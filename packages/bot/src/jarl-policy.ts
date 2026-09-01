import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  currentLink,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  incomingAttackDamage,
  isAttack,
  opponentDamageEffectOnStack,
  optionCard,
  ownCards,
  pitchIds,
  resourcePaymentPitchIds,
  responseEvaluation,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  visibleOpponentDamageAmount,
  type BotPolicyInput,
} from "./policy.js";
import { adjustValueBreakdown } from "./value.js";
import {
  chooseTacticalIntentWithTrace,
  type TacticalTurnPlan,
} from "./tactical-turn-planner.js";

const AGGRO_HERO_NAMES = [
  "arakni, marionette",
  "aurora",
  "cindra",
  "dash i/o",
  "dash io",
  "fai",
  "ira",
  "oscilio",
];

function opponentIsAggro(input: BotPolicyInput): boolean {
  const name = input.view.players[1 - input.seat]!.heroName.toLowerCase();
  return AGGRO_HERO_NAMES.some((candidate) => name.includes(candidate));
}

function opponentIsGravy(input: BotPolicyInput): boolean {
  return input.view.players[1 - input.seat]!.heroName.toLowerCase().includes("gravy bones");
}

function hasSubtype(data: CardData | undefined, subtype: string): boolean {
  return data?.subtypes?.some((value) => value.toLowerCase() === subtype) === true;
}

function earthBanished(input: BotPolicyInput): number {
  return input.view.players[input.seat].banish.filter((card) =>
    hasSubtype(input.cards[card.cardId], "earth")
  ).length;
}

function attackCost(data: CardData): number {
  return Math.max(0, data.cost ?? (data.cardType === "weapon" ? 3 : 0));
}

function attackValue(data: CardData, input: BotPolicyInput): number {
  let value = data.attack ?? 0;
  const functional = key(data);
  if (functional === "felling of the crown|1" && earthBanished(input) >= 4) value += 4;
  if (functional === "oaken old|1") value += 4;
  if (functional === "command and conquer|1") value += 3;
  if (functional === "plow under|2" && earthBanished(input) >= 4) value += 4;
  return value;
}

function cardOpportunity(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return 0;
  const functional = key(data);
  if (functional === "pulse of isenloft|3") return 14;
  if (functional === "sow tomorrow|3") return 12;
  if (functional === "oaken old|1") return 12;
  if (functional === "rootbound carapace|1") return earthBanished(input) < 4 ? 11 : 7;
  if (functional === "felling of the crown|1") return earthBanished(input) >= 4 ? 13 : 4;
  if (functional === "tear asunder|3") return (card.pitchCount ?? 0) > 0 ? 10 : 2;
  if (functional === "crumble to eternity|3") return opponentIsAggro(input) ? 3 : 9;
  if (opponentIsGravy(input) && functional === "frozen to death|3" && markedCompass(input)) return 16;
  if (opponentIsGravy(input) && functional === "mangle|1" && markedCompass(input)) return 16;
  if (functional === "everbloom // life|3") return (card.pitchCount ?? 0) > 0 ? 8 : 2;
  if (functional === "fruits of the forest|3") return 1;
  if (isAttack(data)) return attackValue(data, input);
  // Most blues are deliberately treated as interchangeable three-blocks.
  if (data.pitch === 3) return Math.max(1, (data.defense ?? 0) - 1);
  return Math.max(1, data.defense ?? 0, data.pitch ?? 0);
}

function estimateJarlDamage(cards: readonly CardView[], input: BotPolicyInput): number {
  const unique = [...new Map(cards.map((card) => [card.instanceId, card])).values()];
  const resources = input.view.players[input.seat].resources;
  let best = 0;
  for (const attack of unique) {
    const data = input.cards[attack.cardId];
    if (!data || !(isAttack(data) || data.cardType === "weapon")) continue;
    const cost = attackCost(data);
    const canPay = cost <= resources || unique.some((pitch) =>
      pitch.instanceId !== attack.instanceId &&
      resources + Number(input.cards[pitch.cardId]?.pitch ?? 0) >= cost
    );
    if (canPay) best = Math.max(best, attackValue(data, input));
  }
  return best;
}

function offensiveCards(input: BotPolicyInput): readonly CardView[] {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal, ...me.weapons];
}

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    offensiveCards,
    evaluateResponse: (cards, policyInput) => responseEvaluation({
      damageThreatened: estimateJarlDamage(cards, policyInput),
    }),
    cardOpportunity,
    responseLossWeight: opponentIsGravy(input) ? 0.1 : 1.2,
    defensePermission(candidate) {
      const usesStalagmite = candidate.chosen.some((card) =>
        key(candidate.input.cards[card.cardId]) === "stalagmite, bastion of isenloft|0"
      );
      return usesStalagmite && currentLink(candidate.input)?.goAgain !== true
        ? "forbid"
        : "allow";
    },
    adjustCycleValue(value, candidate) {
      const usesStalagmite = candidate.chosen.some((card) =>
        key(candidate.input.cards[card.cardId]) === "stalagmite, bastion of isenloft|0"
      );
      let adjustment = usesStalagmite && currentLink(candidate.input)?.goAgain === true ? 8 : 0;
      const earlyBarkskin = earthBanished(candidate.input) < 4 && candidate.chosen.some((card) =>
        key(candidate.input.cards[card.cardId]) === "barkskin of the millennium tree|0"
      );
      if (earlyBarkskin) {
        adjustment -= candidate.onHit.value > 0 || candidate.lethal ? 2 : 9;
      }
      return adjustment === 0
        ? value
        : adjustValueBreakdown(value, {
          strategicAdjustment: value.strategicAdjustment + adjustment,
        });
    },
  });
}

function nextTurnArsenalValue(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return -100;
  const functional = key(data);
  if (functional === "pulse of isenloft|3") return 100;
  if (functional === "sow tomorrow|3") return 90;
  if (functional === "crumble to eternity|3") return -200;
  if (data.pitch === 3) return -100;
  if (data.cardType === "defense-reaction") return 75 + (data.defense ?? 0);
  if (isAttack(data)) return 40 + attackValue(data, input);
  return 10 + cardOpportunity(card, input);
}

function targetEquipmentValue(card: CardView, input: BotPolicyInput): number {
  if (card.owner === input.seat) return -100;
  const name = input.cards[card.cardId]?.name.toLowerCase() ?? "";
  if (opponentIsGravy(input) && name.includes("compass of sunken depths")) return 300;
  if (name.includes("fyendal's spring tunic")) return 120;
  if (name.includes("flick knives")) return 115;
  if (name.includes("compass of sunken depths")) return 110;
  return 70 + (card.defCounters ?? 0) * 5;
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  const prompt = decision.prompt.toLowerCase();
  const card = optionCard(intent, input);

  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, nextTurnArsenalValue, 0);
  }
  if (decision.resourcePayment) {
    const ids = resourcePaymentPitchIds(intent, input) ?? [];
    const own = new Map(input.view.players[input.seat].hand.map((held) => [held.instanceId, held]));
    return 30 - ids.reduce((total, id) => {
      const held = own.get(id);
      return total + (held ? cardOpportunity(held, input) : 0);
    }, 0);
  }
  if (prompt === "choose a mode" &&
    ["draw", "+2", "go again"].every((option) => decision.options?.includes(option))) {
    const goAgain = shouldGiveEnlightenedStrikeGoAgain(input);
    if (intent.optionId === "draw") return -100;
    if (intent.optionId === "go again") return goAgain ? 100 : -50;
    if (intent.optionId === "+2") return goAgain ? 60 : 100;
    return -100;
  }
  if (prompt === "choose x") {
    const value = Number(intent.optionId);
    const desired = opponentIsAggro(input) ? 2 : 0;
    return Number.isFinite(value) ? 30 - Math.abs(value - desired) * 10 : -100;
  }
  if (prompt.includes("fuse")) {
    if (intent.optionId.startsWith("both:")) return 100;
    if (intent.optionId.startsWith("ice:") || intent.optionId.startsWith("earth:")) return 50;
    return -20;
  }
  if (prompt.includes("decompose")) {
    const fellingTooEarly = prompt.includes("felling of the crown") && earthBanished(input) < 4;
    if (intent.optionId === "no") return fellingTooEarly ? 20 : -50;
    return fellingTooEarly ? -20 : 60;
  }
  if (prompt.includes("choose an aura")) {
    const functional = card ? key(input.cards[card.cardId]) : "";
    if (functional === "channel lake frigid|3") return opponentIsAggro(input) ? 100 : 20;
    if (functional === "crumble to eternity|3") return opponentIsAggro(input) ? 70 : 100;
    return card ? 10 : -20;
  }
  if (prompt.includes("equipment")) {
    return card ? targetEquipmentValue(card, input) : intent.optionId === "none" ? 0 : -20;
  }
  if (prompt.includes("exposed equipment zone")) {
    return ({ chest: 40, arms: 35, head: 30, legs: 25, none: 0 } as Record<string, number>)[intent.optionId] ?? 1;
  }
  if (prompt.includes("put an action on the bottom") && card) {
    return key(input.cards[card.cardId]) === "everbloom // life|3" ? 60 : 10;
  }
  if (prompt.includes("discard") || prompt.includes("bottom of your deck") ||
    prompt.includes("put a card from your hand")) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 30, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 10, -2);
  if (binary !== undefined) return binary;
  return card ? 10 - cardOpportunity(card, input) : 1;
}

function remainingBlueCount(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const spent = new Set(pitchIds(intent));
  const played = intentCard(intent, own);
  if (played) spent.add(played.instanceId);
  return input.view.players[input.seat].hand.filter((card) =>
    !spent.has(card.instanceId) && input.cards[card.cardId]?.pitch === 3
  ).length;
}

function remainingSubtypeCount(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  subtype: string,
): number {
  const spent = new Set(pitchIds(intent));
  const played = intentCard(intent, own);
  if (played) spent.add(played.instanceId);
  return input.view.players[input.seat].hand.filter((card) =>
    !spent.has(card.instanceId) && hasSubtype(input.cards[card.cardId], subtype)
  ).length;
}

function opponentEquipment(input: BotPolicyInput): CardView[] {
  const opponent = input.view.players[1 - input.seat]!;
  return [
    ...Object.values(opponent.equipment).filter((card): card is CardView => card !== undefined),
    ...opponent.weapons.filter((card) => input.cards[card.cardId]?.cardType === "equipment"),
  ];
}

function compass(input: BotPolicyInput): CardView | undefined {
  return opponentEquipment(input).find((card) =>
    input.cards[card.cardId]?.name.toLowerCase().includes("compass of sunken depths")
  );
}

function markedCompass(input: BotPolicyInput): boolean {
  return (compass(input)?.defCounters ?? 0) > 0;
}

function gravyAttackTargetAdjustment(
  intent: GameIntent,
  card: CardView,
  data: CardData,
  input: BotPolicyInput,
): number {
  if (!opponentIsGravy(input) ||
    !(intent.kind === "play-card" || intent.kind === "play-from-arsenal" ||
      intent.kind === "play-from-zone" || intent.kind === "activate-ability")) return 0;

  // Mangle must damage the hero for Crush to destroy the marked Compass.
  if (key(data) === "mangle|1" && markedCompass(input)) {
    return intent.targetAllyId === undefined ? 150 : -300;
  }

  const allies = input.view.players[1 - input.seat]!.board.filter((candidate) =>
    hasSubtype(input.cards[candidate.cardId], "ally")
  );
  if (allies.length === 0) return data.cardType === "weapon" ? 0 : -45;
  if (intent.targetAllyId === undefined) return -120;

  const target = allies.find((candidate) => candidate.instanceId === intent.targetAllyId);
  if (!target) return -150;
  const targetData = input.cards[target.cardId];
  const life = Math.max(1, target.life ?? targetData?.life ?? 1);
  const attack = Math.max(0, card.attack ?? data.attack ?? 0);
  const threat = Math.max(0, target.attack ?? targetData?.attack ?? 0);
  const overkill = Math.max(0, attack - life);
  return attack >= life
    ? 220 + threat * 3 - overkill * 4
    : 130 + Math.min(attack, life) * 5 + threat * 2;
}

function hasEverbloomTarget(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].graveyard.some((card) =>
    key(input.cards[card.cardId]) === "everbloom // life|3"
  );
}

function shouldGiveEnlightenedStrikeGoAgain(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  // At this choice Enlightened Strike and its bottomed additional-cost card
  // have both left the hand, so one or two cards means it began as a three-
  // or four-card hand. Larger hands should take the efficient +2 mode.
  if (me.hand.length < 1 || me.hand.length > 2) return false;

  const pitchFromHand = (reservedId?: number): number => me.hand.reduce(
    (total, card) => card.instanceId === reservedId
      ? total
      : total + Number(input.cards[card.cardId]?.pitch ?? 0),
    0,
  );
  const canPay = (card: CardView, reserveFromHand: boolean): boolean => {
    const data = input.cards[card.cardId];
    return !!data && me.resources + pitchFromHand(reserveFromHand ? card.instanceId : undefined) >=
      attackCost(data);
  };

  const handAttack = me.hand.some((card) => isAttack(input.cards[card.cardId]) && canPay(card, true));
  const arsenalAttack = me.arsenal.some((card) => isAttack(input.cards[card.cardId]) && canPay(card, false));
  const weaponAttack = me.weapons.some((card) => {
    const data = input.cards[card.cardId];
    return data?.cardType === "weapon" && (data.attack ?? 0) > 0 &&
      !(card.usedAbilityIndexes ?? []).includes(0) && canPay(card, false);
  });
  return handAttack || arsenalAttack || weaponAttack;
}

function shouldActivateOmnisBoots(input: BotPolicyInput, boots: CardView): boolean {
  if (opponentDamageEffectOnStack(input)) {
    const layer = input.view.stack[0];
    const sourceName = input.cards[layer?.card?.cardId ?? ""]?.name.toLowerCase() ?? "";
    const flickKnives = sourceName === "flick knives" || layer?.label.toLowerCase().includes("flick knives");
    if (flickKnives) return true;

    const visibleDamage = visibleOpponentDamageAmount(input);
    const lethal = visibleDamage !== undefined && visibleDamage >= input.view.players[input.seat].life;
    return lethal || (boots.defCounters ?? 0) > 0;
  }

  // Keep fresh Boots available to defend. Once Temper has recorded a block,
  // cash it in only after defense is committed and a follow-up attack still
  // threatens damage; activating in the earlier priority window can waste it
  // before Jarl knows whether hand cards cover the attack.
  return (boots.defCounters ?? 0) > 0 &&
    input.view.pendingDecision?.kind === "defense-reaction" &&
    incomingAttackDamage(input) > 0;
}

function wastesStackedDefenseReaction(data: CardData, input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link || input.view.pendingDecision?.kind !== "defense-reaction") return false;

  const pendingDefense = input.view.stack.reduce((total, layer) => {
    if (layer.seat !== input.seat || !layer.card) return total;
    const pending = input.cards[layer.card.cardId];
    return pending?.cardType === "defense-reaction"
      ? total + Math.max(0, layer.card.defense ?? pending.defense ?? 0)
      : total;
  }, 0);
  if (pendingDefense === 0) return false;

  const incoming = Math.max(0, link.attackValue - link.defenseValue - pendingDefense);
  const meaningfulHit = (link.onHitEffects?.length ?? 0) > 0 || link.wagered === true;
  return !meaningfulHit && incoming > 0 && incoming < input.view.players[input.seat].life &&
    Math.max(0, data.defense ?? 0) > incoming;
}

function scorePlay(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -50;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;
  const functional = key(data);
  const opening = shouldPreserveOpeningHand(input);
  const aggro = opponentIsAggro(input);
  const gravy = opponentIsGravy(input);
  const enemyCompass = compass(input);
  const compassIsMarked = markedCompass(input);
  const me = input.view.players[input.seat];

  let score: number;
  if (intent.kind === "activate-ability") {
    if (functional === "fruits of the forest|3") {
      const missingLife = Math.max(0, (input.cards[me.heroCardId]?.life ?? 40) - me.life);
      score = missingLife > 0 && (me.hand.length === 3 || me.life <= 8) ? 75 : -100;
    } else if (functional === "boots of omnis ward|0") {
      score = shouldActivateOmnisBoots(input, card) ? 90 : -100;
    } else if (data.cardType === "weapon") {
      score = 24 + (data.attack ?? 0);
    } else {
      score = -100;
    }
  } else if (functional === "imposing visage|3") {
    score = opening ? (gravy ? 320 : aggro ? 110 : 100) : aggro ? 62 : 24;
  } else if (functional === "crumble to eternity|3") {
    score = gravy && enemyCompass && !compassIsMarked ? 300 : opening ? (aggro ? 75 : 95) : 18;
  } else if (opening) {
    score = -100;
  } else if (functional === "channel lake frigid|3") {
    score = aggro ? 58 : 18;
  } else if (functional === "oaken old|1") {
    score = 65;
  } else if (functional === "felling of the crown|1") {
    score = earthBanished(input) >= 4 ? 62 : 12;
  } else if (functional === "rootbound carapace|1") {
    score = scoreDefenseReaction(data, input) + (earthBanished(input) < 4 ? 12 : 2);
  } else if (functional === "tear asunder|3") {
    const secondCycle = (card.pitchCount ?? 0) > 0;
    score = secondCycle && remainingBlueCount(intent, input, own) >= 1 ? 60 : 4;
  } else if (functional === "everbloom // life|3" && "meldSide" in intent) {
    const lateGame = me.deckCount <= 20 || (card.pitchCount ?? 0) > 0;
    score = intent.meldSide === "both" && lateGame && hasEverbloomTarget(input) &&
        remainingBlueCount(intent, input, own) >= 1
      ? 55
      : intent.meldSide === "right" && me.life <= 5
      ? 35
      : -40;
  } else if (functional === "frozen to death|3") {
    const canFuse = remainingSubtypeCount(intent, input, own, "ice") >= 1;
    const markedEquipment = opponentEquipment(input).some((equipment) =>
      (equipment.defCounters ?? 0) > 0
    );
    score = gravy && compassIsMarked && canFuse ? 290 : markedEquipment && canFuse ? 55 : aggro ? 25 : 12;
  } else if (functional === "fruits of the forest|3") {
    score = 5;
  } else if (data.cardType === "defense-reaction") {
    score = wastesStackedDefenseReaction(data, input)
      ? -100
      : scoreDefenseReaction(data, input);
  } else if (isAttack(data)) {
    score = gravy && functional === "mangle|1" && compassIsMarked
      ? 275
      : 25 + attackValue(data, input);
  } else if (data.cardType === "instant") {
    score = 8;
  } else {
    score = 10;
  }

  const pitched = pitchIds(intent).flatMap((id) => own.get(id) ?? []);
  score -= pitched.reduce((total, spent) => total + cardOpportunity(spent, input) * 0.6, 0);
  score -= Math.max(0, pitched.length - 1) * 5;
  if (!aggro && pitched.every((spent) => (spent.pitchCount ?? 0) === 0)) {
    const keys = new Set(pitched.map((spent) => key(input.cards[spent.cardId])));
    if (keys.has("crumble to eternity|3") && keys.has("pulse of isenloft|3")) score += 12;
    if (keys.has("oaken old|1") &&
      (keys.has("crumble to eternity|3") || keys.has("pulse of isenloft|3"))) score += 8;
  }
  if (isAttack(data) || data.cardType === "weapon") {
    score += gravyAttackTargetAdjustment(intent, card, data, input);
  }
  return score;
}

function chooseJarlReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: nextTurnArsenalValue,
  });
}

/**
 * Defensive Jarl policy: preserve the best two-card attack, block with the
 * rest, protect the Oaken fusion pieces and second-cycle Tear line, and use
 * bounded validation to select clean-turn openings.
 */
export interface JarlIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

export function chooseJarlIntentWithTrace(input: BotPolicyInput): JarlIntentDecision {
  const reactive = chooseJarlReactiveIntent(input);
  const decision = chooseTacticalIntentWithTrace(input, reactive, {
    chooseForced: (forced) => chooseJarlReactiveIntent({ ...forced, state: undefined }),
    cardOpportunity,
    nextTurnArsenal: nextTurnArsenalValue,
    estimateRemaining: estimateJarlDamage,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    rootScore: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
  });
  const intent = enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, decision.intent), {
    preserveHeroTarget(card) {
      return key(input.cards[card.cardId]) === "mangle|1" && markedCompass(input);
    },
  });
  return decision.plan ? { intent, plan: decision.plan } : { intent };
}

export function chooseJarlIntent(input: BotPolicyInput): GameIntent {
  return chooseJarlIntentWithTrace(input).intent;
}
