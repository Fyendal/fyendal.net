import { describe, expect, it } from "vitest";
import type { LeagueMatchView, LeagueMembership } from "@fyendal/shared";
import { leagueActionCount, waitsOnYou } from "./pendingActions.js";

const NOW = Date.UTC(2026, 10, 2, 18);
const MINUTE = 60_000;
const match = (overrides: Partial<LeagueMatchView>): LeagueMatchView => ({
  id: "m", stage: "season", week: 1, opponent: { username: "bob", timeZone: "UTC" }, status: "proposed",
  scheduledAt: NOW + 60 * MINUTE, proposedBy: "league", deadlineAt: NOW + 7 * 24 * 60 * MINUTE,
  youReady: false, opponentReady: false, roomCode: null, result: null, won: null, overlap: [], ...overrides,
});

describe("league actions waiting on you", () => {
  it("counts answers, check-ins, and forfeit claims", () => {
    expect(waitsOnYou(match({}), NOW)).toBe(true);
    expect(waitsOnYou(match({ proposedBy: "opponent" }), NOW)).toBe(true);
    expect(waitsOnYou(match({ proposedBy: "you" }), NOW)).toBe(false);
    const scheduled = match({ status: "scheduled", scheduledAt: NOW });
    expect(waitsOnYou(scheduled, NOW - 10 * MINUTE)).toBe(false);
    expect(waitsOnYou(scheduled, NOW - 4 * MINUTE)).toBe(true);
    expect(waitsOnYou({ ...scheduled, youReady: true }, NOW)).toBe(false);
    expect(waitsOnYou({ ...scheduled, youReady: true }, NOW + 16 * MINUTE)).toBe(true);
    expect(waitsOnYou({ ...scheduled, youReady: true, opponentReady: true }, NOW + 16 * MINUTE)).toBe(false);
    expect(waitsOnYou(match({ status: "complete", result: "played", won: true }), NOW)).toBe(false);
  });

  it("sums across leagues", () => {
    const league = (matches: LeagueMatchView[]) => ({ matches }) as unknown as LeagueMembership;
    expect(leagueActionCount([league([match({}), match({ proposedBy: "you" })]), league([match({})])], NOW)).toBe(2);
    expect(leagueActionCount(null, NOW)).toBe(0);
  });
});
