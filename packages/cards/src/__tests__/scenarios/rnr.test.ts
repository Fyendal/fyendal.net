import { describe, expect, it } from "vitest";
import { scenario } from "../harness.js";

/** Scenarios for the RNR set: Rhinar's hero ability, bellows, and Wounded Bull. */

describe("RNR — Rhinar hero ability (discard a 6+ card during your action phase)", () => {
  // the additional-cost random discard is paid after the card leaves the hand,
  // so Wrecker Romp itself is never a discard candidate — only the other card
  it("Wrecker Romp discarding a 6+ card triggers intimidate", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["raging onslaught|2"] },
        { hero: "rhinar", hand: ["wrecker romp|3", "raging onslaught|2", "pack hunt|1"] },
      ],
      active: 1,
    });
    g.play("wrecker romp|3", { pitch: ["raging onslaught|2"] })
      // the only other hand card is Pack Hunt (6{p}) — the discard is deterministic
      .expectLog("Pack Hunt at random")
      .expectInZone(1, "pack hunt|1", "graveyard")
      .expectLog("Rhinar's ability triggers")
      .expectAttackValue(6)
      .expectPendingReturn(0, 1)
      .blockWith()
      .settle()
      .expectLife(0, 14);
  });

  it("puts Rhinar's trigger on the stack and gives both players priority before intimidate", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3"] },
        { hero: "rhinar", hand: ["wrecker romp|3", "raging onslaught|2", "pack hunt|1"] },
      ],
      active: 1,
    });

    g.play("wrecker romp|3", { pitch: ["raging onslaught|2"], settle: false });

    expect(g.state.stack[0]).toMatchObject({
      sourceInstanceId: g.state.players[1]!.hero.instanceId,
      seat: 1,
      label: "Intimidate",
      optional: false,
    });
    expect(g.state.priorityPlayer).toBe(1);
    g.expectPendingReturn(0, 0)
      .passPriority();
    expect(g.state.priorityPlayer).toBe(0);
    g.expectPendingReturn(0, 0)
      .passPriority()
      .expectPendingReturn(0, 1);
  });

  it("Wrecker Romp discarding a small card does not intimidate", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["raging onslaught|2"] },
        { hero: "rhinar", hand: ["wrecker romp|3", "raging onslaught|2", "dodge|3"] },
      ],
      active: 1,
    });
    g.play("wrecker romp|3", { pitch: ["raging onslaught|2"] })
      // the only discard candidate is Dodge (below 6) — no trigger
      .expectLog("Dodge at random")
      .expectNoLog("Rhinar's ability triggers")
      .expectPendingReturn(0, 0)
      .blockWith()
      .settle()
      .expectLife(0, 14);
  });
});

describe("RNR — bellows", () => {
  it("Awakening Bellow: immediate intimidate, go again, +3 to the next attack action", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3", "dodge|3"] },
        {
          hero: "rhinar",
          hand: ["awakening bellow|1", "en garde|1", "pack hunt|1", "raging onslaught|2"],
        },
      ],
      active: 1,
    });
    g.play("awakening bellow|1", { pitch: ["en garde|1"] })
      .expectLog("Awakening Bellow: intimidate")
      .expectPendingReturn(0, 1) // non-attack intimidate resolves immediately
      .expectAP(1, 1) // go again
      .play("pack hunt|1", { pitch: ["raging onslaught|2"] })
      .expectAttackValue(9) // 6 + 3
      .expectPendingReturn(0, 2) // Pack Hunt's own intimidate
      .blockWith()
      .settle()
      .expectLife(0, 11);
  });

  it("Barraging Beatdown: +3 holds while defended by less than 2 non-equipment cards", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["raging onslaught|2"] },
        { hero: "rhinar", hand: ["barraging beatdown|2", "wounded bull|2", "wrecker romp|3"] },
      ],
      active: 1,
    });
    g.play("barraging beatdown|2") // cost 0, go again, immediate intimidate
      .expectPendingReturn(0, 1)
      .expectAP(1, 1)
      .play("wounded bull|2", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(9) // 6 + 3, undefended so far
      .blockWith() // still less than 2 defenders
      .settle()
      .expectFinalAttack(9)
      .expectLife(0, 11);
  });

  it("Barraging Beatdown's bonus is lost once 2 cards from hand defend", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3", "dodge|3", "dodge|3"] },
        { hero: "rhinar", hand: ["barraging beatdown|2", "wounded bull|2", "wrecker romp|3"] },
      ],
      active: 1,
    });
    g.play("barraging beatdown|2") // intimidate banishes one of the three Dodges
      .expectPendingReturn(0, 1)
      .play("wounded bull|2", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(9)
      .blockWith()
      .passPriority()
      .react("dodge|3", { settle: false })
      .react("dodge|3", { settle: false }) // 2 non-equipment defenders → bonus off
      .settle()
      .expectFinalAttack(6)
      .expectFinalDefense(4)
      .expectLife(0, 18);
  });
});

describe("RNR — Wounded Bull", () => {
  it("gets +1 while you have less life than the opponent", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", life: 20, hand: [] },
        { hero: "rhinar", life: 15, hand: ["wounded bull|2", "wrecker romp|3"] },
      ],
      active: 1,
    });
    g.play("wounded bull|2", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectLife(0, 13);
  });

  it("no bonus at even life", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", life: 20, hand: [] },
        { hero: "rhinar", life: 20, hand: ["wounded bull|2", "wrecker romp|3"] },
      ],
      active: 1,
    });
    g.play("wounded bull|2", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLife(0, 14);
  });
});
