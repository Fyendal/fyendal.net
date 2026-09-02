import type { IntlShape } from "react-intl";

const TIMING_MESSAGE_IDS: Readonly<Record<string, string>> = {
  "START PHASE": "game.timing.startPhase",
  "ACTION PHASE": "game.timing.actionPhase",
  "END PHASE": "game.timing.endPhase",
  "GAME OVER": "game.timing.gameOver",
  "LAYER STEP": "game.timing.layerStep",
  "ATTACK STEP": "game.timing.attackStep",
  "DEFEND STEP": "game.timing.defendStep",
  "REACTION STEP": "game.timing.reactionStep",
  "DAMAGE STEP": "game.timing.damageStep",
  "RESOLUTION STEP": "game.timing.resolutionStep",
  "ON-HIT TRIGGERS": "game.timing.onHitTriggers",
  ATTACK: "game.timing.attack",
  EFFECTS: "game.timing.effects",
  PRIORITY: "game.timing.priority",
  TRIGGERS: "game.timing.triggers",
  REACTIONS: "game.timing.reactions",
  "START-OF-TURN TRIGGERS": "game.timing.startOfTurnTriggers",
  "BEGINNING TRIGGERS": "game.timing.beginningTriggers",
  "YOUR PRIORITY": "game.timing.yourPriority",
  "OPPONENT'S PRIORITY": "game.timing.opponentPriority",
  "YOU CHOOSING BLOCKS": "game.timing.youChoosingBlocks",
  "OPPONENT CHOOSING BLOCKS": "game.timing.opponentChoosingBlocks",
  WAITING: "game.timing.waiting",
};

function localizeTimingSegment(intl: IntlShape, segment: string): string {
  const messageId = TIMING_MESSAGE_IDS[segment];
  if (messageId) return intl.formatMessage({ id: messageId });
  const waitingOn = /^WAITING ON (.+)$/.exec(segment);
  if (waitingOn) {
    return intl.formatMessage({ id: "game.timing.waitingOn" }, { player: waitingOn[1] });
  }
  const toAct = /^(.+) TO ACT$/.exec(segment);
  if (toAct) return intl.formatMessage({ id: "game.timing.toAct" }, { player: toAct[1] });
  const namedPriority = /^(.+)'S PRIORITY$/.exec(segment);
  if (namedPriority) {
    return intl.formatMessage({ id: "game.timing.namedPriority" }, { player: namedPriority[1] });
  }
  return segment;
}

/** Localize the stable phase/step vocabulary in an authoritative timing
 * label. Unknown segments are intentionally preserved for forward-compatible
 * engine contexts and card-authored text. */
export function localizeTimingLabel(intl: IntlShape, label: string): string {
  return label.split(" · ").map((segment) => localizeTimingSegment(intl, segment)).join(" · ");
}
