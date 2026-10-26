import { LEAGUE_TOKEN_RE } from "@fyendal/protocol";

export function leagueJoinTokenFromPath(pathname: string): string | null {
  const token = /^\/league\/join\/([^/]+)\/?$/.exec(pathname)?.[1];
  return token && LEAGUE_TOKEN_RE.test(token) ? token : null;
}
