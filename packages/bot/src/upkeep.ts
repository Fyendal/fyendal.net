import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";

interface EndPhaseUpkeep {
  /** Resources that prevent the damage. */
  cost: number;
  damage: number;
  /** Semantic prompt of the token's pay-or-take-damage decision. */
  promptId: string;
}

/** Tokens that, at the beginning of their controller's end phase, deal damage
 * unless the controller pays. Keyed by functional identity. */
const END_PHASE_UPKEEP: Readonly<Record<string, EndPhaseUpkeep>> = {
  "bloodrot pox|0": { cost: 3, damage: 2, promptId: "card.saz.bloodrot.pay" },
};

function upkeepOf(data: CardData | undefined): EndPhaseUpkeep | undefined {
  if (!data) return undefined;
  return END_PHASE_UPKEEP[`${data.name.trim().toLowerCase().replace(/\s+/g, " ")}|${data.pitch ?? 0}`];
}

function cardPitch(card: CardView, input: BotPolicyInput): number {
  return Number(input.cards[card.cardId]?.pitch ?? 0);
}

/** Resources the bot must still hold when its end phase begins so unpaid
 * upkeep damage leaves it alive; 0 when no upkeep can kill it this turn. */
export function lethalUpkeepReserve(input: BotPolicyInput): number {
  const me = input.view.players[input.seat];
  if (input.view.activePlayer !== input.seat || input.view.winner != null) return 0;
  const upkeeps = me.board.flatMap((card) => upkeepOf(input.cards[card.cardId]) ?? []);
  if (upkeeps.reduce((total, upkeep) => total + upkeep.damage, 0) < me.life) return 0;
  // Pay the most damage per resource first until the unpaid rest is survivable.
  const ordered = [...upkeeps].sort((left, right) =>
    right.damage / Math.max(1, right.cost) - left.damage / Math.max(1, left.cost)
  );
  let unpaid = ordered.reduce((total, upkeep) => total + upkeep.damage, 0);
  let reserve = 0;
  for (const upkeep of ordered) {
    if (unpaid < me.life) break;
    unpaid -= upkeep.damage;
    reserve += upkeep.cost;
  }
  return reserve;
}

function availableResources(input: BotPolicyInput, spent: ReadonlySet<number> = new Set()): number {
  const me = input.view.players[input.seat];
  return me.hand.reduce(
    (total, card) => spent.has(card.instanceId) ? total : total + cardPitch(card, input),
    0,
  );
}

/** Floating resources plus hand pitch left after the intent, assuming
 * floating resources an unknown cost could consume are gone. */
function resourcesAfter(intent: GameIntent, input: BotPolicyInput): number {
  const me = input.view.players[input.seat];
  if (
    intent.kind !== "play-card" && intent.kind !== "play-from-arsenal" &&
    intent.kind !== "play-from-zone" && intent.kind !== "activate-ability"
  ) return me.resources + availableResources(input);

  const spent = new Set([...intent.pitchInstanceIds, ...(intent.alternativeCostCardInstanceIds ?? [])]);
  if (intent.kind === "play-card") spent.add(intent.instanceId);
  const ownHand = new Map(me.hand.map((card) => [card.instanceId, card]));
  const pitched = intent.pitchInstanceIds.reduce((total, id) => {
    const card = ownHand.get(id);
    return total + (card ? cardPitch(card, input) : 0);
  }, 0);
  // Legal intents record the pitch still owed after floating resources, so a
  // positive requirement means the whole floating pool is spent.
  let floating = 0;
  if (intent.pitchRequired !== undefined && intent.pitchRequired > 0) {
    floating = Math.max(0, pitched - intent.pitchRequired);
  } else if (intent.pitchRequired === 0 && intent.kind !== "activate-ability") {
    const played = intent.kind === "play-card"
      ? ownHand.get(intent.instanceId)
      : [...me.arsenal, ...me.pitch, ...me.graveyard, ...me.banish]
        .find((card) => card.instanceId === intent.instanceId);
    const cost = played ? input.cards[played.cardId]?.cost : undefined;
    floating = cost === undefined ? 0 : Math.max(0, me.resources + pitched - cost);
  }
  return floating + availableResources(input, spent);
}

/** Withhold own-turn plays that would leave too few resources to pay a lethal
 * end-phase upkeep (Bloodrot Pox at 2 life or less). When the bot cannot cover
 * the reserve anyway, every legal intent stays available. */
export function reserveLethalUpkeep(input: BotPolicyInput): BotPolicyInput {
  const reserve = lethalUpkeepReserve(input);
  if (reserve <= 0) return input;
  const me = input.view.players[input.seat];
  if (me.resources + availableResources(input) < reserve) return input;
  const legal = input.legal.filter((intent) => resourcesAfter(intent, input) >= reserve);
  return legal.length === 0 || legal.length === input.legal.length ? input : { ...input, legal };
}

/** Pay an end-phase upkeep whenever possible. Its trigger resolves before the
 * end-phase draw, so pitched hand cards are replaced at once; a held card's
 * margin over that draw is far below the damage it prevents. The cheapest
 * option pitches the fewest cards, then wastes the fewest resources. */
export function chooseUpkeepPayment(input: BotPolicyInput): GameIntent | undefined {
  const decision = input.view.pendingDecision;
  if (!decision || decision.player !== input.seat) return undefined;
  const promptId = decision.promptMessage?.id;
  if (!Object.values(END_PHASE_UPKEEP).some((upkeep) => upkeep.promptId === promptId)) return undefined;

  const hand = new Map(input.view.players[input.seat].hand.map((card) => [card.instanceId, card]));
  const payments = input.legal.flatMap((intent) => {
    if (intent.kind !== "choose" || intent.optionId === "no") return [];
    const ids = decision.resourcePayment?.options
      .find((option) => option.optionId === intent.optionId)?.pitchInstanceIds ?? [];
    const pitched = ids.reduce((total, id) => {
      const card = hand.get(id);
      return total + (card ? cardPitch(card, input) : 0);
    }, 0);
    return [{ intent, cards: ids.length, pitched }];
  });
  return payments.reduce<typeof payments[number] | undefined>((best, candidate) =>
    !best || candidate.cards < best.cards ||
      (candidate.cards === best.cards && candidate.pitched < best.pitched)
      ? candidate
      : best,
  undefined)?.intent;
}
