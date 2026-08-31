import { describe, expect, it, vi } from "vitest";
import {
  concealMotionDestination,
  MOTION_DESTINATION_HIDDEN_ATTRIBUTE,
  refreshMotionDestinationMasks,
  revealMotionDestination,
  type MaskedElementsByBatch,
} from "./motionDestinationMask.js";

function fakeElement() {
  const attributes = new Set<string>();
  const element = {
    setAttribute: vi.fn((name: string) => attributes.add(name)),
    removeAttribute: vi.fn((name: string) => attributes.delete(name)),
  } as unknown as HTMLElement;
  return { attributes, element };
}

describe("motion destination masks", () => {
  it("uses a dedicated attribute that card class rerenders cannot overwrite", () => {
    const target = fakeElement();

    concealMotionDestination(target.element);
    expect(target.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(true);
    revealMotionDestination(target.element);
    expect(target.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(false);
  });

  it("reasserts a mask and transfers it to a replacement presentation node", () => {
    const previous = fakeElement();
    const current = fakeElement();
    const masks: MaskedElementsByBatch = new Map([[
      "7",
      new Map([["0:hand:42", previous.element]]),
    ]]);

    refreshMotionDestinationMasks(
      masks,
      new Map([["0:hand:42", current.element]]),
    );

    expect(current.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(previous.element.removeAttribute).toHaveBeenCalledWith(
      MOTION_DESTINATION_HIDDEN_ATTRIBUTE,
    );
    expect(masks.get("7")?.get("0:hand:42")).toBe(current.element);
  });
});
