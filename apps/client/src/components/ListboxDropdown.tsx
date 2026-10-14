import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const DROPDOWN_GAP = 5;
const DROPDOWN_VIEWPORT_MARGIN = 8;
const DROPDOWN_MAX_HEIGHT = 260;
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const OPTION_SELECTOR = 'button[role="option"]:not(:disabled)';

function focusOption(list: HTMLElement | null, target: "selected" | "last") {
  if (!list) return;
  const options = [...list.querySelectorAll<HTMLButtonElement>(OPTION_SELECTOR)];
  const selected = list.querySelector<HTMLButtonElement>(`${OPTION_SELECTOR}[aria-selected="true"]`);
  (target === "last" ? options.at(-1) : selected ?? options[0])?.focus();
}

export interface ListboxSection<T> {
  key: string;
  /** Visible group heading; omit for an unlabeled group. */
  label?: ReactNode;
  /**
   * `suggested` highlights options the app recommends; `stock` recesses
   * built-in options listed after the user's own.
   */
  tone?: "suggested" | "stock";
  items: readonly T[];
}

/**
 * A field dropdown whose options need more than plain text (portraits,
 * recommendation tags, groups). Short plain lists stay native `<select>`s,
 * which keep the platform picker on phones. Both share the field skin.
 */
export function ListboxDropdown<T>({
  id,
  ariaLabel,
  sections,
  trigger,
  disabled = false,
  getKey,
  isSelected,
  isDisabled,
  renderOption,
  onOpen,
  onSelect,
}: {
  id?: string;
  ariaLabel: string;
  sections: readonly ListboxSection<T>[];
  /** Content of the closed control, normally the selected option. */
  trigger: ReactNode;
  disabled?: boolean;
  getKey: (item: T) => string;
  isSelected: (item: T) => boolean;
  isDisabled?: (item: T) => boolean;
  renderOption: (item: T) => ReactNode;
  onOpen?: () => void;
  onSelect: (item: T) => void;
}) {
  const groupId = useId();
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState({ placement: "below" as "above" | "below", maxHeight: DROPDOWN_MAX_HEIGHT });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"selected" | "last" | null>(null);
  const itemCount = sections.reduce((count, section) => count + section.items.length, 0);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("click", closeOnOutsideClick, true);
    return () => document.removeEventListener("click", closeOnOutsideClick, true);
  }, [open]);

  useEffect(() => {
    const target = focusOnOpen.current;
    focusOnOpen.current = null;
    if (open && target) focusOption(optionsRef.current, target);
  }, [open]);

  useClientLayoutEffect(() => {
    if (!open) return;
    const triggerElement = triggerRef.current;
    const options = optionsRef.current;
    if (!triggerElement || !options) return;

    let animationFrame: number | undefined;
    const updateLayout = () => {
      const triggerRect = triggerElement.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
      const navRect = document.querySelector<HTMLElement>(".mobile-lobby-nav")?.getBoundingClientRect();
      const bottomBoundary = navRect && navRect.height > 0
        ? Math.min(viewportBottom, navRect.top)
        : viewportBottom;
      const spaceAbove = Math.max(0, triggerRect.top - viewportTop - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN);
      const spaceBelow = Math.max(0, bottomBoundary - triggerRect.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN);
      const desiredHeight = Math.min(DROPDOWN_MAX_HEIGHT, options.scrollHeight);
      const placement = spaceBelow < desiredHeight && spaceAbove > spaceBelow ? "above" : "below";
      const maxHeight = Math.min(desiredHeight, placement === "above" ? spaceAbove : spaceBelow);

      setLayout((current) => current.placement === placement && current.maxHeight === maxHeight
        ? current
        : { placement, maxHeight });
    };
    const scheduleUpdate = () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updateLayout);
    };

    updateLayout();
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    document.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [itemCount, open]);

  const openList = (focus: "selected" | "last" | null) => {
    focusOnOpen.current = focus;
    onOpen?.();
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const target = event.key === "ArrowUp" ? "last" : "selected";
    if (open) focusOption(optionsRef.current, target);
    else openList(target);
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(OPTION_SELECTOR)];
    if (options.length === 0) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? options[Math.min(options.length - 1, index + 1)]
      : event.key === "ArrowUp" ? options[Math.max(0, index - 1)]
        : event.key === "Home" ? options[0]
          : event.key === "End" ? options.at(-1)
            : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div
      ref={dropdownRef}
      className="listbox"
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof Node && !event.currentTarget.contains(nextFocus)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="listbox-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onKeyDown={onTriggerKeyDown}
        onClick={() => {
          if (open) setOpen(false);
          else openList(null);
        }}
      >
        {trigger}
        <span className="listbox-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={optionsRef}
          className="listbox-options"
          role="listbox"
          aria-label={ariaLabel}
          data-placement={layout.placement}
          style={{ maxHeight: layout.maxHeight }}
          onKeyDown={onListKeyDown}
        >
          {sections.filter((section) => section.items.length > 0).map((section) => {
            const headingId = `${groupId}-${section.key}`;
            return (
              <div
                key={section.key}
                className="listbox-group"
                role="group"
                data-tone={section.tone}
                aria-labelledby={section.label ? headingId : undefined}
              >
                {section.label ? (
                  <div className="listbox-group-label" id={headingId} role="presentation">{section.label}</div>
                ) : null}
                {section.items.map((item) => (
                  <button
                    type="button"
                    key={getKey(item)}
                    role="option"
                    aria-selected={isSelected(item)}
                    disabled={isDisabled?.(item) ?? false}
                    onClick={() => {
                      onSelect(item);
                      closeList();
                    }}
                  >
                    {renderOption(item)}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
