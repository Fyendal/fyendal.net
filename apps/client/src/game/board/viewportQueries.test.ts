import { afterEach, describe, expect, it, vi } from "vitest";
import { tapInspectsCards } from "./viewportQueries.js";

function stubDevice(active: readonly string[]) {
  vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: active.includes(query) }) });
}

const FINE_HOVER = "(hover: hover) and (pointer: fine)";
const PHONE_PORTRAIT = "(max-width: 700px) and (orientation: portrait)";

describe("tapInspectsCards", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lets a tablet layout inspect by tap because it cannot hover", () => {
    stubDevice([]);
    expect(tapInspectsCards()).toBe(true);
  });

  it("keeps a tap on a large mouse-driven window from opening the sheet", () => {
    stubDevice([FINE_HOVER]);
    expect(tapInspectsCards()).toBe(false);
  });

  it("keeps tap inspection on a narrow upright window", () => {
    stubDevice([FINE_HOVER, PHONE_PORTRAIT]);
    expect(tapInspectsCards()).toBe(true);
  });
});
