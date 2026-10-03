import { describe, expect, it } from "vitest";
import type { ChainLinkView, GameTurnStatsView, GameView } from "@fyendal/shared";
import {
  averagePerRound,
  averageThreatPerAttack,
  averageValue,
  computeCycleStats,
  cycleValue,
  preventedDamage,
  totalPrevented,
} from "../replay/stats.js";

let nextInstance = 1;

function link(
  owner: number,
  attackValue: number,
  defenseValue: number,
  resolved = true,
  instanceId?: number,
): ChainLinkView {
  const id = instanceId ?? nextInstance++;
  return {
    attackingCard: { instanceId: id, cardId: "TST001", owner },
    defendingCards: [],
    attackValue,
    defenseValue,
    damage: Math.max(0, attackValue - defenseValue),
    resolved,
    reactions: [],
  };
}

function frame(
  turn: number,
  activePlayer: number,
  chain: ChainLinkView[],
  life: [number, number] = [20, 20],
): GameView {
  return {
    gameId: "g1",
    turn,
    phase: "action",
    activePlayer,
    priorityPlayer: activePlayer,
    players: [
      { seat: 0, life: life[0] },
      { seat: 1, life: life[1] },
    ],
    chain,
    stack: [],
    pendingDecision: null,
    winner: null,
    log: [],
  } as unknown as GameView;
}

describe("computeCycleStats", () => {
  it("prefers authoritative engine counters, including off-turn effect damage", () => {
    const misleadingLegacyLink = link(0, 9, 0);
    const view = frame(2, 1, [misleadingLegacyLink]);
    view.gameStats = {
      turns: [
        {
          turn: 1,
          activePlayer: 0,
          attacks: [1, 0],
          threatened: [4, 3],
          blocked: [0, 2],
          damageDealt: [2, 3],
        },
        {
          turn: 2,
          activePlayer: 1,
          attacks: [0, 1],
          threatened: [2, 5],
          blocked: [1, 0],
          damageDealt: [2, 4],
          allyAbsorbed: [1, 2],
          lifeGained: [0, 2],
          lifeLost: [1, 0],
        },
      ],
    };

    expect(computeCycleStats([view])).toEqual({
      rows: [
        {
          cycle: 0,
          attacks: [1, 0],
          threatened: [4, 3],
          blocked: [0, 2],
          damageDealt: [2, 3],
          allyAbsorbed: [0, 0],
          lifeGained: [0, 0],
          lifeLost: [0, 0],
        },
        {
          cycle: 1,
          attacks: [0, 1],
          threatened: [2, 5],
          blocked: [1, 0],
          damageDealt: [2, 4],
          allyAbsorbed: [1, 2],
          lifeGained: [0, 2],
          lifeLost: [1, 0],
        },
      ],
      cyclesPlayed: [0, 1],
      total: {
        attacks: [1, 1],
        threatened: [6, 8],
        blocked: [1, 2],
        damageDealt: [4, 7],
        allyAbsorbed: [1, 2],
        lifeGained: [0, 2],
        lifeLost: [1, 0],
      },
    });
  });

  it("separates the opening turn and pairs later turns into rounds", () => {
    const views = [
      frame(1, 0, [link(0, 6, 3)]), // seat 0 threatens 6, seat 1 blocks 3
      frame(1, 0, []), // chain closed
      frame(2, 1, [link(1, 4, 4)]), // seat 1 threatens 4, seat 0 blocks 4
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows).toEqual([
      {
        cycle: 0,
        attacks: [1, 0],
        threatened: [6, 0],
        blocked: [0, 3],
        damageDealt: [3, 0],
        allyAbsorbed: [0, 0],
        lifeGained: [0, 0],
        lifeLost: [0, 0],
      },
      {
        cycle: 1,
        attacks: [0, 1],
        threatened: [0, 4],
        blocked: [4, 0],
        damageDealt: [0, 0],
        allyAbsorbed: [0, 0],
        lifeGained: [0, 0],
        lifeLost: [0, 0],
      },
    ]);
    expect(stats.cyclesPlayed).toEqual([0, 1]);
    expect(stats.total).toEqual({
      attacks: [1, 1],
      threatened: [6, 4],
      blocked: [4, 3],
      damageDealt: [3, 0],
      allyAbsorbed: [0, 0],
      lifeGained: [0, 0],
      lifeLost: [0, 0],
    });
  });

  it("uses resolved hero-target combat damage rather than net life changes", () => {
    const views = [
      frame(1, 0, [], [20, 20]), // turn 1 starts, seat 1 at 20
      frame(1, 0, [link(0, 6, 3)], [20, 17]), // hit for 3
      frame(2, 1, [], [20, 17]), // turn 2 starts, seat 0 still at 20
      frame(2, 1, [link(1, 5, 0)], [14, 17]), // seat 0 drops 20 → 14
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows.map((row) => row.damageDealt)).toEqual([[3, 0], [0, 5]]);
    expect(stats.total.damageDealt).toEqual([3, 5]);
  });

  it("does not misattribute life loss outside combat to the active player", () => {
    const views = [
      frame(1, 0, [], [20, 20]),
      frame(1, 0, [], [20, 18]),
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows[0]!.damageDealt).toEqual([0, 0]);
  });

  it("caps blocked damage at the attack value instead of counting over-block", () => {
    const stats = computeCycleStats([frame(1, 0, [link(0, 2, 7)])]);
    expect(stats.rows[0]!.blocked).toEqual([0, 2]);
  });

  it("derives post-block prevention from threatened and dealt damage", () => {
    const stats = computeCycleStats([
      frame(1, 0, [{ ...link(0, 6, 2), damage: 1 }]),
    ]);
    expect(preventedDamage(stats.rows[0]!, 1)).toBe(3);
    expect(totalPrevented(stats, 1)).toBe(3);
  });

  it("reports ally damage separately without adding it to Talishar value", () => {
    const attack = { ...link(0, 4, 0), targetAllyName: "Ashwing", damage: 3 };
    const stats = computeCycleStats([frame(1, 0, [attack]), frame(2, 1, [])]);
    expect(stats.total.damageDealt).toEqual([0, 0]);
    expect(stats.total.allyAbsorbed).toEqual([0, 3]);
    expect(stats.total.threatened).toEqual([0, 0]);
    expect(stats.total.attacks).toEqual([0, 0]);
    expect(stats.total.blocked).toEqual([0, 0]);
    expect(cycleValue(stats.rows[0]!, 1)).toBe(0);
    expect(averageValue(stats, 1)).toBe(0);
  });

  it("counts a weapon attacking again on a later turn", () => {
    const views = [
      frame(1, 0, [link(0, 3, 0, true, 7)]),
      frame(2, 1, []), // chain closed
      frame(3, 0, [link(0, 3, 0, true, 7)]), // same weapon, next cycle
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows.map((r) => r.threatened)).toEqual([
      [3, 0],
      [3, 0],
    ]);
  });

  it("counts a weapon attacking again after a mid-turn chain close", () => {
    const views = [
      frame(1, 0, [link(0, 3, 0, true, 7)]),
      frame(1, 0, []), // non-attack action closed the chain
      frame(1, 0, [link(0, 3, 0, true, 7)]),
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows[0]!.threatened).toEqual([6, 0]);
  });

  it("tracks repeated attacks by the same weapon on one chain", () => {
    const views = [
      frame(1, 0, [link(0, 2, 0, true, 7)]),
      frame(1, 0, [link(0, 2, 0, true, 7), link(0, 3, 1, true, 7)]),
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows[0]!.threatened).toEqual([5, 0]);
  });

  it("ignores unresolved links until they resolve, then counts them once", () => {
    const l = link(0, 7, 2, false, 42);
    const views = [
      frame(1, 0, [l]),
      frame(1, 0, [{ ...l, resolved: true }]),
      frame(1, 0, [{ ...l, resolved: true }]), // resent frame — no double count
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows[0]!.threatened).toEqual([7, 0]);
    expect(stats.rows[0]!.blocked).toEqual([0, 2]);
  });

  it("handles a game with no combat and no damage", () => {
    const stats = computeCycleStats([frame(1, 0, [])]);
    expect(stats.rows).toEqual([{
      cycle: 0,
      attacks: [0, 0],
      threatened: [0, 0],
      blocked: [0, 0],
      damageDealt: [0, 0],
      allyAbsorbed: [0, 0],
      lifeGained: [0, 0],
      lifeLost: [0, 0],
    }]);
    expect(stats.total).toEqual({
      attacks: [0, 0],
      threatened: [0, 0],
      blocked: [0, 0],
      damageDealt: [0, 0],
      allyAbsorbed: [0, 0],
      lifeGained: [0, 0],
      lifeLost: [0, 0],
    });
  });
});

describe("cycleValue / averageValue", () => {
  it("matches the Dash I/O replay after treating engine turn 1 as opening turn 0", () => {
    const turn = (
      number: number,
      activePlayer: number,
      threatened: [number, number],
      blocked: [number, number],
      damageDealt: [number, number],
    ): GameTurnStatsView => ({
      turn: number, activePlayer, attacks: [0, 0], threatened, blocked, damageDealt,
    });
    const view = frame(9, 0, []);
    view.gameStats = { turns: [
      turn(1, 0, [0, 0], [0, 0], [0, 0]),
      turn(2, 1, [0, 10], [0, 0], [0, 10]),
      turn(3, 0, [15, 0], [0, 11], [4, 0]),
      turn(4, 1, [0, 6], [0, 0], [0, 6]),
      turn(5, 0, [15, 0], [0, 3], [12, 0]),
      turn(6, 1, [0, 8], [2, 0], [0, 6]),
      turn(7, 0, [23, 0], [0, 3], [20, 0]),
      turn(8, 1, [0, 8], [3, 0], [0, 5]),
      turn(9, 0, [11, 0], [0, 4], [5, 0]),
    ] };

    const stats = computeCycleStats([view]);
    expect(stats.rows.map((row) => row.cycle)).toEqual([0, 1, 2, 3, 4]);
    expect(stats.cyclesPlayed).toEqual([4, 4]);
    expect(stats.rows.map((row) => cycleValue(row, 0))).toEqual([0, 15, 15, 25, 14]);
    expect(stats.rows.map((row) => cycleValue(row, 1))).toEqual([0, 21, 9, 11, 14]);
    expect(averageValue(stats, 0)).toBe(17.25);
    expect(averageValue(stats, 1)).toBe(13.75);
  });

  it("folds legacy turn 0 into the FaB opening turn and excludes both from averages", () => {
    const view = frame(2, 1, []);
    view.gameStats = { turns: [
      {
        turn: 0, activePlayer: 0, attacks: [0, 0], threatened: [0, 0],
        blocked: [0, 0], damageDealt: [0, 0], lifeGained: [2, 0],
      },
      {
        turn: 1, activePlayer: 0, attacks: [1, 0], threatened: [6, 0],
        blocked: [0, 0], damageDealt: [6, 0],
      },
      {
        turn: 2, activePlayer: 1, attacks: [0, 0], threatened: [0, 0],
        blocked: [0, 0], damageDealt: [0, 0],
      },
      {
        turn: 3, activePlayer: 0, attacks: [1, 0], threatened: [4, 0],
        blocked: [0, 0], damageDealt: [4, 0],
      },
    ] };
    const stats = computeCycleStats([view]);
    expect(stats.rows.map((row) => row.cycle)).toEqual([0, 1]);
    expect(stats.cyclesPlayed).toEqual([1, 1]);
    expect(cycleValue(stats.rows[0]!, 0)).toBe(8);
    expect(averageValue(stats, 0)).toBe(4);
    expect(averagePerRound(stats, 0, "threatened")).toBe(4);
  });

  it("folds legacy replay turn 0 into the opening row", () => {
    const stats = computeCycleStats([
      frame(0, 0, [link(0, 2, 0)]),
      frame(0, 0, []),
      frame(1, 0, [link(0, 4, 0)]),
    ]);
    expect(stats.rows.map((row) => row.cycle)).toEqual([0]);
    expect(stats.cyclesPlayed).toEqual([0, 0]);
    expect(averageValue(stats, 0)).toBe(0);
  });

  it("value includes threat, blocks, prevention, life gain, and life loss", () => {
    const stats = computeCycleStats([
      frame(1, 0, [link(0, 6, 3)]),
      frame(2, 1, [link(1, 4, 4)]),
    ]);
    expect(cycleValue(stats.rows[0]!, 0)).toBe(6); // opening threat
    expect(cycleValue(stats.rows[0]!, 1)).toBe(3); // opening block
    expect(cycleValue(stats.rows[1]!, 0)).toBe(4); // block during round 1
    expect(cycleValue(stats.rows[1]!, 1)).toBe(4); // threat during round 1
  });

  it("keeps authoritative ally damage out of value and averages", () => {
    const view = frame(1, 0, []);
    view.gameStats = { turns: [{
      turn: 1, activePlayer: 0, attacks: [0, 0], threatened: [0, 0],
      blocked: [0, 0], damageDealt: [0, 0], allyAbsorbed: [4, 0],
    }] };
    const stats = computeCycleStats([view]);
    expect(stats.total.allyAbsorbed[0]).toBe(4);
    expect(cycleValue(stats.rows[0]!, 0)).toBe(0);
    expect(averageValue(stats, 0)).toBe(0);
  });

  it("subtracts Blood Debt-like life loss without treating it as damage dealt", () => {
    const view = frame(1, 0, []);
    view.gameStats = { turns: [{
      turn: 1, activePlayer: 0, attacks: [0, 0], threatened: [0, 0],
      blocked: [0, 0], damageDealt: [0, 0], lifeGained: [0, 0], lifeLost: [1, 0],
    }] };
    const stats = computeCycleStats([view]);
    expect(stats.total.damageDealt).toEqual([0, 0]);
    expect(cycleValue(stats.rows[0]!, 0)).toBe(-1);
    expect(averageValue(stats, 0)).toBe(0); // opening life loss is excluded
  });

  it("includes prevention and life gain in value", () => {
    const view = frame(1, 0, []);
    view.gameStats = { turns: [{
      turn: 1, activePlayer: 0, attacks: [1, 0], threatened: [4, 0],
      blocked: [0, 0], damageDealt: [1, 0], lifeGained: [0, 2], lifeLost: [0, 0],
    }] };
    const stats = computeCycleStats([view]);
    expect(preventedDamage(stats.rows[0]!, 1)).toBe(3);
    expect(cycleValue(stats.rows[0]!, 1)).toBe(5);
  });

  it("averages value over post-opening rounds each seat played in", () => {
    const stats = computeCycleStats([
      frame(1, 0, [link(0, 6, 2)]),
      frame(2, 1, [link(1, 4, 1)]),
      frame(3, 0, [link(0, 4, 0)]),
      frame(4, 1, []),
    ]);
    // Seat 0's opening threat is excluded; round 1 has 4 threat + 1 block.
    expect(averageValue(stats, 0)).toBe(5);
    // Seat 1 has 4 threat over rounds 1 and 2; opening block is excluded.
    expect(averageValue(stats, 1)).toBe(2);
  });

  it("returns zero with no recorded turns", () => {
    const stats = computeCycleStats([]);
    expect(averageValue(stats, 0)).toBe(0);
  });

  it("computes Talishar-style per-round and per-attack averages", () => {
    const stats = computeCycleStats([
      frame(1, 0, [link(0, 6, 2)]),
      frame(2, 1, [link(1, 4, 1)]),
      frame(3, 0, [link(0, 4, 0)]),
      frame(4, 1, []),
    ]);
    expect(averagePerRound(stats, 0, "threatened")).toBe(4);
    expect(averagePerRound(stats, 0, "blocked")).toBe(1);
    expect(averageThreatPerAttack(stats, 0)).toBe(5);
  });
});
