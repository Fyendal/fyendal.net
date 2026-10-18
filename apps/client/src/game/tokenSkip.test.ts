import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { skippableTokenRun } from "./tokenSkip.js";

describe("token skip presentation", () => {
  it("uses the authoritative legal intent instead of matching decision text", () => {
    const legal: GameIntent[] = [{ kind: "skip-runechant" }, { kind: "pass" }];
    expect(skippableTokenRun(legal)).toBe("runechant");
    expect(skippableTokenRun([{ kind: "skip-seismic-surge" }, { kind: "pass" }])).toBe("seismic-surge");
    expect(skippableTokenRun([{ kind: "pass" }])).toBeNull();
  });
});
