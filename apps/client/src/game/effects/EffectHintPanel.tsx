import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import { UiIcon } from "../../components/UiIcon.js";
import type { EffectHint } from "./effectHint.js";

/** A hovered effect chip spelled out: when it lasts on top, as a tag rather
 *  than a second sentence, then the effect itself. Docked above the source's
 *  card preview, or floating by the chip when there is no source card. */
export function EffectHintPanel({
  hint,
  style,
  floating = false,
}: {
  hint: EffectHint;
  style?: CSSProperties;
  floating?: boolean;
}) {
  const intl = useIntl();
  return (
    <div
      className={[
        "effect-hint",
        floating ? "effect-hint-floating" : "",
        hint.imposedBy ? "effect-imposed" : "",
        hint.inactive ? "effect-inactive" : "",
      ].filter(Boolean).join(" ")}
      style={style}
      role="tooltip"
    >
      <div className="effect-hint-meta">
        <span className="effect-hint-life">
          <UiIcon name={hint.icon} />
          {hint.duration}
        </span>
        {hint.imposedBy ? (
          <span className="effect-hint-imposed">
            {intl.formatMessage({ id: "game.effects.imposed" }, { hero: hint.imposedBy })}
          </span>
        ) : null}
        {hint.count > 1 ? (
          <span
            className="effect-hint-count"
            aria-label={intl.formatMessage({ id: "game.effects.identical" }, { count: hint.count })}
          >
            ×{hint.count}
          </span>
        ) : null}
      </div>
      <p className="effect-hint-summary">{hint.summary}</p>
    </div>
  );
}
