import type { DeckCardEvent } from "../deckCardEvents.js";
import {
  MOTION_CONNECT_MS,
  MOTION_DRAW_STAGGER_MS,
  MOTION_PULSE_MS,
  MOTION_STAGGER_MS,
  MOTION_TRAVEL_MS,
  MOTION_SEQUENCE_GAP_MS,
} from "../motion/motionGeometry.js";
import {
  motionTimelinePhase,
  scheduleMotionTimeline,
} from "../motion/motionTimeline.js";
import type { GameMotionEvent, MoveMotionEvent } from "../motion/motionTypes.js";

export type GameSoundKind = "draw" | "play" | "shuffle";

export interface GameSoundCue {
  kind: GameSoundKind;
  delayMs: number;
}

const MAX_REPEATED_DRAW_SOUNDS = 6;

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
  if (event.kind === "pulse") return MOTION_PULSE_MS;
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
