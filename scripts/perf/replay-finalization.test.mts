import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { describe, it } from "node:test";
import {
  createReplayFinalizationMonitor,
  type ReplayFinalizationSample,
} from "./replay-finalization.mjs";

describe("replay finalization performance monitor", () => {
  it("records readiness during a paced dispatch wave", async () => {
    let currentTime = 12;
    const monitor = createReplayFinalizationMonitor({
      requestTimeoutMs: 120_000,
      now: () => currentTime,
      readReadyRoomCodes: async (roomCodes) => new Set(roomCodes),
    });
    const early: ReplayFinalizationSample = {
      roomCode: "EARLY",
      dispatchedAt: 0,
      replayFinalizationLatencyMs: 0,
    };

    monitor.track(early);
    await setImmediate();
    assert.equal(early.replayFinalizationLatencyMs, 12);

    currentTime = 60_025;
    const late: ReplayFinalizationSample = {
      roomCode: "LATE",
      dispatchedAt: 60_000,
      replayFinalizationLatencyMs: 0,
    };
    monitor.track(late);
    await monitor.finish();

    assert.equal(early.replayFinalizationLatencyMs, 12);
    assert.equal(late.replayFinalizationLatencyMs, 25);
  });
});
