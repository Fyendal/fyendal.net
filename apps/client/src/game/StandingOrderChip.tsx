import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";
import { UiIcon } from "../components/UiIcon.js";
import { StandingOrderRows } from "./StandingOrderPanel.js";
import { activeOrderValues, type StandingOrderCardModel } from "./standingOrders.js";
import type { StandingOrderBoard } from "./useStandingOrders.js";

const POPOVER_WIDTH = 256;

/** A small raised control hanging off the card's bottom-left corner, in the
 * mat's gold-rimmed button language so it reads as something to press. The
 * caret says a choice opens; pressing it shows the card's standing orders
 * above the card. */
export function StandingOrderChip({
  model,
  onSetOrder,
}: {
  model: StandingOrderCardModel;
  onSetOrder: StandingOrderBoard["onSetOrder"];
}) {
  const intl = useIntl();
  const popoverId = `standing-order-popover-${useId()}`;
  const chipRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  const name = cardData[model.cardId]?.name ?? model.cardId;
  const set = activeOrderValues(model.rows).length > 0;

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      // Centre the dialog over the whole card, not the corner badge.
      const anchor = chipRef.current?.closest<HTMLElement>(".board-card-stack") ?? chipRef.current;
      if (!anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const half = POPOVER_WIDTH / 2;
      setPosition({
        left: Math.min(window.innerWidth - half - 8, Math.max(half + 8, bounds.left + bounds.width / 2)),
        bottom: window.innerHeight - bounds.top + 8,
      });
    };
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dialogRef.current?.contains(target) || chipRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  // Focus moves into the dialog when it opens and back to the badge when it
  // closes, so keyboard users never lose their place on the board.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && position) {
      (dialogRef.current?.querySelector<HTMLElement>("[aria-pressed='true']") ?? dialogRef.current)?.focus();
    } else if (wasOpen.current && !open) {
      chipRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, position]);

  const label = intl.formatMessage({ id: "game.standingOrder.title" }, { card: name });
  return (
    <>
      <button
        type="button"
        ref={chipRef}
        className={`standing-order-chip${set ? " standing-order-chip-set" : ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <UiIcon name="skip-forward" className="standing-order-chip-icon" />
        <UiIcon name="chevron-down" className="standing-order-chip-caret" />
      </button>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              id={popoverId}
              ref={dialogRef}
              role="dialog"
              tabIndex={-1}
              aria-label={label}
              className="float standing-order-popover"
              style={position}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <StandingOrderRows model={model} onSetOrder={onSetOrder} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
