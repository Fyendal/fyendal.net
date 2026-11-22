import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReplaySummary } from "@fyendal/protocol";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const replayStore = vi.hoisted(() => {
  const summary = (id: string, sandbox: boolean, winner: 0 | 1 | null): ReplaySummary => ({
    id, format: "cc", heroIds: ["HERO0", "HERO1"], yourSeat: 0, winner,
    finishedAt: 1_700_000_000_000, expiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000, frameCount: 12,
    favorite: false, share: null, ...(sandbox ? { sandbox: true as const } : {}),
  });
  const state = {
    savedReplays: [summary("ranked", false, 0), summary("solo", true, 1)],
    watchSavedReplay: vi.fn(),
    exportSavedReplay: vi.fn(),
    setSavedReplayFavorite: vi.fn(),
    deleteSavedReplay: vi.fn(),
  };
  return { state, useStore: <T,>(selector: (value: typeof state) => T) => selector(state) };
});

vi.mock("../store.js", () => ({ useStore: replayStore.useStore }));

import { SandboxReplayList, sandboxReplays } from "./SandboxReplayList.js";

describe("SandboxReplayList", () => {
  it("lists only sandbox replays, labeled, with no win or loss", () => {
    const html = renderToStaticMarkup(<TestI18nProvider><SandboxReplayList /></TestI18nProvider>);
    expect(html).toContain("Sandbox replays");
    expect(html).toContain('<span class="sandbox-badge">Sandbox</span>');
    expect(html.match(/class="match-row is-sandbox"/g)).toHaveLength(1);
    expect(html).toContain("Watch");
    expect(html).not.toMatch(/Victory|Defeat/);
  });

  it("renders nothing without sandbox replays", () => {
    expect(sandboxReplays(replayStore.state.savedReplays).map((replay) => replay.id)).toEqual(["solo"]);
    replayStore.state.savedReplays = replayStore.state.savedReplays.filter((replay) => !replay.sandbox);
    expect(renderToStaticMarkup(<TestI18nProvider><SandboxReplayList /></TestI18nProvider>)).toBe("");
  });
});
