import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitingRoom } from "./WaitingRoom.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const store = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  return { get: () => state, set: (next: Record<string, unknown>) => { state = next; } };
});
vi.mock("../store.js", () => ({
  useStore: (select: (state: Record<string, unknown>) => unknown) => select(store.get()),
}));
afterEach(() => vi.unstubAllGlobals());

function render({ accepted = false, fallback = false, searching = true } = {}): string {
  vi.stubGlobal("location", { origin: "http://localhost" });
  store.set({
    roomCode: "ABC123", spectating: false, botGame: fallback, pendingBotStart: !fallback,
    matchAcceptanceRole: "joining", botMatchTransition: fallback ? "fallback" : "accepted",
    backgroundMatchmaking: { state: searching ? "searching" : "inactive" },
    prep: {
      yourSeat: 0, botGame: fallback, deadlinePhase: fallback ? undefined : "accept", deadlineAt: Date.now() + 30_000,
      seats: [
        { username: "Alice", heroName: "Ira", accepted },
        { username: fallback ? "Ira Bot" : "Bob", heroName: "Ira", accepted: false },
      ],
    },
    acceptMatch: vi.fn(), declineMatch: vi.fn(), leave: vi.fn(), acknowledgeBotMatchFallback: vi.fn(),
  });
  return renderToStaticMarkup(<TestI18nProvider><WaitingRoom /></TestI18nProvider>);
}

describe("match acceptance holding screen", () => {
  it("offers acceptance before the player accepts", () => {
    const html = render();
    expect(html).toContain("Ready to play?");
    expect(html).toContain("Bob is waiting for you.");
    expect(html).toContain("Accept");
  });

  it("keeps accepted players waiting for their opponent without another accept button", () => {
    const html = render({ accepted: true });
    expect(html).toContain("Accepted — waiting for opponent");
    expect(html).toContain("Preparation will open once your opponent accepts too.");
    expect(html).toContain("Decline");
    expect(html).not.toContain("match-accept-primary");
    expect(html).not.toContain("Bob is waiting for you.");
  });

  it.each([true, false])("names the bot and requires acknowledgement (searching: %s)", (searching) => {
    const html = render({ fallback: true, searching });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Your opponent is now Ira Bot, a practice bot.");
    expect(html).toContain("Continue to bot prep");
    expect(html).toContain("Cancel");
    expect(html.includes("still looking for a real player")).toBe(searching);
    expect(html).not.toContain("Ready to play?");
  });
});
