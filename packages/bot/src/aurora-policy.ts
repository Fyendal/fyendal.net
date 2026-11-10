import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import { auroraSolverRules } from "./aurora-rules.js";
import { auroraMatchupForHeroName, type AuroraMatchup } from "./aurora-strategy.js";
import { planBriarTurn, type BriarTurnPlan } from "./briar-turn-planner.js";
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
  currentAttackIsOurs,
  currentLink,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  isAttack,
  optionCard,
  ownCards,
  pitchIds,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  type BotPolicyInput,
  type ResponseModel,
} from "./policy.js";

/** Below this life after an unblocked hit, Aurora stops racing and blocks. */
const BLOCKING_LIFE = 5;

const NON_ATTACK_PRIORITIES: Record<string, number> = {
  "arc lightning|2": 33,
  "quick succession|1": 31,
  "skyward serenade|2": 29,
  "nimblism|1": 27,
  "nimblism|2": 24,
};

/** Non-attack setups that waste their effect without a later attack. */
const SETUPS = new Set([
  "arc lightning|2",
  "quick succession|1",
  "skyward serenade|2",
  "nimblism|1",
  "nimblism|2",
  "electrostatic discharge|1",
]);

const CONDITIONAL_GO_AGAIN = new Set([
  "jack be nimble|1",
  "lightning surge|1",
  "lightning surge|2",
  "path of same ends|1",
  "scar for a scar|1",
  "second strike|1",
  "current funnel|3",
  "flittering charge|1",
]);

function isNonAttack(data: CardData | undefined): boolean {
  return data?.cardType === "action" && !data.subtypes?.includes("attack");
}

function isLightning(data: CardData): boolean {
  return data.subtypes?.includes("lightning") ?? false;
}

function matchupFor(input: BotPolicyInput): AuroraMatchup {
  const opponent = input.view.players[1 - input.seat]!;
  const classes = input.cards[opponent.heroCardId ?? ""]?.classes?.map((value) => value.toLowerCase()) ?? [];
  return auroraMatchupForHeroName(opponent.heroName, classes);
}

/** Whether `followup` can consume the setup played (or pending) as `setup`. */
function consumesSetup(setup: string, followup: CardData): boolean {
  if (setup.startsWith("nimblism|") || setup === "electrostatic discharge|1") {
    return isAttack(followup) && (followup.cost ?? 0) <= 1;
  }
  if (setup === "quick succession|1") {
    return isAttack(followup) && (followup.classes?.includes("runeblade") === true || isLightning(followup));
  }
  // Arc Lightning's grant reaches the next action card of any kind.
  if (setup === "arc lightning|2") return followup.cardType === "action";
  return isAttack(followup) || followup.cardType === "weapon";
}

/** Another playable attack (or action, for Arc Lightning) can follow the setup. */
function hasSetupFollowup(
  functional: string,
  setupIntent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const setup = intentCard(setupIntent, own);
  if (!setup) return false;
  const consumed = new Set([setup.instanceId, ...pitchIds(setupIntent)]);
  return input.legal.some((candidate) => {
    if (
      candidate.kind !== "play-card" && candidate.kind !== "play-from-arsenal" &&
      candidate.kind !== "play-from-zone" && candidate.kind !== "activate-ability"
    ) return false;
    const followup = intentCard(candidate, own);
    if (!followup || consumed.has(followup.instanceId)) return false;
    if (pitchIds(candidate).some((id) => consumed.has(id))) return false;
    const data = input.cards[followup.cardId];
    return !!data && consumesSetup(functional, data);
  });
}

/** Arc Lightning pays off only when several more action cards can chain. */
function arcChainLength(input: BotPolicyInput, arcId: number): number {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].filter((card) =>
    card.instanceId !== arcId && input.cards[card.cardId]?.cardType === "action"
  ).length;
}

function pendingSetups(input: BotPolicyInput): string[] {
  return input.view.ongoing.flatMap((effect) => {
    if (effect.seat !== input.seat || effect.facts?.nextAttack !== true) return [];
    const functional = key(input.cards[effect.cardId]);
    return functional ? [functional] : [];
  });
}

function wastesPendingSetup(data: CardData, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): boolean {
  const pending = pendingSetups(input);
  if (pending.every((setup) => consumesSetup(setup, data))) return false;
  // Only a waste when some other playable card would consume them.
  return input.legal.some((candidate) => {
    const card = intentCard(candidate, own);
    const other = card ? input.cards[card.cardId] : undefined;
    return !!other && other !== data && (isAttack(other) || other.cardType === "weapon") &&
      pending.every((setup) => consumesSetup(setup, other));
  });
}

/** Snapdragon only adds go again to an own cost-1-or-less attack action that
 * lacks it, and only with another action card left to continue into. */
function snapdragonWorthUsing(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link || !currentAttackIsOurs(input) || !canGainGoAgain(link)) return false;
  if (input.view.pendingDecision?.kind !== "attack-reaction") return false;
  if (input.view.stack.some((layer) =>
    layer.seat === input.seat && key(input.cards[layer.card?.cardId ?? ""]) === "snapdragon scalers|0"
  )) return false;
  const attack = input.cards[link.attackingCard.cardId];
  if (!isAttack(attack) || (attack?.cost ?? Infinity) > 1) return false;
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].some((card) => input.cards[card.cardId]?.cardType === "action");
}

function shouldMeldBurnUp(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): boolean {
  if (!("meldSide" in intent) || intent.meldSide !== "both") return false;
  return input.view.players[1 - input.seat]!.life <= 1 ||
    hasSetupFollowup("burn up // shock|1", intent, input, own);
}

function prepareCandidates(candidates: readonly GameIntent[], input: BotPolicyInput): readonly GameIntent[] {
  const own = ownCards(input);
  const melds = candidates.filter((intent) => {
    const card = intentCard(intent, own);
    return !!card && key(input.cards[card.cardId]) === "burn up // shock|1" && shouldMeldBurnUp(intent, input, own);
  });
  return melds.length > 0 ? melds : candidates;
}

const cardOpportunity = opportunityValuer(auroraSolverRules);

const auroraResponse: ResponseModel = {
  offensiveCards: (input) => {
    const me = input.view.players[input.seat];
    return [...me.hand, ...me.arsenal];
  },
  evaluateResponse: (cards, input) => handResponse(cards, input, auroraSolverRules),
};

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const matchup = matchupFor(input);
  return scoreDefenseIntent(intent, input, own, {
    ...auroraResponse,
    cardOpportunity,
    // Play style: Aurora races and keeps its hand for Lightning chains.
    responseLossWeight: matchup.stance === "beatdown" ? 1.6 : 1.35,
    defensePermission(candidate) {
      if (candidate.lethal) return "allow";
      const me = candidate.input.view.players[candidate.input.seat];
      const handIds = new Set(me.hand.map((card) => card.instanceId));
      const handBlockers = candidate.chosen.filter((card) =>
        handIds.has(card.instanceId) && !candidate.stagedIds.has(card.instanceId)
      );
      // Armor alone may always cover a hit; hand cards block only for a reason.
      if (handBlockers.length === 0) return "allow";
      if (me.life - candidate.incoming <= BLOCKING_LIFE) return "allow";
      if (candidate.onHit.value >= 6 || candidate.onHit.handCardsLost >= 2 ||
        candidate.onHit.destroysOccupiedArsenal) return "allow";
      const played = new Set(
        solveHand([...me.hand, ...me.arsenal], candidate.input, auroraSolverRules).line
          .map((step) => step.instanceId),
      );
      return handBlockers.every((card) => !played.has(card.instanceId)) ? "allow" : "forbid";
    },
  });
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  if (decision.kind === "arsenal") return scoreArsenalChoice(intent, input, arsenalValuer(auroraSolverRules));
  if (decision.kind === "choose-target") {
    const opponent = input.view.players[1 - input.seat]!;
    if (intent.optionId === String(opponent.heroInstanceId)) return 50;
    if (intent.optionId === String(input.view.players[input.seat].heroInstanceId)) return -100;
    return intent.optionId === "pass" ? -50 : 10;
  }
  const me = input.view.players[input.seat];
  const attacksHeld = me.hand.filter((card) => isAttack(input.cards[card.cardId])).length + me.arsenal.length;
  switch (intent.optionId) {
    case "1: Embodiment": return 30;
    case "3: Next attack +1": return 20;
    case "2: Search Skyzyk": return attacksHeld === 0 ? 40 : 10;
    case "go again": return attacksHeld > 0 ? 30 : 5;
    case "+2": return attacksHeld > 0 ? 20 : 30;
    case "draw": return 15;
    default: break;
  }
  const binary = scoreBinaryChoice(intent.optionId, 5, -2);
  if (binary !== undefined) return binary;
  const card = optionCard(intent, input);
  // Card choices (Enlightened Strike, Crown of Providence, Sink Below) give up
  // the least valuable card.
  return card ? 20 - cardOpportunity(card, input) : 1;
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -20;
  const functional = key(data);
  const me = input.view.players[input.seat];
  const opponent = input.view.players[1 - input.seat]!;
  const myTurn = input.view.activePlayer === input.seat;
  let score = 0;

  if (shouldPreserveOpeningHand(input)) return -100;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;

  if (intent.kind === "activate-ability") {
    if (data.cardType === "weapon") {
      if (wastesPendingSetup(data, input, own)) return -100;
      score = 12 + pendingSetups(input).length * 10;
    } else if (functional === "grasp of the arknight|0" || functional === "vexing quillhand|0") {
      const arcane = matchupFor(input).arcane;
      score = functional === "vexing quillhand|0" && arcane
        ? -10
        : hasSetupFollowup(functional, intent, input, own) ? 8 : -10;
    } else if (functional === "snapdragon scalers|0") {
      score = snapdragonWorthUsing(input) ? 20 : -100;
    } else if (functional === "path of same ends|1") {
      const link = currentLink(input);
      score = link && link.attackingCard.owner === input.seat && link.goAgain !== true ? 15 : -10;
    } else {
      score = 4;
    }
  } else if (isNonAttack(data)) {
    if (SETUPS.has(functional) && !hasSetupFollowup(functional, intent, input, own)) return -100;
    score = NON_ATTACK_PRIORITIES[functional] ?? 12;
    // Arc Lightning opens the power turn only when the hand can keep chaining.
    if (functional === "arc lightning|2" && arcChainLength(input, card.instanceId) < 2) score = 6;
  } else if (isAttack(data)) {
    if (wastesPendingSetup(data, input, own)) return -100;
    score = (card.attack ?? data.attack ?? 0) + pendingSetups(input).length * 10;
    const printedGoAgain = data.keywords?.includes("Go again") && !CONDITIONAL_GO_AGAIN.has(functional);
    const conditionalGoAgain =
      (functional.startsWith("lightning surge|") && intent.kind === "play-from-arsenal") ||
      (functional === "scar for a scar|1" && me.life < opponent.life) ||
      (functional === "second strike|1" && input.view.turnFacts?.players[input.seat].dealtDamage === true) ||
      (functional === "jack be nimble|1" && me.graveyard.some((grave) =>
        input.cards[grave.cardId]?.name.trim().toLowerCase() === "nimblism"
      )) ||
      functional === "path of same ends|1" ||
      (functional === "current funnel|3" &&
        input.view.turnFacts?.players[input.seat].playedSubtypes.includes("lightning") === true);
    if (printedGoAgain || conditionalGoAgain) score += 13;
    if (functional === "snatch|1") score += 3;
  } else if (data.cardType === "instant") {
    const ownAttack = currentLink(input)?.attackingCard.owner === input.seat;
    if (functional === "burn up // shock|1" && "meldSide" in intent) {
      score = shouldMeldBurnUp(intent, input, own)
        ? 100
        : intent.meldSide === "right" && opponent.life <= 1 ? 100 : -100;
    } else if (functional === "lightning press|1") {
      score = input.view.pendingDecision?.kind === "attack-reaction" && ownAttack ? 18 : -20;
    } else if (functional === "electrostatic discharge|1") {
      score = myTurn && !ownAttack && hasSetupFollowup(functional, intent, input, own) ? 20 : -20;
    } else {
      score = myTurn ? 14 : 2;
    }
  } else if (data.cardType === "defense-reaction") {
    score = defenseReactionWorthSpending(card, input, auroraSolverRules, pitchIds(intent))
      ? scoreDefenseReaction(data, input)
      : -100;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input);
  }
  return score;
}

function chooseAuroraReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    response: auroraResponse,
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: arsenalValuer(auroraSolverRules),
  });
}

export interface AuroraIntentDecision {
  intent: GameIntent;
  plan?: BriarTurnPlan;
}

/** Deterministic Aurora policy: bounded whole-turn rollout in clean action
 * phases, projection scoring in reactive windows. */
export function chooseAuroraIntentWithTrace(input: BotPolicyInput): AuroraIntentDecision {
  if (shouldPreserveOpeningHand(input)) {
    return { intent: enforceSpectraPolicy(input, chooseAuroraReactiveIntent(input)) };
  }
  const plan = planBriarTurn(input, {
    chooseForced: (forced) => chooseAuroraReactiveIntent({ ...forced, state: undefined }),
    rules: auroraSolverRules,
    comparePitchOrder: () => 0,
    scoreIntent: () => 0,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    prepareCandidates,
    fatiguePlan: false,
  });
  const intent = enforceSpectraPolicy(input, plan?.intent ?? chooseAuroraReactiveIntent(input));
  return plan ? { intent, plan } : { intent };
}

export function chooseAuroraIntent(input: BotPolicyInput): GameIntent {
  return chooseAuroraIntentWithTrace(input).intent;
}
