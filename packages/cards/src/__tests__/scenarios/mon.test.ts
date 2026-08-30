import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { scenario } from "../harness.js";

const BLUE = "raging onslaught|3";
const SIX = "raging onslaught|2";
const SEVEN = "raging onslaught|1";

function prismSeat(extra: Record<string, unknown> = {}) {
  return { hero: "rhinar" as const, heroKey: "prism|0", ...extra };
}

function leviaSeat(extra: Record<string, unknown> = {}) {
  return { hero: "rhinar" as const, heroKey: "levia|0", ...extra };
}

function chaneSeat(extra: Record<string, unknown> = {}) {
  return { hero: "rhinar" as const, heroKey: "chane|0", ...extra };
}

describe("MON — Light Illusionist", () => {
  it("Prism banishes a soul card to create a Spectral Shield", () => {
    const s = scenario({
      seats: [
        prismSeat({ resources: 2, soul: [SIX] }),
        { hero: "dorinthea" },
      ],
    });

    s.activate("prism|0")
      .chooseCard(SIX)
      .expectZoneSize(0, "soul", 0)
      .expectInZone(0, SIX, "banish")
      .expectInZone(0, "spectral shield|0", "board");
  });

  it("Merciful Retribution converts a Light attack destroyed by phantasm into soul and damage", () => {
    const s = scenario({
      seats: [
        prismSeat({ board: ["merciful retribution|2"], hand: ["wartune herald|1", BLUE] }),
        { hero: "dorinthea", life: 20, hand: [SEVEN] },
      ],
    });

    s.play("wartune herald|1", { pitch: [BLUE] })
      .blockWith(SEVEN)
      .settle()
      .expectInZone(0, "wartune herald|1", "soul")
      .expectLife(1, 19);
  });

  it("Parable of Humility lowers defending attack power without lowering defense", () => {
    const s = scenario({
      seats: [
        prismSeat({ board: ["parable of humility|2"], hand: ["wartune herald|1", BLUE] }),
        { hero: "dorinthea", hand: [SIX] },
      ],
    });

    s.play("wartune herald|1", { pitch: [BLUE] })
      .blockWith(SIX)
      .settle()
      .expectFinalAttack(7)
      .expectFinalDefense(3);
  });

  it("Ode to Wrath gives Illusionist attacks go again and causes extra life loss", () => {
    const s = scenario({
      seats: [
        prismSeat({ board: ["ode to wrath|2"], hand: ["spears of surreality|1", BLUE] }),
        { hero: "dorinthea", life: 20 },
      ],
    });

    s.play("spears of surreality|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .expectLife(1, 14)
      .expectAP(0, 1);
  });

  it("Iris of Reality grants Illusionist aura attacks go again", () => {
    const s = scenario({
      seats: [
        prismSeat({ weapons: ["iris of reality|0"], board: ["parable of humility|2"], hand: [BLUE] }),
        { hero: "dorinthea" },
      ],
    });

    s.activate("parable of humility|2", { pitch: [BLUE] })
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Dream Weavers makes the next Illusionist attack lose phantasm", () => {
    const s = scenario({
      seats: [
        prismSeat({ equipment: { arms: "dream weavers|0" }, hand: ["enigma chimera|1", BLUE] }),
        { hero: "dorinthea", hand: [SEVEN] },
      ],
    });

    s.activate("dream weavers|0")
      .play("enigma chimera|1", { pitch: [BLUE] })
      .blockWith(SEVEN)
      .settle()
      .expectFinalAttack(8);
  });

  it("Dream Weavers suppresses phantasm granted by Phantasmify", () => {
    const s = scenario({
      seats: [
        prismSeat({
          equipment: { arms: "dream weavers|0" },
          hand: ["phantasmify|1", "invigorating light|1", BLUE, BLUE],
        }),
        { hero: "dorinthea", hand: [SEVEN] },
      ],
    });

    s.activate("dream weavers|0")
      .play("phantasmify|1", { pitch: [BLUE] })
      .play("invigorating light|1", { pitch: [BLUE] })
      .blockWith(SEVEN)
      .settle()
      .expectFinalAttack(11);
  });
});

describe("MON — Light and Charge", () => {
  it("Charge moves the chosen card from hand into the hero's soul", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["cross the line|1", BLUE, SIX] },
        { hero: "dorinthea" },
      ],
    });

    s.play("cross the line|1", { pitch: [BLUE] })
      .chooseCard(SIX)
      .expectInZone(0, SIX, "soul")
      .blockWith()
      .settle();
  });

  it("Herald of Judgment locks the hit hero out of playing from banish next turn", () => {
    const s = scenario({
      seats: [
        prismSeat({ hand: ["herald of judgment|2", BLUE] }),
        chaneSeat({ banish: ["ghostly visit|1"], hand: [BLUE] }),
      ],
    });

    s.play("herald of judgment|2", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .endTurn()
      .expectNoLegalPlay("ghostly visit|1");
  });
});

describe("MON — Shadow Brute and Blood Debt", () => {
  it("Endless Maw publicly logs each random card banished from graveyard", () => {
    const s = scenario({
      seats: [
        leviaSeat({
          resources: 3,
          hand: ["endless maw|1"],
          graveyard: ["ghostly visit|1", "void wraith|1", "snatch|1"],
        }),
        { hero: "dorinthea" },
      ],
    });

    s.play("endless maw|1")
      .expectLog("Ghostly Visit is banished from graveyard")
      .expectLog("Void Wraith is banished from graveyard")
      .expectLog("Snatch is banished from graveyard");
  });

  it("Carrion Husk does not prevent damage or banish itself when it did not defend", () => {
    const s = scenario({
      active: 1,
      seats: [
        leviaSeat({ life: 39, equipment: { chest: "carrion husk|0" } }),
        { hero: "dorinthea", resources: 1, weapons: ["harmonized kodachi|0"] },
      ],
    });

    s.attackWithWeapon("harmonized kodachi|0")
      .blockWith()
      .settle()
      .expectLife(0, 38)
      .expectEquipped(0, "chest", "carrion husk|0")
      .expectNotInZone(0, "carrion husk|0", "banish");
  });

  it("Carrion Husk is banished when the combat chain closes after it defends", () => {
    const s = scenario({
      active: 1,
      seats: [
        leviaSeat({ life: 39, equipment: { chest: "carrion husk|0" } }),
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
    });

    s.play("snatch|1")
      .blockWith("carrion husk|0")
      .settle()
      .expectEquipped(0, "chest", "carrion husk|0")
      .expectNotInZone(0, "carrion husk|0", "banish")
      .doRaw({ kind: "close-chain" })
      .expectNoEquipment(0, "chest")
      .expectInZone(0, "carrion husk|0", "banish");
  });

  it.each([
    { life: 13, banished: true },
    { life: 14, banished: false },
  ])("Carrion Husk start-of-turn threshold at $life life", ({ life, banished }) => {
    const s = scenario({
      active: 1,
      seats: [
        leviaSeat({ life, equipment: { chest: "carrion husk|0" } }),
        { hero: "dorinthea" },
      ],
    });

    s.endTurn();
    if (banished) {
      s.expectNoEquipment(0, "chest").expectInZone(0, "carrion husk|0", "banish");
    } else {
      s.expectEquipped(0, "chest", "carrion husk|0")
        .expectNotInZone(0, "carrion husk|0", "banish");
    }
  });

  it("Blood Debt loses one life for each face-up blood-debt card in banish", () => {
    const s = scenario({
      seats: [
        leviaSeat({ life: 20, hand: [BLUE, BLUE, BLUE, BLUE], banish: ["ghostly visit|1"] }),
        { hero: "dorinthea" },
      ],
    });

    s.doRaw({ kind: "pass" });
    s.expectLife(0, 19).expectTurn(1);
    expect(s.state.pendingDecision?.kind).toBe("arsenal");
    expect(s.state.stack).toHaveLength(0);
    s.settle().expectTurn(2);
  });

  it("groups different Blood Debt cards without a redundant ordering decision", () => {
    const s = scenario({
      seats: [
        leviaSeat({ life: 20, banish: ["ghostly visit|1", "void wraith|1"] }),
        { hero: "dorinthea" },
      ],
    });

    s.doRaw({ kind: "pass" });
    s.expectLife(0, 18).expectTurn(2);
    expect(s.state.pendingDecision).toBeNull();
    expect(s.state.pendingDecision?.kind).not.toBe("order-triggers");
    expect(s.state.log.filter((entry) => entry.publicText?.includes("Blood Debt triggers")))
      .toEqual([{ publicText: "Blood Debt triggers ×2" }]);
  });

  it("stores Blood Debt as one counted server layer beside distinct triggers", () => {
    const s = scenario({
      seats: [
        leviaSeat({
          life: 20,
          banish: ["ghostly visit|1", "void wraith|1"],
          board: ["loan shark|2"],
        }),
        { hero: "dorinthea" },
      ],
    });

    s.doRaw({ kind: "pass" });
    expect(s.state.pendingDecision).toMatchObject({
      kind: "order-triggers",
      optionLabels: [
        "Pay Loan Shark",
        "Blood Debt — lose 1 life",
      ],
      optionCounts: [null, 2],
    });
    expect(projectStateFor(s.state, 0).pendingDecision?.optionCounts).toEqual([null, 2]);
    const order = s.state.pendingDecision?.options;
    expect(order).toHaveLength(2);
    s.doRaw({ kind: "order-triggers", optionIds: order! });
    // Ordering remains a real decision, but confirming it does not create an
    // End Phase priority window. Both layers resolve automatically.
    expect(s.state.pendingDecision).toBeNull();
    expect(s.state.stack).toHaveLength(0);
    s.expectLife(0, 16).expectTurn(2);
  });

  it("auto-resolves counted Blood Debt occurrences and the next distinct end trigger", () => {
    const s = scenario({
      seats: [
        leviaSeat({
          life: 20,
          banish: ["ghostly visit|1", "void wraith|1"],
          board: ["loan shark|2"],
        }),
        { hero: "dorinthea" },
      ],
    });

    s.doRaw({ kind: "pass" });
    const decision = s.state.pendingDecision;
    const bloodDebt = decision?.options?.find((_, index) =>
      decision.optionLabels?.[index] === "Blood Debt — lose 1 life"
    );
    const loanShark = decision?.options?.find((_, index) =>
      decision.optionLabels?.[index] === "Pay Loan Shark"
    );
    expect(bloodDebt).toBeDefined();
    expect(loanShark).toBeDefined();
    s.doRaw({ kind: "order-triggers", optionIds: [bloodDebt!, loanShark!] });

    s.expectLife(0, 16).expectTurn(2);
    expect(s.state.stack).toHaveLength(0);
    expect(s.state.pendingDecision).toBeNull();
  });

  it("Levia suppresses Blood Debt after a 6-power card is banished this turn", () => {
    const s = scenario({
      seats: [
        leviaSeat({
          life: 20,
          hand: ["boneyard marauder|1", BLUE],
          graveyard: [SEVEN, "ghostly visit|1", "void wraith|1"],
        }),
        { hero: "dorinthea" },
      ],
    });

    s.play("boneyard marauder|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .endTurn()
      .expectLife(0, 20);
    expect(s.state.log.some((entry) => entry.publicText?.includes("Blood Debt triggers")))
      .toBe(false);
  });

  it("Hooves of the Shadowbeast can destroy itself after a 6-power card is banished", () => {
    const s = scenario({
      seats: [
        leviaSeat({
          resources: 1,
          equipment: { arms: "ebon fold|0", legs: "hooves of the shadowbeast|0" },
          hand: ["consuming aftermath|1"],
          deck: [BLUE],
        }),
        { hero: "dorinthea" },
      ],
    });

    s.activate("ebon fold|0")
      .chooseCard("consuming aftermath|1")
      .chooseOption("yes")
      .expectNoEquipment(0, "arms")
      .expectNoEquipment(0, "legs")
      .expectAP(0, 2);
  });

  it("Doomsday ignores face-down Blood Debt cards in the banished zone", () => {
    const debt = Array.from({ length: 6 }, () => "ghostly visit|1");
    const faceUp = scenario({
      seats: [leviaSeat({ hand: ["doomsday|3"], banish: debt }), { hero: "dorinthea" }],
    });
    faceUp.play("doomsday|3"); // six face-up Blood Debt cards: playable

    const faceDown = scenario({
      seats: [leviaSeat({ hand: ["doomsday|3"], banishFaceDown: debt }), { hero: "dorinthea" }],
    });
    expect(legalIntents(faceDown.state, 0).filter((i) => i.kind === "play-card")).toEqual([]);
  });
});

describe("MON — Chane and banished-zone play", () => {
  it("Chane creates a Soul Shackle and gives the next Runeblade action go again", () => {
    const s = scenario({
      seats: [
        chaneSeat({ hand: ["vexing malice|1", BLUE] }),
        { hero: "dorinthea", life: 20 },
      ],
    });

    s.activate("chane|0")
      .expectInZone(0, "soul shackle|0", "board")
      .play("vexing malice|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectLife(1, 15);
  });

  it("Soul Shackle banishes the top card at the beginning of its controller's action phase", () => {
    const s = scenario({
      seats: [
        chaneSeat({ board: ["soul shackle|0"], hand: [BLUE, BLUE, BLUE, BLUE], deck: ["ghostly visit|1"] }),
        { hero: "dorinthea" },
      ],
    });

    s.endTurn()
      .endTurn()
      .expectInZone(0, "ghostly visit|1", "banish");
  });

  it("Blood-debt attacks with static permission can be played from banish", () => {
    const s = scenario({
      seats: [
        chaneSeat({ banish: ["ghostly visit|1"], hand: [BLUE] }),
        { hero: "dorinthea" },
      ],
    });

    s.play("ghostly visit|1", { pitch: [BLUE], fromZone: "banish" })
      .blockWith()
      .settle()
      .expectFinalAttack(4);
  });

  it("Seeping Shadows buffs the next qualifying attack and gives it go again", () => {
    const s = scenario({
      seats: [
        chaneSeat({ banish: ["seeping shadows|1"], hand: [BLUE, "bounding demigon|1"] }),
        { hero: "dorinthea" },
      ],
    });

    s.play("seeping shadows|1", { pitch: [BLUE], fromZone: "banish" })
      .play("bounding demigon|1")
      .blockWith()
      .settle()
      .expectFinalAttack(4)
      .expectAP(0, 1);
  });

  it("Spew Shadow grants one selected banished attack permission and a Light-target bonus", () => {
    const s = scenario({
      seats: [
        chaneSeat({ banish: ["ghostly visit|1"], hand: ["spew shadow|1", BLUE] }),
        prismSeat(),
      ],
    });

    s.play("spew shadow|1", { pitch: [BLUE] })
      .chooseCard("ghostly visit|1")
      .play("ghostly visit|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .expectFinalAttack(6);
  });
});

describe("MON — generic commons and rares", () => {
  it("Pulping gains dominate from a random 6-power discard and go again under two defenders", () => {
    const s = scenario({
      seats: [
        { hero: "dorinthea", hand: ["pulping|2", BLUE], deck: [SEVEN] },
        { hero: "rhinar", hand: [SIX] },
      ],
    });

    s.play("pulping|2", { pitch: [BLUE] })
      .blockWith(SIX)
      .settle()
      .expectAP(0, 1);
    expect(s.state.chain.at(-1)?.flags.dominateAtResolution).toBe(true);
  });

  it("Seek Horizon puts a chosen hand card on top and gains go again", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["seek horizon|1", SIX] },
        { hero: "dorinthea" },
      ],
    });

    s.play("seek horizon|1")
      .chooseCard(SIX)
      .blockWith()
      .settle()
      .expectDeckTop(0, SIX)
      .expectAP(0, 1);
  });

  it("Captain's Call buffs the next qualifying attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["captain's call|1", "smash with big tree|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });

    s.play("captain's call|1")
      .chooseOption("power")
      .play("smash with big tree|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .expectFinalAttack(9);
  });

  it("Memorial Ground puts a qualifying graveyard attack on top of the deck", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["memorial ground|1"], graveyard: ["ghostly visit|1"] },
        { hero: "dorinthea" },
      ],
    });

    s.play("memorial ground|1")
      .chooseCard("ghostly visit|1")
      .expectDeckTop(0, "ghostly visit|1");
  });
});

describe("MON — rules regression coverage", () => {
  it("Ravenous Meataxe costs 2 resources to attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", weapons: ["ravenous meataxe|0"], resources: 2 },
        { hero: "dorinthea" },
      ],
    });

    s.activate("ravenous meataxe|0", { settle: false }).expectResources(0, 0);
  });

  it("Valiant Dynamo removes a Battleworn counter after two weapon attacks", () => {
    const s = scenario({
      seats: [
        {
          hero: "dorinthea",
          equipment: { legs: "valiant dynamo|0" },
          hand: ["on a knife edge|2", BLUE],
        },
        { hero: "rhinar", hand: ["pack hunt|1", BLUE] },
      ],
      active: 1,
    });

    s.play("pack hunt|1", { pitch: [BLUE] })
      .blockWith("valiant dynamo|0")
      .settle()
      .endTurn()
      .expectEquipmentDefense(0, "legs", 0)
      .play("on a knife edge|2")
      .attackWithWeapon()
      .blockWith()
      .settle()
      .attackWithWeapon()
      .blockWith()
      .settle()
      .passPriority()
      .settle()
      .chooseOption("yes")
      .expectEquipmentDefense(0, "legs", 1);
  });

  it("Spectra auras can be attacked and destroy themselves before the attack resolves", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        prismSeat({ board: ["parable of humility|2"], hand: ["sigil of solace|1"] }),
      ],
    });

    s.play("snatch|1", { targetAlly: "parable of humility|2", settle: false });
    expect(s.state.stack[0]?.engineEffect).toEqual({ kind: "spectra-destroy" });
    s.expectInZone(1, "parable of humility|2", "board");

    s.settle()
      .expectInZone(1, "parable of humility|2", "graveyard")
      .expectInZone(0, "snatch|1", "graveyard");
    expect(s.state.chain).toHaveLength(0);
  });

  it("Rise Above can put a hand card on top instead of paying resources", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", hand: ["rise above|1", SIX] },
      ],
    });

    s.play("snatch|1")
      .blockWith()
      .passPriority()
      .react("rise above|1", { alternativeCost: SIX })
      .expectDeckTop(1, SIX);
  });

  it("Soul Reaping can banish hand cards instead of paying resources", () => {
    const s = scenario({
      seats: [
        chaneSeat({ hand: ["soul reaping|1", "ghostly visit|1"] }),
        { hero: "dorinthea" },
      ],
    });

    s.play("soul reaping|1", { alternativeCost: "ghostly visit|1" })
      .expectInZone(0, "ghostly visit|1", "banish")
      .expectResources(0, 1);
  });

  it("Blinding Beam costs one less when it targets a Shadow card", () => {
    const s = scenario({
      seats: [
        chaneSeat({ hand: ["ghostly visit|1", BLUE] }),
        prismSeat({ hand: ["blinding beam|1", BLUE] }),
      ],
    });

    s.play("ghostly visit|1", { pitch: [BLUE] })
      .blockWith(BLUE)
      .passPriority();

    const link = s.state.chain[s.state.chain.length - 1]!;
    const beamTargets = legalIntents(s.state, 1)
      .flatMap((intent) =>
        (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
        intent.instanceId === s.state.players[1]!.hand[0]!.instanceId
          ? [intent.targetCardInstanceId]
          : []);
    expect(beamTargets).toEqual([link.attackingCard.instanceId]);

    s.react("blinding beam|1", { targetCard: "ghostly visit|1", settle: false })
      .passPriority()
      .passPriority();
    s.expectAttackValue(1);
  });

  it("Dimenxxional Gateway offers its Shadow banish after arcane prevention", () => {
    const s = scenario({
      seats: [
        chaneSeat({ hand: ["dimenxxional gateway|3", BLUE], deck: ["unhallowed rites|1"] }),
        {
          hero: "dorinthea",
          resources: 1,
          equipment: { head: "nullrune hood|0" },
        },
      ],
    });

    s.play("dimenxxional gateway|3", { pitch: [BLUE] })
      .chooseOption("top")
      .chooseOption("pay 1")
      .chooseCard("unhallowed rites|1")
      .expectInZone(0, "unhallowed rites|1", "banish");
  });
});

describe("MON — granted hit effects", () => {
  it("Shadow Puppetry's granted hit effect looks at and may banish the top card", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["shadow puppetry|1", "head jab|1"], deck: ["head jab|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("shadow puppetry|1");
    g.play("head jab|1").expectAttackValue(4).blockWith().settle(); // 3 + 1, hits
    // "If this attack hits, look at the top card of your deck. You may banish it."
    const top = g.state.players[0]!.deck[0]!;
    expect(g.state.pendingDecision?.chooseHook).toBe("shadow-puppetry-banish");
    expect(g.state.pendingDecision?.options).toContain(String(top.instanceId));
    expect(
      projectStateFor(g.state, 0).log.some((line) => line.includes("You look at Head Jab")),
    ).toBe(true);
    g.chooseCard("head jab|2").expectInZone(0, "head jab|2", "banish");
  });

  it("opens only one empty Damage Step priority round after Shadow Puppetry resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["shadow puppetry|1", "head jab|1", "sigil of solace|3"],
          deck: ["head jab|2"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("shadow puppetry|1");
    g.play("head jab|1").blockWith().settle();
    expect(g.state.pendingDecision?.chooseHook).toBe("shadow-puppetry-banish");
    expect(legalIntents(g.state, 0)).toContainEqual({ kind: "choose", optionId: "no" });

    g.doRaw({ kind: "choose", optionId: "no" });
    expect(g.state.stack).toHaveLength(0);
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });

    g.passPriority().passPriority();
    expect(g.state.chain[0]?.resolved).toBe(true);
    expect(g.state.phase).toBe("action");
  });
});
