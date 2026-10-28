import { useIntl } from "react-intl";
import { UiIcon } from "../components/UiIcon.js";
import { PLAYMAT_IDS, playmatThumbnailUrl, type PlaymatId } from "../playmats.js";

/** Three mats fanned like cloth samples, bright one on top. */
const FAN: readonly PlaymatId[] = ["map-of-rathe", "isenloft", "monarch"];

/** A brass plaque in the table's own idiom: the whole plaque is the offer. */
export function PlaymatHintToast({
  onChoose,
  onDismiss,
}: {
  onChoose: () => void;
  onDismiss: () => void;
}) {
  const intl = useIntl();
  return (
    <div className="playmat-hint" role="status">
      <button type="button" className="playmat-hint-offer" onClick={onChoose}>
        <span className="playmat-hint-fan" aria-hidden="true">
          {FAN.map((id) => {
            const url = playmatThumbnailUrl(id);
            return url ? <img key={id} src={url} alt="" decoding="async" /> : null;
          })}
        </span>
        <span className="playmat-hint-copy">
          <span className="playmat-hint-title">
            {intl.formatMessage({ id: "game.playmatHint.title" })}
          </span>
          <span className="playmat-hint-body">
            {intl.formatMessage({ id: "game.playmatHint.body" }, { count: PLAYMAT_IDS.length - 1 })}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="playmat-hint-close"
        aria-label={intl.formatMessage({ id: "game.playmatHint.dismiss" })}
        onClick={onDismiss}
      >
        <UiIcon name="close" />
      </button>
    </div>
  );
}
