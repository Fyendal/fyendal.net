import { randomBytes } from "node:crypto";
import {
  IDLE_VICTORY_MS,
  type BotOpponent,
  type Decklist,
  type EquipmentSlot,
  type Format,
  type GameIntent,
  type HeroId,
  type MatchPrepPhase,
  type PendingDecision,
  type PresentedDeck,
  type PlayerBadge,
  type PrepSeatView,
  type PrepView,
  type PriorityWindowMode,
  type RoomInvite,
  type RoomSummary,
  type ServerMessage,
  type UndoTarget,
} from "@fyendal/shared";
import {
  botDefinition,
  botDefinitionForDeckId,
} from "@fyendal/bot";
import {
  actionCandidates,
  applyIntent as engineApplyIntent,
  createGame,
  legalIntents,
  projectStateFor,
  projectTransitionEvents,
  runechantSequenceActive,
  type EngineTransitionMove,
  type GameState,
} from "@fyendal/engine";
import {
  cardData,
  deckPoolForHero,
  decklists,
  formatLegalityErrors,
  precon,
  scripts,
} from "@fyendal/cards";
import { MAX_MATCHMAKING_AVOID_ROOM_CODES } from "@fyendal/protocol";
import { resolveDeck, validatePresentation } from "./decks.js";
import { appendClusterEvent, type ClusterEvent } from "./clusterEvents.js";
import { assertActiveRuleset } from "./rulesetFence.js";
import { withTransaction, type Queryable } from "./db.js";
import { CorruptRoomError, decodePersistedState, encodePersistedState } from "./persistedState.js";
import {
  appendReplayView,
  endReplayForRoom,
  startReplay,
} from "./replays.js";
import { hashToken } from "./tokenHash.js";

/**
 * Postgres-backed room storage. Room membership and full game state live in
 * the relational schema, so games survive crashes and
 * instance recycling. All mutations are optimistic read-modify-write cycles
 * guarded by the `version` column (no SELECT … FOR UPDATE — pg-mem compat).
 *
 * `connected` presence is held in lightweight per-socket leases in
 * `room_presence`. Heartbeats never rewrite room/game JSON. Runtime RoomRows
 * still expose lastSeenAt for projections; getRoom overlays normalized leases.
 */

export interface SeatRow {
  tokenHash: string;
  /** Bot seats have no socket or account and are driven after room commits. */
  controller?: "bot";
  /** classic-battles player seats: which preconstructed hero */
  hero?: HeroId;
  /** cc/silver-age player seats: the saved deck this seat plays with */
  deckId?: string;
  /** display-only snapshot for lobby listings */
  deckName?: string;
  /** display-only, for lobby listings */
  username?: string;
  /** Public cosmetic choice resolved from the owning account. */
  badge?: PlayerBadge;
  /** account id, for re-queueing after a pre-game leave */
  userId?: number;
  /** cc/silver-age: hero of the seat's saved deck (prep-room display) */
  heroId?: string;
  /** the deck presented in the prep room (validated subset of the seat's pool) */
  presented?: Decklist;
  /** prep room: player locked in their presentation */
  ready?: boolean;
  /** matchmade prep room: player acknowledged this pairing */
  accepted?: boolean;
  /** seat taken via matchmaking (re-queue on a pre-game opponent leave) */
  fromQueue?: boolean;
  /** Server-owned empty priority-window behavior; durable across gateways. */
  priorityMode?: PriorityWindowMode;
  /** One-shot shortcut for the current consecutive Runechant sequence. */
  runechantSkip?: boolean;
  /** presence: last heartbeat/attach (epoch ms); 0 = absent */
  lastSeenAt: number;
  /** last game intent this seat applied (epoch ms); stamped at game start —
   *  the opponent may claim victory after IDLE_VICTORY_MS without one */
  lastActionAt?: number;
}

export interface SpectatorRow {
  tokenHash: string;
  /** presence: last heartbeat/attach (epoch ms); 0 = absent */
  lastSeenAt: number;
}

/** Credentials presented for a player-seat mutation. The token is rotated on
 * reconnect; account-bound seats additionally require the owning account. */
export interface SeatCredentials {
  token: string;
  userId?: number;
}

export interface RoomCommand {
  id: string;
  expectedVersion: number;
}

export interface MatchmakingChoice {
  userId: number;
  username: string;
  hero?: HeroId;
  deckId?: string;
  deckName?: string;
  allowFutureCards: boolean;
  retainedRoomCode?: string;
  /** Browser-local rooms this player explicitly declined. Never persisted. */
  avoidRoomCodes?: string[];
  /** Preserve a survivor's original place when an opponent times out. */
  joinedAt?: number;
}

export type MatchmakingResult =
  | { ok: true; kind: "queued" }
  | { ok: true; kind: "opened"; code: string; version: number }
  | { ok: true; kind: "matched"; code: string; version: number }
  | { ok: false; error: string };

/** Pre-game state: die roll + the authorized player's first-player pick. */
export interface PrepState {
  rolls: [number, number];
  dieWinner: 0 | 1;
  startPlayer: 0 | 1 | null;
}

export interface RoomRow {
  code: string;
  format: Format;
  seats: [SeatRow | null, SeatRow | null];
  spectators: SpectatorRow[];
  state: GameState | null;
  /** pre-game prep state; null while a seat is open */
  prep: PrepState | null;
  version: number;
  createdAt: number;
  /** GC deadline (epoch ms); null while the room is actively in use */
  gcAt: number | null;
  /** Matchmade prep phase deadline; null for invite and bot rooms. */
  prepDeadlineAt: number | null;
  rulesetVersion: string;
  /** Private rooms are accessible by code/URL and visible in the lobby only to seated accounts. */
  isPrivate: boolean;
  /** Room-wide format rule, fixed when the room is created. */
  allowFutureCards: boolean;
  /** Latest committed semantic edge. Its fromVersion fences reconnects and
   * coalesced multi-instance refreshes from replaying a partial path. */
  lastTransition: StoredRoomTransition | null;
}

export interface StoredRoomTransition {
  fromVersion: number;
  kind: "forward" | "replace";
  events: EngineTransitionMove[];
}

export interface PresenceLease {
  code: string;
  token: string;
  leaseId: string;
  seat: number | null;
}

export interface LobbyRoomSnapshot {
  room: RoomSummary;
  ownerIds: number[];
  isPrivate: boolean;
  /** At least one current player-seat credential owns a live presence lease. */
  hasLivePlayer: boolean;
}

export type JoinResult =
  | { ok: true; kind: "player"; seat: number; token: string; reconnected: boolean; started: boolean; version: number }
  | { ok: true; kind: "spectator"; seat: null; token: string; reconnected: boolean; version: number }
  | { ok: false; error: string };

type VersionedPresence =
  | { kind: "player"; seat: number; version: number }
  | { kind: "spectator"; version: number };
type WithoutVersion<T> = T extends { version: number } ? Omit<T, "version"> : T;
type SeatIndex = 0 | 1;
type SeatWrite =
  | { kind: "full"; seat: SeatIndex; mode: "insert" | "update" }
  | { kind: "activity"; seat: SeatIndex; lastActionAt: number }
  | { kind: "delete"; seat: SeatIndex };
type ReplayWrite =
  | { kind: "start" }
  | { kind: "frame" };
type RoomMutation<T> =
  | {
      room: RoomRow;
      result: T;
      versionNeutral?: true;
      snapshot?: GameState;
      seatWrites?: readonly SeatWrite[];
      replay?: ReplayWrite;
      events?: readonly ClusterEvent[];
      /** A manual seat fill retires both the room opener's durable queue row
       * and any queue row owned by the joining account in the same commit. */
      releaseMatchmaking?: { joiningUserId?: number };
    }
  | { error: string };
type RoomMutationResult<T> =
  | { ok: true; result: T; version: number; replayFinalizationId?: string }
  | { ok: false; error: string };

interface HistoryMetadata {
  version: number;
  snapshotTurn: number;
  undoSeat: 0 | 1;
}

/** Undo keeps the last N snapshots plus turn-start anchors in room_history. */
const HISTORY_CAP = 20;
/** Rooms are deleted this long after the game ends or both players disconnect. */
const GC_DELAY_MS = 15 * 60 * 1000;
/** A seat/spectator counts as present when seen within this window… */
export const PRESENCE_TIMEOUT_MS = 3 * 60 * 1000;
/** …and the gateway re-stamps its attached sockets this often. */
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
export const MATCH_ACCEPT_MS = 30 * 1000;
export const MATCH_PREP_MS = 2 * 60 * 1000;
export const MATCH_FIRST_PICK_MS = 30 * 1000;

/** Presence check against a `lastSeenAt` timestamp (0/missing = absent). */
function isPresent(lastSeenAt: number | undefined, now: number): boolean {
  return !!lastSeenAt && now - lastSeenAt < PRESENCE_TIMEOUT_MS;
}

function seatForCredentials(room: RoomRow, credentials: SeatCredentials): SeatIndex | null {
  const tokenHash = hashReconnectToken(credentials.token);
  const seat = room.seats.findIndex((s) => s?.tokenHash === tokenHash);
  if (seat === -1) return null;
  const owner = room.seats[seat]!.userId;
  if (owner != null && owner !== credentials.userId) return null;
  return seat as SeatIndex;
}

const AUTO_PASS_WINDOW_KINDS: ReadonlySet<PendingDecision["kind"]> = new Set([
  "priority-window",
  "attack-reaction",
  "defense-reaction",
]);

/** The auto-pass condition, verified server-side: the seat holds a
 *  priority/reaction window in which nothing but pass/concede is legal.
 *  Conceding is always offered and never blocks auto-pass. */
function isEmptyPriorityWindow(state: GameState, seat: number): boolean {
  const decision = state.pendingDecision;
  if (!decision || decision.player !== seat || !AUTO_PASS_WINDOW_KINDS.has(decision.kind)) {
    return false;
  }
  const legal = legalIntents(state, seat);
  return legal.some((candidate) => candidate.kind === "pass") &&
    legal.every((candidate) => candidate.kind === "pass" || candidate.kind === "concede");
}
/** Dev-only fixture (see seed.ts): a fixed in-progress classic-battles match
 *  anyone can spectate. GC-exempt and full by construction. `newCode` is hex,
 *  so "DEMO00" can never collide with a real room. */
export const DEMO_ROOM_CODE = "DEMO00";
/** Spectator slots per room — anonymous joins must not grow a room unboundedly. */
const MAX_SPECTATORS = 20;
/** Player-seat gate message, shared by the store and the ws gateway. */
export const PLAY_REQUIRES_LOGIN = "log in to play";
const MAX_RETRIES = 5;
const VERSION_CONFLICT = Symbol("room version conflict");
const GAME_LOG_CAP = 200;

function appendGameLog(
  log: GameState["log"],
  entry: GameState["log"][number],
): GameState["log"] {
  return [...log, entry].slice(-GAME_LOG_CAP);
}

function newCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function newToken(): string {
  return randomBytes(12).toString("hex");
}

export const hashReconnectToken = hashToken;

/** Strip runtime-only engine registries at the one persistence boundary.
 *  They are immutable process-wide dependencies, not game state. Persisting
 *  cardsRef previously added ~165 KB to the current state and every undo
 *  snapshot; scriptsRef also cannot survive JSON serialization. */
export function dehydrateState(
  state: GameState,
  rulesetVersion = "test-ruleset",
) {
  return encodePersistedState(state, rulesetVersion);
}

function dehydrateMembers<T extends { lastSeenAt: number }>(members: T[]): Omit<T, "lastSeenAt">[] {
  return members.map(({ lastSeenAt: _lastSeenAt, ...member }) => member);
}

function hydrateState(s: unknown, code: string, rulesetVersion?: string): GameState | null {
  if (!s) return null;
  return decodePersistedState(s, code, cardData, scripts, rulesetVersion);
}

type RawRoomRow = {
  code: string;
  format: Format;
  spectators: Array<{ tokenHash: string }>;
  state: unknown;
  prep: PrepState | null;
  version: number;
  created_at: number;
  gc_at: number | null;
  prep_deadline_at: number | null;
  ruleset_version: string;
  is_private: boolean;
  allow_future_cards: boolean;
  last_transition: unknown;
};

function dbObject(value: unknown, code: string, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CorruptRoomError(code, path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function dbSafeInteger(value: unknown, code: string, path: string): number {
  const decoded = Number(value);
  if (!Number.isSafeInteger(decoded)) {
    throw new CorruptRoomError(code, path, "expected a safe integer");
  }
  return decoded;
}

const TRANSITION_ZONE_KINDS = new Set([
  "hand", "deck", "arsenal", "pitch", "graveyard", "banish", "soul",
  "board", "equipment", "weapon", "stack", "chain",
]);

function decodeTransitionZone(
  value: unknown,
  code: string,
  path: string,
): NonNullable<EngineTransitionMove["from"]> {
  const zone = dbObject(value, code, path);
  if (Object.keys(zone).some((key) => !["kind", "seat", "position"].includes(key))
    || !TRANSITION_ZONE_KINDS.has(String(zone.kind))
    || !(zone.seat === 0 || zone.seat === 1)
    || !(zone.position === undefined || zone.position === "top" || zone.position === "bottom")
    || (zone.position !== undefined && zone.kind !== "deck")) {
    throw new CorruptRoomError(code, path, "invalid transition zone");
  }
  return {
    kind: zone.kind as NonNullable<EngineTransitionMove["from"]>["kind"],
    seat: zone.seat,
    ...(zone.position === undefined ? {} : { position: zone.position }),
  };
}

function decodeStoredTransition(
  value: unknown,
  code: string,
  path: string,
): StoredRoomTransition | null {
  if (value === null || value === undefined) return null;
  const transition = dbObject(value, code, path);
  if (Object.keys(transition).some((key) => !["fromVersion", "kind", "events"].includes(key))) {
    throw new CorruptRoomError(code, path, "unknown transition field");
  }
  const fromVersion = dbSafeInteger(transition.fromVersion, code, `${path}.fromVersion`);
  if (fromVersion < 0 || !(transition.kind === "forward" || transition.kind === "replace")
    || !Array.isArray(transition.events) || transition.events.length > 512) {
    throw new CorruptRoomError(code, path, "invalid transition envelope");
  }
  const events = transition.events.map((value, index): EngineTransitionMove => {
    const eventPath = `${path}.events[${index}]`;
    const event = dbObject(value, code, eventPath);
    if (Object.keys(event).some((key) => !["kind", "card", "from", "to", "fromPrivate", "toPrivate"].includes(key))
      || event.kind !== "move" || typeof event.fromPrivate !== "boolean"
      || typeof event.toPrivate !== "boolean") {
      throw new CorruptRoomError(code, eventPath, "invalid transition event");
    }
    const card = dbObject(event.card, code, `${eventPath}.card`);
    if (Object.keys(card).some((key) => !["instanceId", "cardId", "owner"].includes(key))
      || !Number.isSafeInteger(card.instanceId) || Number(card.instanceId) <= 0
      || typeof card.cardId !== "string" || card.cardId.length === 0
      || !(card.owner === 0 || card.owner === 1)) {
      throw new CorruptRoomError(code, `${eventPath}.card`, "invalid transition card");
    }
    return {
      kind: "move",
      card: {
        instanceId: Number(card.instanceId),
        cardId: card.cardId,
        owner: card.owner,
      },
      from: event.from === null ? null : decodeTransitionZone(event.from, code, `${eventPath}.from`),
      to: event.to === null ? null : decodeTransitionZone(event.to, code, `${eventPath}.to`),
      fromPrivate: event.fromPrivate,
      toPrivate: event.toPrivate,
    };
  });
  if (transition.kind === "replace" && events.length > 0) {
    throw new CorruptRoomError(code, path, "replace transition must not contain events");
  }
  return { fromVersion, kind: transition.kind, events };
}

function historyMetadataFromState(state: GameState): Omit<HistoryMetadata, "version"> {
  const undoSeat = state.pendingDecision?.player ?? state.priorityPlayer;
  if (!(undoSeat === 0 || undoSeat === 1) || !Number.isSafeInteger(state.turn) || state.turn < 0) {
    throw new CorruptRoomError("<history>", "state", "invalid history metadata");
  }
  return { snapshotTurn: state.turn, undoSeat };
}

function dbStringArray(value: unknown, code: string, path: string, max = 100): string[] {
  if (!Array.isArray(value) || value.length > max || !value.every((item) => typeof item === "string")) {
    throw new CorruptRoomError(code, path, `expected at most ${max} strings`);
  }
  return [...value];
}

function decodeStoredSpectators(
  value: unknown,
  code: string,
  path: string,
): Array<{ tokenHash: string }> {
  if (!Array.isArray(value) || value.length > MAX_SPECTATORS) {
    throw new CorruptRoomError(code, path, `expected at most ${MAX_SPECTATORS} spectators`);
  }
  return value.map((spectator, index) => {
    const decoded = dbObject(spectator, code, `${path}[${index}]`);
    if (Object.keys(decoded).some((key) => key !== "tokenHash") || typeof decoded.tokenHash !== "string") {
      throw new CorruptRoomError(code, `${path}[${index}].tokenHash`, "expected a string");
    }
    return { tokenHash: decoded.tokenHash };
  });
}

function decodeDecklist(value: unknown, code: string, path: string): Decklist {
  const deck = dbObject(value, code, path);
  const allowed = new Set(["heroId", "weaponIds", "equipment", "deck", "sideboard", "inventory"]);
  if (Object.keys(deck).some((key) => !allowed.has(key)) || typeof deck.heroId !== "string") {
    throw new CorruptRoomError(code, path, "invalid decklist fields");
  }
  const equipmentValue = dbObject(deck.equipment, code, `${path}.equipment`);
  const slots = new Set(["head", "chest", "arms", "legs"]);
  const equipment: Partial<Record<EquipmentSlot, string>> = {};
  for (const [slot, cardId] of Object.entries(equipmentValue)) {
    if (!slots.has(slot) || typeof cardId !== "string") {
      throw new CorruptRoomError(code, `${path}.equipment`, "invalid equipment map");
    }
    equipment[slot as EquipmentSlot] = cardId;
  }
  return {
    heroId: deck.heroId,
    weaponIds: dbStringArray(deck.weaponIds, code, `${path}.weaponIds`, 2),
    equipment,
    deck: dbStringArray(deck.deck, code, `${path}.deck`),
    ...(deck.sideboard === undefined
      ? {}
      : { sideboard: dbStringArray(deck.sideboard, code, `${path}.sideboard`) }),
    ...(deck.inventory === undefined
      ? {}
      : { inventory: dbStringArray(deck.inventory, code, `${path}.inventory`) }),
  };
}

function decodeRawRoomRow(value: unknown): RawRoomRow {
  const row = dbObject(value, "<unknown>", "row");
  const code = typeof row.code === "string" ? row.code : "<unknown>";
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new CorruptRoomError(code, "row.code", "invalid room code");
  if (!(row.format === "classic-battles" || row.format === "cc" || row.format === "silver-age")) {
    throw new CorruptRoomError(code, "row.format", "unknown format");
  }
  const spectators = decodeStoredSpectators(row.spectators, code, "row.spectators");
  for (const [field, raw] of [["version", row.version], ["created_at", row.created_at]] as const) {
    if (!Number.isFinite(Number(raw))) throw new CorruptRoomError(code, `row.${field}`, "expected a number");
  }
  if (!(row.gc_at === null || Number.isFinite(Number(row.gc_at)))) {
    throw new CorruptRoomError(code, "row.gc_at", "expected a number or null");
  }
  if (!(row.prep_deadline_at === null || Number.isFinite(Number(row.prep_deadline_at)))) {
    throw new CorruptRoomError(code, "row.prep_deadline_at", "expected a number or null");
  }
  if (typeof row.ruleset_version !== "string" || row.ruleset_version.length === 0) {
    throw new CorruptRoomError(code, "row.ruleset_version", "expected a string");
  }
  if (typeof row.is_private !== "boolean") {
    throw new CorruptRoomError(code, "row.is_private", "expected a boolean");
  }
  if (typeof row.allow_future_cards !== "boolean") {
    throw new CorruptRoomError(code, "row.allow_future_cards", "expected a boolean");
  }
  let decodedPrep: PrepState | null = null;
  if (row.prep !== null) {
    const prep = dbObject(row.prep, code, "row.prep");
    if (Object.keys(prep).some((key) => !["rolls", "dieWinner", "startPlayer"].includes(key))) {
      throw new CorruptRoomError(code, "row.prep", "unknown field");
    }
    if (!Array.isArray(prep.rolls) || prep.rolls.length !== 2 || !prep.rolls.every((roll) => Number.isFinite(roll))) {
      throw new CorruptRoomError(code, "row.prep.rolls", "expected two numbers");
    }
    if (!(prep.dieWinner === 0 || prep.dieWinner === 1) || !(prep.startPlayer === null || prep.startPlayer === 0 || prep.startPlayer === 1)) {
      throw new CorruptRoomError(code, "row.prep", "invalid seat value");
    }
    decodedPrep = {
      rolls: [Number(prep.rolls[0]), Number(prep.rolls[1])],
      dieWinner: prep.dieWinner,
      startPlayer: prep.startPlayer,
    };
  }
  return {
    code,
    format: row.format,
    spectators,
    state: row.state,
    prep: decodedPrep,
    version: Number(row.version),
    created_at: Number(row.created_at),
    gc_at: row.gc_at === null ? null : Number(row.gc_at),
    prep_deadline_at: row.prep_deadline_at === null ? null : Number(row.prep_deadline_at),
    ruleset_version: row.ruleset_version,
    is_private: row.is_private,
    allow_future_cards: row.allow_future_cards,
    last_transition: row.last_transition,
  };
}

function decodeSeatRows(values: unknown[], code: string): [SeatRow | null, SeatRow | null] {
  const seats: [SeatRow | null, SeatRow | null] = [null, null];
  for (const [index, value] of values.entries()) {
    const row = dbObject(value, code, `seats[${index}]`);
    const seat = Number(row.seat);
    if (!(seat === 0 || seat === 1) || seats[seat]) throw new CorruptRoomError(code, `seats[${index}].seat`, "invalid or duplicate seat");
    if (typeof row.token_hash !== "string") throw new CorruptRoomError(code, `seats[${index}].token_hash`, "expected a string");
    if (!(row.controller === "human" || row.controller === "bot")) {
      throw new CorruptRoomError(code, `seats[${index}].controller`, "expected human or bot");
    }
    if (!(row.priority_mode === "always-pause" || row.priority_mode === "auto-pass")) {
      throw new CorruptRoomError(code, `seats[${index}].priority_mode`, "expected always-pause or auto-pass");
    }
    if (typeof row.runechant_skip !== "boolean") {
      throw new CorruptRoomError(code, `seats[${index}].runechant_skip`, "expected a boolean");
    }
    if (typeof row.accepted !== "boolean") {
      throw new CorruptRoomError(code, `seats[${index}].accepted`, "expected a boolean");
    }
    if (!(row.selected_badge === null || row.selected_badge === "early-tester")) {
      throw new CorruptRoomError(code, `seats[${index}].selected_badge`, "expected a known badge or null");
    }
    const presented = row.presented == null
      ? undefined
      : decodeDecklist(row.presented, code, `seats[${index}].presented`);
    seats[seat] = {
      tokenHash: row.token_hash,
      ...(row.controller === "bot" ? { controller: "bot" as const } : {}),
      ...(row.hero === "rhinar" || row.hero === "dorinthea" ? { hero: row.hero } : {}),
      ...(typeof row.deck_id === "string" ? { deckId: row.deck_id } : {}),
      ...(typeof row.deck_name === "string" ? { deckName: row.deck_name } : {}),
      ...(typeof row.username === "string" ? { username: row.username } : {}),
      ...(row.user_id == null ? {} : { userId: Number(row.user_id) }),
      ...(row.selected_badge === "early-tester" ? { badge: row.selected_badge } : {}),
      ...(typeof row.hero_id === "string" ? { heroId: row.hero_id } : {}),
      ...(presented ? { presented } : {}),
      ready: row.ready === true,
      accepted: row.accepted,
      fromQueue: row.from_queue === true,
      priorityMode: row.priority_mode,
      runechantSkip: row.runechant_skip,
      lastSeenAt: 0,
      ...(row.last_action_at == null ? {} : { lastActionAt: Number(row.last_action_at) }),
    };
  }
  return seats;
}

function dbRowArray(value: unknown, code: string, path: string): unknown[] {
  if (!Array.isArray(value)) throw new CorruptRoomError(code, path, "expected an array");
  return value;
}

function toRoom(value: unknown): RoomRow {
  const loaded = dbObject(value, "<unknown>", "row");
  const r = decodeRawRoomRow(loaded);
  const seatRows = dbRowArray(loaded.seat_rows, r.code, "row.seat_rows");
  const presenceRows = dbRowArray(loaded.presence_rows, r.code, "row.presence_rows");
  const seats = decodeSeatRows(seatRows, r.code);
  const newestByToken = new Map<string, number>();
  for (const [index, value] of presenceRows.entries()) {
    const p = dbObject(value, r.code, `presence[${index}]`);
    if (typeof p.token_hash !== "string" || !Number.isFinite(Number(p.last_seen_at))) {
      throw new CorruptRoomError(r.code, `presence[${index}]`, "invalid lease row");
    }
    const seen = Number(p.last_seen_at);
    newestByToken.set(p.token_hash, Math.max(newestByToken.get(p.token_hash) ?? 0, seen));
  }
  const seenAt = (token: string): number => newestByToken.get(token) ?? 0;

  return {
    code: r.code,
    format: r.format,
    seats: seats.map((s) =>
      s ? { ...s, lastSeenAt: seenAt(s.tokenHash) } : s,
    ) as [SeatRow | null, SeatRow | null],
    spectators: r.spectators.map((s) => ({
      ...s,
      lastSeenAt: seenAt(s.tokenHash),
    })),
    state: hydrateState(r.state, String(r.code ?? "<unknown>"), r.ruleset_version),
    prep: r.prep,
    version: Number(r.version),
    createdAt: Number(r.created_at),
    gcAt: r.gc_at == null ? null : Number(r.gc_at),
    prepDeadlineAt: r.prep_deadline_at == null ? null : Number(r.prep_deadline_at),
    rulesetVersion: r.ruleset_version,
    isPrivate: r.is_private,
    allowFutureCards: r.allow_future_cards,
    lastTransition: decodeStoredTransition(r.last_transition, r.code, "row.last_transition"),
  };
}

/**
 * Arm/disarm the GC deadline. The FIRST arming wins — reconnects and further
 * actions don't push the deadline out once the game is over or the room has
 * been abandoned.
 */
function updateGc(room: RoomRow, now = Date.now()): void {
  if (room.code === DEMO_ROOM_CODE) return; // the dev demo room never expires
  const over = room.state?.winner != null;
  const anyonePresent = room.seats.some((s) => s && isPresent(s.lastSeenAt, now));
  if (over || !anyonePresent) {
    room.gcAt ??= now + GC_DELAY_MS;
  } else {
    room.gcAt = null;
  }
}

function lifecycle(room: RoomRow): { status: "open" | "prep" | "active" | "finished"; winner: number | null } {
  if (room.state) {
    return room.state.winner == null
      ? { status: "active", winner: null }
      : { status: "finished", winner: room.state.winner };
  }
  return room.seats[0] && room.seats[1]
    ? { status: "prep", winner: null }
    : { status: "open", winner: null };
}

function heroIdForSeat(seat: SeatRow): string | undefined {
  return seat.heroId ?? (seat.hero ? decklists[seat.hero].heroId : undefined);
}

function heroNameForSeat(seat: SeatRow | null): string | null {
  if (!seat) return null;
  const heroId = heroIdForSeat(seat);
  return heroId ? (cardData[heroId]?.name ?? null) : null;
}

/** Pre-game die roll; ties broken by a coin flip. */
function rollDice(): PrepState {
  const b = randomBytes(3);
  const rolls: [number, number] = [1 + (b[0]! % 6), 1 + (b[1]! % 6)];
  const dieWinner = rolls[0] === rolls[1] ? ((b[2]! % 2) as 0 | 1) : rolls[0] > rolls[1] ? 0 : 1;
  return { rolls, dieWinner, startPlayer: null };
}

function matchPrepPhase(room: RoomRow): MatchPrepPhase | null {
  if (room.prepDeadlineAt === null || room.state || !room.seats.every(Boolean)
    || !room.seats.every((seat) => seat?.fromQueue === true)) return null;
  if (!room.seats.every((seat) => seat?.accepted === true)) return "accept";
  if (room.prep?.startPlayer == null) return "choose-first";
  return room.seats.every((seat) => seat?.ready === true) ? null : "prepare";
}

/**
 * Shared createGame config for both game-start paths. The seed comes from a
 * CSPRNG — a predictable seed (time-based) would let an opponent reconstruct
 * the deck shuffle.
 */
function gameConfig(
  ordered: [Decklist, Decklist],
  startPlayer?: 0 | 1,
): Parameters<typeof createGame>[0] {
  return {
    decklists: ordered,
    seed: randomBytes(4).readUInt32BE(0),
    cards: cardData,
    scripts,
    startPlayer,
  };
}

/**
 * Start the game once both seats are ready and the authorized player has
 * picked who goes first. Decklists are the validated presentations (for
 * classic-battles, presentations of the fixed 40-card box lists).
 */
function maybeStart(room: RoomRow): boolean {
  if (room.state) return false;
  const [a, b] = room.seats;
  if (!a?.ready || !a.presented || !b?.ready || !b.presented) return false;
  const startPlayer = room.prep?.startPlayer;
  if (startPlayer == null) return false;
  room.state = createGame(gameConfig([a.presented, b.presented], startPlayer));
  // both seats count as active from the first turn (idle-claim baseline)
  a.lastActionAt = Date.now();
  b.lastActionAt = a.lastActionAt;
  return true;
}

export class PgRoomStore {
  constructor(private db: Queryable, private rulesetVersion: string) {
    if (!rulesetVersion) throw new Error("rulesetVersion is required");
  }

  private async loadRoom(db: Queryable, code: string): Promise<RoomRow | null> {
    // Aggregate membership before joining it to the room so the full persisted
    // state is returned once, independent of the number of seats or leases.
    const { rows } = await db.query(
      `WITH seat_data AS (
         SELECT s.room_code, json_agg(s ORDER BY s.seat) AS seat_rows
         FROM (
           SELECT rs.*, u.selected_badge
           FROM room_seats AS rs
           LEFT JOIN users AS u ON u.id = rs.user_id
           WHERE rs.room_code = $1
         ) AS s
         GROUP BY s.room_code
       ), presence_data AS (
         SELECT p.room_code, json_agg(p ORDER BY p.lease_id) AS presence_rows
         FROM room_presence AS p
         WHERE p.room_code = $1
         GROUP BY p.room_code
       )
       SELECT r.code, r.format, r.spectators, r.state, r.prep, r.ruleset_version,
              r.version, r.created_at, r.gc_at, r.prep_deadline_at, r.is_private, r.allow_future_cards,
              r.last_transition,
              COALESCE(seat_data.seat_rows, '[]'::json) AS seat_rows,
              COALESCE(presence_data.presence_rows, '[]'::json) AS presence_rows
       FROM rooms AS r
       LEFT JOIN seat_data ON seat_data.room_code = r.code
       LEFT JOIN presence_data ON presence_data.room_code = r.code
       WHERE r.code = $1`,
      [code],
    );
    if (!rows.length) return null;
    return toRoom(rows[0]);
  }

  async getRoom(code: string): Promise<RoomRow | null> {
    return this.loadRoom(this.db, code);
  }

  /** Resolve the capability URL's room code without exposing private rooms in
   *  lobby discovery. The client uses this metadata to request the correct
   *  deck or hero before attempting to take the open seat. */
  async roomInvite(code: string, userId?: number): Promise<RoomInvite | null> {
    const room = await this.getRoom(code.toUpperCase());
    if (!room || (room.state && room.state.winner !== null) || !room.seats.some(Boolean)) return null;
    return {
      code: room.code,
      format: room.format,
      ...(room.allowFutureCards ? { allowFutureCards: true as const } : {}),
      ...(room.seats.every(Boolean) ? { spectateOnly: true } : {}),
      ...(userId != null && room.seats.some((seat) => seat?.userId === userId) ? { yours: true } : {}),
    };
  }

  /** Explicit history load for undo/tests. Normal room reads and broadcasts
   *  never touch room_history. */
  async getHistory(code: string): Promise<GameState[]> {
    const { rows } = await this.db.query(
      "SELECT state FROM room_history WHERE room_code = $1 ORDER BY version",
      [code.toUpperCase()],
    );
    return rows.map((row) => hydrateState(row.state, code.toUpperCase())!);
  }

  /** Conditional room update on the version token; false = concurrent writer
   * won. Relational seat writes are explicit and run only after this succeeds. */
  private async save(room: RoomRow, db: Queryable = this.db): Promise<boolean> {
    const { status, winner } = lifecycle(room);
    const { rowCount } = await db.query(
      `UPDATE rooms SET spectators=$2, state=$3, gc_at=$4, prep=$5,
         status=$6, winner=$7, prep_deadline_at=$8, last_transition=$9, version=version+1
       WHERE code=$1 AND version=$10`,
      [
        room.code,
        JSON.stringify(dehydrateMembers(room.spectators)),
        room.state ? JSON.stringify(dehydrateState(room.state, room.rulesetVersion)) : null,
        room.gcAt,
        room.prep ? JSON.stringify(room.prep) : null,
        status,
        winner,
        room.prepDeadlineAt,
        room.lastTransition ? JSON.stringify(room.lastTransition) : null,
        room.version,
      ],
    );
    return rowCount === 1;
  }

  private seatWriteValues(room: RoomRow, seat: SeatIndex): unknown[] {
    const member = room.seats[seat];
    if (!member) throw VERSION_CONFLICT;
    return [
      room.code,
      seat,
      member.userId ?? null,
      member.tokenHash,
      member.username ?? null,
      member.hero ?? null,
      member.heroId ?? null,
      member.deckId ?? null,
      member.deckName ?? null,
      member.fromQueue ?? false,
      member.ready ?? false,
      member.presented ? JSON.stringify(member.presented) : null,
      member.lastActionAt ?? null,
      member.controller ?? "human",
      member.priorityMode ?? "always-pause",
      member.runechantSkip ?? false,
      member.accepted ?? false,
    ];
  }

  /** Persist only the relational membership changes declared by the mutation.
   * Missing expected rows fail the transaction and are retried from a fresh
   * authoritative room load. */
  private async applySeatWrites(
    db: Queryable,
    room: RoomRow,
    writes: readonly SeatWrite[],
  ): Promise<void> {
    const written = new Set<SeatIndex>();
    for (const write of writes) {
      if (written.has(write.seat)) throw new Error(`duplicate seat write for seat ${write.seat}`);
      written.add(write.seat);

      if (write.kind === "activity") {
        const { rowCount } = await db.query(
          `UPDATE room_seats SET last_action_at = $3
           WHERE room_code = $1 AND seat = $2`,
          [room.code, write.seat, write.lastActionAt],
        );
        if (rowCount !== 1) throw VERSION_CONFLICT;
        continue;
      }
      if (write.kind === "delete") {
        const { rowCount } = await db.query(
          "DELETE FROM room_seats WHERE room_code = $1 AND seat = $2",
          [room.code, write.seat],
        );
        if (rowCount !== 1) throw VERSION_CONFLICT;
        continue;
      }

      const values = this.seatWriteValues(room, write.seat);
      const result = write.mode === "insert"
        ? await db.query(
            `INSERT INTO room_seats
              (room_code, seat, user_id, token_hash, username, hero, hero_id, deck_id, deck_name,
               from_queue, ready, presented, last_action_at, controller, priority_mode, runechant_skip, accepted)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            values,
          )
        : await db.query(
            `UPDATE room_seats SET
               user_id = $3,
               token_hash = $4,
               username = $5,
               hero = $6,
               hero_id = $7,
               deck_id = $8,
               deck_name = $9,
               from_queue = $10,
               ready = $11,
               presented = $12,
               last_action_at = $13,
               controller = $14,
               priority_mode = $15,
               runechant_skip = $16,
               accepted = $17
             WHERE room_code = $1 AND seat = $2`,
            values,
          );
      if (result.rowCount !== 1) throw VERSION_CONFLICT;
    }
  }

  private async persistSeatPreferences(
    db: Queryable,
    room: RoomRow,
    seats: readonly SeatIndex[],
  ): Promise<void> {
    for (const seat of seats) {
      const member = room.seats[seat];
      if (!member) continue;
      const { rowCount } = await db.query(
        `UPDATE room_seats SET priority_mode = $3, runechant_skip = $4
         WHERE room_code = $1 AND seat = $2`,
        [room.code, seat, member.priorityMode ?? "always-pause", member.runechantSkip ?? false],
      );
      if (rowCount !== 1) throw VERSION_CONFLICT;
    }
  }

  private async saveSnapshot(
    db: Queryable,
    room: RoomRow,
    snapshot: GameState,
  ): Promise<void> {
    const metadata = historyMetadataFromState(snapshot);
    await db.query(
      `INSERT INTO room_history
        (room_code, version, state, snapshot_turn, undo_seat)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        room.code,
        room.version + 1,
        JSON.stringify(dehydrateState(snapshot, room.rulesetVersion)),
        metadata.snapshotTurn,
        metadata.undoSeat,
      ],
    );
    const history = await this.loadHistoryMetadata(db, room.code, room.rulesetVersion);
    if (history.length <= HISTORY_CAP) return;

    const keep = new Set(
      history.slice(0, HISTORY_CAP).map((row) => row.version),
    );
    // Preserve the earliest snapshot from this turn and the one before it
    // even when either turn contains more than 20 actions. This bounds
    // history at HISTORY_CAP + 2 while supporting both turn restore controls.
    const anchorTurns = new Set([room.state?.turn, (room.state?.turn ?? 0) - 1]);
    const earliestByTurn = new Map<number, number>();
    for (const row of history) {
      if (anchorTurns.has(row.snapshotTurn)) {
        earliestByTurn.set(row.snapshotTurn, row.version);
      }
    }
    for (const version of earliestByTurn.values()) keep.add(version);
    const remove = history
      .map((row) => row.version)
      .filter((version) => !keep.has(version));
    if (remove.length > 0) {
      const placeholders = remove.map((_, index) => `$${index + 2}`).join(", ");
      await db.query(
        `DELETE FROM room_history
         WHERE room_code = $1 AND version IN (${placeholders})`,
        [room.code, ...remove],
      );
    }
  }

  /** Read only the scalar metadata needed by retention and Undo. Legacy rows
   * written by a rollback-era server are exhaustively decoded once, then
   * repaired in place without changing their authoritative state snapshot. */
  private async loadHistoryMetadata(
    db: Queryable,
    code: string,
    rulesetVersion: string,
  ): Promise<HistoryMetadata[]> {
    const { rows } = await db.query(
      `SELECT version, snapshot_turn, undo_seat
       FROM room_history WHERE room_code = $1 ORDER BY version DESC`,
      [code],
    );
    const decoded = rows.map((value, index) => {
      const row = dbObject(value, code, `history[${index}]`);
      const version = dbSafeInteger(row.version, code, `history[${index}].version`);
      const snapshotTurn = row.snapshot_turn == null
        ? null
        : dbSafeInteger(row.snapshot_turn, code, `history[${index}].snapshot_turn`);
      const rawUndoSeat = row.undo_seat == null
        ? null
        : dbSafeInteger(row.undo_seat, code, `history[${index}].undo_seat`);
      if (snapshotTurn !== null && snapshotTurn < 0) {
        throw new CorruptRoomError(code, `history[${index}].snapshot_turn`, "expected a non-negative integer");
      }
      if (rawUndoSeat !== null && !(rawUndoSeat === 0 || rawUndoSeat === 1)) {
        throw new CorruptRoomError(code, `history[${index}].undo_seat`, "expected a seat");
      }
      return {
        version,
        snapshotTurn,
        undoSeat: rawUndoSeat as 0 | 1 | null,
      };
    });
    const missing = decoded.filter((row) => row.snapshotTurn === null || row.undoSeat === null);
    if (missing.length === 0) return decoded as HistoryMetadata[];

    const missingVersions = new Set(missing.map((row) => row.version));
    const { rows: stateRows } = await db.query(
      `SELECT version, state FROM room_history
       WHERE room_code = $1 AND (snapshot_turn IS NULL OR undo_seat IS NULL)
       ORDER BY version DESC`,
      [code],
    );
    const repaired = new Map<number, Omit<HistoryMetadata, "version">>();
    for (const [index, value] of stateRows.entries()) {
      const row = dbObject(value, code, `legacyHistory[${index}]`);
      const version = dbSafeInteger(row.version, code, `legacyHistory[${index}].version`);
      if (!missingVersions.has(version)) continue;
      const state = hydrateState(row.state, code, rulesetVersion);
      if (!state) throw new CorruptRoomError(code, `legacyHistory[${index}].state`, "expected game state");
      repaired.set(version, historyMetadataFromState(state));
    }
    if (repaired.size !== missing.length) throw VERSION_CONFLICT;

    const values = [...repaired.entries()];
    const turnCases = values.map((_, index) => {
      const base = index * 3 + 2;
      return `WHEN $${base}::bigint THEN $${base + 1}::integer`;
    });
    const seatCases = values.map((_, index) => {
      const base = index * 3 + 2;
      return `WHEN $${base}::bigint THEN $${base + 2}::integer`;
    });
    const versionParams = values.map((_, index) => `$${index * 3 + 2}::bigint`);
    await db.query(
      `UPDATE room_history
       SET snapshot_turn = CASE version ${turnCases.join(" ")} ELSE snapshot_turn END,
           undo_seat = CASE version ${seatCases.join(" ")} ELSE undo_seat END
       WHERE room_code = $1 AND version IN (${versionParams.join(", ")})`,
      [code, ...values.flatMap(([version, metadata]) => [
        version,
        metadata.snapshotTurn,
        metadata.undoSeat,
      ])],
    );

    return decoded.map((row) => {
      const metadata = repaired.get(row.version);
      return metadata ? { version: row.version, ...metadata } : row as HistoryMetadata;
    });
  }

  /** Complete rollback-compatible metadata repair before accepting traffic.
   * Histories are capped, so each room is decoded and updated independently. */
  async backfillHistoryMetadata(): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT DISTINCT history.room_code
       FROM room_history AS history
       JOIN rooms ON rooms.code = history.room_code
       WHERE rooms.ruleset_version = $1
         AND (history.snapshot_turn IS NULL OR history.undo_seat IS NULL)`,
      [this.rulesetVersion],
    );
    for (const [index, value] of rows.entries()) {
      const row = dbObject(value, "<history>", `rooms[${index}]`);
      if (typeof row.room_code !== "string") {
        throw new CorruptRoomError("<history>", `rooms[${index}].room_code`, "expected a string");
      }
      await withTransaction(this.db, async (db) => {
        await this.loadHistoryMetadata(db, row.room_code as string, this.rulesetVersion);
      });
    }
    return rows.length;
  }

  private async retryVersionConflicts<T>(
    work: () => Promise<T>,
    exhausted: () => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (error !== VERSION_CONFLICT) throw error;
      }
    }
    return exhausted();
  }

  /** Load → mutate → conditional save, optionally snapshot, and retry on a
   * version conflict. The conditional update precedes history insertion, so
   * concurrent writers cannot commit the same snapshot version. */
  private async withRetry<T>(
    code: string,
    fn: (room: RoomRow) => RoomMutation<T> | Promise<RoomMutation<T>>,
    command?: {
      meta: RoomCommand;
      credentials: SeatCredentials;
      type: string;
      duplicateResult: (room: RoomRow) => T;
    },
    options?: { lockMatchmaking?: (room: RoomRow) => boolean },
  ): Promise<RoomMutationResult<T>> {
    return this.retryVersionConflicts<RoomMutationResult<T>>(
      () => withTransaction(this.db, async (db) => {
        const room = await this.loadRoom(db, code);
        if (!room) return { ok: false as const, error: "room not found" };
        if (options?.lockMatchmaking?.(room)) {
          // Matchmaking takes the same row lock before assigning a retained
          // opener. Manual seat fills must serialize with that assignment so
          // one account cannot be committed into two rooms concurrently.
          await db.query(
            "SELECT format FROM matchmaking_locks WHERE format = $1 FOR UPDATE",
            [room.format],
          );
        }
        let commandSeat: SeatIndex | null = null;
        if (command) {
          commandSeat = seatForCredentials(room, command.credentials);
          if (commandSeat === null) return { ok: false as const, error: "not a player in this room" };
          const { rows } = await db.query(
            `SELECT committed_version FROM room_commands
             WHERE room_code = $1 AND seat = $2 AND command_id = $3`,
            [code, commandSeat, command.meta.id],
          );
          if (rows.length > 0) {
            return {
              ok: true as const,
              result: command.duplicateResult(room),
              version: Number(rows[0]!.committed_version),
            };
          }
          if (room.version !== command.meta.expectedVersion) {
            return { ok: false as const, error: "stale room version" };
          }
        }
        const preferencesBefore = room.seats.map((seat) => seat
          ? [seat.priorityMode ?? "always-pause", seat.runechantSkip ?? false] as const
          : null);
        const out = await fn(room);
        if ("error" in out) return { ok: false as const, error: out.error };
        const fullSeatWrites = new Set(
          (out.seatWrites ?? [])
            .filter((write): write is Extract<SeatWrite, { kind: "full" }> => write.kind === "full")
            .map((write) => write.seat),
        );
        const preferenceSeats = ([0, 1] as const).filter((seat) => {
          const before = preferencesBefore[seat];
          const after = out.room.seats[seat];
          return before != null && after !== null && !fullSeatWrites.has(seat)
            && (before[0] !== (after.priorityMode ?? "always-pause") || before[1] !== (after.runechantSkip ?? false));
        });
        await this.persistSeatPreferences(db, out.room, preferenceSeats);
        if (out.versionNeutral) {
          if (out.snapshot || out.replay || out.events || out.releaseMatchmaking
            || (out.seatWrites?.length ?? 0) > 0) {
            throw new Error("version-neutral room mutation included versioned writes");
          }
          return { ok: true as const, result: out.result, version: room.version };
        }
        updateGc(out.room);
        if (!(await this.save(out.room, db))) throw VERSION_CONFLICT;
        await this.applySeatWrites(db, out.room, out.seatWrites ?? []);
        if (out.releaseMatchmaking) {
          const released = out.releaseMatchmaking.joiningUserId === undefined
            ? await db.query(
                "DELETE FROM matchmaking_entries WHERE retained_room_code = $1 RETURNING user_id",
                [out.room.code],
              )
            : await db.query(
                `DELETE FROM matchmaking_entries
                 WHERE retained_room_code = $1 OR user_id = $2
                 RETURNING user_id`,
                [out.room.code, out.releaseMatchmaking.joiningUserId],
              );
          if (released.rows.length > 0) {
            await appendClusterEvent(db, { type: "queue-changed" });
          }
        }
        if (out.snapshot) await this.saveSnapshot(db, room, out.snapshot);
        let replayFinalizationId: string | undefined;
        if (out.replay?.kind === "start" && out.room.state) {
          const participants = ([0, 1] as const).map((seat) => {
            const member = out.room.seats[seat];
            const heroId = member ? heroIdForSeat(member) : undefined;
            if (!member || !heroId) throw new Error("started replay is missing a participant");
            return { seat, userId: member.userId, heroId };
          }) as [
            { seat: 0; userId?: number; heroId: string },
            { seat: 1; userId?: number; heroId: string },
          ];
          await startReplay(db, {
            roomCode: out.room.code,
            rulesetVersion: out.room.rulesetVersion,
            format: out.room.format,
            state: out.room.state,
            roomVersion: room.version + 1,
            participants,
          });
        } else if (out.replay?.kind === "frame" && out.room.state) {
          replayFinalizationId = (await appendReplayView(
            db,
            out.room.code,
            room.version + 1,
            out.room.state,
            out.room.state.winner,
            out.room.lastTransition?.fromVersion === room.version
              ? out.room.lastTransition
              : null,
          )) ?? undefined;
        }
        for (const event of out.events ?? []) await appendClusterEvent(db, event);
        await appendClusterEvent(db, {
          type: "room",
          event: { code: out.room.code, kind: "sync", version: room.version + 1 },
        });
        if (command && commandSeat !== null) {
          await db.query(
            `INSERT INTO room_commands
              (room_code, seat, command_id, command_type, expected_version, committed_version, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [code, commandSeat, command.meta.id, command.type, command.meta.expectedVersion, room.version + 1, Date.now()],
          );
        }
        return {
          ok: true as const,
          result: out.result,
          version: room.version + 1,
          ...(replayFinalizationId ? { replayFinalizationId } : {}),
        };
      }),
      () => ({ ok: false, error: "room is busy, try again" }),
    );
  }

  /** What a player seat plays with: a preconstructed hero (classic-battles)
   *  or a saved deck (cc/silver-age — ownership/format checked by the caller). */
  async createRoom(
    format: Format,
    seat: {
      hero?: HeroId;
      deckId?: string;
      deckName?: string;
      username?: string;
      userId?: number;
      fromQueue?: boolean;
    },
    visibility: "public" | "private" = "public",
    allowFutureCards = false,
  ): Promise<{ code: string; seat: number; token: string; version: number }> {
    // snapshot the hero for prep-room display (best-effort; caller validated)
    const heroId =
      format !== "classic-battles" && seat.deckId
        ? (await resolveDeck(this.db, seat.deckId))?.decklist.heroId
        : undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const code = newCode();
      const token = newToken();
      try {
        // gc_at armed up front (covers a creator whose socket never attaches);
        // the attach that follows immediately clears it via markPresent.
        await withTransaction(this.db, async (db) => {
          await assertActiveRuleset(db, this.rulesetVersion);
          const now = Date.now();
          await db.query(
            `INSERT INTO rooms
              (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at, status, winner, is_private, allow_future_cards)
             VALUES ($1, $2, '[]', NULL, NULL, $3, 0, $4, $5, 'open', NULL, $6, $7)`,
            [code, format, this.rulesetVersion, now, now + GC_DELAY_MS, visibility === "private", allowFutureCards],
          );
          await db.query(
            `INSERT INTO room_seats
              (room_code, seat, user_id, token_hash, username, hero, hero_id, deck_id, deck_name, from_queue, ready)
             VALUES ($1,0,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)`,
            [code, seat.userId ?? null, hashReconnectToken(token), seat.username ?? null,
              seat.hero ?? null, heroId ?? null, seat.deckId ?? null, seat.deckName ?? null,
              seat.fromQueue ?? false],
          );
          await appendClusterEvent(db, {
            type: "room",
            event: { code, kind: "sync", version: 0 },
          });
        });
        return { code, seat: 0, token, version: 0 };
      } catch (e) {
        // primary-key collision on the random code → try another one
        if (!String((e as Error).message).includes("duplicate")) throw e;
      }
    }
    throw new Error("could not allocate a room code");
  }

  /** Create a constructed room with its durable, connectionless AI seat. */
  async createBotRoom(
    format: "cc" | "silver-age",
    seat: {
      deckId: string;
      deckName?: string;
      username: string;
      userId: number;
    },
    allowFutureCards = false,
    bot: BotOpponent = format === "cc" ? "hala" : "briar",
  ): Promise<{ code: string; seat: number; token: string; version: number }> {
    const definition = botDefinition(bot);
    if (!definition || definition.format !== format) {
      throw new Error(`${bot} is not available in ${format}`);
    }
    const created = await this.createRoom(format, seat, "private", allowFutureCards);
    const joined = await this.joinRoom(created.code, undefined, {
      allowPlayer: true,
      deckId: definition.deckId,
      deckName: definition.deckName,
      username: definition.username,
      controller: "bot",
    });
    if (!joined.ok || joined.kind !== "player") {
      throw new Error(`could not seat ${definition.username}: ${joined.ok ? "unexpected spectator" : joined.error}`);
    }
    return { ...created, version: joined.version };
  }

  private async matchmakingSeat(
    db: Queryable,
    format: Format,
    choice: MatchmakingChoice,
  ): Promise<SeatRow | null> {
    if (format === "classic-battles") {
      if (!(choice.hero === "rhinar" || choice.hero === "dorinthea")) return null;
      return {
        tokenHash: hashReconnectToken(newToken()),
        hero: choice.hero,
        username: choice.username,
        userId: choice.userId,
        fromQueue: true,
        priorityMode: "always-pause",
        runechantSkip: false,
        lastSeenAt: 0,
      };
    }
    if (!choice.deckId) return null;
    const deck = await resolveDeck(db, choice.deckId);
    if (!deck || deck.format !== format || (deck.userId !== 0 && deck.userId !== choice.userId)) return null;
    if (formatLegalityErrors(cardData, deck.decklist, format, {
      allowFutureCards: choice.allowFutureCards,
    }).length > 0) return null;
    return {
      tokenHash: hashReconnectToken(newToken()),
      deckId: deck.id,
      deckName: choice.deckName ?? deck.name,
      heroId: deck.decklist.heroId,
      username: choice.username,
      userId: choice.userId,
      fromQueue: true,
      priorityMode: "always-pause",
      runechantSkip: false,
      lastSeenAt: 0,
    };
  }

  /** Durable FIFO matchmaking. Updating one format lock row serializes pairing
   * transactions in PostgreSQL without coupling a queue to any gateway. */
  async queueForMatch(format: Format, choice: MatchmakingChoice): Promise<MatchmakingResult> {
    return withTransaction(this.db, async (db) => {
      await assertActiveRuleset(db, this.rulesetVersion);
      await db.query(
        "UPDATE matchmaking_locks SET generation = generation + 1 WHERE format = $1",
        [format],
      );

      const assigned = await db.query(
        `SELECT rs.room_code, r.version
         FROM room_seats rs
         JOIN rooms r ON r.code = rs.room_code
         JOIN (
           SELECT room_code, COUNT(*) AS occupied FROM room_seats GROUP BY room_code
         ) occupancy ON occupancy.room_code = r.code
         WHERE rs.user_id = $1 AND rs.from_queue = TRUE AND r.status = 'prep'
           AND occupancy.occupied = 2
         ORDER BY r.created_at DESC LIMIT 1`,
        [choice.userId],
      );
      if (assigned.rows.length > 0) {
        const code = String(assigned.rows[0]!.room_code);
        const version = Number(assigned.rows[0]!.version);
        await appendClusterEvent(db, { type: "match-ready", userId: choice.userId, code, created: false });
        return { ok: true as const, kind: "matched" as const, code, version };
      }

      // A gateway can recycle after creating an avoided-opponent fallback but
      // before attaching its socket. Reuse that durable opener on retry.
      const existingOpening = await db.query(
        `SELECT q.retained_room_code, r.version
         FROM matchmaking_entries q
         JOIN rooms r ON r.code = q.retained_room_code
         JOIN room_seats rs ON rs.room_code = r.code AND rs.user_id = q.user_id
         JOIN (
           SELECT room_code, COUNT(*) AS occupied FROM room_seats GROUP BY room_code
         ) occupancy ON occupancy.room_code = r.code
         WHERE q.user_id = $1 AND q.format = $2 AND q.allow_future_cards = $3
           AND q.retained_room_code IS NOT NULL AND occupancy.occupied = 1
           AND r.status = 'open'
         LIMIT 1`,
        [choice.userId, format, choice.allowFutureCards],
      );
      if (existingOpening.rows.length > 0) {
        return {
          ok: true as const,
          kind: "opened" as const,
          code: String(existingOpening.rows[0]!.retained_room_code),
          version: Number(existingOpening.rows[0]!.version),
        };
      }

      await db.query("DELETE FROM matchmaking_entries WHERE user_id = $1", [choice.userId]);
      await db.query(
        `INSERT INTO matchmaking_entries
          (user_id, format, hero, deck_id, deck_name, allow_future_cards, retained_room_code, joined_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          choice.userId,
          format,
          choice.hero ?? null,
          choice.deckId ?? null,
          choice.deckName ?? null,
          choice.allowFutureCards,
          choice.retainedRoomCode?.toUpperCase() ?? null,
          choice.joinedAt ?? Date.now(),
        ],
      );

      const currentSeat = await this.matchmakingSeat(db, format, choice);
      if (!currentSeat) {
        await db.query("DELETE FROM matchmaking_entries WHERE user_id = $1", [choice.userId]);
        await appendClusterEvent(db, { type: "queue-changed" });
        return { ok: false as const, error: "your queued deck is no longer available" };
      }

      const openMatchmakingRoom = async (): Promise<Extract<MatchmakingResult, { kind: "opened" }>> => {
        const code = newCode();
        const now = Date.now();
        const room: RoomRow = {
          code,
          format,
          seats: [currentSeat, null],
          spectators: [],
          state: null,
          prep: null,
          version: 0,
          createdAt: now,
          gcAt: now + GC_DELAY_MS,
          prepDeadlineAt: null,
          rulesetVersion: this.rulesetVersion,
          isPrivate: false,
          allowFutureCards: choice.allowFutureCards,
          lastTransition: null,
        };
        await db.query(
          `INSERT INTO rooms
            (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
             status, winner, is_private, allow_future_cards, prep_deadline_at)
           VALUES ($1,$2,'[]',NULL,NULL,$3,0,$4,$5,'open',NULL,FALSE,$6,NULL)`,
          [code, format, this.rulesetVersion, now, room.gcAt, choice.allowFutureCards],
        );
        await this.applySeatWrites(db, room, [{ kind: "full", seat: 0, mode: "insert" }]);
        await db.query(
          "UPDATE matchmaking_entries SET retained_room_code = $2 WHERE user_id = $1",
          [choice.userId, code],
        );
        await appendClusterEvent(db, { type: "room", event: { code, kind: "sync", version: 0 } });
        await appendClusterEvent(db, { type: "queue-changed" });
        return { ok: true, kind: "opened", code, version: 0 };
      };

      const waitForOpponent = async (): Promise<Extract<MatchmakingResult, { kind: "queued" }>> => {
        await appendClusterEvent(db, { type: "queue-waiting", userId: choice.userId, format });
        await appendClusterEvent(db, { type: "queue-changed" });
        return { ok: true, kind: "queued" };
      };

      const avoidRoomCodes = [...new Set((choice.avoidRoomCodes ?? [])
        .map((code) => code.toUpperCase())
        .filter((code) => /^[A-Z0-9]{6}$/.test(code)))]
        .slice(0, MAX_MATCHMAKING_AVOID_ROOM_CODES);
      const avoidPlaceholders = avoidRoomCodes.map((_, index) => `$${index + 6}`).join(", ");
      const avoidClause = avoidRoomCodes.length > 0
        ? `AND (q.retained_room_code IS NULL OR q.retained_room_code NOT IN (${avoidPlaceholders}))`
        : "";

      const { rows } = await db.query(
        `SELECT q.user_id, u.username, q.hero, q.deck_id, q.deck_name,
                q.allow_future_cards, q.retained_room_code
         FROM matchmaking_entries q
         JOIN users u ON u.id = q.user_id
         JOIN (
           SELECT DISTINCT live_seat.room_code, live_seat.user_id
           FROM room_seats live_seat
           JOIN room_presence p
             ON p.room_code = live_seat.room_code
            AND p.seat = live_seat.seat
            AND p.token_hash = live_seat.token_hash
           WHERE p.last_seen_at > $5
         ) live
           ON live.room_code = q.retained_room_code
          AND live.user_id = q.user_id
         WHERE q.format = $1 AND q.allow_future_cards = $2 AND q.user_id <> $3
           AND (q.retained_room_code IS NULL OR $4::text IS NULL)
           AND q.retained_room_code IS NOT NULL
           ${avoidClause}
         ORDER BY q.joined_at, q.user_id LIMIT 1`,
        [
          format,
          choice.allowFutureCards,
          choice.userId,
          choice.retainedRoomCode ?? null,
          Date.now() - PRESENCE_TIMEOUT_MS,
          ...avoidRoomCodes,
        ],
      );
      if (rows.length === 0) {
        // Every unmatched new search becomes a visible one-seat opener. A
        // survivor already owns a retained room and simply keeps waiting in it.
        if (!choice.retainedRoomCode) return openMatchmakingRoom();
        return waitForOpponent();
      }

      const raw = dbObject(rows[0], "<matchmaking>", "opponent");
      const opponent: MatchmakingChoice = {
        userId: Number(raw.user_id),
        username: String(raw.username),
        ...(raw.hero === "rhinar" || raw.hero === "dorinthea" ? { hero: raw.hero } : {}),
        ...(typeof raw.deck_id === "string" ? { deckId: raw.deck_id } : {}),
        ...(typeof raw.deck_name === "string" ? { deckName: raw.deck_name } : {}),
        allowFutureCards: raw.allow_future_cards === true,
        ...(typeof raw.retained_room_code === "string" ? { retainedRoomCode: raw.retained_room_code } : {}),
      };
      const opponentSeat = await this.matchmakingSeat(db, format, opponent);
      if (!opponentSeat) {
        await db.query("DELETE FROM matchmaking_entries WHERE user_id = $1", [opponent.userId]);
        if (!choice.retainedRoomCode) return openMatchmakingRoom();
        return waitForOpponent();
      }

      let room: RoomRow | null = null;
      let createdFreshRoom = false;
      const retainedCode = opponent.retainedRoomCode ?? choice.retainedRoomCode;
      const retainedOwner = opponent.retainedRoomCode ? opponent : choice;
      const incomingSeat = opponent.retainedRoomCode ? currentSeat : opponentSeat;
      if (retainedCode) {
        const retained = await this.loadRoom(db, retainedCode.toUpperCase());
        const ownerSeat = retained?.seats.findIndex((seat) => seat?.userId === retainedOwner.userId) ?? -1;
        const freeSeat = retained?.seats[0] === null ? 0 : retained?.seats[1] === null ? 1 : -1;
        if (retained && !retained.state && ownerSeat !== -1 && freeSeat !== -1) {
          retained.seats[freeSeat] = incomingSeat;
          for (const member of retained.seats) if (member) member.accepted = false;
          retained.prep = rollDice();
          retained.prepDeadlineAt = Date.now() + MATCH_ACCEPT_MS;
          updateGc(retained);
          if (!(await this.save(retained, db))) throw VERSION_CONFLICT;
          await this.applySeatWrites(db, retained, [
            { kind: "full", seat: ownerSeat as SeatIndex, mode: "update" },
            { kind: "full", seat: freeSeat as SeatIndex, mode: "insert" },
          ]);
          room = { ...retained, version: retained.version + 1 };
        }
      }

      if (!room) {
        createdFreshRoom = true;
        const code = newCode();
        const now = Date.now();
        room = {
          code,
          format,
          seats: [opponentSeat, currentSeat],
          spectators: [],
          state: null,
          prep: rollDice(),
          version: 0,
          createdAt: now,
          gcAt: now + GC_DELAY_MS,
          prepDeadlineAt: now + MATCH_ACCEPT_MS,
          rulesetVersion: this.rulesetVersion,
          isPrivate: false,
          allowFutureCards: choice.allowFutureCards,
          lastTransition: null,
        };
        await db.query(
          `INSERT INTO rooms
            (code, format, spectators, state, prep, ruleset_version, version, created_at, gc_at,
             status, winner, is_private, allow_future_cards, prep_deadline_at)
           VALUES ($1,$2,'[]',NULL,$3,$4,0,$5,$6,'prep',NULL,FALSE,$7,$8)`,
          [code, format, JSON.stringify(room.prep), this.rulesetVersion, now, room.gcAt, choice.allowFutureCards, room.prepDeadlineAt],
        );
        await this.applySeatWrites(db, room, [
          { kind: "full", seat: 0, mode: "insert" },
          { kind: "full", seat: 1, mode: "insert" },
        ]);
      }

      await db.query("DELETE FROM matchmaking_entries WHERE user_id IN ($1, $2)", [choice.userId, opponent.userId]);
      await appendClusterEvent(db, { type: "room", event: { code: room.code, kind: "sync", version: room.version } });
      await appendClusterEvent(db, { type: "match-ready", userId: choice.userId, code: room.code, created: false });
      await appendClusterEvent(db, { type: "match-ready", userId: opponent.userId, code: room.code, created: createdFreshRoom });
      await appendClusterEvent(db, { type: "queue-changed" });
      return { ok: true as const, kind: "matched" as const, code: room.code, version: room.version };
    });
  }

  async leaveMatchmaking(userId: number): Promise<boolean> {
    return withTransaction(this.db, async (db) => {
      const { rows } = await db.query("SELECT format FROM matchmaking_entries WHERE user_id = $1", [userId]);
      if (rows.length === 0) return false;
      const format = String(rows[0]!.format);
      await db.query("UPDATE matchmaking_locks SET generation = generation + 1 WHERE format = $1", [format]);
      await db.query("DELETE FROM matchmaking_entries WHERE user_id = $1", [userId]);
      await appendClusterEvent(db, { type: "queue-changed" });
      return true;
    });
  }

  async matchmakingCounts(): Promise<Record<Format, number>> {
    const { rows } = await this.db.query(
      "SELECT format, COUNT(*) AS count FROM matchmaking_entries GROUP BY format",
    );
    const counts: Record<Format, number> = { "classic-battles": 0, cc: 0, "silver-age": 0 };
    for (const row of rows) {
      const format = String(row.format);
      if (format === "classic-battles" || format === "cc" || format === "silver-age") {
        counts[format] = Number(row.count);
      }
    }
    return counts;
  }

  /** Matchmade prep room: acknowledge the pairing before sideboarding. */
  async acceptMatch(
    code: string,
    credentials: SeatCredentials,
  ): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
    const r = await this.withRetry<undefined>(code.toUpperCase(), (room) => {
      if (room.state) return { error: "game has already started" };
      const seatIdx = seatForCredentials(room, credentials);
      if (seatIdx === null) return { error: "not a player in this room" };
      if (matchPrepPhase(room) !== "accept") {
        return room.seats[seatIdx]?.accepted
          ? { room, result: undefined, versionNeutral: true }
          : { error: "this room is not awaiting match acceptance" };
      }
      if (room.prepDeadlineAt !== null && Date.now() >= room.prepDeadlineAt) {
        return { error: "match acceptance expired" };
      }
      const member = room.seats[seatIdx]!;
      if (member.accepted) return { room, result: undefined, versionNeutral: true };
      member.accepted = true;
      if (room.seats.every((seat) => seat?.accepted === true)) {
        room.prepDeadlineAt = Date.now() + MATCH_FIRST_PICK_MS;
      }
      return {
        room,
        result: undefined,
        seatWrites: [{ kind: "full", seat: seatIdx, mode: "update" }],
      };
    });
    return r.ok ? { ok: true, version: r.version } : { ok: false, error: r.error };
  }

  /**
   * Reconnect by token (player seat or spectator), else reclaim a seat owned
   * by this account (covers a lost/overwritten client session token), else
   * take the free seat, else spectate. Classic-battles: the joiner picks their
   * box hero via opts.hero (mirrors allowed); without one they default to the
   * opposite of the seated player. Filling the room only rolls the prep
   * die — the game starts once both seats present decks, ready up, and the
   * authorized player picks who goes first (see presentDeck/chooseFirst).
   * cc/silver-age rooms require opts.deckId to take a player seat; the deck
   * must exist and match the room's format.
   */
  async joinRoom(
    code: string,
    token: string | undefined,
    opts: {
      allowPlayer: boolean;
      /** classic-battles player seats: the joiner's chosen box hero */
      hero?: HeroId;
      deckId?: string;
      deckName?: string;
      username?: string;
      userId?: number;
      fromQueue?: boolean;
      controller?: "bot";
      /** force a spectator slot even when a player seat is free */
      spectate?: boolean;
    },
  ): Promise<JoinResult> {
    const upperCode = code.toUpperCase();
    const r = await this.withRetry<WithoutVersion<Extract<JoinResult, { ok: true }>>>(upperCode, async (room) => {
      if (token) {
        const tokenHash = hashReconnectToken(token);
        const seat = room.seats.findIndex((s) => s?.tokenHash === tokenHash);
        if (seat !== -1) {
          if (!opts.allowPlayer) return { error: PLAY_REQUIRES_LOGIN };
          const seatRow = room.seats[seat]!;
          if (seatRow.userId != null && seatRow.userId !== opts.userId) {
            return { error: "seat belongs to another account" };
          }
          const rotatedToken = newToken();
          seatRow.tokenHash = hashReconnectToken(rotatedToken);
          return {
            room,
            seatWrites: [{ kind: "full", seat: seat as SeatIndex, mode: "update" }],
            result: {
              ok: true,
              kind: "player",
              seat,
              token: rotatedToken,
              reconnected: true,
              started: false,
            } as const,
          };
        }
        if (room.spectators.some((s) => s.tokenHash === tokenHash)) {
          return {
            room,
            result: { ok: true, kind: "spectator", seat: null, token, reconnected: true } as const,
          };
        }
      }
      // Lost session token (client keeps only one stored session — spectating
      // another room overwrites it — and storage can be cleared outright): a
      // account that owns a seat reclaims it instead of landing in a
      // new spectator slot on its own full room.
      if (opts.userId != null) {
        const owned = room.seats.findIndex((s) => s?.userId === opts.userId);
        if (owned !== -1) {
          if (!opts.allowPlayer) return { error: PLAY_REQUIRES_LOGIN };
          const rotatedToken = newToken();
          room.seats[owned]!.tokenHash = hashReconnectToken(rotatedToken);
          return {
            room,
            seatWrites: [{ kind: "full", seat: owned as SeatIndex, mode: "update" }],
            result: {
              ok: true,
              kind: "player",
              seat: owned,
              token: rotatedToken,
              reconnected: true,
              started: false,
            } as const,
          };
        }
      }
      const freeSeat = room.seats[0] === null ? 0 : room.seats[1] === null ? 1 : -1;
      // A reconnect credential that no longer owns any membership must not
      // fall through and silently claim the seat it just lost to a timeout.
      // Full rooms retain the longstanding behavior of admitting it as a
      // spectator instead.
      if (token && freeSeat !== -1 && !opts.spectate) return { error: "room session expired" };
      if (opts.spectate || freeSeat === -1) {
        // prune dead spectator rows (presence expired) so departed watchers
        // never fill the cap; rows at 0 are fresh joins not yet attach-stamped
        const now = Date.now();
        room.spectators = room.spectators.filter(
          (s) => s.lastSeenAt === 0 || isPresent(s.lastSeenAt, now),
        );
        if (room.spectators.length >= MAX_SPECTATORS) {
          return { error: "this room is full" };
        }
        const t = newToken();
        room.spectators.push({ tokenHash: hashReconnectToken(t), lastSeenAt: 0 });
        return {
          room,
          result: { ok: true, kind: "spectator", seat: null, token: t, reconnected: false } as const,
        };
      }
      if (!opts.allowPlayer) return { error: PLAY_REQUIRES_LOGIN };

      // Keep an abandoned opener available for its owner to reconnect, but do
      // not let a new player revive it during the GC grace period. Account and
      // token reclaims returned above; the bot bypass is only for the
      // connectionless seat installed while createBotRoom is composing.
      const host = room.seats[1 - freeSeat];
      if (opts.controller !== "bot" && (!host || !isPresent(host.lastSeenAt, Date.now()))) {
        return { error: "room host is disconnected" };
      }

      // Resolve this seat's deck/hero before mutating anything.
      let seatRow: SeatRow;
      if (room.format === "classic-battles") {
        // the joiner's chosen hero (mirrors allowed); older clients that send
        // none default to the opposite of the seated player
        const otherHero = room.seats[1 - freeSeat]?.hero ?? "rhinar";
        const hero: HeroId =
          opts.hero === "rhinar" || opts.hero === "dorinthea"
            ? opts.hero
            : otherHero === "dorinthea"
              ? "rhinar"
              : "dorinthea";
        seatRow = { tokenHash: "", hero, username: opts.username, userId: opts.userId, fromQueue: opts.fromQueue, lastSeenAt: 0 };
      } else {
        if (!opts.deckId) return { error: `choose a ${room.format} deck to take this seat` };
        const deck = await resolveDeck(this.db, opts.deckId);
        if (!deck || deck.format !== room.format) {
          return { error: `choose a ${room.format} deck to take this seat` };
        }
        const legality = formatLegalityErrors(cardData, deck.decklist, room.format, {
          allowFutureCards: room.allowFutureCards,
        });
        if (legality.length > 0) return { error: legality.join("; ") };
        seatRow = {
          tokenHash: "",
          deckId: deck.id,
          deckName: deck.name,
          username: opts.username,
          userId: opts.userId,
          heroId: deck.decklist.heroId,
          fromQueue: opts.fromQueue,
          controller: opts.controller,
          lastSeenAt: 0,
        };
      }

      // filling the room rolls the prep die; the game starts via maybeStart
      const fillsMatchmakingRoom = opts.fromQueue !== true
        && room.seats[1 - freeSeat]?.fromQueue === true;
      if (!room.state && room.seats[1 - freeSeat]) {
        room.prep = rollDice();
        const matchmade = opts.fromQueue === true && room.seats[1 - freeSeat]?.fromQueue === true;
        room.prepDeadlineAt = matchmade ? Date.now() + MATCH_ACCEPT_MS : null;
        for (const member of room.seats) if (member) member.accepted = false;
      }

      const t = newToken();
      seatRow.tokenHash = hashReconnectToken(t);
      room.seats[freeSeat] = seatRow;
      return {
        room,
        seatWrites: [{ kind: "full", seat: freeSeat as SeatIndex, mode: "insert" }],
        ...(fillsMatchmakingRoom
          ? { releaseMatchmaking: { joiningUserId: opts.userId } }
          : {}),
        result: { ok: true, kind: "player", seat: freeSeat, token: t, reconnected: false, started: false } as const,
      };
    }, undefined, {
      lockMatchmaking: (room) => opts.fromQueue !== true
        && !opts.spectate
        && room.seats.some((seat) => seat?.fromQueue === true),
    });
    // Load first so stale lease timestamps drive spectator pruning, then
    // remove the now-orphaned lease rows. The periodic sweeper does the same
    // cleanup globally.
    await this.db.query(
      "DELETE FROM room_presence WHERE room_code = $1 AND last_seen_at <= $2",
      [upperCode, Date.now() - PRESENCE_TIMEOUT_MS],
    );
    return r.ok ? { ...r.result, version: r.version } : { ok: false, error: r.error };
  }

  /**
   * Prep room: present a deck (validated against the seat's pool — the saved
   * pool for cc/silver-age, the fixed box list for classic-battles) and lock
   * in. The first-player pick must already be in; the game starts once both
   * seats are ready.
   */
  async presentDeck(
    code: string,
    credentials: SeatCredentials,
    presented: PresentedDeck,
  ): Promise<{ ok: true; started: boolean; version: number } | { ok: false; error: string }> {
    const r = await this.withRetry<{ started: boolean }>(code.toUpperCase(), async (room) => {
      if (room.state) return { error: "game has already started" };
      const seatIdx = seatForCredentials(room, credentials);
      if (seatIdx === null) return { error: "not a player in this room" };
      const seat = room.seats[seatIdx]!;
      if (seat.fromQueue && room.seats.every((member) => member?.fromQueue === true)) {
        if (!seat.accepted) return { error: "accept the match first" };
        if (matchPrepPhase(room) !== "prepare") return { error: "the match is not in deck preparation" };
        if (room.prepDeadlineAt !== null && Date.now() >= room.prepDeadlineAt) {
          return { error: "deck preparation expired" };
        }
      }
      if (room.prep?.startPlayer == null) {
        return { error: "choose who goes first before readying up" };
      }
      const pool =
        room.format === "classic-battles"
          ? deckPoolForHero(seat.hero ?? "rhinar")
          : (seat.deckId ? await resolveDeck(this.db, seat.deckId) : null)?.decklist;
      if (!pool) return { error: "your deck is no longer available" };
      const v = validatePresentation(pool, presented, room.format, {
        allowFutureCards: room.allowFutureCards,
      });
      if (!v.ok) return { error: v.error };
      seat.presented = v.decklist;
      seat.ready = true;
      const fullSeats = new Set<SeatIndex>([seatIdx]);
      const botSeat = room.seats.findIndex((candidate) => candidate?.controller === "bot");
      if (botSeat !== -1 && botSeat !== seatIdx) {
        const bot = room.seats[botSeat]!;
        const registered = bot.deckId ? precon(bot.deckId) : null;
        if (!registered || registered.format !== room.format) {
          return { error: "bot precon is not available" };
        }
        const definition = botDefinitionForDeckId(bot.deckId);
        if (!definition || definition.format !== room.format) {
          return { error: "bot precon is not supported" };
        }
        const botPresentation = definition.presentationFor(
          v.decklist,
          room.prep.startPlayer === botSeat ? "first" : "second",
        );
        const botValidation = validatePresentation(registered.pool, botPresentation, room.format, {
          allowFutureCards: room.allowFutureCards,
        });
        if (!botValidation.ok) return { error: botValidation.error };
        bot.presented = botValidation.decklist;
        bot.ready = true;
        fullSeats.add(botSeat as SeatIndex);
      }
      const started = maybeStart(room);
      if (started) room.prepDeadlineAt = null;
      const seatWrites: SeatWrite[] = [...fullSeats].map((seat) => ({
        kind: "full",
        seat,
        mode: "update",
      }));
      if (started) {
        for (const startedSeat of [0, 1] as const) {
          if (fullSeats.has(startedSeat)) continue;
          seatWrites.push({
            kind: "activity",
            seat: startedSeat,
            lastActionAt: room.seats[startedSeat]!.lastActionAt!,
          });
        }
      }
      return { room, result: { started }, seatWrites, ...(started ? { replay: { kind: "start" as const } } : {}) };
    });
    return r.ok ? { ok: true, started: r.result.started, version: r.version } : { ok: false, error: r.error };
  }

  /** Prep room: withdraw readiness to edit the presentation again. */
  async unready(
    code: string,
    credentials: SeatCredentials,
  ): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
    const r = await this.withRetry<undefined>(code.toUpperCase(), (room) => {
      if (room.state) return { error: "game has already started" };
      const seatIdx = seatForCredentials(room, credentials);
      if (seatIdx === null) return { error: "not a player in this room" };
      const seat = room.seats[seatIdx]!;
      if (matchPrepPhase(room) === "choose-first") {
        return { error: "both decks are locked in" };
      }
      seat.ready = false;
      return {
        room,
        result: undefined,
        seatWrites: [{ kind: "full", seat: seatIdx, mode: "update" }],
      };
    });
    return r.ok ? { ok: true, version: r.version } : { ok: false, error: r.error };
  }

  /** Prep room: the die winner picks in PvP; the human always picks against a bot. */
  async chooseFirst(
    code: string,
    credentials: SeatCredentials,
    first: boolean,
  ): Promise<{ ok: true; started: boolean; version: number } | { ok: false; error: string }> {
    const r = await this.withRetry<{ started: boolean }>(code.toUpperCase(), (room) => {
      if (room.state) return { error: "game has already started" };
      if (!room.prep) return { error: "waiting for both players before the die roll" };
      if (room.prep.startPlayer != null) return { error: "first player already chosen" };
      const seatIdx = seatForCredentials(room, credentials);
      if (seatIdx === null) return { error: "not a player in this room" };
      const botSeat = room.seats.findIndex((candidate) => candidate?.controller === "bot");
      const isHumanInBotGame = botSeat !== -1 && seatIdx !== botSeat;
      if (!isHumanInBotGame && seatIdx !== room.prep.dieWinner) {
        return { error: "only the die-roll winner picks" };
      }
      const phase = matchPrepPhase(room);
      if (room.seats.every((member) => member?.fromQueue === true) && phase !== "choose-first") {
        return { error: "both players must accept before choosing who goes first" };
      }
      if (phase === "choose-first"
        && room.prepDeadlineAt !== null && Date.now() >= room.prepDeadlineAt) {
        return { error: "first-player choice expired" };
      }
      room.prep.startPlayer = (first ? seatIdx : 1 - seatIdx) as 0 | 1;
      if (room.seats.every((member) => member?.fromQueue === true)) {
        room.prepDeadlineAt = Date.now() + MATCH_PREP_MS;
      }
      let refreshedBotSeat: SeatIndex | null = null;
      if (botSeat !== -1) {
        const bot = room.seats[botSeat]!;
        const human = room.seats[1 - botSeat];
        const definition = botDefinitionForDeckId(bot.deckId);
        const registered = bot.deckId ? precon(bot.deckId) : null;
        if (!definition || !registered) {
          return { error: "bot deck is not available" };
        }
        // The turn-order decision now comes before Ready. Build the bot's
        // matchup presentation here only for legacy rooms whose human deck was
        // already presented; the normal path defers it to presentDeck.
        if (human?.presented) {
          const presentation = definition.presentationFor(
            human.presented,
            room.prep.startPlayer === botSeat ? "first" : "second",
          );
          const validation = validatePresentation(registered.pool, presentation, room.format, {
            allowFutureCards: room.allowFutureCards,
          });
          if (!validation.ok) return { error: validation.error };
          bot.presented = validation.decklist;
          refreshedBotSeat = botSeat as SeatIndex;
        }
      }
      const started = maybeStart(room);
      if (started) room.prepDeadlineAt = null;
      if (started) this.applyServerShortcuts(room);
      return {
        room,
        result: { started },
        ...(started ? { replay: { kind: "start" as const } } : {}),
        seatWrites: started
          ? ([0, 1] as const).map((seat) => seat === refreshedBotSeat
              ? { kind: "full" as const, seat, mode: "update" as const }
              : {
                  kind: "activity" as const,
                  seat,
                  lastActionAt: room.seats[seat]!.lastActionAt!,
                })
          : refreshedBotSeat === null
          ? []
          : [{ kind: "full" as const, seat: refreshedBotSeat, mode: "update" as const }],
      };
    });
    return r.ok ? { ok: true, started: r.result.started, version: r.version } : { ok: false, error: r.error };
  }

  /**
   * Leave a room before its game started: free the seat (or drop the
   * spectator), clear the prep die. The remaining seat keeps its presentation
   * so a re-queued player doesn't redo sideboarding.
   */
  async leaveRoom(
    code: string,
    credentials: SeatCredentials,
  ): Promise<
    | { ok: true; freedSeat: number | null; remaining: SeatRow | null; format: Format; allowFutureCards: boolean; version: number }
    | { ok: false; error: string }
  > {
    const r = await this.withRetry<{ freedSeat: number | null; remaining: SeatRow | null; format: Format; allowFutureCards: boolean }>(
      code.toUpperCase(),
      (room) => {
        if (room.state) return { error: "game has already started" };
        const tokenHash = hashReconnectToken(credentials.token);
        const tokenSeat = room.seats.findIndex((s) => s?.tokenHash === tokenHash);
        const seatIdx = seatForCredentials(room, credentials);
        if (tokenSeat !== -1 && seatIdx === null) return { error: "not a player in this room" };
        if (seatIdx !== null) {
          const otherSeat = (1 - seatIdx) as SeatIndex;
          const removesBot = room.seats[otherSeat]?.controller === "bot";
          const resetsAcceptance = room.seats[otherSeat]?.accepted === true;
          room.seats[seatIdx] = null;
          room.prep = null;
          room.prepDeadlineAt = null;
          if (room.seats[otherSeat]) room.seats[otherSeat]!.accepted = false;
          // A bot room is private to its human creator. If that player leaves
          // prep, remove the synthetic seat as well instead of listing an
          // orphaned Briar room for matchmaking.
          if (removesBot) {
            room.seats[otherSeat] = null;
          }
          return {
            room,
            seatWrites: [
              { kind: "delete", seat: seatIdx },
              ...(room.seats[otherSeat] && !removesBot && resetsAcceptance
                ? [{ kind: "full" as const, seat: otherSeat, mode: "update" as const }]
                : []),
              ...(removesBot ? [{ kind: "delete" as const, seat: otherSeat }] : []),
            ],
            result: {
              freedSeat: seatIdx,
              remaining: room.seats[otherSeat] ?? null,
              format: room.format,
              allowFutureCards: room.allowFutureCards,
            },
          };
        }
        const specIdx = room.spectators.findIndex((s) => s.tokenHash === tokenHash);
        if (specIdx !== -1) {
          room.spectators.splice(specIdx, 1);
          return {
            room,
            result: {
              freedSeat: null,
              remaining: null,
              format: room.format,
              allowFutureCards: room.allowFutureCards,
            },
          };
        }
        return { error: "not in this room" };
      },
    );
    return r.ok ? { ok: true, ...r.result, version: r.version } : { ok: false, error: r.error };
  }

  /** Resolve expired matchmade prep phases. The deadline and seat mutation are
   * committed with their cluster notifications; survivor requeue uses the same
   * durable path as an explicit pre-game leave. */
  async sweepMatchmadePrep(now = Date.now()): Promise<Array<{ code: string; version: number; started: boolean }>> {
    const { rows } = await this.db.query(
      `SELECT code, prep_deadline_at FROM rooms
       WHERE status = 'prep' AND prep_deadline_at IS NOT NULL
       ORDER BY prep_deadline_at, code`,
    );
    const resolved: Array<{ code: string; version: number; started: boolean }> = [];
    for (const raw of rows) {
      if (Number(raw.prep_deadline_at) > now) continue;
      const code = String(raw.code);
      const r = await this.withRetry<{
        started: boolean;
        survivor: { format: Format; choice: MatchmakingChoice } | null;
      }>(code, (room) => {
        if (room.state || room.prepDeadlineAt === null || room.prepDeadlineAt > now) {
          return { room, result: { started: false, survivor: null }, versionNeutral: true };
        }
        const phase = matchPrepPhase(room);
        if (phase === "choose-first") {
          if (!room.prep) return { error: "matchmade prep room has no die roll" };
          room.prep.startPlayer = room.prep.dieWinner;
          room.prepDeadlineAt = now + MATCH_PREP_MS;
          return {
            room,
            result: { started: false, survivor: null },
          };
        }
        if (phase !== "accept" && phase !== "prepare") {
          room.prepDeadlineAt = null;
          return { room, result: { started: false, survivor: null } };
        }

        const timedOut = ([0, 1] as const).filter((seat) => {
          const member = room.seats[seat];
          return phase === "accept" ? member?.accepted !== true : member?.ready !== true;
        });
        const events: ClusterEvent[] = timedOut.flatMap((seat) => {
          const userId = room.seats[seat]?.userId;
          return userId == null ? [] : [{ type: "match-timeout" as const, userId, code }];
        });
        const survivorSeat = timedOut.length === 1 ? (1 - timedOut[0]!) as SeatIndex : null;
        const survivorRow = survivorSeat === null ? null : room.seats[survivorSeat];
        const survivor = survivorRow?.userId == null ? null : {
          format: room.format,
          choice: {
            userId: survivorRow.userId,
            username: survivorRow.username ?? "unknown",
            hero: survivorRow.hero,
            deckId: survivorRow.deckId,
            deckName: survivorRow.deckName,
            retainedRoomCode: room.code,
            allowFutureCards: room.allowFutureCards,
            joinedAt: room.createdAt,
          },
        };
        for (const seat of timedOut) room.seats[seat] = null;
        if (survivorRow) survivorRow.accepted = false;
        room.prep = null;
        room.prepDeadlineAt = null;
        return {
          room,
          result: { started: false, survivor },
          events,
          seatWrites: [
            ...timedOut.map((seat) => ({ kind: "delete" as const, seat })),
            ...(survivorSeat !== null && survivorRow
              ? [{ kind: "full" as const, seat: survivorSeat, mode: "update" as const }]
              : []),
          ],
        };
      });
      if (!r.ok) continue;
      resolved.push({ code, version: r.version, started: r.result.started });
      if (r.result.survivor) {
        await this.queueForMatch(r.result.survivor.format, r.result.survivor.choice);
      }
    }
    return resolved;
  }

  /** Close the active replay and permanently delete a bot room when its seated
   *  human chooses End Game. Authorization, replay closure, and the bot-seat
   *  check happen in the deletion transaction; room history, seats, and
   *  presence cascade from the room row. */
  async deleteBotRoom(
    code: string,
    credentials: SeatCredentials,
  ): Promise<
    { ok: true; version: number; replayFinalizationId?: string }
    | { ok: false; error: string }
  > {
    const upper = code.toUpperCase();
    return this.retryVersionConflicts(
      () => withTransaction(this.db, async (db) => {
        const room = await this.loadRoom(db, upper);
        if (!room) return { ok: false as const, error: "room not found" };
        if (!room.seats.some((seat) => seat?.controller === "bot")) {
          return { ok: false as const, error: "not a bot game" };
        }
        const seat = seatForCredentials(room, credentials);
        if (seat === null || room.seats[seat]?.controller === "bot") {
          return { ok: false as const, error: "not a player in this room" };
        }
        const replayFinalizationId = room.state
          ? (await endReplayForRoom(db, upper)) ?? undefined
          : undefined;
        const { rowCount } = await db.query(
          "DELETE FROM rooms WHERE code = $1 AND version = $2",
          [upper, room.version],
        );
        if (rowCount !== 1) {
          // pg-mem can report zero for a successful cascading delete.
          const { rows } = await db.query("SELECT 1 FROM rooms WHERE code = $1", [upper]);
          if (rows.length !== 0) throw VERSION_CONFLICT;
        }
        await appendClusterEvent(db, {
          type: "room",
          event: { code: upper, kind: "deleted", version: room.version + 1 },
        });
        return {
          ok: true as const,
          version: room.version + 1,
          ...(replayFinalizationId ? { replayFinalizationId } : {}),
        };
      }),
      () => ({ ok: false as const, error: "room is busy, try again" }),
    );
  }

  /** Every live room needed to build personalized lobby lists: public open
   *  rooms (free seat, joinable), public full rooms (spectate-only), and
   *  private rooms that may be shown to their seated accounts. Finished games
   *  are awaiting GC and stay unlisted. Selects only the small columns — the
   *  `state` and `history` blobs stay in the db. */
  async lobbySnapshot(): Promise<LobbyRoomSnapshot[]> {
    const presenceCutoff = Date.now() - PRESENCE_TIMEOUT_MS;
    const { rows } = await this.db.query(
      `SELECT r.code, r.format, r.created_at, (r.status = 'active') AS started,
              r.is_private, r.allow_future_cards,
              (live.room_code IS NOT NULL) AS has_live_player
       FROM rooms r
       LEFT JOIN (
         SELECT DISTINCT p.room_code
         FROM room_presence p
         JOIN room_seats live_seat
           ON live_seat.room_code = p.room_code
          AND live_seat.seat = p.seat
          AND live_seat.token_hash = p.token_hash
         WHERE p.last_seen_at > $1
       ) live ON live.room_code = r.code
       WHERE r.status <> 'finished'`,
      [presenceCutoff],
    );
    const codes = rows.map((row) => String(row.code));
    const seatRows = codes.length === 0 ? [] : (await this.db.query(
      `SELECT room_code, seat, user_id, hero, hero_id FROM room_seats
       WHERE room_code IN (${codes.map((_, index) => `$${index + 1}`).join(", ")})`,
      codes,
    )).rows;
    const seatsByRoom = new Map<string, [SeatRow | null, SeatRow | null]>();
    for (const rawSeat of seatRows) {
      const pair = seatsByRoom.get(String(rawSeat.room_code)) ?? [null, null];
      const index = Number(rawSeat.seat);
      pair[index] = {
        tokenHash: "",
        lastSeenAt: 0,
        ...(rawSeat.user_id == null ? {} : { userId: Number(rawSeat.user_id) }),
        ...(typeof rawSeat.hero === "string" ? { hero: rawSeat.hero as HeroId } : {}),
        ...(typeof rawSeat.hero_id === "string" ? { heroId: rawSeat.hero_id } : {}),
      };
      seatsByRoom.set(String(rawSeat.room_code), pair);
    }
    const out: LobbyRoomSnapshot[] = [];
    for (const raw of rows as {
      code: string;
      format: Format;
      created_at: number;
      started: boolean;
      is_private: boolean;
      allow_future_cards: boolean;
      has_live_player: boolean;
    }[]) {
      const format = raw.format;
      const [a, b] = seatsByRoom.get(raw.code) ?? [null, null];
      const ownerIds = [a?.userId, b?.userId].filter((id): id is number => id != null);
      if (a && b) {
        // full room: watchable, not joinable
        out.push({
          room: {
            code: raw.code,
            format,
            heroes: [heroNameForSeat(a), heroNameForSeat(b)],
            createdAt: Number(raw.created_at),
            ...(raw.allow_future_cards ? { allowFutureCards: true as const } : {}),
            spectateOnly: true,
            ...(raw.started ? { started: true as const } : {}),
          },
          ownerIds,
          isPrivate: raw.is_private,
          hasLivePlayer: raw.has_live_player,
        });
        continue;
      }
      const host = a ?? b;
      if (!host || raw.started) continue; // a started game always has both seats
      out.push({
        room: {
          code: raw.code,
          format,
          heroes: [heroNameForSeat(a), heroNameForSeat(b)],
          createdAt: Number(raw.created_at),
          ...(raw.allow_future_cards ? { allowFutureCards: true as const } : {}),
        },
        ownerIds,
        isPrivate: raw.is_private,
        hasLivePlayer: raw.has_live_player,
      });
    }
    return out.sort((a, b) => a.room.createdAt - b.room.createdAt);
  }

  personalizeLobby(snapshot: LobbyRoomSnapshot[], userId?: number): RoomSummary[] {
    return snapshot.flatMap(({ room, ownerIds, isPrivate, hasLivePlayer }) => {
      const yours = userId != null && ownerIds.includes(userId);
      // Disconnected rooms remain visible to their owners for reconnect, but
      // are neither discoverable nor presented as joinable to other accounts.
      if ((isPrivate || !hasLivePlayer) && !yours) return [];
      return [{ ...room, ...(yours ? { yours: true } : {}) }];
    });
  }

  async listRooms(userId?: number): Promise<RoomSummary[]> {
    return this.personalizeLobby(await this.lobbySnapshot(), userId);
  }

  /** Landing-page counters in one aggregate query; no JSON state leaves PG. */
  async stats(): Promise<{ inGame: number; openRooms: number }> {
    const { rows } = await this.db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN r.status = 'active' THEN 2 ELSE 0 END), 0) AS in_game,
         COALESCE(SUM(CASE WHEN r.status = 'open' AND r.is_private = FALSE
           AND live.room_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS open_rooms
       FROM rooms r
       LEFT JOIN (
         SELECT DISTINCT p.room_code
         FROM room_presence p
         JOIN room_seats live_seat
           ON live_seat.room_code = p.room_code
          AND live_seat.seat = p.seat
          AND live_seat.token_hash = p.token_hash
         WHERE p.last_seen_at > $1
       ) live ON live.room_code = r.code`,
      [Date.now() - PRESENCE_TIMEOUT_MS],
    );
    return {
      inGame: Number(rows[0]!.in_game),
      openRooms: Number(rows[0]!.open_rooms),
    };
  }

  /** Fold server-owned shortcuts into the current commit, so intermediate
   *  states are never persisted or broadcast. Runechant skipping is checked
   *  first because it can deliberately decline optional prevention; it is
   *  expired before auto-pass is considered at any non-Runechant boundary.
   *  Bot seats always auto-pass empty windows. Automatic steps write no undo
   *  snapshots. */
  private applyServerShortcuts(
    room: RoomRow,
    transitionEvents?: EngineTransitionMove[],
  ): void {
    const autoPasses = (seat: number): boolean =>
      room.seats[seat]?.controller === "bot" || room.seats[seat]?.priorityMode === "auto-pass";
    const hasRunechantSkip = (): boolean => room.seats.some((seat) => seat?.runechantSkip === true);
    if (!autoPasses(0) && !autoPasses(1) && !hasRunechantSkip()) return;
    // Each shortcut strictly advances the game; the bound is insurance only.
    for (let guard = 0; guard < 64; guard++) {
      const state = room.state;
      if (!state || state.winner !== null) {
        for (const member of room.seats) if (member) member.runechantSkip = false;
        return;
      }
      const inRunechantSequence = runechantSequenceActive(state);
      if (!inRunechantSequence && hasRunechantSkip()) {
        // This must happen before auto-pass can traverse a non-Runechant layer:
        // a later Runechant is a new sequence and requires a new click.
        for (const member of room.seats) if (member) member.runechantSkip = false;
      }
      const seat = state.pendingDecision?.player;
      if (seat === undefined) return;
      const skipRunechant =
        inRunechantSequence &&
        room.seats[seat]?.runechantSkip === true &&
        legalIntents(state, seat).some((candidate) => candidate.kind === "skip-runechant");
      const intent: GameIntent | null = skipRunechant
        ? { kind: "skip-runechant" }
        : autoPasses(seat) && isEmptyPriorityWindow(state, seat)
          ? { kind: "pass" }
          : null;
      if (!intent) return;
      const res = engineApplyIntent(state, seat, intent);
      if (!res.ok) return;
      transitionEvents?.push(...res.events);
      room.state = res.state;
    }
  }

  /** Record a seat's priority preference. When auto-pass is enabled while the
   *  seat is already sitting in an empty window, the pass is applied
   *  immediately in one commit (`autoPassed` tells the gateway to broadcast). */
  async setPriorityMode(
    code: string,
    credentials: SeatCredentials,
    mode: PriorityWindowMode,
    command?: RoomCommand,
  ): Promise<{ ok: true; version: number; autoPassed: boolean; replayFinalizationId?: string } | { ok: false; error: string }> {
    const upper = code.toUpperCase();
    const r = await this.withRetry<{ autoPassed: boolean }>(upper, (room) => {
      const seat = seatForCredentials(room, credentials);
      if (seat === null) return { error: "not a player in this room" };
      room.seats[seat]!.priorityMode = mode;
      const shouldPass = mode === "auto-pass"
        && !!room.state
        && room.state.winner === null
        && isEmptyPriorityWindow(room.state, seat);
      if (!shouldPass) return { room, result: { autoPassed: false }, versionNeutral: true };
      const events: EngineTransitionMove[] = [];
      this.applyServerShortcuts(room, events);
      room.lastTransition = { fromVersion: room.version, kind: "forward", events };
      return { room, result: { autoPassed: true }, replay: { kind: "frame" } };
    }, command ? {
      meta: command,
      credentials,
      type: "priority-mode",
      duplicateResult: () => ({ autoPassed: false }),
    } : undefined);
    return r.ok
      ? { ok: true, version: r.version, autoPassed: r.result.autoPassed, ...(r.replayFinalizationId ? { replayFinalizationId: r.replayFinalizationId } : {}) }
      : { ok: false, error: r.error };
  }

  /** Enable or cancel the one-shot shortcut for the continuous Runechant run
   *  presented in this seat's current priority window. A seat cannot arm the
   *  shortcut before its legal choice is visible. */
  async setRunechantSkipping(
    code: string,
    credentials: SeatCredentials,
    enabled: boolean,
    command?: RoomCommand,
  ): Promise<{ ok: true; version: number; advanced: boolean; replayFinalizationId?: string } | { ok: false; error: string }> {
    const upper = code.toUpperCase();
    const r = await this.withRetry<{ advanced: boolean }>(upper, (room) => {
      const seat = seatForCredentials(room, credentials);
      if (seat === null) return { error: "not a player in this room" };
      if (!enabled) {
        room.seats[seat]!.runechantSkip = false;
        return { room, result: { advanced: false }, versionNeutral: true };
      }
      const choicePresented = !!room.state
        && room.state.winner === null
        && room.state.pendingDecision?.player === seat
        && runechantSequenceActive(room.state)
        && legalIntents(room.state, seat).some((candidate) => candidate.kind === "skip-runechant");
      if (!choicePresented) return { room, result: { advanced: false }, versionNeutral: true };
      room.seats[seat]!.runechantSkip = true;
      const events: EngineTransitionMove[] = [];
      this.applyServerShortcuts(room, events);
      room.lastTransition = { fromVersion: room.version, kind: "forward", events };
      return { room, result: { advanced: true }, replay: { kind: "frame" } };
    }, command ? {
      meta: command,
      credentials,
      type: "runechant-skip",
      duplicateResult: () => ({ advanced: false }),
    } : undefined);
    return r.ok
      ? { ok: true, version: r.version, advanced: r.result.advanced, ...(r.replayFinalizationId ? { replayFinalizationId: r.replayFinalizationId } : {}) }
      : { ok: false, error: r.error };
  }

  async applyIntent(
    code: string,
    credentials: SeatCredentials,
    intent: GameIntent,
    options: { autoPass?: boolean } = {},
    command?: RoomCommand,
  ): Promise<{ ok: true; version: number; replayFinalizationId?: string } | { ok: false; error: string }> {
    const r = await this.withRetry(code.toUpperCase(), (room) => {
      if (!room.state) return { error: "game has not started" };
      const seat = seatForCredentials(room, credentials);
      if (seat === null) return { error: "not a player in this room" };
      // autoPass is a presence-only hint from legacy clients: verify the
      // empty-window condition before folding the pass into the preceding
      // action's undo step.
      const verifiedAutoPass =
        options.autoPass === true &&
        intent.kind === "pass" &&
        isEmptyPriorityWindow(room.state, seat);
      const res = engineApplyIntent(room.state, seat, intent);
      if (!res.ok) {
        return { error: res.error };
      }
      // The engine never mutates in place, so undo is just the last snapshot.
      // Staged defenders are cosmetic. Verified automatic passes are part of
      // the preceding meaningful action, so undo rewinds that action and all
      // of the empty priority windows it caused in one step.
      const snapshot = intent.kind !== "stage-defenders" && !verifiedAutoPass
        ? room.state
        : undefined;
      room.state = res.state;
      const events = [...res.events];
      this.applyServerShortcuts(room, events);
      room.lastTransition = { fromVersion: room.version, kind: "forward", events };
      // any applied intent counts as activity (idle-claim timer)
      const seatRow = room.seats[seat];
      if (!seatRow) return { error: "not a player in this room" };
      const lastActionAt = Date.now();
      seatRow.lastActionAt = lastActionAt;
      return {
        room,
        result: undefined,
        snapshot,
        replay: { kind: "frame" },
        seatWrites: [{ kind: "activity", seat, lastActionAt }],
      };
    }, command ? {
      meta: command,
      credentials,
      type: `intent:${intent.kind}`,
      duplicateResult: () => undefined,
    } : undefined);
    return r.ok
      ? { ok: true, version: r.version, ...(r.replayFinalizationId ? { replayFinalizationId: r.replayFinalizationId } : {}) }
      : { ok: false, error: r.error };
  }

  /** Apply one policy-selected bot action against the exact observed version. */
  async applyBotIntent(
    code: string,
    expectedVersion: number,
    intent: GameIntent,
  ): Promise<{ ok: true; version: number; replayFinalizationId?: string } | { ok: false; error: string }> {
    const r = await this.withRetry(code.toUpperCase(), (room) => {
      if (room.version !== expectedVersion) return { error: "stale bot observation" };
      if (!room.state) return { error: "game has not started" };
      const seat = room.seats.findIndex((candidate) => candidate?.controller === "bot");
      if (seat === -1) return { error: "room has no bot" };
      const actor = room.state.pendingDecision?.player ?? room.state.priorityPlayer;
      if (actor !== seat) return { error: "bot does not have priority" };
      const res = engineApplyIntent(room.state, seat, intent);
      if (!res.ok) return { error: res.error };
      const snapshot = intent.kind === "stage-defenders" ? undefined : room.state;
      room.state = res.state;
      const events = [...res.events];
      this.applyServerShortcuts(room, events);
      room.lastTransition = { fromVersion: room.version, kind: "forward", events };
      const botSeat = seat as SeatIndex;
      const lastActionAt = Date.now();
      room.seats[botSeat]!.lastActionAt = lastActionAt;
      return {
        room,
        result: undefined,
        snapshot,
        replay: { kind: "frame" },
        seatWrites: [{ kind: "activity", seat: botSeat, lastActionAt }],
      };
    });
    return r.ok
      ? { ok: true, version: r.version, ...(r.replayFinalizationId ? { replayFinalizationId: r.replayFinalizationId } : {}) }
      : { ok: false, error: r.error };
  }

  /** Active bot rooms are recoverable work after a gateway restart. */
  async botRoomCodes(): Promise<string[]> {
    const { rows } = await this.db.query(
      `SELECT DISTINCT rs.room_code
       FROM room_seats rs
       JOIN rooms r ON r.code = rs.room_code
       WHERE rs.controller = 'bot' AND r.status IN ('prep', 'active')`,
    );
    return rows.map((row) => String(row.room_code));
  }

  /** Revert the last applied intent or rewind to an available turn-start
   * snapshot. Either player may restore shared game state. */
  async undo(
    code: string,
    credentials: SeatCredentials,
    target: UndoTarget = "last-action",
    command?: RoomCommand,
  ): Promise<{ ok: true; version: number; replayFinalizationId?: string } | { ok: false; error: string }> {
    const upper = code.toUpperCase();
    return this.retryVersionConflicts(
      () => withTransaction(this.db, async (db) => {
        const room = await this.loadRoom(db, upper);
        if (!room) return { ok: false as const, error: "room not found" };
        const requestingSeat = seatForCredentials(room, credentials);
        if (requestingSeat === null) {
          return { ok: false as const, error: "not a player in this room" };
        }
        if (command) {
          const { rows } = await db.query(
            `SELECT committed_version FROM room_commands
             WHERE room_code = $1 AND seat = $2 AND command_id = $3`,
            [upper, requestingSeat, command.id],
          );
          if (rows.length > 0) {
            return { ok: true as const, version: Number(rows[0]!.committed_version) };
          }
          if (room.version !== command.expectedVersion) {
            return { ok: false as const, error: "stale room version" };
          }
        }
        if (!room.state) return { ok: false as const, error: "game has not started" };
        if (room.state.winner !== null) return { ok: false as const, error: "game is already over" };
        const candidates = await this.loadHistoryMetadata(db, upper, room.rulesetVersion);
        if (!candidates.length) return { ok: false as const, error: "nothing to undo" };
        const targetTurn = target === "current-turn"
          ? room.state.turn
          : target === "previous-turn"
            ? room.state.turn - 1
            : null;
        const botRoom = room.seats.some((seat) => seat?.controller === "bot");
        const selected = targetTurn === null
          ? (botRoom
              // A snapshot is the state immediately before its actor's
              // intent. Skip the bot's follow-up snapshots so Undo returns
              // to the human's last meaningful choice and the runner cannot
              // instantly repeat the action that was just undone.
              ? candidates.find((candidate) => candidate.undoSeat === requestingSeat)
              : candidates[0])
          : candidates
              .filter((candidate) => candidate.snapshotTurn === targetTurn)
              .at(-1);
        if (!selected) {
          if (target === "last-action") {
            return { ok: false as const, error: "nothing to undo" };
          }
          const label = target === "current-turn" ? "current" : "previous";
          return { ok: false as const, error: `beginning of ${label} turn is not in undo history` };
        }
        const { rows: selectedRows } = await db.query(
          "SELECT state FROM room_history WHERE room_code = $1 AND version = $2",
          [upper, selected.version],
        );
        if (!selectedRows.length) throw VERSION_CONFLICT;
        const selectedRow = dbObject(selectedRows[0], upper, "selectedHistory");
        const prev = hydrateState(selectedRow.state, upper, room.rulesetVersion);
        if (!prev) throw new CorruptRoomError(upper, "selectedHistory.state", "expected game state");
        const undoText = target === "last-action"
          ? "⤺ the last action was undone"
          : `⤺ returned to the beginning of turn ${prev.turn}`;
        room.state = {
          ...prev,
          log: appendGameLog(prev.log, { publicText: undoText }),
        };
        // The restored snapshot can hold an empty window for a seat that
        // opted into auto-pass after the snapshot was written; pass it out
        // in this commit rather than stranding the seat until a resend.
        this.applyServerShortcuts(room);
        room.lastTransition = { fromVersion: room.version, kind: "replace", events: [] };
        updateGc(room);
        if (!(await this.save(room, db))) throw VERSION_CONFLICT;
        await db.query(
          "DELETE FROM room_history WHERE room_code = $1 AND version >= $2",
          [upper, selected.version],
        );
        const replayFinalizationId = await appendReplayView(
          db,
          upper,
          room.version + 1,
          room.state,
          room.state.winner,
          room.lastTransition,
        );
        await appendClusterEvent(db, {
          type: "room",
          event: { code: upper, kind: "sync", version: room.version + 1 },
        });
        if (command) {
          await db.query(
            `INSERT INTO room_commands
              (room_code, seat, command_id, command_type, expected_version, committed_version, created_at)
             VALUES ($1,$2,$3,'undo',$4,$5,$6)`,
            [upper, requestingSeat, command.id, command.expectedVersion, room.version + 1, Date.now()],
          );
        }
        return {
          ok: true as const,
          version: room.version + 1,
          ...(replayFinalizationId ? { replayFinalizationId } : {}),
        };
      }),
      () => ({ ok: false as const, error: "room is busy, try again" }),
    );
  }

  /**
   * End the game in the caller's favor because the opponent has not applied
   * any intent for IDLE_VICTORY_MS. Two server-side checks (the client's
   * toast is only a hint): the opponent's lastActionAt must be stale, AND
   * the game must be waiting on the opponent (their turn or their pending
   * decision) — a player can never claim off their own inaction.
   * Undoable like any other transition (the pre-claim state goes to history).
   */
  async claimVictory(
    code: string,
    credentials: SeatCredentials,
    now = Date.now(),
    command?: RoomCommand,
  ): Promise<{ ok: true; version: number; replayFinalizationId?: string } | { ok: false; error: string }> {
    const r = await this.withRetry<undefined>(code.toUpperCase(), (room) => {
      if (!room.state) return { error: "game has not started" };
      if (room.state.winner !== null) return { error: "game is already over" };
      const seatIdx = seatForCredentials(room, credentials);
      if (seatIdx === null) return { error: "not a player in this room" };
      const waitingOn = room.state.pendingDecision?.player ?? room.state.activePlayer;
      if (waitingOn === seatIdx) return { error: "the game is waiting on you" };
      const lastAction = room.seats[1 - seatIdx]?.lastActionAt ?? 0;
      if (now - lastAction < IDLE_VICTORY_MS) return { error: "opponent is still active" };
      const snapshot = room.state;
      const name = room.seats[seatIdx]!.username ?? `seat ${seatIdx}`;
      room.state = {
        ...room.state,
        winner: seatIdx as 0 | 1,
        log: appendGameLog(room.state.log, {
          publicText: `🏳 ${name} claims victory — the opponent was idle`,
        }),
      };
      return { room, result: undefined, snapshot, replay: { kind: "frame" } };
    }, command ? {
      meta: command,
      credentials,
      type: "claim-victory",
      duplicateResult: () => undefined,
    } : undefined);
    return r.ok
      ? { ok: true, version: r.version, ...(r.replayFinalizationId ? { replayFinalizationId: r.replayFinalizationId } : {}) }
      : { ok: false, error: r.error };
  }

  /** Upsert every local socket lease with two small queries regardless of the
   *  number of sockets. Membership is revalidated from the small room columns
   *  so a superseded seat token cannot keep a room alive. */
  async markPresentBatch(
    leases: PresenceLease[],
    now = Date.now(),
  ): Promise<Map<string, { kind: "player"; seat: number } | { kind: "spectator" }>> {
    const found = new Map<string, { kind: "player"; seat: number } | { kind: "spectator" }>();
    if (leases.length === 0) return found;
    const normalized = leases.map((lease) => ({ ...lease, code: lease.code.toUpperCase() }));
    const codes = [...new Set(normalized.map((lease) => lease.code))];
    const codeParams = codes.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await this.db.query(
      `SELECT code, spectators FROM rooms WHERE code IN (${codeParams})`,
      codes,
    );
    const { rows: rawSeats } = await this.db.query(
      `SELECT room_code, seat, token_hash FROM room_seats WHERE room_code IN (${codeParams})`,
      codes,
    );
    const roomsByCode = new Map<string, { spectators: Array<{ tokenHash: string }> }>();
    for (const [index, value] of rows.entries()) {
      const row = dbObject(value, "<presence-batch>", `rooms[${index}]`);
      if (typeof row.code !== "string") {
        throw new CorruptRoomError("<presence-batch>", `rooms[${index}].code`, "expected a string");
      }
      roomsByCode.set(row.code, {
        spectators: decodeStoredSpectators(row.spectators, row.code, `rooms[${index}].spectators`),
      });
    }
    const seatsByToken = new Map<string, number>();
    for (const [index, value] of rawSeats.entries()) {
      const row = dbObject(value, "<presence-batch>", `seats[${index}]`);
      const seat = Number(row.seat);
      if (typeof row.room_code !== "string" || typeof row.token_hash !== "string" || !(seat === 0 || seat === 1)) {
        throw new CorruptRoomError("<presence-batch>", `seats[${index}]`, "invalid seat row");
      }
      const key = `${row.room_code}\0${row.token_hash}`;
      if (seatsByToken.has(key)) {
        throw new CorruptRoomError("<presence-batch>", `seats[${index}]`, "duplicate membership token");
      }
      seatsByToken.set(key, seat);
    }
    const valid: Array<{ lease: PresenceLease; tokenHash: string }> = [];
    for (const lease of normalized) {
      const raw = roomsByCode.get(lease.code);
      if (!raw) continue;
      const tokenHash = hashReconnectToken(lease.token);
      const actualSeat = seatsByToken.get(`${lease.code}\0${tokenHash}`) ?? -1;
      const key = `${lease.code}\0${lease.leaseId}`;
      if (actualSeat !== -1 && actualSeat === lease.seat) {
        valid.push({ lease, tokenHash });
        found.set(key, { kind: "player", seat: actualSeat });
      } else if (lease.seat === null && raw.spectators.some((s) => s.tokenHash === tokenHash)) {
        valid.push({ lease, tokenHash });
        found.set(key, { kind: "spectator" });
      }
    }
    if (valid.length === 0) return found;

    const params: unknown[] = [];
    const values = valid.map(({ lease, tokenHash }) => {
      const base = params.length;
      params.push(lease.code, lease.leaseId, tokenHash, lease.seat, now);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });
    await this.db.query(
      `INSERT INTO room_presence (room_code, lease_id, token_hash, seat, last_seen_at)
       VALUES ${values.join(", ")}
       ON CONFLICT (room_code, lease_id) DO UPDATE SET
         token_hash = EXCLUDED.token_hash, seat = EXCLUDED.seat, last_seen_at = EXCLUDED.last_seen_at`,
      params,
    );
    const activeCodes = [...new Set(valid.map(({ lease }) => lease.code))];
    const activeParams = activeCodes.map((_, i) => `$${i + 1}`).join(", ");
    await this.db.query(
      `UPDATE rooms SET gc_at = NULL
       WHERE code IN (${activeParams}) AND status <> 'finished'`,
      activeCodes,
    );
    await this.db.query(
      `UPDATE rooms SET gc_at = COALESCE(gc_at, $${activeCodes.length + 1})
       WHERE code IN (${activeParams}) AND status = 'finished'`,
      [...activeCodes, now + GC_DELAY_MS],
    );
    return found;
  }

  async markPresent(
    code: string,
    token: string,
    leaseId = token,
    seat?: number | null,
  ): Promise<VersionedPresence | null> {
    const upper = code.toUpperCase();
    let expectedSeat = seat;
    if (expectedSeat === undefined) {
      const { rows } = await this.db.query("SELECT spectators FROM rooms WHERE code = $1", [upper]);
      if (!rows.length) return null;
      const tokenHash = hashReconnectToken(token);
      const seats = await this.db.query("SELECT seat FROM room_seats WHERE room_code = $1 AND token_hash = $2", [upper, tokenHash]);
      if (seats.rows.length) expectedSeat = Number(seats.rows[0].seat);
      else if (decodeStoredSpectators(rows[0].spectators, upper, "row.spectators").some((s) => s.tokenHash === tokenHash)) expectedSeat = null;
      else return null;
    }
    const result = await this.markPresentBatch([{ code: upper, token, leaseId, seat: expectedSeat }]);
    const found = result.get(`${upper}\0${leaseId}`);
    if (!found) return null;
    const { rows } = await this.db.query(
      "UPDATE rooms SET version = version + 1 WHERE code = $1 RETURNING version",
      [upper],
    );
    if (!rows.length) return null;
    return { ...found, version: Number(rows[0].version) };
  }

  /** Clean socket close: seats stamp 0 (absent) so opponents see the leave
   *  immediately instead of after the timeout. Spectator rows are REMOVED
   *  outright — a deliberate close needs no reconnect-by-token window, and
   *  dead rows must not pile up against MAX_SPECTATORS. Abrupt disconnects
   *  never reach here; those rows expire via the presence timeout and are
   *  pruned at join. */
  async markAbsent(
    code: string,
    token: string,
    leaseId = token,
  ): Promise<VersionedPresence | null> {
    const upper = code.toUpperCase();
    const tokenHash = hashReconnectToken(token);
    const now = Date.now();
    const { rows: removed } = await this.db.query(
      `DELETE FROM room_presence WHERE room_code = $1 AND lease_id = $2 AND token_hash = $3
       RETURNING seat`,
      [upper, leaseId, tokenHash],
    );
    let kind: { kind: "player"; seat: number } | { kind: "spectator" } | null = removed.length
      ? removed[0].seat == null
        ? { kind: "spectator" }
        : { kind: "player", seat: Number(removed[0].seat) }
      : null;

    // Compatibility/fallback for a join that closes before its initial lease
    // upsert completes.
    if (!kind) {
      const { rows } = await this.db.query("SELECT spectators FROM rooms WHERE code = $1", [upper]);
      if (!rows.length) return null;
      const seats = await this.db.query("SELECT seat FROM room_seats WHERE room_code = $1 AND token_hash = $2", [upper, tokenHash]);
      if (seats.rows.length) kind = { kind: "player", seat: Number(seats.rows[0].seat) };
      else if (decodeStoredSpectators(rows[0].spectators, upper, "row.spectators").some((s) => s.tokenHash === tokenHash)) kind = { kind: "spectator" };
      else return null;
    }

    // A player reconnect rotates the membership token. The old socket can
    // close after its lease row is deleted successfully, but it no longer
    // owns the seat and must not bump the room version or emit disconnected.
    const { rows: membershipRows } = await this.db.query(
      "SELECT spectators FROM rooms WHERE code = $1",
      [upper],
    );
    if (!membershipRows.length) return null;
    if (kind.kind === "player") {
      const current = await this.db.query(
        "SELECT 1 FROM room_seats WHERE room_code = $1 AND seat = $2 AND token_hash = $3",
        [upper, kind.seat, tokenHash],
      );
      if (!current.rows.length) return null;
    } else if (!decodeStoredSpectators(
      membershipRows[0].spectators,
      upper,
      "row.spectators",
    ).some((s) => s.tokenHash === tokenHash)) {
      return null;
    }

    if (kind.kind === "player") {
      const { rows: other } = await this.db.query(
        `SELECT 1 FROM room_presence
         WHERE room_code = $1 AND token_hash = $2 AND seat = $3 AND last_seen_at > $4 LIMIT 1`,
        [upper, tokenHash, kind.seat, now - PRESENCE_TIMEOUT_MS],
      );
      if (other.length) return null;
      // Arm only when the last live player lease is gone. The next heartbeat
      // atomically disarms it, and GC_DELAY_MS is much longer than the lease
      // timeout, so races cannot delete an active room.
      const { rows } = await this.db.query(
        `UPDATE rooms SET gc_at = COALESCE(gc_at, $2), version = version + 1
         WHERE code = $1 AND NOT EXISTS (
           SELECT 1 FROM room_presence
           WHERE room_code = $1 AND seat IS NOT NULL AND last_seen_at > $3
         ) RETURNING version`,
        [upper, now + GC_DELAY_MS, now - PRESENCE_TIMEOUT_MS],
      );
      if (!rows.length) {
        const bumped = await this.db.query(
          "UPDATE rooms SET version = version + 1 WHERE code = $1 RETURNING version",
          [upper],
        );
        if (!bumped.rows.length) return null;
        return { ...kind, version: Number(bumped.rows[0].version) };
      }
      return { ...kind, version: Number(rows[0].version) };
    }

    const { rows: other } = await this.db.query(
      `SELECT 1 FROM room_presence
       WHERE room_code = $1 AND token_hash = $2 AND last_seen_at > $3 LIMIT 1`,
      [upper, tokenHash, now - PRESENCE_TIMEOUT_MS],
    );
    if (other.length) return null;
    const removedMembership = await this.withRetry(upper, (room) => {
      const idx = room.spectators.findIndex((s) => s.tokenHash === tokenHash);
      if (idx !== -1) room.spectators.splice(idx, 1);
      return { room, result: undefined };
    });
    return removedMembership.ok ? { ...kind, version: removedMembership.version } : null;
  }

  /**
   * Room GC, run periodically by the single gateway:
   *  1. Arm the deadline on rooms with no live presence (or a finished game)
   *     that don't have one yet — covers rooms stranded by a killed instance,
   *     which the mutation-driven updateGc can never reach. Conditional on
   *     gc_at IS NULL, and a room whose clients are merely between heartbeats
   *     gets disarmed again by the next heartbeat's updateGc — the deadline
   *     is GC_DELAY_MS out, far beyond a heartbeat interval, so a spurious
   *     arm can never delete a live room.
   *  2. Delete rooms past their deadline (atomic, idempotent).
   * Returns the deleted codes.
   */
  async sweepRooms(now = Date.now()): Promise<{ code: string; version: number }[]> {
    await this.db.query("DELETE FROM room_presence WHERE last_seen_at <= $1", [
      now - PRESENCE_TIMEOUT_MS,
    ]);
    const { rows } = await this.db.query(
      "SELECT code, winner FROM rooms WHERE gc_at IS NULL",
    );
    const { rows: presence } = await this.db.query(
      "SELECT room_code, seat FROM room_presence WHERE last_seen_at > $1",
      [now - PRESENCE_TIMEOUT_MS],
    );
    const roomsWithPlayers = new Set(
      presence.filter((p) => p.seat != null).map((p) => p.room_code as string),
    );
    for (const raw of rows as { code: string; winner: string | null }[]) {
      if (raw.code === DEMO_ROOM_CODE) continue;
      const over = raw.winner != null;
      const anyonePresent = roomsWithPlayers.has(raw.code);
      if (over || !anyonePresent) {
        await this.db.query("UPDATE rooms SET gc_at = $2 WHERE code = $1 AND gc_at IS NULL", [
          raw.code,
          now + GC_DELAY_MS,
        ]);
      }
    }
    const { rows: armedRooms } = await this.db.query(
      "SELECT code, gc_at, version FROM rooms WHERE gc_at IS NOT NULL",
    );
    // Filter in JS because pg-mem's BIGINT range scan is incorrect once an
    // index exists. Production still uses the gc_at index for IS NOT NULL;
    // the equality guard below preserves the concurrency guarantee.
    const candidates = armedRooms.filter((room) => Number(room.gc_at) <= now);
    const deleted: { code: string; version: number }[] = [];
    for (const candidate of candidates) {
      // Re-check the deadline in the DELETE so a concurrent heartbeat that
      // disarmed the room after the SELECT always wins. Publish deletion in
      // the same transaction so no gateway can miss the committed GC.
      const removed = await withTransaction(this.db, async (db) => {
        const { rowCount } = await db.query(
          "DELETE FROM rooms WHERE code = $1 AND gc_at = $2 AND ruleset_version = $3",
          [candidate.code, candidate.gc_at, this.rulesetVersion],
        );
        if (rowCount !== 1) {
          // pg-mem reports rowCount=0 for a delete that cascades through the
          // presence/history FKs; verify disappearance for test compatibility.
          const { rows } = await db.query("SELECT 1 FROM rooms WHERE code = $1", [candidate.code]);
          if (rows.length !== 0) return null;
        }
        const room = { code: String(candidate.code), version: Number(candidate.version) + 1 };
        await appendClusterEvent(db, {
          type: "room",
          event: { code: room.code, kind: "deleted", version: room.version },
        });
        return room;
      });
      if (removed) deleted.push(removed);
    }
    return deleted;
  }
}

/** Keep command receipts long enough for reconnect/retry while bounding rows
 * in exceptionally long-lived rooms. */
export async function sweepRoomCommands(
  db: Queryable,
  now = Date.now(),
  retentionMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  const result = await db.query("DELETE FROM room_commands WHERE created_at < $1", [now - retentionMs]);
  return result.rowCount ?? 0;
}

export function spectatorCount(room: RoomRow): number {
  const now = Date.now();
  return room.spectators.filter((s) => isPresent(s.lastSeenAt, now)).length;
}

export function stateMessage(room: RoomRow, seat: number | null): ServerMessage | null {
  if (!room.state) return null;
  const profile = (member: SeatRow | null) => ({
    username: member?.username ?? "Unknown player",
    badge: member?.badge ?? null,
  });
  return {
    type: "state",
    version: room.version,
    // seat null = spectator: both hands/hidden zones projected as counts only
    view: projectStateFor(room.state, seat, room.code),
    ...(room.lastTransition?.fromVersion === room.version - 1
      ? {
          transition: {
            fromVersion: room.lastTransition.fromVersion,
            kind: room.lastTransition.kind,
            events: projectTransitionEvents(room.lastTransition.events, seat),
          },
        }
      : {}),
    playerProfiles: [profile(room.seats[0]), profile(room.seats[1])],
    yourSeat: seat,
    legal: seat === null ? [] : legalIntents(room.state, seat),
    actionCandidates: seat === null ? [] : actionCandidates(room.state, seat),
    spectators: spectatorCount(room),
    lastActionAt: [room.seats[0]?.lastActionAt ?? 0, room.seats[1]?.lastActionAt ?? 0],
    ...(room.seats.some((member) => member?.controller === "bot") ? { botGame: true } : {}),
  };
}

/** Per-player prep-room projection (game not started). */
export function prepViewFor(room: RoomRow, seat: number): PrepView {
  const now = Date.now();
  const seatView = (s: SeatRow | null): PrepSeatView | null => {
    if (!s) return null;
    const heroId = heroIdForSeat(s) ?? "";
    return {
      username: s.username ?? "unknown",
      heroId,
      heroName: heroId ? (cardData[heroId]?.name ?? "") : "",
      hero: s.hero,
      ready: s.ready ?? false,
      connected: s.controller === "bot" || isPresent(s.lastSeenAt, now),
      ...(s.fromQueue ? { accepted: s.accepted === true } : {}),
    };
  };
  return {
    format: room.format,
    ...(room.allowFutureCards ? { allowFutureCards: true as const } : {}),
    ...(room.seats.some((member) => member?.controller === "bot") ? { botGame: true } : {}),
    seats: [seatView(room.seats[0]), seatView(room.seats[1])],
    yourSeat: seat,
    yourDeckId: room.seats[seat]?.deckId,
    die: room.prep ? { rolls: room.prep.rolls, winner: room.prep.dieWinner } : null,
    startPlayer: room.prep?.startPlayer ?? null,
    ...(matchPrepPhase(room) && room.prepDeadlineAt !== null
      ? { deadlineAt: room.prepDeadlineAt, deadlinePhase: matchPrepPhase(room)! }
      : {}),
  };
}
