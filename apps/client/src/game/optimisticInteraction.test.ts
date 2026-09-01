import { describe, expect, it } from "vitest";
import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import type { PendingInteraction } from "../store/types.js";
import { optimisticInteractionView } from "./optimisticInteraction.js";
import { detectGameMotionEvents } from "./motion/detectMotionEvents.js";

function player(seat: 0 | 1, overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    seat,
    heroCardId: `HERO-${seat}`,
    heroInstanceId: 100 + seat,
    heroName: `Hero ${seat}`,
    life: 20,
    actionPoints: 1,
    resources: 0,
    hand: [],
    handCount: 0,
    deckCount: 0,
    arsenal: [],
    arsenalCount: 0,
    pitch: [],
    pitchCount: 0,
    graveyard: [],
    banish: [],
    soul: [],
    equipment: {},
    weapons: [],
    board: [],
    ...overrides,
  };
}

function game(first: PlayerView, pendingDecision: GameView["pendingDecision"] = null): GameView {
  return {
    gameId: "game",
    turn: 1,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [first, player(1)],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision,
    winner: null,
    log: [],
  };
}

function pending(intent: PendingInteraction["intent"]): PendingInteraction {
  return { commandId: "command", expectedVersion: 2, intent };
}

describe("optimistic interaction projection", () => {
  it("moves a played card and declared pitch cards before acknowledgement", () => {
    const played: CardView = { instanceId: 10, cardId: "WTR170", owner: 0 };
    const pitch: CardView = { instanceId: 11, cardId: "WTR171", owner: 0 };
    const view = game(player(0, { hand: [played, pitch], handCount: 2 }));

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "play-card",
      instanceId: 10,
      pitchInstanceIds: [11],
    }));

    expect(projection.predictsSemanticTransition).toBe(true);
    expect(projection.view?.players[0]?.hand).toEqual([]);
    expect(projection.view?.players[0]?.handCount).toBe(0);
    expect(projection.view?.players[0]?.pitch.map((card) => card.instanceId)).toEqual([11]);
    expect(projection.view?.stack[0]?.card?.instanceId).toBe(10);
    expect(view.players[0].hand).toHaveLength(2);
    expect(detectGameMotionEvents(view, projection.view!)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "move",
        instanceId: 10,
        source: { kind: "hand", seat: 0 },
        destination: { kind: "stack-layer", index: 0 },
      }),
      expect.objectContaining({
        kind: "move",
        instanceId: 11,
        source: { kind: "hand", seat: 0 },
        destination: { kind: "pitch", seat: 0 },
      }),
    ]));
  });

  it("keeps a play with a pre-stack choice selected in hand", () => {
    const announced: CardView = { instanceId: 12, cardId: "WTR170", owner: 0 };
    const view = game(player(0, { hand: [announced], handCount: 1 }));

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "play-card",
      instanceId: 12,
      pitchInstanceIds: [],
      deferPlayPresentation: true,
    }));

    expect(projection.view).toBe(view);
    expect(projection.predictsSemanticTransition).toBe(false);
    expect(projection.view?.players[0]?.hand).toEqual([announced]);
    expect(projection.view?.stack).toEqual([]);
    expect(detectGameMotionEvents(view, projection.view!)).toEqual([]);
  });

  it("presents a resolving pre-stack source in hand until its choice completes", () => {
    const announced: CardView = { instanceId: 13, cardId: "WTR170", owner: 0 };
    const view = game(player(0), {
      player: 0,
      kind: "choose-target",
      prompt: "Choose a mode",
      options: ["first", "second"],
      preStackSource: { card: announced, zone: "hand" },
    });

    const projection = optimisticInteractionView(view, 0, null);

    expect(projection.view?.players[0]?.hand).toEqual([announced]);
    expect(projection.view?.players[0]?.handCount).toBe(1);
    expect(projection.key).toBe("interaction:pre-stack:13");
  });

  it("connects an activated source to a pending layer and moves its pitch", () => {
    const weapon: CardView = {
      instanceId: 20,
      cardId: "WTR114",
      owner: 0,
      activatedAbilityLabels: ["Attack"],
    };
    const pitch: CardView = { instanceId: 21, cardId: "WTR171", owner: 0 };
    const view = game(player(0, {
      hand: [pitch],
      handCount: 1,
      weapons: [weapon],
    }));

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "activate-ability",
      sourceInstanceId: 20,
      abilityIndex: 0,
      pitchInstanceIds: [21],
    }));

    expect(projection.predictsSemanticTransition).toBe(true);
    expect(projection.view?.stack[0]).toMatchObject({ card: weapon, label: "Attack" });
    expect(projection.view?.players[0]?.pitch.map((card) => card.instanceId)).toEqual([21]);
    expect(projection.view?.players[0]?.weapons).toEqual([weapon]);
    expect(detectGameMotionEvents(view, projection.view!)).toContainEqual(expect.objectContaining({
      kind: "connect",
      instanceId: 20,
      source: { kind: "weapon", seat: 0, index: 0 },
      destination: { kind: "stack-layer", index: 0 },
    }));
  });

  it("presents an attack action in the attack stack slot", () => {
    const attack: CardView = { instanceId: 25, cardId: "WTR006", owner: 0, attack: 9 };
    const view = game(player(0, { hand: [attack], handCount: 1 }));

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "play-card",
      instanceId: 25,
      pitchInstanceIds: [],
    }));

    expect(projection.view?.chain[0]).toMatchObject({
      attackingCard: { instanceId: 25 },
      attackValue: 9,
      onStack: true,
    });
    expect(detectGameMotionEvents(view, projection.view!)).toContainEqual(expect.objectContaining({
      kind: "move",
      instanceId: 25,
      source: { kind: "hand", seat: 0 },
      destination: { kind: "stack-attack" },
    }));
  });

  it("moves an arsenal choice face down and dismisses the decision", () => {
    const card: CardView = { instanceId: 30, cardId: "WTR171", owner: 0 };
    const view = game(player(0, { hand: [card], handCount: 1 }), {
      player: 0,
      kind: "arsenal",
      prompt: "Choose arsenal",
      options: ["30"],
    });

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "choose",
      optionId: "30",
    }));

    expect(projection.predictsSemanticTransition).toBe(true);
    expect(projection.view?.pendingDecision).toBeNull();
    expect(projection.view?.players[0]?.hand).toEqual([]);
    expect(projection.view?.players[0]?.arsenal[0]).toMatchObject({ instanceId: 30, faceDown: true });
  });

  it("keeps an unpredictable scripted choice mounted until acknowledgement", () => {
    const view = game(player(0), {
      player: 0,
      kind: "optional-effect",
      prompt: "Use it?",
      options: ["yes", "no"],
    });

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "choose",
      optionId: "yes",
    }));

    expect(projection.predictsSemanticTransition).toBe(false);
    expect(projection.view).toBe(view);
    expect(projection.key).toBe("interaction:authoritative");
  });

  it("keeps an Opt decision mounted with only the unselected cards", () => {
    const first: CardView = { instanceId: 50, cardId: "WTR170", owner: 0 };
    const second: CardView = { instanceId: 51, cardId: "WTR171", owner: 0 };
    const view = game(player(0), {
      player: 0,
      kind: "choose-target",
      prompt: "Opt 2",
      options: ["top:50", "bottom:50", "top:51", "bottom:51", "pass"],
      optionLabels: ["Top", "Bottom", "Top", "Bottom", "Done"],
      optionCards: [first, first, second, second, null],
      lookedCards: [first, second],
    });

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "choose",
      optionId: "bottom:50",
    }));

    expect(projection.predictsSemanticTransition).toBe(false);
    expect(projection.view?.pendingDecision).toMatchObject({
      prompt: "Opt 2",
      options: ["top:51", "bottom:51", "pass"],
      optionLabels: ["Top", "Bottom", "Done"],
      optionCards: [second, second, null],
      lookedCards: [second],
    });
    expect(view.pendingDecision?.options).toHaveLength(5);
  });

  it("dismisses an Opt decision after its final card is selected", () => {
    const card: CardView = { instanceId: 50, cardId: "WTR170", owner: 0 };
    const view = game(player(0), {
      player: 0,
      kind: "choose-target",
      prompt: "Opt 1",
      options: ["top:50", "bottom:50"],
      optionCards: [card, card],
      lookedCards: [card],
    });

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "choose",
      optionId: "top:50",
    }));

    expect(projection.view?.pendingDecision).toBeNull();
  });

  it("keeps the Blood on Her Hands allocator mounted while an adjustment is pending", () => {
    const weapon: CardView = { instanceId: 60, cardId: "WTR114", owner: 0 };
    const increment = "blood-mode:increment:power:60:0:0:2";
    const decrement = "blood-mode:decrement:power:60:0:0:2";
    const view = game(player(0, { weapons: [weapon] }), {
      player: 0,
      kind: "choose-target",
      prompt: "Assign 2 Blood on Her Hands modes",
      options: [decrement, increment, "blood-mode:confirm:0:2"],
      optionCards: [weapon, weapon, null],
    });

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "choose",
      optionId: increment,
    }));

    expect(projection.view).toBe(view);
    expect(projection.view?.pendingDecision).toBe(view.pendingDecision);
    expect(projection.key).toBe("interaction:authoritative");
  });

  it("keeps the Forsaken Strike mode chooser mounted between repeated selections", () => {
    const option = "Give Forsaken Strike +2 power";
    const view = game(player(0), {
      player: 0,
      kind: "choose-target",
      prompt: "Forsaken Strike: choose effect 1 of 3",
      options: [
        "Create a Gate to i'Arathael",
        option,
        "Give Forsaken Strike go again",
      ],
    });

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "choose",
      optionId: option,
    }));

    expect(projection.view).toBe(view);
    expect(projection.view?.pendingDecision).toBe(view.pendingDecision);
    expect(projection.key).toBe("interaction:authoritative");
  });

  it("does not dismiss a defend decision that owns staged-card presentation", () => {
    const view = game(player(0), {
      player: 0,
      kind: "defend",
      prompt: "Pay to defend",
      stagedCards: [{ instanceId: 40, cardId: "WTR171", owner: 0 }],
      stagedDefense: 3,
      resourcePayment: { cost: 1, options: [{ optionId: "pitch", pitchInstanceIds: [41] }] },
    });

    const projection = optimisticInteractionView(view, 0, pending({
      kind: "choose",
      optionId: "pitch",
    }));

    expect(projection.view).toBe(view);
    expect(projection.key).toBe("interaction:authoritative");
  });
});
