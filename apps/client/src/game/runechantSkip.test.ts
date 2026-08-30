import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { canSkipRunechant } from "./runechantSkip.js";

describe("Runechant skip presentation", () => {
  it("uses the authoritative legal intent instead of matching decision text", () => {
    const legal: GameIntent[] = [{ kind: "skip-runechant" }, { kind: "pass" }];
    expect(canSkipRunechant(legal)).toBe(true);
    expect(canSkipRunechant([{ kind: "pass" }])).toBe(false);
  });
});
