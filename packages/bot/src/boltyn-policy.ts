import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  currentAttackIsOurs,
  canGainGoAgain,
  currentLink,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  isAttack,
  optionCard,
  ownCards,
  pitchIds,
  pitchValue,
  resourcePaymentPitchIds,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  type BotPolicyInput,
  type ChooseIntent,
  type DefendIntent,
  type ResponseModel,
} from "./policy.js";
import { weaponCost } from "./card-model.js";
import { arsenalValuer, handResponse, opportunityValuer } from "./hand-value.js";
import { planTacticalTurn, type TacticalTurnPlan } from "./tactical-turn-planner.js";
import { futureOffenseRate, POINTS_PER_DAMAGE } from "./turn-planner.js";
import { adjustValueBreakdown } from "./value.js";
import {
  BANNERET_OF_SWORDSMANSHIP,
  BATTLEFIELD_BEACON,
  BEACON_OF_VICTORY,
  BEACON_SEARCH_VALUE,
  BLESSING_OF_BELLONA,
  BLESSING_OF_SURAYA,
  BOLTING_BLADE,
  CARD_DRAW_VALUE,
  CELESTIAL_CATACLYSM,
  CIRCLET,
  COURAGE_TOKEN_VALUE,
  COURAGEOUS_STEELHAND,
  EDICT_OF_STEEL,
  ENERGY_POTION,
  FLURRY_TOKEN_VALUE,
  FYENDALS_SPRING_TUNIC,
  HELM_OF_HALOS_GRACE,
  IRONSONG_VERSUS,
  LUMINA_ASCENSION,
  PONDER_TOKEN_VALUE,
  QUICKEN_TOKEN_VALUE,
  RAYDN,
  ROARING_BEAM,
  SAVING_GRACE,
  SNAPDRAGON_SCALERS,
  SOLFORGE_GAUNTLET,
  SOUL_VALUE,
  SOULBOND_RESOLVE,
  SPIRIT_OF_EIRINA,
  SPIRIT_OF_EIRINA_VALUE,
  TENACITY,
  V_OF_THE_VANGUARD,
  WARBAND_OF_BELLONA,
  WARPATH_OF_WINGED_GRACE,
  boardCount,
  boltynPositionValue,
  boltynSolverRules,
  cardChargeCost,
  isChargeAttack,
  isLight,
  isYellow,
} from "./boltyn-rules.js";

/** Pivot-turn payoffs: blocking with them is a last resort. */
const POWER_CARDS = new Set([
  V_OF_THE_VANGUARD, LUMINA_ASCENSION, BEACON_OF_VICTORY, CELESTIAL_CATACLYSM, "bravery of the blade|1",
]);

const cardOpportunity = opportunityValuer(boltynSolverRules);

function me(input: BotPolicyInput) {
  return input.view.players[input.seat];
}

function chargesThisTurn(input: BotPolicyInput): number {
  return input.view.turnFacts?.players[input.seat]?.chargesThisTurn ?? 0;
}

function charged(input: BotPolicyInput): boolean {
  return chargesThisTurn(input) > 0;
}

function yellowSoulThisTurn(input: BotPolicyInput): boolean {
  return input.view.turnFacts?.players[input.seat]?.yellowSoulThisTurn === true;
}

function soulBanishedThisChain(input: BotPolicyInput): number {
  return input.view.turnFacts?.players[input.seat]?.soulBanishedThisChain ?? 0;
}

function soulCount(input: BotPolicyInput): number {
  return me(input).soul.length;
}

function raydn(input: BotPolicyInput): CardView | undefined {
  return me(input).weapons.find((weapon) => key(input.cards[weapon.cardId]) === RAYDN);
}

/** Raydn still has an activation this turn. */
function raydnAvailable(input: BotPolicyInput): boolean {
  const sword = raydn(input);
  if (!sword) return false;
  if (input.view.activePlayer !== input.seat) return true;
  if (input.view.turnFacts?.players[input.seat]?.weaponAttacksProhibited === true) return false;
  return !sword.usedAbilityIndexes?.includes(0) || (sword.remainingAbilityActivations?.[0] ?? 0) > 0;
}

function ongoingFrom(input: BotPolicyInput, functional: string): boolean {
  return input.view.ongoing.some((effect) =>
    effect.seat === input.seat && key(input.cards[effect.cardId]) === functional
  );
}

function luminaActive(input: BotPolicyInput): boolean {
  return ongoingFrom(input, LUMINA_ASCENSION);
}

/** Raydn swings again after Lumina: unused, or granted another swing by a charged Lumina. */
function raydnSwingAfterLumina(input: BotPolicyInput): boolean {
  if (raydnAvailable(input)) return true;
  return raydn(input) !== undefined && charged(input) &&
    input.view.turnFacts?.players[input.seat]?.weaponAttacksProhibited !== true;
}

/** Spirit of Eirina lets Lumina wait for Raydn's reaction step. */
function luminaIsInstant(input: BotPolicyInput): boolean {
  return boardCount(input, "spirit of eirina") > 0;
}

/** Raydn's activation is on the stack or its link is unresolved. */
function raydnAttacking(input: BotPolicyInput): boolean {
  const sword = raydn(input);
  if (!sword) return false;
  return currentLink(input)?.attackingCard.instanceId === sword.instanceId ||
    input.view.stack.some((layer) => layer.seat === input.seat && layer.card?.instanceId === sword.instanceId);
}

/** Lumina's go again is the only action point past our current link. */
function luminaActionPointNeeded(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link || !currentAttackIsOurs(input) || link.goAgain === true || me(input).actionPoints > 0) return false;
  // A Lumina already on the stack grants it.
  const luminaPending = input.view.stack.some((layer) =>
    layer.seat === input.seat && key(input.cards[layer.card?.cardId ?? ""]) === LUMINA_ASCENSION
  );
  if (luminaPending) return false;
  const heroId = me(input).heroInstanceId;
  return !input.legal.some((intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === heroId);
}

/** Lumina goes only into Raydn's reaction step as an instant, or before a Raydn swing once charged. */
function luminaWindow(input: BotPolicyInput): boolean {
  if (raydnAttacking(input)) {
    if (!luminaIsInstant(input) || input.view.pendingDecision?.kind !== "attack-reaction") return false;
    // A Roaring Beam charge first turns Lumina's +1 into another swing.
    const beamPending = input.view.stack.some((layer) =>
      layer.seat === input.seat && key(input.cards[layer.card?.cardId ?? ""]) === ROARING_BEAM
    );
    return charged(input) || !(beamPending || input.legal.some((intent) => playsCard(intent, input, ROARING_BEAM)));
  }
  return charged(input) && raydnSwingAfterLumina(input);
}

function playsCard(intent: GameIntent, input: BotPolicyInput, functional: string): boolean {
  const card = intentCard(intent, ownCards(input));
  return (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
    key(input.cards[card?.cardId ?? ""]) === functional;
}

function playsLumina(intent: GameIntent, input: BotPolicyInput): boolean {
  return playsCard(intent, input, LUMINA_ASCENSION);
}

function activatesRaydn(intent: GameIntent, input: BotPolicyInput): boolean {
  return intent.kind === "activate-ability" && intent.sourceInstanceId === raydn(input)?.instanceId;
}

function vBuffActive(input: BotPolicyInput): boolean {
  return ongoingFrom(input, V_OF_THE_VANGUARD);
}

function reserve(input: BotPolicyInput): CardView[] {
  return [...me(input).hand, ...me(input).arsenal];
}

function holds(input: BotPolicyInput, functional: string): boolean {
  return reserve(input).some((card) => key(input.cards[card.cardId]) === functional);
}

/** The Tunic stances race; the Soulbond stances block and pivot later. */
function aggressorStance(input: BotPolicyInput): boolean {
  return key(input.cards[me(input).equipment.chest?.cardId ?? ""]) !== SOULBOND_RESOLVE;
}

function resourceCost(data: CardData | undefined): number {
  if (!data) return 0;
  return data.cardType === "weapon" ? weaponCost(data) : Math.max(0, data.cost ?? 0);
}

/** Hand cards left to charge once this intent has spent its card and pitch. */
function chargeableAfter(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): CardView[] {
  const used = intentCard(intent, own);
  const consumed = new Set([used?.instanceId, ...pitchIds(intent)]);
  return me(input).hand.filter((card) => !consumed.has(card.instanceId));
}

/** Conditional attacks the turn can still turn on. */
function playableLater(data: CardData, input: BotPolicyInput): boolean {
  const functional = key(data);
  if (functional.startsWith("duty bound blitz|")) return yellowSoulThisTurn(input);
  if (functional === CELESTIAL_CATACLYSM) return soulCount(input) >= 3;
  return true;
}

/** Attack sources left after this intent: affordable held attacks and an unused Raydn. */
function attackSourcesAfter(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const used = intentCard(intent, own);
  const consumed = new Set([used?.instanceId, ...pitchIds(intent)]);
  const player = me(input);
  const floating = Math.max(
    0,
    player.resources + pitchValue(intent, input, own) - resourceCost(input.cards[used?.cardId ?? ""]),
  );
  const pitchable = player.hand.filter((card) => !consumed.has(card.instanceId));
  let sources = reserve(input).filter((card) => {
    const data = input.cards[card.cardId];
    if (!data || consumed.has(card.instanceId) || !isAttack(data) || !playableLater(data, input)) return false;
    const pitch = pitchable.reduce((total, other) =>
      other.instanceId === card.instanceId ? total : total + Number(input.cards[other.cardId]?.pitch ?? 0), 0);
    return floating + pitch >= resourceCost(data);
  }).length;
  const sword = raydn(input);
  if (sword && used?.instanceId !== sword.instanceId && raydnAvailable(input)) sources++;
  return sources;
}

/** Whether the attack ends above base power, as the hero ability requires. */
function attackWillBePumped(
  data: CardData,
  card: CardView,
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  if (boardCount(input, "courage") > 0 || vBuffActive(input)) return true;
  const functional = key(data);
  if (functional === RAYDN) return charged(input) || luminaActive(input) || (card.attack ?? 0) > 0;
  if (functional.startsWith("beaming bravado|")) {
    if (!charged(input)) return false;
    return chargeableAfter(intent, input, own).some((held) => isYellow(input.cards[held.cardId]));
  }
  if (functional === TENACITY) {
    return input.view.chain.some((link) => link.attackingCard.owner === input.seat && link.defendingCards.length > 0);
  }
  return false;
}

function goAgainExpected(
  data: CardData,
  card: CardView,
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  if (data.keywords?.includes("Go again") && /(?:^|\n)Go again\s*(?:\n|$)/.test(data.text)) return true;
  if (boardCount(input, "quicken") > 0) return true;
  if (key(data) === "bravery of the blade|1") {
    return charged(input) || chargeableAfter(intent, input, own).length > 0;
  }
  return soulCount(input) > 0 && attackWillBePumped(data, card, intent, input, own);
}

const boltynResponse: ResponseModel = {
  offensiveCards: reserve,
  evaluateResponse: (cards, input) => handResponse(cards, input, boltynSolverRules),
};

function scoreDefend(intent: DefendIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const aggressor = aggressorStance(input);
  return scoreDefenseIntent(intent, input, own, {
    ...boltynResponse,
    cardOpportunity,
    // Tunic stances take damage to keep pressure; Soulbond stances block and pivot.
    responseLossWeight: aggressor ? 1 : 1.2,
    equipmentUseIsFree(card, observed) {
      // Solforge Gauntlet settles into the soul when the chain closes.
      return key(observed.cards[card.cardId]) === SOLFORGE_GAUNTLET;
    },
    adjustCycleValue(value, candidate) {
      const observed = candidate.input;
      const chosenIds = new Set(candidate.chosen.map((card) => card.instanceId));
      const chosenKeys = candidate.chosen.map((card) => key(observed.cards[card.cardId]));
      const handLeft = me(observed).hand.filter((card) => !chosenIds.has(card.instanceId));
      const yellowLeft = handLeft.some((card) => isYellow(observed.cards[card.cardId]));
      const anyLeft = handLeft.length > 0;
      let adjustment = 0;
      // A grace-equipment block becomes soul, and a yellow charge a draw or a Quicken.
      if (chosenKeys.includes(HELM_OF_HALOS_GRACE) && anyLeft) {
        adjustment += SOUL_VALUE + (yellowLeft ? CARD_DRAW_VALUE * 0.5 : 0);
      }
      if (chosenKeys.includes(WARPATH_OF_WINGED_GRACE) && anyLeft) {
        adjustment += SOUL_VALUE + (yellowLeft ? QUICKEN_TOKEN_VALUE * 0.75 : 0);
      }
      if (chosenKeys.includes(SOULBOND_RESOLVE) && anyLeft) adjustment += SOUL_VALUE + 0.5;
      if (chosenKeys.includes(CIRCLET)) {
        const opponent = observed.view.players[1 - observed.seat]!;
        if (opponent.banish.some((card) => !card.faceDown && observed.cards[card.cardId]?.cardType === "action")) {
          adjustment += 1.5;
        }
      }
      if (!candidate.lethal) {
        // The Tunic is the V of the Vanguard engine, not a one-point blocker.
        if (chosenKeys.includes(FYENDALS_SPRING_TUNIC)) adjustment -= 5;
        adjustment -= chosenKeys.filter((functional) => POWER_CARDS.has(functional)).length * 1.5;
        adjustment -= chosenKeys.filter((functional) => functional.startsWith("beaming bravado|")).length * 0.5;
      }
      return adjustment === 0
        ? value
        : adjustValueBreakdown(value, { strategicAdjustment: value.strategicAdjustment + adjustment });
    },
  });
}

/** Value of the turn's first charge: Raydn's +3, Lumina's extra swing, the card's riders. */
function firstChargeValue(sourceKey: string, input: BotPolicyInput, raydnReachable: boolean): number {
  if (charged(input)) return 0;
  let value = raydnReachable ? 3 : 0;
  if (raydnReachable && holds(input, LUMINA_ASCENSION)) value += 3;
  if (sourceKey.startsWith("bolt of courage|")) value += CARD_DRAW_VALUE * 0.6;
  if (sourceKey.startsWith("engulfing light|")) value += SOUL_VALUE * 0.6;
  if (sourceKey === "bravery of the blade|1") value += 2 + COURAGE_TOKEN_VALUE * 0.6;
  if (sourceKey === SAVING_GRACE) value += 2;
  if (holds(input, BEACON_OF_VICTORY) && soulCount(input) > 0) value += BEACON_SEARCH_VALUE * 0.5;
  if (holds(input, COURAGEOUS_STEELHAND)) value += 2;
  return value;
}

/** Value a yellow charge adds for the card asking. */
function yellowChargeValue(sourceKey: string, prompt: string, input: BotPolicyInput): number {
  let value = 0;
  if (sourceKey.startsWith("beaming bravado|")) value += 1;
  if (sourceKey === "spirit of war|1") value += 1.5;
  if (prompt.includes("helm of halo") || sourceKey === WARBAND_OF_BELLONA) value += CARD_DRAW_VALUE;
  if (prompt.includes("warpath")) value += QUICKEN_TOKEN_VALUE;
  if (!yellowSoulThisTurn(input) && input.view.activePlayer === input.seat &&
    reserve(input).some((card) => key(input.cards[card.cardId]).startsWith("duty bound blitz|"))) value += 4;
  return value;
}

/** Source card of a scripted prompt. */
function promptSourceKey(input: BotPolicyInput): string {
  const decision = input.view.pendingDecision;
  const announced = decision?.preStackSource?.card;
  if (announced) return key(input.cards[announced.cardId]);
  if (decision?.promptMessage?.id === "card.evo.soul.charge") return WARBAND_OF_BELLONA;
  const prompt = decision?.prompt.toLowerCase() ?? "";
  const sources = [HELM_OF_HALOS_GRACE, WARPATH_OF_WINGED_GRACE, SOULBOND_RESOLVE, WARBAND_OF_BELLONA, ROARING_BEAM];
  for (const candidate of sources) {
    if (prompt.includes(candidate.split("|")[0]!)) return candidate;
  }
  return "";
}

/** Raydn still swings after this charging attack. */
function raydnReachableAfter(sourceKey: string, chargedCard: CardView, input: BotPolicyInput): boolean {
  // A charge as Raydn attacks pumps this very swing.
  if (raydnAttacking(input)) return true;
  if (!raydnAvailable(input)) return false;
  if (sourceKey === "bravery of the blade|1" || boardCount(input, "quicken") > 0) return true;
  if (!sourceKey.startsWith("beaming bravado|") && !sourceKey.startsWith("bolt of courage|") &&
    !sourceKey.startsWith("engulfing light|") && sourceKey !== "spirit of war|1") return true;
  return boardCount(input, "courage") > 0 || vBuffActive(input) ||
    (sourceKey.startsWith("beaming bravado|") && isYellow(input.cards[chargedCard.cardId]));
}

function scoreChargeOption(intent: ChooseIntent, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision!;
  const prompt = decision.prompt.toLowerCase();
  const card = optionCard(intent, input);
  if (!card) return intent.optionId === "no" || intent.optionId === "pass" ? 0 : -50;
  const data = input.cards[card.cardId];
  const sourceKey = promptSourceKey(input);
  const ourTurn = input.view.activePlayer === input.seat;
  let gain = SOUL_VALUE - cardChargeCost(card, input, cardOpportunity);
  // Spirit of Eirina enters the arena instead of the soul: a free setup.
  if (key(data) === SPIRIT_OF_EIRINA && boardCount(input, "spirit of eirina") === 0) gain += SPIRIT_OF_EIRINA_VALUE;
  if (boardCount(input, "blessing of bellona") > 0) gain += COURAGE_TOKEN_VALUE;
  if (boardCount(input, "blessing of suraya") > 0) gain += PONDER_TOKEN_VALUE;
  if (key(data) === BANNERET_OF_SWORDSMANSHIP && (ourTurn ? raydnAvailable(input) : true)) {
    gain += FLURRY_TOKEN_VALUE;
  }
  if (isYellow(data)) gain += yellowChargeValue(sourceKey, prompt, input);
  if (ourTurn && prompt.includes("v of the vanguard")) {
    // Each Light card charged pumps every remaining link of the chain.
    const others = me(input).hand.filter((held) => held.instanceId !== card.instanceId);
    const sources = others.filter((held) => isAttack(input.cards[held.cardId])).length +
      me(input).arsenal.filter((held) => isAttack(input.cards[held.cardId])).length +
      (raydnAvailable(input) ? 1 : 0);
    const fuel = soulCount(input) + 1 + boardCount(input, "quicken");
    const attacksLeft = 1 + Math.max(0, Math.min(sources, fuel));
    gain += isLight(data) ? attacksLeft : 0;
    // The chain needs attacks to carry the pump.
    if (isAttack(data) && sources === 0) gain -= 4;
    return gain;
  }
  if (ourTurn) gain += firstChargeValue(sourceKey, input, raydnReachableAfter(sourceKey, card, input));
  else if (sourceKey === SOULBOND_RESOLVE) gain += 1;
  else if (sourceKey === SAVING_GRACE && !charged(input)) gain += 2;
  return gain;
}

/** Beacon banishes the whole soul so a Roaring Beam above it charges before the search resolves. */
function roaringBeamChargesBeacon(input: BotPolicyInput): boolean {
  return !charged(input) && holds(input, ROARING_BEAM) && (raydnAttacking(input) || raydnAvailable(input));
}

/** Beacon of Victory's X: one for the search, lethal when reachable, else the spare soul. */
function desiredBeaconX(input: BotPolicyInput): number {
  const soul = soulCount(input);
  const link = currentLink(input);
  const opponent = input.view.players[1 - input.seat]!;
  const pending = link ? Math.max(0, link.attackValue - link.defenseValue) : 0;
  const lethal = opponent.life - pending;
  if (lethal > 0 && lethal <= soul) return lethal;
  if (charged(input)) return 1;
  if (roaringBeamChargesBeacon(input)) return soul;
  const further = reserve(input).filter((card) => isAttack(input.cards[card.cardId])).length +
    (raydnAvailable(input) ? 1 : 0);
  return Math.max(1, soul - Math.min(soul - 1, further));
}

/** Beacon of Victory search targets, best first. */
function searchValue(card: CardView, input: BotPolicyInput): number {
  const functional = key(input.cards[card.cardId]);
  const spiritOut = boardCount(input, "spirit of eirina") > 0 ||
    me(input).soul.some((held) => key(input.cards[held.cardId]) === SPIRIT_OF_EIRINA);
  if (functional === SPIRIT_OF_EIRINA) return spiritOut ? 5 : 100;
  if (functional === LUMINA_ASCENSION) return 80;
  if (functional.startsWith("duty bound blitz|")) return yellowSoulThisTurn(input) ? 75 : 40;
  if (functional === CELESTIAL_CATACLYSM) return soulCount(input) >= 3 ? 70 : 20;
  if (functional === "bravery of the blade|1") return 60;
  if (functional === BLESSING_OF_SURAYA) return 58;
  if (functional === V_OF_THE_VANGUARD) return me(input).hand.length >= 3 ? 55 : 25;
  if (functional === BATTLEFIELD_BEACON) return 50;
  if (functional === BLESSING_OF_BELLONA) return 45;
  if (functional === BOLTING_BLADE) return 42;
  return 10 + Number(input.cards[card.cardId]?.attack ?? 0);
}

/** Warmonger's Diplomacy: compare what the hand can still do under war or peace. */
function diplomacyValue(mode: "war" | "peace", input: BotPolicyInput): number {
  const held = reserve(input);
  const chargeAttack = held.some((card) => isChargeAttack(input.cards[card.cardId]));
  if (mode === "war") {
    const attacks = held.reduce((total, card) => {
      const data = input.cards[card.cardId];
      if (!data || !isAttack(data)) return total;
      const yellowElsewhere = held.some((other) =>
        isYellow(input.cards[other.cardId]) && other.instanceId !== card.instanceId
      );
      if (key(data).startsWith("duty bound blitz|") && !yellowSoulThisTurn(input) && !yellowElsewhere) return total;
      if (key(data) === CELESTIAL_CATACLYSM && soulCount(input) < 3) return total;
      return total + (card.attack ?? data.attack ?? 0);
    }, 0);
    return attacks + (chargeAttack && raydnAvailable(input) ? 3 : 0) + boardCount(input, "courage");
  }
  return held.reduce((total, card) => {
    const data = input.cards[card.cardId];
    const functional = key(data);
    if (functional === BLESSING_OF_BELLONA) return total + SOUL_VALUE + COURAGE_TOKEN_VALUE;
    if (functional === BLESSING_OF_SURAYA) return total + SOUL_VALUE + PONDER_TOKEN_VALUE;
    if (functional === SPIRIT_OF_EIRINA) {
      return total + (boardCount(input, "spirit of eirina") > 0 ? 0 : SPIRIT_OF_EIRINA_VALUE);
    }
    if (functional === EDICT_OF_STEEL) return total + FLURRY_TOKEN_VALUE;
    return total;
  }, 0);
}

function scoreChoice(intent: ChooseIntent, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  const prompt = decision.prompt.toLowerCase();
  const card = optionCard(intent, input);

  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, arsenalValuer(boltynSolverRules));
  }
  if (decision.resourcePayment) {
    const ids = resourcePaymentPitchIds(intent, input) ?? [];
    const own = new Map(me(input).hand.map((held) => [held.instanceId, held]));
    return 30 - ids.reduce((total, id) => {
      const held = own.get(id);
      return total + (held ? cardOpportunity(held, input) : 0);
    }, 0);
  }
  if (/\bcharge\b/.test(prompt)) return scoreChargeOption(intent, input);
  if (prompt.includes("war or peace") && (intent.optionId === "war" || intent.optionId === "peace")) {
    // Ties keep war: Raydn and the charge attacks are the deck's engine.
    return diplomacyValue(intent.optionId, input) + (intent.optionId === "war" ? 0.5 : 0);
  }
  if (prompt.includes("nonzero x")) {
    const value = Number(/^x:(\d+)$/.exec(intent.optionId)?.[1]);
    return Number.isFinite(value) ? 50 - Math.abs(value - desiredBeaconX(input)) * 10 : -100;
  }
  if (prompt.includes("soul card") && prompt.includes("banish")) return 1;
  if (prompt.includes("search for an action card")) return card ? searchValue(card, input) : -20;
  if (prompt.includes("battlefield beacon")) {
    return ({ courage: 100, vigor: 20, toughness: 5 } as Record<string, number>)[intent.optionId] ?? 0;
  }
  if (prompt.includes("bottom of your deck")) {
    // Sink Below cycles a card: only a card below a fresh draw goes under.
    if (intent.optionId === "pass" || !card) return 1;
    return 5 - cardChargeCost(card, input, cardOpportunity);
  }
  if (prompt.includes("banished card face-down") || prompt.includes("face down")) {
    return card ? 10 + Number(card.attack ?? 0) + Number(input.cards[card.cardId]?.cost ?? 0) : 0;
  }
  if (prompt.includes("energy counter")) return scoreBinaryChoice(intent.optionId, 10, -20) ?? 0;
  if (prompt.includes("discard") || prompt.includes("put a card from your hand")) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 20, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 10, -2);
  if (binary !== undefined) return binary;
  return card ? 10 - cardOpportunity(card, input) : 1;
}

/** Resources a card playable now still needs beyond what is floating. */
function resourcesWanted(input: BotPolicyInput): number {
  const player = me(input);
  const ourTurn = input.view.activePlayer === input.seat;
  const reacting = input.view.pendingDecision?.kind === "defense-reaction";
  const costs = reserve(input).flatMap((card) => {
    const data = input.cards[card.cardId];
    // A defense reaction only spends resources in the opponent's reaction step.
    const usable = ourTurn ? data?.cardType !== "defense-reaction" : reacting && data?.cardType === "defense-reaction";
    return usable ? [resourceCost(data)] : [];
  });
  const needed = Math.max(0, ...costs);
  return Math.max(0, needed - player.resources);
}

/** The ability is offered again while its go-again layer is still pending. */
function heroAbilityPending(input: BotPolicyInput): boolean {
  const heroId = me(input).heroInstanceId;
  return input.view.stack.some((layer) => layer.seat === input.seat && layer.card?.instanceId === heroId);
}

function scoreHeroAbility(input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const link = currentLink(input);
  if (!link || link.resolved || !currentAttackIsOurs(input) || !canGainGoAgain(link)) return -100;
  if (input.view.pendingDecision?.kind !== "attack-reaction" || heroAbilityPending(input)) return -100;
  const pass: GameIntent = { kind: "pass" };
  const sword = raydn(input);
  const swordWorthSwinging = raydnAvailable(input) &&
    (charged(input) || luminaActive(input) || (sword?.attack ?? 0) > 0 || boardCount(input, "courage") > 0 ||
      vBuffActive(input) || holds(input, LUMINA_ASCENSION));
  const sources = attackSourcesAfter(pass, input, own);
  const others = sources - (raydnAvailable(input) ? 1 : 0);
  if (others === 0 && !swordWorthSwinging) return -100;
  // Floating action points, such as Lumina's go again, already carry every remaining attack.
  if (me(input).actionPoints >= sources) return -100;
  return 30;
}

/** Raydn swings charged this turn and a path leads to it. */
function raydnSwingSecured(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): boolean {
  if (!raydnAvailable(input)) return false;
  const player = me(input);
  const chargeAttacks = player.hand.filter((held) => isChargeAttack(input.cards[held.cardId]));
  if (!charged(input) && !(chargeAttacks.length > 0 && chargeableAfter(intent, input, own).length > 1)) return false;
  const others = reserve(input).flatMap((card) => {
    const data = input.cards[card.cardId];
    return data && isAttack(data) && playableLater(data, input) ? [{ card, data }] : [];
  });
  if (others.length === 0) return true;
  if (boardCount(input, "quicken") > 0) return true;
  return others.some(({ card, data }) => goAgainExpected(data, card, intent, input, own));
}

function raydnSwingPower(card: CardView, input: BotPolicyInput): number {
  return (card.attack ?? 0) + (charged(input) ? 3 : 0) + (luminaActive(input) ? 1 : 0) +
    (boardCount(input, "courage") > 0 ? 1 : 0);
}

/** A 0-power swing that opens no reaction window for Roaring Beam, a lethal Beacon or a Warband charge. */
function emptyRaydnSwing(input: BotPolicyInput): boolean {
  const sword = raydn(input);
  if (!sword || raydnSwingPower(sword, input) > 0) return false;
  return !holds(input, ROARING_BEAM) && !ongoingFrom(input, WARBAND_OF_BELLONA) &&
    !(holds(input, BEACON_OF_VICTORY) && soulCount(input) >= input.view.players[1 - input.seat]!.life);
}

function scoreRaydn(
  card: CardView,
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const power = raydnSwingPower(card, input);
  const further = attackSourcesAfter(intent, input, own) > 0;
  if (power === 0) return emptyRaydnSwing(input) ? -5 : 3;
  let score = power + (ongoingFrom(input, IRONSONG_VERSUS) ? 2 : 0);
  if (further && (boardCount(input, "quicken") > 0 || soulCount(input) > 0)) score += 10;
  // Set-up first: a charge, Lumina or Edict makes the swing bigger.
  if (!charged(input) && me(input).hand.some((held) => isChargeAttack(input.cards[held.cardId]))) score -= 4;
  // Every held Lumina resolves first; an instant one follows the swing instead.
  if (charged(input) && holds(input, LUMINA_ASCENSION) && !luminaIsInstant(input)) {
    score -= 20;
  }
  if (holds(input, EDICT_OF_STEEL)) score -= 5;
  return score;
}

function scoreAttackReaction(data: CardData, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const link = currentLink(input);
  if (!link || !currentAttackIsOurs(input) || input.view.pendingDecision?.kind !== "attack-reaction") return -100;
  const functional = key(data);
  const soul = soulCount(input);
  const further = attackSourcesAfter({ kind: "pass" }, input, own) > 0;
  const opponent = input.view.players[1 - input.seat]!;
  if (functional === BEACON_OF_VICTORY) {
    if (soul === 0) return -100;
    const pending = Math.max(0, link.attackValue - link.defenseValue);
    const lethal = pending < opponent.life && pending + soul >= opponent.life;
    const combo = roaringBeamChargesBeacon(input);
    // Uncharged it trades a soul card and the search for +1: hold it for a charged turn.
    if (!charged(input) && !lethal && !combo) return -100;
    return 8 + (charged(input) || combo ? 12 : 0) + (lethal ? 30 : 0) +
      (canGainGoAgain(link) && further && soul >= 2 ? 4 : 0);
  }
  if (functional === ROARING_BEAM) return soul === 0 ? 14 : further ? 6 : 2;
  if (functional === COURAGEOUS_STEELHAND) {
    return charged(input) ? 9 + (canGainGoAgain(link) && soul >= 1 && further ? 6 : 0) : -100;
  }
  return 4;
}

/** An instant Lumina waits for Raydn's reaction step, after blocks, unless its go again is needed sooner. */
function scoreLumina(input: BotPolicyInput): number {
  if (!luminaWindow(input)) return -100;
  const ready = luminaActive(input) ? 25 : 45;
  if (raydnAttacking(input)) return ready;
  if (!luminaIsInstant(input) || !raydnAvailable(input)) return luminaActive(input) ? 25 : 40;
  return input.view.pendingDecision?.kind === "attack-reaction" && luminaActionPointNeeded(input) ? ready : -5;
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -50;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;
  const functional = key(data);
  const opening = shouldPreserveOpeningHand(input);
  const player = me(input);
  const soul = soulCount(input);
  const further = attackSourcesAfter(intent, input, own) > 0;
  const chargeable = chargeableAfter(intent, input, own);
  const ourTurn = input.view.activePlayer === input.seat;
  let score: number;

  if (intent.kind === "activate-ability") {
    if (card.instanceId === player.heroInstanceId) {
      score = scoreHeroAbility(input, own);
    } else if (functional === RAYDN) {
      score = opening ? -100 : scoreRaydn(card, intent, input, own);
    } else if (functional === FYENDALS_SPRING_TUNIC) {
      // Unneeded resource sources rank below pass so the root cap still compares passing.
      score = resourcesWanted(input) > 0
        ? (ourTurn && holds(input, V_OF_THE_VANGUARD) && player.hand.length >= 4 ? 50 : 25)
        : -100;
    } else if (functional === IRONSONG_VERSUS) {
      score = ourTurn && !opening && raydnSwingSecured(intent, input, own) ? 8 : -20;
    } else if (functional === WARBAND_OF_BELLONA) {
      const chargeAttack = player.hand.some((held) => isChargeAttack(input.cards[held.cardId]));
      const payoff = reserve(input).some((held) =>
        isAttack(input.cards[held.cardId]) || key(input.cards[held.cardId]) === LUMINA_ASCENSION
      );
      score = ourTurn && !opening && !charged(input) && !chargeAttack && chargeable.length > 0 &&
          raydnAvailable(input) && payoff
        ? 12
        : -40;
    } else if (functional === SNAPDRAGON_SCALERS) {
      const link = currentLink(input);
      score = currentAttackIsOurs(input) && !!link && canGainGoAgain(link) &&
          input.view.pendingDecision?.kind === "attack-reaction" && further
        ? 28
        : -100;
    } else if (functional === ENERGY_POTION) {
      score = resourcesWanted(input) > 0 ? 15 : -100;
    } else {
      score = -100;
    }
  } else if (functional === BLESSING_OF_BELLONA || functional === BLESSING_OF_SURAYA) {
    score = opening ? 30 : functional === BLESSING_OF_SURAYA ? 24 : 22;
  } else if (functional === SPIRIT_OF_EIRINA) {
    score = boardCount(input, "spirit of eirina") > 0 ? -100 : opening ? 28 : 14;
  } else if (opening) {
    score = -100;
  } else if (functional === V_OF_THE_VANGUARD) {
    // Light charges pump V and feed the hero ability that extends it.
    const lights = chargeable.filter((held) => isLight(input.cards[held.cardId])).length;
    const pumped = lights > 0 || boardCount(input, "courage") > 0 || vBuffActive(input);
    const goAgain = boardCount(input, "quicken") > 0 || (pumped && (soul >= 1 || lights > 0));
    score = 3 + Math.min(lights, 2) + (goAgain && further ? 14 : 0) +
      (chargeable.length >= 3 ? 10 + 3 * chargeable.length : 0);
  } else if (functional === LUMINA_ASCENSION && !ourTurn) {
    score = -100;
  } else if (functional === LUMINA_ASCENSION) {
    score = scoreLumina(input);
  } else if (functional === EDICT_OF_STEEL) {
    // A bare Flurry is not worth the card; it blocks for 3 until a charged Raydn turn.
    score = raydnSwingSecured(intent, input, own) ? 10 + (charged(input) && holds(input, LUMINA_ASCENSION) ? 6 : 0) : -100;
  } else if (functional === CELESTIAL_CATACLYSM) {
    score = 7 + (further ? 14 : 0) - (soul - 3 < 1 && further ? 2 : 0);
  } else if (functional === BATTLEFIELD_BEACON) {
    const banished = soulBanishedThisChain(input);
    score = 3 + 2 * Math.min(3, banished) +
      (banished === 0 && soul >= 3 && holds(input, CELESTIAL_CATACLYSM) ? -3 : 0);
  } else if (data.cardType === "attack-reaction") {
    score = scoreAttackReaction(data, input, own);
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input) + (functional === SAVING_GRACE && chargeable.length > 0 ? 4 : 0);
  } else if (isAttack(data)) {
    score = card.attack ?? data.attack ?? 0;
    const goAgain = goAgainExpected(data, card, intent, input, own);
    if (goAgain && further) score += 14;
    else if (!goAgain && further) score -= 4;
    if (isChargeAttack(data) && !charged(input) && chargeable.length > 0 &&
      (raydnAvailable(input) || holds(input, LUMINA_ASCENSION))) score += 6;
    if (functional.startsWith("beaming bravado|") &&
      chargeable.some((held) => isYellow(input.cards[held.cardId]))) score += 1;
    if (functional.startsWith("bolt of courage|") && (charged(input) || chargeable.length > 0)) score += 2;
    if (functional === BOLTING_BLADE) score += 2;
    if (functional === BANNERET_OF_SWORDSMANSHIP && raydnAvailable(input) && chargeable.length > 0) score -= 2;
    if (functional === TENACITY) {
      score += input.view.chain.reduce((count, link) =>
        link.attackingCard.owner === input.seat ? count + link.defendingCards.length : count, 0);
    }
    if (intent.kind === "play-from-arsenal") score += 2;
  } else if (functional === ENERGY_POTION) {
    score = further ? -15 : 2;
  } else {
    score = 5;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input);
  }
  return score;
}

/** Deterministic, projection-only Boltyn policy. Equal scores retain engine order. */
function chooseBoltynReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    response: boltynResponse,
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: arsenalValuer(boltynSolverRules),
  });
}

export interface BoltynIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
}

// Several short attacks per turn: more transitions than nodes, and a larger slice for the best root.
const BOLTYN_MAX_SEARCH_NODES = 32;
const BOLTYN_MAX_TRANSITIONS = 400;
const BOLTYN_MAX_ROOT_CANDIDATES = 5;
const BOLTYN_FIRST_ROOT_TRANSITIONS = 160;
// Charge, setup and two Raydn swings outrun an even share of the node budget.
const BOLTYN_FIRST_ROOT_NODES = 16;

/** Boltyn: charge, chain go-again attacks through the soul, convert with V or Lumina. */
export function chooseBoltynIntentWithTrace(input: BotPolicyInput): BoltynIntentDecision {
  const reactive = chooseBoltynReactiveIntent(input);
  const guard = (intent: GameIntent) => enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, intent));
  if (shouldPreserveOpeningHand(input)) return { intent: guard(reactive) };
  const plan = planTacticalTurn(input, {
    chooseForced: (forced) => chooseBoltynReactiveIntent({ ...forced, state: undefined }),
    rules: boltynSolverRules,
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    prepareCandidates: (candidates, observed) => {
      const own = ownCards(observed);
      const allowed = candidates.filter((intent) =>
        (!playsLumina(intent, observed) || luminaWindow(observed)) &&
        (!playsCard(intent, observed, EDICT_OF_STEEL) || raydnSwingSecured(intent, observed, own)) &&
        !(activatesRaydn(intent, observed) && emptyRaydnSwing(observed))
      );
      // Each Lumina before the first swing adds a swing and +1 to all of them.
      const luminaFirst = !luminaIsInstant(observed) && allowed.some((intent) => playsLumina(intent, observed));
      return luminaFirst ? allowed.filter((intent) => !activatesRaydn(intent, observed)) : allowed;
    },
    // A tie-breaker below one damage equivalent, not a substitute for the rollout.
    scoreIntent: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    positionBonus: (observed, _complete, root) =>
      (boltynPositionValue(observed, futureOffenseRate(observed, root, FLURRY_TOKEN_VALUE)) +
        observed.view.players[observed.seat].life) * POINTS_PER_DAMAGE,
    maxSearchNodes: BOLTYN_MAX_SEARCH_NODES,
    maxTransitions: BOLTYN_MAX_TRANSITIONS,
    maxRootCandidates: BOLTYN_MAX_ROOT_CANDIDATES,
    firstRootTransitionBudget: BOLTYN_FIRST_ROOT_TRANSITIONS,
    firstRootNodeBudget: BOLTYN_FIRST_ROOT_NODES,
  });
  const intent = guard(plan?.intent ?? reactive);
  return plan ? { intent, plan } : { intent };
}

export function chooseBoltynIntent(input: BotPolicyInput): GameIntent {
  return chooseBoltynIntentWithTrace(input).intent;
}
