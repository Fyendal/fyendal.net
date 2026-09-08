import { describe, expect, it } from "vitest";
import {
  decodeFaiMidrangePolicyState,
  initialFaiMidrangePolicyState,
  type FaiMidrangePolicyStateV1,
} from "./fai-policy-state.js";

describe("Fai policy state", () => {
  it("round-trips the initial Midrange state through unknown JSON", () => {
    const encoded = JSON.stringify(initialFaiMidrangePolicyState());
    expect(decodeFaiMidrangePolicyState(JSON.parse(encoded) as unknown))
      .toEqual(initialFaiMidrangePolicyState());
  });

  it("round-trips every currently stateful Midrange decision fact", () => {
    const state: FaiMidrangePolicyStateV1 = {
      ...initialFaiMidrangePolicyState(),
      turn: 13,
      origin: {
        resources: 1,
        tiger: 1,
        chestInstanceId: 41,
        pitchIds: [42],
        potionIds: [43],
      },
      reservedId: 44,
      supportedFireIds: [45],
      observedHandIds: [44, 45],
      stagedDefense: {
        ids: [46],
        trace: {
          incoming: 4,
          defense: 3,
          handIds: [46],
          protectedId: 44,
          replacedEnderId: 47,
          lifeAfter: 17,
          retainedDamage: 8,
          netValue: 4,
          complete: true,
        },
      },
    };
    expect(decodeFaiMidrangePolicyState(
      JSON.parse(JSON.stringify(state)) as unknown,
    )).toEqual(state);
  });

  it("rejects unknown fields, duplicate ids, and incompatible versions", () => {
    const valid = initialFaiMidrangePolicyState();
    expect(decodeFaiMidrangePolicyState({ ...valid, unexpected: true })).toBeUndefined();
    expect(decodeFaiMidrangePolicyState({
      ...valid,
      supportedFireIds: [7, 7],
    })).toBeUndefined();
    expect(decodeFaiMidrangePolicyState({
      ...valid,
      strategyVersion: "future-version",
    })).toBeUndefined();
    expect(decodeFaiMidrangePolicyState({
      ...valid,
      origin: {
        resources: 0,
        tiger: 0,
        pitchIds: [],
        potionIds: [],
        unexpected: true,
      },
    })).toBeUndefined();
  });
});
