import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/** Scenarios for the DRO set: Ironhide Legs. */

describe("DRO — Ironhide Legs", () => {
  // same rule as Ironhide Gauntlet (see fab.test.ts): equipment may defend
  // regardless of its defense value; 0-defense gear defends for 0
  it("Ironhide Legs (0 defense) can defend, blocking for 0", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["en garde|1"] },
        { hero: "rhinar", hand: ["rally the rearguard|3", "dodge|3"] },
      ],
    });
    g.attackWithWeapon()
      .blockWith("ironhide legs|0")
      .settle()
      // The triggered payment may pitch from hand; decline it here.
      .chooseOption("no")
      .expectFinalDefense(0)
      .expectLife(1, 18);
  });
});
