import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import { EndTurnPassToast } from "./EndTurnPassToast.js";

const MESSAGE = "Opponent passed to end their turn. If you act, they will regain priority.";

const YOURS = "You passed to end your turn. If the opponent acts, you will regain priority.";

function renderToast(placement?: "divider" | "mobile-hand", passer?: "opponent" | "you") {
  return renderToStaticMarkup(createElement(
    IntlProvider,
    { locale: "en", messages: { "game.turn.endPassPending": MESSAGE, "game.turn.endPassPendingYours": YOURS } },
    createElement(EndTurnPassToast, { ...(placement ? { placement } : {}), ...(passer ? { passer } : {}) }),
  ));
}

describe("EndTurnPassToast", () => {
  it("announces the opponent's pending end-turn pass", () => {
    const html = renderToast();

    expect(html).toContain("end-turn-pass-toast");
    expect(html).toContain("end-turn-pass-toast-divider");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(MESSAGE);
  });

  it("moves to the opposing side and names you when your own seat passed in self-play", () => {
    const html = renderToast("divider", "you");

    expect(html).toContain("end-turn-pass-toast-divider end-turn-pass-toast-opposing");
    expect(html).toContain(YOURS);
    expect(renderToast()).not.toContain("end-turn-pass-toast-opposing");
  });

  it("supports positioning above the mobile hand", () => {
    const html = renderToast("mobile-hand");

    expect(html).toContain("end-turn-pass-toast-mobile-hand");
  });
});
