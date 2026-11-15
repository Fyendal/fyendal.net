import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoreState } from "../store/types.js";

const modalStore = vi.hoisted(() => ({ state: {} as StoreState }));
vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(modalStore.state),
}));

import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { CreateRoomModal } from "./CreateRoomModal.js";
import { FriendRoomModal } from "../social/FriendRoomModal.js";

function setStore() {
  modalStore.state = {
    friendInviteTarget: "bob",
    decks: [],
    cardPoolModes: { cc: "legal", "silver-age": "legal" },
    deckPlayedAt: {},
    socialError: null,
  } as unknown as StoreState;
}

describe("sandbox switch", () => {
  it("is offered, off, when inviting a friend", () => {
    setStore();
    const html = renderToStaticMarkup(<TestI18nProvider><FriendRoomModal /></TestI18nProvider>);
    expect(html).toMatch(/<label class="bot-matchmaking-option sandbox-option">.*<strong>Sandbox<\/strong>/);
    expect(html).toContain("Players can edit their own life, resources, deck, and hand. The game is not recorded.");
    expect(html).toMatch(/<input type="checkbox"\/><span class="switch-track"><\/span><\/label>/);
  });

  it("says it applies only to private rooms when creating a room", () => {
    setStore();
    const html = renderToStaticMarkup(<TestI18nProvider><CreateRoomModal onClose={() => {}} /></TestI18nProvider>);
    expect(html).toContain("Private rooms only. Players can edit their own life");
    expect(html).toMatch(/<input type="checkbox"\/><span class="switch-track"><\/span>/);
  });
});
