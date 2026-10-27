import {
  apiAccountBadges,
  apiAccountBeta,
  apiAccountEmail,
  apiBugReportNotifications,
  apiDeck,
  apiDecks,
  apiDeleteAccount,
  apiDeleteDeck,
  apiDismissBugReportNotifications,
  apiExportAccount,
  apiFabraryPlayDeck,
  apiFabraryDeckPreview,
  apiImportDeck,
  apiReportBug,
  apiRemoveAccountEmail,
  apiReportPlayer,
  apiSelectAccountBadge,
  apiSetAccountEmail,
  apiSetDeckArt,
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
  | "setDeckArt"
  | "loadDeckDetail"
  | "deleteDeck"
  | "exportAccount"
  | "refreshBetaTester"
  | "getAccountBadges"
  | "selectAccountBadge"
  | "getAccountEmail"
  | "setAccountEmail"
  | "removeAccountEmail"
  | "deleteAccount"
  | "reportBug"
  | "reportOpponent"
  | "reportFriend"
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
  let deckMutationRevision = 0;
  let deckListRevision = 0;

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
      if (result.ok) deckMutationRevision += 1;
      set({
        pendingFabraryPlay: { ...pending, status: result.ok ? "ready" : "error", result },
        ...(result.ok ? { decks: [...get().decks.filter((deck) => deck.id !== result.deck.id), result.deck] } : {}),
      });
    },
    refreshDecks: async (silent = false) => {
      const token = get().authToken;
      if (!token) {
        set({ decks: [], deckPlayedAt: {}, decksLoading: false });
        return;
      }
      const request = authRequest(token);
      const revision = deckMutationRevision;
      const listRevision = ++deckListRevision;
      if (!silent) set({ decksLoading: true });
      const result = await apiDecks(token, request.signal);
      if (!isCurrentAuth(request) || listRevision !== deckListRevision) return;
      // A list response may predate a saved deck change. Reload before it can
      // replace the locally updated account snapshot.
      if (revision !== deckMutationRevision) {
        await get().refreshDecks(silent);
        return;
      }
      set({
        decksLoading: false,
        ...(result.ok ? {
          decks: result.decks,
          deckPlayedAt: Object.fromEntries(result.plays.map((play) => [play.deckId, play.playedAt])),
        } : {}),
      });
    },
    importDeck: async (input) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiImportDeck(token, input, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) {
        deckMutationRevision += 1;
        set({ decks: [...get().decks, result.deck] });
      }
      return result;
    },
    updateDeck: async (input) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiUpdateDeck(token, input, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) {
        deckMutationRevision += 1;
        set({ decks: get().decks.map((deck) => deck.id === result.deck.id ? result.deck : deck) });
      }
      return result;
    },
    loadDeckDetail: async (id) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiDeck(token, id, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    setDeckArt: async (id, art) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiSetDeckArt(token, { id, art }, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) {
        deckMutationRevision += 1;
        const prepDeck = get().prepDeck;
        set({
          decks: get().decks.map((deck) => deck.id === result.deck.id ? result.deck : deck),
          ...(prepDeck?.id === result.deck.id ? { prepDeck: { ...prepDeck, art: result.deck.art } } : {}),
        });
      }
      return result;
    },
    deleteDeck: async (id) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiDeleteDeck(token, id, request.signal);
      if (!isCurrentAuth(request)) return superseded;
      if (result.ok) {
        deckMutationRevision += 1;
        const { [id]: _removed, ...deckPlayedAt } = get().deckPlayedAt;
        set({ decks: get().decks.filter((deck) => deck.id !== id), deckPlayedAt });
      }
      return result;
    },
    exportAccount: async () => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiExportAccount(token, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    refreshBetaTester: async () => {
      const token = get().authToken;
      if (!token) {
        set({ betaTester: false });
        return;
      }
      const request = authRequest(token);
      const result = await apiAccountBeta(token, request.signal);
      if (isCurrentAuth(request) && result.ok) set({ betaTester: result.betaTester });
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
    getAccountEmail: async () => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiAccountEmail(token, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    setAccountEmail: async (password, email) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiSetAccountEmail(token, password, email, request.signal);
      return isCurrentAuth(request) ? result : superseded;
    },
    removeAccountEmail: async (password) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "not logged in" };
      const request = authRequest(token);
      const result = await apiRemoveAccountEmail(token, password, request.signal);
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
    reportOpponent: async (reason, details, includeChat) => {
      const token = get().authToken;
      const code = get().roomCode;
      if (!token) return { ok: false, error: "log in to report a player" };
      if (!code) return { ok: false, error: "not in a room" };
      const request = authRequest(token);
      const result = await apiReportPlayer(
        token,
        { source: "game", roomCode: code, reason, details, includeChat },
        request.signal,
      );
      return isCurrentAuth(request) ? result : superseded;
    },
    reportFriend: async (username, reason, details, includeChat) => {
      const token = get().authToken;
      if (!token) return { ok: false, error: "log in to report a player" };
      const request = authRequest(token);
      const result = await apiReportPlayer(
        token,
        { source: "chat", username, reason, details, includeChat },
        request.signal,
      );
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
