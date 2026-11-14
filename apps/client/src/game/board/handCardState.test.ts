import { describe, expect, it, vi } from "vitest";
import type { CardView } from "@fyendal/shared";
import { deriveBoardLegalState } from "./boardModel.js";
import { handCardState } from "./handCardState.js";
import type { PlayerHandInteraction } from "./PlayerHand.js";

const card: CardView = { instanceId: 10, cardId: "TST-HAND", owner: 1 };
const other: CardView = { instanceId: 11, cardId: "WTR171", owner: 1 };
const player = { hand: [card, other], resources: 0, chi: 0 };

function interaction(overrides: Partial<PlayerHandInteraction> = {}): PlayerHandInteraction {
  const legal = [{ kind: "play-card" as const, instanceId: 10, pitchInstanceIds: [] }];
  return {
    legalState: deriveBoardLegalState(legal, legal, false),
    legalIntents: legal,
    selection: { kind: "none" },
    preStackSelectedInstanceId: null,
    pitchSelection: [],
    selectedPaymentVariants: [],
    stagedIds: new Set(),
    optimisticallyHiddenIds: new Set(),
    defending: false,
    choosingArsenal: false,
    handPick: null,
    onCardClick: vi.fn(),
    onActivate: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
}

describe("handCardState", () => {
  it("offers the acting seat's playable cards", () => {
    expect(handCardState(card, player, interaction()).actionable).toBe(true);
    expect(handCardState(other, player, interaction()).actionable).toBe(false);
  });

  it("leaves a hand without interaction inert, even mid-decision", () => {
    expect(handCardState(card, player, null)).toEqual({
      stageable: false, selected: false, pitched: false, actionable: false, dimmed: false,
    });
  });

  it("offers every hand card as a blocker only when it can be staged", () => {
    const legal = [{ kind: "stage-defenders" as const, instanceIds: [11] }];
    const defending = interaction({
      defending: true,
      legalState: deriveBoardLegalState([], legal, false),
      legalIntents: legal,
    });
    expect(handCardState(other, player, defending)).toMatchObject({ actionable: true, stageable: true, dimmed: false });
    expect(handCardState(card, player, defending)).toMatchObject({ actionable: false, dimmed: true });
  });

  it("marks hand picks and arsenal choices from decisions", () => {
    expect(handCardState(other, player, interaction({ handPick: new Map([[11, "pick"]]) })).actionable).toBe(true);
    expect(handCardState(other, player, interaction({ choosingArsenal: true })).actionable).toBe(true);
  });

  it("selects the played card and offers payment cards while paying", () => {
    const paying = interaction({
      selection: { kind: "play-hand", instanceId: 10 },
      selectedPaymentVariants: [{ kind: "play-card", instanceId: 10, pitchInstanceIds: [11], pitchRequired: 1 }],
    });
    expect(handCardState(card, player, paying)).toMatchObject({ selected: true, actionable: true });
    expect(handCardState(other, player, paying).actionable).toBe(true);
    expect(handCardState(other, player, { ...paying, pitchSelection: [11] }).pitched).toBe(true);
  });
});
