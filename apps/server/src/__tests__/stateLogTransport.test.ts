import { describe, expect, it } from "vitest";
import { decodeServerMessage, decodeStateFrame, LiveServerMessageDecoder, StateStreamError } from "@fyendal/protocol";
import type { StateMessage } from "@fyendal/shared";
import { StateLogTransport } from "../stateLogTransport.js";

function state(start: number, count: number, version = 1): StateMessage {
  const log = Array.from({ length: count }, (_, i) => `event ${start + i}`);
  const player = (seat: number) => ({ seat, heroCardId: "HERO", heroInstanceId: seat,
    heroName: "Hero", life: 20, actionPoints: 1, resources: 0, handCount: 0, deckCount: 40,
    arsenalCount: 0, pitchCount: 0, hand: [], arsenal: [], pitch: [], graveyard: [],
    banish: [], soul: [], weapons: [], board: [], equipment: {} });
  const value = decodeServerMessage({ type: "state", version, yourSeat: 0,
    playerProfiles: [{ username: "Alice", badge: null }, { username: "Bob", badge: null }],
    legal: [], lastActionAt: [0, 0],
    view: { gameId: "room", turn: 1, phase: "action", activePlayer: 0, priorityPlayer: 0,
      players: [player(0), player(1)], chain: [], stack: [], ongoing: [], pendingDecision: null,
      winner: null, log, logEntries: log.map((fallback, i) => ({ fallback, sequence: start + i,
        message: { id: "server.log.undo.last.action" }, event: { kind: "roll", result: 3 } })) },
  });
  if (value?.type !== "state") throw new Error("invalid fixture");
  return value;
}

// This exercises the actual encoder and decoder together, including validation
// at the wire boundary; nothing is persisted or shared across socket instances.
describe("incremental log transport", () => {
  it("reconstructs appends, duplicate versions, unchanged logs, and the 200-entry rollover", () => {
    const encoder = new StateLogTransport();
    const decoder = new LiveServerMessageDecoder();
    const initial = state(1, 199);
    expect(decoder.decode(encoder.encode(initial))).toEqual(initial);
    for (const next of [state(1, 200), state(2, 200, 3), state(2, 200, 3), state(7, 200, 9)]) {
      const frame = encoder.encode(next);
      expect(frame.drop).not.toBeNull();
      expect(frame.state.view.log.length).toBeLessThanOrEqual(5);
      expect(decoder.decode(JSON.parse(JSON.stringify(frame)))).toEqual(next);
    }
  });

  it("snapshots undo, replacement, game/seat changes, and explicit resets", () => {
    const encoder = new StateLogTransport();
    const decoder = new LiveServerMessageDecoder();
    decoder.decode(encoder.encode(state(1, 20)));
    const cases = [state(1, 10, 2), state(30, 10, 3), { ...state(30, 10, 4), yourSeat: null },
      { ...state(30, 10, 5), view: { ...state(30, 10).view, gameId: "new-room" } }];
    for (const next of cases) {
      const frame = encoder.encode(next);
      expect(frame.drop).toBeNull();
      expect(decoder.decode(frame)).toEqual(next);
    }
    encoder.reset();
    const full = encoder.encode(state(1, 20));
    expect(full).toMatchObject({ drop: null, sequence: 1 });
    expect(new LiveServerMessageDecoder().decode(full)).toEqual(state(1, 20));
  });

  it("snapshots an undo replacement even if its log still overlaps", () => {
    const encoder = new StateLogTransport();
    encoder.encode(state(1, 20));
    const replacement = { ...state(1, 21, 2), transition: {
      kind: "replace" as const, fromVersion: 1, restoreVersion: 0, events: [],
    } };
    const frame = encoder.encode(replacement);
    expect(frame.drop).toBeNull();
    expect(new LiveServerMessageDecoder().decode(frame)).toEqual(replacement);
  });

  it("compares semantic metadata even when fallback text matches", () => {
    const encoder = new StateLogTransport();
    const original = state(1, 20);
    encoder.encode(original);
    const changed = structuredClone(original);
    changed.view.logEntries![0] = { fallback: changed.view.log[0]!, sequence: 1,
      message: { id: "server.log.undo.turn" } };
    expect(encoder.encode(changed).drop).toBeNull();
  });

  it("keeps participant, spectator, and late-joining socket histories independent", () => {
    const human = new StateLogTransport();
    const spectator = new StateLogTransport();
    const privateState = state(1, 20);
    const publicState = { ...state(11, 10), yourSeat: null };
    human.encode(privateState);
    const publicFrame = spectator.encode(publicState);
    expect(publicFrame.drop).toBeNull();
    expect(JSON.stringify(publicFrame)).not.toContain('"event 1"');
    expect(new LiveServerMessageDecoder().decode(publicFrame)).toEqual(publicState);
    expect(new StateLogTransport().encode(privateState).drop).toBeNull();
    expect(human.encode(state(1, 21)).state.view.log).toEqual(["event 21"]);
  });

  it.each(["gap", "duplicate", "stream", "seat", "game", "overflow", "sequence", "drop"])(
    "rejects %s without applying a partial state", (kind) => {
      const encoder = new StateLogTransport();
      const decoder = new LiveServerMessageDecoder();
      decoder.decode(encoder.encode(state(1, 200)));
      const frame = encoder.encode(state(2, 200, 2));
      if (kind === "gap") frame.sequence++;
      if (kind === "duplicate") frame.sequence--;
      if (kind === "stream") frame.stream = "other";
      if (kind === "seat") frame.state.yourSeat = 1;
      if (kind === "game") frame.state.view.gameId = "other";
      if (kind === "overflow") frame.drop = 0;
      if (kind === "sequence") frame.state.view.logEntries = [{
        fallback: "event 201", sequence: 1, message: { id: "server.log.undo.turn" },
      }];
      if (kind === "drop") frame.drop = 201;
      expect(() => decoder.decode(frame)).toThrow(StateStreamError);
      expect(() => decoder.decode(encoder.encode(state(3, 200, 3)))).toThrow(StateStreamError);
      encoder.reset();
      expect(decoder.decode(encoder.encode(state(3, 200, 3)))).toEqual(state(3, 200, 3));
    },
  );

  it("validates exact frame keys and bounds", () => {
    const frame = new StateLogTransport().encode(state(1, 20));
    for (const invalid of [{ ...frame, extra: true }, { ...frame, sequence: 0 },
      { ...frame, sequence: Number.MAX_SAFE_INTEGER + 1 }, { ...frame, drop: -1 },
      { ...frame, drop: 0.5 }, { ...frame, stream: "" }, { ...frame, stream: "a".repeat(65) }]) {
      expect(decodeStateFrame(invalid)).toBeNull();
    }
  });

  it("ignores unsupported messages without disturbing the state stream", () => {
    const encoder = new StateLogTransport();
    const decoder = new LiveServerMessageDecoder();
    decoder.decode(encoder.encode(state(1, 20)));
    expect(decoder.decode({ type: "unsupported", payload: {} })).toBeNull();
    expect(decoder.decode(encoder.encode(state(1, 21)))).toEqual(state(1, 21));
  });

  it("resets on auth/room acknowledgements and isolates its baseline from consumers", () => {
    const encoder = new StateLogTransport();
    const decoder = new LiveServerMessageDecoder();
    const full = decoder.decode(encoder.encode(state(1, 20)));
    if (full?.type !== "state") throw new Error("missing full state");
    full.view.log[0] = "mutated";
    full.view.logEntries![0] = { fallback: "mutated" };
    expect(decoder.decode(encoder.encode(state(1, 21)))).toEqual(state(1, 21));
    decoder.decode({ type: "authed", username: "Bob" });
    expect(() => decoder.decode(encoder.encode(state(1, 22)))).toThrow(StateStreamError);
  });
});
