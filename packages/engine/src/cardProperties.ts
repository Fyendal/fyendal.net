import type { GameStateInternal } from "./runtimeState.js";
import type { CardColor, CardData, CardType, MeldSide } from "@fyendal/shared";
import type { CardScript } from "./scripts.js";
import type { CardInstance, ChainLinkState, PlayerState } from "./state.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import { currentLink, findCardAnywhere } from "./zoneQueries.js";

// Card data currently stores talent supertypes beside ordinary subtypes.
// Keep this aligned with CR 2.11.6b so effects such as Erase Face can remove
// printed talents without stripping true subtypes such as Attack or Aura. The
// parameterized engine regression covers every entry added here.
export const TALENT_SUPERTYPES = [
  "chaos",
  "draconic",
  "earth",
  "elemental",
  "ice",
  "light",
  "lightning",
  "mystic",
  "revered",
  "reviled",
  "royal",
  "shadow",
] as const;
const TALENT_SUPERTYPE_SET = new Set<string>(TALENT_SUPERTYPES);

// CR 2.11.6a class supertypes, for effects that stop cards gaining classes.
const CLASS_SUPERTYPES = [
  "adjudicator",
  "assassin",
  "bard",
  "brute",
  "guardian",
  "illusionist",
  "mechanologist",
  "merchant",
  "necromancer",
  "ninja",
  "pirate",
  "ranger",
  "runeblade",
  "shapeshifter",
  "thief",
  "warrior",
  "wizard",
] as const;
const CLASS_TALENT_SUPERTYPE_SET = new Set<string>([...CLASS_SUPERTYPES, ...TALENT_SUPERTYPES]);

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
  return ownAbilitiesSuppressed(state, card) || abilitiesLostToChosenName(state, card);
}

function ownAbilitiesSuppressed(state: GameStateInternal, card: CardInstance): boolean {
  const owner = state.players[card.owner] as PlayerState | undefined;
  const link = currentLink(state);
  return Number(owner?.hero.counters?.ownedCardAbilitiesDisabledTurn ?? 0) === state.turn ||
    (link?.flags.attackAbilitiesSuppressed === true &&
      link.attackingCard.instanceId === card.instanceId);
}

/** A board permanent's `chosenNameLosesAbilities` strips matching objects.
 * Matching reads printed data and granted names only: effective names and
 * types consult scripts, which would recurse back into this check. */
function abilitiesLostToChosenName(state: GameStateInternal, card: CardInstance): boolean {
  let data: CardData | undefined;
  let names: string[] | undefined;
  for (const player of state.players) {
    for (const source of player.board) {
      const filter = state.scriptsRef[source.cardId]?.chosenNameLosesAbilities;
      const chosen = source.chosenName?.trim().toLowerCase();
      if (!filter || !chosen || source.instanceId === card.instanceId) continue;
      if (ownAbilitiesSuppressed(state, source)) continue;
      data ??= instanceDataOf(state, card);
      if (filter.cardType !== undefined && data.cardType !== filter.cardType) continue;
      if (filter.subtype !== undefined && !(data.subtypes ?? []).includes(filter.subtype)) continue;
      names ??= [data.name, ...(card.grantedNames ?? [])].map((name) => name.trim().toLowerCase());
      if (names.includes(chosen)) return true;
    }
  }
  return false;
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
 * 1/2/3/4 in card data) but remains independent from the numeric pitch property. */
export function cardColorOf(
  state: GameStateInternal,
  card: {
    readonly owner: number;
    readonly cardId: string;
    readonly flipped?: boolean;
    readonly grantedColor?: CardColor;
  },
): CardColor | 0 {
  const owner = state.players[card.owner] as PlayerState;
  if (Number(owner.hero.counters?.colorsSuppressedUntilTurn ?? 0) >= state.turn) return 0;
  if (card.grantedColor !== undefined) return card.grantedColor;
  const front = dataOf(state, card.cardId);
  const data = card.flipped && front.backId ? dataOf(state, front.backId) : front;
  const color = data.color ?? data.pitch;
  return color === 1 || color === 2 || color === 3 || color === 4 ? color : 0;
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

/** Whether an owned card currently loses its printed class and talent types. */
function ownedClassTalentTypesSuppressed(
  state: GameStateInternal,
  card: CardInstance,
): boolean {
  const owner = state.players[card.owner] as PlayerState;
  return Number(owner.hero.counters?.classTalentTypesSuppressedUntilTurn ?? 0) >= state.turn ||
    state.modifiers.some(
      (modifier) =>
        modifier.seat === owner.seat && modifier.suppressesOwnedClassTalentTypes === true,
    );
}

/** Effective classes/subtypes of a card in its current zone. */
export function cardTypesOf(state: GameStateInternal, card: CardInstance): string[] {
  const data = instanceDataOf(state, card);
  const ownerHero = state.players[card.owner]?.hero;
  const heroOwnedRules = ownerHero ? scriptOf(state, ownerHero.cardId, ownerHero)?.ownedCardTypes : undefined;
  const ownedRules = heroOwnedRules && !heroAbilitiesDisabled(state, card.owner) ? heroOwnedRules : undefined;
  const lockClassTalent = ownedRules?.loseClassTalent === true;
  const suppressClassTalent = lockClassTalent || ownedClassTalentTypesSuppressed(state, card);
  const allZone = card.faceDown
    ? []
    : (scriptOf(state, card.cardId, card)?.allZoneTypes ?? []);
  // CR 8.3.35: Universal continually gives a face-up card the classes of its
  // controller's hero (or its owner's hero when it has no controller). This
  // gain is applied after effects that remove printed class/talent types, so
  // an effect such as Erase Face does not by itself remove the gained class.
  const controllerSeat = findCardAnywhere(state, card.instanceId)?.seat ?? card.owner;
  const controllerHero = state.players[controllerSeat]?.hero ?? state.players[card.owner]?.hero;
  // CR 6.2.3a: an equipment's static grant ends when its ability stops
  // functioning. Derive it from current equipment instead of stamping the hero.
  const equippedHeroTypes = controllerHero?.instanceId === card.instanceId
    ? Object.values(state.players[controllerSeat]!.equipment).flatMap((equipment) =>
      equipment && !equipment.faceDown
        ? (scriptOf(state, equipment.cardId, equipment)?.equippedHeroTypes ?? [])
        : []
    )
    : [];
  const universalClasses = !card.faceDown &&
      instanceHasKeyword(state, card, "universal") && controllerHero
    ? (instanceDataOf(state, controllerHero).classes ?? [])
    : [];
  const types = [
    ...(!suppressClassTalent ? (data.classes ?? []) : []),
    ...(data.subtypes ?? []).filter(
      (type) => !suppressClassTalent || !TALENT_SUPERTYPE_SET.has(type.toLowerCase()),
    ),
    ...universalClasses,
    ...allZone,
    ...equippedHeroTypes,
    ...(card.grantedTypes ?? []),
    ...(card.temporaryAlly ? ["ally"] : []),
    ...state.modifiers.flatMap((modifier) => {
      const name = modifier.grantsTypeToName?.trim().toLowerCase();
      return name && modifier.grantsType && cardNamesOf(state, card).includes(name)
        ? [modifier.grantsType]
        : [];
    }),
    ...(ownedRules?.gain ?? []),
  ].map((type) => type.toLowerCase());
  return [...new Set(
    lockClassTalent ? types.filter((type) => !CLASS_TALENT_SUPERTYPE_SET.has(type)) : types,
  )];
}

/** Chi-subtype cards pitch for chi points instead of resource points (CR 1.13.5). */
export function isChiCard(state: GameStateInternal, card: CardInstance): boolean {
  return (instanceDataOf(state, card).subtypes ?? []).includes("chi");
}

/** An attack action card: playing it creates an attack, not resolution effects. */
export function isAttackActionData(data: CardData): boolean {
  return data.cardType === "action" && (data.subtypes ?? []).includes("attack");
}

/** CR 8.2.6a: arrows can only be played from arsenal while controlling a bow. */
export function isArrowData(data: CardData): boolean {
  return (data.subtypes ?? []).includes("arrow");
}

/** Ward N of a card's printed or temporarily granted keywords (CR 8.3.20).
 * A permanent can be destroyed only once for a damage event, so use its
 * highest active Ward value when it has more than one. */
export function wardValueOf(data: CardData, instance?: CardInstance): number | undefined {
  let value: number | undefined;
  for (const keyword of [...(data.keywords ?? []), ...(instance?.grantedKeywords ?? [])]) {
    if (instance?.suppressedKeywords?.includes(keyword.toLowerCase())) continue;
    const match = /^ward (\d+)$/i.exec(keyword.trim());
    if (match) value = Math.max(value ?? 0, Number(match[1]));
  }
  return value;
}

/** Whether the link's attack currently has veil, printed or granted. */
export function attackHasVeil(state: GameStateInternal, link: ChainLinkState): boolean {
  return link.flags.attackAbilitiesSuppressed !== true &&
    instanceHasKeyword(state, link.attackingCard, "veil");
}

/** Veil: the attack can't be defended by more than 1 card of each color.
 * Returns whether `card` would be a second defender of its color, counting
 * current defenders and any cards staged with it. Colorless cards are never
 * restricted. */
export function veilBlocksDefender(
  state: GameStateInternal,
  link: ChainLinkState,
  card: CardInstance,
  staged: readonly CardInstance[] = [],
): boolean {
  if (!attackHasVeil(state, link)) return false;
  const color = cardColorOf(state, card);
  if (color === 0) return false;
  return [...link.defendingCards, ...link.defendingEquipment, ...staged].some(
    (defender) => defender.instanceId !== card.instanceId && cardColorOf(state, defender) === color,
  );
}
