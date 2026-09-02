import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobileHandToggle } from "./MobileHandToggle.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

function renderToggle(props: ComponentProps<typeof MobileHandToggle>, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(
    <TestI18nProvider locale={locale}><MobileHandToggle {...props} /></TestI18nProvider>,
  );
}

describe("mobile hand toggle", () => {
  it("offers to hide an expanded hand", () => {
    const html = renderToggle({
      expanded: true,
      cardCount: 4,
      onToggle: vi.fn(),
    });

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Hide hand"');
    expect(html).toContain('aria-controls="player-hand"');
    expect(html).toContain('src="/icons/hide-transparent.png"');
    expect(html).not.toContain('>Hide hand<');
    expect(html).not.toContain('>4<');
  });

  it("offers to show a collapsed hand with a singular count", () => {
    const html = renderToggle({
      expanded: false,
      cardCount: 1,
      onToggle: vi.fn(),
    });

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show hand, 1 card"');
    expect(html).toContain('>Show hand<');
    expect(html).not.toContain('/icons/hide-transparent.png');
  });

  it("renders the collapsed control in Simplified Chinese", () => {
    const html = renderToggle({ expanded: false, cardCount: 3, onToggle: vi.fn() }, "zh-Hans");

    expect(html).toContain('aria-label="显示手牌，共 3 张"');
    expect(html).toContain(">显示手牌</span>");
  });
});
