import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Home, otherSearchers } from "./Home.js";
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
    queueCounts: { cc: 0, "silver-age": 0 },
    rooms: [], refreshDecks: vi.fn(), setCardPoolMode: vi.fn(),
    ...overrides,
  });
  return renderToStaticMarkup(<TestI18nProvider><Home /></TestI18nProvider>);
}

describe("Home live searchers", () => {
  it("excludes only this account's own search in that format", () => {
    const counts = { cc: 3, "silver-age": 1 };
    expect(otherSearchers(counts, "cc", null)).toBe(3);
    expect(otherSearchers(counts, "cc", "cc")).toBe(2);
    expect(otherSearchers(counts, "silver-age", "cc")).toBe(1);
    expect(otherSearchers({ cc: 0, "silver-age": 0 }, "cc", "cc")).toBe(0);
  });

  it("shows searchers per format and for the selected format", () => {
    const html = render({ queueCounts: { cc: 2, "silver-age": 1 } });
    expect(html).toContain("Classic Constructed · 2 searching</option>");
    expect(html).toContain("Silver Age · 1 searching</option>");
    expect(html).toMatch(/class="home-play-live">.*1 player searching now/);
  });

  it("shows nothing when nobody else is searching", () => {
    const html = render();
    expect(html).toContain(">Classic Constructed</option>");
    expect(html).not.toContain("home-play-live");
    expect(render({ queuedFormat: "cc", queueCounts: { cc: 1, "silver-age": 0 } }))
      .not.toContain("home-play-live");
  });

  it("counts other players while this account is searching", () => {
    const html = render({ queuedFormat: "silver-age", queueCounts: { cc: 0, "silver-age": 3 } });
    expect(html).toContain("2 other players searching");
  });
});
