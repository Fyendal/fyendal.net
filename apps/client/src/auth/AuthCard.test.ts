import { describe, expect, it } from "vitest";
import { validateAuthInput } from "./validation.js";

describe("registration username validation", () => {
  it("accepts only 3–20 letters, numbers, or underscores", () => {
    expect(validateAuthInput("Player_1", "password1", "register")).toBeNull();
    expect(validateAuthInput("ab", "password1", "register")).toContain("3–20");
    expect(validateAuthInput("a".repeat(21), "password1", "register")).toContain("3–20");
    expect(validateAuthInput("has space", "password1", "register")).toContain("letters");
    expect(validateAuthInput("dash-name", "password1", "register")).toContain("letters");
    expect(validateAuthInput("pläyer", "password1", "register")).toContain("letters");
  });
});
