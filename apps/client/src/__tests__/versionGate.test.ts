import { describe, expect, it } from "vitest";
import { RoomVersionGate } from "../versionGate.js";

describe("RoomVersionGate", () => {
  it("drops stale and duplicate messages but accepts distinct same-version projections", () => {
    const gate = new RoomVersionGate();
    expect(gate.accept("game-started", 4)).toBe(true);
    expect(gate.accept("state", 4)).toBe(true);
    expect(gate.accept("state", 4)).toBe(false);
    expect(gate.accept("state", 3)).toBe(false);
    expect(gate.accept("state", 5)).toBe(true);
    expect(gate.accept("spectators", 4)).toBe(false);
  });

  it("lets one repeated projection through when asked", () => {
    const gate = new RoomVersionGate();
    expect(gate.accept("prep-state", 2)).toBe(true);
    gate.allowRepeat("prep-state");
    expect(gate.accept("prep-state", 2)).toBe(true);
    expect(gate.accept("prep-state", 2)).toBe(false);
    expect(gate.accept("prep-state", 1)).toBe(false);
  });

  it("can reset when a socket enters a different room", () => {
    const gate = new RoomVersionGate();
    expect(gate.accept("state", 10)).toBe(true);
    gate.reset();
    expect(gate.accept("state", 1)).toBe(true);
  });
});
