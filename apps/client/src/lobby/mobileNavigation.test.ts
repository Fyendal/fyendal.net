import { describe, expect, it } from "vitest";
import { mobileLobbyDestinationSelected } from "./mobileNavigation.js";

describe("mobile lobby navigation", () => {
  it("selects the unified Decks destination", () => {
    expect(mobileLobbyDestinationSelected("decks", "decks")).toBe(true);
    expect(mobileLobbyDestinationSelected("decks", "home")).toBe(false);
  });
});
