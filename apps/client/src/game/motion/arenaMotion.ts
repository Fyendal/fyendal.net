import type { MotionRect } from "./motionGeometry.js";

export const ARENA_SHIFT_MS = 320;
export const ARENA_PEEL_MS = 460;
export const ARENA_MERGE_MS = 480;

/** One rendered arena stack: every presentation key it groups and the public
 * state that decides whether those cards may share it. */
export interface ArenaStackState {
  members: readonly string[];
  rect: MotionRect;
  tapped: boolean;
  /** Counter overlay values by kind, as drawn on the top card. */
  overlays: Readonly<Record<string, string>>;
}

/** A stack that stays rendered, sliding from where its cards were. */
export interface ArenaStackMotion {
  id: string;
  /** Offset from the new slot back to the cards' previous centre. */
  dx: number;
  dy: number;
  /** Lifted off a stack that split; the remainder keeps its place. */
  peel: boolean;
  /** The top card turns from this tapped state into its current one. */
  tappedFrom?: boolean;
  /** The ×N count changed in place. */
  countChanged: boolean;
  /** Counter overlay kinds that are new or changed on the top card. */
  changedOverlays: string[];
}

/** A stack that no longer renders because its cards joined another one. */
export interface ArenaMergeMotion {
  fromId: string;
  intoId: string;
  /** Travel from the old stack's centre to the joined stack's centre. */
  dx: number;
  dy: number;
  /** The joined stack's tapped state, which the travelling card turns into. */
  tappedTo: boolean;
}

export interface ArenaMotionPlan {
  stacks: ArenaStackMotion[];
  merges: ArenaMergeMotion[];
}

function centre(rect: MotionRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function mostShared(
  members: readonly string[],
  candidates: ReadonlyMap<string, ArenaStackState>,
): string | undefined {
  let best: string | undefined;
  let bestShared = 0;
  for (const [id, state] of candidates) {
    const shared = members.filter((member) => state.members.includes(member)).length;
    if (shared > bestShared) {
      best = id;
      bestShared = shared;
    }
  }
  return best;
}

/** Arena stacks are keyed by their first card, so a split or merge can give
 * a group a new element. Match stacks by the cards they hold instead: a new
 * stack peels off the surviving stack its cards came from, and a vanished
 * stack whose cards still exist slides into the stack that took them. */
export function planArenaMotion(
  previous: ReadonlyMap<string, ArenaStackState>,
  current: ReadonlyMap<string, ArenaStackState>,
): ArenaMotionPlan {
  const persisting = new Map([...previous].filter(([id]) => current.has(id)));
  const vanished = new Map([...previous].filter(([id]) => !current.has(id)));
  const originById = new Map<string, string>();
  const usersByOrigin = new Map<string, string[]>();
  for (const [id, state] of current) {
    const origin = previous.has(id)
      ? id
      : mostShared(state.members, persisting) ?? mostShared(state.members, vanished);
    if (origin === undefined) continue;
    originById.set(id, origin);
    usersByOrigin.set(origin, [...(usersByOrigin.get(origin) ?? []), id]);
  }

  const offset = (from: MotionRect, to: MotionRect) => {
    const a = centre(from);
    const b = centre(to);
    return { dx: a.x - b.x, dy: a.y - b.y };
  };
  const stacks: ArenaStackMotion[] = [];
  for (const [id, originId] of originById) {
    const state = current.get(id)!;
    const origin = previous.get(originId)!;
    const { dx, dy } = offset(origin.rect, state.rect);
    const siblings = usersByOrigin.get(originId)!;
    const distance = Math.hypot(dx, dy);
    const peel = siblings.length > 1 && siblings.some((sibling) => {
      if (sibling === id) return false;
      const other = offset(origin.rect, current.get(sibling)!.rect);
      const otherDistance = Math.hypot(other.dx, other.dy);
      // Ties go to the stack that kept the element, then board order.
      return otherDistance < distance || (otherDistance === distance && sibling === originId);
    });
    const changedOverlays = Object.entries(state.overlays)
      .filter(([kind, value]) => origin.overlays[kind] !== value)
      .map(([kind]) => kind);
    const motion: ArenaStackMotion = {
      id,
      dx,
      dy,
      peel,
      countChanged: originId === id && origin.members.length !== state.members.length,
      changedOverlays,
      ...(origin.tapped !== state.tapped ? { tappedFrom: origin.tapped } : {}),
    };
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && !motion.peel && motion.tappedFrom === undefined
      && !motion.countChanged && changedOverlays.length === 0) continue;
    stacks.push(motion);
  }

  const usedOrigins = new Set(originById.values());
  const merges: ArenaMergeMotion[] = [];
  for (const [fromId, state] of vanished) {
    if (usedOrigins.has(fromId)) continue;
    const intoId = mostShared(state.members, current);
    if (intoId === undefined) continue;
    const into = current.get(intoId)!;
    const { dx, dy } = offset(into.rect, state.rect);
    merges.push({ fromId, intoId, dx, dy, tappedTo: into.tapped });
  }
  return { stacks, merges };
}
