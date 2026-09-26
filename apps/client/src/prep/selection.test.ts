import type { DeckPool } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  adjustMainCount,
  defaultSelection,
  defaultWeapons,
  poolCounts,
  presentedDeckFromSelection,
  restoreMainDeck,
} from "./selection.js";

const pool: DeckPool = {
  heroId: "HERO",
  weaponIds: [],
  equipmentPool: [],
  deck: ["MAIN", "MAIN", "SHARED"],
  sideboard: ["SIDE", "SHARED"],
};

describe("prep deck selection", () => {
  it("preserves committed arena cards when a preset has different weapons and equipment", () => {
    const draft = defaultSelection({ ...pool, weaponIds: ["WTR003"] }, "preset");
    const arena = { weaponIds: ["GEM003", "GEM003"], equipment: { head: "LOCKED" } };
    expect(presentedDeckFromSelection(draft, arena)).toEqual({ ...arena, deck: pool.deck });
    expect(draft.weaponIndexes).toEqual([0]);
    expect(draft.equipment).toEqual({});
  });

  it("restores the owner's main deck without changing the preset's arena draft", () => {
    const draft = defaultSelection(pool, "deck-1");
    const restored = restoreMainDeck(draft, ["SIDE", "SHARED", "SHARED"]);
    expect(restored.main).toEqual(new Map([["SIDE", 1], ["SHARED", 2]]));
    expect(restored.equipment).toBe(draft.equipment);
    expect(draft.main).toEqual(new Map([["MAIN", 2], ["SHARED", 1]]));
  });

  it("starts with the registered deck in main and the sideboard in inventory", () => {
    const selection = defaultSelection(pool, "deck-1");

    expect([...selection.main]).toEqual([
      ["MAIN", 2],
      ["SHARED", 1],
    ]);
    expect([...poolCounts(pool)]).toEqual([
      ["MAIN", 2],
      ["SHARED", 2],
      ["SIDE", 1],
    ]);
  });

  it("moves exactly one copy in either direction and stays within the pool", () => {
    const available = poolCounts(pool);
    const initial = defaultSelection(pool, "deck-1").main;
    const movedOut = adjustMainCount(initial, available, "MAIN", -1);
    const movedBack = adjustMainCount(movedOut, available, "MAIN", 1);

    expect(movedOut.get("MAIN")).toBe(1);
    expect(movedBack.get("MAIN")).toBe(2);
    expect(adjustMainCount(movedBack, available, "MAIN", 1).get("MAIN")).toBe(2);
    expect(adjustMainCount(new Map(), available, "SIDE", -1).has("SIDE")).toBe(false);
  });

  it("places Modular equipment into the first unoccupied equipment slot", () => {
    const selection = defaultSelection(
      { ...pool, equipmentPool: ["EVO014", "EVO013"] },
      "deck-1",
    );

    expect(selection.equipment).toEqual({ head: "EVO014", chest: "EVO013" });
  });

  it("defaults to the first two one-hand weapons", () => {
    expect(defaultWeapons(["SAR002", "SAR002", "WTR003"])).toEqual([
      "SAR002",
      "SAR002",
    ]);
    expect(defaultSelection({
      ...pool,
      weaponIds: ["SAR002", "SAR002", "WTR003"],
    }, "duplicate-weapons").weaponIndexes).toEqual([0, 1]);
  });

  it("stops after the first two-hand weapon", () => {
    expect(defaultWeapons(["WTR003", "SAR002", "SAR002"])).toEqual(["WTR003"]);
  });

  it("pairs a two-hand weapon with a Perched off-hand", () => {
    expect(defaultWeapons(["WTR003", "SEA003", "SAR002"])).toEqual([
      "WTR003",
      "SEA003",
    ]);
    expect(defaultWeapons(["SEA003", "WTR003", "SAR002"])).toEqual([
      "SEA003",
      "WTR003",
    ]);
  });

  it("skips a two-hand weapon that cannot fit the remaining hand", () => {
    expect(defaultWeapons(["SAR002", "WTR003", "SAR002"])).toEqual([
      "SAR002",
      "SAR002",
    ]);
  });
});
