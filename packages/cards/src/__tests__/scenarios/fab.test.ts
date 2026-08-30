import { describe, it } from "vitest";
import { scenario } from "../harness.js";

/** Scenarios for the FAB set: Bone Vizier and Ironhide Gauntlet. */

describe("FAB — Bone Vizier", () => {
  it("Blade Break destroys it after defending; its on-destroyed reveal buries a small card", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["en garde|1"] },
        {
          hero: "rhinar",
          hand: [],
          // turn-1 opening draw takes the four fillers, leaving Dodge on top
          deck: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2", "raging onslaught|2", "dodge|3", "raging onslaught|2"],
        },
      ],
    });
    g.endTurn() // turn 2, Rhinar (fills its hand from the fillers)
      .endTurn() // turn 3, Dorinthea
      .attackWithWeapon()
      .blockWith("bone vizier|0") // defends for 1
      .settle()
      .expectLife(1, 19)
      .endTurn() // chain closes → Blade Break destroys the Vizier
      .expectNoEquipment(1, "head")
      .expectInZone(1, "bone vizier|0", "graveyard")
      .expectLog("Bone Vizier is destroyed")
      // on-destroyed reveal: Dodge is below 6, so it goes to the bottom
      .expectDeckTop(1, "raging onslaught|2")
      .expectDeckBottom(1, "dodge|3");
  });
});

describe("FAB — Ironhide Gauntlet", () => {
  // equipment may defend regardless of its defense value — 0-defense gear
  // simply defends for 0, so the full attack goes through
  it("Ironhide Gauntlet (0 defense) can defend, blocking for 0", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["en garde|1"] },
        { hero: "rhinar", hand: ["rally the rearguard|3", "dodge|3"] },
      ],
    });
    g.attackWithWeapon()
      .blockWith("ironhide gauntlet|0")
      .settle()
      // The triggered payment may pitch from hand; decline it here.
      .chooseOption("no")
      .expectFinalDefense(0)
      .expectLife(1, 18);
  });
});
