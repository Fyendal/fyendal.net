import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { cardHasName, dataOf, scriptOf } from "./cardProperties.js";
import { basePowerOf } from "./combatValues.js";
import { logPublic, nameOf } from "./gameLog.js";
import type { CardInstance, PendingDecisionState, PlayerState } from "./state.js";
import { currentLink, findCardAnywhere, opponent } from "./zoneQueries.js";
import { destroyPermanent } from "./zoneMoves.js";
import { controlledPermanents } from "./sourceQueries.js";

import { heroAbilitiesDisabled } from "./stateQueries.js";
import { transitionZone } from "./transitions.js";

// ── crowd / clash / life comparison (Super Slam mechanics) ─────────────────

/** The crowd boos a hero: sets their per-turn `booedThisTurn` flag and fires
 *  their hero's onBooed hook. Booing has no other material effect on its own. */
export function crowdBoo(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): void {
  const p = state.players[seat] as PlayerState;
  p.flags.booedThisTurn = true;
  logPublic(state, `The crowd boos ${nameOf(state, p.heroCardId)}`);
  runtime.events.runHook(state, seat, p.hero, "onBooed");
}

/** The crowd cheers a hero: sets their per-turn `cheeredThisTurn` flag and
 *  fires their hero's onCheered hook. */
export function crowdCheer(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): void {
  const p = state.players[seat] as PlayerState;
  p.flags.cheeredThisTurn = true;
  logPublic(state, `The crowd cheers ${nameOf(state, p.heroCardId)}`);
  runtime.events.runHook(state, seat, p.hero, "onCheered");
}

type ClashState = NonNullable<PendingDecisionState["clash"]>;
type ClashRequest = ClashState["request"];
type ClashAttempt = ClashState["attempt"];

/** Reveal and compare for one clash attempt without announcing a result. The
 * split lets a replacement effect replace the would-be result while keeping
 * both revealed cards on top until its decision is complete. */
function revealClash(state: GameStateInternal,
  runtime: EngineRuntime, aSeat: number, bSeat: number): ClashAttempt {
  const a = state.players[aSeat] as PlayerState;
  const b = state.players[bSeat] as PlayerState;
  const topA = a.deck[0];
  const topB = b.deck[0];
  const powA = topA ? basePowerOf(state, runtime, aSeat, topA, dataOf(state, topA.cardId).attack ?? 0) : -1;
  const powB = topB ? basePowerOf(state, runtime, bSeat, topB, dataOf(state, topB.cardId).attack ?? 0) : -1;
  if (topA) logPublic(state, `${nameOf(state, a.heroCardId)} reveals ${nameOf(state, topA.cardId)} (${powA} power)`);
  if (topB) logPublic(state, `${nameOf(state, b.heroCardId)} reveals ${nameOf(state, topB.cardId)} (${powB} power)`);
  let winner = powA === powB ? -1 : powA > powB ? aSeat : bSeat;
  for (const [seat, card] of [[aSeat, topA], [bSeat, topB]] as const) {
    if (!card || winner === seat) continue;
    const replacement = scriptOf(state, card.cardId, card)?.failedClashBecomesWin;
    if (!replacement) continue;
    winner = seat;
    if (replacement.booController) crowdBoo(state, runtime, seat);
    break;
  }
  return {
    winner,
    revealed: [
      ...(topA ? [{ seat: aSeat, instanceId: topA.instanceId }] : []),
      ...(topB ? [{ seat: bSeat, instanceId: topB.instanceId }] : []),
    ],
  };
}

function finishClashAttempt(
  state: GameStateInternal,
  runtime: EngineRuntime,
  request: ClashRequest,
  attempt: ClashAttempt,
): void {
  if (attempt.winner < 0) {
    logPublic(state, "The clash is a tie — no winner");
  } else {
    logPublic(state, `${nameOf(state, (state.players[attempt.winner] as PlayerState).heroCardId)} wins the clash`);
  }
  for (const revealed of attempt.revealed) {
    const found = findCardAnywhere(state, revealed.instanceId);
    if (!found) continue;
    const opposingSeat = revealed.seat === request.sourceSeat
      ? request.opposingSeat
      : request.sourceSeat;
    scriptOf(state, found.card.cardId, found.card)?.onClashRevealed?.(
      runtime.makeCtx(state, revealed.seat, found.card),
      attempt.winner === revealed.seat,
      opposingSeat,
    );
  }
  const source = findCardAnywhere(state, request.sourceInstanceId);
  if (source) {
    scriptOf(state, source.card.cardId, source.card)?.onClashResult?.(
      runtime.makeCtx(state, request.sourceSeat, source.card, currentLink(state)),
      request.resultHook,
      attempt.winner,
    );
  }
}

function namedClashCostPermanents(
  state: GameStateInternal,
  seat: number,
  name: string,
): CardInstance[] {
  return controlledPermanents(state, seat, { faceDownEquipment: false }).filter(
    (card) => !card.faceDown && cardHasName(state, card, name),
  );
}

function offerNextClashReplacement(state: GameStateInternal, clashState: ClashState): boolean {
  while (clashState.replacementIndex < clashState.replacementSeats.length) {
    const seat = clashState.replacementSeats[clashState.replacementIndex] as number;
    const player = state.players[seat] as PlayerState;
    const replacement = scriptOf(state, player.hero.cardId, player.hero)?.firstFailedClashReplacement;
    const costs = replacement
      ? namedClashCostPermanents(state, seat, replacement.costPermanentName)
      : [];
    if (!replacement || costs.length === 0 || clashState.attempt.revealed.length === 0) {
      clashState.replacementIndex += 1;
      continue;
    }
    clashState.stage = "offer";
    delete clashState.chosenReplacementSeat;
    state.pendingDecision = {
      player: seat,
      kind: "optional-effect",
      prompt: `${nameOf(state, player.heroCardId)}: destroy a ${replacement.costPermanentName} to put a revealed card on the bottom of its owner's deck and clash again?`,
      options: ["no", ...costs.map((card) => String(card.instanceId))],
      cardOptions: [null, ...costs.map((card) => card.instanceId)],
      sourceInstanceId: clashState.request.sourceInstanceId,
      chooseHook: replacement.choiceHook,
      clash: clashState,
    };
    return true;
  }
  return false;
}

function completeClashAndContinue(state: GameStateInternal,
  runtime: EngineRuntime, clashState: ClashState): void {
  finishClashAttempt(state, runtime, clashState.request, clashState.attempt);
  const next = clashState.queue.shift();
  if (next) resolveClashRequest(state, runtime, next, clashState.queue);
}

function finishClashOrOfferWinnerChoice(
  state: GameStateInternal,
  runtime: EngineRuntime,
  clashState: ClashState,
): void {
  if (clashState.attempt.winner >= 0) {
    completeClashAndContinue(state, runtime, clashState);
    return;
  }
  const participants = [clashState.request.sourceSeat, clashState.request.opposingSeat];
  const chooser = [state.activePlayer, opponent(state.activePlayer)].find((seat) => {
    if (!participants.includes(seat) || heroAbilitiesDisabled(state, seat)) return false;
    const player = state.players[seat] as PlayerState;
    return scriptOf(state, player.hero.cardId, player.hero)?.choosesFailedClashWinner === true;
  });
  if (chooser === undefined) {
    completeClashAndContinue(state, runtime, clashState);
    return;
  }
  const heroes = participants.map((seat) => (state.players[seat] as PlayerState).hero);
  clashState.stage = "winner-choice";
  state.pendingDecision = {
    player: chooser,
    kind: "choose-target",
    prompt: `${nameOf(state, (state.players[chooser] as PlayerState).heroCardId)}: choose which hero wins the clash`,
    options: heroes.map((hero) => String(hero.instanceId)),
    cardOptions: heroes.map((hero) => hero.instanceId),
    sourceInstanceId: clashState.request.sourceInstanceId,
    chooseHook: "engine-clash-winner",
    clash: clashState,
  };
}

function resolveClashRequest(
  state: GameStateInternal,
  runtime: EngineRuntime,
  request: ClashRequest,
  queue: ClashRequest[] = [],
): void {
  const attempt = revealClash(state, runtime, request.sourceSeat, request.opposingSeat);
  const orderedSeats = [state.activePlayer, state.activePlayer === 0 ? 1 : 0]
    .filter((seat) => seat === request.sourceSeat || seat === request.opposingSeat);
  const replacementSeats: number[] = [];
  for (const seat of orderedSeats) {
    if (attempt.winner === seat) continue;
    const player = state.players[seat] as PlayerState;
    const replacement = !heroAbilitiesDisabled(state, seat)
      ? scriptOf(state, player.hero.cardId, player.hero)?.firstFailedClashReplacement
      : undefined;
    if (!replacement) continue;
    const flag = `firstFailedClashReplacement:${player.hero.instanceId}`;
    if (player.flags[flag] === true) continue;
    player.flags[flag] = true;
    replacementSeats.push(seat);
  }
  const clashState: ClashState = {
    request,
    attempt,
    replacementSeats,
    replacementIndex: 0,
    stage: "offer",
    queue,
  };
  if (!offerNextClashReplacement(state, clashState)) finishClashOrOfferWinnerChoice(state, runtime, clashState);
}

/** Begin a resumable clash owned by a card-script result hook. */
export function requestClash(
  state: GameStateInternal,
  runtime: EngineRuntime,
  sourceSeat: number,
  opposingSeat: number,
  sourceInstanceId: number,
  resultHook: string,
): void {
  const request = { sourceSeat, sourceInstanceId, opposingSeat, resultHook };
  const pendingClash = state.pendingDecision?.clash;
  if (pendingClash) {
    pendingClash.queue.push(request);
    return;
  }
  resolveClashRequest(state, runtime, request);
}

/** Answer either step of an engine-owned failed-clash replacement. */
export function answerClashDecision(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  const clashState = pd?.clash;
  if (!pd || !clashState || pd.player !== seat || !pd.options?.includes(optionId)) {
    return "invalid clash replacement choice";
  }
  state.pendingDecision = null;
  if (clashState.stage === "winner-choice") {
    const winner = state.players.find((player) => player.hero.instanceId === Number(optionId))?.seat;
    if (winner === undefined || (
      winner !== clashState.request.sourceSeat && winner !== clashState.request.opposingSeat
    )) return "chosen hero is not participating in the clash";
    clashState.attempt.winner = winner;
    completeClashAndContinue(state, runtime, clashState);
    return undefined;
  }
  if (clashState.stage === "offer") {
    if (optionId === "no") {
      clashState.replacementIndex += 1;
      if (!offerNextClashReplacement(state, clashState)) finishClashOrOfferWinnerChoice(state, runtime, clashState);
      return undefined;
    }
    const replacementSeat = clashState.replacementSeats[clashState.replacementIndex];
    const player = replacementSeat === undefined
      ? undefined
      : state.players[replacementSeat] as PlayerState;
    const replacement = player
      ? scriptOf(state, player.hero.cardId, player.hero)?.firstFailedClashReplacement
      : undefined;
    const cost = player && replacement
      ? namedClashCostPermanents(state, player.seat, replacement.costPermanentName)
          .find((card) => card.instanceId === Number(optionId))
      : undefined;
    if (!player || !replacement || !cost) return "clash replacement cost not found";
    destroyPermanent(state, runtime, player.seat, cost);
    clashState.stage = "bottom";
    clashState.chosenReplacementSeat = player.seat;
    const revealed = clashState.attempt.revealed.filter(({ seat: ownerSeat, instanceId }) =>
      (state.players[ownerSeat] as PlayerState).deck[0]?.instanceId === instanceId
    );
    if (revealed.length === 0) return "revealed clash card not found";
    state.pendingDecision = {
      player: player.seat,
      kind: "choose-target",
      prompt: `${nameOf(state, player.heroCardId)}: choose a revealed card to put on the bottom of its owner's deck`,
      options: revealed.map(({ instanceId }) => String(instanceId)),
      cardOptions: revealed.map(({ instanceId }) => instanceId),
      sourceInstanceId: clashState.request.sourceInstanceId,
      chooseHook: `${replacement.choiceHook}-bottom`,
      clash: clashState,
    };
    return undefined;
  }
  const revealed = clashState.attempt.revealed.find(
    (entry) => entry.instanceId === Number(optionId),
  );
  if (!revealed) return "revealed clash card not found";
  const owner = state.players[revealed.seat] as PlayerState;
  if (owner.deck[0]?.instanceId !== revealed.instanceId) return "revealed clash card is no longer on top";
  const card = owner.deck.shift() as CardInstance;
  owner.deck.push(card);
  runtime.transitions.move(
    card,
    transitionZone("deck", owner.seat, "top"),
    transitionZone("deck", owner.seat, "bottom"),
    { to: true },
  );
  logPublic(state, `${nameOf(state, card.cardId)} is put on the bottom of its owner's deck`);
  resolveClashRequest(state, runtime, clashState.request, clashState.queue);
  return undefined;
}
