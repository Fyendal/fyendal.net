import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type {
  CardView,
  ChainLinkView,
  CombatValueModifierView,
  EquipmentSlot,
  GameView,
  OnHitEffectView,
  OngoingEffectView,
  PlayableZone,
  PlayerView,
  StackLayerView,
  TurnFactsView,
} from "@fyendal/shared";
import type { CardInstance, CombatValueModifier, Modifier, PlayerState } from "./state.js";
import { cardColorOf, dataOf, instanceDataOf, scriptOf } from "./cardProperties.js";
import { pendingOnHitEffects } from "./hits.js";
import { conditionalModifierGrantsGoAgain } from "./combatModifiers.js";
import {
  attackHasDominate,
  attackHasOverpower,
  attackValueModifiers,
  computeAttack,
  computeDefense,
  defenseValueModifiers,
  effectiveDefense,
  grantsAuraAttackMarker,
  stagedDefenseTotal,
} from "./combatValues.js";
import {
  abilityList,
  activatedFlagKey,
  ONCE_PER_TURN_EFFECT_FLAG_PREFIX,
} from "./scripts.js";
import { currentLink, findCardAnywhere } from "./zoneQueries.js";
import { controlledPermanents } from "./sourceQueries.js";
import { activatedAbilityAvailable } from "./abilityRules.js";
import { wardPieces } from "./damageResolution.js";
import { playFromSourceCardId } from "./playRules.js";
import { windowPrompt } from "./triggers.js";

interface CardViewOptions {
  controller?: PlayerState;
  /** Counter state no longer applies after a card enters an inactive zone. */
  includeCounters?: boolean;
  /** Current ally life is arena state and does not follow a card into an inactive zone. */
  includeLife?: boolean;
  /** Include private provenance for this viewer's play-from-zone permission. */
  playableFrom?: { zone: PlayableZone; actingSeat: number };
}

function projectedAbilityLabels(
  abilities: ReturnType<typeof abilityList>,
): string[] | undefined {
  if (abilities.length <= 1) return undefined;
  return abilities.map(
    (ability, index) => ability.label ?? (ability.isAttack ? "Attack" : `Ability ${index + 1}`),
  );
}

function cardView(state: GameStateInternal,
  runtime: EngineRuntime, c: CardInstance, opts: CardViewOptions = {}): CardView {
  const d = instanceDataOf(state, c);
  const includeCounters = opts.includeCounters ?? true;
  const includeLife = opts.includeLife ?? true;
  const power = includeCounters ? (c.counters?.power ?? 0) : 0;
  const controller = opts.controller;
  const abilities = abilityList(scriptOf(state, c.cardId, c));
  const nativeUsedAbilityIndexes = controller
    ? abilities.flatMap((ability, index) =>
        !activatedAbilityAvailable(controller, c.instanceId, index, ability)
          ? [index]
          : [],
      )
    : [];
  // Aura attacks granted by another permanent (Reality Refractor, Cosmo)
  // are synthetic once-per-turn abilities whose index follows the card's
  // printed abilities. Project their per-instance usage too, so otherwise
  // identical board cards do not collapse after only one has attacked.
  const grantedAuraAttackIndex = controller &&
    controller.board.some((card) => card.instanceId === c.instanceId) &&
    grantsAuraAttackMarker(state, controller, c)
      ? abilities.length
      : undefined;
  const usedAbilityIndexes = grantedAuraAttackIndex !== undefined &&
    controller?.flags[activatedFlagKey(c.instanceId, grantedAuraAttackIndex)] === true
      ? [...nativeUsedAbilityIndexes, grantedAuraAttackIndex]
      : nativeUsedAbilityIndexes;
  const playableFromSource = opts.playableFrom
    ? playFromSourceCardId(state, runtime, c, opts.playableFrom.zone, opts.playableFrom.actingSeat)
    : undefined;
  return {
    instanceId: c.instanceId,
    // a flipped (transcended) hand card shows its back face — public information
    cardId: d.id,
    name: d.name,
    owner: c.owner,
    ...(c.pitchCount ? { pitchCount: c.pitchCount } : {}),
    ...(c.subcards && c.subcards.length > 0
      ? {
          subcards: c.subcards.map((subcard) => cardView(state, runtime, subcard, {
            includeCounters,
            includeLife,
          })),
        }
      : {}),
    // +1{p} counters (Sharpen/Glisten) ride the card; surface the buffed value
    attack: d.attack !== undefined && power > 0 ? d.attack + power : d.attack,
    defense: includeCounters && c.defCounters ? effectiveDefense(state, c) : d.defense,
    ...(c.faceDown ? { faceDown: true } : {}),
    ...(c.intimidated ? { intimidated: true } : {}),
    ...(c.tapped ? { tapped: true } : {}),
    ...(includeCounters && c.defCounters ? { defCounters: c.defCounters } : {}),
    ...(includeCounters && c.counters && Object.keys(c.counters).length > 0
      ? { counters: c.counters }
      : {}),
    ...(playableFromSource ? { playableFromSourceCardId: playableFromSource } : {}),
    ...(usedAbilityIndexes.length > 0 ? { usedAbilityIndexes } : {}),
    ...(abilities.length > 1 ? { activatedAbilityLabels: projectedAbilityLabels(abilities) } : {}),
    ...(c.grantedNames && c.grantedNames.length > 0 ? { grantedNames: c.grantedNames } : {}),
    ...(c.chosenName ? { chosenName: c.chosenName } : {}),
    ...(c.grantedTypes && c.grantedTypes.length > 0 ? { grantedTypes: c.grantedTypes } : {}),
    ...(c.grantedColor !== undefined ? { grantedColor: c.grantedColor } : {}),
    ...(includeLife && c.life !== undefined ? { life: c.life } : {}),
  };
}

/** A card whose identity is secret to this viewer (face-down, not theirs).
 *  Never expose the engine instance id: a client could correlate that stable
 *  id with the same card after it was previously public. `opaqueInstanceId`
 *  is projection-local and exists only so lists can render distinct backs. */
function hiddenView(c: CardInstance, opaqueInstanceId = -1): CardView {
  // intimidated status is public even when the identity is not: everyone knows
  // the card returns to hand at the beginning of the end phase
  return {
    instanceId: opaqueInstanceId,
    cardId: "",
    owner: c.owner,
    faceDown: true,
    hidden: true,
    ...(c.intimidated ? { intimidated: true } : {}),
  };
}

/** Resolve a card-choice option (requestCardChoice). Choices only ever offer
 *  objects the deciding player is entitled to see (own hand, deck searches,
 *  public zones), so this is a plain card view; the projection nulls the
 *  entries for non-deciding viewers so secret cards never leak. Null when
 *  the card left the game before the choice was answered. */
function optionCardView(state: GameStateInternal,
  runtime: EngineRuntime, instanceId: number): CardView | null {
  const found = findCardAnywhere(state, instanceId);
  if (!found) return null;
  const inactive = state.players.some((player) =>
    [...player.graveyard, ...player.banish].some((card) => card.instanceId === instanceId),
  );
  return cardView(state, runtime, found.card, inactive
    ? { includeCounters: false, includeLife: false }
    : {});
}

/** Render a registered card definition that is not a live game object, such
 * as a token hero offered by a transform choice. The synthetic instance id is
 * presentation-only; choosing the card still submits the parallel option id. */
function definitionOptionCardView(
  state: GameStateInternal,
  runtime: EngineRuntime,
  cardId: string,
  owner: number,
  optionIndex: number,
): CardView | null {
  if (!state.cardsRef[cardId]) return null;
  return cardView(state, runtime, {
    instanceId: state.nextInstanceId + optionIndex,
    cardId,
    owner,
  });
}

function playerView(
  state: GameStateInternal,
  runtime: EngineRuntime,
  p: PlayerState,
  self: boolean,
  revealAll = false,
): PlayerView {
  const gameOver = state.winner !== null;
  const equipment: Partial<Record<EquipmentSlot, CardView>> = {};
  for (const [slot, c] of Object.entries(p.equipment)) {
    if (!c) continue;
    // Cloaked: a face-down equipment is hidden from the opponent (they see a
    // face-down card in the slot, not its identity); the owner sees it normally
    equipment[slot as EquipmentSlot] = c.faceDown && !self && !revealAll
      ? hiddenView(c)
      : cardView(state, runtime, c, { controller: p });
  }
  const heroScript = scriptOf(state, p.hero.cardId, p.hero);
  const visibleDeckTop = self && heroScript?.lookAtTopDeck === true ? p.deck[0] : undefined;
  const heroAbilityLabels = projectedAbilityLabels(abilityList(heroScript));
  const heroSubcards = cardView(state, runtime, p.hero).subcards;
  return {
    seat: p.seat,
    heroCardId: p.heroCardId,
    heroInstanceId: p.hero.instanceId,
    ...(p.hero.tapped ? { heroTapped: true } : {}),
    ...(p.hero.counters && Object.keys(p.hero.counters).length > 0
      ? { heroCounters: p.hero.counters }
      : {}),
    ...(p.hero.defCounters ? { heroDefCounters: p.hero.defCounters } : {}),
    ...(heroSubcards ? { heroSubcards } : {}),
    ...(heroAbilityLabels ? { heroAbilityLabels } : {}),
    heroName: dataOf(state, p.heroCardId).name,
    life: p.life,
    actionPoints: p.actionPoints,
    resources: p.resources,
    chi: p.chi,
    hand: self || gameOver || revealAll ? p.hand.map((c) => cardView(state, runtime, c)) : [],
    handCount: p.hand.length,
    deckCount: p.deck.length,
    ...(gameOver || revealAll ? { deck: p.deck.map((c) => cardView(state, runtime, c)) } : {}),
    // face-up cards (e.g. a flipped mentor) are public; face-down stay secret
    arsenal: self || gameOver || revealAll
      ? p.arsenal.map((c) => cardView(state, runtime, c))
      : p.arsenal.filter((c) => !c.faceDown).map((c) => cardView(state, runtime, c)),
    arsenalCount: p.arsenal.length,
    pitch: p.pitch.map((c) => cardView(state, runtime, c)), // pitch zone is public
    pitchCount: p.pitch.length,
    // Watery Grave cards are public until their trigger turns them face down;
    // after that, only the owner retains their identity.
    graveyard: p.graveyard.map((c, index) =>
      !self && !revealAll && c.faceDown
        ? hiddenView(c, -(index + 1))
        : cardView(state, runtime, c, {
            includeCounters: false,
            includeLife: false,
            ...(self && !revealAll ? { playableFrom: { zone: "graveyard", actingSeat: p.seat } } : {}),
          })
    ),
    // face-down banished cards are secret to everyone but their owner
    banish: p.banish.map((c, index) =>
      !self && !revealAll && c.faceDown
        ? hiddenView(c, -(index + 1))
        : cardView(state, runtime, c, {
            includeCounters: false,
            includeLife: false,
            ...(self && !revealAll ? { playableFrom: { zone: "banish", actingSeat: p.seat } } : {}),
          })
    ),
    // the soul is face-up and public
    soul: p.soul.map((c) => cardView(state, runtime, c)),
    ...(visibleDeckTop ? { visibleDeckTop: cardView(state, runtime, visibleDeckTop) } : {}),
    equipment,
    weapons: p.weapons.map((c) => cardView(state, runtime, c, { controller: p })),
    board: p.board.map((c) => cardView(state, runtime, c, { controller: p })),
  };
}

/** Short human-readable summary of a lingering modifier's effect. */
function modifierEffectLabel(state: GameStateInternal, m: Modifier): string {
  const parts: string[] = [];
  if (m.ongoingLabel) parts.push(m.ongoingLabel);
  if (m.attack) parts.push(`${m.attack > 0 ? "+" : ""}${m.attack} attack`);
  if (m.piercing) parts.push(`piercing ${m.piercing}`);
  if (m.defense) parts.push(`${m.defense > 0 ? "+" : ""}${m.defense} defense`);
  if (m.attackCostReduction) {
    parts.push(`attack costs ${m.attackCostReduction} less`);
  }
  if (m.playCostReduction) parts.push(`play costs ${m.playCostReduction} less`);
  if (m.activationCostReduction) parts.push(`activation costs ${m.activationCostReduction} less`);
  if (m.grantKeyword) parts.push(m.grantKeyword.toLowerCase());
  if (m.goAgain) parts.push("go again");
  if (m.onHitGoAgain) parts.push("go again on hit");
  if (m.goAgainIfPlayedOrCreatedSubtype) {
    parts.push(`go again if a ${m.goAgainIfPlayedOrCreatedSubtype} was played or created`);
  }
  if (m.onHitGainLife) parts.push(`gain ${m.onHitGainLife} life on next hit`);
  if (m.onHitDraw) parts.push(`draw ${m.onHitDraw} on next hit`);
  if (m.onHitDestroyTopDeckCards) {
    const { count, minimumDamage } = m.onHitDestroyTopDeckCards;
    parts.push(`destroy the top ${count} deck cards after dealing ${minimumDamage}+ damage`);
  }
  if (m.goAgainIfDefendedByAttackAction) parts.push("go again if defended by an attack action");
  if (m.onDefendedDealDamage) {
    parts.push(`deal ${m.onDefendedDealDamage} damage when defended by 1 or more cards`);
  }
  if (m.onHitCreateToken) {
    const { count } = m.onHitCreateToken;
    parts.push(`create ${count} token${count === 1 ? "" : "s"} on hit`);
  }
  if (m.dominate) parts.push("dominate");
  if (m.intimidate) parts.push(m.intimidate > 1 ? `intimidate ${m.intimidate}` : "intimidate");
  if (m.maxNonBlockDefenders !== undefined) {
    parts.push(`max ${m.maxNonBlockDefenders} non-block defenders`);
  }
  if (m.preventNextDamagePool) {
    const chosenSource = m.appliesToInstanceId === undefined
      ? undefined
      : findCardAnywhere(state, m.appliesToInstanceId)?.card;
    parts.push(
      `prevent next ${m.preventNextDamagePool} damage` +
      (chosenSource ? ` from ${dataOf(state, chosenSource.cardId).name}` : ""),
    );
  }
  if (m.preventDamagePerEvent && m.preventDamageEventsRemaining) {
    parts.push(
      `prevent ${m.preventDamagePerEvent} damage from each of the next ` +
      `${m.preventDamageEventsRemaining} damage events`,
    );
  }
  if (m.preventNextDamageAmount) {
    const sourceType = m.appliesToDamageSourceType
      ? ` from a ${m.appliesToDamageSourceType} source`
      : "";
    const eventLimit = m.maxDamageEventAmount !== undefined
      ? ` when the event is ${m.maxDamageEventAmount} or less`
      : "";
    parts.push(`prevent next ${m.preventNextDamageAmount} damage${sourceType}${eventLimit}`);
  }
  if (m.preventNextDamageFromPitch !== undefined) {
    parts.push(`prevent the next damage event from a pitch ${m.preventNextDamageFromPitch} source`);
  }
  if (m.preventAllDamageFromSource) {
    const chosenSource = m.appliesToInstanceId === undefined
      ? undefined
      : findCardAnywhere(state, m.appliesToInstanceId)?.card;
    parts.push(
      `prevent all damage${chosenSource ? ` from ${dataOf(state, chosenSource.cardId).name}` : " from the chosen source"}`,
    );
  }
  if (m.discardDamagePreventionAmount && m.discardDamagePreventionCardType) {
    parts.push(
      `discard a ${m.discardDamagePreventionCardType} to prevent ` +
      `${m.discardDamagePreventionAmount} damage`,
    );
  }
  if (m.onPreventCreateToken) {
    parts.push(`create ${dataOf(state, m.onPreventCreateToken).name} when damage is prevented`);
  }
  if (m.suppressesHeroAbilities) parts.push("hero abilities disabled");
  return parts.join(", ") || "ongoing effect";
}

/** Keep the relevant printed paragraph(s) for a scripted hit trigger. Card
 * data uses newlines as ability boundaries, so this avoids showing unrelated
 * play/attack text in the compact combat tooltip. */
function printedOnHitText(state: GameStateInternal, cardId: string): string {
  const data = dataOf(state, cardId);
  const paragraphs = data.text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const hitText = paragraphs
    .filter((paragraph) => /\bhits?\b/i.test(paragraph))
    .map((paragraph) => {
      const trigger = paragraph.search(/\b(?:when(?:ever)?|if|the next time)\b(?=[^.]*\bhits?\b)/i);
      return trigger >= 0 ? paragraph.slice(trigger) : paragraph;
    });
  return (hitText.length > 0 ? hitText : paragraphs).join(" ") || `${data.name} has an on-hit effect.`;
}

function grantedOnHitText(state: GameStateInternal, modifier: Modifier): string {
  const effects: string[] = [];
  if (modifier.onHitGoAgain) effects.push("this gets go again");
  if (modifier.onHitGainLife) effects.push(`gain ${modifier.onHitGainLife} life`);
  if (modifier.onHitGainResources) {
    const amount = modifier.onHitGainResources;
    effects.push(`gain ${amount} resource${amount === 1 ? "" : "s"}`);
  }
  if (modifier.onHitDraw) {
    const amount = modifier.onHitDraw;
    effects.push(`draw ${amount} card${amount === 1 ? "" : "s"}`);
  }
  if (modifier.onHitCreateToken) {
    const { cardId, count } = modifier.onHitCreateToken;
    const token = dataOf(state, cardId).name;
    effects.push(`create ${count} ${token} token${count === 1 ? "" : "s"}`);
  }
  if (modifier.onHitLoseLife) {
    const amount = modifier.onHitLoseLife;
    effects.push(`the defending hero loses ${amount} life`);
  }
  if (modifier.onHitDestroyTopDeckCards) {
    const { count, minimumDamage } = modifier.onHitDestroyTopDeckCards;
    effects.push(`if this deals ${minimumDamage} or more damage, destroy the top ${count} cards of the defending hero's deck`);
  }
  if (modifier.onHitToSoul) effects.push("put this into your hero's soul");
  if (modifier.onHitBottomDeck) effects.push("put this on the bottom of its owner's deck");
  if (modifier.onHitReenableAttacker) effects.push("this may attack an additional time this turn");
  if (modifier.onHitReenableAttackerIfMarked) {
    effects.push("if the defending hero was marked, this may attack an additional time this turn");
  }
  if (modifier.onHitMark) effects.push("mark the defending hero");
  if (modifier.onHitScriptHook) effects.push(modifier.onHitScriptHook.label);
  return `When this hits, ${effects.join("; ")}.`;
}

function countWord(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "a" || normalized === "one") return 1;
  if (normalized === "two") return 2;
  if (normalized === "three") return 3;
  const count = Number(normalized);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function projectedOnHitImpact(text: string): NonNullable<OnHitEffectView["impact"]> | undefined {
  const normalized = text.trim().toLowerCase();
  const damage = Number(/(?:deal|deals|lose|loses)\D{0,24}(\d+)\s+(?:arcane\s+)?(?:damage|life)/
    .exec(normalized)?.[1] ?? NaN);
  const drawCards = countWord(/draws?\s+(a|one|two|three|\d+)\s+cards?/.exec(normalized)?.[1]);
  const discardCards = countWord(
    /(?:discard(?:s)?|put)\s+(a|one|two|three|\d+)(?:\s+random)?\s+cards?\s+from\s+(?:their|your)\s+hand/
      .exec(normalized)?.[1],
  ) ?? (/discard|put a card from (?:their|your) hand on top/.test(normalized) ? 1 : undefined);
  const delayed = Number.isFinite(damage) && /(?:end|beginning|next turn|bloodrot)/.test(normalized);
  const impact: NonNullable<OnHitEffectView["impact"]> = {
    ...(Number.isFinite(damage) ? { damage } : {}),
    ...(delayed ? { delayedDamage: damage } : {}),
    ...(drawCards !== undefined ? { drawCards } : {}),
    ...(discardCards !== undefined ? { discardCards } : {}),
    ...(/(?:destroy|put) (?:a card|it) from (?:their|your) arsenal|destroy[^.]{0,40}arsenal/.test(normalized)
      ? { destroysArsenal: true as const }
      : {}),
    ...(/equipment/.test(normalized) ? { damagesEquipment: true as const } : {}),
    ...(/create(?:s)? (?:a |\d+ )?(?:bloodrot pox|gold|agility|might|vigor|runechant|embodiment)/.test(normalized)
      ? { createsToken: true as const }
      : {}),
    ...(/action point|resource|go again|attack an additional time/.test(normalized)
      ? { grantsTempo: true as const }
      : {}),
  };
  return Object.keys(impact).length > 0 ? impact : undefined;
}

function projectedOnHitEffects(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: Parameters<typeof pendingOnHitEffects>[2],
  viewer: number | null | undefined,
): NonNullable<ChainLinkView["onHitEffects"]> {
  return pendingOnHitEffects(state, runtime, link).flatMap((effect) => {
    if (effect.kind === "hook") {
      return effect.rulesCardIds.map((cardId) => {
        const text = printedOnHitText(state, cardId);
        const impact = projectedOnHitImpact(text);
        return {
          sourceCardId: cardId,
          text,
          ...(impact ? { impact } : {}),
        };
      });
    }
    const source = findCardAnywhere(state, effect.modifier.sourceInstanceId);
    const secret = !source || (
      viewer !== undefined && !!source.card.faceDown && source.card.owner !== viewer
    );
    const text = grantedOnHitText(state, effect.modifier);
    const impact = projectedOnHitImpact(text);
    return [{
      sourceCardId: secret ? "" : source.card.cardId,
      text,
      ...(impact ? { impact } : {}),
    }];
  });
}

function projectedCombatValueModifiers(
  state: GameStateInternal,
  modifiers: readonly CombatValueModifier[],
  viewer: number | null,
  revealAll: boolean,
): CombatValueModifierView[] {
  return modifiers.map((modifier) => {
    const source = findCardAnywhere(state, modifier.sourceInstanceId);
    const hidden = !revealAll && !!source?.card.faceDown && source.card.owner !== viewer;
    return {
      sourceCardId: hidden ? "" : modifier.sourceCardId,
      amount: modifier.amount,
    };
  });
}

/** Total remaining prevention already established for the active attack.
 * Optional prevention that has not been chosen yet (Quell, discard
 * replacements, and similar) is excluded; Ward is mandatory and included. */
function projectedCombatPrevention(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: GameStateInternal["chain"][number],
  calculatedDamage: number,
): { amount: number; modifiers: CombatValueModifier[] } | undefined {
  if (link.resolved || link.targetAllyId !== undefined) return undefined;
  const pendingPacket = state.pendingDecision?.arcane?.combat === true &&
    state.pendingDecision.arcane.sourceInstanceId === link.attackingCard.instanceId
    ? state.pendingDecision.arcane
    : undefined;
  if (pendingPacket?.unpreventable || link.flags.unpreventable === true) return undefined;
  const eventAmount = Math.max(0, pendingPacket?.amount ?? calculatedDamage);
  const targetSeat = pendingPacket?.targetSeat ?? (link.attacker === 0 ? 1 : 0);
  const target = state.players[targetSeat] as PlayerState;
  const source = findCardAnywhere(state, link.attackingCard.instanceId)?.card ?? link.attackingCard;
  const activeModifiers = state.modifiers.filter((modifier) =>
    !modifier.consumed &&
    modifier.scope === "until-end-of-turn" &&
    modifier.seat === targetSeat
  );
  const contributions: CombatValueModifier[] = [];
  const addContribution = (
    amount: number,
    origin?: { sourceInstanceId: number; sourceCardId?: string },
  ): void => {
    if (amount === 0) return;
    const originCardId = origin
      ? findCardAnywhere(state, origin.sourceInstanceId)?.card.cardId
      : undefined;
    contributions.push({
      sourceInstanceId: origin?.sourceInstanceId ?? -1,
      sourceCardId: origin?.sourceCardId ?? originCardId ?? "",
      amount,
    });
  };
  const addTrackedPool = (amount: number, appliesToInstanceId?: number): void => {
    let remaining = Math.max(0, amount);
    for (const modifier of activeModifiers) {
      if (
        remaining <= 0 ||
        modifier.appliesToInstanceId !== appliesToInstanceId ||
        Number(modifier.preventNextDamagePool ?? 0) <= 0
      ) continue;
      const contribution = Math.min(remaining, Number(modifier.preventNextDamagePool));
      addContribution(contribution, modifier);
      remaining -= contribution;
    }
    if (remaining > 0) addContribution(remaining);
  };

  const sourceShield = source.damagePrevented;
  if (sourceShield?.targetSeat === targetSeat) {
    addTrackedPool(sourceShield.amount, source.instanceId);
  }

  for (const preventionSource of controlledPermanents(state, targetSeat, {
    faceDownEquipment: false,
  })) {
    const fixed = scriptOf(
      state,
      preventionSource.cardId,
      preventionSource,
    )?.fixedDamagePrevention;
    if (
      !fixed ||
      fixed.amount <= 0 ||
      (fixed.oncePerTurn &&
        Number(preventionSource.counters?.fixedPreventionUsedTurn ?? -1) === state.turn)
    ) continue;
    addContribution(fixed.amount, {
      sourceInstanceId: preventionSource.instanceId,
      sourceCardId: preventionSource.cardId,
    });
  }

  const pitchShield = activeModifiers.find((modifier) =>
    modifier.preventNextDamageFromPitch !== undefined &&
    cardColorOf(state, source) === modifier.preventNextDamageFromPitch
  );
  if (pitchShield) addContribution(eventAmount, pitchShield);

  const repeatingShield = activeModifiers.find((modifier) =>
    Number(modifier.preventDamagePerEvent ?? 0) > 0 &&
    Number(modifier.preventDamageEventsRemaining ?? 0) > 0
  );
  if (repeatingShield) {
    addContribution(Number(repeatingShield.preventDamagePerEvent), repeatingShield);
  }

  const sourceTypes = [
    ...(dataOf(state, source.cardId).classes ?? []),
    ...(dataOf(state, source.cardId).subtypes ?? []),
    ...(source.grantedTypes ?? []),
  ].map((type) => type.toLowerCase());
  const nextEventShield = activeModifiers.find((modifier) => {
    const requiredType = modifier.appliesToDamageSourceType?.toLowerCase();
    return Number(modifier.preventNextDamageAmount ?? 0) > 0 &&
      (modifier.maxDamageEventAmount === undefined || eventAmount <= modifier.maxDamageEventAmount) &&
      (requiredType === undefined || sourceTypes.includes(requiredType));
  });
  if (nextEventShield) {
    addContribution(Number(nextEventShield.preventNextDamageAmount), nextEventShield);
  }

  addContribution(Number(target.flags.preventNextPhysicalDamage ?? 0));
  addTrackedPool(Number(target.flags.preventNextDamage ?? 0));
  for (const ward of wardPieces(state, runtime, target)) {
    const wardSource = findCardAnywhere(state, ward.id)?.card;
    addContribution(ward.n, {
      sourceInstanceId: ward.id,
      sourceCardId: wardSource?.cardId,
    });
  }

  let amount = contributions.reduce((total, modifier) => total + modifier.amount, 0);
  if (amount > 0 && Number(target.flags.nextPhysicalPreventionReduction ?? 0) > 0) {
    addContribution(-1);
    amount -= 1;
  }
  return amount > 0 ? { amount, modifiers: contributions } : undefined;
}

function projectedStackContext(state: GameStateInternal): string | undefined {
  const attackOnStack = state.stackResume === "continue-attack";
  if (state.stackResume === "finish-link-resolution") {
    if (currentLink(state)?.flags.resolutionStepBegan === true) {
      return "RESOLUTION STEP · EFFECTS";
    }
    if (state.stack.length === 0) return "DAMAGE STEP · PRIORITY";
    const hasOnHitLayer = state.stack.some((layer) =>
      layer.engineEffect?.kind === "on-hit-hook" ||
      layer.engineEffect?.kind === "on-hit-modifier"
    );
    return hasOnHitLayer
      ? "DAMAGE STEP · ON-HIT TRIGGERS"
      : "DAMAGE STEP · EFFECTS";
  }
  if (state.stack.length === 0 && !attackOnStack) return undefined;
  if (attackOnStack) return "LAYER STEP · ATTACK";
  if (state.phase === "reaction") return "REACTION STEP · REACTIONS";
  if (state.stackResume === "start-reaction-step") return "DEFEND STEP · TRIGGERS";
  if (state.stackResume === "end-phase") return "END PHASE · TRIGGERS";
  if (state.stackResume === "begin-action-phase") return "START PHASE · START-OF-TURN TRIGGERS";
  if (state.stackResume === "grant-turn-action") return "ACTION PHASE · BEGINNING TRIGGERS";
  return "ACTION PHASE · EFFECTS";
}

function nextPlayDurationLabel(m: Modifier): string {
  const colors: Record<number, string> = { 1: "red", 2: "yellow", 3: "blue" };
  const qualifiers = [
    m.appliesToPitch === undefined ? undefined : colors[m.appliesToPitch],
    m.appliesToCardType,
  ].filter((value): value is string => value !== undefined);
  return qualifiers.length > 0
    ? `next ${qualifiers.join(" ")} card`
    : "next matching play";
}

/** Lingering (invisible) effects worth surfacing on the mat, grouped by source
 *  card. The source's identity follows the usual face-down secrecy rules. */
function ongoingEffects(state: GameStateInternal, viewer: number | null | undefined): OngoingEffectView[] {
  const byKey = new Map<string, OngoingEffectView>();
  const add = (key: string, effect: OngoingEffectView): void => {
    const entry = byKey.get(key);
    if (entry) entry.label += `, ${effect.label}`;
    else byKey.set(key, effect);
  };
  for (const m of state.modifiers) {
    if (m.consumed) continue;
    const surfacedCombatChainCost = m.scope === "combat-chain" &&
      (m.playCostReduction !== undefined || m.activationCostReduction !== undefined);
    if (!surfacedCombatChainCost &&
      m.scope !== "next-attack" && m.scope !== "next-play" && m.scope !== "until-end-of-turn") continue;
    const src = findCardAnywhere(state, m.sourceInstanceId);
    const secret = viewer !== undefined && !!src?.card.faceDown && src.card.owner !== viewer;
    const cardId = src
      ? (secret ? "" : src.card.cardId)
      : (m.sourceCardId ?? "");
    const key = `${m.sourceInstanceId}:${m.seat}:${m.scope}`;
    const duration = m.scope === "next-attack"
      ? (m.appliesToRuneGated ? "next rune-gated attack" : "next attack")
      : m.scope === "next-play"
        ? nextPlayDurationLabel(m)
        : m.scope === "combat-chain"
          ? "this combat chain"
        : m.expiresAtEndOfSeatTurn !== undefined
          ? (m.expiresAtEndOfSeatTurn === state.activePlayer && Number(m.createdTurn ?? -1) < state.turn
              ? "this turn"
              : "next turn")
          : "this turn";
    const label = `${modifierEffectLabel(state, m)} · ${duration}`;
    add(key, { seat: m.seat, cardId, label });
  }

  // Several delayed Crush effects are rules state on the affected hero rather
  // than modifiers. Surface those on that hero's mat as public, source-neutral
  // chips so an opponent's restriction is not incorrectly shown as the
  // attacker's buff. The counter remains the rules authority and controls the
  // lifetime; this projection adds no new mutable state.
  for (const player of state.players as PlayerState[]) {
    const counters = player.hero.counters;
    const heroKey = `hero:${player.hero.instanceId}`;
    const addHeroEffect = (key: string, label: string): void =>
      add(`${heroKey}:${key}`, { seat: player.seat, cardId: "", label });
    const addArcaneBonusPool = (
      flagKey: string,
      sourcePrefix: string,
      effectKey: string,
      labelSuffix: string,
    ): void => {
      let untrackedArcaneBonus = Number(player.flags[flagKey] ?? 0);
      if (untrackedArcaneBonus <= 0) return;
      for (const [key, value] of Object.entries(player.flags)) {
        if (!key.startsWith(sourcePrefix) || typeof value !== "number" || value <= 0) continue;
        const amount = Math.min(value, untrackedArcaneBonus);
        if (amount <= 0) continue;
        const sourceInstanceId = Number(key.slice(sourcePrefix.length));
        const source = Number.isSafeInteger(sourceInstanceId)
          ? findCardAnywhere(state, sourceInstanceId)
          : undefined;
        const secret = viewer !== undefined && !!source?.card.faceDown && source.card.owner !== viewer;
        add(`${effectKey}:${sourceInstanceId}:${player.seat}`, {
          seat: player.seat,
          cardId: source ? (secret ? "" : source.card.cardId) : "",
          label: `amp ${amount} · ${labelSuffix}`,
        });
        untrackedArcaneBonus -= amount;
      }
      if (untrackedArcaneBonus > 0) {
        addHeroEffect(
          effectKey,
          `amp ${untrackedArcaneBonus} · ${labelSuffix}`,
        );
      }
    };
    addArcaneBonusPool(
      "nextArcaneBonus",
      "nextArcaneBonusSource:",
      "next-arcane-bonus",
      "next arcane damage event",
    );
    addArcaneBonusPool(
      "nextArcaneCardBonus",
      "nextArcaneCardBonusSource:",
      "next-arcane-card-bonus",
      "next arcane damage card",
    );
    if (Number(counters?.halveBaseAttackActionUntil ?? 0) >= state.turn) {
      addHeroEffect("halve-base", "attack action base attack and defense are halved · through next turn");
    }
    if (Number(counters?.attackActionBasePowerLimitUntilTurn ?? 0) >= state.turn) {
      const limit = Number(counters?.attackActionBasePowerLimit ?? 0);
      addHeroEffect("base-power-limit", `can't play attack actions with base attack ${limit} or less · next action phase`);
    }
    if (Number(counters?.attackActionNoPowerGainUntilTurn ?? 0) >= state.turn) {
      addHeroEffect("no-power-gain", "attack action cards can't gain attack · next action phase");
    }
    if (Number(counters?.cannotDrawActionTurn ?? 0) >= state.turn) {
      addHeroEffect("cannot-draw", "can't draw cards · next action phase");
    }
    const nextActionExtraCost = Number(player.flags.nextActionExtraCost ?? 0);
    if (nextActionExtraCost > 0) {
      addHeroEffect("next-action-cost", `next action costs +${nextActionExtraCost} resource`);
    }
    const trackedGenericPrevention = state.modifiers.reduce(
      (total, modifier) => total + (
        !modifier.consumed &&
        modifier.seat === player.seat &&
        modifier.scope === "until-end-of-turn" &&
        modifier.appliesToInstanceId === undefined
          ? Number(modifier.preventNextDamagePool ?? 0)
          : 0
      ),
      0,
    );
    const untrackedGenericPrevention = Math.max(
      0,
      Number(player.flags.preventNextDamage ?? 0) - trackedGenericPrevention,
    );
    if (untrackedGenericPrevention > 0) {
      addHeroEffect(
        "prevent-next-damage",
        `prevent next ${untrackedGenericPrevention} damage · this turn`,
      );
    }
    const arcanePrevention = Number(player.flags.preventNextArcaneDamage ?? 0);
    if (arcanePrevention > 0) {
      addHeroEffect("prevent-next-arcane", `prevent next ${arcanePrevention} arcane damage · this turn`);
    }
    const physicalPrevention = Number(player.flags.preventNextPhysicalDamage ?? 0);
    if (physicalPrevention > 0) {
      addHeroEffect("prevent-next-physical", `prevent next ${physicalPrevention} physical damage · this turn`);
    }
  }

  // Backward-compatible projection for source-filtered prevention created by
  // older persisted states, before source-aware modifier records were added.
  const seenSources = new Set<number>();
  const sourceCards = [
    ...state.players.flatMap((player) => [
      player.hero,
      ...player.hand,
      ...player.deck,
      ...player.arsenal,
      ...player.pitch,
      ...player.graveyard,
      ...player.banish,
      ...player.soul,
      ...(player.inventory ?? []),
      ...player.board,
      ...player.weapons,
      ...Object.values(player.equipment).filter((card): card is CardInstance => card !== undefined),
    ]),
    ...state.chain.flatMap((link) => [
      link.attackingCard,
      ...link.defendingCards,
      ...link.defendingEquipment,
      ...link.reactions,
    ]),
    ...state.resolving,
    ...state.stack.flatMap((layer) => [layer.card, layer.abilityCard].filter(
      (card): card is CardInstance => card !== undefined,
    )),
  ];
  for (const source of sourceCards) {
    if (seenSources.has(source.instanceId)) continue;
    seenSources.add(source.instanceId);
    const prevention = source.damagePrevented;
    if (!prevention || prevention.amount <= 0) continue;
    const tracked = state.modifiers.some((modifier) =>
      !modifier.consumed &&
      modifier.seat === prevention.targetSeat &&
      modifier.appliesToInstanceId === source.instanceId &&
      Number(modifier.preventNextDamagePool ?? 0) > 0
    );
    if (tracked) continue;
    add(
      `legacy-source-prevention:${source.instanceId}:${prevention.targetSeat}`,
      {
        seat: prevention.targetSeat,
        cardId: "",
        label: `prevent next ${prevention.amount} damage from ${dataOf(state, source.cardId).name} · this turn`,
      },
    );
  }
  return [...byKey.values()];
}

/** Per-player projection: full info for own zones, hidden info as counts.
 *  `seat` is the viewer's seat; `null` is a spectator (everything hidden). */
export function projectStateFor(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number | null,
  publicGameId = "game",
): GameView {
  return projectState(state, runtime, seat, publicGameId, false);
}

/** Full-information projection for a completed-game replay. It may be
 * persisted while play is active, but must not be exposed until game-over. It
 * reveals both players' hidden zones while omitting live action capabilities
 * and the private RNG seed. */
export function projectStateForReplay(
  state: GameStateInternal,
  runtime: EngineRuntime,
  publicGameId = "game",
): GameView {
  return projectState(state, runtime, null, publicGameId, true);
}

/** Project the authoritative stack one-for-one. Counted server layers expose
 * their remaining occurrence count directly; the client does no grouping. */
function projectedStackLayers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number | null,
  revealAll: boolean,
): StackLayerView[] {
  return state.stack.map((layer) => {
    // Card layers carry their card; trigger layers point at a source in a zone.
    // A face-down source remains secret to an opposing viewer.
    const card = layer.card ??
      findCardAnywhere(state, layer.sourceInstanceId)?.card ??
      layer.triggerSource ??
      null;
    const secret = !revealAll && !layer.card && !!card?.faceDown && card.owner !== seat;
    return {
      card: card && !secret ? cardView(state, runtime, card) : null,
      seat: layer.seat,
      label: layer.label,
      optional: layer.optional,
      ...(layer.triggerCount !== undefined && layer.triggerCount > 1
        ? { count: layer.triggerCount }
        : {}),
    };
  });
}

function projectState(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number | null,
  publicGameId: string,
  revealAll: boolean,
): GameView {
  // while the attack-declared stack machine runs (triggers + priority window),
  // the newest link is still "on the stack": the UI shows it in the stack
  // window instead of as a combat chain link
  const attackOnStack = state.stackResume === "continue-attack";
  const lastLink = state.chain.length - 1;
  const chain = state.chain.map((link, i): ChainLinkView => {
    const attack =
      link.resolved && link.finalAttack !== undefined
        ? link.finalAttack
        : computeAttack(state, runtime, link);
    const defense =
      link.resolved && link.finalDefense !== undefined
        ? link.finalDefense
        : computeDefense(state, runtime, link);
    const onHitEffects = projectedOnHitEffects(state, runtime, link, revealAll ? undefined : seat);
    const damage = Math.max(0, attack - defense);
    const prevention = i === lastLink
      ? projectedCombatPrevention(state, runtime, link, damage)
      : undefined;
    return {
      attackingCard: {
        ...cardView(state, runtime, link.attackingCard),
        attack,
      },
      defendingCards: [
        ...link.defendingCards.map((c) => cardView(state, runtime, c)),
        ...link.defendingEquipment.map((c) => cardView(state, runtime, c)),
      ],
      attackValue: attack,
      defenseValue: defense,
      attackModifiers: projectedCombatValueModifiers(
        state,
        link.resolved
          ? (link.finalAttackModifiers ?? attackValueModifiers(state, runtime, link))
          : attackValueModifiers(state, runtime, link),
        seat,
        revealAll,
      ),
      defenseModifiers: projectedCombatValueModifiers(
        state,
        link.resolved
          ? (link.finalDefenseModifiers ?? defenseValueModifiers(state, runtime, link))
          : defenseValueModifiers(state, runtime, link),
        seat,
        revealAll,
      ),
      ...(onHitEffects.length > 0 ? { onHitEffects } : {}),
      ...(prevention !== undefined
        ? {
            damageToPrevent: prevention.amount,
            preventionModifiers: projectedCombatValueModifiers(
              state,
              prevention.modifiers,
              seat,
              revealAll,
            ),
          }
        : {}),
      damage,
      resolved: link.resolved,
      hit: link.hit,
      // Go again persists on the link; granted defense-restriction keywords
      // are snapshotted before chain-link modifiers expire.
      goAgain: link.goAgain || conditionalModifierGrantsGoAgain(state, link),
      wagered: link.flags.wagered === true,
      ...(link.wagerRewards?.length ? { wagerRewards: [...link.wagerRewards] } : {}),
      dominate: link.resolved
        ? link.flags.dominateAtResolution === true
        : attackHasDominate(state, link),
      overpower: link.resolved
        ? link.flags.overpowerAtResolution === true
        : attackHasOverpower(state, link),
      reactions: [
        ...link.reactions,
        ...(link.resolvedReactionAbilitySources ?? []),
      ].map((c) => cardView(state, runtime, c)),
      ...(attackOnStack && i === lastLink && !link.resolved ? { onStack: true } : {}),
      ...(link.targetAllyId !== undefined
        ? (() => {
            const target = findCardAnywhere(state, link.targetAllyId!);
            return target
              ? {
                  targetAllyName: dataOf(state, target.card.cardId).name,
                  targetAlly: cardView(state, runtime, target.card),
                }
              : { targetAllyName: "a permanent" };
          })()
        : {}),
      };
  });
  const stackContext = projectedStackContext(state);
  const turnFacts: TurnFactsView = {
    players: state.players.map((player) => ({
      attacks: Number(player.flags.attacksDeclaredThisTurn) || 0,
      weaponAttacks: Number(player.flags.weaponAttackCount) || 0,
      playedSubtypes: Object.keys(player.flags)
        .filter((flag) => flag.startsWith("playedSubtype:") && player.flags[flag] === true)
        .map((flag) => flag.slice("playedSubtype:".length))
        .sort(),
      usedOncePerTurnEffectSourceIds: Object.keys(player.flags)
        .filter((flag) => flag.startsWith(ONCE_PER_TURN_EFFECT_FLAG_PREFIX) && player.flags[flag] === true)
        .map((flag) => Number(flag.slice(ONCE_PER_TURN_EFFECT_FLAG_PREFIX.length)))
        .filter(Number.isSafeInteger)
        .sort((a, b) => a - b),
      dealtDamage: player.flags.dealtDamageThisTurn === true,
      physicalDamageDealt: player.flags.physicalDamageDealtThisTurn === true,
      arcaneDamageDealt: player.flags.arcaneDamageDealtThisTurn === true,
      damageTaken: player.flags.damageTakenThisTurn === true,
      physicalDamageTaken: player.flags.physicalDamageTakenThisTurn === true,
      arcaneDamageTaken: player.flags.arcaneDamageTakenThisTurn === true,
    })) as TurnFactsView["players"],
  };
  return {
    // The RNG seed is private server state. Publishing it lets a client
    // reconstruct every future shuffle/random choice in a deterministic game.
    gameId: publicGameId,
    turn: state.turn,
    phase: state.phase,
    activePlayer: state.activePlayer,
    priorityPlayer: state.priorityPlayer,
    ...(state.phase === "layer" &&
      state.stackResume === "end-action-phase" &&
      state.stackPasses === 1
      ? { endTurnPassPending: true as const }
      : {}),
    players: [
      playerView(state, runtime, state.players[0] as PlayerState, seat === 0, revealAll),
      playerView(state, runtime, state.players[1] as PlayerState, seat === 1, revealAll),
    ],
    chain,
    stack: projectedStackLayers(state, runtime, seat, revealAll),
    ...(stackContext ? { stackContext } : {}),
    ongoing: ongoingEffects(state, revealAll ? undefined : seat),
    gameStats: state.gameStats,
    turnFacts,
    pendingDecision: state.pendingDecision
      ? (() => {
          const pd = state.pendingDecision!;
          // staged (uncommitted) defenders: the defender sees the real cards
          // and the live defense total; everyone else sees hand cards
          // face-down (staged equipment stays public) and a 0 total
          let staged: { stagedCards: CardView[]; stagedDefense: number } | undefined;
          if (pd.kind === "defend" && pd.staged && pd.staged.length > 0) {
            const defender = state.players[pd.player] as PlayerState;
            const mine = revealAll || pd.player === seat;
            const cards: CardView[] = [];
            const stagedInstances: CardInstance[] = [];
            for (const id of pd.staged) {
              const hc = defender.hand.find((c) => c.instanceId === id);
              const ac = defender.arsenal.find((c) => c.instanceId === id);
              const ec = Object.values(defender.equipment).find((c) => c?.instanceId === id);
              const wc = defender.weapons.find((c) => c.instanceId === id);
              const hero = defender.hero.instanceId === id ? defender.hero : undefined;
              const c = hc ?? ac ?? ec ?? wc ?? hero;
              if (!c) continue;
              stagedInstances.push(c);
              if (mine) {
                cards.push(cardView(state, runtime, c));
              } else {
                const hidden = hc !== undefined || (ac?.faceDown ?? false);
                cards.push(hidden ? hiddenView(c, -(cards.length + 1)) : cardView(state, runtime, c));
              }
            }
            const link = currentLink(state);
            const total = mine && link ? stagedDefenseTotal(state, runtime, link, stagedInstances) : 0;
            staged = { stagedCards: cards, stagedDefense: mine ? total : 0 };
          }
          const privateDecision = revealAll || pd.player === seat;
          const preStackFlow = pd.variablePlayCost
            ? {
                instanceId: pd.variablePlayCost.instanceId,
                zone: pd.variablePlayCost.from,
              }
            : pd.resume?.kind === "finish-play"
              || pd.resume?.kind === "finish-reaction"
              || pd.resume?.kind === "finish-window-instant"
              ? {
                  instanceId: pd.resume.card.instanceId,
                  zone: pd.resume.from,
                }
              : undefined;
          const preStackCard = preStackFlow
            ? findCardAnywhere(state, preStackFlow.instanceId)?.card
            : undefined;
          return {
            player: pd.player,
            kind: pd.kind,
            // prompts can name a face-down card; only the deciding player may see
            // them. For priority windows the prompt is rebuilt per viewer.
            prompt:
              pd.kind === "priority-window"
                ? windowPrompt(state, revealAll ? pd.player : seat)
                : revealAll || pd.player === seat
                  ? pd.prompt
                  : "",
            ...((revealAll || pd.player === seat) && pd.options ? { options: pd.options } : {}),
            ...((revealAll || pd.player === seat) && pd.defaultOption
              ? { defaultOption: pd.defaultOption }
              : {}),
            ...((revealAll || pd.player === seat) && pd.optionLabels ? { optionLabels: pd.optionLabels } : {}),
            ...((revealAll || pd.player === seat) && pd.optionCounts ? { optionCounts: pd.optionCounts } : {}),
            ...((revealAll || pd.player === seat) && pd.cardOptions
              ? {
                  // Decision capabilities and resolved cards are emitted only
                  // to the deciding player. Counts, ids, and literal trigger
                  // labels can all reveal private state to other viewers.
                  optionCards: pd.cardOptions.map((id, index) =>
                    id === null
                      ? null
                      : typeof id === "string"
                        ? definitionOptionCardView(state, runtime, id, pd.player, index)
                        : optionCardView(state, runtime, id),
                  ),
                }
              : {}),
            ...((revealAll || pd.player === seat) && pd.lookedCardIds
              ? {
                  // look-at floats are private, exactly like optionCards
                  lookedCards: pd.lookedCardIds.flatMap((id) => {
                    const card = optionCardView(state, runtime, id);
                    return card ? [card] : [];
                  }),
                }
              : {}),
            ...(pd.revealedCardIds
              ? {
                  // These identities were explicitly made public by the
                  // resolving effect, so every viewer sees the full group.
                  revealedCards: pd.revealedCardIds.flatMap((id) => {
                    const card = optionCardView(state, runtime, id);
                    return card ? [card] : [];
                  }),
                }
              : {}),
            ...((revealAll || pd.player === seat) && pd.resourcePayment
              ? { resourcePayment: pd.resourcePayment }
              : {}),
            ...(privateDecision && preStackFlow && preStackCard
              ? {
                  preStackSource: {
                    card: cardView(state, runtime, preStackCard),
                    zone: preStackFlow.zone,
                  },
                }
              : {}),
            ...staged,
          };
        })()
      : null,
    winner: state.winner,
    log: state.log.flatMap((entry) => {
      const text = seat === null || revealAll
        ? entry.publicText
        : (entry.seatText?.[seat] ?? entry.publicText);
      return text === null ? [] : [text];
    }),
  };
}
