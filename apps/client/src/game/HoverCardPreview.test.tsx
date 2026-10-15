import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import en from "../i18n/catalogs/en.json";
import { cardBadges } from "./cardBadges.js";
import { HoverCardPreview } from "./HoverCardPreview.js";

describe("HoverCardPreview", () => {
  it("shows both physical faces when hovering either side of Nitro Mechanoid", () => {
    for (const cardId of ["DYN092", "DYN092B"]) {
      const html = renderToStaticMarkup(createElement(HoverCardPreview, {
        preview: { id: cardId, x: 10, y: 20, size: { width: 100, height: 140 } },
        owner: 0,
      }));

      expect(html).toContain("card-preview card-preview-double-sided");
      expect(html.indexOf('data-cardid="DYN092"')).toBeLessThan(
        html.indexOf('data-cardid="DYN092B"'),
      );
      expect(html.match(/class="card-preview-face"/g)).toHaveLength(2);
      expect(html).toContain("width:212px;height:140px");
    }
  });

  it("keeps an ordinary card as a single-face preview", () => {
    const html = renderToStaticMarkup(createElement(HoverCardPreview, {
      preview: { id: "WTR160", x: 10, y: 20, size: { width: 100, height: 140 } },
      owner: 0,
    }));

    expect(html).toContain('class="card-preview"');
    expect(html).not.toContain("card-preview-double-sided");
    expect(html.match(/class="card-preview-face"/g)).toHaveLength(1);
    expect(html).toContain("width:100px;height:140px");
  });

  it("spells out the hovered card's counters and statuses above the preview", () => {
    const badges = cardBadges(
      { instanceId: 7, cardId: "ARC069", owner: 0, counters: { aim: 1, rust: 2, harpoonX: 3 } },
      { veil: true, showFaceUp: true },
    );
    const html = renderToStaticMarkup(createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(HoverCardPreview, {
        preview: { id: "ARC069", x: 10, y: 20, size: { width: 100, height: 140 }, badges },
        owner: 0,
      }),
    ));

    expect(html).toContain('class="card-badge-panel"');
    expect(html).toContain('aria-label="Counters and statuses"');
    expect(html.match(/class="card-badge-row"/g)).toHaveLength(4);
    expect(html).toContain("Veil");
    expect(html).toContain("defended by more than 1 card of each color");
    expect(html).toContain("Face up");
    expect(html).toContain("1 aim counter");
    expect(html).toContain("/icons/aim.png");
    expect(html).toContain("2 rust counters");
    expect(html).not.toContain("harpoonX");
  });

  it("omits the panel when the hovered card has no counters or statuses", () => {
    const html = renderToStaticMarkup(createElement(HoverCardPreview, {
      preview: { id: "WTR160", x: 10, y: 20, size: { width: 100, height: 140 }, badges: [] },
      owner: 0,
    }));

    expect(html).not.toContain("card-badge-panel");
  });
});
