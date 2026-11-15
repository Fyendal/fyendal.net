import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CardView } from "@fyendal/shared";
import { DeckOrderEditor, DeckRevealConfirm, deckKeyTarget, reconcileDeckOrder } from "./DeckOrderEditor.js";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";

const DECK: CardView[] = [
  { instanceId: 11, cardId: "WTR098", name: "Sink Below", owner: 0 },
  { instanceId: 12, cardId: "WTR095", name: "Sigil of Solace", owner: 0 },
  { instanceId: 13, cardId: "WTR092", name: "Snatch", owner: 0 },
];

function render(overrides: Partial<ComponentProps<typeof DeckOrderEditor>> = {}): string {
  return renderToStaticMarkup(
    <TestI18nProvider locale="en">
      <DeckOrderEditor
        heroName="Dorinthea"
        deck={DECK}
        pending={false}
        refusal={null}
        onEdit={vi.fn()}
        onClearRefusal={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />
    </TestI18nProvider>,
  );
}

describe("DeckOrderEditor", () => {
  it("shows every card image in draw order with a position coin", () => {
    const html = render();
    expect(html).toContain("Dorinthea&#x27;s draw order");
    expect(html).toContain("3 cards");
    const cards = html.match(/<li class="deck-order-card" draggable="true">[^]*?<\/li>/g)!;
    expect(cards).toHaveLength(3);
    expect(cards[0]).toContain('data-cardid="WTR098"');
    expect(cards[0]).toContain('class="deck-order-position" aria-hidden="true">1</span>');
    expect(cards[0]).toMatch(/aria-label="[^"]+, position 1 of 3"/);
    expect(cards[2]).toContain('data-cardid="WTR092"');
    expect(cards[0]).toMatch(/aria-label="Move [^"]+ to the top"[^>]*disabled=""/);
    expect(cards[2]).toMatch(/aria-label="Move [^"]+ to the bottom"[^>]*disabled=""/);
    expect(html).not.toContain("trigger-order-grip");
    expect(html).toMatch(/class="btn-primary deck-order-apply" disabled="">Apply order</);
    expect(html).toContain("Card 1 is drawn next.");
  });

  it("shows a refusal and an empty deck", () => {
    const refused = render({ refusal: "SANDBOX_EDIT_UNAVAILABLE" });
    expect(refused).toContain('role="alert"');
    expect(refused).toContain("The deck can&#x27;t change right now.");
    expect(refused).not.toContain("aria-describedby");
    expect(render({ refusal: "SANDBOX_SEAT_FORBIDDEN" })).toContain("You can only edit your own hero.");
    const empty = render({ deck: [] });
    expect(empty).toContain("The deck is empty.");
    expect(empty).toMatch(/class="deck-order-shuffle" disabled=""/);
  });
});

describe("reconcileDeckOrder", () => {
  it("keeps an unchanged draft", () => {
    expect(reconcileDeckOrder([3, 1, 2], [1, 2, 3], [1, 2, 3])).toEqual({ order: [3, 1, 2], changed: false });
  });

  it("drops cards that left and appends new ones in server order", () => {
    expect(reconcileDeckOrder([3, 1, 2], [1, 2, 3], [2, 3, 9, 8])).toEqual({ order: [3, 2, 9, 8], changed: true });
  });

  it("flags a reshuffle of the same cards but keeps the draft", () => {
    expect(reconcileDeckOrder([3, 1, 2], [1, 2, 3], [2, 1, 3])).toEqual({ order: [3, 1, 2], changed: true });
  });

  it("handles an emptied deck", () => {
    expect(reconcileDeckOrder([2, 1], [1, 2], [])).toEqual({ order: [], changed: true });
  });
});

describe("deckKeyTarget", () => {
  it("steps with arrows and jumps with Home and End, stopping at the ends", () => {
    expect(deckKeyTarget("ArrowLeft", 2, 5)).toBe(1);
    expect(deckKeyTarget("ArrowDown", 2, 5)).toBe(3);
    expect(deckKeyTarget("Home", 2, 5)).toBe(0);
    expect(deckKeyTarget("End", 2, 5)).toBe(4);
    expect(deckKeyTarget("ArrowUp", 0, 5)).toBeNull();
    expect(deckKeyTarget("End", 4, 5)).toBeNull();
    expect(deckKeyTarget("Enter", 2, 5)).toBeNull();
  });
});

describe("DeckRevealConfirm", () => {
  const renderConfirm = (mine: boolean) => renderToStaticMarkup(
    <TestI18nProvider locale="en">
      <DeckRevealConfirm mine={mine} onConfirm={vi.fn()} onCancel={vi.fn()} />
    </TestI18nProvider>,
  );

  it("asks before showing the draw order of either deck", () => {
    const mine = renderConfirm(true);
    expect(mine).toContain("See the draw order?");
    expect(mine).toContain("This shows every card left in your deck, in draw order.");
    expect(mine).toContain(">Show draw order</button>");
    expect(mine).toContain(">Cancel</button>");
    expect(renderConfirm(false)).toContain("This shows every card left in your opponent&#x27;s deck, in draw order.");
  });
});
