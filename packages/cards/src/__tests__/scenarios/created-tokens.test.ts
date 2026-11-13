import { describe, expect, it } from "vitest";
import { cardData } from "../../index.js";
import { scenario } from "../harness.js";

function boardNames(game: ReturnType<typeof scenario>, seat: number): string[] {
  return game.state.players[seat]!.board.map((card) => cardData[card.cardId]!.name);
}

describe("created tokens", () => {
  it("Wax Off creates Zen State after Wax On", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["wounding blow|1"] },
        { hero: "dorinthea", hand: ["wax off|3"] },
      ],
    });
    g.state.players[1]!.flags["playedName:wax on"] = true;
    g.play("wounding blow|1").blockWith().passPriority().react("wax off|3").settle();
    expect(boardNames(g, 1)).toContain("Zen State");
  });

  it("Eclipse creates Ursur, the Soul Reaper", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", banish: ["eclipse|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.flags.bloodDebtCardsPlayedThisTurn = 6;
    g.play("eclipse|3", { fromZone: "banish" }).settle();
    expect(boardNames(g, 0)).toContain("Ursur, the Soul Reaper");
  });

  it("Imperial Ledger creates Copper for a hero that isn't Royal", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["imperial ledger|1"] },
        { hero: "dorinthea" },
      ],
    });
    g.activate("imperial ledger|1").settle();
    expect(boardNames(g, 0)).toEqual(["Copper"]);
  });
});
