import {
  apiAccountBadges,
  apiDecks,
  apiDeleteAccount,
  apiDeleteDeck,
  apiExportAccount,
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
  | "importDeck"
  | "updateDeck"
  | "deleteDeck"
  | "exportAccount"
  | "getAccountBadges"
  | "selectAccountBadge"
  | "deleteAccount"
  | "reportBug";

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

  return {
    refreshDecks: async () => {
      const token = get().authToken;
      if (!token) {
        set({ decks: [], decksLoading: false });
        return;
      }
      const request = authRequest(token);
      set({ decksLoading: true });
      const result = await apiDecks(token, request.signal);
      if (!isCurrentAuth(request)) return;
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
  };
}
