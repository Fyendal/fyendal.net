import { describe, expect, it } from "vitest";
import { savedReplayIdFromPath, savedReplayPath } from "./route.js";

describe("saved replay routes", () => {
  it("round-trips server replay ids", () => {
    const id = "0123456789abcdef01234567";
    expect(savedReplayPath(id)).toBe(`/replays/${id}`);
    expect(savedReplayIdFromPath(`/replays/${id}`)).toBe(id);
    expect(savedReplayIdFromPath(`/replays/${id}/`)).toBe(id);
  });

  it("does not route imported files or malformed replay ids", () => {
    expect(savedReplayIdFromPath("/")).toBeNull();
    expect(savedReplayIdFromPath("/replays/local-file")).toBeNull();
    expect(savedReplayIdFromPath("/replays/0123456789ABCDEF01234567")).toBeNull();
  });
});
