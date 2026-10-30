import { legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { GameIntent, PassUntilMode, PendingDecision } from "@fyendal/shared";

/** A chain link by its place on the open chain and its attacking object. */
export interface PassUntilLink {
  index: number;
  instanceId: number;
}

/** A seat's armed pass shortcut. A chain-link latch armed with no open link
 *  binds to the next link to open. An opponent latch remembers the opposing
 *  plays already on the stack or chain, so only a new one ends it. */
export type SeatPassUntil =
  | { mode: "turn"; turn: number }
  | { mode: "chain-link"; turn: number; link?: PassUntilLink }
  | { mode: "opponent"; turn: number; seen: string[] };

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

/** Persisted JSON, decoded exhaustively; anything else is `null`. */
export function decodeStoredPassUntil(value: unknown): SeatPassUntil | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!nonNegativeInteger(candidate.turn)) return null;
  if (candidate.mode === "opponent") {
    return hasExactKeys(candidate, ["mode", "turn", "seen"], ["mode", "turn", "seen"])
      && Array.isArray(candidate.seen) && candidate.seen.length <= 256
      && candidate.seen.every((key) => typeof key === "string" && key.length <= 64)
      ? { mode: "opponent", turn: candidate.turn, seen: [...candidate.seen] as string[] }
      : null;
  }
  if (candidate.mode === "turn") {
    return hasExactKeys(candidate, ["mode", "turn"], ["mode", "turn"])
      ? { mode: "turn", turn: candidate.turn }
      : null;
  }
  if (candidate.mode !== "chain-link" || !hasExactKeys(candidate, ["mode", "turn", "link"], ["mode", "turn"])) {
    return null;
  }
  if (candidate.link === undefined) return { mode: "chain-link", turn: candidate.turn };
  if (typeof candidate.link !== "object" || candidate.link === null || Array.isArray(candidate.link)) return null;
  const link = candidate.link as Record<string, unknown>;
  return hasExactKeys(link, ["index", "instanceId"], ["index", "instanceId"])
    && nonNegativeInteger(link.index) && nonNegativeInteger(link.instanceId)
    ? { mode: "chain-link", turn: candidate.turn, link: { index: link.index, instanceId: link.instanceId } }
    : null;
}

export function armPassUntil(state: GameState, seat: number, mode: PassUntilMode): SeatPassUntil {
  const armed: SeatPassUntil = mode === "opponent"
    ? { mode, turn: state.turn, seen: opponentPlays(state, seat) }
    : { mode, turn: state.turn };
  return refreshPassUntil(state, seat, armed) ?? armed;
}

/** The opposing seat's played cards and activated abilities on the stack, and
 *  its unresolved chain links, by identity. Triggers are not plays. */
function opponentPlays(state: GameState, seat: number): string[] {
  const plays = state.stack
    .filter((layer) => layer.seat !== seat && (layer.card || layer.ability))
    .map((layer) => [
      "layer", layer.sourceInstanceId, layer.card?.instanceId ?? "ability", layer.abilityIndex ?? 0,
    ].join(":"));
  state.chain.forEach((link, index) => {
    if (link.attacker !== seat && !link.resolved) plays.push(`link:${index}:${link.attackingCard.instanceId}`);
  });
  return plays;
}

function openLink(state: GameState): PassUntilLink | null {
  const index = state.chain.length - 1;
  const link = state.chain[index];
  return link && !link.resolved ? { index, instanceId: link.attackingCard.instanceId } : null;
}

/** The latch after observing `state`, or `null` once it has expired: the turn
 *  ended, the chain link it covers is no longer the open one, or the opponent
 *  made a new play. An opponent latch also ends when the seat's own turn
 *  begins, so a quiet opponent never passes that turn away. */
export function refreshPassUntil(state: GameState, seat: number, armed: SeatPassUntil): SeatPassUntil | null {
  if (state.phase === "game-over") return null;
  if (armed.mode === "opponent") {
    if (state.turn !== armed.turn && state.activePlayer === seat) return null;
    const plays = opponentPlays(state, seat);
    return plays.every((play) => armed.seen.includes(play)) ? { ...armed, seen: plays } : null;
  }
  if (state.turn !== armed.turn) return null;
  if (armed.mode === "turn") return armed;
  const link = openLink(state);
  if (!armed.link) return link ? { ...armed, link } : armed;
  return link && link.index === armed.link.index && link.instanceId === armed.link.instanceId ? armed : null;
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
 *  latch before its link opens, and a lethal attack pause it without
 *  disarming. An opponent latch never blocks: its attack ends the latch. */
export function passUntilIntent(state: GameState, seat: number, armed: SeatPassUntil): GameIntent | null {
  if (armed.mode === "chain-link" && !armed.link) return null;
  const decision = state.pendingDecision;
  if (decision && decision.player !== seat) return null;
  const legal = legalIntents(state, seat);
  if (decision?.kind === "defend") {
    if (armed.mode === "opponent" || threatensLethal(state, seat)) return null;
    return legal.find((intent) =>
      intent.kind === "defend" && intent.instanceIds.length === 0 && (intent.pitchInstanceIds?.length ?? 0) === 0
    ) ?? null;
  }
  const passWindow = decision
    ? PASS_WINDOW_KINDS.has(decision.kind)
    : state.phase === "action" && state.priorityPlayer === seat;
  return passWindow ? legal.find((intent) => intent.kind === "pass") ?? null : null;
}
