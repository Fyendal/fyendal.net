import { projectStateFor } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";

/**
 * Scenarios for the WTR Guardian pool: auras, crush attacks, defense reactions,
 * equipment, and the Bravo hero ability.
 *
 * Pitch fodder:
 * - "titanium bauble|3" (blue resource, pitch 3)
 * - "barraging beatdown|2" (yellow brute action, cost 0, pitch 2)
 * - "raging onslaught|2" (yellow generic attack, cost 3, pitch 2)
 */

describe("WTR Guardian — auras", () => {
  it("Blessing of Deliverance draws when a cost-3+ card is pitched and later gains life", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "blessing of deliverance|3",
            "barraging beatdown|2",
            "raging onslaught|2",
            "raging onslaught|2",
            "raging onslaught|2",
          ],
          pitch: ["buckling blow|1"],
          deck: ["disable|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("blessing of deliverance|3", { pitch: ["barraging beatdown|2"] })
      .expectLog("Blessing of Deliverance: drew a card")
      .expectInZone(0, "blessing of deliverance|3", "board")
      .endTurn()
      .endTurn()
      .expectInZone(0, "blessing of deliverance|3", "graveyard")
      .expectLog("Blessing of Deliverance: gained 1 life")
      .expectLife(0, 21);
  });

  it("Blessing of Deliverance does not draw without a cost-3+ pitch", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "blessing of deliverance|3",
            "barraging beatdown|2",
            "raging onslaught|2",
            "raging onslaught|2",
            "raging onslaught|2",
          ],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("blessing of deliverance|3", { pitch: ["barraging beatdown|2"] })
      .expectNoLog("Blessing of Deliverance: drew a card")
      .expectInZone(0, "blessing of deliverance|3", "board");
  });

  it("Emerging Power aura buffs the next attack action", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["emerging power|3", "cartilage crush|3", "barraging beatdown|2", "raging onslaught|2"],
          deck: [],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("emerging power|3", { pitch: ["barraging beatdown|2"] })
      .expectInZone(0, "emerging power|3", "board")
      .endTurn()
      .endTurn()
      .play("cartilage crush|3")
      .expectAttackValue(6) // 5 + 1
      .blockWith()
      .settle()
      .expectFinalAttack(6)
      .expectLife(1, 14);
  });

  it("Stonewall Confidence buffs cost-3+ defenders until the start of the next turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["stonewall confidence|3", "barraging beatdown|2", "raging onslaught|1"],
          deck: [],
        },
        { hero: "dorinthea", hand: ["wrecker romp|1", "raging onslaught|2", "raging onslaught|2"] },
      ],
    });
    g.play("stonewall confidence|3", { pitch: ["barraging beatdown|2"] })
      .expectInZone(0, "stonewall confidence|3", "board")
      .expectAP(0, 1)
      .endTurn(); // seat 1's turn; the aura dies at the start of seat 0's next turn
    g.play("wrecker romp|1") // cost 2, attack 8
      .blockWith("raging onslaught|1") // cost 3, defense 3 + 2 from Stonewall
      .expectLog("Stonewall Confidence: cards you control with cost 3 or more get +2 defense")
      .settle()
      .expectLife(0, 17) // 8 - 5
      .endTurn()
      .expectInZone(0, "stonewall confidence|3", "graveyard")
      .expectLog("Stonewall Confidence is destroyed");
  });
});

describe("WTR Guardian — crush attacks", () => {
  it("Buckling Blow crush puts a -1{d} counter on opponent equipment", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["buckling blow|3", "titanium bauble|3", "barraging beatdown|2"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("buckling blow|3")
      .expectAttackValue(6)
      .blockWith()
      .settle() // crush hit; the target choice is pending
      .chooseOption("head")
      .expectLog("gets a -1 defense counter")
      .expectEquipmentDefense(1, "head", 0)
      .expectLife(1, 14);
  });

  it("Cartilage Crush crush taxes the opponent's next action", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["cartilage crush|3", "titanium bauble|3"] },
        {
          hero: "rhinar",
          hand: ["what happens next?|3", "revolting gesture|1", "titanium bauble|3"],
        },
      ],
    });
    g.play("cartilage crush|3")
      .expectAttackValue(5)
      .blockWith()
      .settle()
      .expectLog("Cartilage Crush: opponent's next action costs +{r}")
      .expectLife(1, 15)
      .endTurn()
      .play("what happens next?|3")
      .play("revolting gesture|1", { pitch: ["titanium bauble|3"] })
      .expectResources(1, 2);
  });

  it("Crush Confidence crush disables opponent hero abilities", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["crush confidence|3", "titanium bauble|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("crush confidence|3")
      .expectAttackValue(5)
      .blockWith()
      .settle()
      .expectLog("Crush Confidence: opponent loses hero abilities until end of next turn")
      .expectLife(1, 15);
  });

  it("Debilitate crush weakens the opponent's next attack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["debilitate|3", "titanium bauble|3", "barraging beatdown|2"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("debilitate|3")
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLog("Debilitate: opponent's next attack gets -2{p}")
      .expectLife(1, 14);
  });

  it("Disable crush puts the opponent's arsenal card on the bottom of their deck", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["disable|3", "titanium bauble|3", "barraging beatdown|2"] },
        {
          hero: "rhinar",
          hand: [],
          arsenal: ["raging onslaught|2"],
          deck: ["buckling blow|1"],
        },
      ],
    });
    g.play("disable|3")
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectZoneSize(1, "arsenal", 0)
      .expectDeckBottom(1, "raging onslaught|2")
      .expectLife(1, 13);

    const publicMove = projectStateFor(g.state, 0).logEntries?.find(
      (entry) => "message" in entry && entry.message.id === "card.log.wtr.disable.arsenal.bottom",
    );
    expect(publicMove).toMatchObject({
      event: { kind: "card-moved", ownerSeat: 1, from: "arsenal", to: "deck" },
    });
    expect(JSON.stringify(publicMove)).not.toContain(printingId("raging onslaught|2"));
  });
});

describe("WTR Guardian — defense reactions and equipment", () => {
  it("Staunch Response can pay {r}{r}{r}{r} for +3 defense", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["staunch response|1"],
        },
        { hero: "rhinar", hand: ["raging onslaught|2", "raging onslaught|2"] },
      ],
      active: 1,
    });
    // Seed floating resources so the optional {r}{r}{r}{r} payment can be made
    // after the printed cost of the defense reaction is paid.
    g.state.players[0]!.resources = 6;
    g.attackWithWeapon()
      .blockWith()
      .passPriority()
      .react("staunch response|1")
      .chooseOption("pay 4")
      .settle()
      .expectFinalDefense(10) // 7 + 3
      .expectLife(0, 20);
  });

  it("Helm of Isen's Peak destroys itself for intended +1 intellect", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["raging onslaught|2"],
          equipment: { head: "helm of isen's peak|0" },
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.activate("helm of isen's peak|0")
      .expectNoEquipment(0, "head")
      .expectInZone(0, "helm of isen's peak|0", "graveyard")
      .expectLog("Helm of Isen's Peak: +1 intellect this turn");
  });
});
