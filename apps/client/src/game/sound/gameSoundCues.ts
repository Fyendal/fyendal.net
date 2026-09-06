import type { GameView } from "@fyendal/shared";
import type { DeckCardEvent } from "../deckCardEvents.js";
import { gameHasPriority } from "../causalExplanations.js";
import {
  MOTION_CONNECT_MS,
  MOTION_DISAPPEAR_MS,
  MOTION_DRAW_STAGGER_MS,
  MOTION_STAGGER_MS,
  MOTION_TRAVEL_MS,
  MOTION_SEQUENCE_GAP_MS,
} from "../motion/motionGeometry.js";
import {
  motionTimelinePhase,
  scheduleMotionTimeline,
} from "../motion/motionTimeline.js";
import type { GameMotionEvent, MoveMotionEvent } from "../motion/motionTypes.js";

export type GameSoundKind =
  | "draw"
  | "play"
  | "shuffle"
  | "priority"
  | "slash"
  | "zap";

export interface GameSoundCue {
  kind: GameSoundKind;
  delayMs: number;
}

const MAX_REPEATED_DRAW_SOUNDS = 6;

/** Alert only when a live transition gives this player priority. Initial
 * snapshots and mandatory decisions must remain silent. */
export function prioritySoundCueForViews(
  previous: GameView,
  current: GameView,
  seat: number | null,
  attentionNeeded: boolean,
): GameSoundCue[] {
  if (seat === null || !attentionNeeded) return [];
  const previouslyMine = gameHasPriority(previous) && previous.priorityPlayer === seat;
  const currentlyMine = gameHasPriority(current) && current.priorityPlayer === seat;
  return currentlyMine && !previouslyMine
    ? [{ kind: "priority", delayMs: 0 }]
    : [];
}

/** Damage audio follows the same locale-independent log metadata as the life
 * animations. Physical effect damage and raw life loss intentionally remain
 * quiet; only attack hits slash and arcane packets zap. */
export function damageSoundCuesForViews(
  previous: GameView,
  current: GameView,
): GameSoundCue[] {
  if (!previous.logEntries || !current.logEntries) return [];
  const previousSequence = previous.logEntries.reduce((highest, entry) => (
    "sequence" in entry ? Math.max(highest, entry.sequence) : highest
  ), 0);
  const cues: GameSoundCue[] = [];
  for (const entry of current.logEntries) {
    if (!("sequence" in entry) || entry.sequence <= previousSequence) continue;
    const event = entry.event;
    if (event?.kind !== "damage") continue;
    if (event.damageType === "arcane") {
      cues.push({ kind: "zap", delayMs: cues.length * 90 });
    } else if (
      entry.message.id === "engine.log.damage.hit"
      || entry.message.id === "engine.log.damage.redirected"
    ) {
      cues.push({ kind: "slash", delayMs: cues.length * 90 });
    }
  }
  return cues;
}

function isDraw(event: GameMotionEvent): event is MoveMotionEvent {
  return event.kind === "move"
    && event.source.kind === "deck"
    && event.destination.kind === "hand";
}

function isPlayedCard(event: GameMotionEvent): event is MoveMotionEvent {
  if (
    event.kind !== "move"
    || (event.destination.kind !== "stack-layer" && event.destination.kind !== "stack-attack")
  ) return false;
  // A permanent source copied onto the stack represents its ability or attack,
  // not a card leaving a playable zone. Trigger connectors are excluded too.
  return event.source.kind === "hand"
    || event.source.kind === "arsenal"
    || event.source.kind === "banish"
    || event.source.kind === "graveyard"
    || event.source.kind === "deck"
    || event.source.kind === "pitch";
}

function eventDurationMs(event: GameMotionEvent): number {
  if (event.kind === "connect") return MOTION_CONNECT_MS;
  if (event.kind === "disappear") return MOTION_DISAPPEAR_MS;
  return MOTION_TRAVEL_MS;
}

/** Build audio from the same semantic phases as motion without depending on
 * DOM geometry. Sounds therefore retain causal order when motion is reduced
 * or an off-screen zone has no measurable anchor. */
export function gameSoundCuesForEvents(
  motionEvents: readonly GameMotionEvent[],
  deckEvents: readonly DeckCardEvent[],
): GameSoundCue[] {
  const timeline = motionEvents.flatMap((event, eventIndex) => {
    const repetitions = isDraw(event)
      ? Math.min(event.count, MAX_REPEATED_DRAW_SOUNDS)
      : 1;
    return Array.from({ length: repetitions }, (_, repetitionIndex) => ({
      id: `sound:${eventIndex}:${repetitionIndex}`,
      event,
      phase: motionTimelinePhase(event),
      durationMs: eventDurationMs(event),
      staggerMs: motionTimelinePhase(event) === "draw"
        ? MOTION_DRAW_STAGGER_MS
        : MOTION_STAGGER_MS,
    }));
  });
  const delays = scheduleMotionTimeline(timeline, MOTION_SEQUENCE_GAP_MS);
  const cues: GameSoundCue[] = [];
  for (const item of timeline) {
    if (isDraw(item.event)) {
      cues.push({ kind: "draw", delayMs: delays.get(item.id) ?? 0 });
    } else if (isPlayedCard(item.event)) {
      cues.push({ kind: "play", delayMs: delays.get(item.id) ?? 0 });
    }
  }
  for (const event of deckEvents) {
    if (event.kind === "shuffle") cues.push({ kind: "shuffle", delayMs: 0 });
  }
  return cues;
}
