import { describe, expect, it } from "vitest";
import {
  decodeFaiAggroPolicyState,
  decodeFaiPolicyState,
  initialFaiAggroPolicyState,
  type FaiAggroPolicyStateV1,
} from "./fai-policy-state.js";

describe("Fai Aggro policy state", () => {
  it("round-trips initial state through the generic unknown JSON decoder", () => {
    const state = initialFaiAggroPolicyState();
    const persisted = JSON.parse(JSON.stringify(state)) as unknown;
    expect(decodeFaiAggroPolicyState(persisted)).toEqual(state);
    expect(decodeFaiPolicyState(persisted)).toEqual(state);
  });

  it("round-trips the minimal facts used across Aggro decisions", () => {
    const state: FaiAggroPolicyStateV1 = {
      ...initialFaiAggroPolicyState(),
      memory: {
        ...initialFaiAggroPolicyState().memory,
        turn: 4,
        startedWithArsenal: true,
        turn1: false,
        initialCardCount: 5,
        originalStarters: 2,
        originalEnders: 2,
        realIds: [41, 42, 43, 44, 45],
        playedIds: [41, 42],
        playedStarterIds: [41],
        playedEnderIds: [42],
        hoodSwap: [44, 45],
        reservedId: 43,
        lastObservation: {
          turn: 4,
          hoodPrompt: true,
          handIds: [43, 44, 45],
          hoodChoiceId: 44,
          playedCandidate: { instanceId: 42, role: "ender" },
        },
      },
      stagedDefense: {
        turn: 4,
        ids: [46],
        trace: {
          rule: "DEF-TEST",
          incoming: 4,
          defense: 3,
          onHitValue: 0,
          retainedDamage: 8,
          marginalLoss: 4,
          complete: true,
        },
      },
    };
    expect(decodeFaiAggroPolicyState(
      JSON.parse(JSON.stringify(state)) as unknown,
    )).toEqual(state);
  });

  it("rejects extra fields and inconsistent played-card sets", () => {
    const state = initialFaiAggroPolicyState();
    expect(decodeFaiAggroPolicyState({ ...state, hiddenInput: {} })).toBeUndefined();
    expect(decodeFaiAggroPolicyState({
      ...state,
      memory: {
        ...state.memory,
        playedIds: [99],
      },
    })).toBeUndefined();
    expect(decodeFaiAggroPolicyState({
      ...state,
      memory: {
        ...state.memory,
        lastObservation: {
          turn: 1,
          hoodPrompt: false,
          handIds: [],
          fullInput: {},
        },
      },
    })).toBeUndefined();
  });
});
