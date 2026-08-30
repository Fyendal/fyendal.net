import { describe, expect, it } from "vitest";
import { handScrollAvailability } from "./PlayerHand.js";

describe("hand scroll controls", () => {
  it("hides both controls while all cards fit", () => {
    expect(handScrollAvailability({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 }))
      .toEqual({ left: false, right: false });
  });

  it("shows only the direction containing hidden cards at either edge", () => {
    expect(handScrollAvailability({ scrollLeft: 0, clientWidth: 900, scrollWidth: 1500 }))
      .toEqual({ left: false, right: true });
    expect(handScrollAvailability({ scrollLeft: 600, clientWidth: 900, scrollWidth: 1500 }))
      .toEqual({ left: true, right: false });
  });

  it("shows both controls between the edges", () => {
    expect(handScrollAvailability({ scrollLeft: 240, clientWidth: 900, scrollWidth: 1500 }))
      .toEqual({ left: true, right: true });
  });
});
