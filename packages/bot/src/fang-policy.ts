import type { CardData, CardView, GameIntent, OngoingEffectView } from "@fyendal/shared";
import {
  fangSolverRules,
  fealtyTokens,
  fealtyValue,
  markValue,
  ONLINE_FEALTY,
  opponentMarked,
} from "./fang-rules.js";
import { cardTraits } from "./card-model.js";
import { printedPump } from "./dorinthea-rules.js";
import { fangMatchupForHeroName, type FangMatchup } from "./fang-strategy.js";
import type { SolverStep } from "./hand-solver.js";
import {
  arsenalValuer,
  defenseReactionWorthSpending,
  handResponse,
  opportunityValuer,
  solveHand,
} from "./hand-value.js";
import {
  canGainGoAgain,
  chooseScoredIntent,
  currentLink,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  intentCard,
  optionCard,
  ownCards,
  pitchIds,
  resourcePaymentPitchIds,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  scoreTacticalRoot,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  type BotPolicyInput,
  type ResponseModel,
} from "./policy.js";
import { chooseTacticalIntentWithTrace, type TacticalTurnPlan } from "./tactical-turn-planner.js";
import { hasType } from "@fyendal/shared";

const FEALTY_CARD_ID = "HNT167";

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";
const isDraconic = (data: CardData | undefined, card: CardView): boolean =>
  !!data && cardTraits(data, card).includes("draconic");

/** Root bonus for the hand solver's next action-phase step: Fang follows the
 * searched line of swings, setups and pitches. */
const SOLVER_STEP_RANK = 1000;
const SOLVER_PITCH_RANK = 50;
/** Damage-equivalent of another dagger swing the Vein's go again opens. */
const EXTRA_SWING_VALUE = 2;
/** Own-link plays that also pump a later attack this turn. */
const NEXT_ATTACK_POWER: Readonly<Record<string, number>> = {
  "blade flurry": 2,
  "tooth of the dragon": 3,
};
/** Giving the first Vein swing go again outranks every other own-link play. */
const FIRST_SWING_GO_AGAIN = 1000;
const LETHAL = 5000;
/** Reactive scores read one damage equivalent as this many points. */
const POINTS = 6;

const cardOpportunity = opportunityValuer(fangSolverRules);

function matchupFor(input: BotPolicyInput): FangMatchup {
  const opponent = input.view.players[1 - input.seat]!;
  const classes = input.cards[opponent.heroCardId]?.classes?.map((value) => value.toLowerCase()) ?? [];
  return fangMatchupForHeroName(opponent.heroName, classes);
}

function heldCards(input: BotPolicyInput): CardView[] {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal];
}

function ourTurn(input: BotPolicyInput): boolean {
  return input.view.activePlayer === input.seat;
}

/** Our Obsidian Fire Vein link in its reaction step, still waiting for a
 * Draconic card. Playing one while the attack is on the stack would only
 * show the defender the go again before blocks. */
function veinWaiting(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link && link.attackingCard.owner === input.seat && link.onStack !== true &&
    input.view.pendingDecision?.kind === "attack-reaction" &&
    hasType(input.cards[link.attackingCard.cardId], "weapon") && canGainGoAgain(link);
}

/** A resolved Fealty: the next card we play is Draconic. */
function hasPendingFealty(input: BotPolicyInput): boolean {
  return input.view.ongoing.some((effect) =>
    effect.seat === input.seat && named(input.cards[effect.cardId]) === "fealty"
  );
}

/** Our Fealty activation is still on the stack; a card played now is not yet Draconic. */
function fealtyOnStack(input: BotPolicyInput): boolean {
  return input.view.stack.some((layer) =>
    layer.seat === input.seat && named(input.cards[layer.card?.cardId ?? ""]) === "fealty"
  );
}

function draconicLinks(input: BotPolicyInput): number {
  return input.view.chain.filter((link) =>
    link.attackingCard.owner === input.seat && isDraconic(input.cards[link.attackingCard.cardId], link.attackingCard)
  ).length;
}

/** Ready Veins: unused this turn, or granted another attack. */
function readyVeins(input: BotPolicyInput): number {
  const me = input.view.players[input.seat];
  const link = currentLink(input);
  return me.weapons.filter((weapon) =>
    named(input.cards[weapon.cardId]) === "obsidian fire vein" &&
    (!weapon.usedAbilityIndexes?.includes(0) || (weapon.remainingAbilityActivations?.[0] ?? 0) > 0) &&
    weapon.instanceId !== link?.attackingCard.instanceId
  ).length;
}

/** Go again now opens another swing or action-speed play. */
function goAgainUseful(input: BotPolicyInput, spent: ReadonlySet<number>): boolean {
  if (!ourTurn(input)) return false;
  const me = input.view.players[input.seat];
  const free = fealtyTokens(input).length >= ONLINE_FEALTY && me.heroAbilitiesLost !== true;
  const budget = me.resources + me.hand.reduce((total, card) =>
    spent.has(card.instanceId) ? total : total + Number(input.cards[card.cardId]?.pitch ?? 0), 0);
  if (readyVeins(input) > 0 && (free || budget >= 1)) return true;
  return heldCards(input).some((card) => {
    const data = input.cards[card.cardId];
    return !spent.has(card.instanceId) && !!data && hasType(data, "action") && budget >= (data.cost ?? 0);
  });
}

/** Power a dagger or weapon reaction adds to the current link. */
function reactionPower(data: CardData, input: BotPolicyInput): number {
  const links = draconicLinks(input);
  const reprise = currentLink(input)?.defendingCards.some((card) =>
    !hasType(input.cards[card.cardId], "equipment")
  ) === true;
  switch (named(data)) {
    case "blistering blade": return links >= 2 ? 3 : 2;
    case "long whisker loyalty": return 2;
    case "fire and brimstone": return 1;
    case "glint the quicksilver":
    case "provoke": return 0;
    case "overpower": return printedPump(data) + (reprise ? 2 : 0);
    default: return printedPump(data);
  }
}

/** Our open link as plays on it change it, before the rest of the turn is solved. */
interface LinkPosition {
  attackValue: number;
  goAgain: boolean;
  /** The Vein still waits for a Draconic card. */
  veinOpen: boolean;
  /** A resolved Fealty makes the next card played Draconic. */
  draconicNext: boolean;
  fealty: number;
  resources: number;
  /** "Next attack" bonuses left for later swings. */
  setups: readonly OngoingEffectView[];
  spent: ReadonlySet<number>;
}

function startPosition(input: BotPolicyInput): LinkPosition {
  const link = currentLink(input)!;
  return {
    attackValue: link.attackValue,
    goAgain: link.goAgain === true,
    veinOpen: veinWaiting(input),
    draconicNext: hasPendingFealty(input),
    fealty: fealtyTokens(input).length,
    resources: input.view.players[input.seat].resources,
    setups: [],
    spent: new Set(),
  };
}

function linkCost(data: CardData, input: BotPolicyInput): number {
  const discount = named(data) === "imperial intent" || named(data) === "fire and brimstone" ? draconicLinks(input) : 0;
  return Math.max(0, (data.cost ?? 0) - discount);
}

/** Playing `card` on our open link: its gain on the link itself (damage past
 * the defense, Fealty, marks, extra swings the solver cannot see on a used
 * dagger) and the position after it. */
function playOnLink(
  position: LinkPosition,
  card: CardView,
  data: CardData,
  input: BotPolicyInput,
  pitched: readonly number[],
): { gain: number; lethal: boolean; next: LinkPosition } {
  const link = currentLink(input)!;
  const opponent = input.view.players[1 - input.seat]!;
  const draconic = position.draconicNext || isDraconic(data, card);
  const triggers = position.veinOpen && draconic;
  const power = (hasType(data, "attack-reaction") ? reactionPower(data, input) : 0) + (triggers ? 1 : 0);
  const margin = position.attackValue - link.defenseValue;
  const links = draconicLinks(input);
  const fealty = position.fealty;
  let gain = Math.max(0, Math.min(power, margin + power));
  const markOnHit = named(data) === "scar tissue" || (named(data) === "searing gaze" && links >= 2) ||
    (named(data) === "long whisker loyalty" && links >= 3);
  if (markOnHit && margin + power > 0 && !opponentMarked(input)) gain += markValue(fealty);
  const gained = (named(data) === "affirm loyalty" && links >= 2) || named(data) === "pledge fealty" ? 1 : 0;
  if (gained) gain += fealtyValue(fealty);
  if ((named(data) === "long whisker loyalty" && links >= 2) || named(data) === "fire and brimstone") {
    gain += EXTRA_SWING_VALUE;
  }
  if (named(data) === "provoke") gain += 1;
  const own = ownCards(input);
  const pitch = pitched.reduce((total, id) => total + Number(input.cards[own.get(id)?.cardId ?? ""]?.pitch ?? 0), 0);
  const nextPower = NEXT_ATTACK_POWER[named(data)];
  return {
    gain,
    lethal: power > 0 && margin + power >= opponent.life,
    next: {
      attackValue: position.attackValue + power,
      goAgain: position.goAgain || triggers || named(data) === "glint the quicksilver",
      veinOpen: position.veinOpen && !triggers,
      draconicNext: false,
      fealty: fealty + gained,
      resources: position.resources + pitch - linkCost(data, input),
      setups: nextPower
        ? [...position.setups, { seat: input.seat, cardId: card.cardId, label: "", facts: { power: nextPower, nextAttack: true } }]
        : position.setups,
      spent: new Set([...position.spent, card.instanceId, ...pitched]),
    },
  };
}

/** The rest of the turn solved from `position`: later swings and the value
 * of what stays held or goes to arsenal. */
function restValue(position: LinkPosition, input: BotPolicyInput): number {
  const link = currentLink(input);
  const me = input.view.players[input.seat];
  const tokens = fealtyTokens(input);
  const change = position.fealty - tokens.length;
  const lost = new Set(tokens.slice(0, Math.max(0, -change)).map((token) => token.instanceId));
  const fealtyId = tokens[0]?.cardId ?? FEALTY_CARD_ID;
  const board = [
    ...me.board.filter((card) => !lost.has(card.instanceId)),
    ...Array.from({ length: Math.max(0, change) }, (_, index) =>
      ({ instanceId: -1 - index, cardId: fealtyId, owner: input.seat })),
  ];
  const players = input.view.players.map((player, seat) =>
    seat === input.seat ? { ...player, board, resources: position.resources } : player
  ) as typeof input.view.players;
  const chain = input.view.chain.map((entry) => entry === link ? { ...entry, goAgain: position.goAgain } : entry);
  const ongoing = [...input.view.ongoing, ...position.setups];
  const after: BotPolicyInput = { ...input, state: undefined, view: { ...input.view, players, chain, ongoing } };
  const held = heldCards(input).filter((card) => !position.spent.has(card.instanceId));
  return solveHand(held, after, fangSolverRules).value;
}

/** Whether `data` can still go on our open link from `position` without pitching. */
function playableOnLink(data: CardData, input: BotPolicyInput, position: LinkPosition): boolean {
  if (linkCost(data, input) > position.resources) return false;
  if (hasType(data, "instant")) return true;
  if (!hasType(data, "attack-reaction")) return false;
  const attacker = input.cards[currentLink(input)!.attackingCard.cardId];
  if (!hasType(attacker, "weapon")) return false;
  if (named(data) === "hunt's end") return position.fealty >= ONLINE_FEALTY;
  return !/target dagger attack/i.test(data.text) || attacker?.subtypes?.includes("dagger") === true;
}

/** Best value from `position`: stop and solve the rest, or play one more
 * held card on this link first (e.g. Tooth of the Dragon, then Blade Flurry). */
function linkValue(position: LinkPosition, input: BotPolicyInput, depth: number): number {
  let best = restValue(position, input);
  if (depth === 0) return best;
  for (const card of heldCards(input)) {
    const data = input.cards[card.cardId];
    if (position.spent.has(card.instanceId) || !data || !playableOnLink(data, input, position)) continue;
    const step = playOnLink(position, card, data, input, []);
    if (step.lethal) return Infinity;
    best = Math.max(best, step.gain + linkValue(step.next, input, depth - 1));
  }
  return best;
}

/** An attack reaction or instant on our own open link, scored against
 * passing: its gain, an optional follow-up on the same link, and the solved
 * rest of the turn. */
function ownLinkPlayValue(intent: GameIntent, card: CardView, data: CardData, input: BotPolicyInput): number {
  const link = currentLink(input);
  if (!link || link.attackingCard.owner !== input.seat) return -Infinity;
  const start = startPosition(input);
  const step = playOnLink(start, card, data, input, pitchIds(intent));
  if (step.lethal) return Infinity;
  return step.gain + linkValue(step.next, input, 1) - restValue(start, input);
}

/** The first Vein swing still needs go again for the other Vein to swing. */
function firstSwingNeedsGoAgain(input: BotPolicyInput): boolean {
  return veinWaiting(input) && readyVeins(input) > 0;
}

/** Legal reactions and instants on our link, split by whether they are Draconic now. */
function linkOptions(input: BotPolicyInput): { draconic: boolean; other: boolean } {
  const own = ownCards(input);
  const options = { draconic: false, other: false };
  for (const intent of input.legal) {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal") continue;
    const card = intentCard(intent, own);
    const data = card && input.cards[card.cardId];
    if (!card || !data) continue;
    if (isDraconic(data, card) && (hasType(data, "attack-reaction") || hasType(data, "instant"))) {
      options.draconic = true;
    } else if (hasType(data, "attack-reaction")) {
      options.other = true;
    }
  }
  return options;
}

/** Fealty tokens die at our end phase unless a Draconic card was played (or a
 * Fealty created) this turn. The view has no creation fact, so only Draconic
 * plays and held Draconic cards count as saving them. */
function fealtyDoomed(input: BotPolicyInput): boolean {
  const played = input.view.turnFacts?.players[input.seat].playedSubtypes.includes("draconic") === true;
  return !played && !heldCards(input).some((card) => isDraconic(input.cards[card.cardId], card));
}

/** No Draconic card can trigger the first Vein, so a Fealty token makes a
 * reaction Draconic: above three tokens, where the rest keep swings free, or
 * when the tokens would otherwise all be destroyed at the end phase. */
function shouldActivateFealty(input: BotPolicyInput): boolean {
  if (!firstSwingNeedsGoAgain(input) || hasPendingFealty(input) || fealtyOnStack(input)) return false;
  const fealty = fealtyTokens(input).length;
  if (fealty === 0) return false;
  const options = linkOptions(input);
  return !options.draconic && options.other && (fealty > ONLINE_FEALTY || fealtyDoomed(input));
}

/** Solves lazily; only clean action-phase roots read it. */
function solverStepRank(input: BotPolicyInput): (intent: GameIntent) => number {
  let step: SolverStep | null | undefined;
  return (intent) => {
    step ??= solveHand(heldCards(input), input, fangSolverRules).line
      .find((candidate) => candidate.kind !== "react") ?? null;
    if (!step) return 0;
    const matches = step.kind === "play"
      ? (intent.kind === "play-card" || intent.kind === "play-from-arsenal" || intent.kind === "play-from-zone") &&
        intent.instanceId === step.instanceId
      : intent.kind === "activate-ability" && intent.sourceInstanceId === step.instanceId;
    if (!matches) return 0;
    const pitched = pitchIds(intent);
    const samePitch = pitched.length === step.pitchIds.length && pitched.every((id) => step!.pitchIds.includes(id));
    return SOLVER_STEP_RANK + (samePitch ? SOLVER_PITCH_RANK : 0);
  };
}

function cleanActionPhase(input: BotPolicyInput): boolean {
  return ourTurn(input) && input.view.phase === "action" && input.view.stack.length === 0 &&
    input.view.pendingDecision === null && currentLink(input) === undefined;
}

const solverRanks = new WeakMap<BotPolicyInput, (intent: GameIntent) => number>();

function solverRank(intent: GameIntent, input: BotPolicyInput): number {
  if (!cleanActionPhase(input)) return 0;
  let rank = solverRanks.get(input);
  if (!rank) {
    rank = solverStepRank(input);
    solverRanks.set(input, rank);
  }
  return rank(intent);
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -20;
  if (shouldPreserveOpeningHand(input)) return -100;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;
  const mine = ourTurn(input);
  const functional = named(data);
  const rank = solverRank(intent, input);
  let score: number;

  if (intent.kind === "activate-ability") {
    if (hasType(data, "weapon")) {
      // Off the solver's line a free swing is still damage.
      const free = fealtyTokens(input).length >= ONLINE_FEALTY && pitchIds(intent).length === 0;
      score = mine ? rank || (free ? 3 : -10) : -100;
    } else if (functional === "fealty") {
      return shouldActivateFealty(input) ? FIRST_SWING_GO_AGAIN : -100;
    } else if (functional === "balance of justice") {
      score = 10;
    } else {
      score = rank || -100;
    }
  } else if (hasType(data, "attack-reaction") || (hasType(data, "instant") && mine && veinWaiting(input))) {
    // Let a stacked Fealty resolve first, so the card it targets is Draconic.
    if (fealtyOnStack(input)) return -100;
    // Pitches are already priced by the solved rest of the turn.
    const value = ownLinkPlayValue(intent, card, data, input);
    if (value === Infinity) return LETHAL;
    // A Draconic card always gives the first swing go again; the best one goes.
    if (firstSwingNeedsGoAgain(input) && (isDraconic(data, card) || hasPendingFealty(input))) {
      return FIRST_SWING_GO_AGAIN + value * POINTS;
    }
    return value > 0 ? 5 + value * POINTS : -100;
  } else if (hasType(data, "defense-reaction")) {
    if (!defenseReactionWorthSpending(card, input, fangSolverRules, pitchIds(intent))) return -100;
    score = scoreDefenseReaction(data, input, card);
    const attacker = input.cards[currentLink(input)?.attackingCard.cardId ?? ""];
    if (functional === "smoke out" && attacker?.pitch === 1 && !opponentMarked(input)) {
      score += markValue(fealtyTokens(input).length) * POINTS;
    }
  } else {
    score = mine ? rank || -10 : -100;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input);
  }
  return score;
}

const fangResponse: ResponseModel = {
  offensiveCards: heldCards,
  evaluateResponse: (cards, input) => handResponse(cards, input, fangSolverRules),
};

/** Play style: aggro lists race; defensive lists trade blocks for the long game. */
const RESPONSE_LOSS_WEIGHT: Record<FangMatchup["stance"], number> = {
  aggro: 1.3,
  default: 1.15,
  defensive: 1,
};

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    ...fangResponse,
    cardOpportunity,
    responseLossWeight: RESPONSE_LOSS_WEIGHT[matchupFor(input).stance],
  });
}

/** Long Whisker Loyalty modes: the extra swing while it is affordable, the
 * mark while building Fealty, otherwise the damage. */
function scoreLongWhiskerMode(optionId: string, input: BotPolicyInput): number | undefined {
  const fealty = fealtyTokens(input).length;
  const link = currentLink(input);
  const lethal = !!link && link.attackValue + 2 - link.defenseValue >= input.view.players[1 - input.seat]!.life;
  switch (optionId) {
    case "+2 attack": return lethal ? 100 : 20;
    case "additional attack": return goAgainUseful(input, new Set()) || fealty >= ONLINE_FEALTY ? 26 : 8;
    case "mark on hit": return opponentMarked(input) ? 2 : fealty < ONLINE_FEALTY ? 24 : 14;
    default: return undefined;
  }
}

/** Grains of Bloodspill: bank a floating resource as Vigor, never pitch for it. */
function scoreVigorPayment(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number | undefined {
  const payment = resourcePaymentPitchIds(intent, input);
  if (payment === undefined) return undefined;
  if (payment.length > 0) return -20;
  const me = input.view.players[input.seat];
  const swingCost = readyVeins(input) > 0 && fealtyTokens(input).length < ONLINE_FEALTY ? 1 : 0;
  return me.resources - swingCost >= 1 ? 15 : -5;
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  if (decision.kind === "arsenal") return scoreArsenalChoice(intent, input, arsenalValuer(fangSolverRules));
  const me = input.view.players[input.seat];
  if (intent.optionId === String(input.view.players[1 - input.seat]!.heroInstanceId)) return 50;
  if (intent.optionId === String(me.heroInstanceId)) return -100;
  const mode = scoreLongWhiskerMode(intent.optionId, input);
  if (mode !== undefined) return mode;
  const vigor = scoreVigorPayment(intent, input);
  if (vigor !== undefined) return vigor;
  const binary = scoreBinaryChoice(intent.optionId, 5, -2);
  if (binary !== undefined) return binary;
  if (/discard|pitch/i.test(decision.prompt)) return scoreSpendCardChoice(intent, input, cardOpportunity);
  const card = optionCard(intent, input);
  // Crown of Providence and Sink Below give up the least valuable card.
  return card ? 20 - cardOpportunity(card, input) : 1;
}

function chooseFangReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    response: fangResponse,
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: arsenalValuer(fangSolverRules),
  });
}

export interface FangIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

/** Deterministic Fang policy: pitch blue to swing both Veins behind Draconic
 * reactions while building Fealty from marks, then spend free swings once
 * three Fealty tokens stand. */
export function chooseFangIntentWithTrace(input: BotPolicyInput): FangIntentDecision {
  const reactive = chooseFangReactiveIntent(input);
  const decision = chooseTacticalIntentWithTrace(input, reactive, {
    chooseForced: (forced) => chooseFangReactiveIntent({ ...forced, state: undefined }),
    rules: fangSolverRules,
    rankCandidate: (intent, observed) => scoreTacticalRoot(intent, observed, scorePlay),
    rootScore: (intent, observed) => scoreTacticalRoot(intent, observed, scorePlay),
  });
  const intent = enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, decision.intent));
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

export function chooseFangIntent(input: BotPolicyInput): GameIntent {
  return chooseFangIntentWithTrace(input).intent;
}
