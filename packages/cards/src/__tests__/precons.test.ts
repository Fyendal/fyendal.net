/**
 * The hardcoded silver-age precon pools (data/precons.json, official LSS
 * Silver Age decklists — Chapter 3, Chapter 2, and the imported Chapter 1
 * all five Chapter 1 decks): every id
 * must resolve, every card must be implemented, and each pool must be a legal
 * 55-card silver-age registration (weapons + equipment + main; main ≥ 40 at
 * presentation).
 */
import { describe, expect, it } from "vitest";
import { cardData, isImplemented, precon, preconsForFormat, silverAgePrecon, silverAgePrecons } from "../index.js";

describe("silver-age precon pools", () => {
  it("offers the imported Chapter 1-3 precons", () => {
    expect(silverAgePrecons.map((p) => p.id)).toEqual([
      "precon-sba",
      "precon-sly",
      "precon-sgb",
      "precon-sbz",
      "precon-sbl",
      "precon-sen",
      "precon-sfa",
      "precon-saz",
      "precon-sdo",
      "precon-sar",
      "precon-svi",
      "precon-sda",
      "precon-sbr",
      "precon-ska",
      "precon-siy",
    ]);
    expect(silverAgePrecon("precon-sba")?.name).toBe("Briar Precon");
    expect(silverAgePrecon("precon-svi")?.name).toBe("Viserai Precon");
    expect(silverAgePrecon("precon-sda")?.name).toBe("Dash Precon");
    expect(silverAgePrecon("precon-sbr")?.name).toBe("Bravo, Flattering Showman Precon");
    expect(silverAgePrecon("precon-ska")?.name).toBe("Kayo Precon");
    expect(silverAgePrecon("precon-siy")?.name).toBe("Iyslander Precon");
    expect(silverAgePrecon("nope")).toBeNull();
  });

  it("every pool is a legal 55-card registration of implemented cards", () => {
    for (const p of silverAgePrecons) {
      const { pool } = p;
      const total =
        pool.weaponIds.length +
        pool.equipmentPool.length +
        pool.deck.length +
        (pool.sideboard?.length ?? 0);
      expect(total, `${p.id} pool size`).toBe(55);
      expect(pool.deck.length, `${p.id} main deck`).toBeGreaterThanOrEqual(40);

      const hero = cardData[pool.heroId];
      expect(hero?.cardType, `${p.id} hero`).toBe("hero");

      for (const id of [...pool.weaponIds, ...pool.equipmentPool, ...pool.deck]) {
        const card = cardData[id];
        expect(card, `${p.id}: ${id} has data`).toBeTruthy();
        expect(isImplemented(card!), `${p.id}: ${id} (${card!.name}) implemented`).toBe(true);
      }
      // equipment must be presentable: a real slot subtype per piece
      for (const id of pool.equipmentPool) {
        const subs = cardData[id]!.subtypes ?? [];
        expect(
          subs.some((s) => ["head", "chest", "arms", "legs"].includes(s)),
          `${p.id}: ${id} slot`,
        ).toBe(true);
      }
    }
  });

  it("registers the Bravo practice list without offering it as a player precon", () => {
    const bravo = precon("bot-bravo-flarvo");
    expect(bravo).toMatchObject({
      name: "Flarvo - Skirmish Season 15 Winner!",
      format: "silver-age",
      botOnly: true,
    });
    expect(preconsForFormat("silver-age").map((deck) => deck.id))
      .not.toContain("bot-bravo-flarvo");
    const pool = bravo!.pool;
    expect(pool.weaponIds.length + pool.equipmentPool.length + pool.deck.length + pool.sideboard!.length)
      .toBe(55);
    for (const id of [...pool.weaponIds, ...pool.equipmentPool, ...pool.deck, ...pool.sideboard!]) {
      expect(cardData[id], id).toBeTruthy();
      expect(isImplemented(cardData[id]!), id).toBe(true);
    }
  });

  it("registers the Fabrary Briar list only for the practice bot", () => {
    const briar = precon("bot-briar-broccoli");
    expect(briar).toMatchObject({
      name: "🥦 Broccoli Deck in Format",
      format: "silver-age",
      botOnly: true,
    });
    expect(preconsForFormat("silver-age").map((deck) => deck.id))
      .not.toContain("bot-briar-broccoli");
    const pool = briar!.pool;
    expect(pool.weaponIds.length + pool.equipmentPool.length + pool.deck.length + pool.sideboard!.length)
      .toBe(55);
    for (const id of [...pool.weaponIds, ...pool.equipmentPool, ...pool.deck, ...pool.sideboard!]) {
      expect(cardData[id], id).toBeTruthy();
      expect(isImplemented(cardData[id]!), id).toBe(true);
    }
  });
});
