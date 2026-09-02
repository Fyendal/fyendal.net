import { useId } from "react";
import type { PlayerBadge } from "@fyendal/shared";
import { useIntl } from "react-intl";

export const PLAYER_BADGE_DETAILS: Record<PlayerBadge, {
  nameMessageId: string;
  descriptionMessageId: string;
  image: string;
}> = {
  "early-tester": {
    nameMessageId: "account.badge.earlyTester.name",
    descriptionMessageId: "account.badge.earlyTester.description",
    image: "/logo.png",
  },
};

export function PlayerBadgeMark({ badge }: { badge: PlayerBadge }) {
  const intl = useIntl();
  const details = PLAYER_BADGE_DETAILS[badge];
  const name = intl.formatMessage({ id: details.nameMessageId });
  const tooltipId = useId();
  return (
    <span className="player-badge-mark" tabIndex={0} aria-describedby={tooltipId}>
      <img
        className="player-nameplate-badge"
        src={details.image}
        width={20}
        height={20}
        alt={intl.formatMessage({ id: "account.badge.imageAlt" }, { name })}
      />
      <span className="player-badge-tooltip" id={tooltipId} role="tooltip">
        <strong>{name}</strong>
        <span>{intl.formatMessage({ id: details.descriptionMessageId })}</span>
      </span>
    </span>
  );
}
