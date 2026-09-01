import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/**
 * Scenarios for the WTR Brute pool: next-attack buffs, random-discount attacks,
 * conditional go again, and equipment resource generation.
 *
 * Pitch fodder: "raging onslaught|2" (yellow), "wrecker romp|3" (blue).
 */

describe("WTR Brute — next-attack buffs", () => {
  it("Awakening Bellow gives the next Brute attack action +2 and intimidates", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["awakening bellow|2", "savage swing|1", "raging onslaught|2", "wrecker romp|3"],
        },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
    });
    g.play("awakening bellow|2", { pitch: ["wrecker romp|3"] })
      .expectAP(0, 1) // go again refunds the action point
      .play("savage swing|1") // cost 1, hand still has fodder for the random discard
      .expectAttackValue(9) // 7 + 2
      .blockWith()
      .settle()
      .expectFinalAttack(9)
      .expectLife(1, 11)
      .expectLog("banishes a random card face down (Intimidate)");
  });

  it("Primeval Bellow discards a random card and gives the next Brute attack +5", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "primeval bellow|1",
            "savage swing|1",
            "savage swing|1",
            "raging onslaught|2",
            "wrecker romp|3",
          ],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("primeval bellow|1")
      .expectAP(0, 1) // go again
      .play("savage swing|1")
      .expectAttackValue(12) // 7 + 5
      .blockWith()
      .settle()
      .expectFinalAttack(12)
      .expectLife(1, 8);
  });

  it("Barraging Beatdown: +4 while defended by fewer than 2 non-equipment cards", () => {
    const few = scenario({
      seats: [
        { hero: "rhinar", hand: ["barraging beatdown|1", "savage swing|1", "raging onslaught|2", "wrecker romp|3"] },
        { hero: "rhinar", hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] },
      ],
    });
    few
      .play("barraging beatdown|1")
      .expectAP(0, 1)
      .play("savage swing|1")
      .expectAttackValue(11) // 7 + 4
      .blockWith("raging onslaught|2")
      .settle()
      .expectFinalAttack(11)
      .expectLife(1, 12);

    const many = scenario({
      seats: [
        { hero: "rhinar", hand: ["barraging beatdown|1", "savage swing|1", "raging onslaught|2", "wrecker romp|3"] },
        { hero: "rhinar", hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] },
      ],
    });
    many
      .play("barraging beatdown|1")
      .play("savage swing|1")
      .blockWith("raging onslaught|2", "raging onslaught|2")
      .settle()
      .expectFinalAttack(7) // no buff
      .expectLife(1, 19);
  });

  it("Barraging Beatdown applies to a Brute weapon attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["ravenous meataxe|0"],
          hand: ["barraging beatdown|1", "awakening bellow|2"],
          resources: 2,
        },
        {
          hero: "rhinar",
          hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"],
        },
      ],
    });

    g.play("barraging beatdown|1")
      .attackWithWeapon("ravenous meataxe|0")
      .expectAttackValue(7) // 3 + 4
      .blockWith("raging onslaught|2")
      .settle()
      .expectFinalAttack(7)
      .expectLife(1, 16);
  });

  it("Barraging Beatdown does not apply to a Generic attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["barraging beatdown|1", "wounded bull|2"],
          resources: 3,
        },
        { hero: "rhinar", hand: [] },
      ],
    });

    g.play("barraging beatdown|1")
      .play("wounded bull|2")
      .expectAttackValue(6);
  });
});

describe("WTR Brute — random-discount attacks", () => {
  it("Savage Swing can be played and resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["savage swing|1", "raging onslaught|2", "wrecker romp|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("savage swing|1", { pitch: ["raging onslaught|2"] })
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectFinalAttack(7)
      .expectLife(1, 13);
  });

  it("Savage Feast draws a card when the discarded random card has 6+ {p}", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["savage feast|1", "savage swing|1", "wrecker romp|3"],
          deck: ["raging onslaught|2"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("savage feast|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectFinalAttack(6)
      .expectLife(1, 14)
      .expectLog("Savage Feast: draw a card")
      .expectHandSize(0, 1) // drew the only deck card
      .expectZoneSize(0, "deck", 0);
  });

  it("Breakneck Battery gains go again only when the discarded card has 6+ {p}", () => {
    const sixPlus = scenario({
      seats: [
        { hero: "rhinar", hand: ["breakneck battery|1", "savage swing|1", "wrecker romp|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    sixPlus
      .play("breakneck battery|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLog("Breakneck Battery gains go again")
      .expectAP(0, 1);

    const small = scenario({
      seats: [
        { hero: "rhinar", hand: ["breakneck battery|1", "awakening bellow|3", "wrecker romp|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    small
      .play("breakneck battery|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectNoLog("Breakneck Battery gains go again")
      .expectAP(0, 0);
  });
});

describe("WTR Brute — equipment", () => {
  it("Barkbone Strapping: destroy to roll a die and gain resources", () => {
    const g = scenario({
      seed: 3,
      seats: [
        { hero: "rhinar", hand: ["raging onslaught|2"], equipment: { chest: "barkbone strapping|0" } },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.activate("barkbone strapping|0")
      .expectResources(0, 2) // seed 3 rolls a 4 → floor(4/2) = 2
      .expectLog("Barkbone Strapping: rolled 4, gained {r}2")
      .expectNoEquipment(0, "chest")
      .expectInZone(0, "barkbone strapping|0", "graveyard");
  });
});
