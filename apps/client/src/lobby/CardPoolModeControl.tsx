import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import type { CardPoolMode } from "@fyendal/shared";

const CARD_POOL_MODES = ["legal", "future", "open"] as const satisfies readonly CardPoolMode[];
const TOOLTIP_GAP = 10;
const TOOLTIP_VIEWPORT_MARGIN = 8;
const TOOLTIP_MAX_WIDTH = 320;

interface TooltipPosition extends CSSProperties {
  left: number;
  top?: number;
  bottom?: number;
}

export function cardPoolTooltipPosition(
  target: Pick<DOMRect, "left" | "top" | "bottom" | "width">,
  viewport: { width: number; height: number },
): TooltipPosition {
  const availableWidth = Math.max(0, viewport.width - TOOLTIP_VIEWPORT_MARGIN * 2);
  const tooltipWidth = Math.min(TOOLTIP_MAX_WIDTH, availableWidth);
  const halfWidth = tooltipWidth / 2;
  const left = Math.min(
    viewport.width - TOOLTIP_VIEWPORT_MARGIN - halfWidth,
    Math.max(TOOLTIP_VIEWPORT_MARGIN + halfWidth, target.left + target.width / 2),
  );

  if (target.bottom + 88 <= viewport.height || target.top < viewport.height / 2) {
    return { left, top: target.bottom + TOOLTIP_GAP };
  }
  return { left, bottom: viewport.height - target.top + TOOLTIP_GAP };
}

export function CardPoolModeControl(props: {
  value: CardPoolMode;
  disabled?: boolean;
  className?: string;
  onChange: (mode: CardPoolMode) => void;
}) {
  const intl = useIntl();
  const controlId = useId();
  const buttonRefs = useRef<Partial<Record<CardPoolMode, HTMLButtonElement | null>>>({});
  const [hoveredMode, setHoveredMode] = useState<CardPoolMode | null>(null);
  const [focusedMode, setFocusedMode] = useState<CardPoolMode | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const activeMode = focusedMode ?? hoveredMode;

  useEffect(() => {
    if (!activeMode) {
      setTooltipPosition(null);
      return;
    }

    const placeTooltip = () => {
      const button = buttonRefs.current[activeMode];
      if (!button) return;
      setTooltipPosition(cardPoolTooltipPosition(button.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };
    placeTooltip();
    window.addEventListener("resize", placeTooltip);
    window.addEventListener("scroll", placeTooltip, true);
    return () => {
      window.removeEventListener("resize", placeTooltip);
      window.removeEventListener("scroll", placeTooltip, true);
    };
  }, [activeMode]);

  return (
    <div className={`card-pool-control${props.className ? ` ${props.className}` : ""}`}>
      <div
        className="card-pool-segments"
        data-mode={props.value}
        role="group"
        aria-label={intl.formatMessage({ id: "lobby.cardPool.title" })}
      >
        {CARD_POOL_MODES.map((mode) => {
          const description = intl.formatMessage({ id: `lobby.cardPool.${mode}Description` });
          return (
            <button
              type="button"
              key={mode}
              ref={(element) => {
                buttonRefs.current[mode] = element;
              }}
              className={props.value === mode ? "selected" : ""}
              aria-describedby={`${controlId}-${mode}`}
              aria-pressed={props.value === mode}
              data-tooltip={description}
              disabled={props.disabled}
              onPointerEnter={() => setHoveredMode(mode)}
              onPointerLeave={() => setHoveredMode((current) => current === mode ? null : current)}
              onFocus={() => setFocusedMode(mode)}
              onBlur={() => setFocusedMode((current) => current === mode ? null : current)}
              onClick={() => props.onChange(mode)}
            >
              {intl.formatMessage({ id: `lobby.cardPool.${mode}` })}
            </button>
          );
        })}
        {CARD_POOL_MODES.map((mode) => (
          <span className="card-pool-segment-description" id={`${controlId}-${mode}`} key={mode}>
            {intl.formatMessage({ id: `lobby.cardPool.${mode}Description` })}
          </span>
        ))}
      </div>
      {activeMode && tooltipPosition && typeof document !== "undefined"
        ? createPortal(
            <span className="card-pool-tooltip" style={tooltipPosition} aria-hidden="true">
              {intl.formatMessage({ id: `lobby.cardPool.${activeMode}Description` })}
            </span>,
            document.body,
          )
        : null}
    </div>
  );
}
