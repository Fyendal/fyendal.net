import { describe, expect, it } from "vitest";
import { scenario } from "../harness.js";

/** Scenarios for the ARR set: Clearing Bellow. */

describe("ARR — Clearing Bellow", () => {
  it("intimidates immediately and has go again", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3"] },
        { hero: "rhinar", hand: ["clearing bellow|3", "pack hunt|1", "raging onslaught|2"] },
      ],
      active: 1,
    });
    g.play("clearing bellow|3") // cost 0
      .expectLog("Clearing Bellow: intimidate")
      .expectPendingReturn(0, 1)
      .expectAP(1, 1) // go again
      .play("pack hunt|1", { pitch: ["raging onslaught|2"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLife(0, 14);
  });
});

describe("ARR — Massacre", () => {
  it.each([
    { card: "primeval bellow|1", beatChest: false, ownIntimidate: 0 },
    { card: "bonebreaker bellow|1", beatChest: true, ownIntimidate: 0 },
    { card: "smell fear|2", beatChest: true, ownIntimidate: 1 },
  ])("uses the current Attack subtype when $card discards Massacre", ({ card, beatChest, ownIntimidate }) => {
    for (const gainsAttack of [false, true]) {
      const g = scenario({
        seats: [
          { hero: "dorinthea", hand: [card, "massacre|1"], resources: 3 },
          { hero: "rhinar", hand: ["dodge|3", "dodge|3", "dodge|3"] },
        ],
      });
      // Model a type-granting effect already applied before the additional cost.
      if (gainsAttack) g.state.players[0]!.hand[0]!.grantedTypes = ["attack"];

      g.play(card);
      if (beatChest) g.chooseCard("massacre|1");
      g.expectPendingReturn(1, ownIntimidate + Number(gainsAttack));
    }
  });

  it.each(["ARR010", "CRU008", "1HP012"])("%s intimidates once after a 6+ discard", (printing) => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: [printing], resources: 3 },
        { hero: "dorinthea", hand: ["dodge|3", "dodge|3", "dodge|3"] },
      ],
    });
    g.state.players[0]!.flags.discardedSixPlusThisTurn = true;

    g.play(printing)
      .expectAttackValue(8)
      .expectPendingReturn(1, 1);
  });

  it("does not intimidate before a 6+ discard", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["massacre|1"], resources: 3 },
        { hero: "dorinthea", hand: ["dodge|3", "dodge|3"] },
      ],
    });

    g.play("massacre|1")
      .expectAttackValue(6)
      .expectPendingReturn(1, 0);
  });
});

describe("ARR — Beat Chest equipment", () => {
  it("Bare Destruction gains go again when its Beat Chest trigger destroys Torc of Vim", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["bare destruction|1", "alpha instinct|3"],
          resources: 2,
          equipment: { chest: "torc of vim|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("bare destruction|1")
      .chooseCard("alpha instinct|3")
      .chooseOption("yes")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });
});

describe("ARR — Beast Within", () => {
  it("puts its graveyard ability on the stack before banishing cards", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          life: 10,
          hand: ["wrecker romp|3", "raging onslaught|2", "beast within|2"],
          deck: ["dodge|3", "pack hunt|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("wrecker romp|3", { pitch: ["raging onslaught|2"], settle: false })
      .expectLife(0, 10)
      .expectZoneSize(0, "banish", 0);

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-order");
    const layers = g.state.pendingDecision?.triggerOrder?.remaining ?? [];
    const beastLayer = layers.find((layer) =>
      layer.label === "Banish until a 6 power card is found");
    const rhinarLayer = layers.find((layer) => layer.label === "Intimidate");
    expect(beastLayer).toBeDefined();
    expect(rhinarLayer).toBeDefined();
    g.doRaw({
      kind: "order-triggers",
      optionIds: [
        `${beastLayer!.sourceInstanceId}:${beastLayer!.triggerIndex}`,
        `${rhinarLayer!.sourceInstanceId}:${rhinarLayer!.triggerIndex}`,
      ],
    });

    expect(g.state.stack[0]).toMatchObject({
      label: "Banish until a 6 power card is found",
      seat: 0,
    });

    g.passPriority()
      .passPriority()
      .expectLife(0, 8)
      .expectInZone(0, "dodge|3", "banish")
      .expectInZone(0, "pack hunt|1", "hand");
  });

  it("does not trigger when it goes to the graveyard from the combat chain", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          life: 10,
          hand: ["beast within|2", "raging onslaught|3"],
          deck: ["dodge|3", "pack hunt|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("beast within|2", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .endTurn()
      .expectLife(0, 10)
      .expectZoneSize(0, "banish", 0)
      .expectInZone(0, "beast within|2", "graveyard")
      .expectNoLog("Beast Within triggers");
  });
});

describe("ARR — Smell Fear", () => {
  it.each([
    { bellows: 1, power: 10 },
    { bellows: 0, power: 7 },
  ])("checks its intimidate count on the next Brute attack, not on resolution ($bellows later intimidates)", ({ bellows, power }) => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["smell fear|2", "wrecker romp|3", ...Array(bellows).fill("clearing bellow|3"), "smash with big tree|1"],
          resources: 3,
        },
        { hero: "rhinar", hand: ["dodge|3", "dodge|3", "dodge|3"] },
      ],
    });

    g.play("smell fear|2").chooseCard("wrecker romp|3").expectPendingReturn(1, 1);
    for (let i = 0; i < bellows; i++) g.play("clearing bellow|3");
    g.play("smash with big tree|1").expectAttackValue(power);
  });

  it("counts an intimidate from the attack itself", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["smell fear|2", "wrecker romp|3", "pack hunt|1"], resources: 3 },
        { hero: "rhinar", hand: ["dodge|3", "dodge|3", "dodge|3"] },
      ],
    });

    g.play("smell fear|2").chooseCard("wrecker romp|3");
    g.play("pack hunt|1").expectPendingReturn(1, 2).expectAttackValue(9);
  });
});
