import type { GameMotionEvent } from "./motionTypes.js";

export type MotionTimelinePhase =
  | "staging"
  | "confirmation"
  | "payment"
  | "movement"
  | "stack-entry"
  | "resolution"
  | "effect-draw"
  | "effect-discard"
  | "trigger"
  | "result"
  | "arsenal"
  | "cleanup"
  | "draw"
  | "turn-start";

const PHASE_ORDER: readonly MotionTimelinePhase[] = [
  "staging",
  "confirmation",
  "payment",
  "movement",
  "stack-entry",
  "resolution",
  "effect-draw",
  "effect-discard",
  "trigger",
  "result",
  "arsenal",
  "cleanup",
  "draw",
  "turn-start",
];

const PHASE_RANK = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));

const PHASE_STAGE: Readonly<Record<MotionTimelinePhase, number>> = {
  staging: 0,
  confirmation: 1,
  payment: 2,
  movement: 2,
  "stack-entry": 3,
  resolution: 4,
  "effect-draw": 5,
  "effect-discard": 6,
  trigger: 7,
  result: 8,
  arsenal: 9,
  cleanup: 10,
  draw: 11,
  "turn-start": 12,
};

export const EFFECT_HAND_PAUSE_MS = 280;

export function motionTimelinePhase(event: GameMotionEvent): MotionTimelinePhase {
  if ("timeline" in event && event.timeline) return event.timeline;
  if (event.kind === "reflow") return event.phase;
  if (event.kind === "settle") return "confirmation";
  if (event.kind === "connect") return "trigger";
  if (event.kind === "appear") return "result";
  if (event.kind === "disappear") return "result";
  if (event.destination.kind === "chain-staged") return "staging";
  if (event.destination.kind === "pitch") return "payment";
  if (event.source.kind === "hand" && event.destination.kind === "arsenal") {
    return "arsenal";
  }
  if (event.source.kind === "pitch" && event.destination.kind === "deck") {
    return "cleanup";
  }
  if (event.source.kind === "deck" && event.destination.kind === "hand") return "draw";
  if (event.destination.kind === "stack-layer" || event.destination.kind === "chain-attack") return "stack-entry";
  if (event.source.kind === "stack-layer") return "resolution";
  return "movement";
}

export interface MotionTimelineCue {
  id: string;
  phase: MotionTimelinePhase;
  durationMs: number;
  staggerMs: number;
}

/** Schedule only phases that are present in the batch. Payment finishes before
 * stack entry. An effect draw stays in the temporary hand long enough to be
 * seen before the following discard begins. */
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

  const presentPhases = [...grouped.keys()].sort((left, right) => (
    (PHASE_RANK.get(left) ?? 0) - (PHASE_RANK.get(right) ?? 0)
  ));
  const groupedStages = new Map<number, MotionTimelinePhase[]>();
  for (const phase of presentPhases) {
    const stage = PHASE_STAGE[phase];
    const stagePhases = groupedStages.get(stage) ?? [];
    stagePhases.push(phase);
    groupedStages.set(stage, stagePhases);
  }

  let cursor = 0;
  const presentStages = [...groupedStages.keys()].sort((left, right) => left - right);
  for (const [stageIndex, stage] of presentStages.entries()) {
    const stagePhases = groupedStages.get(stage) ?? [];
    const stageCues = stagePhases.flatMap((phase) => grouped.get(phase) ?? []);
    const phaseLeadMs = Math.min(...stageCues.map((cue) => cue.staggerMs));
    let stageEnd = cursor;
    for (const [phaseIndex, phase] of stagePhases.entries()) {
      const phaseCues = grouped.get(phase) ?? [];
      const phaseStart = cursor + phaseIndex * phaseLeadMs;
      for (const [cueIndex, cue] of phaseCues.entries()) {
        const delay = phaseStart + cueIndex * cue.staggerMs;
        delays.set(cue.id, delay);
        stageEnd = Math.max(stageEnd, delay + cue.durationMs);
      }
    }
    const nextStage = presentStages[stageIndex + 1];
    const gap = stage === PHASE_STAGE["effect-draw"]
      && nextStage === PHASE_STAGE["effect-discard"]
      ? EFFECT_HAND_PAUSE_MS
      : phaseGapMs;
    cursor = stageEnd + (nextStage !== undefined ? gap : 0);
  }
  return delays;
}
