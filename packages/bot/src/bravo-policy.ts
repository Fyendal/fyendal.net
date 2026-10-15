import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  committedEffectAmount,
  currentAttackIsOurs,
  currentLink,
  enforceSpectraPolicy,
  functionalKey as key,
  incomingAttackDamage,
  intentCard,
  isAttack,
  opponentDamageEffectOnStack,
  optionCard,
  ownCards,
  pitchIds,
  resourcesAfterCost,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  visibleOpponentDamageAmount,
  type BotPolicyInput,
  type ResponseModel,
} from "./policy.js";
import { abilitySource, type HeroSolverRules } from "./card-model.js";
import { guardianPatch } from "./guardian-rules.js";
import { arsenalValuer, handResponse, opportunityValuer } from "./hand-value.js";
import {
  chooseTacticalIntentWithTrace,
  type TacticalTurnPlan,
} from "./tactical-turn-planner.js";

function attackCost(data: CardData): number {
  return data.cardType === "weapon" ? 3 : Math.max(0, data.cost ?? 0);
}

function isWizardFatigueMatchup(input: BotPolicyInput): boolean {
  const opponent = input.view.players[1 - input.seat]!.heroName.trim().toLowerCase();
  return opponent.includes("blaze") || opponent.includes("kano");
}

function attackValue(data: CardData, input: BotPolicyInput): number {
  let value = data.attack ?? 0;
  const text = data.text.toLowerCase();
  if (text.includes("put a card from their hand on top")) value += 5;
  else if (text.includes("put a card from their arsenal")) value += 4;
  else if (text.includes("put a -1") && text.includes("equipment")) value += 3;
  else if (text.includes("costs an additional")) value += 3;
  else if (text.includes("can't gain") || text.includes("gets -2")) value += 3;
  if (data.keywords?.includes("Dominate")) value += 2;
  if (key(data) === "fault line|1" && input.view.players[input.seat].arsenalCount > 0) value += 1;
  return value;
}

/** Arcane Polarity's life gain while held: the larger amount once arcane
 * damage has been dealt this turn. */
function lifeGainAlternative(data: CardData, input: BotPolicyInput): number {
  if (data.cardType !== "instant") return 0;
  const arcaneTaken = input.view.turnFacts?.players[input.seat].arcaneDamageTaken === true;
  return Number(
    (arcaneTaken ? /if you've been dealt arcane damage this turn, instead gain (\d+)\{h\}/i : /^gain (\d+)\{h\}/im)
      .exec(data.text)?.[1] ?? 0,
  );
}

/** Hand-value rules: shared Guardian cards, Fault Line, Arcane Polarity,
 * and Bravo's ability turning a face-down Crush arsenal card face up for
 * +2{p} (go again). */
function bravoSolverRules(input: BotPolicyInput): HeroSolverRules {
  const me = input.view.players[input.seat];
  const nextTurn = input.view.activePlayer !== input.seat;
  const faceDownCrush = heroArsenalAttack(input);
  return {
    name: "bravo",
    trackedTraits: [],
    card(data, card) {
      const patch = guardianPatch(data, card, input);
      const power = card.attack ?? data.attack ?? 0;
      if (key(data) === "fault line|1" && me.arsenalCount > 0) {
        patch.powerIn = () => power + 1;
        patch.uses = { ...patch.uses, power: power + 1 };
      }
      const alternative = lifeGainAlternative(data, input);
      if (alternative > 0) patch.uses = { ...patch.uses, alternative };
      return patch;
    },
    abilities() {
      if (!faceDownCrush || (!nextTurn && me.heroTapped)) return [];
      return [abilitySource({
        instanceId: me.heroInstanceId,
        cardId: me.heroCardId,
        name: "Bravo, Flattering Showman",
        cost: 2,
        goAgain: true,
        canPlay: (view) => view.held.some((card) => card.instanceId === faceDownCrush.instanceId),
        after: () => ({
          pending: [{
            key: "bravo-showman",
            uses: 1,
            power: 2,
            appliesTo: (card) => card.instanceId === faceDownCrush.instanceId,
          }],
        }),
      })];
    },
  };
}

const cardOpportunity = opportunityValuer(bravoSolverRules);

function offensiveCards(input: BotPolicyInput): readonly CardView[] {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal];
}

const bravoResponse: ResponseModel = {
  offensiveCards,
  evaluateResponse: (cards, input) => handResponse(cards, input, bravoSolverRules),
};

function committedOasisPrevention(input: BotPolicyInput): number {
  return committedEffectAmount(
    input,
    "oasis respite|1",
    4,
    (label) => Number(/prevent next (\d+) damage/i.exec(label)?.[1] ?? 4),
  );
}

function damageWorthOasis(input: BotPolicyInput): number {
  const attack = Math.max(
    0,
    incomingAttackDamage(input) - (currentLink(input)?.damageToPrevent ?? 0),
  );
  const effect = opponentDamageEffectOnStack(input)
    ? Math.max(0, (visibleOpponentDamageAmount(input) ?? 0) - committedOasisPrevention(input))
    : 0;
  return Math.max(attack, effect);
}

/** Static Shock asks Bravo to spend a card either now for three physical
 * defense or later as Arcane Barrier pitch for only one prevention. When its
 * Lightning Flow on-hit is represented and a three-block is available, take
 * the efficient use of the card during defense. */
function shouldBlockStaticShockWithThree(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  const attack = input.cards[link?.attackingCard.cardId ?? ""];
  if (attack?.name.trim().toLowerCase() !== "static shock") return false;
  if (!link?.onHitEffects?.some((effect) => /arcane damage/i.test(effect.text))) return false;

  const me = input.view.players[input.seat];
  const hand = new Map(me.hand.map((card) => [card.instanceId, card]));
  return input.legal.some((intent) =>
    intent.kind === "stage-defenders" && intent.instanceIds.some((id) => {
      const card = hand.get(id);
      return card !== undefined && (card.defense ?? input.cards[card.cardId]?.defense ?? 0) >= 3;
    })
  );
}

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    ...bravoResponse,
    cardOpportunity,
    responseLossWeight: isWizardFatigueMatchup(input) ? 0.1 : 1,
    defensePermission: (candidate) => {
      if (!shouldBlockStaticShockWithThree(candidate.input)) return "allow";
      const handIds = new Set(candidate.input.view.players[candidate.input.seat].hand.map(
        (card) => card.instanceId,
      ));
      return candidate.chosen.some((card) =>
          handIds.has(card.instanceId) &&
          (card.defense ?? candidate.input.cards[card.cardId]?.defense ?? 0) >= 3
        )
        ? "require"
        : "allow";
    },
  });
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  if (decision.promptMessage?.id === "card.sly.oasis.hero.choose") {
    return intent.optionId === "your hero" ? 100 : -100;
  }
  if (decision.promptMessage?.id === "card.sly.damage.source.choose") {
    const link = currentLink(input);
    const attackSource = link?.attackingCard.owner !== input.seat
      ? link?.attackingCard.instanceId
      : undefined;
    const stackSource = input.view.stack.find((layer) => layer.seat !== input.seat)
      ?.card?.instanceId;
    const desired = attackSource ?? stackSource;
    return desired !== undefined && intent.optionId === String(desired) ? 100 : -100;
  }
  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, arsenalValuer(bravoSolverRules));
  }
  const card = optionCard(intent, input);
  if (/reveal|clash/i.test(decision.prompt) && card) {
    return 20 + Math.max(card.attack ?? input.cards[card.cardId]?.attack ?? 0, 0);
  }
  if (/discard|bottom of your deck|put a card from your hand on top/i.test(decision.prompt)) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 20, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 10, -2);
  if (binary !== undefined) return binary;
  return card ? 10 + cardOpportunity(card, input) : 1;
}

function remainingSingleCardPitch(
  intent: GameIntent,
  input: BotPolicyInput,
): number {
  const spent = new Set(pitchIds(intent));
  return input.view.players[input.seat].hand.reduce((best, card) =>
    spent.has(card.instanceId)
      ? best
      : Math.max(best, Number(input.cards[card.cardId]?.pitch ?? 0)),
  0);
}

function heroArsenalAttack(input: BotPolicyInput): CardView | undefined {
  return input.view.players[input.seat].arsenal.find((card) => {
    const data = input.cards[card.cardId];
    return card.faceDown !== false && isAttack(data) && data?.keywords?.includes("Crush");
  });
}

function scorePlay(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -20;
  const functional = key(data);
  const oasisDamage = functional === "oasis respite|1" ? damageWorthOasis(input) : 0;
  if (shouldPreserveOpeningHand(input) && oasisDamage === 0) return -100;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;

  let score = 0;
  if (intent.kind === "activate-ability") {
    if (functional === "bravo, flattering showman|0") {
      if (isWizardFatigueMatchup(input)) return -100;
      const attack = heroArsenalAttack(input);
      const attackData = attack ? input.cards[attack.cardId] : undefined;
      const floating = resourcesAfterCost(intent, 2, input, own);
      const canAttack = attackData !== undefined &&
        floating + remainingSingleCardPitch(intent, input) >= attackCost(attackData);
      score = canAttack ? 40 + attackValue(attackData, input) : -100;
    } else if (data.cardType === "weapon") {
      score = 8 + (data.attack ?? 0);
    } else {
      score = 2;
    }
  } else if (isAttack(data)) {
    score = 20 + attackValue(data, input);
    if (intent.kind === "play-from-arsenal") score += 3;
  } else if (data.cardType === "attack-reaction") {
    const link = currentLink(input);
    if (!currentAttackIsOurs(input) || input.view.pendingDecision?.kind !== "attack-reaction") {
      score = -100;
    } else if (functional === "pummel|1" && link) {
      const damageAfterPummel = link.attackValue + 4 - link.defenseValue;
      score = damageAfterPummel >= 4 ? 48 : damageAfterPummel > 0 ? 34 : -20;
    } else {
      score = 8;
    }
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (functional === "oasis respite|1") {
    score = oasisDamage > 0 ? 60 + Math.min(oasisDamage, 4) * 10 : -100;
  } else if (functional === "arcane polarity|1") {
    score = input.view.turnFacts?.players[input.seat].arcaneDamageTaken ? 28 : -100;
  } else if (functional === "edge of their seats|3") {
    score = -20;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input) * 0.5;
  }
  score -= Math.max(0, pitchIds(intent).length - 1) * 10;
  return score;
}

function chooseBravoReactiveIntent(input: BotPolicyInput): GameIntent {
  if (isWizardFatigueMatchup(input)) {
    const payments = input.legal.flatMap((intent) => {
      if (intent.kind !== "choose") return [];
      const amount = /^pay (\d+)$/.exec(intent.optionId)?.[1];
      return amount === undefined ? [] : [{ intent, amount: Number(amount) }];
    });
    if (payments.length > 0 &&
      (input.view.pendingDecision?.promptMessage?.id === "engine.decision.damage.arcane.barrier" ||
        /arcane barrier/i.test(input.view.pendingDecision?.prompt ?? ""))) {
      return payments.reduce((best, candidate) =>
        candidate.amount > best.amount ? candidate : best
      ).intent;
    }
  }
  return chooseScoredIntent(input, {
    response: bravoResponse,
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: arsenalValuer(bravoSolverRules),
  });
}

/** Deterministic Bravo policy: retain one large attack plus its best pitch and
 * validate its ranked clean-turn opening. Into Blaze and Kano, keep that
 * pressure but reserve blue pitch for AB3 instead of the hero activation. */
export interface BravoIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

export function chooseBravoIntentWithTrace(input: BotPolicyInput): BravoIntentDecision {
  const reactive = chooseBravoReactiveIntent(input);
  const decision = chooseTacticalIntentWithTrace(input, reactive, {
    chooseForced: (forced) => chooseBravoReactiveIntent({ ...forced, state: undefined }),
    rules: bravoSolverRules,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    rootScore: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
  });
  const intent = enforceSpectraPolicy(input, decision.intent);
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

export function chooseBravoIntent(input: BotPolicyInput): GameIntent {
  return chooseBravoIntentWithTrace(input).intent;
}
