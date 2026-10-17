/** HTTP auth API wrapper — thin fetch layer over the server's /api endpoints. */
import {
  decodeAccountBadgesResponse,
  decodeAchievementsResponse,
  decodeAccountExportResponse,
  decodeApiError,
  decodeBugReportNotificationsResponse,
  decodeBugReportResponse,
  decodeDeckDetailResponse,
  decodeDeckInvalidResponse,
  decodeDeckResponse,
  decodeDecksResponse,
  decodeFabraryDeckPreviewResponse,
  decodeLoginResponse,
  decodeOkResponse,
  decodePlayerReportResponse,
  decodeReplayResponse,
  decodeReplayNotesResponse,
  decodeMatchRecordsResponse,
  decodeMatchesResponse,
  decodeReplaysResponse,
  decodeReplayShareResponse,
  decodeSharedReplayDenialResponse,
  decodeSharedReplayResponse,
  decodeStatsResponse,
  decodeGlobalNoticeResponse,
  decodeVersionUpdateNoticeResponse,
  type GlobalNoticeResponse,
  type VersionUpdateNoticeResponse,
  type AccountBadgesResponse,
  type AchievementsResponse,
  type AccountExport,
  type ApiError,
  type BugReportNotificationsResponse,
  type BugReportResponse,
  type PlayerReportResponse,
  type DeckDetailResponse,
  type DeckInvalidResponse,
  type DeckResponse,
  type DecksResponse,
  type FabraryDeckPreviewResponse,
  type LoginResponse,
  type OkResponse,
  type ReplayResponse,
  type ReplayNotesResponse,
  type ReplayNoteInput,
  type MatchListFilters,
  type MatchRecordsResponse,
  type MatchesResponse,
  type ReplaysResponse,
  type ReplayShareInput,
  type ReplayShareResponse,
  type SharedReplayDenialResponse,
  type SharedReplayResponse,
  type StatsResponse,
} from "@fyendal/protocol";
import type { PlayerBadge, PlayerReportReason, Format } from "@fyendal/shared";

type RegisterOk = OkResponse;
type LoginOk = LoginResponse;
export type RegisterResult = RegisterOk | ApiError;
export type LoginResult = LoginOk | ApiError;

type Decoder<T> = (value: unknown) => T | null;
const okOnly: Decoder<OkResponse> = decodeOkResponse;

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string;
  keepalive?: boolean;
  signal?: AbortSignal;
}

/** API origin override for production hosting (e.g. https://api.fyendal.com).
 *  Default: same host as the page, port 8080 (local dev). */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? "";

function apiUrl(path: string): string {
  const base = API_ORIGIN || `http://${location.hostname}:8080`;
  return `${base}/api/${path}`;
}

async function request<T extends { ok: boolean }>(
  path: string,
  decode: Decoder<T>,
  options: RequestOptions = {},
): Promise<T | ApiError> {
  try {
    const res = await fetch(apiUrl(path), {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.keepalive ? { keepalive: true } : {}),
      signal: options.signal,
    });
    const data: unknown = await res.json();
    return decode(data) ?? decodeApiError(data) ?? { ok: false, error: "invalid server response" };
  } catch {
    return { ok: false, error: "can't reach server" };
  }
}

function post<T extends { ok: boolean }>(
  path: string,
  body: unknown,
  decode: Decoder<T>,
  options: Omit<RequestOptions, "body" | "method"> = {},
): Promise<T | ApiError> {
  return request(path, decode, { ...options, method: "POST", body });
}

function get<T extends { ok: boolean }>(
  path: string,
  decode: Decoder<T>,
  options: Omit<RequestOptions, "body" | "method"> = {},
): Promise<T | ApiError> {
  return request(path, decode, options);
}

export function apiGlobalNotice(signal?: AbortSignal): Promise<GlobalNoticeResponse | ApiError> {
  return get("notice", decodeGlobalNoticeResponse, { signal });
}

export function apiVersionUpdateNotice(signal?: AbortSignal): Promise<VersionUpdateNoticeResponse | ApiError> {
  return get("version-update", decodeVersionUpdateNoticeResponse, { signal });
}

export function apiRegister(username: string, password: string): Promise<RegisterResult> {
  return post<RegisterOk>("register", { username, password }, okOnly);
}

export function apiLogin(username: string, password: string, signal?: AbortSignal): Promise<LoginResult> {
  return post<LoginOk>("login", { username, password }, decodeLoginResponse, { signal });
}

export function apiLogout(token: string): Promise<{ ok: boolean } | ApiError> {
  return post("logout", {}, okOnly, { token, keepalive: true });
}

export function apiExportAccount(
  token: string,
  signal?: AbortSignal,
): Promise<{ ok: true; export: AccountExport } | ApiError> {
  return get("account/export", decodeAccountExportResponse, { token, signal });
}

export function apiDeleteAccount(
  token: string,
  password: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | ApiError> {
  return post("account/delete", { password }, okOnly, { token, signal });
}

export function apiAccountBadges(
  token: string,
  signal?: AbortSignal,
): Promise<AccountBadgesResponse | ApiError> {
  return get("account/badges", decodeAccountBadgesResponse, { token, signal });
}

export function apiAchievements(
  token: string,
  signal?: AbortSignal,
): Promise<AchievementsResponse | ApiError> {
  return get("account/achievements", decodeAchievementsResponse, { token, signal });
}

export function apiSelectAccountBadge(
  token: string,
  badge: PlayerBadge | null,
  signal?: AbortSignal,
): Promise<AccountBadgesResponse | ApiError> {
  return post("account/badge", { badge }, decodeAccountBadgesResponse, { token, signal });
}

export type BugReportResult = BugReportResponse | ApiError;

export type PlayerReportResult = PlayerReportResponse | ApiError;

export function apiReportPlayer(
  token: string,
  input:
    | { source: "game"; roomCode: string; reason: PlayerReportReason; details: string; includeChat: boolean }
    | { source: "chat"; username: string; reason: PlayerReportReason; details: string; includeChat: boolean },
  signal?: AbortSignal,
): Promise<PlayerReportResult> {
  return post("player-reports", input, decodePlayerReportResponse, { token, signal });
}

export function apiReportBug(
  token: string,
  input: { roomCode: string; description: string },
  signal?: AbortSignal,
): Promise<BugReportResult> {
  return post("bug-reports", input, decodeBugReportResponse, { token, signal });
}

export function apiBugReportNotifications(
  token: string,
  signal?: AbortSignal,
): Promise<BugReportNotificationsResponse | ApiError> {
  return get("bug-report-notifications", decodeBugReportNotificationsResponse, { token, signal });
}

export function apiDismissBugReportNotifications(
  token: string,
  signal?: AbortSignal,
): Promise<OkResponse | ApiError> {
  return post("bug-report-notifications/dismiss", {}, okOnly, { token, signal });
}

// ── lobby stats (public, for the logged-out landing view) ──────────────────

export type StatsOk = StatsResponse;

export function apiStats(): Promise<StatsOk | ApiError> {
  return get("stats", decodeStatsResponse);
}

// ── match history ─────────────────────────────────────────────────────────

export function apiMatchRecords(token: string, signal?: AbortSignal): Promise<MatchRecordsResponse | ApiError> {
  return get("matches/records", decodeMatchRecordsResponse, { token, signal });
}

export function apiMatches(
  token: string,
  filters: MatchListFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<MatchesResponse | ApiError> {
  const params = new URLSearchParams();
  if (filters.opponent && filters.opponent !== "all") params.set("opponent", filters.opponent);
  if (filters.format) params.set("format", filters.format);
  if (filters.heroId) params.set("hero", filters.heroId);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return get(`matches${query ? `?${query}` : ""}`, decodeMatchesResponse, { token, signal });
}

// ── replays ───────────────────────────────────────────────────────────────

export function apiReplays(token: string, signal?: AbortSignal): Promise<ReplaysResponse | ApiError> {
  return get("replays", decodeReplaysResponse, { token, signal });
}

export function apiReplay(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<ReplayResponse | ApiError> {
  return get(`replays/${id}`, decodeReplayResponse, { token, signal });
}

export function apiRoomReplay(
  token: string,
  roomCode: string,
  signal?: AbortSignal,
): Promise<ReplayResponse | ApiError> {
  return get(`replays/room/${roomCode}`, decodeReplayResponse, { token, signal });
}

export function apiReplayNotes(
  token: string,
  target: { replayId: string } | { roomCode: string },
  signal?: AbortSignal,
): Promise<ReplayNotesResponse | ApiError> {
  const path = "replayId" in target
    ? `replay-notes/${target.replayId}`
    : `replay-notes/room/${target.roomCode}`;
  return get(path, decodeReplayNotesResponse, { token, signal });
}

export function apiSaveReplayNote(
  token: string,
  input: ReplayNoteInput,
  signal?: AbortSignal,
): Promise<OkResponse | ApiError> {
  return post("replay-notes", input, okOnly, { token, signal });
}

export type DeleteReplayResult = OkResponse | ApiError;
export type ReplayShareResult = ReplayShareResponse | ApiError;
export type SharedReplayOpenResult = { ok: true } | SharedReplayDenialResponse | ApiError;
export type FavoriteReplayResult = OkResponse | ApiError;

export function apiSetReplayFavorite(
  token: string,
  id: string,
  favorite: boolean,
  signal?: AbortSignal,
): Promise<FavoriteReplayResult> {
  return post("replays/favorite", { id, favorite }, okOnly, { token, signal });
}

export function apiSetReplayShare(
  token: string,
  input: ReplayShareInput,
  signal?: AbortSignal,
): Promise<ReplayShareResponse | ApiError> {
  return post("replays/share", input, decodeReplayShareResponse, { token, signal });
}

export function apiResetReplayShare(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<ReplayShareResponse | ApiError> {
  return post("replays/share/reset", { id }, decodeReplayShareResponse, { token, signal });
}

export function apiRemoveReplayShare(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<OkResponse | ApiError> {
  return post("replays/unshare", { id }, okOnly, { token, signal });
}

/** Open a share link. The session token is optional: public links work signed out. */
export function apiSharedReplay(
  shareToken: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<SharedReplayResponse | SharedReplayDenialResponse | ApiError> {
  return get(
    `shared-replays/${shareToken}`,
    (value) => decodeSharedReplayResponse(value) ?? decodeSharedReplayDenialResponse(value),
    { ...(token ? { token } : {}), signal },
  );
}

export function apiDeleteReplay(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<DeleteReplayResult> {
  return post("replays/delete", { id }, okOnly, { token, signal });
}

// ── decks ──────────────────────────────────────────────────────────────────

type DecksOk = DecksResponse;
type DeckOk = DeckResponse;
/** 422 validation failure from deck import/update */
type DeckInvalid = DeckInvalidResponse;
export type DecksResult = DecksOk | ApiError;
export type DeckResult = DeckOk | DeckInvalid;

export function apiDecks(token: string, signal?: AbortSignal): Promise<DecksResult> {
  return get("decks", decodeDecksResponse, { token, signal });
}

type DeckDetailOk = DeckDetailResponse;
export type DeckDetailResult = DeckDetailOk | ApiError;

/** Full registered pool of one saved deck (prep-room sideboarding). */
export function apiDeck(
  token: string,
  id: string,
  signal?: AbortSignal,
  matchupId?: string,
): Promise<DeckDetailResult> {
  const query = matchupId ? `?matchupId=${encodeURIComponent(matchupId)}` : "";
  return get(`decks/${id}${query}`, decodeDeckDetailResponse, { token, signal });
}

export function apiImportDeck(
  token: string,
  input: { name: string; format: Format; url?: string; text?: string },
  signal?: AbortSignal,
): Promise<DeckResult> {
  return post<DeckResult>(
    "decks/import",
    input,
    (value) => decodeDeckResponse(value) ?? decodeDeckInvalidResponse(value),
    { token, signal },
  );
}

export function apiFabraryDeckPreview(
  url: string,
  signal?: AbortSignal,
): Promise<FabraryDeckPreviewResponse | ApiError> {
  return post("decks/preview", { url }, decodeFabraryDeckPreviewResponse, { signal });
}

export function apiFabraryPlayDeck(
  token: string,
  input: { format: Format; url: string },
  signal?: AbortSignal,
): Promise<DeckResult> {
  return post<DeckResult>(
    "decks/play", input,
    (value) => decodeDeckResponse(value) ?? decodeDeckInvalidResponse(value),
    { token, signal },
  );
}

export function apiUpdateDeck(
  token: string,
  input: { id: string; name: string; url?: string; text?: string },
  signal?: AbortSignal,
): Promise<DeckResult> {
  return post<DeckResult>(
    "decks/update",
    input,
    (value) => decodeDeckResponse(value) ?? decodeDeckInvalidResponse(value),
    { token, signal },
  );
}

export type DeleteDeckResult = OkResponse | ApiError;

export function apiDeleteDeck(token: string, id: string, signal?: AbortSignal): Promise<DeleteDeckResult> {
  return post("decks/delete", { id }, okOnly, { token, signal });
}
