import { describe, expect, it } from "vitest";
import type { GameView } from "@fyendal/shared";
import { replayFileViews } from "@fyendal/protocol";
import {
  parseReplayFile,
  PERSIST_EVERY,
  removeUnsupportedLocalReplays,
  ReplayRecorder,
  type EnumerableStorageLike,
} from "../replay/recorder.js";
import { replayStorageKey } from "../storage.js";

function fakeStorage(): EnumerableStorageLike & { data: Map<string, string>; failWrites: boolean } {
  const data = new Map<string, string>();
  const store = {
    data,
    failWrites: false,
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (store.failWrites) throw new Error("quota exceeded");
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  return store;
}

function frame(turn: number, winner: number | null = null): GameView {
  const player = (seat: 0 | 1) => ({
    seat,
    heroCardId: `HERO-${seat}`,
    heroInstanceId: seat + 1,
    heroName: `Hero ${seat}`,
    life: 20,
    actionPoints: seat === 0 ? 1 : 0,
    resources: 0,
    hand: [],
    handCount: 0,
    deckCount: 40,
    arsenal: [],
    arsenalCount: 0,
    pitch: [],
    pitchCount: 0,
    graveyard: [],
    banish: [],
    soul: [],
    equipment: {},
    weapons: [],
    board: [],
  });
  return {
    gameId: "g1",
    turn,
    phase: "action",
    activePlayer: 0,
    priorityPlayer: 0,
    players: [player(0), player(1)],
    chain: [],
    stack: [],
    ongoing: [],
    pendingDecision: null,
    winner,
    log: [`turn ${turn}`],
  } as unknown as GameView;
}

describe("ReplayRecorder", () => {
  it("appends frames and skips consecutive duplicates (reconnect re-sends)", () => {
    const rec = new ReplayRecorder("ABC123", fakeStorage());
    expect(rec.record(frame(1), 0)).toBe(true);
    expect(rec.record(frame(2), 0)).toBe(true);
    // same state pushed again after a reconnect — not recorded twice
    expect(rec.record(frame(2), 0)).toBe(false);
    expect(rec.length).toBe(2);
    expect(rec.recordedSeat).toBe(0);
  });

  it("persists every PERSIST_EVERY frames and on finish, and reloads from storage", () => {
    const storage = fakeStorage();
    const rec = new ReplayRecorder("ABC123", storage);
    for (let i = 1; i <= PERSIST_EVERY; i++) rec.record(frame(i), 1);
    expect(storage.data.size).toBe(1);

    // simulates a page reload mid-game: a new recorder resumes from storage
    const resumed = new ReplayRecorder("ABC123", storage);
    expect(resumed.length).toBe(PERSIST_EVERY);
    expect(resumed.recordedSeat).toBe(1);

    resumed.record(frame(PERSIST_EVERY + 1, 0), 1);
    resumed.finish();
    const reloaded = new ReplayRecorder("ABC123", storage);
    expect(reloaded.length).toBe(PERSIST_EVERY + 1);
    expect(replayFileViews(reloaded.toFile())[PERSIST_EVERY]!.winner).toBe(0);
  });

  it("keeps recording in memory when storage quota fails", () => {
    const storage = fakeStorage();
    storage.failWrites = true;
    const rec = new ReplayRecorder("ABC123", storage);
    for (let i = 1; i <= PERSIST_EVERY + 5; i++) rec.record(frame(i), 0);
    rec.finish();
    expect(rec.length).toBe(PERSIST_EVERY + 5);
    expect(replayFileViews(rec.toFile()).length).toBe(PERSIST_EVERY + 5);
    expect(storage.data.size).toBe(0);
  });

  it("discard removes the persisted entry", () => {
    const storage = fakeStorage();
    const rec = new ReplayRecorder("ABC123", storage);
    for (let i = 1; i <= PERSIST_EVERY; i++) rec.record(frame(i), 0);
    expect(storage.data.size).toBe(1);
    rec.discard();
    expect(storage.data.size).toBe(0);
    expect(rec.length).toBe(0);
  });

  it("removes pre-launch local replay entries without touching current envelopes", () => {
    const storage = fakeStorage();
    storage.setItem(
      replayStorageKey("OLD123"),
      JSON.stringify({ version: 1, seat: 0, views: [frame(1)] }),
    );
    const current = new ReplayRecorder("NEW123", storage);
    current.record(frame(1), 0);
    current.finish();

    expect(removeUnsupportedLocalReplays(storage)).toBe(1);
    expect(storage.getItem(replayStorageKey("OLD123"))).toBeNull();
    expect(new ReplayRecorder("NEW123", storage).length).toBe(1);
  });

  it("checkpoints a short recording and replaces it with authoritative history", () => {
    const storage = fakeStorage();
    const rec = new ReplayRecorder("ABC123", storage);
    rec.record(frame(1), 0);
    rec.record(frame(2), 0);
    rec.checkpoint();
    expect(new ReplayRecorder("ABC123", storage).length).toBe(2);

    rec.replace({ version: 1, seat: 0, views: [frame(1), frame(2), frame(3)] });
    const reloaded = new ReplayRecorder("ABC123", storage);
    expect(reloaded.length).toBe(3);
    expect(replayFileViews(reloaded.toFile())[2]!.turn).toBe(3);
  });
});

describe("parseReplayFile", () => {
  it("rejects invalid JSON and wrong shapes", () => {
    expect(parseReplayFile("not json").ok).toBe(false);
    expect(parseReplayFile("{}").ok).toBe(false);
    expect(parseReplayFile('{"version":2,"views":[{}]}').ok).toBe(false);
    expect(parseReplayFile('{"version":1,"seat":0,"views":[]}'))
      .toEqual({ ok: false, error: "not a valid replay file" });
  });

  it("round-trips a recorder file", () => {
    const rec = new ReplayRecorder("ABC123", fakeStorage());
    rec.record(frame(1), 0);
    rec.record(frame(2, 1), 0);
    const r = parseReplayFile(JSON.stringify(rec.toFile()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.seat).toBe(0);
      expect(replayFileViews(r.file).length).toBe(2);
      expect(replayFileViews(r.file)[1]!.winner).toBe(1);
    }
  });
});
