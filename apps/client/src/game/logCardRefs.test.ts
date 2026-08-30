import { describe, expect, it } from "vitest";
import { logTextSegments, parseTurnBoundaryLogLine } from "./logCardRefs.js";

describe("game-log card references", () => {
  it("recognizes every complete card name in a log line", () => {
    const segments = logTextSegments("Dash plays Zero to Sixty");
    expect(segments.map((segment) => segment.text).join("")).toBe("Dash plays Zero to Sixty");
    expect(segments.filter((segment) => segment.cardId).map((segment) => segment.text)).toEqual([
      "Dash",
      "Zero to Sixty",
    ]);
  });

  it("recognizes punctuation in a card name without consuming log punctuation", () => {
    const segments = logTextSegments("Re-Charge!: your next boosted attack gets +4{p}");
    expect(segments[0]?.text).toBe("Re-Charge!");
    expect(segments[0]?.cardId).toBeTruthy();
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Re-Charge!: your next boosted attack gets +4{p}",
    );
  });

  it("classifies token card references from card data", () => {
    const token = logTextSegments("Dash creates a Quicken").find(
      (segment) => segment.text === "Quicken",
    );

    expect(token?.cardId).toBeTruthy();
    expect(token?.isToken).toBe(true);
  });

  it("recognizes engine turn-boundary entries without matching ordinary turn text", () => {
    expect(parseTurnBoundaryLogLine("— Turn 3: Dash's turn —")).toEqual({
      turn: 3,
      heroName: "Dash",
    });
    expect(parseTurnBoundaryLogLine("Dash's next attack this turn gets +2{p}")).toBeNull();
  });

  it("leaves ordinary log text untouched", () => {
    expect(logTextSegments("The combat chain closes")).toEqual([
      { text: "The combat chain closes" },
    ]);
  });

  it("uses the exact tagged printing for the hover preview", () => {
    const segments = logTextSegments("You look at Wrecker Romp⟦WTR031⟧");
    expect(segments.map((segment) => segment.text).join("")).toBe("You look at Wrecker Romp");
    // the blue printing, not the representative red WTR029
    expect(segments.find((segment) => segment.cardId)).toMatchObject({
      text: "Wrecker Romp",
      cardId: "WTR031",
    });
  });

  it("uses exact-printing metadata stored after the readable log sentence", () => {
    const segments = logTextSegments("Wrecker Romp resolves⟦WTR031⟧");

    expect(segments.map((segment) => segment.text).join("")).toBe("Wrecker Romp resolves");
    expect(segments.find((segment) => segment.cardId)).toMatchObject({
      text: "Wrecker Romp",
      cardId: "WTR031",
    });
  });

  it("ignores printing tags that do not resolve to a card", () => {
    const segments = logTextSegments("You look at Wrecker Romp⟦NOPE999⟧");
    expect(segments.map((segment) => segment.text).join(""))
      .toBe("You look at Wrecker Romp⟦NOPE999⟧");
    // falls back to the representative printing
    const ref = segments.find((segment) => segment.cardId);
    expect(ref?.cardId).toBeTruthy();
    expect(ref?.cardId).not.toBe("NOPE999");
  });
});
