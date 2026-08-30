import { describe, expect, it } from "vitest";
import { applyIntent } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";
import { cardData } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";

/**
 * Scenarios for WTR warrior cards (young Dorinthea and the warrior deck cards
 * not already covered by DVR reprints).
 *
 * Pitch fodder: "titanium bauble|3" (blue resource, pitch 3).
 */

/** Choose a specific hand card in an open choose-target decision. */
function chooseHandCard(g: ReturnType<typeof scenario>, seat: number, key: string) {
  const id = printingId(key);
  const card = g.state.players[seat]!.hand.find((c) => c.cardId === id);
  if (!card) throw new Error(`no "${key}" in seat ${seat}'s hand`);
  const r = applyIntent(g.state, seat, { kind: "choose", optionId: String(card.instanceId) });
  if (!r.ok) throw new Error(`choose "${key}" rejected: ${r.error}`);
  g.state = r.state;
  return g.settle();
}

const WTR_DORINTHEA_ID = Object.values(cardData).find(
  (c) => functionalKeyOf(c) === "dorinthea|0",
)!.id;

/** Patch a freshly-built dorinthea scenario to use the young WTR hero. */
function useWtrDorinthea(g: ReturnType<typeof scenario>): typeof g {
  const p = g.state.players[0]!;
  p.heroCardId = WTR_DORINTHEA_ID;
  p.hero.cardId = WTR_DORINTHEA_ID;
  return g;
}

describe("WTR — hero ability", () => {
  it("Young Dorinthea does not create a start-of-turn trigger", () => {
    const g = useWtrDorinthea(
      scenario({
        seats: [
          { hero: "dorinthea", hand: [] },
          { hero: "rhinar", hand: [] },
        ],
      }),
    );

    g.endTurn().endTurn(); // return to Dorinthea's action phase
    expect(g.state.phase).toBe("action");
    expect(g.state.stack).toHaveLength(0);
    expect(g.state.log.some((line) => line.publicText?.includes("Reset Dorinthea's ability"))).toBe(false);
  });

  it("Young Dorinthea enables a second weapon attack after a hit", () => {
    const g = useWtrDorinthea(
      scenario({
        seats: [
          { hero: "dorinthea", hand: ["warrior's valor|2", "titanium bauble|3"] },
          { hero: "rhinar", hand: [] },
        ],
      }),
    );
    g.play("warrior's valor|2", { pitch: ["titanium bauble|3"] })
      .attackWithWeapon()
      .expectAttackValue(4) // Dawnblade 2 + Warrior's Valor 2
      .blockWith()
      .settle() // link resolves; Dorinthea's mandatory effect re-enables it
      .expectLog("Dorinthea's ability: the weapon may attack an additional time this turn")
      .expectAP(0, 1) // Warrior's Valor on-hit go again
      .attackWithWeapon()
      .expectAttackValue(3) // second Dawnblade attack
      .blockWith()
      .settle()
      .expectAP(0, 0)
      .expectLife(1, 13); // 4 + 3 damage
  });

  it("Young Dorinthea triggers only once per turn", () => {
    const g = useWtrDorinthea(
      scenario({
        seats: [
          {
            hero: "dorinthea",
            hand: ["warrior's valor|2", "titanium bauble|3", "titanium bauble|3"],
          },
          { hero: "rhinar", hand: [] },
        ],
      }),
    );
    g.play("warrior's valor|2", { pitch: ["titanium bauble|3"] })
      .attackWithWeapon()
      .blockWith()
      .settle()
      .attackWithWeapon()
      .blockWith()
      .settle()
      .expectAP(0, 0)
      .expectLife(1, 13);
    // The ability is once per turn: the log appears exactly once (first hit).
    expect(g.state.log.filter((l) => l.publicText?.includes("Dorinthea's ability: the weapon may attack an additional time")).length).toBe(1);
  });
});

describe("WTR — next-attack buff actions", () => {
  it("Driving Blade (red) gives +3 and go again", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["driving blade|1", "titanium bauble|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("driving blade|1", { pitch: ["titanium bauble|3"] })
      .attackWithWeapon()
      .expectAttackValue(5) // 2 + 3
      .blockWith()
      .settle()
      .expectAP(0, 1) // attack's go again from Driving Blade
      .expectLife(1, 15);
  });

  it("Sharpen Steel (yellow) gives +2", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["sharpen steel|2", "titanium bauble|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("sharpen steel|2") // cost 0, go again
      .attackWithWeapon()
      .expectAttackValue(4) // 2 + 2
      .blockWith()
      .settle()
      .expectLife(1, 16);
  });

  it("Warrior's Valor (yellow) gives +2 and on-hit go again", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["warrior's valor|2", "titanium bauble|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("warrior's valor|2", { pitch: ["titanium bauble|3"] })
      .attackWithWeapon()
      .expectAttackValue(4) // 2 + 2
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectLife(1, 16);
  });
});

describe("WTR — attack reactions", () => {
  it("Biting Blade buffs the attack and Reprise gives weapons +1", () => {
    const g = useWtrDorinthea(
      scenario({
        seats: [
          {
            hero: "dorinthea",
            hand: ["biting blade|1", "titanium bauble|3", "titanium bauble|3"],
          },
          { hero: "rhinar", hand: ["raging onslaught|2"] },
        ],
      }),
    );
    // Patch extra AP so we can swing twice this turn.
    g.state.players[0]!.actionPoints = 2;
    g.attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith("raging onslaught|2")
      .react("biting blade|1")
      .expectLog("Biting Blade (Reprise): weapons you control gain +1 attack")
      .expectFinalAttack(6) // 2 + 3 + 1 (Reprise weapon buff applies to this weapon attack)
      .settle()
      .expectAP(0, 1)
      // Second attack benefits from the +1 weapon buff.
      .attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .expectAttackValue(4) // 2 + 1 (Dawnblade second) + 1 (Biting Blade)
      .blockWith()
      .settle()
      .expectLife(1, 13); // 3 (first) + 4 (second)
  });

  it("Ironsong Response (yellow) gets +2 only with Reprise", () => {
    const blocked = scenario({
      seats: [
        { hero: "dorinthea", hand: ["ironsong response|2", "titanium bauble|3"] },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
    });
    blocked
      .attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith("raging onslaught|2")
      .react("ironsong response|2")
      .expectLog("Ironsong Response (Reprise): +2 attack")
      .expectFinalAttack(4) // 2 + 2
      .expectLife(1, 19); // 4 - 3 defense

    const open = scenario({
      seats: [
        { hero: "dorinthea", hand: ["ironsong response|2", "titanium bauble|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    open
      .attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith()
      .react("ironsong response|2")
      .expectNoLog("Ironsong Response (Reprise)")
      .expectFinalAttack(2)
      .expectLife(1, 18);
  });

  it("Overpower (red) is +4 normally and +6 with Reprise", () => {
    const blocked = scenario({
      seats: [
        { hero: "dorinthea", hand: ["overpower|1", "titanium bauble|3", "titanium bauble|3"] },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
    });
    blocked
      .attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith("raging onslaught|2")
      .react("overpower|1")
      .expectLog("Overpower (Reprise): +6 attack")
      .expectFinalAttack(8) // 2 + 6
      .expectLife(1, 15); // 8 - 3 defense = 5

    const open = scenario({
      seats: [
        { hero: "dorinthea", hand: ["overpower|1", "titanium bauble|3", "titanium bauble|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    open
      .attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith()
      .react("overpower|1")
      .expectFinalAttack(6) // 2 + 4
      .expectLife(1, 14);
  });

  it("Stroke of Foresight (red) draws and puts a chosen hand card on top with Reprise", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["stroke of foresight|1", "titanium bauble|3", "en garde|1"],
          deck: ["sharpen steel|2"],
        },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
    });
    g.attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith("raging onslaught|2")
      .react("stroke of foresight|1"); // draws Sharpen Steel, then asks which hand card
    chooseHandCard(g, 0, "sharpen steel|2")
      .chooseOption("top")
      .expectFinalAttack(5) // 2 + 3
      .expectDeckTop(0, "sharpen steel|2")
      .expectHandSize(0, 1) // en garde remains
      .expectLife(1, 18);
  });
});

describe("WTR — Nature's Path Pilgrimage", () => {
  it("puts a revealed action card face-down into an empty arsenal on hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["nature's path pilgrimage|1", "titanium bauble|3"],
          deck: ["sharpen steel|2"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("nature's path pilgrimage|1", { pitch: ["titanium bauble|3"] })
      .attackWithWeapon()
      .expectAttackValue(5) // 2 + 3
      .blockWith()
      .settle()
      .expectInZone(0, "sharpen steel|2", "arsenal")
      .expectFaceDown(0, "sharpen steel|2", true)
      .expectAP(0, 0)
      .expectLife(1, 15);
  });

  it("does nothing when the top card is not an action", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["nature's path pilgrimage|1", "titanium bauble|3"],
          deck: ["titanium bauble|3"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("nature's path pilgrimage|1", { pitch: ["titanium bauble|3"] })
      .attackWithWeapon()
      .blockWith()
      .settle()
      .expectZoneSize(0, "arsenal", 0)
      .expectAP(0, 0)
      .expectLife(1, 15);
  });
});

describe("WTR — equipment / defense reactions", () => {
  it("Refraction Bolters can destroy itself to grant go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["titanium bauble|3"],
          equipment: { legs: "refraction bolters|0" },
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith()
      .settle() // weapon hits; Refraction Bolters offers the on-hit choice
      .chooseOption("yes")
      .expectLog("Refraction Bolters: the attack gains go again")
      .expectAP(0, 1)
      .expectNoEquipment(0, "legs")
      .expectLife(1, 18);
  });

  it("Steelblade Shunt deals 1 damage to the attacking hero when defending a weapon attack", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["steelblade shunt|1", "titanium bauble|3"] },
        { hero: "rhinar", hand: ["titanium bauble|3"] },
      ],
      active: 1,
    });
    g.attackWithWeapon(undefined, { pitch: ["titanium bauble|3"] })
      .blockWith()
      .passPriority() // attacker passes; defender gains priority
      .react("steelblade shunt|1")
      .expectLog("Steelblade Shunt deals 1 damage to the attacking hero")
      .settle()
      .expectLife(1, 19); // Rhinar (seat 1) takes 1 damage from Shunt
  });
});
