import { describe, expect, it } from "vitest";
import { scenario } from "../harness.js";

// "When this enters / leaves the arena" abilities are triggered layers: each
// waits on the stack for priority before its effect happens.
describe("enter and leave arena triggers use the stack", () => {
  it("Loan Shark creates its Gold only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["loan shark|2"] }, { hero: "dorinthea" }],
    });

    g.play("loan shark|2", { settle: false }).passUntilLayer("Create 2 Gold tokens");

    expect(g.state.stack).toEqual([expect.objectContaining({ label: "Create 2 Gold tokens" })]);
    g.expectInZone(0, "loan shark|2", "board").expectZoneSize(0, "board", 1);

    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    g.expectZoneSize(0, "board", 3);
  });

  it("Blessing of Deliverance draws from an enter trigger after a cost-3 pitch", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["blessing of deliverance|3", "barraging beatdown|2"],
          pitch: ["buckling blow|1"],
          deck: ["head jab|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("blessing of deliverance|3", { pitch: ["barraging beatdown|2"], settle: false }).passUntilLayer("Draw a card");

    expect(g.state.stack).toEqual([expect.objectContaining({ label: "Draw a card" })]);
    g.expectHandSize(0, 0);

    g.passPriority().passPriority();
    g.expectInZone(0, "head jab|1", "hand");
  });

  it("Robe of Resourcefulness gains resources only when its leave trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|3"] },
        { hero: "dorinthea", equipment: { chest: "robe of resourcefulness|0" } },
      ],
    });

    g.play("raging onslaught|3").blockWith("robe of resourcefulness|0").passUntilLayer("Gain 2 resources");

    expect(g.state.stack).toEqual([expect.objectContaining({ label: "Gain 2 resources" })]);
    g.expectInZone(1, "robe of resourcefulness|0", "graveyard").expectResources(1, 0);

    g.passPriority().passPriority();
    g.expectResources(1, 2);
  });
});
