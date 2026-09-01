import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CardView, PendingDecision } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  CardSearchOverlay,
  MinimizedCardSearch,
  cardSearchOverlayModel,
  isCardSearchOverlayDecision,
  toggleCardSearchSelection,
} from "./CardSearchOverlay.js";

const handCard: CardView = { instanceId: 11, cardId: "HAND", owner: 1 };
const deckCard: CardView = { instanceId: 12, cardId: "DECK", owner: 1 };
const arsenalCard: CardView = { instanceId: 13, cardId: "ARSENAL", owner: 1 };

function searchDecision(): PendingDecision {
  return {
    player: 0,
    kind: "choose-target",
    prompt: "Choose up to 1 more card with the named card's name",
    options: ["12"],
    optionCards: [deckCard],
    lookedCards: [handCard, deckCard, arsenalCard],
    minimumSelections: 0,
    maximumSelections: 1,
  };
}

describe("private card search overlay", () => {
  it("groups the complete searched zones while keeping only matching cards selectable", () => {
    const decision = searchDecision();
    const model = cardSearchOverlayModel(decision, { hand: 1, deck: 1, arsenal: 1 });

    expect(isCardSearchOverlayDecision(decision)).toBe(true);
    expect(model?.sections.map((section) => section.label)).toEqual([
      "Hand (1)",
      "Deck (1)",
      "Arsenal (1)",
    ]);
    expect(model?.optionByCardId.get(deckCard.instanceId)).toBe("12");
    expect(model?.optionByCardId.has(handCard.instanceId)).toBe(false);
    expect(model?.minimumSelections).toBe(0);
    expect(model?.maximumSelections).toBe(1);
  });

  it("renders all searched cards in a required zone-style dialog", () => {
    const html = renderToStaticMarkup(createElement(CardSearchOverlay, {
      decision: searchDecision(),
      zoneCounts: { hand: 1, deck: 1, arsenal: 1 },
      onSubmit() {},
    }));

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Search opponent&#x27;s hand, deck, and arsenal");
    expect(html).toContain("Hand (1)");
    expect(html).toContain("Deck (1)");
    expect(html).toContain("Arsenal (1)");
    expect(html).toContain('data-cardid="HAND"');
    expect(html).toContain('data-cardid="DECK"');
    expect(html).toContain('data-cardid="ARSENAL"');
    expect(html.match(/class="card-action"/g)).toHaveLength(1);
    expect(html).not.toContain("card-dim");
    expect(html).toContain('aria-label="Minimize card search"');
    expect(html).toContain(">Done</button>");
  });

  it("toggles selections locally and refuses a fourth selection", () => {
    let selected: readonly string[] = [];
    selected = toggleCardSearchSelection(selected, "1", 3);
    selected = toggleCardSearchSelection(selected, "2", 3);
    selected = toggleCardSearchSelection(selected, "3", 3);

    expect(toggleCardSearchSelection(selected, "4", 3)).toBe(selected);
    expect(toggleCardSearchSelection(selected, "2", 3)).toEqual(["1", "3"]);
  });

  it("renders a compact restore control while minimized", () => {
    const html = renderToStaticMarkup(createElement(MinimizedCardSearch, {
      prompt: "Choose up to 3 more cards",
      onRestore() {},
    }));

    expect(html).toContain('class="card-search-minimized"');
    expect(html).toContain("Choose up to 3 more cards");
    expect(html).toContain("Restore search");
  });
});
