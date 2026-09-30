import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;

export function viewportTooltipPosition(
  target: Pick<DOMRect, "left" | "top" | "bottom" | "width">,
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
  preferredSide: "above" | "below" = "below",
): { left: number; top: number } {
  const halfWidth = Math.min(tooltip.width, viewport.width - VIEWPORT_MARGIN * 2) / 2;
  const left = Math.min(
    viewport.width - VIEWPORT_MARGIN - halfWidth,
    Math.max(VIEWPORT_MARGIN + halfWidth, target.left + target.width / 2),
  );
  const below = target.bottom + gap;
  const above = target.top - gap - tooltip.height;
  const belowFits = below + tooltip.height <= viewport.height - VIEWPORT_MARGIN;
  const aboveFits = above >= VIEWPORT_MARGIN;
  const preferredTop = preferredSide === "above"
    ? aboveFits || !belowFits ? above : below
    : belowFits || !aboveFits ? below : above;
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(preferredTop, viewport.height - VIEWPORT_MARGIN - tooltip.height),
  );
  return { left, top };
}

/** Visual companion to a trigger's persistent aria-describedby text. */
export function ViewportTooltip(props: {
  anchor: HTMLElement | null;
  content: string;
  className?: string;
  gap?: number;
  preferredSide?: "above" | "below";
}) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const anchor = props.anchor;
    if (!anchor) return;
    const placeTooltip = () => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      setPosition(viewportTooltipPosition(
        anchor.getBoundingClientRect(),
        tooltip.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        props.gap,
        props.preferredSide,
      ));
    };
    placeTooltip();
    window.addEventListener("resize", placeTooltip);
    window.addEventListener("scroll", placeTooltip, true);
    return () => {
      window.removeEventListener("resize", placeTooltip);
      window.removeEventListener("scroll", placeTooltip, true);
    };
  }, [props.anchor, props.content, props.gap, props.preferredSide]);

  if (!props.anchor || typeof document === "undefined") return null;
  return createPortal(
    <span
      ref={tooltipRef}
      className={`viewport-tooltip${props.className ? ` ${props.className}` : ""}`}
      aria-hidden="true"
      style={position ?? { left: 0, top: 0, visibility: "hidden" }}
    >
      {props.content}
    </span>,
    document.body,
  );
}
