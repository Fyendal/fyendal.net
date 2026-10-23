import { renderToStaticMarkup } from "react-dom/server";
import { emptyQueueCounts } from "../matchmaking/pairableSearchers.js";
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

function render(
  prep: PrepView | null,
  mobile: boolean,
  prepDeck: typeof deck = deck,
  overrides: Record<string, unknown> = {},
): string {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: mobile }) });
  vi.stubGlobal("location", { origin: "http://localhost" });
  store.set({
    prepDeck, prep, roomCode: "ABC123", queueCounts: emptyQueueCounts(),
    matchmakingActive: false, matchAcceptanceRole: null,
    acceptMatch: vi.fn(), declineMatch: vi.fn(), playBotFromPrep: vi.fn(),
    presentArena: vi.fn(), presentDeck: vi.fn(), prepUnready: vi.fn(),
    chooseFirst: vi.fn(), leave: vi.fn(), selectPrepMatchup: vi.fn(),
    ...overrides,
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

  it.each([false, true])("allows arena drafting while the opponent chooses turn order (mobile: %s)", (mobile) => {
    const prep = pairedPrep("choose-first");
    prep.botGame = false;
    prep.die = { rolls: [3, 5], winner: 1 };
    const html = render(prep, mobile);
    const choices = html.match(/<button\b[^>]*class="prep-card-choice[^>]*>/g) ?? [];
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) expect(choice).not.toContain("disabled");
    expect(html).not.toContain("Lock arena cards");
    expect(html).not.toContain("Arena cards open once turn order is decided.");
    expect(html).toContain("Select Arena Cards");
    expect(html).not.toContain("prep-arena-pending");
  });

  it.each([false, true])("keeps arena drafting disabled while you choose turn order (bot game: %s)", (botGame) => {
    const prep = pairedPrep("choose-first");
    prep.botGame = botGame;
    prep.die = { rolls: [5, 3], winner: 0 };
    const html = render(prep, false);
    const choices = html.match(/<button\b[^>]*class="prep-card-choice[^>]*>/g) ?? [];
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) expect(choice).toContain("disabled");
    expect(html).toContain("Arena cards open once turn order is decided.");
    expect(html).not.toContain("Select Arena Cards");
    expect(html).toContain("prep-arena-pending");
    expect(html).not.toMatch(/<button[^>]*id="fabrary-matchup"[^>]*disabled/);
  });

  it("keeps arena drafting disabled during match acceptance", () => {
    const prep = pairedPrep("accept");
    prep.startPlayer = null;
    const html = render(prep, false);
    const choices = html.match(/<button\b[^>]*class="prep-card-choice[^>]*>/g) ?? [];
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) expect(choice).toContain("disabled");
  });

  it("tells the queue owner when the opponent already accepted the match", () => {
    const prep = pairedPrep("accept");
    prep.botGame = false;
    prep.startPlayer = null;
    prep.deadlinePhase = "accept";
    prep.deadlineAt = Date.now() + 30_000;
    prep.seats = [{ ...prep.seats[0]!, accepted: false }, { ...prep.seats[1]!, accepted: true }];
    const html = render(prep, false, deck, { matchAcceptanceRole: "existing" });
    const prompt = html.match(/<section class="panel prep-match-accept-prompt"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(prompt).toContain("Match Found");
    expect(prompt.match(/accept-hero-side is-accepted/g)).toHaveLength(1);
    expect(prompt).toContain("match-accept-primary");
  });

  it("puts the desktop arena lock in the match sheet beside both player mats", () => {
    const html = render(pairedPrep("select-arena"), false);
    const action = html.match(/<div class="prep-sheet-action">([\s\S]*?)<\/section>/)?.[1];
    expect(action).toContain("Lock arena cards");
    expect(html.match(/Lock arena cards/g)).toHaveLength(1);
    expect(html.match(/class="prep-mat[ "]/g)).toHaveLength(2);
    expect(html).toContain("prep-mat-hidden");
    expect(html).not.toContain("Both selections are revealed");
    expect(html).not.toContain("prep-sheet-state");
    expect(html).not.toContain("sideboarding");
    expect(html).not.toContain("prep-ready-float");
    expect(html).not.toContain("Your Presentation");
  });

  it("heads the desktop selection column with the matchup plan, not the match sheet", () => {
    const withPlans = {
      ...deck,
      matchups: [{ id: "levia", name: "Levia", preferredTurnOrder: "first" as const, notes: "Race them." }],
      selectedMatchupId: "levia",
    };
    const html = render(pairedPrep("select-arena"), false, withPlans);
    const sheet = html.match(/<section class="panel prep-opponent prep-sheet"[\s\S]*?<\/section>/)?.[0];
    const column = html.match(/<div class="prep-selection-column">([\s\S]*)/)?.[1];
    expect(sheet).not.toContain("fabrary-matchup");
    expect(column?.indexOf('id="fabrary-matchup"')).toBeLessThan(column?.indexOf("prep-arena-stage") ?? -1);
    expect(column).toContain("Prefers going first");
  });

  it("keeps the mobile bar to one row: opponent hero, turn order, deck count and Ready", () => {
    const html = render(pairedPrep("select-deck"), true);
    const row = html.match(/<div class="prep-bar-row">([\s\S]*?)<\/button><\/div><\/div>/)?.[1];
    expect(row).toContain("prep-ready-opponent-art");
    expect(row).toContain('<p class="prep-sheet-turn">You go <strong>first</strong></p>');
    expect(row).toContain("Main deck (");
    expect(row).toContain("Ready");
    expect(row).not.toContain("preparing");
  });

  it("offers the matchup plan on mobile too", () => {
    const withPlans = { ...deck, matchups: [{ id: "levia", name: "Levia", preferredTurnOrder: null }] };
    const html = render(pairedPrep("select-arena"), true, withPlans);
    expect(html).toContain('id="fabrary-matchup"');
  });

  it("only reports the opponent when they finish a step ahead of you", () => {
    const prep = pairedPrep("select-arena");
    prep.seats[1] = { ...prep.seats[1]!, arenaLocked: true };
    const html = render(prep, false);
    expect(html).toContain('<div class="prep-sheet-state arena-locked">Arena cards locked</div>');
  });

  it("offers the desktop turn-order choice as the sheet action", () => {
    const html = render(pairedPrep("choose-first"), false);
    const action = html.match(/<div class="prep-sheet-action">([\s\S]*?)<\/section>/)?.[1];
    expect(action).toContain("Go first");
    expect(action).toContain("Go second");
    expect(html).not.toContain("prep-sheet-turn");
  });

  it("states turn order and readies the deck from the desktop sheet", () => {
    const html = render(pairedPrep("select-deck"), false);
    expect(html).toContain('<p class="prep-sheet-turn">You go <strong>first</strong></p>');
    const action = html.match(/<div class="prep-sheet-action">([\s\S]*?)<\/section>/)?.[1];
    expect(action).toContain("Ready");
    expect(html).not.toContain("prep-ready-float");
    expect(html).not.toContain("Arena Cards Revealed");
    expect(html).toContain("Your Presentation");
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
    expect(html).toContain('<div class="prep-ready-float">');
    expect(html.match(/Lock arena cards/g)).toHaveLength(1);
    expect(html).not.toContain("prep-desktop-arena-action");
  });

  it("shows revealed cards separately from deck editing and restores the submitted main deck", () => {
    const prep = { ...pairedPrep("select-deck"), yourPresentedDeck: deck.decklist.deck.slice(0, 50) };
    const html = render(prep, true);
    expect(html).toContain("Your arena cards");
    expect(html).toContain("Opponent’s arena cards");
    expect(html.replace(/<[^>]*>/g, "")).toContain("50 / 60 min");
    expect(html).not.toContain("prep-card-choice");
    expect(html).not.toContain("Lock arena cards");
  });

  it("does not render an empty floating footer while waiting for an opponent", () => {
    const html = render(null, true);
    expect(html).not.toContain("prep-ready-float");
  });

  it("waits for uncached card art before opening the room", () => {
    vi.stubGlobal("Image", class {});
    const html = render(pairedPrep("select-arena"), false);
    expect(html).toContain("Loading Card Art");
    expect(html).toMatch(/0 of \d+ cards ready/);
    expect(html).not.toContain("prep-columns");
  });

  it("never hides the match-accept dialog behind the art loading screen", () => {
    vi.stubGlobal("Image", class {});
    const prep = pairedPrep("accept");
    prep.startPlayer = null;
    prep.deadlinePhase = "accept";
    prep.deadlineAt = Date.now() + 30_000;
    const html = render(prep, false, deck, { matchAcceptanceRole: "existing" });
    expect(html).not.toContain("Loading Card Art");
    expect(html).toContain("prep-match-accept-prompt");
  });
});
