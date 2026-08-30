import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const BLUE = "wrecker romp|3";

describe("ARC — generic equipment and actions", () => {
  it("Vest of the First Fist may destroy itself after an attack action hits", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["ravenous rabble|1"],
          equipment: { chest: "vest of the first fist|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("ravenous rabble|1")
      .blockWith()
      .settle()
      .chooseOption("yes")
      .expectResources(0, 2)
      .expectNoEquipment(0, "chest");
  });

  it("Vest of the First Fist does not trigger from a weapon hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["edge of autumn|0"],
          resources: 1,
          equipment: { chest: "vest of the first fist|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.attackWithWeapon("edge of autumn|0").blockWith().settle();
    expect(g.state.pendingDecision).toBeNull();
    g.expectEquipped(0, "chest", "vest of the first fist|0");
  });

  it("Bracers of Belief buffs the next attack by 3 minus the revealed pitch", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["scar for a scar|1"],
          deck: ["ravenous rabble|1"],
          equipment: { arms: "bracers of belief|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.activate("bracers of belief|0")
      .play("scar for a scar|1")
      .expectAttackValue(6);
  });

  it("Life for a Life gains go again while behind and gains life on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", life: 15, hand: ["life for a life|1", BLUE] },
        { hero: "dorinthea", life: 20, hand: [] },
      ],
    });

    g.play("life for a life|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .expectLife(0, 16)
      .expectAP(0, 1);
  });

  it("Plunder Run played from arsenal buffs the next attack and draws on hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["scar for a scar|1"],
          arsenal: ["plunder run|1"],
          deck: [BLUE],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("plunder run|1", { fromArsenal: true })
      .play("scar for a scar|1")
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectHandSize(0, 1);
  });

  it("Plunder Run does not draw from a weapon hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["edge of autumn|0"],
          resources: 1,
          hand: ["plunder run|3"],
          deck: [BLUE],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("plunder run|3")
      .attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .expectHandSize(0, 0);
  });

  it("Cadaverous Contraband puts a non-attack action from graveyard on top", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["cadaverous contraband|1", BLUE],
          graveyard: ["come to fight|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("cadaverous contraband|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .chooseCard("come to fight|1")
      .expectDeckTop(0, "come to fight|1");
  });

  it("Moon Wish searches for Sun Kiss after hitting", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["moon wish|1", BLUE],
          deck: ["sun kiss|1", "ravenous rabble|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("moon wish|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .chooseCard("sun kiss|1")
      .expectInZone(0, "sun kiss|1", "hand");
  });

  it("Push the Point gains +2 after the previous chain link hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["ravenous rabble|1", "push the point|1", BLUE],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("ravenous rabble|1")
      .blockWith()
      .settle()
      .play("push the point|1", { pitch: [BLUE] })
      .expectAttackValue(6);
  });

  it("Rifting's one-shot instant permission is consumed by the next non-attack action", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["rifting|1", BLUE, "come to fight|1", "sun kiss|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("rifting|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .expectAP(0, 0)
      .play("come to fight|1")
      .expectAP(0, 1);
    expect(g.state.players[0]!.flags.nextNonAttackAsInstant).toBe(false);
    const sunKiss = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("sun kiss|3"),
    )!;
    const plays = legalIntents(g.state, 0).filter(
      (intent) => intent.kind === "play-card" && intent.instanceId === sunKiss.instanceId,
    );
    expect(plays.some((intent) => intent.kind === "play-card" && intent.asInstant === true)).toBe(false);
  });

  it("Lead the Charge grants an action point when the qualifying action is played", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["lead the charge|1", "scar for a scar|1"] },
        { hero: "dorinthea", hand: ["sigil of solace|1"] },
      ],
    });

    g.play("lead the charge|1").play("scar for a scar|1", { settle: false });
    g.expectAP(0, 0);
    expect(g.state.stack[0]?.engineEffect).toEqual({ kind: "gain-action-points", amount: 1 });
    g.passPriority().passPriority().expectAP(0, 1).settle();
  });
});

describe("ARC — rules regression coverage", () => {
  it("Enchanting Melody destroys itself when it prevents damage", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["enchanting melody|1", BLUE, "zap|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("enchanting melody|1", { pitch: [BLUE] })
      .play("zap|1")
      .chooseOption("your hero")
      .expectLife(0, 20)
      .expectInZone(0, "enchanting melody|1", "graveyard");
  });

  it("Eirina's Prayer does not prevent physical damage", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["eirina's prayer|1"], deck: [BLUE], resources: 1 },
        { hero: "dorinthea", hand: ["raging onslaught|2", BLUE] },
      ],
    });

    g.play("raging onslaught|2", { pitch: [BLUE], settle: false })
      .passPriority()
      .react("eirina's prayer|1")
      .blockWith()
      .settle()
      .expectLife(0, 14);
    expect(g.state.players[0]!.flags.preventNextArcaneDamage).toBe(3);
  });

  it("Eirina's Prayer prevents arcane damage and retains unused prevention", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["eirina's prayer|1", BLUE, "zap|1"],
          deck: ["wrecker romp|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("eirina's prayer|1", { pitch: [BLUE] })
      .play("zap|1")
      .chooseOption("your hero")
      .expectLife(0, 20);
    expect(g.state.players[0]!.flags.preventNextArcaneDamage).toBe(2);
  });

  it("Moon Wish may put a hand card on top instead of paying resources", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["moon wish|1", "scar for a scar|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("moon wish|1", { alternativeCost: "scar for a scar|1" })
      .expectDeckTop(0, "scar for a scar|1")
      .expectAttackValue(5);
    expect(projectStateFor(g.state, 1).log.join(" ")).not.toContain("Scar for a Scar");
  });

  it("Moon Wish's alternative cost still pays resource-cost increases", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["moon wish|1", "scar for a scar|1", BLUE],
          board: ["frostbite|0"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("moon wish|1", {
      alternativeCost: "scar for a scar|1",
      pitch: [BLUE],
    })
      .expectDeckTop(0, "scar for a scar|1")
      .expectResources(0, 2)
      .expectZoneSize(0, "board", 0);
  });

  it("rejects an invalid Moon Wish alternative-cost card", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["moon wish|1", "scar for a scar|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const moonWish = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("moon wish|1"),
    )!;

    const result = applyIntent(g.state, 0, {
      kind: "play-card",
      instanceId: moonWish.instanceId,
      pitchInstanceIds: [],
      alternativeCostCardInstanceIds: [999_999],
    });
    expect(result.ok).toBe(false);
    expect(g.state.players[0]!.hand).toHaveLength(2);
  });
});
