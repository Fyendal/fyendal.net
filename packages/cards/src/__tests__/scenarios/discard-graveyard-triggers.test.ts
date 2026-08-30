import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const QUIET_BRUTE = {
  hero: "rhinar" as const,
  heroKey: "bravo, showstopper|0",
  weapons: [] as string[],
  equipment: NO_EQUIPMENT,
};

function discardWithWrecker(card: string, life = 20) {
  const g = scenario({
    seats: [
      { ...QUIET_BRUTE, life, hand: ["wrecker romp|3", card], resources: 2 },
      { hero: "dorinthea", hand: [], equipment: NO_EQUIPMENT },
    ],
  });
  g.play("wrecker romp|3", { settle: false });
  return g;
}

describe("discard trigger timing audit", () => {
  it("Skull Crack waits on the stack before granting a resource", () => {
    const g = discardWithWrecker("skull crack|1").expectResources(0, 0);
    expect(g.state.stack[0]?.label).toBe("Gain 1 resource");
    g.passPriority().passPriority().expectResources(0, 1);
  });

  it("Reincarnate enters the graveyard before its trigger returns it to the deck", () => {
    const g = discardWithWrecker("reincarnate|1")
      .expectInZone(0, "reincarnate|1", "graveyard");
    expect(g.state.stack[0]?.label).toBe("Put this on the bottom of its owner's deck");
    g.passPriority()
      .passPriority()
      .expectNotInZone(0, "reincarnate|1", "graveyard")
      .expectDeckBottom(0, "reincarnate|1");
  });

  it("Fool's Gold waits on the stack before creating Gold", () => {
    const g = discardWithWrecker("fool's gold|2").expectZoneSize(0, "board", 0);
    expect(g.state.stack[0]?.label).toBe("Create a Gold token");
    g.passPriority().passPriority().expectInZone(0, "gold|0", "board");
  });

  it("Sea Legs waits on the stack before creating Goldkiss Rum", () => {
    const g = discardWithWrecker("sea legs|2").expectZoneSize(0, "board", 0);
    expect(g.state.stack[0]?.label).toBe("Create a Goldkiss Rum token");
    g.passPriority().passPriority().expectInZone(0, "goldkiss rum|0", "board");
  });

  it("a defending instant ability exposes a discard trigger before priority resumes", () => {
    const g = scenario({
      seats: [
        { ...QUIET_BRUTE, hand: ["head jab|1"] },
        {
          ...QUIET_BRUTE,
          hand: ["rally the rearguard|3", "fool's gold|2"],
        },
      ],
    });

    g.play("head jab|1")
      .blockWith("rally the rearguard|3")
      .passPriority()
      .activate("rally the rearguard|3", { pitch: ["fool's gold|2"], settle: false })
      .expectInZone(1, "fool's gold|2", "graveyard")
      .expectNotInZone(1, "gold|0", "board");
    expect(g.state.stack[0]?.label).toBe("Create a Gold token");

    g.passPriority().passPriority().expectInZone(1, "gold|0", "board");
  });

  it("Berserk discards a qualifying card before its delayed trigger banishes it", () => {
    const g = scenario({
      seats: [
        {
          ...QUIET_BRUTE,
          resources: 3,
          hand: ["berserk|2", "wrecker romp|3", "raging onslaught|1"],
          deck: ["raging onslaught|1"],
        },
        { hero: "dorinthea", hand: [], equipment: NO_EQUIPMENT },
      ],
    });
    g.play("berserk|2")
      .play("wrecker romp|3", { settle: false })
      .expectInZone(0, "raging onslaught|1", "graveyard")
      .expectNotInZone(0, "raging onslaught|1", "banish");
    expect(g.state.stack[0]?.label).toBe("Banish the discarded card");

    g.passPriority()
      .passPriority()
      .expectNotInZone(0, "raging onslaught|1", "graveyard")
      .expectInZone(0, "raging onslaught|1", "banish")
      .expectInZone(0, "raging onslaught|1", "hand");
  });

  it("Mark of the Beast replaces the graveyard event instead of triggering", () => {
    discardWithWrecker("mark of the beast|2")
      .expectNotInZone(0, "mark of the beast|2", "graveyard")
      .expectInZone(0, "mark of the beast|2", "banish")
      .expectNoLog("Mark of the Beast triggers");
  });

  it("a discard replaced with banish still triggers discard observers", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["wrecker romp|3", "mark of the beast|2"],
          resources: 2,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: ["head jab|1"], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("wrecker romp|3", { settle: false })
      .expectInZone(0, "mark of the beast|2", "banish")
      .expectNotInZone(0, "mark of the beast|2", "graveyard");
    expect(g.state.stack[0]?.label).toBe("Intimidate");
  });

  it("random-only self triggers do not fire for a chosen discard", () => {
    const g = scenario({
      seats: [
        { ...QUIET_BRUTE, hand: ["head jab|1"] },
        {
          ...QUIET_BRUTE,
          hand: ["rally the rearguard|3", "reincarnate|1"],
        },
      ],
    });

    g.play("head jab|1")
      .blockWith("rally the rearguard|3")
      .passPriority()
      .activate("rally the rearguard|3", { pitch: ["reincarnate|1"], settle: false })
      .expectInZone(1, "reincarnate|1", "graveyard");
    expect(g.state.pendingTriggeredLayers ?? []).toEqual([]);
    expect(g.state.stack).toEqual([]);
  });
});

describe("graveyard-entry trigger timing audit", () => {
  it("Sirens of Safe Harbor waits on the stack before gaining life", () => {
    const g = discardWithWrecker("sirens of safe harbor|1", 10).expectLife(0, 10);
    expect(g.state.stack[0]?.label).toBe("Gain 1 life");
    g.passPriority().passPriority().expectLife(0, 11);
  });

  it("Fiddler's Green waits on the stack before gaining life", () => {
    const g = discardWithWrecker("fiddler's green|1", 10).expectLife(0, 10);
    expect(g.state.stack[0]?.label).toBe("Gain 3 life");
    g.passPriority().passPriority().expectLife(0, 13);
  });

  it("Echoflash waits on the stack before its hero deals arcane damage", () => {
    const g = discardWithWrecker("echoflash|2").expectLife(1, 20);
    expect(g.state.stack[0]?.label).toBe("Your hero deals 1 arcane damage");
    g.passPriority().passPriority().expectLife(1, 19);
  });

  it.each([
    ["nasty surprise|3", ["agility|0", "might|0", "vigor|0"]],
    ["kick the hornet's nest|2", ["confidence|0", "might|0", "toughness|0", "vigor|0"]],
  ])("%s triggers after an opponent's effect mills it", (card, tokens) => {
    const g = scenario({
      active: 1,
      seats: [
        { ...QUIET_BRUTE, hand: [], deck: [card] },
        {
          ...QUIET_BRUTE,
          hand: ["grind them down|3", "raging onslaught|3"],
        },
      ],
    });
    g.play("grind them down|3", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .expectInZone(0, card, "graveyard");
    for (const token of tokens) g.expectInZone(0, token, "board");
  });

  it("Ripple Away prevents Nasty Surprise from creating any tokens", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...QUIET_BRUTE, hand: ["ripple away|3"], deck: ["nasty surprise|3"] },
        {
          ...QUIET_BRUTE,
          hand: ["grind them down|3", "raging onslaught|3"],
        },
      ],
    });

    g.passPriority()
      .activate("ripple away|3")
      .play("grind them down|3", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .expectInZone(0, "nasty surprise|3", "graveyard")
      .expectZoneSize(0, "board", 0);
  });

  it("Beneath the Surface turns face down only after its trigger resolves", () => {
    const g = scenario({
      seats: [
        { ...QUIET_BRUTE, hand: ["head jab|1"] },
        {
          hero: "dorinthea",
          hand: ["beneath the surface|2", "raging onslaught|3"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });
    g.play("head jab|1")
      .blockWith()
      .passPriority()
      .react("beneath the surface|2", { pitch: ["raging onslaught|3"] })
      .settle()
      .doRaw({ kind: "close-chain" });

    const beneath = g.state.players[1]!.graveyard.find(
      (card) => card.cardId === printingId("beneath the surface|2"),
    );
    expect(beneath?.faceDown).not.toBe(true);
    expect(g.state.stack).toHaveLength(1);
    expect(g.state.stack[0]?.engineEffect).toEqual({ kind: "watery-grave" });

    g.passPriority().passPriority();
    expect(g.state.players[1]!.graveyard.find(
      (card) => card.cardId === printingId("beneath the surface|2"),
    )?.faceDown).toBe(true);
  });
});
