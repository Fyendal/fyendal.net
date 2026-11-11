import type { CardData, CardView } from "@fyendal/shared";
import { isAttack, type BotPolicyInput } from "./policy.js";

export function leviaEffectActive(input: BotPolicyInput, name: string): boolean {
  return input.view.activePlayer === input.seat && input.view.ongoing.some((effect) =>
    effect.seat === input.seat && input.cards[effect.cardId]?.name.toLowerCase() === name
  );
}

/** Whether Levia's hero text currently removes blood debt this end phase. */
export function leviaDebtSuppressed(input: BotPolicyInput, seat: number = input.seat): boolean {
  return !input.view.players[seat]!.heroAbilitiesLost &&
    input.view.turnFacts?.players[seat]?.banishedSixPlusThisTurn === true;
}

export function leviaAttackPlayable(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  if (!isAttack(data)) return false;
  const me = input.view.players[input.seat];
  if (data?.name === "Consuming Lash") return me.board.some((permanent) =>
    input.cards[permanent.cardId]?.name === "Blasmophet, the Insatiable Hunger"
  );
  // These attacks pay an additional graveyard cost before they can attack.
  if (["Dread Screamer", "Endless Maw", "Shadowrealm Horror"]
    .includes(data?.name ?? "")) return me.graveyard.filter((card) => !card.faceDown).length >= 3;
  if (data?.name === "Soul Harvest") return me.graveyard.filter((card) => !card.faceDown).length >= 6;
  if (data?.name === "Wrecker Romp") return me.hand.length >= 2;
  return true;
}

/** Resource cost of a Levia attack; an active Savage Sash discounts 6{p} attacks by 1. */
export function leviaAttackCost(data: CardData | undefined, sash: boolean): number {
  return Math.max(0, (data?.cost ?? 0) - (sash && (data?.attack ?? 0) >= 6 ? 1 : 0));
}

export function leviaAttackContinues(card: CardView, input: BotPolicyInput, future = false): boolean {
  const data = input.cards[card.cardId];
  if (data?.name === "Feeding Frenzy") {
    // Its own attack trigger can establish go again. Never inspect the next draw.
    return (!future && input.view.turnFacts?.players[input.seat]?.banishedSixPlusThisTurn === true) ||
      input.view.players[input.seat].deckCount > 0;
  }
  if (data?.name === "Dread Screamer") return input.view.players[input.seat].graveyard.some((card) =>
    !card.faceDown && (input.cards[card.cardId]?.attack ?? 0) >= 6
  );
  if (data?.name === "Shadowrealm Horror") return input.view.players[input.seat].graveyard.filter((card) =>
    !card.faceDown && (input.cards[card.cardId]?.attack ?? 0) >= 6
  ).length >= 2;
  return data?.keywords?.includes("Go again") === true;
}

/** Compare two attacks without also spending either attack as a pitch card.
 * Used for resource setup and the next-turn Sash block prediction, not legality. */
export function leviaAttackPair(
  input: BotPolicyInput,
  cards: readonly CardView[],
  options: {
    sash?: boolean;
    resources?: number;
    grantGoAgain?: boolean;
    future?: boolean;
    /** Attacks that also cost a Gate activation. */
    gated?: ReadonlySet<number>;
  } = {},
): boolean {
  const me = input.view.players[input.seat];
  const attacks = cards.filter((card) => leviaAttackPlayable(card, input));
  const sash = options.sash || (!options.future && leviaEffectActive(input, "savage sash"));
  const grantedGoAgain = options.grantGoAgain || (!options.future && leviaEffectActive(input, "consuming lash"));
  const cost = (card: CardView) => leviaAttackCost(input.cards[card.cardId], sash) +
    (options.gated?.has(card.instanceId) ? LEVIA_GATE_COST : 0);
  for (const first of attacks) {
    if (!grantedGoAgain && !leviaAttackContinues(first, input, options.future) &&
      (options.future || me.actionPoints < 2)) continue;
    for (const second of attacks) {
      if (first.instanceId === second.instanceId) continue;
      // Do not promise a retained pair through a random discard additional cost.
      if ([first, second].some((card) => input.cards[card.cardId]?.name === "Wrecker Romp")) continue;
      const pitch = me.hand.filter((card) => cards.some((available) => available.instanceId === card.instanceId) &&
        card.instanceId !== first.instanceId && card.instanceId !== second.instanceId
      ).reduce((sum, card) => sum + (input.cards[card.cardId]?.pitch ?? 0), 0);
      const resources = options.future ? 0 : options.resources ?? me.resources;
      if (resources + pitch >= cost(first) + cost(second)) return true;
    }
  }
  return false;
}

export function leviaSashEnablesPair(input: BotPolicyInput, cards: readonly CardView[], future = false): boolean {
  return leviaAttackPair(input, cards, { sash: true, future }) &&
    !leviaAttackPair(input, cards, { future });
}

const GATE = "Gate to i'Arathael";
const BELLOW = "Bloodrush Bellow";

export const BLOODRUSH_PLAN_WIDTH = 3;
export const BLOODRUSH_MIN_DAMAGE = 10;

export interface LeviaBloodrushTurn {
  /** Attacks the turn chains. */
  readonly width: number;
  /** Expected damage of the chained attacks, net of the one the discard may take. */
  readonly damage: number;
  /** The discard is certain to be a six: a miss ends the turn unplayed. */
  readonly hit: boolean;
}

/** A Bloodrush Bellow in hand or arsenal. */
export function leviaHoldsBellow(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  return [...me.hand, ...me.arsenal].some((card) => input.cards[card.cardId]?.name === BELLOW);
}

/** Six power as the engine counts it, including Rockyard Rodeo's weapon-set power. */
export function leviaSixPower(card: CardView, input: BotPolicyInput): boolean {
  const data = input.cards[card.cardId];
  if (data?.name === "Rockyard Rodeo") {
    return input.view.players[input.seat].weapons.some((weapon) => (input.cards[weapon.cardId]?.attack ?? 0) >= 6);
  }
  return (data?.attack ?? 0) >= 6;
}

/** Projection of the turn a Bellow could send now. Each other held card is
 * either sent or pitched (a sent hand card costs its price plus its pitch),
 * funded cheapest first. The discard may take a sent hand attack, so the
 * damage is net of that expected loss; arsenal and banished attacks are safe. */
export function leviaBloodrushTurn(input: BotPolicyInput, bellow: CardView): LeviaBloodrushTurn {
  const me = input.view.players[input.seat];
  const held = [...me.hand, ...me.arsenal].filter((card) => card.instanceId !== bellow.instanceId);
  const access = leviaBanishAccess(input, false);
  const gated = new Set(access.filter(({ viaGate }) => viaGate).map(({ card }) => card.instanceId));
  const sash = Object.values(me.equipment).some((card) => card && input.cards[card.cardId]?.name === "Savage Sash");
  const inHand = (card: CardView) => me.hand.some((heldCard) => heldCard.instanceId === card.instanceId);
  const effectiveCost = (card: CardView) =>
    leviaAttackCost(input.cards[card.cardId], sash) + (gated.has(card.instanceId) ? LEVIA_GATE_COST : 0) +
    (inHand(card) ? input.cards[card.cardId]?.pitch ?? 0 : 0);
  const attacks = [
    ...held.filter((card) => leviaAttackPlayable(card, input)),
    ...access.map(({ card }) => card),
  ].sort((left, right) => effectiveCost(left) - effectiveCost(right) ||
    (input.cards[right.cardId]?.attack ?? 0) - (input.cards[left.cardId]?.attack ?? 0));
  let pool = me.resources - (input.cards[bellow.cardId]?.cost ?? 0) +
    held.filter(inHand).reduce((total, card) => total + (input.cards[card.cardId]?.pitch ?? 0), 0);
  const sent: CardView[] = [];
  for (const attack of attacks) {
    if (effectiveCost(attack) > pool) continue;
    pool -= effectiveCost(attack);
    sent.push(attack);
  }
  if (sent.length === 0) return { width: 0, damage: 0, hit: false };
  const others = held.filter(inHand);
  const nonSix = others.filter((card) => !leviaSixPower(card, input)).length;
  // One non-six may pay for the Bellow itself.
  const hit = others.length > 0 && nonSix <= 1;
  const continues = sent.filter((card) => leviaAttackContinues(card, input)).length;
  const width = Math.min(sent.length, continues + 1);
  const chained = [...sent]
    .sort((left, right) => leviaBellowedPower(input.cards[right.cardId]) - leviaBellowedPower(input.cards[left.cardId]))
    .slice(0, width);
  const base = chained.reduce((total, card) => total + leviaBellowedPower(input.cards[card.cardId]), 0);
  // The discard hits one of the hand cards left after paying: each chained
  // hand attack is lost with that probability.
  const price = (card: CardView) => effectiveCost(card) - (inHand(card) ? input.cards[card.cardId]?.pitch ?? 0 : 0);
  let needed = (input.cards[bellow.cardId]?.cost ?? 0) - me.resources +
    sent.reduce((total, card) => total + price(card), 0);
  let pitched = 0;
  for (const card of others.filter((card) => !sent.includes(card))
    .sort((left, right) => (input.cards[right.cardId]?.pitch ?? 0) - (input.cards[left.cardId]?.pitch ?? 0))) {
    if (needed <= 0 || (input.cards[card.cardId]?.pitch ?? 0) === 0) break;
    needed -= input.cards[card.cardId]?.pitch ?? 0;
    pitched++;
  }
  const left = Math.max(1, others.length - pitched);
  const fromHand = chained.filter(inHand);
  const expectedLoss = fromHand.reduce((total, card) => total + leviaBellowedPower(input.cards[card.cardId]), 0) / left;
  return { width, damage: base - expectedLoss, hit };
}

/** An attack's power under the Bellow. */
export function leviaBellowedPower(data: CardData | undefined): number {
  return (data?.attack ?? 0) + (data?.classes?.some((cls) => cls.toLowerCase() === "brute") ? 2 : 0);
}

/** Whether a projected Bellow turn is worth sending. */
export function leviaBloodrushWorthSending(turn: LeviaBloodrushTurn, opponentLife: number): boolean {
  return turn.hit && (turn.damage >= BLOODRUSH_MIN_DAMAGE || turn.damage >= opponentLife);
}

const BLASMOPHET = "Blasmophet, the Insatiable Hunger";
const CONSUMED = "Blasmophet, Levia Consumed";
/** Blood debt reducing Levia's life to this offers the Consumed transform. */
export const LEVIA_CONSUMED_LIFE = 13;

/** A Gate's activation cost. */
export const LEVIA_GATE_COST = 1;

function controls(input: BotPolicyInput, name: string): number {
  return input.view.players[input.seat].board.filter((card) => input.cards[card.cardId]?.name === name).length;
}

/** Levia, Redeemed's cards lose blood debt while she has her abilities. */
function carriesBloodDebt(card: CardView, input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  return !card.faceDown && input.cards[card.cardId]?.keywords?.includes("Blood Debt") === true &&
    (me.heroAbilitiesLost === true || input.cards[me.heroCardId]?.name !== "Levia, Redeemed");
}

/** Blasmophet, Levia Consumed with her abilities: blood debt banishes the top
 * of her deck instead of draining life, and she plays one banished card a turn. */
export function leviaConsumed(input: BotPolicyInput): boolean {
  const me = input.view.players[input.seat];
  return me.heroAbilitiesLost !== true && input.cards[me.heroCardId]?.name === CONSUMED;
}

/** Life `cards`' blood debt drains at Levia's end phase. */
export function leviaBloodDebt(cards: readonly CardView[], input: BotPolicyInput): number {
  if (leviaConsumed(input)) return 0;
  return cards.filter((card) => carriesBloodDebt(card, input)).length;
}

export function leviaBloodDebtAction(card: CardView, input: BotPolicyInput): boolean {
  return input.cards[card.cardId]?.cardType === "action" && carriesBloodDebt(card, input);
}

/** Open once-per-turn Blasmophet banish plays: the ally's and, next turn, Consumed's.
 * This turn's Consumed play is already a projected permission on the card. */
function blasmophetSlots(input: BotPolicyInput, nextTurn: boolean): number {
  return (blasmophetPlayOpen(input, nextTurn) ? 1 : 0) + (nextTurn && leviaConsumed(input) ? 1 : 0);
}

/** Whether Blasmophet's once-per-turn banish play is still available. */
function blasmophetPlayOpen(input: BotPolicyInput, nextTurn: boolean): boolean {
  if (controls(input, BLASMOPHET) === 0) return false;
  const me = input.view.players[input.seat];
  if (nextTurn || input.view.pendingDecision !== null || input.view.stack.length > 0 ||
    input.view.chain.some((link) => !link.resolved) || me.actionPoints < 1) return true;
  return input.legal.some((intent) => {
    if (intent.kind !== "play-from-zone" || intent.zone !== "banish") return false;
    const card = me.banish.find((candidate) => candidate.instanceId === intent.instanceId);
    return card !== undefined && card.playableFromSourceCardId === undefined && leviaBloodDebtAction(card, input);
  });
}

export interface LeviaBanishAccess {
  readonly card: CardView;
  readonly viaGate: boolean;
}

/** Banished Blood Debt attacks reachable through Gates and Blasmophet, one per
 * permission, best first. `extra` adds hypothetical Gates and banished cards. */
export function leviaBanishAccess(
  input: BotPolicyInput,
  nextTurn: boolean,
  extra: { gates?: number; banished?: readonly CardView[] } = {},
): LeviaBanishAccess[] {
  const me = input.view.players[input.seat];
  const blasmophet = blasmophetSlots(input, nextTurn);
  const slots = controls(input, GATE) + (extra.gates ?? 0) + blasmophet;
  if (slots === 0) return [];
  // A shared Blasmophet permission projected now is next turn's open play too.
  const reachable = (card: CardView) => card.playableFromSourceCardId === undefined ||
    (nextTurn && leviaSharedBanishPlay(card, input));
  return leviaBanishPriority([...me.banish, ...(extra.banished ?? [])]
    .filter((card) => reachable(card) && leviaBloodDebtAction(card, input) && leviaAttackPlayable(card, input)), input)
    .slice(0, slots)
    .map((card, index) => ({ card, viaGate: index >= blasmophet }));
}

/** Banished cards playable through a once-per-turn Blasmophet permission
 * (the ally's or Consumed's), as opposed to a Gate or a card's own grant. */
function leviaSharedBanishPlay(card: CardView, input: BotPolicyInput): boolean {
  const source = card.playableFromSourceCardId;
  if (source === undefined || card.faceDown) return false;
  const name = input.cards[source]?.name;
  return name === BLASMOPHET || name === CONSUMED;
}

/** Shadowrealm Horror, then Dread Screamer and Feeding Frenzy, then other go
 * again, then Endless Maw: go-again attacks keep the banish turn going. */
function banishRank(data: CardData | undefined): number {
  switch (data?.name) {
    case "Shadowrealm Horror": return 0;
    case "Dread Screamer":
    case "Feeding Frenzy": return 1;
    case "Endless Maw": return 3;
    // Conditional go again (Ram Raider, Soul Cleaver) is only in the text.
    default: return data?.keywords?.includes("Go again") || /go again/i.test(data?.text ?? "") ? 2 : 4;
  }
}

/** Banished attacks in the order Levia spends a banish play on them. */
function leviaBanishPriority(cards: readonly CardView[], input: BotPolicyInput): CardView[] {
  return [...cards].sort((left, right) => {
    const a = input.cards[left.cardId];
    const b = input.cards[right.cardId];
    return banishRank(a) - banishRank(b) || (b?.attack ?? 0) - (a?.attack ?? 0) ||
      (a?.cost ?? 0) - (b?.cost ?? 0) || left.instanceId - right.instanceId;
  });
}

/** Keep only the best banished cards each open Blasmophet permission can play;
 * every face-up Blood Debt card is otherwise its own search branch. */
export function leviaSharedBanishPicks(cards: readonly CardView[], input: BotPolicyInput): Set<number> {
  const shared = cards.filter((card) => leviaSharedBanishPlay(card, input));
  const slots = new Set(shared.map((card) => card.playableFromSourceCardId)).size;
  const playable = shared.filter((card) => !isAttack(input.cards[card.cardId]) || leviaAttackPlayable(card, input));
  return new Set(leviaBanishPriority(playable, input).slice(0, slots).map((card) => card.instanceId));
}

/** `cards` without the Blasmophet banish plays beyond the priority picks. */
export function leviaPrunedBanish(cards: readonly CardView[], input: BotPolicyInput): CardView[] {
  const picks = leviaSharedBanishPicks(cards, input);
  return cards.filter((card) => !leviaSharedBanishPlay(card, input) || picks.has(card.instanceId));
}
