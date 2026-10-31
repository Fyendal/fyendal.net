import { actionCandidates, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent, PassUntilMode, PendingDecision } from "@fyendal/shared";
import { forfeitsActionPoint } from "./endTurnWarning.js";

/** A chain link by its place on the open chain and its attacking object. */
export interface PassUntilLink {
  index: number;
  instanceId: number;
}

/** A seat's armed pass shortcut. A chain-link latch armed with no open link
 *  binds to the next link to open. `seen` holds the opposing plays on the
 *  stack the seat has already had a window for; a new one pauses the latch. */
export type SeatPassUntil =
  | { mode: "turn"; turn: number; seen: string[] }
  | { mode: "chain-link"; turn: number; link?: PassUntilLink; seen: string[] };

const PASS_WINDOW_KINDS: ReadonlySet<PendingDecision["kind"]> = new Set([
  "priority-window",
  "attack-reaction",
  "defense-reaction",
]);

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[], required: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}

function decodeSeen(value: unknown): string[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.length <= 256
    && value.every((key) => typeof key === "string" && key.length <= 64)
    ? [...value] as string[]
    : null;
}

/** Persisted JSON, decoded exhaustively; anything else is `null`. Latches
 *  stored before `seen` existed decode with none, and a retired opponent
 *  latch as a turn latch. */
export function decodeStoredPassUntil(value: unknown): SeatPassUntil | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!nonNegativeInteger(candidate.turn)) return null;
  const seen = decodeSeen(candidate.seen);
  if (seen === null) return null;
  if (candidate.mode === "turn" || candidate.mode === "opponent") {
    return hasExactKeys(candidate, ["mode", "turn", "seen"], ["mode", "turn"])
      ? { mode: "turn", turn: candidate.turn, seen }
      : null;
  }
  if (candidate.mode !== "chain-link" || !hasExactKeys(candidate, ["mode", "turn", "link", "seen"], ["mode", "turn"])) {
    return null;
  }
  if (candidate.link === undefined) return { mode: "chain-link", turn: candidate.turn, seen };
  if (typeof candidate.link !== "object" || candidate.link === null || Array.isArray(candidate.link)) return null;
  const link = candidate.link as Record<string, unknown>;
  return hasExactKeys(link, ["index", "instanceId"], ["index", "instanceId"])
    && nonNegativeInteger(link.index) && nonNegativeInteger(link.instanceId)
    ? { mode: "chain-link", turn: candidate.turn, link: { index: link.index, instanceId: link.instanceId }, seen }
    : null;
}

export function armPassUntil(state: GameState, seat: number, mode: PassUntilMode): SeatPassUntil {
  const armed: SeatPassUntil = { mode, turn: state.turn, seen: opponentPlays(state, seat) };
  return refreshPassUntil(state, seat, armed) ?? armed;
}

/** The opposing seat's played cards and activated abilities on the stack, by
 *  identity. Triggers are not plays. */
function opponentPlays(state: GameState, seat: number): string[] {
  return state.stack
    .filter((layer) => layer.seat !== seat && (layer.card || layer.ability))
    .map((layer) => [
      layer.sourceInstanceId, layer.card?.instanceId ?? "ability", layer.abilityIndex ?? 0,
    ].join(":"));
}

/** The seat acted itself, so every opposing play now on the stack has had
 *  its window. */
export function acknowledgePassUntil(state: GameState, seat: number, armed: SeatPassUntil): SeatPassUntil {
  return { ...armed, seen: opponentPlays(state, seat) };
}

function openLink(state: GameState): PassUntilLink | null {
  const index = state.chain.length - 1;
  const link = state.chain[index];
  return link && !link.resolved ? { index, instanceId: link.attackingCard.instanceId } : null;
}

/** The latch after observing `state`, or `null` once it has expired: the turn
 *  ended or the chain link it covers is no longer the open one. Plays that
 *  left the stack drop out of `seen`. */
export function refreshPassUntil(state: GameState, seat: number, armed: SeatPassUntil): SeatPassUntil | null {
  if (state.phase === "game-over" || state.turn !== armed.turn) return null;
  const plays = opponentPlays(state, seat);
  const seen = armed.seen.filter((play) => plays.includes(play));
  if (armed.mode === "turn") return { ...armed, seen };
  const link = openLink(state);
  if (!armed.link) return link ? { ...armed, link, seen } : { ...armed, seen };
  return link && link.index === armed.link.index && link.instanceId === armed.link.instanceId
    ? { ...armed, seen }
    : null;
}

/** An attack the seat is defending whose power, net of established
 *  prevention, could reduce its hero to 0. */
function threatensLethal(state: GameState, seat: number): boolean {
  const view = projectStateFor(state, seat);
  const link = view.chain.at(-1);
  const life = view.players[seat]?.life;
  if (!link || link.resolved || life === undefined) return false;
  return link.attackValue - (link.damageToPrevent ?? 0) >= life;
}

/** What the latch answers for `seat` in `state`: pass its priority and
 *  reaction windows and declare no blocks. Any other choice, a chain-link
 *  latch before its link opens, a new opposing play, a lethal attack, and
 *  ending the seat's turn with a usable action point pause it without
 *  disarming. */
export function passUntilIntent(state: GameState, seat: number, armed: SeatPassUntil): GameIntent | null {
  if (armed.mode === "chain-link" && !armed.link) return null;
  const decision = state.pendingDecision;
  if (decision && decision.player !== seat) return null;
  if (opponentPlays(state, seat).some((play) => !armed.seen.includes(play))) return null;
  const legal = legalIntents(state, seat);
  if (decision?.kind === "defend") {
    if (threatensLethal(state, seat)) return null;
    return legal.find((intent) =>
      intent.kind === "defend" && intent.instanceIds.length === 0 && (intent.pitchInstanceIds?.length ?? 0) === 0
    ) ?? null;
  }
  const passWindow = decision
    ? PASS_WINDOW_KINDS.has(decision.kind)
    : state.phase === "action" && state.priorityPlayer === seat
      && !forfeitsActionPoint(projectStateFor(state, seat), seat, actionCandidates(state, seat));
  return passWindow ? legal.find((intent) => intent.kind === "pass") ?? null : null;
}
