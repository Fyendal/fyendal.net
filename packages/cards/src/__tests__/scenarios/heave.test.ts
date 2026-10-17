import { describe, expect, it } from "vitest";
import { projectStateFor } from "@fyendal/engine";
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
      const source = game.state.players[0]!.hand.find((candidate) =>
        functionalKeyOf(cardData[candidate.cardId]!) === card
      )!;
      expect(game.state.pendingDecision?.resourcePayment?.options.every((option) =>
        !option.pitchInstanceIds.includes(source.instanceId)
      )).toBe(true);

      game.chooseOption("pitch Wrecker Romp")
        .expectInZone(0, card, "arsenal")
        .expectZoneSize(0, "board", amount);
      expect(game.state.players[0]!.arsenal[0]?.faceDown).not.toBe(true);
    },
  );

  it.each(HEAVE_CASES)(
    "$card logs publicly when its Heave $amount cost can't be paid",
    ({ card, amount }) => {
      const game = scenario({
        seats: [
          { hero: "rhinar", hand: [card] },
          { hero: "dorinthea", hand: [] },
        ],
      });

      game.settle().doRaw({ kind: "pass" }).settle().expectTurn(2);
      expect(game.state.players[0]!.arsenal).toHaveLength(0);
      const logs = (projectStateFor(game.state, 1).logEntries ?? []).filter((entry) =>
        "message" in entry && entry.message.id === "card.log.common.heave.unaffordable"
      );
      expect(logs.map((entry) => "message" in entry ? entry.message.values : undefined)).toEqual([
        { amount, card: { kind: "card", cardId: game.state.players[0]!.hand[0]!.cardId } },
      ]);
    },
  );

  it.each(HEAVE_CASES)("$card heaves into an empty additional arsenal zone", ({ card }) => {
    const game = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "lexi, livewire|0",
          equipment: { head: "new horizon|0" },
          arsenal: ["head shot|1"],
          hand: [card, "wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    game.settle().doRaw({ kind: "pass" }).settle();
    game.chooseOption("pitch Wrecker Romp").expectInZone(0, card, "arsenal");
    expect(game.state.players[0]!.arsenal).toHaveLength(2);
  });
});
