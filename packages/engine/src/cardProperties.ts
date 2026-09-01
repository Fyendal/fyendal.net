import type { GameStateInternal } from "./runtimeState.js";
import type { CardData, CardType, MeldSide } from "@fyendal/shared";
import type { CardScript } from "./scripts.js";
import type { CardInstance, PlayerState } from "./state.js";
import { currentLink } from "./zoneQueries.js";

export function dataOf(state: GameStateInternal, cardId: string): CardData {
  const data = state.cardsRef[cardId];
  if (!data) throw new Error(`unknown card id: ${cardId}`);
  return data;
}

/** Effective static data of a card instance: a transcended card uses its back
 * face's data for the remainder of the game (CR 9.1.5b). */
export function instanceDataOf(state: GameStateInternal, card: CardInstance): CardData {
  const front = dataOf(state, card.cardId);
  if (card.flipped && front.backId) return dataOf(state, front.backId);
  return front;
}

/** Whether this object has lost all abilities for its owner's current turn. */
export function cardAbilitiesSuppressed(
  state: GameStateInternal,
  card: CardInstance,
): boolean {
  const owner = state.players[card.owner] as PlayerState | undefined;
  const link = currentLink(state);
  return Number(owner?.hero.counters?.ownedCardAbilitiesDisabledTurn ?? 0) === state.turn ||
    (link?.flags.attackAbilitiesSuppressed === true &&
      link.attackingCard.instanceId === card.instanceId);
}

/** Whether a layer-continuous effect prohibits activating this object's
 * activated abilities. Existing layers remain independent and still resolve. */
export function activatedAbilitiesSuppressed(
  state: GameStateInternal,
  card: CardInstance,
): boolean {
  return state.modifiers.some((modifier) =>
    !modifier.consumed &&
    modifier.suppressesActivatedAbilitiesOfInstanceId === card.instanceId
  );
}

/** Resolve a functional script. Suppressed objects have no script abilities;
 * callers inspecting an actual object must pass it so ownership is honored. */
export function scriptOf(
  state: GameStateInternal,
  cardId: string,
  card?: CardInstance,
): CardScript | undefined {
  if (card && cardAbilitiesSuppressed(state, card)) return undefined;
  return state.scriptsRef[cardId];
}

export function hasKeyword(
  state: GameStateInternal,
  cardOrId: CardInstance | string,
  keyword: string,
): boolean {
  const card = typeof cardOrId === "string" ? undefined : cardOrId;
  if (card && cardAbilitiesSuppressed(state, card)) return false;
  const cardId = typeof cardOrId === "string" ? cardOrId : cardOrId.cardId;
  return (state.cardsRef[cardId]?.keywords ?? []).some(
    (candidate) => candidate.toLowerCase() === keyword.toLowerCase(),
  );
}

/** Effective keyword presence on an instance. Explicit suppression takes
 * precedence over both printed and granted keywords. */
export function instanceHasKeyword(
  state: GameStateInternal,
  card: CardInstance,
  keyword: string,
): boolean {
  const normalized = keyword.toLowerCase();
  if ((card.suppressedKeywords ?? []).includes(normalized)) return false;
  const materialKeywords = (card.subcards ?? []).flatMap((subcard) =>
    scriptOf(state, subcard.cardId, subcard)?.materialKeywords ?? []
  );
  const grantedBaseKeywords = [
    ...(card.grantedBaseAbilitiesCardId ? [card.grantedBaseAbilitiesCardId] : []),
    ...(card.grantedBaseAbilitiesCardIds ?? []),
  ].flatMap((cardId) => dataOf(state, cardId).keywords ?? []);
  return (
    hasKeyword(state, card, keyword) ||
    (card.grantedKeywords ?? []).some(
      (candidate) => candidate.toLowerCase() === normalized,
    ) ||
    grantedBaseKeywords.some((candidate) => candidate.toLowerCase() === normalized) ||
    materialKeywords.some((candidate) => candidate.toLowerCase() === normalized)
  );
}

/** Whether a card object has a card-type keyword in its current declared form.
 * A melded split card combines the types of both sides (CR 8.3.38c). */
export function meldSideHasType(
  state: GameStateInternal,
  card: CardInstance,
  side: MeldSide,
  cardType: CardType,
): boolean {
  const meld = scriptOf(state, card.cardId, card)?.meld;
  if (!meld) return instanceDataOf(state, card).cardType === cardType;
  if (side === "left") return meld.leftCardType === cardType;
  if (side === "right") return meld.rightCardType === cardType;
  return meld.leftCardType === cardType || meld.rightCardType === cardType;
}

export function cardHasType(
  state: GameStateInternal,
  card: CardInstance,
  cardType: CardType,
): boolean {
  if (cardType === "action" && state.scriptsRef[card.cardId]?.playableEquipment) return true;
  if (state.scriptsRef[card.cardId]?.additionalCardTypes?.includes(cardType)) return true;
  const meld = scriptOf(state, card.cardId, card)?.meld;
  if (!meld) return instanceDataOf(state, card).cardType === cardType;
  const declaredObjectExists = state.stack.some(
    (layer) => layer.card?.instanceId === card.instanceId,
  ) || state.resolving.some((resolving) => resolving.instanceId === card.instanceId);
  if (!card.meldSide || !declaredObjectExists) {
    return meld.leftCardType === cardType || meld.rightCardType === cardType;
  }
  return meldSideHasType(state, card, card.meldSide, cardType);
}

/** Effective card color. Printed color tracks the color strip (represented by
 * 1/2/3 in card data) but remains independent from the numeric pitch property. */
export function cardColorOf(
  state: GameStateInternal,
  card: {
    readonly owner: number;
    readonly cardId: string;
    readonly flipped?: boolean;
    readonly grantedColor?: 1 | 2 | 3;
  },
): number {
  const owner = state.players[card.owner] as PlayerState;
  if (Number(owner.hero.counters?.colorsSuppressedUntilTurn ?? 0) >= state.turn) return 0;
  if (card.grantedColor !== undefined) return card.grantedColor;
  const front = dataOf(state, card.cardId);
  const pitch = (card.flipped && front.backId ? dataOf(state, front.backId) : front).pitch;
  return pitch === 1 || pitch === 2 || pitch === 3 ? pitch : 0;
}

/** Effective names of a card object. Amnesia-style suppression is stored on
 * the owner's hero so it follows the owned object through every zone. */
export function cardNamesOf(state: GameStateInternal, card: CardInstance): string[] {
  const owner = state.players[card.owner] as PlayerState;
  if (
    Number(owner.hero.counters?.namesSuppressedUntilTurn ?? 0) >= state.turn ||
    state.modifiers.some(
      (modifier) => modifier.seat === owner.seat && modifier.suppressesOwnedNames === true,
    )
  ) return [];
  const allZone = card.faceDown
    ? []
    : (scriptOf(state, card.cardId, card)?.allZoneNames ?? []);
  return [...new Set([
    dataOf(state, card.cardId).name,
    ...allZone,
    ...(card.grantedNames ?? []),
  ].map((name) => name.trim().toLowerCase()))];
}

export function cardHasName(
  state: GameStateInternal,
  card: CardInstance,
  name: string,
): boolean {
  return cardNamesOf(state, card).includes(name.trim().toLowerCase());
}

/** Effective classes/subtypes of a card in its current zone. */
export function cardTypesOf(state: GameStateInternal, card: CardInstance): string[] {
  const data = instanceDataOf(state, card);
  const owner = state.players[card.owner] as PlayerState;
  const suppressClassTalent =
    Number(owner.hero.counters?.classTalentTypesSuppressedUntilTurn ?? 0) >= state.turn ||
    state.modifiers.some(
      (modifier) =>
        modifier.seat === owner.seat && modifier.suppressesOwnedClassTalentTypes === true,
    );
  const allZone = card.faceDown
    ? []
    : (scriptOf(state, card.cardId, card)?.allZoneTypes ?? []);
  return [...new Set([
    ...(!suppressClassTalent ? (data.classes ?? []) : []),
    ...(data.subtypes ?? []),
    ...(!suppressClassTalent ? allZone : []),
    ...(!suppressClassTalent ? (card.grantedTypes ?? []) : []),
    ...(card.temporaryAlly ? ["ally"] : []),
    ...(!suppressClassTalent ? state.modifiers.flatMap((modifier) => {
      const name = modifier.grantsTypeToName?.trim().toLowerCase();
      return name && modifier.grantsType && cardNamesOf(state, card).includes(name)
        ? [modifier.grantsType]
        : [];
    }) : []),
  ].map((type) => type.toLowerCase()))];
}

/** Chi-subtype cards pitch for chi points instead of resource points (CR 1.13.5). */
export function isChiCard(state: GameStateInternal, card: CardInstance): boolean {
  return (instanceDataOf(state, card).subtypes ?? []).includes("chi");
}

/** CR 8.2.6a: arrows can only be played from arsenal while controlling a bow. */
export function isArrowData(data: CardData): boolean {
  return (data.subtypes ?? []).includes("arrow");
}

/** Ward N of a card's static data (CR 8.3.20: "If you would be dealt damage,
 * destroy this to prevent N of that damage"), if it has the keyword. */
export function wardValueOf(data: CardData): number | undefined {
  for (const keyword of data.keywords ?? []) {
    const match = /^ward (\d+)$/i.exec(keyword.trim());
    if (match) return Number(match[1]);
  }
  return undefined;
}
