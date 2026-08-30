import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EndTurnPassToast } from "./EndTurnPassToast.js";

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
