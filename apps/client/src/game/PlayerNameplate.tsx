import type { PlayerProfileView } from "@fyendal/shared";
import { PlayerBadgeMark } from "./PlayerBadge.js";

export function PlayerIdentity({
  className,
  profile,
}: {
  className: string;
  profile: PlayerProfileView;
}) {
  return (
    <div className={className}>
      {profile.badge ? <PlayerBadgeMark badge={profile.badge} /> : null}
      <span className="player-nameplate-username" translate="no">{profile.username}</span>
    </div>
  );
}

export function PlayerNameplate({
  placement,
  profile,
}: {
  placement: "opponent" | "self";
  profile: PlayerProfileView;
}) {
  return (
    <PlayerIdentity
      className={`player-nameplate player-nameplate-${placement}`}
      profile={profile}
    />
  );
}
