import { describe, expect, it } from "vitest";
import type { CardView, GameView, PlayerView, TurnTriggerView } from "@fyendal/shared";
import {
  activeOrderMessages,
  standingOrderCardModels,
  standingOrderKey,
} from "./standingOrders.js";

const FEALTY_SFA = "SFA037";
const FEALTY_HNT = "HNT167";
const DYNAMO = "MON107";
const COG = "SEA042";

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

const YES_NO = {
  hook: "trigger-choice",
  options: [
    { value: "yes", message: { id: "common.option.yes" } },
    { value: "no", message: { id: "common.option.no" } },
  ],
};

const dynamoTrigger: TurnTriggerView = {
  event: "end-of-turn",
  label: "Recover Valiant Dynamo",
  labelMessage: { id: "card.trigger.common.valiantdynamo.recover" },
  optional: true,
  choices: [YES_NO],
};

const cogTrigger: TurnTriggerView = {
  event: "start-of-turn",
  label: "Remove a steam counter or destroy this",
  labelMessage: { id: "card.trigger.steam.maintain" },
  choices: [{
    hook: "sea-cog-maintenance",
    options: [
      { value: "remove", message: { id: "common.option.remove" } },
      { value: "destroy", message: { id: "common.option.destroy" } },
    ],
  }],
};

const fealtyTrigger: TurnTriggerView = { event: "end-of-turn", label: "Destroy Fealty" };

function withTriggers(): GameView {
  const dynamo: CardView = { instanceId: 13, cardId: DYNAMO, owner: 0, turnTriggers: [dynamoTrigger] };
  return view({
    players: [
      player(0, {
        board: [
          { instanceId: 11, cardId: FEALTY_SFA, owner: 0, turnTriggers: [fealtyTrigger] },
          { instanceId: 14, cardId: COG, owner: 0, turnTriggers: [cogTrigger] },
        ],
        equipment: { chest: dynamo },
      }),
      player(1, {
        board: [{ instanceId: 24, cardId: COG, owner: 1, turnTriggers: [cogTrigger] }],
        equipment: { chest: { ...dynamo, instanceId: 23, owner: 1 } },
      }),
    ],
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

describe("standingOrderCardModels", () => {
  it("offers a row for every declared turn-trigger choice before it first fires", () => {
    const models = standingOrderCardModels(withTriggers(), 0, {});
    expect([...models.keys()]).toEqual(["valiant dynamo|0", "golden cog|0"]);
    expect(models.get("valiant dynamo|0")?.rows).toEqual([{
      hook: "trigger-choice",
      timing: "end-of-turn",
      label: { id: "card.trigger.common.valiantdynamo.recover" },
      fallback: "Recover Valiant Dynamo",
      options: YES_NO.options,
      order: null,
    }]);
    expect(models.get("golden cog|0")?.rows).toMatchObject([
      { hook: "sea-cog-maintenance", timing: "start-of-turn", order: null },
    ]);
  });

  it("gives no chip to a mandatory trigger without a choice", () => {
    expect(standingOrderCardModels(withTriggers(), 0, {}).has("fealty|0")).toBe(false);
  });

  it("never offers rows on the opponent's permanents, even with stored orders", () => {
    const opponentOnly = withTriggers();
    opponentOnly.players[0] = player(0);
    expect(standingOrderCardModels(opponentOnly, 0, {
      "golden cog|0": { "sea-cog-maintenance": "remove" },
    }).size).toBe(0);
  });

  it("reads stored answers by hook and ignores values the choice does not offer", () => {
    const models = standingOrderCardModels(withTriggers(), 0, {
      "golden cog|0": { "sea-cog-maintenance": "remove" },
      "valiant dynamo|0": { "trigger-choice": "later" },
    });
    expect(models.get("golden cog|0")?.rows[0]?.order).toBe("remove");
    expect(models.get("valiant dynamo|0")?.rows[0]?.order).toBeNull();
  });

  it("lists the set orders' option labels for the chip", () => {
    const rows = standingOrderCardModels(withTriggers(), 0, {
      "golden cog|0": { "sea-cog-maintenance": "destroy" },
    }).get("golden cog|0")!.rows;
    expect(activeOrderMessages(rows)).toEqual([{ id: "common.option.destroy" }]);
    expect(activeOrderMessages(standingOrderCardModels(withTriggers(), 0, {}).get("golden cog|0")!.rows))
      .toEqual([]);
  });
});
