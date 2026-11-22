/** Board orientation versus the seat whose legal moves the client holds.
 * Outside solo both are `yourSeat`; a solo board stays on the owner's seat
 * while control follows whichever seat must act. Spectators sit at seat 0. */
export function boardSeats({
  soloGame,
  boardSeat,
  yourSeat,
}: {
  soloGame: boolean;
  boardSeat: 0 | 1 | null;
  yourSeat: number | null;
}): { boardSeat: 0 | 1; actingSeat: 0 | 1 } {
  const orientation = soloGame && boardSeat !== null ? boardSeat : yourSeat;
  return { boardSeat: orientation === 1 ? 1 : 0, actingSeat: yourSeat === 1 ? 1 : 0 };
}

/** Whether a seat's half and hand accept input: only the acting seat's, and never while watching. */
export function seatInteractive(
  seat: number,
  actingSeat: number | null,
  watching: boolean,
): boolean {
  return !watching && actingSeat !== null && seat === actingSeat;
}
