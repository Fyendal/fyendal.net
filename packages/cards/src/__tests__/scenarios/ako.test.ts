import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/** Scenarios for the AKO set: Wild Ride's conditional go again. */

describe("AKO — Wild Ride (draw then discard on attack)", () => {
  it("gains go again (and Rhinar intimidates) when a 6+ card is discarded", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3"] },
        {
          hero: "rhinar",
          hand: ["wild ride|1", "raging onslaught|2", "muscle mutt|2"],
          deck: ["pack hunt|1"], // drawn card is also 6+, so either random discard qualifies
        },
      ],
      active: 1,
    });
    g.play("wild ride|1", { pitch: ["raging onslaught|2"] })
      .expectLog("Wild Ride gains go again")
      .expectLog("Rhinar's ability triggers") // discarding a 6+ card fires the hero too
      .expectAttackValue(6)
      .expectPendingReturn(0, 1)
      .blockWith()
      .settle()
      .expectAP(1, 1) // go again refunded the action point
      .expectLife(0, 14);
  });

  it("no go again when the discard is smaller than 6", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        {
          hero: "rhinar",
          hand: ["wild ride|1", "raging onslaught|2", "clearing bellow|3"],
          deck: ["dodge|3"], // drawn card and the only other hand card are both below 6
        },
      ],
      active: 1,
    });
    g.play("wild ride|1", { pitch: ["raging onslaught|2"] })
      .expectNoLog("Wild Ride gains go again")
      .expectNoLog("Rhinar's ability triggers")
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectAP(1, 0)
      .expectLife(0, 14);
  });
});
