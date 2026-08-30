import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardScript, ScriptCtx } from "./scripts.js";
import type { CardInstance, PlayerState } from "./state.js";
import { isChiCard } from "./cardProperties.js";
import { nameOf } from "./gameLog.js";
import { removeFromArray } from "./zoneQueries.js";
import { notePitch, payFromPools, pitchIntoPool, pitchProhibitedByEffect, pitchValueOfInstance, scriptedPaymentOptions } from "./resources.js";

interface VariableResourceCost {
  base: number;
  resourcesPerX?: number;
  minimum?: number;
  maximum?: number;
  canDeclareX?(x: number): boolean;
}

type VariablePlayCost = NonNullable<CardScript["variablePlayCost"]>;
type ResolvedVariablePlayCost = Omit<VariablePlayCost, "maximum" | "canDeclareX"> &
  VariableResourceCost;

type VariableResourceChoice = { x: number; cost: number };

const MAX_ENUMERATED_X = 127;

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.floor(value));
}

function resourcesPerX(cost: VariableResourceCost): number {
  return Math.max(1, Math.floor(cost.resourcesPerX ?? 1));
}

export function variableResourceCost(cost: VariableResourceCost, x: number): number {
  return cost.base + x * resourcesPerX(cost);
}

export function resolveVariablePlayCost(
  variableCost: VariablePlayCost,
  ctx: ScriptCtx,
): ResolvedVariablePlayCost {
  return {
    ...variableCost,
    maximum: typeof variableCost.maximum === "function"
      ? variableCost.maximum(ctx)
      : variableCost.maximum,
    canDeclareX: variableCost.canDeclareX
      ? (x: number) => variableCost.canDeclareX!(ctx, x)
      : undefined,
  };
}

export function variableResourceChoices(
  state: GameStateInternal,
  player: PlayerState,
  sourceInstanceId: number,
  variableCost: VariableResourceCost,
  costForBase: (baseCost: number) => number,
): Record<string, VariableResourceChoice> {
  const minimum = Math.min(
    MAX_ENUMERATED_X,
    nonNegativeInteger(variableCost.minimum ?? 0),
  );
  const maximum = Math.min(
    MAX_ENUMERATED_X,
    nonNegativeInteger(variableCost.maximum ?? MAX_ENUMERATED_X),
  );
  const choices: Record<string, VariableResourceChoice> = {};
  for (let x = minimum; x <= maximum; x++) {
    if (variableCost.canDeclareX && !variableCost.canDeclareX(x)) continue;
    const cost = costForBase(variableResourceCost(variableCost, x));
    const payments = scriptedPaymentOptions(state, player, cost, `x:${x}`, [sourceInstanceId]);
    if (Object.keys(payments).length === 0) break;
    choices[`X = ${x}`] = { x, cost };
  }
  return choices;
}

export function isValidVariableX(
  declaredX: number | undefined,
  variableCost: VariableResourceCost,
): declaredX is number {
  const minimum = nonNegativeInteger(variableCost.minimum ?? 0);
  const maximum = Math.floor(variableCost.maximum ?? MAX_ENUMERATED_X);
  return (
    declaredX !== undefined &&
    Number.isSafeInteger(declaredX) &&
    declaredX >= minimum &&
    declaredX <= maximum &&
    (!variableCost.canDeclareX || variableCost.canDeclareX(declaredX))
  );
}

/**
 * Validate and pay a resource cost with chosen pitch cards.
 * Returns an error string, or undefined on success (resources deducted, cards pitched).
 *
 * Chi (CR 1.13.5 / 1.14.2c/d): pitching a chi-subtype card grants chi points
 * instead of resource points; chi points pay resource costs and must be spent
 * before resource points. `opts.chiCost` adds a chi point cost ({c}): only chi
 * points may pay it, so while paying a chi cost only chi-subtype cards may be
 * pitched. The no-overpitch rule applies to the combined chi+resources pool.
 */
export function payCost(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  cost: number,
  pitchInstanceIds: number[],
  excludeInstanceId?: number,
  opts?: { chiCost?: number; beforePitch?: () => void },
): string | undefined {
  const chiCost = opts?.chiCost ?? 0;
  const total = cost + chiCost;
  const pitchCards: CardInstance[] = [];
  let pitchedChi = 0;
  for (const id of new Set(pitchInstanceIds)) {
    const c = player.hand.find((x) => x.instanceId === id);
    if (!c) return `pitch card ${id} not in hand`;
    if (c.instanceId === excludeInstanceId) return "cannot pitch the card being played";
    const value = pitchValueOfInstance(state, c);
    if (!value) return `${nameOf(state, c.cardId)} has no pitch value`;
    if (pitchProhibitedByEffect(state, player, c)) return "that card cannot be pitched this turn";
    if (chiCost > 0 && !isChiCard(state, c)) {
      return `only cards that gain chi can be pitched for a chi cost`;
    }
    if (isChiCard(state, c)) pitchedChi += value;
    pitchCards.push(c);
  }
  // the chi part of a cost can only be paid with chi points
  if (player.chi + pitchedChi < chiCost) {
    return `not enough chi (need ${chiCost}, have ${player.chi + pitchedChi})`;
  }
  // no overpitching: you may not pitch another card once the cost is already covered
  let running = player.resources + player.chi;
  for (const c of pitchCards) {
    if (running >= total) {
      return `overpitch: ${nameOf(state, c.cardId)} is not needed to pay a cost of ${total}`;
    }
    running += pitchValueOfInstance(state, c);
  }
  if (running < total) return `not enough resources (need ${total}, have ${running})`;
  opts?.beforePitch?.();
  commitPitchCards(state, runtime, player, pitchCards);
  if (chiCost > 0) player.chi -= chiCost;
  payFromPools(player, cost);
  return undefined;
}

/** Move already-validated pitch cards from hand to pitch zone and resource pool. */
function commitPitchCards(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  pitchCards: CardInstance[],
): void {
  for (const c of pitchCards) {
    removeFromArray(player.hand, c.instanceId);
    player.pitch.push(c);
    notePitch(state, player, c);
    pitchIntoPool(state, runtime, player, c, pitchValueOfInstance(state, c));
  }
}
