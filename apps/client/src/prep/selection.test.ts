import type { DeckPool } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  adjustMainCount,
  defaultSelection,
  defaultWeapons,
  poolCounts,
} from "./selection.js";

const pool: DeckPool = {
  heroId: "HERO",
  weaponIds: [],
  equipmentPool: [],
  deck: ["MAIN", "MAIN", "SHARED"],
  sideboard: ["SIDE", "SHARED"],
};

describe("prep deck selection", () => {
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
  });

  it("stops after the first two-hand weapon", () => {
    expect(defaultWeapons(["WTR003", "SAR002", "SAR002"])).toEqual(["WTR003"]);
  });

  it("skips a two-hand weapon that cannot fit the remaining hand", () => {
    expect(defaultWeapons(["SAR002", "WTR003", "SAR002"])).toEqual([
      "SAR002",
      "SAR002",
    ]);
  });
});
