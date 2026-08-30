import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobileHandToggle } from "./MobileHandToggle.js";

describe("mobile hand toggle", () => {
  it("offers to hide an expanded hand", () => {
    const html = renderToStaticMarkup(createElement(MobileHandToggle, {
      expanded: true,
      cardCount: 4,
      onToggle: vi.fn(),
    }));

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Hide hand"');
    expect(html).toContain('aria-controls="player-hand"');
    expect(html).toContain('src="/icons/hide-transparent.png"');
    expect(html).not.toContain('>Hide hand<');
    expect(html).not.toContain('>4<');
  });

  it("offers to show a collapsed hand with a singular count", () => {
    const html = renderToStaticMarkup(createElement(MobileHandToggle, {
      expanded: false,
      cardCount: 1,
      onToggle: vi.fn(),
    }));

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show hand, 1 card"');
    expect(html).toContain('>Show hand<');
    expect(html).not.toContain('/icons/hide-transparent.png');
  });
});
