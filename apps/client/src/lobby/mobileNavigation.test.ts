import { describe, expect, it } from "vitest";
import { mobileLobbyDestinationSelected } from "./mobileNavigation.js";

describe("mobile lobby navigation", () => {
  it("selects the unified Decks destination", () => {
    expect(mobileLobbyDestinationSelected("decks", "decks")).toBe(true);
    expect(mobileLobbyDestinationSelected("decks", "home")).toBe(false);
  });
  it("keeps achievements under More on mobile", () => {
    expect(mobileLobbyDestinationSelected("more", "achievements")).toBe(true);
  });
  it("selects the match history destination", () => {
    expect(mobileLobbyDestinationSelected("history", "history")).toBe(true);
    expect(mobileLobbyDestinationSelected("more", "history")).toBe(false);
  });
});
