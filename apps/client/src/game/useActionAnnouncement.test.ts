import { describe, expect, it } from "vitest";
import type { GameIntent } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { canAddPaymentCard } from "./legalSelection.js";
import {
  actionAnnouncementReducer,
  blockingEquipmentByPlay,
  committedActionIntent,
  deriveAnnouncement,
  handCardSelection,
  INITIAL_ANNOUNCEMENT,
  isAnnouncementPaymentReady,
  nonAttackActionPlayIds,
  requiresAbilityChoice,
  requiresChainCloseConfirmation,
  resolvePlayMethod,
  shouldSkipPlayConfirmation,
  shouldAutoCommitAnnouncement,
} from "./useActionAnnouncement.js";

describe("announcement payment readiness", () => {
  it("keeps a staged exact card cost open until the player confirms it", () => {
    expect(isAnnouncementPaymentReady(1, false, true, false, false)).toBe(false);
    expect(isAnnouncementPaymentReady(1, false, true, true, false)).toBe(true);
  });

  it("still requires a selected ungrouped alternative cost", () => {
    expect(isAnnouncementPaymentReady(1, true, false, false, false)).toBe(false);
    expect(isAnnouncementPaymentReady(1, true, false, false, true)).toBe(true);
  });
});

describe("action announcement reducer", () => {
  it("remembers an arena drop through boost and payment, and clears it on a new click selection", () => {
    const dropped = actionAnnouncementReducer(INITIAL_ANNOUNCEMENT, {
      type: "play-hand-from-drop", instanceId: 1,
    });
    const boostDeclared = actionAnnouncementReducer(dropped, { type: "select-boost", boostCount: 1 });
    const boosted = actionAnnouncementReducer(boostDeclared, { type: "toggle-pitch", instanceId: 2 });
    expect(boosted).toMatchObject({
      sel: { kind: "play-hand", instanceId: 1 },
      pitchSel: [2],
      boostCount: 1,
      playConfirmedByDrop: true,
    });
    expect(actionAnnouncementReducer(boosted, {
      type: "select", sel: { kind: "play-hand", instanceId: 3 },
    }).playConfirmedByDrop).toBe(false);
    expect(actionAnnouncementReducer(boosted, { type: "reset" })).toEqual(INITIAL_ANNOUNCEMENT);
  });

  it("preserves the selected card's choices when it is dropped to confirm its play", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 1 },
      pitchSel: [2],
      boostCount: 1,
      targetCardInstanceId: 3,
    };
    expect(actionAnnouncementReducer(selected, {
      type: "play-hand-from-drop", instanceId: 1,
    })).toEqual({ ...selected, playConfirmedByDrop: true });
  });
  it("restarts payment when Boost or a target is redeclared", () => {
    const paid = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "play-hand" as const, instanceId: 1 },
      boostCount: 0,
      targetAllyId: 3,
      pitchSel: [2],
      alternativeCostCardInstanceIds: null,
    };
    const unpaid = { pitchSel: [], alternativeCostCardInstanceIds: undefined };
    expect(actionAnnouncementReducer(paid, { type: "select-ally-target", targetAllyId: 4 }))
      .toMatchObject({ ...unpaid, boostCount: 0, targetAllyId: 4 });
    expect(actionAnnouncementReducer(paid, { type: "select-card-target", targetCardInstanceId: 5 }))
      .toMatchObject({ ...unpaid, targetAllyId: 3, targetCardInstanceId: 5 });
    expect(actionAnnouncementReducer(paid, { type: "select-boost", boostCount: 1 }))
      .toMatchObject({ ...unpaid, boostCount: 1, targetAllyId: undefined });
  });

  it("keeps declared Boost and targets when the payment method changes", () => {
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
      selectionSource: "alternative",
    });
    expect(targetChosen).toMatchObject({
      alternativeCostCardInstanceIds: [5],
      additionalCostConfirmed: false,
    });

    expect(actionAnnouncementReducer(targetChosen, {
      type: "confirm-additional-cost",
    })).toMatchObject({
      alternativeCostCardInstanceIds: [5],
      additionalCostConfirmed: true,
    });

    const bothTargetsChosen = actionAnnouncementReducer(targetChosen, {
      type: "toggle-additional-cost-card",
      instanceId: 6,
      selectionSource: "alternative",
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

  it("collects a defense-ability card cost in the exact payment field", () => {
    const selected = {
      ...INITIAL_ANNOUNCEMENT,
      sel: { kind: "activate" as const, sourceInstanceId: 1 },
    };

    const targetChosen = actionAnnouncementReducer(selected, {
      type: "toggle-additional-cost-card",
      instanceId: 5,
      selectionSource: "payment",
    });

    expect(targetChosen).toMatchObject({
      pitchSel: [5],
      alternativeCostCardInstanceIds: undefined,
      additionalCostConfirmed: false,
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

describe("arena drop play confirmation", () => {
  it("commits after required choices without enabling the user's fast-play setting", () => {
    const sel = { kind: "play-hand" as const, instanceId: 1 };
    expect(shouldAutoCommitAnnouncement(sel, "confirm", false, true)).toBe(true);
    expect(shouldAutoCommitAnnouncement(sel, "confirm", false, false)).toBe(false);
    for (const step of ["method", "ability", "payment", "boost", "target", "close-chain"] as const) {
      expect(shouldAutoCommitAnnouncement(sel, step, false, true)).toBe(false);
    }
  });

  it("retains the existing fast-play behavior and keeps drop confirmation specific to card plays", () => {
    const sel = { kind: "play-hand" as const, instanceId: 1 };
    expect(shouldAutoCommitAnnouncement(sel, "close-chain", true, false)).toBe(true);
    expect(shouldAutoCommitAnnouncement({ kind: "activate", sourceInstanceId: 1 }, "confirm", false, true))
      .toBe(false);
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

describe("blocked equipment plays", () => {
  it("flags an Evo head only while a non-base head is equipped", () => {
    const id = (name: string) => Object.values(cardData).find((data) => data.name === name)!.id;
    const memory = { instanceId: 31, cardId: id("Evo Steel Soul Memory"), owner: 0 };
    const recall = { instanceId: 32, cardId: id("Evo Recall"), owner: 0 };
    const baseHead = { instanceId: 33, cardId: id("Cogwerx Base Head"), owner: 0 };

    expect([...blockingEquipmentByPlay([memory], { head: recall })]).toEqual([[31, recall.cardId]]);
    expect([...blockingEquipmentByPlay([memory], { head: baseHead })]).toEqual([]);
    expect([...blockingEquipmentByPlay([memory], {})]).toEqual([]);
  });
});

describe("announcement order", () => {
  const sel = { kind: "play-hand" as const, instanceId: 10 };
  const inputs = (actionCandidates: GameIntent[]) => ({
    actionCandidates,
    legalIntents: [],
    hand: [],
    chainClosingPlayIds: new Set<number>(),
    blockingEquipment: new Map<number, string>(),
    skipPlayConfirmation: false,
  });
  const apply = (...actions: Parameters<typeof actionAnnouncementReducer>[1][]) =>
    actions.reduce(actionAnnouncementReducer, { ...INITIAL_ANNOUNCEMENT, sel });

  it("declares a target before paying", () => {
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [31], targetAllyId: 50 },
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [31], targetAllyId: 51 },
    ];
    expect(deriveAnnouncement(apply(), inputs(legal)).actionStep).toBe("target");
    expect(deriveAnnouncement(apply({ type: "toggle-pitch", instanceId: 31 }), inputs(legal)).actionStep)
      .toBe("target");

    const targeted = apply({ type: "select-ally-target", targetAllyId: 51 });
    expect(deriveAnnouncement(targeted, inputs(legal)).actionStep).toBe("payment");
    const paid = deriveAnnouncement(
      actionAnnouncementReducer(targeted, { type: "toggle-pitch", instanceId: 31 }),
      inputs(legal),
    );
    expect(paid.actionStep).toBe("confirm");
    expect(paid.chosenActionIntent).toMatchObject({ targetAllyId: 51, pitchInstanceIds: [31] });
  });

  it("declares Boost before paying", () => {
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [31] },
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [31], boost: true },
    ];
    const initial = deriveAnnouncement(apply(), inputs(legal));
    expect(initial.actionStep).toBe("boost");
    expect(initial.boostOptions).toEqual([0, 1]);

    const boosted = apply({ type: "select-boost", boostCount: 1 });
    expect(deriveAnnouncement(boosted, inputs(legal)).actionStep).toBe("payment");
    const paid = deriveAnnouncement(
      actionAnnouncementReducer(boosted, { type: "toggle-pitch", instanceId: 31 }),
      inputs(legal),
    );
    expect(paid.actionStep).toBe("confirm");
    expect(paid.chosenActionIntent).toMatchObject({ boost: true });
  });

  it("offers only payments compatible with the declared target", () => {
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [31], targetCardInstanceId: 32 },
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [32], targetCardInstanceId: 31 },
    ];
    const targeted = apply({ type: "select-card-target", targetCardInstanceId: 32 });
    const declared = deriveAnnouncement(targeted, inputs(legal));
    expect(declared.actionStep).toBe("payment");
    expect(declared.selectedPaymentVariants.map((intent) => intent.pitchInstanceIds)).toEqual([[31]]);
    expect(canAddPaymentCard(declared.selectedPaymentVariants, [], 31)).toBe(true);
    expect(canAddPaymentCard(declared.selectedPaymentVariants, [], 32)).toBe(false);
    expect(deriveAnnouncement(
      actionAnnouncementReducer(targeted, { type: "toggle-pitch", instanceId: 32 }),
      inputs(legal),
    ).actionStep).toBe("payment");
  });

  it("keeps the declared target through an alternative cost", () => {
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [31], targetAllyId: 50 },
      {
        kind: "play-card", instanceId: 10, pitchInstanceIds: [], targetAllyId: 50,
        alternativeCostCardInstanceIds: [40],
      },
    ];
    const targeted = apply({ type: "select-ally-target", targetAllyId: 50 });
    expect(deriveAnnouncement(targeted, inputs(legal)).alternativeCostSets.size).toBe(1);
    const paid = deriveAnnouncement(
      actionAnnouncementReducer(targeted, { type: "select-alternative-cost", instanceIds: [40] }),
      inputs(legal),
    );
    expect(paid.actionStep).toBe("confirm");
    expect(paid.chosenActionIntent).toMatchObject({
      targetAllyId: 50, alternativeCostCardInstanceIds: [40],
    });
  });

  it("goes straight to payment and auto-commits a dropped play without targets or Boost", () => {
    const legal: GameIntent[] = [{ kind: "play-card", instanceId: 10, pitchInstanceIds: [31] }];
    const dropped = actionAnnouncementReducer(INITIAL_ANNOUNCEMENT, {
      type: "play-hand-from-drop", instanceId: 10,
    });
    expect(deriveAnnouncement(dropped, inputs(legal)).actionStep).toBe("payment");
    const paid = deriveAnnouncement(
      actionAnnouncementReducer(dropped, { type: "toggle-pitch", instanceId: 31 }),
      inputs(legal),
    );
    expect(paid.actionStep).toBe("confirm");
    expect(paid.autoCommitPending).toBe(true);
  });
});
