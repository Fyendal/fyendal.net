import type { EngineRuntime } from "./runtimePorts.js";
import { scriptOf } from "./cardProperties.js";
import { hookSources, lingeringModifierSources } from "./sourceQueries.js";
import { gameLogMessage, logPublic } from "./gameLog.js";
import { rngInt } from "./rng.js";
import type { GameStateInternal } from "./runtimeState.js";

import type { PlayerState } from "./state.js";
import { destroyPermanent } from "./zoneMoves.js";
import { currentLink, findCardAnywhere, findPermanent } from "./zoneQueries.js";

export function recordDieResult(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState, result: number): void {
  player.flags.rolledDieThisTurn = true;
  player.flags[`rolledDie:${result}`] = true;
  for (let threshold = 1; threshold <= result; threshold++) {
    player.flags[`rolledDieAtLeast:${threshold}`] = true;
  }
  const active = hookSources(state, player.seat, { board: true, equipment: true, weapons: true });
  const observers = [...active, ...lingeringModifierSources(state, player.seat).filter(
    (candidate) => !active.some((source) => source.instanceId === candidate.instanceId),
  )];
  for (const source of observers) {
    scriptOf(state, source.cardId, source)?.onFriendlyDieRollResult?.(
      runtime.makeCtx(state, player.seat, source, currentLink(state)),
      result,
    );
  }
}

export function rollIgnoringLowest(
  state: GameStateInternal,
  sides: number,
  extraDiceIgnoreLowest = 0,
): number {
  const rolls = Array.from(
    { length: 1 + Math.max(0, extraDiceIgnoreLowest) },
    () => rngInt(state, sides) + 1,
  ).sort((a, b) => a - b);
  return rolls[Math.min(extraDiceIgnoreLowest, rolls.length - 1)] ?? 0;
}

export function recordDieRoll(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState, sides: number): number {
  const result = rollIgnoringLowest(state, sides);
  recordDieResult(state, runtime, player, result);
  return result;
}

export function answerDieRollReplacement(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  const roll = pd?.dieRoll;
  if (!pd || pd.player !== seat || pd.chooseHook !== "engine-die-roll-replacement" || !roll) {
    return "not a die-roll replacement decision";
  }
  if (optionId !== "keep" && optionId !== "reroll") return "invalid die-roll choice";
  let result = roll.result;
  if (optionId === "reroll") {
    const replacement = findPermanent(state, roll.replacementInstanceId);
    if (!replacement) return "die-roll replacement is no longer active";
    destroyPermanent(state, runtime, replacement.seat, replacement.card);
    result = rollIgnoringLowest(state, roll.sides, roll.extraDiceIgnoreLowest ?? 0);
    const rollingPlayer = state.players[roll.rollingSeat] as PlayerState;
    recordDieResult(state, runtime, rollingPlayer, result);
    logPublic(state, gameLogMessage(
      `the die is rerolled: ${result}`,
      "engine.log.die.rerolled",
      { result },
      { kind: "roll", result, seat: rollingPlayer.seat, sides: roll.sides },
    ));
  } else {
    recordDieResult(state, runtime, state.players[roll.rollingSeat] as PlayerState, result);
  }
  state.pendingDecision = null;
  const source = findCardAnywhere(state, roll.rollingSourceInstanceId);
  if (source) {
    scriptOf(state, source.card.cardId, source.card)?.onDieRollResolved?.(
      runtime.makeCtx(state, source.seat, source.card, currentLink(state)),
      roll.hook,
      result,
    );
  }
  return undefined;
}
