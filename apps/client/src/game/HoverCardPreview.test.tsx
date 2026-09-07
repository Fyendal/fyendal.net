import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
