import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { printingId, scenario, type Scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const SEISMIC_SURGE_TOKEN = "CRU044";
const SPECTRAL_SHIELD = "spectral shield|0";
const CRADLE = "channel galcia's cradle|3";
const BOO = "boo, resident spook|2";

function boardCount(g: Scenario, seat: number, key: string): number {
  return g.state.players[seat]!.board.filter((card) => card.cardId === printingId(key)).length;
}

function boardCard(g: Scenario, seat: number, key: string) {
  return g.state.players[seat]!.board.find((card) => card.cardId === printingId(key));
}

function canActivate(g: Scenario, seat: number, instanceId: number): boolean {
  return legalIntents(g.state, seat).some(
    (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === instanceId,
  );
}

function resolveCardLayers(g: Scenario): void {
  while (g.state.stack[0]?.card) g.passPriority();
}

describe("Shimmering Specter leaves the arena from the combat chain", () => {
  it("creates a Spectral Shield when it leaves the chain after attacking", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["shimmering specter|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.play("shimmering specter|1").blockWith().settle();
    expect(boardCount(g, 0, SPECTRAL_SHIELD)).toBe(0);

    g.passUntilLayer("Create a Spectral Shield token");
    g.expectInZone(0, "shimmering specter|1", "graveyard");
    g.passPriority().passPriority();
    expect(boardCount(g, 0, SPECTRAL_SHIELD)).toBe(1);
  });

  it("creates a Spectral Shield for its defender when it leaves the chain after defending", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["wounded bull|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", hand: ["shimmering specter|1"], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("wounded bull|1").blockWith("shimmering specter|1").settle();
    expect(boardCount(g, 1, SPECTRAL_SHIELD)).toBe(0);

    g.passUntilLayer("Create a Spectral Shield token");
    g.passPriority().passPriority();
    expect(boardCount(g, 1, SPECTRAL_SHIELD)).toBe(1);
    expect(boardCount(g, 0, SPECTRAL_SHIELD)).toBe(0);
  });
});

describe("Channel Galcia's Cradle", () => {
  it("freezes its target while it is in the arena, and again at the start of each of your turns", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: [CRADLE], board: [BOO], pitch: [CRADLE], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: { ...NO_EQUIPMENT, arms: "gallantry gold|0" } },
      ],
    });
    const boo = boardCard(g, 0, BOO)!;
    const gallantry = g.state.players[1]!.equipment.arms!;
    expect(canActivate(g, 0, boo.instanceId)).toBe(true);

    g.play(CRADLE, { settle: false });
    g.passUntilLayer("Freeze target ally, aura, item, or equipment");
    g.doRaw({ kind: "choose", optionId: String(boo.instanceId) });
    g.passPriority().passPriority();
    expect(canActivate(g, 0, boo.instanceId)).toBe(false);

    // Channel Ice: the pitched Ice card keeps it in the arena. The freeze has
    // no turn limit, so it lasts into your next turn.
    g.endTurn();
    g.expectInZone(0, CRADLE, "board");
    g.passActionPhase().settle();
    expect(g.state.activePlayer).toBe(0);

    // At the start of your turn it freezes another target.
    expect(g.stackLabels()).toEqual(["Freeze target ally, aura, item, or equipment"]);
    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    g.doRaw({ kind: "choose", optionId: String(gallantry.instanceId) });
    g.settle();
    expect(canActivate(g, 0, boo.instanceId)).toBe(false);
    expect(
      Object.keys(g.state.players[1]!.equipment.arms!.scriptState ?? {}).some((key) =>
        key.startsWith("frozenWhileInArena:"),
      ),
    ).toBe(true);
  });

  it("stops freezing once it leaves the arena", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: [CRADLE], board: [BOO], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });
    const boo = boardCard(g, 0, BOO)!;

    g.play(CRADLE, { settle: false });
    g.passUntilLayer("Freeze target ally, aura, item, or equipment");
    g.doRaw({ kind: "choose", optionId: String(boo.instanceId) });
    g.passPriority().passPriority();
    expect(canActivate(g, 0, boo.instanceId)).toBe(false);

    // With no Ice card in the pitch zone, Channel Ice destroys it at the end phase.
    g.endTurn();
    g.expectInZone(0, CRADLE, "graveyard");
    g.endTurn();
    expect(canActivate(g, 0, boo.instanceId)).toBe(true);
  });
});

describe("Ironsong Pride end-phase check", () => {
  it("is destroyed at the beginning of your end phase if no sword hit this turn", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", resources: 1, weapons: ["dawnblade, resplendent|0"], hand: ["ironsong pride|1"] },
        { hero: "rhinar" },
      ],
    });
    const sword = g.state.players[0]!.weapons[0]!;

    g.play("ironsong pride|1", { settle: false });
    resolveCardLayers(g);
    g.doRaw({ kind: "choose", optionId: String(sword.instanceId) });
    g.passPriority().passPriority();
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(1);

    g.passActionPhase();
    g.expectLog("Ironsong Pride triggers: Destroy this unless a sword has hit this turn");
    g.expectInZone(0, "ironsong pride|1", "graveyard");
    // Its leave trigger then removes the counters it put on the sword.
    g.expectLog("Ironsong Pride triggers: Remove all +1 power counters from swords you control");
    expect(g.state.players[0]!.weapons[0]!.counters?.power ?? 0).toBe(0);
  });

  it("stays when a sword hit this turn, including a hit before it entered the arena", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", resources: 2, weapons: ["dawnblade, resplendent|0"], hand: ["ironsong pride|1"] },
        { hero: "rhinar", equipment: NO_EQUIPMENT },
      ],
    });
    const sword = g.state.players[0]!.weapons[0]!;
    const life = g.state.players[1]!.life;

    g.attackWithWeapon("dawnblade, resplendent|0").blockWith().settle();
    expect(g.state.players[1]!.life).toBeLessThan(life);

    g.play("ironsong pride|1", { settle: false });
    resolveCardLayers(g);
    g.doRaw({ kind: "choose", optionId: String(sword.instanceId) });
    g.passPriority().passPriority();

    g.endTurn();
    g.expectInZone(0, "ironsong pride|1", "board");
    g.expectNoLog("Destroy this unless a sword has hit this turn");
  });
});

describe("Nerves of Steel", () => {
  it("is destroyed when your hero is dealt damage", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["wounded bull|1"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", board: ["nerves of steel|3"], equipment: NO_EQUIPMENT },
      ],
    });

    g.play("wounded bull|1").blockWith().settle();
    g.expectLog("Nerves of Steel triggers: Destroy this");
    g.expectInZone(1, "nerves of steel|3", "graveyard");
  });

  it("stops Battleworn from triggering on equipment that defended an attack with 2 or less power", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|3"], equipment: NO_EQUIPMENT },
        {
          hero: "dorinthea",
          board: ["nerves of steel|3"],
          equipment: { ...NO_EQUIPMENT, arms: "gallantry gold|0" },
        },
      ],
    });

    g.play("head jab|3").blockWith("gallantry gold|0").settle();
    expect(g.state.chain[0]?.finalAttack).toBeLessThanOrEqual(2);
    g.endTurn();
    g.expectNoLog("(Battleworn)");
    expect(g.state.players[1]!.equipment.arms?.defCounters ?? 0).toBe(0);
    g.expectInZone(1, "nerves of steel|3", "board");
  });

  it("does not stop Battleworn against an attack with more than 2 power", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["wounded bull|1"], equipment: NO_EQUIPMENT },
        {
          hero: "dorinthea",
          board: ["nerves of steel|3"],
          equipment: { ...NO_EQUIPMENT, arms: "gallantry gold|0" },
        },
      ],
    });

    g.play("wounded bull|1").blockWith("gallantry gold|0").settle();
    g.endTurn();
    g.expectLog("gets a -1 defense counter (Battleworn)");
    expect(g.state.players[1]!.equipment.arms?.defCounters).toBe(1);
  });
});

describe("Who Blinks First?", () => {
  // Pleiades's counter-removal cost destroys the aura while players hold priority.
  function blinksLeaves(): Scenario {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "pleiades, superstar|0",
          weapons: [],
          board: ["who blinks first?|3", "in the palm of your hand|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", heroKey: "bravo, showstopper|0", board: [SEISMIC_SURGE_TOKEN], equipment: NO_EQUIPMENT },
      ],
    });
    for (const card of g.state.players[0]!.board) card.counters = { suspense: 1 };
    g.activate("pleiades, superstar|0", { settle: false });
    g.doRaw({ kind: "choose", optionId: String(boardCard(g, 0, "who blinks first?|3")!.instanceId) });
    g.expectInZone(0, "who blinks first?|3", "graveyard");
    g.passPriority().passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("blinks-aura");
    return g;
  }

  it("may decline to destroy an aura a Guardian hero controls", () => {
    const g = blinksLeaves();
    const surge = g.state.players[1]!.board[0]!;
    // Pleiades is a Guardian too, so her own auras are also options.
    expect(g.state.pendingDecision?.options?.[0]).toBe("pass");
    expect(g.state.pendingDecision?.options).toContain(String(surge.instanceId));

    g.doRaw({ kind: "choose", optionId: "pass" });
    g.expectZoneSize(1, "board", 1).expectZoneSize(0, "board", 1);
  });

  it("destroys the chosen aura a Guardian hero controls", () => {
    const g = blinksLeaves();
    const surge = g.state.players[1]!.board[0]!;

    g.doRaw({ kind: "choose", optionId: String(surge.instanceId) });
    g.expectZoneSize(1, "board", 0);
  });
});

describe("Destructive Tendencies", () => {
  // An item token, an aura token, and a non-token aura, each with a counter.
  function tendencies(): { g: Scenario; gold: number; surge: number } {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["destructive tendencies|3"], board: ["gold|0", SEISMIC_SURGE_TOKEN, "who blinks first?|3"] },
        { hero: "dorinthea" },
      ],
    });
    for (const card of g.state.players[0]!.board) card.counters = { suspense: 1 };
    const [gold, surge] = g.state.players[0]!.board;
    g.play("destructive tendencies|3");
    return { g, gold: gold!.instanceId, surge: surge!.instanceId };
  }

  function countersOn(g: Scenario, instanceId: number): number {
    const card = g.state.players[0]!.board.find((candidate) => candidate.instanceId === instanceId)!;
    return Object.values(card.counters ?? {}).reduce((sum, n) => sum + Number(n), 0);
  }

  it("removes all counters from both a target item token and a target aura token", () => {
    const { g, gold, surge } = tendencies();
    expect(g.state.pendingDecision?.chooseHook).toBe("pen-tendencies-item");
    expect(g.state.pendingDecision?.options).toEqual(["pass", String(gold)]);
    g.doRaw({ kind: "choose", optionId: String(gold) });

    // A non-token aura is not a legal target.
    expect(g.state.pendingDecision?.chooseHook).toBe("pen-tendencies-aura");
    expect(g.state.pendingDecision?.options).toEqual(["pass", String(surge)]);
    g.doRaw({ kind: "choose", optionId: String(surge) });

    expect(countersOn(g, gold)).toBe(0);
    expect(countersOn(g, surge)).toBe(0);
    expect(g.state.players[0]!.board[2]!.counters?.suspense).toBe(1);
  });

  it("may choose only the aura token mode, but not neither mode", () => {
    const { g, gold, surge } = tendencies();
    g.doRaw({ kind: "choose", optionId: "pass" });

    expect(g.state.pendingDecision?.options).toEqual([String(surge)]);
    g.doRaw({ kind: "choose", optionId: String(surge) });

    expect(countersOn(g, gold)).toBe(1);
    expect(countersOn(g, surge)).toBe(0);
  });
});
