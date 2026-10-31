import { useId, useState } from "react";
import { useIntl } from "react-intl";
import {
  PLAYMAT_IDS,
  playmatNameMessageId,
  playmatThumbnailUrl,
  type PlaymatId,
} from "../playmats.js";
import { SegmentedControl, SettingRow } from "./settingsControls.js";

type PlaymatSide = "own" | "bot";

const SIDE_CHOICES = [
  { value: "own", labelId: "settings.playmat.yours" },
  { value: "bot", labelId: "settings.playmat.bots" },
] as const;

/** Swatch grid for the two halves a player dresses: their own, seen by
 * opponents too, and a practice bot's. Native radios keep arrow-key navigation. */
export function PlaymatPicker({
  playmat,
  onPlaymatChange,
  botPlaymat,
  onBotPlaymatChange,
  labelledBy,
}: {
  playmat: PlaymatId;
  onPlaymatChange: (playmat: PlaymatId) => void;
  botPlaymat: PlaymatId;
  onBotPlaymatChange: (playmat: PlaymatId) => void;
  /** Id of the heading that names the swatch grid. */
  labelledBy: string;
}) {
  const intl = useIntl();
  const [side, setSide] = useState<PlaymatSide>("own");
  const noteId = useId();
  const selected = side === "own" ? playmat : botPlaymat;
  const choose = side === "own" ? onPlaymatChange : onBotPlaymatChange;
  return (
    <div className="settings-playmat">
      <SettingRow
        className="settings-choice-row"
        name={intl.formatMessage({ id: "settings.playmat.side" })}
        description={intl.formatMessage({ id: side === "own" ? "settings.playmat.yoursNote" : "settings.playmat.botsNote" })}
        descriptionId={noteId}
        control={
          <SegmentedControl
            choices={SIDE_CHOICES}
            value={side}
            onChange={setSide}
            label={intl.formatMessage({ id: "settings.playmat.side" })}
            describedBy={noteId}
          />
        }
      />
      <div className="playmat-picker" role="radiogroup" aria-labelledby={labelledBy}>
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
