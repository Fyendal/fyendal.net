import { describe, expect, it } from "vitest";
import type { GameIntent } from "@fyendal/shared";
import { legalIntents, onlyIdleResourceSources } from "@fyendal/engine";
import { printingId, scenario, type Scenario, type SeatSpec } from "../harness.js";

const isPassive = (intent: GameIntent): boolean =>
  intent.kind === "pass" || intent.kind === "concede" || intent.kind.endsWith("-draw");

/** No weapon or chest ability that the extra resources could also fund. */
const UNARMED = { weapons: [], equipment: { chest: null } } satisfies Partial<SeatSpec>;

function idle(g: Scenario, seat = 0): boolean {
  return onlyIdleResourceSources(g.state, seat, legalIntents(g.state, seat), isPassive);
}

function withChargedTunic(spec: Omit<SeatSpec, "hero" | "equipment">): Scenario {
  const g = scenario({
    seats: [
      { hero: "rhinar", equipment: { chest: "fyendal's spring tunic|0" }, ...spec },
      { hero: "dorinthea" },
    ],
  });
  g.state.players[0]!.equipment.chest!.counters = { energy: 3 };
  return g;
}

function isActivationOf(g: Scenario, key: string) {
  return (intent: GameIntent): boolean => {
    if (intent.kind !== "activate-ability") return false;
    const player = g.state.players[0]!;
    const source = [...Object.values(player.equipment), ...player.hand]
      .find((card) => card?.instanceId === intent.sourceInstanceId);
    return source?.cardId === printingId(key);
  };
}

describe("resource-only activations and auto-pass", () => {
  it("treats a charged Fyendal's Spring Tunic alone as nothing to stop for", () => {
    const g = withChargedTunic({});
    expect(legalIntents(g.state, 0).some(isActivationOf(g, "fyendal's spring tunic|0"))).toBe(true);
    expect(idle(g)).toBe(true);
  });

  it("stops when the Tunic's resource would make an otherwise unaffordable card playable", () => {
    const g = withChargedTunic({ hand: ["raging onslaught|1"], resources: 2, weapons: [] });
    const onslaught = g.state.players[0]!.hand[0]!;
    // 2 floating resources can't pay Raging Onslaught's 3 on their own…
    expect(legalIntents(g.state, 0)).not.toContainEqual(
      expect.objectContaining({ kind: "play-card", instanceId: onslaught.instanceId }),
    );
    // …but the Tunic's extra resource can, so the window is worth a stop.
    expect(idle(g)).toBe(false);
  });

  it("still skips when the Tunic's resource is not enough to unlock anything", () => {
    const g = withChargedTunic({ hand: ["raging onslaught|1"], resources: 1, weapons: [] });
    expect(idle(g)).toBe(true);
  });

  it("counts a from-hand source such as Blood Harvest", () => {
    const enabling = scenario({
      seats: [
        { hero: "rhinar", hand: ["blood harvest|0", "raging onslaught|1"], ...UNARMED },
        { hero: "dorinthea" },
      ],
    });
    expect(legalIntents(enabling.state, 0).some(isActivationOf(enabling, "blood harvest|0"))).toBe(true);
    expect(idle(enabling)).toBe(false);

    const alone = scenario({
      seats: [{ hero: "rhinar", hand: ["blood harvest|0"], ...UNARMED }, { hero: "dorinthea" }],
    });
    expect(idle(alone)).toBe(true);
  });

  it("follows Dead Threads' ally-in-graveyard condition", () => {
    const threads = (spec: Omit<SeatSpec, "hero" | "equipment">): Scenario => scenario({
      seats: [
        { hero: "rhinar", equipment: { chest: "dead threads|0" }, weapons: [], ...spec },
        { hero: "dorinthea" },
      ],
    });
    const allyDied = (g: Scenario): Scenario => {
      g.state.players[0]!.flags["graveSubtype:ally"] = true;
      return g;
    };

    // Without an ally in the graveyard the ability can't fund anything.
    const unmet = threads({ hand: ["raging onslaught|1"], resources: 2 });
    expect(legalIntents(unmet.state, 0).some(isActivationOf(unmet, "dead threads|0"))).toBe(false);
    expect(idle(unmet)).toBe(true);

    const charged = allyDied(threads({}));
    expect(legalIntents(charged.state, 0).some(isActivationOf(charged, "dead threads|0"))).toBe(true);
    expect(idle(charged)).toBe(true);

    expect(idle(allyDied(threads({ hand: ["raging onslaught|1"], resources: 2 })))).toBe(false);
  });

  it("chains a source that another source's activation enables", () => {
    // Blood Harvest leaving the hand empties it, which is Threadbare Tunic's
    // condition; only both together pay for the 4-cost arsenal card.
    const chained = (chest: string | null): Scenario => scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["blood harvest|0"],
          arsenal: ["buckling blow|1"],
          equipment: { chest },
          weapons: [],
        },
        { hero: "dorinthea" },
      ],
    });

    const both = chained("threadbare tunic|0");
    expect(legalIntents(both.state, 0).some(isActivationOf(both, "threadbare tunic|0"))).toBe(false);
    expect(idle(both)).toBe(false);

    // Blood Harvest alone can't pay for it.
    expect(idle(chained(null))).toBe(true);
  });

  it("uses a variable gain's maximum for Barkbone Strapping", () => {
    const strapping = (hand: string[]): Scenario => scenario({
      seats: [
        { hero: "rhinar", hand, equipment: { chest: "barkbone strapping|0" }, weapons: [] },
        { hero: "dorinthea" },
      ],
    });
    // Only a roll of 6 pays for Raging Onslaught, which is still worth a stop.
    expect(idle(strapping(["raging onslaught|1"]))).toBe(false);
    expect(idle(strapping([]))).toBe(true);
  });

  it("still performs the gain for an ability built with resourceAbility", () => {
    const g = withChargedTunic({ weapons: [] });
    g.activate("fyendal's spring tunic|0").expectResources(0, 1);
    expect(g.state.players[0]!.equipment.chest?.counters?.energy ?? 0).toBe(0);
  });

  it("never treats a window with a real play as idle", () => {
    const g = withChargedTunic({ hand: ["wrecker romp|1", "raging onslaught|3"] });
    expect(idle(g)).toBe(false);
  });
});
