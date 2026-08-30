import {
  apiDeleteReplay,
  apiReplay,
  apiReplays,
} from "../auth/auth.js";
import { savedReplayPath } from "../replay/route.js";
import type { AuthRequest } from "./accountActions.js";
import { downloadReplayFile } from "./replayRuntime.js";
import type { StoreState } from "./types.js";

type ReplayActionKey =
  | "refreshReplays"
  | "watchSavedReplay"
  | "exportSavedReplay"
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
  openReplay: (file: Parameters<typeof downloadReplayFile>[0], savedReplayId: string) => void;
  showError: (message: string) => void;
}): Pick<StoreState, ReplayActionKey> {
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
      const token = get().authToken;
      if (!token) return "not logged in";
      const request = authRequest(token);
      const result = await apiReplay(token, id, request.signal);
      if (!isCurrentAuth(request)) return "account request was superseded";
      if (!result.ok) return result.error;
      const path = savedReplayPath(id);
      if (location.pathname !== path) history.pushState(null, "", path);
      openReplay(result.replay, id);
      return null;
    },
    exportSavedReplay: async (id) => {
      const token = get().authToken;
      if (!token) return "not logged in";
      const request = authRequest(token);
      const result = await apiReplay(token, id, request.signal);
      if (!isCurrentAuth(request)) return "account request was superseded";
      if (!result.ok) return result.error;
      downloadReplayFile(result.replay);
      return null;
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
