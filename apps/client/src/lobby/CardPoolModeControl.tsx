import { useId } from "react";
import { useIntl } from "react-intl";
import type { CardPoolMode } from "@fyendal/shared";

const CARD_POOL_MODES = ["legal", "future", "open"] as const satisfies readonly CardPoolMode[];

export function CardPoolModeControl(props: {
  value: CardPoolMode;
  disabled?: boolean;
  className?: string;
  onChange: (mode: CardPoolMode) => void;
}) {
  const intl = useIntl();
  const controlId = useId();
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
              className={props.value === mode ? "selected" : ""}
              aria-describedby={`${controlId}-${mode}`}
              aria-pressed={props.value === mode}
              data-tooltip={description}
              disabled={props.disabled}
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
    </div>
  );
}
