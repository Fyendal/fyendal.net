import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { FullscreenNudge } from "./FullscreenNudge.js";

afterEach(() => vi.unstubAllGlobals());

function render() {
  return renderToStaticMarkup(<TestI18nProvider locale="en"><FullscreenNudge /></TestI18nProvider>);
}

function stubBrowser({
  supported = true,
  active = false,
  seen = false,
  userAgent = "Mozilla/5.0 (Linux; Android 14)",
}: { supported?: boolean; active?: boolean; seen?: boolean; userAgent?: string } = {}) {
  const documentElement = supported ? { requestFullscreen: vi.fn() } : {};
  vi.stubGlobal("document", {
    documentElement,
    exitFullscreen: supported ? vi.fn() : undefined,
    fullscreenElement: active ? documentElement : null,
  });
  vi.stubGlobal("navigator", { userAgent });
  vi.stubGlobal("localStorage", { getItem: () => (seen ? "1" : null), setItem: vi.fn() });
}

describe("landscape full-screen well", () => {
  it("offers full screen with a reason until the player answers once", () => {
    stubBrowser();
    expect(render()).toContain("Play full screen");
    expect(render()).toContain("Not now");

    stubBrowser({ seen: true });
    expect(render()).not.toContain("Not now");
    expect(render()).toContain('class="fullscreen-well-pill"');
  });

  it("disappears while full screen is active", () => {
    stubBrowser({ active: true });
    expect(render()).toBe("");
  });

  it("explains the Home Screen route on iPhone and stays hidden elsewhere without support", () => {
    stubBrowser({ supported: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
    expect(render()).toContain("Show me how");

    stubBrowser({ supported: false });
    expect(render()).toBe("");
  });
});
