import type { PrepView } from "@fyendal/shared";

export type SoloSeatStatus = "turn-order" | "arena" | "arena-locked" | "sideboarding" | "ready";

/** What a seat of a self-play prep room still has to do. */
export function soloSeatStatus(prep: PrepView, seat: 0 | 1): SoloSeatStatus | null {
  const view = prep.seats[seat];
  if (!view) return null;
  if (view.ready) return "ready";
  if (prep.phase === "select-deck") return "sideboarding";
  if (view.arenaLocked) return "arena-locked";
  if (prep.phase === "select-arena") return "arena";
  if (prep.phase === "choose-first") return "turn-order";
  return null;
}

/**
 * The seat to show after a self-play prep update: once the viewed seat locks
 * its arena or readies its deck, the other seat if it still has that step.
 */
export function soloAutoAdvanceSeat(previous: PrepView | null, next: PrepView): 0 | 1 | null {
  if (next.soloGame !== true || previous?.soloGame !== true) return null;
  if (previous.yourSeat !== next.yourSeat) return null;
  const seat = next.yourSeat as 0 | 1;
  const other = (1 - seat) as 0 | 1;
  const before = previous.seats[seat];
  const now = next.seats[seat];
  const otherSeat = next.seats[other];
  if (!before || !now || !otherSeat) return null;
  if (!before.arenaLocked && now.arenaLocked && next.phase === "select-arena" && !otherSeat.arenaLocked) {
    return other;
  }
  if (!before.ready && now.ready && next.phase === "select-deck" && !otherSeat.ready) return other;
  return null;
}
