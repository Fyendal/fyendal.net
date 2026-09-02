import type {
  CardView,
  CombatValueModifierView,
  ClientMessage,
  DeckPool,
  Format,
  GameIntent,
  GameMessage,
  GameMessageValue,
  GameStatsView,
  GameTransitionMove,
  GameTransitionView,
  GameTurnStatsView,
  GameView,
  OnHitEffectView,
  OnHitImpactView,
  PendingDecision,
  PlayerBadge,
  PlayerView,
  PrepView,
  ReplayFile,
  RoomSummary,
  ServerMessage,
  PlayerTurnFactsView,
  TurnFactsView,
} from "@fyendal/shared";

type JsonObject = Record<string, unknown>;
type Decoder<T> = (value: unknown) => T | null;

export interface ApiError { ok: false; error: string }
export interface OkResponse { ok: true }
export interface LoginResponse { ok: true; token: string; username: string }
export interface StatsResponse { ok: true; inGame: number; openRooms: number }
export interface DeckSummary {
  id: string;
  name: string;
  format: Format;
  fabraryUrl: string | null;
  heroName: string;
  deckSize: number;
  updatedAt: number;
  /** Current legality hints; omitted when the corresponding list is empty. */
  bannedCards?: string[];
  futureCards?: string[];
}
export interface DecksResponse { ok: true; decks: DeckSummary[] }
export interface DeckResponse { ok: true; deck: DeckSummary }
export interface FabraryMatchup {
  id: string;
  name: string;
  heroIdentifiers?: string[];
  preferredTurnOrder: "first" | "second" | null;
  notes?: string;
}
export interface DeckDetailResponse {
  ok: true;
  deck: DeckSummary & {
    decklist: DeckPool;
    matchups?: FabraryMatchup[];
    selectedMatchupId?: string;
  };
}
export interface DeckInvalidResponse {
  ok: false;
  errors?: string[];
  missing?: string[];
  unimplemented?: string[];
  error?: string;
}
export interface BugReportResponse { ok: true; reportId: string }
export interface FixedBugReportNotification {
  reportId: string;
  fixedAt: number;
}
export interface BugReportNotificationsResponse {
  ok: true;
  notifications: FixedBugReportNotification[];
}
export interface ReplaySummary {
  id: string;
  format: Format;
  heroIds: [string, string];
  yourSeat: 0 | 1;
  /** Null when a bot practice game was ended manually. */
  winner: 0 | 1 | null;
  finishedAt: number;
  expiresAt: number;
  frameCount: number;
}
export interface ReplaysResponse { ok: true; replays: ReplaySummary[] }
export interface ReplayResponse { ok: true; replay: ReplayFile }
export interface AccountBadgesResponse {
  ok: true;
  availableBadges: PlayerBadge[];
  selectedBadge: PlayerBadge | null;
}
export interface AccountExport {
  exportedAt: string;
  account: {
    username: string;
    createdAt: number;
    earlyTester: boolean;
    selectedBadge: PlayerBadge | null;
  };
  decks: Array<{
    id: string;
    name: string;
    format: Format;
    fabraryUrl: string | null;
    decklist: DeckPool;
    heroName: string;
    createdAt: number;
    updatedAt: number;
  }>;
  rooms: Array<{
    code: string;
    format: Format;
    status: string;
    winner: number | null;
    createdAt: number;
    seat: number;
    allowFutureCards?: true;
  }>;
  matchmaking: null | {
    format: Format;
    hero: string | null;
    deckId: string | null;
    retainedRoomCode: string | null;
    joinedAt: number;
  };
  bugReports: Array<{
    id: string;
    roomCode: string;
    roomVersion: number;
    rulesetVersion: string;
    description: string;
    createdAt: number;
    fixedAt: number | null;
    dismissedAt: number | null;
  }>;
  replays: Array<{
    id: string;
    finishedAt: number;
    expiresAt: number;
    replay: ReplayFile;
  }>;
}
export interface AccountExportResponse { ok: true; export: AccountExport }

const MAX_ID = 128;
const MAX_SHORT_TEXT = 256;
const MAX_TEXT = 4096;
const MAX_CARDS = 256;
const MAX_INPUT_CARDS = 100;
const MAX_LOG = 200;
const MAX_ROOMS = 10_000;
const MAX_DECKS = 1_000;
const MAX_REPLAY_VIEWS = 10_000;
const MAX_COUNTERS = 128;
const MAX_MESSAGE_VALUES = 16;
const MAX_MESSAGE_VALUE_TEXT = 256;
const MAX_MESSAGE_VALUE_KEY = 64;
export const MAX_MATCHMAKING_AVOID_ROOM_CODES = 20;

const MESSAGE_ID_RE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const MESSAGE_VALUE_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const TERM_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

const FORMATS = new Set(["classic-battles", "cc", "silver-age"]);
const HEROES = new Set(["dorinthea", "rhinar"]);
const PHASES = new Set(["start", "action", "layer", "reaction", "defend", "end", "game-over"]);
const MELD_SIDES = new Set(["left", "right", "both"]);
const BOT_OPPONENTS = new Set(["bravo", "briar", "cindra", "ira", "hala", "jarl"]);
const PLAYABLE_ZONES = new Set(["banish", "graveyard", "deck"]);
const EQUIPMENT_SLOTS = new Set(["head", "chest", "arms", "legs"]);
const DECISION_KINDS = new Set([
  "defend", "attack-reaction", "defense-reaction", "priority-window",
  "arsenal", "choose-target", "choose-name", "order-triggers", "optional-effect",
]);
const ERROR_CODES = new Set([
  "AUTH_REQUIRED", "ROOM_NOT_FOUND", "ROOM_BUSY", "ALREADY_IN_ROOM", "NOT_IN_ROOM",
  "SESSION_REPLACED", "INVALID_PRESENTATION", "INVALID_MESSAGE", "FORBIDDEN", "CONFLICT",
  "INTERNAL_ERROR", "RESYNC_REQUIRED",
]);
const UNDO_TARGETS = new Set(["last-action", "current-turn", "previous-turn"]);
const EMOTE_MESSAGES = new Set([
  "Hello!",
  "Good luck, have fun!",
  "Good game!",
  "Thanks!",
  "Sorry!",
  "Nice play!",
  "Thinking...",
  "Oops!",
]);

function playerBadge(value: unknown): value is PlayerBadge {
  return value === "early-tester";
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function exactKeys(value: JsonObject, allowed: readonly string[], required = allowed): boolean {
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);
  return keys.every((key) => allowedSet.has(key)) && required.every((key) => key in value);
}

function string(value: unknown, max = MAX_TEXT, allowEmpty = true): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= max;
}

const id = (value: unknown): value is string => string(value, MAX_ID, false);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const nonNegativeInteger = (value: unknown): value is number => integer(value) && (value as number) >= 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const seat = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const nullableSeat = (value: unknown): value is 0 | 1 | null => value === null || seat(value);
const optional = <T>(value: unknown, decode: (v: unknown) => v is T): value is T | undefined =>
  value === undefined || decode(value);

function array<T>(value: unknown, decode: (item: unknown) => item is T, max: number): value is T[] {
  // Forward only the item. Array#every also passes (index, array), which can
  // accidentally bind optional decoder parameters such as cardView's nested
  // subcard depth and make ordinary long zones fail validation.
  return Array.isArray(value) && value.length <= max && value.every((item) => decode(item));
}

const shortStrings = (value: unknown, max = MAX_CARDS): value is string[] =>
  array(value, (item): item is string => string(item, MAX_SHORT_TEXT), max);
const instanceId = (value: unknown): value is number => nonNegativeInteger(value);
const instanceIds = (value: unknown): value is number[] => array(value, instanceId, MAX_INPUT_CARDS);

function gameMessageValue(value: unknown): value is GameMessageValue {
  if (
    typeof value === "boolean" ||
    (typeof value === "string" && string(value, MAX_MESSAGE_VALUE_TEXT)) ||
    Number.isSafeInteger(value)
  ) return true;
  const reference = object(value);
  if (!reference || typeof reference.kind !== "string") return false;
  if (reference.kind === "card") {
    return exactKeys(reference, ["kind", "cardId"]) && id(reference.cardId);
  }
  if (reference.kind === "player") {
    return exactKeys(reference, ["kind", "seat"]) && seat(reference.seat);
  }
  if (reference.kind === "term") {
    return exactKeys(reference, ["kind", "id"])
      && string(reference.id, MAX_ID, false) && TERM_ID_RE.test(reference.id);
  }
  return false;
}

/** Decode a locale-independent message received from a wire or replay boundary. */
export function decodeGameMessage(value: unknown): GameMessage | null {
  const message = object(value);
  if (
    !message ||
    !exactKeys(message, ["id", "values"], ["id"]) ||
    !string(message.id, MAX_ID, false) ||
    !MESSAGE_ID_RE.test(message.id)
  ) return null;
  if (message.values === undefined) return { id: message.id };
  const values = object(message.values);
  if (!values) return null;
  const entries = Object.entries(values);
  if (
    entries.length > MAX_MESSAGE_VALUES ||
    entries.some(([key, entry]) =>
      key.length > MAX_MESSAGE_VALUE_KEY ||
      !MESSAGE_VALUE_KEY_RE.test(key) ||
      !gameMessageValue(entry))
  ) return null;
  return { id: message.id, values: values as Record<string, GameMessageValue> };
}

function numberRecord(value: unknown): value is Record<string, number> {
  const record = object(value);
  return !!record && Object.keys(record).length <= MAX_COUNTERS
    && Object.keys(record).every((key) => string(key, MAX_SHORT_TEXT, false))
    && Object.values(record).every(finite);
}

function equipmentRecord<T>(value: unknown, decode: (v: unknown) => v is T): value is Partial<Record<"head" | "chest" | "arms" | "legs", T>> {
  const record = object(value);
  return !!record && Object.keys(record).every((key) => EQUIPMENT_SLOTS.has(key))
    && Object.values(record).every(decode);
}

function decodeDeckPoolValue(value: unknown): value is DeckPool {
  const deck = object(value);
  return !!deck
    && exactKeys(deck, ["heroId", "weaponIds", "equipmentPool", "inventoryPool", "deck", "sideboard"], ["heroId", "weaponIds", "equipmentPool", "deck"])
    && id(deck.heroId)
    && array(deck.weaponIds, id, MAX_CARDS)
    && array(deck.equipmentPool, id, MAX_CARDS)
    && optional(deck.inventoryPool, (v): v is string[] => array(v, id, MAX_CARDS))
    && array(deck.deck, id, MAX_CARDS)
    && optional(deck.sideboard, (v): v is string[] => array(v, id, MAX_CARDS));
}

function presentedDeck(value: unknown): boolean {
  const deck = object(value);
  return !!deck && exactKeys(deck, ["weaponIds", "equipment", "deck"])
    && array(deck.weaponIds, id, 2)
    && equipmentRecord(deck.equipment, id)
    && array(deck.deck, id, MAX_INPUT_CARDS);
}

function decodeGameIntentValue(value: unknown): value is GameIntent {
  const intent = object(value);
  if (!intent || !string(intent.kind, 32, false)) return false;
  const meld = (v: unknown): boolean => v === undefined || MELD_SIDES.has(String(v));
  const target = (v: unknown): boolean => v === undefined || instanceId(v);
  const presenceFlag = (v: unknown): boolean => v === undefined || v === true;
  const boostCount = (v: unknown): boolean =>
    v === undefined || (nonNegativeInteger(v) && v >= 2 && v <= 8);
  const additionalCostSelection = (v: unknown): boolean => {
    if (v === undefined) return true;
    const selection = object(v);
    return !!selection &&
      exactKeys(selection, ["kind", "cardLabel", "maximumDestroyed", "maximumDiscarded"]) &&
      selection.kind === "destroy-controlled-and-or-discard-hand" &&
      string(selection.cardLabel, MAX_SHORT_TEXT, false) &&
      nonNegativeInteger(selection.maximumDestroyed) && selection.maximumDestroyed <= 16 &&
      nonNegativeInteger(selection.maximumDiscarded) && selection.maximumDiscarded <= 16;
  };
  switch (intent.kind) {
    case "play-card":
    case "play-from-arsenal":
      return exactKeys(intent, ["kind", "instanceId", "pitchInstanceIds", "pitchRequired", "meldSide", "targetAllyId", "targetCardInstanceId", "boost", "boostCount", "asInstant", "alternativeCostCardInstanceIds", "additionalCostSelection", "deferPlayPresentation"], ["kind", "instanceId", "pitchInstanceIds"])
        && instanceId(intent.instanceId) && instanceIds(intent.pitchInstanceIds)
        && optional(intent.pitchRequired, nonNegativeInteger)
        && meld(intent.meldSide) && target(intent.targetAllyId) && target(intent.targetCardInstanceId)
        && presenceFlag(intent.boost) && boostCount(intent.boostCount)
        && (intent.boostCount === undefined || intent.boost === true)
        && presenceFlag(intent.asInstant)
        && presenceFlag(intent.deferPlayPresentation)
        && optional(intent.alternativeCostCardInstanceIds, instanceIds)
        && additionalCostSelection(intent.additionalCostSelection);
    case "play-from-zone":
      return exactKeys(intent, ["kind", "zone", "instanceId", "pitchInstanceIds", "pitchRequired", "meldSide", "targetAllyId", "targetCardInstanceId", "boost", "boostCount", "asInstant", "alternativeCostCardInstanceIds", "additionalCostSelection", "deferPlayPresentation"], ["kind", "zone", "instanceId", "pitchInstanceIds"])
        && PLAYABLE_ZONES.has(String(intent.zone)) && instanceId(intent.instanceId)
        && instanceIds(intent.pitchInstanceIds) && optional(intent.pitchRequired, nonNegativeInteger)
        && meld(intent.meldSide)
        && target(intent.targetAllyId) && target(intent.targetCardInstanceId)
        && presenceFlag(intent.boost) && boostCount(intent.boostCount)
        && (intent.boostCount === undefined || intent.boost === true)
        && presenceFlag(intent.asInstant)
        && presenceFlag(intent.deferPlayPresentation)
        && optional(intent.alternativeCostCardInstanceIds, instanceIds)
        && additionalCostSelection(intent.additionalCostSelection);
    case "activate-ability":
      return exactKeys(intent, ["kind", "sourceInstanceId", "pitchInstanceIds", "pitchRequired", "abilityIndex", "targetAllyId", "alternativeCostCardInstanceIds"], ["kind", "sourceInstanceId", "pitchInstanceIds"])
        && instanceId(intent.sourceInstanceId) && instanceIds(intent.pitchInstanceIds)
        && optional(intent.pitchRequired, nonNegativeInteger)
        && (intent.abilityIndex === undefined || (nonNegativeInteger(intent.abilityIndex) && intent.abilityIndex <= 32))
        && target(intent.targetAllyId)
        && optional(intent.alternativeCostCardInstanceIds, instanceIds);
    case "defend":
      return exactKeys(intent, ["kind", "instanceIds", "pitchInstanceIds"], ["kind", "instanceIds"])
        && instanceIds(intent.instanceIds)
        && optional(intent.pitchInstanceIds, (v): v is number[] => instanceIds(v));
    case "stage-defenders":
      return exactKeys(intent, ["kind", "instanceIds"]) && instanceIds(intent.instanceIds);
    case "choose":
      return exactKeys(intent, ["kind", "optionId"]) && string(intent.optionId, MAX_SHORT_TEXT, false);
    case "choose-many":
      return exactKeys(intent, ["kind", "optionIds"])
        && array(intent.optionIds, (v): v is string => string(v, MAX_SHORT_TEXT, false), MAX_CARDS);
    case "order-triggers":
      return exactKeys(intent, ["kind", "optionIds"])
        && array(intent.optionIds, (v): v is string => string(v, MAX_SHORT_TEXT, false), MAX_CARDS);
    case "skip-runechant":
    case "pass":
    case "close-chain":
    case "concede":
      return exactKeys(intent, ["kind"]);
    default:
      return false;
  }
}

function commandFields(message: Record<string, unknown>): boolean {
  if (message.commandId === undefined && message.expectedVersion === undefined) return true;
  return typeof message.commandId === "string"
    && /^[A-Za-z0-9_-]{8,64}$/.test(message.commandId)
    && nonNegativeInteger(message.expectedVersion);
}

export function decodeClientMessage(value: unknown): ClientMessage | null {
  const message = object(value);
  if (!message || !string(message.type, 32, false)) return null;
  let valid = false;
  switch (message.type) {
    case "auth":
      valid = exactKeys(message, ["type", "token"]) && string(message.token, 128, false);
      break;
    case "create-room":
      valid = exactKeys(message, ["type", "format", "hero", "deckId", "private", "allowFutureCards"], ["type", "format"])
        && FORMATS.has(String(message.format))
        && (message.hero === undefined || HEROES.has(String(message.hero)))
        && (message.deckId === undefined || id(message.deckId))
        && (message.private === undefined || typeof message.private === "boolean")
        && (message.allowFutureCards === undefined || typeof message.allowFutureCards === "boolean");
      break;
    case "queue-join":
      valid = exactKeys(message, ["type", "format", "hero", "deckId", "allowFutureCards", "avoidRoomCodes"], ["type", "format"])
        && FORMATS.has(String(message.format))
        && (message.hero === undefined || HEROES.has(String(message.hero)))
        && (message.deckId === undefined || id(message.deckId))
        && (message.allowFutureCards === undefined || typeof message.allowFutureCards === "boolean")
        && (message.avoidRoomCodes === undefined || (
          Array.isArray(message.avoidRoomCodes)
          && message.avoidRoomCodes.length <= MAX_MATCHMAKING_AVOID_ROOM_CODES
          && message.avoidRoomCodes.every((code) => typeof code === "string" && /^[A-Za-z0-9]{6}$/.test(code))
        ));
      break;
    case "create-bot-room":
      valid = exactKeys(message, ["type", "format", "deckId", "bot", "allowFutureCards"], ["type", "deckId"])
        && (message.format === undefined || message.format === "cc" || message.format === "silver-age")
        && id(message.deckId)
        && (message.bot === undefined || BOT_OPPONENTS.has(String(message.bot)))
        && (message.allowFutureCards === undefined || typeof message.allowFutureCards === "boolean");
      break;
    case "join-room":
      valid = exactKeys(message, ["type", "code", "token", "deckId", "hero", "spectate"], ["type", "code"])
        && typeof message.code === "string" && /^[A-Za-z0-9]{6}$/.test(message.code)
        && (message.token === undefined || string(message.token, 128, false))
        && (message.deckId === undefined || id(message.deckId))
        && (message.hero === undefined || HEROES.has(String(message.hero)))
        && (message.spectate === undefined || typeof message.spectate === "boolean");
      break;
    case "inspect-room":
      valid = exactKeys(message, ["type", "code"])
        && typeof message.code === "string" && /^[A-Za-z0-9]{6}$/.test(message.code);
      break;
    case "present-deck":
      valid = exactKeys(message, ["type", "deck"]) && presentedDeck(message.deck);
      break;
    case "choose-first":
      valid = exactKeys(message, ["type", "first"]) && typeof message.first === "boolean";
      break;
    case "intent":
      valid = exactKeys(message, ["type", "intent", "autoPass", "commandId", "expectedVersion"], ["type", "intent"])
        && decodeGameIntentValue(message.intent)
        && (message.autoPass === undefined || message.autoPass === true)
        && commandFields(message);
      break;
    case "priority-mode":
      valid = exactKeys(message, ["type", "mode", "commandId", "expectedVersion"], ["type", "mode"])
        && (message.mode === "auto-pass" || message.mode === "always-pause")
        && commandFields(message);
      break;
    case "runechant-skip":
      valid = exactKeys(message, ["type", "enabled", "commandId", "expectedVersion"], ["type", "enabled"])
        && typeof message.enabled === "boolean"
        && commandFields(message);
      break;
    case "undo":
      valid = exactKeys(message, ["type", "target", "commandId", "expectedVersion"], ["type"])
        && (message.target === undefined || UNDO_TARGETS.has(String(message.target)))
        && commandFields(message);
      break;
    case "emote":
      valid = exactKeys(message, ["type", "message"])
        && EMOTE_MESSAGES.has(String(message.message));
      break;
    case "list-rooms":
    case "queue-leave":
    case "prep-unready":
    case "claim-victory":
      valid = exactKeys(message, ["type", "commandId", "expectedVersion"], ["type"])
        && commandFields(message);
      break;
    case "accept-match":
      valid = exactKeys(message, ["type"]);
      break;
    case "leave-room":
      valid = exactKeys(message, ["type", "endGame"], ["type"])
        && (message.endGame === undefined || message.endGame === true);
      break;
  }
  return valid ? value as ClientMessage : null;
}

function cardView(value: unknown, depth = 0): value is CardView {
  if (depth > 8) return false;
  const card = object(value);
  if (!card || !exactKeys(card, [
    "instanceId", "cardId", "name", "owner", "pitchCount", "attack", "defense", "faceDown", "tapped",
    "defCounters", "counters", "usedAbilityIndexes", "remainingAbilityActivations", "activatedAbilityLabels", "life", "hidden", "subcards", "grantedNames", "chosenName",
    "grantedTypes", "grantedColor", "playableFromSourceCardId", "intimidated",
  ], ["instanceId", "cardId", "owner"])) return false;
  const validInstanceId = instanceId(card.instanceId)
    || (card.hidden === true
      && card.faceDown === true
      && card.cardId === ""
      && integer(card.instanceId)
      && card.instanceId < 0);
  return validInstanceId && string(card.cardId, MAX_ID)
    && optional(card.name, (v): v is string => string(v, MAX_SHORT_TEXT, false))
    && seat(card.owner)
    && optional(card.pitchCount, nonNegativeInteger)
    && optional(card.attack, finite) && optional(card.defense, finite)
    && optional(card.faceDown, (v): v is boolean => typeof v === "boolean")
    && optional(card.intimidated, (v): v is boolean => typeof v === "boolean")
    && optional(card.tapped, (v): v is boolean => typeof v === "boolean")
    && optional(card.defCounters, nonNegativeInteger) && optional(card.counters, numberRecord)
    && optional(card.usedAbilityIndexes, (v): v is number[] =>
      array(v, (index): index is number => nonNegativeInteger(index) && index <= 32, 33))
    && optional(card.remainingAbilityActivations, (v): v is number[] =>
      array(v, (count): count is number => nonNegativeInteger(count) && count <= 32, 33))
    && optional(card.activatedAbilityLabels, (v): v is string[] =>
      array(v, (label): label is string => string(label, MAX_SHORT_TEXT, false), 33))
    && optional(card.subcards, (v): v is CardView[] => array(v, (entry) => cardView(entry, depth + 1), 16))
    && optional(card.grantedNames, (v): v is string[] => array(v, (entry): entry is string => string(entry, MAX_ID), 16))
    && optional(card.chosenName, (v): v is string => string(v, MAX_SHORT_TEXT, false))
    && optional(card.grantedTypes, (v): v is string[] => array(v, (entry): entry is string => string(entry, MAX_ID), 16))
    && optional(card.grantedColor, (v): v is 1 | 2 | 3 => v === 1 || v === 2 || v === 3)
    && optional(card.playableFromSourceCardId, (v): v is string => string(v, MAX_ID, false))
    && optional(card.life, finite) && optional(card.hidden, (v): v is boolean => typeof v === "boolean");
}

const TRANSITION_ZONE_KINDS = new Set([
  "hand", "deck", "arsenal", "pitch", "graveyard", "banish", "soul",
  "board", "equipment", "weapon", "stack", "chain",
]);

function gameTransitionZone(value: unknown): boolean {
  const zone = object(value);
  return !!zone && exactKeys(zone, ["kind", "seat", "position"], ["kind", "seat"])
    && TRANSITION_ZONE_KINDS.has(String(zone.kind)) && seat(zone.seat)
    && optional(zone.position, (position): position is "top" | "bottom" => (
      position === "top" || position === "bottom"
    ))
    && (zone.position === undefined || zone.kind === "deck");
}

function gameTransitionMove(value: unknown): value is GameTransitionMove {
  const move = object(value);
  return !!move && exactKeys(move, ["kind", "from", "to", "count", "instanceId"], ["kind", "from", "to", "count"])
    && move.kind === "move"
    && (move.from === null || gameTransitionZone(move.from))
    && (move.to === null || gameTransitionZone(move.to))
    && (move.from !== null || move.to !== null)
    && nonNegativeInteger(move.count) && Number(move.count) > 0 && Number(move.count) <= MAX_CARDS
    && optional(move.instanceId, instanceId);
}

function gameTransitionView(value: unknown): value is GameTransitionView {
  const transition = object(value);
  return !!transition
    && exactKeys(transition, ["fromVersion", "kind", "events"])
    && nonNegativeInteger(transition.fromVersion)
    && (transition.kind === "forward" || transition.kind === "replace")
    && array(transition.events, gameTransitionMove, 512)
    && (transition.kind === "forward" || transition.events.length === 0);
}

const cardViews = (value: unknown): value is CardView[] => array(value, cardView, MAX_CARDS);

function playerView(value: unknown): value is PlayerView {
  const player = object(value);
  if (!player || !exactKeys(player, [
    "seat", "heroCardId", "heroInstanceId", "heroTapped", "heroCounters", "heroDefCounters", "heroSubcards", "heroAbilityLabels", "heroName",
    "life", "actionPoints", "resources", "chi", "hand", "handCount", "deckCount", "deck",
    "arsenal", "arsenalCount", "pitch", "pitchCount", "graveyard", "banish", "soul",
    "visibleDeckTop", "equipment", "weapons", "board",
  ], [
    "seat", "heroCardId", "heroInstanceId", "heroName", "life", "actionPoints", "resources",
    "hand", "handCount", "deckCount", "arsenal", "arsenalCount", "pitch", "pitchCount",
    "graveyard", "banish", "soul", "equipment", "weapons", "board",
  ])) return false;
  return seat(player.seat) && id(player.heroCardId) && instanceId(player.heroInstanceId)
    && optional(player.heroTapped, (v): v is boolean => typeof v === "boolean")
    && optional(player.heroCounters, numberRecord) && optional(player.heroDefCounters, nonNegativeInteger)
    && optional(player.heroSubcards, cardViews)
    && string(player.heroName, MAX_SHORT_TEXT, false)
    && optional(player.heroAbilityLabels, (v): v is string[] =>
      array(v, (label): label is string => string(label, MAX_SHORT_TEXT, false), 33))
    && finite(player.life) && finite(player.actionPoints) && finite(player.resources)
    && optional(player.chi, finite) && cardViews(player.hand) && nonNegativeInteger(player.handCount)
    && nonNegativeInteger(player.deckCount) && optional(player.deck, cardViews) && cardViews(player.arsenal)
    && nonNegativeInteger(player.arsenalCount) && cardViews(player.pitch)
    && nonNegativeInteger(player.pitchCount) && cardViews(player.graveyard) && cardViews(player.banish)
    && cardViews(player.soul)
    && optional(player.visibleDeckTop, cardView)
    && equipmentRecord(player.equipment, cardView) && cardViews(player.weapons) && cardViews(player.board);
}

function chainLink(value: unknown): boolean {
  const link = object(value);
  return !!link && exactKeys(link, [
    "attackingCard", "defendingCards", "attackValue", "defenseValue", "damage", "resolved",
    "attackModifiers", "defenseModifiers", "onHitEffects", "damageToPrevent", "preventionModifiers", "onStack", "hit", "goAgain", "wagered", "wagerRewards", "dominate", "overpower", "maxNonBlockDefenders", "reactions", "targetAllyName", "targetAlly",
  ], ["attackingCard", "defendingCards", "attackValue", "defenseValue", "damage", "resolved", "reactions"])
    && cardView(link.attackingCard) && cardViews(link.defendingCards) && finite(link.attackValue)
    && finite(link.defenseValue) && finite(link.damage) && typeof link.resolved === "boolean"
    && optional(link.attackModifiers, combatValueModifiers)
    && optional(link.defenseModifiers, combatValueModifiers)
    && optional(link.onHitEffects, onHitEffects)
    && optional(link.damageToPrevent, nonNegativeInteger)
    && optional(link.preventionModifiers, combatValueModifiers)
    && optional(link.onStack, (v): v is boolean => typeof v === "boolean")
    && optional(link.hit, (v): v is boolean => typeof v === "boolean")
    && optional(link.goAgain, (v): v is boolean => typeof v === "boolean")
    && optional(link.wagered, (v): v is boolean => typeof v === "boolean")
    && optional(link.wagerRewards, (v): v is string[] => shortStrings(v, 32))
    && optional(link.dominate, (v): v is boolean => typeof v === "boolean")
    && optional(link.overpower, (v): v is boolean => typeof v === "boolean")
    && optional(link.maxNonBlockDefenders, nonNegativeInteger)
    && cardViews(link.reactions)
    && optional(link.targetAllyName, (v): v is string => string(v, MAX_SHORT_TEXT, false))
    && optional(link.targetAlly, cardView);
}

function onHitEffects(value: unknown): value is OnHitEffectView[] {
  return array(value, (entry): entry is OnHitEffectView => {
    const effect = object(entry);
    return !!effect && exactKeys(effect, ["sourceCardId", "text", "impact"], ["sourceCardId", "text"])
      && string(effect.sourceCardId, MAX_SHORT_TEXT)
      && string(effect.text, MAX_TEXT, false)
      && optional(effect.impact, onHitImpact);
  }, MAX_CARDS);
}

function onHitImpact(value: unknown): value is OnHitImpactView {
  const impact = object(value);
  return !!impact && Object.keys(impact).length > 0 && exactKeys(impact, [
    "damage", "delayedDamage", "drawCards", "discardCards", "destroysArsenal",
    "damagesEquipment", "createsToken", "grantsTempo",
  ], [])
    && optional(impact.damage, nonNegativeInteger)
    && optional(impact.delayedDamage, nonNegativeInteger)
    && optional(impact.drawCards, nonNegativeInteger)
    && optional(impact.discardCards, nonNegativeInteger)
    && optional(impact.destroysArsenal, (entry): entry is true => entry === true)
    && optional(impact.damagesEquipment, (entry): entry is true => entry === true)
    && optional(impact.createsToken, (entry): entry is true => entry === true)
    && optional(impact.grantsTempo, (entry): entry is true => entry === true);
}

function combatValueModifiers(value: unknown): value is CombatValueModifierView[] {
  return array(value, (entry): entry is CombatValueModifierView => {
    const modifier = object(entry);
    return !!modifier && exactKeys(modifier, ["sourceCardId", "amount"])
      && string(modifier.sourceCardId, MAX_SHORT_TEXT) && finite(modifier.amount);
  }, MAX_CARDS);
}

function stackLayer(value: unknown): boolean {
  const layer = object(value);
  return !!layer && exactKeys(
    layer,
    ["card", "seat", "label", "labelMessage", "optional", "count"],
    ["card", "seat", "label", "optional"],
  )
    && (layer.card === null || cardView(layer.card)) && seat(layer.seat)
    && string(layer.label, MAX_SHORT_TEXT) && typeof layer.optional === "boolean"
    && (layer.labelMessage === undefined || decodeGameMessage(layer.labelMessage) !== null)
    && (layer.count === undefined
      || (integer(layer.count) && layer.count >= 2 && layer.count <= MAX_CARDS));
}

function ongoingEffect(value: unknown): boolean {
  const effect = object(value);
  return !!effect && exactKeys(effect, ["seat", "cardId", "label"])
    && seat(effect.seat) && string(effect.cardId, MAX_ID) && string(effect.label, MAX_SHORT_TEXT);
}

function seatCounters(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(nonNegativeInteger);
}

function gameTurnStats(value: unknown): value is GameTurnStatsView {
  const stats = object(value);
  return !!stats && exactKeys(stats, [
    "turn", "activePlayer", "attacks", "threatened", "blocked", "damageDealt",
  ]) && nonNegativeInteger(stats.turn) && seat(stats.activePlayer)
    && seatCounters(stats.attacks) && seatCounters(stats.threatened)
    && seatCounters(stats.blocked) && seatCounters(stats.damageDealt);
}

function gameStats(value: unknown): value is GameStatsView {
  const stats = object(value);
  return !!stats && exactKeys(stats, ["turns"])
    && array(stats.turns, gameTurnStats, MAX_REPLAY_VIEWS);
}

function playerTurnFacts(value: unknown): value is PlayerTurnFactsView {
  const facts = object(value);
  return !!facts && exactKeys(facts, [
    "attacks", "weaponAttacks", "playedSubtypes", "usedOncePerTurnEffectSourceIds", "dealtDamage",
    "physicalDamageDealt", "arcaneDamageDealt", "damageTaken",
    "physicalDamageTaken", "arcaneDamageTaken",
  ])
    && nonNegativeInteger(facts.attacks)
    && nonNegativeInteger(facts.weaponAttacks)
    && shortStrings(facts.playedSubtypes)
    && array(facts.usedOncePerTurnEffectSourceIds, instanceId, MAX_CARDS)
    && typeof facts.dealtDamage === "boolean"
    && typeof facts.physicalDamageDealt === "boolean"
    && typeof facts.arcaneDamageDealt === "boolean"
    && typeof facts.damageTaken === "boolean"
    && typeof facts.physicalDamageTaken === "boolean"
    && typeof facts.arcaneDamageTaken === "boolean";
}

function turnFacts(value: unknown): value is TurnFactsView {
  const facts = object(value);
  return !!facts && exactKeys(facts, ["players"])
    && Array.isArray(facts.players) && facts.players.length === 2
    && facts.players.every(playerTurnFacts);
}

function pendingDecision(value: unknown): boolean {
  const decision = object(value);
  return !!decision && exactKeys(decision, [
    "player", "kind", "prompt", "promptMessage", "options", "minimumSelections", "maximumSelections", "defaultOption", "optionLabels", "optionMessages", "optionCounts", "optionCards", "revealedCards", "lookedCards", "stagedCards", "stagedDefense",
    "resourcePayment", "preStackSource",
  ], ["player", "kind", "prompt"])
    && seat(decision.player) && DECISION_KINDS.has(String(decision.kind))
    && string(decision.prompt, MAX_TEXT)
    && optional(decision.promptMessage, (value): value is GameMessage => decodeGameMessage(value) !== null)
    && optional(decision.options, (v): v is string[] => shortStrings(v))
    && optional(decision.minimumSelections, nonNegativeInteger)
    && optional(decision.maximumSelections, nonNegativeInteger)
    && optional(decision.defaultOption, (v): v is string => string(v, MAX_SHORT_TEXT, false))
    && optional(decision.optionLabels, (v): v is string[] => shortStrings(v))
    && optional(decision.optionMessages, (v): v is Array<GameMessage | null> =>
      array(v, (item): item is GameMessage | null => item === null || decodeGameMessage(item) !== null, MAX_CARDS))
    && optional(decision.optionCounts, (v): v is Array<number | null> =>
      array(v, (count): count is number | null =>
        count === null || (integer(count) && count >= 2 && count <= MAX_CARDS), MAX_CARDS))
    && optional(decision.optionCards, (v): v is Array<CardView | null> =>
      array(v, (item): item is CardView | null => item === null || cardView(item), MAX_CARDS))
    && optional(decision.revealedCards, cardViews)
    && optional(decision.lookedCards, cardViews)
    && optional(decision.stagedCards, cardViews) && optional(decision.stagedDefense, finite)
    && optional(decision.resourcePayment, (value): value is {
      cost: number;
      options: { optionId: string; pitchInstanceIds: number[] }[];
    } => {
      const payment = object(value);
      return !!payment && exactKeys(payment, ["cost", "options"])
        && nonNegativeInteger(payment.cost)
        && array(payment.options, (entry): entry is {
          optionId: string;
          pitchInstanceIds: number[];
        } => {
          const option = object(entry);
          return !!option && exactKeys(option, ["optionId", "pitchInstanceIds"])
            && string(option.optionId, MAX_SHORT_TEXT, false)
            && instanceIds(option.pitchInstanceIds);
        }, MAX_CARDS);
    })
    && optional(decision.preStackSource, (value): value is PendingDecision["preStackSource"] => {
      const source = object(value);
      return !!source && exactKeys(source, ["card", "zone"], ["card", "zone"])
        && cardView(source.card)
        && (source.zone === "hand" || source.zone === "arsenal" || PLAYABLE_ZONES.has(String(source.zone)));
    })
    && (!(Array.isArray(decision.options) && Array.isArray(decision.optionCards))
      || decision.options.length === decision.optionCards.length)
    && (!(Array.isArray(decision.options) && Array.isArray(decision.optionLabels))
      || decision.options.length === decision.optionLabels.length)
    && (!(Array.isArray(decision.options) && Array.isArray(decision.optionMessages))
      || decision.options.length === decision.optionMessages.length)
    && (!(Array.isArray(decision.options) && Array.isArray(decision.optionCounts))
      || decision.options.length === decision.optionCounts.length)
    && ((decision.minimumSelections === undefined) === (decision.maximumSelections === undefined))
    && (decision.maximumSelections === undefined || (
      decision.kind === "choose-target"
      && Array.isArray(decision.options)
      && Number(decision.minimumSelections) <= Number(decision.maximumSelections)
      && Number(decision.maximumSelections) <= decision.options.length
    ))
    && (typeof decision.defaultOption !== "string"
      || (Array.isArray(decision.options) && decision.options.includes(decision.defaultOption)));
}

export function decodeGameView(value: unknown): GameView | null {
  const view = object(value);
  if (!view || !exactKeys(view, [
    "gameId", "turn", "phase", "activePlayer", "priorityPlayer", "endTurnPassPending", "players", "chain", "stack",
    "stackContext", "ongoing", "pendingDecision", "gameStats", "turnFacts", "winner", "log",
  ], [
    "gameId", "turn", "phase", "activePlayer", "priorityPlayer", "players", "chain", "stack",
    "ongoing", "pendingDecision", "winner", "log",
  ])) return null;
  const valid = id(view.gameId) && nonNegativeInteger(view.turn) && PHASES.has(String(view.phase))
    && seat(view.activePlayer) && seat(view.priorityPlayer)
    && optional(view.endTurnPassPending, (v): v is true => v === true)
    && Array.isArray(view.players) && view.players.length === 2 && view.players.every(playerView)
    && Array.isArray(view.chain) && view.chain.length <= MAX_CARDS && view.chain.every(chainLink)
    && Array.isArray(view.stack) && view.stack.length <= MAX_CARDS && view.stack.every(stackLayer)
    && optional(view.stackContext, (v): v is string => string(v, MAX_SHORT_TEXT, false))
    && Array.isArray(view.ongoing) && view.ongoing.length <= MAX_CARDS && view.ongoing.every(ongoingEffect)
    && (view.pendingDecision === null || pendingDecision(view.pendingDecision))
    && optional(view.gameStats, gameStats)
    && optional(view.turnFacts, turnFacts)
    && nullableSeat(view.winner)
    && array(view.log, (item): item is string => string(item, MAX_TEXT), MAX_LOG);
  return valid ? value as GameView : null;
}

function roomSummary(value: unknown): value is RoomSummary {
  const room = object(value);
  return !!room && exactKeys(room, ["code", "format", "heroes", "createdAt", "spectateOnly", "started", "yours", "allowFutureCards"], ["code", "format", "heroes", "createdAt"])
    && string(room.code, 6, false) && FORMATS.has(String(room.format))
    && Array.isArray(room.heroes) && room.heroes.length === 2
    && room.heroes.every((hero) => hero === null || string(hero, MAX_SHORT_TEXT, false))
    && nonNegativeInteger(room.createdAt)
    && optional(room.spectateOnly, (v): v is boolean => typeof v === "boolean")
    && optional(room.started, (v): v is true => v === true)
    && optional(room.yours, (v): v is boolean => typeof v === "boolean")
    && optional(room.allowFutureCards, (v): v is true => v === true);
}

function playerProfile(value: unknown): boolean {
  const profile = object(value);
  return !!profile && exactKeys(profile, ["username", "badge"])
    && string(profile.username, MAX_SHORT_TEXT, false)
    && (profile.badge === null || playerBadge(profile.badge));
}

function roomInvite(value: unknown): boolean {
  const room = object(value);
  return !!room && exactKeys(room, ["code", "format", "spectateOnly", "yours", "allowFutureCards"], ["code", "format"])
    && string(room.code, 6, false) && FORMATS.has(String(room.format))
    && optional(room.spectateOnly, (v): v is boolean => typeof v === "boolean")
    && optional(room.yours, (v): v is boolean => typeof v === "boolean")
    && optional(room.allowFutureCards, (v): v is true => v === true);
}

function prepSeat(value: unknown): boolean {
  const item = object(value);
  return !!item && exactKeys(item, ["username", "heroId", "heroName", "hero", "ready", "connected", "accepted"], ["username", "heroId", "heroName", "ready", "connected"])
    && string(item.username, MAX_SHORT_TEXT, false) && id(item.heroId)
    && string(item.heroName, MAX_SHORT_TEXT, false)
    && (item.hero === undefined || HEROES.has(String(item.hero)))
    && typeof item.ready === "boolean" && typeof item.connected === "boolean"
    && optional(item.accepted, (v): v is boolean => typeof v === "boolean");
}

function prepView(value: unknown): value is PrepView {
  const prep = object(value);
  if (!prep || !exactKeys(prep, ["format", "seats", "yourSeat", "yourDeckId", "die", "startPlayer", "botGame", "allowFutureCards", "deadlineAt", "deadlinePhase"], ["format", "seats", "yourSeat", "die", "startPlayer"])) return false;
  let dieValid = prep.die === null;
  if (!dieValid) {
    const die = object(prep.die);
    dieValid = !!die && exactKeys(die, ["rolls", "winner"])
      && Array.isArray(die.rolls) && die.rolls.length === 2
      && die.rolls.every((roll) => integer(roll) && roll >= 1 && roll <= 6)
      && seat(die.winner);
  }
  return FORMATS.has(String(prep.format)) && Array.isArray(prep.seats) && prep.seats.length === 2
    && prep.seats.every((item) => item === null || prepSeat(item)) && seat(prep.yourSeat)
    && optional(prep.yourDeckId, id)
    && optional(prep.botGame, (v): v is boolean => typeof v === "boolean")
    && optional(prep.allowFutureCards, (v): v is true => v === true)
    && optional(prep.deadlineAt, nonNegativeInteger)
    && optional(prep.deadlinePhase, (v): v is "accept" | "prepare" | "choose-first" =>
      v === "accept" || v === "prepare" || v === "choose-first")
    && ((prep.deadlineAt === undefined) === (prep.deadlinePhase === undefined))
    && dieValid && nullableSeat(prep.startPlayer);
}

export function decodeServerMessage(value: unknown): ServerMessage | null {
  const message = object(value);
  if (!message || !string(message.type, 32, false)) return null;
  const version = () => nonNegativeInteger(message.version);
  let valid = false;
  switch (message.type) {
    case "authed":
      valid = exactKeys(message, ["type", "username"]) && string(message.username, MAX_SHORT_TEXT, false);
      break;
    case "auth-failed": case "queue-left": case "left": case "match-timeout":
      valid = exactKeys(message, ["type"]);
      break;
    case "room-created":
      valid = exactKeys(message, ["type", "code", "seat", "token", "version"])
        && string(message.code, 6, false) && seat(message.seat)
        && string(message.token, 128, false) && version();
      break;
    case "joined":
      valid = exactKeys(message, ["type", "code", "seat", "token", "spectator", "resumed", "version"], ["type", "code", "seat", "token", "version"])
        && string(message.code, 6, false) && nullableSeat(message.seat)
        && string(message.token, 128) && optional(message.spectator, (v): v is boolean => typeof v === "boolean")
        && optional(message.resumed, (v): v is true => v === true) && version();
      break;
    case "game-started": case "opponent-disconnected": case "opponent-reconnected":
      valid = exactKeys(message, ["type", "version"]) && version();
      break;
    case "emote":
      valid = exactKeys(message, ["type", "seat", "message"])
        && seat(message.seat) && EMOTE_MESSAGES.has(String(message.message));
      break;
    case "state":
      valid = exactKeys(message, ["type", "version", "view", "transition", "playerProfiles", "yourSeat", "legal", "actionCandidates", "spectators", "lastActionAt", "botGame"], ["type", "version", "view", "playerProfiles", "yourSeat", "legal", "lastActionAt"])
        && version() && decodeGameView(message.view) !== null && nullableSeat(message.yourSeat)
        && optional(message.transition, gameTransitionView)
        && Array.isArray(message.playerProfiles) && message.playerProfiles.length === 2
        && message.playerProfiles.every(playerProfile)
        && array(message.legal, decodeGameIntentValue, MAX_CARDS)
        && optional(message.actionCandidates, (v): v is GameIntent[] =>
          array(v, decodeGameIntentValue, MAX_CARDS))
        && optional(message.spectators, nonNegativeInteger)
        && optional(message.botGame, (v): v is boolean => typeof v === "boolean")
        && Array.isArray(message.lastActionAt) && message.lastActionAt.length === 2
        && message.lastActionAt.every(nonNegativeInteger);
      break;
    case "spectators":
      valid = exactKeys(message, ["type", "count", "version"])
        && nonNegativeInteger(message.count) && version();
      break;
    case "rooms":
      valid = exactKeys(message, ["type", "rooms"]) && array(message.rooms, roomSummary, MAX_ROOMS);
      break;
    case "room-info":
      valid = exactKeys(message, ["type", "room"]) && roomInvite(message.room);
      break;
    case "queue-status": {
      const counts = object(message.counts);
      valid = exactKeys(message, ["type", "counts"]) && !!counts
        && exactKeys(counts, [...FORMATS]) && Object.values(counts).every(nonNegativeInteger);
      break;
    }
    case "queued":
      valid = exactKeys(message, ["type", "format"]) && FORMATS.has(String(message.format));
      break;
    case "prep-state":
      valid = exactKeys(message, ["type", "prep", "version"]) && prepView(message.prep) && version();
      break;
    case "error":
      valid = exactKeys(message, ["type", "code", "message"]) && ERROR_CODES.has(String(message.code))
        && string(message.message, MAX_TEXT);
      break;
  }
  return valid ? value as ServerMessage : null;
}

export function decodeReplayFile(value: unknown): ReplayFile | null {
  const replay = object(value);
  if (!replay || !nullableSeat(replay.seat)) return null;
  if (replay.version === 1) {
    if (!exactKeys(replay, ["version", "seat", "views"]) || !Array.isArray(replay.views)
      || replay.views.length > MAX_REPLAY_VIEWS) return null;
    const views = replay.views.map(decodeGameView);
    return views.every((view): view is GameView => view !== null)
      ? { version: 1, seat: replay.seat, views }
      : null;
  }
  if (replay.version !== 2 || !exactKeys(replay, ["version", "seat", "frames"])
    || !Array.isArray(replay.frames) || replay.frames.length > MAX_REPLAY_VIEWS) return null;
  const frames = replay.frames.map((value, index) => {
    const frame = object(value);
    if (!frame || !exactKeys(frame, ["view", "transition"]) || !("transition" in frame)) return null;
    const view = decodeGameView(frame.view);
    const transition = frame.transition === null
      ? null
      : gameTransitionView({
          ...object(frame.transition),
          fromVersion: index === 0 ? 0 : index - 1,
        })
        ? frame.transition as Omit<GameTransitionView, "fromVersion">
        : null;
    if (!view || (frame.transition !== null && transition === null)) return null;
    return { view, transition };
  });
  return frames.every((frame): frame is NonNullable<typeof frame> => frame !== null)
    ? { version: 2, seat: replay.seat, frames }
    : null;
}

export function replayFileViews(file: ReplayFile): GameView[] {
  return file.version === 1 ? file.views : file.frames.map((frame) => frame.view);
}

export function replayFileTransitions(
  file: ReplayFile,
): Array<Omit<GameTransitionView, "fromVersion"> | null> {
  return file.version === 1
    ? file.views.map(() => null)
    : file.frames.map((frame) => frame.transition);
}

export const decodeApiError: Decoder<ApiError> = (value) => {
  const data = object(value);
  return data && exactKeys(data, ["ok", "error"]) && data.ok === false && string(data.error, MAX_TEXT)
    ? { ok: false, error: data.error }
    : null;
};

export const decodeOkResponse: Decoder<OkResponse> = (value) => {
  const data = object(value);
  return data && exactKeys(data, ["ok"]) && data.ok === true ? { ok: true } : null;
};

export const decodeBugReportResponse: Decoder<BugReportResponse> = (value) => {
  const data = object(value);
  return data && exactKeys(data, ["ok", "reportId"]) && data.ok === true && id(data.reportId)
    ? { ok: true, reportId: data.reportId }
    : null;
};

export const decodeBugReportNotificationsResponse: Decoder<BugReportNotificationsResponse> = (value) => {
  const data = object(value);
  if (!data || !exactKeys(data, ["ok", "notifications"]) || data.ok !== true
    || !Array.isArray(data.notifications) || data.notifications.length > MAX_ROOMS) return null;
  const notifications = data.notifications.map((value): FixedBugReportNotification | null => {
    const notification = object(value);
    return notification
      && exactKeys(notification, ["reportId", "fixedAt"])
      && id(notification.reportId)
      && nonNegativeInteger(notification.fixedAt)
      ? { reportId: notification.reportId, fixedAt: notification.fixedAt }
      : null;
  });
  return notifications.every(
    (notification): notification is FixedBugReportNotification => notification !== null,
  )
    ? { ok: true, notifications }
    : null;
};

function decodeReplaySummary(value: unknown): ReplaySummary | null {
  const replay = object(value);
  return replay
    && exactKeys(replay, ["id", "format", "heroIds", "yourSeat", "winner", "finishedAt", "expiresAt", "frameCount"])
    && id(replay.id)
    && FORMATS.has(String(replay.format))
    && Array.isArray(replay.heroIds) && replay.heroIds.length === 2 && replay.heroIds.every(id)
    && seat(replay.yourSeat) && nullableSeat(replay.winner)
    && nonNegativeInteger(replay.finishedAt) && nonNegativeInteger(replay.expiresAt)
    && nonNegativeInteger(replay.frameCount)
    ? value as ReplaySummary
    : null;
}

export const decodeReplaysResponse: Decoder<ReplaysResponse> = (value) => {
  const data = object(value);
  if (!data || !exactKeys(data, ["ok", "replays"]) || data.ok !== true || !Array.isArray(data.replays)
    || data.replays.length > MAX_ROOMS) return null;
  const replays = data.replays.map(decodeReplaySummary);
  return replays.every((replay): replay is ReplaySummary => replay !== null)
    ? { ok: true, replays }
    : null;
};

export const decodeReplayResponse: Decoder<ReplayResponse> = (value) => {
  const data = object(value);
  if (!data || !exactKeys(data, ["ok", "replay"]) || data.ok !== true) return null;
  const replay = decodeReplayFile(data.replay);
  return replay ? { ok: true, replay } : null;
};

export const decodeLoginResponse: Decoder<LoginResponse> = (value) => {
  const data = object(value);
  return data && exactKeys(data, ["ok", "token", "username"]) && data.ok === true
    && string(data.token, 128, false) && string(data.username, MAX_SHORT_TEXT, false)
    ? { ok: true, token: data.token, username: data.username }
    : null;
};

export const decodeStatsResponse: Decoder<StatsResponse> = (value) => {
  const data = object(value);
  return data && exactKeys(data, ["ok", "inGame", "openRooms"]) && data.ok === true
    && nonNegativeInteger(data.inGame) && nonNegativeInteger(data.openRooms)
    ? { ok: true, inGame: data.inGame, openRooms: data.openRooms }
    : null;
};

export const decodeAccountBadgesResponse: Decoder<AccountBadgesResponse> = (value) => {
  const data = object(value);
  return !!data
    && exactKeys(data, ["ok", "availableBadges", "selectedBadge"])
    && data.ok === true
    && array(data.availableBadges, playerBadge, 32)
    && new Set(data.availableBadges).size === data.availableBadges.length
    && (data.selectedBadge === null || playerBadge(data.selectedBadge))
    && (data.selectedBadge === null || data.availableBadges.includes(data.selectedBadge))
    ? value as AccountBadgesResponse
    : null;
};

function decodeDeckSummary(value: unknown): DeckSummary | null {
  const deck = object(value);
  return deck && exactKeys(
    deck,
    ["id", "name", "format", "fabraryUrl", "heroName", "deckSize", "updatedAt", "bannedCards", "futureCards"],
    ["id", "name", "format", "fabraryUrl", "heroName", "deckSize", "updatedAt"],
  )
    && id(deck.id) && string(deck.name, MAX_SHORT_TEXT, false) && FORMATS.has(String(deck.format))
    && (deck.fabraryUrl === null || string(deck.fabraryUrl, 2048))
    && string(deck.heroName, MAX_SHORT_TEXT, false) && nonNegativeInteger(deck.deckSize)
    && nonNegativeInteger(deck.updatedAt)
    && optional(deck.bannedCards, shortStrings)
    && optional(deck.futureCards, shortStrings)
    ? value as DeckSummary
    : null;
}

export const decodeDecksResponse: Decoder<DecksResponse> = (value) => {
  const data = object(value);
  if (!data || !exactKeys(data, ["ok", "decks"]) || data.ok !== true || !Array.isArray(data.decks)
    || data.decks.length > MAX_DECKS) return null;
  const decks = data.decks.map(decodeDeckSummary);
  return decks.every((deck): deck is DeckSummary => deck !== null) ? { ok: true, decks } : null;
};

export const decodeDeckResponse: Decoder<DeckResponse> = (value) => {
  const data = object(value);
  if (!data || !exactKeys(data, ["ok", "deck"]) || data.ok !== true) return null;
  const deck = decodeDeckSummary(data.deck);
  return deck ? { ok: true, deck } : null;
};

export const decodeDeckDetailResponse: Decoder<DeckDetailResponse> = (value) => {
  const data = object(value);
  const rawDeck = data?.ok === true ? object(data.deck) : null;
  if (!data || !exactKeys(data, ["ok", "deck"]) || !rawDeck
    || !exactKeys(
      rawDeck,
      ["id", "name", "format", "fabraryUrl", "heroName", "deckSize", "updatedAt", "bannedCards", "futureCards", "decklist", "matchups", "selectedMatchupId"],
      ["id", "name", "format", "fabraryUrl", "heroName", "deckSize", "updatedAt", "decklist"],
    )) return null;
  const { decklist: rawPool, matchups: rawMatchups, selectedMatchupId, ...summaryValue } = rawDeck;
  const summary = decodeDeckSummary(summaryValue);
  const matchup = (item: unknown): item is FabraryMatchup => {
    const data = object(item);
    return !!data && exactKeys(data, ["id", "name", "heroIdentifiers", "preferredTurnOrder", "notes"], ["id", "name", "preferredTurnOrder"])
      && id(data.id) && string(data.name, MAX_SHORT_TEXT, false)
      && optional(data.heroIdentifiers, (identifiers): identifiers is string[] => shortStrings(identifiers, 64))
      && (data.preferredTurnOrder === null || data.preferredTurnOrder === "first" || data.preferredTurnOrder === "second")
      && optional(data.notes, (notes): notes is string => string(notes, MAX_TEXT));
  };
  const matchupsValid = rawMatchups === undefined || array(rawMatchups, matchup, 128);
  return summary && decodeDeckPoolValue(rawPool) && matchupsValid
    && (selectedMatchupId === undefined || id(selectedMatchupId))
    ? {
      ok: true,
      deck: {
        ...summary,
        decklist: rawPool,
        ...(rawMatchups === undefined ? {} : { matchups: rawMatchups }),
        ...(selectedMatchupId === undefined ? {} : { selectedMatchupId }),
      },
    }
    : null;
};

export const decodeDeckInvalidResponse: Decoder<DeckInvalidResponse> = (value) => {
  const data = object(value);
  if (!data || !exactKeys(data, ["ok", "errors", "missing", "unimplemented", "error"], ["ok"])
    || data.ok !== false) return null;
  const list = (v: unknown): boolean => v === undefined || shortStrings(v, MAX_CARDS);
  return list(data.errors) && list(data.missing) && list(data.unimplemented)
    && (data.error === undefined || string(data.error, MAX_TEXT))
    ? value as DeckInvalidResponse
    : null;
};

function exportDeck(value: unknown): boolean {
  const deck = object(value);
  return !!deck && exactKeys(deck, ["id", "name", "format", "fabraryUrl", "decklist", "heroName", "createdAt", "updatedAt"])
    && id(deck.id) && string(deck.name, MAX_SHORT_TEXT, false) && FORMATS.has(String(deck.format))
    && (deck.fabraryUrl === null || string(deck.fabraryUrl, 2048)) && decodeDeckPoolValue(deck.decklist)
    && string(deck.heroName, MAX_SHORT_TEXT, false) && nonNegativeInteger(deck.createdAt)
    && nonNegativeInteger(deck.updatedAt);
}

function exportRoom(value: unknown): boolean {
  const room = object(value);
  return !!room && exactKeys(
    room,
    ["code", "format", "status", "winner", "createdAt", "seat", "allowFutureCards"],
    ["code", "format", "status", "winner", "createdAt", "seat"],
  )
    && string(room.code, 6, false) && FORMATS.has(String(room.format))
    && string(room.status, 32, false) && nullableSeat(room.winner)
    && nonNegativeInteger(room.createdAt) && seat(room.seat)
    && optional(room.allowFutureCards, (v): v is true => v === true);
}

function exportBugReport(value: unknown): boolean {
  const report = object(value);
  return !!report
    && exactKeys(report, ["id", "roomCode", "roomVersion", "rulesetVersion", "description", "createdAt", "fixedAt", "dismissedAt"])
    && id(report.id) && string(report.roomCode, 6, false) && nonNegativeInteger(report.roomVersion)
    && string(report.rulesetVersion, MAX_SHORT_TEXT, false) && string(report.description, MAX_TEXT, false)
    && nonNegativeInteger(report.createdAt)
    && (report.fixedAt === null || nonNegativeInteger(report.fixedAt))
    && (report.dismissedAt === null || nonNegativeInteger(report.dismissedAt));
}

function exportMatchmaking(value: unknown): boolean {
  if (value === null) return true;
  const matchmaking = object(value);
  return !!matchmaking
    && exactKeys(matchmaking, ["format", "hero", "deckId", "retainedRoomCode", "joinedAt"])
    && FORMATS.has(String(matchmaking.format))
    && (matchmaking.hero === null || string(matchmaking.hero, MAX_SHORT_TEXT, false))
    && (matchmaking.deckId === null || id(matchmaking.deckId))
    && (matchmaking.retainedRoomCode === null || string(matchmaking.retainedRoomCode, 6, false))
    && nonNegativeInteger(matchmaking.joinedAt);
}

function exportReplay(value: unknown): boolean {
  const replay = object(value);
  return !!replay
    && exactKeys(replay, ["id", "finishedAt", "expiresAt", "replay"])
    && id(replay.id) && nonNegativeInteger(replay.finishedAt) && nonNegativeInteger(replay.expiresAt)
    && decodeReplayFile(replay.replay) !== null;
}

export const decodeAccountExportResponse: Decoder<AccountExportResponse> = (value) => {
  const data = object(value);
  const exported = data?.ok === true ? object(data.export) : null;
  const account = exported ? object(exported.account) : null;
  const valid = !!data && exactKeys(data, ["ok", "export"]) && data.ok === true && !!exported
    && exactKeys(exported, ["exportedAt", "account", "decks", "rooms", "matchmaking", "bugReports", "replays"]) && !!account
    && exactKeys(account, ["username", "createdAt", "earlyTester", "selectedBadge"])
    && string(exported.exportedAt, 64, false) && string(account.username, MAX_SHORT_TEXT, false)
    && nonNegativeInteger(account.createdAt) && typeof account.earlyTester === "boolean"
    && (account.selectedBadge === null || playerBadge(account.selectedBadge))
    && (account.selectedBadge === null || account.earlyTester === true)
    && array(exported.decks, (item): item is AccountExport["decks"][number] => exportDeck(item), MAX_DECKS)
    && array(exported.rooms, (item): item is AccountExport["rooms"][number] => exportRoom(item), MAX_ROOMS)
    && exportMatchmaking(exported.matchmaking)
    && array(exported.bugReports, (item): item is AccountExport["bugReports"][number] => exportBugReport(item), MAX_ROOMS)
    && array(exported.replays, (item): item is AccountExport["replays"][number] => exportReplay(item), MAX_ROOMS);
  return valid ? value as AccountExportResponse : null;
};

export { decodeGameIntentValue as isGameIntent };
