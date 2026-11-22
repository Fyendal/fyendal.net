import { describe, expect, it } from "vitest";
import { isReleaseNotesPath } from "./route.js";

describe("release notes route", () => {
  it("matches only /release-notes", () => {
    expect(isReleaseNotesPath("/release-notes")).toBe(true);
    expect(isReleaseNotesPath("/release-notes/")).toBe(true);
    expect(isReleaseNotesPath("/")).toBe(false);
    expect(isReleaseNotesPath("/release-notes/1.6.0")).toBe(false);
    expect(isReleaseNotesPath("/updates")).toBe(false);
  });
});
