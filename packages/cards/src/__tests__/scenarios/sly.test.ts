import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario, type SeatSpec } from "../harness.js";

/**
 * Scenarios for the SLY (Silver Age: Lyath Goldmane precon) pool: the crowd
 * boo mechanic, Lyath's base-{p}/{d} halving, Suspense auras, Clash, the
 * Might/Confidence tokens, and the Reviled attack cycle.
 *
 * Lyath halves (rounded up) the base {p} and {d} of cards he controls, so all
 * expected values below account for that (e.g. Short Shrift's 3{p} becomes 2).
 */

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function lyath(spec: Partial<SeatSpec> = {}): SeatSpec {
  return {
    hero: "rhinar",
    heroKey: "lyath goldmane|0",
    weapons: [],
    ...spec,
    equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) },
  };
}

function foe(spec: Partial<SeatSpec> = {}): SeatSpec {
  return {
    hero: "rhinar",
    ...spec,
    equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) },
  };
}

describe("SLY — Lyath's halving", () => {
  it("halves the base {p} of his attack action cards (rounded up)", () => {
    const g = scenario({
      seats: [lyath({ hand: ["short shrift|2"] }), foe({})],
    });
    g.play("short shrift|2").expectAttackValue(2); // 3 halved
  });

  it("Titan's Fist does not give its conditional +1 to other attacks", () => {
    const g = scenario({
      seats: [
        lyath({
          weapons: ["titan's fist|0"],
          hand: ["short shrift|2"],
          pitch: ["power play|3"],
        }),
        foe({}),
      ],
    });
    g.play("short shrift|2").expectAttackValue(2);
  });

  it("Titan's Fist gives its conditional +1 only to its own attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["titan's fist|0"],
          resources: 3,
          pitch: ["power play|3"],
          hand: ["head jab|1"],
        },
        foe({}),
      ],
    });

    g.play("head jab|1")
      .expectAttackValue(3)
      .blockWith()
      .settle()
      .attackWithWeapon("titan's fist|0")
      .expectAttackValue(4);
  });

  it("'above base' does not fulfill itself", () => {
    const g = scenario({
      seats: [lyath({ hand: ["short shrift|2"] }), foe({})],
    });
    g.play("short shrift|2").expectAttackValue(2); // no buffs: the +1 does not trigger itself
  });

  it("does not halve the opponent's cards", () => {
    const g = scenario({
      seats: [lyath({}), foe({ hand: ["short shrift|2"] })],
      active: 1,
    });
    g.play("short shrift|2").expectAttackValue(3);
  });

  it("halves the base {d} of his defending cards", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["mocking blow|1"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2"); // 6{p}
    const mockingBlow = g.state.players[0]!.hand[0]!;
    g.doRaw({ kind: "stage-defenders", instanceIds: [mockingBlow.instanceId] });
    expect(projectStateFor(g.state, 0).pendingDecision?.stagedDefense).toBe(2);
    g.blockWith("mocking blow|1") // 3{d} halved → 2
      .settle()
      .expectFinalDefense(2)
      .expectLife(0, 16); // 6 - 2 = 4 damage
  });

  it("staging includes Lyath's activated +1 after halving base defense", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["mocking blow|1", "edge of their seats|3"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2", { settle: false })
      .passPriority()
      .activate("lyath goldmane|0", { pitch: ["edge of their seats|3"] });
    const mockingBlow = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("mocking blow|1"),
    )!;
    g.doRaw({ kind: "stage-defenders", instanceIds: [mockingBlow.instanceId] });
    expect(projectStateFor(g.state, 0).pendingDecision?.stagedDefense).toBe(3);
  });

  it("can stage and defend with an off-hand shield in a weapon zone", () => {
    const g = scenario({
      seats: [
        lyath({ weapons: ["steelbraid buckler|0"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2");
    const buckler = g.state.players[0]!.weapons[0]!;
    expect(legalIntents(g.state, 0)).toContainEqual({
      kind: "stage-defenders",
      instanceIds: [buckler.instanceId],
    });
    g.doRaw({ kind: "stage-defenders", instanceIds: [buckler.instanceId] });
    expect(projectStateFor(g.state, 0).pendingDecision?.stagedDefense).toBe(1);
    g.doRaw({ kind: "defend", instanceIds: [buckler.instanceId] })
      .settle()
      .expectFinalDefense(1);
  });
});

describe("SLY — Lyath hero abilities", () => {
  it("instant ability boos him, creates a Might token, and costs 2", () => {
    const g = scenario({
      seats: [lyath({ hand: ["mocking blow|1", "mocking blow|2"] }), foe({})],
    });
    g.activate("lyath goldmane|0", { pitch: ["mocking blow|1", "mocking blow|2"] })
      .expectLog("The crowd boos Lyath Goldmane")
      .expectInZone(0, "might|0", "board")
      .expectAP(0, 1); // instant: no action point spent
  });

  it("is usable in the defense reaction window and pumps defending action cards", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["mocking blow|1", "edge of their seats|3"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2"); // 6{p}
    g.blockWith("mocking blow|1"); // 2{d} after halving
    g.passPriority(); // attacker passes → defense reaction window
    g.activate("lyath goldmane|0", { pitch: ["edge of their seats|3"] })
      .expectLog("The crowd boos Lyath Goldmane")
      .expectInZone(0, "might|0", "board")
      .expectFinalDefense(3) // 2 + 1 from Lyath's ability
      .expectLife(0, 17);
  });

  it("Might is destroyed at the start of his turn and buffs the next attack", () => {
    const g = scenario({
      seats: [lyath({ board: ["might|0"], hand: ["short shrift|2"] }), foe({})],
    });
    g.endTurn() // opponent's turn
      .endTurn() // back to Lyath: Might's start-of-turn trigger resolves
      .expectNotInZone(0, "might|0", "board");
    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("might|0"),
      label: "+1 attack · next attack",
    });
    g.play("short shrift|2").expectAttackValue(4); // 2 + 1 (Might) + 1 (above base)
  });

  it("distinct simultaneous start-of-turn triggers: the owner picks the resolution order", () => {
    const g = scenario({
      seats: [lyath({ board: ["might|0", "confidence|0"] }), foe({})],
    });
    g.endTurn(); // opponent's turn, settled
    g.doRaw({ kind: "pass" }); // opponent ends → Lyath's start-of-turn triggers queue
    if (g.state.pendingDecision?.kind === "arsenal") {
      g.doRaw({ kind: "choose", optionId: "pass" });
    }
    if (g.state.pendingDecision?.kind === "priority-window") {
      // Lyath's structurally available instant ability is advertised even
      // without enough resources, so explicitly yield that priority window.
      g.doRaw({ kind: "pass" });
    }
    // both triggers collected; distinct cards → an ordering decision, not a window
    const pd = g.state.pendingDecision!;
    expect(pd.chooseHook).toBe("trigger-order");
    expect(pd.kind).toBe("order-triggers");
    expect(pd.player).toBe(0);
    expect(pd.options).toHaveLength(2);
    const [mightId, confidenceId] = g.state.players[0]!.board.map((c) => c.instanceId);
    expect(legalIntents(g.state, 0)).toContainEqual({
      kind: "order-triggers",
      optionIds: [`${mightId}:0`, `${confidenceId}:0`],
    });
    expect(projectStateFor(g.state, 0).pendingDecision).toMatchObject({
      kind: "order-triggers",
      options: [`${mightId}:0`, `${confidenceId}:0`],
      optionLabels: pd.optionLabels,
    });
    expect(projectStateFor(g.state, 1).pendingDecision).not.toHaveProperty("optionLabels");
    const invalid = applyIntent(g.state, 0, {
      kind: "order-triggers",
      optionIds: [`${confidenceId}:0`, `${confidenceId}:0`],
    });
    expect(invalid).toEqual({ ok: false, error: "invalid trigger order" });
    g.doRaw({
      kind: "order-triggers",
      optionIds: [`${confidenceId}:0`, `${mightId}:0`],
    });
    // The submitted order is honored, but the Start Phase resolves both
    // layers automatically without opening a priority window.
    expect(g.state.phase).toBe("action");
    expect(g.state.pendingDecision).toBeNull();
    expect(g.state.stack).toHaveLength(0);
    g.expectZoneSize(0, "board", 0);
  });

  it("taps himself — stays tapped through his next turn, untapping only in his own end phase", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["mocking blow|1", "edge of their seats|3"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    const heroId = g.state.players[0]!.hero.instanceId;
    g.play("raging onslaught|2");
    g.blockWith("mocking blow|1");
    g.passPriority(); // attacker passes → defense reaction window
    g.activate("lyath goldmane|0", { pitch: ["edge of their seats|3"] }); // settles the combat
    expect(g.state.players[0]!.hero.tapped).toBe(true);
    g.endTurn(); // opponent's end phase: only the opponent untaps
    expect(g.state.players[0]!.hero.tapped).toBe(true); // still tapped on his own turn
    const reactivate = legalIntents(g.state, 0).filter(
      (i) => i.kind === "activate-ability" && i.sourceInstanceId === heroId,
    );
    expect(reactivate).toEqual([]);
    g.endTurn(); // his own end phase: untaps
    expect(g.state.players[0]!.hero.tapped).toBeUndefined();
  });
});

describe("SLY — the crowd boos", () => {
  it("Mocking Blow boos when ahead on life and gets +4 from being booed", () => {
    const g = scenario({
      seats: [lyath({ hand: ["mocking blow|1"] }), foe({ life: 10 })],
    });
    g.play("mocking blow|1")
      .expectLog("The crowd boos Lyath Goldmane")
      .expectInZone(0, "might|0", "board")
      .expectAttackValue(5); // 1 (halved) + 4
  });

  it("Mocking Blow does not boo when behind", () => {
    const g = scenario({
      seats: [lyath({ hand: ["mocking blow|1"], life: 10 }), foe({ life: 20 })],
    });
    g.play("mocking blow|1").expectNoLog("The crowd boos").expectAttackValue(1);
  });

  it("Line Crossers makes tied life count as having more", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["mocking blow|1"], equipment: { arms: "line crossers|0" } }),
        foe({}),
      ],
    });
    g.play("mocking blow|1").expectLog("The crowd boos Lyath Goldmane").expectAttackValue(5);
  });

  it("Booze! enters the arena, boos twice, and is destroyed at turn start", () => {
    const g = scenario({
      seats: [lyath({ hand: ["booze!|3"] }), foe({})],
    });
    g.play("booze!|3")
      .expectLog("The crowd boos Lyath Goldmane") // enters the arena
      .expectInZone(0, "booze!|3", "board")
      .expectInZone(0, "might|0", "board")
      .expectAP(0, 1); // go again
    g.endTurn().endTurn(); // start of Lyath's next turn: destroyed → boos again
    g.expectNotInZone(0, "booze!|3", "board")
      // both Might tokens fired too: one new Might from the leaving-boo remains
      .expectZoneSize(0, "board", 1)
      .expectInZone(0, "might|0", "board");
  });

  it("Villainous Pose buffs the next attack and boos", () => {
    const g = scenario({
      seats: [lyath({ hand: ["villainous pose|1", "short shrift|2", "mocking blow|3"] }), foe({})],
    });
    g.play("villainous pose|1", { pitch: ["mocking blow|3"] })
      .expectLog("The crowd boos Lyath Goldmane")
      .expectAP(0, 1); // go again
    g.play("short shrift|2").expectAttackValue(7); // 2 + 4 + 1 (above base)
  });

  it("Sadistic Scowl buffs the next attack and intimidates", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["sadistic scowl|1", "goon tactics|3"] }),
        foe({ hand: ["raging onslaught|1"] }),
      ],
    });
    g.play("sadistic scowl|1", { pitch: ["goon tactics|3"] })
      .expectAP(0, 1) // go again
      .expectPendingReturn(1, 1); // intimidated card banished face down
  });

  it("Prime the Crowd buffs the next attack action and boos each Reviled hero", () => {
    const g = scenario({
      seats: [lyath({ hand: ["prime the crowd|1", "short shrift|2", "mocking blow|3"] }), foe({})],
    });
    g.play("prime the crowd|1", { pitch: ["mocking blow|3"] })
      .expectLog("The crowd boos Lyath Goldmane")
      .expectInZone(0, "might|0", "board")
      .expectAP(0, 1); // go again
    g.play("short shrift|2").expectAttackValue(7); // 2 + 4 + 1 (above base)
  });
});

describe("SLY — Suspense auras", () => {
  it("Tension in the Air enters the arena, ticks down, then buffs the next attack", () => {
    const g = scenario({
      seats: [
        lyath({
          hand: ["tension in the air|1", "mocking blow|3"],
          deck: ["short shrift|2", "short shrift|2", "short shrift|2", "short shrift|2", "short shrift|2"],
        }),
        foe({}),
      ],
    });
    g.play("tension in the air|1", { pitch: ["mocking blow|3"] })
      .expectInZone(0, "tension in the air|1", "board");
    g.endTurn().endTurn() // start of Lyath's 2nd turn: 2 → 1 counter
      .expectLog("a suspense counter is removed (1 left)")
      .expectInZone(0, "tension in the air|1", "board");
    g.endTurn().endTurn() // start of Lyath's 3rd turn: 1 → 0 → destroyed
      .expectLog("a suspense counter is removed (0 left)")
      .expectNotInZone(0, "tension in the air|1", "board");
    g.play("short shrift|2").expectAttackValue(7); // 2 + 4 + 1 (above base)
  });

  it("The Suspense is Killing Me gives the first attack each turn +1{p}", () => {
    const g = scenario({
      seats: [
        lyath({
          board: ["the suspense is killing me|3"],
          weapons: ["titan's fist|0"],
          hand: ["sadistic scowl|1", "goon tactics|3"],
        }),
        foe({}),
      ],
    });
    g.attackWithWeapon("titan's fist|0", { pitch: ["sadistic scowl|1", "goon tactics|3"] })
      .expectAttackValue(4); // 3 halved → 2, +1 first attack, +1 cost-3 card pitched
  });

  it("Act of Glory buffs the next attack when it leaves the arena", () => {
    const g = scenario({
      seats: [lyath({ board: ["act of glory|1"], hand: ["short shrift|2"] }), foe({})],
    });
    g.endTurn().endTurn(); // start-of-turn trigger destroys it (no counters in setup)
    g.expectNotInZone(0, "act of glory|1", "board");
    g.play("short shrift|2").expectAttackValue(9); // 2 + 6 + 1 (above base)
  });
});

describe("SLY — equipment", () => {
  it("Stonewall Impasse's clash bonus applies when Temper resolves", () => {
    const g = scenario({
      seats: [
        lyath({ deck: ["raging onslaught|2"], equipment: { arms: "stonewall impasse|0" } }),
        foe({ hand: ["raging onslaught|2"], deck: ["head jab|2"] }), // 6 halved → 3 vs 2{p}: Lyath wins
      ],
      active: 1,
    });
    g.attackWithWeapon();
    g.blockWith("stonewall impasse|0")
      .settle()
      .expectLog("wins the clash")
      .expectFinalDefense(2); // 1 (halved) + 1
    g.endTurn(); // 2{d} during close - counter = 1{d}; the bonus then expires
    g.expectEquipped(0, "arms", "stonewall impasse|0").expectEquipmentDefense(0, "arms", 0);
    expect(g.state.players[0]!.equipment.arms?.defCounters).toBe(1);
  });

  it("clash reveals are halved too: Lyath's 6{p} counts as 3 and loses to a 4", () => {
    const g = scenario({
      seats: [
        lyath({ deck: ["raging onslaught|2"], equipment: { arms: "stonewall impasse|0" } }),
        foe({ hand: ["raging onslaught|2"], deck: ["raging onslaught|3"] }), // 6 → 3 vs 4: foe wins
      ],
      active: 1,
    });
    g.attackWithWeapon();
    g.blockWith("stonewall impasse|0")
      .settle()
      .expectLog("Rhinar wins the clash") // the attacking hero, not Lyath
      .expectFinalDefense(1); // no clash-win bonus
  });

  it("Stonewall Impasse gets nothing on a tied clash", () => {
    const g = scenario({
      seats: [
        lyath({ deck: ["raging onslaught|2"], equipment: { arms: "stonewall impasse|0" } }),
        foe({ hand: ["raging onslaught|2"], deck: ["short shrift|2"] }), // 6 halved → 3 vs 3: tie
      ],
      active: 1,
    });
    g.attackWithWeapon();
    g.blockWith("stonewall impasse|0")
      .settle()
      .expectLog("The clash is a tie")
      .expectFinalDefense(1);
  });

  it("Stand Strong creates a Confidence token when an aura of suspense is in play", () => {
    const g = scenario({
      seats: [
        lyath({
          board: ["tension in the air|1"],
          equipment: { legs: "stand strong|0" },
          hand: ["goon tactics|3"],
        }),
        foe({}),
      ],
    });
    g.activate("stand strong|0", { pitch: ["goon tactics|3"] })
      .expectNoEquipment(0, "legs")
      .expectInZone(0, "confidence|0", "board")
      .expectAP(0, 1); // go again
  });

  it("Confidence limits the next attack to 2 non-block defenders", () => {
    const g = scenario({
      seats: [
        lyath({ board: ["confidence|0"], hand: ["short shrift|2"] }),
        foe({
          hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"],
          equipment: { arms: "ironrot gauntlet|0" },
        }),
      ],
    });
    g.endTurn().endTurn(); // Confidence's start-of-turn trigger resolves
    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("confidence|0"),
      label: "max 2 non-block defenders · next attack",
    });
    g.play("short shrift|2");
    // 2 hand cards + 1 equipment = 3 non-block defenders: illegal
    expect(() =>
      g.blockWith("raging onslaught|2", "raging onslaught|2", "ironrot gauntlet|0"),
    ).toThrow(/no legal defend intent/);
    g.blockWith("raging onslaught|2", "raging onslaught|2")
      .settle()
      .expectFinalDefense(6);
  });

  it("Blade Beckoner Plating gets +1{d} while defending a weapon attack", () => {
    const g = scenario({
      seats: [
        lyath({ equipment: { chest: "blade beckoner plating|0" } }),
        foe({ hand: ["raging onslaught|2"] }), // pitches it for the Bone Basher attack
      ],
      active: 1,
    });
    g.attackWithWeapon(); // Bone Basher, 4{p}
    g.blockWith("blade beckoner plating|0")
      .settle()
      .expectFinalDefense(2); // 1 (halved) + 1
  });
});

describe("SLY — attacks and defense", () => {
  it("Drag Down gives the defended attack -3{p}", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["drag down|1"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2", "sigil of solace|1"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2"); // 6{p}
    g.blockWith().passPriority().react("drag down|1", { settle: false });
    g.passPriority().passPriority();
    g.expectAttackValue(6);
    expect(g.state.stack[0]?.engineEffect?.kind).toBe("on-defend-hook");
    g.settle().expectFinalAttack(3);
  });

  it("Brothers in Arms pays {r} for +2{d}", () => {
    const g = scenario({
      seats: [
        foe({ hand: ["brothers in arms|3"], resources: 1 }),
        lyath({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2"); // 6{p}
    g.blockWith("brothers in arms|3").settle();
    g.chooseOption("pay 1")
      .expectResources(0, 0)
      .expectFinalDefense(4); // 2 + 2 (opponent's card: not halved)
  });

  it("Full of Bravado creates a Confidence token when it attacks with an aura of suspense", () => {
    const g = scenario({
      seats: [
        lyath({ board: ["tension in the air|1"], hand: ["full of bravado|3", "goon tactics|3"] }),
        foe({}),
      ],
    });
    g.play("full of bravado|3", { pitch: ["goon tactics|3"] })
      .expectAttackValue(3) // 5 halved
      .expectInZone(0, "confidence|0", "board");
  });

  it("Goon Beatdown gets +3{p} with 3 auras and boos on hit", () => {
    const g = scenario({
      seats: [
        lyath({ board: ["booze!|3", "might|0", "confidence|0"], hand: ["goon beatdown|3"] }),
        foe({}),
      ],
    });
    g.play("goon beatdown|3").expectAttackValue(4); // 1 (halved) + 3
    g.blockWith().settle().expectLog("The crowd boos Lyath Goldmane");
  });

  it("Goon Tactics destroys the top card of their deck on hit", () => {
    const g = scenario({
      seats: [
        lyath({ board: ["booze!|3", "might|0", "confidence|0"], hand: ["goon tactics|3"] }),
        foe({ deck: ["raging onslaught|1"] }),
      ],
    });
    g.play("goon tactics|3");
    g.blockWith().settle().expectInZone(1, "raging onslaught|1", "graveyard");
  });

  it("Power Play gets +5{p} from arsenal, nothing from hand", () => {
    const fromArsenal = scenario({
      seats: [lyath({ arsenal: ["power play|3"], hand: ["mocking blow|3"] }), foe({})],
    });
    fromArsenal
      .play("power play|3", { fromArsenal: true, pitch: ["mocking blow|3"] })
      .expectAttackValue(6); // 1 + 5
    const fromHand = scenario({
      seats: [lyath({ hand: ["power play|3", "mocking blow|3"] }), foe({})],
    });
    fromHand.play("power play|3", { pitch: ["mocking blow|3"] }).expectAttackValue(1);
  });

  it("Oasis Respite shields 4 damage and gains 1 life while behind", () => {
    // the shield lasts the turn it is played, so it is played as an instant on
    // the opponent's turn, before their attack resolves
    const g = scenario({
      seats: [
        lyath({ hand: ["oasis respite|1", "mocking blow|3"], life: 10 }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2"); // 6{p}
    g.blockWith();
    g.passPriority(); // attacker passes → defense reaction window
    g.react("oasis respite|1", { pitch: ["mocking blow|3"] });
    g.chooseOption("Lyath") // target hero
      .chooseCard("raging onslaught|2") // the source: the attacking card itself
      .chooseOption("yes") // behind on life: gain 1
      .expectLog("is prevented (4)") // 6 - 4 shield = 2 damage
      .expectLife(0, 9);
  });

  it("Oasis Respite prevents only the chosen source's damage (object, not name)", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["oasis respite|1", "mocking blow|3"] }),
        foe({ hand: ["head jab|2", "raging onslaught|3"] }),
      ],
      active: 1,
    });
    g.play("head jab|2"); // 2{p}, go again — a different source than the shielded one
    g.blockWith();
    g.passPriority(); // → defense reaction window
    g.react("oasis respite|1", { pitch: ["mocking blow|3"] });
    g.chooseOption("Lyath").chooseCard("bone basher|0"); // shield against the weapon, not this attack
    g.settle().expectLife(0, 18); // Head Jab hits for 2 — the shield doesn't cover it
    g.attackWithWeapon("bone basher|0", { pitch: ["raging onslaught|3"] });
    g.blockWith().settle().expectLife(0, 18); // 4 damage, all prevented
  });

  it("Oasis Respite can shield the opponent; their controller decides the life gain", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["oasis respite|1", "mocking blow|3"], life: 20 }),
        foe({ hand: [], life: 15 }),
      ],
    });
    g.play("oasis respite|1", { pitch: ["mocking blow|3"] });
    g.chooseOption("Rhinar") // target the opposing hero
      .chooseCard("bone basher|0")
      .chooseOption("yes") // Rhinar is behind: their controller gains 1
      .expectLife(1, 16);
    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 1,
      cardId: printingId("oasis respite|1"),
      label: "prevent next 4 damage from Bone Basher · this turn",
    });
  });

  it("Concealed Object pumps an attack by 1 and is destroyed at end of turn", () => {
    const g = scenario({
      seats: [lyath({ hand: ["concealed object|3", "short shrift|2"] }), foe({})],
    });
    g.play("concealed object|3")
      .expectInZone(0, "concealed object|3", "board")
      .expectLog("The crowd boos Lyath Goldmane");
    g.play("short shrift|2");
    g.blockWith();
    g.activate("concealed object|3").expectFinalAttack(4); // 2 + 1 (pump) + 1 (above base)
    g.endTurn().expectNotInZone(0, "concealed object|3", "board");
  });
});

describe("SLY — crush cycle", () => {
  it("Short Shrift crush makes the opponent discard a card of their choice", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["villainous pose|1", "short shrift|2", "mocking blow|3"] }),
        foe({ hand: ["raging onslaught|1"] }),
      ],
    });
    g.play("villainous pose|1", { pitch: ["mocking blow|3"] });
    g.play("short shrift|2").expectAttackValue(7); // 2 + 4 + 1 (above base)
    g.blockWith().settle(); // 7 damage ≥ 4 → crush
    g.chooseCard("raging onslaught|1").expectInZone(1, "raging onslaught|1", "graveyard");
  });

  it("Walk in My Shoes crush halves the opponent's attack actions until end of their next turn", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["villainous pose|1", "walk in my shoes|2", "mocking blow|3"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
    });
    g.play("villainous pose|1", { pitch: ["mocking blow|3"] });
    g.play("walk in my shoes|2");
    g.blockWith().settle(); // 7 damage ≥ 4 → crush
    g.endTurn(); // the debuff survives the turn boundary
    g.play("raging onslaught|2").expectAttackValue(3); // 6 halved (opponent has no Lyath)
  });

  it("Wee Wrecking Ball crush destroys a card in their arsenal", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["villainous pose|1", "wee wrecking ball|2", "mocking blow|3"] }),
        foe({ arsenal: ["raging onslaught|1"] }),
      ],
    });
    g.play("villainous pose|1", { pitch: ["mocking blow|3"] });
    g.play("wee wrecking ball|2");
    g.blockWith()
      .settle()
      .expectZoneSize(1, "arsenal", 0)
      .expectInZone(1, "raging onslaught|1", "graveyard");
  });
});

describe("SLY — Brothers in Arms", () => {
  it("pitches when its defend trigger resolves to pay the {r}", () => {
    const g = scenario({
      seats: [
        lyath({ hand: ["brothers in arms|3", "edge of their seats|3"] }),
        foe({ hand: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2"] }),
      ],
      active: 1,
    });
    g.play("raging onslaught|2"); // 6{p}
    const bia = g.state.players[0]!.hand.find(
      (c) => c.cardId === printingId("brothers in arms|3"),
    )!;
    g.doRaw({ kind: "stage-defenders", instanceIds: [bia.instanceId] });
    // Declaring the defense does not pitch for a cost that only exists when
    // the triggered layer resolves.
    const legal = legalIntents(g.state, 0).filter(
      (i) =>
        i.kind === "defend" &&
        i.instanceIds.includes(bia.instanceId),
    );
    expect(legal).toHaveLength(1);
    expect("pitchInstanceIds" in legal[0]!).toBe(false);
    const r = applyIntent(g.state, 0, legal[0]!);
    expect(r.ok).toBe(true);
    if (r.ok) g.state = r.state;
    g.expectInZone(0, "edge of their seats|3", "hand").settle();
    expect(g.state.pendingDecision?.options?.some((option) =>
      option.toLowerCase().includes("pitch edge of their seats")
    )).toBe(true);
    g.chooseOption("pitch edge of their seats")
      .expectInZone(0, "edge of their seats|3", "pitch")
      .expectLog("Brothers in Arms gets +2{d}")
      .expectFinalDefense(3) // 2 halved to 1, +2 from the payment
      .expectResources(0, 2); // 3 pitched - 1 paid
  });
});
