import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import type { PassUntilMode } from "@fyendal/shared";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { passUntilHotkey } from "./passHotkey.js";

const MODES = ["opponent", "chain-link", "turn"] as const satisfies readonly PassUntilMode[];

const ICONS = { "chain-link": "effect-chain", turn: "effect-turn", opponent: "watch" } as const;

const SHORTCUTS = { opponent: "Shift+Space", "chain-link": "F4", turn: "F6" } as const;

/** Keycaps for a shortcut; Space reuses the board's Space keycap glyph. */
function ShortcutKeys({ mode }: { mode: PassUntilMode }) {
  return (
    <span className="pass-until-keys" aria-hidden="true">
      {SHORTCUTS[mode].split("+").map((key) =>
        key === "Space"
          ? <kbd key={key} className="shortcut-key" />
          : <kbd key={key} className="pass-until-keycap">{key === "Shift" ? "\u21e7" : key}</kbd>)}
    </span>
  );
}

/** Catalog stem per mode; a chain link is the open one or, with none, the next. */
function modeKey(mode: PassUntilMode, linkOpen: boolean): string {
  if (mode !== "chain-link") return mode;
  return linkOpen ? "chainLink" : "nextChainLink";
}

function armedMessageId(mode: PassUntilMode, linkOpen: boolean): string {
  return `game.passUntil.armed.${modeKey(mode, linkOpen)}`;
}

/** Phones get a sheet above the gamebar; wider boards drop from the toggle. */
const SHEET_MAX_WIDTH = 700;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 10;

/** Drops from the toggle like a split-button menu, right edges aligned;
 *  opens upward when the space below is short. Portalled so no game float
 *  stacks over it. */
function menuPosition(toggle: DOMRect, menu: DOMRect): { style: CSSProperties; above: boolean } {
  const above = toggle.bottom + MENU_GAP + menu.height > window.innerHeight - VIEWPORT_MARGIN
    && toggle.top - MENU_GAP - menu.height >= VIEWPORT_MARGIN;
  const right = Math.min(window.innerWidth - toggle.right, window.innerWidth - menu.width - VIEWPORT_MARGIN);
  return {
    above,
    style: above
      ? { bottom: window.innerHeight - toggle.top + MENU_GAP, right }
      : { top: toggle.bottom + MENU_GAP, right },
  };
}

/** Fast-forward segment beside Pass. Its menu keeps passing until the
 *  opponent acts, the chain link resolves, or the turn ends; while armed, the
 *  segment itself shows it. */
export function PassUntilControl({
  mode,
  linkOpen,
  paused,
  disabled = false,
  hotkeys = false,
  placement = "hud",
  onArm,
  onCancel,
}: {
  mode: PassUntilMode | null;
  /** A chain link is open, so the chain-link option covers it. */
  linkOpen: boolean;
  /** Armed, but the game waits on a choice the shortcut does not make. */
  paused: boolean;
  disabled?: boolean;
  /** Only one mounted control listens for the shortcuts. */
  hotkeys?: boolean;
  placement?: "hud" | "toolbar";
  onArm: (mode: PassUntilMode) => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [sheet, setSheet] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [above, setAbove] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const narrow = window.innerWidth <= SHEET_MAX_WIDTH;
      setSheet(narrow);
      const toggle = toggleRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      const placed = narrow || !toggle || !menu ? null : menuPosition(toggle, menu);
      setAbove(placed?.above ?? false);
      setPosition(placed?.style ?? {});
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const choose = (next: PassUntilMode) => {
    setOpen(false);
    if (next === mode) onCancel();
    else onArm(next);
  };

  // Focus lands once on opening, not again when the mode changes while open.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    if (!open) return;
    itemRefs.current[Math.max(0, MODES.indexOf(modeRef.current ?? "opponent"))]?.focus();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choiceRef = useRef(choose);
  choiceRef.current = choose;
  useEffect(() => {
    if (!hotkeys || disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const next = passUntilHotkey(event);
      if (!next) return;
      event.preventDefault();
      choiceRef.current(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, hotkeys]);

  // The board passes on Space at the window; inside the menu, Space and the
  // arrows operate the menu instead.
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      toggleRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.code === "Space" && !event.shiftKey) {
      event.stopPropagation();
    }
  };

  const armedLabel = mode ? intl.formatMessage({ id: armedMessageId(mode, linkOpen) }) : null;
  const pausedLabel = paused ? intl.formatMessage({ id: "game.passUntil.paused" }) : null;
  const toggleLabel = !armedLabel
    ? intl.formatMessage({ id: "game.passUntil.open" })
    : paused
      ? intl.formatMessage({ id: "game.passUntil.armedPaused" }, { mode: armedLabel })
      : armedLabel;
  return (
    <div ref={rootRef} className="pass-until">
      <TooltipButton
        ref={toggleRef}
        className={`pass-until-toggle${mode ? " pass-until-toggle-armed" : ""}`}
        tooltip={toggleLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-pressed={mode !== null}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <UiIcon name={mode ? ICONS[mode] : "skip-forward"} className="pass-until-toggle-icon" />
        {mode && !paused ? <span className="pass-until-run" aria-hidden="true" /> : null}
      </TooltipButton>
      {placement === "hud" ? (
        <span className="pass-until-live" role="status" aria-live="polite">
          {armedLabel ? toggleLabel : null}
        </span>
      ) : null}
      {open ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className={`pass-until-menu${sheet ? " pass-until-menu-sheet" : above ? " pass-until-menu-above" : ""}`}
          style={position ?? { visibility: "hidden" }}
          role="menu"
          aria-label={intl.formatMessage({ id: "game.passUntil.heading" })}
          onKeyDown={onMenuKeyDown}
        >
          {armedLabel ? (
            <p className="pass-until-heading pass-until-heading-armed">
              {armedLabel}
              {pausedLabel ? <span className="pass-until-heading-paused">{pausedLabel}</span> : null}
            </p>
          ) : (
            <p className="pass-until-heading" aria-hidden="true">
              {intl.formatMessage({ id: "game.passUntil.heading" })}
            </p>
          )}
          {MODES.map((option, index) => {
            const name = intl.formatMessage({ id: `game.passUntil.${modeKey(option, linkOpen)}` });
            return (
              <TooltipButton
                key={option}
                ref={(element) => { itemRefs.current[index] = element; }}
                role="menuitemradio"
                aria-label={name}
                aria-checked={mode === option}
                aria-keyshortcuts={SHORTCUTS[option]}
                className="pass-until-option"
                tooltip={intl.formatMessage({ id: `game.passUntil.${modeKey(option, true)}.detail` })}
                tooltipClassName="lobby-tooltip pass-until-tooltip"
                onClick={() => choose(option)}
              >
                <UiIcon name={ICONS[option]} className="pass-until-option-icon" />
                <span className="pass-until-option-name">{name}</span>
                <ShortcutKeys mode={option} />
              </TooltipButton>
            );
          })}
          {mode ? (
            <button
              ref={(element) => { itemRefs.current[MODES.length] = element; }}
              type="button"
              role="menuitem"
              className="pass-until-option pass-until-option-stop"
              onClick={() => {
                setOpen(false);
                onCancel();
              }}
            >
              {intl.formatMessage({ id: "game.passUntil.stop.label" })}
            </button>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
