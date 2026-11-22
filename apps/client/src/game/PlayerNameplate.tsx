import type { ReactNode } from "react";
import type { PlayerProfileView } from "@fyendal/shared";
import { PlayerBadgeMark } from "./PlayerBadge.js";

export function PlayerIdentity({
  className,
  profile,
  name,
  children,
}: {
  className: string;
  profile: PlayerProfileView;
  /** Shown instead of the username, e.g. the hero in solo where both seats share one account. */
  name?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      {profile.badge && name === undefined ? <PlayerBadgeMark badge={profile.badge} /> : null}
      <span className="player-nameplate-username" translate="no">{name ?? profile.username}</span>
      {children}
    </div>
  );
}

export function PlayerNameplate({
  placement,
  profile,
  name,
  actions,
  acting = false,
}: {
  placement: "opponent" | "self";
  profile: PlayerProfileView;
  name?: string;
  /** Solo: this hero is the one acting. */
  acting?: boolean;
  /** Interactive controls shown after the username, such as opponent actions. */
  actions?: ReactNode;
}) {
  return (
    <PlayerIdentity
      className={`player-nameplate player-nameplate-${placement}${acting ? " player-nameplate-acting" : ""}`}
      profile={profile}
      name={name}
    >
      {actions}
    </PlayerIdentity>
  );
}
