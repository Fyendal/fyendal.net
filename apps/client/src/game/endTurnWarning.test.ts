import { describe, expect, it } from "vitest";
import type { CardView, GameIntent, GameView } from "@fyendal/shared";
import { shouldWarnBeforeEndTurn } from "./endTurnWarning.js";

const card = (instanceId: number, cardId: string): CardView => ({ instanceId, cardId, owner: 0 });

function view(overrides: Partial<GameView> = {}, actionPoints = 1): GameView {
  const player = {
    actionPoints,
    hand: [card(1, "WTR006")],
    arsenal: [],
    graveyard: [],
    banish: [],
    weapons: [card(2, "WTR003")],
  };
  return {
    turn: 2,
    phase: "action",
    activePlayer: 0,
    pendingDecision: null,
    stack: [],
    players: [player, { ...player, hand: [], weapons: [] }],
    ...overrides,
  } as unknown as GameView;
}

const playAction: GameIntent = { kind: "play-card", instanceId: 1, pitchInstanceIds: [] };
const swingWeapon: GameIntent = { kind: "activate-ability", sourceInstanceId: 2, pitchInstanceIds: [] };
const useEquipment: GameIntent = { kind: "activate-ability", sourceInstanceId: 9, pitchInstanceIds: [] };

describe("shouldWarnBeforeEndTurn", () => {
  it("warns with an action point and a playable action card or weapon", () => {
    expect(shouldWarnBeforeEndTurn(view(), 0, [playAction])).toBe(true);
    expect(shouldWarnBeforeEndTurn(view(), 0, [swingWeapon])).toBe(true);
  });

  it("does not warn without an action point", () => {
    expect(shouldWarnBeforeEndTurn(view({}, 0), 0, [playAction, swingWeapon])).toBe(false);
  });

  it("ignores instant-speed plays and non-weapon abilities", () => {
    expect(shouldWarnBeforeEndTurn(view(), 0, [{ ...playAction, asInstant: true }])).toBe(false);
    expect(shouldWarnBeforeEndTurn(view(), 0, [useEquipment])).toBe(false);
  });

  it("only warns on the player's own open action phase", () => {
    expect(shouldWarnBeforeEndTurn(view({ activePlayer: 1 }), 0, [playAction])).toBe(false);
    expect(shouldWarnBeforeEndTurn(view({ phase: "end" }), 0, [playAction])).toBe(false);
    expect(shouldWarnBeforeEndTurn(view({ turn: 1 }), 0, [playAction])).toBe(false);
    expect(
      shouldWarnBeforeEndTurn(view({ stack: [{}] as unknown as GameView["stack"] }), 0, [playAction]),
    ).toBe(false);
    expect(shouldWarnBeforeEndTurn(view(), null, [playAction])).toBe(false);
  });
});
