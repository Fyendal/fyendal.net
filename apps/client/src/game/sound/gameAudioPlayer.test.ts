import { describe, expect, it } from "vitest";
import { gameSoundPlaybackDuration } from "./gameAudioPlayer.js";

describe("game audio playback duration", () => {
  it("caps the shuffle cue to the shuffle animation", () => {
    expect(gameSoundPlaybackDuration("shuffle", 3.06)).toBe(0.9);
    expect(gameSoundPlaybackDuration("shuffle", 0.5)).toBe(0.5);
    expect(gameSoundPlaybackDuration("slash", 3.06)).toBe(0.65);
    expect(gameSoundPlaybackDuration("slash", 0.4)).toBe(0.4);
  });

  it("leaves other cue durations unchanged", () => {
    expect(gameSoundPlaybackDuration("draw", 3.06)).toBe(3.06);
    expect(gameSoundPlaybackDuration("play", 3.06)).toBe(3.06);
    expect(gameSoundPlaybackDuration("priority", 3.06)).toBe(3.06);
    expect(gameSoundPlaybackDuration("zap", 3.06)).toBe(3.06);
  });
});
