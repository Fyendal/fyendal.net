import { describe, expect, it } from "vitest";
import { replayResult } from "../replay/replayResult.js";

describe("saved replay results", () => {
  it("labels a manually ended bot game without inventing a winner", () => {
    expect(replayResult(null, 0)).toEqual({
      label: "Ended",
      className: "replay-ended",
    });
  });

  it("keeps completed results relative to the participant", () => {
    expect(replayResult(0, 0).label).toBe("Victory");
    expect(replayResult(1, 0).label).toBe("Defeat");
  });
});
