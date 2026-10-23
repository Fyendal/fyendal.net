import { describe, expect, it } from "vitest";
import { leagueJoinTokenFromPath } from "./route.js";

describe("league join route", () => {
  it("accepts only well-formed sign-up tokens", () => {
    const token = "Ab_-".repeat(10) + "xyz";
    expect(leagueJoinTokenFromPath(`/league/join/${token}`)).toBe(token);
    expect(leagueJoinTokenFromPath(`/league/join/${token}/`)).toBe(token);
    expect(leagueJoinTokenFromPath("/league/join/short")).toBeNull();
    expect(leagueJoinTokenFromPath(`/league/${token}`)).toBeNull();
  });
});
