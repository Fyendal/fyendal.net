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

  it("falls back to the nearest ordinary card or effect", () => {
    const fallback = {} as HTMLElement;
    const target = {
      closest: vi.fn((selector: string) =>
        selector === "[data-cardid], [data-effect-label]" ? fallback : null),
    } as unknown as HTMLElement;

    expect(hoverPreviewTarget(target)).toBe(fallback);
  });
});
