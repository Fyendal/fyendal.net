import { describe, expect, it } from "vitest";
import { boardSeats, seatInteractive } from "./boardSeats.js";

describe("boardSeats", () => {
  it("orients by the acting seat outside solo", () => {
    expect(boardSeats({ soloGame: false, boardSeat: null, yourSeat: 1 }))
      .toEqual({ boardSeat: 1, actingSeat: 1 });
    expect(boardSeats({ soloGame: false, boardSeat: null, yourSeat: 0 }))
      .toEqual({ boardSeat: 0, actingSeat: 0 });
  });

  it("keeps spectators on seat 0's side", () => {
    expect(boardSeats({ soloGame: false, boardSeat: null, yourSeat: null }))
      .toEqual({ boardSeat: 0, actingSeat: 0 });
  });

  it("keeps a solo board on the owner's seat while control passes", () => {
    expect(boardSeats({ soloGame: true, boardSeat: 0, yourSeat: 1 }))
      .toEqual({ boardSeat: 0, actingSeat: 1 });
    expect(boardSeats({ soloGame: true, boardSeat: 0, yourSeat: 0 }))
      .toEqual({ boardSeat: 0, actingSeat: 0 });
    expect(boardSeats({ soloGame: true, boardSeat: 1, yourSeat: 0 }))
      .toEqual({ boardSeat: 1, actingSeat: 0 });
  });

  it("ignores a stale board seat once the room is no longer solo", () => {
    expect(boardSeats({ soloGame: false, boardSeat: 0, yourSeat: 1 }).boardSeat).toBe(1);
  });
});

describe("seatInteractive", () => {
  it("accepts input only on the acting seat", () => {
    expect(seatInteractive(1, 1, false)).toBe(true);
    expect(seatInteractive(0, 1, false)).toBe(false);
    expect(seatInteractive(0, null, false)).toBe(false);
  });

  it("never accepts input while watching", () => {
    expect(seatInteractive(1, 1, true)).toBe(false);
  });
});
