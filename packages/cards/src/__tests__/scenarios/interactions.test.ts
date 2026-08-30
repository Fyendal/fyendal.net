import { describe, expect, it } from "vitest";
import { projectStateFor } from "@fyendal/engine";
import { scenario } from "../harness.js";

/**
 * Cross-card interactions where ordering/timing matters more than any single
 * card's script: resolution snapshots, close-of-chain equipment keywords, and
 * the end-of-turn return of intimidated cards.
 */

describe("interactions — resolution snapshot", () => {
  it("an attack-reaction buff survives in the resolved link's finalAttack", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["ironsong response|1", "en garde|1"] },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
    });
    g.attackWithWeapon()
      .blockWith("raging onslaught|2")
      .react("ironsong response|1")
      // chain-link modifiers expire at resolution — a live recompute would now
      // give 2, but the snapshot taken at resolution must keep the buffed 5
      .expectFinalAttack(5)
      .expectFinalDefense(3)
      .expectLife(1, 18);
  });
});

describe("interactions — close-of-chain equipment keywords", () => {
  it("Battleworn: a -1 defense counter, not destruction", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        { hero: "rhinar", hand: ["pack hunt|1", "raging onslaught|2"] },
      ],
      active: 1,
    });
    g.play("pack hunt|1", { pitch: ["raging onslaught|2"] })
      .blockWith("gallantry gold|0") // defends for 1
      .settle()
      .expectLife(0, 15)
      .endTurn() // chain closes
      .expectLog("gets a -1 defense counter (Battleworn)")
      .expectEquipped(0, "arms", "gallantry gold|0") // still in play…
      .expectEquipmentDefense(0, "arms", 0); // …but now defends for 0
  });

  it("Blade Break: defending equipment is destroyed when the chain closes", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        { hero: "rhinar", hand: ["pack hunt|1", "raging onslaught|2"] },
      ],
      active: 1,
    });
    g.play("pack hunt|1", { pitch: ["raging onslaught|2"] })
      .blockWith("ironrot helm|0") // defends for 1
      .settle()
      .expectLife(0, 15)
      .endTurn() // chain closes → destroyed
      .expectLog("Ironrot Helm is destroyed")
      .expectNoEquipment(0, "head")
      .expectInZone(0, "ironrot helm|0", "graveyard");
  });
});

describe("interactions — intimidate timing", () => {
  it("the banished card returns to hand at the beginning of the end phase", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3", "raging onslaught|2"] },
        { hero: "rhinar", hand: ["clearing bellow|3"] },
      ],
      active: 1,
    });
    g.play("clearing bellow|3")
      .expectPendingReturn(0, 1)
      .expectHandSize(0, 1)
      .endTurn()
      .expectLog("intimidated card returns to their hand")
      .expectPendingReturn(0, 0)
      .expectHandSize(0, 2); // back before the end-of-turn triggers/arsenal step
  });
});

describe("interactions — choice option projection", () => {
  it("card choices project resolved optionCards, nulled for the non-decider", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", equipment: { head: "carrion crown|0" }, hand: ["barnacle|2"], deck: [] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("carrion crown|0", { settle: false })
      .passPriority()
      .passPriority();
    const ally = g.state.players[0]!.hand[0]!;
    const own = projectStateFor(g.state, 0).pendingDecision;
    expect(own?.options).toEqual([String(ally.instanceId)]);
    expect(own?.optionCards?.[0]?.cardId).toBe(ally.cardId);
    // the opponent receives no decision capabilities or resolved private cards
    const opp = projectStateFor(g.state, 1).pendingDecision;
    expect(opp?.options).toBeUndefined();
    expect(opp?.optionCards).toBeUndefined();
  });

  it("plain numeric options stay literal (no optionCards) — Blaze's remove-X choose", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "blaze, firemind|0",
          weapons: [],
          hand: ["whisper of the oracle|1"],
          deck: ["voltic bolt|1", "snapback|1", "look tuff|1", "wounded bull|1"],
        },
        { hero: "dorinthea", hand: ["wounded bull|1", "raging onslaught|3"] },
      ],
    });
    s.play("whisper of the oracle|1");
    s.chooseOption("top").chooseOption("top").chooseOption("top").chooseOption("top");
    s.endTurn();
    s.play("wounded bull|1", { settle: false });
    s.passPriority(); // yields the attack window to Blaze
    s.activate("blaze, firemind|0", { settle: false });
    s.passPriority();
    s.passPriority(); // the ability resolves into the remove-X choice
    const pd = projectStateFor(s.state, 0).pendingDecision;
    // "1".."4" are counter counts, not instances — instance 1 is a hero, so
    // resolving them as cards rendered the opposing hero's name as an option
    expect(pd?.options).toEqual(["1", "2", "3", "4"]);
    expect(pd?.optionCards).toBeUndefined();
  });
});
