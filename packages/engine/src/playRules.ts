import type { EngineRuntime } from "./runtimePorts.js";
import { cardAbilitiesSuppressed, cardColorOf, cardHasName, cardHasType, cardNamesOf, cardTypesOf, dataOf, instanceDataOf, scriptOf } from "./cardProperties.js";
import { controlledPermanents, lingeringModifierSources } from "./sourceQueries.js";
import { logPublic, nameOf } from "./gameLog.js";
import type { GameStateInternal } from "./runtimeState.js";

import type { CardInstance, ChainLinkState, Modifier, PlayerState, StackLayer } from "./state.js";
import { destroyControlledCard, destroyPermanent, enterBanish } from "./zoneMoves.js";
import { currentLink, findCardAnywhere, opponent, removeFromArray } from "./zoneQueries.js";
import type { MeldSide, PlayableZone } from "@fyendal/shared";
import { noteActionPlayedOrActivated } from "./cardLifecycle.js";
import { actionLimitReached, goAgainSuppressed } from "./ruleQueries.js";
import { cardProhibitedByChosenName } from "./restrictions.js";

export /** Static taxes imposed by opposing arena objects. */
function opposingStaticCostIncrease(state: GameStateInternal, seat: number): number {
  return (state.players as PlayerState[])
    .filter((player) => player.seat !== seat)
    .flatMap((player) => controlledPermanents(state, player.seat, { faceDownEquipment: false }))
    .reduce((sum, source) =>
      sum + Number(scriptOf(state, source.cardId, source)?.additionalCostToOpponents ?? 0), 0);
}

/** May `card` be played from `zone` right now? Only an explicit per-card
 *  permission (e.g. Katsu's searched combo card) allows it, and it beats the
 *  face-down play lock (a trap banished face-down with "you may play it"). */
export function mayPlayFromZone(
  state: GameStateInternal,
  runtime: EngineRuntime,
  card: CardInstance,
  zone: PlayableZone,
  actingSeat = card.owner,
): boolean {
  if (
    zone === "banish" &&
    Number((state.players[card.owner] as PlayerState).hero.counters?.banishPlayLockedUntilTurn ?? 0) === state.turn
  ) {
    return false;
  }
  if (
    card.playableFrom?.includes(zone) === true &&
    (card.playableBySeat === undefined
      ? actingSeat === card.owner
      : actingSeat === card.playableBySeat)
  ) return true;
  if (actingSeat !== card.owner) return false;
  if (modifierGrantingPlayFromZone(state, card, zone, actingSeat)) return true;
  if (zone === "banish" && canRuneGate(state, card)) return true;
  const owner = state.players[card.owner] as PlayerState;
  for (const source of controlledPermanents(state, owner.seat, { faceDownEquipment: false })) {
    const hook = scriptOf(state, source.cardId, source)?.allowsFriendlyCardPlayFrom;
    if (hook?.(runtime.makeCtx(state, owner.seat, source), card, zone) === true) return true;
  }
  return !card.faceDown && scriptOf(state, card.cardId, card)?.staticPlayableFrom?.includes(zone) === true;
}

/** Whether the only active permission to play `card` from `zone` requires the
 * instant play method. Ordinary per-card, modifier, Rune Gate, static, or
 * source grants take precedence when both kinds of permission exist. */
export function playFromZoneRequiresInstant(
  state: GameStateInternal,
  runtime: EngineRuntime,
  card: CardInstance,
  zone: PlayableZone,
  actingSeat = card.owner,
): boolean {
  if (actingSeat !== card.owner || card.faceDown) return false;
  if (
    card.playableFrom?.includes(zone) === true
    || modifierGrantingPlayFromZone(state, card, zone, actingSeat) !== undefined
    || (zone === "banish" && canRuneGate(state, card))
    || scriptOf(state, card.cardId, card)?.staticPlayableFrom?.includes(zone) === true
  ) return false;

  const owner = state.players[card.owner] as PlayerState;
  let instantOnlyGrant = false;
  for (const source of controlledPermanents(state, owner.seat, { faceDownEquipment: false })) {
    const sourceScript = scriptOf(state, source.cardId, source);
    const ctx = runtime.makeCtx(state, owner.seat, source);
    if (sourceScript?.allowsFriendlyCardPlayFrom?.(ctx, card, zone) !== true) continue;
    if (sourceScript.requiresFriendlyCardPlayAsInstant?.(ctx, card, zone) === true) {
      instantOnlyGrant = true;
    } else {
      return false;
    }
  }
  return instantOnlyGrant;
}

/** Public card identity responsible for a current play-from-zone permission.
 *  Undefined covers legacy grants that predate provenance tracking. */
export function playFromSourceCardId(
  state: GameStateInternal,
  runtime: EngineRuntime,
  card: CardInstance,
  zone: PlayableZone,
  actingSeat = card.owner,
): string | undefined {
  if (!mayPlayFromZone(state, runtime, card, zone, actingSeat)) return undefined;
  if (
    card.playableFrom?.includes(zone) === true &&
    (card.playableBySeat === undefined
      ? actingSeat === card.owner
      : actingSeat === card.playableBySeat)
  ) return card.playableFromSourceCardId;
  if (actingSeat !== card.owner) return undefined;
  const modifier = modifierGrantingPlayFromZone(state, card, zone, actingSeat);
  if (modifier) return modifier.sourceCardId;
  if (zone === "banish" && canRuneGate(state, card)) return card.cardId;
  const owner = state.players[card.owner] as PlayerState;
  for (const source of controlledPermanents(state, owner.seat, { faceDownEquipment: false })) {
    const hook = scriptOf(state, source.cardId, source)?.allowsFriendlyCardPlayFrom;
    if (hook?.(runtime.makeCtx(state, owner.seat, source), card, zone) === true) return source.cardId;
  }
  return scriptOf(state, card.cardId, card)?.staticPlayableFrom?.includes(zone) === true
    ? card.cardId
    : undefined;
}

function nameContainsWords(name: string, phrase: string): boolean {
  const words = name.trim().toLowerCase().split(/\s+/);
  const wanted = phrase.trim().toLowerCase().split(/\s+/);
  return words.some((_, index) =>
    wanted.every((word, offset) => words[index + offset] === word)
  );
}

function modifierGrantingPlayFromZone(
  state: GameStateInternal,
  card: CardInstance,
  zone: PlayableZone,
  actingSeat: number,
): Modifier | undefined {
  if (card.faceDown) return undefined;
  return state.modifiers.find((modifier) =>
    modifier.consumed !== true &&
    modifier.seat === actingSeat &&
    modifier.grantsPlayFromZone === zone &&
    modifierMatchesPlayedCard(state, modifier, card) &&
    (
      !modifier.grantsPlayFromNameContains ||
      cardNamesOf(state, card).some((name) =>
        nameContainsWords(name, modifier.grantsPlayFromNameContains!)
      )
    )
  );
}

/** Cards in a zone that `actingSeat` may play, including explicitly granted
 * opponent-owned cards. Deck permission remains limited to each owner's top. */
export function cardsPlayableFromZone(
  state: GameStateInternal,
  runtime: EngineRuntime,
  actingSeat: number,
  zone: PlayableZone,
): CardInstance[] {
  return (state.players as PlayerState[]).flatMap((owner) => {
    const cards = zone === "deck" ? owner.deck.slice(0, 1) : owner[zone];
    return cards.filter((card) => mayPlayFromZone(state, runtime, card, zone, actingSeat));
  });
}

/** May `actingSeat` play this arsenal card? Face-up arsenal annex effects
 * replace the owner's ordinary permission for their duration. Face-down
 * arsenal cards remain private and playable only by their owner. */
export function mayPlayFromArsenal(
  state: GameStateInternal,
  card: CardInstance,
  actingSeat = card.owner,
): boolean {
  if (card.faceDown) return actingSeat === card.owner;
  const owner = state.players[card.owner] as PlayerState;
  const annexingSeat = owner.hero.counters?.faceUpArsenalAnnexedBySeat;
  const throughTurn = owner.hero.counters?.faceUpArsenalAnnexedThroughTurn;
  if (
    annexingSeat !== undefined &&
    throughTurn !== undefined &&
    state.turn <= throughTurn
  ) {
    return actingSeat === annexingSeat;
  }
  return actingSeat === card.owner;
}

/** Arsenal cards this player may play, including face-up cards annexed from
 * an opponent. */
export function cardsPlayableFromArsenal(
  state: GameStateInternal,
  actingSeat: number,
): CardInstance[] {
  return (state.players as PlayerState[]).flatMap((owner) =>
    owner.arsenal.filter((card) => mayPlayFromArsenal(state, card, actingSeat)),
  );
}

/** Per-card discount available to this acting player. */
export function cardPlayReductionForSeat(card: CardInstance, actingSeat: number): number {
  if (
    card.playCostReductionSeat !== undefined &&
    card.playCostReductionSeat !== actingSeat
  ) return 0;
  return Number(card.playCostReduction ?? 0);
}

/** Rune Gate (CR 8.3.27): enough controlled Runechants permit a face-up card
 * carrying the marker to be played from banish without its printed resource
 * cost. Other numerical increases still apply in cardPlayCost. */
export function canRuneGate(state: GameStateInternal, card: CardInstance): boolean {
  if (card.faceDown || scriptOf(state, card.cardId, card)?.runeGate !== true) return false;
  const cost = instanceDataOf(state, card).cost ?? 0;
  const player = state.players[card.owner] as PlayerState;
  const runechants = player.board.filter(
    (source) => !source.faceDown && scriptOf(state, source.cardId, source)?.runechantToken === true,
  ).length;
  return runechants >= cost;
}

export /** Shared card-filter matching for delayed play effects and their cost view. */
function modifierMatchesPlayedCard(
  state: GameStateInternal,
  mod: Modifier,
  card: CardInstance,
): boolean {
  const data = instanceDataOf(state, card);
  const cost = data.cost ?? 0;
  const color = cardColorOf(state, card);
  if (mod.appliesToCardType && data.cardType !== mod.appliesToCardType) return false;
  if (mod.appliesToPitch !== undefined && color !== mod.appliesToPitch) return false;
  if (mod.minCost !== undefined && cost < mod.minCost) return false;
  if (mod.maxCost !== undefined && cost > mod.maxCost) return false;
  if (mod.appliesToName && data.name.trim().toLowerCase() !== mod.appliesToName.toLowerCase()) return false;
  if (
    mod.appliesToKeyword &&
    !(data.keywords ?? []).some((keyword) => keyword.toLowerCase() === mod.appliesToKeyword!.toLowerCase())
  ) return false;
  const tags = [...(data.classes ?? []), ...(data.subtypes ?? []), ...(card.grantedTypes ?? [])]
    .map((tag) => tag.toLowerCase());
  if (mod.appliesToClass && !tags.includes(mod.appliesToClass.toLowerCase())) return false;
  if (mod.appliesToSubtype) {
    const wanted = Array.isArray(mod.appliesToSubtype) ? mod.appliesToSubtype : [mod.appliesToSubtype];
    if (!wanted.some((tag) => tags.includes(tag.toLowerCase()))) return false;
  }
  if (mod.appliesToType && !mod.appliesToType.some((tag) => tags.includes(tag.toLowerCase()))) {
    return false;
  }
  if (mod.excludesSubtype && tags.includes(mod.excludesSubtype.toLowerCase())) return false;
  return true;
}

export function costModifierScopeApplies(modifier: Modifier): boolean {
  return modifier.scope === "combat-chain" || modifier.scope === "until-end-of-turn";
}

function consumeCostModifierUse(modifier: Modifier): void {
  if (modifier.remainingCostUses !== undefined) {
    modifier.remainingCostUses = Math.max(0, modifier.remainingCostUses - 1);
    if (modifier.remainingCostUses === 0) modifier.consumed = true;
  } else if (modifier.once) {
    modifier.consumed = true;
  }
}

function consumeMatchingPlayCostReductions(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
): void {
  for (const modifier of state.modifiers) {
    if (
      modifier.seat !== seat ||
      modifier.consumed ||
      !costModifierScopeApplies(modifier) ||
      !modifier.playCostReduction ||
      (modifier.once !== true && modifier.remainingCostUses === undefined) ||
      !modifierMatchesPlayedCard(state, modifier, card)
    ) continue;
    consumeCostModifierUse(modifier);
  }
}

export function consumeMatchingActivationCostReductions(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
): void {
  for (const modifier of state.modifiers) {
    if (
      modifier.seat !== seat ||
      modifier.consumed ||
      !costModifierScopeApplies(modifier) ||
      !modifier.activationCostReduction ||
      (modifier.once !== true && modifier.remainingCostUses === undefined) ||
      !modifierMatchesPlayedCard(state, modifier, card)
    ) continue;
    consumeCostModifierUse(modifier);
  }
}

/** Record a played card's name and subtypes in per-turn flags, for "if you've
 *  played a < Lightning / Nimblism / ... > card this turn" conditions. Also
 *  consumes "the next card you play this turn is <type>" (next-play) granted
 *  type modifiers: the card gains the tag and the played-type flags count it. */
export function noteCardPlayed(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): StackLayer[] {
  const triggeredLayers: StackLayer[] = [];
  const cardId = card.cardId;
  const d = dataOf(state, cardId);
  const isAction = cardHasType(state, card, "action");
  const isInstant = cardHasType(state, card, "instant");
  const normalizedName = d.name.trim().toLowerCase().replace(/\s+/g, " ");
  player.flags[`playedName:${normalizedName}`] = true;
  player.flags[`playedNameCount:${normalizedName}`] =
    (Number(player.flags[`playedNameCount:${normalizedName}`]) || 0) + 1;
  player.flags.playedCardThisTurn = true;
  for (const cardType of ["action", "instant"] as const) {
    if (cardHasType(state, card, cardType)) player.flags[`playedCardType:${cardType}`] = true;
  }
  if (!isAction && !isInstant) player.flags[`playedCardType:${d.cardType.toLowerCase()}`] = true;
  if (isAction) noteActionPlayedOrActivated(player);
  const activeLink = currentLink(state);
  if (isInstant && activeLink) activeLink.flags.playedInstant = true;
  if (
    isAction &&
    (d.subtypes ?? []).includes("attack") &&
    Number(player.hero.counters?.halveNextAttackActionOnTurn ?? 0) === state.turn
  ) {
    (card.counters ??= {}).halveBasePower = 1;
    (player.hero.counters ??= {}).halveNextAttackActionOnTurn = 0;
  }
  const nonAttackAction =
    isAction && !(d.subtypes ?? []).includes("attack");
  if (
    isAction &&
    (d.subtypes ?? []).includes("attack") &&
    (player.flags.nextActionGoAgain === true || player.flags.nextActionCardGoAgain === true)
  ) {
    player.flags.nextActionGoAgain = false;
    player.flags.nextActionCardGoAgain = false;
    (card.grantedKeywords ??= []).push("go again");
  }
  if (nonAttackAction) {
    player.flags.playedNonAttackAction = true;
    player.flags.nonAttackActionsPlayedThisTurn =
      (Number(player.flags.nonAttackActionsPlayedThisTurn) || 0) + 1;
  }
  if (isAction && (d.subtypes ?? []).includes("attack")) {
    player.flags.playedAttackAction = true;
    player.flags.attackActionsPlayedThisTurn = Number(player.flags.attackActionsPlayedThisTurn ?? 0) + 1;
  }
  for (const s of d.subtypes ?? []) {
    player.flags[`playedSubtype:${s.toLowerCase()}`] = true;
    player.flags[`playedSubtypeCount:${s.toLowerCase()}`] =
      (Number(player.flags[`playedSubtypeCount:${s.toLowerCase()}`]) || 0) + 1;
  }
  for (const c of d.classes ?? []) {
    player.flags[`playedClass:${c.toLowerCase()}`] = true;
    player.flags[`playedClassCount:${c.toLowerCase()}`] =
      (Number(player.flags[`playedClassCount:${c.toLowerCase()}`]) || 0) + 1;
    if (isAction && !(d.subtypes ?? []).includes("attack")) {
      player.flags[`playedClassType:${c.toLowerCase()}:non-attack-action`] = true;
      player.flags[`playedClassTypeCount:${c.toLowerCase()}:non-attack-action`] =
        (Number(player.flags[`playedClassTypeCount:${c.toLowerCase()}:non-attack-action`]) || 0) + 1;
    }
  }
  for (const keyword of d.keywords ?? []) {
    const normalizedKeyword = keyword.toLowerCase();
    player.flags[`playedKeyword:${normalizedKeyword}`] = true;
    player.flags[`playedKeywordCount:${normalizedKeyword}`] =
      (Number(player.flags[`playedKeywordCount:${normalizedKeyword}`]) || 0) + 1;
  }
  if (isAction) {
    const printedCost = d.cost ?? 0;
    for (const mod of state.modifiers) {
      const amount = Number(mod.onActionPlayedGainActionPoints ?? 0);
      if (
        amount <= 0 ||
        mod.consumed ||
        mod.seat !== player.seat ||
        printedCost < (mod.minCost ?? 0)
      ) continue;
      mod.consumed = true;
      const source = findCardAnywhere(state, mod.sourceInstanceId)?.card;
      const sourceName = source ? nameOf(state, source.cardId) : "Delayed effect";
      triggeredLayers.push({
        sourceInstanceId: mod.sourceInstanceId,
        seat: player.seat,
        triggerIndex: -2,
        label: `${sourceName} — gain ${amount} action point${amount === 1 ? "" : "s"}`,
        optional: false,
        engineEffect: { kind: "gain-action-points", amount },
      });
      logPublic(state, `${sourceName} triggers: gain ${amount} action point${amount === 1 ? "" : "s"}`);
    }
  }
  if (nonAttackAction) {
    if (player.flags.nextNonAttackAsInstant === true) {
      player.flags.nextNonAttackAsInstant = false;
    }
    delete player.flags[`asInstant:${card.instanceId}`];
    if (
      player.flags.nextWizardNonAttackAsInstant === true &&
      (d.classes ?? []).includes("wizard")
    ) {
      player.flags.nextWizardNonAttackAsInstant = false;
    }
    const wizardBonus = Number(player.flags.nextWizardNonAttackArcaneBonus || 0);
    if (wizardBonus > 0 && (d.classes ?? []).includes("wizard")) {
      player.flags.nextWizardNonAttackArcaneBonus = 0;
      if (scriptOf(state, cardId, card)?.arcaneDamageEffect) {
        (card.counters ??= {}).arcaneBonus =
          Number(card.counters?.arcaneBonus || 0) + wizardBonus;
      }
    }
  }
  const arcaneCardBonus = Number(player.flags.nextArcaneCardBonus || 0);
  if (arcaneCardBonus > 0 && scriptOf(state, cardId, card)?.arcaneDamageEffect) {
    (card.counters ??= {}).arcaneBonus =
      Number(card.counters?.arcaneBonus || 0) + arcaneCardBonus;
    player.flags.nextArcaneCardBonus = 0;
    for (const key of Object.keys(player.flags)) {
      if (key.startsWith("nextArcaneCardBonusSource:")) delete player.flags[key];
    }
  }
  // `playedPitch:<n>` counts — "if you've played another blue card this turn"
  const color = cardColorOf(state, card);
  player.flags[`playedPitch:${color}`] = (Number(player.flags[`playedPitch:${color}`]) || 0) + 1;
  // "the next matching card you play this turn is <type> / gets <keyword>"
  const consumedNextPlay = new Set<number>();
  for (const mod of state.modifiers) {
    if (mod.scope !== "next-play" || mod.seat !== player.seat || !modifierMatchesPlayedCard(state, mod, card)) continue;
    consumedNextPlay.add(mod.id);
    if (mod.basePower !== undefined) {
      (card.counters ??= {}).setBasePower = mod.basePower;
      card.counters.setBasePowerUntilTurn = state.turn;
    }
    if (mod.grantType) {
      const tag = mod.grantType.toLowerCase();
      (card.grantedTypes ??= []).push(tag);
      player.flags[`playedSubtype:${tag}`] = true;
      player.flags[`playedClass:${tag}`] = true;
      logPublic(state, `${nameOf(state, cardId)} is ${mod.grantType} in addition to its other types`);
    }
    if (mod.grantKeyword) {
      (card.grantedKeywords ??= []).push(mod.grantKeyword.toLowerCase());
      logPublic(state, `${nameOf(state, cardId)} gains ${mod.grantKeyword}`);
    }
  }
  state.modifiers = state.modifiers.filter((m) => !consumedNextPlay.has(m.id));
  if (isAction && (d.subtypes ?? []).includes("attack")) {
    const tags = new Set([
      ...(d.classes ?? []),
      ...(d.subtypes ?? []),
      ...(card.grantedTypes ?? []),
    ].map((tag) => tag.toLowerCase()));
    for (const tag of tags) {
      player.flags[`playedAttackActionTypeCount:${tag}`] =
        Number(player.flags[`playedAttackActionTypeCount:${tag}`] ?? 0) + 1;
    }
  }
  consumeMatchingPlayCostReductions(state, player.seat, card);
  if (activeLink) {
    const tags = [
      ...(d.classes ?? []),
      ...(d.subtypes ?? []),
      ...(card.grantedTypes ?? []),
    ];
    for (const tag of tags) {
      activeLink.flags[`playedType:${tag.toLowerCase()}`] = true;
    }
  }
  return triggeredLayers;
}

/** Announce go again for a played non-attack action, including one played at
 * instant speed, or for an instant explicitly granted go again by an effect.
 * The stamped action point is granted only when its layer resolves. */
export function cardLayerGoAgain(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): boolean {
  const data = instanceDataOf(state, card);
  const isAction = cardHasType(state, card, "action");
  const isInstant = cardHasType(state, card, "instant");
  // A melded split card has the combined types of its declared sides while it
  // is on the stack. Its printed front can be an instant even though the
  // declared left/both form is also an action (Everbloom // Life).
  if ((!isAction && !isInstant) || (isAction && (data.subtypes ?? []).includes("attack"))) return false;
  const nonAttackAction = isAction && !(data.subtypes ?? []).includes("attack");
  const flagGoAgain = isAction && player.flags.nextActionGoAgain === true;
  const nextActionCardGoAgain = isAction && player.flags.nextActionCardGoAgain === true;
  const nextNonAttackActionCardGoAgain = nonAttackAction &&
    player.flags.nextNonAttackActionCardGoAgain === true;
  if (flagGoAgain) player.flags.nextActionGoAgain = false;
  if (nextActionCardGoAgain) player.flags.nextActionCardGoAgain = false;
  if (nextNonAttackActionCardGoAgain) player.flags.nextNonAttackActionCardGoAgain = false;
  if (isAction && goAgainSuppressed(state, player.seat)) return false;
  if (isAction && state.players.some((candidate) =>
    controlledPermanents(state, candidate.seat, { faceDownEquipment: false })
      .some((source) => scriptOf(state, source.cardId, source)?.suppressesNonAttackActionGoAgain === true)
  )) return false;
  const modifierGoAgain = state.modifiers.some((modifier) =>
    modifier.goAgain === true &&
    !modifier.consumed &&
    modifier.seat === player.seat &&
    (modifier.scope === "until-end-of-turn" || modifier.scope === "static" || modifier.scope === "combat-chain") &&
    (modifier.appliesTo === undefined || modifier.appliesTo === "any") &&
    modifierMatchesPlayedCard(state, modifier, card)
  );
  return (
    flagGoAgain ||
    nextActionCardGoAgain ||
    nextNonAttackActionCardGoAgain ||
    modifierGoAgain ||
    (isAction && !cardAbilitiesSuppressed(state, card) && (
      (data.keywords ?? []).some((keyword) => keyword.toLowerCase() === "go again") ||
      (card.grantedKeywords ?? []).some((keyword) => keyword.toLowerCase() === "go again")
    ))
  );
}

/** Whether a card is an instant or a non-attack action currently permitted
 * to be played as though it were an instant. */
export function canPlayAsInstant(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  link?: ChainLinkState,
  fromOverride?: "hand" | "arsenal" | PlayableZone,
): boolean {
  const data = instanceDataOf(state, card);
  const meld = scriptOf(state, card.cardId, card)?.meld;
  // Before a split card is announced, ask whether it has an instant side at
  // all. Legal-intent construction then filters the individual left/right/
  // both announcements with meldSideHasType.
  if (meld && !card.meldSide) {
    return meld.leftCardType === "instant" || meld.rightCardType === "instant";
  }
  if (cardHasType(state, card, "instant") && !cardHasType(state, card, "action")) return true;
  const playableEquipment =
    data.cardType === "equipment" && scriptOf(state, card.cardId, card)?.playableEquipment === true;
  if (!playableEquipment && (data.cardType !== "action" || (data.subtypes ?? []).includes("attack"))) return false;
  const player = state.players[seat] as PlayerState;
  if (card.playableAsInstant) return true;
  if (player.flags[`asInstant:${card.instanceId}`] === true) return true;
  if (player.flags.nextNonAttackAsInstant === true) return true;
  if (
    player.flags.nextWizardNonAttackAsInstant === true &&
    (data.classes ?? []).some((cardClass) => cardClass.toLowerCase() === "wizard")
  ) return true;
  const extraZone = fromOverride === "banish" || fromOverride === "graveyard" || fromOverride === "deck"
    ? fromOverride
    : (["banish", "graveyard", "deck"] as const).find((zone) =>
        player[zone].some((candidate) => candidate.instanceId === card.instanceId),
      );
  {
    const active = controlledPermanents(state, seat, { faceDownEquipment: false });
    const sources = [...active, ...lingeringModifierSources(state, seat).filter(
      (candidate) => !active.some((source) => source.instanceId === candidate.instanceId),
    )];
    for (const source of sources) {
      const allow = scriptOf(state, source.cardId, source)?.allowsFriendlyCardPlayAsInstant;
      if (allow?.(runtime.makeCtx(state, seat, source, link), card, extraZone ?? fromOverride ?? "hand") === true) return true;
    }
  }
  return scriptOf(state, card.cardId, card)?.playAsInstant?.(
    runtime.makeCtx(state, seat, card, link),
  ) === true;
}

export /** Validate the discard part of an ability's discardCost. */
function validateDiscardCost(
  state: GameStateInternal,
  player: PlayerState,
  ability: { discardCost?: { count: number; classes?: string[]; cardTypes?: string[]; types?: string[] } },
  discardIds: number[],
): string | undefined {
  const dc = ability.discardCost;
  if (!dc) return undefined;
  if (new Set(discardIds).size !== discardIds.length || discardIds.length !== dc.count) {
    return `must discard exactly ${dc.count} card(s)`;
  }
  for (const id of discardIds) {
    const c = player.hand.find((x) => x.instanceId === id);
    if (!c) return `card ${id} not in hand`;
    if (
      dc.classes &&
      !(dataOf(state, c.cardId).classes ?? []).some((cl) => dc.classes!.includes(cl.toLowerCase()))
    ) {
      return `${nameOf(state, c.cardId)} is not a valid discard for this ability`;
    }
    if (dc.cardTypes && !dc.cardTypes.includes(dataOf(state, c.cardId).cardType.toLowerCase())) {
      return `${nameOf(state, c.cardId)} is not a valid discard for this ability`;
    }
    if (dc.types && !cardTypesOf(state, c).some((type) => dc.types!.includes(type))) {
      return `${nameOf(state, c.cardId)} is not a valid discard for this ability`;
    }
  }
  return undefined;
}

export /** Pay an ability's discardCost: the chosen hand cards go to the graveyard
 *  and generate the ordinary discard event. */
function payDiscardCost(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState, discardIds: number[]): void {
  for (const id of discardIds) {
    const c = removeFromArray(player.hand, id);
    if (!c) continue;
    runtime.commands.discardToGraveyard(state, player.seat, c, false, player.seat);
    runtime.commands.fireOnDiscard(state, player.seat, c, false);
  }
}

function attackTargetCard(
  state: GameStateInternal,
  attackingSeat: number,
  targetAllyId?: number,
): CardInstance | undefined {
  const target = state.players[opponent(attackingSeat)] as PlayerState;
  return targetAllyId === undefined
    ? target.hero
    : target.board.find((card) => card.instanceId === targetAllyId);
}

function modifierMatchesAttackTarget(
  state: GameStateInternal,
  modifier: Modifier,
  attackingSeat: number,
  targetAllyId?: number,
): boolean {
  const target = attackTargetCard(state, attackingSeat, targetAllyId);
  if (!target) return false;
  const data = dataOf(state, target.cardId);
  if (modifier.appliesToTargetType) {
    if (targetAllyId !== undefined) return false;
    const wanted = modifier.appliesToTargetType.toLowerCase();
    const tags = [...(data.classes ?? []), ...(data.subtypes ?? [])]
      .map((tag) => tag.toLowerCase());
    if (!tags.includes(wanted)) return false;
  }
  if (modifier.appliesToTargetNamePrefix) {
    if (targetAllyId !== undefined) return false;
    if (!data.name.toLowerCase().startsWith(modifier.appliesToTargetNamePrefix.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/** Numerical decrease supplied by active modifiers for an attack aimed at the
 * announced target. Shared by card plays and permanent attack activations. */
export function attackCostReductionForTarget(
  state: GameStateInternal,
  attackingSeat: number,
  attacker: CardInstance,
  targetAllyId?: number,
): number {
  return state.modifiers.reduce((sum, modifier) => {
    if (
      modifier.seat !== attackingSeat ||
      modifier.consumed ||
      !modifier.attackCostReduction ||
      !["next-attack", "until-end-of-turn", "combat-chain"].includes(modifier.scope) ||
      !modifierMatchesPlayedCard(state, modifier, attacker) ||
      !modifierMatchesAttackTarget(state, modifier, attackingSeat, targetAllyId)
    ) return sum;
    return sum + modifier.attackCostReduction;
  }, 0);
}

/** Consume every one-shot reduction that matched the successfully announced
 * attack. Multiple copies all apply to, and are consumed by, the same attack. */
export function consumeAttackCostReductions(
  state: GameStateInternal,
  attackingSeat: number,
  attacker: CardInstance,
  targetAllyId?: number,
): void {
  for (const modifier of state.modifiers) {
    if (
      modifier.seat === attackingSeat &&
      !modifier.consumed &&
      modifier.attackCostReduction &&
      ["next-attack", "until-end-of-turn", "combat-chain"].includes(modifier.scope) &&
      modifierMatchesPlayedCard(state, modifier, attacker) &&
      modifierMatchesAttackTarget(state, modifier, attackingSeat, targetAllyId)
    ) modifier.consumed = true;
  }
}

/** Effective classes/subtypes as a card is announced. Effects that apply to
 * the next card played start applying during announcement, before legality is
 * checked (CR 5.1.2a). This lets a prospective type grant satisfy a live play
 * restriction without mutating the card until the play succeeds. */
function announcedCardTypes(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
): Set<string> {
  const tags = new Set(cardTypesOf(state, card));
  for (const modifier of state.modifiers) {
    if (
      modifier.seat === seat &&
      !modifier.consumed &&
      modifier.scope === "next-play" &&
      modifier.grantType !== undefined &&
      modifierMatchesPlayedCard(state, modifier, card)
    ) {
      tags.add(modifier.grantType.toLowerCase());
    }
  }
  return tags;
}

/** Whether a turn-long modifier prohibits this player from playing the card.
 * The card may still be pitched, discarded, or used to pay an ability cost. */
export function cardPlayRestrictedByModifier(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
): boolean {
  if (cardProhibitedByChosenName(state, card)) return true;
  const data = instanceDataOf(state, card);
  const player = state.players[seat] as PlayerState;
  const temporalCaps = state.modifiers.filter((modifier) => modifier.seat === seat && !modifier.consumed);
  const attackCap = temporalCaps.reduce((cap, modifier) => Math.min(cap, modifier.attackActionCardCap ?? Infinity), Infinity);
  const nonAttackCap = temporalCaps.reduce((cap, modifier) => Math.min(cap, modifier.nonAttackActionCardCap ?? Infinity), Infinity);
  const isAttackAction = data.cardType === "action" && (data.subtypes ?? []).includes("attack");
  if (data.cardType === "action" && temporalCaps.some((modifier) =>
    (modifier.restrictActionsToWeaponOrAttack === true && !isAttackAction) ||
    (modifier.restrictActionsToNonWeaponNonAttack === true && isAttackAction)
  )) return true;
  if (isAttackAction &&
    Number(player.flags.attackActionsPlayedThisTurn ?? 0) >= attackCap) return true;
  if (data.cardType === "action" && !(data.subtypes ?? []).includes("attack") &&
    Number(player.flags.nonAttackActionsPlayedThisTurn ?? 0) >= nonAttackCap) return true;
  if (data.cardType === "defense-reaction" && temporalCaps.some((modifier) =>
    modifier.prohibitsDefenseReactionNamesInGraveyard === true &&
    player.graveyard.some((grave) => cardNamesOf(state, grave).some((name) => cardNamesOf(state, card).includes(name)))
  )) return true;
  if (
    data.cardType === "action" && (data.subtypes ?? []).includes("attack") &&
    Number(player.hero.counters?.actionCardCapsTurn ?? 0) === state.turn &&
    Number(player.flags.attackActionsPlayedThisTurn ?? 0) >= Number(player.hero.counters?.attackActionCardCap ?? 0)
  ) return true;
  if (
    data.cardType === "action" && !(data.subtypes ?? []).includes("attack") &&
    Number(player.hero.counters?.actionCardCapsTurn ?? 0) === state.turn &&
    Number(player.flags.nonAttackActionsPlayedThisTurn ?? 0) >= Number(player.hero.counters?.nonAttackActionCardCap ?? 0)
  ) return true;
  if (data.cardType === "action" && actionLimitReached(state, state.players[seat] as PlayerState)) {
    return true;
  }
  const tags = announcedCardTypes(state, seat, card);
  return state.modifiers.some((modifier) =>
    modifier.seat === seat &&
    !modifier.consumed &&
    modifier.scope === "until-end-of-turn" &&
    modifier.restrictCardPlaysToType !== undefined &&
    !tags.has(modifier.restrictCardPlaysToType.toLowerCase())
  );
}

/** The resource cost of playing a card: its printed cost (or zero when an
 *  alternative replaces that cost), then the script's own dynamic adjustment
 *  and turn-scoped increases/reductions. Consulted in enumeration AND
 *  validation; hooks must be pure. Optional meld/per-play adjustments included. */
export function cardPlayCost(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  link?: ChainLinkState,
  opts?: {
    baseCostOverride?: number;
    meldSide?: MeldSide;
    extraCost?: number;
    reduction?: number;
    perCardReduction?: number;
    alternativeCost?: boolean;
    runeGate?: boolean;
    targetCardInstanceId?: number;
    targetAllyId?: number;
  },
): number {
  const player = state.players[seat] as PlayerState;
  const data = instanceDataOf(state, card);
  const script = scriptOf(state, card.cardId, card);
  if (script?.unmodifiableCharacteristics?.includes("cost")) {
    return Math.max(0, opts?.baseCostOverride ?? data.cost ?? 0);
  }
  const replacesPrintedCost = opts?.alternativeCost &&
    script?.alternativePlayCost?.replacesResourceCost !== false;
  let cost = replacesPrintedCost || opts?.runeGate
    ? 0
    : (opts?.baseCostOverride ?? data.cost ?? 0) * (opts?.meldSide === "both" ? 2 : 1);
  // CR 1.14.2: numerical increases are applied before numerical decreases.
  cost += Number(player.flags.costMoreThisTurn || 0);
  cost += controlledPermanents(state, seat, { faceDownEquipment: false })
    .reduce((sum, source) => sum + Number(scriptOf(state, source.cardId, source)?.additionalCostToController || 0), 0);
  cost += opposingStaticCostIncrease(state, seat);
  if (data.cardType === "defense-reaction") {
    cost += Number(player.flags.nextDefenseReactionExtraCost || 0);
  }
  cost += Number(opts?.extraCost || 0);
  const hook = script?.modifyPlayCost;
  if (hook) {
    cost = Math.max(
      0,
      hook(
        runtime.makeCtx(state, seat, card, link, undefined, opts?.targetCardInstanceId),
        cost,
      ),
    );
  }
  const origin: "hand" | "arsenal" | PlayableZone = player.hand.some((candidate) => candidate.instanceId === card.instanceId)
    ? "hand"
    : player.arsenal.some((candidate) => candidate.instanceId === card.instanceId)
      ? "arsenal"
      : (["banish", "graveyard", "deck"] as const).find((zone) =>
    player[zone].some((candidate) => candidate.instanceId === card.instanceId),
  ) ?? "hand";
  {
    for (const source of controlledPermanents(state, seat, { faceDownEquipment: false })) {
      const adjust = scriptOf(state, source.cardId, source)?.modifyFriendlyCardPlayCost;
      if (adjust) cost = Math.max(0, adjust(runtime.makeCtx(state, seat, source, link), card, origin, cost));
    }
  }
  const attackReduction =
    data.cardType === "action" && (data.subtypes ?? []).includes("attack")
      ? attackCostReductionForTarget(state, seat, card, opts?.targetAllyId)
      : 0;
  for (const modifier of state.modifiers) {
    if (
      !["combat-chain", "until-end-of-turn"].includes(modifier.scope) ||
      modifier.consumed ||
      modifier.seat !== seat ||
      !modifier.playCostReduction ||
      !modifierMatchesPlayedCard(state, modifier, card)
    ) continue;
    cost -= modifier.playCostReduction;
  }
  return Math.max(
    0,
    cost - Number(opts?.reduction || 0) -
      Number(opts?.perCardReduction || 0) - attackReduction,
  );
}

/** Legal card targets announced as part of playing this object. Unlike a
 * scripted resolution-time choice, these options participate in cost
 * calculation and are validated before payment. */
export function playTargetOptions(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  link?: ChainLinkState,
  fromArsenal = false,
): number[] {
  const hook = scriptOf(state, card.cardId, card)?.playTargetOptions;
  if (!hook) return [];
  return [...new Set(hook(runtime.makeCtx(state, seat, card, link, fromArsenal)))]
    .filter((instanceId) => Number.isSafeInteger(instanceId) && !!findCardAnywhere(state, instanceId));
}

/** Authoritatively validate and stamp a declared card target onto the played
 * object so it survives JSON cloning and deferred stack resolution. */
export function preparePlayTarget(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  targetCardInstanceId: number | undefined,
  link?: ChainLinkState,
  fromArsenal = false,
): string | undefined {
  const hook = scriptOf(state, card.cardId, card)?.playTargetOptions;
  if (!hook) {
    delete card.playTargetInstanceId;
    return targetCardInstanceId === undefined
      ? undefined
      : `${nameOf(state, card.cardId)} does not target a card`;
  }
  delete card.playTargetInstanceId;
  if (targetCardInstanceId === undefined) return "choose a card target";
  if (!playTargetOptions(state, runtime, seat, card, link, fromArsenal).includes(targetCardInstanceId)) {
    return "not a legal card target";
  }
  card.playTargetInstanceId = targetCardInstanceId;
  return undefined;
}

export const MAX_ALTERNATIVE_COST_OPTIONS = 64;

function controlledCostCards(state: GameStateInternal, player: PlayerState): CardInstance[] {
  const cards = [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter(
      (card): card is CardInstance => card !== undefined,
    ),
    ...state.chain.flatMap((link) => [
      ...(link.attacker === player.seat &&
        link.attackCardType === "action" &&
        link.flags.attackGone !== true
        ? [link.attackingCard]
        : []),
      ...link.defendingCards.filter((card) => card.owner === player.seat),
      ...link.reactions.filter((card) => card.owner === player.seat),
    ]),
  ];
  return [...new Map(cards.map((card) => [card.instanceId, card])).values()];
}

export function exactCardCombinations(cards: CardInstance[], count: number): number[][] {
  if (count < 1 || cards.length < count) return [];
  const out: number[][] = [];
  const visit = (start: number, picked: number[]): void => {
    if (out.length >= MAX_ALTERNATIVE_COST_OPTIONS) return;
    if (picked.length === count) {
      out.push([...picked]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      picked.push(cards[i]!.instanceId);
      visit(i + 1, picked);
      picked.pop();
    }
  };
  visit(0, []);
  return out;
}

function nonEmptyCardSubsets(cards: CardInstance[]): number[][] {
  if (cards.length === 0) return [];
  // Ordinary hands keep this exhaustive. A pathological oversized hand stays
  // bounded while retaining every singleton and the "all cards" choice.
  if (cards.length > 10) {
    return [
      ...cards.slice(0, MAX_ALTERNATIVE_COST_OPTIONS - 1).map((card) => [card.instanceId]),
      cards.map((card) => card.instanceId),
    ];
  }
  const out: number[][] = [];
  const total = 2 ** cards.length;
  for (let mask = 1; mask < total && out.length < MAX_ALTERNATIVE_COST_OPTIONS; mask++) {
    const ids: number[] = [];
    for (let i = 0; i < cards.length; i++) {
      if ((mask & (2 ** i)) !== 0) ids.push(cards[i]!.instanceId);
    }
    out.push(ids);
  }
  const all = cards.map((card) => card.instanceId);
  if (!out.some((ids) => ids.length === all.length)) out[out.length - 1] = all;
  return out;
}

/** Exact card-instance sets that can pay this card's declared alternative
 *  play cost. Legal-intent enumeration and authoritative validation share
 *  this function so every offered payment applies successfully. */
export function alternativePlayCostOptions(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): number[][] {
  const cost = scriptOf(state, card.cardId, card)?.alternativePlayCost;
  if (!cost) return [];
  if (cost.kind === "put-hand-card-on-deck-top") {
    return player.hand
      .filter((candidate) => candidate.instanceId !== card.instanceId)
      .map((candidate) => [candidate.instanceId]);
  }
  if (cost.kind === "destroy-controlled-named") {
    const controlled = controlledCostCards(state, player);
    return cost.options.flatMap(({ name, count }) =>
      exactCardCombinations(
        controlled.filter(
          (candidate) => cardHasName(state, candidate, name),
        ),
        count,
      ),
    ).slice(0, MAX_ALTERNATIVE_COST_OPTIONS);
  }
  if (cost.kind === "banish-hand") {
    const candidates = player.hand.filter(
      (candidate) => candidate.instanceId !== card.instanceId,
    );
    return nonEmptyCardSubsets(candidates).filter((ids) => ids.length >= cost.min);
  }
  if (cost.kind === "destroy-controlled-and-or-discard-hand-subtype") {
    const controlled = controlledCostCards(state, player).filter((candidate) =>
      cardTypesOf(state, candidate).includes(cost.subtype.toLowerCase())
    );
    const hand = player.hand.filter((candidate) =>
      candidate.instanceId !== card.instanceId &&
      cardTypesOf(state, candidate).includes(cost.subtype.toLowerCase())
    );
    const controlledIds = new Set(controlled.map((candidate) => candidate.instanceId));
    const maximum = Math.min(
      controlled.length + hand.length,
      cost.maximumDestroyed + cost.maximumDiscarded,
    );
    const options: number[][] = [];
    for (let count = 1; count <= maximum && options.length < MAX_ALTERNATIVE_COST_OPTIONS; count++) {
      for (const ids of exactCardCombinations([...controlled, ...hand], count)) {
        const destroyed = ids.filter((id) => controlledIds.has(id)).length;
        const discarded = ids.length - destroyed;
        if (destroyed > cost.maximumDestroyed || discarded > cost.maximumDiscarded) continue;
        options.push(ids);
        if (options.length >= MAX_ALTERNATIVE_COST_OPTIONS) break;
      }
    }
    return options;
  }
  const wanted = cost.name.trim().toLowerCase();
  return [
    ...player.hand.filter(
      (candidate) =>
        candidate.instanceId !== card.instanceId &&
        cardHasName(state, candidate, wanted),
    ),
    ...controlledCostCards(state, player).filter(
      (candidate) => cardHasName(state, candidate, wanted),
    ),
  ].map((candidate) => [candidate.instanceId]);
}

function sameInstanceSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const wanted = new Set(a);
  return wanted.size === a.length && b.every((id) => wanted.has(id));
}

/** Validate and perform one announced alternative play cost. The caller pays
 *  any remaining numeric taxes separately through cardPlayCost/payCost. */
export function payAlternativePlayCost(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  card: CardInstance,
  instanceIds: readonly number[],
  link?: ChainLinkState,
): string | undefined {
  const script = scriptOf(state, card.cardId, card);
  const cost = script?.alternativePlayCost;
  if (!cost) return `${nameOf(state, card.cardId)} has no alternative play cost`;
  const option = alternativePlayCostOptions(state, player, card).find(
    (candidate) => sameInstanceSet(candidate, instanceIds),
  );
  if (!option) return "invalid alternative play cost";

  const paidCards: CardInstance[] = [];
  if (cost.kind === "put-hand-card-on-deck-top") {
    const paid = player.hand.find((candidate) => candidate.instanceId === option[0]);
    if (!paid || !runtime.makeCtx(state, player.seat, card, link).putOnDeckTop(paid.instanceId)) {
      return "could not pay alternative play cost";
    }
    paidCards.push(paid);
  } else if (cost.kind === "destroy-controlled-named") {
    for (const id of option) {
      const paid = controlledCostCards(state, player).find((candidate) => candidate.instanceId === id);
      if (!paid) return "alternative-cost card is no longer controlled";
      paidCards.push(paid);
    }
    for (const paid of paidCards) {
      if (!destroyControlledCard(state, runtime, player.seat, paid)) {
        return "could not destroy alternative-cost card";
      }
    }
  } else if (cost.kind === "banish-hand") {
    for (const id of option) {
      const paid = player.hand.find((candidate) => candidate.instanceId === id);
      if (!paid) return "alternative-cost card is no longer in hand";
      paidCards.push(paid);
    }
    for (const paid of paidCards) {
      removeFromArray(player.hand, paid.instanceId);
      enterBanish(state, runtime, paid, "hand");
    }
  } else if (cost.kind === "destroy-controlled-and-or-discard-hand-subtype") {
    const controlled = controlledCostCards(state, player);
    for (const id of option) {
      const paid = controlled.find((candidate) => candidate.instanceId === id)
        ?? player.hand.find((candidate) => candidate.instanceId === id);
      if (!paid) return "declared additional-cost card is no longer available";
      paidCards.push(paid);
    }
    for (const paid of paidCards) {
      if (controlled.some((candidate) => candidate.instanceId === paid.instanceId)) {
        if (!destroyPermanent(state, runtime, player.seat, paid)) {
          return "could not destroy a declared additional-cost card";
        }
      }
    }
    for (const paid of paidCards) {
      if (controlled.some((candidate) => candidate.instanceId === paid.instanceId)) continue;
      if (!removeFromArray(player.hand, paid.instanceId)) {
        return "could not discard a declared additional-cost card";
      }
      runtime.commands.discardToGraveyard(state, player.seat, paid, false, player.seat);
      runtime.commands.fireOnDiscard(state, player.seat, paid, false);
    }
  } else {
    const id = option[0]!;
    const fromHand = player.hand.find((candidate) => candidate.instanceId === id);
    if (fromHand) {
      removeFromArray(player.hand, id);
      runtime.commands.discardToGraveyard(state, player.seat, fromHand, false, player.seat);
      runtime.commands.fireOnDiscard(state, player.seat, fromHand, false);
      paidCards.push(fromHand);
    } else {
      const permanent = controlledCostCards(state, player).find(
        (candidate) => candidate.instanceId === id,
      );
      if (!permanent) return "alternative-cost card is no longer controlled";
      paidCards.push(permanent);
      if (!destroyControlledCard(state, runtime, player.seat, permanent)) {
        return "could not destroy alternative-cost card";
      }
    }
  }
  script?.onAlternativeCostPaid?.(
    runtime.makeCtx(state, player.seat, card, link),
    paidCards,
  );
  return undefined;
}
