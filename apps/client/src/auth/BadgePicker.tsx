import type { ReactNode } from "react";
import type { PlayerBadge } from "@fyendal/shared";
import { useIntl } from "react-intl";
import { UiIcon } from "../components/UiIcon.js";
import { PLAYER_BADGE_DETAILS } from "../game/PlayerBadge.js";

/** Badge art beside its visible name, or an empty slot for no badge. */
export function BadgeArt({ badge, size }: { badge: PlayerBadge | null; size: number }) {
  return badge ? (
    <img className="account-badge-art" src={PLAYER_BADGE_DETAILS[badge].image} width={size} height={size} alt="" />
  ) : (
    <span className="account-badge-art account-badge-none" style={{ width: size, height: size }} aria-hidden="true" />
  );
}

export function badgeMessageIds(badge: PlayerBadge | null): { name: string; description: string } {
  return badge
    ? { name: PLAYER_BADGE_DETAILS[badge].nameMessageId, description: PLAYER_BADGE_DETAILS[badge].descriptionMessageId }
    : { name: "account.badge.none", description: "account.badge.none.description" };
}

export function BadgePicker({
  availableBadges,
  selectedBadge,
  disabled = false,
  onSelect,
  lockedBadges = [],
}: {
  availableBadges: readonly PlayerBadge[];
  selectedBadge: PlayerBadge | null;
  disabled?: boolean;
  onSelect: (badge: PlayerBadge | null) => void;
  /** Unearned badges shown with how to earn them; never selectable. */
  lockedBadges?: ReadonlyArray<{ badge: PlayerBadge; requirement: ReactNode }>;
}) {
  const intl = useIntl();
  return (
    <fieldset className="account-badge-picker" disabled={disabled}>
      <legend>{intl.formatMessage({ id: "account.badge.displayed" })}</legend>
      {[null, ...availableBadges].map((badge) => {
        const ids = badgeMessageIds(badge);
        const selected = selectedBadge === badge;
        return (
          <label className={`account-badge-option${selected ? " selected" : ""}`} key={badge ?? "none"}>
            <input
              type="radio"
              name="account-badge"
              checked={selected}
              onChange={() => onSelect(badge)}
              data-modal-initial-focus={selected || undefined}
            />
            <BadgeArt badge={badge} size={32} />
            <span className="account-badge-copy">
              <strong>{intl.formatMessage({ id: ids.name })}</strong>
              <span>{intl.formatMessage({ id: ids.description })}</span>
            </span>
            <UiIcon name="check" className="account-badge-check" />
          </label>
        );
      })}
      {lockedBadges.map(({ badge, requirement }) => (
        <div className="account-badge-option locked" key={badge}>
          <BadgeArt badge={badge} size={32} />
          <span className="account-badge-copy">
            <strong>{intl.formatMessage({ id: PLAYER_BADGE_DETAILS[badge].nameMessageId })}</strong>
            <span>{requirement}</span>
          </span>
          <UiIcon name="lock" className="account-badge-lock" />
        </div>
      ))}
    </fieldset>
  );
}
