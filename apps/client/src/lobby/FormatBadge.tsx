import type { Format } from "@fyendal/shared";

export const FORMAT_LABELS: Record<Format, string> = {
  "classic-battles": "Classic Battles",
  cc: "Classic Constructed",
  "silver-age": "Silver Age",
};

const BADGE_CLASS: Record<Format, string> = {
  "classic-battles": "format-badge format-cb",
  cc: "format-badge format-cc",
  "silver-age": "format-badge format-sa",
};

export function FormatBadge({ format }: { format: Format }) {
  return <span className={BADGE_CLASS[format]}>{FORMAT_LABELS[format]}</span>;
}
