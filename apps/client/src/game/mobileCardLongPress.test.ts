import { describe, expect, it } from "vitest";
import { CARD_LONG_PRESS_MOVE_PX, cardLongPressMoved } from "./mobileCardLongPress.js";

describe("mobile card long press", () => {
  it("keeps a press active through small finger movement", () => {
    expect(cardLongPressMoved(100, 200, 100 + CARD_LONG_PRESS_MOVE_PX, 195)).toBe(false);
  });

  it("cancels a press once movement exceeds the drag threshold", () => {
    expect(cardLongPressMoved(100, 200, 100, 200 + CARD_LONG_PRESS_MOVE_PX + 1)).toBe(true);
  });
});
