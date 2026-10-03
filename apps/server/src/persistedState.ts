import type { CardInstance, GameState, Modifier } from "@fyendal/engine";
import type { GameLogEvent, GameLogPayload, GameMessage } from "@fyendal/shared";

import type {
  PersistedCardInstanceV1, PersistedStackLayerV1, PersistedDelayedTriggerV1,
  PersistedPlayerV1, PersistedChainLinkV1, PersistedWagerV1,
  PersistedCombatValueModifierV1, PersistedModifierV1, PersistedPendingArcaneV1,
  PersistedDecisionResumeV1, PersistedPendingDecisionV1, PersistedGameLogEntryV1,
  PersistedGameTurnStatsV1, PersistedGameStatsV1, PersistedGameStateV1,
  BotSimulationSnapshotV1,
} from "@fyendal/shared";
export type {
  PersistedCardInstanceV1, PersistedStackLayerV1, PersistedDelayedTriggerV1,
  PersistedPlayerV1, PersistedChainLinkV1, PersistedWagerV1,
  PersistedCombatValueModifierV1, PersistedModifierV1, PersistedPendingArcaneV1,
  PersistedDecisionResumeV1, PersistedPendingDecisionV1, PersistedGameLogEntryV1,
  PersistedGameTurnStatsV1, PersistedGameStatsV1, PersistedGameStateV1,
} from "@fyendal/shared";
import { decodeSerializedStateEnvelope, CorruptRoomError } from "@fyendal/protocol";
export { CorruptRoomError, PERSISTED_STATE_VERSION, MAX_PERSISTED_STATE_BYTES } from "@fyendal/protocol";
type JsonObject = Record<string, unknown>;
type Seat = 0 | 1;
type FlagValue = number | boolean;

export interface PersistedStateV1 extends BotSimulationSnapshotV1 {}
function fail(code: string, path: string, detail: string): never { throw new CorruptRoomError(code, path, detail); }
type SameKeys<Left, Right> =
  Exclude<keyof Left, keyof Right> extends never
    ? Exclude<keyof Right, keyof Left> extends never
      ? true
      : false
    : false;
// Mutual assignability catches changed field types, while SameKeys remains
// necessary because TypeScript permits extra optional properties structurally.
type SameShape<Left, Right> =
  [Left] extends [Right]
    ? [Right] extends [Left]
      ? true
      : false
    : false;
type Assert<T extends true> = T;
type EnginePendingDecision = NonNullable<GameState["pendingDecision"]>;
type PersistedEngineDecision = Omit<
  EnginePendingDecision,
  | "optionCards"
  | "revealedCards"
  | "lookedCards"
  | "stagedCards"
  | "stagedHandCount"
  | "stagedDefense"
  | "preStackSource"
>;
type PersistedEngineState = Omit<
  GameState,
  "cardsRef" | "scriptsRef" | "globalCardIds" | "extraTurnSeats" | "gameStats" | "delayedTriggers"
> & Partial<Pick<GameState, "globalCardIds" | "extraTurnSeats" | "gameStats" | "delayedTriggers">>;

// Persistence is deliberately hand-written, but its object boundaries must
// stay exhaustive as the engine grows. These assertions make a newly added
// runtime field or field-type change a typecheck failure until its DTO is
// updated; the card and modifier assertions below also cover decoder key lists.
type _CardKeysAreExhaustive = Assert<SameKeys<CardInstance, PersistedCardInstanceV1>>;
type _CardShapeIsCompatible = Assert<SameShape<CardInstance, PersistedCardInstanceV1>>;
type _PlayerKeysAreExhaustive = Assert<SameKeys<GameState["players"][number], PersistedPlayerV1>>;
type _PlayerShapeIsCompatible = Assert<
  SameShape<GameState["players"][number], PersistedPlayerV1>
>;
type _ChainKeysAreExhaustive = Assert<SameKeys<GameState["chain"][number], PersistedChainLinkV1>>;
type _ChainShapeIsCompatible = Assert<
  SameShape<GameState["chain"][number], PersistedChainLinkV1>
>;
type _DelayedTriggerKeysAreExhaustive = Assert<
  SameKeys<GameState["delayedTriggers"][number], PersistedDelayedTriggerV1>
>;
type _DelayedTriggerShapeIsCompatible = Assert<
  SameShape<GameState["delayedTriggers"][number], PersistedDelayedTriggerV1>
>;
type _StackKeysAreExhaustive = Assert<SameKeys<GameState["stack"][number], PersistedStackLayerV1>>;
type _StackShapeIsCompatible = Assert<
  SameShape<GameState["stack"][number], PersistedStackLayerV1>
>;
type _ModifierKeysAreExhaustive = Assert<SameKeys<Modifier, PersistedModifierV1>>;
type _ModifierShapeIsCompatible = Assert<SameShape<Modifier, PersistedModifierV1>>;
type _ArcaneKeysAreExhaustive = Assert<
  SameKeys<NonNullable<EnginePendingDecision["arcane"]>, PersistedPendingArcaneV1>
>;
type _ArcaneShapeIsCompatible = Assert<
  SameShape<NonNullable<EnginePendingDecision["arcane"]>, PersistedPendingArcaneV1>
>;
type _DecisionKeysAreExhaustive = Assert<
  SameKeys<PersistedEngineDecision, PersistedPendingDecisionV1>
>;
type _DecisionShapeIsCompatible = Assert<
  SameShape<PersistedEngineDecision, PersistedPendingDecisionV1>
>;
type _StateKeysAreExhaustive = Assert<
  SameKeys<Omit<GameState, "cardsRef" | "scriptsRef">, PersistedGameStateV1>
>;
type _StateShapeIsCompatible = Assert<
  SameShape<PersistedEngineState, PersistedGameStateV1>
>;

/**
 * A short-lived engine build carried the translated "pay N" option messages
 * from an Arcane Barrier amount choice into its subsequent card-pitch choice.
 * Those messages are presentation-only and do not correspond to the card
 * options. Drop only that known stale metadata before exhaustive validation so
 * rooms committed by that build remain recoverable.
 */
function repairArcaneBarrierPitchOptionMessages(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const envelope = value as JsonObject;
  const state = envelope.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return value;
  const pendingDecision = (state as JsonObject).pendingDecision;
  if (
    !pendingDecision ||
    typeof pendingDecision !== "object" ||
    Array.isArray(pendingDecision)
  ) return value;
  const decision = pendingDecision as JsonObject;
  const staleMessages = decision.optionMessages;
  if (
    decision.chooseHook !== "arcane-barrier-pitch" ||
    !Array.isArray(staleMessages) ||
    staleMessages.length < 2 ||
    !staleMessages.every((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return false;
      const messageObject = message as JsonObject;
      const values = messageObject.values;
      if (
        Object.keys(messageObject).length !== 2 ||
        messageObject.id !== "common.option.pay" ||
        !values ||
        typeof values !== "object" ||
        Array.isArray(values)
      ) return false;
      const valueObject = values as JsonObject;
      return Object.keys(valueObject).length === 1 &&
        Number.isSafeInteger(valueObject.amount) &&
        Number(valueObject.amount) >= 0;
    })
  ) return value;

  const { optionMessages: _staleOptionMessages, ...repairedDecision } = decision;
  return {
    ...envelope,
    state: {
      ...(state as JsonObject),
      pendingDecision: repairedDecision,
    },
  };
}

/** Validate unknown persisted JSON exhaustively before restoring registries. */
export function decodePersistedState(
  value: unknown,
  code: string,
  cardsRef: GameState["cardsRef"],
  scriptsRef: GameState["scriptsRef"],
  expectedRulesetVersion?: string,
): GameState {
  const envelope = decodeSerializedStateEnvelope(repairArcaneBarrierPitchOptionMessages(value), code);
  if (expectedRulesetVersion !== undefined && envelope.rulesetVersion !== expectedRulesetVersion) {
    fail(code, "rulesetVersion", "room belongs to another ruleset");
  }
  return {
    ...envelope.state,
    globalCardIds: envelope.state.globalCardIds ?? [],
    extraTurnSeats: envelope.state.extraTurnSeats ?? [],
    delayedTriggers: envelope.state.delayedTriggers ?? [],
    pendingTriggeredLayers: envelope.state.pendingTriggeredLayers ?? [],
    pendingTokenCreations: envelope.state.pendingTokenCreations,
    gameStats: envelope.state.gameStats ?? { turns: [] },
    cardsRef,
    scriptsRef,
  } as unknown as GameState;
}

export function encodePersistedState(state: GameState, rulesetVersion = "test-ruleset"): PersistedStateV1 {
  const persisted: PersistedGameStateV1 = {
    seed: state.seed,
    rngState: state.rngState,
    nextInstanceId: state.nextInstanceId,
    nextModifierId: state.nextModifierId,
    globalCardIds: state.globalCardIds,
    turn: state.turn,
    activePlayer: state.activePlayer,
    priorityPlayer: state.priorityPlayer,
    phase: state.phase,
    players: state.players,
    chain: state.chain,
    resolving: state.resolving,
    pendingDecision: state.pendingDecision,
    reactionPasses: state.reactionPasses,
    stack: state.stack,
    pendingTriggeredLayers: state.pendingTriggeredLayers ?? [],
    pendingTokenCreations: state.pendingTokenCreations,
    stackPasses: state.stackPasses,
    stackResume: state.stackResume,
    modifiers: state.modifiers,
    delayedTriggers: state.delayedTriggers,
    pendingDestructions: state.pendingDestructions,
    controlReturns: state.controlReturns,
    extraTurnSeats: state.extraTurnSeats,
    gameStats: state.gameStats,
    ...(state.nextLogSequence === undefined ? {} : { nextLogSequence: state.nextLogSequence }),
    log: state.log,
    winner: state.winner,
    ...(state.drawOfferSeat === undefined ? {} : { drawOfferSeat: state.drawOfferSeat }),
  };
  return { schemaVersion: 1, rulesetVersion, state: persisted };
}
