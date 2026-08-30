import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EndTurnPassToast,
  OpponentTurnSummaryToast,
  previousOpponentTurnSummary,
} from "./EndTurnPassToast.js";

describe("EndTurnPassToast", () => {
  it("announces the opponent's pending end-turn pass", () => {
    const html = renderToStaticMarkup(createElement(EndTurnPassToast));

    expect(html).toContain("end-turn-pass-toast");
    expect(html).toContain("end-turn-pass-toast-divider");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Opponent is trying to end their turn");
  });

  it("supports positioning above the mobile hand", () => {
    const html = renderToStaticMarkup(createElement(EndTurnPassToast, {
      placement: "mobile-hand",
    }));

    expect(html).toContain("end-turn-pass-toast-mobile-hand");
  });
});

describe("opponent turn summary", () => {
  it("makes a skipped opening-turn arsenal action explicit", () => {
    expect(previousOpponentTurnSummary([
      "— Turn 1: Bravo, Flattering Showman's turn —",
      "Bravo, Flattering Showman puts a card face down into arsenal",
      "Bravo, Flattering Showman draws 1 card(s)",
      "— Turn 2: Briar's turn —",
    ], "Bravo, Flattering Showman")).toBe(
      "Opponent ended the turn and put a card face down into arsenal.",
    );
  });

  it("distinguishes a successful face-up Heave", () => {
    expect(previousOpponentTurnSummary([
      "— Turn 1: Bravo, Flattering Showman's turn —",
      "Thunder Quake⟦SBR030⟧ is put face up into Bravo, Flattering Showman's arsenal",
      "— Turn 2: Briar's turn —",
    ], "Bravo, Flattering Showman")).toBe(
      "Opponent put Thunder Quake face up into arsenal.",
    );
  });

  it("renders the summary as a non-interactive status toast", () => {
    const html = renderToStaticMarkup(createElement(OpponentTurnSummaryToast, {
      message: "Opponent ended the turn.",
    }));
    expect(html).toContain("turn-summary-toast");
    expect(html).toContain("Opponent ended the turn.");
  });
});
