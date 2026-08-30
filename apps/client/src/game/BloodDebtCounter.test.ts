import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardView } from "@fyendal/shared";
import { BloodDebtCounter, countBloodDebtCards } from "./BloodDebtCounter.js";

const card = (instanceId: number, cardId: string): CardView => ({
  instanceId,
  cardId,
  owner: 0,
});

describe("BloodDebtCounter", () => {
  it("counts only banished cards whose metadata has Blood Debt", () => {
    expect(countBloodDebtCards([
      card(1, "LEV009"),
      card(2, "LEV010"),
      card(3, "WTR215"),
      card(4, ""),
    ])).toBe(2);
  });

  it("renders the Blood Debt icon and derived count", () => {
    const html = renderToStaticMarkup(createElement(BloodDebtCounter, {
      cards: [card(1, "LEV009"), card(2, "LEV010")],
    }));

    expect(html).toContain("/icons/blood-debt.svg");
    expect(html).toContain(">2</span>");
    expect(html).toContain("2 cards have Blood Debt in this banished zone");
  });

  it("stays hidden when the banished zone has no Blood Debt", () => {
    const html = renderToStaticMarkup(createElement(BloodDebtCounter, {
      cards: [card(1, "WTR215")],
    }));

    expect(html).toBe("");
  });
});
