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
  "stack-entry",
  "payment",
  "movement",
  "resolution",
  "trigger",
  "result",
  "arsenal",
  "cleanup",
  "draw",
];

const PHASE_RANK = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));

const PHASE_STAGE: Readonly<Record<MotionTimelinePhase, number>> = {
  staging: 0,
  confirmation: 1,
  "stack-entry": 2,
  payment: 2,
  movement: 2,
  resolution: 3,
  trigger: 4,
  result: 5,
  arsenal: 6,
  cleanup: 7,
  draw: 8,
};

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

/** Schedule only phases that are present in the batch. Causally related play,
 * payment, and movement phases share a stage: play leads by one short stagger,
 * but their animations overlap. Later stages wait for every cue in the prior
 * stage, plus a short pause. Input ordering never changes semantic phase order. */
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
    cursor = stageEnd + (stageIndex < presentStages.length - 1 ? phaseGapMs : 0);
  }
  return delays;
}
