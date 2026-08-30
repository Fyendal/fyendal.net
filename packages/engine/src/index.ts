import { engineRuntime } from "./engineRuntime.js";
import type { GameIntent, MeldSide } from "@fyendal/shared";
import { activateAbility, answerChoice, playCard } from "./actions.js";
import { declareTail } from "./attacks.js";
import { assignDefenders, stageDefenders } from "./defense.js";
import { scriptOf } from "./cardProperties.js";
import { logPublic, nameOf } from "./gameLog.js";
import { checkWin } from "./win.js";
import { currentLink, findCardAnywhere, opponent } from "./zoneQueries.js";
import { closeChain } from "./combatChain.js";
import {
  activateDefenseAbility,
  activateWindowAbility,
  beginReactionStep,
  holdReactionWindow,
  passReaction,
  playReaction,
} from "./reactions.js";
import {
  resumeWagerLossReplacements,
  resumeWagerPrizes,
  resumeWagerResult,
} from "./wagers.js";
import {
  actionCandidates as actionCandidatesImpl,
  legalIntents as legalIntentsImpl,
} from "./legal.js";
import { skipRunechantStep } from "./runechantSkip.js";
import {
  projectStateFor as projectStateForImpl,
  projectStateForReplay as projectStateForReplayImpl,
} from "./project.js";
import {
  answerTriggerChoice,
  answerTriggerOrder,
  answerTriggerOrderList,
  continueStack,
  offerEndActionPriority,
  passWindow,
  playWindowInstant,
} from "./triggers.js";
import {
  cloneState,
  createGame as createGameState,
  type GameConfig,
  type GameStateInternal,
} from "./runtimeState.js";
import type {
  CardInstance,
  ChainLinkState,
  PendingDecisionState,
  PlayerState,
} from "./state.js";
import {
  attackBonusAboveBase as attackBonusAboveBaseImpl,
  basePowerOf as basePowerOfImpl,
} from "./combatValues.js";
import {
  answerArsenal,
  answerEndPhasePitchOrder,
  drawUpTo,
  endTurn,
  startTurn,
} from "./turn.js";
import { globalHookSources } from "./sourceQueries.js";

import { mayPlayFromArsenal, mayPlayFromZone } from "./playRules.js";
import { scriptedPaymentOptions } from "./resources.js";
import { opposingActionsProhibited, ownedCardActionProhibited } from "./restrictions.js";
import { checkStateBased } from "./stateBased.js";

export type ApplyResult =
  | { ok: true; state: GameStateInternal }
  | { ok: false; error: string };

/** Run start-of-game hero effects in seat order. A setup effect may pause on
 * a real player choice; opening hands and turn 1 begin only after all choices
 * are complete. */
function continueGameSetup(state: GameStateInternal, fromSeat: number): void {
  // Rule-defined global objects initialize once before hero setup. Global
  // setup is synchronous; player-choice setup remains owned by hero scripts.
  if (fromSeat === 0) {
    for (const p of state.players) {
      for (const global of globalHookSources(state, p.seat)) {
        scriptOf(state, global.cardId, global)?.onGameStart?.(
          engineRuntime.makeCtx(state, p.seat, global),
        );
      }
    }
  }
  for (let seat = fromSeat; seat < state.players.length; seat++) {
    const p = state.players[seat]!;
    scriptOf(state, p.heroCardId, p.hero)?.onGameStart?.(engineRuntime.makeCtx(state, p.seat, p.hero));
    for (const equipment of Object.values(p.equipment)) {
      if (equipment) {
        scriptOf(state, equipment.cardId, equipment)?.onGameStart?.(
          engineRuntime.makeCtx(state, p.seat, equipment),
        );
      }
    }
    if (state.pendingDecision?.chooseHook) {
      state.pendingDecision.resume = { kind: "game-setup", nextSeat: seat + 1 };
      return;
    }
  }
  for (const p of state.players) drawUpTo(state, engineRuntime, p);
  // Opening hands are drawn before turn 1, so they do not satisfy effects
  // that ask whether a hero has drawn a card "this turn".
  for (const p of state.players) delete p.flags.cardsDrawnThisTurn;
  startTurn(state, engineRuntime);
}

/** Run the deferred continuation after a scripted choice resolves. */
function afterChoice(
  state: GameStateInternal,
  resume: PendingDecisionState["resume"],
): void {
  if (resume?.kind === "after-declare") declareTail(state, engineRuntime);
  else if (resume?.kind === "start-reaction-step") beginReactionStep(state);
  else if (resume?.kind === "continue-stack") continueStack(state, engineRuntime, resume.seat);
  else if (resume?.kind === "finish-wager-result") resumeWagerResult(state, engineRuntime, resume.wagerIndex);
  else if (resume?.kind === "continue-wager-loss-replacements") {
    resumeWagerLossReplacements(
      state, engineRuntime,
      resume.wagerIndex,
      resume.remainingSourceInstanceIds,
    );
  }
  else if (resume?.kind === "continue-wager-prizes") resumeWagerPrizes(state, engineRuntime, resume.wagerIndex);
  else if (resume?.kind === "reopen-reaction") holdReactionWindow(state, engineRuntime, resume.seat);
  else if (resume?.kind === "game-setup") continueGameSetup(state, resume.nextSeat);
}

/** Resume an activated-ability cost flow without duplicating the positional
 * action/window call contract at every decision handler. */
function resumeAbilityActivation(
  state: GameStateInternal,
  resume: NonNullable<PendingDecisionState["activationCost"]>,
  selections: {
    soulInstanceIds?: number[];
    effectCostInstanceIds?: number[];
    discardInstanceIds?: number[];
  } = {},
): string | undefined {
  const soulInstanceIds = selections.soulInstanceIds ?? resume.soulInstanceIds ?? [];
  const effectCostInstanceIds =
    selections.effectCostInstanceIds ?? resume.effectCostInstanceIds ?? [];
  const discardInstanceIds =
    selections.discardInstanceIds ?? resume.discardInstanceIds ?? [];
  return resume.mode === "window"
    ? activateWindowAbility(
        state, engineRuntime,
        resume.seat,
        resume.sourceInstanceId,
        resume.pitchInstanceIds,
        resume.abilityIndex,
        soulInstanceIds,
        true,
        effectCostInstanceIds,
        resume.alternativeCostCardInstanceIds,
        discardInstanceIds,
        resume.declaredVariableX,
      )
    : activateAbility(
        state, engineRuntime,
        resume.seat,
        resume.sourceInstanceId,
        resume.pitchInstanceIds,
        resume.abilityIndex,
        resume.targetAllyId,
        soulInstanceIds,
        true,
        effectCostInstanceIds,
        resume.alternativeCostCardInstanceIds,
        discardInstanceIds,
        resume.declaredVariableX,
      );
}

/** Route a play intent to the handler for the current phase. */
function dispatchPlay(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  fromArsenal: boolean,
  pitchInstanceIds: number[],
  meldSide?: MeldSide,
  targetAllyId?: number,
  boost = false,
  boostCount?: number,
  asInstant?: boolean,
  alternativeCostCardInstanceIds?: number[],
  targetCardInstanceId?: number,
): string | undefined {
  if (state.phase === "layer") {
    return playWindowInstant(
      state, engineRuntime,
      seat,
      card.instanceId,
      fromArsenal,
      pitchInstanceIds,
      meldSide,
      targetCardInstanceId,
      undefined,
      undefined,
      alternativeCostCardInstanceIds,
    );
  }
  if (state.phase === "reaction") {
    return playReaction(
      state, engineRuntime,
      seat,
      card,
      fromArsenal,
      pitchInstanceIds,
      meldSide,
      alternativeCostCardInstanceIds,
      targetCardInstanceId,
    );
  }
  return playCard(
    state, engineRuntime,
    seat,
    card.instanceId,
    pitchInstanceIds,
    fromArsenal ? "arsenal" : "hand",
    meldSide,
    targetAllyId,
    boost,
    boostCount,
    asInstant,
    alternativeCostCardInstanceIds,
    targetCardInstanceId,
  );
}

/**
 * Answer a pending scripted decision (trigger choice, arsenal, or a
 * choose-target/optional-effect choice). Returns null when the pending
 * decision isn't a scripted answer for this seat (caller keeps routing).
 */
function answerScriptedDecision(
  state: GameStateInternal,
  seat: number,
  optionId: string,
): string | undefined | null {
  const pd = state.pendingDecision;
  if (!pd || pd.player !== seat) return null;
  if (pd.chooseHook === "engine-variable-play-x" && pd.variablePlayCost?.choices) {
    const declaration = pd.variablePlayCost.choices[optionId];
    if (!declaration) return "invalid option";
    const pending = pd.variablePlayCost;
    const player = state.players[seat] as PlayerState;
    const payments = scriptedPaymentOptions(
      state,
      player,
      declaration.cost,
      `x:${declaration.x}`,
      [pending.instanceId],
    );
    const options = Object.keys(payments);
    if (options.length === 0) return "declared X cannot be paid";
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: `Pay ${declaration.cost} resources`,
      options,
      sourceInstanceId: pending.instanceId,
      chooseHook: "engine-variable-play-payment",
      resourcePayment: {
        cost: declaration.cost,
        options: Object.entries(payments).map(([paymentOptionId, payment]) => ({
          optionId: paymentOptionId,
          pitchInstanceIds: payment.pitchIds,
        })),
      },
      variablePlayCost: {
        ...pending,
        choices: undefined,
        declaredX: declaration.x,
        paymentOptions: Object.fromEntries(Object.entries(payments).map(([id, payment]) => [
          id,
          { pitchInstanceIds: payment.pitchIds },
        ])),
      },
    };
    const soleOption = options.length === 1 ? options[0] : undefined;
    return soleOption && payments[soleOption]?.pitchIds.length === 0
      ? answerScriptedDecision(state, seat, soleOption)
      : undefined;
  }
  if (pd.chooseHook === "engine-variable-play-payment" && pd.variablePlayCost?.paymentOptions) {
    const payment = pd.variablePlayCost.paymentOptions[optionId];
    if (!payment || pd.variablePlayCost.declaredX === undefined) return "invalid option";
    const pending = pd.variablePlayCost;
    state.pendingDecision = null;
    if (pending.mode === "reaction") {
      const found = findCardAnywhere(state, pending.instanceId);
      if (!found) return "card not found";
      return playReaction(
        state, engineRuntime,
        pending.seat,
        found.card,
        pending.from === "arsenal",
        payment.pitchInstanceIds,
        pending.meldSide,
        pending.alternativeCostCardInstanceIds,
        pending.targetCardInstanceId,
        pending.from === "hand" || pending.from === "arsenal" ? undefined : pending.from,
        pending.declaredX,
      );
    }
    if (pending.mode === "window") {
      return playWindowInstant(
        state, engineRuntime,
        pending.seat,
        pending.instanceId,
        pending.from === "arsenal",
        payment.pitchInstanceIds,
        pending.meldSide,
        pending.targetCardInstanceId,
        pending.from === "hand" || pending.from === "arsenal" ? undefined : pending.from,
        pending.declaredX,
        pending.alternativeCostCardInstanceIds,
      );
    }
    return playCard(
      state, engineRuntime,
      pending.seat,
      pending.instanceId,
      payment.pitchInstanceIds,
      pending.from,
      pending.meldSide,
      pending.targetAllyId,
      pending.boost,
      pending.boostCount,
      pending.asInstant,
      pending.alternativeCostCardInstanceIds,
      pending.targetCardInstanceId,
      pending.declaredX,
    );
  }
  if (pd.chooseHook === "engine-variable-activation-x" && pd.variableActivationCost?.choices) {
    const declaration = pd.variableActivationCost.choices[optionId];
    if (!declaration) return "invalid option";
    const pending = pd.variableActivationCost;
    const player = state.players[seat] as PlayerState;
    const payments = scriptedPaymentOptions(
      state,
      player,
      declaration.cost,
      `x:${declaration.x}`,
      [pending.sourceInstanceId],
    );
    const options = Object.keys(payments);
    if (options.length === 0) return "declared X cannot be paid";
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: `Pay ${declaration.cost} resources`,
      options,
      sourceInstanceId: pending.sourceInstanceId,
      chooseHook: "engine-variable-activation-payment",
      resourcePayment: {
        cost: declaration.cost,
        options: Object.entries(payments).map(([paymentOptionId, payment]) => ({
          optionId: paymentOptionId,
          pitchInstanceIds: payment.pitchIds,
        })),
      },
      variableActivationCost: {
        ...pending,
        choices: undefined,
        declaredX: declaration.x,
        paymentOptions: Object.fromEntries(Object.entries(payments).map(([id, payment]) => [
          id,
          { pitchInstanceIds: payment.pitchIds },
        ])),
      },
    };
    const soleOption = options.length === 1 ? options[0] : undefined;
    return soleOption && payments[soleOption]?.pitchIds.length === 0
      ? answerScriptedDecision(state, seat, soleOption)
      : undefined;
  }
  if (pd.chooseHook === "engine-variable-activation-payment" && pd.variableActivationCost?.paymentOptions) {
    const payment = pd.variableActivationCost.paymentOptions[optionId];
    if (!payment || pd.variableActivationCost.declaredX === undefined) return "invalid option";
    const pending = pd.variableActivationCost;
    state.pendingDecision = null;
    return pending.mode === "window"
      ? activateWindowAbility(
          state, engineRuntime,
          pending.seat,
          pending.sourceInstanceId,
          payment.pitchInstanceIds,
          pending.abilityIndex,
          [],
          true,
          [],
          undefined,
          [],
          pending.declaredX,
        )
      : activateAbility(
          state, engineRuntime,
          pending.seat,
          pending.sourceInstanceId,
          payment.pitchInstanceIds,
          pending.abilityIndex,
          undefined,
          [],
          true,
          [],
          undefined,
          [],
          pending.declaredX,
        );
  }
  if (pd.chooseHook === "engine-activation-discard" && pd.activationCost) {
    if (!pd.options?.includes(optionId)) return "invalid option";
    const resume = pd.activationCost;
    const selected = [...(resume.discardInstanceIds ?? []), Number(optionId)];
    state.pendingDecision = null;
    return resumeAbilityActivation(state, resume, { discardInstanceIds: selected });
  }
  if (pd.chooseHook === "engine-activation-soul" && pd.activationCost) {
    if (!pd.options?.includes(optionId)) return "invalid option";
    const resume = pd.activationCost;
    const selected = [...(resume.soulInstanceIds ?? []), Number(optionId)];
    state.pendingDecision = null;
    return resumeAbilityActivation(state, resume, { soulInstanceIds: selected });
  }
  if (pd.activationCost?.effectCostInstanceIds !== undefined) {
    if (!pd.options?.includes(optionId)) return "invalid option";
    const resume = pd.activationCost;
    const selected = [...(resume.effectCostInstanceIds ?? []), Number(optionId)];
    state.pendingDecision = null;
    return resumeAbilityActivation(state, resume, { effectCostInstanceIds: selected });
  }
  if (pd.chooseHook === "trigger-choice") return answerTriggerChoice(state, engineRuntime, seat, optionId);
  if (pd.chooseHook === "trigger-order") return answerTriggerOrder(state, engineRuntime, seat, optionId);
  if (pd.chooseHook === "engine-end-phase-pitch-order") {
    return answerEndPhasePitchOrder(state, engineRuntime, seat, optionId);
  }
  if (pd.kind === "arsenal") return answerArsenal(state, engineRuntime, seat, optionId);
  if (pd.kind === "choose-target" || pd.kind === "choose-name" || pd.kind === "optional-effect") {
    const resume = pd.resume;
    const err = answerChoice(state, engineRuntime, seat, optionId);
    // a chained follow-up choice inherited the resume inside answerChoice;
    // the continuation runs when the follow-up is answered, not now
    if (!err && !state.pendingDecision?.chooseHook) afterChoice(state, resume);
    return err;
  }
  return null;
}

/** Create a new game: hero game-start effects run (decks already shuffled),
 *  both players draw opening hands, then the first turn starts. */
export function createGame(config: GameConfig): GameStateInternal {
  const state = createGameState(config);
  for (const player of state.players) {
    for (const equipment of Object.values(player.equipment)) {
      if (equipment) engineRuntime.events.runHook(state, player.seat, equipment, "onEnterArena");
    }
  }
  continueGameSetup(state, 0);
  return state;
}

/**
 * The single entry point for all player actions. Never throws on illegal
 * input; returns a new state on success and leaves the input state untouched.
 */
export function applyIntent(
  state: GameStateInternal,
  seat: number,
  intent: GameIntent,
): ApplyResult {
  if (state.winner !== null) return { ok: false, error: "game is over" };
  if (
    (intent.kind === "play-card" ||
      intent.kind === "play-from-arsenal" ||
      intent.kind === "play-from-zone" ||
      intent.kind === "activate-ability") &&
    opposingActionsProhibited(state, seat)
  ) {
    return { ok: false, error: "opponents cannot play cards or activate abilities this turn" };
  }
  if (
    intent.kind === "play-card" ||
    intent.kind === "play-from-arsenal" ||
    intent.kind === "play-from-zone" ||
    intent.kind === "activate-ability"
  ) {
    const instanceId = intent.kind === "activate-ability"
      ? intent.sourceInstanceId
      : intent.instanceId;
    const found = findCardAnywhere(state, instanceId);
    if (found && ownedCardActionProhibited(state, seat, found.card)) {
      return { ok: false, error: "cannot play or activate a card you own" };
    }
  }
  const next = cloneState(state);
  let err: string | undefined;

  switch (intent.kind) {
    case "concede": {
      next.winner = opponent(seat);
      next.phase = "game-over";
      next.pendingDecision = null;
      const conceding = next.players[seat];
      if (conceding) logPublic(next, `${nameOf(next, conceding.heroCardId)} concedes`);
      break;
    }
    case "play-card": {
      const found = findCardAnywhere(next, intent.instanceId);
      if (!found || found.seat !== seat) {
        err = "card not found";
        break;
      }
      err = dispatchPlay(next, seat, found.card, false, intent.pitchInstanceIds, intent.meldSide, intent.targetAllyId, intent.boost, intent.boostCount, intent.asInstant, intent.alternativeCostCardInstanceIds, intent.targetCardInstanceId);
      break;
    }
    case "play-from-arsenal": {
      const found = findCardAnywhere(next, intent.instanceId);
      const card = found?.card;
      if (!card || !found || !next.players[found.seat]?.arsenal.some((candidate) => candidate.instanceId === card.instanceId)) {
        err = "card not in arsenal";
        break;
      }
      if (!mayPlayFromArsenal(next, card, seat)) {
        err = "card may not be played from arsenal";
        break;
      }
      err = dispatchPlay(next, seat, card, true, intent.pitchInstanceIds, intent.meldSide, intent.targetAllyId, intent.boost, intent.boostCount, intent.asInstant, intent.alternativeCostCardInstanceIds, intent.targetCardInstanceId);
      break;
    }
    case "play-from-zone": {
      const found = findCardAnywhere(next, intent.instanceId);
      if (!found || !mayPlayFromZone(next, engineRuntime, found.card, intent.zone, seat)) {
        err = "card not found";
      } else if (next.phase === "layer") {
        err = playWindowInstant(
          next, engineRuntime,
          seat,
          intent.instanceId,
          false,
          intent.pitchInstanceIds,
          intent.meldSide,
          intent.targetCardInstanceId,
          intent.zone,
          undefined,
          intent.alternativeCostCardInstanceIds,
        );
      } else if (next.phase === "reaction") {
        err = playReaction(next, engineRuntime, seat, found.card, false, intent.pitchInstanceIds, intent.meldSide, intent.alternativeCostCardInstanceIds, intent.targetCardInstanceId, intent.zone);
      } else {
        err = playCard(next, engineRuntime, seat, intent.instanceId, intent.pitchInstanceIds, intent.zone, intent.meldSide, intent.targetAllyId, intent.boost, intent.boostCount, intent.asInstant, intent.alternativeCostCardInstanceIds, intent.targetCardInstanceId);
      }
      break;
    }
    case "activate-ability": {
      const ai = intent.abilityIndex ?? 0;
      if (next.phase === "reaction" || next.phase === "defend") {
        const link = currentLink(next);
        const defending = link?.defendingCards.some(
          (c) => c.instanceId === intent.sourceInstanceId && c.owner === seat,
        );
        err = defending
          ? activateDefenseAbility(next, engineRuntime, seat, intent.sourceInstanceId, intent.pitchInstanceIds)
          : activateWindowAbility(next, engineRuntime, seat, intent.sourceInstanceId, intent.pitchInstanceIds, ai, [], false, [], intent.alternativeCostCardInstanceIds);
      } else if (next.phase === "layer") {
        err = activateWindowAbility(next, engineRuntime, seat, intent.sourceInstanceId, intent.pitchInstanceIds, ai, [], false, [], intent.alternativeCostCardInstanceIds);
      } else {
        err = activateAbility(next, engineRuntime, seat, intent.sourceInstanceId, intent.pitchInstanceIds, ai, intent.targetAllyId, [], false, [], intent.alternativeCostCardInstanceIds);
      }
      break;
    }
    case "pass": {
      const pd = next.pendingDecision;
      if (pd?.kind === "priority-window") {
        err = passWindow(next, engineRuntime, seat);
      } else if (pd?.kind === "optional-effect" || pd?.kind === "arsenal") {
        // scripted yes/no (and arsenal) decisions decline on pass — in ANY
        // phase; the phase-based reaction pass below only applies when no
        // scripted decision is open
        const res = answerScriptedDecision(next, seat, pd.kind === "arsenal" ? "pass" : "no");
        err = res === null ? "cannot pass now" : res;
      } else if (next.phase === "reaction") {
        err = passReaction(next, engineRuntime, seat);
      } else if (
        next.phase === "action" &&
        !pd &&
        !currentLink(next) &&
        seat === next.priorityPlayer
      ) {
        if (!offerEndActionPriority(next, engineRuntime, seat)) endTurn(next, engineRuntime);
      } else {
        // scripted decisions decline on "no"; a decision without "no" but with
        // an explicit "pass" option (look-at acknowledgments, opt, ordering
        // choices) declines on "pass" instead
        const options = next.pendingDecision?.options;
        const decline = options && !options.includes("no") && options.includes("pass") ? "pass" : "no";
        const res = answerScriptedDecision(next, seat, decline);
        err = res === null ? "cannot pass now" : res;
      }
      break;
    }
    case "defend": {
      err = assignDefenders(next, engineRuntime, seat, intent.instanceIds, intent.pitchInstanceIds ?? []);
      break;
    }
    case "stage-defenders": {
      err = stageDefenders(next, engineRuntime, seat, intent.instanceIds);
      break;
    }
    case "close-chain": {
      // only the turn player, in their action phase, while the chain is still
      // open (links present, last resolved, no new attack declared)
      const last = next.chain[next.chain.length - 1];
      if (
        next.phase !== "action" ||
        next.pendingDecision ||
        seat !== next.activePlayer ||
        seat !== next.priorityPlayer ||
        !last ||
        !last.resolved
      ) {
        err = "cannot close the combat chain now";
        break;
      }
      closeChain(next, engineRuntime);
      if ((next.pendingTriggeredLayers?.length ?? 0) > 0) {
        next.stackResume ??= "begin-action";
        continueStack(next, engineRuntime);
      }
      break;
    }
    case "choose": {
      const res = answerScriptedDecision(next, seat, intent.optionId);
      err =
        res === null
          ? next.pendingDecision && next.pendingDecision.player === seat
            ? "not a choice decision"
            : "not your decision"
          : res;
      break;
    }
    case "order-triggers": {
      err = answerTriggerOrderList(next, engineRuntime, seat, intent.optionIds);
      break;
    }
    case "skip-runechant": {
      err = skipRunechantStep(next, engineRuntime, seat);
      break;
    }
  }

  if (err) return { ok: false, error: err };
  checkStateBased(next, engineRuntime);
  checkWin(next);
  return { ok: true, state: next };
}

export function legalIntents(state: GameStateInternal, seat: number) {
  return legalIntentsImpl(state, engineRuntime, seat);
}

export function actionCandidates(state: GameStateInternal, seat: number) {
  return actionCandidatesImpl(state, engineRuntime, seat);
}

export function projectStateFor(
  state: GameStateInternal,
  seat: number | null,
  publicGameId?: string,
) {
  return projectStateForImpl(state, engineRuntime, seat, publicGameId);
}

export function projectStateForReplay(state: GameStateInternal, publicGameId?: string) {
  return projectStateForReplayImpl(state, engineRuntime, publicGameId);
}
export { runechantSequenceActive } from "./runechantSkip.js";
export { rngNext } from "./rng.js";
export {
  chainLinkNumber,
  chainLinksControlled,
  hitsThisCombatChain,
} from "./combatValues.js";

export function basePowerOf(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  raw: number,
) {
  return basePowerOfImpl(state, engineRuntime, seat, card, raw);
}

export function attackBonusAboveBase(
  state: GameStateInternal,
  link: ChainLinkState,
  excludeInstanceId?: number,
) {
  return attackBonusAboveBaseImpl(state, engineRuntime, link, excludeInstanceId);
}
export type { ActivatedAbility } from "./scripts.js";
export type {
  CardInstance,
  GameLogEntry,
  Modifier,
} from "./state.js";
export type { GameStateInternal as GameState } from "./runtimeState.js";
export type { CardScript, DeepReadonly, ScriptCtx, TriggerDef } from "./scripts.js";
