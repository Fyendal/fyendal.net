import { useRef, useState, type ReactNode } from "react";
import { ViewportTooltip } from "../components/ViewportTooltip.js";

/** Wraps a figure with an immediate custom tooltip explaining what it covers.
 * The hint is also the element's accessible name, so it is never hover-only. */
export function HoverHint({
  hint,
  className,
  children,
}: {
  hint: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  return (
    <>
      <span
        ref={ref}
        className={`hover-hint${className ? ` ${className}` : ""}`}
        tabIndex={0}
        aria-label={hint}
        onPointerEnter={() => setActive(true)}
        onPointerLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
      >
        {children}
      </span>
      {active ? <ViewportTooltip anchor={ref.current} content={hint} className="lobby-tooltip" gap={8} /> : null}
    </>
  );
}
