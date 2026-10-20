import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { StandingOrderChip } from "./StandingOrderChip.js";
import { StandingOrderRows } from "./StandingOrderPanel.js";
import type { StandingOrderCardModel } from "./standingOrders.js";

const fealty: StandingOrderCardModel = {
  key: "fealty|0",
  cardId: "SFA037",
  rows: [{
    kind: "priority-window",
    timing: "end-of-turn",
    label: { id: "engine.term.card.destroy", values: { card: { kind: "card", cardId: "SFA037" } } },
    fallback: "Destroy Fealty",
    order: "ask",
  }],
};

const dynamo: StandingOrderCardModel = {
  key: "valiant dynamo|0",
  cardId: "MON107",
  rows: [
    { kind: "priority-window", timing: null, label: null, fallback: null, order: "pass" },
    {
      kind: "optional-trigger",
      timing: null,
      label: { id: "card.trigger.common.valiantdynamo.recover" },
      fallback: "Recover Valiant Dynamo",
      order: "no",
    },
  ],
};

function render(node: React.ReactElement, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(createElement(TestI18nProvider, { locale, children: node }));
}

describe("StandingOrderRows", () => {
  it("offers two answers for a priority window and three for an optional trigger", () => {
    const html = render(createElement(StandingOrderRows, { model: dynamo, onSetOrder: () => undefined }));
    expect(html.match(/standing-order-row"/g)).toHaveLength(2);
    expect(html).toContain("When its trigger is on the stack");
    expect(html).toContain("Recover Valiant Dynamo");
    expect(html).toContain('aria-pressed="true">Always pass<');
    expect(html).toContain('aria-pressed="true">Always deny<');
    expect(html).toContain(">Always use<");
    expect(html.match(/>Always ask</g)).toHaveLength(2);
    expect(html).toContain("standing-order-segmented-3");
  });

  it("names the trigger's timing so the row is not mistaken for an activated ability", () => {
    expect(render(createElement(StandingOrderRows, { model: fealty, onSetOrder: () => undefined })))
      .toContain("At the beginning of the end phase: Destroy Fealty");
    expect(render(createElement(StandingOrderRows, { model: fealty, onSetOrder: () => undefined }), "zh-Hans"))
      .toContain("结束阶段开始时：");
  });

  it("resolves card references inside the question label and localizes", () => {
    expect(render(createElement(StandingOrderRows, { model: fealty, onSetOrder: () => undefined })))
      .toContain("Destroy Fealty");
    expect(render(createElement(StandingOrderRows, { model: fealty, onSetOrder: () => undefined }), "zh-Hans"))
      .toContain("总是让过");
  });
});

describe("StandingOrderChip", () => {
  it("sits on the card as a badge that opens the card's standing orders", () => {
    const html = render(createElement(StandingOrderChip, { model: fealty, onSetOrder: () => undefined }));
    expect(html).toContain('class="standing-order-chip"');
    expect(html).toContain('aria-label="Standing orders for Fealty"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("skip-forward.svg");
    expect(html).not.toContain("standing-order-popover");
  });

  it("marks the badge once any order is set", () => {
    const html = render(createElement(StandingOrderChip, { model: dynamo, onSetOrder: () => undefined }));
    expect(html).toContain('class="standing-order-chip standing-order-chip-set"');
  });
});
