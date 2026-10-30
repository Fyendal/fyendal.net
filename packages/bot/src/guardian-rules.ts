import type { CardData, CardView } from "@fyendal/shared";
import { DEFAULT_HIT_CHANCE } from "./card-ev.js";
import type { SolverCardPatch } from "./card-model.js";
import type { SolverCard, SolverView } from "./hand-solver.js";
import { evaluateOnHit } from "./on-hit.js";
import type { BotPolicyInput } from "./policy.js";

/**
 * Card rules shared by the Guardian and Earth/Ice decks (Bravo, Jarl,
 * Starvo): Pummel, Titan's Fist, Earth-banish thresholds, Decompose and
 * Earth/Ice Fusion.
 */
export const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

function hasSubtype(data: CardData | undefined, subtype: string): boolean {
  return data?.subtypes?.some((value) => value.toLowerCase() === subtype) === true;
}

export function earthBanished(input: BotPolicyInput): number {
  return input.view.players[input.seat].banish.filter((card) => hasSubtype(input.cards[card.cardId], "earth")).length;
}

/** Decompose: banish two Earth cards and an action card from the graveyard. */
export function canDecompose(input: BotPolicyInput): boolean {
  const graveyard = input.view.players[input.seat].graveyard;
  const earth = graveyard.filter((card) => hasSubtype(input.cards[card.cardId], "earth"));
  return earth.length >= 2 && graveyard.some((card) =>
    input.cards[card.cardId]?.cardType === "action" &&
    earth.filter((other) => other.instanceId !== card.instanceId).length >= 2
  );
}

/** Fusion: reveal another held card of each named element. */
function canFuse(view: SolverView, self: number, elements: readonly string[]): boolean {
  const others = view.held.filter((card) => card.instanceId !== self);
  return elements.every((element) => others.some((card) => view.hasTrait(card, element)));
}

/** Fusion from `cards`; one dual-element card (Crumble to Eternity) covers both. */
export function cardsCanFuse(
  cards: readonly CardView[],
  input: BotPolicyInput,
  elements: readonly string[],
): boolean {
  return elements.every((element) => cards.some((card) => hasSubtype(input.cards[card.cardId], element)));
}

/** Fusion from the current hand, for static card uses. */
function handCanFuse(input: BotPolicyInput, self: number, elements: readonly string[]): boolean {
  const others = input.view.players[input.seat].hand.filter((card) => card.instanceId !== self);
  return cardsCanFuse(others, input, elements);
}

/** Pummel's attack-action mode adds "When this hits a hero, they discard a card." */
const PUMMEL_ON_HIT_RIDER = evaluateOnHit({
  effects: [{ text: "they discard a card" }],
  attackerCanContinue: false,
  attackerCanArsenal: true,
  defenderHasHand: true,
  defenderHasArsenal: false,
}).value * DEFAULT_HIT_CHANCE;

function isClubOrHammerWeapon(card: SolverCard): boolean {
  return card.kind === "weapon" && (card.traits.includes("club") || card.traits.includes("hammer"));
}

/** Damage-equivalent of Oaken Old's fused hit: two random cards to the bottom. */
const OAKEN_OLD_FUSED_ON_HIT = 6;

export function guardianPatch(data: CardData, card: CardView, input: BotPolicyInput): SolverCardPatch {
  const power = card.attack ?? data.attack ?? 0;
  const me = input.view.players[input.seat];
  const patch: SolverCardPatch = {};
  const titansFist = me.weapons.some((weapon) => named(input.cards[weapon.cardId]) === "titan's fist");
  // Titan's Fist checks for a cost-3+ card in the pitch zone.
  if (titansFist && (data.cost ?? 0) >= 3 && Number(data.pitch ?? 0) > 0) {
    patch.onPitch = () => ({ flags: { pitchedCost3: 1 } });
  }
  switch (named(data)) {
    case "titan's fist":
      patch.powerIn = (view) => power + (view.flag("pitchedCost3") > 0 ? 1 : 0);
      break;
    case "pummel":
      patch.reactionPower = Number(/\+(\d+)\{p\}/.exec(data.text)?.[1] ?? 0);
      patch.uses = { pumpRider: PUMMEL_ON_HIT_RIDER };
      patch.reactionTarget = (attack) => isClubOrHammerWeapon(attack) || (attack.kind === "attack" && attack.cost >= 2);
      break;
    case "felling of the crown":
    case "plow under":
      if (earthBanished(input) >= 4) {
        patch.powerIn = () => power + 4;
        patch.uses = { power: power + 4 };
      }
      break;
    case "cadaverous tilling":
      if (canDecompose(input)) {
        patch.powerIn = () => power + 2;
        patch.uses = { power: power + 2 };
      }
      break;
    case "rootbound carapace":
      if (canDecompose(input)) patch.uses = { defense: (card.defense ?? data.defense ?? 0) + 1 };
      break;
    case "oaken old":
      patch.powerIn = (view) => power + (canFuse(view, card.instanceId, ["earth", "ice"]) ? 2 : 0);
      patch.onHitIn = (view) => canFuse(view, card.instanceId, ["earth", "ice"]) ? OAKEN_OLD_FUSED_ON_HIT : 0;
      if (handCanFuse(input, card.instanceId, ["earth", "ice"])) {
        patch.uses = { power: power + 2, onHit: OAKEN_OLD_FUSED_ON_HIT };
      }
      break;
    default:
      break;
  }
  return patch;
}
