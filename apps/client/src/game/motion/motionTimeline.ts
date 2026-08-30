import type { GameMotionEvent, MotionLocation } from "./motionTypes.js";

export type MotionTimelinePhase =
  | "staging"
  | "confirmation"
  | "payment"
  | "movement"
  | "stack-entry"
  | "resolution"
  | "trigger"
  | "result"
  | "arsenal"
  | "cleanup"
  | "draw";

const PHASE_ORDER: readonly MotionTimelinePhase[] = [
  "staging",
  "confirmation",
  "payment",
  "movement",
  "stack-entry",
  "resolution",
  "trigger",
  "result",
  "arsenal",
  "cleanup",
  "draw",
];

const PHASE_RANK = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));

function isStackLocation(location: MotionLocation): boolean {
  return location.kind === "stack-layer" || location.kind === "stack-attack";
}

export function motionTimelinePhase(event: GameMotionEvent): MotionTimelinePhase {
  if (event.kind === "settle") return "confirmation";
  if (event.kind === "connect") return "trigger";
  if (event.kind === "appear") return "result";
  if (event.kind === "pulse") return "result";
  if (event.destination.kind === "chain-staged") return "staging";
  if (event.destination.kind === "pitch") return "payment";
  if (event.source.kind === "hand" && event.destination.kind === "arsenal") {
    return "arsenal";
  }
  if (event.source.kind === "pitch" && event.destination.kind === "deck") {
    return "cleanup";
  }
  if (event.source.kind === "deck" && event.destination.kind === "hand") return "draw";
  if (isStackLocation(event.destination)) return "stack-entry";
  if (isStackLocation(event.source)) return "resolution";
  return "movement";
}

export interface MotionTimelineCue {
  id: string;
  phase: MotionTimelinePhase;
  durationMs: number;
  staggerMs: number;
}

/** Schedule only phases that are present in the batch. Each later phase starts
 * after every cue in the previous phase has completed, plus a short causal
 * pause. Input ordering affects order within a phase but never phase order. */
export function scheduleMotionTimeline(
  cues: readonly MotionTimelineCue[],
  phaseGapMs: number,
): ReadonlyMap<string, number> {
  const delays = new Map<string, number>();
  const grouped = new Map<MotionTimelinePhase, MotionTimelineCue[]>();
  for (const cue of cues) {
    const phaseCues = grouped.get(cue.phase) ?? [];
    phaseCues.push(cue);
    grouped.set(cue.phase, phaseCues);
  }

  let cursor = 0;
  const presentPhases = [...grouped.keys()].sort((left, right) => (
    (PHASE_RANK.get(left) ?? 0) - (PHASE_RANK.get(right) ?? 0)
  ));
  for (const [phaseIndex, phase] of presentPhases.entries()) {
    const phaseCues = grouped.get(phase) ?? [];
    let phaseEnd = cursor;
    for (const [cueIndex, cue] of phaseCues.entries()) {
      const delay = cursor + cueIndex * cue.staggerMs;
      delays.set(cue.id, delay);
      phaseEnd = Math.max(phaseEnd, delay + cue.durationMs);
    }
    cursor = phaseEnd + (phaseIndex < presentPhases.length - 1 ? phaseGapMs : 0);
  }
  return delays;
}
