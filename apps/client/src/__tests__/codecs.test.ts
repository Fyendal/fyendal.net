import { describe, expect, it } from "vitest";
import { decodeServerMessage } from "@fyendal/protocol";

const player = (seat: 0 | 1) => ({
  seat,
  heroCardId: `HERO${seat}`,
  heroInstanceId: seat,
  heroName: `Hero ${seat}`,
  life: 20,
  actionPoints: 1,
  resources: 0,
  handCount: 0,
  deckCount: 40,
  arsenalCount: 0,
  pitchCount: 0,
  hand: [],
  arsenal: [],
  pitch: [],
  graveyard: [],
  banish: [],
  soul: [],
  weapons: [],
  board: [],
  equipment: {},
});

const view = {
  gameId: "game",
  turn: 1,
  phase: "action",
  activePlayer: 0,
  priorityPlayer: 0,
  players: [player(0), player(1)],
  chain: [],
  stack: [],
  ongoing: [],
  pendingDecision: null,
  winner: null,
  log: [],
};

describe("server-message runtime codec", () => {
  it("rejects malformed messages before they reach client state", () => {
    expect(decodeServerMessage({ type: "state", version: 1, view: null })).toBeNull();
    expect(decodeServerMessage({ type: "room-created", code: 7, seat: 0, token: "x", version: 1 })).toBeNull();
    expect(decodeServerMessage({ type: "rooms", rooms: [{ code: "ABC123" }] })).toBeNull();
    expect(decodeServerMessage({ type: "unknown", payload: {} })).toBeNull();
  });

  it("accepts bounded non-game protocol messages", () => {
    expect(decodeServerMessage({ type: "authed", username: "alice" })).toEqual({
      type: "authed",
      username: "alice",
    });
    expect(decodeServerMessage({
      type: "queue-status",
      counts: { "classic-battles": 1, cc: 0, "silver-age": 2 },
    })).not.toBeNull();
    expect(decodeServerMessage({
      type: "error",
      code: "ROOM_NOT_FOUND",
      message: "This room no longer exists",
    })).not.toBeNull();
    expect(decodeServerMessage({ type: "error", message: "room not found" })).toBeNull();
  });

  it("accepts the literal started flag on lobby room summaries", () => {
    const rooms = (started: unknown) => ({
      type: "rooms",
      rooms: [{
        code: "ABC123",
        format: "classic-battles",
        heroes: ["Rhinar", "Dorinthea"],
        createdAt: 1,
        spectateOnly: true,
        started,
      }],
    });

    expect(decodeServerMessage(rooms(true))).not.toBeNull();
    expect(decodeServerMessage(rooms(false))).toBeNull();
  });

  it("accepts literal-true Boost intents and rejects ambiguous Boost values", () => {
    const state = (boost: unknown) => ({
      type: "state",
      version: 1,
      view,
      playerProfiles: [
        { username: "Alice", badge: "early-tester" },
        { username: "Bob", badge: null },
      ],
      yourSeat: 0,
      legal: [{ kind: "play-card", instanceId: 7, pitchInstanceIds: [], boost }],
      lastActionAt: [0, 0],
    });

    expect(decodeServerMessage(state(true))).not.toBeNull();
    expect(decodeServerMessage(state(false))).toBeNull();
    expect(decodeServerMessage(state("true"))).toBeNull();
  });

  it("accepts projected target-aware, alternative-cost play intents", () => {
    const state = {
      type: "state",
      version: 1,
      view,
      playerProfiles: [
        { username: "Alice", badge: "early-tester" },
        { username: "Bob", badge: null },
      ],
      yourSeat: 0,
      legal: [{
        kind: "play-card",
        instanceId: 7,
        pitchInstanceIds: [],
        targetCardInstanceId: 10,
        alternativeCostCardInstanceIds: [8, 9],
      }],
      lastActionAt: [0, 0],
    };

    expect(decodeServerMessage(state)).not.toBeNull();
  });
});
