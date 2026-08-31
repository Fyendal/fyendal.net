import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";

const mech = {
  hero: "rhinar" as const,
  heroKey: "dash|0",
  weapons: [] as string[],
};

function boardCard(g: Scenario, seat: number, key: string) {
  const card = g.state.players[seat]!.board.find((c) => c.cardId === printingId(key));
  expect(card, `no ${key} on seat ${seat}'s board`).toBeTruthy();
  return card!;
}

function expectDominateLimitsHandDefense(g: Scenario, defender: number): void {
  const handIds = new Set(g.state.players[defender]!.hand.map((card) => card.instanceId));
  const defends = legalIntents(g.state, defender).filter((intent) => intent.kind === "defend");
  expect(defends.length).toBeGreaterThan(0);
  expect(
    defends.every(
      (intent) =>
        intent.kind !== "defend" ||
        intent.instanceIds.filter((instanceId) => handIds.has(instanceId)).length <= 1,
    ),
  ).toBe(true);
}

describe("ARC — Mechanologist attacks and actions", () => {
  it("Spark of Genius declares XX, pays before entering the stack, then searches on resolution", () => {
    const g = scenario({
      seats: [
        {
          ...mech,
          hand: ["spark of genius|2", "locked and loaded|3", "zipper hit|3"],
          deck: ["teklo pounder|3"],
        },
        { hero: "dorinthea", weapons: [], hand: ["sigil of solace|1"] },
      ],
    });

    g.play("spark of genius|2");
    expect(g.state.pendingDecision?.options).toEqual(["X = 0", "X = 1", "X = 2", "X = 3"]);

    g.chooseOption("X = 2");
    expect(g.state.pendingDecision?.resourcePayment?.cost).toBe(4);
    const paymentView = projectStateFor(g.state, 0).pendingDecision?.resourcePayment;
    // Both pitch orders are legal and determine the order the cards are
    // returned to the bottom of the deck at end of turn.
    expect(paymentView?.options).toHaveLength(2);
    expect(projectStateFor(g.state, 1).pendingDecision?.resourcePayment).toBeUndefined();

    const paymentOption = g.state.pendingDecision!.options![0]!;
    g.doRaw({ kind: "choose", optionId: paymentOption })
      .expectInZone(0, "teklo pounder|3", "deck");
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(g.state.stack).toHaveLength(1);

    g.settle();
    expect(g.state.pendingDecision?.chooseHook).toBe("spark-item");
    expect(g.state.stack).toHaveLength(1);
    expect(g.state.players[0]!.board).toHaveLength(0);

    const pounder = g.state.players[0]!.deck.find(
      (card) => card.cardId === printingId("teklo pounder|3"),
    )!;
    g.doRaw({ kind: "choose", optionId: String(pounder.instanceId) })
      .expectInZone(0, "teklo pounder|3", "board")
      .expectResources(0, 2)
      .expectLog("shuffles their deck");
    expect(g.state.stack).toHaveLength(0);
  });

  it("Spark of Genius leaves the stack before offering crank for the searched item", () => {
    const g = scenario({
      seats: [
        {
          ...mech,
          hand: ["spark of genius|2", "zipper hit|3"],
          deck: ["prismatic lens|2"],
        },
        { hero: "dorinthea", weapons: [], hand: ["sigil of solace|1"] },
      ],
    });

    g.play("spark of genius|2")
      .chooseOption("X = 1")
      .chooseOption("pitch Zipper Hit")
      .settle();

    const lens = g.state.players[0]!.deck.find(
      (card) => card.cardId === printingId("prismatic lens|2"),
    )!;
    expect(g.state.pendingDecision?.chooseHook).toBe("spark-item");
    expect(g.state.stack).toHaveLength(1);
    g.doRaw({ kind: "choose", optionId: String(lens.instanceId) })
      .expectInZone(0, "prismatic lens|2", "board");

    expect(g.state.stack).toHaveLength(0);
    expect(g.state.players[0]!.board).toHaveLength(1);
    expect(projectStateFor(g.state, 1).stack[0]).toBeUndefined();
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-crank");
    expect(g.state.pendingDecision?.options).toEqual(["yes", "no"]);

    g.chooseOption("no");
    expect(boardCard(g, 0, "prismatic lens|2").counters?.steam).toBe(1);
  });

  it("Teklo Foundry Heart pays its cost before its action ability resolves from the stack", () => {
    const g = scenario({
      seats: [
        {
          ...mech,
          equipment: { chest: "teklo foundry heart|0" },
          hand: ["locked and loaded|3"],
          deck: ["zero to sixty|1", "zipper hit|2"],
        },
        { hero: "dorinthea", weapons: [], hand: ["sigil of solace|1"] },
      ],
    });
    g.state.players[0]!.flags.boostedThisTurn = true;

    g.activate("teklo foundry heart|0", {
      pitch: ["locked and loaded|3"],
      settle: false,
    });

    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(g.state.stack).toHaveLength(1);
    g.expectZoneSize(0, "deck", 2)
      .expectZoneSize(0, "banish", 0)
      .expectResources(0, 2)
      .expectAP(0, 0);

    g.settle()
      .expectZoneSize(0, "deck", 0)
      .expectZoneSize(0, "banish", 2)
      .expectResources(0, 4)
      .expectAP(0, 1);
  });

  it("Pedal to the Metal gives the next attack dominate after hitting", () => {
    const g = scenario({
      seats: [
        {
          ...mech,
          hand: ["pedal to the metal|1", "locked and loaded|3", "zero to sixty|1"],
          deck: ["zero to sixty|3"],
        },
        { hero: "dorinthea", weapons: [], hand: ["raging onslaught|1", "raging onslaught|3"] },
      ],
    });

    g.play("pedal to the metal|1", {
      pitch: ["locked and loaded|3"],
      boost: true,
    })
      .blockWith()
      .settle()
      .play("zero to sixty|1");

    expectDominateLimitsHandDefense(g, 1);
  });

  it("Pour the Mold puts an eligible item into the arena and adds steam after a boost", () => {
    const g = scenario({
      seats: [
        { ...mech, hand: ["pour the mold|2", "aether sink|2"] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    g.state.players[0]!.flags.boostedThisTurn = true;

    g.play("pour the mold|2").chooseCard("aether sink|2").expectInZone(0, "aether sink|2", "board");
    expect(boardCard(g, 0, "aether sink|2").counters?.steam).toBe(2);
  });

  it("Cognition Nodes sends a hit attack action card to the bottom of its owner's deck", () => {
    const g = scenario({
      seats: [
        {
          ...mech,
          board: ["cognition nodes|3"],
          hand: ["zero to sixty|1", "pour the mold|3"],
          deck: ["zipper hit|3"],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    boardCard(g, 0, "cognition nodes|3").counters = { steam: 1 };

    g.play("zero to sixty|1", { boost: true })
      .blockWith()
      .activate("cognition nodes|3", { ability: 1 })
      .play("pour the mold|3")
      .expectDeckBottom(0, "zero to sixty|1");
    expect(boardCard(g, 0, "cognition nodes|3").counters?.steam).toBe(0);
  });

  it("Convection Amplifier spends steam to give the next attack action dominate", () => {
    const g = scenario({
      seats: [
        {
          ...mech,
          board: ["convection amplifier|1"],
          hand: ["zero to sixty|1"],
        },
        { hero: "dorinthea", weapons: [], hand: ["raging onslaught|1", "raging onslaught|3"] },
      ],
    });
    boardCard(g, 0, "convection amplifier|1").counters = { steam: 2 };

    g.activate("convection amplifier|1")
      .play("zero to sixty|1");
    expect(boardCard(g, 0, "convection amplifier|1").counters?.steam).toBe(1);
    expectDominateLimitsHandDefense(g, 1);
  });

  it("Over Loop goes to the bottom of its owner's deck when it hits", () => {
    const g = scenario({
      seats: [
        {
          ...mech,
          hand: ["over loop|1", "locked and loaded|3", "pour the mold|3"],
          deck: ["zipper hit|3"],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.play("over loop|1", { pitch: ["locked and loaded|3"], boost: true })
      .blockWith()
      .settle();
    g.play("pour the mold|3")
      .expectDeckBottom(0, "over loop|1");
    expect(g.transitionEvents).toContainEqual(expect.objectContaining({
      from: { kind: "chain", seat: 0 },
      to: { kind: "deck", seat: 0, position: "bottom" },
    }));
  });

  it("Locked and Loaded buffs the next Mechanologist attack and opts after a boost", () => {
    const g = scenario({
      seats: [
        { ...mech, hand: ["locked and loaded|2", "zero to sixty|1"], deck: ["raging onslaught|1", "raging onslaught|3"] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    g.state.players[0]!.flags.boostedThisTurn = true;

    g.play("locked and loaded|2")
      .chooseOption("bottom")
      .expectDeckBottom(0, "raging onslaught|1")
      .play("zero to sixty|1")
      .expectAttackValue(6);
  });
});

describe("ARC — Mechanologist items", () => {
  it("Aether Sink and Cognition Nodes can load an empty steam counter", () => {
    const sink = scenario({
      seats: [
        { ...mech, board: ["aether sink|2"], hand: ["locked and loaded|3"] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    boardCard(sink, 0, "aether sink|2").counters = { steam: 0 };
    sink.activate("aether sink|2", { ability: 0, pitch: ["locked and loaded|3"] });
    expect(boardCard(sink, 0, "aether sink|2").counters?.steam).toBe(1);
    sink.expectAP(0, 1);

    const nodes = scenario({
      seats: [
        { ...mech, board: ["cognition nodes|3"], hand: ["locked and loaded|3"] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    boardCard(nodes, 0, "cognition nodes|3").counters = { steam: 0 };
    nodes.activate("cognition nodes|3", { ability: 0, pitch: ["locked and loaded|3"] });
    expect(boardCard(nodes, 0, "cognition nodes|3").counters?.steam).toBe(1);
    nodes.expectAP(0, 1);
  });

  it("Aether Sink's Arcane Barrier does not prevent physical damage", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...mech, board: ["aether sink|2"], hand: [] },
        { hero: "dorinthea", weapons: [], hand: ["zero to sixty|1"] },
      ],
    });
    boardCard(g, 0, "aether sink|2").counters = { steam: 1 };

    g.play("zero to sixty|1", { settle: false })
      .passPriority()
      .activate("aether sink|2", { ability: 1, settle: false });

    expect(boardCard(g, 0, "aether sink|2").counters?.steam ?? 0).toBe(0);
    expect(
      legalIntents(g.state, 0).some(
        (intent) =>
          intent.kind === "activate-ability" &&
          intent.sourceInstanceId === boardCard(g, 0, "aether sink|2").instanceId &&
          intent.abilityIndex === 1,
      ),
    ).toBe(false);

    g.settle()
      .blockWith()
      .settle()
      .expectLife(0, 16);
  });

  it("Aether Sink's Arcane Barrier can be paid for each separate arcane-damage event", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          ...mech,
          board: ["aether sink|2"],
          hand: ["locked and loaded|3", "zero to sixty|3"],
        },
        {
          hero: "dorinthea",
          weapons: [],
          board: ["runechant|0", "runechant|0"],
          hand: ["wounded bull|1"],
          resources: 3,
        },
      ],
    });
    boardCard(g, 0, "aether sink|2").counters = { steam: 1 };

    g.play("wounded bull|1", { settle: false })
      .passPriority()
      .activate("aether sink|2", { ability: 1, settle: false })
      .settle()
      .chooseOption("pay 2")
      .chooseCard("locked and loaded|3")
      .chooseOption("pay 2")
      .chooseCard("zero to sixty|3")
      .expectLife(0, 20)
      .blockWith()
      .settle()
      .endTurn();

    expect(boardCard(g, 0, "aether sink|2").grantedKeywords).toBeUndefined();
  });

  it("Dissipation Shield removes steam at maintenance", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...mech, board: ["dissipation shield|2"], hand: [] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    boardCard(g, 0, "dissipation shield|2").counters = { steam: 2 };

    g.endTurn().chooseOption("remove");
    expect(boardCard(g, 0, "dissipation shield|2").counters?.steam).toBe(1);
  });

  it("Dissipation Shield destroys itself to prevent damage equal to its steam", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...mech, board: ["dissipation shield|2"], hand: [] },
        { hero: "dorinthea", weapons: [], hand: ["zero to sixty|1"] },
      ],
    });
    boardCard(g, 0, "dissipation shield|2").counters = { steam: 3 };

    g.play("zero to sixty|1", { settle: false })
      .passPriority()
      .activate("dissipation shield|2")
      .expectInZone(0, "dissipation shield|2", "graveyard")
      .blockWith()
      .settle()
      .expectLife(0, 19);
  });

  it("Optekal Monocle removes its last steam, opts, and destroys itself", () => {
    const g = scenario({
      seats: [
        { ...mech, board: ["optekal monocle|3"], hand: [], deck: ["raging onslaught|1", "raging onslaught|3"] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    boardCard(g, 0, "optekal monocle|3").counters = { steam: 1 };

    g.activate("optekal monocle|3")
      .chooseOption("bottom")
      .expectDeckBottom(0, "raging onslaught|1")
      .expectInZone(0, "optekal monocle|3", "graveyard")
      .expectAP(0, 1);
  });

  it("ARC Opt effects put energy counters on Blaze", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "blaze, firemind|0",
          weapons: [],
          board: ["optekal monocle|3"],
          deck: ["raging onslaught|1"],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    boardCard(g, 0, "optekal monocle|3").counters = { steam: 1 };

    g.activate("optekal monocle|3").chooseOption("top");
    expect(g.state.players[0]!.hero.counters?.energy).toBe(1);
  });
});
