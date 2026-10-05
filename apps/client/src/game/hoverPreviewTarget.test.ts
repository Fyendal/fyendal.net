import { describe, expect, it, vi } from "vitest";
import { hoverPreviewTarget } from "./hoverPreviewTarget.js";

describe("hoverPreviewTarget", () => {
  it("selects the bound card inside an exposed stack layer", () => {
    const boundCard = {} as HTMLElement;
    const boundLayer = {
      querySelector: vi.fn(() => boundCard),
    } as unknown as HTMLElement;
    const target = {
      closest: vi.fn((selector: string) =>
        selector === "[data-bound-preview-card]" ? boundLayer : null),
    } as unknown as HTMLElement;

    expect(hoverPreviewTarget(target)).toBe(boundCard);
    expect(boundLayer.querySelector).toHaveBeenCalledWith("[data-cardid]");
  });

  it("keeps the effect tooltip when hovering the nested card image", () => {
    const effect = {
      dataset: { cardid: "DTD230", effectLabel: "War · next turn" },
    } as unknown as HTMLElement;
    const nestedCard = { dataset: { cardid: "DTD230" } } as unknown as HTMLElement;
    const target = {
      closest: vi.fn((selector: string) => {
        if (selector === "[data-effect-label]") return effect;
        if (selector === "[data-cardid]" || selector === "[data-cardid], [data-effect-label]") return nestedCard;
        return null;
      }),
    } as unknown as HTMLElement;

    expect(hoverPreviewTarget(target)).toBe(effect);
  });

  it("falls back to the nearest ordinary card", () => {
    const fallback = {} as HTMLElement;
    const target = {
      closest: vi.fn((selector: string) =>
        selector === "[data-cardid]" ? fallback : null),
    } as unknown as HTMLElement;

    expect(hoverPreviewTarget(target)).toBe(fallback);
  });
});
