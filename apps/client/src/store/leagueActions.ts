import { apiLeagues } from "../auth/auth.js";
import type { AuthRequest } from "./accountActions.js";
import type { StoreState } from "./types.js";

export function initialLeagueState(): Pick<StoreState, "leagues"> {
  return { leagues: null };
}

/** Memberships decide whether the League tab appears; a failed load keeps
 * the last known list rather than hiding the tab. */
export function createLeagueActions({
  set,
  get,
  authRequest,
  isCurrentAuth,
}: {
  set: (state: Partial<StoreState>) => void;
  get: () => StoreState;
  authRequest: (token: string) => AuthRequest;
  isCurrentAuth: (request: AuthRequest) => boolean;
}): Pick<StoreState, "refreshLeagues"> {
  return {
    refreshLeagues: async () => {
      const token = get().authToken;
      if (!token) {
        set(initialLeagueState());
        return;
      }
      const request = authRequest(token);
      const result = await apiLeagues(token, request.signal);
      if (!isCurrentAuth(request) || !result.ok) return;
      set({ leagues: result.leagues });
    },
  };
}
