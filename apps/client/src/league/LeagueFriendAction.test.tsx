import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
}));

import { LeagueFriendAction } from "./LeagueFriendAction.js";

function render(username = "Rival"): string {
  return renderToStaticMarkup(
    <TestI18nProvider>
      <LeagueFriendAction username={username} />
    </TestI18nProvider>,
  );
}

beforeEach(() => {
  mocks.state = {
    authUser: "Me",
    friends: [],
    friendRequests: [],
    sendFriendRequest: vi.fn(),
    respondFriendRequest: vi.fn(),
    openChat: vi.fn(),
  };
});

describe("LeagueFriendAction", () => {
  it("offers to add a stranger", () => {
    const html = render();
    expect(html).toContain('data-relation="none"');
    expect(html).toContain('aria-label="Add Rival as a friend"');
    expect(html).toContain(">Add friend<");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("title=");
  });

  it("follows the friendship state", () => {
    mocks.state.friendRequests = [{ username: "Rival", direction: "outgoing", createdAt: 1 }];
    const outgoing = render();
    expect(outgoing).toMatch(/data-relation="outgoing"[^>]*disabled=""/);
    expect(outgoing).toContain(">Request sent<");

    mocks.state.friendRequests = [{ username: "Rival", direction: "incoming", createdAt: 1 }];
    const incoming = render("rival");
    expect(incoming).toContain('data-relation="incoming"');
    expect(incoming).toContain('aria-label="Respond to Rival&#x27;s friend request"');
    expect(incoming).toContain(">Accept friend<");

    mocks.state.friendRequests = [];
    mocks.state.friends = [{ username: "Rival", presence: "online", friendsSince: 1, unreadCount: 0 }];
    const friend = render("rival");
    expect(friend).toContain('data-relation="friend"');
    expect(friend).toContain('aria-label="Message Rival"');
    expect(friend).toContain(">Message<");
  });

  it("renders nothing for a signed-out viewer or the viewer's own name", () => {
    expect(render("me")).toBe("");
    mocks.state.authUser = null;
    expect(render()).toBe("");
  });
});
