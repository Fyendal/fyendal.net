import { cardData, precon, validatePresentation } from "@fyendal/cards";
import type { Decklist } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  boltynPreferredTurnOrderFor,
  boltynPresentationFor,
  bravoPresentationFor,
  briarPresentationFor,
  cindraPresentationFor,
  halaPresentationFor,
  iraPresentation,
  iraSageMatchupForHeroName,
  iraSagePresentationFor,
  jarlPresentationFor,
  leviaPresentationFor,
  leviaPreferredTurnOrderFor,
  starvoPresentationFor,
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

describe("Levia Gates matchup guide", () => {
  const pool = precon("bot-levia-gates")!.pool;
  const guide = (heroName: string) => {
    const cards = { ...cardData, GUIDE_HERO: { ...cardData["MON119"]!, name: heroName } };
    const opponent = { heroId: "GUIDE_HERO", weaponIds: [], equipment: {} };
    return {
      presented: leviaPresentationFor(opponent, cards),
      preference: leviaPreferredTurnOrderFor(opponent, cards),
    };
  };

  it("uses the anti-Wizard AB3 arena and cuts", () => {
    const { presented, preference } = guide("Oscilio, Constella Intelligence");
    expect(preference).toBe("first");
    expect(presented).toMatchObject({
      weaponIds: ["MON221B"],
      equipment: { head: "CRU006", chest: "AKO004", arms: "ARC157", legs: "WTR004" },
    });
    expect(presented.deck).toHaveLength(60);
    expect(presented.deck).not.toContain("SUP165");
    expect(presented.deck).not.toContain("PEN194");
  });

  it("keeps 63 cards into Huntsman and 60 into all other named heroes", () => {
    const names = [
      "Marlynn", "Levia, Shadowborn Abomination", "Jarl Vetreiði", "Viserai, Between Worlds",
      "Arakni, 5L!p3d 7hRu 7h3 cR4X", "Arakni, Huntsman", "Arakni, Marionette",
      "Aurora, Legacy of Tempest", "Betsy", "Bravo, Showstopper", "Cindra, Dracai of Retribution",
      "Dash I/O", "Dorinthea Ironsong", "Fai, Rising Rebellion", "Fang, Dracai of Blades",
      "Mortimer", "Gravy Bones, Shipwrecked Looter", "Ira, Scarlet Revenger", "Kassai of the Golden Sand",
      "Hala, Bladesaint of the Vow", "Katsu, the Wanderer", "Kayo, Armed and Dangerous",
      "Lyath Goldmane, Vile Savant", "Malice, Domina of the Dead", "Maxx Nitro",
      "Olympia, Prized Fighter", "Puffin, Hightail", "Pleiades, Superstar", "Rhinar, Reckless Rampage",
      "Riptide, Lurker of the Deep", "Boltyn, Breaker of Dawn", "Tuffnut, Bumbling Hulkster",
      "Teklovossen, Esteemed Magnate", "Vynnset, Iron Maiden", "Valda Brightaxe", "Uzuri, Switchblade",
      "Zyggy Starlight", "Unknown Hero",
    ];
    for (const name of names) {
      const { presented } = guide(name);
      expect(presented.deck, name).toHaveLength(name === "Arakni, Huntsman" ? 63 : 60);
      expect(validatePresentation(pool, presented, "cc", { cardPoolMode: "open" }), name)
        .toMatchObject({ ok: true });
    }
  });

  it("selects the guide's distinct plans and second-player preferences", () => {
    const mirror = guide("Levia, Shadowborn Abomination");
    expect(mirror.preference).toBe("second");
    expect(mirror.presented.deck).not.toContain("SUP165");
    expect(mirror.presented.deck.filter((id) => id === "IAR037")).toHaveLength(1);
    const jarl = guide("Jarl Vetreiði").presented;
    expect(jarl.equipment).toMatchObject({ chest: "WTR150", arms: "IAR004" });
    expect(jarl.deck.filter((id) => id === "IAR017")).toHaveLength(2);
    const vynnset = guide("Vynnset, Iron Maiden").presented;
    expect(vynnset.equipment).toMatchObject({ chest: "MON187", arms: "ARC157" });
    expect(vynnset.deck.filter((id) => id === "IAR020")).toHaveLength(1);
    const marlynn = guide("Marlynn, Treasure Hunter").presented;
    expect(marlynn.equipment.chest).toBe("MON187");
    expect(marlynn.deck.filter((id) => id === "SUP165")).toHaveLength(1);
    expect(guide("Fang, Dracai of Blades").preference).toBe("second");
    expect(guide("Riptide, Lurker of the Deep").preference).toBe("second");
    expect(guide("Teklovossen, Esteemed Magnate").preference).toBe("second");
  });

  it("keeps the cut twin hero in inventory for both transformation routes", () => {
    for (const name of ["Oscilio, Constella Intelligence", "Jarl Vetreiði", "Levia, Shadowborn Abomination"]) {
      const result = validatePresentation(pool, guide(name).presented, "cc", { cardPoolMode: "open" });
      expect(result.ok, name).toBe(true);
      if (result.ok) expect(result.decklist.inventory).toContain("DTD164");
    }
  });
});

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
        expect(validatePresentation(pool, presented, "silver-age", { cardPoolMode: "open" })).toMatchObject({ ok: true });
      }
    }
  });
});

describe("SAGE Ira matchup presentation", () => {
  const pool = precon("bot-ira-sage")!.pool;
  const guide = (heroName: string, classes: string[] = ["brute"]) => {
    const cards = { ...cardData, GUIDE_HERO: { ...cardData["MON119"]!, name: heroName, classes } };
    return iraSagePresentationFor({ heroId: "GUIDE_HERO", weaponIds: [], equipment: {} }, cards);
  };
  const copies = (deck: readonly string[], id: string) => deck.filter((card) => card === id).length;

  it("groups heroes like the other Silver Age plans", () => {
    expect(iraSageMatchupForHeroName("oscilio, constella intelligence")).toBe("arcane");
    expect(iraSageMatchupForHeroName("someone", ["runeblade"])).toBe("arcane");
    expect(iraSageMatchupForHeroName("bravo, flattering showman")).toBe("dominate");
    expect(iraSageMatchupForHeroName("oldhim")).toBe("slow");
    expect(iraSageMatchupForHeroName("kayo")).toBe("aggro");
    expect(iraSageMatchupForHeroName("puffin")).toBe("default");
  });

  it("adds exactly one flex pair to the 38-card core", () => {
    const flex = ["SBW023", "HVY219", "SIY017", "AKO009", "SUP221"];
    const plans: [string, string[], string][] = [
      ["Kano", ["wizard"], "SBW023"],
      ["Bravo, Flattering Showman", ["guardian"], "HVY219"],
      ["Kayo", ["brute"], "SIY017"],
      ["Oldhim", ["guardian"], "AKO009"],
      ["Puffin", ["mechanologist"], "SUP221"],
    ];
    for (const [name, classes, added] of plans) {
      const presented = guide(name, classes);
      expect(presented.deck, name).toHaveLength(40);
      for (const id of flex) expect(copies(presented.deck, id), `${name} ${id}`).toBe(id === added ? 2 : 0);
      expect(validatePresentation(pool, presented, "silver-age", { cardPoolMode: "open" }), name)
        .toMatchObject({ ok: true });
    }
  });

  it("wears arcane barrier only against arcane heroes", () => {
    expect(guide("Kano", ["wizard"]).equipment).toEqual({
      head: "SFA005", chest: "SFA007", arms: "SFA008", legs: "SFA009",
    });
    expect(guide("Kayo").equipment).toEqual({
      head: "SLY005", chest: "SFA006", arms: "SFA008", legs: "SFA009",
    });
  });
});

describe("Bravo Fabrary matchup presentation", () => {
  it.each(["SBZ001", "ARC113"])(
    "uses the fatigue package and AB3 equipment against %s",
    (heroId) => {
      const presented = bravoPresentationFor(opponent({ heroId }));
      expect(presented.equipment).toEqual({
        head: "SBR006",
        chest: "SBR007",
        arms: "SGB006",
        legs: "SBL010",
      });
      const arcaneBarrier = Object.values(presented.equipment).reduce((total, id) =>
        total + (cardData[id!]?.keywords ?? []).reduce((pieceTotal, keyword) => {
          const amount = /^Arcane Barrier (\d+)$/.exec(keyword)?.[1];
          return pieceTotal + Number(amount ?? 0);
        }, 0),
      0);
      expect(arcaneBarrier).toBe(3);
      expect(presented.deck.filter((id) => id === "SBA030")).toHaveLength(2);
      expect(presented.deck.filter((id) => id === "SLY019")).toHaveLength(2);
      expect(presented.deck).not.toContain("SBR017");
    },
  );

  it("uses the anti-arcane package against Iyslander", () => {
    const presented = bravoPresentationFor(opponent({ heroId: "SIY001" }));
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
      opponent({ heroId: "ARC113" }),
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

describe("Jarl Atlanta matchup presentation", () => {
  it("presents all 67 deck cards with physical equipment by default", () => {
    const presented = jarlPresentationFor(opponent({ heroId: "RNR001" }));
    expect(presented).toMatchObject({
      weaponIds: ["SLY002", "EVR018"],
      equipment: {
        head: "PEN310",
        chest: "ROS028",
        arms: "AJV006",
        legs: "OMN204",
      },
    });
    expect(presented.deck).toHaveLength(67);
    expect(presented.deck.filter((id) => id === "AJV011")).toHaveLength(2);
    expect(presented.deck.filter((id) => id === "PEN321")).toHaveLength(3);
  });

  it.each(["AMA001", "IAR054", "ASB001", "BOL001", "HNT001", "TCC001", "EVO008"])(
    "uses Crown of Frozen Thoughts against %s",
    (heroId) => {
      const presented = jarlPresentationFor(opponent({ heroId }));
      expect(presented.equipment.head).toBe("PEN227");
    },
  );

  it.each([
    ["ROS019", 3, "PEN215"], ["SBZ001", 3, "PEN215"],
    ["ARC113", 3, "PEN215"], ["SIY001", 3, "PEN215"],
    ["ROS007", 1, "PEN310"], ["DTD133", 1, "PEN310"],
    ["SBA001", 1, "PEN310"], ["SVI001", 1, "PEN310"],
  ] as const)(
    "equips against %s with AB%s",
    (heroId, amount, head) => {
      const presented = jarlPresentationFor(opponent({ heroId }));
      expect(presented.equipment).toMatchObject({
        head,
        chest: "ELE144",
        legs: "OMN204",
      });
      const barrier = Object.values(presented.equipment).reduce((total, id) =>
        total + (cardData[id!]?.keywords ?? []).reduce((pieceTotal, keyword) =>
          pieceTotal + Number(/^Arcane Barrier (\d+)$/.exec(keyword)?.[1] ?? 0), 0), 0);
      expect(barrier).toBe(amount);
    },
  );

  it("always produces a legal presentation from the bot-only pool", () => {
    const pool = precon("bot-jarl")!.pool;
    for (const heroId of [
      "RNR001", "HNT263", "HNT001", "ROS007", "HNT054", "AIO001",
      "CRU076", "UPR001", "HNT073", "AGB001", "ASR001", "MPG000",
      "SDO001", "AKO001", "SEA010", "ROS019", "DTD133",
      "AMA001", "ASB001", "TCC001", "EVO008", "SBZ001",
      "ARC113", "SIY001", "SBA001", "SVI001",
    ]) {
      expect(validatePresentation(pool, jarlPresentationFor(opponent({ heroId })), "cc"))
        .toMatchObject({ ok: true });
    }
  });
});

describe("Starvo boss presentation", () => {
  it("uses Stalagmite and the physical suite by default", () => {
    const presented = starvoPresentationFor(opponent());
    expect(presented).toMatchObject({
      weaponIds: ["ELE003", "EVR018"],
      equipment: {
        head: "ELE115",
        chest: "WTR150",
        arms: "ELE173",
        legs: "TCC033",
      },
    });
    expect(presented.deck).toHaveLength(65);
  });

  it("uses the arcane package against Wizard and Greaves against Illusionist", () => {
    expect(starvoPresentationFor(opponent({ heroId: "ROS019" }))).toMatchObject({
      weaponIds: ["ELE003", "EVR155"],
      equipment: { chest: "ELE144", legs: "ROS071" },
    });
    expect(starvoPresentationFor(opponent({ heroId: "SEN001" })).equipment.legs)
      .toBe("ROS071");
  });

  it("reconstructs a valid 65-card open-pool presentation", () => {
    const pool = precon("bot-starvo-boss")!.pool;
    for (const heroId of ["RNR001", "ROS019", "SVI001", "SEN001"]) {
      const presented = starvoPresentationFor(opponent({ heroId }));
      expect(validatePresentation(pool, presented, "cc", { cardPoolMode: "open" }))
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

describe("Boltyn Raydn matchup guide", () => {
  const pool = precon("bot-boltyn-raydn")!.pool;
  const guide = (heroName: string, classes: string[] = []) => {
    const cards = { ...cardData, GUIDE_HERO: { ...cardData["WTR001"]!, name: heroName, classes } };
    const opponent = { heroId: "GUIDE_HERO", weaponIds: [], equipment: {} };
    return {
      presented: boltynPresentationFor(opponent, cards),
      preference: boltynPreferredTurnOrderFor(opponent, cards),
      validation: validatePresentation(pool, boltynPresentationFor(opponent, cards), "cc", { cardPoolMode: "open" }),
    };
  };
  const count = (deck: readonly string[], id: string) => deck.filter((card) => card === id).length;

  it("defaults unknown heroes to the Defensive Aggressor sixty", () => {
    const { presented, preference, validation } = guide("Unknown Hero");
    expect(validation).toMatchObject({ ok: true });
    expect(preference).toBe("first");
    expect(presented.weaponIds).toEqual(["ASB002"]);
    expect(presented.equipment).toEqual({ head: "EVO247", chest: "PEN311", arms: "DTD207", legs: "ASB006" });
    expect(presented.deck).toHaveLength(60);
    expect(count(presented.deck, "SBL020")).toBe(2);
    expect(count(presented.deck, "ASB014")).toBe(2);
    expect(count(presented.deck, "ANQ015")).toBe(1);
    expect(count(presented.deck, "ASB025")).toBe(2);
    expect(presented.deck).not.toContain("ASB016");
    expect(presented.deck).not.toContain("MPW146");
  });

  it("takes the Soulbond defender stance with the full reaction suite against aggro", () => {
    for (const name of ["Cindra, Dracai of Retribution", "Fai, Rising Rebellion", "Arakni, Marionette", "Dash I/O"]) {
      const { presented, validation } = guide(name);
      expect(validation, name).toMatchObject({ ok: true });
      expect(presented.equipment, name).toEqual({ head: "ASB003", chest: "DTD047", arms: "DTD207", legs: "ASB006" });
      expect(presented.deck, name).toHaveLength(60);
      expect(count(presented.deck, "ASB025"), name).toBe(3);
      expect(count(presented.deck, "ASB016"), name).toBe(3);
      expect(count(presented.deck, "SBL020"), name).toBe(1);
    }
    expect(guide("Arakni, Marionette").preference).toBe("second");
    expect(guide("Dash I/O").preference).toBe("first");
    expect(count(guide("Levia, Shadowborn Abomination").presented.deck, "MON063")).toBe(2);
  });

  it("brings Kabuto and the sword package against warriors", () => {
    const dorinthea = guide("Dorinthea Ironsong", ["warrior"]);
    expect(dorinthea.preference).toBe("second");
    expect(dorinthea.presented.equipment).toEqual({ head: "HNT115", chest: "PEN311", arms: "DTD207", legs: "ASB006" });
    expect(dorinthea.presented.deck).toHaveLength(63);
    expect(count(dorinthea.presented.deck, "ASB025")).toBe(3);
    expect(count(dorinthea.presented.deck, "ASB016")).toBe(3);
    const hala = guide("Hala, Bladesaint of the Vow", ["warrior"]);
    expect(hala.presented.equipment.head).toBe("HNT115");
    expect(hala.presented.deck).toHaveLength(63);
    expect(count(hala.presented.deck, "ANQ015")).toBe(1);
    const fang = guide("Fang, Dracai of Blades", ["warrior"]);
    expect(fang.presented.equipment).toMatchObject({ head: "HNT115", arms: "PEN179" });
    expect(fang.presented.deck).toHaveLength(60);
    expect(guide("Unknown Swordsman", ["warrior"]).presented.equipment.head).toBe("HNT115");
  });

  it("races fatigue and wizards on Tunic with Snapdragon Scalers", () => {
    for (const name of ["Arakni, Huntsman", "Teklovossen, Esteemed Magnate", "Zyggy Starlight", "Oscilio, Constella Intelligence"]) {
      const { presented, preference } = guide(name, name.includes("Oscilio") ? ["wizard"] : []);
      expect(presented.equipment, name).toMatchObject({ chest: "PEN311", legs: "BOL008" });
      expect(presented.deck, name).toHaveLength(60);
      expect(count(presented.deck, "MPW146"), name).toBe(2);
      expect(preference, name).toBe("first");
    }
    expect(guide("Oscilio, Constella Intelligence", ["wizard"]).presented.equipment.arms).toBe("PEN179");
  });

  it("uses the Circlet against shadow runeblades and larger decks into guardians", () => {
    const vynnset = guide("Vynnset, Iron Maiden", ["runeblade"]);
    expect(vynnset.presented.equipment).toEqual({ head: "IAR223", chest: "PEN311", arms: "PEN179", legs: "ASB006" });
    expect(vynnset.presented.deck).toHaveLength(63);
    const viserai = guide("Viserai, the Forsaken", ["runeblade"]);
    expect(viserai.presented.equipment).toEqual({ head: "IAR223", chest: "DTD047", arms: "PEN179", legs: "ASB006" });
    expect(viserai.presented.deck).toHaveLength(60);
    const jarl = guide("Jarl Vetreiði", ["guardian"]);
    expect(jarl.preference).toBe("first");
    expect(jarl.presented.deck).toHaveLength(63);
    expect(count(jarl.presented.deck, "MON063")).toBe(2);
    expect(guide("Victor Goldmane, High and Mighty", ["guardian"]).presented.deck).toHaveLength(62);
    const valda = guide("Valda Brightaxe", ["guardian"]);
    expect(valda.presented.equipment.chest).toBe("DTD047");
    expect(valda.presented.deck).toHaveLength(63);
  });

  it("presents a legal deck for every named hero in both turn orders", () => {
    const names = [
      "Marlynn, Treasure Hunter", "Aurora, Tempest in a Teacup", "Gravy Bones, Shipwrecked Looter",
      "Olympia, Prized Fighter", "Kassai of the Golden Sand", "Ira, Scarlet Revenger", "Puffin, Hightail",
      "Rhinar, Reckless Rampage", "Lyath Goldmane, Vile Savant", "Pleiades, Superstar", "Katsu, the Wanderer",
    ];
    for (const name of names) {
      const { validation, presented } = guide(name);
      expect(validation, name).toMatchObject({ ok: true });
      expect(presented.deck.length, name).toBeGreaterThanOrEqual(60);
      expect(presented.deck.length, name).toBeLessThanOrEqual(65);
    }
    expect(count(guide("Marlynn, Treasure Hunter").presented.deck, "ASB016")).toBe(3);
    expect(guide("Aurora, Tempest in a Teacup").presented.equipment.arms).toBe("PEN179");
    expect(guide("Olympia, Prized Fighter").presented.deck).toHaveLength(63);
  });
});
