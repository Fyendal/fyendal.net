import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { DeckCardToast } from "./DeckCardToast.js";

describe("deck card toast", () => {
  it("localizes a card banished from deck in Chinese", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <DeckCardToast
          event={{
            kind: "banish",
            cardIds: [],
            label: "Banished from deck",
            sourceZone: "deck",
          }}
          viewerSeat={0}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("从牌库放逐");
    expect(html).not.toContain("Banished from deck");
  });

  it("shows each hero's revealed number and fills the higher one", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="en">
        <DeckCardToast
          event={{
            kind: "numbers",
            cardIds: [],
            label: "Spur Locked",
            numbers: [
              { seat: 0, heroName: "Min, Mad", number: 5 },
              { seat: 1, heroName: "Ira, Scarlet Revenger", number: 2 },
            ],
          }}
          viewerSeat={1}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("Spur Locked: numbers revealed");
    // the viewer's pick leads; the higher pick is the filled tile
    expect(html).toMatch(/number-reveal-mine">.*>2<.*>Ira<.*>vs<.*number-reveal-theirs number-reveal-highest">.*>5<.*>Min</);
  });

  it("marks a tie without filling either number", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="en">
        <DeckCardToast
          event={{
            kind: "numbers",
            cardIds: [],
            label: "Spur Locked",
            numbers: [
              { seat: 0, heroName: "Rhinar, Reckless Rampage", number: 3 },
              { seat: 1, heroName: "Cindra", number: 3 },
            ],
          }}
          viewerSeat={0}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain(">Tie<");
    expect(html).not.toContain("number-reveal-highest");
  });
});
