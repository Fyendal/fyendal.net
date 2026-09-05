import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const mocks = vi.hoisted(() => ({
  state: {
    authUser: "CurrentUser",
    screen: "lobby",
    roomCode: null,
    socialOpen: false,
    friends: [],
    friendRequests: [],
    friendGameInvites: [],
    socialError: null,
    activeChat: null,
    incomingChatToast: null,
    chatMessages: {},
    chatHasMore: {},
    setSocialOpen: vi.fn(),
    clearSocialError: vi.fn(),
    sendFriendRequest: vi.fn(),
    respondFriendRequest: vi.fn(),
    cancelFriendRequest: vi.fn(),
    removeFriend: vi.fn(),
    openChat: vi.fn(),
    dismissIncomingChatToast: vi.fn(),
    closeChat: vi.fn(),
    loadEarlierChat: vi.fn(),
    sendChatMessage: vi.fn(),
    markChatRead: vi.fn(),
    beginFriendInvite: vi.fn(),
    dismissFriendGameInvite: vi.fn(),
    acceptFriendGameInvite: vi.fn(),
  } as Record<string, unknown>,
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
}));
vi.mock("./FriendRoomModal.js", () => ({ FriendRoomModal: () => null }));

import { SocialDock } from "./SocialDock.js";
import { PostGameFriendAction } from "./PostGameFriendAction.js";

function render(): string {
  return renderToStaticMarkup(
    <TestI18nProvider><SocialDock /></TestI18nProvider>,
  );
}

describe("SocialDock", () => {
  it("collapses to an accessible bubble and caps the aggregate badge", () => {
    Object.assign(mocks.state, {
      socialOpen: false,
      friends: [{ username: "Alice", presence: "offline", friendsSince: 1, unreadCount: 100 }],
      friendRequests: [{ username: "Bob", direction: "incoming", createdAt: 1 }],
      friendGameInvites: [],
    });
    const html = render();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("99+");
    expect(html).not.toContain("social-panel-header");
  });

  it("shows requests, live invitations, and friends without a busy status", () => {
    Object.assign(mocks.state, {
      socialOpen: true,
      friends: [
        { username: "Offline", presence: "offline", friendsSince: 1, unreadCount: 0 },
        { username: "Online", presence: "online", friendsSince: 1, unreadCount: 0 },
        { username: "Unread", presence: "offline", friendsSince: 1, unreadCount: 3 },
      ],
      friendRequests: [
        { username: "Incoming", direction: "incoming", createdAt: 1 },
        { username: "Outgoing", direction: "outgoing", createdAt: 2 },
      ],
      friendGameInvites: [{
        inviteId: "invite-1",
        fromUsername: "Inviter",
        room: { code: "ABC123", format: "cc" },
        sentAt: 1,
      }],
    });
    const html = render();
    expect(html).toContain("Friend requests");
    expect(html).toContain("Game invitations");
    expect(html).toContain("Pending");
    expect(html).toContain("Online");
    expect(html).toContain("Offline");
    expect(html).not.toContain("Busy");
    expect(html.indexOf("Unread")).toBeLessThan(html.indexOf("Online"));
  });

  it("offers game invitations only from a free lobby", () => {
    Object.assign(mocks.state, {
      screen: "lobby",
      roomCode: null,
      socialOpen: true,
      friends: [{ username: "Online", presence: "online", friendsSince: 1, unreadCount: 0 }],
      friendRequests: [],
      friendGameInvites: [],
    });
    expect(render()).toContain("Invite Online to a game");

    Object.assign(mocks.state, { screen: "game", roomCode: "ABC123" });
    expect(render()).not.toContain("Invite Online to a game");
  });

  it("shows an escaped incoming-message toast while the friend panel is closed", () => {
    Object.assign(mocks.state, {
      screen: "lobby",
      roomCode: null,
      socialOpen: false,
      friends: [{ username: "Alice", presence: "online", friendsSince: 1, unreadCount: 1 }],
      friendRequests: [],
      friendGameInvites: [],
      incomingChatToast: {
        id: "1",
        friendUsername: "Alice",
        senderUsername: "Alice",
        text: '<img src=x onerror="alert(1)">',
        sentAt: 1,
        readAt: null,
      },
    });
    const html = render();
    expect(html).toContain("social-message-toast");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
  });
});

describe("PostGameFriendAction", () => {
  it("moves through add, pending, accept, and message relationship states", () => {
    Object.assign(mocks.state, { friends: [], friendRequests: [] });
    expect(renderToStaticMarkup(<TestI18nProvider><PostGameFriendAction username="Opponent" /></TestI18nProvider>))
      .toContain("Add Friend");
    Object.assign(mocks.state, {
      friendRequests: [{ username: "Opponent", direction: "outgoing", createdAt: 1 }],
    });
    expect(renderToStaticMarkup(<TestI18nProvider><PostGameFriendAction username="Opponent" /></TestI18nProvider>))
      .toContain("Request sent");
    Object.assign(mocks.state, {
      friendRequests: [{ username: "Opponent", direction: "incoming", createdAt: 1 }],
    });
    expect(renderToStaticMarkup(<TestI18nProvider><PostGameFriendAction username="Opponent" /></TestI18nProvider>))
      .toContain("Accept Friend");
    Object.assign(mocks.state, {
      friends: [{ username: "Opponent", presence: "online", friendsSince: 1, unreadCount: 0 }],
      friendRequests: [],
    });
    expect(renderToStaticMarkup(<TestI18nProvider><PostGameFriendAction username="Opponent" /></TestI18nProvider>))
      .toContain("Message");
  });

  it("hides the action for self", () => {
    Object.assign(mocks.state, { friends: [], friendRequests: [] });
    expect(renderToStaticMarkup(<TestI18nProvider><PostGameFriendAction username="currentuser" /></TestI18nProvider>))
      .toBe("");
  });
});
