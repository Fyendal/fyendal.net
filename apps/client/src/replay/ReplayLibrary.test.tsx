import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const replayStore = vi.hoisted(() => {
  const state = {
    savedReplays: [{
      id: "replay-1",
      format: "cc" as const,
      heroIds: ["HERO0", "HERO1"] as [string, string],
      yourSeat: 0 as const,
      winner: 0 as const,
      finishedAt: 1,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1_000,
      frameCount: 3,
      favorite: false,
    }],
    replaysLoading: false,
    refreshReplays: vi.fn(),
    watchSavedReplay: vi.fn(),
    exportSavedReplay: vi.fn(),
    setSavedReplayFavorite: vi.fn(),
    deleteSavedReplay: vi.fn(),
    openReplayText: vi.fn(),
  };
  return {
    useStore: <T,>(selector: (value: typeof state) => T) => selector(state),
  };
});

vi.mock("../store.js", () => ({ useStore: replayStore.useStore }));

import { ReplayLibrary, replaysForFilter } from "./ReplayLibrary.js";

describe("ReplayLibrary", () => {
  it("keeps favorite, export, and delete as accessible icon actions in one row", () => {
    const html = renderToStaticMarkup(
      createElement(TestI18nProvider, null, createElement(ReplayLibrary)),
    );

    expect(html).toContain("Open Replay File…");
    expect(html).toContain('aria-label="Replay lists"');
    expect(html).toContain('id="replay-tab-all"');
    expect(html).toContain('id="replay-tab-favorites"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Favorites");
    expect(html).toContain('class="replay-card-secondary-actions"');
    expect(html).toContain('aria-label="Favorite replay"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Export replay JSON"');
    expect(html).toContain('aria-label="Delete replay"');
    expect(html).toContain('class="replay-card-icon-button btn-danger"');
    expect(html).not.toContain(">Export JSON</button>");
    expect(html).not.toContain(">Delete</button>");
  });

  it("formats the representative replay surface in Simplified Chinese", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans"><ReplayLibrary /></TestI18nProvider>,
    );

    expect(html).toContain("我的回放");
    expect(html).toContain("全部");
    expect(html).toContain("收藏");
    expect(html).toContain("3 帧");
    expect(html).toContain('aria-label="导出回放 JSON"');
    expect(html).toContain('aria-label="收藏回放"');
    expect(html).toContain("HERO0 对阵 HERO1");
  });

  it("shows only favorite replays in the favorites tab", () => {
    const replays = [
      { id: "ordinary", favorite: false },
      { id: "favorite", favorite: true },
    ];

    expect(replaysForFilter(replays, "all")).toEqual(replays);
    expect(replaysForFilter(replays, "favorites")).toEqual([replays[1]]);
  });
});
