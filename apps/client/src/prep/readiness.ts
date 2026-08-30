export interface PrepReadiness {
  canReady: boolean;
  blockingReason: string | null;
  opponentStatus: "waiting" | "preparing" | "ready" | "disconnected";
}

export function derivePrepReadiness({
  accepting,
  mainCountValid,
  opponentPresent,
  opponentReady,
  opponentConnected,
  ready,
  startPlayer,
}: {
  accepting: boolean;
  mainCountValid: boolean;
  opponentPresent: boolean;
  opponentReady: boolean;
  opponentConnected: boolean;
  ready: boolean;
  startPlayer: 0 | 1 | null;
}): PrepReadiness {
  const opponentStatus = !opponentPresent
    ? "waiting"
    : !opponentConnected
      ? "disconnected"
      : opponentReady
        ? "ready"
        : "preparing";

  if (ready) return { canReady: false, blockingReason: null, opponentStatus };
  if (accepting) {
    return { canReady: false, blockingReason: "Accept the match before readying your deck.", opponentStatus };
  }
  if (!opponentPresent) {
    return { canReady: false, blockingReason: "Waiting for an opponent to join.", opponentStatus };
  }
  if (startPlayer === null) {
    return { canReady: false, blockingReason: "Choose who goes first before readying your deck.", opponentStatus };
  }
  if (!mainCountValid) {
    return { canReady: false, blockingReason: "Adjust the main deck to meet the format requirement.", opponentStatus };
  }
  return { canReady: true, blockingReason: null, opponentStatus };
}
