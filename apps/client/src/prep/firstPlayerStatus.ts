type Seat = 0 | 1;

export function canReadyForGame({
  accepting,
  startPlayer,
}: {
  accepting: boolean;
  startPlayer: Seat | null;
}): boolean {
  return !accepting && startPlayer !== null;
}

export function canChooseFirst({
  botGame,
  dieWinner,
  yourSeat,
}: {
  botGame: boolean;
  dieWinner: Seat | null;
  yourSeat: number;
}): boolean {
  return dieWinner !== null && (botGame || dieWinner === yourSeat);
}

export function firstPlayerStatus({
  opponentPresent,
  botGame,
  dieWinner,
  startPlayer,
  yourSeat,
}: {
  opponentPresent: boolean;
  botGame?: boolean;
  dieWinner: Seat | null;
  startPlayer: Seat | null;
  yourSeat: number;
}): string | null {
  if (!opponentPresent) return "Waiting for an opponent";
  if (dieWinner === null) return "Waiting for the first-player roll";

  const youDecide = canChooseFirst({ botGame: botGame === true, dieWinner, yourSeat });
  if (startPlayer === null) {
    return youDecide ? null : "Opponent is deciding";
  }

  const decider = youDecide ? "You" : "Opponent";
  const yourTurnOrder = startPlayer === yourSeat ? "first" : "second";
  return `${decider} decided: You go ${yourTurnOrder}`;
}
