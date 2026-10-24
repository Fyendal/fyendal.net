/** A player's initial in a ring; "?" for a deleted account. */
export function LeagueAvatar({ username }: { username: string | null }) {
  const initial = username === null ? "?" : (Array.from(username)[0] ?? "?").toUpperCase();
  return <span className="league-avatar" aria-hidden="true">{initial}</span>;
}
