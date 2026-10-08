import { describe, expect, it } from "vitest";
import {
  cardData,
  formatLegalityIssues,
  isImplemented,
  precon,
  precons,
  preconsForFormat,
} from "../index.js";

describe("Classic Constructed shared decks", () => {
  it("offers shared decks in release order", () => {
    expect(preconsForFormat("cc").map((deck) => deck.id)).toEqual([
      "precon-asb",
      "precon-aio",
      "precon-ajv",
      "precon-amx",
      "precon-agb",
      "precon-asr",
      "precon-aps",
      "precon-arr",
      "precon-aac",
      "precon-aha",
      "precon-azs",
      "precon-aol",
    ]);
    expect(precon("precon-ako")?.name).toBe("Armory Deck: Kayo");
  });

  it("hides shared decks with Living Legend heroes or banned cards", () => {
    const hidden = precons
      .filter((deck) => deck.format === "cc")
      .filter((deck) => formatLegalityIssues(cardData, deck.pool, deck.format).length > 0);
    expect(hidden.map((deck) => deck.id)).toEqual([
      "precon-ako", "precon-aaz", "precon-ast", "bot-starvo-boss",
    ]);
    expect(hidden.map((deck) => cardData[deck.pool.heroId]!.name)).toEqual([
      "Kayo, Armed and Dangerous",
      "Azalea, Ace in the Hole",
      "Aurora, Shooting Star",
      "Bravo, Star of the Show",
    ]);
  });

  it("registers complete 60-card pools containing only implemented cards", () => {
    for (const deck of precons.filter((candidate) => candidate.format === "cc")) {
      expect(deck.pool.deck, `${deck.id} main deck`).toHaveLength(60);
      expect(cardData[deck.pool.heroId]?.cardType, `${deck.id} hero`).toBe("hero");
      for (const id of [
        ...deck.pool.weaponIds,
        ...deck.pool.equipmentPool,
        ...deck.pool.deck,
        ...(deck.pool.sideboard ?? []),
      ]) {
        expect(cardData[id], `${deck.id}: ${id} has data`).toBeTruthy();
        expect(isImplemented(cardData[id]!), `${deck.id}: ${id} implemented`).toBe(true);
      }
    }
  });

  it("registers the Hala Masterclass list only for the practice bot", () => {
    expect(precon("precon-hala-masterclass")).toMatchObject({
      name: "Masterclass: Hala, Bladesaint of the Vow",
      format: "cc",
      botOnly: true,
    });
    expect(preconsForFormat("cc").map((deck) => deck.id))
      .not.toContain("precon-hala-masterclass");
  });

  it("registers the Cindra Fabrary list only for the practice bot", () => {
    const cindra = precon("bot-cindra-head-jabs");
    expect(cindra).toMatchObject({
      name: "Art of the Dragon: Head Jab",
      format: "cc",
      botOnly: true,
    });
    expect(preconsForFormat("cc").map((deck) => deck.id))
      .not.toContain("bot-cindra-head-jabs");

    const pool = cindra!.pool;
    expect(pool.weaponIds.length + pool.equipmentPool.length + pool.deck.length + pool.sideboard!.length)
      .toBe(80);
    for (const id of [...pool.weaponIds, ...pool.equipmentPool, ...pool.deck, ...pool.sideboard!]) {
      expect(cardData[id], id).toBeTruthy();
      expect(isImplemented(cardData[id]!), id).toBe(true);
    }
  });

  it("registers the complete Atlanta Jarl list only for the practice bot", () => {
    const jarl = precon("bot-jarl");
    expect(jarl).toMatchObject({
      name: "100th Calling: Atlanta 3rd 🇺🇸",
      format: "cc",
      botOnly: true,
    });
    expect(preconsForFormat("cc").map((deck) => deck.id)).not.toContain("bot-jarl");

    const pool = jarl!.pool;
    expect(pool.deck).toHaveLength(60);
    expect(pool.weaponIds.length + pool.equipmentPool.length + pool.deck.length + pool.sideboard!.length)
      .toBe(80);
    expect(new Set([...pool.weaponIds, ...pool.equipmentPool])).toEqual(new Set([
      "ROS028", "OMN204", "IAR223", "PEN215", "PEN227", "PEN310",
      "EVO249", "AJV006", "ELE144", "PEN313", "SBR002", "EVR018", "SLY002",
    ]));
    const counts = Object.fromEntries(
      [...pool.deck, ...pool.sideboard!].map((id) => [id, 0]),
    );
    for (const id of [...pool.deck, ...pool.sideboard!]) counts[id] = (counts[id] ?? 0) + 1;
    expect(counts).toEqual({
      IAR261: 3, PEN319: 3, PEN320: 1, SUP261: 3, AJV011: 2,
      ELE005: 3, SBR020: 2, ROS042: 3, PEN321: 3, ASR018: 2,
      SBA028: 3, SBR021: 1, SUP262: 3, AJV014: 3, ELE147: 1,
      TER027: 2, ELE146: 3, AJV018: 3, SEA258: 3, AJV020: 3,
      ROS057: 3, ELE018: 2, IAR260: 3, EVR022: 2, ELE114: 1,
      HVY209: 2, APS021: 2, SIY033: 2,
    });
    for (const id of [...pool.weaponIds, ...pool.equipmentPool, ...pool.deck, ...pool.sideboard!]) {
      expect(cardData[id], id).toBeTruthy();
      expect(isImplemented(cardData[id]!), id).toBe(true);
    }
  });

  it("registers the open-pool Starvo boss only for the practice bot", () => {
    const starvo = precon("bot-starvo-boss");
    expect(starvo).toMatchObject({
      name: "Bravo, Star of the Show — Boss Battle",
      format: "cc",
      botOnly: true,
    });
    expect(preconsForFormat("cc").map((deck) => deck.id)).not.toContain("bot-starvo-boss");

    const pool = starvo!.pool;
    expect(pool.deck).toHaveLength(60);
    expect(pool.weaponIds.length + pool.equipmentPool.length + pool.deck.length + pool.sideboard!.length)
      .toBe(77);
    for (const id of [...pool.weaponIds, ...pool.equipmentPool, ...pool.deck, ...pool.sideboard!]) {
      expect(cardData[id], id).toBeTruthy();
      expect(isImplemented(cardData[id]!), id).toBe(true);
    }
  });
});
