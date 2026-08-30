import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/**
 * Scenarios for the Dorinthea pool (DVR): hero/weapon synergy, reprise,
 * next-attack buffs, and equipment/resource abilities.
 * Pitch fodder: "en garde|1" (red), "raging onslaught|2" (yellow),
 * "wrecker romp|3" (blue) unless the card under test needs them.
 */

describe("DVR — next-attack buffs", () => {
  it("Sharpen Steel buffs the next Dawnblade attack by +3", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["sharpen steel|1", "en garde|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("sharpen steel|1") // cost 0, go again
      .expectAP(0, 1)
      .attackWithWeapon()
      .expectAttackValue(5) // 2 + 3
      .blockWith()
      .settle()
      .expectFinalAttack(5)
      .expectLife(1, 15);
  });

  it("Driving Blade gives the next weapon attack +2 and go again", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["driving blade|2", "raging onslaught|2", "en garde|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("driving blade|2", { pitch: ["raging onslaught|2"] })
      .expectAP(0, 1) // go again on the action itself
      .attackWithWeapon()
      .expectAttackValue(4) // 2 + 2
      .blockWith()
      .settle()
      .expectAP(0, 1) // attack's go again refunds the action point
      .expectLife(1, 16);
  });

  it("Slice and Dice: first sword attack +1, second +2", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["slice and dice|2", "on a knife edge|2", "en garde|1", "en garde|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("slice and dice|2")
      .play("on a knife edge|2") // go again for the first attack
      .attackWithWeapon()
      .expectAttackValue(3) // 2 + 1 (first weapon attack)
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .attackWithWeapon() // legal: Dorinthea's ability re-enabled Dawnblade
      .expectAttackValue(5) // 2 + 2 (second) + 1 (Dawnblade's own second-attack text)
      .blockWith()
      .settle()
      .expectLife(1, 12);
  });
});

describe("DVR — Dawnblade / Dorinthea hero", () => {
  it("go again on Dawnblade re-enables it (Dorinthea) and hits add counters (Glistening Steelblade)", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["glistening steelblade|2", "en garde|1", "en garde|1", "en garde|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("glistening steelblade|2", { pitch: ["en garde|1"] })
      .attackWithWeapon() // declared with go again → Dorinthea re-enables Dawnblade
      .expectLog("Dorinthea's ability: Dawnblade may attack an additional time this turn")
      .expectAttackValue(2)
      .blockWith()
      .settle() // hit: Glistening puts a +1 counter on Dawnblade
      .expectLog("Dawnblade, Resplendent gets a +1 attack counter")
      .expectAP(0, 1)
      .attackWithWeapon() // legal only because Dorinthea reset the once-per-turn flag
      .expectAttackValue(4) // 2 + 1 (second attack this turn) + 1 (counter)
      .blockWith()
      .settle()
      .expectAP(0, 0)
      .expectLife(1, 14);
  });

  it("Hala Goldenhelm: flip, lesson counters on sword hits, payoff searches Glistening Steelblade", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["en garde|1", "en garde|1", "en garde|1", "en garde|1"],
          deck: ["glistening steelblade|2"],
          mentor: true,
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.endTurn() // turn 2, Rhinar
      .endTurn() // turn 3, Dorinthea — mentor flip trigger pends
      .chooseOption("yes")
      .expectFaceDown(0, "hala goldenhelm|0", false)
      .attackWithWeapon()
      .blockWith()
      .settle() // hit: go again (Hala) + first lesson counter
      .expectLog("Hala Goldenhelm: the attack gains go again")
      .expectLog("Hala Goldenhelm gets a lesson counter (1)")
      .expectAP(0, 1)
      .attackWithWeapon()
      .expectAttackValue(3)
      .blockWith()
      .settle() // second hit: lesson counter 2 → payoff
      .expectLog("Hala Goldenhelm gets a lesson counter (2)")
      .expectInZone(0, "hala goldenhelm|0", "banish")
      .expectInZone(0, "glistening steelblade|2", "arsenal")
      .expectFaceDown(0, "glistening steelblade|2", false)
      .expectLife(1, 15);
  });

  it("Hala Goldenhelm: lesson counters accumulate across turns", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          mentor: true,
          hand: ["titanium bauble|3", "titanium bauble|3"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.endTurn() // turn 2, Rhinar
      .endTurn() // turn 3, Dorinthea — mentor flip trigger pends
      .chooseOption("yes")
      .attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith()
      .settle() // hit: first lesson counter
      .expectLog("Hala Goldenhelm gets a lesson counter (1)")
      .endTurn() // turn 4, Rhinar — the counter must survive end-of-turn cleanup
      .endTurn() // turn 5, Dorinthea
      .attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith()
      .settle() // second hit: counter 2 → payoff (Hala banishes herself)
      .expectLog("Hala Goldenhelm gets a lesson counter (2)")
      .expectInZone(0, "hala goldenhelm|0", "banish");
  });
});

describe("DVR — attack reactions", () => {
  it("Ironsong Response: +3 only when defended from hand (Reprise)", () => {
    const blocked = scenario({
      seats: [
        { hero: "dorinthea", hand: ["ironsong response|1", "en garde|1"] },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
    });
    blocked
      .attackWithWeapon()
      .blockWith("raging onslaught|2")
      .react("ironsong response|1")
      .expectLog("Ironsong Response (Reprise): +3 attack")
      .expectFinalAttack(5)
      .expectLife(1, 18);

    const open = scenario({
      seats: [
        { hero: "dorinthea", hand: ["ironsong response|1", "en garde|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    open
      .attackWithWeapon()
      .blockWith()
      .react("ironsong response|1")
      .expectNoLog("Ironsong Response (Reprise)")
      .expectFinalAttack(2)
      .expectLife(1, 18);
  });

  it("Out for Blood: +2 now, and Reprise gives the next attack +1", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["blade flash|3", "out for blood|2", "en garde|1", "en garde|1", "en garde|1", "en garde|1"],
        },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
    });
    g.attackWithWeapon()
      .blockWith("raging onslaught|2")
      .react("blade flash|3", { settle: false }) // attack gains go again
      .react("out for blood|2", { settle: false })
      .settle()
      .expectLog("Out for Blood (Reprise): your next attack gains +1")
      .expectFinalAttack(4) // 2 + 2
      .expectAP(0, 1) // Blade Flash's go again
      .attackWithWeapon()
      .expectAttackValue(4) // 2 + 1 (second attack) + 1 (Reprise)
      .blockWith()
      .settle()
      .expectLife(1, 15);
  });

  it("In the Swing is illegal before two weapon attacks, then gives +3", () => {
    const early = scenario({
      seats: [
        { hero: "dorinthea", hand: ["in the swing|1", "en garde|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    early
      .attackWithWeapon() // first weapon attack — only 1 so far
      .blockWith()
      .expectNoLegalPlay("in the swing|1")
      .settle()
      .expectLife(1, 18);

    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["on a knife edge|2", "in the swing|1", "en garde|1", "en garde|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("on a knife edge|2")
      .attackWithWeapon()
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .attackWithWeapon() // second weapon attack
      .blockWith()
      .react("in the swing|1")
      .expectFinalAttack(6) // 2 + 1 (second attack) + 3
      .expectLife(1, 12); // 2 (first attack) + 6
  });

  it("Thrust gives a sword attack +3", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["thrust|1", "en garde|1", "en garde|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.attackWithWeapon()
      .blockWith()
      .react("thrust|1", { pitch: ["en garde|1"] })
      .expectFinalAttack(5)
      .expectLife(1, 15);
  });

  it("Run Through gives go again and the next sword attack +2", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["run through|2", "en garde|1", "en garde|1", "en garde|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.attackWithWeapon()
      .blockWith()
      .react("run through|2", { pitch: ["en garde|1"] })
      .expectAP(0, 1)
      .attackWithWeapon()
      .expectAttackValue(5) // 2 + 1 (second attack) + 2 (Run Through)
      .blockWith()
      .settle()
      .expectLife(1, 13);
  });
});

describe("DVR — go again actions", () => {
  it("Hit and Run: next weapon attack go again; +1 next attack after a weapon attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["on a knife edge|2", "hit and run|3", "en garde|1", "en garde|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("on a knife edge|2")
      .attackWithWeapon()
      .blockWith()
      .settle()
      .play("hit and run|3")
      .attackWithWeapon()
      .expectAttackValue(4) // 2 + 1 (Hit and Run) + 1 (second attack)
      .blockWith()
      .settle()
      .expectAP(0, 1) // Hit and Run's go again
      .expectLife(1, 14);
  });

  it("Second Swing: +4 next attack after attacking with a weapon", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["on a knife edge|2", "second swing|1", "en garde|1", "en garde|1", "en garde|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("on a knife edge|2")
      .attackWithWeapon()
      .blockWith()
      .settle()
      .play("second swing|1", { pitch: ["en garde|1"] })
      .attackWithWeapon()
      .expectAttackValue(7) // 2 + 4 + 1 (second attack)
      .blockWith()
      .settle()
      .expectLife(1, 11);
  });
});

describe("DVR — Flock of the Feather Walkers / Quicken", () => {
  it("requires a card with cost 1 or less in hand to reveal", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["flock of the feather walkers|1", "wrecker romp|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.expectNoLegalPlay("flock of the feather walkers|1"); // Wrecker Romp costs 2 — nothing to reveal

    const ok = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["flock of the feather walkers|1", "wrecker romp|3", "sharpen steel|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    ok.play("flock of the feather walkers|1", { pitch: ["wrecker romp|3"] })
      .expectLog("reveals Sharpen Steel (cost 1 or less)")
      .expectAttackValue(5)
      .blockWith()
      .settle()
      .expectLife(1, 15);
  });

  // the Quicken token is created by Flock's "when this attacks", so it did not
  // exist when the attack was declared — it must survive and apply to a LATER
  // attack ("when you play an attack action card or activate a weapon attack,
  // destroy this and the attack gains go again")
  it("Quicken created by Flock's attack does not buff that same attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["flock of the feather walkers|1", "wrecker romp|3", "sharpen steel|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("flock of the feather walkers|1", { pitch: ["wrecker romp|3"] })
      .blockWith()
      .settle()
      .expectInZone(0, "quicken|0", "board") // token should still be in play…
      .expectAP(0, 0); // …and the Flock attack should NOT have had go again
  });
});

describe("DVR — instants, equipment, resources", () => {
  it("Sigil of Solace can be played in the response window to an attack", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", life: 17, hand: ["sigil of solace|3"] },
        { hero: "rhinar", hand: ["pack hunt|1", "raging onslaught|2"] },
      ],
      active: 1,
    });
    g.play("pack hunt|1", { settle: false }) // attack declared; priority window opens (Sigil is an instant)
      .passPriority() // attacker passes
      .react("sigil of solace|3") // defender gains 1 life in response
      .expectLog("gains 1 life")
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLife(0, 12); // 17 + 1 - 6
  });

  it("Blossom of Spring: destroy for a floating resource and go again", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["en garde|1", "en garde|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.activate("blossom of spring|0")
      .expectAP(0, 1) // go again
      .expectResources(0, 1)
      .expectNoEquipment(0, "chest")
      .expectInZone(0, "blossom of spring|0", "graveyard")
      .play("en garde|1") // cost covered by the floating resource — no pitch
      .expectResources(0, 0)
      .expectHandSize(0, 1)
      .attackWithWeapon()
      .expectAttackValue(5)
      .blockWith()
      .settle()
      .expectLife(1, 15);
  });

  it("Titanium Bauble pitches for 3 and can never be played", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        { hero: "rhinar", hand: ["alpha rampage|1", "titanium bauble|3", "raging onslaught|2"] },
      ],
      active: 1,
    });
    g.expectNoLegalPlay("titanium bauble|3")
      .play("alpha rampage|1", { pitch: ["titanium bauble|3"] })
      .expectInZone(1, "titanium bauble|3", "pitch")
      .expectAttackValue(9)
      .blockWith()
      .settle()
      .expectLife(0, 11);
  });
});
