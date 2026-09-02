import type { Format } from "@fyendal/shared";
import { useIntl, type IntlShape } from "react-intl";

export const FORMAT_LABELS: Record<Format, string> = {
  "classic-battles": "Classic Battles",
  cc: "Classic Constructed",
  "silver-age": "Silver Age",
};

const FORMAT_MESSAGE_IDS: Record<Format, string> = {
  "classic-battles": "format.classicBattles",
  cc: "format.classicConstructed",
  "silver-age": "format.silverAge",
};

const FORMAT_ENGLISH_SUBTITLES: Record<Format, string> = {
  "classic-battles": "Classic Battles",
  cc: "CC",
  "silver-age": "Silver Age",
};

export function formatLabel(intl: IntlShape, format: Format): string {
  return intl.formatMessage({ id: FORMAT_MESSAGE_IDS[format] });
}

/** A compact plain-text label for controls, such as native select options,
 * that cannot render the visual subtitle used by FormatName. */
export function formatSelectLabel(intl: IntlShape, format: Format): string {
  const localizedLabel = formatLabel(intl, format);
  if (intl.locale === "en") return localizedLabel;
  return `${localizedLabel} · ${FORMAT_ENGLISH_SUBTITLES[format]}`;
}

/** Localized format name with a compact English reference for non-English
 * locales. This keeps product format names recognizable across languages. */
export function FormatName({
  format,
  className,
}: {
  format: Format;
  className?: string;
}) {
  const intl = useIntl();
  const localizedLabel = formatLabel(intl, format);
  const englishSubtitle = intl.locale === "en" ? null : FORMAT_ENGLISH_SUBTITLES[format];

  return (
    <span
      className={className}
      aria-label={englishSubtitle ? `${localizedLabel} (${englishSubtitle})` : undefined}
    >
      <span className="format-name-primary">{localizedLabel}</span>
      {englishSubtitle ? (
        <span className="format-name-subtitle" lang="en" aria-hidden="true">
          {englishSubtitle}
        </span>
      ) : null}
    </span>
  );
}

const BADGE_CLASS: Record<Format, string> = {
  "classic-battles": "format-badge format-cb",
  cc: "format-badge format-cc",
  "silver-age": "format-badge format-sa",
};

export function FormatBadge({ format }: { format: Format }) {
  return <span className={BADGE_CLASS[format]}>{formatLabel(useIntl(), format)}</span>;
}
