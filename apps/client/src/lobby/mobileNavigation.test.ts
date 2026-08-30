import { describe, expect, it } from "vitest";
import { mobileDeckDestination, mobileLobbyDestinationSelected } from "./mobileNavigation.js";

describe("mobile lobby navigation", () => {
  it("treats both constructed formats as the Decks destination", () => {
    expect(mobileLobbyDestinationSelected("decks", "cc")).toBe(true);
    expect(mobileLobbyDestinationSelected("decks", "silver-age")).toBe(true);
    expect(mobileLobbyDestinationSelected("decks", "home")).toBe(false);
  });

  it("returns the session's most recently viewed deck format", () => {
    expect(mobileDeckDestination("silver-age")).toBe("silver-age");
  });
});
