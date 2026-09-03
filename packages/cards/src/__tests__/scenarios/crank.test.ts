import { describe, expect, it } from "vitest";
import { functionalKeyOf } from "../../functional.js";
import { cardData } from "../../index.js";
import { scenario } from "../harness.js";

const standardCrankEntries = [...new Map(
  Object.values(cardData)
    .filter((card) =>
      card.cardType !== "token" &&
      card.keywords?.some((keyword) => keyword.trim().toLowerCase() === "crank") &&
      /this enters the arena with (?:a|\d+) str?eam counters?/i.test(card.text)
    )
    .map((card) => {
      const match = card.text.match(
        /this enters the arena with (?:(a) str?eam counter|(\d+) steam counters?)/i,
      );
      const steam = match?.[1] ? 1 : Number(match?.[2]);
      return [functionalKeyOf(card), steam] as const;
    }),
).entries()];

describe("Crank entry coverage", () => {
  it.each(standardCrankEntries)(
    "%s enters with its printed steam counters before offering Crank",
    (key, expectedSteam) => {
      const g = scenario({
        seats: [
          { hero: "rhinar", hand: [key], resources: 10 },
          { hero: "dorinthea" },
        ],
      });

      g.play(key, { settle: false })
        .passPriority()
        .passPriority();

      const entered = g.state.players[0]!.board.find(
        (card) => functionalKeyOf(cardData[card.cardId]!) === key,
      );
      expect(entered?.counters?.steam).toBe(expectedSteam);
      expect(g.state.pendingDecision).toMatchObject({
        player: 0,
        chooseHook: "engine-crank",
        defaultOption: "yes",
        sourceInstanceId: entered?.instanceId,
      });
    },
  );

  it("offers Crank before an enter-arena choice and preserves that choice", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["null time zone|3"], resources: 2 },
        { hero: "dorinthea" },
      ],
    });

    g.play("null time zone|3", { settle: false })
      .passPriority()
      .passPriority();

    expect(g.state.pendingDecision?.chooseHook).toBe("engine-crank");
    g.chooseOption("no");
    expect(g.state.pendingDecision?.chooseHook).toBe("null-name");
  });
});
