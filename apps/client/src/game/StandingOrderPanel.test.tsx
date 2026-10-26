import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { StandingOrderChip } from "./StandingOrderChip.js";
import { StandingOrderRows } from "./StandingOrderPanel.js";
import type { StandingOrderCardModel } from "./standingOrders.js";

const cog: StandingOrderCardModel = {
  key: "golden cog|0",
  cardId: "SEA042",
  rows: [{
    hook: "sea-cog-maintenance",
    timing: "start-of-turn",
    label: { id: "card.trigger.steam.maintain" },
    fallback: "Remove a steam counter or destroy this",
    options: [
      { value: "remove", message: { id: "common.option.remove" } },
      { value: "destroy", message: { id: "common.option.destroy" } },
    ],
    order: null,
  }],
};

const dynamo: StandingOrderCardModel = {
  key: "valiant dynamo|0",
  cardId: "MON107",
  rows: [{
    hook: "trigger-choice",
    timing: "end-of-turn",
    label: { id: "card.trigger.common.valiantdynamo.recover" },
    fallback: "Recover Valiant Dynamo",
    options: [
      { value: "yes", message: { id: "common.option.yes" } },
      { value: "no", message: { id: "common.option.no" } },
    ],
    order: "no",
  }],
};

function render(node: React.ReactElement, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(createElement(TestI18nProvider, { locale, children: node }));
}

describe("StandingOrderRows", () => {
  it("offers Always ask plus each declared option of a trigger's choice", () => {
    const updates: unknown[] = [];
    const html = render(createElement(StandingOrderRows, {
      model: cog,
      onSetOrder: (...args) => updates.push(args),
    }));
    expect(html.match(/standing-order-row"/g)).toHaveLength(1);
    expect(html).toContain('aria-pressed="true">Always ask<');
    expect(html).toContain(">Remove<");
    expect(html).toContain(">Destroy<");
    expect(html).toContain("standing-order-segmented-3");
    expect(html).not.toContain("Always pass");
  });

  it("marks the stored option of an optional trigger", () => {
    const html = render(createElement(StandingOrderRows, { model: dynamo, onSetOrder: () => undefined }));
    expect(html).toContain("At the beginning of the end phase: Recover Valiant Dynamo");
    expect(html).toContain('aria-pressed="true">No<');
    expect(html).toContain('aria-pressed="false">Yes<');
  });

  it("names the trigger's timing so the row is not mistaken for an activated ability", () => {
    expect(render(createElement(StandingOrderRows, { model: cog, onSetOrder: () => undefined })))
      .toContain("At the start of the turn: ");
    expect(render(createElement(StandingOrderRows, { model: dynamo, onSetOrder: () => undefined }), "zh-Hans"))
      .toContain("结束阶段开始时：");
  });

  it("localizes the ask answer", () => {
    expect(render(createElement(StandingOrderRows, { model: cog, onSetOrder: () => undefined }), "zh-Hans"))
      .toContain("总是询问");
  });
});

describe("StandingOrderChip", () => {
  it("sits on the card as a badge that opens the card's standing orders", () => {
    const html = render(createElement(StandingOrderChip, { model: cog, onSetOrder: () => undefined }));
    expect(html).toContain('class="standing-order-chip"');
    expect(html).toContain('aria-label="Standing orders for Golden Cog"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("skip-forward.svg");
    expect(html).not.toContain("standing-order-popover");
  });

  it("marks the badge and names the set answer once an order is set", () => {
    const html = render(createElement(StandingOrderChip, { model: dynamo, onSetOrder: () => undefined }));
    expect(html).toContain('class="standing-order-chip standing-order-chip-set"');
    expect(html).toContain('aria-label="Standing orders for Valiant Dynamo: No"');
  });
});
