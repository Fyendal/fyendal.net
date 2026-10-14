import { forwardRef, useState, type ButtonHTMLAttributes } from "react";
import { ViewportTooltip } from "./ViewportTooltip.js";

/** An icon button whose label is both its accessible name and a custom
 * viewport tooltip. Use this instead of the native `title` attribute. The
 * tooltip appears on hover and keyboard focus, and hides on press so it never
 * covers the surface the button opens. */
export const TooltipButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    tooltip: string;
    tooltipClassName?: string;
    tooltipSide?: "above" | "below";
  }
>(function TooltipButton(
  { tooltip, tooltipClassName = "lobby-tooltip", tooltipSide = "below", ...button },
  ref,
) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={tooltip}
        {...button}
        ref={ref}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setAnchor(event.currentTarget);
          button.onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          setAnchor(null);
          button.onPointerLeave?.(event);
        }}
        onPointerDown={(event) => {
          setAnchor(null);
          button.onPointerDown?.(event);
        }}
        onFocus={(event) => {
          // Focus restored after a pointer interaction is not focus-visible.
          if (event.currentTarget.matches(":focus-visible")) setAnchor(event.currentTarget);
          button.onFocus?.(event);
        }}
        onBlur={(event) => {
          setAnchor(null);
          button.onBlur?.(event);
        }}
      />
      {anchor ? (
        <ViewportTooltip
          anchor={anchor}
          content={tooltip}
          className={tooltipClassName}
          gap={8}
          preferredSide={tooltipSide}
        />
      ) : null}
    </>
  );
});
