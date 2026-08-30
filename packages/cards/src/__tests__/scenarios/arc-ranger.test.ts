import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";

const AZALEA = "azalea|0";
const DEATH_DEALER = "death dealer|0";
const BLUE = "wrecker romp|3";
const RED = "snatch|1";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function azaleaSeat(extra: Record<string, unknown> = {}) {
  return {
    hero: "dorinthea" as const,
    heroKey: AZALEA,
    weapons: [DEATH_DEALER],
    equipment: { ...NO_EQUIPMENT },
    ...extra,
  };
}

describe("ARC Ranger — arsenal setup", () => {
  it("Take Cover reloads a hand card face down after it resolves", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["take cover|1", BLUE] }),
        { hero: "rhinar", hand: ["snatch|1"] },
      ],
      active: 1,
    });

    s.play("snatch|1")
      .blockWith()
      .passPriority()
      .react("take cover|1")
      .chooseCard(BLUE)
      .expectInZone(0, BLUE, "arsenal")
      .expectFaceDown(0, BLUE, true);
  });

  it("Silver the Tip loads a looked-at arrow and bottoms the rest", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          hand: ["silver the tip|3", BLUE],
          deck: ["head shot|1", RED, "raging onslaught|2"],
          resources: 1,
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("silver the tip|3")
      .chooseCard("head shot|1")
      .expectInZone(0, "head shot|1", "arsenal")
      .expectDeckBottom(0, RED)
      .play("head shot|1", { fromArsenal: true, pitch: [BLUE] })
      .expectAttackValue(6); // 4 base +2 from entering the arsenal face up
  });

  it("Silver the Tip lets its controller order all cards put on the bottom", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          hand: ["silver the tip|2"],
          deck: [RED, BLUE, "raging onslaught|2", "pack hunt|1"],
          resources: 1,
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("silver the tip|2")
      .chooseCard(RED)
      .chooseCard(BLUE);

    expect(s.state.players[0]!.deck.map((card) => card.cardId)).toEqual([
      printingId("pack hunt|1"),
      printingId(RED),
      printingId(BLUE),
      printingId("raging onslaught|2"),
    ]);
  });

  it("Take Aim reloads and buffs the next Ranger attack action", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["take aim|2", "head shot|2", BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("take aim|2")
      .chooseCard("head shot|2")
      .expectFaceDown(0, "head shot|2", true)
      .play("head shot|2", { fromArsenal: true, pitch: [BLUE] })
      .expectAttackValue(5); // 3 base +2 from Take Aim; no face-up-entry bonus
  });

  it("Ridge Rider Shot opts when put face up into the arsenal", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          arsenal: ["ravenous rabble|1"],
          deck: ["ridge rider shot|2", RED, BLUE],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.activate(AZALEA)
      .chooseOption("bottom")
      .expectInZone(0, "ridge rider shot|2", "arsenal")
      .expectDeckTop(0, BLUE)
      .expectDeckBottom(0, RED);
  });
});

describe("ARC Ranger — arrows", () => {
  it("Salvage Shot goes to the bottom of its owner's deck after it hits", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          hand: [BLUE, RED, "raging onslaught|2", "pack hunt|1"],
          arsenal: ["salvage shot|1"],
          deck: ["scar for a scar|1"],
          resources: 1,
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("salvage shot|1", { fromArsenal: true })
      .blockWith()
      .settle()
      .endTurn()
      .expectInZone(0, "salvage shot|1", "deck")
      .expectDeckBottom(0, "salvage shot|1");
  });

  it("Searing Shot makes the hit hero lose 1 life in addition to combat damage", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: ["searing shot|2"] }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("searing shot|2", { fromArsenal: true })
      .blockWith()
      .settle()
      .expectLife(1, 16)
      .expectLog("loses 1 life");
  });

  it("Searing Shot does not make a hero lose life when it hits an ally", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: ["searing shot|1"] }),
        { hero: "rhinar", hand: [], board: ["barnacle|2"] },
      ],
    });

    s.play("searing shot|1", {
      fromArsenal: true,
      targetAlly: "barnacle|2",
    }).expectLife(1, 20);
  });

  it("Sic 'Em Shot has go again when played from the arsenal", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: ["sic 'em shot|2"], resources: 1 }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("sic 'em shot|2", { fromArsenal: true })
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Hamstring Shot taxes the hit hero's first attack during their next turn", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: ["hamstring shot|1"], resources: 1 }),
        { hero: "rhinar", hand: ["nimblism|1", "scar for a scar|1"] },
      ],
    });

    s.play("hamstring shot|1", { fromArsenal: true })
      .blockWith()
      .settle()
      .endTurn()
      .play("nimblism|1")
      .expectNoLegalPlay("scar for a scar|1");
  });
});
