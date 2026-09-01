import { describe, expect, it } from "vitest";
import type { PlayerView } from "@fyendal/shared";
import { optimisticInteractionHiddenIds } from "./pendingInteraction.js";

const player: PlayerView = {
  seat: 0,
  heroCardId: "TST-HERO",
  heroInstanceId: 1,
  heroName: "Test Hero",
  life: 40,
  actionPoints: 1,
  resources: 0,
  hand: [
    { instanceId: 10, cardId: "TST010", owner: 0 },
    { instanceId: 11, cardId: "TST011", owner: 0 },
    { instanceId: 12, cardId: "TST012", owner: 0 },
  ],
  handCount: 3,
  deckCount: 1,
  arsenal: [{ instanceId: 20, cardId: "TST020", owner: 0 }],
  arsenalCount: 1,
  pitch: [],
  pitchCount: 0,
  graveyard: [{ instanceId: 30, cardId: "TST030", owner: 0 }],
  banish: [{ instanceId: 40, cardId: "TST040", owner: 0 }],
  soul: [],
  equipment: {},
  weapons: [],
  board: [],
};

describe("pending interaction presentation", () => {
  it("moves the source to the pending slot and hides all declared costs", () => {
    const result = optimisticInteractionHiddenIds({
      kind: "play-card",
      instanceId: 10,
      pitchInstanceIds: [11],
      alternativeCostCardInstanceIds: [12],
    }, player);

    expect([...result!]).toEqual([10, 11, 12]);
  });

  it("keeps a pre-stack play and its costs visible until the choice resolves", () => {
    expect(optimisticInteractionHiddenIds({
      kind: "play-card",
      instanceId: 10,
      pitchInstanceIds: [11],
      deferPlayPresentation: true,
    }, player)).toBeNull();
  });

  it("finds plays from public zones and a visible deck top", () => {
    expect(optimisticInteractionHiddenIds({
      kind: "play-from-zone",
      zone: "graveyard",
      instanceId: 30,
      pitchInstanceIds: [],
    }, player)).toEqual(new Set([30]));
    expect(optimisticInteractionHiddenIds({
      kind: "play-from-zone",
      zone: "deck",
      instanceId: 50,
      pitchInstanceIds: [],
    }, player, { instanceId: 50, cardId: "TST050", owner: 0 })).toEqual(new Set([50]));
  });

  it("does not fabricate a pending card that is absent from the current view", () => {
    expect(optimisticInteractionHiddenIds({
      kind: "play-from-arsenal",
      instanceId: 99,
      pitchInstanceIds: [],
    }, player)).toBeNull();
  });

  it("still hides declared payment when a played source belongs to another zone owner", () => {
    expect(optimisticInteractionHiddenIds({
      kind: "play-from-arsenal",
      instanceId: 99,
      pitchInstanceIds: [11],
      alternativeCostCardInstanceIds: [12],
    }, player)).toEqual(new Set([11, 12]));
  });

  it("hides activation payment without hiding the source permanent", () => {
    expect(optimisticInteractionHiddenIds({
      kind: "activate-ability",
      sourceInstanceId: 1,
      pitchInstanceIds: [11],
      alternativeCostCardInstanceIds: [12],
    }, player)).toEqual(new Set([11, 12]));
  });
});
