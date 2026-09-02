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
  setAllowFutureCards: vi.fn(),
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
    roomListStore.setAllowFutureCards.mockReset();
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
          allowFutureCards: true,
        },
      ],
      authUser: "NewPlayer",
      decks: [],
      decksLoading: false,
      joinRoom: roomListStore.joinRoom,
      lastPlayedDecks: { cc: null, "silver-age": null },
      allowFutureCards: { cc: false, "silver-age": false },
      queuedFormat: null,
      queueJoin: roomListStore.queueJoin,
      queueLeave: roomListStore.queueLeave,
      createRoom: roomListStore.createRoom,
      createBotRoom: roomListStore.createBotRoom,
      setAllowFutureCards: roomListStore.setAllowFutureCards,
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
    const html = renderLocalized(<RoomList onGoToFormat={() => {}} />);

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

  it("shows play options and only rejoinable rooms on Home", () => {
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
      decks: [
        {
          id: "first-deck",
          name: "First Bravo",
          format: "cc",
          fabraryUrl: null,
          heroName: "Bravo",
          deckSize: 80,
          updatedAt: 1,
        },
        {
          id: "remembered-deck",
          name: "Last Played Bravo",
          format: "cc",
          fabraryUrl: null,
          heroName: "Bravo",
          deckSize: 80,
          updatedAt: 2,
        },
      ],
      lastPlayedDecks: { cc: "remembered-deck", "silver-age": null },
    };

    const html = renderLocalized(<Home onGoToFormat={() => {}} />);

    expect(html).toContain("Rejoin Rooms");
    expect(html).toContain("Victor");
    expect(html).toContain("Rejoin");
    expect(html).not.toContain("Open Hero");
    expect(html).not.toContain("Started Hero");
    expect(html).toContain("Welcome back, NewPlayer.");
    expect(html).toContain("Allow Future Cards");
    expect(html).toContain('role="switch"');
    expect(html).not.toContain("Choose how you’d like to start playing.");
    expect(html).toContain("Play CC");
    expect(html).toContain("Find Match");
    expect(html).toContain("Play vs Bot");
    expect(html).not.toContain("Hala");
    expect(html).toContain("Last Played Bravo");
    const deckTrigger = html.match(
      /<button type="button" class="create-room-deck-trigger"[\s\S]*?<\/button>/,
    )?.[0];
    expect(deckTrigger).toContain("Last Played Bravo");
    expect(deckTrigger).not.toContain("First Bravo");
    expect(html).toContain("Import your Silver Age deck");
    expect(html.indexOf("Rejoin Rooms")).toBeLessThan(html.indexOf("new-player-options"));
    expect(html).not.toContain("Quick Match");
    expect(html).not.toContain("Invite Friend");
  });

  it("offers a Silver Age precon and hides an empty rejoin section on first run", () => {
    const html = renderLocalized(<Home onGoToFormat={() => {}} />);

    expect(html).toContain("Welcome to Fyendal, NewPlayer.");
    expect(html).toContain("Choose one of these three ways to start playing.");
    expect(html).toContain("Try with a precon");
    expect(html).not.toContain("Choose a precon");
    expect(html).toContain("Briar Precon");
    expect(html).toContain("create-room-deck-trigger");
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain("create-room-deck-option-content");
    expect(html).not.toContain("<select");
    expect(html).toContain("Find Match");
    expect(html).toContain("Play vs Bot");
    expect(html).toContain("Import your Silver Age deck");
    expect(html).toContain("Import your CC deck");
    expect(html.match(/class="new-player-card /g)).toHaveLength(3);
    expect(html).not.toContain("Rejoin Rooms");
    expect(html).not.toContain("Quick Match");
    expect(html).not.toContain("Invite Friend");
  });

  it("shows independent Home future-card switches for both formats", () => {
    roomListStore.state = {
      ...roomListStore.state,
      allowFutureCards: { cc: true, "silver-age": true },
    };

    const enabledHtml = renderLocalized(<Home onGoToFormat={() => {}} />);
    expect(enabledHtml.match(/role="switch" checked=""/g)).toHaveLength(2);

    roomListStore.state = {
      ...roomListStore.state,
      allowFutureCards: { cc: true, "silver-age": false },
    };

    const mixedHtml = renderLocalized(<Home onGoToFormat={() => {}} />);
    expect(mixedHtml.match(/role="switch" checked=""/g)).toHaveLength(1);
    expect(mixedHtml).toContain("Classic Constructed");
    expect(mixedHtml).toContain("Silver Age");
  });

  it("waits for deck loading before showing the new-player choices", () => {
    roomListStore.state = { ...roomListStore.state, decksLoading: true };

    const html = renderLocalized(<Home onGoToFormat={() => {}} />);

    expect(html).toContain("Loading your decks…");
    expect(html).not.toContain("Welcome to Fyendal");
    expect(html).not.toContain("Try with a precon");
    expect(html).not.toContain("Rejoin Rooms");
  });

  it("renders the authenticated home actions in Simplified Chinese", () => {
    const html = renderLocalized(<Home onGoToFormat={() => {}} />, "zh-Hans");

    expect(html).toContain("欢迎来到 Fyendal，NewPlayer。");
    expect(html).toContain("卡牌范围");
    expect(html).toContain("允许未来卡牌");
    expect(html).toContain("白银时代");
    expect(html).toContain("Silver Age");
    expect(html).toContain("经典构筑");
    expect(html).toContain(">CC</span>");
    expect(html).toContain("试用预构筑牌组");
    expect(html).toContain("寻找对局");
    expect(html).toContain("对战AI");
  });

  it("turns imported format cards into playable deck pickers", () => {
    roomListStore.state = {
      ...roomListStore.state,
      decks: [
        {
          id: "silver-first",
          name: "First Silver Age Deck",
          format: "silver-age",
          fabraryUrl: null,
          heroName: "Briar",
          deckSize: 40,
          updatedAt: 1,
        },
        {
          id: "silver-deck",
          name: "My Silver Age Deck",
          format: "silver-age",
          fabraryUrl: null,
          heroName: "Briar",
          deckSize: 40,
          updatedAt: 1,
        },
        {
          id: "cc-first",
          name: "First CC Deck",
          format: "cc",
          fabraryUrl: null,
          heroName: "Bravo",
          deckSize: 80,
          updatedAt: 1,
        },
        {
          id: "cc-deck",
          name: "My CC Deck",
          format: "cc",
          fabraryUrl: null,
          heroName: "Bravo",
          deckSize: 80,
          updatedAt: 1,
        },
      ],
      lastPlayedDecks: { cc: "cc-deck", "silver-age": "silver-deck" },
    };

    const html = renderLocalized(<Home onGoToFormat={() => {}} />);

    expect(html).not.toContain("Choose how you’d like to start playing.");
    expect(html).not.toContain("Try with a precon");
    expect(html).toContain("Play Silver Age");
    expect(html).toContain("My Silver Age Deck");
    expect(html).toContain("Play CC");
    expect(html).toContain("My CC Deck");
    expect(html).not.toContain("Import your Silver Age deck");
    expect(html).not.toContain("Import your CC deck");
    expect(html.match(/class="new-player-card /g)).toHaveLength(2);
    expect(html.match(/create-room-deck-trigger/g)).toHaveLength(2);
    const triggers = html.match(
      /<button type="button" class="create-room-deck-trigger"[\s\S]*?<\/button>/g,
    );
    expect(triggers).toHaveLength(2);
    expect(triggers?.[0]).toContain("My Silver Age Deck");
    expect(triggers?.[0]).not.toContain("First Silver Age Deck");
    expect(triggers?.[1]).toContain("My CC Deck");
    expect(triggers?.[1]).not.toContain("First CC Deck");
    expect(html.match(/>Find Match<\/button>/g)).toHaveLength(2);
    expect(html.match(/>Play vs Bot<\/button>/g)).toHaveLength(2);
  });
});
