import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { scriptOf } from "./cardProperties.js";
import { logPublic, nameOf } from "./gameLog.js";
import type { CardInstance, ChainLinkState, PlayerState, StackLayer } from "./state.js";

import { createTokenFor } from "./tokens.js";
import { currentLink, findCardAnywhere } from "./zoneQueries.js";
import { hookSources, lingeringModifierSources } from "./sourceQueries.js";

function completeWagerResult(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  wagerIndex: number,
): void {
  const wager = link.wagers?.[wagerIndex];
  if (!wager) return;
  const source = findCardAnywhere(state, wager.source.instanceId)?.card ?? wager.source;
  const proposedWinner = Number(link.flags[`wagerPendingWinner:${wagerIndex}`]);
  const replacementSourceId = Number(link.flags[`wagerReplacementSource:${wagerIndex}`]);
  const replacementSource = replacementSourceId
    ? findCardAnywhere(state, replacementSourceId)?.card
    : undefined;
  const override = Number(
    replacementSource?.counters?.wagerWinnerOverride ?? source.counters?.wagerWinnerOverride ?? 0,
  ) - 1;
  const winner = override >= 0 && state.players[override] ? override : proposedWinner;
  delete link.flags[`wagerPendingWinner:${wagerIndex}`];
  delete link.flags[`wagerReplacementSource:${wagerIndex}`];
  if (replacementSource?.counters) delete replacementSource.counters.wagerWinnerOverride;
  if (source.counters) delete source.counters.wagerWinnerOverride;

  logPublic(
    state,
    `${nameOf(state, (state.players[winner] as PlayerState).heroCardId)} wins the wager`,
  );
  // Winning a wager is its own event. Abilities such as Prizeworn
  // Pathfinders trigger now and resolve as separate layers after this wager
  // layer finishes; the winner may be either the attacker or defender.
  runtime.dispatchFlow("deferEventTriggers", state, "wager-won", winner, state.nextInstanceId, link.attackingCard);
  link.flags[`wagerWinner:${wagerIndex}`] = winner;
  link.flags[`wagerRewardCursor:${wagerIndex}`] = 0;
  continueWagerPrizes(state, runtime, wagerIndex);
}

/** Continue a wager's prize list after a token-replacement ordering choice. */
export function resumeWagerPrizes(state: GameStateInternal,
  runtime: EngineRuntime, wagerIndex: number): void {
  continueWagerPrizes(state, runtime, wagerIndex);
  const link = currentLink(state);
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume ??= {
      kind: "continue-stack",
      seat: link?.attacker ?? state.activePlayer,
    };
    return;
  }
  runtime.dispatchFlow("continueStack", state, link?.attacker ?? state.activePlayer);
}

function continueWagerPrizes(state: GameStateInternal,
  runtime: EngineRuntime, wagerIndex: number): void {
  const link = currentLink(state);
  const wager = link?.wagers?.[wagerIndex];
  if (!link || !wager) return;
  const source = findCardAnywhere(state, wager.source.instanceId)?.card ?? wager.source;
  const winner = Number(link.flags[`wagerWinner:${wagerIndex}`]);
  const winningPlayer = state.players[winner] as PlayerState | undefined;
  if (!winningPlayer) return;
  let cursor = Number(link.flags[`wagerRewardCursor:${wagerIndex}`] ?? 0);
  while (cursor < wager.rewardCardIds.length) {
    const cardId = wager.rewardCardIds[cursor]!;
    cursor++;
    link.flags[`wagerRewardCursor:${wagerIndex}`] = cursor;
    createTokenFor(state, runtime, winningPlayer, cardId, { kind: "wager", sourceCardId: source.cardId });
    if (state.pendingDecision?.chooseHook) {
      state.pendingDecision.resume = { kind: "continue-wager-prizes", wagerIndex };
      return;
    }
  }
  delete link.flags[`wagerWinner:${wagerIndex}`];
  delete link.flags[`wagerRewardCursor:${wagerIndex}`];
  scriptOf(state, source.cardId, source)?.onWagerResolved?.(
    runtime.makeCtxForTokenCreation(
      state,
      wager.controllerSeat,
      source,
      link,
      { kind: "wager", sourceCardId: source.cardId },
    ),
    winner,
  );
}

/** Continue a wager result after a replacement decision. */
export function resumeWagerResult(state: GameStateInternal,
  runtime: EngineRuntime, wagerIndex: number): void {
  const link = currentLink(state);
  if (!link) return;
  completeWagerResult(state, runtime, link, wagerIndex);
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume ??= { kind: "continue-stack", seat: link.attacker };
  } else {
    runtime.dispatchFlow("continueStack", state, link.attacker);
  }
}

function liveWagerLossReplacementSources(
  state: GameStateInternal,
  controllerSeat: number,
  sourceInstanceIds: readonly number[],
): CardInstance[] {
  return sourceInstanceIds.flatMap((instanceId) => {
    const found = findCardAnywhere(state, instanceId);
    if (
      !found ||
      found.seat !== controllerSeat ||
      !scriptOf(state, found.card.cardId, found.card)?.onFriendlyWagerLossReplacement
    ) return [];
    return [found.card];
  });
}

function applyWagerLossReplacement(
  state: GameStateInternal,
  runtime: EngineRuntime,
  wagerIndex: number,
  replacementSource: CardInstance,
  remainingSourceInstanceIds: number[],
): void {
  const link = currentLink(state);
  const wager = link?.wagers?.[wagerIndex];
  if (!link || !wager) return;
  const replacement = scriptOf(state, replacementSource.cardId, replacementSource)
    ?.onFriendlyWagerLossReplacement;
  if (!replacement) {
    continueWagerLossReplacements(state, runtime, wagerIndex, remainingSourceInstanceIds);
    return;
  }
  const handled = replacement(
    runtime.makeCtx(state, wager.controllerSeat, replacementSource, link),
  );
  if (!handled) {
    continueWagerLossReplacements(state, runtime, wagerIndex, remainingSourceInstanceIds);
    return;
  }
  link.flags[`wagerReplacementSource:${wagerIndex}`] = replacementSource.instanceId;
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume = {
      kind: "continue-wager-loss-replacements",
      wagerIndex,
      remainingSourceInstanceIds,
    };
    return;
  }
  completeWagerResult(state, runtime, link, wagerIndex);
}

function continueWagerLossReplacements(
  state: GameStateInternal,
  runtime: EngineRuntime,
  wagerIndex: number,
  remainingSourceInstanceIds: number[],
): void {
  const link = currentLink(state);
  const wager = link?.wagers?.[wagerIndex];
  if (!link || !wager) return;
  const sources = liveWagerLossReplacementSources(
    state,
    wager.controllerSeat,
    remainingSourceInstanceIds,
  );
  if (sources.length === 0) {
    completeWagerResult(state, runtime, link, wagerIndex);
    return;
  }
  if (sources.length > 1) {
    const sourceIds = sources.map((source) => source.instanceId);
    state.pendingDecision = {
      player: wager.controllerSeat,
      kind: "choose-target",
      prompt: "Choose the next wager-loss replacement to apply",
      options: sourceIds.map(String),
      optionLabels: sources.map((source) => nameOf(state, source.cardId)),
      cardOptions: sourceIds,
      chooseHook: "engine-wager-loss-replacement-order",
      wagerLossReplacementOrder: {
        wagerIndex,
        remainingSourceInstanceIds: sourceIds,
      },
      resume: { kind: "continue-stack", seat: link.attacker },
    };
    return;
  }
  const replacementSource = sources[0]!;
  applyWagerLossReplacement(
    state, runtime,
    wagerIndex,
    replacementSource,
    remainingSourceInstanceIds.filter(
      (instanceId) => instanceId !== replacementSource.instanceId,
    ),
  );
}

export function answerWagerLossReplacementOrder(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pending = state.pendingDecision;
  const batch = pending?.wagerLossReplacementOrder;
  if (
    !pending ||
    pending.player !== seat ||
    pending.chooseHook !== "engine-wager-loss-replacement-order" ||
    !batch
  ) return "not your decision";
  const selectedId = Number(optionId);
  if (
    !Number.isSafeInteger(selectedId) ||
    !batch.remainingSourceInstanceIds.includes(selectedId)
  ) return "invalid replacement";
  const link = currentLink(state);
  const wager = link?.wagers?.[batch.wagerIndex];
  const selected = wager
    ? liveWagerLossReplacementSources(state, wager.controllerSeat, [selectedId])[0]
    : undefined;
  if (!selected) return "replacement source no longer exists";
  state.pendingDecision = null;
  applyWagerLossReplacement(
    state, runtime,
    batch.wagerIndex,
    selected,
    batch.remainingSourceInstanceIds.filter((instanceId) => instanceId !== selectedId),
  );
  return undefined;
}

/** Continue after a chosen wager-loss replacement's optional effect resolves. */
export function resumeWagerLossReplacements(
  state: GameStateInternal,
  runtime: EngineRuntime,
  wagerIndex: number,
  remainingSourceInstanceIds: number[],
): void {
  const link = currentLink(state);
  if (!link) return;
  const replacementSourceId = Number(link.flags[`wagerReplacementSource:${wagerIndex}`]);
  const replacementSource = replacementSourceId
    ? findCardAnywhere(state, replacementSourceId)?.card
    : undefined;
  const winnerOverride = Number(replacementSource?.counters?.wagerWinnerOverride ?? 0);
  if (winnerOverride > 0) {
    completeWagerResult(state, runtime, link, wagerIndex);
  } else {
    delete link.flags[`wagerReplacementSource:${wagerIndex}`];
    continueWagerLossReplacements(state, runtime, wagerIndex, remainingSourceInstanceIds);
  }
  if (state.pendingDecision?.chooseHook) {
    state.pendingDecision.resume ??= { kind: "continue-stack", seat: link.attacker };
  } else {
    runtime.dispatchFlow("continueStack", state, link.attacker);
  }
}

/** Resolve one wager after the chain link's hit result is known (CR 8.5.46). */
export function resolveWagerLayer(state: GameStateInternal,
  runtime: EngineRuntime, layer: StackLayer): void {
  const link = currentLink(state);
  const effect = layer.engineEffect;
  if (!link || effect?.kind !== "wager-result") {
    logPublic(state, "A wager resolves without effect (the chain link is gone)");
    return;
  }
  const wager = link.wagers?.[effect.wagerIndex];
  if (!wager) {
    logPublic(state, "A wager resolves without effect (its wager is gone)");
    return;
  }
  const winner = link.hit ? wager.controllerSeat : wager.opposingSeat;
  link.flags[`wagerPendingWinner:${effect.wagerIndex}`] = winner;
  if (winner !== wager.controllerSeat) {
    const activeSources = hookSources(state, wager.controllerSeat, {
      board: true,
      arsenal: true,
      equipment: true,
      weapons: true,
    });
    const replacementSourceIds = [
      ...activeSources,
      ...lingeringModifierSources(state, wager.controllerSeat).filter((candidate) =>
        !activeSources.some((active) => active.instanceId === candidate.instanceId),
      ),
    ].filter((source) =>
      scriptOf(state, source.cardId, source)?.onFriendlyWagerLossReplacement
    ).map((source) => source.instanceId);
    continueWagerLossReplacements(state, runtime, effect.wagerIndex, replacementSourceIds);
    return;
  }
  completeWagerResult(state, runtime, link, effect.wagerIndex);
}
