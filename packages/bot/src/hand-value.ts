import type { CardView } from "@fyendal/shared";
import { BLOCK_USE_RATE, defaultCardUses, heldValue } from "./card-ev.js";
import {
  buildHandSolver,
  modelContext,
  solverCard,
  type HeroSolverRules,
  type ModelContext,
} from "./card-model.js";
import type { HandSolver, SolverResult } from "./hand-solver.js";
import { responseEvaluation, type BotPolicyInput, type ResponseEvaluation } from "./policy.js";

/**
 * The one place policies read hand value. Every number is a damage
 * equivalent (see card-ev.ts): damage threatened, a card held over a draw, a
 * card kept in arsenal. Hero policies supply only their solver rules.
 */
export type HeroRulesFactory = (input: BotPolicyInput) => HeroSolverRules;

interface CachedHand {
  readonly context: ModelContext;
  solver?: HandSolver;
}

const CACHE_LIMIT = 16;
const cache = new Map<string, CachedHand>();

/** Everything the solver reads from the bot's own side of the board. Inputs
 * that differ only elsewhere (e.g. a projected resource count during the
 * opponent's turn, which the next-turn solve ignores) share one solver. */
function handKey(input: BotPolicyInput, factory: HeroRulesFactory): string {
  const me = input.view.players[input.seat];
  const opponent = input.view.players[1 - input.seat]!;
  const nextTurn = input.view.activePlayer !== input.seat;
  const ids = (cards: readonly CardView[]) => cards.map((card) =>
    `${card.instanceId}:${card.cardId}:${card.attack ?? ""}:${card.defense ?? ""}:${card.faceDown ? 1 : 0}` +
    `:${card.usedAbilityIndexes?.join(".") ?? ""}:${card.playableFromSourceCardId ?? ""}`
  ).join(",");
  return JSON.stringify([
    factory.name, input.view.gameId, input.seat, input.view.turn, nextTurn, me.life, opponent.life,
    opponent.arsenalCount, opponent.handCount,
    ids(me.hand), ids(me.arsenal), ids(me.weapons), ids(me.board), ids(me.banish), ids(me.graveyard),
    ids(Object.values(me.equipment).flatMap((card) => card ? [card] : [])),
    nextTurn
      ? []
      : [me.resources, me.actionPoints, ids(me.pitch), ids(input.view.chain.map((link) => link.attackingCard))],
    nextTurn ? [] : input.view.ongoing.map((effect) => `${effect.seat}:${effect.cardId}:${effect.label}`),
    input.decklists?.own?.length ?? 0, input.decklists?.opponent?.length ?? 0,
  ]);
}

function cachedHand(input: BotPolicyInput, factory: HeroRulesFactory): CachedHand {
  const key = handKey(input, factory);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const entry: CachedHand = { context: modelContext(input, factory(input)) };
  cache.set(key, entry);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return entry;
}

/** Best line from the given hand/arsenal cards (weapons, equipment and hero
 * abilities are always available). On the bot's own turn this continues the
 * current action phase; otherwise it is the bot's next turn. */
export function solveHand(
  cards: readonly CardView[],
  input: BotPolicyInput,
  factory: HeroRulesFactory,
): SolverResult {
  const entry = cachedHand(input, factory);
  entry.solver ??= buildHandSolver(entry.context);
  return entry.solver.solve(new Set(cards.map((card) => card.instanceId)));
}

/** Damage-equivalent offense of a hand: damage plus on-hit and play value,
 * excluding leftover value. Planner horizons add leftovers separately. */
export function handDamage(
  cards: readonly CardView[],
  input: BotPolicyInput,
  factory: HeroRulesFactory,
): number {
  const result = solveHand(cards, input, factory);
  return result.damage + result.onHit - result.consumedValue;
}

/** Defense-cycle response: next turn's damage plus the value of whatever the
 * line leaves held or in arsenal, so a card kept for arsenal is not free to
 * block with. */
export function handResponse(
  cards: readonly CardView[],
  input: BotPolicyInput,
  factory: HeroRulesFactory,
): ResponseEvaluation {
  const result = solveHand(cards, input, factory);
  return responseEvaluation({
    damageThreatened: result.damage + result.onHit - result.consumedValue,
    futureHandValue: result.leftoverValue,
  });
}

/** Arsenal value of a card for the bot's next turn (damage equivalents). At
 * the end-of-turn arsenal decision the hand refills either way, so the best
 * card goes to arsenal unless none beats an empty slot (score 0). */
export function arsenalCardValue(card: CardView, input: BotPolicyInput, factory: HeroRulesFactory): number {
  const { context } = cachedHand(input, factory);
  return solverCard(card, "hand", context)?.arsenalValue ?? 0;
}

/** `arsenalCardValue` bound to one hero's rules, for arsenal choice scoring. */
export function arsenalValuer(factory: HeroRulesFactory): (card: CardView, input: BotPolicyInput) => number {
  return (card, input) => arsenalCardValue(card, input, factory);
}

/** Value of keeping a card in hand over the draw it displaces. */
export function heldCardValue(card: CardView, input: BotPolicyInput, factory: HeroRulesFactory): number {
  const { context } = cachedHand(input, factory);
  const model = solverCard(card, "hand", context);
  if (model) return model.heldValue;
  const data = input.cards[card.cardId];
  return data ? heldValue(defaultCardUses(data), context.averageDraw, context.hitChance) : 0;
}

/** Blocking value an equipment piece gives up when it is spent. */
export function equipmentValue(card: CardView, input: BotPolicyInput): number {
  const data = input.cards[card.cardId];
  return Math.max(0, card.defense ?? data?.defense ?? 0) * BLOCK_USE_RATE;
}

