import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MatchRecords, MatchSummary } from "@fyendal/protocol";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import type { MatchListState } from "../store/types.js";

const historyStore = vi.hoisted(() => {
  const records: MatchRecords = {
    heroes: [
      { heroId: "HERO0", opponentKind: "player", format: "cc", games: 3, wins: 2, losses: 1, draws: 0, ended: 0, lastPlayedAt: 1_700_000_000_000 },
      { heroId: "HERO0", opponentKind: "bot", format: "silver-age", games: 2, wins: 1, losses: 0, draws: 0, ended: 1, lastPlayedAt: 1_700_100_000_000 },
    ],
    matchups: [
      { heroId: "HERO0", opponentHeroId: "HERO1", opponentKind: "player", format: "cc", games: 3, wins: 2, losses: 1, draws: 0 },
      { heroId: "HERO0", opponentHeroId: "HERO2", opponentKind: "bot", format: "silver-age", games: 1, wins: 1, losses: 0, draws: 0 },
    ],
  };
  const matches: MatchSummary[] = [
    {
      id: "m1", format: "cc", yourSeat: 0, winner: 0, endReason: "lethal", finishedAt: 1_700_000_000_000,
      players: [
        { heroId: "HERO0", controller: "human", username: "alice", bot: null, deckName: "My Levia" },
        { heroId: "HERO1", controller: "human", username: "bob", bot: null, deckName: null },
      ],
      replay: { id: "replay-1", expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000 - 60_000, favorite: false },
    },
    {
      id: "m2", format: "silver-age", yourSeat: 1, winner: 0, endReason: "concede", finishedAt: 1_699_000_000_000,
      players: [
        { heroId: "HERO2", controller: "bot", username: "Bravo Bot", bot: "bravo", deckName: "Flarvo" },
        { heroId: "HERO0", controller: "human", username: "alice", bot: null, deckName: null },
      ],
      replay: null,
    },
    {
      id: "m3", format: "cc", yourSeat: 0, winner: null, endReason: null, finishedAt: 1_698_000_000_000,
      players: [
        { heroId: "HERO0", controller: "human", username: "alice", bot: null, deckName: null },
        { heroId: "HERO1", controller: "human", username: null, bot: null, deckName: null },
      ],
      replay: { id: "replay-3", expiresAt: 1, favorite: true },
    },
  ];
  const matchList: MatchListState = {
    filters: {}, matches, nextCursor: "1.abcdefabcdefabcdefabcdef", loading: false, error: null, loaded: true,
  };
  const state: {
    authToken: string | null;
    matchRecords: MatchRecords | null;
    matchRecordsLoading: boolean;
    matchRecordsError: boolean;
    matchList: MatchListState;
    savedReplays: Array<{ favorite: boolean }>;
    refreshMatchRecords: () => void;
    loadMatches: () => void;
    watchSavedReplay: () => void;
    exportSavedReplay: () => void;
    setMatchReplayFavorite: () => void;
    deleteMatchReplay: () => void;
    openReplayText: () => void;
  } = {
    authToken: "token",
    matchRecords: records,
    matchRecordsLoading: false,
    matchRecordsError: false,
    matchList,
    savedReplays: [],
    refreshMatchRecords: vi.fn(),
    loadMatches: vi.fn(),
    watchSavedReplay: vi.fn(),
    exportSavedReplay: vi.fn(),
    setMatchReplayFavorite: vi.fn(),
    deleteMatchReplay: vi.fn(),
    openReplayText: vi.fn(),
  };
  return {
    state,
    useStore: <T,>(selector: (value: typeof state) => T) => selector(state),
  };
});

vi.mock("../store.js", () => ({ useStore: historyStore.useStore }));

import { MatchHistory } from "./MatchHistory.js";
import { reasonMessageId, resultMessageId } from "./MatchList.js";

function render(locale: "en" | "zh-Hans" = "en"): string {
  return renderToStaticMarkup(<TestI18nProvider locale={locale}><MatchHistory /></TestI18nProvider>);
}

describe("MatchHistory", () => {
  it("opens on the overview with the stat strip, hero grid and recent matches", () => {
    const html = render();
    expect(html).toContain("Match history");
    expect(html).not.toContain("Open a replay file");
    expect(html).toContain("Replays stay for 7 days. Favorite one to keep it.");
    expect(html).toContain('id="history-tab-overview"');
    expect(html).toContain('id="history-tab-matches"');
    expect(html).toContain('id="history-tab-heroes"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(">4</span></dd><dt>Games</dt>");
    expect(html).not.toContain(" title=\"Against");
    expect(html).toMatch(/class="hover-hint stat-primary" tabindex="0" aria-label="Against players: 67%"[^>]*>67%</);
    expect(html).toContain('class="hover-hint is-all" tabindex="0" aria-label="Against everyone: 75%"');
    expect(html).toContain('class="hover-hint is-bots" tabindex="0" aria-label="Against bots: 100%"');
    expect(html).toContain(">3–1</span></dd><dt>Record</dt>");
    expect(html).toContain('class="hover-hint stat-primary is-win"');
    expect(html).toContain("<dt>Win streak</dt>");
    expect(html).not.toContain('class="segment"');
    expect(html).toContain('class="hero-tile"');
    expect(html).toContain("Recent matches");
    expect(html).toContain("See all matches");
    expect(html).toContain("<strong>Victory</strong>");
    expect(html).toContain("<strong>Defeat</strong>");
    expect(html).toContain("<strong>Ended</strong>");
    expect(html).toContain('title="Won by lethal"');
    expect(html).toContain("Deleted player");
    expect(html).toContain("Bravo Bot");
    expect(html).not.toContain("My Levia");
    expect(html).toContain('class="match-row is-win"');
    expect(html).toContain('class="match-row is-loss"');
    expect(html).toContain('class="match-row is-ended"');
    expect(html).toContain('aria-label="Favorite replay"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('title="Replay: 2 days left"');
    expect(html).toContain('aria-label="Share replay"');
    expect(html).not.toContain("<svg");
    expect(html).toContain("Replay expires in 2 days");
    expect(html).toContain("Replay expired");
    expect(html).not.toContain("Show older matches");
  });

  it("reads naturally in Simplified Chinese", () => {
    const html = render("zh-Hans");
    expect(html).toContain("对战记录");
    expect(html).toContain('aria-label="对玩家：67%"');
    expect(html).toContain("<dt>胜率</dt>");
    expect(html).toContain("<strong>胜利</strong>");
    expect(html).toContain("已注销玩家");
    expect(html).toContain("最近对局");
    expect(html).toContain('aria-label="收藏回放"');
  });

  it("shows the empty state before any game and keeps the import action", () => {
    const { state } = historyStore;
    const previous = { records: state.matchRecords, list: state.matchList };
    state.matchRecords = { heroes: [], matchups: [] };
    state.matchList = { ...state.matchList, matches: [], nextCursor: null };
    try {
      const html = render();
      expect(html).toContain("No matches yet. Play against a bot or a player and it will show up here.");
      expect(html).toContain("Open a replay file");
      expect(html).not.toContain('id="history-tab-overview"');
      expect(html).not.toContain('class="stat-strip"');
    } finally {
      state.matchRecords = previous.records;
      state.matchList = previous.list;
    }
  });

  it("offers a retry when the record or the list fails to load", () => {
    const { state } = historyStore;
    const previous = { error: state.matchRecordsError, list: state.matchList };
    state.matchRecordsError = true;
    state.matchList = { ...state.matchList, error: "boom" };
    try {
      const html = render();
      expect(html).toContain("Could not load your record.");
      expect(html).toContain("Could not load matches.");
      expect(html.match(/>Retry<\/button>/g)).toHaveLength(2);
    } finally {
      state.matchRecordsError = previous.error;
      state.matchList = previous.list;
    }
  });

  it("maps outcomes to one-word results and keeps the reason as a detail", () => {
    expect(resultMessageId({ winner: 0, yourSeat: 0, endReason: "idle" })).toBe("history.result.win");
    expect(resultMessageId({ winner: null, yourSeat: 0, endReason: "draw" })).toBe("history.result.draw");
    expect(resultMessageId({ winner: null, yourSeat: 0, endReason: "ended" })).toBe("history.result.ended");
    expect(reasonMessageId({ winner: 0, yourSeat: 0, endReason: "idle" })).toBe("history.reason.win.idle");
    expect(reasonMessageId({ winner: 1, yourSeat: 0, endReason: "concede" })).toBe("history.reason.loss.concede");
    expect(reasonMessageId({ winner: 1, yourSeat: 1, endReason: null })).toBeNull();
    expect(reasonMessageId({ winner: null, yourSeat: 0, endReason: "ended" })).toBeNull();
  });
});
