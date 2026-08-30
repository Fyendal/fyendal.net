import { describe, expect, it } from "vitest";
import { motionPreferenceReducesMotion } from "./useMotionPreference.js";

describe("motion preference", () => {
  it("follows the system only for the default preference", () => {
    expect(motionPreferenceReducesMotion("system", true)).toBe(true);
    expect(motionPreferenceReducesMotion("system", false)).toBe(false);
    expect(motionPreferenceReducesMotion("full", true)).toBe(false);
    expect(motionPreferenceReducesMotion("reduced", false)).toBe(true);
  });
});
