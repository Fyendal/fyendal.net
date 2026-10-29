import type { CardData, CardView, GameIntent, GameView } from "@fyendal/shared";
import { planBriarTurn, type BriarTurnPlan } from "./briar-turn-planner.js";
import { briarSolverRules } from "./briar-rules.js";
import { briarMatchupForHeroName } from "./briar-strategy.js";
import { arsenalValuer, handResponse, opportunityValuer } from "./hand-value.js";
import {
  chooseScoredIntent,
  committedEffectAmount,
  enforceSpectraPolicy,
  functionalKey as key,
  incomingAttackDamage,
  intentCard,
  isAttack,
  optionCard,
  ownCards,
  pitchIds,
  preventableAttackDamage,
  resourcesAfterCost,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  type BotPolicyInput,
  type ResponseModel,
} from "./policy.js";
import { threatenedAttackDamage } from "./public-threat.js";

const NON_ATTACK_PRIORITIES: Record<string, number> = {
  "nimblism|1": 27,
  "nimblism|2": 24,
  "quick succession|1": 31,
  "quick succession|3": 26,
  "sizzle|1": 28,
  "sprout strength|1": 27,
  "weave lightning|1": 29,
};

const CONDITIONAL_GO_AGAIN = new Set([
  "entwine lightning|1",
  "jack be nimble|1",
  "lightning surge|1",
  "path of same ends|1",
  "scar for a scar|1",
  "second strike|1",
]);

function isNonAttack(data: CardData | undefined): boolean {
  return data?.cardType === "action" && !data.subtypes?.includes("attack");
}

function hasSubtype(data: CardData, subtype: string): boolean {
  return data.subtypes?.includes(subtype) ?? false;
}

function isRunebladeOrLightningAttack(data: CardData): boolean {
  return isAttack(data) && (
    data.classes?.includes("runeblade") === true ||
    hasSubtype(data, "lightning")
  );
}

function isFatiguePlan(input: BotPolicyInput): boolean {
  return briarMatchupForHeroName(
    input.view.players[1 - input.seat]!.heroName,
  ) === "fatigue";
}

function compareBriarPitchOrder(
  left: GameIntent,
  right: GameIntent,
  input: BotPolicyInput,
): number {
  if (!isFatiguePlan(input)) return 0;
  const own = ownCards(input);
  const rank = (instanceId: number): number => {
    const card = own.get(instanceId);
    return card && key(input.cards[card.cardId]) === "burn up // shock|1" &&
        (card.pitchCount ?? 0) === 0
      ? 1
      : 0;
  };
  const leftIds = pitchIds(left);
  const rightIds = pitchIds(right);
  const length = Math.min(leftIds.length, rightIds.length);
  for (let index = 0; index < length; index++) {
    const difference = rank(leftIds[index]!) - rank(rightIds[index]!);
    if (difference !== 0) return difference;
  }
  return 0;
}

function scoreBriarPlannedIntent(intent: GameIntent, input: BotPolicyInput): number {
  const own = ownCards(input);
  let score = 0;
  if (isFatiguePlan(input)) {
    const firstCycleBurns = new Set(pitchIds(intent).filter((id) => {
      const card = own.get(id);
      return card && key(input.cards[card.cardId]) === "burn up // shock|1" &&
        (card.pitchCount ?? 0) === 0;
    }));
    score += firstCycleBurns.size * 600;
    if (intent.kind === "activate-ability") {
      const source = own.get(intent.sourceInstanceId);
      if (source && key(input.cards[source.cardId]) === "star fall|0") score += 150;
    }
  }
  if (intent.kind === "play-from-arsenal") {
    const card = own.get(intent.instanceId);
    if (card && key(input.cards[card.cardId]) === "evergreen|1") score += 100;
  }
  return score;
}

function omitProactiveCloudCover(
  candidates: readonly GameIntent[],
  input: BotPolicyInput,
): readonly GameIntent[] {
  const own = ownCards(input);
  return candidates.filter((intent) => {
    const card = intentCard(intent, own);
    return !card || key(input.cards[card.cardId]) !== "cloud cover|1";
  });
}

/**
 * A setup action is useful only when another currently playable attack can
 * consume it. Looking at legal intents also avoids treating an unusable
 * weapon or an attack spent as pitch as a follow-up.
 */
function hasSetupFollowup(
  functional: string,
  setupIntent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const setup = intentCard(setupIntent, own);
  if (!setup) return false;
  const setupPitchIds = pitchIds(setupIntent);
  const consumed = new Set([setup.instanceId, ...setupPitchIds]);
  const frostbiteCount = input.view.players[input.seat].board.filter((card) =>
    key(input.cards[card.cardId]) === "frostbite|0"
  ).length;
  const setupResources = resourcesAfterCost(
    setupIntent,
    (input.cards[setup.cardId]?.cost ?? 0) + frostbiteCount,
    input,
    own,
  );

  return input.legal.some((candidate) => {
    if (
      candidate.kind !== "play-card" &&
      candidate.kind !== "play-from-arsenal" &&
      candidate.kind !== "play-from-zone" &&
      candidate.kind !== "activate-ability"
    ) return false;
    const followup = intentCard(candidate, own);
    if (!followup || consumed.has(followup.instanceId)) return false;
    const data = input.cards[followup.cardId];
    if (!data) return false;
    const attackAction = isAttack(data);
    const attack = attackAction || data.cardType === "weapon";
    if (
      pitchIds(candidate).some((id) => consumed.has(id)) &&
      !(frostbiteCount > 0 && attackAction && (data.cost ?? 0) <= setupResources)
    ) return false;

    if (functional.startsWith("nimblism|")) {
      return attackAction && (data.cost ?? 0) <= 1;
    }
    if (functional === "sizzle|1") {
      return attack && (hasSubtype(data, "lightning") || hasSubtype(data, "elemental"));
    }
    if (functional.startsWith("weave lightning|")) {
      return attackAction && (hasSubtype(data, "lightning") || hasSubtype(data, "elemental"));
    }
    if (functional.startsWith("quick succession|")) {
      return isRunebladeOrLightningAttack(data);
    }
    if (functional === "sprout strength|1") return attack;
    return attack;
  });
}

function shouldLeadWithBurnUp(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const card = intentCard(intent, own);
  if (
    !card || key(input.cards[card.cardId]) !== "burn up // shock|1" ||
    !("meldSide" in intent) || intent.meldSide !== "both"
  ) return false;
  const opponentLife = input.view.players[1 - input.seat]!.life;
  const firstCycleFatigue = isFatiguePlan(input) && (card.pitchCount ?? 0) === 0;
  return (!firstCycleFatigue || opponentLife <= 1) &&
    (hasSetupFollowup("burn up // shock|1", intent, input, own) || opponentLife <= 1);
}

function prepareBriarCandidates(
  candidates: readonly GameIntent[],
  input: BotPolicyInput,
): readonly GameIntent[] {
  const proactive = omitProactiveCloudCover(candidates, input);
  const own = ownCards(input);
  const burnUpMelds = proactive.filter((intent) => shouldLeadWithBurnUp(intent, input, own));
  return burnUpMelds.length > 0 ? burnUpMelds : proactive;
}

function pendingAttackSetups(input: BotPolicyInput): Set<string> {
  return new Set(input.view.ongoing.flatMap((effect) => {
    if (effect.seat !== input.seat || effect.facts?.nextAttack !== true) return [];
    const functional = key(input.cards[effect.cardId]);
    return functional ? [functional] : [];
  }));
}

function attackConsumesPendingSetup(data: CardData, input: BotPolicyInput): boolean {
  const pending = pendingAttackSetups(input);
  const attackAction = isAttack(data);
  const attack = attackAction || data.cardType === "weapon";
  const elemental = hasSubtype(data, "lightning") || hasSubtype(data, "elemental");
  if ([...pending].some((functional) => functional.startsWith("weave lightning|")) && !(attackAction && elemental)) {
    return false;
  }
  if (pending.has("sizzle|1") && !(attack && elemental)) return false;
  if ([...pending].some((functional) => functional.startsWith("nimblism|")) && !(attackAction && (data.cost ?? 0) <= 1)) {
    return false;
  }
  if ([...pending].some((functional) => functional.startsWith("quick succession|")) && !isRunebladeOrLightningAttack(data)) {
    return false;
  }
  return true;
}

function hasPendingSetupConsumer(
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  return input.legal.some((candidate) => {
    if (
      candidate.kind !== "play-card" &&
      candidate.kind !== "play-from-arsenal" &&
      candidate.kind !== "play-from-zone" &&
      candidate.kind !== "activate-ability"
    ) return false;
    const card = intentCard(candidate, own);
    const data = card ? input.cards[card.cardId] : undefined;
    return !!data && (isAttack(data) || data.cardType === "weapon") &&
      attackConsumesPendingSetup(data, input);
  });
}

function recentTurnLog(view: GameView): string[] {
  let marker = -1;
  for (let index = view.log.length - 1; index >= 0; index--) {
    if (view.log[index]!.startsWith("— Turn ")) {
      marker = index;
      break;
    }
  }
  return marker < 0 ? view.log : view.log.slice(marker);
}

function dealtDamageThisTurn(input: BotPolicyInput): boolean {
  const projected = input.view.turnFacts?.players[input.seat].dealtDamage;
  if (projected !== undefined) return projected;
  const opponent = input.view.players[1 - input.seat]!.heroName;
  return recentTurnLog(input.view).some((line) =>
    / hits(?: [^ ]+)? for [1-9]\d*/.test(line) ||
    (line.startsWith(`${opponent} takes `) && !line.includes("takes 0 "))
  );
}

function playedLightningThisTurn(input: BotPolicyInput): boolean {
  const projected = input.view.turnFacts?.players[input.seat].playedSubtypes;
  if (projected !== undefined) return projected.includes("lightning");
  const hero = input.view.players[input.seat].heroName;
  return recentTurnLog(input.view).some((line) => {
    if (!line.startsWith(`${hero} plays `)) return false;
    const name = line.slice(`${hero} plays `.length).replace(/ in response$/, "");
    return Object.values(input.cards).some((card) =>
      card.name === name && card.subtypes?.includes("lightning")
    );
  });
}

function opponentArcaneDamageOnStack(input: BotPolicyInput): boolean {
  if (input.view.pendingDecision?.kind !== "priority-window") return false;
  const layer = input.view.stack[0];
  if (!layer || layer.seat === input.seat) return false;
  const text = layer.card ? input.cards[layer.card.cardId]?.text : undefined;
  return /\barcane damage\b/i.test(layer.label) ||
    (text !== undefined && /\bdeal(?:s)?\b[^.\n]*\barcane damage\b/i.test(text));
}

function opponentArcaneDamageAmountOnStack(input: BotPolicyInput): number {
  if (input.view.pendingDecision?.kind !== "priority-window") return 0;
  const layer = input.view.stack[0];
  if (!layer || layer.seat === input.seat) return 0;
  const text = layer.card ? input.cards[layer.card.cardId]?.text : undefined;
  const amount = /(\d+)\s*arcane damage/i.exec(layer.label)?.[1] ??
    (text ? /deal(?:s)?\s+(\d+)\s*arcane damage/i.exec(text)?.[1] : undefined);
  return Number(amount ?? 0);
}

function hasAvailableArcanePrevention(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  const arena = [
    ...Object.values(me.equipment).filter((card): card is CardView => card !== undefined),
    ...me.board,
  ];
  if (arena.some((card) =>
    input.cards[card.cardId]?.keywords?.some((keyword) => /^spellvoid [1-9]\d*$/i.test(keyword))
  )) return true;
  const hasBarrier = arena.some((card) =>
    input.cards[card.cardId]?.keywords?.some((keyword) => /^arcane barrier [1-9]\d*$/i.test(keyword))
  );
  return hasBarrier && (
    me.resources + (me.chi ?? 0) > 0 ||
    me.hand.some((card) => (input.cards[card.cardId]?.pitch ?? 0) > 0)
  );
}

function arcaneSeedsLifeIsLastSurvivalOption(
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  sourceInstanceId: number,
): boolean {
  const me = input.view.players[input.seat];
  const alternativeCard = input.legal.some((candidate) => {
    const card = intentCard(candidate, own);
    if (!card || card.instanceId === sourceInstanceId) return false;
    const data = input.cards[card.cardId];
    return data?.cardType === "defense-reaction" || key(data) === "cloud cover|1";
  });
  if (alternativeCard) return false;

  const link = [...input.view.chain].reverse().find((candidate) => !candidate.resolved);
  if (
    input.view.pendingDecision?.kind === "defense-reaction" &&
    link &&
    link.attackingCard.owner !== input.seat
  ) {
    return threatenedAttackDamage(input) === me.life;
  }

  const arcane = opponentArcaneDamageAmountOnStack(input);
  return arcane === me.life && !hasAvailableArcanePrevention(input);
}

const cardOpportunity = opportunityValuer(briarSolverRules);

const briarResponse: ResponseModel = {
  offensiveCards: (input) => {
    const me = input.view.players[input.seat];
    return [...me.hand, ...me.arsenal];
  },
  evaluateResponse: (cards, input) => handResponse(cards, input, briarSolverRules),
};

function scoreDefend(intent: Extract<GameIntent, { kind: "defend" }>, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  return scoreDefenseIntent(intent, input, own, {
    ...briarResponse,
    // Play style: Briar leans toward keeping its Lightning sequences.
    responseLossWeight: 1.25,
    cardOpportunity,
    plannedPrevention(policyInput, _defendIntent, spentIds, reactionPlan) {
      const link = [...policyInput.view.chain].reverse().find((candidate) => !candidate.resolved);
      if (!link) return reactionPlan;
      const me = policyInput.view.players[policyInput.seat];
      const cloudCoverIds = me.hand.flatMap((card) =>
        key(policyInput.cards[card.cardId]) === "cloud cover|1" ? [card.instanceId] : []
      );
      const committed = committedEffectAmount(
        policyInput,
        "cloud cover|1",
        3,
        (effect) => effect.facts?.preventDamage ?? 3,
      );
      const available = cloudCoverIds.filter((id) =>
        !spentIds.has(id) && !reactionPlan.consumedIds.includes(id)
      );
      // Reserve Cloud Cover during the defense step and plan blocks around its
      // prevention plus any available defense reactions.
      if (cloudCoverIds.length > 0 && available.length === 0 && committed === 0) return null;
      const incoming = incomingAttackDamage(policyInput);
      const threatened = threatenedAttackDamage(policyInput);
      const minimumToSurvive = Math.max(0, threatened - me.life + 1);
      const planCloudCover = available.length > 0 && (
        threatened < me.life || reactionPlan.amount < minimumToSurvive
      );
      const covered = threatened >= me.life ? threatened : incoming;
      const uncovered = Math.max(0, covered - reactionPlan.amount - committed);
      const copies = planCloudCover
        ? Math.min(available.length, Math.ceil(uncovered / 3))
        : 0;
      return {
        amount: reactionPlan.amount + committed + copies * 3,
        consumedIds: [...reactionPlan.consumedIds, ...available.slice(0, copies)],
        resourceCost: reactionPlan.resourceCost,
        reactionIds: reactionPlan.reactionIds,
        pitchIds: reactionPlan.pitchIds,
        preventionIds: [...(reactionPlan.preventionIds ?? []), ...available.slice(0, copies)],
      };
    },
  });
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, arsenalValuer(briarSolverRules));
  }
  const binary = scoreBinaryChoice(intent.optionId, 5, -2);
  if (binary !== undefined) return binary;
  const card = optionCard(intent, input);
  // Fusion reveals rather than spends a card. Prefer revealing the least
  // valuable legal Lightning card and keep the stronger attack in hand.
  return card ? 20 - cardOpportunity(card, input) : 1;
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!data) return -20;
  const functional = key(data);
  const me = input.view.players[input.seat];
  const myTurn = input.view.activePlayer === input.seat;
  let score = 0;

  // The opponent can spend their entire hand blocking on turn one and both
  // players refill afterward. Preserve Briar's known hand, pass, and convert
  // the best setup card into a five-card turn through arsenal.
  if (shouldPreserveOpeningHand(input)) return -100;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;

  if (intent.kind === "activate-ability") {
    if (data.cardType === "weapon" && !attackConsumesPendingSetup(data, input)) return -100;
    if (functional === "scorpio, comet tail|0") score = 12;
    else if (functional === "swiftstrike bracers|0" || functional === "quick clicks|0") {
      score = hasSetupFollowup(functional, intent, input, own) ? 18 : -100;
    }
    else if (functional === "blossom of spring|0" || functional === "garland of spring|0") {
      const needsResource = me.hand.some((candidate) =>
        (input.cards[candidate.cardId]?.cost ?? 0) > me.resources
      );
      score = needsResource ? 16 : -10;
    } else if (functional === "crown of dichotomy|0") {
      const runebladeAttack = me.graveyard.some((candidate) => {
        const grave = input.cards[candidate.cardId];
        return isAttack(grave) && grave?.classes?.includes("runeblade");
      });
      const runebladeNonAttack = me.graveyard.some((candidate) => {
        const grave = input.cards[candidate.cardId];
        return isNonAttack(grave) && grave?.classes?.includes("runeblade");
      });
      score = me.deckCount <= 6 && runebladeAttack && runebladeNonAttack ? 14 : -10;
    }
    else score = 4;
    if (data.cardType === "weapon") score += pendingAttackSetups(input).size * 10;
  } else if (isNonAttack(data)) {
    const requiresAttackFollowup =
      functional.startsWith("nimblism|") ||
      functional === "sizzle|1" ||
      functional === "sprout strength|1" ||
      functional.startsWith("weave lightning|") ||
      functional.startsWith("quick succession|");
    score = requiresAttackFollowup && !hasSetupFollowup(functional, intent, input, own)
      ? -100
      : (NON_ATTACK_PRIORITIES[functional] ?? 12);
  } else if (isAttack(data)) {
    if (!attackConsumesPendingSetup(data, input) && hasPendingSetupConsumer(input, own)) return -100;
    score = (data.attack ?? 0) + pendingAttackSetups(input).size * 10;
    if (functional === "evergreen|1") {
      if (intent.kind === "play-from-arsenal") score += 20;
      else if (me.arsenal.length === 0 && input.view.players[1 - input.seat]!.life > (data.attack ?? 0)) {
        score = -100;
      }
    }
    const printedGoAgain = data.keywords?.includes("Go again") && !CONDITIONAL_GO_AGAIN.has(functional);
    const conditionalGoAgain =
      (functional === "lightning surge|1" && intent.kind === "play-from-arsenal") ||
      (functional === "scar for a scar|1" && me.life < input.view.players[1 - input.seat]!.life) ||
      (functional === "second strike|1" && dealtDamageThisTurn(input)) ||
      (functional === "jack be nimble|1" && me.graveyard.some((candidate) =>
        input.cards[candidate.cardId]?.name.trim().toLowerCase() === "nimblism"
      )) ||
      (functional === "path of same ends|1") ||
      (functional === "entwine lightning|1");
    if (printedGoAgain || conditionalGoAgain) score += 13;
    if (functional === "snatch|1") score += 3;
    if (functional === "static shock|1" && playedLightningThisTurn(input)) score += 4;
    if (functional === "rush of power|1" && input.view.players[input.seat].board.some((c) => input.cards[c.cardId]?.name === "Embodiment of Lightning")) score += 5;
  } else if (data.cardType === "instant") {
    if (functional === "arcane seeds // life|1" && "meldSide" in intent) {
      const survival = intent.meldSide === "right" &&
        arcaneSeedsLifeIsLastSurvivalOption(input, own, card?.instanceId ?? -1);
      score = intent.meldSide === "both" && myTurn
        ? 100
        : survival
        ? 120
        : -100;
    } else if (functional === "burn up // shock|1" && "meldSide" in intent) {
      const opponentLife = input.view.players[1 - input.seat]!.life;
      // Keep the card for its full melded line. Playing another setup action
      // first opens a priority window where only Shock is legal, so the melded
      // play must outrank those actions as well. Shock alone is worth spending
      // only when its 1 damage ends the game.
      score = shouldLeadWithBurnUp(intent, input, own)
        ? 100
        : intent.meldSide === "right" && opponentLife <= 1
        ? 100
        : -100;
    } else if (functional === "lightning press|1") {
      const ownAttack = [...input.view.chain].reverse().find((link) => !link.resolved)?.attackingCard.owner === input.seat;
      score = input.view.pendingDecision?.kind === "attack-reaction" && ownAttack ? 18 : -20;
    } else if (functional === "cloud cover|1") {
      const link = [...input.view.chain].reverse().find((candidate) => !candidate.resolved);
      const incoming = preventableAttackDamage(input);
      const threatened = threatenedAttackDamage(input);
      const alreadySurvivesLethalAttack = !!link && Math.max(link.attackValue, threatened) >= me.life &&
        threatened < me.life;
      const usefulCombatWindow = input.view.pendingDecision?.kind === "defense-reaction" &&
        incoming > 0 && !alreadySurvivesLethalAttack;
      score = !myTurn && (usefulCombatWindow || opponentArcaneDamageOnStack(input))
        ? 16
        : -8;
    } else {
      score = myTurn ? 14 : 2;
    }
    if (
      functional !== "burn up // shock|1" &&
      functional !== "arcane seeds // life|1" &&
      "meldSide" in intent
    ) {
      score += intent.meldSide === "both" ? 8 : intent.meldSide === "left" ? 3 : 2;
    }
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input);
  }
  return score;
}

/** Projection-only reactive policy used outside clean action-phase planning. */
function chooseBriarReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    response: briarResponse,
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: arsenalValuer(briarSolverRules),
  });
}

export interface BriarIntentDecision {
  intent: GameIntent;
  /** Present for clean action-phase decisions made by the bounded turn planner. */
  plan?: BriarTurnPlan;
}

/** Deterministic Briar policy. Action phases use a bounded whole-turn rollout;
 * reactive windows retain the projection-only scorer. */
export function chooseBriarIntentWithTrace(input: BotPolicyInput): BriarIntentDecision {
  if (shouldPreserveOpeningHand(input)) {
    return { intent: enforceSpectraPolicy(input, chooseBriarReactiveIntent(input)) };
  }
  const plan = planBriarTurn(input, {
    chooseForced: (forced) => chooseBriarReactiveIntent({ ...forced, state: undefined }),
    rules: briarSolverRules,
    comparePitchOrder: compareBriarPitchOrder,
    scoreIntent: scoreBriarPlannedIntent,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    prepareCandidates: prepareBriarCandidates,
    fatiguePlan: isFatiguePlan(input),
  });
  const intent = enforceSpectraPolicy(
    input,
    plan?.intent ?? chooseBriarReactiveIntent(input),
  );
  return plan ? { intent, plan } : { intent };
}

export function chooseBriarIntent(input: BotPolicyInput): GameIntent {
  return chooseBriarIntentWithTrace(input).intent;
}
