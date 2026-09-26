import {
  apiAccountBadges,
  apiBugReportNotifications,
  apiDecks,
  apiDeleteAccount,
  apiDeleteDeck,
  apiDismissBugReportNotifications,
  apiExportAccount,
  apiFabraryPlayDeck,
  apiFabraryDeckPreview,
  apiImportDeck,
  apiReportBug,
  apiSelectAccountBadge,
  apiUpdateDeck,
} from "../auth/auth.js";
import type { StoreState } from "./types.js";

export interface AuthRequest {
  epoch: number;
  token: string;
  signal: AbortSignal;
}

type AccountActionKey =
  | "refreshDecks"
  | "resolveFabraryPlay"
  | "previewFabraryPlay"
  | "importDeck"
  | "updateDeck"
  | "deleteDeck"
  | "exportAccount"
  | "getAccountBadges"
  | "selectAccountBadge"
  | "deleteAccount"
  | "reportBug"
  | "refreshBugReportNotifications"
  | "dismissBugReportNotifications";

export function createAccountActions({
  set,
  get,
  authRequest,
  isCurrentAuth,
}: {
  set: (state: Partial<StoreState>) => void;
  get: () => StoreState;
  authRequest: (token: string) => AuthRequest;
  isCurrentAuth: (request: AuthRequest) => boolean;
}): Pick<StoreState, AccountActionKey> {
  const superseded = { ok: false, error: "account request was superseded" } as const;
  let playRevision = 0;

  return {
    previewFabraryPlay: async () => {
      const pending = get().pendingFabraryPlay;
      if (!pending?.route.ok || get().authToken
        || (pending.preview && pending.preview.status !== "error")) return;
      const preview = { status: "loading" as const, result: null };
      set({ pendingFabraryPlay: { ...pending, preview } });
      const result = await apiFabraryDeckPreview(pending.route.request.url);
      const current = get().pendingFabraryPlay;
      if (get().authToken || current?.preview !== preview) return;
      set({ pendingFabraryPlay: { ...current,
        preview: { status: result.ok ? "ready" : "error", result } } });
    },
    resolveFabraryPlay: async (refresh = false) => {
      const pending = get().pendingFabraryPlay;
      const token = get().authToken;
      if (!pending?.route.ok || !token
        || (!["idle", "error"].includes(pending.status) && !(refresh && pending.status === "ready"))) return;
      const request = authRequest(token);
      get().clearError();
      set({ pendingFabraryPlay: { ...pending, status: "loading", result: null } });
      const result = await apiFabraryPlayDeck(token, pending.route.request, request.signal);
      if (!isCurrentAuth(request) || get().pendingFabraryPlay?.route !== pending.route) return;
      if (!result.ok && result.error === "not logged in") {
        await get().logout();
        return;
      }
      if (result.ok) playRevision += 1;
      set({
        pendingFabraryPlay: { ...pending, status: result.ok ? "ready" : "error", result },
        ...(result.ok ? { decks: [...get().decks.filter((deck) => deck.id !== result.deck.id), result.deck] } : {}),
      });
    },
    refreshDecks: async () => {
      const token = get().authToken;
      if (!token) {
        set({ decks: [], decksLoading: false });
        return;
      }
      const request = authRequest(token);
      const revision = playRevision;
      set({ decksLoading: true });
      const result = await apiDecks(token, request.signal);
      if (!isCurrentAuth(request)) return;
      // Login's list request may predate the link import. Reload instead of
      // replacing the newly saved deck with that older account snapshot.
      if (revision !== playRevision) {
        await get().refreshDecks();
        return;
      }
      set({
        decksLoading: false,
        ...(result.ok ? { decks: result.decks } : {}),
      });
    },
    importDeck: async (input) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiImportDeck(token, input, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) set({ decks: [...get().decks, result.deck] });
      return result;
    },
    updateDeck: async (input) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiUpdateDeck(token, input, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) {
        set({ decks: get().decks.map((deck) => deck.id === result.deck.id ? result.deck : deck) });
      }
      return result;
    },
    deleteDeck: async (id) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiDeleteDeck(token, id, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) set({ decks: get().decks.filter((deck) => deck.id !== id) });
      return result;
    },
    exportAccount: async () => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiExportAccount(token, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    getAccountBadges: async () => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiAccountBadges(token, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    selectAccountBadge: async (badge) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiSelectAccountBadge(token, badge, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    deleteAccount: async (password) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiDeleteAccount(token, password, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) await get().logout();
      return result;
    },
    reportBug: async (description) => {
      const token = get().authToken;
      const code = get().roomCode;
      if (!token) return { ok: false, error: "log in to report a bug" };
      if (!code) return { ok: false, error: "not in a room" };
      const request = authRequest(token);
      const result = await apiReportBug(token, { roomCode: code, description }, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    refreshBugReportNotifications: async () => {
      const token = get().authToken;
      if (!token) {
        set({ bugReportNotifications: [] });
        return;
      }
      const request = authRequest(token);
      const result = await apiBugReportNotifications(token, request.signal);
      if (isCurrentAuth(request) && result.ok) {
        set({ bugReportNotifications: result.notifications });
      }
    },
    dismissBugReportNotifications: async () => {
      const token = get().authToken;
      if (!token) return;
      const request = authRequest(token);
      const result = await apiDismissBugReportNotifications(token, request.signal);
      if (isCurrentAuth(request) && result.ok) {
        set({ bugReportNotifications: [] });
      }
    },
  };
}
