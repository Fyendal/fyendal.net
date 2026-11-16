import { describe, expect, it } from "vitest";
import type { GameState } from "@fyendal/engine";
import { rememberedTargetIntent, decodeStoredRememberedTargets } from "../rememberedTargets.js";

describe("remembered trigger targets", () => {
  it("decodes only the exact persisted shape", () => {
    const stored = { turn: 3, targets: [{ source: 7, target: 2 }] };
    expect(decodeStoredRememberedTargets(stored)).toEqual(stored);
    expect(decodeStoredRememberedTargets({ turn: 3, targets: [{ source: -1, target: 2 }] })).toBeNull();
    expect(decodeStoredRememberedTargets({ turn: 3, targets: [{ source: 7 }] })).toBeNull();
    expect(decodeStoredRememberedTargets({ turn: 3, targets: [], extra: true })).toBeNull();
    expect(decodeStoredRememberedTargets({ turn: "3", targets: [] })).toBeNull();
    expect(decodeStoredRememberedTargets([])).toBeNull();
  });

  it("answers nothing once its turn has ended", () => {
    const state = {
      phase: "layer",
      turn: 4,
      pendingDecision: { player: 0, kind: "choose-target", prompt: "", chooseHook: "trigger-target", sourceInstanceId: 7 },
    } as unknown as GameState;
    expect(rememberedTargetIntent(state, 0, { turn: 3, targets: [{ source: 7, target: 2 }] })).toBeNull();
  });
});
