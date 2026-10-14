import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
}));

import { OpponentActions } from "./OpponentActions.js";
import { ReportForm } from "./ReportForm.js";

const report = vi.fn();

function render(username = "Rival"): string {
  return renderToStaticMarkup(
    <TestI18nProvider>
      <OpponentActions username={username} roomCode="ABC123" onReport={report} />
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

describe("OpponentActions", () => {
  it("offers to add and report a stranger", () => {
    const html = render();
    expect(html).toContain('aria-label="Actions for Rival"');
    expect(html).toContain('aria-label="Add Rival as a friend"');
    expect(html).toContain('data-relation="none"');
    expect(html).toContain('aria-label="Report Rival"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("title=");
  });

  it("follows the friendship state", () => {
    mocks.state.friendRequests = [{ username: "Rival", direction: "outgoing", createdAt: 1 }];
    expect(render()).toContain('aria-label="Friend request sent to Rival"');
    expect(render()).toMatch(/data-relation="outgoing"[^>]*aria-disabled="true"/);

    mocks.state.friendRequests = [{ username: "Rival", direction: "incoming", createdAt: 1 }];
    const incoming = render("rival");
    expect(incoming).toContain('aria-label="Respond to rival&#x27;s friend request"');
    expect(incoming).toMatch(/data-relation="incoming"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);

    mocks.state.friendRequests = [];
    mocks.state.friends = [{ username: "Rival", online: true }];
    expect(render("rival")).toContain('aria-label="Message Rival"');
  });

  it("renders nothing for a signed-out viewer or the viewer's own name", () => {
    expect(render("me")).toBe("");
    mocks.state.authUser = null;
    expect(render()).toBe("");
  });

  it("asks for a reason before a game report can be sent", () => {
    const html = renderForm("game", null);
    for (const label of [
      "What happened in this game?",
      "Stalling or idling",
      "Spamming emotes",
      "Offensive username",
      "Cheating or exploiting a bug",
      "Something else",
    ]) expect(html).toContain(label);
    expect(html).not.toContain("Harassment");
    expect(html).not.toContain("Include our chat history");
    expect(html).toContain("Rival isn&#x27;t notified about reports.");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it("offers a friend's chat history, unchecked in game and checked in chat", () => {
    const game = renderForm("game", { checked: false });
    expect(game).toContain("Include our chat history");
    expect(game).toContain("Your recent messages with Rival are shared with our team.");
    expect(game).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*>/);

    const chat = renderForm("chat", { checked: true });
    expect(chat).toContain("What happened in this chat?");
    expect(chat).toContain("Harassment or abusive messages");
    expect(chat).not.toContain("Stalling or idling");
    expect(chat).toMatch(/<input type="checkbox"[^>]*checked=""/);
  });
});

function renderForm(source: "game" | "chat", chatOption: { checked: boolean } | null): string {
  return renderToStaticMarkup(
    <TestI18nProvider>
      <ReportForm
        username="Rival"
        source={source}
        titleId="title"
        chatOption={chatOption}
        onReport={report}
        onSent={vi.fn()}
        onClose={vi.fn()}
      />
    </TestI18nProvider>,
  );
}
