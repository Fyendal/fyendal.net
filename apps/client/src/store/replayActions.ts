import {
  apiDeleteReplay,
  apiReplay,
  apiReplayNotes,
  apiReplays,
  apiSetReplayFavorite,
} from "../auth/auth.js";
import type { ReplayServerNote } from "@fyendal/protocol";
import type { ReplayFile } from "@fyendal/shared";
import { savedReplayPath } from "../replay/route.js";
import type { AuthRequest } from "./accountActions.js";
import { downloadReplayFile } from "./replayRuntime.js";
import { withReplayNotes } from "../replay/replayFileNotes.js";
import type { StoreState } from "./types.js";

type ReplayActionKey =
  | "refreshReplays"
  | "watchSavedReplay"
  | "exportSavedReplay"
  | "setSavedReplayFavorite"
  | "deleteSavedReplay";

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
    savedReplayId: string,
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
