import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const BLUE = "raging onslaught|3";

describe("ARC — Runeblade commons and rares", () => {
  it("Oath of the Arknight buffs only the next Runeblade attack and creates a Runechant", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["oath of the arknight|1", "spellblade strike|1", BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("oath of the arknight|1", { pitch: [BLUE] })
      .expectZoneSize(0, "board", 1)
      .play("spellblade strike|1")
      .expectAttackValue(7)
      .expectLife(1, 19) // the pre-existing Runechant fired
      .expectZoneSize(0, "board", 1) // Spellblade Strike made a new one
      .blockWith()
      .settle()
      .expectFinalAttack(7);
  });

  it("Runechants discount Drawn to the Dark Dimension and it draws when attacking", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["runechant|0", "runechant|0"],
          hand: ["drawn to the dark dimension|2"],
          deck: ["zap|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("drawn to the dark dimension|2")
      .expectResources(0, 0)
      .expectHandSize(0, 1)
      .expectZoneSize(0, "board", 0)
      .blockWith()
      .settle();
  });

  it("Reduce to Runechant is discounted in the reaction window and creates a token", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["wounded bull|1", BLUE] },
        {
          hero: "dorinthea",
          board: ["runechant|0"],
          hand: ["reduce to runechant|2"],
        },
      ],
    });

    s.play("wounded bull|1", { pitch: [BLUE] }).blockWith().passPriority();
    s.react("reduce to runechant|2")
      .expectFinalDefense(3)
      .expectZoneSize(1, "board", 2);
  });

  it("Bloodspill Invocation destroys itself and creates Runechants when an attack action hits", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["bloodspill invocation|1", "spellblade strike|1", BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("bloodspill invocation|1", { pitch: [BLUE] })
      .expectInZone(0, "bloodspill invocation|1", "board")
      .play("spellblade strike|1")
      .blockWith()
      .settle()
      .expectInZone(0, "bloodspill invocation|1", "graveyard")
      .expectZoneSize(0, "board", 4); // Spellblade's one plus Bloodspill's three
  });

  it("Bloodspill Invocation also triggers when an attack action hits an ally", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["bloodspill invocation|3", "spellblade strike|1", BLUE],
        },
        { hero: "dorinthea", board: ["barnacle|2"] },
      ],
    });

    s.play("bloodspill invocation|3", { pitch: [BLUE] })
      .play("spellblade strike|1", { targetAlly: "barnacle|2" })
      .expectInZone(0, "bloodspill invocation|3", "graveyard")
      .expectZoneSize(0, "board", 2); // one from Spellblade, one from Bloodspill
  });

  it("Bloodspill Invocation destroys itself when its controller is dealt damage", () => {
    const effectDamage = scenario({
      seats: [
        { hero: "rhinar", hand: ["bloodspill invocation|3", BLUE] },
        { hero: "dorinthea", hand: ["zap|3"] },
      ],
    });

    effectDamage.play("bloodspill invocation|3", { pitch: [BLUE] }).endTurn();
    effectDamage.play("zap|3").chooseOption("opposing hero");
    effectDamage.expectInZone(0, "bloodspill invocation|3", "graveyard");

    const attackDamage = scenario({
      seats: [
        { hero: "rhinar", hand: ["bloodspill invocation|3", BLUE] },
        { hero: "dorinthea", hand: ["wounded bull|1", BLUE] },
      ],
    });

    attackDamage.play("bloodspill invocation|3", { pitch: [BLUE] }).endTurn();
    attackDamage
      .play("wounded bull|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .expectInZone(0, "bloodspill invocation|3", "graveyard");
  });
});

describe("ARC — Wizard commons and rares", () => {
  it("Robe of Rapture is destroyed as a cost and gains 3 resources", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          equipment: { chest: "robe of rapture|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    s.activate("robe of rapture|0")
      .expectResources(0, 3)
      .expectNoEquipment(0, "chest")
      .expectInZone(0, "robe of rapture|0", "graveyard");
  });

  it("Storm Striders costs 1 resource to activate and is destroyed as a cost", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          equipment: { legs: "storm striders|0" },
          hand: ["raging onslaught|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.activate("storm striders|0", { pitch: ["raging onslaught|1"] })
      .expectResources(0, 0)
      .expectNoEquipment(0, "legs")
      .expectInZone(0, "storm striders|0", "graveyard");
    expect(s.state.players[0]!.flags.nextWizardNonAttackAsInstant).toBe(true);
  });

  it("Stir the Aetherwinds makes the next Wizard action instant-speed and amplifies it", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["lead the charge|1", "stir the aetherwinds|1", "zap|1", BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("lead the charge|1").play("stir the aetherwinds|1", { pitch: [BLUE] });
    const zap = s.state.players[0]!.hand.find((card) => card.cardId === printingId("zap|1"))!;
    const methods = legalIntents(s.state, 0).filter(
      (intent) => intent.kind === "play-card" && intent.instanceId === zap.instanceId,
    );
    expect(methods.some((intent) => intent.kind === "play-card" && intent.asInstant !== true)).toBe(true);
    expect(methods.some((intent) => intent.kind === "play-card" && intent.asInstant === true)).toBe(true);
    s.play("zap|1", { asInstant: true })
      .chooseOption("opposing hero")
      .expectLife(1, 14)
      .expectAP(0, 1);
    expect(s.state.players[0]!.flags.nextWizardNonAttackAsInstant).toBe(false);
  });

  it("Stir's damage bonus is consumed when the next Wizard action has no arcane effect", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["stir the aetherwinds|1", "index|3", BLUE],
          deck: ["zap|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("stir the aetherwinds|1", { pitch: [BLUE] });
    s.play("index|3").chooseCard("zap|1");
    expect(s.state.players[0]!.flags.nextWizardNonAttackArcaneBonus).toBe(0);
  });

  it("Aether Flare amplifies the next arcane-damage card by damage actually dealt", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["aether flare|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });

    s.play("aether flare|3", { pitch: [BLUE] }).expectLife(1, 19);
    expect(s.state.players[0]!.flags.nextArcaneCardBonus).toBe(1);
  });

  it("Aether Spindle opts for the amount of arcane damage dealt", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["aether spindle|2", BLUE],
          deck: ["zap|1", "scalding rain|2", "voltic bolt|2"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("aether spindle|2", { pitch: [BLUE] })
      .expectLife(1, 17)
      .chooseOption("top")
      .chooseOption("bottom")
      .chooseOption("top")
      .expectDeckTop(0, "voltic bolt|2")
      .expectDeckBottom(0, "scalding rain|2");
  });

  it("Index chooses one looked-at card for the top and orders the rest on the bottom", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["index|3"],
          deck: ["zap|1", "scalding rain|2", "voltic bolt|2"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("index|3")
      .chooseCard("scalding rain|2")
      .chooseCard("voltic bolt|2")
      .chooseCard("zap|1")
      .expectDeckTop(0, "scalding rain|2")
      .expectDeckBottom(0, "zap|1");
  });

  it("Reverberate banishes an eligible Wizard action and permits it as an instant", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["reverberate|3", "zap|3", "voltic bolt|2", BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("reverberate|3", { pitch: [BLUE] })
      .expectLife(1, 19)
      .chooseCard("zap|3")
      .expectInZone(0, "zap|3", "banish");
    const zap = s.state.players[0]!.banish.find((card) => card.cardId === printingId("zap|3"))!;
    const play = legalIntents(s.state, 0).find(
      (intent) =>
        intent.kind === "play-from-zone" &&
        intent.zone === "banish" &&
        intent.instanceId === zap.instanceId,
    );
    expect(play).toBeTruthy();
    expect(play?.kind === "play-from-zone" && play.asInstant).toBe(true);
    s.doRaw(play!)
      .settle()
      .chooseOption("opposing hero")
      .expectLife(1, 18)
      .expectInZone(0, "zap|3", "graveyard");
  });

  it("target-hero arcane spells may target their controller", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["scalding rain|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });

    s.play("scalding rain|3", { pitch: [BLUE] })
      .chooseOption("your hero")
      .expectLife(0, 18);
  });
});

describe("ARC — functional key coverage", () => {
  it("keeps the assigned ARC pitch variants registered without duplicating reprints", () => {
    expect(printingId("spellblade assault|2")).toBe("ARC086");
    expect(printingId("absorb in aether|2")).toBe("ARC124");
    expect(printingId("voltic bolt|2")).toBe("ARC148");
  });
});
