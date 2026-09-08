import type { FaiDefenseTrace } from "./fai-aggro-defense.js";
import {
  FAI_AGGRO_MEMORY_SCHEMA_VERSION,
  initialFaiAggroMemoryState,
  type FaiAggroLastObservationV1,
  type FaiAggroMemoryStateV1,
} from "./fai-aggro-model.js";
import type { MidDefenseTrace } from "./fai-midrange-defense.js";
import {
  MIDRANGE_VERSION,
  type MidResourceOrigin,
} from "./fai-midrange-model.js";

export const FAI_POLICY_STATE_SCHEMA_VERSION = 1;
const MAX_TRACKED_INSTANCE_IDS = 128;

export interface FaiAggroPolicyStateV1 {
  schemaVersion: typeof FAI_POLICY_STATE_SCHEMA_VERSION;
  strategy: "aggro";
  memory: FaiAggroMemoryStateV1;
  stagedDefense?: {
    turn: number;
    ids: number[];
    trace: FaiDefenseTrace;
  };
}

export interface FaiMidrangeResourceOriginV1 {
  resources: number;
  tiger: number;
  chestInstanceId?: number;
  pitchIds: number[];
  potionIds: number[];
}

export interface FaiMidrangePolicyStateV1 {
  schemaVersion: typeof FAI_POLICY_STATE_SCHEMA_VERSION;
  strategy: "midrange";
  strategyVersion: typeof MIDRANGE_VERSION;
  turn: number;
  origin?: FaiMidrangeResourceOriginV1;
  reservedId?: number;
  supportedFireIds: number[];
  observedHandIds: number[];
  stagedDefense?: {
    ids: number[];
    trace: MidDefenseTrace;
  };
}

export type FaiPolicyStateV1 = FaiAggroPolicyStateV1 | FaiMidrangePolicyStateV1;

export function initialFaiAggroPolicyState(): FaiAggroPolicyStateV1 {
  return {
    schemaVersion: FAI_POLICY_STATE_SCHEMA_VERSION,
    strategy: "aggro",
    memory: initialFaiAggroMemoryState(),
  };
}

export function initialFaiMidrangePolicyState(): FaiMidrangePolicyStateV1 {
  return {
    schemaVersion: FAI_POLICY_STATE_SCHEMA_VERSION,
    strategy: "midrange",
    strategyVersion: MIDRANGE_VERSION,
    turn: -1,
    supportedFireIds: [],
    observedHandIds: [],
  };
}

export function encodeMidrangeResourceOrigin(
  origin: MidResourceOrigin,
): FaiMidrangeResourceOriginV1 {
  return {
    resources: origin.resources,
    tiger: origin.tiger,
    ...(origin.chest === undefined ? {} : { chestInstanceId: origin.chest }),
    pitchIds: [...origin.pitch].sort((left, right) => left - right),
    potionIds: [...origin.potions].sort((left, right) => left - right),
  };
}

export function decodeMidrangeResourceOrigin(
  origin: FaiMidrangeResourceOriginV1,
): MidResourceOrigin {
  return {
    resources: origin.resources,
    tiger: origin.tiger,
    ...(origin.chestInstanceId === undefined ? {} : { chest: origin.chestInstanceId }),
    pitch: new Set(origin.pitchIds),
    potions: new Set(origin.potionIds),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function instanceIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_TRACKED_INSTANCE_IDS ||
    !value.every((id) => safeInteger(id, 1))) return undefined;
  const ids = value.map(Number);
  return new Set(ids).size === ids.length ? ids : undefined;
}

function decodePlayedCandidate(
  value: unknown,
): FaiAggroLastObservationV1["playedCandidate"] | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(candidate, ["instanceId", "role"]) ||
    !safeInteger(candidate.instanceId, 1) ||
    !(candidate.role === "starter" || candidate.role === "extender" || candidate.role === "ender")) {
    return undefined;
  }
  return { instanceId: candidate.instanceId, role: candidate.role };
}

function decodeAggroLastObservation(value: unknown): FaiAggroLastObservationV1 | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(
    candidate,
    ["turn", "hoodPrompt", "handIds"],
    ["hoodChoiceId", "playedCandidate"],
  )) return undefined;
  const handIds = instanceIds(candidate.handIds);
  const playedCandidate = candidate.playedCandidate === undefined
    ? undefined
    : decodePlayedCandidate(candidate.playedCandidate);
  if (!safeInteger(candidate.turn) || typeof candidate.hoodPrompt !== "boolean" || !handIds ||
    !(candidate.hoodChoiceId === undefined || safeInteger(candidate.hoodChoiceId, 1)) ||
    (candidate.playedCandidate !== undefined && !playedCandidate)) return undefined;
  return {
    turn: candidate.turn,
    hoodPrompt: candidate.hoodPrompt,
    handIds,
    ...(candidate.hoodChoiceId === undefined ? {} : { hoodChoiceId: candidate.hoodChoiceId }),
    ...(playedCandidate ? { playedCandidate } : {}),
  };
}

function decodeAggroMemory(value: unknown): FaiAggroMemoryStateV1 | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(
    candidate,
    [
      "schemaVersion",
      "turn",
      "startedWithArsenal",
      "turn1",
      "initialCardCount",
      "originalStarters",
      "originalEnders",
      "realIds",
      "playedIds",
      "playedStarterIds",
      "playedEnderIds",
      "hoodSwap",
    ],
    ["reservedId", "lastObservation"],
  )) return undefined;
  const realIds = instanceIds(candidate.realIds);
  const playedIds = instanceIds(candidate.playedIds);
  const playedStarterIds = instanceIds(candidate.playedStarterIds);
  const playedEnderIds = instanceIds(candidate.playedEnderIds);
  const hoodSwap = instanceIds(candidate.hoodSwap);
  const lastObservation = candidate.lastObservation === undefined
    ? undefined
    : decodeAggroLastObservation(candidate.lastObservation);
  if (candidate.schemaVersion !== FAI_AGGRO_MEMORY_SCHEMA_VERSION ||
    !safeInteger(candidate.turn, -1) || typeof candidate.startedWithArsenal !== "boolean" ||
    typeof candidate.turn1 !== "boolean" || !safeInteger(candidate.initialCardCount) ||
    !safeInteger(candidate.originalStarters) || !safeInteger(candidate.originalEnders) ||
    !realIds || !playedIds || !playedStarterIds || !playedEnderIds || !hoodSwap ||
    !(candidate.reservedId === undefined || safeInteger(candidate.reservedId, 1)) ||
    (candidate.lastObservation !== undefined && !lastObservation)) return undefined;
  const real = new Set(realIds);
  const played = new Set(playedIds);
  if (playedIds.some((id) => !real.has(id)) ||
    playedStarterIds.some((id) => !played.has(id)) ||
    playedEnderIds.some((id) => !played.has(id))) return undefined;
  return {
    schemaVersion: FAI_AGGRO_MEMORY_SCHEMA_VERSION,
    turn: candidate.turn,
    startedWithArsenal: candidate.startedWithArsenal,
    turn1: candidate.turn1,
    initialCardCount: candidate.initialCardCount,
    originalStarters: candidate.originalStarters,
    originalEnders: candidate.originalEnders,
    realIds,
    playedIds,
    playedStarterIds,
    playedEnderIds,
    hoodSwap,
    ...(candidate.reservedId === undefined ? {} : { reservedId: candidate.reservedId }),
    ...(lastObservation ? { lastObservation } : {}),
  };
}

function decodeAggroDefenseTrace(value: unknown): FaiDefenseTrace | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(candidate, [
    "rule",
    "incoming",
    "defense",
    "onHitValue",
    "retainedDamage",
    "marginalLoss",
    "complete",
  ]) || typeof candidate.rule !== "string" || candidate.rule.length > 256 ||
    !finiteNumber(candidate.incoming) || !finiteNumber(candidate.defense) ||
    !finiteNumber(candidate.onHitValue) || !finiteNumber(candidate.retainedDamage) ||
    !finiteNumber(candidate.marginalLoss) || typeof candidate.complete !== "boolean") {
    return undefined;
  }
  return {
    rule: candidate.rule,
    incoming: candidate.incoming,
    defense: candidate.defense,
    onHitValue: candidate.onHitValue,
    retainedDamage: candidate.retainedDamage,
    marginalLoss: candidate.marginalLoss,
    complete: candidate.complete,
  };
}

function decodeAggroStagedDefense(
  value: unknown,
): FaiAggroPolicyStateV1["stagedDefense"] | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(candidate, ["turn", "ids", "trace"]) ||
    !safeInteger(candidate.turn)) return undefined;
  const ids = instanceIds(candidate.ids);
  const trace = decodeAggroDefenseTrace(candidate.trace);
  return ids && trace ? { turn: candidate.turn, ids, trace } : undefined;
}

export function decodeFaiAggroPolicyState(value: unknown): FaiAggroPolicyStateV1 | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(
    candidate,
    ["schemaVersion", "strategy", "memory"],
    ["stagedDefense"],
  )) return undefined;
  const memory = decodeAggroMemory(candidate.memory);
  const stagedDefense = candidate.stagedDefense === undefined
    ? undefined
    : decodeAggroStagedDefense(candidate.stagedDefense);
  if (candidate.schemaVersion !== FAI_POLICY_STATE_SCHEMA_VERSION ||
    candidate.strategy !== "aggro" || !memory ||
    (candidate.stagedDefense !== undefined && !stagedDefense)) return undefined;
  return {
    schemaVersion: FAI_POLICY_STATE_SCHEMA_VERSION,
    strategy: "aggro",
    memory,
    ...(stagedDefense ? { stagedDefense } : {}),
  };
}

function decodeOrigin(value: unknown): FaiMidrangeResourceOriginV1 | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(
    candidate,
    ["resources", "tiger", "pitchIds", "potionIds"],
    ["chestInstanceId"],
  )) return undefined;
  const pitchIds = instanceIds(candidate.pitchIds);
  const potionIds = instanceIds(candidate.potionIds);
  if (!safeInteger(candidate.resources) || !safeInteger(candidate.tiger) ||
    !pitchIds || !potionIds ||
    !(candidate.chestInstanceId === undefined || safeInteger(candidate.chestInstanceId, 1))) {
    return undefined;
  }
  return {
    resources: candidate.resources,
    tiger: candidate.tiger,
    ...(candidate.chestInstanceId === undefined
      ? {}
      : { chestInstanceId: candidate.chestInstanceId }),
    pitchIds,
    potionIds,
  };
}

function decodeDefenseTrace(value: unknown): MidDefenseTrace | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(
    candidate,
    ["incoming", "defense", "handIds", "lifeAfter", "retainedDamage", "netValue", "complete"],
    ["protectedId", "replacedEnderId"],
  )) return undefined;
  const handIds = instanceIds(candidate.handIds);
  if (!finiteNumber(candidate.incoming) || !finiteNumber(candidate.defense) || !handIds ||
    !finiteNumber(candidate.lifeAfter) || !finiteNumber(candidate.retainedDamage) ||
    !finiteNumber(candidate.netValue) || typeof candidate.complete !== "boolean" ||
    !(candidate.protectedId === undefined || safeInteger(candidate.protectedId, 1)) ||
    !(candidate.replacedEnderId === undefined || safeInteger(candidate.replacedEnderId, 1))) {
    return undefined;
  }
  return {
    incoming: candidate.incoming,
    defense: candidate.defense,
    handIds,
    ...(candidate.protectedId === undefined ? {} : { protectedId: candidate.protectedId }),
    ...(candidate.replacedEnderId === undefined
      ? {}
      : { replacedEnderId: candidate.replacedEnderId }),
    lifeAfter: candidate.lifeAfter,
    retainedDamage: candidate.retainedDamage,
    netValue: candidate.netValue,
    complete: candidate.complete,
  };
}

function decodeStagedDefense(
  value: unknown,
): FaiMidrangePolicyStateV1["stagedDefense"] | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(candidate, ["ids", "trace"])) return undefined;
  const ids = instanceIds(candidate.ids);
  const trace = decodeDefenseTrace(candidate.trace);
  return ids && trace ? { ids, trace } : undefined;
}

/** Exact decoder for policy state crossing a process or persistence boundary. */
export function decodeFaiMidrangePolicyState(
  value: unknown,
): FaiMidrangePolicyStateV1 | undefined {
  const candidate = record(value);
  if (!candidate || !exactKeys(
    candidate,
    [
      "schemaVersion",
      "strategy",
      "strategyVersion",
      "turn",
      "supportedFireIds",
      "observedHandIds",
    ],
    ["origin", "reservedId", "stagedDefense"],
  )) return undefined;
  const supportedFireIds = instanceIds(candidate.supportedFireIds);
  const observedHandIds = instanceIds(candidate.observedHandIds);
  const origin = candidate.origin === undefined ? undefined : decodeOrigin(candidate.origin);
  const stagedDefense = candidate.stagedDefense === undefined
    ? undefined
    : decodeStagedDefense(candidate.stagedDefense);
  if (candidate.schemaVersion !== FAI_POLICY_STATE_SCHEMA_VERSION ||
    candidate.strategy !== "midrange" || candidate.strategyVersion !== MIDRANGE_VERSION ||
    !safeInteger(candidate.turn, -1) || !supportedFireIds || !observedHandIds ||
    (candidate.origin !== undefined && !origin) ||
    !(candidate.reservedId === undefined || safeInteger(candidate.reservedId, 1)) ||
    (candidate.stagedDefense !== undefined && !stagedDefense)) return undefined;
  return {
    schemaVersion: FAI_POLICY_STATE_SCHEMA_VERSION,
    strategy: "midrange",
    strategyVersion: MIDRANGE_VERSION,
    turn: candidate.turn,
    ...(origin ? { origin } : {}),
    ...(candidate.reservedId === undefined ? {} : { reservedId: candidate.reservedId }),
    supportedFireIds,
    observedHandIds,
    ...(stagedDefense ? { stagedDefense } : {}),
  };
}

export function decodeFaiPolicyState(value: unknown): FaiPolicyStateV1 | undefined {
  const candidate = record(value);
  if (candidate?.strategy === "aggro") return decodeFaiAggroPolicyState(value);
  if (candidate?.strategy === "midrange") return decodeFaiMidrangePolicyState(value);
  return undefined;
}
