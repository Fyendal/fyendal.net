import { legalIntents, type GameState } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";

/** A trigger source and the target its later declarations reuse. */
export interface RememberedTarget {
  source: number;
  target: number;
}

/** Target choices the server repeats for the seat until `turn` ends. */
export interface SeatRememberedTargets {
  turn: number;
  targets: RememberedTarget[];
}

const MAX_REMEMBERED_TARGETS = 32;

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const present = Object.keys(record);
  return present.length === keys.length && keys.every((key) => present.includes(key)) ? record : null;
}

/** Persisted JSON, decoded exhaustively; anything else is `null`. */
export function decodeStoredRememberedTargets(value: unknown): SeatRememberedTargets | null {
  const candidate = exactRecord(value, ["turn", "targets"]);
  if (!candidate || !nonNegativeInteger(candidate.turn) || !Array.isArray(candidate.targets)
    || candidate.targets.length > MAX_REMEMBERED_TARGETS) return null;
  const targets: RememberedTarget[] = [];
  for (const entry of candidate.targets) {
    const pair = exactRecord(entry, ["source", "target"]);
    if (!pair || !nonNegativeInteger(pair.source) || !nonNegativeInteger(pair.target)) return null;
    targets.push({ source: pair.source, target: pair.target });
  }
  return { turn: candidate.turn, targets };
}

/** The source of the seat's pending trigger-target declaration. */
function pendingTriggerTargetSource(state: GameState, seat: number): number | undefined {
  const decision = state.pendingDecision;
  return decision?.player === seat && decision.chooseHook === "trigger-target"
    ? decision.sourceInstanceId
    : undefined;
}

function legalChoice(state: GameState, seat: number, optionId: string): boolean {
  return legalIntents(state, seat).some((intent) => intent.kind === "choose" && intent.optionId === optionId);
}

/** Remember `optionId` for the pending declaration's source; null unless it
 *  is a legal card target of a trigger-target declaration. */
export function rememberTargetChoice(
  state: GameState,
  seat: number,
  armed: SeatRememberedTargets | undefined,
  optionId: string,
): SeatRememberedTargets | null {
  const source = pendingTriggerTargetSource(state, seat);
  const target = Number(optionId);
  if (source === undefined || !/^\d+$/.test(optionId) || !legalChoice(state, seat, optionId)) return null;
  const kept = (armed?.turn === state.turn ? armed.targets : []).filter((entry) => entry.source !== source);
  return { turn: state.turn, targets: [...kept, { source, target }].slice(-MAX_REMEMBERED_TARGETS) };
}

export function rememberedTargetsActive(state: GameState, armed: SeatRememberedTargets): boolean {
  return state.phase !== "game-over" && state.turn === armed.turn;
}

/** Repeat the remembered target while it is still legal; otherwise ask. */
export function rememberedTargetIntent(
  state: GameState,
  seat: number,
  armed: SeatRememberedTargets,
): Extract<GameIntent, { kind: "choose" }> | null {
  if (!rememberedTargetsActive(state, armed)) return null;
  const source = pendingTriggerTargetSource(state, seat);
  const remembered = armed.targets.find((entry) => entry.source === source);
  if (!remembered) return null;
  const optionId = String(remembered.target);
  return legalChoice(state, seat, optionId) ? { kind: "choose", optionId } : null;
}
