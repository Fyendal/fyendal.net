import { useId } from "react";
import { useIntl } from "react-intl";
import { CARD_POOL_MODES } from "./CardPoolModeControl.js";

/** The `?` beside a card pool field, describing every pool on hover or focus. */
export function CardPoolHelp() {
  const intl = useIntl();
  const tooltipId = useId();
  return (
    <>
      <button
        type="button"
        className="home-card-pool-help"
        aria-label={intl.formatMessage({ id: "lobby.cardPool.help" })}
        aria-describedby={tooltipId}
      >?</button>
      <div className="home-card-pool-tooltip" id={tooltipId} role="tooltip">
        <dl>
          {CARD_POOL_MODES.map((poolMode) => (
            <div key={poolMode}>
              <dt>{intl.formatMessage({ id: `lobby.cardPool.${poolMode}` })}</dt>
              <dd>{intl.formatMessage({ id: `lobby.cardPool.${poolMode}Description` })}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
