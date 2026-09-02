import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChainLinkView } from "@fyendal/shared";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { ChainFloat } from "./ChainFloat.js";
import { StackFloat } from "./StackFloat.js";

const link: ChainLinkView = {
  attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
  defendingCards: [],
  reactions: [],
  attackValue: 3,
  defenseValue: 0,
  damage: 3,
  resolved: false,
};

function renderCombatFloats(hidden: boolean) {
  const visibility = { hidden, setHidden: vi.fn() };
  return renderToStaticMarkup(createElement(
    TestI18nProvider,
    null,
    createElement(
      Fragment,
      null,
      createElement(StackFloat, {
        layers: [{ card: null, seat: 0, label: "On hit", optional: false }],
        visibility,
      }),
      createElement(ChainFloat, { links: [link], onRect: vi.fn(), visibility }),
    ),
  ));
}

describe("shared combat-float visibility", () => {
  it("shows both expanded windows together", () => {
    const html = renderCombatFloats(false);

    expect(html).toContain("stack-float");
    expect(html).toContain("chain-float");
    expect(html).not.toContain("stack-mini");
    expect(html).not.toContain("chain-mini");
  });

  it("minimizes both windows together", () => {
    const html = renderCombatFloats(true);

    expect(html).toContain("stack-mini");
    expect(html).toContain("chain-mini");
    expect(html).not.toContain("stack-float");
    expect(html).not.toContain("chain-float");
  });
});
