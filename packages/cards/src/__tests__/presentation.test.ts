import { describe, expect, it } from "vitest";
import type { CardData, DeckPool, Format, PresentedDeck } from "@fyendal/shared";
import {
  arenaWeaponIssue,
  validateArenaAgainstCards,
  validatePresentationAgainstCards,
} from "../presentation.js";

const card = (id: string, cardType: CardData["cardType"], subtypes: string[] = []): CardData => ({
  id,
  name: id,
  cardType,
  subtypes,
  text: "",
});

const cards: Record<string, CardData> = {
  HERO: card("HERO", "hero"),
  KAYO: { ...card("KAYO", "hero"), name: "Kayo, Strong-arm" },
  ZANE: { ...card("ZANE", "hero"), name: "Zane, Broadly Beloved" },
  TWO_SWORD: card("TWO_SWORD", "weapon", ["sword", "2h"]),
  ONE: card("ONE", "weapon", ["sword", "1h"]),
  TWO: card("TWO", "weapon", ["bow", "2h"]),
  TWO_CLUB: card("TWO_CLUB", "weapon", ["club", "2h"]),
  QUIVER: card("QUIVER", "equipment", ["quiver"]),
  OFF_HAND: card("OFF_HAND", "equipment", ["off-hand"]),
  PERCHED: { ...card("PERCHED", "action", ["off-hand", "ally"]), keywords: ["Perched"] },
  HEAD: card("HEAD", "equipment", ["head"]),
  CHEST: card("CHEST", "equipment", ["chest"]),
  BOTH: card("BOTH", "equipment", ["head", "chest"]),
  MODULAR: { ...card("MODULAR", "equipment"), keywords: ["Modular"] },
  MAIN: card("MAIN", "action", ["attack"]),
  SIDE: card("SIDE", "action", ["attack"]),
  OUT: card("OUT", "action", ["attack"]),
  FUTURE: { ...card("FUTURE", "action", ["attack"]), set: "AMO" },
  INCARNATE: { ...card("INCARNATE", "action", ["ally"]), keywords: ["Incarnate"] },
  INVENTORY: card("INVENTORY", "hero"),
};

const basePool = (size = 60): DeckPool => ({
  heroId: "HERO",
  weaponIds: ["ONE", "ONE", "TWO", "QUIVER"],
  equipmentPool: ["HEAD", "CHEST"],
  deck: Array.from({ length: size }, () => "MAIN"),
  sideboard: ["SIDE"],
});

const presentation = (deckSize = 60): PresentedDeck => ({
  weaponIds: ["ONE", "ONE"],
  equipment: { head: "HEAD", chest: "CHEST" },
  deck: Array.from({ length: deckSize }, () => "MAIN"),
});

describe("shared presentation validation", () => {
  it("validates arena cards without requiring a main deck", () => {
    expect(validateArenaAgainstCards(cards, basePool(0), { weaponIds: ["ONE", "ONE"], equipment: { head: "HEAD" } }, "cc"))
      .toEqual({ ok: true });
    expect(validateArenaAgainstCards(cards, basePool(), { weaponIds: ["TWO", "ONE"], equipment: {} }, "cc").ok).toBe(false);
    expect(validateArenaAgainstCards(cards, basePool(), { weaponIds: ["OUT"], equipment: {} }, "cc").ok).toBe(false);
    expect(validateArenaAgainstCards(cards, basePool(), { weaponIds: [], equipment: { arms: "HEAD" } }, "cc").ok).toBe(false);
    expect(validateArenaAgainstCards(cards, { ...basePool(), heroId: "KAYO" }, { weaponIds: ["ONE", "ONE"], equipment: {} }, "cc").ok).toBe(false);
  });

  it("applies the room's future-card rule while always validating the pool", () => {
    const pool = basePool();
    pool.deck[0] = "FUTURE";
    const deck = presentation().deck;
    deck[0] = "FUTURE";
    expect(validatePresentationAgainstCards(cards, pool, { ...presentation(), deck }, "cc"))
      .toEqual({ ok: false, error: "FUTURE is from the unreleased AMO set" });
    expect(validatePresentationAgainstCards(
      cards,
      pool,
      { ...presentation(), deck },
      "cc",
      { cardPoolMode: "future" },
    ).ok).toBe(true);
  });

  it("enforces Kayo, Strong-arm's single weapon zone", () => {
    const pool = { ...basePool(), heroId: "KAYO" };
    const result = validatePresentationAgainstCards(cards, pool, presentation(), "cc");
    expect(result).toEqual({ ok: false, error: "Kayo, Strong-arm starts with only one weapon zone" });
  });

  it("rejects an Incarnate card from the presented main deck", () => {
    const pool = basePool();
    pool.deck[0] = "INCARNATE";
    const deck = presentation().deck;
    deck[0] = "INCARNATE";

    expect(validatePresentationAgainstCards(cards, pool, { ...presentation(), deck }, "cc"))
      .toEqual({ ok: false, error: "INCARNATE can't start in your deck (Incarnate)" });
  });

  it("always carries fixed registered inventory into the game", () => {
    const pool = { ...basePool(), inventoryPool: ["INVENTORY"] };
    const result = validatePresentationAgainstCards(cards, pool, presentation(), "cc");

    expect(result).toMatchObject({ ok: true, decklist: { inventory: ["INVENTORY", "TWO", "QUIVER", "SIDE"] } });
  });

  it.each([
    ["two one-hand weapons", ["ONE", "ONE"], true],
    ["a two-hand weapon alone", ["TWO"], true],
    ["a two-hand bow plus one quiver", ["TWO", "QUIVER"], true],
    ["a two-hand bow plus one Perched off-hand", ["TWO", "PERCHED"], true],
    ["a two-hand club plus one Perched off-hand", ["TWO_CLUB", "PERCHED"], true],
    ["a two-hand club plus a quiver", ["TWO_CLUB", "QUIVER"], false],
    ["a two-hand weapon plus another weapon", ["TWO", "ONE"], false],
    ["more than one off-hand", ["OFF_HAND", "PERCHED"], false],
    ["more than one quiver", ["TWO", "QUIVER", "QUIVER"], false],
    ["more than two one-hand weapons", ["ONE", "ONE", "ONE"], false],
  ])("handles %s", (_name, weaponIds, ok) => {
    const pool = basePool();
    pool.weaponIds.push("ONE", "QUIVER", "TWO_CLUB", "OFF_HAND", "PERCHED");
    expect(validatePresentationAgainstCards(cards, pool, { ...presentation(), weaponIds }, "cc").ok).toBe(ok);
  });

  it.each([
    ["matching equipment slot", { head: "HEAD" }, true],
    ["wrong equipment slot", { head: "CHEST" }, false],
    ["equipment outside the pool", { head: "OUT" }, false],
    ["one registered copy used in two slots", { head: "BOTH", chest: "BOTH" }, false],
  ] as const)("handles %s", (_name, equipment, ok) => {
    const pool = basePool();
    pool.equipmentPool.push("BOTH", "MODULAR");
    expect(validatePresentationAgainstCards(cards, pool, { ...presentation(), equipment }, "cc").ok).toBe(ok);
  });

  it.each(["head", "chest", "arms", "legs"] as const)(
    "allows Modular equipment in the %s slot",
    (slot) => {
      const pool = basePool();
      pool.equipmentPool.push("MODULAR");
      expect(validatePresentationAgainstCards(
        cards,
        pool,
        { ...presentation(), equipment: { [slot]: "MODULAR" } },
        "cc",
      ).ok).toBe(true);
    },
  );

  it.each([
    ["registered copies", ["MAIN", "SIDE"], true],
    ["too many copies", ["SIDE", "SIDE"], false],
    ["unregistered card", ["MAIN", "OUT"], false],
  ] as const)("enforces the main-deck subset for %s", (_name, chosen, ok) => {
    const pool = basePool(59);
    const deck = [...Array.from({ length: 58 }, () => "MAIN"), ...chosen];
    expect(validatePresentationAgainstCards(cards, pool, { ...presentation(), deck }, "cc").ok).toBe(ok);
  });

  it.each([
    ["cc", 59, false],
    ["cc", 60, true],
    ["silver-age", 39, false],
    ["silver-age", 40, true],
    ["silver-age", 41, false],
  ] as [Format, number, boolean][])("enforces %s size %d", (format, size, ok) => {
    const pool = basePool(Math.max(60, size));
    expect(validatePresentationAgainstCards(cards, pool, presentation(size), format).ok).toBe(ok);
  });
});

describe("arena weapon issues", () => {
  it.each([
    ["HERO", ["TWO", "ONE"], { code: "two-hander-pairing", cardId: "TWO" }],
    ["HERO", ["TWO", "TWO_CLUB"], { code: "multiple-two-handers", cardId: "TWO" }],
    ["HERO", ["ONE", "ONE", "OFF_HAND"], { code: "too-many" }],
    ["HERO", ["OFF_HAND", "PERCHED"], { code: "multiple-off-hands" }],
    ["HERO", ["MAIN"], { code: "not-weapon-zone", cardId: "MAIN" }],
    ["KAYO", ["ONE", "ONE"], { code: "single-weapon-zone", cardId: "KAYO" }],
    ["HERO", ["TWO", "QUIVER"], null],
    ["ZANE", ["TWO_SWORD", "TWO_SWORD"], null],
    ["ZANE", ["TWO_SWORD", "ONE"], null],
    ["ZANE", ["TWO_SWORD", "TWO_CLUB"], { code: "two-hander-pairing", cardId: "TWO_CLUB" }],
    ["HERO", ["TWO_SWORD", "ONE"], { code: "two-hander-pairing", cardId: "TWO_SWORD" }],
  ] as const)("reports %s with %j", (heroId, ids, expected) => {
    expect(arenaWeaponIssue(cards, heroId, ids)).toEqual(expected);
  });
});
