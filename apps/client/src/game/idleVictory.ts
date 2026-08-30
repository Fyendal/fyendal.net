import { IDLE_VICTORY_MS } from "@fyendal/shared";

export function shouldShowIdleVictoryClaim({
  botGame,
  replaying,
  gameOver,
  waitingOnOpponent,
  opponentLastAction,
  opponentIdleMs,
  dismissedFor,
}: {
  botGame: boolean;
  replaying: boolean;
  gameOver: boolean;
  waitingOnOpponent: boolean;
  opponentLastAction: number;
  opponentIdleMs: number;
  dismissedFor: number | null;
}): boolean {
  return !botGame &&
    !replaying &&
    !gameOver &&
    waitingOnOpponent &&
    opponentLastAction > 0 &&
    opponentIdleMs >= IDLE_VICTORY_MS &&
    dismissedFor !== opponentLastAction;
}
