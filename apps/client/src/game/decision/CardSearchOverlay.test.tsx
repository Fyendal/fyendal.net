import { renderToStaticMarkup } from "react-dom/server";
import type { CardView, PendingDecision } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
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
    expect(model?.sections.map((section) => [section.zone, section.count])).toEqual([
      ["hand", 1],
      ["deck", 1],
      ["arsenal", 1],
    ]);
    expect(model?.optionByCardId.get(deckCard.instanceId)).toBe("12");
    expect(model?.optionByCardId.has(handCard.instanceId)).toBe(false);
    expect(model?.minimumSelections).toBe(0);
    expect(model?.maximumSelections).toBe(1);
  });

  it("renders all searched cards in a required zone-style dialog", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <CardSearchOverlay
          decision={searchDecision()}
          zoneCounts={{ hand: 1, deck: 1, arsenal: 1 }}
          onSubmit={() => undefined}
        />
      </TestI18nProvider>,
    );

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
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <MinimizedCardSearch
          prompt="Choose up to 3 more cards"
          onRestore={() => undefined}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain('class="card-search-minimized"');
    expect(html).toContain("Choose up to 3 more cards");
    expect(html).toContain("Restore search");
  });

  it("localizes the search chrome without changing the authored card prompt", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <CardSearchOverlay
          decision={searchDecision()}
          zoneCounts={{ hand: 1, deck: 1, arsenal: 1 }}
          onSubmit={() => undefined}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("手牌（1）");
    expect(html).toContain("牌库（1）");
    expect(html).toContain("Arsenal（1）");
    expect(html).toContain("完成");
    expect(html).toContain("Choose up to 1 more card with the named card&#x27;s name");
  });
});
