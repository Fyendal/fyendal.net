import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { FullscreenButton } from "./FullscreenButton.js";

afterEach(() => vi.unstubAllGlobals());

function render(placement: "header" | "menu", locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(
    <TestI18nProvider locale={locale}><FullscreenButton placement={placement} /></TestI18nProvider>,
  );
}

describe("full-screen button", () => {
  it("shows the current action in the home header and mobile menu", () => {
    const documentElement = { requestFullscreen: vi.fn() };
    vi.stubGlobal("document", {
      documentElement,
      exitFullscreen: vi.fn(),
      fullscreenElement: null,
    });

    expect(render("header")).toContain('aria-label="Enter full screen"');
    expect(render("header")).toContain('class="topbar-icon-link topbar-fullscreen-button"');
    expect(render("menu", "zh-Hans")).toContain(">进入全屏</button>");

    vi.stubGlobal("document", {
      documentElement,
      exitFullscreen: vi.fn(),
      fullscreenElement: documentElement,
    });
    expect(render("header")).toContain('aria-label="Exit full screen"');
    expect(render("menu")).toContain(">Exit full screen</button>");
  });

  it("hides the control when the browser does not support full screen", () => {
    vi.stubGlobal("document", { documentElement: {}, exitFullscreen: undefined });
    expect(render("header")).toBe("");
  });
});
