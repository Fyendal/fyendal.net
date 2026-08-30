import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
    }],
    replaysLoading: false,
    refreshReplays: vi.fn(),
    watchSavedReplay: vi.fn(),
    exportSavedReplay: vi.fn(),
    deleteSavedReplay: vi.fn(),
    openReplayText: vi.fn(),
  };
  return {
    useStore: <T,>(selector: (value: typeof state) => T) => selector(state),
  };
});

vi.mock("../store.js", () => ({ useStore: replayStore.useStore }));

import { ReplayLibrary } from "./ReplayLibrary.js";

describe("ReplayLibrary", () => {
  it("keeps export and delete as accessible icon actions in one row", () => {
    const html = renderToStaticMarkup(createElement(ReplayLibrary));

    expect(html).toContain("Open Replay File…");
    expect(html).toContain('class="replay-card-secondary-actions"');
    expect(html).toContain('aria-label="Export replay JSON"');
    expect(html).toContain('aria-label="Delete replay"');
    expect(html).toContain('class="replay-card-icon-button btn-danger"');
    expect(html).not.toContain(">Export JSON</button>");
    expect(html).not.toContain(">Delete</button>");
  });
});
