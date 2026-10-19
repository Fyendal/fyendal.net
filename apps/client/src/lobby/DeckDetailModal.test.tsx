import { renderToStaticMarkup } from "react-dom/server";
import type { DeckSummary } from "@fyendal/protocol";
import { describe, expect, it, vi } from "vitest";
import type { StoreState } from "../store/types.js";

const modalStore = vi.hoisted(() => ({ state: {} as StoreState }));
vi.mock("../store.js", () => ({
  useStore: (selector: (state: StoreState) => unknown) => selector(modalStore.state),
}));

import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { DeckDetailModal } from "./DeckDetailModal.js";

const deck: DeckSummary = {
  id: "cc",
  name: "Bravo Deck",
  format: "cc",
  fabraryUrl: null,
  heroName: "Bravo",
  deckSize: 80,
  updatedAt: 1,
};

function render(props: { deck?: DeckSummary; href?: string; queued?: boolean; pool?: "legal" | "future" | "open" }) {
  modalStore.state = {
    authUser: null,
    cardPoolModes: { cc: props.pool ?? "legal", "silver-age": "legal" },
    queuedFormat: props.queued ? "cc" : null,
  } as StoreState;
  return renderToStaticMarkup(
    <TestI18nProvider>
      <DeckDetailModal deck={props.deck ?? deck} fabraryHref={props.href}
        onEdit={() => {}} onDelete={() => {}} onClose={() => {}} />
    </TestI18nProvider>,
  );
}

describe("DeckDetailModal", () => {
  it("offers starting a game, Fabrary, edit, and delete", () => {
    const html = render({ href: "https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7" });
    expect(html).toContain("Bravo Deck");
    expect(html).toContain("Bravo · 80 cards");
    expect(html).toMatch(/aria-pressed="(true|false)"><span class="ui-icon"[^>]*><\/span>Find match<\/button>/);
    expect(html).toContain("Invite friend</button>");
    expect(html).toContain("Play vs bot</button>");
    expect(html).toMatch(/<select[^>]*>.*<option value="legal" selected="">Legal<\/option>/);
    expect(html).toMatch(/class="btn-cta deck-detail-start"[^>]*>Start<\/button>/);
    expect(html).toContain('href="https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("View on Fabrary");
    expect(html).toContain("Edit deck");
    expect(html).toContain("Delete deck");
  });

  it("omits the Fabrary link for pasted lists", () => {
    expect(render({})).not.toContain("View on Fabrary");
  });

  it("blocks starting with cards the chosen pool rejects", () => {
    const future = { ...deck, futureCards: ["Shiny Card"] };
    const blocked = render({ deck: future });
    expect(blocked).toContain("Illegal cards: Shiny Card");
    expect(blocked).toMatch(/class="btn-cta deck-detail-start" disabled=""/);
    expect(render({ deck: future, pool: "future" })).not.toContain("Illegal cards");
  });

  it("offers cancelling an active search instead of starting", () => {
    const html = render({ queued: true });
    expect(html).toContain("Cancel match search");
    expect(html).not.toContain(">Start</button>");
  });
});
