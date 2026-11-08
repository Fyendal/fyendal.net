import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";
import { cardTypesOf, dataOf, isAttackActionData, scriptOf } from "./cardProperties.js";
import { BOOST_BANISHED_PREFIX } from "./combatValues.js";
import { gameLogMessage, logCardValue, logNameOf, logPublic, nameOf } from "./gameLog.js";
import { boostCountForCardPlay } from "./playRules.js";
import { lingeringModifierSources } from "./sourceQueries.js";
import { removeFromArray } from "./zoneQueries.js";
import { enterBanish } from "./zoneMoves.js";
import type { BanishBatch } from "./zoneMoves.js";

// Instant-speed plays can pause for cost decisions, so the declaration and its
// result ride on the card until the attack reaches the combat chain.
const DECLARED_BOOSTS_KEY = "engineDeclaredBoosts";
const BOOSTED_ATTACK_KEY = "engineBoostedAttack";

export interface BoostResult {
  boosted: boolean;
  /** A Mechanologist card was banished, so the attack gains go again. */
  boostSucceeded: boolean;
}

export function boostDeclarationError(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  boost: boolean,
  boostCount: number | undefined,
): string | undefined {
  const player = state.players[seat] as PlayerState;
  const availableBoosts = isAttackActionData(dataOf(state, card.cardId))
    ? boostCountForCardPlay(state, seat, card)
    : 0;
  if (boost && availableBoosts < 1) return `${nameOf(state, card.cardId)} cannot boost`;
  if (!boost && boostCount !== undefined) return "cannot declare a Boost count without boosting";
  const declaredBoostCount = boost ? (boostCount ?? 1) : 0;
  if (
    !Number.isSafeInteger(declaredBoostCount) ||
    declaredBoostCount < 0 ||
    declaredBoostCount > availableBoosts
  ) return `${nameOf(state, card.cardId)} cannot boost ${declaredBoostCount} times`;
  if (player.deck.length < declaredBoostCount) {
    return `cannot boost ${declaredBoostCount} times with only ${player.deck.length} card(s) in deck`;
  }
  return undefined;
}

/** Record an instant-speed play's Boost declaration; call after play script state is reset. */
export function declareInstantBoosts(card: CardInstance, boost: boolean, boostCount: number | undefined): void {
  if (!boost) return;
  (card.scriptState ??= {})[DECLARED_BOOSTS_KEY] = boostCount ?? 1;
}

function takeScriptValue(card: CardInstance, key: string): number {
  const value = Number(card.scriptState?.[key] ?? 0);
  if (card.scriptState) {
    delete card.scriptState[key];
    if (Object.keys(card.scriptState).length === 0) delete card.scriptState;
  }
  return value;
}

/** Pay an instant-speed attack's declared Boosts and keep the result for its chain link. */
export function payDeclaredInstantBoosts(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
): void {
  const declared = takeScriptValue(card, DECLARED_BOOSTS_KEY);
  if (declared < 1) return;
  const result = payBoosts(state, runtime, seat, card, declared);
  if (result.boosted) (card.scriptState ??= {})[BOOSTED_ATTACK_KEY] = result.boostSucceeded ? 2 : 1;
}

/** Read and clear the Boost result `payDeclaredInstantBoosts` recorded. */
export function takeInstantBoostResult(card: CardInstance): BoostResult {
  const value = takeScriptValue(card, BOOSTED_ATTACK_KEY);
  return { boosted: value > 0, boostSucceeded: value > 1 };
}

/** Banish the top card for each declared Boost (CR 8.3.9). */
export function payBoosts(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  declaredBoostCount: number,
): BoostResult {
  const player = state.players[seat] as PlayerState;
  let boosted = false;
  let boostSucceeded = false;
  for (let boostIndex = 0; boostIndex < declaredBoostCount; boostIndex++) {
    const banished = player.deck.shift();
    if (!banished) break;
    const boostEventNextId = state.nextInstanceId;
    state.resolving.push(banished);
    const activeBoostSources = [player.hero, ...player.weapons, ...Object.values(player.equipment), ...player.board]
      .filter((source): source is CardInstance => source !== undefined && !source.faceDown);
    const boostSources = [
      ...activeBoostSources,
      ...lingeringModifierSources(state, seat).filter(
        (candidate) => !activeBoostSources.some((source) => source.instanceId === candidate.instanceId),
      ),
    ];
    const replaced = boostSources.some((source) =>
      scriptOf(state, source.cardId, source)?.replaceBoostBanish?.(
        runtime.makeCtx(state, seat, source), card, banished,
      ) === true,
    );
    // A source replacement takes over the whole Boost movement. Otherwise
    // the deck top's own self-replacement may add the top card of each
    // other hero's deck to the same banishment.
    const banishedForBoost: CardInstance[] = [];
    if (!replaced) {
      banishedForBoost.push(banished);
      if (scriptOf(state, banished.cardId, banished)?.boostBanishesOtherDeckTops === true) {
        for (const other of state.players) {
          if (other.seat === seat) continue;
          const top = other.deck.shift();
          if (top) banishedForBoost.push(top);
        }
      }
    }
    const banishBatch: BanishBatch = [];
    for (const moved of banishedForBoost) {
      removeFromArray(state.resolving, moved.instanceId);
      enterBanish(state, runtime, moved, "deck", seat, banishBatch);
      runtime.dispatchFlow(
        "deferEventTriggers",
        state,
        "card-banished-for-boost",
        seat,
        boostEventNextId,
        moved,
      );
      // Boost's banish is an effect-cost of the action card (CR 1.14.1,
      // 8.3.9), so it counts as an action card effect moving the card.
      if (!moved.faceDown) {
        runtime.dispatchFlow(
          "deferEventTriggers",
          state,
          "card-moved-from-deck-by-effect",
          moved.owner,
          boostEventNextId,
          moved,
          { from: "deck", to: "banish", causedBySeat: seat, effectSource: "action-card" },
        );
      }
      // Track the effective types actually banished for Boost. Card
      // scripts use these per-turn markers for conditions such as "if an
      // Evo has been banished from boosting this turn"; replacement
      // effects deliberately do not create the marker.
      for (const type of cardTypesOf(state, moved)) {
        player.flags[`boostedSubtype:${type}`] = true;
      }
      if (moved.owner !== seat) player.flags.boostBanishedOpponentCard = true;
      // Per-object marker for "a card you've banished from boosting this
      // turn"; enterBanish clears it when the card becomes a new object.
      player.flags[`banishedFromBoost:${moved.instanceId}`] = true;
      // Recorded even at 0: the bonus is re-read while the card stays banished.
      const banishPower = scriptOf(state, card.cardId, card)?.boostBanishPowerBonus?.(
        runtime.makeCtx(state, seat, card),
        moved,
      );
      if (banishPower !== undefined) {
        (card.scriptState ??= {})[`${BOOST_BANISHED_PREFIX}${moved.instanceId}`] = banishPower;
      }
    }
    runtime.events.fireCardsBanished(state, banishBatch);
    boosted = true;
    boostSucceeded = boostSucceeded ||
      (replaced ? [banished] : banishedForBoost).some((moved) =>
        cardTypesOf(state, moved).includes("mechanologist")
      );
    player.flags.boostedThisTurn = true;
    player.flags.boostCountThisTurn = (Number(player.flags.boostCountThisTurn) || 0) + 1;
    player.flags.boostCountThisChain = (Number(player.flags.boostCountThisChain) || 0) + 1;
    player.flags.lastBoostedCardInstanceId = banished.instanceId;
    const boostMods = state.modifiers.filter(
      (m) =>
        (m.scope === "until-end-of-turn" || m.scope === "combat-chain") &&
        m.seat === seat &&
        !m.consumed &&
        (m.onBoostAttack !== undefined || m.onBoostDominate === true),
    );
    for (const boostMod of boostMods) {
      if (boostMod.onBoostAttack !== undefined) {
        card.tempPower = (card.tempPower ?? 0) + Number(boostMod.onBoostAttack);
      }
      if (boostMod.onBoostDominate === true) {
        (card.grantedKeywords ??= []).push("dominate");
      }
      boostMod.consumed = true;
    }
    for (const moved of banishedForBoost) {
      scriptOf(state, moved.cardId, moved)?.onBanishedForBoost?.(
        runtime.makeCtx(state, moved.owner, moved),
        card,
      );
    }
    runtime.dispatchFlow(
      "deferEventTriggers",
      state,
      "card-boosted",
      seat,
      boostEventNextId,
      card,
    );
    for (const src of boostSources) {
      scriptOf(state, src.cardId, src)?.onBoosted?.(runtime.makeCtx(state, seat, src), card, banished);
    }
    logPublic(state, gameLogMessage(
      `${logNameOf(state, card.cardId)} boosts`,
      "engine.log.card.boosts",
      { card: logCardValue(card.cardId) },
    ));
  }
  return { boosted, boostSucceeded };
}
