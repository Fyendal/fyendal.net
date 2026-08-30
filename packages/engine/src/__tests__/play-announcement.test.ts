import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents } from "../index.js";
import { giveCard, makeGame, player } from "./fixtures.js";

describe("card-play announcement", () => {
  it("reserves a hand card for a mandatory additional discard cost", () => {
    let state = makeGame(149);
    state.scriptsRef = {
      ...state.scriptsRef,
      BIG: {
        requiredHandCardsForAdditionalCost: 1,
        additionalCost(ctx) {
          ctx.discardRandom(ctx.seat, 1);
        },
      },
    };
    const playerZero = player(state, 0);
    playerZero.hand = [];
    const attackId = giveCard(state, 0, "BIG");
    const pitchId = giveCard(state, 0, "BLUE");

    expect(legalIntents(state, 0).some(
      (intent) => intent.kind === "play-card" && intent.instanceId === attackId,
    )).toBe(false);
    expect(applyIntent(state, 0, {
      kind: "play-card",
      instanceId: attackId,
      pitchInstanceIds: [pitchId],
    })).toMatchObject({ ok: false });

    const discardId = giveCard(state, 0, "BLUE");
    const play = legalIntents(state, 0).find(
      (intent) => intent.kind === "play-card" && intent.instanceId === attackId,
    );
    expect(play).toBeDefined();
    const result = applyIntent(state, 0, play!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
    expect(player(state, 0).graveyard.some((card) => card.instanceId === discardId)).toBe(true);
  });

  it("finishes declaration choices before putting an action on the stack or offering priority", () => {
    let state = makeGame(147);
    state.cardsRef = {
      ...state.cardsRef,
      MODE_ACTION: {
        id: "MODE_ACTION",
        name: "Modal Action",
        cardType: "action",
        classes: ["generic"],
        pitch: 3,
        cost: 0,
        text: "Choose 1. Go again.",
        keywords: ["Go again"],
      },
    };
    state.scriptsRef = {
      ...state.scriptsRef,
      MODE_ACTION: {
        additionalCost(ctx) {
          ctx.requestChoice("mode", "Choose a mode", ["first", "second"]);
        },
        onChoose(ctx, hook, option) {
          if (hook === "mode") ctx.setCounter("selectedMode", option === "first" ? 1 : 2);
        },
        onPlay(ctx) {
          ctx.setFlag("player", "modalActionResolved", true);
        },
      },
    };
    const cardId = giveCard(state, 0, "MODE_ACTION");
    giveCard(state, 0, "INSTANT");
    const play = legalIntents(state, 0).find(
      (intent) => intent.kind === "play-card" && intent.instanceId === cardId,
    );
    expect(play).toBeDefined();

    let result = applyIntent(state, 0, play!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    expect(state.stack).toHaveLength(0);
    expect(state.pendingDecision).toMatchObject({ chooseHook: "mode", player: 0 });
    expect(legalIntents(state, 0).some((intent) => intent.kind === "pass")).toBe(false);

    result = applyIntent(state, 0, { kind: "choose", optionId: "second" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    expect(state.stack).toHaveLength(1);
    expect(state.stack[0]?.card?.counters?.selectedMode).toBe(2);
    expect(state.players[0]!.flags.modalActionResolved).not.toBe(true);
    expect(state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    expect(legalIntents(state, 0).some((intent) => intent.kind === "pass")).toBe(true);
  });

  it("an instant pays its alternative cost over another layer", () => {
    let state = makeGame(148);
    state.cardsRef = {
      ...state.cardsRef,
      ALT_INSTANT: {
        id: "ALT_INSTANT",
        name: "Alternative Instant",
        cardType: "instant",
        classes: ["generic"],
        pitch: 3,
        cost: 2,
        text: "You may destroy a Gold you control rather than pay this card's resource cost.",
      },
      GOLD: {
        id: "GOLD",
        name: "Gold",
        cardType: "token",
        subtypes: ["item"],
        text: "",
      },
    };
    state.scriptsRef = {
      ...state.scriptsRef,
      ALT_INSTANT: {
        alternativePlayCost: {
          kind: "destroy-controlled-named",
          options: [{ name: "Gold", count: 1 }],
        },
      },
    };

    const firstId = giveCard(state, 0, "INSTANT");
    const alternativeId = giveCard(state, 0, "ALT_INSTANT");
    const goldId = state.nextInstanceId++;
    player(state, 0).board.push({ instanceId: goldId, cardId: "GOLD", owner: 0 });

    const firstIntent = legalIntents(state, 0).find(
      (intent) => intent.kind === "play-card" && intent.instanceId === firstId,
    );
    expect(firstIntent).toBeDefined();
    let result = applyIntent(state, 0, firstIntent!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
    expect(state.phase).toBe("layer");
    expect(state.stack).toHaveLength(1);
    player(state, 0).resources = 1;
    player(state, 0).flags.costMoreThisTurn = 1;
    player(state, 0).hand = player(state, 0).hand.filter(
      (card) => card.instanceId === alternativeId,
    );

    const regularIntent = legalIntents(state, 0).find(
      (intent) =>
        intent.kind === "play-card" &&
        intent.instanceId === alternativeId &&
        intent.alternativeCostCardInstanceIds === undefined,
    );
    expect(regularIntent).toBeUndefined();

    const alternativeIntent = legalIntents(state, 0).find(
      (intent) =>
        intent.kind === "play-card" &&
        intent.instanceId === alternativeId &&
        intent.alternativeCostCardInstanceIds?.includes(goldId),
    );
    expect(alternativeIntent).toBeDefined();
    result = applyIntent(state, 0, alternativeIntent!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.state.stack).toHaveLength(2);
    expect(result.state.stack[0]?.card?.instanceId).toBe(alternativeId);
    expect(result.state.stack[1]?.card?.instanceId).toBe(firstId);
    expect(result.state.players[0]!.board.some((card) => card.instanceId === goldId)).toBe(false);
    expect(result.state.players[0]!.resources).toBe(0);
    expect(result.state.priorityPlayer).toBe(0);
    expect(result.state.pendingDecision).toMatchObject({
      player: 0,
      kind: "priority-window",
    });
  });

  it("declares mixed destroy-and-discard costs before paying printed resources", () => {
    let state = makeGame(150);
    state.cardsRef = {
      ...state.cardsRef,
      STRIKE: {
        id: "STRIKE",
        name: "Test Strike",
        cardType: "action",
        classes: ["generic"],
        subtypes: ["attack"],
        pitch: 1,
        cost: 3,
        attack: 3,
        defense: 3,
        text: "As an additional cost, destroy or discard test allies.",
      },
      TEST_ALLY: {
        id: "TEST_ALLY",
        name: "Test Ally",
        cardType: "action",
        classes: ["generic"],
        subtypes: ["test-ally", "ally"],
        pitch: 1,
        cost: 0,
        attack: 1,
        life: 1,
        text: "",
      },
    };
    state.scriptsRef = {
      ...state.scriptsRef,
      STRIKE: {
        alternativePlayCost: {
          kind: "destroy-controlled-and-or-discard-hand-subtype",
          subtype: "test-ally",
          cardLabel: "test allies",
          maximumDestroyed: 3,
          maximumDiscarded: 3,
          replacesResourceCost: false,
        },
        onAlternativeCostPaid(ctx, paidCards) {
          ctx.setCounter("paidAllies", paidCards.length);
        },
      },
    };
    const playerZero = player(state, 0);
    playerZero.hand = [];
    const strikeId = giveCard(state, 0, "STRIKE");
    const discardedIds = Array.from({ length: 3 }, () => giveCard(state, 0, "TEST_ALLY"));
    const pitchId = giveCard(state, 0, "BLUE");
    const destroyedIds = Array.from({ length: 3 }, () => {
      const instanceId = state.nextInstanceId++;
      playerZero.board.push({ instanceId, cardId: "TEST_ALLY", owner: 0, life: 1 });
      return instanceId;
    });
    const paidIds = [...destroyedIds, ...discardedIds];

    const play = legalIntents(state, 0).find(
      (intent) =>
        intent.kind === "play-card" &&
        intent.instanceId === strikeId &&
        intent.alternativeCostCardInstanceIds?.length === 6 &&
        paidIds.every((id) => intent.alternativeCostCardInstanceIds?.includes(id)) &&
        intent.pitchInstanceIds.length === 1 &&
        intent.pitchInstanceIds[0] === pitchId,
    );
    expect(play).toBeDefined();
    if (!play || play.kind !== "play-card") throw new Error("expected declared play intent");
    expect(play.additionalCostSelection).toEqual({
      kind: "destroy-controlled-and-or-discard-hand",
      cardLabel: "test allies",
      maximumDestroyed: 3,
      maximumDiscarded: 3,
    });
    expect(play.pitchInstanceIds.some((id) => paidIds.includes(id))).toBe(false);

    const result = applyIntent(state, 0, play!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    state = result.state;

    expect(player(state, 0).resources).toBe(0);
    expect(player(state, 0).pitch).toContainEqual(expect.objectContaining({ instanceId: pitchId }));
    expect(player(state, 0).board).toHaveLength(0);
    expect(player(state, 0).graveyard).toEqual(expect.arrayContaining(
      paidIds.map((instanceId) => expect.objectContaining({ instanceId })),
    ));
    expect(state.chain[0]?.attackingCard).toMatchObject({
      instanceId: strikeId,
      counters: { paidAllies: 6 },
    });
  });
});
