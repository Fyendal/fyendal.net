import type { CardView, GameIntent } from "@fyendal/shared";
import { intentCard, ownCards, type BotPolicyInput } from "./policy.js";

// Strategy rules approved in the Midrange review, 2026-09-04. These are bot
// constraints, not changes to card legality or engine costs.
export const MIDRANGE_VERSION = "midrange-helm-v2-turn-completion";
export const FIRE = "fire that burns within";
export const FLAME = "phoenix flame";
export const POTION = "energy potion";
export const ANGER = "compounding anger";
export function midName(card: CardView, input: BotPolicyInput): string {
  return input.cards[card.cardId]?.name.toLowerCase() ?? "";
}
export function midSource(intent: GameIntent, input: BotPolicyInput): string {
  if (intent.kind === "activate-ability" && intent.sourceInstanceId === input.view.players[input.seat].heroInstanceId) return "fai";
  const card = intentCard(intent, ownCards(input));
  return card ? midName(card, input) : "";
}
export function midDraconicLinks(input: BotPolicyInput): number {
  return input.view.chain.filter((link) => link.attackingCard.owner === input.seat &&
    [...(input.cards[link.attackingCard.cardId]?.subtypes ?? []), ...(link.attackingCard.grantedTypes ?? [])]
      .some((type) => type.toLowerCase() === "draconic")).length;
}
export function midEnder(card: CardView, input: BotPolicyInput): boolean {
  return [ANGER, "salt the wound", "lava burst", "snatch"].includes(midName(card, input));
}
export function midStarter(card: CardView, input: BotPolicyInput): boolean {
  return ["ronin renegade", "brand with cinderclaw", "rising resentment", "fire tenet: strike first", "growl", "ravenous rabble"].includes(midName(card, input));
}
export function reserveRank(card: CardView, input: BotPolicyInput): number {
  const name = midName(card, input);
  if (name === FLAME) return -1;
  if (midStarter(card, input)) {
    const draconic = input.cards[card.cardId]?.subtypes?.some((x) => x.toLowerCase() === "draconic") ?? false;
    const fealty = input.view.players[input.seat].board.some((x) => midName(x, input) === "fealty");
    return draconic !== fealty ? 5 : 4;
  }
  if (name === POTION) return 0;
  return midEnder(card, input) ? 2 : 3;
}
export function yellowBluePayment(intent: GameIntent, input: BotPolicyInput): boolean {
  const ids = "pitchInstanceIds" in intent ? (intent.pitchInstanceIds ?? []) : [];
  if ("pitchRequired" in intent && (intent.pitchRequired ?? 0) > 0 && !ids.length) return false;
  return ids.every((id) => {
    const card = input.view.players[input.seat].hand.find((x) => x.instanceId === id);
    const pitch = card && input.cards[card.cardId]?.pitch;
    return pitch === 2 || pitch === 3;
  });
}

/** Local resource provenance. Spend Tiger's resource first on permitted costs;
 * Anger cannot turn a freshly generated chest resource into "leftover" funds.
 * This observer contains no state mutations and never enters persisted games. */
export interface MidResourceOrigin {
  resources: number;
  tiger: number;
  chest?: number;
  pitch: ReadonlySet<number>;
  potions: ReadonlySet<number>;
}
export function resourceOrigin(input: BotPolicyInput, tiger = 0): MidResourceOrigin {
  const me = input.view.players[input.seat];
  return { resources: me.resources, tiger, chest: me.equipment.chest?.instanceId,
    pitch: new Set(me.pitch.map((x) => x.instanceId)),
    potions: new Set(me.board.filter((x) => midName(x, input) === POTION).map((x) => x.instanceId)) };
}
export function tigerFloating(input: BotPolicyInput, origin: MidResourceOrigin): number {
  const me = input.view.players[input.seat];
  const tiger = origin.tiger + Number(origin.chest !== undefined && me.equipment.chest?.instanceId !== origin.chest);
  const pitched = me.pitch.filter((x) => !origin.pitch.has(x.instanceId))
    .reduce((sum, x) => sum + (input.cards[x.cardId]?.pitch ?? 0), 0);
  const potionResources = 2 * [...origin.potions].filter((id) => !me.board.some((x) => x.instanceId === id)).length;
  const spent = Math.max(0, origin.resources + pitched + potionResources + tiger - origin.tiger - me.resources);
  return Math.min(me.resources, Math.max(0, tiger - spent));
}
export interface MidLimits {
  opening: boolean;
  closing: boolean;
  tools: boolean;
  paidAnger: boolean;
  origin: MidResourceOrigin;
  reservedId?: number;
}
export function midAllowed(intent: GameIntent, input: BotPolicyInput, limits: MidLimits): boolean {
  if (intent.kind === "concede" || !yellowBluePayment(intent, input)) return false;
  const name = midSource(intent, input);
  const pitch = "pitchInstanceIds" in intent ? (intent.pitchInstanceIds ?? []) : [];
  if (limits.reservedId !== undefined && (("instanceId" in intent && intent.instanceId === limits.reservedId) || pitch.includes(limits.reservedId))) return false;
  if (limits.opening && pitch.length) return false;
  if (["tearing shuko", "pouncing paws", "blood scent"].includes(name)) return !limits.opening && limits.tools;
  if (name === "hope merchant's hood") return false;
  if (name === "fai") {
    const cost = Math.max(0, 3 - midDraconicLinks(input));
    if (cost > 1) return false;
    const me = input.view.players[input.seat];
    if (!limits.closing && cost > me.resources - tigerFloating(input, limits.origin) && !pitch.length) return false;
  }
  if (name === ANGER) {
    const cost = Math.max(0, 3 - midDraconicLinks(input));
    const me = input.view.players[input.seat];
    if (pitch.length && !limits.paidAnger) return false;
    const generated = pitch.reduce((sum, id) => {
      const card = me.hand.find((x) => x.instanceId === id);
      return sum + (card ? input.cards[card.cardId]?.pitch ?? 0 : 0);
    }, 0);
    if (cost > me.resources - tigerFloating(input, limits.origin) + generated) return false;
  }
  return true;
}

/** Same resolution policy in real play and rollouts. A Fire attack trigger is
 * a priority window (CR 7.2.3–7.2.4); recover before resolving its card choice.
 * https://rules.fabtcg.com/en/cr/07-combat/ */
export function midForced(input: BotPolicyInput, limits?: MidLimits): GameIntent {
  const legal = input.legal.filter((x) => x.kind !== "concede");
  const prompt = input.view.pendingDecision?.prompt ?? "";
  const me = input.view.players[input.seat];
  const firePending = input.view.stack.some((layer) => layer.seat === input.seat && layer.card &&
    midName(layer.card, input) === FIRE && /discard/i.test(layer.label));
  if (firePending && !me.hand.some((x) => midName(x, input) === FLAME)) {
    const hero = legal.find((x) => midSource(x, input) === "fai" &&
      midDraconicLinks(input) >= 2 && (!limits || midAllowed(x, input, limits)) && yellowBluePayment(x, input));
    if (hero) return hero;
  }
  if (/Fire that Burns Within|return a Phoenix Flame|Rise from the Ashes/i.test(prompt)) {
    const flames = [...me.hand, ...me.graveyard].filter((x) => midName(x, input) === FLAME);
    const choice = legal.find((x) => x.kind === "choose" && flames.some((f) => String(f.instanceId) === x.optionId));
    if (choice) return choice;
  }
  if (/Fai/i.test(prompt)) {
    const yes = legal.find((x) => x.kind === "choose" && x.optionId === "yes");
    if (yes) return yes;
  }
  if (input.view.pendingDecision?.resourcePayment) {
    const options = input.view.pendingDecision.resourcePayment.options;
    const choice = legal.find((x) => x.kind === "choose" && options.some((o) => o.optionId === x.optionId &&
      yellowBluePayment({ kind: "activate-ability", sourceInstanceId: me.heroInstanceId, pitchInstanceIds: o.pitchInstanceIds }, input)));
    if (choice) return choice;
  }
  if (input.view.pendingDecision?.kind === "arsenal") {
    const cards = me.hand.filter((x) => midName(x, input) !== FLAME).sort((a, b) => reserveRank(b, input) - reserveRank(a, input));
    const choice = legal.find((x) => x.kind === "choose" && x.optionId === String(cards[0]?.instanceId));
    if (choice) return choice;
  }
  return legal.find((x) => x.kind === "defend" && !x.instanceIds.length) ??
    legal.find((x) => x.kind === "choose" && ["no", "done", "pass", "decline", "pay 0"].includes(x.optionId)) ??
    legal.find((x) => x.kind === "pass") ?? legal.find((x) => x.kind === "close-chain") ?? legal[0]!;
}
