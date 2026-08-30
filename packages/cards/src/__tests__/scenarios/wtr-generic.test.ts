import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents } from "@fyendal/engine";
import { printingId, scenario, type Scenario } from "../harness.js";

/**
 * Scenarios for the WTR generic pool. These cards are class-agnostic, so we
 * borrow Dorinthea (sword weapon) and Rhinar (club weapon) as convenient hosts.
 * Pitch fodder: "raging onslaught|2" (yellow), "wrecker romp|3" (blue).
 */

/** Play a card from the active player's arsenal (the harness only exposes hand plays). */
function playFromArsenal(g: Scenario, key: string): Scenario {
  const seat = g.state.activePlayer;
  const id = printingId(key);
  const card = g.state.players[seat]!.arsenal.find((c) => c.cardId === id);
  if (!card) throw new Error(`no "${key}" in seat ${seat}'s arsenal`);
  const r = applyIntent(g.state, seat, {
    kind: "play-from-arsenal",
    instanceId: card.instanceId,
    pitchInstanceIds: [],
  });
  if (!r.ok) throw new Error(`play-from-arsenal for "${key}" rejected: ${r.error}`);
  g.state = r.state;
  return g.settle();
}

/** Choose a specific hand card in an open choose-target decision. */
function chooseHandCard(g: Scenario, seat: number, key: string): Scenario {
  const id = printingId(key);
  const card = g.state.players[seat]!.hand.find((c) => c.cardId === id);
  if (!card) throw new Error(`no "${key}" in seat ${seat}'s hand`);
  const r = applyIntent(g.state, seat, { kind: "choose", optionId: String(card.instanceId) });
  if (!r.ok) throw new Error(`choose "${key}" rejected: ${r.error}`);
  g.state = r.state;
  return g.settle();
}

describe("WTR generic — attacks", () => {
  it("Enlightened Strike restores its mode choice without retaining go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["enlightened strike|1", "raging onslaught|2"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("enlightened strike|1").chooseCard("raging onslaught|2");
    const modeSnapshot = g.state;
    expect(modeSnapshot.pendingDecision?.chooseHook).toBe("estrike-mode");
    expect(modeSnapshot.chain).toHaveLength(0);
    expect(legalIntents(modeSnapshot, 0).some((intent) => intent.kind === "pass")).toBe(false);

    const goAgain = applyIntent(modeSnapshot, 0, { kind: "choose", optionId: "go again" });
    expect(goAgain.ok).toBe(true);
    if (!goAgain.ok) return;
    expect(goAgain.state.chain.at(-1)?.goAgain).toBe(true);

    const plusTwo = applyIntent(modeSnapshot, 0, { kind: "choose", optionId: "+2" });
    expect(plusTwo.ok).toBe(true);
    if (!plusTwo.ok) return;
    expect(plusTwo.state.chain.at(-1)?.goAgain).toBe(false);
    g.state = plusTwo.state;
    g.expectAttackValue(7);

    const draw = applyIntent(modeSnapshot, 0, { kind: "choose", optionId: "draw" });
    expect(draw.ok).toBe(true);
    if (!draw.ok) return;
    expect(draw.state.chain.at(-1)?.goAgain).toBe(false);
    expect(draw.state.players[0]!.hand).toHaveLength(1);
  });

  it("Barraging Brawnhide gains +1 while defended by fewer than 2 non-equipment cards", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["barraging brawnhide|1", "wrecker romp|3"] },
        { hero: "dorinthea", hand: ["sink below|1"] },
      ],
    });
    g.play("barraging brawnhide|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(8) // 7 + 1
      .blockWith()
      .passPriority()
      .react("sink below|1")
      .chooseOption("pass")
      .settle()
      .expectFinalAttack(8)
      .expectLife(1, 16); // 20 - (8 - 4) = 16
  });

  it("Demolition Crew requires revealing a cost-2+ card and has dominate", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["demolition crew|1", "raging onslaught|2", "wrecker romp|3"] },
        { hero: "dorinthea", hand: ["sink below|1", "sink below|1"] },
      ],
    });
    g.play("demolition crew|1")
      .expectLog("reveals Raging Onslaught (cost 2 or greater)")
      .expectAttackValue(6)
      // Dominate means only 1 card from hand may defend
      .blockWith()
      .passPriority()
      .react("sink below|1")
      .chooseOption("pass")
      .settle()
      .expectFinalAttack(6)
      .expectLife(1, 18); // 20 - (6 - 4) = 18
  });

  it("Drone of Brutality can be played (replacement effect is TODO)", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["drone of brutality|1", "wrecker romp|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("drone of brutality|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLife(1, 14);
  });

  it("Flock of the Feather Walkers reveals a cheap card and creates a Quicken", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["flock of the feather walkers|2", "snatch|1", "raging onslaught|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("flock of the feather walkers|2")
      .expectLog("reveals Snatch (cost 1 or less)")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectInZone(0, "quicken|0", "board")
      .expectLife(1, 16);
  });

  it("Nimble Strike banishes Nimblism from graveyard for +1 and go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["nimble strike|1", "raging onslaught|2"],
          graveyard: ["nimblism|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("nimble strike|1")
      .expectLog("banishes Nimblism from graveyard")
      .expectAttackValue(5) // 4 + 1
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectInZone(0, "nimblism|1", "banish")
      .expectLife(1, 15);
  });

  it("Scar for a Scar gains go again when at less life", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", life: 15, hand: ["scar for a scar|1"] },
        { hero: "dorinthea", life: 20, hand: [] },
      ],
    });
    g.play("scar for a scar|1", { settle: false });
    expect(g.state.stack[0]).toMatchObject({
      label: "Gain go again",
      triggerEventCard: { cardId: printingId("scar for a scar|1") },
    });
    g.passPriority()
      .passPriority()
      .expectLog("gains go again (less life than opponent)")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectLife(1, 16);
  });

  it("Scour the Battlescape bottoms a card and draws, and gains go again from arsenal", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["raging onslaught|2"],
          arsenal: ["scour the battlescape|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    playFromArsenal(g, "scour the battlescape|1")
      .expectLog("gains go again (played from arsenal)")
      .expectAttackValue(3)
      .chooseOption("pass") // decline the optional bottom/draw
      .blockWith() // no defenders
      .settle()
      .expectAP(0, 1)
      .expectLife(1, 17);

    const g2 = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["raging onslaught|2"],
          arsenal: ["scour the battlescape|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    playFromArsenal(g2, "scour the battlescape|1");
    chooseHandCard(g2, 0, "raging onslaught|2")
      .expectDeckBottom(0, "raging onslaught|2")
      .expectHandSize(0, 1) // drew Wrecker Romp
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectLife(1, 17);
  });

  it("Snatch draws a card when it hits", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"], deck: ["raging onslaught|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("snatch|1")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectHandSize(0, 1)
      .expectLife(1, 16);
  });

  it("Regurgitating Slog banishes Sloggism from graveyard to gain dominate", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["regurgitating slog|1", "wrecker romp|3"],
          graveyard: ["sloggism|1"],
        },
        { hero: "dorinthea", hand: ["sink below|1", "sink below|1"] },
      ],
    });
    g.play("regurgitating slog|1", { pitch: ["wrecker romp|3"] })
      .expectLog("banishes Sloggism from graveyard")
      .expectLog("gains dominate")
      .expectAttackValue(6)
      .blockWith()
      .passPriority()
      .react("sink below|1") // dominate allows only 1 hand defense reaction
      .chooseOption("pass")
      .settle()
      .expectFinalAttack(6)
      .expectLife(1, 18); // 20 - (6 - 4) = 18
  });

  it("Wounded Bull gains +1 when at less life", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", life: 10, hand: ["wounded bull|1", "wrecker romp|3"] },
        { hero: "dorinthea", life: 20, hand: [] },
      ],
    });
    g.play("wounded bull|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .expectLife(1, 12);
  });
});

describe("WTR generic — non-attack actions", () => {
  it("Nimblism buffs the next cheap attack action", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["nimblism|1", "snatch|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("nimblism|1")
      .expectAP(0, 1)
      .play("snatch|1")
      .expectAttackValue(7) // 4 + 3
      .blockWith()
      .settle()
      .expectLife(1, 13);
  });

  it("Sloggism buffs the next costly attack action", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["timesnap potion|3", "sloggism|1", "demolition crew|1", "wrecker romp|3", "raging onslaught|2"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("timesnap potion|3") // enters the board
      .expectInZone(0, "timesnap potion|3", "board")
      .expectAP(0, 0)
      .endTurn()
      .endTurn()
      .activate("timesnap potion|3") // action: destroy, +2 AP
      .expectAP(0, 2)
      .play("sloggism|1", { pitch: ["wrecker romp|3"] })
      .expectAP(0, 2) // Sloggism has go again
      .play("demolition crew|1")
      .expectAttackValue(12) // 6 + 6
      .blockWith()
      .settle()
      .expectLife(1, 8);
  });

  it("Potion of Strength buffs the next attack this turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["potion of strength|3", "snatch|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("potion of strength|3") // enters the board
      .expectInZone(0, "potion of strength|3", "board")
      .expectAP(0, 0)
      .endTurn()
      .endTurn()
      .activate("potion of strength|3") // action with go again: destroy, +2 next attack
      .expectAP(0, 1)
      .play("snatch|1")
      .expectAttackValue(6) // 4 + 2
      .blockWith()
      .settle()
      .expectLife(1, 14);
  });

  it("Crazy Brew destroys itself and resolves its seeded die outcome", () => {
    const g = scenario({
      seed: 3,
      seats: [
        { hero: "rhinar", life: 18, board: ["crazy brew|3"] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("crazy brew|3")
      .expectNotInZone(0, "crazy brew|3", "board")
      .expectInZone(0, "crazy brew|3", "graveyard")
      .expectLog("Crazy Brew: rolled");
  });

  it("Energy Potion enters the board and destroys for two resources at instant speed", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["energy potion|3"] }, { hero: "dorinthea", hand: [] }],
    });
    g.play("energy potion|3")
      .expectInZone(0, "energy potion|3", "board")
      .expectAP(0, 0)
      .activate("energy potion|3") // instant speed: no action point needed
      .expectResources(0, 2)
      .expectNotInZone(0, "energy potion|3", "board")
      .expectInZone(0, "energy potion|3", "graveyard");
  });

  it("Timesnap Potion enters the board and destroys for two action points", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["timesnap potion|3", "snatch|1", "snatch|1"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("timesnap potion|3")
      .expectInZone(0, "timesnap potion|3", "board")
      .expectAP(0, 0)
      .endTurn()
      .endTurn()
      .activate("timesnap potion|3") // -1 AP to activate, +2 AP
      .expectAP(0, 2)
      .play("snatch|1")
      .blockWith()
      .settle()
      .expectAP(0, 1) // Snatch has no go again
      .play("snatch|1")
      .blockWith()
      .settle()
      .expectAP(0, 0)
      .expectLife(1, 12);
  });
});

describe("WTR generic — equipment", () => {
  it("Fyendal's Spring Tunic defaults its energy-counter trigger to yes", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", equipment: { chest: "fyendal's spring tunic|0" } },
        { hero: "dorinthea" },
      ],
    });

    g.endTurn().endTurn();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      defaultOption: "yes",
    });
    g.chooseOption("yes");
    expect(g.state.players[0]!.equipment.chest?.counters?.energy).toBe(1);
  });

  it("Goliath Gauntlet buffs the next attack action with cost 2 or more", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["wrecker romp|1", "raging onslaught|2", "raging onslaught|1"], equipment: { arms: "goliath gauntlet|0" } },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("goliath gauntlet|0")
      .expectAP(0, 1)
      .expectNoEquipment(0, "arms")
      .play("wrecker romp|1", { pitch: ["raging onslaught|2"] }) // cost 2, attack 8
      .expectAttackValue(10) // 8 + 2
      .blockWith()
      .settle()
      .expectLife(1, 10);
  });

  it("Heartened Cross Strap reduces the cost of the next attack action by {r}{r}", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["wrecker romp|1", "raging onslaught|2"], equipment: { chest: "heartened cross strap|0" } },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("heartened cross strap|0")
      .expectNoEquipment(0, "chest")
      .play("wrecker romp|1") // printed cost 2, reduced to 0; no pitch needed
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .expectLife(1, 12);
  });

  it("Hope Merchant's Hood shuffles chosen hand cards into the deck and draws that many", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["raging onslaught|2", "wrecker romp|3"],
          equipment: { head: "hope merchant's hood|0" },
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.activate("hope merchant's hood|0") // instant speed; destroys itself, then asks
      .expectNoEquipment(0, "head");
    chooseHandCard(g, 0, "wrecker romp|3") // shuffle one in…
      .chooseOption("done") // …and stop
      .expectHandSize(0, 2) // Wrecker Romp swapped for a fresh draw
      .expectLog("Hope Merchant's Hood: shuffled 1 card(s) in and drew 1");
  });

  it("Snapdragon Scalers gives a cheap attack action go again in the reaction window", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"], equipment: { legs: "snapdragon scalers|0" } },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const scalers = g.state.players[0]!.equipment.legs!;
    g.play("snatch|1", { settle: false }) // cost 0 attack action
      .blockWith()
      .activate("snapdragon scalers|0", { settle: false }); // cost is paid before the layer resolves

    g.expectNoEquipment(0, "legs");
    expect(g.state.players[0]!.graveyard.some((card) => card.instanceId === scalers.instanceId))
      .toBe(true);
    expect(g.state.stack.filter((layer) => layer.sourceInstanceId === scalers.instanceId))
      .toHaveLength(1);
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === scalers.instanceId
    )).toBe(false);

    g.settle()
      .expectLog("Snapdragon Scalers: target attack action gains go again")
      .settle()
      .expectAP(0, 1) // go again refunded the action point
      .expectLife(1, 16);
  });
});

describe("WTR generic — reactions", () => {
  it("Pummel buffs a club or hammer weapon attack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["pummel|1", "raging onslaught|2", "raging onslaught|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.attackWithWeapon()
      .blockWith()
      .react("pummel|1", { pitch: ["raging onslaught|2"] })
      .expectFinalAttack(8) // Bone Basher 4 + 4
      .expectLife(1, 12);
  });

  it("Pummel buffs an attack action and makes it discard on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["pummel|1", "demolition crew|1", "raging onslaught|2", "wrecker romp|3"] },
        { hero: "dorinthea", hand: ["sink below|3", "sink below|3"] },
      ],
    });
    g.play("demolition crew|1") // cost 2, attack 6
      .blockWith()
      .react("pummel|1", { pitch: ["wrecker romp|3"] })
      .chooseCard("sink below|3")
      .settle()
      .expectFinalAttack(10) // 6 + 4
      .expectHandSize(1, 1) // discarded one card on hit
      .expectLife(1, 10);
  });

  it("Razor Reflex buffs a sword weapon attack", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["razor reflex|1", "en garde|1", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.attackWithWeapon()
      .blockWith()
      .react("razor reflex|1", { pitch: ["raging onslaught|2"] })
      .expectFinalAttack(5) // Dawnblade 2 + 3
      .expectLife(1, 15);
  });

  it("Razor Reflex buffs a cheap attack action and grants on-hit go again", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["razor reflex|1", "snatch|1", "raging onslaught|2"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("snatch|1")
      .blockWith()
      .react("razor reflex|1", { pitch: ["raging onslaught|2"] })
      .expectFinalAttack(7) // 4 + 3
      .settle()
      .expectAP(0, 1) // go again from Razor Reflex on hit
      .expectLife(1, 13);
  });

  it("Sink Below bottoms a card and draws", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["sink below|1", "en garde|1"], deck: ["raging onslaught|2"] },
        { hero: "rhinar", hand: ["snatch|1"] },
      ],
      active: 1,
    });
    g.play("snatch|1")
      .blockWith()
      .passPriority()
      .react("sink below|1");
    chooseHandCard(g, 0, "en garde|1")
      .expectDeckBottom(0, "en garde|1")
      .expectHandSize(0, 1) // drew Raging Onslaught
      .settle()
      .expectLife(0, 20); // Snatch 4 - Sink Below 4 = 0 damage
  });

  it("Unmovable played from arsenal gets +1 defense", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["raging onslaught|3"], arsenal: ["unmovable|1"] },
        { hero: "rhinar", hand: ["snatch|1"] },
      ],
      active: 1,
    });
    g.play("snatch|1")
      .blockWith()
      .passPriority() // attacker's reaction window
      .react("unmovable|1") // cost 3 from arsenal, pitch the blue
      .expectLog("Unmovable: +1 defense (played from arsenal)")
      .expectLife(0, 20); // 4 attack vs 7 + 1 defense
  });
});

describe("WTR generic — instants", () => {
  it("Sigil of Solace gains life in the reaction window", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", life: 17, hand: ["sigil of solace|1"] },
        { hero: "rhinar", hand: ["pack hunt|1", "raging onslaught|2"] },
      ],
      active: 1,
    });
    g.play("pack hunt|1", { settle: false })
      .passPriority()
      .react("sigil of solace|1")
      .expectLife(0, 20)
      .blockWith()
      .settle()
      .expectLife(0, 14); // 20 - 6 = 14
  });
});
