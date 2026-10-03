import type { CardView } from "@fyendal/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
import { SquareCardPresentation } from "../Card.js";
import { ZoneOverlay, sortZoneCards } from "./ZoneOverlay.js";

const cards: CardView[] = [
  { instanceId: 1, cardId: "UNKNOWN-Z", name: "Zulu", owner: 0 },
  { instanceId: 2, cardId: "UNKNOWN-A-1", name: "Alpha", owner: 0 },
  { instanceId: 3, cardId: "UNKNOWN-A-2", name: "alpha", owner: 0 },
];

const pitchedCards: CardView[] = [
  { instanceId: 11, cardId: "WTR217", owner: 0 }, // Sink Below (blue)
  { instanceId: 12, cardId: "WTR219", owner: 0 }, // Nimblism (yellow)
  { instanceId: 13, cardId: "WTR215", owner: 0 }, // Sink Below (red)
  { instanceId: 14, cardId: "WTR220", owner: 0 }, // Nimblism (blue)
  { instanceId: 15, cardId: "WTR216", owner: 0 }, // Sink Below (yellow)
  { instanceId: 16, cardId: "WTR218", owner: 0 }, // Nimblism (red)
];

describe("shared zone overlay sorting", () => {
  it("preserves zone order unless card-name sorting is selected", () => {
    expect(sortZoneCards(cards, "zone")).toBe(cards);
    expect(sortZoneCards(cards, "name").map((card) => card.instanceId)).toEqual([2, 3, 1]);
  });

  it("sorts by pitch first and card name second", () => {
    expect(sortZoneCards(pitchedCards, "pitch").map((card) => card.instanceId)).toEqual([
      16, 13, // red: Nimblism, Sink Below
      12, 15, // yellow: Nimblism, Sink Below
      14, 11, // blue: Nimblism, Sink Below
    ]);
  });

  it("sorts by card name first and red-yellow-blue pitch second", () => {
    expect(sortZoneCards(pitchedCards, "name").map((card) => card.instanceId)).toEqual([
      16, 12, 14, // Nimblism: red, yellow, blue
      13, 15, 11, // Sink Below: red, yellow, blue
    ]);
  });

  it("offers the same localized sort control in the shared zone viewer", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <ZoneOverlay
          overlay={{ title: "Your Graveyard", cards, inactiveZone: true }}
          yourSeat={0}
          onClose={() => undefined}
          onInspectCard={() => undefined}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("Sort by");
    expect(html).toContain('<option value="zone" selected="">Zone order</option>');
    expect(html).toContain('<option value="pitch">Pitch</option>');
    expect(html).toContain('<option value="name">Name</option>');
    expect(html.indexOf('data-cardid="UNKNOWN-Z"')).toBeLessThan(
      html.indexOf('data-cardid="UNKNOWN-A-1"'),
    );
  });

  it.each([
    ["Graveyard", true],
    ["Banished", true],
    ["Deck", false],
  ] as const)("shows full cards in the %s viewer even on a square board", (title, inactiveZone) => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <SquareCardPresentation enabled>
          <ZoneOverlay
            overlay={{ title, cards: [{ instanceId: 20, cardId: "WTR160", owner: 0 }], inactiveZone }}
            yourSeat={0}
            onClose={() => undefined}
            onInspectCard={() => undefined}
          />
        </SquareCardPresentation>
      </TestI18nProvider>,
    );

    expect(html).toContain("card-zone");
    expect(html).not.toContain("card-board-square");
  });

  it("keeps face-down banished cards full-sized without revealing their identity", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <SquareCardPresentation enabled>
          <ZoneOverlay
            overlay={{
              title: "Banished",
              cards: [{ instanceId: 21, cardId: "WTR160", owner: 1, faceDown: true }],
              inactiveZone: true,
            }}
            yourSeat={0}
            onClose={() => undefined}
            onInspectCard={() => undefined}
          />
        </SquareCardPresentation>
      </TestI18nProvider>,
    );

    expect(html).toContain("card-back");
    expect(html).not.toContain("card-back-square");
    expect(html).not.toContain('data-cardid="WTR160"');
  });
});
