import type { GameStateInternal } from "./runtimeState.js";
import type { CardData } from "@fyendal/shared";
import {
  cardAbilitiesSuppressed,
  cardColorOf,
  dataOf,
} from "./cardProperties.js";
import type { CardInstance, ChainLinkState, Modifier, PlayerState } from "./state.js";
import { goAgainSuppressed } from "./ruleQueries.js";
import { opponent } from "./zoneQueries.js";

function isSword(data: CardData): boolean {
  return (data.subtypes ?? []).includes("sword");
}

export function hasClass(data: CardData, cardClass: string): boolean {
  return (data.classes ?? []).some(
    (candidate) => candidate.toLowerCase() === cardClass.toLowerCase(),
  );
}

/** Does a modifier's static filter set match the supplied card properties? */
function modifierMatches(
  modifier: Modifier,
  data: CardData,
  cardType: "action" | "weapon" | "ally" | "defense",
  color: number,
  granted: (tag: string) => boolean = () => false,
  grantedNames: readonly string[] = [],
  keywordAbilitiesActive = true,
  effectiveCardTypes: readonly string[] = [data.cardType],
): boolean {
  const appliesTo = modifier.appliesTo ?? "any";
  if (appliesTo === "weapon") {
    if (cardType !== "weapon") return false;
  } else if (appliesTo === "attack") {
    if (
      cardType !== "weapon" &&
      (cardType !== "action" || !(data.subtypes ?? []).includes("attack"))
    ) return false;
  } else if (appliesTo === "sword") {
    if (cardType !== "weapon" || !isSword(data)) return false;
  } else if (appliesTo === "attack-action") {
    if (cardType !== "action" || !(data.subtypes ?? []).includes("attack")) return false;
  }
  const cost = data.cost ?? 0;
  if (modifier.minCost !== undefined && cost < modifier.minCost) return false;
  if (modifier.maxCost !== undefined && cost > modifier.maxCost) return false;
  if (modifier.maxBasePower !== undefined && (data.attack ?? 0) > modifier.maxBasePower) {
    return false;
  }
  if (modifier.minBasePower !== undefined && (data.attack ?? 0) < modifier.minBasePower) {
    return false;
  }
  const appliesToKeyword = modifier.appliesToKeyword?.toLowerCase();
  if (
    appliesToKeyword &&
    (
      !keywordAbilitiesActive ||
      !(data.keywords ?? []).some(
        (keyword) => keyword.toLowerCase() === appliesToKeyword,
      )
    )
  ) return false;
  if (
    modifier.appliesToName &&
    ![data.name, ...grantedNames].some(
      (name) => name.trim().toLowerCase() === modifier.appliesToName!.toLowerCase(),
    )
  ) return false;
  if (
    modifier.excludesSubtype &&
    (data.subtypes ?? []).includes(modifier.excludesSubtype)
  ) return false;
  if (modifier.appliesToCardType === "reaction") {
    if (
      !effectiveCardTypes.includes("attack-reaction") &&
      !effectiveCardTypes.includes("defense-reaction")
    ) {
      return false;
    }
  } else if (
    modifier.appliesToCardType &&
    !effectiveCardTypes.includes(modifier.appliesToCardType)
  ) return false;
  if (modifier.appliesToPitch !== undefined && color !== modifier.appliesToPitch) return false;
  const hasTag = (tag: string): boolean =>
    hasClass(data, tag) ||
    (data.subtypes ?? []).some(
      (subtype) => subtype.toLowerCase() === tag.toLowerCase(),
    ) ||
    granted(tag.toLowerCase());
  if (modifier.appliesToClass && !hasTag(modifier.appliesToClass)) return false;
  if (modifier.appliesToSubtype) {
    const wanted = Array.isArray(modifier.appliesToSubtype)
      ? modifier.appliesToSubtype
      : [modifier.appliesToSubtype];
    if (!wanted.some(hasTag)) return false;
  }
  if (modifier.appliesToType && !modifier.appliesToType.some(hasTag)) return false;
  return true;
}

/** Classes/subtypes granted to a link at declaration or on its attack card. */
export function attackGrantedType(link: ChainLinkState, tag: string): boolean {
  return (
    link.flags[`grantedType:${tag}`] === true ||
    (link.attackingCard.grantedTypes ?? []).includes(tag)
  );
}

export function modifierAppliesTo(
  state: GameStateInternal,
  modifier: Modifier,
  data: CardData,
  cardType: "action" | "weapon" | "ally",
  color: number,
  card: CardInstance,
  granted?: (tag: string) => boolean,
  grantedNames?: readonly string[],
): boolean {
  return modifierMatches(
    modifier,
    data,
    cardType,
    color,
    granted,
    grantedNames,
    !cardAbilitiesSuppressed(state, card),
  );
}

export function modifierAppliesToDefense(
  state: GameStateInternal,
  modifier: Modifier,
  data: CardData,
  color: number,
  card: CardInstance,
): boolean {
  if (
    modifier.appliesToInstanceId !== undefined &&
    modifier.appliesToInstanceId !== card.instanceId
  ) return false;
  if (modifier.appliesTo === "weapon" || modifier.appliesTo === "sword") return false;
  // Outside the stack, a split-card has the card types of both sides (CR 9.2.2).
  const meld = state.scriptsRef[card.cardId]?.meld;
  const effectiveCardTypes = meld
    ? [meld.leftCardType, meld.rightCardType]
    : [data.cardType];
  return modifierMatches(
    modifier,
    data,
    "action",
    color,
    undefined,
    undefined,
    !cardAbilitiesSuppressed(state, card),
    effectiveCardTypes,
  );
}

export function modifierApplies(
  state: GameStateInternal,
  modifier: Modifier,
  link: ChainLinkState,
): boolean {
  if (modifier.seat !== link.attacker) return false;
  if (
    modifier.appliesToInstanceId !== undefined &&
    modifier.appliesToInstanceId !== link.attackingCard.instanceId
  ) return false;
  if (modifier.appliesToTargetType) {
    if (link.targetAllyId !== undefined) return false;
    const targetHero = dataOf(
      state,
      (state.players[opponent(link.attacker)] as PlayerState).heroCardId,
    );
    const wanted = modifier.appliesToTargetType.toLowerCase();
    const matches =
      (targetHero.classes ?? []).some((tag) => tag.toLowerCase() === wanted) ||
      (targetHero.subtypes ?? []).some((tag) => tag.toLowerCase() === wanted);
    if (!matches) return false;
  }
  if (modifier.appliesToMarkedHero) {
    if (link.targetAllyId !== undefined) return false;
    const targetHero = (state.players[opponent(link.attacker)] as PlayerState).hero;
    if (
      (targetHero.counters?.marked ?? 0) <= 0 &&
      link.flags.targetWasMarkedOnHit !== true
    ) return false;
  }
  if (modifier.appliesToFromArsenal === true && link.flags.fromArsenal !== true) return false;
  if (modifier.appliesToRuneGated === true && !link.attackingCard.counters?.runeGated) {
    return false;
  }
  if (modifier.appliesToCharged === true && !link.attackingCard.counters?.chargedPitch) {
    return false;
  }
  return modifierAppliesTo(
    state,
    modifier,
    dataOf(state, link.attackingCard.cardId),
    link.attackCardType,
    cardColorOf(state, link.attackingCard),
    link.attackingCard,
    (tag) => attackGrantedType(link, tag),
    link.attackingCard.grantedNames,
  );
}

/** Modifiers on state currently live on a link within the given scopes. */
export function activeModifiers(
  state: GameStateInternal,
  link: ChainLinkState,
  scopes: Modifier["scope"][],
): Modifier[] {
  return state.modifiers.filter(
    (modifier) => scopes.includes(modifier.scope) && modifierApplies(state, modifier, link),
  );
}

/** Whether an attached modifier's played/created-subtype condition currently
 * gives the active attack go again. The condition remains live until the link
 * resolves, so an aura created after declaration can still satisfy it. */
export function conditionalModifierGrantsGoAgain(
  state: GameStateInternal,
  link: ChainLinkState,
): boolean {
  const player = state.players[link.attacker] as PlayerState;
  if (
    link.flags.attackAbilitiesSuppressed === true ||
    goAgainSuppressed(state, link.attacker) ||
    (link.attackingCard.suppressedKeywords ?? []).includes("go again")
  ) return false;
  return activeModifiers(state, link, ["chain-link"]).some((modifier) => {
    const subtype = modifier.goAgainIfPlayedOrCreatedSubtype?.toLowerCase();
    return subtype !== undefined && (
      player.flags[`playedSubtype:${subtype}`] === true ||
      player.flags[`createdSubtype:${subtype}`] === true
    );
  });
}
