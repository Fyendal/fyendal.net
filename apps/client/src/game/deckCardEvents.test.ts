import type { CardView, GameView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { describe, expect, it } from "vitest";
import { detectDeckCardEvents, revealedCardIdsFromLogs } from "./deckCardEvents.js";

function card(instanceId: number, cardId: string): CardView {
  return { instanceId, cardId, owner: 0 };
}

function view(overrides: {
  deckCount?: number;
  opponentDeckCount?: number;
  hand?: CardView[];
  graveyard?: CardView[];
  banish?: CardView[];
  opponentBanish?: CardView[];
  log?: string[];
} = {}): GameView {
  const player = {
    seat: 0,
    heroCardId: "HERO",
    heroInstanceId: 1,
    heroName: "Hero",
    life: 20,
    actionPoints: 1,
    resources: 0,
    hand: overrides.hand ?? [],
    handCount: overrides.hand?.length ?? 0,
    deckCount: overrides.deckCount ?? 10,
    arsenal: [],
    arsenalCount: 0,
    pitch: [],
    pitchCount: 0,
    graveyard: overrides.graveyard ?? [],
    banish: overrides.banish ?? [],
    soul: [],
    equipment: {},
    weapons: [],
    board: [],
  };
  return {
    gameId: "deck-events",
    turn: 1,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [player, {
      ...player,
      seat: 1,
      heroInstanceId: 2,
      heroName: "Opponent",
      deckCount: overrides.opponentDeckCount ?? overrides.deckCount ?? 10,
      banish: overrides.opponentBanish ?? [],
    }],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: null,
    winner: null,
    log: overrides.log ?? [],
  } as GameView;
}

describe("public deck-card events", () => {
  it("announces cards that move directly from deck to banish or graveyard", () => {
    const sinkBelow = Object.values(cardData).find((entry) => entry.name === "Sink Below")!;
    const snatch = Object.values(cardData).find((entry) => entry.name === "Snatch")!;
    const previous = view({ deckCount: 10 });
    const current = view({
      deckCount: 8,
      banish: [card(10, sinkBelow.id)],
      graveyard: [card(11, snatch.id)],
      log: [
        "Sink Below is banished from deck",
        "Snatch is put into the graveyard from deck",
      ],
    });

    expect(detectDeckCardEvents(previous, current)).toEqual([
      { kind: "banish", cardIds: [sinkBelow.id], label: "Banished from deck", seat: 0 },
      { kind: "graveyard", cardIds: [snatch.id], label: "Sent from deck to graveyard", seat: 0 },
    ]);
  });

  it("announces public cards banished from graveyard", () => {
    const sinkBelow = Object.values(cardData).find((entry) => entry.name === "Sink Below")!;
    const snatch = Object.values(cardData).find((entry) => entry.name === "Snatch")!;
    const sink = card(10, sinkBelow.id);
    const attack = card(11, snatch.id);
    const previous = view({ graveyard: [sink, attack] });
    const current = view({
      banish: [sink, attack],
      log: [
        "Sink Below is banished from graveyard",
        "Snatch is banished from graveyard",
      ],
    });

    expect(detectDeckCardEvents(previous, current)).toEqual([{
      kind: "banish",
      cardIds: [sinkBelow.id, snatch.id],
      label: "Banished from graveyard",
      seat: 0,
    }]);
  });

  it("attributes revealed cards to the revealing hero's seat", () => {
    const sinkBelow = Object.values(cardData).find((entry) => entry.name === "Sink Below")!;
    expect(detectDeckCardEvents(
      view({ log: [] }),
      view({ log: ["Opponent reveals Sink Below (-3 power)"] }),
    )).toEqual([{
      kind: "reveal",
      cardIds: [sinkBelow.id],
      label: "Revealed from deck",
      cardSeats: [1],
    }]);
  });

  it("labels Crash and Bash's reveal as coming from hand", () => {
    const faultLine = Object.values(cardData).find((entry) => entry.name === "Fault Line")!;
    expect(detectDeckCardEvents(
      view({ log: [] }),
      view({ log: ["Crash and Bash reveals Fault Line from hand"] }),
    )).toEqual([{
      kind: "reveal",
      cardIds: [faultLine.id],
      label: "Revealed from hand",
      cardSeats: [undefined],
    }]);
  });

  it("labels a fused card as revealed from hand", () => {
    const lightningPress = Object.values(cardData).find(
      (entry) => entry.name === "Lightning Press",
    )!;
    expect(detectDeckCardEvents(
      view({ log: [] }),
      view({ log: [`Entwine Lightning is fused (reveals ${lightningPress.name})`] }),
    )).toEqual([{
      kind: "reveal",
      cardIds: [lightningPress.id],
      label: "Revealed from hand",
      cardSeats: [undefined],
    }]);
  });

  it("merges simultaneous deck banishes with per-card seats", () => {
    const sinkBelow = Object.values(cardData).find((entry) => entry.name === "Sink Below")!;
    const snatch = Object.values(cardData).find((entry) => entry.name === "Snatch")!;
    expect(detectDeckCardEvents(
      view({ deckCount: 10, opponentDeckCount: 10 }),
      view({
        deckCount: 9,
        opponentDeckCount: 9,
        banish: [card(10, sinkBelow.id)],
        opponentBanish: [card(11, snatch.id)],
        log: [
          "Sink Below is banished from deck",
          "Snatch is banished from deck",
        ],
      }),
    )).toEqual([{
      kind: "banish",
      cardIds: [sinkBelow.id, snatch.id],
      label: "Banished from deck",
      cardSeats: [0, 1],
    }]);
  });

  it("merges a clash's reveals into one event with per-card seats", () => {
    const sinkBelow = Object.values(cardData).find((entry) => entry.name === "Sink Below")!;
    const snatch = Object.values(cardData).find((entry) => entry.name === "Snatch")!;
    expect(detectDeckCardEvents(
      view({ log: [] }),
      view({
        log: [
          "Hero reveals Sink Below (4 power)",
          "Opponent reveals Snatch (2 power)",
        ],
      }),
    )).toEqual([{
      kind: "reveal",
      cardIds: [sinkBelow.id, snatch.id],
      label: "Revealed from deck",
      cardSeats: [0, 1],
    }]);
  });

  it("does not mistake a previously public card for a deck departure", () => {
    const played = card(10, "PLAYED");
    const previous = view({ deckCount: 10, hand: [played] });
    const current = view({ deckCount: 9, graveyard: [played] });

    expect(detectDeckCardEvents(previous, current)).toEqual([]);
  });

  it("extracts reveal-only cards from newly public effect logs", () => {
    const sinkBelow = Object.values(cardData).find((entry) => entry.name === "Sink Below")!;
    const ids = revealedCardIdsFromLogs([
      "Ravenous Rabble reveals Sink Below (-3 power)",
    ]);

    expect(ids).toContain(sinkBelow.id);
    expect(detectDeckCardEvents(
      view({ log: [] }),
      view({ log: ["Ravenous Rabble reveals Sink Below (-3 power)"] }),
    )).toContainEqual({
      kind: "reveal",
      cardIds: expect.arrayContaining([sinkBelow.id]),
      label: "Revealed from deck",
      cardSeats: [undefined],
    });
  });

  it("keeps the exact pitch printing encoded in a reveal log", () => {
    const blueSinkBelow = Object.values(cardData).find(
      (entry) => entry.name === "Sink Below" && entry.pitch === 3,
    )!;

    expect(revealedCardIdsFromLogs([
      `Ravenous Rabble reveals Sink Below (-3 power)⟦${blueSinkBelow.id}⟧`,
    ])).toEqual([blueSinkBelow.id]);
  });

  it("does not invent shorter card names contained inside revealed card names", () => {
    const revealedNames = ["Mighty Windup", "Vigorous Windup", "Smash Instinct", "Tough as a Rok"];
    const revealedIds = revealedCardIdsFromLogs([
      `Hero reveals ${revealedNames.join(", ")}`,
    ]);

    expect(revealedIds).toHaveLength(4);
    for (const name of revealedNames) {
      const expected = Object.values(cardData).find((entry) => entry.name === name)!;
      expect(revealedIds).toContain(expected.id);
    }
    for (const falsePositive of ["Might", "Vigor", "Ash", "Rok"]) {
      const unexpected = Object.values(cardData).find((entry) => entry.name === falsePositive)!;
      expect(revealedIds).not.toContain(unexpected.id);
    }
  });

  it("does not replay historical logs after undo", () => {
    const previous = view({ log: ["one", "Ravenous Rabble reveals Sink Below (-3 power)"] });
    const current = view({ log: ["one"] });
    expect(detectDeckCardEvents(previous, current)).toEqual([]);
  });

  it("announces a shuffle without revealing any cards", () => {
    expect(detectDeckCardEvents(
      view({ log: [] }),
      view({ log: ["Hero shuffles their deck"] }),
    )).toEqual([{
      kind: "shuffle",
      cardIds: [],
      label: "Hero shuffles their deck",
      seat: 0,
    }]);
  });

  it("announces die-roll results from the public log", () => {
    expect(detectDeckCardEvents(
      view({ log: [] }),
      view({ log: ["Hero rolls 4", "the die is rerolled: 2"] }),
    )).toEqual([
      { kind: "roll", cardIds: [], label: "Hero rolls 4" },
      { kind: "roll", cardIds: [], label: "the die is rerolled: 2" },
    ]);
  });

  it("does not treat a played card resolving beside a deck search as a deck departure", () => {
    const spark = Object.values(cardData).find((entry) => entry.name === "Spark of Genius")!;
    const previous = view({ deckCount: 10, hand: [card(20, spark.id)] });
    const current = view({
      deckCount: 9,
      graveyard: [card(20, spark.id)],
      log: ["Hero plays Spark of Genius", "Hero shuffles their deck"],
    });
    expect(detectDeckCardEvents(previous, current).some((event) => event.kind === "graveyard")).toBe(false);
  });
});
