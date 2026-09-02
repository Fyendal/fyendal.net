import type { EngineRuntime } from "./runtimePorts.js";
import { cardAbilitiesSuppressed, dataOf, scriptOf } from "./cardProperties.js";
import { controlledPermanents, hookSources, lingeringModifierSources } from "./sourceQueries.js";
import { queueDecisionBehindCrank } from "./decisionQueue.js";

import { logPublic, nameOf } from "./gameLog.js";
import type { GameStateInternal } from "./runtimeState.js";

import type { CardInstance, PendingDecisionState, PlayerState } from "./state.js";
import { currentLink, findCardAnywhere, findPermanent } from "./zoneQueries.js";
import type { CardData } from "@fyendal/shared";
import { transitionZone } from "./transitions.js";

/** Count a successfully paid action play or action-ability activation. */
export function noteActionPlayedOrActivated(player: PlayerState): void {
  player.flags.actionsPlayedOrActivatedThisTurn =
    Number(player.flags.actionsPlayedOrActivatedThisTurn ?? 0) + 1;
}

/** Consume an effect that gives the player's next action go again. Unlike
 * card-specific variants, this applies to both action cards and activated
 * action abilities (including weapon and ally attacks). */
export function consumeNextActionGoAgain(player: PlayerState): boolean {
  if (player.flags.nextActionGoAgain !== true) return false;
  player.flags.nextActionGoAgain = false;
  return true;
}

/** Clear metadata whose meaning is limited to a face-down private-zone
 * placement. Deck cards are inherently hidden without `faceDown`, and cards
 * in hand must expose their rules identity to their owner. */
export function clearPrivateZonePlacement(card: CardInstance): void {
  delete card.faceDown;
  delete card.arsenalSlot;
}

/** Move up to `n` cards from the top of the player's deck to their hand. */
export function drawCards(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  n: number,
  drawSource?: CardInstance,
): void {
  const withinActionPhase = ["action", "defend", "reaction", "layer"].includes(state.phase);
  if (drawSource && state.players.some((candidate) =>
    controlledPermanents(state, candidate.seat, { faceDownEquipment: false })
      .some((source) => {
        const script = scriptOf(state, source.cardId, source);
        return script?.prohibitsEffectDraws === true ||
          (withinActionPhase && script?.prohibitsEffectDrawsDuringActionPhase === true);
      })
  )) return;
  if (
    state.phase === "action" &&
    state.activePlayer === player.seat &&
    Number(player.hero.counters?.cannotDrawActionTurn ?? 0) === state.turn
  ) {
    return;
  }
  let count = Math.max(0, n);
  for (const source of hookSources(state, player.seat, {
    board: true,
    equipment: true,
    weapons: true,
    heroLast: true,
  })) {
    const replacement = scriptOf(state, source.cardId, source)?.replaceFriendlyDraw?.(
      runtime.makeCtx(state, player.seat, source),
      count,
    );
    if (replacement !== undefined) count = Math.max(0, Math.floor(replacement));
  }
  for (const opposing of state.players as PlayerState[]) {
    if (opposing.seat === player.seat) continue;
    const observed = new Set<number>();
    for (const source of hookSources(state, opposing.seat, { board: true, equipment: true, weapons: true, heroLast: true })) {
      observed.add(source.instanceId);
      const replacement = scriptOf(state, source.cardId, source)?.replaceOpponentDraw?.(
        runtime.makeCtx(state, opposing.seat, source),
        player.seat,
        count,
      );
      if (replacement !== undefined) count = Math.max(0, Math.floor(replacement));
    }
    for (const modifier of state.modifiers) {
      if (modifier.scope !== "until-end-of-turn" || modifier.seat !== opposing.seat || observed.has(modifier.sourceInstanceId)) continue;
      const source = findCardAnywhere(state, modifier.sourceInstanceId);
      if (!source || source.seat !== opposing.seat) continue;
      observed.add(source.card.instanceId);
      const replacement = scriptOf(state, source.card.cardId, source.card)?.replaceOpponentDraw?.(
        runtime.makeCtx(state, opposing.seat, source.card),
        player.seat,
        count,
      );
      if (replacement !== undefined) count = Math.max(0, Math.floor(replacement));
    }
  }
  const before = player.hand.length;
  for (let i = 0; i < count && player.deck.length > 0; i++) {
    const card = player.deck.shift() as CardInstance;
    clearPrivateZonePlacement(card);
    player.hand.push(card);
    runtime.transitions.move(
      card,
      transitionZone("deck", player.seat, "top"),
      transitionZone("hand", player.seat),
      { from: true, to: true },
    );
  }
  const drawn = player.hand.length - before;
  if (drawn <= 0) return;
  player.flags.cardsDrawnThisTurn =
    (Number(player.flags.cardsDrawnThisTurn) || 0) + drawn;
  for (const source of hookSources(state, player.seat, {
    board: true,
    equipment: true,
    weapons: true,
    heroLast: true,
  })) {
    scriptOf(state, source.cardId, source)?.onFriendlyDraws?.(
      runtime.makeCtx(state, player.seat, source, currentLink(state)),
      drawn,
      drawSource,
    );
  }
  for (const source of lingeringModifierSources(state, player.seat)) {
    if (hookSources(state, player.seat, { board: true, equipment: true, weapons: true, heroLast: true })
      .some((active) => active.instanceId === source.instanceId)) continue;
    scriptOf(state, source.cardId, source)?.onFriendlyDraws?.(
      runtime.makeCtx(state, player.seat, source, currentLink(state)), drawn, drawSource,
    );
  }
  for (const opposing of state.players as PlayerState[]) {
    if (opposing.seat === player.seat) continue;
    for (const source of hookSources(state, opposing.seat, { board: true, equipment: true, weapons: true, heroLast: true })) {
      scriptOf(state, source.cardId, source)?.onOpponentDraws?.(
        runtime.makeCtx(state, opposing.seat, source),
        player.seat,
        drawn,
      );
    }
  }
}

/** Number of currently usable arsenal zones for a player. Existing cards do
 * not disappear if a continuous extra-zone effect later turns off. */
export function arsenalCapacity(state: GameStateInternal, seat: number): number {
  const player = state.players[seat] as PlayerState;
  if (!player.arsenal.some((card) => !card.faceDown)) return 1;
  const grantsExtra = controlledPermanents(state, seat, { faceDownEquipment: false })
    .some((source) => scriptOf(state, source.cardId, source)?.additionalArsenalZoneWhileFaceUp === true);
  return grantsExtra ? 2 : 1;
}

/** "if you've controlled a card named X this turn" tracking (per-turn flags,
 * auto-wiped). Stamped when a permanent enters a player's board and re-stamped
 * for everything in play at the start of each turn, so a permanent that left
 * earlier this turn still counts. */
export function stampControlledName(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): void {
  const controlledName = nameOf(state, card.cardId).trim().toLowerCase().replace(/\s+/g, " ");
  player.flags[`controlledName:${controlledName}`] = true;
}

function hasCrank(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  card: CardInstance,
): boolean {
  if (!cardAbilitiesSuppressed(state, card) && (dataOf(state, card.cardId).keywords ?? []).some(
    (keyword) => keyword.trim().toLowerCase() === "crank",
  )) return true;
  return controlledPermanents(state, player.seat, { faceDownEquipment: false })
    .some((source) => scriptOf(state, source.cardId, source)?.grantsCrankToFriendly?.(
      runtime.makeCtx(state, player.seat, source),
      card,
    ) === true);
}

export function offerCrankDecision(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  card: CardInstance,
  allowCrank: boolean,
): boolean {
  if (
    !allowCrank ||
    !hasCrank(state, runtime, player, card) ||
    (card.counters?.steam ?? 0) <= 0
  ) return false;
  const decision = {
    player: player.seat,
    kind: "optional-effect",
    prompt: `${nameOf(state, card.cardId)}: Crank — remove a steam counter to gain 1 action point?`,
    promptMessage: {
      id: "engine.decision.crank",
      values: { card: { kind: "card", cardId: card.cardId } },
    },
    options: ["yes", "no"],
    optionMessages: [
      { id: "common.option.yes" },
      { id: "common.option.no" },
    ],
    defaultOption: "yes",
    sourceInstanceId: card.instanceId,
    chooseHook: "engine-crank",
  } satisfies PendingDecisionState;
  if (state.pendingDecision?.chooseHook) {
    return queueDecisionBehindCrank(state, decision);
  }
  state.pendingDecision = decision;
  return true;
}

// ── tap / untap (High Seas mechanics) ────────────────────────────────────────

/** Tap or untap a permanent as an effect. Fails (returns false) when the
 *  target isn't an in-arena permanent or is already in the requested state. */
export function tapPermanent(
  state: GameStateInternal,
  runtime: EngineRuntime,
  instanceId: number,
  tapped: boolean,
): boolean {
  const found = findPermanent(state, instanceId);
  if (!found || (found.card.tapped === true) === tapped) return false;
  if (!tapped && !canUntapPermanent(state, runtime, found.card)) return false;
  if (tapped) found.card.tapped = true;
  else delete found.card.tapped;
  logPublic(state, `${nameOf(state, found.card.cardId)} ${tapped ? "taps" : "untaps"}`);
  return true;
}

/** Whether an arena permanent may untap through an effect or APUD. */
export function canUntapPermanent(
  state: GameStateInternal,
  runtime: EngineRuntime,
  target: CardInstance,
): boolean {
  if (Number(target.counters?.cannotUntapUntilTurn ?? 0) >= state.turn) return false;
  for (const controller of state.players as PlayerState[]) {
    for (const source of controlledPermanents(state, controller.seat, { faceDownEquipment: false })) {
      if (source.instanceId === target.instanceId) continue;
      if (scriptOf(state, source.cardId, source)?.preventsUntapOf?.(
        runtime.makeCtx(state, controller.seat, source, currentLink(state)),
        target,
      ) === true) return false;
    }
  }
  return true;
}

/**
 * Played cards with these subtypes enter the arena as permanents when they
 * resolve (aura 8.2.4a, item 8.2.5a, ally 8.2.8) instead of going to the graveyard.
 */
export function entersArena(data: CardData): boolean {
  const subtypes = data.subtypes ?? [];
  return (
    subtypes.includes("item") ||
    subtypes.includes("ally") ||
    subtypes.includes("aura") ||
    subtypes.includes("invocation") ||
    subtypes.includes("figment")
  );
}

/** Whether a resolving card becomes an arena permanent, including
 * deck-playable equipment whose arena placement is declared by its script. */
export function settlesInArena(state: GameStateInternal, card: CardInstance): boolean {
  const data = dataOf(state, card.cardId);
  return entersArena(data) ||
    (data.cardType === "equipment" && scriptOf(state, card.cardId, card)?.playableEquipment === true);
}

export function settlePlayedCard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  card: CardInstance,
  opts?: { allowCrank?: boolean },
): void {
  const data = dataOf(state, card.cardId);
  if (data.cardType === "equipment" && scriptOf(state, card.cardId, card)?.playableEquipment === true) {
    const slot = (["head", "chest", "arms", "legs"] as const).find((candidate) =>
      (data.subtypes ?? []).includes(candidate),
    );
    if (!slot) {
      runtime.commands.moveToGraveyard(state, card, "stack");
      return;
    }
    const base = player.equipment[slot];
    if (base) {
      runtime.commands.fireLeaveArena(state, player.seat, base, "subcard");
      card.subcards = [base];
    }
    player.equipment[slot] = card;
    logPublic(state, `${nameOf(state, card.cardId)} is equipped to the ${slot} zone`);
    runtime.events.runHook(state, player.seat, card, "onEnterArena", currentLink(state));
    if (base) {
      runtime.commands.fireTransformHook(state, player.seat, base, "into", card);
      runtime.commands.fireTransformHook(state, player.seat, card, "from", base);
    }
    runtime.events.fireFriendlyEnterArena(state, player.seat, card);
    return;
  }
  if (entersArena(dataOf(state, card.cardId))) {
    stampEnteringLife(state, card);
    player.board.push(card);
    stampControlledName(state, player, card);
    logPublic(state, `${nameOf(state, card.cardId)} enters the arena`);
    runtime.events.runHook(state, player.seat, card, "onEnterArena", currentLink(state));
    if (!offerCrankDecision(state, runtime, player, card, opts?.allowCrank !== false)) {
      runtime.events.fireFriendlyEnterArena(state, player.seat, card);
    }
  } else {
    runtime.commands.moveToGraveyard(state, card, "stack");
  }
}

/** A permanent entering the arena with a life property (allies, CR 8.2.8)
 *  starts at its base life. */
export function stampEnteringLife(state: GameStateInternal, card: CardInstance): void {
  const life = dataOf(state, card.cardId).life;
  if (life !== undefined) card.life = life;
}
