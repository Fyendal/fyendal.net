import { describe, expect, it } from "vitest";
import type { GameView, PlayerView } from "@fyendal/shared";
import {
  activeOrderValues,
  currentStandingOrderQuestion,
  standingOrderCardModels,
  standingOrderKey,
  type ObservedStandingOrderQuestion,
} from "./standingOrders.js";

const FEALTY_SFA = "SFA037";
const FEALTY_HNT = "HNT167";
const DYNAMO = "MON107";

function player(seat: number, overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    seat,
    heroCardId: "WTR001",
    heroInstanceId: 100 + seat,
    heroName: `Hero ${seat}`,
    life: 20,
    actionPoints: 1,
    resources: 0,
    hand: [],
    handCount: 0,
    deckCount: 30,
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

function view(overrides: Partial<GameView> = {}): GameView {
  return {
    gameId: "game",
    turn: 3,
    phase: "end",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [
      player(0, {
        board: [
          { instanceId: 11, cardId: FEALTY_SFA, owner: 0 },
          { instanceId: 12, cardId: FEALTY_HNT, owner: 0 },
        ],
        equipment: { chest: { instanceId: 13, cardId: DYNAMO, owner: 0 } },
      }),
      player(1, { board: [{ instanceId: 21, cardId: FEALTY_SFA, owner: 1 }] }),
    ],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: null,
    winner: null,
    log: [],
    ...overrides,
  };
}

function fealtyWindow(instanceId: number, seat: number, player: number): GameView {
  return view({
    stack: [{
      card: { instanceId, cardId: instanceId === 12 ? FEALTY_HNT : FEALTY_SFA, owner: seat },
      seat,
      label: "Destroy Fealty",
      labelMessage: { id: "engine.term.card.destroy", values: { card: { kind: "card", cardId: FEALTY_SFA } } },
      optional: false,
    }],
    pendingDecision: { player, kind: "priority-window", prompt: "Respond?" },
  });
}

function dynamoChoice(player: number): GameView {
  return view({
    pendingDecision: {
      player,
      kind: "optional-effect",
      prompt: "Valiant Dynamo: Recover Valiant Dynamo",
      promptMessage: { id: "card.trigger.common.valiantdynamo.recover" },
      options: ["yes", "no"],
      defaultOption: "yes",
      sourceInstanceId: 13,
    },
  });
}

describe("standing order keys", () => {
  it("keys every Fealty printing and token copy to one functional identity", () => {
    expect(standingOrderKey({ cardId: FEALTY_SFA })).toBe("fealty|0");
    expect(standingOrderKey({ cardId: FEALTY_HNT })).toBe("fealty|0");
    expect(standingOrderKey({ cardId: DYNAMO })).toBe("valiant dynamo|0");
    expect(standingOrderKey({ cardId: "NOPE999" })).toBeNull();
  });
});

describe("currentStandingOrderQuestion", () => {
  it("finds the viewer's priority window on a Fealty trigger from either seat", () => {
    expect(currentStandingOrderQuestion(fealtyWindow(11, 0, 0), 0)).toMatchObject({
      kind: "priority-window",
      key: "fealty|0",
      card: { instanceId: 11 },
      label: { id: "engine.term.card.destroy" },
    });
    expect(currentStandingOrderQuestion(fealtyWindow(21, 1, 0), 0)).toMatchObject({
      kind: "priority-window",
      key: "fealty|0",
      card: { instanceId: 21 },
    });
  });

  it("is not a question when the window belongs to the other seat", () => {
    expect(currentStandingOrderQuestion(fealtyWindow(11, 0, 1), 0)).toBeNull();
  });

  it("ignores windows whose top layer is not an arena permanent", () => {
    const played = view({
      stack: [{ card: { instanceId: 77, cardId: "WTR160", owner: 0 }, seat: 0, label: "Played card", optional: false }],
      pendingDecision: { player: 0, kind: "priority-window", prompt: "Respond?" },
    });
    expect(currentStandingOrderQuestion(played, 0)).toBeNull();
  });

  it("finds the viewer's own optional trigger choice by its source", () => {
    expect(currentStandingOrderQuestion(dynamoChoice(0), 0)).toMatchObject({
      kind: "optional-trigger",
      key: "valiant dynamo|0",
      card: { instanceId: 13 },
      label: { id: "card.trigger.common.valiantdynamo.recover" },
    });
  });

  it("never treats the opponent's choice, a non yes/no choice, or an unsourced choice as a question", () => {
    expect(currentStandingOrderQuestion(dynamoChoice(1), 0)).toBeNull();
    expect(currentStandingOrderQuestion(dynamoChoice(1), 1)).toBeNull();
    const choice = dynamoChoice(0);
    expect(currentStandingOrderQuestion(view({
      pendingDecision: { ...choice.pendingDecision!, options: ["yes", "no", "later"] },
    }), 0)).toBeNull();
    expect(currentStandingOrderQuestion(view({
      pendingDecision: { ...choice.pendingDecision!, sourceInstanceId: undefined },
    }), 0)).toBeNull();
  });
});

describe("standingOrderCardModels", () => {
  const observed = new Map<string, ObservedStandingOrderQuestion[]>([
    ["fealty|0", [{ kind: "priority-window", label: null, fallback: "Destroy Fealty" }]],
    ["valiant dynamo|0", [
      { kind: "priority-window", label: null, fallback: "Recover Valiant Dynamo" },
      { kind: "optional-trigger", label: { id: "card.trigger.common.valiantdynamo.recover" }, fallback: "Recover" },
    ]],
  ]);

  it("gives a chip to every card with a seen or remembered question, once per identity", () => {
    const models = standingOrderCardModels(view(), 0, {}, observed);
    expect([...models.keys()]).toEqual(["valiant dynamo|0", "fealty|0"]);
    expect(models.get("fealty|0")?.rows).toEqual([
      { kind: "priority-window", timing: null, label: null, fallback: "Destroy Fealty", order: "ask" },
    ]);
    expect(models.get("valiant dynamo|0")?.rows.map((row) => row.kind)).toEqual(["optional-trigger"]);
  });

  it("builds rows from remembered orders when nothing was seen this game", () => {
    const models = standingOrderCardModels(view(), 0, { "fealty|0": { priorityWindow: "pass" } }, new Map());
    expect(models.get("fealty|0")?.rows).toEqual([
      { kind: "priority-window", timing: null, label: null, fallback: null, order: "pass" },
    ]);
    expect(models.has("valiant dynamo|0")).toBe(false);
  });

  it("offers rows for printed turn triggers before they first fire", () => {
    const printed = view({
      players: [
        player(0, {
          equipment: {
            chest: {
              instanceId: 13,
              cardId: DYNAMO,
              owner: 0,
              turnTriggers: [{
                event: "end-of-turn",
                label: "Recover Valiant Dynamo",
                labelMessage: { id: "card.trigger.common.valiantdynamo.recover" },
                optional: true,
              }],
            },
          },
        }),
        player(1),
      ],
    });
    expect(standingOrderCardModels(printed, 0, {}, new Map()).get("valiant dynamo|0")?.rows).toEqual([
      {
        kind: "optional-trigger",
        timing: "end-of-turn",
        label: { id: "card.trigger.common.valiantdynamo.recover" },
        fallback: "Recover Valiant Dynamo",
        order: "ask",
      },
    ]);
  });

  it("shows only priority windows on the opponent's permanents", () => {
    const opponentDynamo = view({
      players: [
        player(0),
        player(1, { equipment: { chest: { instanceId: 23, cardId: DYNAMO, owner: 1 } } }),
      ],
    });
    const models = standingOrderCardModels(opponentDynamo, 0, {
      "valiant dynamo|0": { priorityWindow: "pass", optionalTrigger: "yes" },
    }, new Map());
    expect(models.get("valiant dynamo|0")?.rows.map((row) => row.kind)).toEqual(["priority-window"]);
  });

  it("gives no chip to the opponent's turn-structure triggers", () => {
    const opponentDynamo = view({
      players: [
        player(0),
        player(1, {
          equipment: {
            chest: {
              instanceId: 23,
              cardId: DYNAMO,
              owner: 1,
              turnTriggers: [{ event: "end-of-turn", label: "Recover Valiant Dynamo", optional: true }],
            },
          },
        }),
      ],
    });
    const orders = { "valiant dynamo|0": { priorityWindow: "pass" as const } };
    expect(standingOrderCardModels(opponentDynamo, 0, orders, new Map()).size).toBe(0);
    const observed = new Map([["valiant dynamo|0", [
      { kind: "priority-window" as const, label: null, fallback: "Some other trigger" },
    ]]]);
    expect(standingOrderCardModels(opponentDynamo, 0, orders, observed).get("valiant dynamo|0")?.rows)
      .toHaveLength(1);
  });

  it("lists the set orders for the chip text", () => {
    expect(activeOrderValues([
      { kind: "priority-window", timing: null, label: null, fallback: null, order: "pass" },
      { kind: "optional-trigger", timing: null, label: null, fallback: null, order: "ask" },
    ])).toEqual(["pass"]);
  });
});
