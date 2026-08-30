/**
 * SAR (Silver Age: Arakni, Web of Deceit precon, Chapter 2) scenario tests —
 * marking and marked-payoffs, Web of Deceit's brood transformation (and
 * return to the brood), the brood heroes' discard-cost reaction abilities,
 * Mark of the Huntsman / Graphene Chelicera daggers, the reaction pumps
 * (Scar Tissue / Spike with Bloodrot / Stains of the Redback / Two Sides /
 * Night's Embrace / Shred), Topsy Turvy's top→bottom replacement, Hyper
 * Inflation's cost increase, Concoct Disorder, Danger Digits, Art of Desire,
 * the traps, and Reaper's Call's from-hand discard.
 *
 * Driving notes: the seat uses the dorinthea decklist as a base with the hero
 * and weapons overridden. The marked counter is stamped directly in setup
 * where the mark itself isn't under test. Hero-variant seats use heroKey with
 * the brood printing ids (their null life defaults to 20).
 */
import { describe, expect, it } from "vitest";
import { applyIntent, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";

const HUNTSMAN = "mark of the huntsman|0";
const GRAPHENE = "graphene chelicera|0";
const BLUE = "wrecker romp|3"; // blue pitch fodder
const RED = "snatch|1"; // red pitch fodder

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function arakniSeat(extra: Record<string, unknown> = {}) {
  return {
    hero: "dorinthea" as const,
    heroKey: "arakni, web of deceit|0",
    weapons: [HUNTSMAN],
    equipment: { ...NO_EQUIPMENT },
    ...extra,
  };
}

/** Stamp the marked condition on a hero (setup touch). */
function mark(s: Scenario, seat: number): void {
  s.state.players[seat]!.hero.counters = { marked: 1 };
}

function markedCount(s: Scenario, seat: number): number {
  return s.state.players[seat]!.hero.counters?.marked ?? 0;
}

describe("SAR — mark and the brood", () => {
  it("marking an already marked hero keeps a single marked condition", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark the prey|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    mark(s, 1);

    s.play("mark the prey|1").blockWith().settle();
    expect(markedCount(s, 1)).toBe(1);
  });

  it("Mark the Prey marks on hit; Web of Deceit becomes a random Agent at the end phase", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["mark the prey|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("mark the prey|1").blockWith().settle()
      .expectLife(1, 17)
      .expectLog("is marked");
    expect(markedCount(s, 1)).toBe(1);
    const before = s.state.players[0]!.hero.cardId;
    expect(before).toBe(printingId("arakni, web of deceit|0"));
    s.endTurn(); // the become trigger fires
    const after = s.state.players[0]!.hero.cardId;
    expect(after).not.toBe(before);
    expect(s.state.log.some((l) => l.publicText?.includes("becomes Arakni,"))).toBe(true);
  });

  it("a brood hero returns to the brood at its next end phase", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["mark the prey|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("mark the prey|1").blockWith().settle().endTurn();
    expect(s.state.players[0]!.hero.cardId).not.toBe(printingId("arakni, web of deceit|0"));
    s.endTurn().endTurn(); // the agent's own end phase: return to the brood
    expect(s.state.players[0]!.hero.cardId).toBe(printingId("arakni, web of deceit|0"));
  });

  it("an adult Arakni returns to Marionette after an Agent transformation", () => {
    const s = scenario({
      seats: [
        arakniSeat({ heroKey: "arakni, marionette|0" }),
        { hero: "rhinar", hand: [] },
      ],
    });
    const originalHeroId = s.state.players[0]!.hero.cardId;
    mark(s, 1);

    s.endTurn();
    expect(s.state.players[0]!.hero.cardId).not.toBe(originalHeroId);

    s.endTurn().endTurn();
    expect(s.state.players[0]!.hero.cardId).toBe(originalHeroId);
    expect(s.state.players[0]!.heroCardId).toBe(originalHeroId);
    expect(s.state.players[0]!.hero.originalHeroCardId).toBe(originalHeroId);
  });

  it("Web of Deceit: stealth attacks on a marked hero get +1{p} and go again on hit", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["mark of the black widow|1"] }), { hero: "rhinar", hand: [] }],
    });
    mark(s, 1); // setup stamp
    s.play("mark of the black widow|1") // stealth attack
      .expectAttackValue(4) // 3 base + 1
      .blockWith().settle() // hits — Rhinar banishes a hand card (none)
      .expectAP(0, 1); // go again from the hit
    expect(markedCount(s, 1)).toBe(0);
  });

  it.each(["mark of the black widow|1", "kiss of death|1"])(
    "Marionette gives +1{p} and on-hit go again to %s against a marked hero",
    (attack) => {
      const s = scenario({
        seats: [
          arakniSeat({ heroKey: "arakni, marionette|0", hand: [attack] }),
          { hero: "rhinar", hand: [] },
        ],
      });
      mark(s, 1);

      s.play(attack)
        .expectAttackValue(4)
        .blockWith().settle()
        .expectAP(0, 1);
      expect(markedCount(s, 1)).toBe(0);
    },
  );

  it("Marionette and marked-hit riders do not trigger against an unmarked hero", () => {
    const s = scenario({
      seats: [
        arakniSeat({
          heroKey: "arakni, marionette|0",
          hand: ["mark of the black widow|1"],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("mark of the black widow|1")
      .blockWith()
      .settle()
      .expectNoLog("Arakni, Marionette triggers")
      .expectNoLog("Mark of the Black Widow triggers")
      .expectAP(0, 0);
  });
});

describe("SAR — daggers", () => {
  it("Mark of the Huntsman destroys itself to mark on hit", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: [BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith().settle()
      .chooseOption("yes") // destroy this and mark them
      .expectLog("is marked");
    expect(markedCount(s, 1)).toBe(1);
    expect(s.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Mark of the Huntsman gets +1{p} against a marked hero", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: [BLUE] }), { hero: "rhinar", hand: [] }],
    });
    mark(s, 1);
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] }).expectAttackValue(2); // 1 base + 1
  });

  it("Graphene Chelicera's attack gets go again against a marked hero", () => {
    const s = scenario({
      seats: [arakniSeat({ weapons: [GRAPHENE], hand: [RED] }), { hero: "rhinar", hand: [] }],
    });
    mark(s, 1);
    s.attackWithWeapon(GRAPHENE, { pitch: [RED] })
      .blockWith().settle()
      .expectAP(0, 1); // go again refunded
  });

  it("Danger Digits: the off-link dagger deals 1 damage and is destroyed", () => {
    const s = scenario({
      seats: [
        arakniSeat({
          weapons: [HUNTSMAN, HUNTSMAN],
          equipment: { ...NO_EQUIPMENT, arms: "danger digits|0" },
          hand: [BLUE, BLUE],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    const offDagger = s.state.players[0]!.weapons[1]!.instanceId;
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith()
      .activate("danger digits|0")
      .chooseCard(HUNTSMAN); // the dagger that wasn't attacking
    s.settle();
    expect(s.state.players[0]!.weapons.some((c) => c.instanceId === offDagger)).toBe(false);
    expect(s.state.players[1]!.life).toBe(18); // 1 (Huntsman hit) + 1 (Danger Digits)
  });

  it("Danger Digits' effect hit fires Arakni, Tarantula's dagger-hit trigger", () => {
    const s = scenario({
      seats: [
        arakniSeat({
          heroKey: "arakni, tarantula|0",
          weapons: [HUNTSMAN, HUNTSMAN],
          equipment: { ...NO_EQUIPMENT, arms: "danger digits|0" },
          hand: [BLUE],
        }),
        { hero: "rhinar", hand: [BLUE] },
      ],
    });
    mark(s, 1);
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith(BLUE)
      .activate("danger digits|0")
      .chooseCard(HUNTSMAN)
      .settle();
    expect(s.state.players[1]!.life).toBe(18); // 1 damage + Tarantula's 1 life loss
    expect(markedCount(s, 1)).toBe(0);
  });

  it("Pick Up the Point pays to retrieve and equip a dagger from the graveyard", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["pick up the point|1"], graveyard: [GRAPHENE], resources: 1 }), { hero: "rhinar", hand: [] }],
    });
    s.play("pick up the point|1")
      .chooseCard(GRAPHENE)
      .chooseOption("pay 1");
    expect(s.state.players[0]!.weapons.some((card) => card.cardId === printingId(GRAPHENE))).toBe(true);
  });

  it("Pick Up the Point cannot retrieve Kiss of Death", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["pick up the point|1"], graveyard: ["kiss of death|1", GRAPHENE], resources: 1 }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("pick up the point|1");

    expect(projectStateFor(s.state, 0).pendingDecision?.optionCards?.map((card) => card?.cardId ?? null))
      .toEqual([null, printingId(GRAPHENE)]);
  });

  it("Up Sticks and Run retrieves and pumps the next dagger attack by +4", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["up sticks and run|1", BLUE], graveyard: [GRAPHENE], resources: 1 }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("up sticks and run|1") // go again
      .chooseCard(GRAPHENE) // retrieve
      .chooseOption("pay 1")
      .attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .expectAttackValue(5); // 1 base + 4
  });
});

describe("SAR — Orb-Weaver Spinneret", () => {
  it("equips a Graphene Chelicera and pumps the next stealth attack", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["orb-weaver spinneret|1", RED] }), { hero: "rhinar", hand: [] }],
    });
    s.play("orb-weaver spinneret|1"); // go again; 1 weapon slot was free
    expect(s.state.players[0]!.weapons.some((c) => c.cardId === printingId(GRAPHENE))).toBe(true);
    s.attackWithWeapon(GRAPHENE, { pitch: [RED] }).expectAttackValue(4); // 1 base + 3
  });
});

describe("SAR — equipment", () => {
  it("Stalker's Steps give a stealth attack go again", () => {
    const s = scenario({
      seats: [
        arakniSeat({ equipment: { ...NO_EQUIPMENT, legs: "stalker's steps|0" }, hand: ["mark the prey|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("mark the prey|1")
      .blockWith()
      .activate("stalker's steps|0")
      .settle()
      .expectNoEquipment(0, "legs")
      .expectAP(0, 1);
  });

  it("Prey Spotters marks in the reaction window, then the attack hit removes Mark", () => {
    const s = scenario({
      seats: [
        arakniSeat({ equipment: { ...NO_EQUIPMENT, head: "prey spotters|0" }, hand: [BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith()
      .activate("prey spotters|0")
      .settle()
      .expectLog("is marked")
      .expectLog("is no longer marked")
      .expectNoEquipment(0, "head");
    expect(markedCount(s, 1)).toBe(0);
  });
});

describe("SAR — reaction pumps", () => {
  it("Scar Tissue pumps a dagger attack and marks on hit", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["scar tissue|1", BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith()
      .react("scar tissue|1")
      .settle()
      .chooseOption("no") // leave Mark of the Huntsman equipped
      .expectFinalAttack(5) // 1 base + 3, then +1 now that they're marked (snapshot)
      .expectLog("is marked");
    expect(markedCount(s, 1)).toBe(1);
  });

  it("Spike with Bloodrot pumps a stealth attack action and creates Bloodrot Pox on hit", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark the prey|1", "spike with bloodrot|1", RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("mark the prey|1")
      .blockWith()
      .react("spike with bloodrot|1", { pitch: [RED] }) // cost 1
      .settle()
      .expectFinalAttack(7) // 3 base + 3, +1 now that they're marked (snapshot)
      .expectInZone(1, "bloodrot pox|0", "board");
  });

  it("Stains of the Redback costs {r} less against a marked hero and grants go again", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark the prey|1", "stains of the redback|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    mark(s, 1);
    s.play("mark the prey|1")
      .blockWith()
      .react("stains of the redback|1") // cost 1 − 1 = free
      .settle()
      .expectFinalAttack(7) // 3 base + 3 + 1 (marked hero, Web of Deceit)
      .expectAP(0, 1); // go again refunded
  });

  it("Two Sides to the Blade: stealth mode pumps and marks on hit", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark the prey|1", "two sides to the blade|1", RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("mark the prey|1") // stealth attack action — only the stealth mode is legal
      .blockWith()
      .react("two sides to the blade|1", { pitch: [RED] })
      .settle()
      .expectFinalAttack(7) // 3 base + 3, +1 now that they're marked (snapshot)
      .expectLog("is marked");
  });

  it("Night's Embrace gives stealth attacks +1{p} this turn", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark the prey|1", "night's embrace|3"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("mark the prey|1")
      .blockWith()
      .react("night's embrace|3")
      .settle()
      .expectFinalAttack(5); // 3 base + 1, +1 now that they're marked (snapshot)
  });

  it("Shred gives a defending card -2{d}", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark the prey|1", "shred|3"] }),
        { hero: "rhinar", hand: ["ravenous rabble|1"] },
      ],
    });
    s.play("mark the prey|1")
      .blockWith("ravenous rabble|1")
      .react("shred|3")
      .chooseCard("ravenous rabble|1")
      .expectFinalDefense(0) // 2 − 2
      .expectLife(1, 17); // the full 3 through
  });
});

describe("SAR — chaos actions", () => {
  it("Art of Desire: Body banishes their deck top and rewards a red banish", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["art of desire: body|1"], deck: [BLUE] }),
        { hero: "rhinar", hand: [], deck: [RED, BLUE] },
      ],
    });
    s.play("art of desire: body|1")
      .blockWith().settle()
      .expectInZone(1, RED, "banish") // their deck top banished
      .expectInZone(0, BLUE, "hand") // drew a card (red banish)
      .expectLife(0, 21); // gained 1{h}
  });

  it("Concoct Disorder loads both arsenals face-down and gets go again", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["concoct disorder|1", RED], deck: [BLUE, BLUE] }),
        { hero: "rhinar", hand: [], deck: [BLUE, BLUE] },
      ],
    });
    s.play("concoct disorder|1", { pitch: [RED] })
      .blockWith().settle()
      .expectAP(0, 1) // go again from the 2 arsenal puts
      .expectLog("face-down into their arsenal");
    expect(s.state.players[0]!.arsenal[0]?.faceDown).toBe(true);
    expect(s.state.players[1]!.arsenal[0]?.faceDown).toBe(true);
  });

  it("Hyper Inflation makes cards cost {r} more this turn", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["hyper inflation|1", "mark the prey|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("hyper inflation|1").blockWith().settle();
    expect(s.state.players[0]!.flags.costMoreThisTurn).toBe(1);
    expect(s.state.players[1]!.flags.costMoreThisTurn).toBe(1);
    // Mark the Prey (cost 0) now costs {r}: an empty-pitch play is rejected
    const prey = s.state.players[0]!.hand.find((c) => c.cardId === printingId("mark the prey|1"))!;
    const r = applyIntent(s.state, 0, { kind: "play-card", instanceId: prey.instanceId, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
  });

  it("Infect creates a Bloodrot Pox under the hit hero's control", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["infect|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("infect|1").blockWith().settle().expectInZone(1, "bloodrot pox|0", "board");
  });

  it("Mark of the Black Widow makes a marked hero banish a hand card", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark of the black widow|1"] }),
        { hero: "rhinar", hand: [RED, BLUE] },
      ],
    });
    mark(s, 1);
    s.play("mark of the black widow|1")
      .blockWith().settle()
      .chooseCard(RED) // Rhinar chooses their banish
      .expectInZone(1, RED, "banish");
  });

  it("Mark of the Funnel Web banishes a marked hero's arsenal card", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["mark of the funnel web|1"] }),
        { hero: "rhinar", hand: [], arsenal: ["wax on|1"] },
      ],
    });
    mark(s, 1);
    s.play("mark of the funnel web|1")
      .blockWith().settle()
      .expectZoneSize(1, "arsenal", 0)
      .expectInZone(1, "wax on|1", "banish");
    expect(s.state.pendingDecision).toBeNull();
  });

  it("Topsy Turvy sends top-of-deck puts to the bottom (Memorial Ground)", () => {
    const s = scenario({
      seats: [
        arakniSeat({
          equipment: { ...NO_EQUIPMENT, head: "topsy turvy|0" },
          hand: [BLUE],
        }),
        { hero: "rhinar", hand: ["memorial ground|2"], graveyard: ["bolt'n' shot|1"], deck: [BLUE, BLUE, BLUE] },
      ],
    });
    s.activate("topsy turvy|0") // until end of turn — so Rhinar must play in a window this turn
      .expectNoEquipment(0, "head")
      .attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith()
      .passPriority(); // Rhinar's reaction window
    s.react("memorial ground|2") // an instant — playable in the window
      .chooseCard("bolt'n' shot|1")
      .expectDeckBottom(1, "bolt'n' shot|1") // not the top — Topsy Turvy
      .settle();
    expect(s.state.players[1]!.deck[0]?.cardId).toBe(printingId(BLUE));
  });

  it("Reaper's Call marks from hand as an instant (discard cost)", () => {
    const s = scenario({
      seats: [arakniSeat({ hand: ["reaper's call|3", "mark the prey|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("mark the prey|1", { settle: false }); // the attack-declared window opens (the from-hand ability is live)
    s.activate("reaper's call|3") // discarded from hand
      .expectLog("is marked");
    expect(markedCount(s, 1)).toBe(1);
    s.settle();
  });
});

describe("SAR — traps", () => {
  it("Frailty Trap creates a Frailty under a go-again attacker", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: [BLUE] }),
        { hero: "rhinar", hand: ["frailty trap|1"] },
      ],
    });
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] }) // go again attack
      .blockWith()
      .passPriority() // Rhinar's reaction window
      .react("frailty trap|1")
      .settle()
      .expectInZone(0, "frailty|0", "board");
  });

  it("Lair of the Spider marks a go-again attacker", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: [BLUE] }),
        { hero: "rhinar", hand: ["lair of the spider|1"] },
      ],
    });
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith()
      .passPriority()
      .react("lair of the spider|1")
      .settle();
    expect(markedCount(s, 0)).toBe(1);
  });

  it("Den of the Spider marks an above-base attacker; Inertia Trap tokens it too", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["up sticks and run|1", BLUE], graveyard: [GRAPHENE], resources: 1 }),
        { hero: "rhinar", hand: ["den of the spider|1", "inertia trap|1"] },
      ],
    });
    s.play("up sticks and run|1")
      .chooseCard(GRAPHENE)
      .chooseOption("pay 1")
      .attackWithWeapon(HUNTSMAN, { pitch: [BLUE] }) // 1 + 4 = above base
      .blockWith()
      .passPriority()
      .react("inertia trap|1")
      .settle();
    s.expectInZone(0, "inertia|0", "board");
    expect(markedCount(s, 0)).toBe(0); // Den wasn't played
  });

  it("Den of the Spider marks the attacking hero when the attack is above base", () => {
    const s = scenario({
      seats: [
        arakniSeat({ hand: ["up sticks and run|1", BLUE], graveyard: [GRAPHENE], resources: 1 }),
        { hero: "rhinar", hand: ["den of the spider|1"] },
      ],
    });
    s.play("up sticks and run|1")
      .chooseCard(GRAPHENE)
      .chooseOption("pay 1")
      .attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith()
      .passPriority()
      .react("den of the spider|1")
      .settle();
    expect(markedCount(s, 0)).toBe(1);
  });
});

describe("SAR — the brood heroes", () => {
  it("Arakni, Black Widow: discard an Assassin card for +3{p}, stealth banishes a hand card on hit", () => {
    const s = scenario({
      seats: [
        arakniSeat({ heroKey: "arakni, black widow|0", hand: ["mark the prey|1", "art of desire: body|1"] }),
        { hero: "rhinar", hand: [RED] },
      ],
    });
    s.play("mark the prey|1") // Assassin stealth attack
      .blockWith()
      .activate("arakni, black widow|0", { settle: false })
      .chooseCard("art of desire: body|1") // discard cost
      .chooseCard(RED) // Rhinar banishes a hand card
      .expectFinalAttack(6) // 3 base + 3
      .expectInZone(1, RED, "banish");
  });

  it("Arakni, Tarantula: daggers drain 1{h} on hit", () => {
    const s = scenario({
      seats: [arakniSeat({ heroKey: "arakni, tarantula|0", hand: [BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(HUNTSMAN, { pitch: [BLUE] })
      .blockWith().settle()
      .chooseOption("no") // leave Mark of the Huntsman equipped
      .expectLife(1, 18) // 1 combat + 1 life loss
      .expectLog("loses 1 life");
  });

  it("Arakni, Redback: discard for +3{p} and go again on a stealth attack", () => {
    const s = scenario({
      seats: [
        arakniSeat({ heroKey: "arakni, redback|0", hand: ["mark the prey|1", "art of desire: body|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("mark the prey|1")
      .blockWith()
      .activate("arakni, redback|0", { settle: false })
      .chooseCard("art of desire: body|1")
      .expectFinalAttack(6)
      .expectAP(0, 1); // go again refunded
  });

  it("Arakni, Orb-Weaver discounts Graphene and equips one via its ability", () => {
    const s = scenario({
      seats: [
        arakniSeat({ heroKey: "arakni, orb-weaver|0", weapons: [GRAPHENE], hand: ["art of desire: body|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    // Graphene's attack costs {r} less: free activation
    s.attackWithWeapon(GRAPHENE).blockWith().settle()
      .expectLife(1, 19); // 1 damage
    // the instant ability: discard an Assassin card → equip a second Graphene
    s.state.players[0]!.actionPoints = 1; // a go-again refund would provide this
    s.activate("arakni, orb-weaver|0", { settle: false })
      .chooseCard("art of desire: body|1");
    expect(s.state.players[0]!.weapons.filter((c) => c.cardId === printingId(GRAPHENE))).toHaveLength(2);
  });
});
