import { describe, expect, it } from "vitest";
import {
  COLD_PRIORITY_ARRIVAL_MS,
  INITIAL_PRIORITY_ARRIVAL,
  trackPriorityArrival,
} from "./priorityArrival.js";

describe("priority arrival", () => {
  it("flashes when the board opens on our priority", () => {
    expect(trackPriorityArrival(INITIAL_PRIORITY_ARRIVAL, true, 10_000).cold).toBe(true);
  });

  it("stays quiet through a quick pass exchange", () => {
    let state = trackPriorityArrival(INITIAL_PRIORITY_ARRIVAL, true, 10_000);
    state = trackPriorityArrival(state, false, 10_400);
    state = trackPriorityArrival(state, true, 10_400 + COLD_PRIORITY_ARRIVAL_MS - 1);
    expect(state.cold).toBe(false);
    expect(state.lostAt).toBeNull();
  });

  it("flashes again once the opponent has held priority long enough", () => {
    let state = trackPriorityArrival(INITIAL_PRIORITY_ARRIVAL, true, 10_000);
    state = trackPriorityArrival(state, false, 10_400);
    state = trackPriorityArrival(state, true, 10_400 + COLD_PRIORITY_ARRIVAL_MS);
    expect(state.cold).toBe(true);
  });

  it("measures the wait from the moment priority left, not the latest tick", () => {
    let state = trackPriorityArrival(INITIAL_PRIORITY_ARRIVAL, true, 10_000);
    state = trackPriorityArrival(state, false, 10_400);
    state = trackPriorityArrival(state, false, 12_000);
    expect(state.lostAt).toBe(10_400);
    expect(trackPriorityArrival(state, true, 13_400).cold).toBe(true);
  });

  it("does not re-arm while we keep holding priority", () => {
    let state = trackPriorityArrival(INITIAL_PRIORITY_ARRIVAL, true, 10_000);
    state = trackPriorityArrival(state, true, 20_000);
    expect(state).toEqual({ lostAt: null, cold: true });
  });
});
