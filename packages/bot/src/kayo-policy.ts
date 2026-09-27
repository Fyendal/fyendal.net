import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  currentLink,
  enforceSpectraPolicy,
  intentCard,
  isAttack,
  isOpeningTurn,
  optionCard,
  ownCards,
  pitchIds,
  responseEvaluation,
  resourcePaymentPitchIds,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  type BotPolicyInput,
} from "./policy.js";
import { planTacticalTurn, type TacticalIntentDecision } from "./tactical-turn-planner.js";

function named(data: CardData | undefined, name: string): boolean {
  return data?.name.trim().toLowerCase() === name;
}

/** Kayo's extra power applies in pitch and discard, not on the combat chain. */
function sixPlus(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  return isAttack(data) && (data?.attack ?? 0) + 1 >= 6;
}

function agilityReady(input: BotPolicyInput): boolean {
  return input.view.ongoing.some((effect) => effect.seat === input.seat && /next attack.*go again/i.test(effect.label));
}

function pitchHasSix(intent: GameIntent, input: BotPolicyInput): boolean {
  const own = ownCards(input);
  return input.view.players[input.seat].pitch.some((card) => sixPlus(card, input)) ||
    pitchIds(intent).some((id) => { const card = own.get(id); return !!card && sixPlus(card, input); });
}

function likelyGoAgain(data: CardData, intent: GameIntent, input: BotPolicyInput): boolean {
  if (named(data, "buckwild")) return pitchHasSix(intent, input);
  if (named(data, "wild ride")) return true;
  if (named(data, "mandible claw")) {
    // The rollout verifies the actual discard condition. The projection-only
    // fallback uses the public draw/discard attacks already on this chain.
    return input.view.chain.some((link) => link.resolved && link.attackingCard.owner === input.seat &&
      ["wild ride", "bare fangs"].includes(input.cards[link.attackingCard.cardId]?.name.toLowerCase() ?? ""));
  }
  return data.keywords?.includes("Go again") === true || (isAttack(data) && agilityReady(input));
}

function cardOpportunity(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (named(data, "agile windup")) return 9;
  if (isAttack(data)) return (data?.attack ?? 0) + (named(data, "wild ride") || named(data, "buckwild") ? 4 : 0);
  return data?.pitch ?? 0;
}

function nextTurnArsenal(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!isAttack(data)) return 0;
  const setup = input.view.players[input.seat].board.some((token) => named(input.cards[token.cardId], "agility"));
  if (named(data, "bare fangs")) return setup ? 85 : 45;
  if (named(data, "wild ride")) return 50;
  if (named(data, "agile windup") || named(data, "mighty windup")) return 5;
  return (data?.attack ?? 0) * (setup ? 9 : 5);
}

/** Resource-aware offensive value for selective blocks and rollout horizons.
 * Only the bot's visible cards participate; random draw/discard is valued as
 * potential rather than reading future deck positions. */
function estimateDamage(cards: readonly CardView[], input: BotPolicyInput): number {
  const me = input.view.players[input.seat];
  const handIds = new Set(me.hand.map((card) => card.instanceId));
  const initialSix = me.pitch.some((card) => sixPlus(card, input));
  const claw = me.weapons.find((card) => named(input.cards[card.cardId], "mandible claw"));
  const clawReady = !!claw && !claw.usedAbilityIndexes?.includes(0);
  function search(remaining: readonly CardView[], resources: number, pitchedSix: boolean,
    discardedSix: boolean, agility: boolean, weaponReady: boolean): number {
    let best = 0;
    const attacks = remaining.filter((card) => isAttack(input.cards[card.cardId]));
    const candidates = [...attacks, ...(weaponReady && claw ? [claw] : [])];
    for (const attack of candidates) {
      const data = input.cards[attack.cardId]!;
      const weapon = data.cardType === "weapon";
      const pitchable = remaining.filter((card) =>
        card.instanceId !== attack.instanceId && handIds.has(card.instanceId)
      );
      for (let mask = 0; mask < 2 ** pitchable.length; mask++) {
        const pitched = pitchable.filter((_, index) => (mask & 2 ** index) !== 0);
        const available = resources + pitched.reduce((sum, card) => sum + (input.cards[card.cardId]?.pitch ?? 0), 0);
        const cost = weapon ? 2 : data.cost ?? 0;
        if (available < cost) continue;
        const six = pitchedSix || pitched.some((card) => sixPlus(card, input));
        if (named(data, "bear hug") && !six) continue;
        if (named(data, "run roughshod") && !discardedSix) continue;
        const after = remaining.filter((card) => card.instanceId !== attack.instanceId && !pitched.includes(card));
        const discards = discardedSix || named(data, "wild ride");
        const go = weapon ? discardedSix : agility || named(data, "wild ride") || (named(data, "buckwild") && six);
        const followup = go ? search(after, available - cost, six, discards,
          weapon && agility, weapon ? false : weaponReady) : 0;
        best = Math.max(best, (data.attack ?? 0) + followup);
      }
    }
    return best;
  }
  return search(cards, me.resources, initialSix, false, agilityReady(input), clawReady);
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card && input.cards[card.cardId];
  if (!card || !data) return -100;
  const me = input.view.players[input.seat];
  const mine = input.view.activePlayer === input.seat;
  const used = new Set([card.instanceId, ...pitchIds(intent)]);
  const remaining = [...me.hand, ...me.arsenal].filter((candidate) => !used.has(candidate.instanceId));
  const attacks = remaining.filter((candidate) => isAttack(input.cards[candidate.cardId]));

  if (intent.kind === "activate-ability") {
    if (named(data, "agile windup")) {
      const alreadySetup = me.board.some((token) => named(input.cards[token.cardId], "agility"));
      if (alreadySetup) return -100;
      // Turn zero includes either player's opening turn: take the free setup
      // before refill, including when defending or holding priority in end.
      return input.view.turn === 1 ? 200 : mine && attacks.length > 0 ? 22 : -100;
    }
    if (named(data, "mighty windup")) return mine && attacks.length > 0 ? 5 : -100;
    if (named(data, "flat trackers")) {
      const reserve = me.arsenal.length === 0 && me.hand.some((candidate) => {
        const attack = input.cards[candidate.cardId];
        return isAttack(attack) && (attack?.attack ?? 0) >= 6 &&
          !["wild ride", "buckwild"].includes(attack!.name.toLowerCase());
      });
      const alreadySetup = me.board.some((token) => named(input.cards[token.cardId], "agility"));
      return mine && reserve && !alreadySetup ? 150 : -100;
    }
    if (named(data, "predatory plating")) {
      const current = currentLink(input);
      const short = attacks.some((candidate) => {
        const cost = input.cards[candidate.cardId]?.cost ?? 0;
        const otherPitch = me.hand.reduce((sum, handCard) => sum + (
          handCard.instanceId === candidate.instanceId ? 0 : input.cards[handCard.cardId]?.pitch ?? 0
        ), 0);
        return cost === me.resources + otherPitch + 1;
      });
      return mine && current?.attackingCard.owner === input.seat && short ? 40 : -100;
    }
    if (named(data, "unflinching foothold")) return currentLink(input)?.dominate && !mine ? 100 : -100;
    if (named(data, "knucklehead")) return -100;
    if (data.cardType !== "weapon") return -100;
  }
  if (data.cardType === "defense-reaction") return scoreDefenseReaction(data, input);
  if (!isAttack(data) && data.cardType !== "weapon") return -100;
  if (isOpeningTurn(input) && !/briar|kayo|fai/i.test(input.view.players[1 - input.seat]!.heroName)) return -100;
  // Once the boots are gone, reserve the high attack for next turn's Agility.
  if (me.arsenal.length === 0 && me.board.some((token) => named(input.cards[token.cardId], "agility")) &&
      nextTurnArsenal(card, input) >= 54 && attacks.length === 0 &&
      input.view.players[1 - input.seat]!.life > (data.attack ?? 0)) return -100;
  let score = 12 + (data.attack ?? 0);
  if (likelyGoAgain(data, intent, input) && attacks.length > 0) score += 40;
  // Claw belongs between the draw/discard opener and the finisher. A fresh
  // Might token also records useful setup, without inspecting engine flags.
  if (data.cardType === "weapon" && attacks.length > 0 &&
      me.board.some((token) => named(input.cards[token.cardId], "might"))) score += 40;
  if (named(data, "rough up") && pitchHasSix(intent, input)) score++;
  if (named(data, "bare fangs")) score += 2;
  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= cardOpportunity(pitched, input) * 0.6 + 1;
  }
  return score;
}

function chooseReactive(input: BotPolicyInput): GameIntent {
  const hasAgility = input.view.players[input.seat].board.some((token) => named(input.cards[token.cardId], "agility"));
  if (input.view.turn === 1 && !hasAgility) {
    const own = ownCards(input);
    const windup = input.legal.find((intent) => intent.kind === "activate-ability" &&
      named(input.cards[intentCard(intent, own)?.cardId ?? ""], "agile windup"));
    if (windup) return windup;
  }
  return chooseScoredIntent(input, {
    play: scorePlay,
    nextTurnArsenal,
    defend: (intent, observed, own) => scoreDefenseIntent(intent, observed, own, {
      cardOpportunity,
      offensiveCards: (policy) => [
        ...policy.view.players[policy.seat].hand, ...policy.view.players[policy.seat].arsenal,
      ],
      evaluateResponse: (cards, policy) => responseEvaluation({ damageThreatened: estimateDamage(cards, policy) }),
      responseLossWeight: 1.3,
    }),
    choose: (intent, observed) => {
      if (observed.view.pendingDecision?.kind === "arsenal") {
        return scoreArsenalChoice(intent, observed, nextTurnArsenal);
      }
      // Revealing to Strongest Survive preserves the card; spending a lower
      // value discard is never preferable when a legal reveal is offered.
      if (intent.optionId.startsWith("reveal:")) return 100;
      const payment = resourcePaymentPitchIds(intent, observed);
      if (payment !== undefined) {
        const own = ownCards(observed);
        const pitchCost = payment.reduce((sum, id) => {
          const card = own.get(id);
          return sum + (card ? cardOpportunity(card, observed) : 0);
        }, 0);
        const link = currentLink(observed);
        const lethal = link?.attackingCard.owner === observed.seat &&
          link.attackValue >= observed.view.players[1 - observed.seat]!.life;
        return (lethal ? 100 : 5) - pitchCost * 2;
      }
      const binary = scoreBinaryChoice(intent.optionId, 4, 0);
      if (binary !== undefined) return binary;
      if (/discard|pitch/i.test(observed.view.pendingDecision?.prompt ?? "")) {
        return scoreSpendCardChoice(intent, observed, cardOpportunity);
      }
      const card = optionCard(intent, observed);
      return card ? cardOpportunity(card, observed) : 0;
    },
  });
}

export function chooseKayoIntentWithTrace(input: BotPolicyInput): TacticalIntentDecision {
  const reactive = chooseReactive(input);
  const rootScore = scorePlay(reactive, input, ownCards(input));
  // Setup and opening decisions are explicit; action rollouts then account for
  // actual costs, random discards, go again, and Claw's once-per-turn limit.
  if (input.view.turn === 1 || rootScore >= 150) return { intent: enforceSpectraPolicy(input, reactive) };
  const plan = planTacticalTurn(input, {
    chooseForced: (forced) => chooseReactive({ ...forced, state: undefined }),
    cardOpportunity, nextTurnArsenal, estimateRemaining: estimateDamage,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    prepareCandidates: (candidates, observed) => candidates.filter((intent) =>
      intent.kind === "pass" || intent.kind === "close-chain" || scorePlay(intent, observed, ownCards(observed)) > 0
    ),
    maxSearchNodes: 48, maxTransitions: 160, maxRootCandidates: 3,
  });
  const intent = enforceSpectraPolicy(input, plan?.intent ?? reactive);
  return plan ? { intent, plan } : { intent };
}

export function chooseKayoIntent(input: BotPolicyInput): GameIntent {
  return chooseKayoIntentWithTrace(input).intent;
}
