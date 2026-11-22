import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerNameplate } from "./PlayerNameplate.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("PlayerNameplate", () => {
  it("puts the early-tester logo before the username", () => {
    const html = renderToStaticMarkup(createElement(
      TestI18nProvider,
      null,
      createElement(PlayerNameplate, {
        placement: "opponent",
        profile: { username: "ArakniFan", badge: "early-tester" },
      }),
    ));

    expect(html).toContain('class="player-nameplate player-nameplate-opponent"');
    expect(html.indexOf('src="/logo.png"')).toBeLessThan(html.indexOf("ArakniFan"));
    expect(html).toContain('alt="Early Tester badge"');
    expect(html).toContain("Awarded to players who joined Fyendal during early testing.");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("aria-describedby=");
  });

  it("shows an ordinary username without a badge", () => {
    const html = renderToStaticMarkup(createElement(PlayerNameplate, {
      placement: "self",
      profile: { username: "LatePlayer", badge: null },
    }));

    expect(html).toContain("LatePlayer");
    expect(html).not.toContain("/logo.png");
  });

  it("shows the hero in place of the shared username in solo", () => {
    const html = renderToStaticMarkup(createElement(PlayerNameplate, {
      placement: "opponent",
      profile: { username: "alice", badge: "early-tester" },
      name: "Kayo",
    }));

    expect(html).toContain(">Kayo</span>");
    expect(html).not.toContain("alice");
    expect(html).not.toContain("/logo.png");
  });
});
