import { useEffect, useRef, useState } from "react";

/** Drag state for a floating window. Spread `dragProps` on the float's
 *  container; buttons and clickable cards inside are excluded so clicks still
 *  work (pointer capture on the container would swallow their click).
 *  `axis: "y"` locks the window to vertical movement (horizontal position
 *  keeps coming from the CSS default); `hTransform` is the transform the
 *  dragged style must keep to preserve that CSS anchoring — `translateX(-50%)`
 *  for left-anchored centering (chain), `none` for right-anchored (status). */
export function useFloatDrag(opts?: {
  axis?: "y";
  hTransform?: string;
  /** Changing this starts the next float at its CSS-defined position. */
  resetKey?: string;
}) {
  const resetKey = opts?.resetKey;
  const [position, setPosition] = useState<{
    resetKey: string | undefined;
    x: number;
    y: number;
  } | null>(null);
  const pos = position?.resetKey === resetKey ? position : null;
  const drag = useRef<{
    resetKey: string | undefined;
    dx: number;
    dy: number;
  } | null>(null);
  useEffect(() => {
    setPosition(null);
    drag.current = null;
  }, [resetKey]);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Mobile floats are positioned as scrollable sheets. Let touch gestures
    // scroll their contents instead of capturing them as drag operations.
    if (window.matchMedia("(max-width: 700px)").matches) return;
    if ((e.target as HTMLElement).closest("button, .card-clickable")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      resetKey,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.resetKey !== resetKey) return;
    // clamp to the viewport so a float can't be dragged fully off-screen
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    setPosition({
      resetKey,
      x: clamp(e.clientX - drag.current.dx, window.innerWidth - rect.width),
      y: clamp(e.clientY - drag.current.dy, window.innerHeight - rect.height),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  return {
    /** current drag offset; null until first dragged */
    pos,
    /** inline style overriding the CSS default position once dragged */
    style: pos
      ? opts?.axis === "y"
        ? ({ top: pos.y, transform: opts.hTransform ?? "translateX(-50%)" } as const)
        : ({ left: pos.x, top: pos.y, right: "auto", bottom: "auto", transform: "none" } as const)
      : undefined,
    dragProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
