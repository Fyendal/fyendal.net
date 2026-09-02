import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreState } from "../store/types.js";

const inviteStore = vi.hoisted(() => ({
  state: {} as StoreState,
  joinRoom: vi.fn(),
  dismissInvite: vi.fn(),
}));

vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(inviteStore.state),
}));

import { RoomInviteModal } from "../lobby/RoomInviteModal.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

function renderInvite(locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(
    <TestI18nProvider locale={locale}><RoomInviteModal /></TestI18nProvider>,
  );
}

describe("room invite onboarding", () => {
  beforeEach(() => {
    inviteStore.joinRoom.mockReset();
    inviteStore.dismissInvite.mockReset();
    inviteStore.state = {
      inviteRoom: { code: "ABC123", format: "silver-age" },
      authUser: null,
      decks: [],
      joinRoom: inviteStore.joinRoom,
      dismissInvite: inviteStore.dismissInvite,
    } as unknown as StoreState;
  });

  it("offers account creation as the primary path for a new invitee", () => {
    const html = renderInvite();

    expect(html).toContain("You’ve been invited to play Silver Age");
    expect(html).toContain("Create Player Account");
    expect(html).toContain("I Have an Account");
    expect(html).toContain("Just spectate without an account");
  });

  it("sends an anonymous invitee straight to spectating when the room is full", () => {
    inviteStore.state = {
      ...inviteStore.state,
      inviteRoom: {
        code: "ABC123",
        format: "silver-age",
        spectateOnly: true,
      },
    };

    const html = renderInvite();

    expect(html).toContain("already has two players");
    expect(html).toContain("Spectate");
    expect(html).not.toContain("Create Player Account");
  });
});
