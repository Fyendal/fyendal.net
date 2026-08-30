import { precon, validatePresentation } from "@fyendal/cards";
import type { Decklist } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  bravoPresentationFor,
  briarPresentationFor,
  cindraPresentationFor,
  halaPresentationFor,
  iraPresentation,
  jarlPresentationFor,
} from "./sideboard.js";

function opponent(overrides: Partial<Decklist> = {}): Decklist {
  return {
    heroId: "RNR001",
    weaponIds: [],
    equipment: {},
    deck: Array(40).fill("WTR159") as string[],
    ...overrides,
  };
}

describe("Briar matchup presentation", () => {
  it("uses the published Ninja, fatigue, Wizard, and Runeblade plans", () => {
    const ninja = briarPresentationFor(opponent({ heroId: "SFA001" }));
    expect(ninja.deck.filter((id) => id === "SBA023")).toHaveLength(2);
    expect(ninja.deck.filter((id) => id === "SBA013")).toHaveLength(1);
    expect(ninja.deck.filter((id) => id === "SBA032")).toHaveLength(1);
    const fatigue = briarPresentationFor(opponent({ heroId: "SDO001" }));
    expect(fatigue.deck.filter((id) => id === "ELE119")).toHaveLength(2);
    expect(fatigue.deck.filter((id) => id === "OMN085")).toHaveLength(2);
    expect(fatigue.deck).not.toContain("SBA020");
    expect(fatigue.equipment.arms).toBe("SBA008");
    const wizard = briarPresentationFor(opponent({ heroId: "SBZ001" }));
    expect(wizard.deck.filter((id) => id === "SBA031")).toHaveLength(2);
    expect(wizard.equipment).toMatchObject({ head: "PEN093", arms: "SBA008", legs: "SBL010" });

    const runeblade = briarPresentationFor(opponent({ heroId: "SVI001" }));
    expect(runeblade.deck).not.toContain("SBA031");
    expect(runeblade.equipment).toMatchObject({ head: "PEN093", arms: "SBA008", legs: "SBA009" });
  });

  it("selects the mirror list after the actual first player is known", () => {
    const briar = opponent({ heroId: "SBA001" });
    const goingFirst = briarPresentationFor(briar, "first");
    expect(goingFirst.deck.filter((id) => id === "SBA023")).toHaveLength(2);
    expect(goingFirst.deck).not.toContain("SBA013");

    const goingSecond = briarPresentationFor(briar, "second");
    expect(goingSecond.deck.filter((id) => id === "SBA023")).toHaveLength(1);
    expect(goingSecond.deck).not.toContain("OMN085");
  });

  it("always produces a legal forty from the bot-only Fabrary pool", () => {
    const pool = precon("bot-briar-broccoli")!.pool;
    for (const heroId of [
      "RNR001", "SFA001", "SDO001", "SBZ001", "SVI001", "SAZ001",
      "SBA001", "SEN001", "SIY001",
    ]) {
      for (const turnOrder of ["first", "second"] as const) {
        const presented = briarPresentationFor(opponent({ heroId }), turnOrder);
        expect(presented.deck).toHaveLength(40);
        expect(validatePresentation(pool, presented, "silver-age")).toMatchObject({ ok: true });
      }
    }
  });
});

describe("Bravo Fabrary matchup presentation", () => {
  it("uses the anti-arcane Blaze package and full AB equipment", () => {
    const presented = bravoPresentationFor(opponent({ heroId: "SBZ001" }));
    expect(presented.equipment).toEqual({
      head: "SBR006",
      chest: "SBR007",
      arms: "SGB006",
      legs: "SBL010",
    });
    expect(presented.deck.filter((id) => id === "SBA030")).toHaveLength(2);
    expect(presented.deck.filter((id) => id === "SLY019")).toHaveLength(2);
    expect(presented.deck).not.toContain("SBR017");
  });

  it("follows the Briar guide's second-player plan", () => {
    const presented = bravoPresentationFor(opponent({ heroId: "SBA001" }));
    expect(presented.equipment.head).toBe("SBR006");
    expect(presented.equipment.arms).toBe("SBA007");
    expect(presented.deck.filter((id) => id === "SBA030")).toHaveLength(2);
    expect(presented.deck.filter((id) => id === "SBR016")).toHaveLength(2);
  });

  it("uses the Oldhim and Olympia long-game cuts", () => {
    for (const heroId of ["OLD001", "AOL001"]) {
      const matchup = opponent({ heroId });
      const presented = bravoPresentationFor(matchup);
      expect(presented.deck).not.toContain("MPG047");
      expect(presented.deck.filter((id) => id === "SBR021")).toHaveLength(2);
      expect(presented.deck.filter((id) => id === "SBR016")).toHaveLength(2);
    }
  });

  it("always produces a legal forty from the bot-only registered pool", () => {
    const pool = precon("bot-bravo-flarvo")!.pool;
    for (const matchup of [
      opponent(),
      opponent({ heroId: "SBZ001" }),
      opponent({ heroId: "SBR001" }),
      opponent({ heroId: "SBA001" }),
      opponent({ heroId: "DRO001" }),
      opponent({ heroId: "SEN001" }),
      opponent({ heroId: "SFA001" }),
      opponent({ heroId: "OLD001" }),
      opponent({ heroId: "AOL001" }),
      opponent({ heroId: "ROS019" }),
    ]) {
      expect(validatePresentation(pool, bravoPresentationFor(matchup), "silver-age"))
        .toMatchObject({ ok: true });
    }
  });
});

describe("Cindra Fabrary matchup presentation", () => {
  it("uses the stock sixty, Vest, and paired Kunai by default", () => {
    const presented = cindraPresentationFor(opponent());
    expect(presented).toMatchObject({
      weaponIds: ["GEM003", "GEM003"],
      equipment: {
        head: "WTR079",
        chest: "HNT168",
        arms: "SUP244",
        legs: "HNT143",
      },
    });
    expect(presented.deck).toHaveLength(60);
    expect(presented.deck.filter((id) => id === "UPR098")).toHaveLength(2);
  });

  it("uses the published defensive Furnace plan against Arakni, Marionette", () => {
    const matchup = opponent({ heroId: "HNT001" });
    const presented = cindraPresentationFor(matchup);
    expect(presented.equipment.chest).toBe("UPR084");
    expect(presented.deck).toHaveLength(60);
    expect(presented.deck.filter((id) => id === "PEN321")).toHaveLength(3);
    expect(presented.deck.filter((id) => id === "ANQ034")).toHaveLength(3);
    expect(presented.deck.filter((id) => id === "GEM015")).toHaveLength(3);
    expect(presented.deck).toContain("SUP216");
    expect(presented.deck).not.toContain("OMN245");
  });

  it("selects Claw and the defensive package into Oscilio", () => {
    const matchup = opponent({ heroId: "ROS019" });
    const presented = cindraPresentationFor(matchup);
    expect(presented.weaponIds).toEqual(["GEM003", "SEA257"]);
    expect(presented.equipment.chest).toBe("UPR084");
    expect(presented.deck.filter((id) => id === "PEN321")).toHaveLength(3);
    expect(presented.deck.filter((id) => id === "ANQ034")).toHaveLength(3);
  });

  it("uses the Warmonger's swap and Claw against Vynnset", () => {
    const presented = cindraPresentationFor(opponent({ heroId: "DTD133" }));
    expect(presented.weaponIds).toEqual(["GEM003", "SEA257"]);
    expect(presented.deck.filter((id) => id === "DTD230")).toHaveLength(2);
    expect(presented.deck).not.toContain("UPR098");
  });

  it("uses the exact Dori package and preserves the Huntsman sixty-four", () => {
    const dori = opponent({ heroId: "CRU076" });
    const doriDeck = cindraPresentationFor(dori);
    expect(doriDeck.deck).toHaveLength(60);
    expect(doriDeck.deck.filter((id) => id === "DTD230")).toHaveLength(2);
    expect(doriDeck.deck.filter((id) => id === "PEN321")).toHaveLength(3);
    const huntsman = opponent({ heroId: "DYN113" });
    const huntsmanDeck = cindraPresentationFor(huntsman);
    expect(huntsmanDeck.deck).toHaveLength(64);
    expect(huntsmanDeck.deck.filter((id) => id === "GEM015")).toHaveLength(3);
    expect(huntsmanDeck.deck).toContain("SUP216");
  });

  it("always produces a legal presentation from the bot-only pool", () => {
    const pool = precon("bot-cindra-head-jabs")!.pool;
    for (const matchup of [
      opponent(),
      opponent({ heroId: "HNT001" }),
      opponent({ heroId: "ROS019" }),
      opponent({ heroId: "SEA043" }),
      opponent({ heroId: "DTD133" }),
      opponent({ heroId: "HVY090" }),
      opponent({ heroId: "HNT054" }),
      opponent({ heroId: "DYN113" }),
      opponent({ heroId: "CRU045" }),
      opponent({ heroId: "CRU076" }),
      opponent({ heroId: "AIO001" }),
      opponent({ heroId: "ASB001" }),
    ]) {
      expect(validatePresentation(pool, cindraPresentationFor(matchup), "cc"))
        .toMatchObject({ ok: true });
    }
  });
});

describe("Jarl Fabrary matchup presentation", () => {
  it("uses the published anti-aggro quantities and physical equipment", () => {
    const presented = jarlPresentationFor(opponent({ heroId: "HNT054" }));
    expect(presented).toMatchObject({
      weaponIds: ["SLY002", "EVR018"],
      equipment: {
        head: "PEN310",
        chest: "ROS028",
        arms: "AJV006",
        legs: "OMN204",
      },
    });
    expect(presented.deck).toHaveLength(60);
    expect(presented.deck.filter((id) => id === "AJV011")).toHaveLength(2);
    expect(presented.deck.filter((id) => id === "PEN321")).toHaveLength(2);
  });

  it("uses the exact Oscilio and Huntsman branches from Fabrary", () => {
    const oscilio = jarlPresentationFor(opponent({ heroId: "ROS019" }));
    expect(oscilio.deck).toHaveLength(60);
    expect(oscilio.deck).toContain("AJV017");
    expect(oscilio.deck.filter((id) => id === "WTR161")).toHaveLength(2);
    expect(oscilio.deck).not.toContain("ROS042");
    expect(oscilio.equipment).toMatchObject({
      head: "PEN215",
      chest: "ELE144",
      legs: "SBL010",
    });

    const huntsman = jarlPresentationFor(opponent({ heroId: "HNT263" }));
    expect(huntsman.deck).toHaveLength(67);
    expect(huntsman.deck.filter((id) => id === "AJV011")).toHaveLength(3);
    expect(huntsman.deck.filter((id) => id === "HNT231")).toHaveLength(2);
  });

  it("always produces a legal presentation from the bot-only pool", () => {
    const pool = precon("bot-jarl")!.pool;
    for (const heroId of [
      "RNR001", "HNT263", "HNT001", "ROS007", "HNT054", "AIO001",
      "CRU076", "UPR001", "HNT073", "AGB001", "ASR001", "MPG000",
      "SDO001", "AKO001", "SEA010", "ROS019", "DTD133",
    ]) {
      expect(validatePresentation(pool, jarlPresentationFor(opponent({ heroId })), "cc"))
        .toMatchObject({ ok: true });
    }
  });
});

describe("Ira presentation", () => {
  it("presents the complete registered Armory Deck", () => {
    const pool = precon("precon-asr")!.pool;
    const presented = iraPresentation();
    expect(presented).toMatchObject({
      weaponIds: ["ASR002"],
      equipment: {
        head: "ASR003",
        chest: "ASR004",
        arms: "ASR005",
        legs: "ASR006",
      },
    });
    expect(presented.deck).toHaveLength(60);
    expect(validatePresentation(pool, presented, "cc")).toMatchObject({ ok: true });
  });
});

describe("Hala Masterclass presentation", () => {
  it("uses the proactive sixty and default equipment in a general matchup", () => {
    const presented = halaPresentationFor(opponent());
    expect(presented).toMatchObject({
      weaponIds: ["MPW005"],
      equipment: {
        head: "PEN310",
        chest: "MPW010",
        arms: "AHA005",
        legs: "MPW012",
      },
    });
    expect(presented.deck).toHaveLength(60);
    expect(presented.deck.filter((id) => id === "MPW076")).toHaveLength(1);
    expect(presented.deck.filter((id) => id === "MPW126")).toHaveLength(2);
  });

  it("brings the published defensive package against Arakni, Marionette", () => {
    const presented = halaPresentationFor(opponent({ heroId: "HNT001" }));
    expect(presented.deck).toHaveLength(60);
    expect(presented.deck.filter((id) => id === "PEN321")).toHaveLength(3);
    expect(presented.deck.filter((id) => id === "ASB016")).toHaveLength(3);
    expect(presented.deck.filter((id) => id === "PEN049")).toHaveLength(3);
    expect(presented.deck.filter((id) => id === "MPW025")).toHaveLength(2);
  });

  it("uses Kabuto and the larger long-game package in Warrior mirrors", () => {
    const presented = halaPresentationFor(opponent({ heroId: "SDO001" }));
    expect(presented.equipment.head).toBe("HNT115");
    expect(presented.deck).toHaveLength(64);
    expect(presented.deck.filter((id) => id === "MPW130")).toHaveLength(3);
    expect(presented.deck.filter((id) => id === "PEN049")).toHaveLength(3);
  });

  it.each(["AST001", "OMN047"])(
    "brings AB1 in the head slot against Aurora (%s)",
    (heroId) => {
      const presented = halaPresentationFor(opponent({ heroId }));
      expect(presented.equipment).toEqual({
        head: "ARC155",
        chest: "MPW010",
        arms: "AHA005",
        legs: "MPW012",
      });
      expect(presented.deck).toHaveLength(60);
    },
  );

  it("always produces a legal presentation from the registered pool", () => {
    const pool = precon("precon-hala-masterclass")!.pool;
    for (const matchup of [
      opponent(),
      opponent({ heroId: "HNT001" }),
      opponent({ heroId: "HNT054" }),
      opponent({ heroId: "SDO001" }),
      opponent({ heroId: "ROS019" }),
      opponent({ heroId: "AST001" }),
      opponent({ heroId: "OMN047" }),
    ]) {
      expect(validatePresentation(pool, halaPresentationFor(matchup), "cc"))
        .toMatchObject({ ok: true });
    }
  });
});
