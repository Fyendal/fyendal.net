import { describe, expect, it } from "vitest";
import {
  CARD_LONG_PRESS_MOVE_PX,
  cardLongPressMoved,
  mobileCardLongPressCardId,
} from "./mobileCardLongPress.js";

describe("mobile card long press", () => {
  it("keeps a press active through small finger movement", () => {
    expect(cardLongPressMoved(100, 200, 100 + CARD_LONG_PRESS_MOVE_PX, 195)).toBe(false);
  });

  it("cancels a press once movement exceeds the drag threshold", () => {
    expect(cardLongPressMoved(100, 200, 100, 200 + CARD_LONG_PRESS_MOVE_PX + 1)).toBe(true);
  });

  it("finds an actionable card for long-press inspection", () => {
    const target = {
      closest: (selector: string) => selector === ".overlay, .modal-surface-backdrop"
        ? null
        : selector === "[data-cardid]"
          ? { dataset: { cardid: "SEA225" }, className: "card-clickable" }
          : null,
    } as unknown as HTMLElement;

    expect(mobileCardLongPressCardId(target)).toBe("SEA225");
  });

  it("does not inspect a card through an open overlay", () => {
    const target = {
      closest: (selector: string) => selector === ".overlay, .modal-surface-backdrop"
        ? { className: "overlay" }
        : { dataset: { cardid: "SEA225" } },
    } as unknown as HTMLElement;

    expect(mobileCardLongPressCardId(target)).toBeNull();
  });

  it("does not start another inspection from the enlarged card modal", () => {
    const target = {
      closest: (selector: string) => selector.split(", ").includes(".modal-surface-backdrop")
        ? { className: "modal-surface-backdrop" }
        : selector === "[data-cardid]"
          ? { dataset: { cardid: "SEA225" } }
          : null,
    } as unknown as HTMLElement;

    expect(mobileCardLongPressCardId(target)).toBeNull();
  });
});
