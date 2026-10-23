import { describe, expect, it } from "vitest";
import {
  decodeLeagueAction,
  decodeLeagueAvailability,
  decodeLeagueAvailabilityRequest,
  decodeLeagueIdRequest,
  decodeLeagueMatchRequest,
  decodeLeagueProposeRequest,
  decodeClientMessage,
  decodeLeaguesResponse,
  decodeLeagueJoinPreviewResponse,
  decodeLeagueJoinRequest,
  decodeLeaguePairingNote,
  decodeLeagueTimeZone,
} from "../index.js";

const window = { weekday: 6, start: 18 * 60, end: 22 * 60 };

describe("league decoding", () => {
  it("accepts IANA time zones only", () => {
    expect(decodeLeagueTimeZone("America/New_York")).toBe("America/New_York");
    expect(decodeLeagueTimeZone("UTC")).toBe("UTC");
    expect(decodeLeagueTimeZone("Asia/Kathmandu")).toBe("Asia/Kathmandu");
    for (const invalid of ["Mars/Olympus", "", "a".repeat(65), "Europe/../etc", 5, null]) {
      expect(decodeLeagueTimeZone(invalid)).toBeNull();
    }
  });

  it("accepts slot-aligned windows and copies them without extra keys", () => {
    expect(decodeLeagueAvailability([window, { weekday: 0, start: 0, end: 1440 }]))
      .toEqual([window, { weekday: 0, start: 0, end: 1440 }]);
    expect(decodeLeagueAvailability([])).toEqual([]);
  });

  it.each([
    { ...window, weekday: 7 }, { ...window, start: 15 }, { ...window, end: 1470 },
    { ...window, end: window.start }, { ...window, start: -30 }, { ...window, extra: 1 },
    { weekday: 1, start: 0 },
  ])("rejects invalid windows: %j", (invalid) => {
    expect(decodeLeagueAvailability([invalid])).toBeNull();
  });

  it("bounds the window count", () => {
    expect(decodeLeagueAvailability(Array.from({ length: 337 }, () => window))).toBeNull();
  });

  it("decodes join, availability, and league id requests", () => {
    const token = "A".repeat(43);
    const join = { token, timeZone: "Europe/London", availability: [window] };
    expect(decodeLeagueJoinRequest(join)).toEqual(join);
    expect(decodeLeagueJoinRequest({ ...join, token: "short" })).toBeNull();
    expect(decodeLeagueJoinRequest({ ...join, week: 2 })).toBeNull();
    const update = { leagueId: "a".repeat(24), timeZone: "Europe/London", availability: [window] };
    expect(decodeLeagueAvailabilityRequest(update)).toEqual(update);
    expect(decodeLeagueAvailabilityRequest({ ...update, week: 2 })).toEqual({ ...update, week: 2 });
    expect(decodeLeagueAvailabilityRequest({ ...update, week: 0 })).toBeNull();
    expect(decodeLeagueAvailabilityRequest({ ...update, leagueId: "ZZ" })).toBeNull();
    expect(decodeLeagueAvailabilityRequest({ ...update, timeZone: "Nowhere/Land" })).toBeNull();
    expect(decodeLeagueIdRequest({ leagueId: update.leagueId })).toEqual({ leagueId: update.leagueId });
    expect(decodeLeagueIdRequest({ leagueId: update.leagueId, extra: 1 })).toBeNull();
  });

  it("decodes memberships", () => {
    const league = {
      id: "b".repeat(24), name: "Friday league", format: "cc", status: "signup", startsAt: null,
      seasonWeeks: 4, matchesPerWeek: 2, matchMinutes: 60, maxPlayers: 8, signupOpen: true,
      roster: [{ username: "alice", you: true }, { username: null, you: false }],
      timeZone: "UTC", availability: [window], matches: [],
    };
    expect(decodeLeaguesResponse({ ok: true, leagues: [league] })).toEqual({ ok: true, leagues: [league] });
    const match = {
      id: "c".repeat(24), stage: "season", week: 1, opponent: { username: "bob", timeZone: "Asia/Tokyo" },
      status: "proposed", scheduledAt: 1_800_000_000_000, proposedBy: "league", deadlineAt: 1_800_600_000_000,
      youReady: false, opponentReady: false, roomCode: null, result: null, won: null,
      overlap: [{ start: 1_800_000_000_000, end: 1_800_007_200_000 }],
    };
    expect(decodeLeaguesResponse({ ok: true, leagues: [{ ...league, matches: [match] }] })).not.toBeNull();
    expect(decodeLeaguesResponse({ ok: true, leagues: [{ ...league, matches: [{ ...match, opponent: null, roomCode: "ABC123" }] }] })).not.toBeNull();
    for (const invalid of [
      { ...match, proposedBy: "someone" }, { ...match, roomCode: "abc" },
      { ...match, overlap: [{ start: 5, end: 5 }] }, { ...match, extra: 1 },
    ]) expect(decodeLeaguesResponse({ ok: true, leagues: [{ ...league, matches: [invalid] }] })).toBeNull();
    expect(decodeLeaguesResponse({ ok: true, leagues: [{ ...league, roster: [{ username: "a b", you: true }] }] })).toBeNull();
    expect(decodeLeaguesResponse({ ok: true, leagues: [{ ...league, timeZone: "Mars/Base" }] })).toBeNull();
  });

  it("decodes match requests and the league room message", () => {
    const matchId = "d".repeat(24);
    expect(decodeLeagueMatchRequest({ matchId })).toEqual({ matchId });
    expect(decodeLeagueMatchRequest({ matchId: "x" })).toBeNull();
    expect(decodeLeagueProposeRequest({ matchId, at: 1_800_000_000_000 })).toEqual({ matchId, at: 1_800_000_000_000 });
    expect(decodeLeagueProposeRequest({ matchId, at: -1 })).toBeNull();
    expect(decodeClientMessage({ type: "create-league-room", matchId, deckId: "deck" }))
      .toEqual({ type: "create-league-room", matchId, deckId: "deck" });
    expect(decodeClientMessage({ type: "create-league-room", matchId, deckId: "deck", format: "cc" })).toBeNull();
  });

  it("decodes pairing notes", () => {
    const note = { overlapMinutes: 240, scoreGap: 1.5, rematches: 0, cost: 2.75 };
    expect(decodeLeaguePairingNote(note)).toEqual(note);
    expect(decodeLeaguePairingNote({ ...note, scoreGap: 4 })).toBeNull();
    expect(decodeLeaguePairingNote({ ...note, cost: Number.NaN })).toBeNull();
    expect(decodeLeaguePairingNote({ ...note, extra: true })).toBeNull();
  });

  it("decodes every operator action exhaustively", () => {
    const actions = [
      { kind: "close-signup" }, { kind: "start" }, { kind: "cancel" },
      { kind: "drop", memberId: 3 },
      { kind: "set-result", matchId: "m1", outcome: "double-forfeit" },
      { kind: "extend-deadline", matchId: "m1", deadlineAt: 1_800_000_000_000 },
    ];
    for (const action of actions) expect(decodeLeagueAction(action)).toEqual(action);
    for (const invalid of [
      { kind: "start", extra: 1 }, { kind: "drop", memberId: 0 },
      { kind: "set-result", matchId: "m1", outcome: "c" }, { kind: "extend-deadline", matchId: "m1" },
      { kind: "pair-now" }, null, [],
    ]) expect(decodeLeagueAction(invalid)).toBeNull();
  });

  it("decodes the join preview", () => {
    const league = {
      name: "Friday league", format: "cc", status: "signup", startsAt: null,
      members: 3, maxPlayers: 8, matchesPerWeek: 2, seasonWeeks: 4, joined: false,
    };
    expect(decodeLeagueJoinPreviewResponse({ ok: true, league })).toEqual({ ok: true, league });
    expect(decodeLeagueJoinPreviewResponse({ ok: true, league: { ...league, members: 9 } })).toBeNull();
    expect(decodeLeagueJoinPreviewResponse({ ok: true, league: { ...league, status: "paused" } })).toBeNull();
    expect(decodeLeagueJoinPreviewResponse({ ok: true, league, extra: 1 })).toBeNull();
  });
});
