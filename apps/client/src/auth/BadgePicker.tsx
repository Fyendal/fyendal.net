import type { PlayerBadge } from "@fyendal/shared";
import { useIntl } from "react-intl";
import { PLAYER_BADGE_DETAILS, PlayerBadgeMark } from "../game/PlayerBadge.js";

export function BadgePicker({
  availableBadges,
  selectedBadge,
  disabled = false,
  onSelect,
}: {
  availableBadges: readonly PlayerBadge[];
  selectedBadge: PlayerBadge | null;
  disabled?: boolean;
  onSelect: (badge: PlayerBadge | null) => void;
}) {
  const intl = useIntl();
  return (
    <fieldset className="account-badge-picker" disabled={disabled}>
      <legend>{intl.formatMessage({ id: "account.badge.displayed" })}</legend>
      <label className={`account-badge-option${selectedBadge === null ? " selected" : ""}`}>
        <input
          type="radio"
          name="account-badge"
          checked={selectedBadge === null}
          onChange={() => onSelect(null)}
        />
        <span className="account-badge-none" aria-hidden="true">—</span>
        <span>{intl.formatMessage({ id: "account.badge.none" })}</span>
      </label>
      {availableBadges.map((badge) => (
        <label
          className={`account-badge-option${selectedBadge === badge ? " selected" : ""}`}
          key={badge}
        >
          <input
            type="radio"
            name="account-badge"
            checked={selectedBadge === badge}
            onChange={() => onSelect(badge)}
          />
          <PlayerBadgeMark badge={badge} />
          <span>{intl.formatMessage({ id: PLAYER_BADGE_DETAILS[badge].nameMessageId })}</span>
        </label>
      ))}
    </fieldset>
  );
}
