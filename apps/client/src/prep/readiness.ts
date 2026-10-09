export interface PrepReadiness {
  canReady: boolean;
  blockingReason: string | null;
}

export function derivePrepReadiness({
  accepting,
  mainCountValid,
  opponentPresent,
  ready,
  startPlayer,
}: {
  accepting: boolean;
  mainCountValid: boolean;
  opponentPresent: boolean;
  ready: boolean;
  startPlayer: 0 | 1 | null;
}): PrepReadiness {
  if (ready) return { canReady: false, blockingReason: null };
  if (accepting) {
    return { canReady: false, blockingReason: "Accept the match before readying your deck." };
  }
  if (!opponentPresent) {
    return { canReady: false, blockingReason: "Waiting for an opponent to join." };
  }
  if (startPlayer === null) {
    return { canReady: false, blockingReason: "Choose who goes first before readying your deck." };
  }
  if (!mainCountValid) {
    return { canReady: false, blockingReason: "Adjust the main deck to meet the format requirement." };
  }
  return { canReady: true, blockingReason: null };
}
