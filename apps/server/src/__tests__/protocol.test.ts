import { describe, expect, it } from "vitest";
import { decodeClientMessage } from "@fyendal/protocol";
import { botDefinitions } from "@fyendal/bot";

describe("decodeClientMessage", () => {
  it("accepts every bot registered by the server", () => {
    for (const definition of botDefinitions) {
      expect(decodeClientMessage({
        type: "create-bot-room",
        format: definition.format,
        deckId: "precon-asr",
        bot: definition.id,
      })).toMatchObject({ bot: definition.id });
    }
  });

  it("accepts valid room, prep, and intent messages", () => {
    expect(decodeClientMessage({
      type: "create-room",
      format: "classic-battles",
      hero: "rhinar",
      private: true,
      allowFutureCards: true,
    })).not.toBeNull();
    expect(decodeClientMessage({ type: "inspect-room", code: "ABC123" })).toEqual({
      type: "inspect-room",
      code: "ABC123",
    });
    expect(decodeClientMessage({ type: "create-bot-room", format: "silver-age", deckId: "precon-sba", bot: "briar", allowFutureCards: true })).toEqual({
      type: "create-bot-room",
      format: "silver-age",
      deckId: "precon-sba",
      bot: "briar",
      allowFutureCards: true,
    });
    expect(decodeClientMessage({
      type: "create-bot-room",
      format: "silver-age",
      deckId: "precon-sba",
      bot: "bravo",
    })).toMatchObject({ bot: "bravo" });
    expect(decodeClientMessage({ type: "join-room", code: "ABC123", spectate: true })).toEqual({
      type: "join-room",
      code: "ABC123",
      spectate: true,
    });
    expect(decodeClientMessage({
      type: "present-deck",
      deck: { weaponIds: ["WTR001"], equipment: { head: "WTR002" }, deck: ["WTR003"] },
    })).not.toBeNull();
    expect(decodeClientMessage({
      type: "intent",
      intent: {
        kind: "play-card",
        instanceId: 7,
        pitchInstanceIds: [8, 9],
        boost: true,
        asInstant: true,
        targetCardInstanceId: 11,
        alternativeCostCardInstanceIds: [10],
      },
    })).not.toBeNull();
    expect(decodeClientMessage({
      type: "intent",
      intent: { kind: "pass" },
      autoPass: true,
    })).not.toBeNull();
    expect(decodeClientMessage({ type: "runechant-skip", enabled: true })).not.toBeNull();
    expect(decodeClientMessage({ type: "undo", target: "current-turn" })).not.toBeNull();
    expect(decodeClientMessage({ type: "undo", target: "previous-turn" })).not.toBeNull();
  });

  it("accepts Boost only as a presence-only true flag on every play source", () => {
    for (const intent of [
      { kind: "play-card", instanceId: 7, pitchInstanceIds: [8], boost: true },
      { kind: "play-from-arsenal", instanceId: 7, pitchInstanceIds: [], boost: true },
      { kind: "play-from-zone", zone: "banish", instanceId: 7, pitchInstanceIds: [], boost: true },
    ]) {
      expect(decodeClientMessage({ type: "intent", intent })).not.toBeNull();
    }

    for (const boost of [false, "true", 1]) {
      expect(decodeClientMessage({
        type: "intent",
        intent: { kind: "play-card", instanceId: 7, pitchInstanceIds: [], boost },
      })).toBeNull();
    }
  });

  it("accepts the instant play method only as a presence-only true flag", () => {
    const intent = { kind: "play-card", instanceId: 7, pitchInstanceIds: [] };
    expect(decodeClientMessage({ type: "intent", intent: { ...intent, asInstant: true } })).not.toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { ...intent, asInstant: false } })).toBeNull();
  });

  it("validates alternative-cost card instance-id arrays on play intents", () => {
    const intent = { kind: "play-card", instanceId: 7, pitchInstanceIds: [] };
    expect(decodeClientMessage({
      type: "intent",
      intent: { ...intent, alternativeCostCardInstanceIds: [8, 9] },
    })).not.toBeNull();
    expect(decodeClientMessage({
      type: "intent",
      intent: { ...intent, alternativeCostCardInstanceIds: ["8"] },
    })).toBeNull();
  });

  it("validates announced card targets on play intents", () => {
    const intent = { kind: "play-card", instanceId: 7, pitchInstanceIds: [] };
    expect(decodeClientMessage({
      type: "intent",
      intent: { ...intent, targetCardInstanceId: 8 },
    })).not.toBeNull();
    expect(decodeClientMessage({
      type: "intent",
      intent: { ...intent, targetCardInstanceId: "8" },
    })).toBeNull();
  });

  it("rejects unknown fields, types, and protocol variants", () => {
    expect(decodeClientMessage({ type: "list-rooms", admin: true })).toBeNull();
    expect(decodeClientMessage({ type: "join-room", code: "../../.." })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "pass", seat: 0 } })).toBeNull();
    expect(decodeClientMessage({ type: "intent", intent: { kind: "pass" }, autoPass: false })).toBeNull();
    expect(decodeClientMessage({ type: "runechant-skip", enabled: "yes" })).toBeNull();
    expect(decodeClientMessage({ type: "undo", target: "all" })).toBeNull();
    expect(decodeClientMessage({ type: "delete-everything" })).toBeNull();
  });

  it("bounds attacker-controlled strings and arrays", () => {
    expect(decodeClientMessage({ type: "auth", token: "x".repeat(129) })).toBeNull();
    expect(decodeClientMessage({
      type: "intent",
      intent: { kind: "defend", instanceIds: Array.from({ length: 101 }, (_, i) => i) },
    })).toBeNull();
    expect(decodeClientMessage({
      type: "present-deck",
      deck: { weaponIds: [], equipment: {}, deck: Array(101).fill("WTR001") },
    })).toBeNull();
  });
});
