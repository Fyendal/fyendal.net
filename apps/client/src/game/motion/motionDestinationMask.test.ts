import { describe, expect, it, vi } from "vitest";
import {
  activateMotionDestinationMasks,
  concealMotionDestination,
  MOTION_DESTINATION_HIDDEN_ATTRIBUTE,
  motionDestinationsRequiringEarlyMask,
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

  it("masks pending arrivals but leaves persistent reflows visible until activation", () => {
    const active = fakeElement();
    const drawn = fakeElement();
    const persistent = fakeElement();
    const elements = new Map([
      ["0:arsenal:41", active.element],
      ["0:hand:42", drawn.element],
      ["0:hand:43", persistent.element],
    ]);
    const masks: MaskedElementsByBatch = new Map();

    activateMotionDestinationMasks(
      "arsenal",
      [{ destinationPresentationKey: "0:arsenal:41" }],
      elements,
      masks,
    );

    expect(active.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(true);
    activateMotionDestinationMasks(
      "draw",
      motionDestinationsRequiringEarlyMask([
        { mode: "draw", destinationPresentationKey: "0:hand:42" },
        { mode: "reflow", destinationPresentationKey: "0:hand:43" },
      ]),
      elements,
      masks,
    );
    expect(drawn.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(true);
    expect(persistent.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(false);
    expect([...masks.keys()]).toEqual(["arsenal", "draw"]);

    activateMotionDestinationMasks(
      "carried-draw",
      motionDestinationsRequiringEarlyMask([{
        mode: "reflow",
        destinationPresentationKey: "0:hand:43",
        maskDestinationWhilePending: true,
      }]),
      elements,
      masks,
    );
    expect(persistent.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(true);

    activateMotionDestinationMasks(
      "draw",
      [
        { mode: "draw", destinationPresentationKey: "0:hand:42" },
        { mode: "reflow", destinationPresentationKey: "0:hand:43" },
      ],
      elements,
      masks,
    );
    expect(persistent.attributes.has(MOTION_DESTINATION_HIDDEN_ATTRIBUTE)).toBe(true);
  });
});
