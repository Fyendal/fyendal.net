import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import en from "../i18n/catalogs/en.json";
import { cardBadges } from "./cardBadges.js";
import { createdCardIds, createdCardsFor } from "./createdCards.js";
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

  it("docks the created cards beside the card that makes them as rows of rules text", () => {
    const created = createdCardsFor("IAR017", 296, 1920)!;
    expect(created.beside).toBe(true);
    const html = renderToStaticMarkup(createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(HoverCardPreview, {
        preview: { id: "IAR017", x: 10, y: 20, created: { ids: created.ids, dock: "left" } },
        owner: 0,
      }),
    ));

    expect(html).toContain("created-cards-panel is-left");
    expect(html).toContain("width:272px");
    expect(html).toContain(">Creates</h3>");
    expect(html.indexOf('data-cardid="IAR017"')).toBeLessThan(html.indexOf('data-cardid="IAR221"'));
    expect(html).toContain('<span class="created-card-name">Blasmophet, the Insatiable Hunger</span>');
    expect(html).toContain('<span class="created-card-type">token - shadow demon ally<span class="created-card-stat">');
    expect(html).toContain('src="/icons/attack.png" alt="" draggable="false"/>6</span>');
    expect(html).toContain('src="/icons/life.png" alt="" draggable="false"/>6</span>');
    expect(html).toContain('<p class="created-card-text">');
  });

  it("draws rules-text symbols and token stats as icons", () => {
    const html = renderToStaticMarkup(createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(HoverCardPreview, {
        preview: { id: "AMO013", x: 10, y: 20, created: { ids: createdCardIds("AMO013"), dock: "right" } },
        owner: 0,
      }),
    ));

    expect(html).toContain("unless you pay <img class=\"rules-symbol\"");
    expect(html.match(/class="rules-symbol" src="\/icons\/resource.png"/g)).toHaveLength(3);
    expect(html).toContain('class="rules-symbol" src="/icons/attack.png"');
    expect(html.match(/<p class="created-card-text">/g)).toHaveLength(4);
  });

  it("mounts pending created cards hidden so their art loads during the dwell", () => {
    const html = renderToStaticMarkup(createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(HoverCardPreview, {
        preview: {
          id: "AMO013",
          x: 10,
          y: 20,
          created: { ids: createdCardIds("AMO013"), dock: "right" },
          createdPending: true,
        },
        owner: 0,
      }),
    ));

    expect(html).toContain('class="created-cards-panel is-right is-pending" aria-hidden="true"');
    expect(html).toContain("https://content.fabrary.net/cards/AAZ031.webp");
  });

  it("stacks the created cards under the card when no column fits beside it", () => {
    const created = createdCardsFor("IAR017", 296, 500)!;
    expect(created.beside).toBe(false);
    const html = renderToStaticMarkup(createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(HoverCardPreview, {
        preview: { id: "IAR017", x: 10, y: 20, created: { ids: created.ids, dock: "below" } },
        owner: 0,
      }),
    ));

    expect(html).toContain('class="created-cards-panel is-below"');
    expect(html).not.toContain("width:272px");
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

  it("turns a Meld card sideways so both halves read upright", () => {
    const html = renderToStaticMarkup(createElement(HoverCardPreview, {
      preview: { id: "SEA258", x: 10, y: 20, size: { width: 100, height: 140 } },
      owner: 0,
    }));

    expect(html).toContain("width:140px;height:100px");
    expect(html).toContain('class="card-preview-sideways"');
  });

  it("names each card bound to the hovered ally above the preview", () => {
    const badges = cardBadges(
      { instanceId: 7, cardId: "IAR090", owner: 0, life: 3 },
      { boundCardNames: ["Mark of Ushering"] },
    );
    expect(badges.find((badge) => badge.kind === "bound")?.placement).toBe("preview");
    const html = renderToStaticMarkup(createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(HoverCardPreview, {
        preview: { id: "IAR090", x: 10, y: 20, size: { width: 100, height: 140 }, badges },
        owner: 0,
      }),
    ));

    expect(html.match(/class="card-badge-row"/g)).toHaveLength(2);
    expect(html).toContain('<span class="card-badge-title">Mark of Ushering</span>');
    expect(html).toContain("/icons/bound.png");
  });

  it("names an attacked ally as the attack target above the preview", () => {
    const badges = cardBadges(
      { instanceId: 7, cardId: "SEA075", owner: 0, life: 3 },
      { attackTarget: true },
    );
    expect(badges.find((badge) => badge.kind === "attack-target")?.placement).toBe("preview");
    const html = renderToStaticMarkup(createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(HoverCardPreview, {
        preview: { id: "SEA075", x: 10, y: 20, size: { width: 100, height: 140 }, badges },
        owner: 0,
      }),
    ));

    expect(html).toContain('<span class="card-badge-title">Attack target</span>');
    expect(html).toContain("The current attack targets this card");
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
