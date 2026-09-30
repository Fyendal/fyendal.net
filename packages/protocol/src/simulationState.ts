import type {
  PersistedCardInstanceV1, PersistedStackLayerV1, PersistedDelayedTriggerV1,
  PersistedPlayerV1, PersistedChainLinkV1, PersistedWagerV1,
  PersistedCombatValueModifierV1, PersistedModifierV1, PersistedPendingArcaneV1,
  PersistedDecisionResumeV1, PersistedPendingDecisionV1, PersistedGameLogEntryV1,
  PersistedGameTurnStatsV1, PersistedGameStatsV1, PersistedGameStateV1,
  BotSimulationSnapshotV1, GameMessage, GameLogEvent, GameLogPayload,
} from "@fyendal/shared";
type CardInstance = PersistedCardInstanceV1;
type Modifier = PersistedModifierV1;
type SameKeys<L, R> = Exclude<keyof L, keyof R> extends never ? Exclude<keyof R, keyof L> extends never ? true : false : false;
type Assert<T extends true> = T;
type PersistedStateV1 = BotSimulationSnapshotV1;
type JsonObject = Record<string, unknown>;
type Seat = 0 | 1;
export const PERSISTED_STATE_VERSION = 1;
export const MAX_PERSISTED_STATE_BYTES = 2 * 1024 * 1024;
const MAX_COLLECTION = 512;
const MAX_LOG_ENTRIES = 200;
const MAX_TEXT = 2_048;
const MAX_ARCANE_DEPTH = 8;
const MAX_TRIGGER_COUNT = 256;
const MAX_MESSAGE_VALUES = 16;
const MAX_MESSAGE_VALUE_TEXT = 256;
const MAX_MESSAGE_VALUE_KEY = 64;
const MESSAGE_ID_RE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const MESSAGE_VALUE_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const TERM_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
export class CorruptRoomError extends Error {
  readonly code = "CORRUPT_ROOM";

  constructor(readonly roomCode: string, readonly path: string, detail: string) {
    super(`corrupt room ${roomCode} at ${path}: ${detail}`);
    this.name = "CorruptRoomError";
  }
}

function fail(code: string, path: string, detail: string): never {
  throw new CorruptRoomError(code, path, detail);
}

function object(value: unknown, code: string, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code, path, "expected an object");
  return value as JsonObject;
}

function exact(value: unknown, code: string, path: string, required: readonly string[], optional: readonly string[] = []): JsonObject {
  const out = object(value, code, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(out)) if (!allowed.has(key)) fail(code, `${path}.${key}`, "unexpected field");
  for (const key of required) if (!Object.hasOwn(out, key)) fail(code, `${path}.${key}`, "missing field");
  return out;
}

function integer(value: unknown, code: string, path: string): number {
  if (!Number.isSafeInteger(value)) fail(code, path, "expected a safe integer");
  return value as number;
}

function bool(value: unknown, code: string, path: string): boolean {
  if (typeof value !== "boolean") fail(code, path, "expected a boolean");
  return value;
}

function string(value: unknown, code: string, path: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail(code, path, "expected a bounded non-empty string");
  return value;
}

function nullableString(value: unknown, code: string, path: string): void {
  if (value !== null) string(value, code, path);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], code: string, path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(code, path, "unexpected value");
  return value as T;
}

function array(value: unknown, code: string, path: string, max = MAX_COLLECTION): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(code, path, "expected a bounded array");
  return value;
}

function optional(value: JsonObject, key: string, validate: (value: unknown, path: string) => void, path: string): void {
  if (Object.hasOwn(value, key)) validate(value[key], `${path}.${key}`);
}

function validateStringArray(value: unknown, code: string, path: string): void {
  array(value, code, path).forEach((entry, index) => string(entry, code, `${path}[${index}]`, 256));
}

function validateIntegerArray(value: unknown, code: string, path: string, nullable = false): void {
  array(value, code, path).forEach((entry, index) => {
    if (nullable && entry === null) return;
    integer(entry, code, `${path}[${index}]`);
  });
}

function validateGameMessage(value: unknown, code: string, path: string): void {
  const message = exact(value, code, path, ["id"], ["values"]);
  const messageId = string(message.id, code, `${path}.id`, 128);
  if (!MESSAGE_ID_RE.test(messageId)) fail(code, `${path}.id`, "expected a dotted message id");
  optional(message, "values", (rawValues, valuesPath) => {
    const values = object(rawValues, code, valuesPath);
    const entries = Object.entries(values);
    if (entries.length > MAX_MESSAGE_VALUES) fail(code, valuesPath, "too many message values");
    for (const [key, entry] of entries) {
      const entryPath = `${valuesPath}.${key}`;
      if (key.length > MAX_MESSAGE_VALUE_KEY || !MESSAGE_VALUE_KEY_RE.test(key)) {
        fail(code, entryPath, "invalid message value key");
      }
      if (typeof entry === "string") {
        if (entry.length > MAX_MESSAGE_VALUE_TEXT) fail(code, entryPath, "message value is too long");
        continue;
      }
      if (typeof entry === "boolean" || Number.isSafeInteger(entry)) continue;
      const reference = object(entry, code, entryPath);
      const kind = string(reference.kind, code, `${entryPath}.kind`, 16);
      if (kind === "card") {
        const card = exact(reference, code, entryPath, ["kind", "cardId"]);
        string(card.cardId, code, `${entryPath}.cardId`, 128);
      } else if (kind === "player") {
        const player = exact(reference, code, entryPath, ["kind", "seat"]);
        const seat = integer(player.seat, code, `${entryPath}.seat`);
        if (seat !== 0 && seat !== 1) fail(code, `${entryPath}.seat`, "expected seat 0 or 1");
      } else if (kind === "term") {
        const term = exact(reference, code, entryPath, ["kind", "id"]);
        const termId = string(term.id, code, `${entryPath}.id`, 128);
        if (!TERM_ID_RE.test(termId)) fail(code, `${entryPath}.id`, "invalid term id");
      } else {
        fail(code, `${entryPath}.kind`, "unknown message value kind");
      }
    }
  }, path);
}

const GAME_LOG_ZONES = [
  "hand", "deck", "arsenal", "pitch", "graveyard", "banish", "soul", "board",
  "equipment", "weapon", "stack", "chain", "inventory",
] as const;

function validateGameLogEvent(value: unknown, code: string, path: string): void {
  const event = object(value, code, path);
  const kind = string(event.kind, code, `${path}.kind`, 32) as GameLogEvent["kind"];
  const validateSeat = (seatValue: unknown, seatPath: string) => {
    const seat = integer(seatValue, code, seatPath);
    if (seat !== 0 && seat !== 1) fail(code, seatPath, "expected seat 0 or 1");
  };
  const positiveInteger = (integerValue: unknown, integerPath: string) => {
    const result = integer(integerValue, code, integerPath);
    if (result <= 0) fail(code, integerPath, "expected a positive safe integer");
    return result;
  };
  if (kind === "card-moved") {
    const moved = exact(value, code, path, ["kind", "ownerSeat", "from", "to"], ["cardId", "faceDown"]);
    validateSeat(moved.ownerSeat, `${path}.ownerSeat`);
    oneOf(moved.from, GAME_LOG_ZONES, code, `${path}.from`);
    oneOf(moved.to, GAME_LOG_ZONES, code, `${path}.to`);
    optional(moved, "cardId", (entry, entryPath) => { string(entry, code, entryPath, 128); }, path);
    optional(moved, "faceDown", (entry, entryPath) => {
      if (entry !== true) fail(code, entryPath, "expected true");
    }, path);
    return;
  }
  if (kind === "cards-revealed") {
    const revealed = exact(value, code, path, ["kind", "cards", "sourceZone"]);
    oneOf(revealed.sourceZone, ["hand", "deck", "inventory"] as const, code, `${path}.sourceZone`);
    const cards = array(revealed.cards, code, `${path}.cards`, 256);
    if (cards.length === 0) fail(code, `${path}.cards`, "expected at least one card");
    cards.forEach((cardValue, index) => {
      const cardPath = `${path}.cards[${index}]`;
      const card = exact(cardValue, code, cardPath, ["cardId", "ownerSeat"]);
      string(card.cardId, code, `${cardPath}.cardId`, 128);
      validateSeat(card.ownerSeat, `${cardPath}.ownerSeat`);
    });
    return;
  }
  if (kind === "damage") {
    const damage = exact(value, code, path, ["kind", "targetSeat", "amount", "damageType"], ["sourceCardId"]);
    validateSeat(damage.targetSeat, `${path}.targetSeat`);
    positiveInteger(damage.amount, `${path}.amount`);
    oneOf(damage.damageType, ["physical", "arcane"] as const, code, `${path}.damageType`);
    optional(damage, "sourceCardId", (entry, entryPath) => { string(entry, code, entryPath, 128); }, path);
    return;
  }
  if (kind === "turn-start") {
    const turn = exact(value, code, path, ["kind", "turn", "activeSeat"]);
    positiveInteger(turn.turn, `${path}.turn`);
    validateSeat(turn.activeSeat, `${path}.activeSeat`);
    return;
  }
  if (kind === "shuffle") {
    const shuffle = exact(value, code, path, ["kind", "seat"]);
    validateSeat(shuffle.seat, `${path}.seat`);
    return;
  }
  if (kind === "roll") {
    const roll = exact(value, code, path, ["kind", "result"], ["seat", "sides"]);
    const result = positiveInteger(roll.result, `${path}.result`);
    optional(roll, "seat", (entry, entryPath) => { validateSeat(entry, entryPath); }, path);
    optional(roll, "sides", (entry, entryPath) => {
      const sides = positiveInteger(entry, entryPath);
      if (result > sides) fail(code, `${path}.result`, "result exceeds die sides");
    }, path);
    return;
  }
  fail(code, `${path}.kind`, "unknown game log event kind");
}

function validateGameLogPayload(value: unknown, code: string, path: string): void {
  const payload = exact(value, code, path, ["fallback", "message"], ["event"]);
  string(payload.fallback, code, `${path}.fallback`);
  validateGameMessage(payload.message, code, `${path}.message`);
  optional(payload, "event", (event, eventPath) => validateGameLogEvent(event, code, eventPath), path);
}

function validateTokenCreationCause(value: unknown, code: string, path: string): void {
  const cause = exact(value, code, path, ["kind"], ["sourceCardId"]);
  oneOf(cause.kind, ["effect", "wager"] as const, code, `${path}.kind`);
  optional(cause, "sourceCardId", (entry, entryPath) => {
    string(entry, code, entryPath, 128);
  }, path);
}

function validateTokenCreationReplacementRefs(value: unknown, code: string, path: string): void {
  array(value, code, path, 256).forEach((entryValue, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = exact(entryValue, code, entryPath, ["instanceId", "kind"]);
    integer(entry.instanceId, code, `${entryPath}.instanceId`);
    oneOf(
      entry.kind,
      ["global", "friendly", "optional-friendly"] as const,
      code,
      `${entryPath}.kind`,
    );
  });
}

function validateTokenCreationRequests(value: unknown, code: string, path: string): void {
  array(value, code, path, 256).forEach((entryValue, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = exact(
      entryValue,
      code,
      entryPath,
      ["seat", "cardId", "count", "cause"],
      ["initialCounters"],
    );
    integer(entry.seat, code, `${entryPath}.seat`);
    string(entry.cardId, code, `${entryPath}.cardId`, 128);
    integer(entry.count, code, `${entryPath}.count`);
    validateTokenCreationCause(entry.cause, code, `${entryPath}.cause`);
    optional(entry, "initialCounters", (counters, countersPath) => {
      validateFlags(counters, code, countersPath, true);
    }, entryPath);
  });
}

function validateCardOptionArray(value: unknown, code: string, path: string): void {
  array(value, code, path).forEach((entry, index) => {
    if (entry === null) return;
    if (typeof entry === "string") {
      string(entry, code, `${path}[${index}]`, 256);
      return;
    }
    integer(entry, code, `${path}[${index}]`);
  });
}

function validateFlags(value: unknown, code: string, path: string, numbersOnly = false): void {
  const flags = object(value, code, path);
  if (Object.keys(flags).length > 256) fail(code, path, "too many entries");
  for (const [key, entry] of Object.entries(flags)) {
    if (!key || key.length > 128) fail(code, path, "invalid key");
    if (typeof entry === "number") integer(entry, code, `${path}.${key}`);
    else if (!numbersOnly && typeof entry === "boolean") bool(entry, code, `${path}.${key}`);
    else fail(code, `${path}.${key}`, numbersOnly ? "expected a safe integer" : "expected a safe integer or boolean");
  }
}

const CARD_REQUIRED = ["instanceId", "cardId", "owner"] as const satisfies readonly (keyof CardInstance)[];
const CARD_OPTIONAL = ["subcards", "pitchCount", "faceDown", "intimidated", "returnToHandAtTurn", "tapped", "defCounters", "counters", "chosenName", "playableFrom", "playableFromSourceCardId", "playableFromSingleUseGroup", "playableBySeat", "playableFromExpiry", "playableFromEndTurnExpiry", "playableFromUntilStartOfSeatTurn", "playableFromUntilEndOfSeatTurn", "playableFromGrantedTurn", "playableFromUntilChainClose", "playCostReduction", "playCostReductionSeat", "playTargetInstanceId", "boundToInstanceId", "grantedTypes", "grantedColor", "grantedNames", "originalHeroCardId", "temporaryHeroOriginalCardId", "temporaryHeroUntilTurn", "grantedBaseAbilitiesCardId", "grantedBaseAbilitiesCardIds", "copyOriginalCardId", "grantedKeywords", "suppressedKeywords", "tempPower", "tempDefense", "temporaryAlly", "meldSide", "life", "damagePrevented", "flipped", "arsenalSlot", "temporaryGraveyardReplacement", "playableAsInstant"] as const satisfies readonly (keyof CardInstance)[];
type _CardValidatorIsExhaustive = Assert<
  SameKeys<CardInstance, Record<(typeof CARD_REQUIRED)[number] | (typeof CARD_OPTIONAL)[number], unknown>>
>;
function validateCard(value: unknown, code: string, path: string, depth = 0): void {
  if (depth > 8) fail(code, path, "card nesting is too deep");
  const card = exact(value, code, path, CARD_REQUIRED, CARD_OPTIONAL);
  integer(card.instanceId, code, `${path}.instanceId`);
  string(card.cardId, code, `${path}.cardId`, 128);
  integer(card.owner, code, `${path}.owner`);
  for (const key of ["faceDown", "intimidated", "tapped", "flipped", "playableFromUntilChainClose", "playableAsInstant"] as const) optional(card, key, (v, p) => { bool(v, code, p); }, path);
  optional(card, "pitchCount", (v, p) => {
    if (integer(v, code, p) < 0) fail(code, p, "expected a non-negative safe integer");
  }, path);
  for (const key of ["returnToHandAtTurn", "defCounters", "playableBySeat", "playableFromExpiry", "playableFromEndTurnExpiry", "playableFromUntilStartOfSeatTurn", "playableFromUntilEndOfSeatTurn", "playableFromGrantedTurn", "playCostReduction", "playCostReductionSeat", "playTargetInstanceId", "boundToInstanceId", "temporaryHeroUntilTurn", "tempPower", "tempDefense", "life", "arsenalSlot"] as const) optional(card, key, (v, p) => { integer(v, code, p); }, path);
  optional(card, "counters", (v, p) => validateFlags(v, code, p, true), path);
  optional(card, "chosenName", (v, p) => { string(v, code, p, 128); }, path);
  optional(card, "playableFromSourceCardId", (v, p) => { string(v, code, p, 128); }, path);
  optional(card, "playableFromSingleUseGroup", (v, p) => { string(v, code, p, 128); }, path);
  optional(card, "temporaryGraveyardReplacement", (v, p) => { oneOf(v, ["banish"] as const, code, p); }, path);
  optional(card, "subcards", (v, p) => array(v, code, p, 16).forEach(
    (subcard, index) => validateCard(subcard, code, `${p}[${index}]`, depth + 1),
  ), path);
  optional(card, "playableFrom", (v, p) => array(v, code, p, 3).forEach((z, i) => oneOf(z, ["banish", "graveyard", "deck"] as const, code, `${p}[${i}]`)), path);
  optional(card, "grantedTypes", (v, p) => validateStringArray(v, code, p), path);
  optional(card, "grantedColor", (v, p) => {
    if (v !== 1 && v !== 2 && v !== 3 && v !== 4) fail(code, p, "expected 1, 2, 3, or 4");
  }, path);
  optional(card, "grantedNames", (v, p) => validateStringArray(v, code, p), path);
  optional(card, "grantedBaseAbilitiesCardIds", (v, p) => validateStringArray(v, code, p), path);
  optional(card, "originalHeroCardId", (v, p) => { string(v, code, p, 128); }, path);
  optional(card, "temporaryHeroOriginalCardId", (v, p) => { string(v, code, p, 128); }, path);
  optional(card, "grantedBaseAbilitiesCardId", (v, p) => { string(v, code, p, 128); }, path);
  optional(card, "copyOriginalCardId", (v, p) => { string(v, code, p, 128); }, path);
  optional(card, "grantedKeywords", (v, p) => validateStringArray(v, code, p), path);
  optional(card, "suppressedKeywords", (v, p) => validateStringArray(v, code, p), path);
  optional(card, "meldSide", (v, p) => { oneOf(v, ["left", "right", "both"] as const, code, p); }, path);
  optional(card, "temporaryAlly", (v, p) => {
    const ally = exact(v, code, p, ["power", "life"]);
    integer(ally.power, code, `${p}.power`);
    integer(ally.life, code, `${p}.life`);
  }, path);
  optional(card, "damagePrevented", (v, p) => {
    const damage = exact(v, code, p, ["targetSeat", "amount"]);
    integer(damage.targetSeat, code, `${p}.targetSeat`);
    integer(damage.amount, code, `${p}.amount`);
  }, path);
}

function validateCards(value: unknown, code: string, path: string): void {
  array(value, code, path).forEach((card, index) => validateCard(card, code, `${path}[${index}]`));
}

const STACK_REQUIRED = ["sourceInstanceId", "seat", "triggerIndex", "label", "optional"] as const;
const STACK_OPTIONAL = ["triggerCount", "triggerBatchStarted", "triggerSource", "triggerEventCard", "defaultOption", "accepted", "card", "goAgain", "ability", "abilityCard", "abilityIndex", "targetCardInstanceId", "resolvedReactionAbility", "fromHand", "meldStage", "engineEffect"] as const;
function validateStackLayer(value: unknown, code: string, path: string): void {
  const layer = exact(value, code, path, STACK_REQUIRED, STACK_OPTIONAL);
  for (const key of ["sourceInstanceId", "seat", "triggerIndex"] as const) integer(layer[key], code, `${path}.${key}`);
  optional(layer, "triggerCount", (v, p) => {
    integer(v, code, p);
    if ((v as number) < 1 || (v as number) > MAX_TRIGGER_COUNT) {
      fail(code, p, `expected an integer from 1 to ${MAX_TRIGGER_COUNT}`);
    }
  }, path);
  optional(layer, "triggerBatchStarted", (v, p) => {
    if (v !== true) fail(code, p, "expected true");
  }, path);
  if (layer.triggerBatchStarted !== undefined && layer.triggerCount === undefined) {
    fail(code, path, "triggerBatchStarted requires triggerCount");
  }
  if (layer.triggerCount === 1 && layer.triggerBatchStarted !== true) {
    fail(code, path, "a final counted occurrence must have started");
  }
  string(layer.label, code, `${path}.label`);
  bool(layer.optional, code, `${path}.optional`);
  optional(layer, "defaultOption", (v, p) => { oneOf(v, ["yes", "no"] as const, code, p); }, path);
  for (const key of ["accepted", "goAgain", "ability", "resolvedReactionAbility", "fromHand"] as const) optional(layer, key, (v, p) => { bool(v, code, p); }, path);
  optional(layer, "abilityIndex", (v, p) => { integer(v, code, p); }, path);
  optional(layer, "targetCardInstanceId", (v, p) => { integer(v, code, p); }, path);
  optional(layer, "meldStage", (v, p) => { if (v !== 1 && v !== 2) fail(code, p, "expected 1 or 2"); }, path);
  optional(layer, "card", (v, p) => validateCard(v, code, p), path);
  optional(layer, "abilityCard", (v, p) => validateCard(v, code, p), path);
  optional(layer, "triggerSource", (v, p) => validateCard(v, code, p), path);
  optional(layer, "triggerEventCard", (v, p) => validateCard(v, code, p), path);
  optional(layer, "engineEffect", (v, p) => {
    const effect = object(v, code, p);
    const kind = oneOf(
      effect.kind,
      ["gain-action-points", "lose-life", "phantasm-destroy", "spectra-destroy", "watery-grave", "wager-result", "on-hit-hook", "on-effect-hit-hook", "on-friendly-effect-hit-hook", "on-defend-hook", "on-friendly-defended-hook", "on-defended-modifier", "fragment", "on-fragment-hook", "delayed-trigger", "on-hit-modifier"] as const,
      code,
      `${p}.kind`,
    );
    if (kind === "gain-action-points" || kind === "lose-life") {
      const gain = exact(v, code, p, ["kind", "amount"]);
      integer(gain.amount, code, `${p}.amount`);
    } else if (kind === "wager-result") {
      const wager = exact(v, code, p, ["kind", "wagerIndex"]);
      integer(wager.wagerIndex, code, `${p}.wagerIndex`);
    } else if (kind === "on-effect-hit-hook") {
      const hit = exact(v, code, p, ["kind", "source", "targetSeat"]);
      validateCard(hit.source, code, `${p}.source`);
      integer(hit.targetSeat, code, `${p}.targetSeat`);
    } else if (kind === "on-friendly-effect-hit-hook") {
      const hit = exact(v, code, p, ["kind", "source", "hitSource", "targetSeat", "targetWasMarked"]);
      validateCard(hit.source, code, `${p}.source`);
      validateCard(hit.hitSource, code, `${p}.hitSource`);
      integer(hit.targetSeat, code, `${p}.targetSeat`);
      bool(hit.targetWasMarked, code, `${p}.targetWasMarked`);
    } else if (kind === "on-hit-hook" || kind === "on-defend-hook" || kind === "fragment" || kind === "on-fragment-hook") {
      const hit = exact(v, code, p, ["kind", "source"]);
      validateCard(hit.source, code, `${p}.source`);
    } else if (kind === "delayed-trigger") {
      const delayed = exact(v, code, p, ["kind", "source", "hook"]);
      validateCard(delayed.source, code, `${p}.source`);
      string(delayed.hook, code, `${p}.hook`, 256);
    } else if (kind === "on-friendly-defended-hook") {
      const defended = exact(v, code, p, ["kind", "source", "defendedFromHand"]);
      validateCard(defended.source, code, `${p}.source`);
      bool(defended.defendedFromHand, code, `${p}.defendedFromHand`);
    } else if (kind === "on-hit-modifier" || kind === "on-defended-modifier") {
      const hit = exact(v, code, p, ["kind", "modifier"]);
      validateModifier(hit.modifier, code, `${p}.modifier`);
    } else {
      exact(v, code, p, ["kind"]);
    }
  }, path);
}

function validateStack(value: unknown, code: string, path: string): void {
  array(value, code, path).forEach((layer, index) => validateStackLayer(layer, code, `${path}[${index}]`));
}

function validatePlayer(value: unknown, code: string, path: string, expectedSeat: Seat): void {
  const required = ["seat", "hero", "heroCardId", "life", "intellect", "hand", "deck", "arsenal", "pitch", "graveyard", "banish", "soul", "equipment", "weapons", "board", "resources", "chi", "actionPoints", "flags"] as const;
  const player = exact(value, code, path, required, ["inventory"]);
  if (integer(player.seat, code, `${path}.seat`) !== expectedSeat) fail(code, `${path}.seat`, "seat does not match tuple position");
  validateCard(player.hero, code, `${path}.hero`);
  string(player.heroCardId, code, `${path}.heroCardId`, 128);
  for (const key of ["life", "intellect", "resources", "chi", "actionPoints"] as const) integer(player[key], code, `${path}.${key}`);
  for (const key of ["hand", "deck", "arsenal", "pitch", "graveyard", "banish", "soul", "weapons", "board"] as const) validateCards(player[key], code, `${path}.${key}`);
  optional(player, "inventory", (v, p) => validateCards(v, code, p), path);
  const equipment = exact(player.equipment, code, `${path}.equipment`, [], ["head", "chest", "arms", "legs"]);
  for (const [slot, card] of Object.entries(equipment)) validateCard(card, code, `${path}.equipment.${slot}`);
  validateFlags(player.flags, code, `${path}.flags`);
}

function validateChainLink(value: unknown, code: string, path: string): void {
  const required = ["attacker", "attackingCard", "attackCardType", "defendingCards", "defendingEquipment", "reactions", "goAgain", "damage", "hit", "resolved", "flags"] as const;
  const link = exact(value, code, path, required, ["resolvedReactionAbilitySources", "finalAttack", "finalDefense", "finalAttackModifiers", "finalDefenseModifiers", "targetAllyId", "declaredAtNextId", "wagerRewards", "wagers"]);
  integer(link.attacker, code, `${path}.attacker`);
  validateCard(link.attackingCard, code, `${path}.attackingCard`);
  oneOf(link.attackCardType, ["action", "weapon", "ally"] as const, code, `${path}.attackCardType`);
  for (const key of ["defendingCards", "defendingEquipment", "reactions"] as const) validateCards(link[key], code, `${path}.${key}`);
  optional(link, "resolvedReactionAbilitySources", (v, p) => validateCards(v, code, p), path);
  for (const key of ["goAgain", "hit", "resolved"] as const) bool(link[key], code, `${path}.${key}`);
  integer(link.damage, code, `${path}.damage`);
  for (const key of ["finalAttack", "finalDefense", "targetAllyId", "declaredAtNextId"] as const) optional(link, key, (v, p) => { integer(v, code, p); }, path);
  optional(link, "wagerRewards", (v, p) => { validateStringArray(v, code, p); }, path);
  optional(link, "wagers", (v, p) => {
    array(v, code, p, 128).forEach((entryValue, index) => {
      const entryPath = `${p}[${index}]`;
      const wager = exact(entryValue, code, entryPath, ["source", "controllerSeat", "opposingSeat", "rewardCardIds", "rewardLabel"]);
      validateCard(wager.source, code, `${entryPath}.source`);
      integer(wager.controllerSeat, code, `${entryPath}.controllerSeat`);
      integer(wager.opposingSeat, code, `${entryPath}.opposingSeat`);
      validateStringArray(wager.rewardCardIds, code, `${entryPath}.rewardCardIds`);
      string(wager.rewardLabel, code, `${entryPath}.rewardLabel`, 512);
    });
  }, path);
  for (const key of ["finalAttackModifiers", "finalDefenseModifiers"] as const) {
    optional(link, key, (value, valuePath) => {
      array(value, code, valuePath, 128).forEach((entryValue, index) => {
        const entryPath = `${valuePath}[${index}]`;
        const entry = exact(entryValue, code, entryPath, ["sourceInstanceId", "sourceCardId", "amount"]);
        integer(entry.sourceInstanceId, code, `${entryPath}.sourceInstanceId`);
        string(entry.sourceCardId, code, `${entryPath}.sourceCardId`, 256);
        integer(entry.amount, code, `${entryPath}.amount`);
      });
    }, path);
  }
  validateFlags(link.flags, code, `${path}.flags`);
}

const MODIFIER_REQUIRED = ["id", "sourceInstanceId", "seat", "scope"] as const;
const MODIFIER_NUMBERS = ["expiresAtStartOfTurn", "expiresAtEndOfTurn", "expiresAtStartOfSeatTurn", "expiresAtEndOfSeatTurn", "createdTurn", "basePower", "attack", "powerGainBonus", "attackActivationCostReduction", "activationCostReduction", "attackCostReduction", "piercing", "defense", "damage", "intimidate", "preventNextDamageAmount", "preventNextDamagePool", "preventDamagePerEvent", "preventDamageEventsRemaining", "discardDamagePreventionAmount", "discardDamagePreventionDraw", "preventNextDamageFromPitch", "maxDamageEventAmount", "reflectPreventedDamageToSeat", "redirectDamageFromSeat", "redirectDamageToSeat", "redirectDamagePrevent", "onHitGainLife", "onHitGainResources", "onHitDraw", "attackActionCardCap", "nonAttackActionCardCap", "goAgainIfAttackPowerAtLeast", "onDefendedDealDamage", "onHitLoseLife", "onDestroyedDraw", "onBoostAttack", "onActionPlayedGainActionPoints", "extraDiceIgnoreLowest", "onHitDealDamage", "defendedLessThanNonEquip", "minCost", "maxCost", "maxBasePower", "minBasePower", "minimumAttackBasePower", "appliesToInstanceId", "suppressesActivatedAbilitiesOfInstanceId", "cannotDefendWithInstanceId", "appliesToPitch", "playCostReduction", "remainingCostUses", "maxNonBlockDefenders", "onDefendedByAttackActionPowerCounters"] as const satisfies readonly (keyof Modifier)[];
const MODIFIER_BOOLEANS = ["appliesToEquipment", "appliesToFirstDefenderOnly", "damageUnpreventable", "goAgain", "dominate", "overpower", "preventAllDamageFromSource", "reflectPreventedDamageUnpreventable", "onHitGoAgain", "suppressesHeroAbilities", "suppressesHeroAbilitiesDuringActionPhase", "suppressesOwnedNames", "suppressesOwnedClassTalentTypes", "restrictActionsToWeaponOrAttack", "restrictActionsToNonWeaponNonAttack", "prohibitsDefenseReactionNamesInGraveyard", "goAgainIfDefendedByAttackAction", "suppressHitEffects", "onHitToSoul", "onHitBottomDeck", "onHitReenableAttacker", "onHitReenableAttackerIfMarked", "onHitMark", "onBoostDominate", "onHitClearHandAndArsenalAtEndPhase", "replaceCombatDamageWithDefendingEquipment", "appliesToMarkedHero", "appliesToFromArsenal", "appliesToRuneGated", "appliesToCharged", "noDefenseReactionsFromArsenal", "noDefenseReactionsFromHand", "once", "expiresOnChainClose", "consumed"] as const satisfies readonly (keyof Modifier)[];
const MODIFIER_STRINGS = ["sourceCardId", "grantType", "grantName", "discardDamagePreventionCardType", "preventLethalDamageByBanishingNamedCard", "banishPreventedDamageSourceFaceDownIfType", "appliesToDamageSourceType", "appliesToDamageRecipientType", "grantKeyword", "suppressKeyword", "prohibitsName", "grantsTypeToName", "grantsType", "onFriendlyActivateCreateToken", "onDamageDealtCreateTokenPerPoint", "onPreventCreateToken", "appliesToClass", "appliesToKeyword", "appliesToName", "appliesToTargetType", "appliesToTargetNamePrefix", "excludesSubtype", "appliesToCardType", "restrictCardPlaysToType", "ongoingLabel", "grantsPlayFromNameContains", "goAgainIfPlayedOrCreatedSubtype", "overpowerIfNameContains"] as const satisfies readonly (keyof Modifier)[];
const MODIFIER_OBJECTS = ["onHitCreateToken", "onAttackActionPlayedFromBanishCreateToken", "onHitDestroyTopDeckCards", "onHitScriptHook", "defendingPitchDefenseAdjustment", "appliesTo", "appliesToSubtype", "appliesToType", "grantsPlayFromZone"] as const satisfies readonly (keyof Modifier)[];
type _ModifierValidatorIsExhaustive = Assert<
  SameKeys<
    Modifier,
    Record<
      | (typeof MODIFIER_REQUIRED)[number]
      | (typeof MODIFIER_NUMBERS)[number]
      | (typeof MODIFIER_BOOLEANS)[number]
      | (typeof MODIFIER_STRINGS)[number]
      | (typeof MODIFIER_OBJECTS)[number],
      unknown
    >
  >
>;
function validateModifier(value: unknown, code: string, path: string): void {
  const optionalKeys = [...MODIFIER_NUMBERS, ...MODIFIER_BOOLEANS, ...MODIFIER_STRINGS, ...MODIFIER_OBJECTS];
  const modifier = exact(value, code, path, MODIFIER_REQUIRED, optionalKeys);
  for (const key of ["id", "sourceInstanceId", "seat"] as const) integer(modifier[key], code, `${path}.${key}`);
  oneOf(modifier.scope, ["chain-link", "next-attack", "until-end-of-turn", "static", "combat-chain", "next-play"] as const, code, `${path}.scope`);
  for (const key of MODIFIER_NUMBERS) optional(modifier, key, (v, p) => { integer(v, code, p); }, path);
  for (const key of MODIFIER_BOOLEANS) optional(modifier, key, (v, p) => { bool(v, code, p); }, path);
  for (const key of MODIFIER_STRINGS) optional(modifier, key, (v, p) => { string(v, code, p, 256); }, path);
  optional(modifier, "onHitCreateToken", (v, p) => {
    const token = exact(v, code, p, ["cardId", "count"]);
    string(token.cardId, code, `${p}.cardId`, 128);
    integer(token.count, code, `${p}.count`);
  }, path);
  optional(modifier, "onAttackActionPlayedFromBanishCreateToken", (v, p) => {
    const token = exact(v, code, p, ["cardId", "count"]);
    string(token.cardId, code, `${p}.cardId`, 128);
    integer(token.count, code, `${p}.count`);
  }, path);
  optional(modifier, "onHitDestroyTopDeckCards", (v, p) => {
    const effect = exact(v, code, p, ["count", "minimumDamage"]);
    integer(effect.count, code, `${p}.count`);
    integer(effect.minimumDamage, code, `${p}.minimumDamage`);
  }, path);
  optional(modifier, "onHitScriptHook", (v, p) => {
    const effect = exact(
      v,
      code,
      p,
      ["hook", "label"],
      ["heroOnly", "requiresAttackCounter", "requiresAttackNameContains"],
    );
    string(effect.hook, code, `${p}.hook`, 256);
    string(effect.label, code, `${p}.label`, 256);
    optional(effect, "heroOnly", (entry, entryPath) => { bool(entry, code, entryPath); }, p);
    optional(effect, "requiresAttackCounter", (entry, entryPath) => { string(entry, code, entryPath, 128); }, p);
    optional(effect, "requiresAttackNameContains", (entry, entryPath) => { string(entry, code, entryPath, 128); }, p);
  }, path);
  optional(modifier, "defendingPitchDefenseAdjustment", (v, p) => {
    const adjustment = exact(v, code, p, ["pitch", "amount"], ["requiresAimCounter"]);
    integer(adjustment.pitch, code, `${p}.pitch`);
    integer(adjustment.amount, code, `${p}.amount`);
    optional(adjustment, "requiresAimCounter", (entry, entryPath) => { bool(entry, code, entryPath); }, p);
  }, path);
  optional(modifier, "appliesTo", (v, p) => { oneOf(v, ["any", "attack", "weapon", "sword", "attack-action"] as const, code, p); }, path);
  optional(modifier, "grantsPlayFromZone", (v, p) => { oneOf(v, ["banish", "graveyard", "deck"] as const, code, p); }, path);
  optional(modifier, "appliesToSubtype", (v, p) => typeof v === "string" ? string(v, code, p, 256) : validateStringArray(v, code, p), path);
  optional(modifier, "appliesToType", (v, p) => validateStringArray(v, code, p), path);
}

function validateArcane(value: unknown, code: string, path: string, depth: number): void {
  if (depth > MAX_ARCANE_DEPTH) fail(code, path, "arcane queue nesting is too deep");
  const arcane = exact(value, code, path, ["sourceInstanceId", "sourceSeat", "targetSeat", "amount", "arcane"], ["sourceIsAlly", "sourceIsRunechant", "countsAsHit", "destroySourceAfterDamage", "targetWasMarked", "targetAllyId", "combat", "combatDamageEquipmentReplacementIds", "unpreventable", "payTotal", "arcaneBarrierResolved", "usedQuellSourceIds", "usedDiscardDamagePreventionModifierIds", "usedSoulDamagePreventionSourceIds", "soulDamagePreventionSourceInstanceId", "lethalDamagePreventionModifierId", "quellSourceInstanceId", "queue"]);
  for (const key of ["sourceInstanceId", "sourceSeat", "targetSeat", "amount"] as const) integer(arcane[key], code, `${path}.${key}`);
  bool(arcane.arcane, code, `${path}.arcane`);
  for (const key of ["sourceIsAlly", "sourceIsRunechant", "countsAsHit", "destroySourceAfterDamage", "targetWasMarked", "combat", "unpreventable", "arcaneBarrierResolved"] as const) optional(arcane, key, (v, p) => { bool(v, code, p); }, path);
  for (const key of ["targetAllyId", "payTotal", "soulDamagePreventionSourceInstanceId", "lethalDamagePreventionModifierId", "quellSourceInstanceId"] as const) optional(arcane, key, (v, p) => { integer(v, code, p); }, path);
  optional(arcane, "usedQuellSourceIds", (v, p) => array(v, code, p, 64).forEach((entry, index) => integer(entry, code, `${p}[${index}]`)), path);
  optional(arcane, "usedDiscardDamagePreventionModifierIds", (v, p) => array(v, code, p, 64).forEach((entry, index) => integer(entry, code, `${p}[${index}]`)), path);
  optional(arcane, "usedSoulDamagePreventionSourceIds", (v, p) => array(v, code, p, 64).forEach((entry, index) => integer(entry, code, `${p}[${index}]`)), path);
  optional(arcane, "combatDamageEquipmentReplacementIds", (v, p) => array(v, code, p, 64).forEach((entry, index) => integer(entry, code, `${p}[${index}]`)), path);
  optional(arcane, "queue", (v, p) => array(v, code, p, 64).forEach((entry, index) => validateArcane(entry, code, `${p}[${index}]`, depth + 1)), path);
}

function validateResume(value: unknown, code: string, path: string): void {
  const resume = object(value, code, path);
  const kind = oneOf(resume.kind, ["stack-card", "continue-play-after-declaration", "finish-play", "finish-reaction", "finish-window-instant", "after-declare", "start-reaction-step", "after-resolution", "continue-stack", "finish-wager-result", "continue-wager-loss-replacements", "continue-wager-prizes", "reopen-reaction", "game-setup"] as const, code, `${path}.kind`);
  if (kind === "stack-card") {
    const entry = exact(value, code, path, ["kind", "seat", "card"]);
    integer(entry.seat, code, `${path}.seat`); validateCard(entry.card, code, `${path}.card`);
  } else if (kind === "continue-play-after-declaration") {
    const entry = exact(value, code, path, ["kind", "seat", "instanceId", "pitchInstanceIds", "from"], ["meldSide", "targetAllyId", "boost", "boostCount", "asInstant", "alternativeCostCardInstanceIds", "targetCardInstanceId", "declaredVariableX"]);
    integer(entry.seat, code, `${path}.seat`);
    integer(entry.instanceId, code, `${path}.instanceId`);
    validateIntegerArray(entry.pitchInstanceIds, code, `${path}.pitchInstanceIds`);
    oneOf(entry.from, ["hand", "arsenal", "banish", "graveyard", "deck"] as const, code, `${path}.from`);
    optional(entry, "meldSide", (v, p) => { oneOf(v, ["left", "right", "both"] as const, code, p); }, path);
    optional(entry, "targetAllyId", (v, p) => { integer(v, code, p); }, path);
    optional(entry, "boost", (v, p) => { bool(v, code, p); }, path);
    optional(entry, "boostCount", (v, p) => {
      const count = integer(v, code, p);
      if (count < 2 || count > 8) fail(code, p, "expected a Boost count from 2 to 8");
    }, path);
    optional(entry, "asInstant", (v, p) => { bool(v, code, p); }, path);
    optional(entry, "alternativeCostCardInstanceIds", (v, p) => validateIntegerArray(v, code, p), path);
    optional(entry, "targetCardInstanceId", (v, p) => { integer(v, code, p); }, path);
    optional(entry, "declaredVariableX", (v, p) => { integer(v, code, p); }, path);
  } else if (kind === "finish-play") {
    const entry = exact(value, code, path, ["kind", "seat", "card", "from"], ["targetAllyId", "boost", "boostCount", "asInstant"]);
    integer(entry.seat, code, `${path}.seat`); validateCard(entry.card, code, `${path}.card`);
    oneOf(entry.from, ["hand", "arsenal", "banish", "graveyard", "deck"] as const, code, `${path}.from`);
    optional(entry, "targetAllyId", (v, p) => { integer(v, code, p); }, path);
    optional(entry, "boost", (v, p) => { bool(v, code, p); }, path);
    optional(entry, "boostCount", (v, p) => {
      const count = integer(v, code, p);
      if (count < 2 || count > 8) fail(code, p, "expected a Boost count from 2 to 8");
    }, path);
    optional(entry, "asInstant", (v, p) => { bool(v, code, p); }, path);
  } else if (kind === "finish-reaction" || kind === "finish-window-instant") {
    const entry = exact(value, code, path, ["kind", "seat", "card", "from"]);
    integer(entry.seat, code, `${path}.seat`); validateCard(entry.card, code, `${path}.card`);
    oneOf(entry.from, ["hand", "arsenal", "banish", "graveyard", "deck"] as const, code, `${path}.from`);
  } else if (kind === "continue-stack") {
    const entry = exact(value, code, path, ["kind"], ["seat"]);
    optional(entry, "seat", (v, p) => { integer(v, code, p); }, path);
  } else if (kind === "finish-wager-result" || kind === "continue-wager-prizes") {
    const entry = exact(value, code, path, ["kind", "wagerIndex"]);
    integer(entry.wagerIndex, code, `${path}.wagerIndex`);
  } else if (kind === "continue-wager-loss-replacements") {
    const entry = exact(value, code, path, ["kind", "wagerIndex", "remainingSourceInstanceIds"]);
    integer(entry.wagerIndex, code, `${path}.wagerIndex`);
    validateIntegerArray(
      entry.remainingSourceInstanceIds,
      code,
      `${path}.remainingSourceInstanceIds`,
    );
  } else if (kind === "reopen-reaction") {
    const entry = exact(value, code, path, ["kind", "seat"]); integer(entry.seat, code, `${path}.seat`);
  } else if (kind === "game-setup") {
    const entry = exact(value, code, path, ["kind", "nextSeat"]); integer(entry.nextSeat, code, `${path}.nextSeat`);
  } else exact(value, code, path, ["kind"]);
}

function validateDecision(value: unknown, code: string, path: string, depth = 0): void {
  if (depth > 16) fail(code, path, "follow-up decision nesting is too deep");
  const decision = exact(value, code, path, ["player", "kind", "prompt"], ["promptMessage", "options", "minimumSelections", "maximumSelections", "defaultOption", "optionLabels", "optionMessages", "optionCounts", "sourceInstanceId", "scriptSourceSnapshot", "chooseHook", "followUpDecisions", "tokenCreationCause", "cardOptions", "revealedCardIds", "lookedCardIds", "payment", "resourcePayment", "xPayment", "variablePlayCost", "variableActivationCost", "tokenCreationReplacement", "tokenCreationReplacementOrder", "wagerLossReplacementOrder", "activationCost", "clash", "arcane", "triggerOrder", "deckBottomOrder", "dieRoll", "staged", "resume"]);
  integer(decision.player, code, `${path}.player`);
  oneOf(decision.kind, ["defend", "attack-reaction", "defense-reaction", "priority-window", "arsenal", "choose-target", "choose-name", "order-triggers", "optional-effect"] as const, code, `${path}.kind`);
  string(decision.prompt, code, `${path}.prompt`);
  optional(decision, "promptMessage", (v, p) => validateGameMessage(v, code, p), path);
  optional(decision, "options", (v, p) => validateStringArray(v, code, p), path);
  optional(decision, "minimumSelections", (v, p) => { integer(v, code, p); }, path);
  optional(decision, "maximumSelections", (v, p) => { integer(v, code, p); }, path);
  if ((decision.minimumSelections === undefined) !== (decision.maximumSelections === undefined)) {
    fail(code, path, "selection bounds must be present together");
  }
  if (decision.maximumSelections !== undefined) {
    if (decision.kind !== "choose-target") {
      fail(code, path, "selection bounds require a choose-target decision");
    }
    const minimum = integer(decision.minimumSelections, code, `${path}.minimumSelections`);
    const maximum = integer(decision.maximumSelections, code, `${path}.maximumSelections`);
    if (minimum < 0 || maximum < minimum) fail(code, path, "invalid selection bounds");
    if (!Array.isArray(decision.options) || maximum > decision.options.length) {
      fail(code, path, "selection maximum exceeds options");
    }
  }
  optional(decision, "defaultOption", (v, p) => { string(v, code, p, 256); }, path);
  if (
    typeof decision.defaultOption === "string" &&
    (!Array.isArray(decision.options) || !decision.options.includes(decision.defaultOption))
  ) {
    fail(code, `${path}.defaultOption`, "must be one of options");
  }
  optional(decision, "optionLabels", (v, p) => validateStringArray(v, code, p), path);
  if (
    Array.isArray(decision.options) &&
    Array.isArray(decision.optionLabels) &&
    decision.options.length !== decision.optionLabels.length
  ) {
    fail(code, `${path}.optionLabels`, "must be parallel to options");
  }
  optional(decision, "optionMessages", (v, p) => {
    array(v, code, p).forEach((message, index) => {
      if (message !== null) validateGameMessage(message, code, `${p}[${index}]`);
    });
  }, path);
  if (
    Array.isArray(decision.options) &&
    Array.isArray(decision.optionMessages) &&
    decision.options.length !== decision.optionMessages.length
  ) {
    fail(code, `${path}.optionMessages`, "must be parallel to options");
  }
  optional(decision, "optionCounts", (v, p) => {
    array(v, code, p, MAX_COLLECTION).forEach((count, index) => {
      if (count === null) return;
      integer(count, code, `${p}[${index}]`);
      if ((count as number) < 2 || (count as number) > MAX_TRIGGER_COUNT) {
        fail(code, `${p}[${index}]`, `expected null or an integer from 2 to ${MAX_TRIGGER_COUNT}`);
      }
    });
  }, path);
  optional(decision, "scriptSourceSnapshot", (v, p) => {
    const source = exact(v, code, p, ["seat", "card"]);
    integer(source.seat, code, `${p}.seat`);
    validateCard(source.card, code, `${p}.card`);
  }, path);
  if (
    Array.isArray(decision.options) &&
    Array.isArray(decision.optionCounts) &&
    decision.options.length !== decision.optionCounts.length
  ) {
    fail(code, `${path}.optionCounts`, "must be parallel to options");
  }
  optional(decision, "sourceInstanceId", (v, p) => { integer(v, code, p); }, path);
  optional(decision, "chooseHook", (v, p) => { string(v, code, p, 256); }, path);
  optional(decision, "followUpDecisions", (v, p) => {
    array(v, code, p, 32).forEach((entry, index) => {
      validateDecision(entry, code, `${p}[${index}]`, depth + 1);
    });
  }, path);
  optional(decision, "tokenCreationCause", (v, p) => validateTokenCreationCause(v, code, p), path);
  optional(decision, "cardOptions", (v, p) => validateCardOptionArray(v, code, p), path);
  optional(decision, "revealedCardIds", (v, p) => validateIntegerArray(v, code, p), path);
  optional(decision, "lookedCardIds", (v, p) => validateIntegerArray(v, code, p), path);
  optional(decision, "staged", (v, p) => validateIntegerArray(v, code, p), path);
  optional(decision, "payment", (v, p) => {
    const payment = exact(v, code, p, ["pitchOptions"]);
    const choices = object(payment.pitchOptions, code, `${p}.pitchOptions`);
    if (Object.keys(choices).length > 128) fail(code, `${p}.pitchOptions`, "too many choices");
    for (const [key, choiceValue] of Object.entries(choices)) {
      if (!key || key.length > 128) fail(code, `${p}.pitchOptions`, "invalid choice key");
      const choice = exact(choiceValue, code, `${p}.pitchOptions.${key}`, ["cost", "pitchIds", "result"]);
      integer(choice.cost, code, `${p}.pitchOptions.${key}.cost`);
      validateIntegerArray(choice.pitchIds, code, `${p}.pitchOptions.${key}.pitchIds`);
      string(choice.result, code, `${p}.pitchOptions.${key}.result`, 256);
    }
  }, path);
  optional(decision, "resourcePayment", (v, p) => {
    const payment = exact(v, code, p, ["cost", "options"]);
    integer(payment.cost, code, `${p}.cost`);
    array(payment.options, code, `${p}.options`, 128).forEach((entryValue, index) => {
      const entry = exact(entryValue, code, `${p}.options[${index}]`, ["optionId", "pitchInstanceIds"]);
      string(entry.optionId, code, `${p}.options[${index}].optionId`, 128);
      validateIntegerArray(entry.pitchInstanceIds, code, `${p}.options[${index}].pitchInstanceIds`);
    });
  }, path);
  optional(decision, "xPayment", (v, p) => {
    const payment = exact(v, code, p, ["choices"]);
    const choices = object(payment.choices, code, `${p}.choices`);
    if (Object.keys(choices).length > 128) fail(code, `${p}.choices`, "too many choices");
    for (const [key, choiceValue] of Object.entries(choices)) {
      if (!key || key.length > 128) fail(code, `${p}.choices`, "invalid choice key");
      const choice = exact(choiceValue, code, `${p}.choices.${key}`, ["cost", "result"]);
      integer(choice.cost, code, `${p}.choices.${key}.cost`);
      string(choice.result, code, `${p}.choices.${key}.result`, 256);
    }
  }, path);
  optional(decision, "variablePlayCost", (v, p) => {
    const variable = exact(v, code, p, ["mode", "seat", "instanceId", "from"], ["choices", "declaredX", "paymentOptions", "meldSide", "targetAllyId", "targetCardInstanceId", "boost", "boostCount", "asInstant", "alternativeCostCardInstanceIds"]);
    oneOf(variable.mode, ["action", "reaction", "window"] as const, code, `${p}.mode`);
    integer(variable.seat, code, `${p}.seat`);
    integer(variable.instanceId, code, `${p}.instanceId`);
    oneOf(variable.from, ["hand", "arsenal", "banish", "graveyard", "deck"] as const, code, `${p}.from`);
    optional(variable, "choices", (choiceValue, choicePath) => {
      const choices = object(choiceValue, code, choicePath);
      if (Object.keys(choices).length > 128) fail(code, choicePath, "too many choices");
      for (const [key, entryValue] of Object.entries(choices)) {
        if (!key || key.length > 128) fail(code, `${choicePath}.${key}`, "invalid choice key");
        const entry = exact(entryValue, code, `${choicePath}.${key}`, ["x", "cost"]);
        integer(entry.x, code, `${choicePath}.${key}.x`);
        integer(entry.cost, code, `${choicePath}.${key}.cost`);
      }
    }, p);
    optional(variable, "paymentOptions", (paymentValue, paymentPath) => {
      const payments = object(paymentValue, code, paymentPath);
      if (Object.keys(payments).length > 128) fail(code, paymentPath, "too many payment options");
      for (const [key, entryValue] of Object.entries(payments)) {
        if (!key || key.length > 128) fail(code, `${paymentPath}.${key}`, "invalid payment key");
        const entry = exact(entryValue, code, `${paymentPath}.${key}`, ["pitchInstanceIds"]);
        validateIntegerArray(entry.pitchInstanceIds, code, `${paymentPath}.${key}.pitchInstanceIds`);
      }
    }, p);
    for (const key of ["declaredX", "targetAllyId", "targetCardInstanceId", "boostCount"] as const) {
      optional(variable, key, (entry, entryPath) => { integer(entry, code, entryPath); }, p);
    }
    optional(variable, "meldSide", (entry, entryPath) => { oneOf(entry, ["left", "right", "both"] as const, code, entryPath); }, p);
    for (const key of ["boost", "asInstant"] as const) {
      optional(variable, key, (entry, entryPath) => { bool(entry, code, entryPath); }, p);
    }
    optional(variable, "alternativeCostCardInstanceIds", (entry, entryPath) => {
      validateIntegerArray(entry, code, entryPath);
    }, p);
  }, path);
  optional(decision, "variableActivationCost", (v, p) => {
    const variable = exact(v, code, p, ["mode", "seat", "sourceInstanceId", "abilityIndex"], ["choices", "declaredX", "paymentOptions"]);
    oneOf(variable.mode, ["action", "window"] as const, code, `${p}.mode`);
    for (const key of ["seat", "sourceInstanceId", "abilityIndex"] as const) integer(variable[key], code, `${p}.${key}`);
    optional(variable, "choices", (choiceValue, choicePath) => {
      const choices = object(choiceValue, code, choicePath);
      if (Object.keys(choices).length > 128) fail(code, choicePath, "too many choices");
      for (const [key, entryValue] of Object.entries(choices)) {
        if (!key || key.length > 128) fail(code, `${choicePath}.${key}`, "invalid choice key");
        const entry = exact(entryValue, code, `${choicePath}.${key}`, ["x", "cost"]);
        integer(entry.x, code, `${choicePath}.${key}.x`);
        integer(entry.cost, code, `${choicePath}.${key}.cost`);
      }
    }, p);
    optional(variable, "paymentOptions", (paymentValue, paymentPath) => {
      const payments = object(paymentValue, code, paymentPath);
      if (Object.keys(payments).length > 128) fail(code, paymentPath, "too many payment options");
      for (const [key, entryValue] of Object.entries(payments)) {
        if (!key || key.length > 128) fail(code, `${paymentPath}.${key}`, "invalid payment key");
        const entry = exact(entryValue, code, `${paymentPath}.${key}`, ["pitchInstanceIds"]);
        validateIntegerArray(entry.pitchInstanceIds, code, `${paymentPath}.${key}.pitchInstanceIds`);
      }
    }, p);
    optional(variable, "declaredX", (entry, entryPath) => { integer(entry, code, entryPath); }, p);
  }, path);
  optional(decision, "tokenCreationReplacement", (v, p) => {
    const batch = exact(v, code, p, ["seat", "cardId", "count", "cause", "remainingReplacements"], ["controllerSeats", "initialCounters"]);
    integer(batch.seat, code, `${p}.seat`);
    string(batch.cardId, code, `${p}.cardId`, 128);
    integer(batch.count, code, `${p}.count`);
    validateTokenCreationCause(batch.cause, code, `${p}.cause`);
    optional(batch, "initialCounters", (counters, countersPath) => {
      validateFlags(counters, code, countersPath, true);
    }, p);
    validateTokenCreationReplacementRefs(batch.remainingReplacements, code, `${p}.remainingReplacements`);
    optional(batch, "controllerSeats", (entry, entryPath) => {
      validateIntegerArray(entry, code, entryPath);
    }, p);
  }, path);
  optional(decision, "tokenCreationReplacementOrder", (v, p) => {
    const batch = exact(v, code, p, ["seat", "cardId", "count", "cause", "remainingReplacements"], ["controllerSeats", "initialCounters"]);
    integer(batch.seat, code, `${p}.seat`);
    string(batch.cardId, code, `${p}.cardId`, 128);
    integer(batch.count, code, `${p}.count`);
    validateTokenCreationCause(batch.cause, code, `${p}.cause`);
    optional(batch, "initialCounters", (counters, countersPath) => {
      validateFlags(counters, code, countersPath, true);
    }, p);
    validateTokenCreationReplacementRefs(batch.remainingReplacements, code, `${p}.remainingReplacements`);
    optional(batch, "controllerSeats", (entry, entryPath) => {
      validateIntegerArray(entry, code, entryPath);
    }, p);
  }, path);
  optional(decision, "wagerLossReplacementOrder", (v, p) => {
    const batch = exact(v, code, p, ["wagerIndex", "remainingSourceInstanceIds"]);
    integer(batch.wagerIndex, code, `${p}.wagerIndex`);
    validateIntegerArray(
      batch.remainingSourceInstanceIds,
      code,
      `${p}.remainingSourceInstanceIds`,
    );
  }, path);
  optional(decision, "activationCost", (v, p) => {
    const activation = exact(v, code, p, ["mode", "seat", "sourceInstanceId", "abilityIndex", "pitchInstanceIds"], ["targetAllyId", "soulInstanceIds", "discardInstanceIds", "effectCostInstanceIds", "alternativeCostCardInstanceIds", "declaredVariableX"]);
    oneOf(activation.mode, ["action", "window"] as const, code, `${p}.mode`);
    for (const key of ["seat", "sourceInstanceId", "abilityIndex"] as const) integer(activation[key], code, `${p}.${key}`);
    optional(activation, "declaredVariableX", (entry, entryPath) => { integer(entry, code, entryPath); }, p);
    validateIntegerArray(activation.pitchInstanceIds, code, `${p}.pitchInstanceIds`);
    optional(activation, "soulInstanceIds", (entry, entryPath) => validateIntegerArray(entry, code, entryPath), p);
    optional(activation, "discardInstanceIds", (entry, entryPath) => validateIntegerArray(entry, code, entryPath), p);
    optional(activation, "effectCostInstanceIds", (entry, entryPath) => validateIntegerArray(entry, code, entryPath), p);
    optional(activation, "alternativeCostCardInstanceIds", (entry, entryPath) => validateIntegerArray(entry, code, entryPath), p);
    optional(activation, "targetAllyId", (entry, entryPath) => { integer(entry, code, entryPath); }, p);
  }, path);
  optional(decision, "clash", (v, p) => {
    const clash = exact(v, code, p, ["request", "attempt", "replacementSeats", "replacementIndex", "stage", "queue"], ["chosenReplacementSeat"]);
    const validateRequest = (requestValue: unknown, requestPath: string) => {
      const request = exact(requestValue, code, requestPath, ["sourceSeat", "sourceInstanceId", "opposingSeat", "resultHook"]);
      for (const key of ["sourceSeat", "sourceInstanceId", "opposingSeat"] as const) integer(request[key], code, `${requestPath}.${key}`);
      string(request.resultHook, code, `${requestPath}.resultHook`, 256);
    };
    validateRequest(clash.request, `${p}.request`);
    const attempt = exact(clash.attempt, code, `${p}.attempt`, ["winner", "revealed"]);
    integer(attempt.winner, code, `${p}.attempt.winner`);
    array(attempt.revealed, code, `${p}.attempt.revealed`, 2).forEach((entryValue, index) => {
      const entryPath = `${p}.attempt.revealed[${index}]`;
      const entry = exact(entryValue, code, entryPath, ["seat", "instanceId"]);
      integer(entry.seat, code, `${entryPath}.seat`);
      integer(entry.instanceId, code, `${entryPath}.instanceId`);
    });
    validateIntegerArray(clash.replacementSeats, code, `${p}.replacementSeats`);
    integer(clash.replacementIndex, code, `${p}.replacementIndex`);
    oneOf(clash.stage, ["offer", "bottom", "winner-choice"] as const, code, `${p}.stage`);
    optional(clash, "chosenReplacementSeat", (entry, entryPath) => { integer(entry, code, entryPath); }, p);
    array(clash.queue, code, `${p}.queue`, 32).forEach((entry, index) => validateRequest(entry, `${p}.queue[${index}]`));
  }, path);
  optional(decision, "arcane", (v, p) => validateArcane(v, code, p, 0), path);
  optional(decision, "triggerOrder", (v, p) => {
    const order = exact(v, code, p, ["remaining", "later"], ["baseStack"]);
    validateStack(order.remaining, code, `${p}.remaining`);
    optional(order, "baseStack", (entry, entryPath) => {
      validateStack(entry, code, entryPath);
    }, p);
    array(order.later, code, `${p}.later`, 32).forEach((groupValue, index) => {
      const groupPath = `${p}.later[${index}]`;
      const group = exact(groupValue, code, groupPath, ["seat", "layers"]);
      integer(group.seat, code, `${groupPath}.seat`);
      validateStack(group.layers, code, `${groupPath}.layers`);
    });
  }, path);
  optional(decision, "deckBottomOrder", (v, p) => {
    const order = exact(v, code, p, ["ordered", "remaining"]);
    validateIntegerArray(order.ordered, code, `${p}.ordered`);
    validateIntegerArray(order.remaining, code, `${p}.remaining`);
  }, path);
  optional(decision, "dieRoll", (v, p) => {
    const roll = exact(v, code, p, ["rollingSourceInstanceId", "rollingSeat", "hook", "sides", "result", "replacementInstanceId"], ["extraDiceIgnoreLowest"]);
    for (const key of ["rollingSourceInstanceId", "rollingSeat", "sides", "result", "replacementInstanceId"] as const) integer(roll[key], code, `${p}.${key}`);
    optional(roll, "extraDiceIgnoreLowest", (entry, entryPath) => { integer(entry, code, entryPath); }, p);
    string(roll.hook, code, `${p}.hook`, 256);
  }, path);
  optional(decision, "resume", (v, p) => validateResume(v, code, p), path);
}

function validateState(value: unknown, code: string): PersistedGameStateV1 {
  const path = "state";
  const required = ["seed", "rngState", "nextInstanceId", "nextModifierId", "turn", "activePlayer", "priorityPlayer", "phase", "players", "chain", "resolving", "pendingDecision", "pendingTokenCreations", "reactionPasses", "stack", "stackPasses", "stackResume", "modifiers", "pendingDestructions", "controlReturns", "log", "winner"] as const;
  const state = exact(value, code, path, required, ["gameStats", "globalCardIds", "extraTurnSeats", "delayedTriggers", "pendingTriggeredLayers", "nextLogSequence"]);
  for (const key of ["seed", "rngState", "nextInstanceId", "nextModifierId", "turn", "activePlayer", "priorityPlayer", "reactionPasses", "stackPasses"] as const) integer(state[key], code, `${path}.${key}`);
  optional(state, "globalCardIds", (value, valuePath) => {
    array(value, code, valuePath, 32).forEach((entry, index) => {
      string(entry, code, `${valuePath}[${index}]`, 256);
    });
  }, path);
  optional(state, "extraTurnSeats", (value, valuePath) => {
    const seats = array(value, code, valuePath, 64);
    seats.forEach((entry, index) => {
      const seat = integer(entry, code, `${valuePath}[${index}]`);
      if (seat !== 0 && seat !== 1) fail(code, `${valuePath}[${index}]`, "expected seat 0 or 1");
    });
  }, path);
  oneOf(state.phase, ["start", "action", "layer", "reaction", "defend", "end", "game-over"] as const, code, `${path}.phase`);
  const players = array(state.players, code, `${path}.players`, 2);
  if (players.length !== 2) fail(code, `${path}.players`, "expected exactly two players");
  validatePlayer(players[0], code, `${path}.players[0]`, 0);
  validatePlayer(players[1], code, `${path}.players[1]`, 1);
  array(state.chain, code, `${path}.chain`, 128).forEach((link, index) => validateChainLink(link, code, `${path}.chain[${index}]`));
  validateCards(state.resolving, code, `${path}.resolving`);
  if (state.pendingDecision !== null) validateDecision(state.pendingDecision, code, `${path}.pendingDecision`);
  validateStack(state.stack, code, `${path}.stack`);
  optional(state, "pendingTriggeredLayers", (value, valuePath) => {
    validateStack(value, code, valuePath);
  }, path);
  validateTokenCreationRequests(
    state.pendingTokenCreations,
    code,
    `${path}.pendingTokenCreations`,
  );
  if (state.stackResume !== null) oneOf(state.stackResume, ["begin-action", "begin-action-phase", "grant-turn-action", "end-action-phase", "start-attack-step", "continue-attack", "start-reaction-step", "finish-link-resolution", "end-phase"] as const, code, `${path}.stackResume`);
  array(state.modifiers, code, `${path}.modifiers`).forEach((modifier, index) => validateModifier(modifier, code, `${path}.modifiers[${index}]`));
  optional(state, "delayedTriggers", (value, valuePath) => {
    array(value, code, valuePath, 128).forEach((entryValue, index) => {
      const entryPath = `${valuePath}[${index}]`;
      const entry = exact(
        entryValue,
        code,
        entryPath,
        ["source", "seat", "subjectSeat", "event", "turn", "hook", "label"],
        ["labelMessage"],
      );
      validateCard(entry.source, code, `${entryPath}.source`);
      for (const key of ["seat", "subjectSeat", "turn"] as const) integer(entry[key], code, `${entryPath}.${key}`);
      oneOf(entry.event, ["start-of-turn", "end-of-turn"] as const, code, `${entryPath}.event`);
      string(entry.hook, code, `${entryPath}.hook`, 256);
      string(entry.label, code, `${entryPath}.label`, 512);
      optional(entry, "labelMessage", (message, messagePath) => {
        validateGameMessage(message, code, messagePath);
      }, entryPath);
    });
  }, path);
  array(state.pendingDestructions, code, `${path}.pendingDestructions`).forEach((entryValue, index) => {
    const entryPath = `${path}.pendingDestructions[${index}]`;
    const entry = exact(entryValue, code, entryPath, ["seat", "instanceId"]);
    integer(entry.seat, code, `${entryPath}.seat`); integer(entry.instanceId, code, `${entryPath}.instanceId`);
  });
  array(state.controlReturns, code, `${path}.controlReturns`).forEach((entryValue, index) => {
    const entryPath = `${path}.controlReturns[${index}]`;
    const entry = exact(entryValue, code, entryPath, ["instanceId", "thiefSeat", "homeSeat"]);
    for (const key of ["instanceId", "thiefSeat", "homeSeat"] as const) integer(entry[key], code, `${entryPath}.${key}`);
  });
  optional(state, "gameStats", (statsValue, statsPath) => {
    const stats = exact(statsValue, code, statsPath, ["turns"]);
    array(stats.turns, code, `${statsPath}.turns`, 10_000).forEach((turnValue, index) => {
      const turnPath = `${statsPath}.turns[${index}]`;
      const turn = exact(turnValue, code, turnPath, [
        "turn", "activePlayer", "attacks", "threatened", "blocked", "damageDealt",
      ], ["allyAbsorbed", "lifeGained", "lifeLost"]);
      integer(turn.turn, code, `${turnPath}.turn`);
      const activePlayer = integer(turn.activePlayer, code, `${turnPath}.activePlayer`);
      if (activePlayer !== 0 && activePlayer !== 1) fail(code, `${turnPath}.activePlayer`, "expected seat 0 or 1");
      for (const key of ["attacks", "threatened", "blocked", "damageDealt"] as const) {
        const values = array(turn[key], code, `${turnPath}.${key}`, 2);
        if (values.length !== 2) fail(code, `${turnPath}.${key}`, "expected two seat values");
        values.forEach((entry, seatIndex) => {
          const count = integer(entry, code, `${turnPath}.${key}[${seatIndex}]`);
          if (count < 0) fail(code, `${turnPath}.${key}[${seatIndex}]`, "expected a non-negative integer");
        });
      }
      for (const key of ["allyAbsorbed", "lifeGained", "lifeLost"] as const) {
        optional(turn, key, (value, valuePath) => {
          const values = array(value, code, valuePath, 2);
          if (values.length !== 2) fail(code, valuePath, "expected two seat values");
          values.forEach((entry, seatIndex) => {
            const count = integer(entry, code, `${valuePath}[${seatIndex}]`);
            if (count < 0) fail(code, `${valuePath}[${seatIndex}]`, "expected a non-negative integer");
          });
        }, turnPath);
      }
    });
  }, path);
  optional(state, "nextLogSequence", (value, valuePath) => {
    const sequence = integer(value, code, valuePath);
    if (sequence <= 0) fail(code, valuePath, "expected a positive safe integer");
  }, path);
  let greatestLogSequence = 0;
  let previousLogSequence = 0;
  array(state.log, code, `${path}.log`, MAX_LOG_ENTRIES).forEach((entryValue, index) => {
    const entryPath = `${path}.log[${index}]`;
    const entry = exact(
      entryValue,
      code,
      entryPath,
      ["publicText"],
      ["seatText", "sequence", "publicPayload", "seatPayloads"],
    );
    nullableString(entry.publicText, code, `${entryPath}.publicText`);
    optional(entry, "seatText", (v, p) => {
      const texts = array(v, code, p, 2);
      if (texts.length !== 2) fail(code, p, "expected two seat messages");
      nullableString(texts[0], code, `${p}[0]`); nullableString(texts[1], code, `${p}[1]`);
    }, entryPath);
    const hasStructuredPayload = entry.publicPayload !== undefined || entry.seatPayloads !== undefined;
    if (hasStructuredPayload && entry.sequence === undefined) {
      fail(code, `${entryPath}.sequence`, "structured log entries require a sequence");
    }
    if (!hasStructuredPayload && entry.sequence !== undefined) {
      fail(code, `${entryPath}.sequence`, "legacy log entries cannot have a sequence");
    }
    optional(entry, "sequence", (value, valuePath) => {
      const sequence = integer(value, code, valuePath);
      if (sequence <= 0) fail(code, valuePath, "expected a positive safe integer");
      if (sequence <= previousLogSequence) {
        fail(code, valuePath, "structured log sequences must be strictly increasing");
      }
      previousLogSequence = sequence;
      greatestLogSequence = Math.max(greatestLogSequence, sequence);
    }, entryPath);
    optional(entry, "publicPayload", (value, valuePath) => {
      validateGameLogPayload(value, code, valuePath);
      const payload = value as GameLogPayload;
      if (entry.publicText === null || payload.fallback !== entry.publicText) {
        fail(code, `${valuePath}.fallback`, "must match publicText");
      }
    }, entryPath);
    optional(entry, "seatPayloads", (value, valuePath) => {
      const payloads = array(value, code, valuePath, 2);
      if (payloads.length !== 2) fail(code, valuePath, "expected two seat payloads");
      if (payloads.every((payload) => payload === null)) {
        fail(code, valuePath, "expected at least one seat payload");
      }
      payloads.forEach((payload, seat) => {
        if (payload === null) return;
        const payloadPath = `${valuePath}[${seat}]`;
        validateGameLogPayload(payload, code, payloadPath);
        const seatTexts = entry.seatText as [string | null, string | null] | undefined;
        if (!seatTexts || seatTexts[seat] === null || (payload as GameLogPayload).fallback !== seatTexts[seat]) {
          fail(code, `${payloadPath}.fallback`, "must match seatText");
        }
      });
    }, entryPath);
  });
  if (greatestLogSequence > 0) {
    const nextLogSequence = state.nextLogSequence;
    if (typeof nextLogSequence !== "number" || nextLogSequence <= greatestLogSequence) {
      fail(code, `${path}.nextLogSequence`, "must be greater than every structured log sequence");
    }
  }
  if (!(state.winner === null || state.winner === 0 || state.winner === 1)) fail(code, `${path}.winner`, "expected null, 0, or 1");
  return state as unknown as PersistedGameStateV1;
}

export function decodeSerializedStateEnvelope(value: unknown, code: string): PersistedStateV1 {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail(code, "envelope", "state is not JSON serializable");
  }
  if (serialized.length > MAX_PERSISTED_STATE_BYTES) fail(code, "envelope", "state exceeds size limit");
  const candidate = object(value, code, "envelope");
  if (candidate.schemaVersion !== PERSISTED_STATE_VERSION) fail(code, "schemaVersion", "expected current schema version 1");
  const envelope = exact(candidate, code, "envelope", ["schemaVersion", "rulesetVersion", "state"]);
  string(envelope.rulesetVersion, code, "rulesetVersion", 256);
  return {
    schemaVersion: 1,
    rulesetVersion: envelope.rulesetVersion as string,
    state: validateState(envelope.state, code),
  };
}
