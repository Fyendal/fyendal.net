import { describe, expect, it } from "vitest";
import { printingId, scenario, type Scenario } from "../harness.js";

function resolveCardLayers(g: Scenario): void {
  while (g.state.stack[0]?.card) g.passPriority();
}

function boardCount(g: Scenario, seat: number, key: string): number {
  return g.state.players[seat]!.board.filter((card) => card.cardId === printingId(key)).length;
}

// DTD / DYN / CRU "When this enters / leaves the arena" abilities wait on the
// stack for priority before their effect happens.
describe("DTD, DYN and CRU arena triggers use the stack", () => {
  it("Figment of War creates Courage only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 4, hand: ["figment of war|2"] }, { hero: "dorinthea" }],
    });

    g.play("figment of war|2", { settle: false });
    resolveCardLayers(g);

    expect(g.state.stack).toEqual([expect.objectContaining({ label: "Create a Courage token" })]);
    g.expectInZone(0, "figment of war|2", "board").expectZoneSize(0, "board", 1);

    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    g.expectZoneSize(0, "board", 2);
  });

  it("Figment of Protection creates a Spectral Shield only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 4, hand: ["figment of protection|2"] }, { hero: "dorinthea" }],
    });

    g.play("figment of protection|2", { settle: false });
    resolveCardLayers(g);

    expect(g.stackLabels().includes("Create a Spectral Shield token")).toBe(true);
    g.expectZoneSize(0, "board", 1);

    g.passPriority().passPriority();
    g.expectZoneSize(0, "board", 2);
  });

  it("Stamp Authority's intervening if gains intellect only on resolution and only with two cost-3 pitches", () => {
    const met = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          hand: ["stamp authority|3"],
          pitch: ["raging onslaught|1", "raging onslaught|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    met.play("stamp authority|3", { settle: false });
    resolveCardLayers(met);

    expect(met.stackLabels().includes("Gain +1 intellect")).toBe(true);
    expect(met.state.players[0]!.flags.bonusIntellect ?? 0).toBe(0);
    met.passPriority().passPriority();
    expect(met.state.players[0]!.flags.bonusIntellect).toBe(1);

    const unmet = scenario({
      seats: [{ hero: "rhinar", resources: 3, hand: ["stamp authority|3"] }, { hero: "dorinthea" }],
    });
    unmet.play("stamp authority|3", { settle: false });
    resolveCardLayers(unmet);
    expect(unmet.stackLabels().includes("Gain +1 intellect")).toBe(false);
  });

  it("Runeblood Barrier creates 4 Runechants only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 3, hand: ["runeblood barrier|2"] }, { hero: "dorinthea" }],
    });

    g.play("runeblood barrier|2", { settle: false });
    resolveCardLayers(g);

    expect(g.stackLabels().includes("Create 4 Runechants")).toBe(true);
    expect(boardCount(g, 0, "runechant|0")).toBe(0);

    g.passPriority().passPriority();
    g.expectZoneSize(0, "board", 5);
  });

  it("Looming Doom destroys Runechants for doom counters only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["looming doom|3"], board: ["runechant|0", "runechant|0"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("looming doom|3", { settle: false });
    resolveCardLayers(g);

    const label = "Destroy your Runechants and put that many doom counters on Looming Doom";
    expect(g.stackLabels().includes(label)).toBe(true);
    expect(boardCount(g, 0, "runechant|0")).toBe(2);

    g.passPriority().passPriority();
    expect(boardCount(g, 0, "runechant|0")).toBe(0);
    const doom = g.state.players[0]!.board.find((card) => card.cardId === printingId("looming doom|3"));
    expect(doom?.counters?.doom).toBe(2);
  });

  it("Ironsong Pride targets a sword as its enter trigger goes on the stack, and clears counters on leaving", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", resources: 2, weapons: ["dawnblade, resplendent|0"], hand: ["ironsong pride|1"] },
        { hero: "rhinar", hand: ["tranquil passing|1", "raging onslaught|3"] },
      ],
    });
    const sword = g.state.players[0]!.weapons[0]!;

    // A sword hit keeps Ironsong Pride through its end-phase check.
    g.attackWithWeapon("dawnblade, resplendent|0").blockWith().settle();
    g.play("ironsong pride|1", { settle: false });
    resolveCardLayers(g);

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    expect(g.state.pendingDecision?.options).toEqual([String(sword.instanceId)]);
    g.doRaw({ kind: "choose", optionId: String(sword.instanceId) });

    const enter = "Put a +1 power counter on target sword you control";
    expect(g.stackLabels().includes(enter)).toBe(true);
    expect(g.state.players[0]!.weapons[0]!.counters?.power ?? 0).toBe(0);

    g.passPriority().passPriority();
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(1);

    // The opponent banishes Ironsong Pride with Tranquil Passing.
    const leave = "Remove all +1 power counters from swords you control";
    const pride = g.state.players[0]!.board.find((card) => card.cardId === printingId("ironsong pride|1"))!;
    g.passActionPhase();
    while (g.state.activePlayer !== 1 || g.state.phase !== "action") g.passPriority();
    g.play("tranquil passing|1", { pitch: ["raging onslaught|3"], settle: false });
    resolveCardLayers(g);
    g.doRaw({ kind: "choose", optionId: String(pride.instanceId) });
    g.passPriority().passPriority();

    expect(g.stackLabels().includes(leave)).toBe(true);
    g.expectInZone(0, "ironsong pride|1", "banish");
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(1);

    g.passPriority().passPriority();
    expect(g.state.players[0]!.weapons[0]!.counters?.power ?? 0).toBe(0);
  });

  it("Tranquil Passing banishes its declared optional target only when its trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["tranquil passing|1"] },
        { hero: "dorinthea", board: ["runechant|0"] },
      ],
    });
    const aura = g.state.players[1]!.board[0]!;

    g.play("tranquil passing|1", { settle: false });
    resolveCardLayers(g);

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    expect(g.state.pendingDecision?.options).toContain(String(aura.instanceId));
    g.doRaw({ kind: "choose", optionId: String(aura.instanceId) });

    expect(g.stackLabels().includes("Banish an opposing aura with cost 3 or less until this leaves")).toBe(true);
    g.expectInZone(1, "runechant|0", "board");

    g.passPriority().passPriority();
    // A banished token ceases to exist.
    g.expectNotInZone(1, "runechant|0", "board").expectNotInZone(1, "runechant|0", "banish");
  });

  it("Tranquil Passing's target may be declined", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["tranquil passing|1"] },
        { hero: "dorinthea", board: ["runechant|0"] },
      ],
    });

    g.play("tranquil passing|1", { settle: false });
    resolveCardLayers(g);

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    const decline = (g.state.pendingDecision?.options ?? []).find((option) => !/^\d+$/.test(option));
    expect(decline).toBeDefined();
    g.doRaw({ kind: "choose", optionId: decline! });
    while (g.state.stack.length) g.passPriority();
    g.expectInZone(1, "runechant|0", "board");
  });
});
