import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario } from "../harness.js";

function tokenCount(g: ReturnType<typeof scenario>, seat: number, key: string): number {
  return g.state.players[seat]!.board.filter(
    (card) => functionalKeyOf(cardData[card.cardId]!) === key,
  ).length;
}

/** Scenarios for the HVY set: Beast Mode, Pack Call, Rally the Rearguard. */

describe("HVY — Beast Mode", () => {
  it("registers the complete set", () => {
    expect(Object.keys(cardData).filter((id) => id.startsWith("HVY"))).toHaveLength(255);
    for (const id of ["HVY001", "HVY002", "HVY045", "HVY046", "HVY047", "HVY048", "HVY090", "HVY091", "HVY092", "HVY093"]) {
      expect(scripts[id]).toBeDefined();
    }
  });

  it("gets +2 after you have intimidated this turn", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3"] },
        { hero: "rhinar", hand: ["clearing bellow|3", "beast mode|1", "wrecker romp|3"] },
      ],
      active: 1,
    });
    g.play("clearing bellow|3") // immediate intimidate sets up Beast Mode
      .expectPendingReturn(0, 1)
      .expectAP(1, 1) // go again
      .play("beast mode|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(8) // 6 + 2
      .blockWith()
      .settle()
      .expectLife(0, 12);
  });

  it("no bonus without an intimidate this turn", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        { hero: "rhinar", hand: ["beast mode|1", "wrecker romp|3"] },
      ],
      active: 1,
    });
    g.play("beast mode|1", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLife(0, 14);
  });
});

describe("HVY — Pack Call (on defend, reveal top: 6+ stays, else bottom)", () => {
  it("a 6+ top card stays on top", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["en garde|1"] },
        { hero: "rhinar", hand: ["pack call|2"], deck: ["raging onslaught|2", "dodge|3"] },
      ],
    });
    g.attackWithWeapon()
      .blockWith("pack call|2")
      .settle()
      .expectLog("it stays on top")
      .expectDeckTop(1, "raging onslaught|2")
      .expectFinalDefense(3)
      .expectLife(0, 20);
  });

  it("a smaller top card goes to the bottom", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["en garde|1"] },
        { hero: "rhinar", hand: ["pack call|2"], deck: ["dodge|3", "raging onslaught|2"] },
      ],
    });
    g.attackWithWeapon()
      .blockWith("pack call|2")
      .settle()
      .expectLog("put on the bottom of the deck")
      .expectDeckTop(1, "raging onslaught|2")
      .expectDeckBottom(1, "dodge|3");
  });
});

describe("HVY — Rally the Rearguard", () => {
  it("while defending, discard a card for +3 defense", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["en garde|1"] },
        { hero: "rhinar", hand: ["rally the rearguard|3", "dodge|3"] },
      ],
    });
    g.attackWithWeapon()
      .blockWith("rally the rearguard|3")
      .passPriority() // attacker passes the reaction step
      .activate("rally the rearguard|3", { pitch: ["dodge|3"] }) // discard is passed as "pitch"
      .expectLog("Rally the Rearguard gains +3 defense")
      .expectFinalDefense(5) // 2 + 3
      .expectLife(0, 20); // Dawnblade's 2 is fully defended
  });
});

describe("HVY — Heavy Hitters mechanics", () => {
  it("Bloodied Oval can defend using its dynamically defined defense", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", life: 19, weapons: ["bloodied oval|0"] },
      { hero: "dorinthea", life: 20, hand: ["head jab|1"] },
    ], active: 1 });

    g.play("head jab|1")
      .blockWith("bloodied oval|0")
      .settle()
      .expectFinalDefense(1)
      .expectLife(0, 17);
  });

  it("Performance Bonus gains go again only when played from arsenal", () => {
    const fromArsenal = scenario({ seats: [
      { hero: "rhinar", arsenal: ["performance bonus|1"] },
      { hero: "dorinthea" },
    ] });

    fromArsenal
      .play("performance bonus|1", { fromArsenal: true })
      .blockWith()
      .settle()
      .expectAP(0, 1);

    const fromHand = scenario({ seats: [
      { hero: "rhinar", hand: ["performance bonus|1"] },
      { hero: "dorinthea" },
    ] });

    fromHand
      .play("performance bonus|1")
      .blockWith()
      .settle()
      .expectAP(0, 0);
  });

  it("Send Packing banishes the arsenal card face up", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["send packing|2", "wrecker romp|3"] },
      { hero: "dorinthea", arsenalFaceDown: ["head jab|1"] },
    ] });

    g.play("send packing|2", { pitch: ["wrecker romp|3"] });
    const banished = g.state.players[1]!.banish.find(
      (card) => cardData[card.cardId]?.name === "Head Jab",
    );
    expect(banished, "arsenal card was not banished").toBeTruthy();
    expect(banished!.faceDown, "banished card should be face up").toBeUndefined();
    // face-up means the attacker sees the identity too
    const view = projectStateFor(g.state, 0);
    expect(view.players[1]!.banish.some((card) => card.cardId === banished!.cardId)).toBe(true);

    g.blockWith().settle().expectInZone(1, "head jab|1", "banish"); // it hit, so the card stays banished
  });

  it("Sonata Galaxia at X=0 consumes AP when it puts a go-again aura into the arena", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["sonata galaxia|1"],
        deck: ["malefic incantation|1"],
      },
      { hero: "dorinthea" },
    ] });

    g.play("sonata galaxia|1", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-variable-play-x");

    g.chooseOption("X = 0");
    expect(g.state.pendingDecision?.chooseHook).toBe("galaxia-aura");

    g.chooseCard("malefic incantation|1")
      .expectInZone(0, "malefic incantation|1", "board")
      .expectInZone(0, "sonata galaxia|1", "graveyard")
      .expectAP(0, 0);

    expect(g.state.pendingDecision?.chooseHook).not.toBe("engine-variable-play-payment");
  });

  it("Sonata Galaxia at X=2 refunds exactly its own action point", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        resources: 4,
        hand: ["sonata galaxia|1"],
        deck: ["malefic incantation|1"],
      },
      { hero: "dorinthea" },
    ] });

    g.play("sonata galaxia|1", { settle: false })
      .chooseOption("X = 2")
      .chooseCard("malefic incantation|1")
      .expectInZone(0, "malefic incantation|1", "board")
      .expectAP(0, 1);
  });

  it("No Fear returns its banished cost cards despite its lingering prevention", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["no fear|1", "beast mode|1"] },
      { hero: "dorinthea" },
    ] });

    g.play("no fear|1", { settle: false })
      .chooseCard("beast mode|1")
      .chooseOption("done")
      .settle()
      .expectInZone(0, "beast mode|1", "banish")
      .endTurn()
      .expectInZone(0, "beast mode|1", "hand");
  });

  it("declares and pays Reel In's X cost while preserving the priority window", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["sigil of solace|1", "reel in|3", "raging onslaught|3"] },
      { hero: "dorinthea" },
    ] });
    g.play("sigil of solace|1", { settle: false })
      .react("reel in|3", { settle: false });
    expect(g.state.pendingDecision?.options).toContain("X = 2");
    expect(g.state.stack).toHaveLength(1);
    g.chooseOption("X = 2");
    expect(g.state.pendingDecision?.resourcePayment?.cost).toBe(2);
    g.doRaw({ kind: "choose", optionId: g.state.pendingDecision!.options![0]! });
    expect(g.state.stack).toHaveLength(2);
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
  });

  it("declares and pays Up the Ante's X cost before the reaction is played", () => {
    const g = scenario({ seats: [
      { hero: "dorinthea", resources: 1, hand: ["wage gold|1", "up the ante|3", "raging onslaught|3", "raging onslaught|3"] },
      { hero: "rhinar" },
    ] });
    g.play("wage gold|1").chooseOption("yes").blockWith()
      .react("up the ante|3", { settle: false });
    expect(g.state.pendingDecision?.options).toEqual(["X = 0", "X = 1", "X = 2", "X = 3"]);
    expect(g.state.players[0]!.hand.some((card) => card.cardId === "HVY103")).toBe(true);
    g.chooseOption("X = 1");
    expect(g.state.players[0]!.resources).toBe(0);
    expect(g.state.pendingDecision?.chooseHook).toBe("ante-mode");
    expect(g.state.pendingDecision?.resourcePayment).toBeUndefined();
    expect(g.state.stack.some((layer) => layer.card?.cardId === "HVY103")).toBe(false);
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "pass")).toBe(false);
    g.doRaw({ kind: "choose", optionId: "agility" });
    expect(g.state.pendingDecision?.chooseHook).toBe("ante-mode");
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "pass")).toBe(false);
    g.doRaw({ kind: "choose", optionId: "gold" });
    expect(g.state.stack.some((layer) => layer.card?.cardId === "HVY103")).toBe(true);
    expect(g.state.pendingDecision?.kind).toBe("attack-reaction");
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "pass")).toBe(true);
  });

  it("Up the Ante resolves selected modes in their printed order", () => {
    const g = scenario({ seats: [
      { hero: "dorinthea", resources: 2, hand: ["wage gold|1", "up the ante|3", "raging onslaught|3"] },
      { hero: "rhinar" },
    ] });
    g.play("wage gold|1").chooseOption("yes").blockWith()
      .react("up the ante|3", { settle: false })
      .chooseOption("X = 1");
    g.doRaw({ kind: "choose", optionId: "power" });
    g.doRaw({ kind: "choose", optionId: "agility" });
    g.passPriority().passPriority();

    const link = projectStateFor(g.state, 0).chain.at(-1)!;
    expect(g.state.chain.at(-1)?.flags.wagerCount).toBe(2);
    expect(link.attackValue).toBe((cardData[link.attackingCard.cardId]!.attack ?? 0) + 2);
  });

  it("Bet Big creates an optional attack trigger", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["bet big|1"], resources: 4 },
      { hero: "dorinthea" },
    ] });
    g.play("bet big|1", { settle: false }).settle();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      options: ["yes", "no"],
    });
    expect(g.state.chain.at(-1)?.wagers).toBeUndefined();
    g.chooseOption("no");
    expect(g.state.chain.at(-1)?.wagers).toBeUndefined();
  });

  it("Double Down waits for the first attack that actually wagers", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["double down|1", "head jab|3", "wage gold|1"], resources: 20 },
      { hero: "dorinthea" },
    ] });
    g.play("double down|1")
      .play("head jab|3").blockWith().settle()
      .play("wage gold|1").chooseOption("yes").settle();
    const link = projectStateFor(g.state, 0).chain.at(-1)!;
    expect(link.attackValue).toBe((cardData[link.attackingCard.cardId]!.attack ?? 0) + 3);
    expect(link.overpower).toBe(true);
  });

  it("Double Down increases wager prizes for the defending winner", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["double down|1", "wage gold|1"], resources: 20 },
      { hero: "dorinthea", hand: ["ten foot tall and bulletproof|1"] },
    ] });
    g.play("double down|1").play("wage gold|1").chooseOption("yes")
      .blockWith("ten foot tall and bulletproof|1").settle();
    expect(tokenCount(g, 1, "gold|0")).toBe(2);
  });

  it("Double Down increases scripted token prizes from wagers", () => {
    const g = scenario({ seats: [
      {
        hero: "dorinthea",
        weapons: ["golden grail|0"],
        hand: ["double down|1", "gutshot|1"],
        resources: 20,
      },
      { hero: "rhinar" },
    ] });
    g.play("double down|1").play("gutshot|1")
      .attackWithWeapon("golden grail|0").blockWith().settle();
    expect(tokenCount(g, 0, "blade dance|0")).toBe(2);
  });

  it("Double Down does not increase Olympia's separate Gold trigger", () => {
    const g = scenario({ seats: [
      { hero: "dorinthea", heroKey: "olympia|0", hand: ["double down|1", "wage gold|1"], resources: 20 },
      { hero: "rhinar" },
    ] });
    g.play("double down|1").play("wage gold|1").chooseOption("yes")
      .blockWith().settle();
    expect(tokenCount(g, 0, "gold|0")).toBe(3);
  });

  it("Ripple Away replaces tokens created by a delayed action-card effect", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["ripple away|3", "bad breath|1", "head jab|3"],
        resources: 20,
      },
      { hero: "dorinthea" },
    ] });

    g.activate("ripple away|3")
      .play("bad breath|1")
      .play("head jab|3")
      .blockWith()
      .settle();

    expect(tokenCount(g, 0, "might|0")).toBe(2);
  });

  it.each([
    ["double down|1", 1],
    ["ripple away|3", 0],
  ] as const)("the turn player may apply %s first to a one-token wager prize", (first, expectedGold) => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["double down|1", "ripple away|3", "wage gold|1"], resources: 20 },
      { hero: "dorinthea" },
    ] });
    g.play("double down|1").activate("ripple away|3")
      .play("wage gold|1").chooseOption("yes").blockWith().settle();
    const pending = g.state.pendingDecision;
    const wantedId = g.state.players[0]!.graveyard
      .find((card) => functionalKeyOf(cardData[card.cardId]!) === first)?.instanceId;
    expect(pending?.chooseHook).toBe("engine-token-replacement-order");
    expect(wantedId).toBeDefined();
    const wantedIndex = pending?.cardOptions?.indexOf(wantedId!) ?? -1;
    expect(wantedIndex).toBeGreaterThanOrEqual(0);
    g.doRaw({ kind: "choose", optionId: pending!.options![wantedIndex]! }).settle();
    expect(tokenCount(g, 0, "gold|0")).toBe(expectedGold);
  });

  it("lets each controller order their own token replacements", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["double down|1", "wage gold|1"],
        resources: 20,
      },
      {
        hero: "dorinthea",
        hand: ["ripple away|3", "ripple away|3"],
      },
    ] });
    g.play("double down|1").play("wage gold|1").chooseOption("yes")
      .blockWith()
      .passPriority().activate("ripple away|3", { settle: false })
      .passPriority().passPriority()
      .passPriority().activate("ripple away|3");

    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "engine-token-replacement-player-order",
      options: ["0", "1"],
    });
    g.chooseOption("1");
    const rippleIds = g.state.players[1]!.graveyard
      .filter((card) => functionalKeyOf(cardData[card.cardId]!) === "ripple away|3")
      .map((card) => `global:${card.instanceId}`);
    expect(g.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "engine-token-replacement-order",
      options: rippleIds,
    });
  });

  it("Raise an Army asks once for a Gold count capped at the total controlled", () => {
    const g = scenario({ seats: [
      {
        hero: "dorinthea",
        heroKey: "kassai|0",
        hand: ["raise an army|2"],
        board: ["gold|0", "gold|0", "gold|0"],
      },
      { hero: "rhinar" },
    ] });

    g.play("raise an army|2", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("army-gold-count");
    expect(g.state.pendingDecision?.prompt).toBe("How many Gold do you want to destroy?");
    expect(g.state.pendingDecision?.options).toEqual(["0", "1", "2", "3"]);

    g.chooseOption("2");
    expect(g.state.players[0]!.board.filter((card) => cardData[card.cardId]?.name === "Gold")).toHaveLength(1);
    expect(g.state.players[0]!.board.filter((card) => cardData[card.cardId]?.name === "Cintari Sellsword")).toHaveLength(2);
  });

  it("Grains of Bloodspill lets its controller pitch to pay after a weapon hits", () => {
    const g = scenario({ seats: [
      {
        hero: "dorinthea",
        weapons: ["dawnblade|0"],
        equipment: { chest: "grains of bloodspill|0" },
        hand: ["raging onslaught|1", "raging onslaught|1"],
      },
      { hero: "rhinar" },
    ] });

    g.attackWithWeapon("dawnblade|0", { pitch: ["raging onslaught|1"] })
      .blockWith()
      .settle();

    expect(g.state.players[0]!.resources).toBe(0);
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      chooseHook: "grains",
      resourcePayment: { cost: 1 },
    });

    g.chooseOption("pay 1")
      .expectInZone(0, "vigor|0", "board")
      .expectZoneSize(0, "pitch", 2);
  });

  it("Aether Arc deals arcane damage and creates Ponder", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["aether arc|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.play("aether arc|3")
      .expectLife(1, 19)
      .expectInZone(0, "ponder|0", "board");
  });

  it("Beat Chest pays with a 6-power card and Pound Town creates Might", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["pound town|1", "raging onslaught|1", "wrecker romp|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.play("pound town|1", { pitch: ["wrecker romp|3"] })
      .chooseCard("raging onslaught|1")
      .expectInZone(0, "might|0", "board")
      .blockWith()
      .settle();
  });

  it("a wager awards its token to the winner and Olympia creates Gold once", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "olympia|0",
          hand: ["wage gold|1", "wrecker romp|3"],
          deck: ["thunk|1"],
        },
        { hero: "rhinar", deck: ["dodge|3"] },
      ],
    });
    g.play("wage gold|1", { pitch: ["wrecker romp|3"] })
      .chooseOption("yes");
    expect(projectStateFor(g.state, 0).chain[0]?.wagerRewards).toEqual([
      "Winner creates Gold",
    ]);
    g.expectZoneSize(0, "board", 0)
      .blockWith()
      .settle()
      .expectZoneSize(0, "board", 2)
      .expectLog("wins the wager");
  });

  it("Betsy creates a triggered payment after an attack wagers", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "betsy|0", hand: ["wage gold|1"], resources: 5 },
        { hero: "dorinthea" },
      ],
    });

    g.play("wage gold|1").chooseOption("yes");
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "betsy-pay",
      options: ["pay 2", "no"],
    });

    g.chooseOption("pay 2").expectAttackValue(8);
    expect(g.state.chain.at(-1)?.flags.overpower).toBe(true);
  });

  it("Victor draws from the first Gold his effect creates", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "victor goldmane|0", hand: ["starting stake|2"], deck: ["dodge|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.play("starting stake|2")
      .expectInZone(0, "gold|0", "board")
      .expectHandSize(0, 1);
  });

  it("Engaged Swiftblade grants go again when an attack action defends", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["engaged swiftblade|1", "wrecker romp|3"] },
        { hero: "rhinar", hand: ["raging onslaught|3"] },
      ],
    });
    g.play("engaged swiftblade|1", { pitch: ["wrecker romp|3"] })
      .attackWithWeapon()
      .blockWith("raging onslaught|3")
      .settle()
      .expectAP(0, 1);
  });

  it("Hot Streak does not trigger when Cintari Saber attacks", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["cintari saber|0", "hot streak|0"],
          resources: 1,
        },
        { hero: "rhinar", hand: ["raging onslaught|3"] },
      ],
    });
    const hotStreakId = g.state.players[0]!.weapons.find(
      (weapon) => cardData[weapon.cardId]?.name === "Hot Streak",
    )!.instanceId;

    g.attackWithWeapon("cintari saber|0").blockWith("raging onslaught|3");

    expect(g.state.stack.some((layer) => layer.sourceInstanceId === hotStreakId)).toBe(false);
    expect(g.state.log.some((entry) => entry.publicText?.includes("Hot Streak triggers"))).toBe(false);
  });

  it("Hot Streak does not trigger when it is not defended", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["hot streak|0"],
          resources: 1,
        },
        { hero: "rhinar" },
      ],
    });
    const hotStreakId = g.state.players[0]!.weapons[0]!.instanceId;

    g.attackWithWeapon("hot streak|0").blockWith();

    expect(g.state.stack.some((layer) => layer.sourceInstanceId === hotStreakId)).toBe(false);
    expect(g.state.log.some((entry) => entry.publicText?.includes("Hot Streak triggers"))).toBe(false);
  });

  it("Hot Streak triggers when it is defended by an attack action card", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["hot streak|0"],
          resources: 1,
        },
        { hero: "rhinar", hand: ["raging onslaught|3"] },
      ],
    });

    g.attackWithWeapon("hot streak|0").blockWith("raging onslaught|3");

    expect(g.state.log.some((entry) => entry.publicText?.includes(
      "Hot Streak triggers: When Hot Streak is defended by an attack action card",
    ))).toBe(true);
    g.settle().expectAP(0, 1);
  });

  it("Victor may destroy Gold to replace his first failed clash", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", resources: 1, deck: ["raging onslaught|1", "dodge|3"] },
        {
          hero: "rhinar",
          heroKey: "victor goldmane|0",
          hand: ["test of vigor|1"],
          deck: ["raging onslaught|1", "wage gold|3"],
          board: ["gold|0"],
        },
      ],
    });
    g.attackWithWeapon().blockWith("test of vigor|1")
      .passPriority().passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("victor-reclash");
    g.chooseCard("gold|0");
    expect(g.state.pendingDecision?.chooseHook).toBe("victor-reclash-bottom");
    g.chooseCard("raging onslaught|1")
      .expectDeckTop(0, "dodge|3")
      .expectDeckBottom(0, "raging onslaught|1")
      .expectNotInZone(1, "gold|0", "board")
      .expectInZone(1, "vigor|0", "board")
      .expectHandSize(1, 0);
  });

  it("Victor may decline only his first failed-clash replacement each turn", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", resources: 1, deck: ["raging onslaught|1"] },
        {
          hero: "rhinar",
          heroKey: "victor goldmane|0",
          hand: ["test of vigor|1", "test of vigor|1"],
          deck: ["raging onslaught|1"],
          board: ["gold|0"],
        },
      ],
    });
    g.attackWithWeapon().blockWith("test of vigor|1", "test of vigor|1")
      .passPriority().passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("victor-reclash");
    g.chooseOption("no").expectInZone(1, "gold|0", "board");
    expect(g.state.pendingDecision?.chooseHook).not.toBe("victor-reclash");
    expect(g.state.log.filter((entry) => entry.publicText?.includes("clash is a tie"))).toHaveLength(2);
  });

  it("Kassai selects and banishes her graveyard cards as an activation cost", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "kassai|0",
          graveyard: ["wage gold|1", "wage might|1", "wage gold|2", "wage vigor|2"],
        },
        { hero: "rhinar" },
      ],
    });
    g.activate("kassai|0", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("kassai-cost");
    expect(g.state.players[0]!.graveyard).toHaveLength(4);
    g.chooseCard("wage gold|1")
      .chooseCard("wage might|1")
      .chooseCard("wage gold|2")
      .chooseCard("wage vigor|2")
      .expectZoneSize(0, "graveyard", 0)
      .expectZoneSize(0, "banish", 4);
  });

  it("Good Time Chapeau destroys a chosen Gold as an activation cost", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["gold|0"],
          equipment: { head: "good time chapeau|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    g.activate("good time chapeau|0", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("chapeau-cost");
    g.expectInZone(0, "gold|0", "board")
      .chooseCard("gold|0")
      .expectNotInZone(0, "gold|0", "board");
  });

  it("Hood of Red Sand pays every reaction cost before its layer is announced", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          resources: 2,
          graveyard: ["wage gold|1", "wage gold|2"],
          equipment: { head: "hood of red sand|0" },
        },
        { hero: "rhinar" },
      ],
    });
    g.attackWithWeapon().blockWith().activate("hood of red sand|0", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("hood-cost");
    expect(g.state.players[0]!.equipment.head?.cardId).toBeTruthy();
    g.chooseCard("wage gold|1").chooseCard("wage gold|2");
    expect(g.state.players[0]!.equipment.head).toBeUndefined();
    g.expectZoneSize(0, "graveyard", 1)
      .expectZoneSize(0, "banish", 2)
      .expectResources(0, 0);
  });
});

describe("HVY — look-at floats", () => {
  it("Seduce Secrets floats the whole hand plus deck top in one look decision", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["seduce secrets|2"] },
        { hero: "dorinthea", hand: ["snatch|1", "wounded bull|1"], deck: ["wrecker romp|1"] },
      ],
    });
    g.play("seduce secrets|2", { settle: false });
    g.passPriority();
    g.passPriority(); // the instant resolves and stops at the look

    const opp = g.state.players[1]!;
    const expected = [...opp.hand, ...opp.deck.slice(0, 1)].map((card) => card.instanceId);
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-look");
    expect(g.state.pendingDecision?.lookedCardIds).toEqual(expected);
    // all looked cards show in one float, privately
    expect(projectStateFor(g.state, 0).pendingDecision?.lookedCards).toHaveLength(3);
    expect(projectStateFor(g.state, 1).pendingDecision?.lookedCards).toBeUndefined();

    g.passPriority(); // pass dismisses the float
    expect(g.state.pendingDecision?.chooseHook).not.toBe("engine-look");
    expect(g.state.phase).toBe("action");
  });
});
