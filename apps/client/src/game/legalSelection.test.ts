import { describe, expect, it } from "vitest";
import type { GameIntent } from "@fyendal/shared";
import {
  actionSelectionVariants,
  actionVariants,
  canAddPitch,
  canAddResourcePaymentPitch,
  offeredMeldSides,
  paidActionCandidates,
  paidActionVariants,
  pitchResourceProgress,
  selectedActionIntent,
  selectedDefendIntent,
  selectedResourcePaymentOption,
} from "./legalSelection.js";

describe("authoritative legal-intent selection", () => {
  it.each([
    ["dynamic reduction", { kind: "play-card", instanceId: 10, pitchInstanceIds: [] }],
    ["cost increase", { kind: "play-card", instanceId: 10, pitchInstanceIds: [31, 32] }],
    ["chi-only cost", { kind: "activate-ability", sourceInstanceId: 20, pitchInstanceIds: [41] }],
    ["alternate zone", { kind: "play-from-zone", zone: "banish", instanceId: 50, pitchInstanceIds: [31] }],
  ] as const)("returns the exact server object for %s", (_label, offered) => {
    const mutableOffered = { ...offered, pitchInstanceIds: [...offered.pitchInstanceIds] } as GameIntent;
    const legal = [mutableOffered];
    const sel = offered.kind === "play-card"
      ? ({ kind: "play-hand", instanceId: offered.instanceId } as const)
      : offered.kind === "play-from-zone"
        ? ({ kind: "play-zone", zone: offered.zone, instanceId: offered.instanceId } as const)
        : ({ kind: "activate", sourceInstanceId: offered.sourceInstanceId } as const);
    const found = selectedActionIntent(legal, sel, null, null, null, offered.pitchInstanceIds);
    expect(found).toBe(mutableOffered);
  });

  it("requires the exact Meld side, target, and offered pitch set", () => {
    const hero: GameIntent = { kind: "play-card", instanceId: 10, pitchInstanceIds: [31], meldSide: "both" };
    const ally: GameIntent = { ...hero, targetAllyId: 99 };
    const legal: GameIntent[] = [hero, ally];
    const sel = { kind: "play-hand", instanceId: 10 } as const;
    expect(selectedActionIntent(legal, sel, "both", 99, null, [31])).toBe(ally);
    expect(selectedActionIntent(legal, sel, "left", 99, null, [31])).toBeNull();
    expect(selectedActionIntent(legal, sel, "both", 99, null, [])).toBeNull();
  });

  it("offers only Meld modes present in legal intents for the selected card", () => {
    const selected = { kind: "play-hand", instanceId: 10 } as const;
    const legal: GameIntent[] = [
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [], meldSide: "right" },
      { kind: "play-card", instanceId: 10, pitchInstanceIds: [], meldSide: "right", asInstant: true },
      { kind: "play-card", instanceId: 11, pitchInstanceIds: [], meldSide: "both" },
    ];

    expect(offeredMeldSides(legal, selected)).toEqual(["right"]);
  });

  it("matches Meld modes to the selected alternate zone", () => {
    const selected = { kind: "play-zone", instanceId: 10, zone: "banish" } as const;
    const legal: GameIntent[] = [
      { kind: "play-from-zone", zone: "graveyard", instanceId: 10, pitchInstanceIds: [], meldSide: "left" },
      { kind: "play-from-zone", zone: "banish", instanceId: 10, pitchInstanceIds: [], meldSide: "right" },
      { kind: "play-from-zone", zone: "banish", instanceId: 10, pitchInstanceIds: [], meldSide: "both" },
    ];

    expect(offeredMeldSides(legal, selected)).toEqual(["right", "both"]);
  });

  it("selects the exact offered Boost variant", () => {
    const normal: GameIntent = { kind: "play-card", instanceId: 10, pitchInstanceIds: [31] };
    const boosted: GameIntent = { ...normal, boost: true };
    const boostedTwice: GameIntent = { ...normal, boost: true, boostCount: 2 };
    const legal = [normal, boosted, boostedTwice];
    const sel = { kind: "play-hand", instanceId: 10 } as const;
    expect(selectedActionIntent(legal, sel, null, null, null, [31], null)).toBeNull();
    expect(selectedActionIntent(legal, sel, null, null, null, [31], 0)).toBe(normal);
    expect(selectedActionIntent(legal, sel, null, null, null, [31], 1)).toBe(boosted);
    expect(selectedActionIntent(legal, sel, null, null, null, [31], 2)).toBe(boostedTwice);
  });

  it("keeps Boost and target unresolved while staging an exact payment", () => {
    const base: GameIntent = { kind: "play-card", instanceId: 10, pitchInstanceIds: [31] };
    const legal: GameIntent[] = [
      base,
      { ...base, boost: true },
      { ...base, targetAllyId: 99 },
      { ...base, targetAllyId: 99, boost: true },
      { ...base, targetAllyId: 100, pitchInstanceIds: [32] },
    ];
    const selected = actionSelectionVariants(
      legal,
      { kind: "play-hand", instanceId: 10 },
      null,
    );

    expect(paidActionVariants(selected, [31], null)).toEqual(legal.slice(0, 4));
  });

  it("selects the explicitly announced action or instant play method", () => {
    const action: GameIntent = { kind: "play-card", instanceId: 10, pitchInstanceIds: [] };
    const instant: GameIntent = { ...action, asInstant: true };
    const legal = [action, instant];
    const sel = { kind: "play-hand", instanceId: 10 } as const;

    expect(selectedActionIntent(legal, sel, null, null, null, [], 0, false)).toBe(action);
    expect(selectedActionIntent(legal, sel, null, null, null, [], 0, true)).toBe(instant);
  });

  it("does not offer action/instant play methods for an activated ability", () => {
    const blossom: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: 20,
      pitchInstanceIds: [],
    };
    const sel = { kind: "activate", sourceInstanceId: 20 } as const;

    expect(actionVariants([blossom], sel, null, null, null, 0, false)).toEqual([blossom]);
    expect(actionVariants([blossom], sel, null, null, null, 0, true)).toEqual([]);
  });

  it("selects the exact alternative-cost card set offered by the server", () => {
    const normal: GameIntent = { kind: "play-card", instanceId: 10, pitchInstanceIds: [] };
    const first: GameIntent = { ...normal, alternativeCostCardInstanceIds: [31] };
    const second: GameIntent = { ...normal, alternativeCostCardInstanceIds: [32, 33] };
    const legal = [normal, first, second];
    const sel = { kind: "play-hand", instanceId: 10 } as const;

    expect(selectedActionIntent(legal, sel, null, null, null, [])).toBe(normal);
    expect(selectedActionIntent(legal, sel, null, null, null, [], 0, false, [33, 32])).toBe(second);
  });

  it("selects resource or card payment for an activated ability", () => {
    const normal: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: 20,
      pitchInstanceIds: [41],
    };
    const destroyEquipment: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: 20,
      pitchInstanceIds: [],
      alternativeCostCardInstanceIds: [31],
    };
    const legal = [normal, destroyEquipment];
    const sel = { kind: "activate", sourceInstanceId: 20 } as const;

    expect(selectedActionIntent(legal, sel, null, null, null, [41])).toBe(normal);
    expect(selectedActionIntent(legal, sel, null, null, null, [], 0, false, [31]))
      .toBe(destroyEquipment);
    expect(paidActionVariants(actionSelectionVariants(legal, sel, null), [], null)).toEqual([]);
  });

  it("selects the exact announced card target", () => {
    const first: GameIntent = {
      kind: "play-card",
      instanceId: 10,
      pitchInstanceIds: [],
      targetCardInstanceId: 41,
    };
    const second: GameIntent = { ...first, targetCardInstanceId: 42 };
    const sel = { kind: "play-hand", instanceId: 10 } as const;

    expect(selectedActionIntent([first, second], sel, null, null, 42, [])).toBe(second);
    expect(selectedActionIntent([first, second], sel, null, null, null, [])).toBeNull();
  });

  it("only permits pitch selections that can become an offered payment", () => {
    const variants = actionVariants(
      [
        { kind: "play-card", instanceId: 10, pitchInstanceIds: [31] },
        { kind: "play-card", instanceId: 10, pitchInstanceIds: [32, 33] },
      ],
      { kind: "play-hand", instanceId: 10 },
      null,
      null,
      null,
    );
    expect(canAddPitch(variants, [], 32)).toBe(true);
    expect(canAddPitch(variants, [32], 31)).toBe(false);
    expect(canAddPitch(variants, [32], 33)).toBe(true);
  });

  it("preserves sequential pitch order", () => {
    const redThenBlue: GameIntent = {
      kind: "play-card",
      instanceId: 10,
      pitchInstanceIds: [31, 32],
    };
    const variants = actionVariants(
      [redThenBlue],
      { kind: "play-hand", instanceId: 10 },
      null,
      null,
      null,
    );

    expect(canAddPitch(variants, [], 31)).toBe(true);
    expect(canAddPitch(variants, [], 32)).toBe(false);
    expect(canAddPitch(variants, [31], 32)).toBe(true);
    expect(selectedActionIntent(
      [redThenBlue],
      { kind: "play-hand", instanceId: 10 },
      null,
      null,
      null,
      [32, 31],
    )).toBeNull();
  });

  it("accepts any final pitch order that naturally reaches a candidate's cost", () => {
    const candidate: GameIntent = {
      kind: "play-card",
      instanceId: 10,
      pitchInstanceIds: [],
      pitchRequired: 4,
    };
    const variants = actionVariants(
      [candidate],
      { kind: "play-hand", instanceId: 10 },
      null,
      null,
      null,
    );
    const values = new Map([[31, 1], [32, 3], [33, 1]]);
    const pitchValue = (id: number) => values.get(id) ?? 0;

    expect(canAddPitch(variants, [], 32, pitchValue)).toBe(true);
    expect(canAddPitch(variants, [32], 31, pitchValue)).toBe(true);
    expect(paidActionCandidates(variants, [32], pitchValue)).toEqual([]);
    expect(paidActionCandidates(variants, [32, 31], pitchValue)).toEqual([candidate]);
    expect(canAddPitch(variants, [32, 31], 33, pitchValue)).toBe(false);
    expect(selectedActionIntent(
      [candidate],
      { kind: "play-hand", instanceId: 10 },
      null,
      null,
      null,
      [32, 31],
      0,
      false,
      null,
      pitchValue,
    )).toEqual({ ...candidate, pitchInstanceIds: [32, 31] });
  });

  it("reports compact resource progress for the tightest compatible payment", () => {
    const variants = actionVariants(
      [
        { kind: "play-card", instanceId: 10, pitchInstanceIds: [31] },
        { kind: "play-card", instanceId: 10, pitchInstanceIds: [32, 33] },
      ],
      { kind: "play-hand", instanceId: 10 },
      null,
      null,
      null,
    );
    const values = new Map([[31, 3], [32, 2], [33, 1]]);

    expect(pitchResourceProgress(variants, [32], (id) => values.get(id) ?? 0)).toEqual({
      selected: 2,
      required: 3,
    });
  });

  it("reports the effective cost instead of the final overpay total", () => {
    const variants = actionVariants(
      [{
        kind: "play-card",
        instanceId: 10,
        pitchInstanceIds: [31, 32],
        pitchRequired: 2,
      }],
      { kind: "play-hand", instanceId: 10 },
      null,
      null,
      null,
    );
    const values = new Map([[31, 1], [32, 3]]);

    expect(pitchResourceProgress(variants, [31], (id) => values.get(id) ?? 0)).toEqual({
      selected: 1,
      required: 2,
    });
  });

  it("stages a declared resource payment from authoritative pitch options", () => {
    const payment = {
      cost: 4,
      options: [
        { optionId: "first", pitchInstanceIds: [31, 32] },
        { optionId: "second", pitchInstanceIds: [33, 34] },
      ],
    };

    expect(canAddResourcePaymentPitch(payment, [], 31)).toBe(true);
    expect(canAddResourcePaymentPitch(payment, [31], 34)).toBe(false);
    expect(canAddResourcePaymentPitch(payment, [31], 32)).toBe(true);
    expect(selectedResourcePaymentOption(payment, [32, 31])).toBeNull();
    expect(selectedResourcePaymentOption(payment, [31, 32])).toEqual(payment.options[0]);
  });

  it("matches defender cards as a set but preserves their pitch order", () => {
    const offered: GameIntent = { kind: "defend", instanceIds: [1, 2], pitchInstanceIds: [4, 3] };
    expect(selectedDefendIntent([offered], [2, 1], [4, 3])).toBe(offered);
    expect(selectedDefendIntent([offered], [2, 1], [3, 4])).toBeNull();
  });
});
