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
      expect(game.state.pendingDecision).toMatchObject({ player: 0, chooseHook: "hidden-trigger" });
      game.chooseOption("yes");
      expect(game.state.pendingDecision?.resourcePayment?.cost).toBe(amount);
      const source = game.state.players[0]!.hand.find((candidate) =>
        functionalKeyOf(cardData[candidate.cardId]!) === card
      )!;
      expect(JSON.stringify(projectStateFor(game.state, 1).logEntries ?? [])).toContain(source.cardId);
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
    "$card stays private when its Heave $amount can't be paid",
    ({ card }) => {
      const game = scenario({
        seats: [
          { hero: "rhinar", hand: [card] },
          { hero: "dorinthea", hand: [] },
        ],
      });
      const cardId = game.state.players[0]!.hand[0]!.cardId;
      const seenStacks: string[] = [];
      game.settle();
      game.doRaw({ kind: "pass" });
      seenStacks.push(JSON.stringify(projectStateFor(game.state, 1).stack));
      game.settle().expectTurn(2);

      expect(game.state.players[0]!.hand.map((held) => held.cardId)).toContain(cardId);
      expect(seenStacks.join()).not.toContain(cardId);
      expect(JSON.stringify(projectStateFor(game.state, 1).logEntries ?? [])).not.toContain(cardId);
    },
  );

  it.each(HEAVE_CASES)("$card stays private when its owner declines to heave", ({ card }) => {
    const game = scenario({
      seats: [
        { hero: "rhinar", hand: [card, "wrecker romp|3"] },
        { hero: "dorinthea", hand: [] },
      ],
    });
    const cardId = game.state.players[0]!.hand[0]!.cardId;

    game.settle().doRaw({ kind: "pass" }).settle();
    expect(game.state.pendingDecision?.chooseHook).toBe("hidden-trigger");
    const opponentView = projectStateFor(game.state, 1);
    expect(JSON.stringify(opponentView.stack)).not.toContain(cardId);
    expect(opponentView.pendingDecision?.prompt).toBe("");

    game.chooseOption("no").expectTurn(2);
    expect(game.state.players[0]!.hand.map((held) => held.cardId)).toContain(cardId);
    expect(JSON.stringify(projectStateFor(game.state, 1).logEntries ?? [])).not.toContain(cardId);
  });

  describe("with two Heave cards and one payment", () => {
    const twoHeaves = () => {
      const game = scenario({
        seats: [
          { hero: "rhinar", hand: ["thunder quake|3", "pulverize|1", "wrecker romp|3"] },
          { hero: "dorinthea", hand: [] },
        ],
      });
      game.settle().doRaw({ kind: "pass" }).settle();
      expect(game.state.pendingDecision?.chooseHook).toBe("hidden-trigger");
      const first = game.state.pendingDecision!.sourceInstanceId!;
      const second = game.state.players[0]!.hand.find((held) =>
        held.instanceId !== first &&
        ["thunder quake|3", "pulverize|1"].includes(functionalKeyOf(cardData[held.cardId]!))
      )!;
      return { game, first, second };
    };

    it("resolves the first Heave fully and never offers the second once the arsenal is full", () => {
      const { game, first, second } = twoHeaves();

      game.chooseOption("yes");
      expect(game.state.pendingDecision?.resourcePayment?.cost).toBe(3);
      game.chooseOption("pitch Wrecker Romp").expectTurn(2);

      expect(game.state.players[0]!.arsenal.map((card) => card.instanceId)).toEqual([first]);
      expect(game.state.players[0]!.hand.map((card) => card.instanceId)).toContain(second.instanceId);
      expect(JSON.stringify(projectStateFor(game.state, 1).logEntries ?? [])).not.toContain(second.cardId);
    });

    it("offers the second Heave after the first is declined", () => {
      const { game, second } = twoHeaves();

      game.chooseOption("no");
      expect(game.state.pendingDecision).toMatchObject({
        chooseHook: "hidden-trigger",
        sourceInstanceId: second.instanceId,
      });
    });
  });

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

    game.settle().doRaw({ kind: "pass" }).settle().chooseOption("yes");
    game.chooseOption("pitch Wrecker Romp").expectInZone(0, card, "arsenal");
    expect(game.state.players[0]!.arsenal).toHaveLength(2);
  });
});
