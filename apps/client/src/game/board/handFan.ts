import type { CSSProperties } from "react";

/** Per-card position in the arced hand; layout reads it from CSS. */
export function handFanSlotStyle(slot: number): CSSProperties {
  return { "--fan-slot": slot } as CSSProperties;
}
