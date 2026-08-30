import { describe, expect, it } from "vitest";
import type { GameIntent } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import {
  actionAnnouncementReducer,
  committedActionIntent,
  handCardSelection,
  INITIAL_ANNOUNCEMENT,
  nonAttackActionPlayIds,
  requiresAbilityChoice,
  requiresChainCloseConfirmation,
  resolvePlayMethod,
  shouldSkipPlayConfirmation,
} from "./useActionAnnouncement.js";

describe("action announcement reducer", () => {
  it("clears payment-dependent choices when the payment method changes", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 1 },
      pitchSel: [2],
      boostCount: 1,
      targetAllyId: 3,
      targetCardInstanceId: 4,
    };

    expect(actionAnnouncementReducer(selected, {
      type: "select-alternative-cost",
      instanceIds: [5],
    })).toEqual({
      ...selected,
      pitchSel: [],
      boostCount: null,
      targetAllyId: undefined,
      targetCardInstanceId: null,
      alternativeCostCardInstanceIds: [5],
      additionalCostConfirmed: true,
    });
  });

  it("collects destroy and discard targets in one additional-cost declaration", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 1 },
    };

    const targetChosen = actionAnnouncementReducer(selected, {
      type: "toggle-additional-cost-card",
      instanceId: 5,
    });
    expect(targetChosen).toMatchObject({
      alternativeCostCardInstanceIds: [5],
      additionalCostConfirmed: false,
    });

    const bothTargetsChosen = actionAnnouncementReducer(targetChosen, {
      type: "toggle-additional-cost-card",
      instanceId: 6,
    });
    expect(bothTargetsChosen).toMatchObject({
      alternativeCostCardInstanceIds: [5, 6],
      additionalCostConfirmed: false,
    });

    expect(actionAnnouncementReducer(bothTargetsChosen, {
      type: "confirm-additional-cost",
    })).toMatchObject({
      alternativeCostCardInstanceIds: [5, 6],
      additionalCostConfirmed: true,
    });
  });

  it("selects normal resource payment when the player begins pitching", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 1 },
    };

    expect(actionAnnouncementReducer(selected, {
      type: "toggle-pitch",
      instanceId: 2,
    })).toEqual({
      ...selected,
      pitchSel: [2],
      alternativeCostCardInstanceIds: null,
    });
  });

  it("keeps an explicitly selected alternative cost while pitching its resource taxes", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 1 },
      alternativeCostCardInstanceIds: [3],
    };

    expect(actionAnnouncementReducer(selected, {
      type: "toggle-pitch",
      instanceId: 2,
    })).toEqual({
      ...selected,
      pitchSel: [2],
    });
  });

  it("starts every newly selected action from a clean announcement", () => {
    const dirty = { ...INITIAL_ANNOUNCEMENT, pitchSel: [7], boostCount: 2 };
    expect(actionAnnouncementReducer(dirty, {
      type: "select",
      sel: { kind: "activate", sourceInstanceId: 8 },
    })).toEqual({
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "activate", sourceInstanceId: 8 },
    });
  });

  it("commits chain-closing plays without changing the staged play", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 9 },
      pitchSel: [10],
    };

    expect(actionAnnouncementReducer(selected, { type: "confirm-chain-close" })).toEqual({
      ...selected,
      chainCloseConfirmed: true,
      commitConfirmed: true,
    });
  });

  it("records an explicit commit separately from staged payment", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 9 },
      pitchSel: [10],
    };

    expect(actionAnnouncementReducer(selected, { type: "confirm-action" })).toEqual({
      ...selected,
      commitConfirmed: true,
    });
  });

  it("clears staged payment when the action/instant method changes", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 9 },
      pitchSel: [10],
      alternativeCostCardInstanceIds: [11],
    };

    expect(actionAnnouncementReducer(selected, {
      type: "select-play-method",
      playMethod: "action",
    })).toEqual({
      ...selected,
      playMethod: "action",
      pitchSel: [],
      alternativeCostCardInstanceIds: undefined,
    });
  });

  it("clears staged payment after choosing an activated-ability mode", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "activate" as const, sourceInstanceId: 9 },
      pitchSel: [10],
      alternativeCostCardInstanceIds: [11],
    };

    expect(actionAnnouncementReducer(selected, {
      type: "select-ability",
      abilityIndex: 1,
    })).toEqual({
      ...selected,
      sel: { kind: "activate", sourceInstanceId: 9, abilityIndex: 1 },
      pitchSel: [],
      alternativeCostCardInstanceIds: undefined,
    });
  });
});

describe("activated ability choice", () => {
  const legal: GameIntent[] = [
    {
      kind: "activate-ability",
      sourceInstanceId: 9,
      abilityIndex: 0,
      pitchInstanceIds: [10],
    },
    {
      kind: "activate-ability",
      sourceInstanceId: 9,
      abilityIndex: 1,
      pitchInstanceIds: [],
    },
  ];

  it("requires the mode before payment when multiple abilities are legal", () => {
    expect(requiresAbilityChoice(legal, {
      kind: "activate",
      sourceInstanceId: 9,
    })).toBe(true);
  });

  it("stops requiring the mode after the player chooses one", () => {
    expect(requiresAbilityChoice(legal, {
      kind: "activate",
      sourceInstanceId: 9,
      abilityIndex: 0,
    })).toBe(false);
  });
});

describe("play method choice", () => {
  it("requires a choice when both action and instant intents are offered", () => {
    expect(resolvePlayMethod(true, true, null)).toEqual({
      choiceRequired: true,
      asInstant: false,
    });
    expect(resolvePlayMethod(true, true, "action")).toEqual({
      choiceRequired: false,
      asInstant: false,
    });
    expect(resolvePlayMethod(true, true, "instant")).toEqual({
      choiceRequired: false,
      asInstant: true,
    });
  });

  it("uses the only offered method without prompting", () => {
    expect(resolvePlayMethod(true, false, null)).toEqual({
      choiceRequired: false,
      asInstant: false,
    });
    expect(resolvePlayMethod(false, true, null)).toEqual({
      choiceRequired: false,
      asInstant: true,
    });
  });
});

describe("action commit", () => {
  const intent: GameIntent = { kind: "play-card", instanceId: 9, pitchInstanceIds: [10] };

  it("does not submit a fully paid action before explicit confirmation", () => {
    expect(committedActionIntent(intent, true, false, false, false)).toBeNull();
  });

  it("submits only after the final confirmation", () => {
    expect(committedActionIntent(intent, true, true, false, false)).toBe(intent);
    expect(committedActionIntent(intent, true, true, true, false)).toBeNull();
    expect(committedActionIntent(intent, true, true, true, true)).toBe(intent);
  });
});

describe("skip action confirmation", () => {
  it("skips the final confirmation for card plays and activated abilities", () => {
    expect(shouldSkipPlayConfirmation({ kind: "play-hand", instanceId: 1 }, true)).toBe(true);
    expect(shouldSkipPlayConfirmation({ kind: "play-arsenal", instanceId: 1 }, true)).toBe(true);
    expect(shouldSkipPlayConfirmation({ kind: "play-zone", instanceId: 1, zone: "banish" }, true)).toBe(true);
    expect(shouldSkipPlayConfirmation({ kind: "play-zone", instanceId: 1, zone: "graveyard" }, true)).toBe(true);
    expect(shouldSkipPlayConfirmation({ kind: "activate", sourceInstanceId: 1 }, true)).toBe(true);
    expect(shouldSkipPlayConfirmation({ kind: "play-hand", instanceId: 1 }, false)).toBe(false);
    expect(shouldSkipPlayConfirmation({ kind: "activate", sourceInstanceId: 1 }, false)).toBe(false);
  });
});

describe("hand card actions", () => {
  it("selects a from-hand instant ability when that is the only legal use", () => {
    expect(handCardSelection([
      { kind: "activate-ability", sourceInstanceId: 12, pitchInstanceIds: [] },
      { kind: "pass" },
    ], 12)).toEqual({ kind: "activate", sourceInstanceId: 12, abilityIndex: 0 });
  });

  it("asks how to use a card that can be played or activated from hand", () => {
    expect(handCardSelection([
      { kind: "play-card", instanceId: 12, pitchInstanceIds: [] },
      { kind: "activate-ability", sourceInstanceId: 12, pitchInstanceIds: [] },
    ], 12)).toEqual({ kind: "choose-hand-action", instanceId: 12 });
  });
});

describe("combat-chain close confirmation", () => {
  const chainClosingPlayIds = new Set([9]);

  it("requires confirmation for a normal play identified as a non-attack action", () => {
    expect(requiresChainCloseConfirmation(
      { kind: "play-card", instanceId: 9, pitchInstanceIds: [] },
      chainClosingPlayIds,
    )).toBe(true);
  });

  it("does not intercept attacks, instants, or unrelated intents", () => {
    expect(requiresChainCloseConfirmation(
      { kind: "play-card", instanceId: 8, pitchInstanceIds: [] },
      chainClosingPlayIds,
    )).toBe(false);
    expect(requiresChainCloseConfirmation(
      { kind: "play-card", instanceId: 9, pitchInstanceIds: [], asInstant: true },
      chainClosingPlayIds,
    )).toBe(false);
    expect(requiresChainCloseConfirmation(
      { kind: "close-chain" },
      chainClosingPlayIds,
    )).toBe(false);
  });

  it("classifies non-attack action cards without including attack actions", () => {
    const nonAttack = Object.values(cardData).find((data) =>
      data.cardType === "action" && !(data.subtypes ?? []).includes("attack"));
    const attack = Object.values(cardData).find((data) =>
      data.cardType === "action" && (data.subtypes ?? []).includes("attack"));
    expect(nonAttack).toBeDefined();
    expect(attack).toBeDefined();

    const ids = nonAttackActionPlayIds([
      { instanceId: 21, cardId: nonAttack!.id, owner: 0 },
      { instanceId: 22, cardId: attack!.id, owner: 0 },
    ]);
    expect([...ids]).toEqual([21]);
  });
});
