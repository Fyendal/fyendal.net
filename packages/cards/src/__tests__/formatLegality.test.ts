import { describe, expect, it } from "vitest";
import type { CardData, DeckPool } from "@fyendal/shared";
import { formatLegalityIssues } from "../formatLegality.js";

const card = (
  id: string,
  name: string,
  cardType: CardData["cardType"] = "action",
  pitch?: CardData["pitch"],
  set?: string,
): CardData => ({ id, name, cardType, ...(pitch ? { pitch } : {}), ...(set ? { set } : {}), text: "" });

const cards: Record<string, CardData> = {
  HERO: card("HERO", "Rhinar, Reckless Rampage", "hero"),
  AZALEA: card("AZALEA", "Azalea, Ace in the Hole", "hero"),
  DEATH_DEALER: card("DEATH_DEALER", "Death Dealer", "weapon"),
  KAYO: card("KAYO", "Kayo, Armed and Dangerous", "hero"),
  MANDIBLE_CLAW: card("MANDIBLE_CLAW", "Mandible Claw", "weapon"),
  PRISM_AWAKENER: card("PRISM_AWAKENER", "Prism, Awakener of Sol", "hero"),
  LUMINARIS_ANGEL: card("LUMINARIS_ANGEL", "Luminaris, Angel's Glow", "weapon"),
  LUMINARIS_CELESTIAL: card("LUMINARIS_CELESTIAL", "Luminaris, Celestial Fury", "weapon"),
  VERDANCE: card("VERDANCE", "Verdance, Thorn of the Rose", "hero"),
  STAFF: card("STAFF", "Staff of Verdant Shoots", "weapon"),
  VICTOR: card("VICTOR", "Victor Goldmane, High and Mighty", "hero"),
  GRINDSTONE: card("GRINDSTONE", "Miller's Grindstone", "weapon"),
  ART: card("ART", "Art of War"),
  CHANNEL_LIGHTNING_VALLEY: card("CHANNEL_LIGHTNING_VALLEY", "Channel Lightning Valley"),
  PHANTOM_TIDEMAW: card("PHANTOM_TIDEMAW", "Phantom Tidemaw"),
  REAPING_BLADE: card("REAPING_BLADE", "Reaping Blade", "weapon"),
  REMEMBRANCE: card("REMEMBRANCE", "Remembrance"),
  VOLZAR: card("VOLZAR", "Volzar, the Lightning Rod", "weapon"),
  ROOTBOUND_CARAPACE: card("ROOTBOUND_CARAPACE", "Rootbound Carapace", "defense-reaction", 1),
  SCEPTER_OF_PAIN: card("SCEPTER_OF_PAIN", "Scepter of Pain", "weapon"),
  TALK_A_BIG_GAME: card("TALK_A_BIG_GAME", "Talk a Big Game"),
  BONDS_RED: card("BONDS_RED", "Bonds of Ancestry", "action", 1),
  BONDS_YELLOW: card("BONDS_YELLOW", "Bonds of Ancestry", "action", 2),
  BONDS_BLUE: card("BONDS_BLUE", "Bonds of Ancestry", "action", 3),
  SOMERSAULT_RED: card("SOMERSAULT_RED", "Electromagnetic Somersault", "action", 1),
  SOMERSAULT_YELLOW: card("SOMERSAULT_YELLOW", "Electromagnetic Somersault", "action", 2),
  SOMERSAULT_BLUE: card("SOMERSAULT_BLUE", "Electromagnetic Somersault", "action", 3),
  NORMAL: card("NORMAL", "Wrecker Romp", "action", 3),
  FUTURE: card("FUTURE", "Tomorrow's Attack", "action", 1, "AMO"),
};

function pool(overrides: Partial<DeckPool> = {}): DeckPool {
  return {
    heroId: "HERO",
    weaponIds: [],
    equipmentPool: [],
    deck: ["NORMAL"],
    sideboard: [],
    ...overrides,
  };
}

describe("Classic Constructed format legality", () => {
  it("rejects Living Legend heroes and their signature weapons", () => {
    const pairs = [
      ["AZALEA", ["DEATH_DEALER"]],
      ["KAYO", ["MANDIBLE_CLAW"]],
      ["PRISM_AWAKENER", ["LUMINARIS_ANGEL", "LUMINARIS_CELESTIAL"]],
      ["VERDANCE", ["STAFF"]],
      ["VICTOR", ["GRINDSTONE"]],
    ] as const;

    for (const [heroId, weaponIds] of pairs) {
      const issues = formatLegalityIssues(
        cards,
        pool({ heroId, weaponIds: [...weaponIds] }),
        "cc",
      );
      expect(issues.map((issue) => issue.kind)).toEqual([
        "living-legend-hero",
        ...weaponIds.map(() => "living-legend-weapon" as const),
      ]);
    }
  });

  it("rejects cards banned at every pitch", () => {
    const issues = formatLegalityIssues(cards, pool({
      weaponIds: ["REAPING_BLADE", "VOLZAR"],
      deck: ["ART", "CHANNEL_LIGHTNING_VALLEY", "PHANTOM_TIDEMAW", "REMEMBRANCE"],
    }), "cc");
    expect(issues.map((issue) => issue.cardName)).toEqual([
      "Reaping Blade",
      "Volzar, the Lightning Rod",
      "Art of War",
      "Channel Lightning Valley",
      "Phantom Tidemaw",
      "Remembrance",
    ]);
  });

  it("applies pitch-specific bans without banning legal colors", () => {
    expect(formatLegalityIssues(
      cards,
      pool({ deck: ["BONDS_RED", "SOMERSAULT_BLUE"] }),
      "cc",
    )).toEqual([]);
    const issues = formatLegalityIssues(
      cards,
      pool({ deck: ["BONDS_YELLOW", "BONDS_BLUE", "SOMERSAULT_RED", "SOMERSAULT_YELLOW"] }),
      "cc",
    );
    expect(issues.map((issue) => issue.cardId)).toEqual([
      "BONDS_YELLOW",
      "BONDS_BLUE",
      "SOMERSAULT_RED",
      "SOMERSAULT_YELLOW",
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      "Bonds of Ancestry (Yellow) is banned in Classic Constructed",
      "Bonds of Ancestry (Blue) is banned in Classic Constructed",
      "Electromagnetic Somersault (Red) is banned in Classic Constructed",
      "Electromagnetic Somersault (Yellow) is banned in Classic Constructed",
    ]);
  });

  it("allows cards removed from the Classic Constructed ban list", () => {
    expect(formatLegalityIssues(cards, pool({
      weaponIds: ["SCEPTER_OF_PAIN"],
      deck: ["ROOTBOUND_CARAPACE", "TALK_A_BIG_GAME"],
    }), "cc")).toEqual([]);
  });

  it("does not apply the Classic Constructed list to other formats", () => {
    expect(formatLegalityIssues(cards, pool({ deck: ["ART"] }), "silver-age")).toEqual([]);
  });

  it("rejects unreleased-set cards unless the room allows future cards", () => {
    for (const format of ["cc", "silver-age"] as const) {
      expect(formatLegalityIssues(cards, pool({ deck: ["FUTURE"] }), format)).toMatchObject([
        { kind: "future-card", cardName: "Tomorrow's Attack" },
      ]);
      expect(formatLegalityIssues(
        cards,
        pool({ deck: ["FUTURE"] }),
        format,
        { allowFutureCards: true },
      )).toEqual([]);
    }
  });
});
