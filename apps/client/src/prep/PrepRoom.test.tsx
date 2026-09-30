import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrepSeatView, PrepView } from "@fyendal/shared";
import { PrepRoom } from "./PrepRoom.js";
import { preconPrepDeck } from "./prepDeck.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const store = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  return { get: () => state, set: (next: Record<string, unknown>) => { state = next; } };
});
vi.mock("../store.js", () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select(store.get()),
}));
afterEach(() => vi.unstubAllGlobals());

const deck = preconPrepDeck("precon-asb")!;
const arena = { weaponIds: deck.decklist.weaponIds, equipment: {} };
function pairedPrep(phase: PrepView["phase"]): PrepView {
  const locked = phase === "select-deck";
  const member = (seat: number): PrepSeatView => ({
    username: `Player ${seat}`, heroId: deck.decklist.heroId, heroName: deck.heroName,
    ready: false, connected: true, arenaLocked: locked,
    ...(locked ? { arena } : {}),
  });
  return {
    format: "cc", phase, yourSeat: 0, botGame: true,
    die: { rolls: [3, 5], winner: 1 },
    startPlayer: phase === "choose-first" ? null : 0,
    seats: [member(0), member(1)],
    ...(locked ? { yourArena: arena } : {}),
  };
}

function render(prep: PrepView | null, mobile: boolean): string {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: mobile }) });
  vi.stubGlobal("location", { origin: "http://localhost" });
  store.set({
    prepDeck: deck, prep, roomCode: "ABC123", queueCounts: {},
    matchmakingActive: false, matchAcceptanceRole: null,
    acceptMatch: vi.fn(), declineMatch: vi.fn(), playBotFromPrep: vi.fn(),
    presentArena: vi.fn(), presentDeck: vi.fn(), prepUnready: vi.fn(),
    chooseFirst: vi.fn(), leave: vi.fn(), selectPrepMatchup: vi.fn(),
  });
  return renderToStaticMarkup(<TestI18nProvider><PrepRoom /></TestI18nProvider>);
}

describe("preparation stage layout", () => {
  it.each([false, true])("shows full-screen control beside Leave (mobile: %s)", (mobile) => {
    vi.stubGlobal("document", {
      documentElement: { requestFullscreen: vi.fn() },
      exitFullscreen: vi.fn(),
      fullscreenElement: null,
    });
    const html = render(pairedPrep("select-arena"), mobile);
    const actions = html.match(/<div class="prep-topbar-actions">([\s\S]*?)<\/div>/)?.[1];
    expect(actions).toContain('aria-label="Enter full screen"');
    expect(actions).toContain("Leave");
  });

  it.each([false, true])("allows arena drafting before either player chooses turn order (mobile: %s)", (mobile) => {
    for (const winner of [0, 1] as const) {
      const prep = pairedPrep("choose-first");
      prep.botGame = false;
      prep.die = { rolls: winner === 0 ? [5, 3] : [3, 5], winner };
      const html = render(prep, mobile);
      const choices = html.match(/<button\b[^>]*class="prep-card-choice[^>]*>/g) ?? [];
      expect(choices.length).toBeGreaterThan(0);
      for (const choice of choices) expect(choice).not.toContain("disabled");
      expect(html).not.toContain("Lock arena cards");
    }
  });

  it("keeps arena drafting disabled during match acceptance", () => {
    const prep = pairedPrep("accept");
    prep.startPlayer = null;
    const html = render(prep, false);
    const choices = html.match(/<button\b[^>]*class="prep-card-choice[^>]*>/g) ?? [];
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) expect(choice).toContain("disabled");
  });

  it("keeps desktop arena selection and its sticky action in one panel", () => {
    const html = render(pairedPrep("select-arena"), false);
    expect(html).toContain("prep-desktop-arena-action");
    expect(html.match(/Lock arena cards/g)).toHaveLength(1);
    expect(html).not.toContain("prep-ready-float");
    expect(html).not.toContain("Your presentation");
  });

  it("shows mobile first-player choices without an arena lock action", () => {
    const html = render(pairedPrep("choose-first"), true);
    expect(html).toContain("prep-float-pick");
    expect(html).toContain("Go first");
    expect(html).toContain("Go second");
    expect(html).not.toContain("Lock arena cards");
  });

  it("uses the mobile footer for the arena action without duplicating it in the panel", () => {
    const html = render(pairedPrep("select-arena"), true);
    expect(html).toContain("prep-ready-float prep-arena-mobile");
    expect(html.match(/Lock arena cards/g)).toHaveLength(1);
    expect(html).not.toContain("prep-desktop-arena-action");
  });

  it("shows revealed cards separately from deck editing and restores the submitted main deck", () => {
    const prep = { ...pairedPrep("select-deck"), yourPresentedDeck: deck.decklist.deck.slice(0, 50) };
    const html = render(prep, true);
    expect(html).toContain("Your arena cards");
    expect(html).toContain("Opponent’s arena cards");
    expect(html).toContain("50 / 60 min");
    expect(html).not.toContain("prep-card-choice");
    expect(html).not.toContain("Lock arena cards");
  });

  it("does not render an empty floating footer while waiting for an opponent", () => {
    const html = render(null, true);
    expect(html).not.toContain("prep-ready-float");
  });
});
