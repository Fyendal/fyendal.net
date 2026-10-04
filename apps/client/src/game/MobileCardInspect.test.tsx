import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { MobileCardInspect } from "./MobileCardInspect.js";

function inspect(cardId: string | null, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(createElement(TestI18nProvider, {
    locale,
    children: createElement(MobileCardInspect, { cardId, owner: 0, onClose: () => {} }),
  }));
}

describe("MobileCardInspect", () => {
  it.each(["DYN092", "DYN092B", "DTD164", "DTD164B"])(
    "offers a flip while initially showing the inspected face %s",
    (cardId) => {
      const html = inspect(cardId);
      expect(html).toContain('type="button">Flip card</button>');
      expect(html).toContain(`data-cardid="${cardId}"`);
      expect(html.match(/data-cardid=/g)).toHaveLength(1);
    },
  );

  it("does not offer a flip for a single-sided card", () => {
    expect(inspect("WTR160")).not.toContain("Flip card");
  });

  it("localizes the flip control", () => {
    expect(inspect("DYN092", "zh-Hans")).toContain("翻转卡牌");
  });

  it.each([null, "UNKNOWN"])("does not inspect an absent card %s", (cardId) => {
    expect(inspect(cardId)).toBe("");
  });
});
