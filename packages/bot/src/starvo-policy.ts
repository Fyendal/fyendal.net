import { precon } from "@fyendal/cards";
import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  allyLethalThreshold,
  attackIntentVariantKey,
  chooseScoredIntent,
  currentAttackIsOurs,
  currentLink,
  enforceSpectraPolicy,
  functionalKey,
  incomingAttackDamage,
  intentCard,
  isAttack,
  opponentAllies,
  optionCard,
  ownCards,
  pitchIds,
  resourcePaymentPitchIds,
  resourcesAfterCost,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  targetableAttackIntent,
  type BotPolicyInput,
  type ResponseEvaluation,
  type ResponseModel,
} from "./policy.js";
import {
  chooseTacticalIntentWithTrace,
  type TacticalIntentConfig,
  type TacticalTurnPlan,
} from "./tactical-turn-planner.js";
import { abilitySource, cardUses, type HeroSolverRules, type ModelContext } from "./card-model.js";
import { PITCH_FUNDING_RATE, standaloneValue } from "./card-ev.js";
import { unseenCounts } from "./deck-knowledge.js";
import { guardianPatch } from "./guardian-rules.js";
import type { PendingEffect, SolverCard, SolverView } from "./hand-solver.js";
import { arsenalValuer, handResponse, opportunityValuer } from "./hand-value.js";
import { evaluateOnHit } from "./on-hit.js";
import { adjustValueBreakdown } from "./value.js";

export interface StarvoIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

const STARVO_DECK_ID = "bot-starvo-boss";
const STARVO = "bravo, star of the show|0";
const WINTERS_WAIL = "winter's wail|0";
const CROWN = "crown of seeds|0";
const TUNIC = "fyendal's spring tunic|0";
const STALAGMITE = "stalagmite, bastion of isenloft|0";
const HEART_OF_ICE = "heart of ice|0";
const SHOCK_CHARMERS = "shock charmers|0";
const BALANCE = "balance of justice|0";
const PULSE_VOLTHAVEN = "pulse of volthaven|1";
const AWAKENING = "awakening|3";
const OAKEN_OLD = "oaken old|1";
const CRIPPLING_CRUSH = "crippling crush|1";
const SPINAL_CRUSH = "spinal crush|1";
const FELLING = "felling of the crown|1";
const TILLING_RED = "cadaverous tilling|1";
const CHANNEL_LAKE = "channel lake frigid|3";
const BLIZZARD = "blizzard|3";
const CHUM = "chum, friendly first mate|2";
const SAWBONES = "sawbones, dock hand|2";

const STARVO_MAX_SEARCH_NODES = 24;
const STARVO_MAX_TRANSITIONS = 80;
const STARVO_MAX_ROOT_CANDIDATES = 4;
const STARVO_MAX_ACTION_DEPTH = 6;
const STARVO_MAX_FORCED_STEPS = 32;
const STARVO_FIRST_ROOT_TRANSITIONS = STARVO_MAX_TRANSITIONS;
const STARVO_FIRST_ROOT_NODES = 18;

const registered = precon(STARVO_DECK_ID);
if (!registered) throw new Error("Starvo boss deck is not registered");
const STARVO_REGISTERED_DECK = [
  ...registered.pool.deck,
  ...(registered.pool.sideboard ?? []),
] as const;

function key(card: CardData | undefined): string {
  return functionalKey(card);
}

function hasSubtype(data: CardData | undefined, subtype: string): boolean {
  return data?.subtypes?.some((value) => value.toLowerCase() === subtype) === true;
}

function attackCost(data: CardData): number {
  return data.cardType === "weapon" ? 3 : Math.max(0, data.cost ?? 0);
}

function isEligibleStarvoAttack(data: CardData | undefined): boolean {
  return !!data && isAttack(data) && (data.cost ?? 0) >= 3;
}

function isCompatiblePulseAttack(data: CardData | undefined): boolean {
  return !!data && (isAttack(data) || data.cardType === "weapon") &&
    ["ice", "lightning", "elemental"].some((subtype) => hasSubtype(data, subtype));
}

function canRevealElements(cards: readonly CardView[], input: BotPolicyInput): boolean {
  return ["earth", "ice", "lightning"].every((subtype) =>
    cards.some((card) => hasSubtype(input.cards[card.cardId], subtype))
  );
}

function earthBanished(input: BotPolicyInput): number {
  return input.view.players[input.seat].banish.filter((card) =>
    hasSubtype(input.cards[card.cardId], "earth")
  ).length;
}

function canDecompose(input: BotPolicyInput): boolean {
  const graveyard = input.view.players[input.seat].graveyard;
  return graveyard.some((first) => hasSubtype(input.cards[first.cardId], "earth") &&
    graveyard.some((second) => second.instanceId !== first.instanceId &&
      hasSubtype(input.cards[second.cardId], "earth") && graveyard.some((action) =>
        action.instanceId !== first.instanceId && action.instanceId !== second.instanceId &&
        input.cards[action.cardId]?.cardType === "action"
      )
    )
  );
}

function starvoBonusActive(input: BotPolicyInput): boolean {
  return input.view.ongoing.some((effect) =>
    effect.seat === input.seat && key(input.cards[effect.cardId]) === STARVO &&
    /dominate/i.test(effect.label) && /go again/i.test(effect.label)
  );
}

function pulseBonusActive(input: BotPolicyInput): boolean {
  return input.view.ongoing.some((effect) =>
    effect.seat === input.seat && key(input.cards[effect.cardId]) === PULSE_VOLTHAVEN
  );
}

function aggressiveOpponent(input: BotPolicyInput): boolean {
  const opponent = input.view.players[1 - input.seat]!;
  const name = opponent.heroName.toLowerCase();
  const classes = input.cards[opponent.heroCardId]?.classes?.map((value) =>
    value.toLowerCase()
  ) ?? [];
  return classes.some((value) => ["ninja", "runeblade", "mechanologist"].includes(value)) ||
    ["arakni, marionette", "aurora", "cindra", "dash", "fai", "ira", "oscilio"]
      .some((candidate) => name.includes(candidate));
}

function meaningfulIncomingOnHit(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link || link.attackingCard.owner === input.seat) return false;
  const attacker = input.view.players[1 - input.seat]!;
  return evaluateOnHit({
    effects: link.onHitEffects ?? [],
    sourceText: input.cards[link.attackingCard.cardId]?.text,
    attackerCanContinue: link.goAgain === true,
    attackerCanArsenal: attacker.arsenalCount === 0,
    defenderHasHand: input.view.players[input.seat].handCount > 0,
    defenderHasArsenal: input.view.players[input.seat].arsenalCount > 0,
  }).value > 0 || link.wagered === true;
}

function attackPressure(data: CardData, input: BotPolicyInput): number {
  const functional = key(data);
  let attack = Math.max(0, data.attack ?? 0);
  if (functional === FELLING && earthBanished(input) >= 4) attack += 4;
  if (functional === TILLING_RED && canDecompose(input)) attack += 2;
  if (isEligibleStarvoAttack(data) && starvoBonusActive(input)) attack += 2;
  if (isCompatiblePulseAttack(data) && pulseBonusActive(input)) attack += 4;
  return attack;
}

function disruptionValue(data: CardData, input: BotPolicyInput): number {
  const functional = key(data);
  if (functional === OAKEN_OLD) return 8;
  if (functional === CRIPPLING_CRUSH) return 7;
  if (functional === SPINAL_CRUSH) return aggressiveOpponent(input) ? 7 : 4;
  if (functional === FELLING && earthBanished(input) >= 4) return 4;
  if (functional === TILLING_RED && canDecompose(input) && earthBanished(input) < 4) return 3;
  if (functional === WINTERS_WAIL) return 3;
  if (functional === CHANNEL_LAKE) return aggressiveOpponent(input) ? 6 : 2;
  return data.keywords?.some((keyword) => keyword.toLowerCase() === "crush") ? 3 : 0;
}

const cardOpportunity = opportunityValuer(starvoSolverRules);

function availablePitch(
  cards: readonly CardView[],
  excluded: ReadonlySet<number>,
  input: BotPolicyInput,
): number {
  return cards.reduce((total, card) => excluded.has(card.instanceId)
    ? total
    : total + Math.max(0, input.cards[card.cardId]?.pitch ?? 0), 0);
}

function hasIcePitch(
  cards: readonly CardView[],
  excluded: ReadonlySet<number>,
  input: BotPolicyInput,
): boolean {
  return cards.some((card) => !excluded.has(card.instanceId) &&
    (input.cards[card.cardId]?.pitch ?? 0) > 0 && hasSubtype(input.cards[card.cardId], "ice"));
}

/** Awakening while behind on life: Seismic Surge tokens equal to the
 * difference (twice that if fused with a held Earth card), and a tutored
 * Guardian attack costing at most that many. The tutor replaces a random draw
 * with the best eligible card left in the deck; the Surges discount its cost. */
function awakeningValue(input: BotPolicyInput, card: CardView, context: ModelContext): number {
  const me = input.view.players[input.seat];
  const deficit = input.view.players[1 - input.seat]!.life - me.life;
  if (deficit <= 0) return 0;
  const fused = me.hand.some((held) =>
    held.instanceId !== card.instanceId && hasSubtype(input.cards[held.cardId], "earth")
  );
  const surges = fused ? deficit * 2 : deficit;
  const counts = unseenCounts(input, "own");
  if (!counts) return 0;
  let best = 0;
  for (const cardId of counts.keys()) {
    const data = input.cards[cardId];
    if (
      !data || !isAttack(data) || data.cardType !== "action" ||
      !data.classes?.some((cardClass) => cardClass.toLowerCase() === "guardian")
    ) continue;
    const cost = Math.max(0, data.cost ?? 0);
    if (cost > surges) continue;
    best = Math.max(best, standaloneValue(cardUses(data, input), context.hitChance) + cost * PITCH_FUNDING_RATE);
  }
  return best;
}

/** Starvo's hero bonus: the next attack action card with cost 3+ gains +2{p},
 * dominate and go again. */
function starvoHeroBonus(key: string): PendingEffect {
  return { key, uses: 1, power: 2, grantsGoAgain: true, appliesTo: (card) => card.kind === "attack" && card.cost >= 3 };
}

/** Hand-value rules: shared Guardian cards, disruption riders as on-hit
 * value, active Pulse/hero bonuses, and the start-of-turn element reveal. */
function starvoSolverRules(input: BotPolicyInput): HeroSolverRules {
  const me = input.view.players[input.seat];
  return {
    name: "starvo",
    trackedTraits: [],
    startPending(observed, nextTurn) {
      if (nextTurn) return [];
      return [
        ...(starvoBonusActive(observed) ? [starvoHeroBonus("starvo-active")] : []),
        ...(pulseBonusActive(observed)
          ? [{
            key: "pulse-active",
            uses: 1,
            power: 4,
            appliesTo: (card: SolverCard, view: SolverView) =>
              ["ice", "lightning", "elemental"].some((element) => view.hasTrait(card, element)),
          }]
          : []),
      ];
    },
    card(data, card, context) {
      const patch = guardianPatch(data, card, input);
      const disruption = disruptionValue(data, input);
      if (disruption > 0 && (isAttack(data) || data.cardType === "weapon")) {
        patch.onHit = disruption;
        patch.uses = { ...patch.uses, onHit: disruption };
      } else if (disruption > 0) {
        patch.bonusIn = () => disruption;
      }
      if (key(data) === AWAKENING) {
        const alternative = awakeningValue(input, card, context);
        if (alternative > 0) patch.uses = { ...patch.uses, alternative };
      }
      return patch;
    },
    abilities(_context, nextTurn) {
      // The reveal happens at the start of Starvo's turn.
      if (!nextTurn) return [];
      return [abilitySource({
        instanceId: me.heroInstanceId,
        cardId: me.heroCardId,
        name: "Bravo, Star of the Show",
        cost: 0,
        speed: "instant",
        canPlay: (view) => view.flag("played") === 0 && view.flag("attacks") === 0 &&
          ["earth", "ice", "lightning"].every((element) =>
            view.held.some((held) => held.zone === "hand" && view.hasTrait(held, element))
          ),
        after: () => ({ pending: [starvoHeroBonus("starvo-reveal")] }),
      })];
    },
  };
}

function offensiveCards(input: BotPolicyInput): readonly CardView[] {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal];
}

const starvoResponse: ResponseModel = {
  offensiveCards,
  evaluateResponse: (cards, input) => handResponse(cards, input, starvoSolverRules),
};

/** Arsenal cards worth protecting with a held reveal (Pulse decisions). */
function isPremiumArsenal(data: CardData | undefined, input: BotPolicyInput): boolean {
  const functional = key(data);
  if (!data) return false;
  if (functional === OAKEN_OLD || functional === CRIPPLING_CRUSH || functional === SPINAL_CRUSH) return true;
  return isEligibleStarvoAttack(data) && attackPressure(data, input) + disruptionValue(data, input) >= 15;
}

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    ...starvoResponse,
    cardOpportunity,
    // Play style: Starvo protects its large-attack turns over chip prevention.
    responseLossWeight: 2.25,
    defensePermission(candidate) {
      const usesTunic = candidate.chosen.some((card) => key(input.cards[card.cardId]) === TUNIC);
      if (usesTunic && !candidate.lethal) return "forbid";
      const usesStalagmite = candidate.chosen.some((card) =>
        key(input.cards[card.cardId]) === STALAGMITE
      );
      if (!usesStalagmite) return "allow";
      const consequential = currentLink(candidate.input)?.goAgain === true ||
        candidate.onHit.value > 0 || candidate.lethal;
      const handAlternative = bestHandOnlyCoverResponse(candidate.input);
      const candidateResponse = responseAfterDefense(candidate.intent, candidate.input).total;
      if (handAlternative !== undefined && handAlternative >= candidateResponse) return "forbid";
      return consequential ? "allow" : "forbid";
    },
    adjustCycleValue(value, candidate) {
      const usesStalagmite = candidate.chosen.some((card) =>
        key(candidate.input.cards[card.cardId]) === STALAGMITE
      );
      if (!usesStalagmite) return value;
      const adjustment = currentLink(candidate.input)?.goAgain === true ||
          candidate.onHit.value > 0 || candidate.lethal
        ? 7
        : -12;
      return adjustValueBreakdown(value, {
        strategicAdjustment: value.strategicAdjustment + adjustment,
      });
    },
  });
}

function defenseValue(intent: Extract<GameIntent, { kind: "defend" }>, input: BotPolicyInput): number {
  const own = ownCards(input);
  return intent.instanceIds.reduce((total, id) => {
    const card = own.get(id);
    return total + Math.max(0, card?.defense ?? input.cards[card?.cardId ?? ""]?.defense ?? 0);
  }, 0);
}

function responseAfterDefense(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
): ResponseEvaluation {
  const spent = new Set([...intent.instanceIds, ...(intent.pitchInstanceIds ?? [])]);
  return handResponse(
    offensiveCards(input).filter((card) => !spent.has(card.instanceId)),
    input,
    starvoSolverRules,
  );
}

function bestHandOnlyCoverResponse(input: BotPolicyInput): number | undefined {
  const incoming = incomingAttackDamage(input);
  const handIds = new Set(input.view.players[input.seat].hand.map((card) => card.instanceId));
  const responses = input.legal
    .filter((intent): intent is Extract<GameIntent, { kind: "defend" }> =>
      intent.kind === "defend" && intent.instanceIds.length > 0 &&
      intent.instanceIds.every((id) => handIds.has(id)) && defenseValue(intent, input) >= incoming
    )
    .map((intent) => responseAfterDefense(intent, input).total);
  return responses.length > 0 ? Math.max(...responses) : undefined;
}

function scoreRevealChoice(intent: Extract<GameIntent, { kind: "choose" }>): number | undefined {
  if (!/^\d+:\d+:\d+$/.test(intent.optionId)) return undefined;
  const ids = intent.optionId.split(":");
  return 120 - new Set(ids).size * 10;
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  const prompt = decision.prompt.toLowerCase();
  const card = optionCard(intent, input);
  if (prompt.includes("reveal an earth, an ice, and a lightning card")) {
    return scoreRevealChoice(intent) ?? -100;
  }
  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, arsenalValuer(starvoSolverRules));
  }
  if (decision.resourcePayment) {
    const ids = resourcePaymentPitchIds(intent, input) ?? [];
    const own = ownCards(input);
    return 40 - ids.reduce((total, id) => {
      const held = own.get(id);
      return total + (held ? cardOpportunity(held, input) : 0);
    }, 0);
  }
  if (prompt.includes("guardian attack") && card) {
    const data = input.cards[card.cardId];
    return data ? 40 + attackPressure(data, input) + disruptionValue(data, input) : -100;
  }
  if (prompt.includes("fuse")) {
    if (intent.optionId.startsWith("both:")) return 110;
    if (intent.optionId.startsWith("ice:") || intent.optionId.startsWith("earth:")) return 60;
    return -20;
  }
  if (prompt.includes("decompose")) {
    const tooEarly = prompt.includes("felling of the crown") && earthBanished(input) < 4;
    if (intent.optionId === "no") return tooEarly ? 25 : -40;
    return tooEarly ? -20 : 70;
  }
  if (prompt.includes("attack actions to return") ||
    prompt.includes("choose another attack action")) {
    if (!card) return intent.optionId === "done" ? 0 : -50;
    return card.owner === input.seat ? 50 + cardOpportunity(card, input) : -100;
  }
  if (prompt.includes("discard") || prompt.includes("bottom of your deck") ||
    prompt.includes("put a card from your hand")) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 30, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 20, -5);
  if (binary !== undefined) return binary;
  return card ? 10 + cardOpportunity(card, input) : 1;
}

function hasCompatiblePulseFollowUp(input: BotPolicyInput, pulseId?: number): boolean {
  if (input.view.activePlayer !== input.seat) return false;
  const own = ownCards(input);
  return input.legal.some((intent) => {
    if (!targetableAttackIntent(intent)) return false;
    const card = intentCard(intent, own);
    if (!card || card.instanceId === pulseId || pitchIds(intent).includes(pulseId ?? -1)) return false;
    return isCompatiblePulseAttack(input.cards[card.cardId]);
  });
}

function hasFriendlySomersaultTarget(input: BotPolicyInput, intent: GameIntent): boolean {
  const link = currentLink(input);
  const somersault = intentCard(intent, ownCards(input));
  const data = input.cards[somersault?.cardId ?? ""];
  if (!link || link.resolved || !data) return false;
  const minimumCost = Math.max(0, Number(data.pitch ?? 1) - 1);
  return [link.attackingCard, ...link.defendingCards].some((card) =>
    card.owner === input.seat && isAttack(input.cards[card.cardId]) &&
    Number(input.cards[card.cardId]?.cost ?? 0) >= minimumCost
  );
}

function isElectromagneticSomersault(intent: GameIntent, input: BotPolicyInput): boolean {
  const card = intentCard(intent, ownCards(input));
  return key(input.cards[card?.cardId ?? ""]).startsWith("electromagnetic somersault|");
}

function remainingCardsAfterIntent(intent: GameIntent, input: BotPolicyInput): CardView[] {
  const own = ownCards(input);
  const spent = new Set(pitchIds(intent));
  const played = intentCard(intent, own);
  if (played && input.view.players[input.seat].hand.some((card) =>
    card.instanceId === played.instanceId
  )) spent.add(played.instanceId);
  return input.view.players[input.seat].hand.filter((card) => !spent.has(card.instanceId));
}

function canFundWailAfter(intent: GameIntent, data: CardData, input: BotPolicyInput): boolean {
  if (!isEligibleStarvoAttack(data) || !starvoBonusActive(input)) return false;
  const wail = input.view.players[input.seat].weapons.find((card) =>
    key(input.cards[card.cardId]) === WINTERS_WAIL && !(card.usedAbilityIndexes ?? []).includes(0)
  );
  if (!wail) return false;
  const remaining = remainingCardsAfterIntent(intent, input);
  return resourcesAfterCost(intent, attackCost(data), input) + availablePitch(
    remaining,
    new Set(),
    input,
  ) >= 3 && hasIcePitch(remaining, new Set(), input);
}

function awakeningIsLive(intent: GameIntent, input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  const opponent = input.view.players[1 - input.seat]!;
  const lifeGap = opponent.life - me.life;
  if (lifeGap <= 0 || !remainingCardsAfterIntent(intent, input).some((card) =>
    hasSubtype(input.cards[card.cardId], "earth")
  )) return false;
  return [...registeredDeckRemaining(input)].some(([cardId, count]) => {
    const data = input.cards[cardId];
    return count > 0 && isAttack(data) &&
      data?.classes?.some((cardClass) => cardClass.toLowerCase() === "guardian") === true &&
      (data.cost ?? Number.POSITIVE_INFINITY) <= lifeGap && disruptionValue(data, input) > 0;
  });
}

function hasPostChainContinuation(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  if (input.view.chain.length === 0 || me.actionPoints <= 0) return false;
  const pitch = availablePitch(me.hand, new Set(), input) + me.resources;
  const readyWail = me.weapons.some((card) =>
    key(input.cards[card.cardId]) === WINTERS_WAIL &&
    !(card.usedAbilityIndexes ?? []).includes(0)
  );
  if (readyWail && pitch >= 3) return true;
  return [...me.hand, ...me.arsenal].some((card) => {
    const data = input.cards[card.cardId];
    return isAttack(data) && pitch - (me.hand.includes(card) ? data?.pitch ?? 0 : 0) >=
      attackCost(data!);
  });
}

function scorePlay(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  if (intent.kind === "close-chain") return hasPostChainContinuation(input) ? 75 : -15;
  if (intent.kind === "pass") return -100;
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -100;
  if (shouldPreserveOpeningHand(input)) return -100;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;
  const functional = key(data);
  let score: number;
  if (intent.kind === "activate-ability") {
    if (functional === BALANCE) score = 120;
    else if (functional === TUNIC) score = -30;
    else if (functional === CROWN) score = -100;
    else if (functional === SHOCK_CHARMERS) {
      score = shockCharmersIsSurplus(input, intent) ? 38 : -100;
    } else if (functional === HEART_OF_ICE) {
      score = input.view.activePlayer === input.seat ? 28 : -100;
    } else if (data.cardType === "weapon") {
      const icePitched = pitchIds(intent).some((id) => {
        const pitched = own.get(id);
        return hasSubtype(input.cards[pitched?.cardId ?? ""], "ice");
      });
      score = 30 + attackPressure(data, input) + (icePitched ? 5 : 0) +
        ((input.view.turnFacts?.players[input.seat].attacks ?? 0) > 0 ? 18 : 0);
    } else score = -20;
  } else if (functional === PULSE_VOLTHAVEN) {
    score = hasCompatiblePulseFollowUp(input, card.instanceId) ? 72 : -100;
  } else if (functional === AWAKENING) {
    score = awakeningIsLive(intent, input) ? 58 : -100;
  } else if (functional === CHANNEL_LAKE) {
    score = aggressiveOpponent(input) ? 58 : 18;
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (isElectromagneticSomersault(intent, input)) {
    score = hasFriendlySomersaultTarget(input, intent) ? 48 : -100;
  } else if (isAttack(data)) {
    score = 30 + attackPressure(data, input) * 2 + disruptionValue(data, input) * 3;
    if (isEligibleStarvoAttack(data) && starvoBonusActive(input)) score += 40;
    if (canFundWailAfter(intent, data, input)) score += 30;
    if (intent.kind === "play-from-arsenal") score += 4;
  } else if (data.cardType === "instant") score = 5;
  else score = 8;

  const pitched = pitchIds(intent).flatMap((id) => own.get(id) ?? []);
  score -= pitched.reduce((total, spent) => total + cardOpportunity(spent, input) * 0.65, 0);
  score -= Math.max(0, pitched.length - 1) * 5;
  return score;
}

function isPulseIntent(intent: GameIntent, input: BotPolicyInput): boolean {
  const card = intentCard(intent, ownCards(input));
  return key(input.cards[card?.cardId ?? ""]) === PULSE_VOLTHAVEN;
}

function legalWithoutWastefulInstants(input: BotPolicyInput): BotPolicyInput {
  const legal = input.legal.filter((intent) => {
    if (isPulseIntent(intent, input)) {
      return hasCompatiblePulseFollowUp(input, intentCard(intent, ownCards(input))?.instanceId);
    }
    const card = intentCard(intent, ownCards(input));
    if (key(input.cards[card?.cardId ?? ""]) === BLIZZARD) {
      const link = currentLink(input);
      return !!link && link.attackingCard.owner !== input.seat && link.goAgain === true;
    }
    return !isElectromagneticSomersault(intent, input) ||
      hasFriendlySomersaultTarget(input, intent);
  });
  return legal.length > 0 && legal.length !== input.legal.length ? { ...input, legal } : input;
}

function knownOwnDeckCards(input: BotPolicyInput): CardView[] {
  const me = input.view.players[input.seat];
  const cards = [
    ...me.hand,
    ...me.arsenal,
    ...me.pitch,
    ...me.graveyard,
    ...me.banish,
    ...me.soul,
    ...me.board,
    ...input.view.chain.flatMap((link) => [
      link.attackingCard,
      ...link.defendingCards,
      ...link.reactions,
    ]).filter((card) => card.owner === input.seat),
    ...input.view.stack.flatMap((layer) => layer.card?.owner === input.seat ? [layer.card] : []),
  ];
  return [...new Map(cards.map((card) => [card.instanceId, card])).values()];
}

function registeredDeckRemaining(input: BotPolicyInput): ReadonlyMap<string, number> {
  const remaining = new Map<string, number>();
  for (const cardId of STARVO_REGISTERED_DECK) {
    remaining.set(cardId, (remaining.get(cardId) ?? 0) + 1);
  }
  for (const card of knownOwnDeckCards(input)) {
    const count = remaining.get(card.cardId) ?? 0;
    if (count > 0) remaining.set(card.cardId, count - 1);
  }
  return remaining;
}

function crownRepairChance(hand: readonly CardView[], input: BotPolicyInput): number {
  if (canRevealElements(hand, input)) return 0;
  const remaining = registeredDeckRemaining(input);
  let total = 0;
  let repairs = 0;
  for (const [cardId, count] of remaining) {
    if (count <= 0) continue;
    total += count;
    const candidate: CardView = { instanceId: -1, cardId, owner: input.seat };
    if (canRevealElements([...hand, candidate], input)) repairs += count;
  }
  return total > 0 ? repairs / total : 0;
}

function crownIsWorthUsing(
  input: BotPolicyInput,
  intent: Extract<GameIntent, { kind: "activate-ability" }>,
): boolean {
  const link = currentLink(input);
  if (!link || link.attackingCard.owner === input.seat || incomingAttackDamage(input) <= 0) {
    return false;
  }
  const me = input.view.players[input.seat];
  const arsenal = me.arsenal.find((card) => card.faceDown !== false);
  if (!arsenal) return false;
  const lethal = incomingAttackDamage(input) >= me.life;
  const meaningful = meaningfulIncomingOnHit(input);
  const premiumArsenal = isPremiumArsenal(input.cards[arsenal.cardId], input);
  const spent = new Set(intent.pitchInstanceIds);
  const hand = me.hand.filter((card) => !spent.has(card.instanceId));
  const pitchCost = intent.pitchInstanceIds.reduce((total, id) => {
    const card = me.hand.find((candidate) => candidate.instanceId === id);
    return total + (card ? cardOpportunity(card, input) : 0);
  }, 0);
  if (!lethal && premiumArsenal && canRevealElements(hand, input)) return false;
  if (lethal) return true;
  if (meaningful && pitchCost <= 5) return true;
  if (intent.pitchInstanceIds.length === 0 && !premiumArsenal) return true;
  const repairChance = crownRepairChance(hand, input);
  if (intent.pitchInstanceIds.length > 0 && pitchCost > 4) return false;
  return repairChance >= 0.15 && !premiumArsenal;
}

function bestCrownIntent(
  input: BotPolicyInput,
): Extract<GameIntent, { kind: "activate-ability" }> | undefined {
  const own = ownCards(input);
  return input.legal
    .filter((intent): intent is Extract<GameIntent, { kind: "activate-ability" }> =>
      intent.kind === "activate-ability" &&
      key(input.cards[intentCard(intent, own)?.cardId ?? ""]) === CROWN
    )
    .filter((intent) => crownIsWorthUsing(input, intent))
    .map((intent, index) => ({
      intent,
      index,
      cost: intent.pitchInstanceIds.reduce((total, id) => {
        const card = own.get(id);
        return total + (card ? cardOpportunity(card, input) : 0);
      }, 0),
    }))
    .sort((left, right) => left.cost - right.cost || left.index - right.index)[0]?.intent;
}

function firstAbility(input: BotPolicyInput, functional: string): GameIntent | undefined {
  const own = ownCards(input);
  return input.legal.find((intent) => intent.kind === "activate-ability" &&
    key(input.cards[intentCard(intent, own)?.cardId ?? ""]) === functional);
}

function tunicEnablesCrown(input: BotPolicyInput): GameIntent | undefined {
  if (input.view.activePlayer === input.seat || input.view.players[input.seat].resources > 0) {
    return undefined;
  }
  const tunic = firstAbility(input, TUNIC);
  if (!tunic) return undefined;
  const own = ownCards(input);
  const crown = input.legal.find((intent): intent is Extract<
    GameIntent,
    { kind: "activate-ability" }
  > => intent.kind === "activate-ability" &&
    key(input.cards[intentCard(intent, own)?.cardId ?? ""]) === CROWN);
  if (!crown) return undefined;
  return crownIsWorthUsing(input, { ...crown, pitchInstanceIds: [] }) ? tunic : undefined;
}

function tunicEnablesOffense(input: BotPolicyInput): boolean {
  if (input.view.activePlayer !== input.seat) return false;
  const me = input.view.players[input.seat];
  const attacks = [...me.hand, ...me.arsenal].filter((card) =>
    isAttack(input.cards[card.cardId])
  );
  return attacks.some((attack) => {
    const data = input.cards[attack.cardId];
    if (!data) return false;
    const otherHand = me.hand.filter((card) => card.instanceId !== attack.instanceId);
    const available = me.resources + availablePitch(otherHand, new Set(), input);
    const cost = attackCost(data);
    if (available < cost && available + 1 >= cost) return true;
    return starvoBonusActive(input) && isEligibleStarvoAttack(data) &&
      available < cost + 3 && available + 1 >= cost + 3 &&
      hasIcePitch(otherHand, new Set(), input);
  });
}

function shockCharmersIsSurplus(input: BotPolicyInput, intent: GameIntent): boolean {
  const link = currentLink(input);
  if (!link || !currentAttackIsOurs(input) || link.damage <= 0) return false;
  if (link.onHitEffects?.some((effect) => key(input.cards[effect.sourceCardId]) === SHOCK_CHARMERS)) {
    return false;
  }
  const lethal = link.damage + 1 >= input.view.players[1 - input.seat]!.life;
  if (lethal) return true;
  const hasWailContinuation = link.goAgain === true || link.attackModifiers?.some((modifier) =>
    key(input.cards[modifier.sourceCardId]) === STARVO
  ) === true;
  if (!hasWailContinuation) return true;
  if (input.view.players[input.seat].resources < 2) return false;
  const remaining = remainingCardsAfterIntent(intent, input);
  return resourcesAfterCost(intent, 2, input) + availablePitch(remaining, new Set(), input) >= 3;
}

function starvoPriorityOverride(input: BotPolicyInput): GameIntent | undefined {
  const decision = input.view.pendingDecision;
  const prompt = decision?.prompt.toLowerCase() ?? "";
  if (decision?.kind === "optional-effect" && prompt.includes("bravo, star of the show") &&
    prompt.includes("reveal earth, ice, and lightning")) {
    return input.legal.find((intent) => intent.kind === "choose" && intent.optionId === "yes");
  }
  if (prompt.includes("reveal an earth, an ice, and a lightning card")) {
    return input.legal
      .filter((intent): intent is Extract<GameIntent, { kind: "choose" }> =>
        intent.kind === "choose" && scoreRevealChoice(intent) !== undefined
      )
      .map((intent, index) => ({ intent, index, score: scoreRevealChoice(intent)! }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.intent;
  }
  if (prompt.includes("cadaverous tilling") && prompt.includes("decompose")) {
    return input.legal.find((intent) => intent.kind === "choose" && intent.optionId !== "no");
  }
  const balance = firstAbility(input, BALANCE);
  if (balance) return balance;
  const tunic = tunicEnablesCrown(input);
  if (tunic) return tunic;
  const crown = bestCrownIntent(input);
  if (crown) return crown;
  const shock = firstAbility(input, SHOCK_CHARMERS);
  if (shock && shockCharmersIsSurplus(input, shock)) return shock;
  const offensiveTunic = firstAbility(input, TUNIC);
  if (offensiveTunic && tunicEnablesOffense(input)) return offensiveTunic;
  return undefined;
}

function withoutNonlethalTunicDefense(input: BotPolicyInput): BotPolicyInput {
  const link = currentLink(input);
  const me = input.view.players[input.seat];
  if (!link || link.damage >= me.life) return input;
  const tunic = [...ownCards(input).values()].find((card) =>
    key(input.cards[card.cardId]) === TUNIC
  );
  if (!tunic) return input;
  const legal = input.legal.filter((intent) => {
    const ids = intent.kind === "defend" || intent.kind === "stage-defenders"
      ? intent.instanceIds
      : [];
    return !ids.includes(tunic.instanceId);
  });
  return legal.length > 0 && legal.length !== input.legal.length ? { ...input, legal } : input;
}

function avoidWastefulAllyOverkill(input: BotPolicyInput, intent: GameIntent): GameIntent {
  if (!targetableAttackIntent(intent) || intent.targetAllyId === undefined) return intent;
  const ally = opponentAllies(input).find((candidate) => candidate.instanceId === intent.targetAllyId);
  if (!ally) return intent;
  const allyKey = key(input.cards[ally.cardId]);
  if (allyKey === CHUM || allyKey === SAWBONES) return intent;
  const card = intentCard(intent, ownCards(input));
  const data = card ? input.cards[card.cardId] : undefined;
  const damage = data ? attackPressure(data, input) : 0;
  if (damage - allyLethalThreshold(ally, input) <= 1) return intent;
  const variant = attackIntentVariantKey(intent);
  return input.legal.find((candidate) => targetableAttackIntent(candidate) &&
    candidate.targetAllyId === undefined && attackIntentVariantKey(candidate) === variant) ?? intent;
}

function preferHandOverEquivalentStalagmite(
  input: BotPolicyInput,
  intent: GameIntent,
): GameIntent {
  if (intent.kind !== "defend") return intent;
  const own = ownCards(input);
  if (!intent.instanceIds.some((id) => key(input.cards[own.get(id)?.cardId ?? ""]) === STALAGMITE)) {
    return intent;
  }
  const handIds = new Set(input.view.players[input.seat].hand.map((card) => card.instanceId));
  const incoming = incomingAttackDamage(input);
  const alternatives = input.legal.filter(
    (candidate): candidate is Extract<GameIntent, { kind: "defend" }> =>
      candidate.kind === "defend" && candidate.instanceIds.length > 0 &&
      candidate.instanceIds.every((id) => handIds.has(id)) &&
      defenseValue(candidate, input) >= incoming &&
      responseAfterDefense(candidate, input).total >= responseAfterDefense(intent, input).total,
  );
  return alternatives.reduce<GameIntent>((best, candidate) =>
    scoreDefend(candidate, input, own) >
        scoreDefend(best as Extract<GameIntent, { kind: "defend" }>, input, own)
      ? candidate
      : best, alternatives[0] ?? intent);
}

function chooseStarvoReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    response: starvoResponse,
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: arsenalValuer(starvoSolverRules),
  });
}

function prepareStarvoRootCandidates(
  candidates: readonly GameIntent[],
  input: BotPolicyInput,
  depth: number,
): readonly GameIntent[] {
  if (depth > 0) {
    const own = ownCards(input);
    return candidates.map((intent, index) => ({
      intent,
      index,
      score: scorePlay(intent, input, own),
    })).sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ intent }) => intent);
  }
  if (candidates.length <= STARVO_MAX_ROOT_CANDIDATES) return candidates;
  const own = ownCards(input);
  const ranked = candidates.map((intent, index) => ({
    intent,
    index,
    score: scorePlay(intent, input, own),
    data: (() => {
      const card = intentCard(intent, own);
      return card ? input.cards[card.cardId] : undefined;
    })(),
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: GameIntent[] = [];
  const take = (predicate: (entry: typeof ranked[number]) => boolean): void => {
    const match = ranked.find((entry) => predicate(entry) && !selected.includes(entry.intent));
    if (match) selected.push(match.intent);
  };
  take((entry) => isEligibleStarvoAttack(entry.data));
  take((entry) => {
    const functional = key(entry.data);
    return functional === PULSE_VOLTHAVEN || functional === AWAKENING ||
      functional === CHANNEL_LAKE || functional === HEART_OF_ICE || functional === TUNIC;
  });
  take((entry) => key(entry.data) === WINTERS_WAIL);
  take((entry) => entry.intent.kind === "pass");
  for (const entry of ranked) {
    if (selected.length >= STARVO_MAX_ROOT_CANDIDATES) break;
    if (!selected.includes(entry.intent)) selected.push(entry.intent);
  }
  return selected;
}

function starvoTacticalConfig(): TacticalIntentConfig {
  return {
    chooseForced: (forced) => {
      const guarded = legalWithoutWastefulInstants(withoutNonlethalTunicDefense({
        ...forced,
        state: undefined,
      }));
      return finalizeStarvoIntent(
        guarded,
        starvoPriorityOverride(guarded) ?? chooseStarvoReactiveIntent(guarded),
      );
    },
    rules: starvoSolverRules,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    prepareCandidates: (candidates, observed, context) =>
      prepareStarvoRootCandidates(candidates, observed, context.depth),
    scoreIntent: (intent, observed) => {
      if (intent.kind === "close-chain") {
        return hasPostChainContinuation(observed) ? 75 : 0;
      }
      if (intent.kind === "pass" && hasPostChainContinuation(observed)) return -75;
      const card = intentCard(intent, ownCards(observed));
      const data = card ? observed.cards[card.cardId] : undefined;
      if (!data) return 0;
      const functional = key(data);
      if (functional === PULSE_VOLTHAVEN) return 18;
      if (functional === CHANNEL_LAKE) return aggressiveOpponent(observed) ? 18 : 4;
      if (isAttack(data) || data.cardType === "weapon") {
        return disruptionValue(data, observed) * 14 +
          (isEligibleStarvoAttack(data) && starvoBonusActive(observed) ? 22 : 0) +
          (functional === WINTERS_WAIL &&
              (observed.view.turnFacts?.players[observed.seat].attacks ?? 0) > 0
            ? 220
            : 0);
      }
      return 0;
    },
    rootScore: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    maxSearchNodes: STARVO_MAX_SEARCH_NODES,
    maxTransitions: STARVO_MAX_TRANSITIONS,
    maxRootCandidates: STARVO_MAX_ROOT_CANDIDATES,
    maxActionDepth: STARVO_MAX_ACTION_DEPTH,
    maxForcedSteps: STARVO_MAX_FORCED_STEPS,
    firstRootNodeBudget: STARVO_FIRST_ROOT_NODES,
    firstRootTransitionBudget: STARVO_FIRST_ROOT_TRANSITIONS,
    recordCheckpoints: true,
  };
}

function finalizeStarvoIntent(input: BotPolicyInput, intent: GameIntent): GameIntent {
  return avoidWastefulAllyOverkill(
    input,
    enforceSpectraPolicy(input, preferHandOverEquivalentStalagmite(input, intent)),
  );
}

function sameIntent(left: GameIntent, right: GameIntent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Projection-only Starvo policy: preserve elemental power turns on defense,
 * then use bounded authoritative rollout to sequence disruption into Wail. */
export function chooseStarvoIntentWithTrace(input: BotPolicyInput): StarvoIntentDecision {
  const guarded = legalWithoutWastefulInstants(withoutNonlethalTunicDefense(input));
  const override = starvoPriorityOverride(guarded);
  if (override) return { intent: finalizeStarvoIntent(guarded, override) };
  const reactive = chooseStarvoReactiveIntent(guarded);
  const decision = chooseTacticalIntentWithTrace(guarded, reactive, starvoTacticalConfig());
  const intent = finalizeStarvoIntent(guarded, decision.intent);
  return decision.plan && sameIntent(intent, decision.plan.intent)
    ? { intent, plan: decision.plan }
    : { intent };
}

/** Reapply cheap, projection-only guardrails before accepting an exactly
 * matched cached continuation. */
export function chooseStarvoContinuationIntent(
  input: BotPolicyInput,
  proposed: GameIntent,
): GameIntent {
  const guarded = legalWithoutWastefulInstants(withoutNonlethalTunicDefense(input));
  const override = starvoPriorityOverride(guarded);
  if (override) return finalizeStarvoIntent(guarded, override);
  const reactive = chooseStarvoReactiveIntent(guarded);
  const config = starvoTacticalConfig();
  const selected = config.rootScore(proposed, guarded) >= config.rootScore(reactive, guarded)
    ? proposed
    : reactive;
  return finalizeStarvoIntent(guarded, selected);
}

export function chooseStarvoIntent(input: BotPolicyInput): GameIntent {
  return chooseStarvoIntentWithTrace(input).intent;
}
