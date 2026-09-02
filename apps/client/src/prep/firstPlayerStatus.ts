type Seat = 0 | 1;

export type FirstPlayerStatus =
  | "waiting-opponent"
  | "waiting-roll"
  | "opponent-deciding"
  | "you-decided-first"
  | "you-decided-second"
  | "opponent-decided-first"
  | "opponent-decided-second";

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
}): FirstPlayerStatus | null {
  if (!opponentPresent) return "waiting-opponent";
  if (dieWinner === null) return "waiting-roll";

  const youDecide = canChooseFirst({ botGame: botGame === true, dieWinner, yourSeat });
  if (startPlayer === null) {
    return youDecide ? null : "opponent-deciding";
  }

  const decider = youDecide ? "you" : "opponent";
  const yourTurnOrder = startPlayer === yourSeat ? "first" : "second";
  return `${decider}-decided-${yourTurnOrder}`;
}
