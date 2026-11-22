import {
  MANUAL_LIFE_MAX,
  MANUAL_LIFE_MIN,
  MANUAL_RESOURCES_MAX,
  MANUAL_RESOURCES_MIN,
  hasType,
  type ManualEdit,
  type ManualMoveDestination,
} from "@fyendal/shared";
import { clearPrivateZonePlacement, clearTemporaryObjectEffects } from "./cardLifecycle.js";
import { dataOf } from "./cardProperties.js";
import { gameLogMessage, logCardValue, logPlayerValue, logPrivate, logPublic, nameOf } from "./gameLog.js";
import { shuffleInPlace } from "./rng.js";
import { cloneState, type GameStateInternal } from "./runtimeState.js";
import type { CardInstance, PlayerState } from "./state.js";
import {
  createTransitionCollector,
  transitionZone,
  transitionZoneIsPrivate,
  type EngineTransitionMove,
} from "./transitions.js";

export type ManualEditResult =
  | { ok: true; state: GameStateInternal; events: EngineTransitionMove[] }
  | { ok: false; error: string };

function inRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Pending decisions that already priced a payment against the floating pool. */
function paymentPending(state: GameStateInternal): boolean {
  const pd = state.pendingDecision;
  return !!pd && !!(pd.payment || pd.xPayment || pd.variablePlayCost || pd.activationCost
    || pd.variableActivationCost || pd.arcane);
}

const DECK_EDIT_DECISIONS = new Set(["priority-window", "attack-reaction", "defense-reaction", "defend"]);
// Any other key may carry a continuation, payment, or deck reference.
const DECK_EDIT_DECISION_KEYS = new Set(["player", "kind", "prompt", "promptMessage", "warningMessage", "staged"]);

function deckEditRefusal(state: GameStateInternal): string | null {
  const pd = state.pendingDecision;
  if (!pd) return null;
  if (!DECK_EDIT_DECISIONS.has(pd.kind)) return "the deck cannot change during this decision";
  for (const [key, value] of Object.entries(pd)) {
    if (value !== undefined && !DECK_EDIT_DECISION_KEYS.has(key)) return "the deck cannot change during this decision";
  }
  return null;
}

function permutationRefusal(deck: readonly { instanceId: number }[], ids: readonly number[]): string | null {
  if (ids.length !== deck.length) return "the new order must list every card in the deck";
  const current = new Set(deck.map((card) => card.instanceId));
  const seen = new Set<number>();
  for (const id of ids) {
    if (!current.has(id)) return "the new order names a card that is not in the deck";
    if (seen.has(id)) return "the new order lists a card twice";
    seen.add(id);
  }
  return null;
}

type ManualMoveSource = "hand" | "deck" | "graveyard" | "banish";
const MOVE_SOURCES: readonly ManualMoveSource[] = ["hand", "deck", "graveyard", "banish"];

function findMovableCard(player: PlayerState, instanceId: number): { zone: ManualMoveSource; index: number } | null {
  for (const zone of MOVE_SOURCES) {
    const index = player[zone].findIndex((card) => card.instanceId === instanceId);
    if (index >= 0) return { zone, index };
  }
  return null;
}

function destinationZone(to: ManualMoveDestination): ManualMoveSource {
  return to === "deck-top" || to === "deck-bottom" ? "deck" : to;
}

function moveCardRefusal(
  state: GameStateInternal,
  seat: number,
  instanceId: number,
  to: ManualMoveDestination,
): string | null {
  const player = state.players[seat]!;
  const found = findMovableCard(player, instanceId);
  if (!found) return "that card is not in your hand, deck, graveyard, or banished zone";
  const card = player[found.zone][found.index]!;
  if (card.owner !== seat) return "you can only move cards you own";
  if (found.zone === "banish" && card.faceDown) return "face-down banished cards cannot be moved";
  if (hasType(dataOf(state, card.cardId), "token")) return "tokens cannot be moved";
  if (found.zone === destinationZone(to) && found.zone !== "deck") return "the card is already there";
  // Layers may target or remember cards in these zones.
  if (state.stack.length > 0 || state.resolving.length > 0
    || (state.pendingTriggeredLayers?.length ?? 0) > 0 || state.stackResume) {
    return "cards cannot move while the stack is in use";
  }
  return deckEditRefusal(state);
}

/** A moved card is a new object (CR 3.0.9); its pitch history, flipped face, and script bookkeeping persist. */
function resetMovedCard(card: CardInstance): void {
  clearPrivateZonePlacement(card);
  clearTemporaryObjectEffects(card);
  delete card.lastKnownCounters;
  delete card.intimidated;
  delete card.returnToHandAtTurn;
  delete card.chosenName;
  delete card.grantedTypes;
  delete card.grantedColor;
  delete card.meldSide;
  delete card.attackTargetIds;
  delete card.playTargetInstanceId;
  delete card.boundToInstanceId;
  delete card.damagePrevented;
}

function logCardMove(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
  from: ManualMoveSource,
  to: ManualMoveDestination,
): void {
  const hero = nameOf(state, state.players[seat]!.heroCardId);
  const fromText = from === "banish" ? "the banished zone" : `their ${from}`;
  const toText = to === "deck-top"
    ? "the top of their deck"
    : to === "deck-bottom"
      ? "the bottom of their deck"
      : to === "banish" ? "the banished zone" : `their ${to}`;
  // ICU select keys cannot contain hyphens.
  const toValue = to === "deck-top" ? "deckTop" : to === "deck-bottom" ? "deckBottom" : to;
  const named = gameLogMessage(
    `${hero} moves ${nameOf(state, card.cardId)} from ${fromText} to ${toText}`,
    "engine.log.manual.card.moved",
    { player: logPlayerValue(seat), card: logCardValue(card.cardId), from, to: toValue },
  );
  if (!transitionZoneIsPrivate(from) || !transitionZoneIsPrivate(destinationZone(to))) {
    logPublic(state, named);
    return;
  }
  logPrivate(state, seat, named, gameLogMessage(
    `${hero} moves a card from ${fromText} to ${toText}`,
    "engine.log.manual.card.moved.hidden",
    { player: logPlayerValue(seat), from, to: toValue },
  ));
}

/** Why `edit` cannot apply to `seat` now, or null when it can. */
export function manualEditRefusal(
  state: GameStateInternal,
  seat: number,
  edit: ManualEdit,
): string | null {
  if (state.phase === "game-over") return "game is over";
  if (!state.players[seat]) return "no such seat";
  switch (edit.kind) {
    case "set-life":
      return inRange(edit.life, MANUAL_LIFE_MIN, MANUAL_LIFE_MAX) ? null : "life is out of range";
    case "set-resources":
      if (!inRange(edit.resources, MANUAL_RESOURCES_MIN, MANUAL_RESOURCES_MAX)) return "resources are out of range";
      return paymentPending(state) ? "resources cannot change while a payment is pending" : null;
    case "reorder-deck":
      return deckEditRefusal(state) ?? permutationRefusal(state.players[seat]!.deck, edit.instanceIds);
    case "shuffle-deck":
      return deckEditRefusal(state);
    case "move-card":
      return moveCardRefusal(state, seat, edit.instanceId, edit.to);
    case "reveal-deck":
      return null;
    default:
      return "unknown edit";
  }
}

export function manualEditAllowed(state: GameStateInternal, seat: number, edit: ManualEdit): boolean {
  return manualEditRefusal(state, seat, edit) === null;
}

/** Silent sandbox edit: no triggers, flags, stats, scripts, or state-based checks. */
export function applyManualEdit(
  state: GameStateInternal,
  seat: number,
  edit: ManualEdit,
): ManualEditResult {
  const refusal = manualEditRefusal(state, seat, edit);
  if (refusal) return { ok: false, error: refusal };
  const next = cloneState(state);
  // No log line: the owner seeing their own deck reveals nothing to the opponent.
  if (edit.kind === "reveal-deck") return { ok: true, state: next, events: [] };
  const transition = createTransitionCollector();
  const player = next.players[seat]!;
  const hero = nameOf(next, player.heroCardId);
  switch (edit.kind) {
    case "set-life": {
      const from = player.life;
      player.life = edit.life;
      logPublic(next, gameLogMessage(
        `${hero}'s life is set from ${from} to ${edit.life}`,
        "engine.log.manual.life",
        { player: logPlayerValue(seat), from, to: edit.life },
      ));
      break;
    }
    case "set-resources": {
      const from = player.resources;
      player.resources = edit.resources;
      logPublic(next, gameLogMessage(
        `${hero}'s floating resources are set from ${from} to ${edit.resources}`,
        "engine.log.manual.resources",
        { player: logPlayerValue(seat), from, to: edit.resources },
      ));
      break;
    }
    case "reorder-deck": {
      const byId = new Map(player.deck.map((card) => [card.instanceId, card]));
      player.deck = edit.instanceIds.map((id) => byId.get(id)!);
      logPublic(next, gameLogMessage(
        `${hero}'s deck is reordered`,
        "engine.log.manual.deck.reordered",
        { player: logPlayerValue(seat) },
      ));
      break;
    }
    case "shuffle-deck": {
      shuffleInPlace(next, player.deck);
      // The fallback matches the line the client animates as a shuffle.
      logPublic(next, gameLogMessage(
        `${hero} shuffles their deck`,
        "engine.log.manual.deck.shuffled",
        { player: logPlayerValue(seat) },
        { kind: "shuffle", seat },
      ));
      break;
    }
    case "move-card": {
      const found = findMovableCard(player, edit.instanceId)!;
      const [card] = player[found.zone].splice(found.index, 1) as [CardInstance];
      resetMovedCard(card);
      const destination = destinationZone(edit.to);
      if (edit.to === "deck-top") player.deck.unshift(card);
      else player[destination].push(card);
      const pd = next.pendingDecision;
      if (pd?.kind === "defend" && pd.staged?.includes(card.instanceId)) {
        const staged = pd.staged.filter((id) => id !== card.instanceId);
        if (staged.length > 0) pd.staged = staged;
        else delete pd.staged;
      }
      const position = edit.to === "deck-top" ? "top" : edit.to === "deck-bottom" ? "bottom" : undefined;
      transition.recorder.move(
        card,
        transitionZone(found.zone, seat),
        transitionZone(destination, seat, position),
        { from: transitionZoneIsPrivate(found.zone), to: transitionZoneIsPrivate(destination) },
      );
      logCardMove(next, seat, card, found.zone, edit.to);
      break;
    }
  }
  return { ok: true, state: next, events: transition.events };
}
