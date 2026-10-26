import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  chooseScoredIntent,
  currentLink,
  defenderDefense,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  incomingAttackDamage,
  intentCard,
  isAttack,
  isOpeningTurn,
  optionCard,
  ownCards,
  pitchIds,
  pitchValue,
  preferredPitchIntents,
  resourcePaymentPitchIds,
  resourcesAfterCost,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  type BotPolicyInput,
  type DefenseCandidateContext,
  type DefensePermission,
  type PlannedPrevention,
  type ResponseModel,
} from "./policy.js";
import { SIGNIFICANT_ON_HIT_VALUE } from "./on-hit.js";
import { threatenedAttackDamage } from "./public-threat.js";
import { DISRUPTION_HIT_CHANCE } from "./card-ev.js";
import { probabilityAtLeastOne, totalCount, unseenCounts } from "./deck-knowledge.js";
import { cardUses, solverCard, type HeroSolverRules, type SolverCardPatch } from "./card-model.js";
import type { PendingEffect, SolverCard, SolverView } from "./hand-solver.js";
import {
  arsenalCardValue, arsenalValuer, handResponse, heldCardValue, opportunityValuer, solveHand,
} from "./hand-value.js";
import { planTacticalTurn, type TacticalTurnPlan } from "./tactical-turn-planner.js";
import { POINTS_PER_DAMAGE } from "./turn-planner.js";
import { valueBreakdown, type LifeThreshold, type ValueBreakdown } from "./value.js";
import {
  chooseLeviaMacro,
  leviaLifeRisk,
  leviaMacroIntentBonus,
  leviaMacroPositionBonus,
  type LeviaMacroChoice,
} from "./levia-macros.js";
import {
  leviaAttackContinues,
  BLOODRUSH_PLAN_WIDTH,
  leviaAttackCost,
  leviaAttackPair,
  leviaAttackPlayable,
  leviaBanishAccess,
  leviaBloodDebt,
  leviaBloodDebtAction as bloodDebtAction,
  leviaBloodrushTurn,
  leviaBloodrushWorthSending,
  leviaEffectActive,
  leviaHoldsBellow,
  leviaSixPower,
  LEVIA_GATE_COST,
  leviaSashEnablesPair,
  type LeviaBanishAccess,
} from "./levia-turn.js";

function name(data: CardData | undefined): string {
  return data?.name.toLowerCase() ?? "";
}

function ownBloodDebt(input: BotPolicyInput): number {
  return leviaBloodDebt(input.view.players[input.seat].banish, input);
}

/** Most life Levia pays for a Hexagore swing that does not end the game. */
const HEXAGORE_MAX_SELF_DAMAGE = 2;

function hexagoreSelfDamage(input: BotPolicyInput): number {
  return Math.max(0, 6 - ownBloodDebt(input));
}

/** A Hexagore swing that costs more life than the cap and is not a survivable kill. */
function costlyHexagore(intent: GameIntent, input: BotPolicyInput): boolean {
  if (intent.kind !== "activate-ability") return false;
  const me = input.view.players[input.seat];
  const weapon = me.weapons.find((held) => held.instanceId === intent.sourceInstanceId);
  const data = input.cards[weapon?.cardId ?? ""];
  if (name(data) !== "hexagore, the death hydra") return false;
  const selfDamage = hexagoreSelfDamage(input);
  if (selfDamage <= HEXAGORE_MAX_SELF_DAMAGE) return false;
  const lethal = (data?.attack ?? 0) >= input.view.players[1 - input.seat]!.life && selfDamage < me.life;
  return !lethal;
}

function withoutCostlyHexagore(intents: readonly GameIntent[], input: BotPolicyInput): GameIntent[] {
  return intents.filter((intent) => !costlyHexagore(intent, input));
}

/** Share of six-power cards assumed in an unknown deck. */
const DEFAULT_TOP_SIX_SHARE = 0.6;

/** Share of the bot's unseen deck with 6 or more power: the chance a banish
 * from the top of the deck suppresses blood debt. Rockyard Rodeo's power is
 * its weapon's wherever it is. */
function topSixShare(input: BotPolicyInput): number {
  const counts = unseenCounts(input, "own");
  const total = counts ? totalCount(counts) : 0;
  if (!counts || total === 0) return DEFAULT_TOP_SIX_SHARE;
  const me = input.view.players[input.seat];
  const weaponPower = Math.max(0, ...me.weapons.map((weapon) => input.cards[weapon.cardId]?.attack ?? 0));
  let sixes = 0;
  for (const [cardId, count] of counts) {
    const data = input.cards[cardId];
    const power = name(data) === "rockyard rodeo" ? weaponPower : data?.attack ?? 0;
    if (power >= 6) sixes += count;
  }
  return sixes / total;
}

/** Chance a play banishes a card with 6 or more power: the top of the deck
 * for Feeding Frenzy, Beckoning Hunger and Pull from Beyond; three random
 * graveyard cards for Dread Screamer, Endless Maw and Shadowrealm Horror; a
 * chosen six for Soul Harvest. */
function sixBanishChance(data: CardData | undefined, input: BotPolicyInput): number {
  const me = input.view.players[input.seat];
  const sixes = me.graveyard.filter((card) => (input.cards[card.cardId]?.attack ?? 0) >= 6).length;
  switch (name(data)) {
    case "feeding frenzy":
    case "beckoning hunger":
    case "pull from beyond":
      return me.deckCount > 0 ? topSixShare(input) : 0;
    case "dread screamer":
    case "endless maw":
    case "shadowrealm horror":
      return probabilityAtLeastOne(sixes, me.graveyard.length, 3);
    case "soul harvest":
      return sixes > 0 ? 1 : 0;
    default:
      return 0;
  }
}

/** Solver flag: percent chance the line has already banished a six. */
const SUPPRESSION_FLAG = "levia:suppressed";

function suppressionBefore(view: SolverView): number {
  return view.flag(SUPPRESSION_FLAG) / 100;
}

function suppressionAfter(view: SolverView, chance: number): number {
  const before = suppressionBefore(view);
  return before + (1 - before) * chance;
}

/** A held six-power card that can be banished from hand at instant speed,
 * suppressing blood debt on demand. */
function handBanishSuppressor(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  return HAND_BANISH_INSTANTS.includes(name(data)) && (data?.attack ?? 0) >= 6 &&
    input.view.players[input.seat].hand.some((held) => held.instanceId === card.instanceId);
}

function hasGate(input: BotPolicyInput): boolean {
  return input.view.players[input.seat].board.some((card) =>
    name(input.cards[card.cardId]) === "gate to i'arathael"
  );
}

function playableBanishAttacks(input: BotPolicyInput, spent: ReadonlySet<number>): CardView[] {
  const me = input.view.players[input.seat];
  const permitted = me.banish.filter((card) =>
    !card.faceDown && !spent.has(card.instanceId) && card.playableFromSourceCardId !== undefined &&
    isAttack(input.cards[card.cardId])
  );
  const permittedIds = new Set(permitted.map((card) => card.instanceId));
  const gateUses = me.board.filter((card) =>
    name(input.cards[card.cardId]) === "gate to i'arathael"
  ).length;
  const blasmophetUses = me.board.some((card) =>
    name(input.cards[card.cardId]) === "blasmophet, the insatiable hunger"
  ) ? 1 : 0;
  const potentialUses = gateUses + blasmophetUses;
  if (potentialUses === 0) return permitted;
  const potential = me.banish.filter((card) =>
    !spent.has(card.instanceId) && !permittedIds.has(card.instanceId) &&
    bloodDebtAction(card, input) && isAttack(input.cards[card.cardId])
  ).sort((left, right) =>
    (input.cards[right.cardId]?.attack ?? 0) - (input.cards[left.cardId]?.attack ?? 0)
  ).slice(0, potentialUses);
  return [...permitted, ...potential];
}

function attackReserve(input: BotPolicyInput, spent: ReadonlySet<number>): CardView[] {
  const me = input.view.players[input.seat];
  return [
    ...[...me.hand, ...me.arsenal].filter((card) =>
      !spent.has(card.instanceId) && isAttack(input.cards[card.cardId])
    ),
    ...playableBanishAttacks(input, spent),
  ];
}

/** Whether an action card could spend Scabskin's action points: playable and
 * paid from the floating resources plus the rest of the hand's pitch. */
function actionPointsUsable(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  const sash = leviaEffectActive(input, "savage sash");
  const actions = [
    ...[...me.hand, ...me.arsenal].filter((card) => input.cards[card.cardId]?.cardType === "action"),
    ...playableBanishAttacks(input, new Set()),
  ];
  return actions.some((card) => {
    const data = input.cards[card.cardId];
    if (isAttack(data) && !leviaAttackPlayable(card, input)) return false;
    const pitch = me.hand.filter((held) => held.instanceId !== card.instanceId)
      .reduce((sum, held) => sum + (input.cards[held.cardId]?.pitch ?? 0), 0);
    return me.resources + pitch >= leviaAttackCost(data, sash);
  });
}

/** Brute weapons attack for {r}{r}. */
const WEAPON_SWING_COST = 2;

/** Whether a legal weapon swing and one terminal attack card fit the floating
 * resources plus the rest of the hand's pitch, given an action point for each.
 * A card with go again already reaches the weapon without a roll. */
function weaponSwingPair(input: BotPolicyInput, cards: readonly CardView[]): boolean {
  const me = input.view.players[input.seat];
  const weaponIds = new Set(me.weapons.map((weapon) => weapon.instanceId));
  const swing = input.legal.some((intent) => {
    if (intent.kind !== "activate-ability" || !weaponIds.has(intent.sourceInstanceId)) return false;
    const weapon = me.weapons.find((held) => held.instanceId === intent.sourceInstanceId);
    // A Hexagore swing that costs life is not worth rolling for.
    return name(input.cards[weapon?.cardId ?? ""]) !== "hexagore, the death hydra" || hexagoreSelfDamage(input) === 0;
  });
  if (!swing) return false;
  const sash = leviaEffectActive(input, "savage sash");
  return cards.some((card) => {
    if (!leviaAttackPlayable(card, input) || leviaAttackContinues(card, input)) return false;
    const pitch = me.hand.filter((held) => held.instanceId !== card.instanceId)
      .reduce((sum, held) => sum + (input.cards[held.cardId]?.pitch ?? 0), 0);
    return me.resources + pitch >= WEAPON_SWING_COST + leviaAttackCost(input.cards[card.cardId], sash);
  });
}

function gateTargetValue(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  if (intent.kind !== "activate-ability" || intent.targetCardInstanceId === undefined) return -500;
  const me = input.view.players[input.seat];
  if (input.view.activePlayer !== input.seat || me.actionPoints < 1) return -500;
  const target = me.banish.find((card) => card.instanceId === intent.targetCardInstanceId);
  if (!target || !bloodDebtAction(target, input) || target.playableFromSourceCardId !== undefined ||
    !leviaAttackPlayable(target, input)) return -500;
  const targetData = input.cards[target.cardId];
  if (!targetData) return -500;
  const pitched = new Set(pitchIds(intent));
  const pitchedResources = pitchValue(intent, input, own);
  const pitchRequired = intent.pitchRequired ?? 0;
  const costToActivate = pitchRequired > 0
    ? me.resources + pitchRequired
    : 1;
  const afterActivation = Math.max(0, me.resources + pitchedResources - costToActivate);
  const remainingPitch = me.hand.filter((card) => !pitched.has(card.instanceId)).reduce((total, card) =>
    total + (input.cards[card.cardId]?.pitch ?? 0), 0
  );
  if (leviaAttackCost(targetData, leviaEffectActive(input, "savage sash")) > afterActivation + remainingPitch) {
    return -500;
  }
  const bloodrushActive = leviaEffectActive(input, "bloodrush bellow");
  // Rank targets by the attack they will make, not by their value in hand.
  const power = (targetData.attack ?? 0) + (bloodrushActive && targetData.classes?.includes("brute") ? 2 : 0);
  // Banked for the Bellow turn while one waits, unless nothing else attacks.
  if (!bloodrushActive && leviaHoldsBellow(input) && hasDirectAttack(input, own)) return -20;
  const reserve = [...me.hand, ...me.arsenal].filter((card) => !pitched.has(card.instanceId));
  if (!leviaAttackPair(input, reserve) &&
    leviaAttackPair(input, [...reserve, target], { resources: afterActivation })) {
    return (bloodrushActive ? 95 : 66) + power * 0.1;
  }
  // A Gate costs a resource and an attack permission. Prefer an attack already
  // available, especially while Bloodrush is running, before paying for access.
  if (hasDirectAttack(input, own)) return (leviaAttackContinues(target, input) ? 42 : 24) + power * 0.1;
  return 54 + Math.min(30, power * 3);
}

function hasDirectAttack(input: BotPolicyInput, own: ReadonlyMap<number, CardView>): boolean {
  return input.legal.some((intent) => {
    const card = intentCard(intent, own);
    if (!card) return false;
    return (intent.kind === "play-card" || intent.kind === "play-from-arsenal" || intent.kind === "play-from-zone") &&
      isAttack(input.cards[card.cardId]);
  });
}

function gateSetupValue(card: CardView, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  if (hasGate(input)) return -80;
  if (input.view.turn === 1) return 96;
  const me = input.view.players[input.seat];
  const remaining = me.hand.filter((held) => held.instanceId !== card.instanceId);
  const affordableTarget = me.banish.some((target) =>
    bloodDebtAction(target, input) && leviaAttackPlayable(target, input) &&
    input.cards[target.cardId]?.cost === 2 && target.playableFromSourceCardId === undefined
  ) && remaining.some((held) => input.cards[held.cardId]?.pitch === 3);
  const convertible = hasDirectAttack(input, own) || input.legal.some((intent) =>
    (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
    name(input.cards[intentCard(intent, own)?.cardId ?? ""]) === "bloodrush bellow"
  );
  return affordableTarget ? 46 : !convertible ? 24 : -80;
}

/** Whether the card's pitch is what funds this turn's attack pair, or (for
 * `any`) its only attack. */
function fundsAttackPair(card: CardView, input: BotPolicyInput, any = false): boolean {
  const me = input.view.players[input.seat];
  const reserve = [...me.hand, ...me.arsenal];
  const without = reserve.filter((held) => held.instanceId !== card.instanceId);
  if (leviaAttackPair(input, reserve) && !leviaAttackPair(input, without)) return true;
  return any && affordableFollowups(input, new Set()) > 0 &&
    affordableFollowups(input, new Set([card.instanceId])) === 0;
}

function affordableFollowups(input: BotPolicyInput, spent: ReadonlySet<number>): number {
  const me = input.view.players[input.seat];
  const pitch = me.hand.filter((card) => !spent.has(card.instanceId))
    .reduce((total, card) => total + (input.cards[card.cardId]?.pitch ?? 0), 0);
  return attackReserve(input, spent).filter((card) => leviaAttackPlayable(card, input) &&
    (input.cards[card.cardId]?.cost ?? 0) <= me.resources + pitch -
      (me.hand.some((held) => held.instanceId === card.instanceId) ? input.cards[card.cardId]?.pitch ?? 0 : 0)
  ).length;
}

/** Hex Gauntlet is a one-shot 6{p} banish. Spend it only where that banish
 * matters: after Feeding Frenzy's own banish missed and its go again is needed
 * for the next attack, or as the turn's last action to suppress blood debt. */
function hexGauntletValue(input: BotPolicyInput, gauntlet: CardView): number {
  const me = input.view.players[input.seat];
  if (input.view.activePlayer !== input.seat || input.view.stack.length > 0 ||
    input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true) return -80;
  const open = input.view.chain.find((link) => !link.resolved);
  if (open) {
    // Wait until the attack trigger has banished the top card.
    if (open.onStack || open.attackingCard.owner !== input.seat ||
      name(input.cards[open.attackingCard.cardId]) !== "feeding frenzy") return -80;
    const spent = new Set([gauntlet.instanceId, open.attackingCard.instanceId]);
    return affordableFollowups(input, spent) > me.actionPoints ? 90 : -80;
  }
  const debt = ownBloodDebt(input);
  if (input.view.phase !== "action" || debt === 0 || (debt < 3 && me.life > debt + 5)) return -80;
  // Above pass and close-chain only: every useful play this turn comes first,
  // so a natural 6{p} banish can still make the Gauntlet unnecessary.
  return 2;
}

const cardOpportunity = opportunityValuer(leviaSolverRules);

/** Bloodrush Bellow: Brute attacks gain +2{p} for the rest of the turn. */
function bloodrushPending(key: string): PendingEffect {
  return { key, uses: Number.POSITIVE_INFINITY, power: 2, appliesTo: (card, view) => view.hasTrait(card, "brute") };
}

/** Hand-value rules: Levia's attack playability and go-again conditions,
 * Bloodrush Bellow, Cleave's Gate mode, and attacks whose power depends on
 * the board. */
export function leviaSolverRules(input: BotPolicyInput): HeroSolverRules {
  return leviaRules(input, true);
}

/** Rules for arsenal valuation, which never reads a hand-only mode. Valuing
 * Gate access through these avoids re-valuing Cleave's own Gate mode. */
function leviaArsenalRules(input: BotPolicyInput): HeroSolverRules {
  return leviaRules(input, false);
}

function leviaRules(input: BotPolicyInput, gateMode: boolean): HeroSolverRules {
  const me = input.view.players[input.seat];
  const nextTurn = input.view.activePlayer !== input.seat;
  const banishedSix = !nextTurn && input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true;
  const weaponPower = Math.max(0, ...me.weapons.map((weapon) => input.cards[weapon.cardId]?.attack ?? 0));
  const debt = ownBloodDebt(input);
  const selfDamage = hexagoreSelfDamage(input);
  // Life the evaluated turn's end phase drains unless a six is banished.
  const playExposure = nextTurn || !banishedSix ? debt : 0;
  return {
    name: "levia",
    trackedTraits: [],
    startPending(observed, next) {
      return !next && leviaEffectActive(observed, "bloodrush bellow") ? [bloodrushPending("bloodrush-active")] : [];
    },
    card(data, card, context) {
      const patch: SolverCardPatch = {};
      if (isAttack(data)) {
        const continues = leviaAttackContinues(card, input, nextTurn);
        patch.canPlay = () => leviaAttackPlayable(card, input);
        patch.goAgainIn = () => continues;
        if (continues) patch.uses = { reliableGoAgain: true };
      }
      // The first play likely to banish a six earns the life it protects.
      const chance = playExposure > 0 ? sixBanishChance(data, input) : 0;
      if (chance > 0) {
        patch.bonusIn = (view) => playExposure * (suppressionAfter(view, chance) - suppressionBefore(view));
        patch.after = (view) => ({
          flags: { [SUPPRESSION_FLAG]: Math.round(suppressionAfter(view, chance) * 100) },
        });
      }
      if (debt > 0 && handBanishSuppressor(card, input)) {
        // Held, it suppresses next turn's blood debt on demand.
        const printed = cardUses(data, input, card).alternative ?? 0;
        patch.uses = { ...patch.uses, alternative: Math.max(printed, debt) };
      }
      switch (name(data)) {
        case "cleave the heavens":
          // Held, it can also be banished for a Gate at instant speed.
          if (gateMode && me.hand.some((held) => held.instanceId === card.instanceId)) {
            patch.uses = {
              ...patch.uses,
              alternative: Math.max(patch.uses?.alternative ?? 0, banishGain(card, input)),
            };
          }
          break;
        case "bloodrush bellow": {
          // The discard is a six for certain when at most one other held card
          // is not, since that one pays for the Bellow.
          const others = (view: SolverView) => view.held.filter((held) => held.instanceId !== card.instanceId);
          const hits = (view: SolverView) => {
            const pool = others(view);
            return pool.length > 0 && pool.filter((held) => held.power < 6).length <= 1;
          };
          const sendable = leviaBloodrushWorthSending(
            leviaBloodrushTurn(input, card), input.view.players[1 - input.seat]!.life,
          );
          patch.canPlay = (view) => sendable && others(view).length > 0;
          patch.goAgainIn = hits;
          patch.bonusIn = (view) => hits(view) ? context.averageDraw : -context.averageDraw;
          patch.after = () => ({ pending: [bloodrushPending(`bloodrush#${card.instanceId}`)] });
          // Static value: the three-wide plan, kept through the opposing turn
          // unless the arsenal slot is stuck, in which case it is a blocker.
          const waiting = me.arsenal.some((held) => held.instanceId === card.instanceId);
          const arsenalFree = me.arsenal.length === 0 ||
            me.arsenal.some((held) => leviaAttackPlayable(held, input));
          const planned = !nextTurn || sendable || waiting || arsenalFree;
          patch.uses = {
            pump: planned ? 2 * BLOODRUSH_PLAN_WIDTH : 0,
            pumpRider: planned ? context.averageDraw * (2 * topSixShare(input) - 1) : 0,
          };
          break;
        }
        case "diabolic offering":
          patch.powerIn = () => banishedSix ? 6 : 0;
          break;
        case "rockyard rodeo":
          patch.powerIn = () => weaponPower;
          break;
        case "hexagore, the death hydra":
          patch.canPlay = () => selfDamage <= HEXAGORE_MAX_SELF_DAMAGE;
          patch.bonusIn = () => -selfDamage;
          break;
        default:
          break;
      }
      return patch;
    },
    // Banished Blood Debt attacks reachable through Gates and Blasmophet.
    abilities(context, next) {
      return leviaBanishAccess(input, next).flatMap(({ card, viaGate }): SolverCard[] => {
        const model = solverCard(card, "banish", context);
        if (!model) return [];
        if (!viaGate) return [model];
        const costIn = model.costIn;
        return [{
          ...model,
          cost: model.cost + LEVIA_GATE_COST,
          ...(costIn ? { costIn: (view: SolverView) => costIn(view) + LEVIA_GATE_COST } : {}),
        }];
      });
    },
  };
}

const OPPONENT_AURA_REMOVAL =
  /(?:return|destroy|banish)[^.]*\baura\b[^.]*\b(?:they|an opponent|target opponent|the defending hero) controls?\b|\baura\b[^.]*\b(?:they|an opponent|target opponent|the defending hero) controls?\b[^.]*(?:return|destroy|banish)/i;

/** Chance a Gate (an aura) is removed before Levia's next turn, from aura
 * removal among the opponent's unseen decklist cards. */
function gateRemovalChance(input: BotPolicyInput): number {
  const counts = unseenCounts(input, "opponent");
  if (!counts) return 0;
  let removers = 0;
  for (const [cardId, count] of counts) {
    if (OPPONENT_AURA_REMOVAL.test(input.cards[cardId]?.text ?? "")) removers += count;
  }
  const intellect = input.cards[input.view.players[1 - input.seat]!.heroCardId]?.intellect ?? 4;
  return probabilityAtLeastOne(removers, totalCount(counts), intellect) * DISRUPTION_HIT_CHANCE;
}

/** Next-turn value of Gate and Blasmophet access, in damage equivalents. */
function accessValue(access: readonly LeviaBanishAccess[], input: BotPolicyInput): number {
  const gateKept = access.some(({ viaGate }) => viaGate) ? 1 - gateRemovalChance(input) : 1;
  return access.reduce((total, { card, viaGate }) => {
    const value = Math.max(0, arsenalCardValue(card, input, leviaArsenalRules) - (viaGate ? LEVIA_GATE_COST : 0));
    return total + (viaGate ? value * gateKept : value);
  }, 0);
}

export function leviaEngineValue(input: BotPolicyInput): number {
  return accessValue(leviaBanishAccess(input, true), input);
}

/** Value a new Gate adds once `banished` is in the banished zone. */
function newGateValue(input: BotPolicyInput, banished: CardView): number {
  return accessValue(leviaBanishAccess(input, true, { gates: 1, banished: [banished] }), input) -
    leviaEngineValue(input);
}

const HAND_BANISH_INSTANTS = ["cleave the heavens", "fallen herald", "blood harvest", "consuming lash"];

/** Gain from banishing a held card: this turn's blood-debt suppression or
 * drain, and the Gate a Cleave creates. */
function banishGain(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return -Infinity;
  const suppressed = input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true;
  const gain = suppressed ? 0 : (data.attack ?? 0) >= 6 ? ownBloodDebt(input) : -1;
  return name(data) === "cleave the heavens" ? gain + newGateValue(input, card) : gain;
}

/** Net gain from banishing a held card at end of turn. The hand refills, so
 * the card costs only its margin over a draw. */
function endOfTurnBanishGain(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  if (!data) return -Infinity;
  const me = input.view.players[input.seat];
  const gain = banishGain(card, input);
  const held = heldCardValue(card, input, leviaSolverRules);
  const kept = me.arsenal.length === 0 ? Math.max(held, arsenalCardValue(card, input, leviaSolverRules)) : held;
  return gain - kept;
}

/** Scored just above passing so every real play comes first. */
function endOfTurnBanishScore(intent: GameIntent, card: CardView, input: BotPolicyInput): number {
  const me = input.view.players[input.seat];
  if (input.view.activePlayer !== input.seat || input.view.phase !== "action" ||
    input.view.stack.length > 0 || input.view.chain.some((link) => !link.resolved) ||
    pitchIds(intent).length > 0 || (intent.kind === "activate-ability" && (intent.pitchRequired ?? 0) > 0) ||
    !me.hand.some((held) => held.instanceId === card.instanceId)) return -80;
  const gain = endOfTurnBanishGain(card, input);
  if (gain <= 0) return -80;
  // A suppression that protects a large share of Levia's life ranks among the
  // attacks, so the planner's root candidates include it.
  const debt = ownBloodDebt(input);
  const suppresses = debt > 0 && (input.cards[card.cardId]?.attack ?? 0) >= 6 &&
    input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn !== true;
  const urgent = suppresses && me.life <= debt * 2 + 6 ? Math.min(45, debt * 6) : 0;
  return 3 + Math.min(0.9, gain / 10) + urgent;
}

/** Prevent with Fallen Herald when needed to survive or worth more than the card next turn. */
function heraldPreventionScore(card: CardView, input: BotPolicyInput): number {
  const link = currentLink(input);
  if (input.view.activePlayer === input.seat || !link || link.attackingCard.owner === input.seat ||
    link.onStack) return -100;
  const incoming = Math.max(0, incomingAttackDamage(input) - (link.damageToPrevent ?? 0));
  const threatened = Math.max(0, threatenedAttackDamage(input) - (link.damageToPrevent ?? 0));
  const worth = heraldWorth(card, input, incoming, threatened);
  return worth === undefined ? -100 : worth === "survives" ? 150 : worth > 0 ? 20 + worth * 4 : -60;
}

/** Herald's margin over keeping it against `incoming` damage, or "survives"
 * when it alone keeps Levia alive against the `threatened` pumps. */
function heraldWorth(
  card: CardView,
  input: BotPolicyInput,
  incoming: number,
  threatened: number,
): number | "survives" | undefined {
  const me = input.view.players[input.seat];
  const prevented = Math.min(4, incoming);
  if (prevented === 0) return undefined;
  // Survival counts public pumps the attacker can still spend.
  if (threatened >= me.life && threatened - prevented < me.life) return "survives";
  const rest = me.hand.filter((held) => held.instanceId !== card.instanceId);
  const lost = solveHand(me.hand, input, leviaSolverRules).value - solveHand(rest, input, leviaSolverRules).value;
  return prevented - lost;
}

/** Plans Fallen Herald's prevention into a block when activating it after the block would pay off. */
function leviaPlannedPrevention(
  input: BotPolicyInput,
  intent: Extract<GameIntent, { kind: "defend" }>,
  spentIds: ReadonlySet<number>,
  reactionPlan: PlannedPrevention,
): PlannedPrevention {
  const link = currentLink(input);
  if (!link) return reactionPlan;
  const me = input.view.players[input.seat];
  const herald = me.hand.find((card) => name(input.cards[card.cardId]) === "fallen herald" &&
    !spentIds.has(card.instanceId) && !reactionPlan.consumedIds.includes(card.instanceId));
  if (!herald) return reactionPlan;
  const own = ownCards(input);
  const defense = intent.instanceIds.reduce((total, id) => {
    const card = own.get(id);
    return total + (card ? defenderDefense(card, input) : 0);
  }, 0);
  const blocked = defense + reactionPlan.amount + (link.damageToPrevent ?? 0);
  const incoming = Math.max(0, incomingAttackDamage(input) - blocked);
  const threatened = Math.max(0, threatenedAttackDamage(input) - blocked);
  const worth = heraldWorth(herald, input, incoming, threatened);
  if (worth === undefined || (worth !== "survives" && worth <= 0)) return reactionPlan;
  return {
    ...reactionPlan,
    amount: reactionPlan.amount + 4,
    consumedIds: [...reactionPlan.consumedIds, herald.instanceId],
    preventionIds: [...(reactionPlan.preventionIds ?? []), herald.instanceId],
  };
}

const BLOOD_HARVEST_RESOURCES = 3;
const EXPIRING_ACCESS_BONUS = 24;
const PITCH_OPPORTUNITY_WEIGHT = 0.7;

/** Score given up by spending a card as payment. */
function pitchPenalty(card: CardView, input: BotPolicyInput): number {
  return cardOpportunity(card, input) * PITCH_OPPORTUNITY_WEIGHT + 1;
}

/** Blood Harvest's banish is scored as a blue pitch: the best attack it pays
 * for, charged Blood Harvest's own opportunity in place of the pitch cards it
 * replaces. Cheaper pitch cards therefore win, keeping the 6{p} attack. Unlike
 * a pitch card, the banish also enables attacks that are not yet legal and
 * counts as this turn's 6{p} banish. */
function bloodHarvestPaymentScore(
  harvest: CardView,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const me = input.view.players[input.seat];
  let best = -Infinity;
  const legalAttackers = new Set<number>();
  for (const attack of input.legal) {
    if (attack.kind !== "play-card" && attack.kind !== "play-from-arsenal" && attack.kind !== "play-from-zone") continue;
    const attacker = intentCard(attack, own);
    if (!attacker || attacker.instanceId === harvest.instanceId || !isAttack(input.cards[attacker.cardId])) continue;
    legalAttackers.add(attacker.instanceId);
    const pitched = attack.pitchInstanceIds;
    if (pitched.length === 0) continue;
    // Keep the pitch cards that still cover what Blood Harvest's resources do not.
    const residual = pitchValue(attack, input, own) - BLOOD_HARVEST_RESOURCES;
    for (let mask = 0; mask < (1 << pitched.length) - 1; mask++) {
      const kept = { ...attack, pitchInstanceIds: pitched.filter((_, index) => (mask & (1 << index)) !== 0) };
      if (pitchValue(kept, input, own) >= residual) best = Math.max(best, scorePlay(kept, input, own));
    }
  }
  // Hand and arsenal attacks the current resources and pitch cannot pay for.
  const sash = leviaEffectActive(input, "savage sash");
  for (const attacker of [...me.hand, ...me.arsenal]) {
    if (attacker.instanceId === harvest.instanceId || legalAttackers.has(attacker.instanceId) ||
      !leviaAttackPlayable(attacker, input)) continue;
    // Wrecker Romp's random discard needs another card after Blood Harvest leaves the hand.
    if (name(input.cards[attacker.cardId]) === "wrecker romp" && me.hand.length < 3) continue;
    let missing = leviaAttackCost(input.cards[attacker.cardId], sash) - me.resources - BLOOD_HARVEST_RESOURCES;
    const pitchInstanceIds: number[] = [];
    const spare = me.hand.filter((held) =>
      held.instanceId !== harvest.instanceId && held.instanceId !== attacker.instanceId &&
      (input.cards[held.cardId]?.pitch ?? 0) > 0
    ).sort((left, right) => cardOpportunity(left, input) - cardOpportunity(right, input));
    for (const held of spare) {
      if (missing <= 0) break;
      pitchInstanceIds.push(held.instanceId);
      missing -= input.cards[held.cardId]?.pitch ?? 0;
    }
    if (missing > 0) continue;
    const kind = me.hand.includes(attacker) ? "play-card" : "play-from-arsenal";
    best = Math.max(best, scorePlay({ kind, instanceId: attacker.instanceId, pitchInstanceIds }, input, own));
  }
  // Its 6{p} banish also suppresses this turn's blood debt, offsetting the card given up.
  return best - pitchPenalty(harvest, input) + banishGain(harvest, input) * PITCH_OPPORTUNITY_WEIGHT;
}

function scorePlay(intent: GameIntent, input: BotPolicyInput, own: ReadonlyMap<number, CardView>): number {
  const card = intentCard(intent, own);
  const data = card && input.cards[card.cardId];
  if (!card || !data) return -100;
  const named = name(data);
  const me = input.view.players[input.seat];
  const bloodrushActive = leviaEffectActive(input, "bloodrush bellow");
  // Wait for the current action/attack to resolve before spending its remaining
  // hand on setup. A priority window with no legal attacks is not a dead hand.
  const midTurnSetupBlocked = input.view.phase !== "action" || input.view.stack.length > 0 ||
    me.actionPoints < 1 || input.view.chain.some((link) => !link.resolved);
  if (intent.kind === "activate-ability" && HAND_BANISH_INSTANTS.includes(named)) {
    const conversion = endOfTurnBanishScore(intent, card, input);
    if (named === "fallen herald") {
      return input.view.activePlayer === input.seat ? conversion : heraldPreventionScore(card, input);
    }
    if (midTurnSetupBlocked) return conversion;
  }
  if (intent.kind === "activate-ability" && named === "gate to i'arathael" && midTurnSetupBlocked) return -80;
  let followupCount: number | undefined;
  const followups = (): number => followupCount ??= attackReserve(
    input, new Set([card.instanceId, ...pitchIds(intent)]),
  ).length;
  let score: number;

  if (named === "gate to i'arathael") {
    score = gateTargetValue(intent, input, own);
  } else if (named === "cleave the heavens" && intent.kind === "activate-ability") {
    score = Math.max(gateSetupValue(card, input, own), endOfTurnBanishScore(intent, card, input));
  } else if (named === "consuming lash" && intent.kind === "activate-ability") {
    const spent = new Set([card.instanceId, ...pitchIds(intent)]);
    const remaining = [...me.hand, ...me.arsenal].filter((held) => !spent.has(held.instanceId));
    const resources = resourcesAfterCost(intent, 1, input, own);
    const needsGoAgain = !leviaEffectActive(input, "consuming lash") &&
      !leviaAttackPair(input, remaining, { resources }) &&
      leviaAttackPair(input, remaining, { resources, grantGoAgain: true });
    score = needsGoAgain ? (bloodrushActive ? 95 : 65) : endOfTurnBanishScore(intent, card, input);
  } else if (named === "savage sash") {
    // Reserved for the Bellow turn unless the opponent is low.
    const saved = !bloodrushActive && leviaHoldsBellow(input) && input.view.players[1 - input.seat]!.life > 14;
    score = !saved && leviaSashEnablesPair(input, [...me.hand, ...me.arsenal]) ? (bloodrushActive ? 100 : 74) : -60;
  } else if (named === "blood harvest" && intent.kind === "activate-ability") {
    score = Math.max(bloodHarvestPaymentScore(card, input, own), endOfTurnBanishScore(intent, card, input));
  } else if (named === "bloodrush bellow") {
    // Keep enough cards after paying that the random discard leaves an attack.
    const spent = new Set([card.instanceId, ...pitchIds(intent)]);
    const kept = me.hand.filter((held) => !spent.has(held.instanceId)).length;
    const arsenalAttack = me.arsenal.some((held) => leviaAttackPlayable(held, input));
    const turn = leviaBloodrushTurn(input, card);
    // The discard hits for certain only if every card left after this pitch is a six.
    const remaining = me.hand.filter((held) => !spent.has(held.instanceId));
    const hit = remaining.length > 0 && remaining.every((held) => leviaSixPower(held, input));
    const worth = hit && leviaBloodrushWorthSending(turn, input.view.players[1 - input.seat]!.life);
    // A certain six discard of a last card that cannot attack anyway trades it for two draws.
    const cyclesDeadCard = hit && kept === 1 && !remaining.some((held) => leviaAttackPlayable(held, input));
    score = worth && followups() > 0 && (kept >= 2 || (kept === 1 && arsenalAttack))
      ? 72 + Math.min(turn.width, BLOODRUSH_PLAN_WIDTH) * 8
      : cyclesDeadCard ? 45 : -60;
  } else if (named === "call to the grave") {
    score = fundsAttackPair(card, input, true) ? 20 : me.graveyard.length < 6 ? 58 : 38;
  } else if (named === "pull from beyond") {
    score = fundsAttackPair(card, input, true) ? 20
      : bloodrushActive && hasDirectAttack(input, own) ? 12 : !hasGate(input) ? 60 : 42;
  } else if (named === "goremass summoning") {
    score = fundsAttackPair(card, input) ? 20
      : input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true ? 52 : -20;
  } else if (named === "levia, shadowborn abomination" && intent.kind === "activate-ability") {
    score = me.life <= 8 || (ownBloodDebt(input) >= me.life &&
      input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn !== true) ? 180 : -120;
  } else if (named === "doomsday") {
    score = 75;
  } else if (named === "scabskin leathers") {
    // Under an active Bellow the roll comes before the attacks, so a chain
    // whose go-again card was discarded can still go wide. Otherwise a one
    // whiffs the turn, which exposed blood debt cannot afford.
    const reserve = [...me.hand, ...me.arsenal];
    const exposed = ownBloodDebt(input) > 0 &&
      input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn !== true;
    // Never gamble the action point while one attack already kills.
    const opponentLife = input.view.players[1 - input.seat]!.life;
    const lethalAttack = input.legal.some((candidate) => {
      if (candidate.kind !== "play-card" && candidate.kind !== "play-from-arsenal" &&
        candidate.kind !== "play-from-zone") return false;
      const attacker = intentCard(candidate, own);
      const attackerData = attacker && input.cards[attacker.cardId];
      if (!attackerData || !isAttack(attackerData)) return false;
      const bellowed = bloodrushActive && attackerData.classes?.includes("brute") ? 2 : 0;
      return (attackerData.attack ?? 0) + bellowed >= opponentLife;
    });
    // A whiff is fatal only when the unsuppressed blood debt drains the rest of Levia's life.
    const whiffKills = exposed && ownBloodDebt(input) >= me.life;
    // An unusable roll ranks below any banish or pass, so a rollout tie never picks it.
    score = !actionPointsUsable(input) ? -150
      : me.actionPoints < 2 && !whiffKills && !lethalAttack && (bloodrushActive || !exposed) &&
        !leviaAttackPair(input, reserve) &&
        (leviaAttackPair(input, reserve, { grantGoAgain: true }) || weaponSwingPair(input, reserve))
        ? (bloodrushActive ? 85 : 53)
        : -55;  } else if (named === "fyendal's spring tunic") {
    score = followups() > 0 ? 32 : -30;
  } else if (named === "hex gauntlet") {
    score = hexGauntletValue(input, card);
  } else if (named === "embraforged gauntlet") {
    score = followups() > 0 ? 35 : -35;
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (named === "diabolic offering" &&
    input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn !== true) {
    // Zero power until a six is banished this turn.
    score = -30;
  } else if (isAttack(data) || data.cardType === "weapon") {
    score = 22 + (data.attack ?? 0) * 2;
    // A Gate or Blasmophet permission already paid for expires with the turn
    // and spends no hand card; play it before a hand attack competing for the
    // same resources.
    if (intent.kind === "play-from-zone" && card.playableFromSourceCardId !== undefined) score += EXPIRING_ACCESS_BONUS;
    if (bloodrushActive && data.classes?.includes("brute")) score += 30;
    if (["feeding frenzy", "dread screamer", "shadowrealm horror"].includes(named) && followups() > 0) {
      score += 20;
    }
    if (named === "hexagore, the death hydra") {
      const selfDamage = hexagoreSelfDamage(input);
      score -= selfDamage * (me.life <= 9 ? 15 : 5);
      if (selfDamage >= me.life) score -= 1_000;
      else if ((data.attack ?? 0) >= input.view.players[1 - input.seat]!.life && !hasDirectAttack(input, own)) score += 120;
    }
    if (named === "ravenous meataxe" && followups() > 0) score -= 12;
  } else {
    score = -30;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= pitchPenalty(pitched, input);
  }
  return score;
}

function scorePullOptChoice(
  intent: Extract<GameIntent, { kind: "choose" }>,
  input: BotPolicyInput,
): number | undefined {
  const decision = input.view.pendingDecision;
  const source = decision?.promptMessage?.values?.card;
  if ((decision?.promptMessage?.id !== "card.common.opt" &&
      decision?.promptMessage?.id !== "card.common.opt.remaining") ||
    !source || typeof source !== "object" || source.kind !== "card" ||
    name(input.cards[source.cardId]) !== "pull from beyond") return undefined;
  const requiredPitch = input.cards[source.cardId]?.pitch;
  if (requiredPitch === undefined || !decision.optionCards) return undefined;

  // Bottom every visible nonmatch before finishing the opt. The next card
  // banished will then have Pull's color whenever one was among the two seen.
  const nonmatching = decision.optionCards.some((card) =>
    card !== null && input.cards[card.cardId]?.pitch !== requiredPitch
  );
  if (!nonmatching) return intent.optionId === "pass" ? 100 : -100;
  const selected = optionCard(intent, input);
  return intent.optionId.startsWith("bottom:") && selected &&
    input.cards[selected.cardId]?.pitch !== requiredPitch ? 100 : -100;
}

function opponentHero(input: BotPolicyInput): string {
  return name(input.cards[input.view.players[1 - input.seat]!.heroCardId]);
}

/** Call to the Grave: prefer Beast Within, or Back Alley Breakline for a second attack. */
function scoreCallChoice(card: CardView | null | undefined, input: BotPolicyInput): number {
  if (!card) return 0;
  const me = input.view.players[input.seat];
  const named = name(input.cards[card.cardId]);
  const suppressed = input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true;
  const attacks = attackReserve(input, new Set()).filter((held) => leviaAttackPlayable(held, input)).length;
  if (named === "beast within") return me.life <= 3 ? 10 : suppressed && attacks >= 2 ? 60 : 90;
  if (named === "back alley breakline") return attacks >= 2 ? 75 : 20;
  return cardOpportunity(card, input);
}

/** Blasmophet's end-phase banish: only a Blood Debt card keeps it. */
function scoreBlasmophetBanish(card: CardView | null | undefined, input: BotPolicyInput): number {
  if (!card) return 0;
  if (!bloodDebtAction(card, input)) return -20;
  const me = input.view.players[input.seat];
  if (input.view.activePlayer === input.seat) return 10 - heldCardValue(card, input, leviaSolverRules);
  const rest = me.hand.filter((held) => held.instanceId !== card.instanceId);
  const lost = solveHand(me.hand, input, leviaSolverRules).value - solveHand(rest, input, leviaSolverRules).value;
  const kept = Math.max(0, ...leviaBanishAccess(input, true, { banished: [card] })
    .filter((access) => !access.viaGate).map((access) => arsenalCardValue(access.card, input, leviaSolverRules)));
  return kept > lost ? 10 + kept - lost : -20;
}

/** Life a banished Blood Debt card drains at Levia's next end phase. */
const BLOOD_DEBT_DRAIN = 1;

/** An opponent's effect makes Levia banish one of her hand cards. */
function forcedHandBanish(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): CardView | undefined {
  const decision = input.view.pendingDecision;
  if (input.view.activePlayer === input.seat || decision?.kind !== "choose-target" ||
    !/banish/i.test(decision.prompt)) return undefined;
  const hand = input.view.players[input.seat].hand;
  const handIds = new Set(hand.map((card) => card.instanceId));
  if (!(decision.options ?? []).every((option) => handIds.has(Number(option)))) return undefined;
  return hand.find((card) => card.instanceId === Number(intent.optionId));
}

/** Give up the card whose loss costs next turn's response least, net of the
 * Gate access a banished Blood Debt attack keeps and the life it drains. */
function scoreForcedHandBanish(card: CardView, input: BotPolicyInput): number {
  const offensive = leviaResponse.offensiveCards(input);
  const full = leviaResponse.evaluateResponse(offensive, input).total;
  const rest = leviaResponse.evaluateResponse(
    offensive.filter((held) => held.instanceId !== card.instanceId),
    input,
  ).total;
  const access = accessValue(leviaBanishAccess(input, true, { banished: [card] }), input) -
    leviaEngineValue(input);
  const drain = input.cards[card.cardId]?.keywords?.includes("Blood Debt") ? BLOOD_DEBT_DRAIN : 0;
  return 20 - (full - rest) + access - drain;
}

/** Transform into Consumed, except into Marionette without Engulfing Shadows banished. */
function scoreTransformChoice(optionId: string, input: BotPolicyInput): number | undefined {
  const engulfing = input.view.players[input.seat].banish.some((card) =>
    !card.faceDown && name(input.cards[card.cardId]) === "engulfing shadows"
  );
  const accept = !opponentHero(input).includes("marionette") || engulfing;
  return scoreBinaryChoice(optionId, accept ? 12 : 0, accept ? 0 : 12);
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  if (input.view.pendingDecision?.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, arsenalValuer(leviaSolverRules));
  }
  const pullOpt = scorePullOptChoice(intent, input);
  if (pullOpt !== undefined) return pullOpt;
  const messageId = input.view.pendingDecision?.promptMessage?.id;
  if (messageId === "card.agb.deck.card.graveyard") return scoreCallChoice(optionCard(intent, input), input);
  if (messageId === "card.common.levia.transform") {
    const transform = scoreTransformChoice(intent.optionId, input);
    if (transform !== undefined) return transform;
  }
  if (messageId === "card.iar.hand.banish.optional" && input.view.phase === "end" &&
    input.view.players[input.seat].board.some((held) =>
      name(input.cards[held.cardId]) === "blasmophet, the insatiable hunger"
    )) return scoreBlasmophetBanish(optionCard(intent, input), input);
  const forced = forcedHandBanish(intent, input);
  if (forced) return scoreForcedHandBanish(forced, input);
  const payment = resourcePaymentPitchIds(intent, input);
  if (payment !== undefined) {
    const own = ownCards(input);
    return 10 - payment.reduce((sum, id) => {
      const card = own.get(id);
      return sum + (card ? cardOpportunity(card, input) : 0);
    }, 0);
  }
  const prompt = input.view.pendingDecision?.prompt.toLowerCase() ?? "";
  const card = optionCard(intent, input);
  if (/discard|pitch|banish.*hand/.test(prompt)) return scoreSpendCardChoice(intent, input, cardOpportunity);
  const binary = scoreBinaryChoice(intent.optionId, 12, 0);
  if (binary !== undefined) return binary;
  if (card) {
    const data = input.cards[card.cardId];
    return cardOpportunity(card, input) + (data?.keywords?.includes("Blood Debt") ? 3 : 0);
  }
  return 0;
}

const leviaResponse: ResponseModel = {
  offensiveCards: (input) => [
    ...input.view.players[input.seat].hand, ...input.view.players[input.seat].arsenal,
  ],
  // Blood-debt suppression is part of the solved line (see leviaRules).
  evaluateResponse: (cards, input) => handResponse(cards, input, leviaSolverRules),
};

/** Low-life breakpoints for defense: at or below the exposed blood debt one
 * unsuppressed end phase kills, a few life above it every turn must banish a
 * six, and below Hexagore's self-damage band the weapon costs life. */
function leviaLifeThresholds(input: BotPolicyInput): LifeThreshold[] {
  const debt = ownBloodDebt(input);
  return [
    { atOrBelow: debt, cost: 8 },
    { atOrBelow: debt + 4, cost: 4 },
    { atOrBelow: 8, cost: 2 },
  ];
}

/** Tempo cost of a block that leaves the hand empty, or with one card: the
 * next turn has no pitch for Hexagore and nothing to banish, so it is skipped
 * rather than merely weakened. Lethal attacks are exempt. */
const EMPTY_HAND_COST = 6;
const ONE_CARD_HAND_COST = 1.5;

/** The Bellow blocks only when the block answers a damaging on-hit, or is
 * needed to survive; otherwise it waits for its turn. */
function leviaBellowBlocks(candidate: DefenseCandidateContext): DefensePermission {
  const { input } = candidate;
  const bellow = candidate.chosen.some((card) =>
    name(input.cards[card.cardId]) === "bloodrush bellow" &&
    input.view.players[input.seat].hand.some((held) => held.instanceId === card.instanceId));
  if (!bellow || candidate.lethal) return "allow";
  return candidate.stopsHit && candidate.onHit.value >= SIGNIFICANT_ON_HIT_VALUE ? "allow" : "forbid";
}

function leviaKeepsCards(value: ValueBreakdown, candidate: DefenseCandidateContext): ValueBreakdown {
  if (candidate.lethal) return value;
  const me = candidate.input.view.players[candidate.input.seat];
  const left = me.hand.filter((card) => !candidate.consumedIds.has(card.instanceId)).length;
  const cost = left === 0 ? EMPTY_HAND_COST : left === 1 ? ONE_CARD_HAND_COST : 0;
  return cost === 0 ? value : valueBreakdown({ ...value, strategicAdjustment: value.strategicAdjustment - cost });
}

function scoreDefense(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    cardOpportunity,
    adjustCycleValue: leviaKeepsCards,
    defensePermission: leviaBellowBlocks,
    lifeThresholds: leviaLifeThresholds(input),
    plannedPrevention: leviaPlannedPrevention,
    equipmentUseIsFree: (card, policy) => name(policy.cards[card.cardId]) === "savage sash" &&
      (card.defCounters ?? 0) === 0 && leviaSashEnablesPair(policy,
        [...policy.view.players[policy.seat].hand, ...policy.view.players[policy.seat].arsenal]
          .filter((held) => !intent.instanceIds.includes(held.instanceId)), true),
    ...leviaResponse,
    // Play style: neutral. Blood debt already prices her life into every
    // line through the solver and the low-life band above.
    responseLossWeight: 1,
  });
}

function chooseReactive(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(input, {
    response: leviaResponse,
    play: scorePlay,
    choose: scoreChoice,
    nextTurnArsenal: arsenalValuer(leviaSolverRules),
    defend: scoreDefense,
  });
}

function scoreCandidate(intent: GameIntent, input: BotPolicyInput, macro: LeviaMacroChoice): number {
  let score: number;
  switch (intent.kind) {
    case "pass": score = 0; break;
    case "close-chain": score = 1; break;
    case "choose": score = scoreChoice(intent, input); break;
    case "defend": score = scoreDefense(intent, input, ownCards(input)); break;
    case "play-card":
    case "play-from-arsenal":
    case "play-from-zone":
    case "activate-ability":
      score = scorePlay(intent, input, ownCards(input));
      break;
    default: score = 0;
  }
  return score + leviaMacroIntentBonus(macro, intent, input);
}

// Gate activations and banish plays stretch a turn to several short actions.
const LEVIA_MAX_SEARCH_NODES = 48;
const LEVIA_MAX_TRANSITIONS = 400;
const LEVIA_MAX_ROOT_CANDIDATES = 5;
/** Rollout opponents never block, so a simulated kill is a nudge, not a goal. */
const LEVIA_SIMULATED_WIN_BONUS = 4 * POINTS_PER_DAMAGE;
/** Rollout advantage, in points, before it overrides the reactive sequencing. */
const LEVIA_PLAN_OVERRIDE_MARGIN = 3 * POINTS_PER_DAMAGE;
/** Life the rollout's line must save over the reactive line to override it. */
const LEVIA_PLAN_OVERRIDE_RISK = 3;

function sameIntent(left: GameIntent, right: GameIntent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface LeviaIntentDecision {
  intent: GameIntent;
  plan?: TacticalTurnPlan;
  macro: LeviaMacroChoice;
}

export function chooseLeviaIntentWithTrace(raw: BotPolicyInput): LeviaIntentDecision {
  const input = { ...raw, legal: withoutCostlyHexagore(raw.legal, raw) };
  const macro = chooseLeviaMacro(input);
  // Levia's instants set up her own attacks. Keep the hand for blocks throughout
  // the opponent's turn, including priority windows before an attack is declared.
  if (input.view.activePlayer !== input.seat &&
    (input.view.pendingDecision === null || input.view.pendingDecision.kind === "priority-window")) {
    const pass = input.legal.find((intent) => intent.kind === "pass");
    if (pass) return { intent: pass, macro };
  }
  const reactive = chooseReactive(input);
  // The opening hand is replaced after turn one; the reactive setup rules
  // (bank a Gate, keep blockers) stand without a rollout.
  if (isOpeningTurn(input)) {
    return { intent: enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, reactive)), macro };
  }
  const plan = planTacticalTurn(input, {
    chooseForced: (forced) => chooseReactive({ ...forced, state: undefined }),
    rules: leviaSolverRules,
    rankCandidate: (intent, observed) => scoreCandidate(intent, observed, macro),
    scoreIntent: (intent, observed) => leviaMacroIntentBonus(macro, intent, observed),
    positionBonus: (observed, complete) =>
      leviaMacroPositionBonus(macro, input, observed, complete, leviaEngineValue),
    risk: (observed) => leviaLifeRisk(input, observed),
    maxSearchNodes: LEVIA_MAX_SEARCH_NODES,
    maxTransitions: LEVIA_MAX_TRANSITIONS,
    maxRootCandidates: LEVIA_MAX_ROOT_CANDIDATES,
    rankContinuations: true,
    // Continuations keep the preferred pitch pattern per action; the root
    // candidates still carry every pattern.
    prepareCandidates: (candidates, observed, { depth }) => {
      const allowed = withoutCostlyHexagore(candidates, observed);
      return depth === 0 ? allowed : preferredPitchIntents(allowed, observed);
    },
    maxForcedSteps: 48,
    simulatedWinBonus: LEVIA_SIMULATED_WIN_BONUS,
  });
  // The reactive rules sequence the turn; the rollout decides among roots they
  // rank equally. It overrides a higher-ranked root only when its best line
  // both scores clearly higher and costs Levia clearly less life, as when
  // attacking would leave blood debt exposed that a banish suppresses; a
  // single sampled rollout is not trusted on damage alone.
  const rootScore = (intent: GameIntent) => scoreCandidate(intent, input, macro);
  const reactiveRoot = plan?.rootResults.find((root) => sameIntent(root.intent, reactive));
  // Equal lines fall back to the reactive ranking.
  const best = (roots: NonNullable<typeof plan>["rootResults"]) => roots.length === 0 ? undefined : roots.reduce((top, root) =>
    root.score > top.score || (root.score === top.score && rootScore(root.intent) > rootScore(top.intent))
      ? root
      : top);
  const bestRoot = plan && best(plan.rootResults);
  const savesLife = reactiveRoot && bestRoot &&
    bestRoot.score - reactiveRoot.score >= LEVIA_PLAN_OVERRIDE_MARGIN &&
    reactiveRoot.evaluation.risk - bestRoot.evaluation.risk >= LEVIA_PLAN_OVERRIDE_RISK;
  const bestRanked = plan && best(plan.rootResults.filter((root) => rootScore(root.intent) >= rootScore(reactive)));
  const selected = savesLife ? bestRoot.intent : bestRanked?.intent ?? reactive;
  const intent = enforceAllyTargetPolicy(input, enforceSpectraPolicy(input, selected));
  return plan ? { intent, plan, macro } : { intent, macro };
}

export function chooseLeviaIntent(input: BotPolicyInput): GameIntent {
  return chooseLeviaIntentWithTrace(input).intent;
}
