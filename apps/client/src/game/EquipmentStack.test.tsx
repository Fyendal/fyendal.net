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

  it("renders only remaining dots for a multi-activation weapon", () => {
    const html = renderToStaticMarkup(createElement(EquipmentStack, {
      card: {
        instanceId: 5,
        cardId: "ARC040",
        owner: 0,
        remainingAbilityActivations: [2],
      },
      showActivationDots: true,
    }));

    expect(html).toContain('aria-label="2 activations remaining"');
    expect(html.match(/<span class="weapon-activation-dot(?: |")/g)).toHaveLength(2);
    expect(html).not.toContain("weapon-activation-dot-spent");
  });

  it("removes the indicator when only one activation remains", () => {
    const html = renderToStaticMarkup(createElement(EquipmentStack, {
      card: {
        instanceId: 7,
        cardId: "ARC040",
        owner: 0,
        remainingAbilityActivations: [1],
      },
      showActivationDots: true,
    }));

    expect(html).not.toContain("weapon-activation-dots");
  });

  it("does not render activation dots for an ordinary once-per-turn weapon", () => {
    const html = renderToStaticMarkup(createElement(EquipmentStack, {
      card: { instanceId: 6, cardId: "ARC040", owner: 0 },
      showActivationDots: true,
    }));

    expect(html).not.toContain("weapon-activation-dots");
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
      motionLocation: { kind: "board", seat: 0 },
      underCardMotionLocation: { kind: "soul", seat: 0 },
      highlighted: true,
      selected: true,
      soulCount: soul.length,
      soulCountLabel: "2 cards in soul",
      onClick: () => undefined,
    }));

    expect(html.match(/class="equipment-stack-card"/g)).toHaveLength(3);
    expect(html.indexOf('data-cardid="MON062"')).toBeLessThan(html.indexOf('data-cardid="MON063"'));
    expect(html.indexOf('data-cardid="MON063"')).toBeLessThan(html.indexOf('data-cardid="MON031"'));
    expect(html.match(/card-highlight/g)).toHaveLength(1);
    expect(html.match(/card-selected/g)).toHaveLength(1);
    expect(html).toContain('class="pip pile-pip equipment-stack-pip soul-pip"');
    expect(html).toContain('aria-label="2 cards in soul"');
    expect(html).toContain('src="/icons/soul.svg" width="24" height="24"');
    expect(html).toContain('class="soul-pip-count">2</span>');
    expect(html).toContain('data-motion-card="0:board:10"');
    expect(html).toContain('data-motion-card="0:soul:11"');
    expect(html).toContain('data-motion-card="0:soul:12"');
  });

  it("omits the hero soul icon at zero", () => {
    const html = renderToStaticMarkup(createElement(EquipmentStack, {
      card: { instanceId: 20, cardId: "MON031", owner: 0 },
      soulCount: 0,
      soulCountLabel: "0 cards in soul",
    }));

    expect(html).not.toContain("soul-pip");
    expect(html).not.toContain("0 cards in soul");
  });

  it("renders bound cards beneath a tapped ally in a landscape stack", () => {
    const ally: CardView = {
      instanceId: 30,
      cardId: "IAR059",
      owner: 0,
      tapped: true,
    };
    const marks: CardView[] = [
      { instanceId: 31, cardId: "IAR066", owner: 0, boundToInstanceId: ally.instanceId },
      { instanceId: 32, cardId: "IAR067", owner: 0, boundToInstanceId: ally.instanceId },
    ];

    const html = renderToStaticMarkup(createElement(EquipmentStack, {
      card: ally,
      underCards: marks,
      underCardMotionLocation: { kind: "board", seat: 0 },
      boundCount: marks.length,
      boundCountLabel: "2 bound cards",
    }));

    expect(html).toContain(
      'class="equipment-stack equipment-stack-bound equipment-stack-bound-tapped"',
    );
    expect(html.match(/equipment-stack-card equipment-stack-card-bound/g)).toHaveLength(2);
    expect(html.match(/data-bound-preview-card="true"/g)).toHaveLength(2);
    expect(html.indexOf('data-cardid="IAR066"')).toBeLessThan(html.indexOf('data-cardid="IAR067"'));
    expect(html.indexOf('data-cardid="IAR067"')).toBeLessThan(html.indexOf('data-cardid="IAR059"'));
    expect(html).toContain('aria-label="2 bound cards"');
    expect(html).toContain('src="/icons/bound.png" width="24" height="24"');
    expect(html).toContain('class="bound-pip-count">2</span>');
    expect(html).toContain('data-motion-card="0:board:31"');
    expect(html).toContain('data-motion-card="0:board:32"');
  });
});
