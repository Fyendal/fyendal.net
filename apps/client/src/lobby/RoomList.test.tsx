import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreState } from "../store/types.js";

const roomListStore = vi.hoisted(() => ({
  state: {} as StoreState,
  joinRoom: vi.fn(),
  queueJoin: vi.fn(),
  queueLeave: vi.fn(),
  createRoom: vi.fn(),
  createBotRoom: vi.fn(),
  setCardPoolMode: vi.fn(),
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(roomListStore.state),
}));

import { RoomList } from "./RoomList.js";
import { Home } from "./Home.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

function renderLocalized(node: ReactNode, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(<TestI18nProvider locale={locale}>{node}</TestI18nProvider>);
}

describe("RoomList", () => {
  beforeEach(() => {
    roomListStore.joinRoom.mockReset();
    roomListStore.queueJoin.mockReset();
    roomListStore.queueLeave.mockReset();
    roomListStore.createRoom.mockReset();
    roomListStore.createBotRoom.mockReset();
    roomListStore.setCardPoolMode.mockReset();
    roomListStore.state = {
      rooms: [
        {
          code: "OPEN01",
          format: "classic-battles",
          heroes: ["Open Hero", null],
          createdAt: 1,
        },
        {
          code: "PREP01",
          format: "classic-battles",
          heroes: ["Prep Hero", "Opponent"],
          createdAt: 2,
          spectateOnly: true,
        },
        {
          code: "LIVE01",
          format: "cc",
          heroes: ["Started Hero", "Opponent"],
          createdAt: 3,
          spectateOnly: true,
          started: true,
          cardPoolMode: "future",
        },
      ],
      authUser: "NewPlayer",
      decks: [],
      decksLoading: false,
      joinRoom: roomListStore.joinRoom,
      lastPlayedDecks: { cc: null, "silver-age": null },
      cardPoolModes: { cc: "legal", "silver-age": "legal" },
      queuedFormat: null,
      queueJoin: roomListStore.queueJoin,
      queueLeave: roomListStore.queueLeave,
      createRoom: roomListStore.createRoom,
      createBotRoom: roomListStore.createBotRoom,
      setCardPoolMode: roomListStore.setCardPoolMode,
    } as unknown as StoreState;
  });

  it("separates your rooms from open rooms and started games", () => {
    roomListStore.state = {
      ...roomListStore.state,
      rooms: [
        ...roomListStore.state.rooms,
        {
          code: "MINE01",
          format: "cc",
          heroes: ["Owned Hero", "Opponent"],
          createdAt: 4,
          yours: true,
          started: true,
        },
      ],
    };
    const html = renderLocalized(<RoomList onGoToDecks={() => {}} />);

    const yourHeading = html.indexOf("Your Rooms");
    const yourRoom = html.indexOf("Owned Hero");
    const openHeading = html.indexOf("Open Rooms");
    const openRoom = html.indexOf("Open Hero");
    const fullPrepRoom = html.indexOf("Prep Hero");
    const startedHeading = html.indexOf("Started Games");
    const startedRoom = html.indexOf("Started Hero");

    expect(yourHeading).toBeGreaterThan(-1);
    expect(yourRoom).toBeGreaterThan(yourHeading);
    expect(openHeading).toBeGreaterThan(yourRoom);
    expect(openHeading).toBeGreaterThan(-1);
    expect(openRoom).toBeGreaterThan(openHeading);
    expect(fullPrepRoom).toBeGreaterThan(openRoom);
    expect(startedHeading).toBeGreaterThan(fullPrepRoom);
    expect(startedRoom).toBeGreaterThan(startedHeading);
    expect(html).toContain(">Started</span>");
    expect(html).toContain('class="room-card-status"');
    expect(html).not.toContain(">Future cards</span>");
    expect(html).toContain("Create Room");
    expect(html.match(/<article class="room-card/g)).toHaveLength(4);
    expect(html).not.toContain("Quick Match");
    expect(html).not.toContain("Find Game");
    expect(html).not.toContain("Other Rooms");
  });

  it("shows one play setup with every game mode and only rejoinable rooms", () => {
    roomListStore.state = {
      ...roomListStore.state,
      rooms: [
        ...roomListStore.state.rooms,
        {
          code: "MINE01",
          format: "cc",
          heroes: ["Bravo", "Victor"],
          createdAt: 4,
          yours: true,
        },
      ],
    };

    const html = renderLocalized(<Home />);

    expect(html).toContain('class="home-play-poster"');
    expect(html).not.toContain("Welcome to Fyendal");
    expect(html).not.toContain("Choose a format");
    expect(html).toContain("Precon");
    expect(html).toContain("Find Match");
    expect(html).toContain("Invite Friend");
    expect(html).toContain("Play vs AI");
    expect(html).toContain('class="home-play-mode-segments" role="group" aria-label="Game mode"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('class="home-play-field home-card-pool-field"');
    expect(html).toContain('<option value="future">Future</option>');
    expect(html).toContain("About card pool modes");
    expect(html).toContain("Tournament-legal cards only.");
    expect(html).not.toContain("card-pool-segments");
    expect(html).toContain('type="submit" class="btn-primary"');
    expect(html).not.toContain("Manage Decks");
    expect(html).toContain("Rejoin Rooms");
    expect(html).toContain("Victor");
    expect(html.indexOf("Rejoin Rooms")).toBeLessThan(html.indexOf("home-play-poster"));
    expect(html).not.toContain("Open Hero");
    expect(html).not.toContain("Started Hero");
  });

  it("uses the last played saved deck in the selected format", () => {
    roomListStore.state = {
      ...roomListStore.state,
      decks: [
        { id: "first", name: "First Briar", format: "silver-age", fabraryUrl: null, heroName: "Briar", deckSize: 40, updatedAt: 1 },
        { id: "remembered", name: "Last Played Briar", format: "silver-age", fabraryUrl: null, heroName: "Briar", deckSize: 40, updatedAt: 2 },
      ],
      lastPlayedDecks: { cc: null, "silver-age": "remembered" },
    };

    const html = renderLocalized(<Home />);
    const trigger = html.match(/<button type="button" class="create-room-deck-trigger"[\s\S]*?<\/button>/)?.[0];

    expect(html).not.toContain("Welcome back, NewPlayer.");
    expect(trigger).toContain("Last Played Briar");
    expect(trigger).not.toContain("First Briar");
    expect(html.match(/class="home-play-field home-card-pool-field"/g)).toHaveLength(1);
  });

  it("restores the signed-in account's saved play preferences", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (key === "fyendal-home-game-mode-newplayer") return "bot";
        if (key === "fyendal-home-format-newplayer") return "cc";
        return null;
      },
      setItem: vi.fn(),
    });
    try {
      const html = renderLocalized(<Home />);
      expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Play vs AI<\/button>/);
      expect(html).toContain('<option value="cc" selected="">Classic Constructed</option>');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("waits for deck loading before showing play setup", () => {
    roomListStore.state = { ...roomListStore.state, decksLoading: true };

    const html = renderLocalized(<Home />);

    expect(html).toContain("Loading your decks…");
    expect(html).not.toContain("home-play-poster");
    expect(html).not.toContain("Game mode");
  });

  it("localizes the play setup in Simplified Chinese", () => {
    const html = renderLocalized(<Home />, "zh-Hans");

    expect(html).not.toContain("欢迎来到 Fyendal，NewPlayer。");
    expect(html).toContain("游戏模式");
    expect(html).toContain("寻找对局");
    expect(html).toContain("邀请好友");
    expect(html).toContain("对战 AI");
    expect(html).toContain("了解卡牌范围模式");
    expect(html).not.toContain("管理牌组");
  });
});
