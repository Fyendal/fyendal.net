import { useState } from "react";
import { useIntl } from "react-intl";
import {
  PLAYMAT_IDS,
  playmatNameMessageId,
  playmatThumbnailUrl,
  type PlaymatId,
} from "../playmats.js";

type PlaymatSide = "own" | "bot";

/** Swatch grid for the two halves a player dresses: their own, seen by
 * opponents too, and a practice bot's. Native radios keep arrow-key navigation. */
export function PlaymatPicker({
  playmat,
  onPlaymatChange,
  botPlaymat,
  onBotPlaymatChange,
}: {
  playmat: PlaymatId;
  onPlaymatChange: (playmat: PlaymatId) => void;
  botPlaymat: PlaymatId;
  onBotPlaymatChange: (playmat: PlaymatId) => void;
}) {
  const intl = useIntl();
  const [side, setSide] = useState<PlaymatSide>("own");
  const selected = side === "own" ? playmat : botPlaymat;
  const choose = side === "own" ? onPlaymatChange : onBotPlaymatChange;
  return (
    <div className="settings-control-row settings-playmat-row">
      <div className="settings-playmat-head">
        <span className="settings-control-name" id="settings-playmat-label">
          {intl.formatMessage({ id: "settings.playmat" })}
        </span>
        <div
          className="settings-segmented"
          role="group"
          aria-label={intl.formatMessage({ id: "settings.playmat.side" })}
        >
          <button
            type="button"
            className={side === "own" ? "settings-selected" : ""}
            aria-pressed={side === "own"}
            onClick={() => setSide("own")}
          >
            {intl.formatMessage({ id: "settings.playmat.yours" })}
          </button>
          <button
            type="button"
            className={side === "bot" ? "settings-selected" : ""}
            aria-pressed={side === "bot"}
            onClick={() => setSide("bot")}
          >
            {intl.formatMessage({ id: "settings.playmat.bots" })}
          </button>
        </div>
      </div>
      <p className="settings-playmat-note">
        {intl.formatMessage({ id: side === "own" ? "settings.playmat.yoursNote" : "settings.playmat.botsNote" })}
      </p>
      <div className="playmat-picker" role="radiogroup" aria-labelledby="settings-playmat-label">
        {PLAYMAT_IDS.map((id) => {
          const thumbnail = playmatThumbnailUrl(id);
          return (
            <label
              key={id}
              className={`playmat-swatch${selected === id ? " playmat-swatch-selected" : ""}`}
              data-playmat={id}
            >
              <input
                type="radio"
                name={`playmat-${side}`}
                value={id}
                checked={selected === id}
                onChange={() => choose(id)}
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
