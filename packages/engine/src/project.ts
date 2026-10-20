import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type {
  CardView,
  ChainAdditionalTargetView,
  ChainLinkView,
  CombatValueModifierView,
  DefenderDefenseView,
  EquipmentSlot,
  GameLogViewEntry,
  GameMessage,
  GameView,
  OnHitEffectView,
  PendingDecision,
  PlayableZone,
  PlayerView,
  StackLayerView,
  TurnFactsView,
} from "@fyendal/shared";
import type { CardInstance, CombatValueModifier, Modifier, PendingDecisionState, PlayerState } from "./state.js";
import { arsenalCapacity, arsenalZoneCount } from "./cardLifecycle.js";
import { attackHasVeil, cardColorOf, cardTypesOf, dataOf, instanceDataOf, scriptOf } from "./cardProperties.js";
import { pendingOnHitEffects } from "./hits.js";
import {
  conditionalModifierGrantsGoAgain,
  conditionalScriptGrantsGoAgain,
} from "./combatModifiers.js";
import {
  attackHasDominate,
  attackMaxNonBlockDefenders,
  attackHasOverpower,
  attackValueModifiers,
  computeAttack,
  computeCombatDamage,
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
import { additionalTargetsAroundPrimary, currentLink, findCardAnywhere } from "./zoneQueries.js";
import { queuedAttackObjects } from "./attackQueue.js";
import { controlledPermanents } from "./sourceQueries.js";
import { activatedAbilityUsage } from "./abilityRules.js";
import { legalDefenderCards } from "./defense.js";
import { wardPieces } from "./damageResolution.js";
import { playFromSourceCardId } from "./playRules.js";
import { windowPrompt, windowPromptMessage } from "./triggers.js";
import { triggerLabelMessage } from "./triggerPresentation.js";
import { projectOngoingEffects } from "./ongoingEffects.js";

function projectedLog(
  state: GameStateInternal,
  seat: number | null,
  revealAll: boolean,
): { log: string[]; logEntries?: GameLogViewEntry[] } {
  const entries = state.log.flatMap((entry) => {
    const publicAudience = seat === null || revealAll;
    const seatText = publicAudience ? undefined : entry.seatText?.[seat];
    const usesSeatOverride = seatText !== undefined && seatText !== null;
    const text = publicAudience
      ? entry.publicText
      : usesSeatOverride
        ? seatText
        : entry.publicText;
    if (text === null) return [];

    const payload = publicAudience
      ? entry.publicPayload
      : usesSeatOverride
        ? entry.seatPayloads?.[seat]
        : entry.publicPayload;
    return [{ text, payload, sequence: entry.sequence }];
  });
  const log = entries.map((entry) => entry.text);
  if (!entries.some((entry) => entry.payload && entry.sequence !== undefined)) return { log };
  return {
    log,
    logEntries: entries.map((entry): GameLogViewEntry =>
      entry.payload && entry.sequence !== undefined
        ? { ...entry.payload, fallback: entry.text, sequence: entry.sequence }
        : { fallback: entry.text }
    ),
  };
}

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
  grantedAuraAttack = false,
): string[] | undefined {
  if (abilities.length + (grantedAuraAttack ? 1 : 0) <= 1) return undefined;
  return [
    ...abilities.map(
      (ability, index) => ability.label ?? (ability.isAttack ? "Attack" : `Ability ${index + 1}`),
    ),
    ...(grantedAuraAttack ? ["Attack with this aura"] : []),
  ];
}

/** Engine statuses kept in script state that every player may see. All other
 * script state is private implementation detail and never projected. */
function isPublicStatusKey(key: string): boolean {
  return key === "marked" || key === "attacked" || key === "arcaneBonus" || key === "sharpenedTurn" ||
    key === "fused" || key === "fusedEarth" || key === "fusedIce" ||
    key.startsWith("fused:") || key.startsWith("frostZone:");
}

/** A card's rules counters plus its public statuses, as `CardView.counters`. */
function publicCounters(card: CardInstance): Record<string, number> | undefined {
  const projected: Record<string, number> = { ...card.counters };
  for (const [key, value] of Object.entries(card.scriptState ?? {})) {
    if (isPublicStatusKey(key)) projected[key] = value;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

/** Cards outside the arena carry no counters and no arena statuses. */
const INACTIVE_ZONE: CardViewOptions = { includeCounters: false };

function cardView(state: GameStateInternal,
  runtime: EngineRuntime, c: CardInstance, opts: CardViewOptions = {}): CardView {
  const d = instanceDataOf(state, c);
  const includeCounters = opts.includeCounters ?? true;
  const includeLife = opts.includeLife ?? true;
  const power = includeCounters ? (c.counters?.power ?? 0) : 0;
  const counters = includeCounters ? publicCounters(c) : undefined;
  const controller = opts.controller;
  const abilities = abilityList(scriptOf(state, c.cardId, c));
  const abilityUsage = controller
    ? abilities.map((ability, index) =>
        activatedAbilityUsage(controller, c.instanceId, index, ability))
    : [];
  const remainingAbilityActivations = abilityUsage.map((usage) =>
    usage !== undefined && usage.total > 1 ? usage.remaining : 0);
  const hasRemainingMultipleActivation = remainingAbilityActivations.some((remaining) => remaining > 0);
  const nativeUsedAbilityIndexes = controller
    ? abilityUsage.flatMap((usage, index) => usage?.remaining === 0 ? [index] : [])
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
  const activatedAbilityLabels = projectedAbilityLabels(abilities, grantedAuraAttackIndex !== undefined);
  const attackAbilityIndexes = abilities.flatMap((ability, index) =>
    ability.isAttack ? [index] : []);
  if (grantedAuraAttackIndex !== undefined) attackAbilityIndexes.push(grantedAuraAttackIndex);
  const usedAbilityIndexes = grantedAuraAttackIndex !== undefined &&
    controller?.flags[activatedFlagKey(c.instanceId, grantedAuraAttackIndex)] === true
      ? [...nativeUsedAbilityIndexes, grantedAuraAttackIndex]
      : nativeUsedAbilityIndexes;
  const playableFromSource = opts.playableFrom
    ? playFromSourceCardId(state, runtime, c, opts.playableFrom.zone, opts.playableFrom.actingSeat)
    : undefined;
  return {
    instanceId: c.instanceId,
    // A transcended card always shows its active back face (CR 9.1.5b).
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
    ...(c.arsenalSlot !== undefined ? { arsenalSlot: c.arsenalSlot } : {}),
    ...(c.intimidated ? { intimidated: true } : {}),
    ...(c.tapped ? { tapped: true } : {}),
    ...(includeCounters && c.defCounters ? { defCounters: c.defCounters } : {}),
    ...(counters ? { counters } : {}),
    ...(playableFromSource ? { playableFromSourceCardId: playableFromSource } : {}),
    ...(usedAbilityIndexes.length > 0 ? { usedAbilityIndexes } : {}),
    ...(hasRemainingMultipleActivation ? { remainingAbilityActivations } : {}),
    ...(activatedAbilityLabels ? { activatedAbilityLabels } : {}),
    ...(attackAbilityIndexes.length > 0 ? { attackAbilityIndexes } : {}),
    ...(c.grantedNames && c.grantedNames.length > 0 ? { grantedNames: c.grantedNames } : {}),
    ...(c.chosenName ? { chosenName: c.chosenName } : {}),
    ...(c.boundToInstanceId !== undefined ? { boundToInstanceId: c.boundToInstanceId } : {}),
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

/** A selectable option card. Another player's face-down card, such as an
 * opponent's face-down arsenal card, is offered as an opaque card back unless
 * the decision itself shows it to the decider (a search or a public reveal). */
function selectableOptionCardView(
  state: GameStateInternal,
  runtime: EngineRuntime,
  pd: PendingDecisionState,
  instanceId: number,
  optionIndex: number,
  revealAll: boolean,
): CardView | null {
  const card = findCardAnywhere(state, instanceId)?.card;
  if (
    !revealAll && card?.faceDown && card.owner !== pd.player &&
    !pd.lookedCardIds?.includes(instanceId) && !pd.revealedCardIds?.includes(instanceId)
  ) {
    return hiddenView(card, -(optionIndex + 1));
  }
  return optionCardView(state, runtime, instanceId);
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
  viewerSeat: number | null = null,
): PlayerView {
  const gameOver = state.phase === "game-over";
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
  const heroAbilities = abilityList(heroScript);
  const heroAbilityLabels = projectedAbilityLabels(heroAbilities);
  const heroAttackAbilityIndexes = heroAbilities.flatMap((ability, index) =>
    ability.isAttack ? [index] : []);
  const heroUsedAbilityIndexes = heroAbilities.flatMap((ability, index) =>
    activatedAbilityUsage(p, p.hero.instanceId, index, ability)?.remaining === 0 ? [index] : []);
  const heroSubcards = cardView(state, runtime, p.hero).subcards;
  const heroCounters = publicCounters(p.hero);
  return {
    seat: p.seat,
    heroCardId: p.heroCardId,
    heroInstanceId: p.hero.instanceId,
    ...(p.hero.tapped ? { heroTapped: true } : {}),
    ...(heroCounters ? { heroCounters } : {}),
    ...(p.hero.defCounters ? { heroDefCounters: p.hero.defCounters } : {}),
    ...(heroSubcards ? { heroSubcards } : {}),
    ...(heroAbilityLabels ? { heroAbilityLabels } : {}),
    ...(heroAttackAbilityIndexes.length > 0 ? { heroAttackAbilityIndexes } : {}),
    ...(heroUsedAbilityIndexes.length > 0 ? { heroUsedAbilityIndexes } : {}),
    heroName: dataOf(state, p.heroCardId).name,
    life: p.life,
    actionPoints: p.actionPoints,
    resources: p.resources,
    chi: p.chi,
    hand: self || gameOver || revealAll ? p.hand.map((c) => cardView(state, runtime, c, INACTIVE_ZONE)) : [],
    handCount: p.hand.length,
    deckCount: p.deck.length,
    ...(gameOver || revealAll ? { deck: p.deck.map((c) => cardView(state, runtime, c, INACTIVE_ZONE)) } : {}),
    // face-up cards (e.g. a flipped mentor) are public; face-down stay secret
    arsenal: self || gameOver || revealAll
      ? p.arsenal.map((c) => cardView(state, runtime, c, INACTIVE_ZONE))
      : p.arsenal.filter((c) => !c.faceDown).map((c) => cardView(state, runtime, c, INACTIVE_ZONE)),
    arsenalCount: p.arsenal.length,
    arsenalCapacity: arsenalCapacity(state, p.seat),
    arsenalZones: arsenalZoneCount(state, p.seat),
    pitch: p.pitch.map((c) => cardView(state, runtime, c, INACTIVE_ZONE)), // pitch zone is public
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
            ...(viewerSeat !== null && !revealAll
              ? { playableFrom: { zone: "banish", actingSeat: viewerSeat } }
              : {}),
          })
    ),
    // the soul is face-up and public
    soul: p.soul.map((c) => cardView(state, runtime, c, INACTIVE_ZONE)),
    ...(visibleDeckTop ? { visibleDeckTop: cardView(state, runtime, visibleDeckTop) } : {}),
    equipment,
    weapons: p.weapons.map((c) => cardView(state, runtime, c, { controller: p })),
    board: p.board.map((c) => cardView(state, runtime, c, { controller: p })),
  };
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
  if (modifier.onHitDealDamage) {
    effects.push(`deal ${modifier.onHitDealDamage} damage to the defending hero`);
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
  if (modifier.onHitClearHandAndArsenalAtEndPhase) {
    effects.push(
      "at the beginning of the defending hero's end phase, they discard their hand and destroy their arsenal",
    );
  }
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
      return Array.from({ length: effect.triggerCount }, () =>
        effect.rulesCardIds.map((cardId) => {
          const text = printedOnHitText(state, cardId);
          const impact = projectedOnHitImpact(text);
          return {
            sourceCardId: cardId,
            text,
            ...(impact ? { impact } : {}),
          };
        })
      ).flat();
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
  // Shields spent by targets damaged before the hero; the hero's own
  // next-damage shield is added for targets damaged after it.
  spentShields: Set<Modifier> = new Set(),
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
    !spentShields.has(modifier) &&
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
      (fixed.firstDamageEventEachTurn &&
        Number(target.flags.damageEventsThisTurn ?? 0) !== (pendingPacket ? 1 : 0)) ||
      (fixed.condition && !fixed.condition(runtime.makeCtx(state, targetSeat, preventionSource, link))) ||
      (fixed.oncePerTurn &&
        Number(preventionSource.scriptState?.fixedPreventionUsedTurn ?? -1) === state.turn)
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

  for (const repeatingShield of activeModifiers) {
    if (
      Number(repeatingShield.preventDamagePerEvent ?? 0) <= 0 ||
      Number(repeatingShield.preventDamageEventsRemaining ?? 0) <= 0
    ) continue;
    addContribution(Number(repeatingShield.preventDamagePerEvent), repeatingShield);
  }

  const sourceTypes = cardTypesOf(state, source);
  const nextEventShield = activeModifiers.find((modifier) => {
    const requiredType = modifier.appliesToDamageSourceType?.toLowerCase();
    return Number(modifier.preventNextDamageAmount ?? 0) > 0 &&
      (modifier.maxDamageEventAmount === undefined || eventAmount <= modifier.maxDamageEventAmount) &&
      (requiredType === undefined || sourceTypes.includes(requiredType));
  });
  if (nextEventShield) {
    addContribution(Number(nextEventShield.preventNextDamageAmount), nextEventShield);
    if (eventAmount > 0) spentShields.add(nextEventShield);
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

/** These additional attack-targets still in the arena, with the damage each
 * would be dealt (or was dealt, once the link resolved). Mirrors damage.ts,
 * which damages targets separately in the attacker's order (CR 7.5.2c): only
 * a recipient-type shield of the ally's controller applies, and each shield
 * is spent once. Spent shields are recorded so later targets do not count
 * them. */
function projectedAdditionalTargets(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: GameStateInternal["chain"][number],
  ids: readonly number[],
  attack: number,
  seat: number | null,
  revealAll: boolean,
  spentShields: Set<Modifier>,
): ChainAdditionalTargetView[] {
  if (ids.length === 0) return [];
  const targetSeat = link.attacker === 0 ? 1 : 0;
  const damage = link.resolved ? 0 : computeCombatDamage(state, runtime, link, attack, 0);
  return ids.flatMap((id): ChainAdditionalTargetView[] => {
    // Only allies still in the arena: one that left may now be a hidden card.
    const ally = (state.players[targetSeat] as PlayerState).board.find((card) => card.instanceId === id);
    if (!ally) return [];
    if (link.resolved) {
      const dealt = link.additionalTargetHits?.find((hit) => hit.targetAllyId === id)?.damage ?? 0;
      return [{ ally: cardView(state, runtime, ally), damage: dealt }];
    }
    const view: ChainAdditionalTargetView = { ally: cardView(state, runtime, ally), damage };
    const prevention = projectedAllyPrevention(state, link, ally, targetSeat, damage, spentShields);
    if (!prevention) return [view];
    return [{
      ...view,
      damageToPrevent: prevention.amount,
      preventionModifiers: projectedCombatValueModifiers(state, prevention.modifiers, seat, revealAll),
    }];
  });
}

/** The recipient-type shield an attack-target ally would spend (mirrors
 * dealAllyDamage), recorded as spent so later targets do not count it. */
function projectedAllyPrevention(
  state: GameStateInternal,
  link: GameStateInternal["chain"][number],
  ally: CardInstance,
  targetSeat: number,
  damage: number,
  spentShields: Set<Modifier>,
): { amount: number; modifiers: CombatValueModifier[] } | undefined {
  if (damage <= 0 || link.flags.unpreventable === true) return undefined;
  const recipientTypes = cardTypesOf(state, ally);
  const shield = state.modifiers.find((modifier) =>
    !modifier.consumed &&
    !spentShields.has(modifier) &&
    modifier.seat === targetSeat &&
    modifier.scope === "until-end-of-turn" &&
    Number(modifier.preventNextDamageAmount ?? 0) > 0 &&
    modifier.appliesToDamageRecipientType !== undefined &&
    recipientTypes.includes(modifier.appliesToDamageRecipientType.toLowerCase())
  );
  if (!shield) return undefined;
  spentShields.add(shield);
  const amount = Math.min(damage, Number(shield.preventNextDamageAmount));
  const sourceCardId = shield.sourceCardId ??
    findCardAnywhere(state, shield.sourceInstanceId)?.card.cardId ?? "";
  return { amount, modifiers: [{ sourceInstanceId: shield.sourceInstanceId, sourceCardId, amount }] };
}

function projectedStackContext(state: GameStateInternal): string | undefined {
  const link = currentLink(state);
  const attackOnStack = state.stackResume === "start-attack-step";
  const attackStepEffects = !!link && !link.resolved &&
    state.phase === "layer" &&
    (link.flags.attackStepBegan === true || state.stackResume === "continue-attack");
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
  if (state.stack.length === 0 && !attackOnStack && !attackStepEffects) return undefined;
  if (attackOnStack) return "LAYER STEP · ATTACK";
  if (attackStepEffects) return "ATTACK STEP · TRIGGERS";
  if (state.phase === "reaction") return "REACTION STEP · REACTIONS";
  if (state.stackResume === "start-reaction-step") return "DEFEND STEP · TRIGGERS";
  if (state.stackResume === "end-phase") return "END PHASE · TRIGGERS";
  if (state.stackResume === "begin-action-phase") return "START PHASE · START-OF-TURN TRIGGERS";
  if (state.stackResume === "grant-turn-action") return "ACTION PHASE · BEGINNING TRIGGERS";
  return "ACTION PHASE · EFFECTS";
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
 * their remaining occurrence count directly; the client does no grouping.
 * While new triggers are being ordered, the lower stack is parked on the
 * decision; it is still on the stack, so it remains visible beneath them. */
function projectedStackLayers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number | null,
  revealAll: boolean,
): StackLayerView[] {
  const parked = state.pendingDecision?.triggerOrder?.baseStack ?? [];
  return [...state.stack, ...parked].map((layer) => {
    // Card layers carry their card; trigger layers point at a source in a zone.
    // A face-down source remains secret to an opposing viewer.
    const card = layer.card ??
      findCardAnywhere(state, layer.sourceInstanceId)?.card ??
      layer.triggerSource ??
      null;
    const secret = !revealAll && !layer.card && !!card?.faceDown && card.owner !== seat;
    const labelMessage = secret ? undefined : triggerLabelMessage(state, layer);
    return {
      card: card && !secret ? cardView(state, runtime, card) : null,
      seat: layer.seat,
      label: layer.label,
      ...(labelMessage ? { labelMessage } : {}),
      optional: layer.optional,
      ...(layer.triggerCount !== undefined && layer.triggerCount > 1
        ? { count: layer.triggerCount }
        : {}),
    };
  });
}

/** Project only announcement continuations, never ordinary resolution choices. */
function projectedPreStackSource(
  state: GameStateInternal,
  runtime: EngineRuntime,
  pd: PendingDecisionState,
  privateDecision: boolean,
): PendingDecision["preStackSource"] {
  const activation = pd.variableActivationCost ?? pd.activationCost;
  if (activation) {
    for (const player of state.players) {
      const zones = [
        ["hero", [player.hero]], ["equipment", Object.values(player.equipment)],
        ["weapon", player.weapons], ["board", player.board],
      ] as const;
      for (const [zone, cards] of zones) {
        const card = cards.find((candidate) => candidate?.instanceId === activation.sourceInstanceId);
        if (card) return privateDecision || !card.faceDown
          ? { card: cardView(state, runtime, card), zone }
          : undefined;
      }
    }
    return undefined;
  }

  const resume = pd.resume;
  const play = pd.variablePlayCost ?? (resume?.kind === "continue-play-after-declaration"
    ? resume
    : resume?.kind === "finish-play" || resume?.kind === "finish-reaction" || resume?.kind === "finish-window-instant"
      ? { instanceId: resume.card.instanceId, from: resume.from }
      : undefined);
  const card = play ? findCardAnywhere(state, play.instanceId)?.card : undefined;
  // CR 5.1.2: the announced card is public before costs and modes are chosen,
  // even while an engine continuation retains it in its original zone.
  return play && card
    ? { card: cardView(state, runtime, { ...card, faceDown: false }), zone: play.from }
    : undefined;
}

function projectedDecisionPromptMessage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  decision: PendingDecisionState,
  viewerSeat: number | null,
): GameMessage | undefined {
  if (decision.promptMessage) return decision.promptMessage;
  if (decision.resourcePayment) {
    return {
      id: "engine.decision.payment",
      values: { cost: decision.resourcePayment.cost },
    };
  }
  if (decision.chooseHook === "engine-end-phase-pitch-order") {
    return {
      id: decision.deckBottomOrder?.ordered.length
        ? "engine.decision.deckbottom.next"
        : "engine.decision.deckbottom.first",
    };
  }
  if (
    decision.chooseHook === "engine-activation-discard" &&
    decision.sourceInstanceId !== undefined
  ) {
    const source = findCardAnywhere(state, decision.sourceInstanceId)?.card;
    if (source) {
      return {
        id: "engine.decision.activation.discard",
        values: { card: { kind: "card", cardId: source.cardId } },
      };
    }
  }
  if (
    decision.chooseHook === "engine-effect-attack-target" &&
    decision.sourceInstanceId !== undefined
  ) {
    const source = findCardAnywhere(state, decision.sourceInstanceId)?.card;
    if (source) {
      return {
        id: "engine.decision.attack.target",
        values: { card: { kind: "card", cardId: source.cardId } },
      };
    }
  }
  if (decision.chooseHook === "engine-token-replacement-player-order") {
    return { id: "engine.decision.token.playerorder" };
  }
  if (decision.chooseHook === "engine-token-replacement-order" && decision.tokenCreationReplacementOrder) {
    return {
      id: "engine.decision.token.next",
      values: { card: { kind: "card", cardId: decision.tokenCreationReplacementOrder.cardId } },
    };
  }
  if (decision.chooseHook === "engine-wager-loss-replacement-order") {
    return { id: "engine.decision.wager.next" };
  }
  if (decision.kind === "priority-window") {
    return windowPromptMessage(state, viewerSeat);
  }
  if (decision.kind === "attack-reaction" || decision.kind === "defense-reaction") {
    const card = state.stack[0]?.card;
    return {
      id: decision.kind === "attack-reaction"
        ? card
          ? "engine.decision.reaction.attack.card"
          : "engine.decision.reaction.attack"
        : card
          ? "engine.decision.reaction.defense.card"
          : "engine.decision.reaction.defense",
      ...(card
        ? { values: { card: { kind: "card" as const, cardId: card.cardId } } }
        : {}),
    };
  }
  if (decision.kind === "defend") {
    const link = currentLink(state);
    if (!link) return undefined;
    return {
      id: "engine.decision.defend",
      values: {
        card: { kind: "card", cardId: link.attackingCard.cardId },
        attack: computeAttack(state, runtime, link),
      },
    };
  }
  if (decision.kind === "arsenal") {
    return { id: "engine.decision.arsenal" };
  }
  if (decision.kind === "order-triggers") {
    return { id: "engine.decision.triggers.order" };
  }
  return undefined;
}

function projectState(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number | null,
  publicGameId: string,
  revealAll: boolean,
): GameView {
  // Until the attack-layer resolves, the newest link is presented on the
  // stack. Attack-step triggers run after it has become attacking.
  const attackOnStack = state.stackResume === "start-attack-step";
  const lastLink = state.chain.length - 1;
  const defendingCardIds = new Set(state.chain.flatMap((link) => [
    ...link.defendingCards.map((card) => card.instanceId),
    ...link.defendingEquipment.map((card) => card.instanceId),
  ]));
  const chain = state.chain.map((link, i): ChainLinkView => {
    const defendingCardView = (card: CardInstance): CardView => {
      const projected = cardView(state, runtime, card);
      const baseOverride = link.flags[`baseDefense:${card.instanceId}`];
      return typeof baseOverride === "number"
        ? { ...projected, defense: Math.max(0, baseOverride - (card.defCounters ?? 0)) }
        : projected;
    };
    const attack =
      link.resolved && link.finalAttack !== undefined
        ? link.finalAttack
        : computeAttack(state, runtime, link);
    const defense =
      link.resolved && link.finalDefense !== undefined
        ? link.finalDefense
        : computeDefense(state, runtime, link);
    const onHitEffects = projectedOnHitEffects(state, runtime, link, revealAll ? undefined : seat);
    const damage = link.resolved
      ? link.damage
      : computeCombatDamage(state, runtime, link, attack, defense);
    // Targets are damaged in the attacker's order (or primary first until
    // it is chosen), each spending the shields it uses before the next.
    const { before, after } = additionalTargetsAroundPrimary(state, link);
    const spentShields = new Set<Modifier>();
    const targetsBefore = projectedAdditionalTargets(
      state, runtime, link, before, attack, seat, revealAll, spentShields,
    );
    const targetSeat = link.attacker === 0 ? 1 : 0;
    const primaryAlly = (state.players[targetSeat] as PlayerState).board
      .find((card) => card.instanceId === link.targetAllyId);
    const prevention = i !== lastLink || link.resolved
      ? undefined
      : primaryAlly
        ? projectedAllyPrevention(state, link, primaryAlly, targetSeat, damage, spentShields)
        : projectedCombatPrevention(state, runtime, link, damage, spentShields);
    const additionalTargets = [
      ...targetsBefore,
      ...projectedAdditionalTargets(state, runtime, link, after, attack, seat, revealAll, spentShields),
    ];
    const maxNonBlockDefenders = link.resolved
      ? undefined
      : attackMaxNonBlockDefenders(state, link);
    return {
      // Per-turn usage of the attacking card's own abilities is public combat
      // information, exactly as it is for permanents in the arena.
      attackingCard: {
        ...cardView(state, runtime, link.attackingCard, { controller: state.players[link.attacker] }),
        attack,
      },
      defendingCards: [
        ...link.defendingCards.map(defendingCardView),
        ...link.defendingEquipment.map(defendingCardView),
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
      goAgain: link.goAgain ||
        (!link.resolved && (
          conditionalModifierGrantsGoAgain(state, link, attack) ||
          conditionalScriptGrantsGoAgain(state, runtime, link)
        )),
      wagered: link.flags.wagered === true,
      ...(link.wagerRewards?.length ? { wagerRewards: [...link.wagerRewards] } : {}),
      dominate: link.resolved
        ? link.flags.dominateAtResolution === true
        : attackHasDominate(state, runtime, link),
      overpower: link.resolved
        ? link.flags.overpowerAtResolution === true
        : attackHasOverpower(state, link),
      ...(attackHasVeil(state, link) ? { veil: true } : {}),
      ...(maxNonBlockDefenders !== undefined
        ? { maxNonBlockDefenders }
        : {}),
      reactions: [
        ...link.reactions,
        // A resolved ability may retain a display snapshot of its source.
        // Show the physical defender once when that source is on the chain.
        ...(link.resolvedReactionAbilitySources ?? []).filter(
          (source) => !defendingCardIds.has(source.instanceId),
        ),
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
      ...(additionalTargets.length > 0 ? { additionalTargets } : {}),
      };
  });
  const stackContext = projectedStackContext(state);
  // Queued attacks were played or announced face up, so every viewer sees them.
  const attackQueue = state.players.flatMap((player) =>
    queuedAttackObjects(state, player.seat).map((card) => ({
      card: cardView(state, runtime, card),
      seat: player.seat,
    })),
  );
  const turnFacts: TurnFactsView = {
    players: state.players.map((player) => ({
      attacks: Number(player.flags.attacksDeclaredThisTurn) || 0,
      weaponAttacks: Number(player.flags.weaponAttackCount) || 0,
      ...((seat === player.seat || revealAll)
        ? { banishedSixPlusThisTurn: player.flags.banishedSixPlusThisTurn === true }
        : {}),
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
  const projectedGameLog = projectedLog(state, seat, revealAll);
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
      playerView(state, runtime, state.players[0] as PlayerState, seat === 0, revealAll, seat),
      playerView(state, runtime, state.players[1] as PlayerState, seat === 1, revealAll, seat),
    ],
    chain,
    stack: projectedStackLayers(state, runtime, seat, revealAll),
    ...(stackContext ? { stackContext } : {}),
    ...(attackQueue.length > 0 ? { attackQueue } : {}),
    ongoing: projectOngoingEffects(state, runtime, revealAll ? undefined : seat),
    gameStats: state.gameStats,
    turnFacts,
    pendingDecision: state.pendingDecision
      ? (() => {
          const pd = state.pendingDecision!;
          // staged (uncommitted) defenders: the defender sees the real cards
          // and the live defense total; everyone else sees hand cards
          // face-down (staged equipment stays public) and a 0 total
          let staged: {
            stagedCards: CardView[];
            stagedHandCount: number;
            stagedDefense: number;
          } | undefined;
          const stagedInstances: CardInstance[] = [];
          if (pd.kind === "defend" && pd.staged && pd.staged.length > 0) {
            const defender = state.players[pd.player] as PlayerState;
            const mine = revealAll || pd.player === seat;
            const cards: CardView[] = [];
            let stagedHandCount = 0;
            for (const id of pd.staged) {
              const hc = defender.hand.find((c) => c.instanceId === id);
              const ac = defender.arsenal.find((c) => c.instanceId === id);
              const ec = Object.values(defender.equipment).find((c) => c?.instanceId === id);
              const wc = defender.weapons.find((c) => c.instanceId === id);
              const bc = defender.board.find((c) => c.instanceId === id);
              const hero = defender.hero.instanceId === id ? defender.hero : undefined;
              const c = hc ?? ac ?? ec ?? wc ?? bc ?? hero;
              if (!c) continue;
              if (hc) stagedHandCount += 1;
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
            staged = { stagedCards: cards, stagedHandCount, stagedDefense: mine ? total : 0 };
          }
          const defenderDefense = pd.kind === "defend" && (revealAll || pd.player === seat)
            ? projectedDefenderDefense(state, runtime, pd.player, stagedInstances)
            : [];
          const privateDecision = revealAll || pd.player === seat;
          const promptMessage = projectedDecisionPromptMessage(
            state,
            runtime,
            pd,
            revealAll ? pd.player : seat,
          );
          const preStackSource = projectedPreStackSource(state, runtime, pd, privateDecision);
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
            ...(privateDecision && promptMessage
              ? { promptMessage }
              : {}),
            ...((revealAll || pd.player === seat) && pd.options ? { options: pd.options } : {}),
            ...((revealAll || pd.player === seat) && pd.minimumSelections !== undefined
              ? {
                  minimumSelections: pd.minimumSelections,
                  maximumSelections: pd.maximumSelections,
                }
              : {}),
            ...((revealAll || pd.player === seat) && pd.defaultOption
              ? { defaultOption: pd.defaultOption }
              : {}),
            ...((revealAll || pd.player === seat) && pd.optionLabels ? { optionLabels: pd.optionLabels } : {}),
            ...(privateDecision && pd.optionMessages ? { optionMessages: pd.optionMessages } : {}),
            ...(privateDecision && pd.chosenOptions ? { chosenOptions: pd.chosenOptions } : {}),
            ...(privateDecision && pd.chosenOptionMessages
              ? { chosenOptionMessages: pd.chosenOptionMessages }
              : {}),
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
                        : selectableOptionCardView(state, runtime, pd, id, index, revealAll),
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
            ...(defenderDefense.length > 0 ? { defenderDefense } : {}),
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
              ? {
                  resourcePayment: {
                    ...pd.resourcePayment,
                    ...(pd.sourceInstanceId !== undefined ? { sourceInstanceId: pd.sourceInstanceId } : {}),
                  },
                }
              : {}),
            ...(preStackSource ? { preStackSource } : {}),
            ...(privateDecision && pd.chooseHook === "trigger-choice" && pd.sourceInstanceId !== undefined
              ? { sourceInstanceId: pd.sourceInstanceId }
              : {}),
            ...(privateDecision && pd.chooseHook === "engine-token-replacement-order"
              ? { optionLayout: "effect-list" as const }
              : {}),
            ...staged,
          };
        })()
      : null,
    winner: state.winner,
    ...(state.drawOfferSeat === undefined ? {} : { drawOfferSeat: state.drawOfferSeat }),
    ...projectedGameLog,
  };
}

/** Marginal defense of each legal defender relative to the staged set (for a
 * staged card, the defense unstaging it removes), measured exactly as the
 * staged total so delayed one-shot defense effects are included. */
function projectedDefenderDefense(
  state: GameStateInternal,
  runtime: EngineRuntime,
  defenderSeat: number,
  staged: readonly CardInstance[],
): DefenderDefenseView[] {
  const link = currentLink(state);
  if (!link) return [];
  const total = (cards: CardInstance[]) =>
    cards.length > 0 ? stagedDefenseTotal(state, runtime, link, cards) : 0;
  const base = total([...staged]);
  const stagedIds = new Set(staged.map((card) => card.instanceId));
  const { hand, arsenal, equipment } = legalDefenderCards(state, runtime, defenderSeat);
  return [...hand, ...arsenal, ...equipment].map((card) => ({
    instanceId: card.instanceId,
    defense: Math.max(0, stagedIds.has(card.instanceId)
      ? base - total(staged.filter((other) => other.instanceId !== card.instanceId))
      : total([...staged, card]) - base),
  }));
}
