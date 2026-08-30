import type { GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { deriveBoardLegalState } from "./boardModel.js";

describe("board legal projection", () => {
  it("indexes playable and activatable action candidates", () => {
    const candidates: GameIntent[] = [
      { kind: "play-card", instanceId: 1, pitchInstanceIds: [] },
      { kind: "play-from-arsenal", instanceId: 2, pitchInstanceIds: [] },
      { kind: "play-from-zone", instanceId: 3, zone: "banish", pitchInstanceIds: [] },
      { kind: "activate-ability", sourceInstanceId: 4, abilityIndex: 0, pitchInstanceIds: [] },
    ];

    const result = deriveBoardLegalState(candidates, []);

    expect([...result.playableHand]).toEqual([1]);
    expect([...result.playableArsenal]).toEqual([2]);
    expect([...result.playableZones]).toEqual([[3, "banish"]]);
    expect([...result.activatable]).toEqual([4]);
  });

  it("keeps pass, chain-close, and defender staging sourced from legal intents", () => {
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [8, 9] },
      { kind: "pass" },
      { kind: "close-chain" },
    ];

    const result = deriveBoardLegalState([], legal);

    expect([...result.stageableDefenders]).toEqual([8, 9]);
    expect(result.canPass).toBe(true);
    expect(result.canCloseChain).toBe(true);
  });
});
