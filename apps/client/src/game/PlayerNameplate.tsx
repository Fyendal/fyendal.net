import type { ReactNode } from "react";
import type { PlayerProfileView } from "@fyendal/shared";
import { PlayerBadgeMark } from "./PlayerBadge.js";

export function PlayerIdentity({
  className,
  profile,
  children,
}: {
  className: string;
  profile: PlayerProfileView;
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      {profile.badge ? <PlayerBadgeMark badge={profile.badge} /> : null}
      <span className="player-nameplate-username" translate="no">{profile.username}</span>
      {children}
    </div>
  );
}

export function PlayerNameplate({
  placement,
  profile,
  actions,
}: {
  placement: "opponent" | "self";
  profile: PlayerProfileView;
  /** Interactive controls shown after the username, such as opponent actions. */
  actions?: ReactNode;
}) {
  return (
    <PlayerIdentity
      className={`player-nameplate player-nameplate-${placement}`}
      profile={profile}
    >
      {actions}
    </PlayerIdentity>
  );
}
