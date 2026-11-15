import {
  MANUAL_LIFE_MAX,
  MANUAL_LIFE_MIN,
  MANUAL_RESOURCES_MAX,
  MANUAL_RESOURCES_MIN,
  type ManualEdit,
} from "@fyendal/shared";
import { gameLogMessage, logPlayerValue, logPublic, nameOf } from "./gameLog.js";
import { shuffleInPlace } from "./rng.js";
import { cloneState, type GameStateInternal } from "./runtimeState.js";
import type { EngineTransitionMove } from "./transitions.js";

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
  }
  return { ok: true, state: next, events: [] };
}
