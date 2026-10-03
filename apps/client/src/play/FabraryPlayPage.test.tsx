import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreState } from "../store/types.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const store = vi.hoisted(() => ({ state: {} as StoreState }));
vi.mock("../store.js", () => ({ useStore: (selector: (state: StoreState) => unknown) => selector(store.state) }));
import { FabraryPlayPage } from "./FabraryPlayPage.js";

beforeEach(() => {
  store.state = {
    authUser: "Alice", error: null, cardPoolModes: { cc: "legal", "silver-age": "legal" },
    roomCode: null, rooms: [], queuedFormat: null, matchmakingActive: false,
    connected: true, bugReportNotifications: [], logout: vi.fn(),
    refreshBugReportNotifications: vi.fn(), dismissBugReportNotifications: vi.fn(),
    pendingFabraryPlay: {
      route: { ok: true, request: { url: "https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7", format: "cc" } },
      status: "ready", result: { ok: true, deck: {
        id: "deck", name: "My deck", format: "cc", fabraryUrl: null,
        heroName: "Rhinar", deckSize: 80, updatedAt: 0,
        bannedCards: ["Art of War"], futureCards: ["Future card"],
      } },
    },
    login: vi.fn(), register: vi.fn(), listRooms: vi.fn(), resolveFabraryPlay: vi.fn(),
    previewFabraryPlay: vi.fn(),
    dismissFabraryPlay: vi.fn(), startFabraryPlay: vi.fn(), setCardPoolMode: vi.fn(), joinRoom: vi.fn(),
  } as unknown as StoreState;
});

const render = (locale: "en" | "zh-Hans" = "en") => renderToStaticMarkup(
  <TestI18nProvider locale={locale}><FabraryPlayPage /></TestI18nProvider>,
);

describe("Fabrary play entry page", () => {
  it("defaults to registration beside the requested format for guests", () => {
    store.state.authUser = null;
    const html = render();
    expect(html).toContain("Play your Fabrary deck");
    expect(html).toContain("Classic Constructed");
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain("Register");
    expect(html).toContain('class="auth-tab active" aria-pressed="true">Register');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('name="termsAccepted"');
    expect(html).toContain("Create account");
    expect(html).toContain('class="fabrary-play-auth"');
    expect(html).not.toContain("Start playing");
    expect(html).not.toContain("Log in or create an account to play this deck.");
    expect(html).not.toContain("Find a player");
    expect(html).not.toContain('class="fabrary-play-actions"');
    expect(html).toContain("Play Flesh and Blood online");
    expect(html).toContain("Bring your Fabrary deck to face other players or practice against AI.");
    expect(html).toContain('class="fabrary-play-intro-kicker">Free · Open source · Community driven');
    expect(html).toContain('class="fabrary-play-deck"');
    expect(html).not.toContain("Online Matches and Focused Practice");
    expect(html).not.toContain("Spectate and review");
    expect(html).toContain('src="/fyendal-gameplay-cindra-play.jpg"');
    expect(html).toContain('width="1260" height="1118"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("lobby-topbar-guest");
    expect(html).toContain('class="brand-logo"');
    expect(html).not.toContain("fabrary-play-portrait");
  });

  it("shows the hero portrait beside the names and uses the account header", () => {
    const html = render();
    expect(html).toContain('class="fabrary-play-identity"');
    expect(html).toContain('class="fabrary-play-portrait"');
    expect(html).toContain('src="https://content.fabrary.net/heroes/rhinar.webp"');
    expect(html).toContain('alt="" width="80" height="80"');
    expect(html).toContain("My deck");
    expect(html).toContain("Rhinar");
    expect(html).toContain("lobby-topbar-authenticated");
    expect(html).toContain('class="brand-logo"');
    expect(html).toContain("Alice");
    expect(html).not.toContain('class="fabrary-play-auth"');
    expect(html).toContain("Log out");
    expect(html).toContain('class="conn-dot on"');
    expect(html).toContain("https://discord.gg/");
  });

  it("shows the public deck identity for guests with login replacing play options", () => {
    store.state.authUser = null;
    store.state.pendingFabraryPlay!.preview = { status: "ready", result: {
      ok: true, deck: { name: "Public Fabrary deck", heroName: "Malice, Domina of the Dead" },
    } };
    const html = render();
    expect(html).toContain("Public Fabrary deck");
    expect(html).toContain("Malice, Domina of the Dead");
    expect(html).toContain("https://content.fabrary.net/heroes/malice-domina-of-the-dead.webp");
    expect(html).toContain('name="username"');
    expect(html).toContain("Register");
    expect(html).not.toContain("Find a player");
    expect(html).not.toContain('class="fabrary-play-actions"');
    expect(html).not.toContain("My deck");
    expect(html).not.toContain("fabrary-play-settings");
  });

  it("keeps login available while the guest preview loads or fails", () => {
    store.state.authUser = null;
    store.state.pendingFabraryPlay!.preview = { status: "loading", result: null };
    expect(render()).toContain("Loading deck preview");
    expect(render()).toContain('name="username"');
    store.state.pendingFabraryPlay!.preview = { status: "error", result: { ok: false, error: "Deck unavailable" } };
    expect(render()).toContain("Deck unavailable");
    expect(render()).toContain("Try again");
    expect(render()).toContain('name="username"');
  });

  it("explains banned and future cards and blocks play until the chosen mode allows them", () => {
    const html = render();
    expect(html).toContain("Art of War");
    expect(html).toContain("Future card");
    expect(html).toContain("Choose Open");
    expect(html).toContain("1 banned card");
    expect(html).toContain("1 future card");
    expect(html).toContain('<details class="fabrary-play-card-note">');
    expect(html).not.toContain('<details class="fabrary-play-card-note" open');
    expect(html.indexOf("Find a player")).toBeLessThan(html.indexOf("1 future card"));
    expect(html).toContain('disabled="">Find a player');
    store.state.cardPoolModes.cc = "open";
    expect(render()).not.toContain('disabled="">Find a player');
    expect(render()).not.toContain("Choose Open");
  });

  it("allows play when the account has other ongoing games", () => {
    store.state.cardPoolModes.cc = "open";
    store.state.rooms = [{ code: "ABC123", format: "cc", heroes: ["Rhinar", "Bravo"],
      createdAt: 0, yours: true, started: true }];
    const html = render();
    expect(html).not.toContain("Return to your game");
    expect(html).not.toContain('disabled="">Find a player');
    expect(html).toContain('>Play vs AI</button>');
    expect(html).toContain('class="fabrary-play-intro"');
  });

  it("keeps a long future-card list collapsed and only asks for a mode change when needed", () => {
    store.state.pendingFabraryPlay!.result = { ok: true, deck: {
      id: "deck", name: "Domina on my Corpse until I'm Dead", format: "cc", fabraryUrl: null,
      heroName: "Malice, Domina of the Dead", deckSize: 80, updatedAt: 0,
      futureCards: Array.from({ length: 22 }, (_, index) => `Future card ${index}`),
    } };
    expect(render()).toContain("Choose Future or Open");
    store.state.cardPoolModes.cc = "future";
    const html = render();
    expect(html).toContain("22 future cards");
    expect(html).not.toContain("Choose Future or Open");
    expect(html).not.toContain('disabled="">Find a player');
    expect(html).not.toContain("Saved to your decks");
  });

  it("shows missing and unimplemented cards with retry", () => {
    store.state.pendingFabraryPlay!.status = "error";
    store.state.pendingFabraryPlay!.result = {
      ok: false, missing: ["Unknown card"], unimplemented: ["Unfinished card"],
    };
    const html = render();
    expect(html).toContain("Unknown cards: Unknown card");
    expect(html).toContain("Not implemented yet: Unfinished card");
    expect(html).toContain("Try again");
  });

  it("renders the entry and mode guidance in Chinese", () => {
    const html = render("zh-Hans");
    expect(html).toContain("来自 Fabrary");
    expect(html).toContain("选择开放模式");
    expect(html).toContain("寻找玩家");
    expect(html).toContain("对战 AI");
    expect(html).toContain("免费 · 开源 · 社区共建");
    expect(html).toContain("在线畅玩赤魂战纪 (Flesh &amp; Blood)");
    expect(html).toContain("使用你的 Fabrary 牌组，与其他玩家对战或和 AI 练习。");
  });
});
