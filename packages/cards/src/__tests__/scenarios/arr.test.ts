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
