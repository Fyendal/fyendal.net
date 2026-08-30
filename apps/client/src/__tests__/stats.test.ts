import { describe, expect, it } from "vitest";
import type { ChainLinkView, GameView } from "@fyendal/shared";
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
        },
      ],
    };

    expect(computeCycleStats([view])).toEqual({
      rows: [{
        cycle: 1,
        attacks: [1, 1],
        threatened: [6, 8],
        blocked: [1, 2],
        damageDealt: [4, 7],
      }],
      cyclesPlayed: [1, 1],
      total: {
        attacks: [1, 1],
        threatened: [6, 8],
        blocked: [1, 2],
        damageDealt: [4, 7],
      },
    });
  });

  it("pairs turns into cycles: threatened on your turn, blocked on the opponent's", () => {
    const views = [
      frame(1, 0, [link(0, 6, 3)]), // seat 0 threatens 6, seat 1 blocks 3
      frame(1, 0, []), // chain closed
      frame(2, 1, [link(1, 4, 4)]), // seat 1 threatens 4, seat 0 blocks 4
    ];
    const stats = computeCycleStats(views);
    expect(stats.rows).toEqual([
      {
        cycle: 1,
        attacks: [1, 1],
        threatened: [6, 4],
        blocked: [4, 3],
        damageDealt: [3, 0],
      },
    ]);
    expect(stats.cyclesPlayed).toEqual([1, 1]);
    expect(stats.total).toEqual({
      attacks: [1, 1],
      threatened: [6, 4],
      blocked: [4, 3],
      damageDealt: [3, 0],
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
    expect(stats.rows[0]!.damageDealt).toEqual([3, 5]);
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

  it("does not count damage dealt to an ally as hero damage", () => {
    const attack = { ...link(0, 4, 0), targetAllyName: "Ashwing" };
    const stats = computeCycleStats([frame(1, 0, [attack])]);
    expect(stats.total.damageDealt).toEqual([0, 0]);
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
      cycle: 1,
      attacks: [0, 0],
      threatened: [0, 0],
      blocked: [0, 0],
      damageDealt: [0, 0],
    }]);
    expect(stats.total).toEqual({
      attacks: [0, 0],
      threatened: [0, 0],
      blocked: [0, 0],
      damageDealt: [0, 0],
    });
  });
});

describe("cycleValue / averageValue", () => {
  it("value is threatened + blocked within the cycle", () => {
    const stats = computeCycleStats([
      frame(1, 0, [link(0, 6, 3)]),
      frame(2, 1, [link(1, 4, 4)]),
    ]);
    expect(cycleValue(stats.rows[0]!, 0)).toBe(10); // 6 threatened + 4 blocked
    expect(cycleValue(stats.rows[0]!, 1)).toBe(7); // 4 threatened + 3 blocked
  });

  it("averages value over the cycles each seat played in", () => {
    const stats = computeCycleStats([
      frame(1, 0, [link(0, 6, 2)]),
      frame(2, 1, [link(1, 4, 1)]),
      frame(3, 0, [link(0, 4, 0)]),
      frame(4, 1, []),
    ]);
    // seat 0: (6+1) + (4+0) = 11 over 2 cycles = 5.5
    expect(averageValue(stats, 0)).toBe(5.5);
    // seat 1: (4+2) + (0+0) = 6 over 2 cycles = 3
    expect(averageValue(stats, 1)).toBe(3);
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
    expect(averagePerRound(stats, 0, "threatened")).toBe(5);
    expect(averagePerRound(stats, 0, "blocked")).toBe(0.5);
    expect(averageThreatPerAttack(stats, 0)).toBe(5);
  });
});
