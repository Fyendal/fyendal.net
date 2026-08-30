import { describe, expect, it } from "vitest";
import { scenario } from "../harness.js";

describe("AJV — Jarl", () => {
  it("Crumble to Eternity can mark off-hand equipment in a weapon zone", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "MPG000",
          hand: ["AJV018"],
          weapons: ["SLY002", "EVR018"],
        },
        {
          hero: "dorinthea",
          hand: [],
          weapons: ["SGB002"],
        },
      ],
    });

    g.play("AJV018").chooseCard("SGB002");

    expect(g.state.players[1]!.weapons[0]!.defCounters).toBe(1);
  });

  it("a fused Frozen to Death can destroy marked off-hand equipment", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "MPG000",
          hand: ["AJV020", "AJV018", "SIY033"],
          weapons: ["SLY002", "EVR018"],
        },
        {
          hero: "dorinthea",
          hand: [],
          weapons: ["SGB002"],
        },
      ],
    });
    g.state.players[1]!.weapons[0]!.defCounters = 1;

    g.play("AJV020", { pitch: ["SIY033"] })
      .chooseOption("ice:")
      .chooseCard("SGB002");

    expect(g.state.players[1]!.weapons).toHaveLength(0);
  });
});
