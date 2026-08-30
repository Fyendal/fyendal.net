import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PitchStack } from "./PitchStack.js";

describe("PitchStack", () => {
  it("shows every pitched card with the newest card in front", () => {
    const html = renderToStaticMarkup(createElement(PitchStack, {
      cards: [
        { instanceId: 11, cardId: "WTR160", owner: 0 },
        { instanceId: 12, cardId: "WTR161", owner: 0 },
        { instanceId: 13, cardId: "WTR162", owner: 0 },
      ],
      resources: 4,
    }));

    expect(html.match(/pitch-stack-card/g)).toHaveLength(3);
    expect(html).toContain('data-cardid="WTR160"');
    expect(html).toContain('data-cardid="WTR161"');
    expect(html).toContain('data-cardid="WTR162"');
    expect(html).toContain("translateY(-24px)");
    expect(html).toContain("translateY(-12px)");
    expect(html).toContain("translateY(-0px)");
    expect(html).toContain('class="pip pitch-pip" style="z-index:3">4</span>');
  });

  it("shows floating resources without requiring a pitched card", () => {
    const html = renderToStaticMarkup(createElement(PitchStack, {
      cards: [],
      resources: 2,
    }));

    expect(html).toContain("pitch-pip-bare");
    expect(html).not.toContain("pitch-stack-card");
  });
});
