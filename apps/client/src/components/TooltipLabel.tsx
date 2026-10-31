import { useState, type HTMLAttributes, type ReactNode } from "react";
import { ViewportTooltip } from "./ViewportTooltip.js";

/** Compact non-interactive content (an icon and a value) whose full label is
 * its accessible name and a viewport tooltip on hover or keyboard focus. */
export function TooltipLabel({
  label,
  children,
  tooltipSide = "below",
  ...span
}: HTMLAttributes<HTMLSpanElement> & {
  label: string;
  children: ReactNode;
  tooltipSide?: "above" | "below";
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={label}
      {...span}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setAnchor(event.currentTarget); }}
      onPointerLeave={() => setAnchor(null)}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setAnchor(event.currentTarget); }}
      onBlur={() => setAnchor(null)}
    >
      {children}
      {anchor ? (
        <ViewportTooltip
          anchor={anchor}
          content={label}
          className="lobby-tooltip"
          gap={8}
          preferredSide={tooltipSide}
        />
      ) : null}
    </span>
  );
}
