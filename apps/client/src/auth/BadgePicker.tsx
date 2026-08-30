import type { PlayerBadge } from "@fyendal/shared";
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
  return (
    <fieldset className="account-badge-picker" disabled={disabled}>
      <legend>Displayed badge</legend>
      <label className={`account-badge-option${selectedBadge === null ? " selected" : ""}`}>
        <input
          type="radio"
          name="account-badge"
          checked={selectedBadge === null}
          onChange={() => onSelect(null)}
        />
        <span className="account-badge-none" aria-hidden="true">—</span>
        <span>No badge</span>
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
          <span>{PLAYER_BADGE_DETAILS[badge].name}</span>
        </label>
      ))}
    </fieldset>
  );
}
