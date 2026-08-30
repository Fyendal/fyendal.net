import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/** Scenarios for the RVD set: Bone Basher. */

describe("RVD — Bone Basher", () => {
  it("attacks for 4 as a once-per-turn {r}{r} action", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        { hero: "rhinar", hand: ["raging onslaught|2"] },
      ],
      active: 1,
    });
    g.activate("bone basher|0", { pitch: ["raging onslaught|2"] })
      .expectLog("activates Bone Basher")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectAP(1, 0)
      .expectLife(0, 16);
  });
});
