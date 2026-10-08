import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import { intentCard, isAttack, ownCards, type BotPolicyInput } from "./policy.js";
import { leviaEffectActive } from "./levia-turn.js";

export type LeviaMacro = "redeem" | "stabilize" | "engine" | "bloodrush" | "attrition" | "pressure";

export interface LeviaMacroChoice {
  goal: LeviaMacro;
  /** Public matchup context changes priorities, never the legality of an action. */
  matchup: "wizard" | "grindy" | "assassin" | "trap" | "race" | "mirror" | "default";
}

function cardName(data: CardData | undefined): string {
  return data?.name.toLowerCase() ?? "";
}

function bloodDebt(cards: readonly CardView[], input: BotPolicyInput): number {
  return cards.filter((card) => !card.faceDown &&
    input.cards[card.cardId]?.keywords?.includes("Blood Debt")).length;
}

function enginePermanents(cards: readonly CardView[], input: BotPolicyInput): number {
  return cards.filter((card) => ["gate to i'arathael", "blasmophet, the insatiable hunger"]
    .includes(cardName(input.cards[card.cardId]))).length;
}

function matchup(input: BotPolicyInput): LeviaMacroChoice["matchup"] {
  const opponent = cardName(input.cards[input.view.players[1 - input.seat]!.heroCardId]);
  if (opponent.includes("oscilio") || opponent.includes("kano") || opponent.includes("blaze")) return "wizard";
  if (opponent.includes("levia")) return "mirror";
  if (opponent.includes("riptide")) return "trap";
  if (opponent.includes("arakni") || opponent.includes("uzuri")) return "assassin";
  if (["jarl", "bravo", "pleiades", "mortimer"].some((name) => opponent.includes(name))) return "grindy";
  if (["fai", "kassai", "boltyn", "teklovossen", "vynnset"].some((name) => opponent.includes(name))) return "race";
  return "default";
}

/** Select from rule-relevant public facts; the choice is refreshed on every task. */
export function chooseLeviaMacro(input: BotPolicyInput): LeviaMacroChoice {
  const me = input.view.players[input.seat];
  const opponent = input.view.players[1 - input.seat]!;
  const context = matchup(input);
  const debt = bloodDebt(me.banish, input);
  const suppressed = input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true;
  const canRedeem = input.legal.some((intent) =>
    intent.kind === "activate-ability" && intent.sourceInstanceId === me.heroInstanceId
  );
  const attacks = [...me.hand, ...me.arsenal].filter((card) => isAttack(input.cards[card.cardId]));
  const hasBloodrush = [...me.hand, ...me.arsenal].some((card) =>
    cardName(input.cards[card.cardId]) === "bloodrush bellow"
  );
  const hasPitch = me.hand.some((card) => (input.cards[card.cardId]?.pitch ?? 0) >= 2);
  const hasEngine = enginePermanents(me.board, input) > 0;

  if (canRedeem && (me.life <= 8 || (!suppressed && debt >= me.life))) {
    return { goal: "redeem", matchup: context };
  }
  if (leviaEffectActive(input, "bloodrush bellow")) return { goal: "bloodrush", matchup: context };
  if (debt > 0 && !suppressed && (me.life <= debt + 5 || attacks.length === 0)) {
    return { goal: "stabilize", matchup: context };
  }
  if (hasBloodrush && attacks.length > 0 && hasPitch &&
    (attacks.length > 1 || opponent.life <= 14 || context === "race")) {
    return { goal: "bloodrush", matchup: context };
  }
  if (!hasEngine && input.view.turn === 1) {
    return { goal: "engine", matchup: context };
  }
  if (context === "grindy" || context === "assassin") return { goal: "attrition", matchup: context };
  return { goal: "pressure", matchup: context };
}

/** Small sequencing preference; the planner still measures the resulting turn. */
export function leviaMacroIntentBonus(
  macro: LeviaMacroChoice,
  intent: GameIntent,
  input: BotPolicyInput,
): number {
  if (intent.kind === "pass" || intent.kind === "close-chain") return 0;
  const card = intentCard(intent, ownCards(input));
  const named = cardName(input.cards[card?.cardId ?? ""]);
  if (macro.matchup === "mirror" &&
    (named === "dam the shadowake" || named === "chains of mephetis")) return 20;
  if (macro.goal === "redeem" && named === "levia, shadowborn abomination") return 350;
  if (macro.goal === "stabilize") {
    if (named === "call to the grave" || named === "pull from beyond") return 32;
    if (named === "bloodrush bellow") return -35;
    if (named === "hexagore, the death hydra") return -45;
  }
  if (macro.goal === "engine") {
    if (input.view.turn === 1 && (named === "gate to i'arathael" || named === "cleave the heavens")) return 12;
    if (named === "call to the grave" || named === "pull from beyond") return 18;
  }
  if (macro.goal === "bloodrush") {
    if (named === "bloodrush bellow") return 42;
    if (named === "feeding frenzy" || named === "shadowrealm horror") return 14;
  }
  if (macro.goal === "attrition") {
    if (named === "goremass summoning") return 24;
    if (named === "scabskin leathers") return -25;
  }
  return 0;
}

/** Score a projected rollout end against the observed start of this decision. */
export function leviaMacroPositionBonus(
  macro: LeviaMacroChoice,
  root: BotPolicyInput,
  observed: BotPolicyInput,
  complete: boolean,
): number {
  const start = root.view.players[root.seat];
  const me = observed.view.players[root.seat];
  const debt = bloodDebt(me.banish, observed);
  const suppressed = observed.view.turnFacts?.players[root.seat]?.banishedSixPlusThisTurn === true;
  const lifeLost = Math.max(0, start.life - me.life);
  const exposedDebt = suppressed ? 0 : debt;
  const reserve = ["wizard", "assassin", "trap"].includes(macro.matchup) ? 3 : 1;
  let score = -lifeLost * 105 - exposedDebt * (complete ? 135 : 70);
  if (exposedDebt >= me.life) score -= 100_000;
  if (me.life <= reserve && exposedDebt > 0) score -= 2_000;
  if (me.life <= reserve && start.life > reserve) score -= 600;
  if (macro.goal === "stabilize" && suppressed) score += 180;
  if (macro.goal === "engine" || macro.goal === "attrition") {
    score += Math.max(0, enginePermanents(me.board, observed) - enginePermanents(start.board, root)) *
      (root.view.turn === 1 ? 80 : 15);
    score += Math.min(6, Math.max(0, me.graveyard.length - start.graveyard.length)) * 9;
  }
  if (macro.goal === "bloodrush") {
    const attacks = (input: BotPolicyInput) => input.view.turnFacts?.players[input.seat]?.attacks ?? 0;
    score += Math.max(0, attacks(observed) - attacks(root)) * 28;
  }
  return score;
}
