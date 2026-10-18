import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Home } from "./Home.js";
import { emptyQueueCounts } from "../matchmaking/pairableSearchers.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const store = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  return { get: () => state, set: (next: Record<string, unknown>) => { state = next; } };
});
vi.mock("../store.js", () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select(store.get()),
}));

function render(overrides: Record<string, unknown> = {}): string {
  store.set({
    authUser: { id: 1, username: "alice" },
    cardPoolModes: { cc: "legal", "silver-age": "legal" },
    createBotRoom: vi.fn(), createRoom: vi.fn(), joinRoom: vi.fn(),
    decks: [], decksLoading: false, deckPlayedAt: {},
    queuedFormat: null, queueJoin: vi.fn(), queueLeave: vi.fn(),
    queueCounts: emptyQueueCounts(),
    rooms: [], refreshDecks: vi.fn(), setCardPoolMode: vi.fn(),
    ...overrides,
  });
  return renderToStaticMarkup(<TestI18nProvider><Home /></TestI18nProvider>);
}

/** Legal-pool searchers with legal decks per format. */
function legalSearchers(cc: number, silverAge: number) {
  const counts = emptyQueueCounts();
  counts.cc.legal.legal = cc;
  counts["silver-age"].legal.legal = silverAge;
  return counts;
}

describe("Home live searchers", () => {
  it("shows searchers for the selected format only, outside the format options", () => {
    const html = render({ queueCounts: legalSearchers(2, 1) });
    expect(html).toContain(">Classic Constructed</option>");
    expect(html).toContain(">Silver Age</option>");
    expect(html).toMatch(/class="home-play-live">.*1 player searching now/);
  });

  it("shows nothing when nobody else is searching", () => {
    const html = render();
    expect(html).toContain(">Classic Constructed</option>");
    expect(html).not.toContain("home-play-live");
    expect(render({ queuedFormat: "cc", queueCounts: legalSearchers(1, 0) }))
      .not.toContain("home-play-live");
  });

  it("counts other players while this account is searching", () => {
    const html = render({ queuedFormat: "silver-age", queueCounts: legalSearchers(0, 3) });
    expect(html).toContain("2 other players searching");
  });
});
