import { describe, expect, it } from "vitest";
import { applyIntent, createGame, legalIntents } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";
import { cardData, scripts } from "../../index.js";

const dash = {
  hero: "rhinar" as const,
  heroKey: "dash|0",
  weapons: [] as string[],
};

function boardCard(g: Scenario, key: string) {
  const card = g.state.players[0]!.board.find((c) => c.cardId === printingId(key));
  expect(card, `no ${key} on Dash's board`).toBeTruthy();
  return card!;
}

describe("SDA — Boost", () => {
  it("offers Boost as an optional cost and grants go again for a Mechanologist top card", () => {
    const g = scenario({
      seats: [
        { ...dash, hand: ["zero to sixty|1"], deck: ["zipper hit|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    const plays = legalIntents(g.state, 0).filter(
      (i) => i.kind === "play-card" && i.instanceId === g.state.players[0]!.hand[0]!.instanceId,
    );
    expect(plays.some((i) => i.kind === "play-card" && i.boost === true)).toBe(true);
    expect(plays.some((i) => i.kind === "play-card" && i.boost !== true)).toBe(true);

    g.play("zero to sixty|1", { boost: true })
      .expectInZone(0, "zipper hit|3", "banish")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("a non-Mechanologist banish pays Boost but does not grant go again", () => {
    const g = scenario({
      seats: [
        { ...dash, hand: ["zero to sixty|1"], deck: ["raging onslaught|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("zero to sixty|1", { boost: true }).blockWith().settle().expectAP(0, 0);
  });

  it("Hyper Driver pays once per turn when a card is boosted", () => {
    const g = scenario({
      seats: [
        { ...dash, board: ["hyper driver|1"], hand: ["zero to sixty|1"], deck: ["zipper hit|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    boardCard(g, "hyper driver|1").counters = { steam: 3 };

    g.play("zero to sixty|1", { boost: true })
      .expectResources(0, 1)
      .expectLog("remove a steam counter (3 → 2)")
      .blockWith()
      .settle();
    expect(boardCard(g, "hyper driver|1").counters?.steam).toBe(2);
  });

  it("Crankshaft banished for Boost adds a Hyper Driver steam counter", () => {
    const g = scenario({
      seats: [
        { ...dash, board: ["hyper driver|1"], hand: ["zero to sixty|1"], deck: ["crankshaft|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    boardCard(g, "hyper driver|1").counters = { steam: 1 };

    g.play("zero to sixty|1", { boost: true }).blockWith().settle();
    // +1 from Crankshaft, then -1 from Hyper Driver's own boost trigger.
    expect(boardCard(g, "hyper driver|1").counters?.steam).toBe(1);
    g.expectLog("Hyper Driver gains a steam counter (1 → 2)");
    g.expectLog("remove a steam counter (2 → 1)");
  });
});

describe("SDA — Dash attack and item effects", () => {
  it("Dash starts with an eligible Mechanologist item before opening hands", () => {
    let s = createGame({
      decklists: [
        {
          heroId: "SDA001",
          weaponIds: [],
          equipment: {},
          deck: ["SDA024", ...Array(39).fill("RNR020")],
        },
        {
          heroId: "RNR002",
          weaponIds: [],
          equipment: {},
          deck: Array(40).fill("RNR020"),
        },
      ],
      seed: 91,
      cards: cardData,
      scripts,
    });
    expect(s.pendingDecision?.player).toBe(0);
    expect(s.players[0]!.hand).toHaveLength(0);
    const hyper = s.players[0]!.deck.find((c) => c.cardId === "SDA024")!;
    const choice = applyIntent(s, 0, { kind: "choose", optionId: String(hyper.instanceId) });
    expect(choice.ok).toBe(true);
    if (!choice.ok) return;
    s = choice.state;
    expect(s.players[0]!.board.some((c) => c.cardId === "SDA024")).toBe(true);
    expect(s.players[0]!.deck.some((c) => c.cardId === "SDA024")).toBe(false);
    expect(s.players[0]!.hand).toHaveLength(4);
    expect(s.phase).toBe("action");
  });

  it("Crank may remove Boom Grenade's steam counter to regain an action point", () => {
    const yes = scenario({
      seats: [
        { ...dash, hand: ["boom grenade|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    yes.play("boom grenade|1").chooseOption("yes").expectAP(0, 1);
    expect(boardCard(yes, "boom grenade|1").counters?.steam).toBeUndefined();

    const no = scenario({
      seats: [
        { ...dash, hand: ["boom grenade|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    no.play("boom grenade|1").chooseOption("no").expectAP(0, 0);
    expect(boardCard(no, "boom grenade|1").counters?.steam).toBe(1);
  });

  it("Re-Charge adds steam and gives the next boosted attack +4", () => {
    const g = scenario({
      seats: [
        {
          ...dash,
          board: ["hyper driver|1"],
          hand: ["re-charge!|1", "zero to sixty|1", "zipper hit|3"],
          deck: ["throttle|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    boardCard(g, "hyper driver|1").counters = { steam: 1 };

    g.play("re-charge!|1", { pitch: ["zipper hit|3"] })
      .play("zero to sixty|1", { boost: true })
      .expectAttackValue(8)
      .blockWith()
      .settle();
  });

  it("Jump Start and Rev Up each cost one less while Hyper Driver is controlled", () => {
    const jump = scenario({
      seats: [
        { ...dash, board: ["hyper driver|1"], hand: ["jump start|1", "re-charge!|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    boardCard(jump, "hyper driver|1").counters = { steam: 3 };
    jump.play("jump start|1", { pitch: ["re-charge!|1"] }).expectResources(0, 0);

    const rev = scenario({
      seats: [
        { ...dash, board: ["hyper driver|1"], hand: ["rev up|1", "zipper hit|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    boardCard(rev, "hyper driver|1").counters = { steam: 3 };
    rev.play("rev up|1", { pitch: ["zipper hit|3"] }).expectResources(0, 1);
  });

  it("Overblast counts earlier boosts on the open combat chain", () => {
    const g = scenario({
      seats: [
        {
          ...dash,
          hand: ["zero to sixty|1", "overblast|1", "zipper hit|3"],
          deck: ["throttle|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("zero to sixty|1", { boost: true })
      .blockWith()
      .settle()
      .play("overblast|1", { pitch: ["zipper hit|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle();
  });

  it("Teklo Trebuchet gives the next boosted attack on the chain +2", () => {
    const g = scenario({
      seats: [
        {
          ...dash,
          hand: ["teklo trebuchet 2000|3", "zero to sixty|1"],
          deck: ["throttle|3", "zipper hit|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("teklo trebuchet 2000|3", { boost: true })
      .blockWith()
      .settle()
      .play("zero to sixty|1", { boost: true })
      .expectAttackValue(6)
      .blockWith()
      .settle();
  });

  it("Achilles Accelerator converts a prior boost into an action point", () => {
    const g = scenario({
      seats: [
        {
          ...dash,
          equipment: { legs: "achilles accelerator|0" },
          hand: ["zero to sixty|1"],
          deck: ["zipper hit|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("zero to sixty|1", { boost: true })
      .blockWith()
      .settle()
      .activate("achilles accelerator|0")
      .expectAP(0, 2)
      .expectNoEquipment(0, "legs");
  });

  it("Talishar adds its third rust counter on attack and breaks in the end phase", () => {
    const g = scenario({
      seats: [
        { ...dash, weapons: ["talishar, the lost prince|0"], hand: [], resources: 2 },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { rust: 2 };
    g.attackWithWeapon("talishar, the lost prince|0")
      .blockWith()
      .settle()
      .endTurn()
      .expectInZone(0, "talishar, the lost prince|0", "graveyard");
  });

  it("Fender Bender gets +1 for each defending equipment", () => {
    const g = scenario({
      seats: [
        { ...dash, hand: ["fender bender|1", "zipper hit|3"] },
        { hero: "dorinthea", hand: [], equipment: { head: "ironrot helm|0" } },
      ],
    });
    g.play("fender bender|1", { pitch: ["zipper hit|3"] })
      .blockWith("ironrot helm|0")
      .expectAttackValue(5)
      .settle();
  });

  it("Out Pace cannot be defended by equipment", () => {
    const g = scenario({
      seats: [
        { ...dash, hand: ["out pace|1", "zipper hit|3"] },
        { hero: "dorinthea", hand: [], equipment: { head: "ironrot helm|0" } },
      ],
    });
    g.play("out pace|1", { pitch: ["zipper hit|3"] });
    const defends = legalIntents(g.state, 1).filter((i) => i.kind === "defend");
    expect(defends.every((i) => i.kind !== "defend" || i.instanceIds.length === 0)).toBe(true);
    g.blockWith().settle();
  });

  it("Under Loop goes to the bottom of its owner's deck after hitting", () => {
    const g = scenario({
      seats: [
        { ...dash, hand: ["under loop|1", "re-charge!|1", "zipper hit|3"], deck: ["throttle|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("under loop|1", { pitch: ["zipper hit|3"], boost: true })
      .blockWith()
      .settle()
      .play("re-charge!|1")
      .expectDeckBottom(0, "under loop|1");
  });

  it("Boom Grenade destroys itself and deals 4 after a Mechanologist attack hits", () => {
    const g = scenario({
      seats: [
        { ...dash, board: ["boom grenade|1"], hand: ["zero to sixty|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    boardCard(g, "boom grenade|1").counters = { steam: 1 };
    g.play("zero to sixty|1")
      .blockWith()
      .settle()
      .expectLife(1, 12)
      .expectInZone(0, "boom grenade|1", "graveyard");
  });

  it("Plasma Barrel Shot loads, spends steam, and scales with prior boosts", () => {
    const g = scenario({
      seats: [
        {
          ...dash,
          weapons: ["plasma barrel shot|0"],
          hand: ["zero to sixty|1", "zipper hit|3"],
          deck: ["throttle|3"],
          resources: 2,
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("plasma barrel shot|0", { ability: 1 })
      .play("zero to sixty|1", { boost: true })
      .blockWith()
      .settle()
      .activate("plasma barrel shot|0", { ability: 0 })
      .expectAttackValue(2)
      .blockWith()
      .settle();
  });
});
