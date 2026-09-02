import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { dataOf, scriptOf } from "./cardProperties.js";
import {
  gameLogMessage,
  logCardValue,
  logPlayerValue,
  logPublic,
  nameOf,
} from "./gameLog.js";
import type { TokenCreationContext } from "./scripts.js";
import type { CardInstance, PlayerState, TokenCreationRequest, TokenCreationReplacementRef } from "./state.js";
import { currentLink, findCardAnywhere } from "./zoneQueries.js";
import { controlledPermanents, hookSources, lingeringModifierSources } from "./sourceQueries.js";

import { offerCrankDecision, stampControlledName, stampEnteringLife } from "./cardLifecycle.js";

/** Create a token/aura on a player's board without applying creation-count replacements. */
function createTokenRaw(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  cardId: string,
): CardInstance {
  const token: CardInstance = {
    instanceId: state.nextInstanceId++,
    cardId,
    owner: player.seat,
  };
  stampEnteringLife(state, token);
  player.board.push(token);
  stampControlledName(state, player, token);
  // "if you've created a card this turn" tracking (per-turn flags, auto-wiped)
  player.flags.createdThisTurn = (Number(player.flags.createdThisTurn) || 0) + 1;
  const createdName = nameOf(state, cardId).trim().toLowerCase().replace(/\s+/g, " ");
  player.flags[`createdName:${createdName}`] = true;
  player.flags[`createdNameCount:${createdName}`] =
    (Number(player.flags[`createdNameCount:${createdName}`]) || 0) + 1;
  for (const subtype of dataOf(state, cardId).subtypes ?? []) {
    player.flags[`createdSubtype:${subtype.toLowerCase()}`] = true;
    player.flags[`createdSubtypeCount:${subtype.toLowerCase()}`] =
      (Number(player.flags[`createdSubtypeCount:${subtype.toLowerCase()}`]) || 0) + 1;
  }
  logPublic(state, gameLogMessage(
    `${nameOf(state, player.heroCardId)} creates ${nameOf(state, cardId)}`,
    "engine.log.token.created",
    {
      player: logPlayerValue(player.seat),
      card: logCardValue(cardId),
    },
  ));
  runtime.events.runHook(state, player.seat, token, "onEnterArena");
  for (const source of hookSources(state, player.seat, {
    board: true,
    arsenal: true,
    equipment: true,
    weapons: true,
  })) {
    if (source.instanceId === token.instanceId) continue;
    scriptOf(state, source.cardId, source)?.onFriendlyTokenCreated?.(
      runtime.makeCtx(state, player.seat, source, currentLink(state)),
      token,
    );
  }
  if (!offerCrankDecision(state, runtime, player, token, true)) {
    runtime.events.fireFriendlyEnterArena(state, player.seat, token);
  }
  return token;
}

/** Complete one token event and then notify "one or more" observers once. */
function createTokenBatchRaw(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  cardId: string,
  count: number,
): CardInstance[] {
  const maxTriggerSourceId = state.nextInstanceId;
  const data = dataOf(state, cardId);
  const unique = (data.keywords ?? []).some((keyword) => keyword.trim().toLowerCase() === "unique");
  const alreadyControlled = unique && player.board.some((card) =>
    nameOf(state, card.cardId).trim().toLowerCase() === data.name.trim().toLowerCase()
  );
  const allowedCount = unique ? (alreadyControlled ? 0 : Math.min(1, count)) : count;
  const tokens = Array.from({ length: allowedCount }, () => createTokenRaw(state, runtime, player, cardId));
  if (tokens.length === 0) return tokens;
  runtime.events.queueTriggeredEvent(
    state,
    "token-created",
    player.seat,
    tokens[0],
    { tokenCount: tokens.length },
    maxTriggerSourceId,
  );
  return tokens;
}

type ApplicableTokenCreationReplacement = {
  ref: TokenCreationReplacementRef;
  controllerSeat: number;
  label: string;
  next?: number;
};

function replacementRefId(ref: TokenCreationReplacementRef): string {
  return `${ref.kind}:${ref.instanceId}`;
}

/** Stable snapshot of every replacement effect that may apply to this batch. */
function tokenCreationReplacementRefs(
  state: GameStateInternal,
  player: PlayerState,
): TokenCreationReplacementRef[] {
  const refs: TokenCreationReplacementRef[] = [];
  const seen = new Set<string>();
  const push = (ref: TokenCreationReplacementRef): void => {
    const key = replacementRefId(ref);
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  };
  for (const player of state.players) {
    const active = controlledPermanents(state, player.seat, { faceDownEquipment: false });
    for (const source of [
      ...active,
      ...lingeringModifierSources(state, player.seat).filter((candidate) =>
        !active.some((permanent) => permanent.instanceId === candidate.instanceId),
      ),
    ]) {
      if (scriptOf(state, source.cardId, source)?.globalTokenCreationReplacement) {
        push({ instanceId: source.instanceId, kind: "global" });
      }
    }
  }
  const friendlyActive = controlledPermanents(state, player.seat, { faceDownEquipment: false });
  for (const source of [
    ...friendlyActive,
    ...lingeringModifierSources(state, player.seat).filter((candidate) =>
      !friendlyActive.some((permanent) => permanent.instanceId === candidate.instanceId)
    ),
  ]) {
    const script = scriptOf(state, source.cardId, source);
    if (script?.replaceFriendlyTokenCreation) {
      push({ instanceId: source.instanceId, kind: "friendly" });
    }
    if (script?.optionalFriendlyTokenCreationReplacement) {
      push({ instanceId: source.instanceId, kind: "optional-friendly" });
    }
  }
  for (const source of player.graveyard.filter((card) => !card.faceDown)) {
    const replacement = scriptOf(state, source.cardId, source)?.optionalFriendlyTokenCreationReplacement;
    if (replacement?.sourceZone === "graveyard") {
      push({ instanceId: source.instanceId, kind: "optional-friendly" });
    }
  }
  return refs;
}

function applicableTokenCreationReplacements(
  state: GameStateInternal,
  runtime: EngineRuntime,
  creatingSeat: number,
  cardId: string,
  count: number,
  cause: TokenCreationContext,
  refs: TokenCreationReplacementRef[],
): ApplicableTokenCreationReplacement[] {
  const normalizedCount = Math.max(0, Math.floor(count));
  return refs.flatMap((ref) => {
    const found = findCardAnywhere(state, ref.instanceId);
    if (!found) return [];
    const script = scriptOf(state, found.card.cardId, found.card);
    const ctx = runtime.makeCtx(state, found.seat, found.card, currentLink(state));
    if (ref.kind === "global") {
      const replacement = script?.globalTokenCreationReplacement;
      const next = replacement?.replace(ctx, creatingSeat, cardId, normalizedCount, cause);
      if (replacement && next !== undefined) {
        return [{
          ref,
          controllerSeat: found.seat,
          label: replacement.label,
          next: Math.max(0, Math.floor(next)),
        }];
      }
      return [];
    }
    if (found.seat !== creatingSeat) return [];
    if (ref.kind === "friendly") {
      const replacement = script?.replaceFriendlyTokenCreation;
      const next = replacement?.(ctx, cardId, normalizedCount);
      const normalizedNext = next === undefined ? undefined : Math.max(0, Math.floor(next));
      return normalizedNext === undefined || normalizedNext === normalizedCount
        ? []
        : [{
            ref,
            controllerSeat: found.seat,
            label: `${nameOf(state, found.card.cardId)} changes the number created`,
            next: normalizedNext,
          }];
    }
    const optional = script?.optionalFriendlyTokenCreationReplacement;
    if (
      optional?.sourceZone === "graveyard" &&
      !state.players[found.seat]?.graveyard.some((card) => card.instanceId === found.card.instanceId)
    ) return [];
    return normalizedCount > 0 && optional?.condition(ctx, cardId, normalizedCount)
      ? [{ ref, controllerSeat: found.seat, label: optional.label }]
      : [];
  });
}

function continueTokenCreation(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  cardId: string,
  count: number,
  cause: TokenCreationContext,
  remainingReplacements: TokenCreationReplacementRef[],
  controllerSeats?: number[],
): CardInstance[] {
  const normalizedCount = Math.max(0, Math.floor(count));
  // An instruction to create zero tokens does not produce an event, so no
  // later replacement can make that event exist again (CR 1.9.1b).
  if (normalizedCount === 0) return [];
  const applicable = applicableTokenCreationReplacements(
    state, runtime,
    player.seat,
    cardId,
    normalizedCount,
    cause,
    remainingReplacements,
  );
  if (applicable.length === 0) {
    return createTokenBatchRaw(state, runtime, player, cardId, normalizedCount);
  }

  let orderedControllers = controllerSeats?.filter((controllerSeat) =>
    applicable.some((candidate) => candidate.controllerSeat === controllerSeat)
  );
  if (!orderedControllers) {
    const applicableControllers = [...new Set(applicable.map((candidate) => candidate.controllerSeat))];
    if (applicableControllers.length > 1) {
      state.pendingDecision = {
        player: state.activePlayer,
        kind: "choose-target",
        prompt: "Choose which player's token replacements apply first",
        promptMessage: { id: "engine.decision.token.playerorder" },
        options: applicableControllers.map(String),
        optionLabels: applicableControllers.map((controllerSeat) =>
          nameOf(state, (state.players[controllerSeat] as PlayerState).heroCardId)
        ),
        chooseHook: "engine-token-replacement-player-order",
        tokenCreationReplacementOrder: {
          seat: player.seat,
          cardId,
          count: normalizedCount,
          cause,
          remainingReplacements,
        },
      };
      return [];
    }
    orderedControllers = applicableControllers;
  }

  const currentController = orderedControllers[0];
  if (currentController === undefined) {
    return createTokenBatchRaw(state, runtime, player, cardId, normalizedCount);
  }
  const controlledApplicable = applicable.filter(
    (candidate) => candidate.controllerSeat === currentController,
  );
  if (controlledApplicable.length > 1) {
    state.pendingDecision = {
      player: currentController,
      kind: "choose-target",
      prompt: "Choose the next token creation replacement to apply",
      promptMessage: { id: "engine.decision.token.next" },
      options: controlledApplicable.map(({ ref }) => replacementRefId(ref)),
      optionLabels: controlledApplicable.map(({ label }) => label),
      cardOptions: controlledApplicable.map(({ ref }) => ref.instanceId),
      chooseHook: "engine-token-replacement-order",
      tokenCreationReplacementOrder: {
        seat: player.seat,
        cardId,
        count: normalizedCount,
        cause,
        remainingReplacements,
        controllerSeats: orderedControllers,
      },
    };
    return [];
  }
  const chosen = controlledApplicable[0]!;
  const remaining = remainingReplacements.filter(
    (ref) => replacementRefId(ref) !== replacementRefId(chosen.ref),
  );
  if (chosen.ref.kind === "optional-friendly") {
    const source = findCardAnywhere(state, chosen.ref.instanceId);
    state.pendingDecision = {
      player: player.seat,
      kind: "optional-effect",
      prompt: chosen.label,
      promptMessage: source
        ? {
            id: "engine.decision.token.optional.card",
            values: { card: { kind: "card", cardId: source.card.cardId } },
          }
        : { id: "engine.decision.token.optional" },
      options: ["yes", "no"],
      optionMessages: [{ id: "common.option.yes" }, { id: "common.option.no" }],
      sourceInstanceId: chosen.ref.instanceId,
      chooseHook: "engine-token-creation-replacement",
      tokenCreationReplacement: {
        seat: player.seat,
        cardId,
        count: normalizedCount,
        cause,
        remainingReplacements: remaining,
        controllerSeats: orderedControllers,
      },
    };
    return [];
  }
  return continueTokenCreation(
    state, runtime,
    player,
    cardId,
    chosen.next ?? normalizedCount,
    cause,
    remaining,
    orderedControllers,
  );
}

/** Start one token event after any earlier suspended event has completed. */
function beginTokenCreation(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  cardId: string,
  count: number,
  cause: TokenCreationContext = { kind: "effect" },
): CardInstance[] {
  const tokenData = dataOf(state, cardId);
  const auraTokensProhibited =
    tokenData.cardType === "token" &&
    (tokenData.subtypes ?? []).includes("aura") &&
    state.players.some((candidate) => controlledPermanents(state, candidate.seat, {
      faceDownEquipment: false,
    }).some((source) => scriptOf(state, source.cardId, source)?.prohibitsAuraTokenCreation === true));
  if (
    tokenData.cardType === "token" &&
    (tokenData.subtypes ?? []).includes("aura") &&
    (auraTokensProhibited || Number(player.hero.counters?.auraTokenCreationLockedUntilTurn ?? 0) === state.turn)
  ) {
    logPublic(state, `${nameOf(state, player.heroCardId)} can't create aura tokens this turn`);
    return [];
  }
  return continueTokenCreation(
    state, runtime,
    player,
    cardId,
    count,
    cause,
    tokenCreationReplacementRefs(state, player),
  );
}

/** Resolve token reprints to one deterministic printing per functional card.
 * Card identity remains data-driven: the engine does not know any token name
 * or printing ID. */
function canonicalTokenCardId(state: GameStateInternal, requestedCardId: string): string {
  const requested = dataOf(state, requestedCardId);
  if (requested.cardType !== "token") return requestedCardId;
  const normalizedName = requested.name.trim().toLowerCase().replace(/\s+/g, " ");
  const pitch = requested.pitch ?? 0;
  for (const candidate of Object.values(state.cardsRef)) {
    if (
      candidate.cardType === "token" &&
      (candidate.pitch ?? 0) === pitch &&
      candidate.name.trim().toLowerCase().replace(/\s+/g, " ") === normalizedName
    ) {
      return candidate.id;
    }
  }
  return requested.id;
}

/** Create one token batch, applying each live count replacement once. If an
 * earlier command has already suspended the resolving effect, preserve this
 * event for the same continuation instead of overwriting its decision. */
export function createTokensFor(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  cardId: string,
  count: number,
  cause: TokenCreationContext = { kind: "effect" },
): CardInstance[] {
  const canonicalCardId = canonicalTokenCardId(state, cardId);
  const pendingHook = state.pendingDecision?.chooseHook;
  if (
    pendingHook === "engine-token-creation-replacement" ||
    pendingHook === "engine-token-replacement-player-order" ||
    pendingHook === "engine-token-replacement-order"
  ) {
    state.pendingTokenCreations.push({
      seat: player.seat,
      cardId: canonicalCardId,
      count,
      cause,
    });
    return [];
  }
  return beginTokenCreation(state, runtime, player, canonicalCardId, count, cause);
}

/** Resume token events emitted after the command that opened the decision.
 * Stop as soon as another event suspends; the next answer resumes the queue. */
export function resumePendingTokenCreations(state: GameStateInternal, runtime: EngineRuntime): void {
  const queue = state.pendingTokenCreations;
  while (!state.pendingDecision?.chooseHook && queue.length > 0) {
    const request = queue.shift() as TokenCreationRequest;
    const player = state.players[request.seat] as PlayerState | undefined;
    if (!player) continue;
    beginTokenCreation(
      state, runtime,
      player,
      request.cardId,
      request.count,
      request.cause,
    );
  }
}

export function answerTokenReplacementOrder(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pending = state.pendingDecision;
  const batch = pending?.tokenCreationReplacementOrder;
  if (!pending || pending.player !== seat || pending.chooseHook !== "engine-token-replacement-order" || !batch) {
    return "not your decision";
  }
  const ref = batch.remainingReplacements.find(
    (candidate) => replacementRefId(candidate) === optionId,
  );
  if (!ref) return "invalid replacement";
  const applicable = applicableTokenCreationReplacements(
    state, runtime,
    batch.seat,
    batch.cardId,
    batch.count,
    batch.cause,
    batch.remainingReplacements,
  );
  const chosen = applicable.find((candidate) => replacementRefId(candidate.ref) === optionId);
  if (!chosen || batch.controllerSeats?.[0] !== chosen.controllerSeat) {
    return "replacement source no longer exists";
  }
  state.pendingDecision = null;
  const player = state.players[batch.seat] as PlayerState | undefined;
  if (!player) return "token recipient no longer exists";
  const remaining = batch.remainingReplacements.filter(
    (candidate) => replacementRefId(candidate) !== optionId,
  );
  if (chosen.ref.kind === "optional-friendly") {
    const source = findCardAnywhere(state, chosen.ref.instanceId);
    state.pendingDecision = {
      player: batch.seat,
      kind: "optional-effect",
      prompt: chosen.label,
      promptMessage: source
        ? {
            id: "engine.decision.token.optional.card",
            values: { card: { kind: "card", cardId: source.card.cardId } },
          }
        : { id: "engine.decision.token.optional" },
      options: ["yes", "no"],
      optionMessages: [{ id: "common.option.yes" }, { id: "common.option.no" }],
      sourceInstanceId: chosen.ref.instanceId,
      chooseHook: "engine-token-creation-replacement",
      tokenCreationReplacement: {
        seat: batch.seat,
        cardId: batch.cardId,
        count: batch.count,
        cause: batch.cause,
        remainingReplacements: remaining,
        controllerSeats: batch.controllerSeats,
      },
    };
    return undefined;
  }
  continueTokenCreation(
    state, runtime,
    player,
    batch.cardId,
    chosen.next ?? batch.count,
    batch.cause,
    remaining,
    batch.controllerSeats,
  );
  return undefined;
}

export function answerTokenReplacementPlayerOrder(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pending = state.pendingDecision;
  const batch = pending?.tokenCreationReplacementOrder;
  if (
    !pending ||
    pending.player !== seat ||
    pending.chooseHook !== "engine-token-replacement-player-order" ||
    !batch
  ) return "not your decision";
  const firstController = Number(optionId);
  if (!Number.isSafeInteger(firstController) || !state.players[firstController]) {
    return "invalid replacement controller";
  }
  const applicableControllers = [...new Set(applicableTokenCreationReplacements(
    state, runtime,
    batch.seat,
    batch.cardId,
    batch.count,
    batch.cause,
    batch.remainingReplacements,
  ).map((candidate) => candidate.controllerSeat))];
  if (!applicableControllers.includes(firstController)) return "invalid replacement controller";
  const controllerSeats = Array.from(
    { length: state.players.length },
    (_, offset) => (firstController + offset) % state.players.length,
  ).filter((controllerSeat) => applicableControllers.includes(controllerSeat));
  state.pendingDecision = null;
  const player = state.players[batch.seat] as PlayerState | undefined;
  if (!player) return "token recipient no longer exists";
  continueTokenCreation(
    state, runtime,
    player,
    batch.cardId,
    batch.count,
    batch.cause,
    batch.remainingReplacements,
    controllerSeats,
  );
  return undefined;
}

/** Resolve an optional token-batch replacement. */
export function answerTokenCreationReplacement(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pending = state.pendingDecision;
  const batch = pending?.tokenCreationReplacement;
  if (
    !pending ||
    pending.player !== seat ||
    pending.chooseHook !== "engine-token-creation-replacement" ||
    !batch
  ) return "not your decision";
  if (optionId !== "yes" && optionId !== "no") return "invalid option";
  const sourceInstanceId = pending.sourceInstanceId;
  state.pendingDecision = null;
  if (optionId === "yes") {
    const found = sourceInstanceId === undefined
      ? undefined
      : findCardAnywhere(state, sourceInstanceId);
    const replacement = found
      ? scriptOf(state, found.card.cardId, found.card)?.optionalFriendlyTokenCreationReplacement
      : undefined;
    const sourceIsFunctional = found && replacement && (
      replacement.sourceZone !== "graveyard" ||
      state.players[found.seat]?.graveyard.some((card) => card.instanceId === found.card.instanceId)
    );
    if (sourceIsFunctional) {
      replacement.effect(runtime.makeCtx(state, found.seat, found.card, currentLink(state)));
    }
    return undefined;
  }
  const player = state.players[batch.seat] as PlayerState | undefined;
  if (!player) return "token recipient no longer exists";
  continueTokenCreation(
    state, runtime,
    player,
    batch.cardId,
    batch.count,
    batch.cause,
    batch.remainingReplacements,
    batch.controllerSeats,
  );
  return undefined;
}

/** Create a single-token event. */
export function createTokenFor(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  cardId: string,
  cause: TokenCreationContext = { kind: "effect" },
): CardInstance | undefined {
  return createTokensFor(state, runtime, player, cardId, 1, cause)[0];
}
