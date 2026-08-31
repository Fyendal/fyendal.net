import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { activatedFlagKey } from "./scripts.js";
import type { ChainLinkState, PlayerState } from "./state.js";
import { nameOf } from "./gameLog.js";
import { heroSoulCards } from "./zoneQueries.js";
import { abilityResourceCost, effectiveAbilityList, payActivatedAbilityCost, prepareActivatedDiscardCost, prepareActivatedEffectCardCosts } from "./abilityRules.js";
import { pushAbilityLayer } from "./stackCore.js";

/** Validate, pay for, and stack an ability activated from hand.
 * Action and priority-window callers share this flow; they remain responsible
 * for restoring the appropriate priority window after the layer is added. */
export function activateFromHandAbility(
  state: GameStateInternal,
  runtime: EngineRuntime,
  options: {
    mode: "action" | "window";
    seat: number;
    sourceInstanceId: number;
    abilityIndex: number;
    pitchInstanceIds: number[];
    soulInstanceIds: number[];
    effectCostInstanceIds: number[];
    alternativeCostCardInstanceIds?: number[];
    discardInstanceIds: number[];
    declaredVariableX?: number;
    link?: ChainLinkState;
  },
): { status: "activated" | "pending" } | { status: "error"; error: string } {
  const {
    mode,
    seat,
    sourceInstanceId,
    abilityIndex,
    pitchInstanceIds,
    soulInstanceIds,
    effectCostInstanceIds,
    alternativeCostCardInstanceIds,
    discardInstanceIds,
    declaredVariableX,
    link,
  } = options;
  const player = state.players[seat] as PlayerState;
  const card = player.hand.find((candidate) => candidate.instanceId === sourceInstanceId);
  const ability = card ? effectiveAbilityList(state, seat, card)[abilityIndex] : undefined;
  if (!card || !ability?.fromHand || ability.isAttack) {
    return { status: "error", error: "source not found" };
  }
  const timing = ability.timing ?? "action";
  const validTiming = timing === "instant" || (
    mode === "window" &&
    timing === "attack-reaction" &&
    link?.attacker === seat &&
    state.pendingDecision?.kind === "attack-reaction"
  );
  if (!validTiming) {
    return { status: "error", error: "ability is not usable in this window" };
  }
  const flagKey = activatedFlagKey(card.instanceId, abilityIndex);
  if (ability.oncePerTurn && player.flags[flagKey]) {
    return { status: "error", error: "ability can only be activated once per turn" };
  }
  const ctx = runtime.makeCtx(state, seat, card, link);
  if (ability.canActivate && !ability.canActivate(ctx)) {
    return { status: "error", error: "cannot activate now" };
  }

  const variableSoul = ability.variableBanishSoulCost;
  const maximumSoulCost = variableSoul
    ? Math.min(
        heroSoulCards(player).length,
        Math.max(0, Math.floor(variableSoul.maximum ?? 127)),
      )
    : 0;
  if (variableSoul && declaredVariableX === undefined) {
    const choices = Object.fromEntries(
      Array.from({ length: maximumSoulCost + 1 }, (_, x) => [`X = ${x}`, { x, cost: 0 }]),
    );
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: variableSoul.prompt ?? "Choose X",
      options: Object.keys(choices),
      sourceInstanceId: card.instanceId,
      chooseHook: "engine-variable-activation-x",
      variableActivationCost: {
        mode,
        seat,
        sourceInstanceId: card.instanceId,
        abilityIndex,
        choices,
      },
    };
    return { status: "pending" };
  }
  if (
    variableSoul &&
    (!Number.isSafeInteger(declaredVariableX) ||
      declaredVariableX! < 0 ||
      declaredVariableX! > maximumSoulCost)
  ) {
    return { status: "error", error: "invalid X declaration" };
  }

  const costAbility = variableSoul
    ? { ...ability, banishSoulCost: declaredVariableX! }
    : ability;
  const discardCostPrep = prepareActivatedDiscardCost(
    state,
    mode,
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    undefined,
    discardInstanceIds,
    effectCostInstanceIds,
    alternativeCostCardInstanceIds,
    declaredVariableX,
  );
  if (discardCostPrep === "pending") return { status: "pending" };
  if (discardCostPrep) return { status: "error", error: discardCostPrep };

  const effectCostPrep = prepareActivatedEffectCardCosts(
    state,
    mode,
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    undefined,
    effectCostInstanceIds,
    discardInstanceIds,
    alternativeCostCardInstanceIds,
    declaredVariableX,
  );
  if (effectCostPrep === "pending") return { status: "pending" };
  if (effectCostPrep) return { status: "error", error: effectCostPrep };

  const selectedSoulIds = [...new Set(soulInstanceIds)];
  const soulCost = costAbility.banishSoulCost ?? 0;
  if (selectedSoulIds.length < soulCost) {
    const remaining = heroSoulCards(player)
      .filter((candidate) => !selectedSoulIds.includes(candidate.instanceId));
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: `${nameOf(state, card.cardId)}: choose soul card ${selectedSoulIds.length + 1} of ${soulCost} to banish as a cost`,
      options: remaining.map((candidate) => String(candidate.instanceId)),
      cardOptions: remaining.map((candidate) => candidate.instanceId),
      sourceInstanceId: card.instanceId,
      chooseHook: "engine-activation-soul",
      activationCost: {
        mode,
        seat,
        sourceInstanceId: card.instanceId,
        abilityIndex,
        pitchInstanceIds,
        ...(selectedSoulIds.length ? { soulInstanceIds: selectedSoulIds } : {}),
        ...(discardInstanceIds.length ? { discardInstanceIds } : {}),
        ...(effectCostInstanceIds.length ? { effectCostInstanceIds } : {}),
        ...(declaredVariableX === undefined ? {} : { declaredVariableX }),
      },
    };
    return { status: "pending" };
  }
  if (pitchInstanceIds.includes(card.instanceId)) {
    return { status: "error", error: "cannot pitch the ability source" };
  }

  const costError = payActivatedAbilityCost(
    state, runtime,
    seat,
    card,
    costAbility,
    abilityIndex,
    pitchInstanceIds,
    abilityResourceCost(state, runtime, seat, card, costAbility, link),
    {
      chiCost: costAbility.chiCost,
      soulInstanceIds: selectedSoulIds,
      effectCostInstanceIds,
      discardInstanceIds,
    },
  );
  if (costError) return { status: "error", error: costError };
  if (variableSoul) (card.counters ??= {})[variableSoul.counterKey] = declaredVariableX!;
  if (ability.fromHandMove === "banish") ctx.banish(card.instanceId);
  else ctx.discardCard(seat, card.instanceId);
  pushAbilityLayer(state, seat, card, nameOf(state, card.cardId), { abilityIndex });
  return { status: "activated" };
}
