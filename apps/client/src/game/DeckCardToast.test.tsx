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
});
