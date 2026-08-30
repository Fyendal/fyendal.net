import { describe, expect, it } from "vitest";
import type { CardView } from "@fyendal/shared";
import {
  boardCardInEquipmentZone,
  boardCardsOutsideEquipmentZones,
  equipmentStackCards,
  groupBoardCards,
} from "./boardGroups.js";

const card = (instanceId: number, overrides: Partial<CardView> = {}): CardView => ({
  instanceId,
  cardId: "TOKEN",
  owner: 0,
  counters: { steam: 2, rust: 1 },
  ...overrides,
});

const distinctStatuses: Array<[string, Partial<CardView>]> = [
  ["tapped state", { tapped: true }],
  ["counter amount", { counters: { steam: 1, rust: 1 } }],
  ["used ability", { usedAbilityIndexes: [0] }],
  ["ally life", { life: 2 }],
];

describe("board card grouping", () => {
  it("groups identical cards regardless of counter insertion order", () => {
    const groups = groupBoardCards([
      card(1),
      card(2, { counters: { rust: 1, steam: 2 } }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, card: { instanceId: 1 } });
  });

  it("groups functionally equivalent token printings with different art", () => {
    const groups = groupBoardCards([
      card(1, { cardId: "ARC112", counters: {} }),
      card(2, { cardId: "ROS162", counters: {} }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, card: { instanceId: 1, cardId: "ARC112" } });
  });

  it.each(distinctStatuses)("keeps cards with different %s separate", (_label, status) => {
    expect(groupBoardCards([card(1), card(2, status)])).toHaveLength(2);
  });

  it("keeps currently activatable and inactive copies separate", () => {
    expect(groupBoardCards([card(1), card(2)], new Set([1]))).toHaveLength(2);
  });
});

describe("equipment-zone board cards", () => {
  it("finds the board aura assigned to a chosen equipment zone", () => {
    const frostbite = card(2, { counters: { "frostZone:arms": 1 } });

    expect(boardCardInEquipmentZone([card(1), frostbite], "arms")).toBe(frostbite);
    expect(boardCardInEquipmentZone([card(1), frostbite], "head")).toBeUndefined();
  });

  it("removes slot-assigned auras from the generic board strip", () => {
    const boardToken = card(1);
    const frostbite = card(2, { counters: { "frostZone:legs": 1 } });

    expect(boardCardsOutsideEquipmentZones([boardToken, frostbite])).toEqual([boardToken]);
  });

  it("ignores inactive equipment-zone markers", () => {
    const token = card(1, { counters: { "frostZone:head": 0 } });

    expect(boardCardInEquipmentZone([token], "head")).toBeUndefined();
    expect(boardCardsOutsideEquipmentZones([token])).toEqual([token]);
  });
});

describe("equipmentStackCards", () => {
  it("flattens nested public subcards behind the equipped top card", () => {
    const base = card(1);
    const firstEvo = card(2, { subcards: [base] });
    const material = card(3);
    const topEvo = card(4, { subcards: [firstEvo, material] });

    expect(equipmentStackCards(topEvo).map((entry) => entry.instanceId)).toEqual([1, 2, 3, 4]);
  });
});
