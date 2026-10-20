import { describe, expect, it, vi } from "vitest";
import { hoverPreviewTarget } from "./hoverPreviewTarget.js";

describe("hoverPreviewTarget", () => {
  it("never previews the card under a standing-order badge or its dialog", () => {
    const card = { dataset: { cardid: "MON107" } } as unknown as HTMLElement;
    const chip = {} as HTMLElement;
    const target = {
      closest: vi.fn((selector: string) =>
        selector === ".standing-order-chip, .standing-order-popover" ? chip : card),
    } as unknown as HTMLElement;

    expect(hoverPreviewTarget(target)).toBeNull();
  });

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

  it("keeps the effect hint when hovering the nested card image", () => {
    const effect = {
      dataset: { cardid: "DTD230", effectSummary: "War" },
    } as unknown as HTMLElement;
    const nestedCard = { dataset: { cardid: "DTD230" } } as unknown as HTMLElement;
    const target = {
      closest: vi.fn((selector: string) => {
        if (selector === "[data-effect-summary]") return effect;
        if (selector === "[data-cardid]" || selector === "[data-cardid], [data-effect-summary]") return nestedCard;
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
