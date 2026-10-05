import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreState } from "../store/types.js";

const appState = vi.hoisted((): Partial<StoreState> => ({
  screen: "room-loading", clientUpdateRequired: true, authUser: "Alice", authToken: "session",
  roomCode: "ABC123", pendingFabraryPlay: null,
}));
vi.mock("../store.js", () => ({
  useStore: (selector: (state: Partial<StoreState>) => unknown) => selector(appState),
  roomCodeFromUrl: () => "ABC123",
  hasSavedRoomSession: () => true,
  hasSavedSpectatorSession: () => false,
}));
vi.mock("../lobby/Lobby.js", () => ({ Lobby: () => null }));
vi.mock("../matchmaking/BackgroundMatchOffer.js", () => ({ BackgroundMatchOffer: () => null }));

import { App } from "../App.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("client update recovery", () => {
  beforeEach(() => vi.stubGlobal("location", { pathname: "/ABC123" }));
  afterEach(() => vi.unstubAllGlobals());

  it.each<StoreState["screen"]>(["lobby", "room-loading", "waiting", "prep", "game", "replay"])(
    "keeps the refresh action visible on the %s screen", (screen) => {
      appState.screen = screen;
      const html = renderToStaticMarkup(<TestI18nProvider><App /></TestI18nProvider>);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Refresh this page to reconnect with the latest version.");
      expect(html).toContain('type="button">Refresh page</button>');
    },
  );

  it("localizes the refresh instruction and button", () => {
    appState.screen = "room-loading";
    const html = renderToStaticMarkup(<TestI18nProvider locale="zh-Hans"><App /></TestI18nProvider>);
    expect(html).toContain("请刷新页面，使用最新版本重新连接。");
    expect(html).toContain('type="button">刷新页面</button>');
  });
});
