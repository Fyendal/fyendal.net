import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BadgePicker } from "./BadgePicker.js";

describe("BadgePicker", () => {
  it("renders one radio group with exactly one selected badge", () => {
    const html = renderToStaticMarkup(createElement(BadgePicker, {
      availableBadges: ["early-tester"],
      selectedBadge: "early-tester",
      onSelect: vi.fn(),
    }));

    expect(html.match(/name="account-badge"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain("Early Tester");
    expect(html).toContain("Awarded to players who joined Fyendal during early testing.");
    expect(html).toContain('role="tooltip"');
  });
});
