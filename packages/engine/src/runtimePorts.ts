import type { ScriptCtx, TokenCreationContext } from "./scripts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, ChainLinkState } from "./state.js";
import type { FlowStepName } from "./flowTypes.js";

export type ScriptCommandName =
  | "applyOneShotDefenseModifiers"
  | "arsenalCapacity"
  | "attackBonusAboveBase"
  | "attackFromDeck"
  | "attackHasDominate"
  | "attackHasOverpower"
  | "attackWithPermanent"
  | "banishCard"
  | "basePowerOf"
  | "boundArcaneCardBonus"
  | "chainLinkNumber"
  | "chainLinksControlled"
  | "compareLife"
  | "computeAttack"
  | "computeDefense"
  | "createTokenFor"
  | "createTokensFor"
  | "crowdBoo"
  | "crowdCheer"
  | "currentPowerOf"
  | "dealEffectDamage"
  | "destroyPermanent"
  | "discardToGraveyard"
  | "drawCards"
  | "effectDamageBonus"
  | "enterSoul"
  | "entersArena"
  | "fireLeaveArena"
  | "fireOnDiscard"
  | "fireTransformHook"
  | "gainHeroLife"
  | "hitsThisCombatChain"
  | "linkAttackHasType"
  | "moveToGraveyard"
  | "noteAttackDefendedBy"
  | "notePitch"
  | "pitchIntoPool"
  | "pitchProhibitedByEffect"
  | "pitchValueOfInstance"
  | "putCardOnDeckBottom"
  | "queueDefendEventLayersAfterCurrent"
  | "recordDieResult"
  | "recordDieRoll"
  | "removeFromOwnerZones"
  | "removeFromStackResolution"
  | "replaceAttackFromHand"
  | "replaceTemporalPowerGain"
  | "requestClash"
  | "resolveIntimidate"
  | "rollIgnoringLowest"
  | "scriptedPaymentOptions"
  | "setAttackActivationLimitKey"
  | "settlePlayedCard"
  | "settlesInArena"
  | "snapshotSerializable"
  | "stampControlledName"
  | "tapPermanent";

export type ScriptEventName =
  | "collectCardEventTriggerLayers"
  | "fireCardBanished"
  | "fireCardLeavesGraveyard"
  | "fireFriendlyAttackLost"
  | "fireFriendlyDestroyed"
  | "fireFriendlyEnterArena"
  | "fireHeroDealtDamage"
  | "fireOnFriendlyActivate"
  | "fireOnFriendlyCrank"
  | "fireOnFriendlyPlay"
  | "grantLinkGoAgain"
  | "notifyPlayerGainedGoAgain"
  | "queueTriggeredEvent"
  | "runHook";

type BoundRuntimeFunction = (...args: any[]) => any;

/** Stateless, process-local composition passed explicitly through engine flows. */
export interface EngineRuntime {
  readonly commands: Readonly<Record<ScriptCommandName, BoundRuntimeFunction>>;
  readonly events: Readonly<Record<ScriptEventName, BoundRuntimeFunction>>;
  dispatchFlow<T = any>(kind: FlowStepName, state: GameStateInternal, ...args: any[]): T;
  makeCtx(
    state: GameStateInternal,
    seat: number,
    self: CardInstance,
    link?: ChainLinkState,
    fromArsenal?: boolean,
    playTargetInstanceId?: number,
    leavingArenaAsActivationCost?: boolean,
    tokenCreationCause?: TokenCreationContext,
  ): ScriptCtx;
  makeCtxForTokenCreation(
    state: GameStateInternal,
    seat: number,
    self: CardInstance,
    link: ChainLinkState | undefined,
    cause: TokenCreationContext,
  ): ScriptCtx;
}
