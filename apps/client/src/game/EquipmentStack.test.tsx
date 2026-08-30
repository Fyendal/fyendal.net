import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardView } from "@fyendal/shared";
import { EquipmentStack } from "./EquipmentStack.js";

describe("EquipmentStack", () => {
  it("renders every nested public card for transformed heroes and constructs", () => {
    const card: CardView = {
      instanceId: 3,
      cardId: "DYN092B",
      owner: 0,
      subcards: [{
        instanceId: 2,
        cardId: "EVO018",
        owner: 0,
        subcards: [{ instanceId: 1, cardId: "EVO022", owner: 0 }],
      }],
    };

    const html = renderToStaticMarkup(createElement(EquipmentStack, { card }));

    expect(html).toContain('data-card-stack-id="3"');
    expect(html.match(/class="equipment-stack-card"/g)).toHaveLength(3);
    expect(html).toContain('data-cardid="EVO022"');
    expect(html).toContain('data-cardid="EVO018"');
    expect(html).toContain('data-cardid="DYN092B"');
    expect(html).toContain('class="pip pile-pip equipment-stack-pip">2</span>');
  });

  it("omits the underneath count when the permanent has no subcards", () => {
    const html = renderToStaticMarkup(createElement(EquipmentStack, {
      card: { instanceId: 4, cardId: "EVO022", owner: 0 },
    }));

    expect(html).not.toContain("equipment-stack-pip");
  });

  it("renders soul cards underneath the hero while keeping interaction on the hero", () => {
    const hero: CardView = { instanceId: 10, cardId: "MON031", owner: 0 };
    const soul: CardView[] = [
      { instanceId: 11, cardId: "MON062", owner: 0 },
      { instanceId: 12, cardId: "MON063", owner: 0 },
    ];

    const html = renderToStaticMarkup(createElement(EquipmentStack, {
      card: hero,
      underCards: soul,
      highlighted: true,
      selected: true,
      onClick: () => undefined,
    }));

    expect(html.match(/class="equipment-stack-card"/g)).toHaveLength(3);
    expect(html.indexOf('data-cardid="MON062"')).toBeLessThan(html.indexOf('data-cardid="MON063"'));
    expect(html.indexOf('data-cardid="MON063"')).toBeLessThan(html.indexOf('data-cardid="MON031"'));
    expect(html.match(/card-highlight/g)).toHaveLength(1);
    expect(html.match(/card-selected/g)).toHaveLength(1);
    expect(html).toContain('class="pip pile-pip equipment-stack-pip">2</span>');
  });
});
