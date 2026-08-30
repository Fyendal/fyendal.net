import { describe, expect, it } from "vitest";
import type { CardView } from "@fyendal/shared";
import { visibleDeckTop } from "./visibleDeckTop.js";

const top: CardView = { instanceId: 1, cardId: "AIO012", owner: 0 };

describe("visible deck top", () => {
  it("places Dash I/O's projected visible top card in the deck zone", () => {
    const player = { visibleDeckTop: top };
    expect(visibleDeckTop(player)).toBe(top);
  });

  it("keeps Dash I/O's new top card facedown while the deck shuffles", () => {
    const player = { visibleDeckTop: top };
    expect(visibleDeckTop(player, true)).toBeUndefined();
    expect(visibleDeckTop(player, false)).toBe(top);
  });
});
