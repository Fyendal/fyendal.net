import { useId } from "react";
import type { PlayerBadge } from "@fyendal/shared";

export const PLAYER_BADGE_DETAILS: Record<PlayerBadge, {
  name: string;
  description: string;
  image: string;
}> = {
  "early-tester": {
    name: "Early Tester",
    description: "Awarded to players who joined Fyendal during early testing.",
    image: "/logo.png",
  },
};

export function PlayerBadgeMark({ badge }: { badge: PlayerBadge }) {
  const details = PLAYER_BADGE_DETAILS[badge];
  const tooltipId = useId();
  return (
    <span className="player-badge-mark" tabIndex={0} aria-describedby={tooltipId}>
      <img
        className="player-nameplate-badge"
        src={details.image}
        width={20}
        height={20}
        alt={`${details.name} badge`}
      />
      <span className="player-badge-tooltip" id={tooltipId} role="tooltip">
        <strong>{details.name}</strong>
        <span>{details.description}</span>
      </span>
    </span>
  );
}
