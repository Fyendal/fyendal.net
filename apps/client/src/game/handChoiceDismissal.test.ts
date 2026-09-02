import { describe, expect, it } from "vitest";
import { handChoiceDismissal } from "./handChoiceDismissal.js";

describe("hand choice dismissal", () => {
  it("resets a local pitch or mode announcement on an outside click", () => {
    expect(handChoiceDismissal(true, false, false)).toBe("reset-local");
  });

  it("undoes a committed pre-stack play on an outside click", () => {
    expect(handChoiceDismissal(false, true, false)).toBe("undo-pre-stack");
  });

  it("keeps the choice open while interacting with its hand or decision UI", () => {
    expect(handChoiceDismissal(true, false, true)).toBeNull();
    expect(handChoiceDismissal(false, true, true)).toBeNull();
  });
});
