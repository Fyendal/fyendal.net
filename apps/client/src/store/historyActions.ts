import type { MatchListFilters } from "@fyendal/protocol";
import { apiMatchRecords, apiMatches } from "../auth/auth.js";
import type { AuthRequest } from "./accountActions.js";
import type { MatchListState, StoreState } from "./types.js";

type HistoryActionKey =
  | "refreshMatchRecords"
  | "loadMatches"
  | "setMatchReplayFavorite"
  | "deleteMatchReplay";

export function emptyMatchList(filters: MatchListFilters = {}): MatchListState {
  return { filters, matches: [], nextCursor: null, loading: false, error: null, loaded: false };
}

export function initialHistoryState(): Pick<
  StoreState,
  "matchRecords" | "matchRecordsLoading" | "matchRecordsError" | "matchList"
> {
  return {
    matchRecords: null,
    matchRecordsLoading: false,
    matchRecordsError: false,
    matchList: emptyMatchList(),
  };
}

/** Match history reads: the counter rows arrive whole and are summed in the
 * client; the list is paged per filter. Both drop stale responses after an
 * account change, and the list also drops a page from an older request. */
export function createHistoryActions({
  set,
  get,
  authRequest,
  isCurrentAuth,
}: {
  set: (state: Partial<StoreState>) => void;
  get: () => StoreState;
  authRequest: (token: string) => AuthRequest;
  isCurrentAuth: (request: AuthRequest) => boolean;
}): Pick<StoreState, HistoryActionKey> {
  let listSequence = 0;
  return {
    refreshMatchRecords: async () => {
      const token = get().authToken;
      if (!token) {
        set(initialHistoryState());
        return;
      }
      const request = authRequest(token);
      set({ matchRecordsLoading: true, matchRecordsError: false });
      const result = await apiMatchRecords(token, request.signal);
      if (!isCurrentAuth(request)) return;
      set(result.ok
        ? { matchRecords: { heroes: result.heroes, matchups: result.matchups }, matchRecordsLoading: false }
        : { matchRecordsLoading: false, matchRecordsError: true });
    },
    loadMatches: async (filters, cursor = null) => {
      const token = get().authToken;
      if (!token) {
        set({ matchList: emptyMatchList(filters) });
        return;
      }
      const request = authRequest(token);
      const sequence = ++listSequence;
      const previous = get().matchList;
      set({
        matchList: { ...(cursor ? previous : emptyMatchList(filters)), filters, loading: true, error: null },
      });
      const result = await apiMatches(token, filters, cursor, request.signal);
      if (!isCurrentAuth(request) || sequence !== listSequence) return;
      const current = get().matchList;
      if (!result.ok) {
        set({ matchList: { ...current, loading: false, error: result.error } });
        return;
      }
      set({
        matchList: {
          filters,
          matches: cursor ? [...current.matches, ...result.matches] : result.matches,
          nextCursor: result.nextCursor,
          loading: false,
          error: null,
          loaded: true,
        },
      });
    },
    setMatchReplayFavorite: async (matchId, replayId, favorite) => {
      const result = await get().setSavedReplayFavorite(replayId, favorite);
      if (result.ok) {
        const list = get().matchList;
        set({
          matchList: {
            ...list,
            matches: list.matches.map((match) => match.id === matchId && match.replay
              ? { ...match, replay: { ...match.replay, favorite } }
              : match),
          },
        });
      }
      return result;
    },
    deleteMatchReplay: async (matchId, replayId) => {
      const result = await get().deleteSavedReplay(replayId);
      if (result.ok) {
        const list = get().matchList;
        set({
          matchList: {
            ...list,
            matches: list.matches.map((match) => match.id === matchId ? { ...match, replay: null } : match),
          },
        });
      }
      return result;
    },
  };
}
