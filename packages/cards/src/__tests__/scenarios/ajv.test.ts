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

  it("a fused Frozen to Death keeps its exposed-zone marker through a declined token replacement", () => {
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
          graveyard: ["smoldering steel|1"],
          equipment: { chest: "HVY097" },
          weapons: ["SGB002"],
        },
      ],
    });
    g.state.players[1]!.equipment.chest!.defCounters = 1;

    g.play("AJV020", { pitch: ["SIY033"] })
      .chooseOption("ice:")
      .chooseCard("HVY097")
      .chooseOption("chest")
      .chooseOption("no");

    expect(g.state.players[1]!.equipment.chest).toBeUndefined();
    expect(g.state.players[1]!.board.some(
      (card) => card.counters?.["frostZone:chest"] === 1,
    )).toBe(true);
  });

  it("Unforgetting Unforgiving lets Jarl play the searched Mangle next action phase", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          heroKey: "MPG000",
          hand: ["AJV013", "SIY033", "SIY033"],
          deck: ["AJV011"],
          weapons: ["SLY002", "EVR018"],
        },
        {
          hero: "dorinthea",
          hand: ["head jab|1"],
          weapons: ["SGB002"],
        },
      ],
    });
    g.state.players[1]!.weapons[0]!.defCounters = 1;

    g.play("head jab|1")
      .blockWith("AJV013")
      .settle()
      .chooseCard("AJV011")
      .settle()
      .endTurn();

    expect(g.state.activePlayer).toBe(0);
    expect(g.state.players[0]!.banish[0]?.playableFrom).toContain("banish");

    g.play("AJV011", { fromZone: "banish", pitch: ["SIY033", "SIY033"] });
  });
});
