import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";

const VIEWPORT_MARGIN = 8;
const GAP = 6;
const MENU_KEYS: ReadonlyMap<string, "next" | "previous" | "first" | "last"> = new Map([
  ["ArrowDown", "next"],
  ["ArrowUp", "previous"],
  ["Home", "first"],
  ["End", "last"],
]);

export interface ReplayMenuItem {
  key: string;
  icon: UiIconName;
  label: string;
  onSelect: () => void;
  /** Destructive items are separated from the rest. */
  danger?: boolean;
}

/** Right-aligned under the trigger, flipped above when the viewport bottom
 * would cut it off. */
export function replayMenuPosition(
  trigger: Pick<DOMRect, "top" | "bottom" | "right">,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(trigger.right - menu.width, viewport.width - VIEWPORT_MARGIN - menu.width),
  );
  const below = trigger.bottom + GAP;
  const fitsBelow = below + menu.height <= viewport.height - VIEWPORT_MARGIN;
  const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, trigger.top - GAP - menu.height);
  return { left, top };
}

/** The less frequent replay actions behind one overflow button. The menu is
 * portaled so scrolling panels never clip it; it closes on selection, Escape,
 * Tab, an outside press, or a scroll. */
export function ReplayActionsMenu({
  label,
  items,
  disabled,
}: {
  label: string;
  items: readonly ReplayMenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    setPosition(replayMenuPosition(
      triggerRef.current.getBoundingClientRect(),
      { width: menu.width, height: menu.height },
      { width: window.innerWidth, height: window.innerHeight },
    ));
  }, [open]);

  // The menu is hidden while it is measured, and hidden items cannot take focus.
  useEffect(() => {
    if (position) menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [position]);

  useEffect(() => {
    if (!open) return;
    const pressOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener("pointerdown", pressOutside);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", pressOutside);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const focusItem = (target: "next" | "previous" | "first" | "last") => {
    const entries = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const last = entries.length - 1;
    const next = target === "first" ? 0
      : target === "last" ? last
      : target === "next" ? (index + 1) % entries.length
      : index <= 0 ? last : index - 1;
    entries[next]?.focus();
  };

  return (
    <>
      <TooltipButton
        ref={triggerRef}
        className={`match-icon-button${open ? " is-open" : ""}`}
        tooltip={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <UiIcon name="more" />
      </TooltipButton>
      {open ? createPortal(
        <div
          ref={menuRef}
          className="replay-menu"
          role="menu"
          aria-label={label}
          style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            } else if (event.key === "Tab") {
              close(false);
            } else {
              const target = MENU_KEYS.get(event.key);
              if (!target) return;
              event.preventDefault();
              focusItem(target);
            }
          }}
        >
          {items.map((item, index) => (
            <Fragment key={item.key}>
              {item.danger && index > 0 ? <div role="separator" className="replay-menu-separator" /> : null}
              <button
                type="button"
                role="menuitem"
                className={`replay-menu-item${item.danger ? " is-danger" : ""}`}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                <UiIcon name={item.icon} />
                <span>{item.label}</span>
              </button>
            </Fragment>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
