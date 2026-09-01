import { describe, expect, it } from "vitest";
import { cardData, scripts } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario } from "../harness.js";

const HEAVE_CASES: { card: string; amount: number }[] = [];
const seen = new Set<string>();

for (const card of Object.values(cardData)) {
  const keyword = (card.keywords ?? []).find((candidate) => /^Heave \d+$/.test(candidate));
  if (!keyword || card.pitch === undefined) continue;
  const key = functionalKeyOf(card);
  if (seen.has(key)) continue;
  seen.add(key);
  HEAVE_CASES.push({ card: key, amount: Number(keyword.slice("Heave ".length)) });
}

HEAVE_CASES.sort((a, b) => a.card.localeCompare(b.card));

describe("Heave", () => {
  it("registers the exact hand trigger for every Heave printing", () => {
    const heavePrintings = Object.values(cardData).filter((card) =>
      (card.keywords ?? []).some((keyword) => /^Heave \d+$/.test(keyword)),
    );

    for (const card of heavePrintings) {
      const keyword = card.keywords!.find((candidate) => /^Heave \d+$/.test(candidate))!;
      expect(
        scripts[card.id]?.triggers?.some((trigger) =>
          trigger.event === "end-of-turn"
          && trigger.sourceZone === "hand"
          && trigger.label === keyword
        ),
        card.id,
      ).toBe(true);
    }
  });

  it.each(HEAVE_CASES)(
    "$card pays $amount, enters arsenal face up, and creates $amount Seismic Surges",
    ({ card, amount }) => {
      const game = scenario({
        seats: [
          { hero: "rhinar", hand: [card, "wrecker romp|3"] },
          { hero: "dorinthea", hand: [] },
        ],
      });

      game.settle().doRaw({ kind: "pass" }).settle();
      expect(game.state.pendingDecision?.resourcePayment?.cost).toBe(amount);

      game.chooseOption("pitch Wrecker Romp")
        .expectInZone(0, card, "arsenal")
        .expectZoneSize(0, "board", amount);
      expect(game.state.players[0]!.arsenal[0]?.faceDown).not.toBe(true);
    },
  );
});
