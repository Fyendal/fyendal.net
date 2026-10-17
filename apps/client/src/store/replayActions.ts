import {
  apiDeleteReplay,
  apiRemoveReplayShare,
  apiReplay,
  apiReplayNotes,
  apiReplays,
  apiResetReplayShare,
  apiSetReplayFavorite,
  apiSetReplayShare,
  apiSharedReplay,
} from "../auth/auth.js";
import type { ApiError, ReplayServerNote, ReplaySummary } from "@fyendal/protocol";
import type { ReplayFile } from "@fyendal/shared";
import { savedReplayPath, sharedReplayPath } from "../replay/route.js";
import type { AuthRequest } from "./accountActions.js";
import { downloadReplayFile } from "./replayRuntime.js";
import { withReplayNotes } from "../replay/replayFileNotes.js";
import type { StoreState } from "./types.js";

type ReplayActionKey =
  | "refreshReplays"
  | "watchSavedReplay"
  | "exportSavedReplay"
  | "setSavedReplayFavorite"
  | "deleteSavedReplay"
  | "setReplayShare"
  | "resetReplayShare"
  | "removeReplayShare"
  | "watchSharedReplay";

export function createReplayActions({
  set,
  get,
  authRequest,
  isCurrentAuth,
  openReplay,
  showError,
}: {
  set: (state: Partial<StoreState>) => void;
  get: () => StoreState;
  authRequest: (token: string) => AuthRequest;
  isCurrentAuth: (request: AuthRequest) => boolean;
  openReplay: (
    file: Parameters<typeof downloadReplayFile>[0],
    savedReplayId: string | null,
    serverNotes?: ReplayServerNote[],
    serverTarget?: { replayId: string } | { roomCode: string } | null,
  ) => void;
  showError: (message: string) => void;
}): Pick<StoreState, ReplayActionKey> {
  const loadSavedReplay = async (id: string): Promise<
    | { ok: true; replay: ReplayFile; notes: ReplayServerNote[] }
    | { ok: false; error: string }
  > => {
    const token = get().authToken;
    if (!token) return { ok: false, error: "not logged in" };
    const request = authRequest(token);
    const [replayResult, noteResult] = await Promise.all([
      apiReplay(token, id, request.signal),
      apiReplayNotes(token, { replayId: id }, request.signal),
    ]);
    if (!isCurrentAuth(request)) {
      return { ok: false, error: "account request was superseded" };
    }
    if (!replayResult.ok) return replayResult;
    if (!noteResult.ok) return noteResult;
    return { ok: true, replay: replayResult.replay, notes: noteResult.notes };
  };

  /** Send one owner share change and record the resulting link on the list. */
  const applyShare = async <T extends { ok: true }>(
    id: string,
    send: (token: string, signal: AbortSignal) => Promise<T | ApiError>,
    shareOf: (result: T) => ReplaySummary["share"],
  ): Promise<T | ApiError> => {
    const token = get().authToken;
    if (!token) return { ok: false, error: "not logged in" };
    const request = authRequest(token);
    const result = await send(token, request.signal);
    if (!isCurrentAuth(request)) return { ok: false, error: "account request was superseded" };
    if (result.ok) {
      const share = shareOf(result);
      set({
        savedReplays: get().savedReplays.map((replay) => replay.id === id ? { ...replay, share } : replay),
      });
    }
    return result;
  };

  return {
    refreshReplays: async () => {
      const token = get().authToken;
      if (!token) {
        set({ savedReplays: [], replaysLoading: false });
        return;
      }
      const request = authRequest(token);
      set({ replaysLoading: true });
      const result = await apiReplays(token, request.signal);
      if (!isCurrentAuth(request)) return;
      set({
        replaysLoading: false,
        ...(result.ok ? { savedReplays: result.replays } : {}),
      });
      if (!result.ok) showError(result.error);
    },
    watchSavedReplay: async (id) => {
      const result = await loadSavedReplay(id);
      if (!result.ok) return result.error;
      const path = savedReplayPath(id);
      if (location.pathname !== path) history.pushState(null, "", path);
      openReplay(result.replay, id, result.notes, { replayId: id });
      return null;
    },
    exportSavedReplay: async (id) => {
      const result = await loadSavedReplay(id);
      if (!result.ok) return result.error;
      downloadReplayFile(withReplayNotes(result.replay, result.notes));
      return null;
    },
    setSavedReplayFavorite: async (id, favorite) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiSetReplayFavorite(token, id, favorite, request.signal);
      if (!isCurrentAuth(request)) {
        return { ok: false, error: "account request was superseded" };
      }
      if (result.ok) {
        const now = Date.now();
        set({
          savedReplays: get().savedReplays.flatMap((replay) =>
            replay.id !== id
              ? [replay]
              : !favorite && replay.expiresAt <= now
                ? []
                : [{ ...replay, favorite }]),
        });
      }
      return result;
    },
    setReplayShare: (replayId, visibility, includeNotes) => applyShare(
      replayId,
      (token, signal) => apiSetReplayShare(token, { replayId, visibility, includeNotes }, signal),
      (result) => result.share,
    ),
    resetReplayShare: (replayId) => applyShare(
      replayId,
      (token, signal) => apiResetReplayShare(token, replayId, signal),
      (result) => result.share,
    ),
    removeReplayShare: (replayId) => applyShare(
      replayId,
      (token, signal) => apiRemoveReplayShare(token, replayId, signal),
      () => null,
    ),
    watchSharedReplay: async (shareToken) => {
      const token = get().authToken;
      const request = token ? authRequest(token) : null;
      const result = await apiSharedReplay(shareToken, token, request?.signal);
      if (request && !isCurrentAuth(request)) return { ok: false, error: "account request was superseded" };
      if (!result.ok) return result;
      const path = sharedReplayPath(shareToken);
      if (location.pathname !== path) history.pushState(null, "", path);
      // No server note target: a viewer's note edits stay in this browser.
      openReplay(result.replay, null, result.shared.notes, null);
      set({ activeSharedReplay: { token: shareToken, ownerUsername: result.shared.ownerUsername } });
      return { ok: true };
    },
    deleteSavedReplay: async (id) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiDeleteReplay(token, id, request.signal);
      if (!isCurrentAuth(request)) {
        return { ok: false, error: "account request was superseded" };
      }
      if (result.ok) {
        set({ savedReplays: get().savedReplays.filter((replay) => replay.id !== id) });
      }
      return result;
    },
  };
}
