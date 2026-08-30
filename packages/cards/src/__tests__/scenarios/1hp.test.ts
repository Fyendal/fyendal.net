import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/** Scenarios for the 1HP set: Alpha Rampage (Rhinar specialization) and Come to Fight. */

describe("1HP — Alpha Rampage", () => {
  // the discard cost is paid after Alpha Rampage leaves the hand (see the
  // Wrecker Romp tests in rnr.test.ts), so Raging Onslaught is always discarded
  it("discard cost plus Rhinar's trigger: keyword + hero intimidate banish 2", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3", "dodge|3"] },
        { hero: "rhinar", hand: ["alpha rampage|1", "titanium bauble|3", "raging onslaught|2"] },
      ],
      active: 1,
    });
    g.play("alpha rampage|1", { pitch: ["titanium bauble|3"] })
      // additional cost discards Raging Onslaught (the only other card) — a 6+ discard
      .expectLog("Raging Onslaught at random")
      .expectLog("Rhinar's ability triggers")
      .expectAttackValue(9)
      // Alpha Rampage's own Intimidate keyword + the queued hero trigger
      .expectPendingReturn(0, 2)
      .blockWith()
      .settle()
      .expectLife(0, 11);
  });
});

describe("1HP — Come to Fight", () => {
  it("gives the next attack action +1 and has go again", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        {
          hero: "rhinar",
          hand: ["come to fight|3", "en garde|1", "pack hunt|1", "raging onslaught|2"],
        },
      ],
      active: 1,
    });
    g.play("come to fight|3", { pitch: ["en garde|1"] })
      .expectAP(1, 1) // go again
      .play("pack hunt|1", { pitch: ["raging onslaught|2"] })
      .expectAttackValue(7) // 6 + 1
      .blockWith()
      .settle()
      .expectLife(0, 13);
  });
});
