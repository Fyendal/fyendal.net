import { useIntl } from "react-intl";
import {
  PLAYMAT_IDS,
  playmatNameMessageId,
  playmatThumbnailUrl,
  type PlaymatId,
} from "../playmats.js";

/** Swatch strip of arena surfaces; native radios keep arrow-key navigation. */
export function PlaymatPicker({
  playmat,
  onPlaymatChange,
}: {
  playmat: PlaymatId;
  onPlaymatChange: (playmat: PlaymatId) => void;
}) {
  const intl = useIntl();
  return (
    <div className="settings-control-row settings-playmat-row">
      <span className="settings-control-name" id="settings-playmat-label">
        {intl.formatMessage({ id: "settings.playmat" })}
      </span>
      <div className="playmat-picker" role="radiogroup" aria-labelledby="settings-playmat-label">
        {PLAYMAT_IDS.map((id) => {
          const thumbnail = playmatThumbnailUrl(id);
          return (
            <label
              key={id}
              className={`playmat-swatch${playmat === id ? " playmat-swatch-selected" : ""}`}
              data-playmat={id}
            >
              <input
                type="radio"
                name="playmat"
                value={id}
                checked={playmat === id}
                onChange={() => onPlaymatChange(id)}
              />
              <span className="playmat-swatch-art">
                {thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" /> : null}
              </span>
              <span className="playmat-swatch-name">
                {intl.formatMessage({ id: playmatNameMessageId(id) })}
              </span>
            </label>
          );
        })}
      </div>
      <p className="playmat-credit">{intl.formatMessage({ id: "settings.playmat.credit" })}</p>
    </div>
  );
}
