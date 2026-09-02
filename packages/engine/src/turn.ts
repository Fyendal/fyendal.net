import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";
import { dataOf, scriptOf } from "./cardProperties.js";

import { logPublic, nameOf } from "./gameLog.js";

import { beginStatsTurn } from "./stats.js";
import { findPermanent, opponent } from "./zoneQueries.js";
import { destroyPermanent } from "./zoneMoves.js";
import { controlledPermanents } from "./sourceQueries.js";
import { arsenalCapacity, canUntapPermanent, drawCards, stampControlledName } from "./cardLifecycle.js";
import { transitionZone } from "./transitions.js";

/** Draw cards until the player's hand reaches their intellect. */
export function drawUpTo(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState): void {
  const baseIntellect =
    typeof player.flags.baseIntellectThisTurn === "number"
      ? player.flags.baseIntellectThisTurn
      : player.intellect;
  const intellect = baseIntellect + Number(player.flags.bonusIntellect || 0);
  const need = intellect - player.hand.length;
  if (need > 0 && player.deck.length > 0) {
    const drawn = Math.min(need, player.deck.length);
    drawCards(state, runtime, player, need);
    logPublic(state, `${nameOf(state, player.heroCardId)} draws ${drawn} card(s)`);
  }
}

/**
 * Start of the active player's turn: reset AP, then the start phase — every
 * start-of-turn trigger (e.g. a face-down mentor in arsenal) goes on the stack
 * and resolves without priority before beginning-of-action-phase triggers.
 * The turn action point is assigned as the action phase begins, before those
 * beginning-of-action-phase layers receive priority. (Draws happen in the end
 * phase.)
 */
export function startTurn(state: GameStateInternal, runtime: EngineRuntime): void {
  state.modifiers = state.modifiers.filter(
    (modifier) =>
      (modifier.expiresAtStartOfTurn === undefined || modifier.expiresAtStartOfTurn > state.turn) &&
      !(modifier.expiresAtStartOfSeatTurn === state.activePlayer && Number(modifier.createdTurn ?? -1) < state.turn),
  );
  beginStatsTurn(state);
  const player = state.players[state.activePlayer] as PlayerState;
  // "if you've controlled a <name> this turn" flags: everything in play at the
  // start of the turn counts, even if a start-of-turn trigger removes it
  for (const candidate of state.players as PlayerState[]) {
    for (const permanent of controlledPermanents(state, candidate.seat, { faceDownEquipment: false })) {
      stampControlledName(state, candidate, permanent);
    }
  }
  for (const candidate of state.players as PlayerState[]) {
    for (const zone of [candidate.hand, candidate.deck, candidate.arsenal, candidate.pitch, candidate.graveyard, candidate.banish, candidate.board]) {
      for (const card of zone) {
        const absoluteExpired = card.playableFromExpiry !== undefined && card.playableFromExpiry <= state.turn;
        const seatExpired = card.playableFromUntilStartOfSeatTurn === state.activePlayer &&
          Number(card.playableFromGrantedTurn ?? -1) < state.turn;
        if (!absoluteExpired && !seatExpired) continue;
        delete card.playableFrom;
        delete card.playableBySeat;
        delete card.playCostReduction;
        delete card.playCostReductionSeat;
        delete card.playableFromExpiry;
        delete card.playableFromUntilStartOfSeatTurn;
        delete card.playableFromGrantedTurn;
        delete card.playableAsInstant;
      }
    }
  }
  if (Number(player.hero.counters?.cannotDrawActionTurn ?? 0) === state.turn) {
    player.flags.cannotDrawNextActionPhase = true;
  }
  if (Number(player.hero.counters?.goAgainSuppressedPending ?? 0) > 0) {
    (player.hero.counters ??= {}).goAgainSuppressedTurn = state.turn;
    delete player.hero.counters?.goAgainSuppressedPending;
  }
  const originalHeroId = player.hero.temporaryHeroOriginalCardId;
  if (
    originalHeroId !== undefined &&
    Number(player.hero.temporaryHeroUntilTurn ?? 0) <= state.turn
  ) {
    const transformedName = nameOf(state, player.heroCardId);
    player.hero.cardId = originalHeroId;
    player.heroCardId = originalHeroId;
    delete player.hero.temporaryHeroOriginalCardId;
    delete player.hero.temporaryHeroUntilTurn;
    logPublic(state, `${transformedName} returns to being ${nameOf(state, originalHeroId)}`);
    scriptOf(state, originalHeroId, player.hero)?.onBecomeHero?.(
      runtime.makeCtx(state, player.seat, player.hero),
    );
  }
  state.phase = "start";
  state.priorityPlayer = state.activePlayer;
  state.pendingDecision = null;
  // The turn action point is assigned when the action phase begins, after the
  // automatic start phase has finished (CR 4.2.1–4.3.3).
  player.actionPoints = 0;
  player.resources = 0;
  player.chi = 0; // floating chi resets wherever floating resources reset
  logPublic(state, `— Turn ${state.turn}: ${nameOf(state, player.heroCardId)}'s turn —`);
  runtime.dispatchFlow("queueEventTriggers", state, "start-of-turn", state.activePlayer, "begin-action-phase");
}

/** Active player passes with an empty chain → end phase: end-of-turn triggers resolve first. */
export function endTurn(state: GameStateInternal, runtime: EngineRuntime): void {
  // CR 4.3.4 closes a resolved combat chain before the end phase begins. This
  // settles attacking/defending cards and applies Blade Break, Battleworn,
  // Guardwell, and Temper while the game is still in the action phase. A
  // chain-close trigger must finish before we resume this boundary.
  if (state.chain.length > 0) {
    runtime.dispatchFlow("closeChain", state);
    if (state.stack.length > 0 || (state.pendingTriggeredLayers?.length ?? 0) > 0) {
      state.stackResume ??= "end-action-phase";
      runtime.dispatchFlow("continueStack", state);
      return;
    }
  }
  state.phase = "end";
  // scheduled delayed destructions fire at the beginning of the end phase
  const pending = state.pendingDestructions.splice(0);
  for (const { seat, instanceId } of pending) {
    const found = findPermanent(state, instanceId);
    if (found) destroyPermanent(state, runtime, seat, found.card);
  }
  // delayed counter wipes (Glisten's "at the beginning of your end phase,
  // remove all +1{p} counters from weapons you control")
  const turnPlayer = state.players[state.activePlayer] as PlayerState;
  if (Number(turnPlayer.hero.counters?.clearHandAndArsenalAtEndPhaseTurn ?? 0) === state.turn) {
    const ctx = runtime.makeCtx(state, turnPlayer.seat, turnPlayer.hero);
    for (const card of [...turnPlayer.hand]) ctx.discardCard(turnPlayer.seat, card.instanceId);
    for (const card of [...turnPlayer.arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal");
    delete turnPlayer.hero.counters?.clearHandAndArsenalAtEndPhaseTurn;
  }
  for (const candidate of state.players as PlayerState[]) {
    if (Number(candidate.hero.counters?.bonusIntellectAtEndPhaseTurn ?? 0) !== state.turn) continue;
    delete candidate.hero.counters?.bonusIntellectAtEndPhaseTurn;
    candidate.flags.bonusIntellect = Number(candidate.flags.bonusIntellect ?? 0) + 1;
  }
  for (const candidate of state.players as PlayerState[]) {
    if (Number(candidate.hero.counters?.drawUpToAtEndPhaseTurn ?? 0) !== state.turn) continue;
    delete candidate.hero.counters?.drawUpToAtEndPhaseTurn;
    drawUpTo(state, runtime, candidate);
  }
  if (Number(turnPlayer.flags.clearWeaponPowerCountersAtTurn || 0) === state.turn) {
    for (const w of turnPlayer.weapons) {
      if (w.counters?.power) {
        delete w.counters.power;
        logPublic(state, `${nameOf(state, w.cardId)}'s +1{p} counters are removed`);
      }
    }
    turnPlayer.flags.clearWeaponPowerCountersAtTurn = 0;
  }
  // stolen permanents return home at the end of the action phase (8.3.x): move
  // them back if the thief still controls them
  const returns = state.controlReturns.splice(0);
  for (const { instanceId, thiefSeat, homeSeat } of returns) {
    const thief = state.players[thiefSeat] as PlayerState;
    const idx = thief.board.findIndex((c) => c.instanceId === instanceId);
    if (idx < 0) continue; // left play meanwhile
    const card = thief.board.splice(idx, 1)[0] as CardInstance;
    const home = state.players[homeSeat] as PlayerState;
    home.board.push(card);
    stampControlledName(state, home, card);
    logPublic(state, `${nameOf(state, card.cardId)} returns to ${nameOf(state, home.heroCardId)}'s control`);
  }
  // Face-down banished cards pending return go back to hand at their scheduled
  // beginning of end phase. Intimidated cards return at the upcoming one.
  for (const p of state.players) {
    const pl = p as PlayerState;
    const due = (card: CardInstance): boolean =>
      card.intimidated === true || (card.returnToHandAtTurn ?? Infinity) <= state.turn;
    const returning = pl.banish.filter(due);
    pl.banish = pl.banish.filter((card) => !due(card));
    for (const c of returning) {
      const wasIntimidated = c.intimidated === true;
      c.faceDown = undefined;
      delete c.intimidated;
      delete c.returnToHandAtTurn;
      pl.hand.push(c);
      runtime.transitions.move(
        c,
        transitionZone("banish", pl.seat),
        transitionZone("hand", pl.seat),
        { from: true, to: true },
      );
      logPublic(
        state,
        `${nameOf(state, pl.heroCardId)}'s ${wasIntimidated ? "intimidated" : "face-down banished"} card returns to their hand`,
      );
    }
  }
  runtime.dispatchFlow("queueEventTriggers", state, "end-of-turn", state.activePlayer, "end-phase");
}

/** End phase after the stack has resolved: arsenal decision, then cleanup. */
export function continueEndPhase(state: GameStateInternal, runtime: EngineRuntime): void {
  const player = state.players[state.activePlayer] as PlayerState;
  if (player.hand.length > 0 && player.arsenal.length < arsenalCapacity(state, player.seat)) {
    state.pendingDecision = {
      player: player.seat,
      kind: "arsenal",
      prompt: "You may put a card from your hand into your arsenal, or pass",
      promptMessage: { id: "engine.decision.arsenal" },
      options: player.hand.map((c) => String(c.instanceId)),
      cardOptions: player.hand.map((c) => c.instanceId), // own hand — visible
    };
    return;
  }
  finishEndPhase(state, runtime);
}

export function answerArsenal(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  if (!pd || pd.kind !== "arsenal" || pd.player !== seat) return "not your decision";
  const player = state.players[seat] as PlayerState;
  if (optionId !== "pass") {
    const id = Number(optionId);
    const idx = player.hand.findIndex((c) => c.instanceId === id);
    if (idx < 0) return "card not in hand";
    const card = player.hand.splice(idx, 1)[0] as CardInstance;
    card.faceDown = true;
    const used = new Set(player.arsenal.map((candidate, index) => candidate.arsenalSlot ?? index));
    let slot = 0;
    while (used.has(slot)) slot++;
    card.arsenalSlot = slot;
    player.arsenal.push(card);
    runtime.transitions.move(
      card,
      transitionZone("hand", player.seat),
      transitionZone("arsenal", player.seat),
      { from: true, to: true },
    );
    logPublic(state, `${nameOf(state, player.heroCardId)} puts a card face down into arsenal`);
  }
  finishEndPhase(state, runtime);
  return undefined;
}

/**
 * Continue CR 4.4.3c in turn-player order. A single pitch card has no relative
 * order to choose; two or more pause cleanup on a private card choice.
 */
function continuePitchBottoming(state: GameStateInternal, runtime: EngineRuntime): void {
  const seatOrder = [state.activePlayer, opponent(state.activePlayer)];
  for (const seat of seatOrder) {
    const player = state.players[seat] as PlayerState;
    if (player.pitch.length === 0) continue;
    if (player.pitch.length === 1) {
      const card = player.pitch.shift() as CardInstance;
      player.deck.push(card);
      runtime.transitions.move(
        card,
        transitionZone("pitch", player.seat),
        transitionZone("deck", player.seat, "bottom"),
        { to: true },
      );
      continue;
    }

    const ids = player.pitch.map((card) => card.instanceId);
    state.pendingDecision = {
      player: seat,
      kind: "choose-target",
      prompt: "Choose the first card to put on the bottom of your deck",
      promptMessage: { id: "engine.decision.deckbottom.first" },
      options: ids.map(String),
      cardOptions: [...ids],
      chooseHook: "engine-end-phase-pitch-order",
      deckBottomOrder: { ordered: [], remaining: ids },
    };
    return;
  }

  completeEndPhase(state, runtime);
}

/** Answer the private, one-card-at-a-time pitch ordering choice. */
export function answerEndPhasePitchOrder(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  if (
    !pd ||
    pd.player !== seat ||
    pd.chooseHook !== "engine-end-phase-pitch-order" ||
    !pd.deckBottomOrder
  ) {
    return "not your decision";
  }

  const chosen = Number(optionId);
  const index = pd.deckBottomOrder.remaining.indexOf(chosen);
  if (!Number.isSafeInteger(chosen) || index < 0) return "invalid option";

  const ordered = [...pd.deckBottomOrder.ordered, chosen];
  const remaining = pd.deckBottomOrder.remaining.filter((_, i) => i !== index);
  if (remaining.length > 1) {
    pd.prompt = "Choose the next card to put on the bottom of your deck";
    pd.options = remaining.map(String);
    pd.cardOptions = [...remaining];
    pd.deckBottomOrder = { ordered, remaining };
    return undefined;
  }

  const player = state.players[seat] as PlayerState;
  const cardsById = new Map(player.pitch.map((card) => [card.instanceId, card]));
  const finalOrder = [...ordered, ...remaining];
  if (
    finalOrder.length !== player.pitch.length ||
    finalOrder.some((instanceId) => !cardsById.has(instanceId))
  ) {
    return "pitch zone changed during ordering";
  }
  player.pitch = [];
  for (const instanceId of finalOrder) {
    const card = cardsById.get(instanceId) as CardInstance;
    player.deck.push(card);
    runtime.transitions.move(
      card,
      transitionZone("pitch", player.seat),
      transitionZone("deck", player.seat, "bottom"),
      { to: true },
    );
  }
  state.pendingDecision = null;
  continuePitchBottoming(state, runtime);
  return undefined;
}

export function finishEndPhase(state: GameStateInternal, runtime: EngineRuntime): void {
  continuePitchBottoming(state, runtime);
}

function completeEndPhase(state: GameStateInternal, runtime: EngineRuntime): void {
  const player = state.players[state.activePlayer] as PlayerState;
  // Granted aura attacks leave a public presentation marker on the attacking
  // card. It is turn state, so remove it during that controller's cleanup.
  for (const card of player.board) {
    delete card.counters?.attacked;
    if (card.counters && Object.keys(card.counters).length === 0) delete card.counters;
  }
  // untap step (APUD): only the turn player untaps their permanents, after
  // pitching and before drawing
  const permanents = controlledPermanents(state, player.seat, {
    includeDisabledHero: true,
  });
  let untapped = 0;
  for (const c of permanents) {
    if (c.tapped && canUntapPermanent(state, runtime, c)) {
      delete c.tapped;
      untapped++;
    }
  }
  if (untapped > 0) {
    logPublic(state, `${nameOf(state, player.heroCardId)} untaps ${untapped} permanent(s)`);
  }
  // CR 8.2.8b: during the end phase (either player's), every ally's life
  // total resets to its base life
  for (const p of state.players) {
    for (const c of (p as PlayerState).board) {
      const printed = dataOf(state, c.cardId).life;
      const base = printed === undefined
        ? undefined
        : Math.max(0, printed - (Number(c.counters?.lifePenalty) || 0));
      if (base !== undefined && c.life !== undefined && c.life !== base) {
        c.life = base;
        logPublic(state, `${nameOf(state, c.cardId)} is restored to ${base} life`);
      }
    }
  }
  // end-of-turn draw (after the arsenal decision): only the active player draws up,
  // except on the first turn of the game, when both players draw up
  drawUpTo(state, runtime, player);
  if (state.turn === 1) {
    drawUpTo(state, runtime, state.players[opponent(state.activePlayer)] as PlayerState);
  }
  // per-turn flags reset after draws so bonus intellect is respected; intimidated
  // cards already returned at the beginning of the end phase
  for (const p of state.players) {
    p.resources = 0;
    p.chi = 0;
    p.flags = {};
    if (Number(p.hero.counters?.cannotDrawActionTurn ?? 0) <= state.turn) {
      delete p.hero.counters?.cannotDrawActionTurn;
    }
    if (Number(p.hero.counters?.loseLifeOnActionUntilTurn ?? 0) <= state.turn) {
      delete p.hero.counters?.loseLifeOnActionUntilTurn;
      delete p.hero.counters?.loseLifeOnActionSource;
    }
    // source-side prevention shields (Oasis Respite's damagePrevented) expire
    for (const c of controlledPermanents(state, p.seat, {
      includeDisabledHero: true,
    })) {
      delete c.damagePrevented;
    }
    // card-scoped play-from-zone permissions (e.g. Katsu's searched card) and
    // their attached cost discounts expire too — unless they were granted
    // "until the start of your next turn" (playableFromExpiry); so do
    // per-instance "until end of turn" keyword/power grants (Azalea's
    // dominate, Bull's Eye Bracers) and "this combat chain" defense grants
    // (Shred — the chain closes with the turn at the latest)
    for (const zone of [p.hand, p.deck, p.arsenal, p.pitch, p.graveyard, p.banish, p.board, p.weapons, Object.values(p.equipment).filter((card): card is CardInstance => card !== undefined)]) {
      for (const c of zone) {
        const permissionSurvives =
          (c.playableFromExpiry !== undefined && state.turn < c.playableFromExpiry) ||
          (c.playableFromEndTurnExpiry !== undefined && state.turn < c.playableFromEndTurnExpiry) ||
          c.playableFromUntilStartOfSeatTurn !== undefined ||
          (c.playableFromUntilEndOfSeatTurn !== undefined &&
            (c.playableFromUntilEndOfSeatTurn !== state.activePlayer || Number(c.playableFromGrantedTurn ?? -1) >= state.turn));
        if (!permissionSurvives) {
          delete c.playableFrom;
          delete c.playableFromSourceCardId;
          delete c.playableBySeat;
          delete c.playCostReduction;
          delete c.playCostReductionSeat;
        }
        if (c.playableFromExpiry !== undefined && state.turn >= c.playableFromExpiry) delete c.playableFromExpiry;
        if (c.playableFromEndTurnExpiry !== undefined && state.turn >= c.playableFromEndTurnExpiry) delete c.playableFromEndTurnExpiry;
        if (c.playableFromUntilEndOfSeatTurn === state.activePlayer && Number(c.playableFromGrantedTurn ?? -1) < state.turn) {
          delete c.playableFromUntilEndOfSeatTurn;
          delete c.playableFromGrantedTurn;
        }
        delete c.playableFromUntilChainClose;
        delete c.grantedKeywords;
        delete c.grantedNames;
        delete c.suppressedKeywords;
        delete c.tempPower;
        delete c.tempDefense;
        if (c.temporaryAlly) {
          delete c.temporaryAlly;
          delete c.life;
        }
        delete c.temporaryGraveyardReplacement;
        delete c.playableAsInstant;
      }
    }
  }
  // until-end-of-turn and next-attack/next-play modifiers expire; consumed one-shot modifiers too
  state.modifiers = state.modifiers.filter((m) => {
    if (m.consumed) return false;
    if (m.expiresAtStartOfTurn !== undefined && m.expiresAtStartOfTurn > state.turn) return true;
    if (m.expiresAtEndOfTurn !== undefined && m.expiresAtEndOfTurn > state.turn) return true;
    if (m.expiresAtStartOfSeatTurn !== undefined) return true;
    if (m.expiresAtEndOfSeatTurn !== undefined &&
      (m.expiresAtEndOfSeatTurn !== state.activePlayer || Number(m.createdTurn ?? -1) >= state.turn)) return true;
    return m.scope !== "until-end-of-turn" && m.scope !== "next-attack" && m.scope !== "next-play";
  });
  state.pendingDecision = null;
  state.activePlayer = (state.extraTurnSeats ??= []).shift() ?? opponent(state.activePlayer);
  state.turn++;
  startTurn(state, runtime);
}
