import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import {
  cardAbilitiesSuppressed,
  cardColorOf,
  dataOf,
  scriptOf,
} from "./cardProperties.js";
import { basePowerOf } from "./combatValues.js";
import { logPrivate, logPublic, nameOf } from "./gameLog.js";
import type { CardInstance, PlayerState } from "./state.js";
import {
  currentLink,
  findPermanent,
  removeFromArray,
} from "./zoneQueries.js";
import { controlledPermanents, hookSources } from "./sourceQueries.js";

import { stampControlledName } from "./cardLifecycle.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import {
  transitionZone,
  transitionZoneFromEngineZone,
  transitionZoneIsPrivate,
} from "./transitions.js";

/** A card entering the graveyard is a new object (CR 3.0.9). Temporary
 * permission to play its previous object from an extra zone, together with
 * the permission's provenance, duration, and discount, does not survive that
 * reset. Effects that grant permission to the new graveyard object do so
 * after moving it there. */
function clearPlayFromZoneGrant(card: CardInstance): void {
  delete card.playableFrom;
  delete card.playableFromSourceCardId;
  delete card.playableBySeat;
  delete card.playableFromExpiry;
  delete card.playableFromEndTurnExpiry;
  delete card.playableFromUntilStartOfSeatTurn;
  delete card.playableFromUntilEndOfSeatTurn;
  delete card.playableFromGrantedTurn;
  delete card.playableFromUntilChainClose;
  delete card.playCostReduction;
  delete card.playCostReductionSeat;
  delete card.playableAsInstant;
}

/**
 * Put a card into its owner's graveyard: record per-turn facts in the owner's
 * flags (`graveName:<name>` / `graveCardType:<type>` /
 * `graveSubtype:<subtype>` true, `gravePitch:<n>` counts) and fire
 * onCardToGraveyard for the entering card's own script and
 * for the owner's hero. Every graveyard insertion routes through here.
 * Tokens never reach the graveyard — they cease to exist when they leave the
 * arena, so no graveyard flags or triggers fire for them.
 */
function enterGraveyard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  card: CardInstance,
  from: string,
  causedBySeat?: number,
): void {
  const owner = state.players[card.owner] as PlayerState;
  if (dataOf(state, card.cardId).cardType === "token") return;
  // Ephemeral (CR 8.3.21): "If this would be put into a graveyard from
  //  anywhere, instead it ceases to exist" — no graveyard, no graveyard flags
  //  or triggers
  if (!cardAbilitiesSuppressed(state, card) && (dataOf(state, card.cardId).keywords ?? []).some((k) => k.toLowerCase() === "ephemeral")) {
    logPublic(state, `${nameOf(state, card.cardId)} ceases to exist (Ephemeral)`);
    return;
  }
  clearPlayFromZoneGrant(card);
  // Rule-facing markers stop applying in an inactive zone. Card scripts also
  // use this map for private delayed-effect state, which must remain available
  // to the resolving layer and lingering modifiers; project.ts never exposes
  // that implementation state for graveyard/banish cards.
  const inactiveCounterKeys = [
    "aim", "attacked", "balance", "bind", "defense", "doom", "flow", "frost", "frozenUntilTurn",
    "haunt", "holo", "lessons", "marked", "power", "rust", "sand", "stain", "storm",
  ];
  for (const key of inactiveCounterKeys) delete card.counters?.[key];
  if (card.counters && Object.keys(card.counters).length === 0) delete card.counters;
  delete card.defCounters;
  owner.graveyard.push(card);
  if (from === "deck") {
    logPublic(state, `${nameOf(state, card.cardId)} is put into the graveyard from deck`);
  }
  const wateryGrave =
    (from === "arena" || from === "chain") &&
    !card.faceDown &&
    !cardAbilitiesSuppressed(state, card) &&
    (dataOf(state, card.cardId).keywords ?? []).some(
      (keyword) => keyword.trim().toLowerCase() === "watery grave",
    );
  if (wateryGrave) {
    (state.pendingTriggeredLayers ??= []).push({
      sourceInstanceId: card.instanceId,
      seat: card.owner,
      triggerIndex: -5,
      label: "Watery Grave — turn this face down",
      optional: false,
      engineEffect: { kind: "watery-grave" },
    });
    logPublic(state, `${nameOf(state, card.cardId)} triggers Watery Grave`);
  }
  // The graveyard is public and cards enter it face up. Determine leave-arena
  // abilities above using the source's prior orientation, then normalize it.
  delete card.faceDown;
  owner.flags.graveThisTurn = true;
  const d = dataOf(state, card.cardId);
  owner.flags[`graveName:${d.name.trim().toLowerCase().replace(/\s+/g, " ")}`] = true;
  owner.flags[`graveCardType:${d.cardType.toLowerCase()}`] = true;
  for (const s of d.subtypes ?? []) {
    owner.flags[`graveSubtype:${s.toLowerCase()}`] = true;
  }
  const color = cardColorOf(state, card);
  owner.flags[`gravePitch:${color}`] = (Number(owner.flags[`gravePitch:${color}`]) || 0) + 1;
  runtime.events.queueTriggeredEvent(
    state,
    "card-put-into-graveyard",
    card.owner,
    card,
    { from, causedBySeat },
  );
  if (from === "deck") {
    runtime.events.queueTriggeredEvent(
      state,
      "card-moved-from-deck-by-effect",
      card.owner,
      card,
      { from, to: "graveyard", causedBySeat },
    );
  }
  scriptOf(state, card.cardId, card)?.onCardToGraveyard?.(
    runtime.makeCtx(state, card.owner, card, currentLink(state)),
    card,
    from,
    causedBySeat,
  );
  if (owner.hero.instanceId !== card.instanceId) {
    if (!heroAbilitiesDisabled(state, owner.seat)) {
      scriptOf(state, owner.hero.cardId, owner.hero)?.onCardToGraveyard?.(
        runtime.makeCtx(state, card.owner, owner.hero, currentLink(state)),
        card,
        from,
        causedBySeat,
      );
    }
  }
}

/** Move a card to its owner's graveyard. */
export function moveToGraveyard(state: GameStateInternal,
  runtime: EngineRuntime, card: CardInstance, from = "chain", causedBySeat?: number): void {
  const script = scriptOf(state, card.cardId, card);
  const owner = state.players[card.owner] as PlayerState;
  const source = transitionZoneFromEngineZone(
    from,
    owner.seat,
    from === "deck" ? "top" : undefined,
  );
  const sourcePrivate = source !== null
    && transitionZoneIsPrivate(source.kind, card.faceDown === true);
  const replacement = card.temporaryGraveyardReplacement ?? (typeof script?.graveyardReplacement === "function"
    ? script.graveyardReplacement(runtime.makeCtx(state, card.owner, card, currentLink(state)))
    : script?.graveyardReplacement);
  if (replacement === "bottom-of-deck") {
    owner.deck.push(card);
    runtime.transitions.move(
      card,
      source,
      transitionZone("deck", owner.seat, "bottom"),
      { from: sourcePrivate, to: true },
    );
    logPublic(state, `${nameOf(state, card.cardId)} is put on the bottom of the deck`);
    return;
  }
  if (replacement === "banish") {
    runtime.transitions.move(
      card,
      source,
      transitionZone("banish", owner.seat),
      { from: sourcePrivate, to: card.faceDown === true },
    );
    enterBanish(state, runtime, card, from);
    return;
  }
  if (replacement === "cease-to-exist") {
    runtime.transitions.move(card, source, null, { from: sourcePrivate });
    logPublic(state, `${nameOf(state, card.cardId)} ceases to exist`);
    return;
  }
  const ceases = dataOf(state, card.cardId).cardType === "token"
    || (!cardAbilitiesSuppressed(state, card)
      && (dataOf(state, card.cardId).keywords ?? []).some(
        (keyword) => keyword.trim().toLowerCase() === "ephemeral",
      ));
  runtime.transitions.move(
    card,
    source,
    ceases ? null : transitionZone("graveyard", owner.seat),
    { from: sourcePrivate },
  );
  enterGraveyard(state, runtime, card, from, causedBySeat);
}

/** Destroy a permanent (equipment/aura/weapon); moves it to graveyard and fires onDestroyed. */
export function fireLeaveArena(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  to: "graveyard" | "banish" | "soul" | "deck" | "hand" | "subcard" | "cease-to-exist",
  asActivationCost = false,
): void {
  // Continuous effects sourced by a permanent end as soon as it leaves the
  // arena, regardless of which destination moved it there.
  state.modifiers = state.modifiers.filter(
    (m) => m.sourceInstanceId !== card.instanceId || m.scope !== "static",
  );
  runtime.events.queueTriggeredEvent(
    state,
    "card-left-arena",
    seat,
    card,
    { from: "arena" },
  );
  scriptOf(state, card.cardId, card)?.onLeaveArena?.(
    runtime.makeCtx(state, seat, card, currentLink(state), undefined, undefined, asActivationCost),
    to,
  );
}

export function destroyPermanent(state: GameStateInternal,
  runtime: EngineRuntime, seat: number, card: CardInstance): boolean {
  const controllerSeat = findPermanent(state, card.instanceId)?.seat ?? seat;
  if (seat !== controllerSeat) {
    const protectedBy = hookSources(state, controllerSeat, {
      board: true,
      equipment: true,
      weapons: true,
    }).find((source) => scriptOf(state, source.cardId, source)?.preventsOpponentDestroyingFriendly?.(
      runtime.makeCtx(state, controllerSeat, source, currentLink(state)),
      card,
    ) === true);
    if (protectedBy) {
      logPublic(state, `${nameOf(state, card.cardId)} can't be destroyed by the opposing effect`);
      return false;
    }
  }
  const p = state.players[controllerSeat] as PlayerState;
  const sourceKind = Object.values(p.equipment).some((candidate) => candidate?.instanceId === card.instanceId)
    ? "equipment" as const
    : p.weapons.some((candidate) => candidate.instanceId === card.instanceId)
      ? "weapon" as const
      : "board" as const;
  for (const [slot, eq] of Object.entries(p.equipment)) {
    if (eq?.instanceId === card.instanceId) {
      delete p.equipment[slot as keyof typeof p.equipment];
    }
  }
  removeFromArray(p.board, card.instanceId);
  // weapons are permanents too (self-destroying daggers, "destroy target weapon")
  removeFromArray(p.weapons, card.instanceId);
  // Equipment remains represented in its arena slot while it defends. If it
  // is destroyed before combat damage, remove that separate chain copy at
  // once so it no longer contributes defense or settles a second time when
  // the combat chain closes.
  for (const link of state.chain) {
    if (removeFromArray(link.defendingEquipment, card.instanceId)) {
      link.flags[`equipmentGone:${card.instanceId}`] = true;
    }
  }
  const incarnate =
    !cardAbilitiesSuppressed(state, card) &&
    (dataOf(state, card.cardId).keywords ?? []).some(
      (keyword) => keyword.trim().toLowerCase() === "incarnate",
    );
  if (incarnate) {
    runtime.transitions.move(
      card,
      transitionZone(sourceKind, controllerSeat),
      null,
    );
    fireLeaveArena(state, runtime, controllerSeat, card, "cease-to-exist");
    logPublic(state, `${nameOf(state, card.cardId)} ceases to exist (Incarnate)`);
    return true;
  }
  moveToGraveyard(state, runtime, card, "arena", seat);
  fireLeaveArena(state, runtime, controllerSeat, card, "graveyard");
  logPublic(state, `${nameOf(state, card.cardId)} is destroyed`);
  runtime.events.runHook(state, controllerSeat, card, "onDestroyed");
  runtime.events.fireFriendlyDestroyed(state, controllerSeat, card, seat);
  // an ally that dies while it is the attacking card of a chain link notifies
  // its controller's other permanents (Silent Stilettos)
  const attacking = state.chain.some(
    (l) => !l.resolved && l.attackingCard.instanceId === card.instanceId,
  );
  if (attacking) runtime.events.fireFriendlyAttackLost(state, controllerSeat, card, "ally-died");
  return true;
}

/**
 * Put a card into its owner's soul (face up, public). Records the per-turn
 * facts on the owner (`soulThisTurn`, `soulPitch:<n>` counts). When `charged`
 * (the Charge mechanic — hand into soul), also sets `chargedThisTurn`
 * / `chargedPitch:<n>` and fires the entering card's onCharged hook (Solflare).
 */
export function enterSoul(
  state: GameStateInternal,
  runtime: EngineRuntime,
  card: CardInstance,
  charged: boolean,
): void {
  const owner = state.players[card.owner] as PlayerState;
  if (scriptOf(state, card.cardId, card)?.replacesSoulMoveWithArena === true) {
    owner.board.push(card);
    stampControlledName(state, owner, card);
    logPublic(state, `${nameOf(state, card.cardId)} enters the arena instead of its hero's soul`);
    runtime.events.runHook(state, owner.seat, card, "onEnterArena");
    runtime.events.fireFriendlyEnterArena(state, owner.seat, card);
    return;
  }
  owner.soul.push(card);
  owner.flags.soulThisTurn = true;
  const color = cardColorOf(state, card);
  owner.flags[`soulPitch:${color}`] = (Number(owner.flags[`soulPitch:${color}`]) || 0) + 1;
  logPublic(
    state,
    `${nameOf(state, owner.heroCardId)} ${charged ? "charges" : "puts"} ${nameOf(state, card.cardId)} into their hero's soul`,
  );
  for (const source of controlledPermanents(state, owner.seat, {
    faceDownEquipment: false,
  })) {
    scriptOf(state, source.cardId, source)?.onCardPutIntoSoul?.(
      runtime.makeCtx(state, owner.seat, source, currentLink(state)),
      card,
      charged,
    );
  }
  if (!charged) return;
  owner.flags.chargedThisTurn = true;
  owner.flags[`chargedPitch:${color}`] = (Number(owner.flags[`chargedPitch:${color}`]) || 0) + 1;
  scriptOf(state, card.cardId, card)?.onCharged?.(
    runtime.makeCtx(state, card.owner, card, currentLink(state)),
  );
}

/** Search all owner zones for `instanceId` and remove the card. Equipment is
 *  included only when `includeEquipment` is set; the banish zone is included
 *  only when `includeBanish` is set. Returns the owner and card on success. */
function findAndRemoveCard(
  state: GameStateInternal,
  instanceId: number,
  opts?: { includeEquipment?: boolean; includeBanish?: boolean },
): { owner: PlayerState; card: CardInstance; fromArena: boolean; fromZone: string } | undefined {
  for (const p of state.players as PlayerState[]) {
    if (opts?.includeEquipment) {
      const eqSlot = Object.entries(p.equipment).find(([, c]) => c?.instanceId === instanceId);
      if (eqSlot) {
        const card = p.equipment[eqSlot[0] as keyof typeof p.equipment] as CardInstance;
        delete p.equipment[eqSlot[0] as keyof typeof p.equipment];
        return { owner: p, card, fromArena: true, fromZone: "arena" };
      }
      const weapon = removeFromArray(p.weapons, instanceId);
      if (weapon) return { owner: p, card: weapon, fromArena: true, fromZone: "arena" };
    }
    const zones: { arr: CardInstance[]; name: string; arena?: boolean }[] = [
      { arr: p.hand, name: "hand" }, { arr: p.deck, name: "deck" },
      { arr: p.arsenal, name: "arsenal" }, { arr: p.pitch, name: "pitch" },
      { arr: p.graveyard, name: "graveyard" }, { arr: p.soul, name: "soul" },
      { arr: p.board, name: "arena", arena: true },
    ];
    if (opts?.includeBanish) zones.push({ arr: p.banish, name: "banish" });
    for (const { arr, arena, name } of zones) {
      const card = removeFromArray(arr, instanceId);
      if (card) return { owner: p, card, fromArena: arena === true, fromZone: name };
    }
  }
  return undefined;
}

/** Put an already removed card into its owner's banished zone and record all
 * public, per-turn, and observer consequences of the move. */
export function enterBanish(
  state: GameStateInternal,
  runtime: EngineRuntime,
  card: CardInstance,
  from: string,
  causedBySeat = card.owner,
): void {
  const owner = state.players[card.owner] as PlayerState;
  const causedBy = state.players[causedBySeat] as PlayerState | undefined;
  if (causedBy && (dataOf(state, card.cardId).keywords ?? []).some(
    (keyword) => keyword.trim().toLowerCase() === "blood debt"
  )) {
    causedBy.flags.banishedBloodDebtThisTurn = true;
  }
  owner.flags.banishedThisTurn = (Number(owner.flags.banishedThisTurn) || 0) + 1;
  if (basePowerOf(state, runtime, owner.seat, card, dataOf(state, card.cardId).attack ?? 0) >= 6) {
    owner.flags.banishedSixPlusThisTurn = true;
  }
  // Observers historically see ordinary cards already present in banish.
  // Tokens still fire the move event, but cease instead of remaining there.
  if (dataOf(state, card.cardId).cardType !== "token") owner.banish.push(card);
  const origin = from === "deck"
    ? " from deck"
    : from === "graveyard"
      ? " from graveyard"
      : "";
  if (card.faceDown) {
    logPrivate(
      state,
      owner.seat,
      `${nameOf(state, card.cardId)} is banished face down${origin}`,
      `A face-down card is banished${origin}`,
    );
  } else {
    logPublic(state, `${nameOf(state, card.cardId)} is banished${origin}`);
  }
  if (!card.faceDown) {
    scriptOf(state, card.cardId, card)?.onSelfBanished?.(
      runtime.makeCtx(state, owner.seat, card, currentLink(state)),
      from,
    );
  }
  runtime.events.fireCardBanished(state, owner.seat, card, from);
}

/** Banish a card from any of its owner's zones (hand/soul/equipment/board/…). */
export function banishCard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  instanceId: number,
  causedBySeat?: number,
  faceDown?: boolean,
): boolean {
  const applyBanishVisibility = (card: CardInstance): void => {
    if (faceDown === true) card.faceDown = true;
    else if (faceDown === false) delete card.faceDown;
  };
  const fromResolving = removeFromStackResolution(state, instanceId);
  let fromChain: { owner: PlayerState; card: CardInstance; fromArena: boolean; fromZone: string } | undefined;
  const active = currentLink(state);
  const activeAttacker = !fromResolving &&
    active?.attackingCard.instanceId === instanceId &&
    active.flags.attackGone !== true;
  // Ally and weapon attackers remain represented in their arena zone while
  // the combat-chain copy supplies last-known information. If that permanent
  // has already died, a triggered effect may instead find its new graveyard
  // object here. In both cases move the owner-zone object, never the stale
  // chain copy; attack actions exist only on the chain and use the fallback.
  const fromAttackingOwnerZone = activeAttacker
    ? findAndRemoveCard(state, instanceId, { includeEquipment: true })
    : undefined;
  if (activeAttacker) {
    const card = active.attackingCard;
    active.attackingCard = {
      ...card,
      ...(card.counters ? { counters: { ...card.counters } } : {}),
      ...(card.grantedTypes ? { grantedTypes: [...card.grantedTypes] } : {}),
      ...(card.grantedKeywords ? { grantedKeywords: [...card.grantedKeywords] } : {}),
    };
    active.flags.attackGone = true;
    if (!fromAttackingOwnerZone) {
      applyBanishVisibility(card);
      enterBanish(state, runtime, card, "chain", causedBySeat);
      return true;
    }
  }
  // A resolving instant/reaction is represented on both its stack layer and
  // the combat-chain link. Explicitly moving it must clear both copies.
  for (const link of state.chain) {
    const card = removeFromArray(link.defendingCards, instanceId)
      ?? removeFromArray(link.defendingEquipment, instanceId)
      ?? removeFromArray(link.reactions, instanceId);
    if (!card) continue;
    fromChain ??= {
      owner: state.players[card.owner] as PlayerState,
      card,
      fromArena: false,
      fromZone: "chain",
    };
  }
  const found = fromResolving
    ?? fromAttackingOwnerZone
    ?? fromChain
    ?? findAndRemoveCard(state, instanceId, { includeEquipment: true });
  if (!found) return false;
  const { owner, card, fromArena, fromZone } = found;
  delete card.flipped;
  if (fromArena) fireLeaveArena(state, runtime, owner.seat, card, "banish");
  applyBanishVisibility(card);
  enterBanish(state, runtime, card, fromZone, causedBySeat);
  if (fromZone === "deck") {
    runtime.events.queueTriggeredEvent(
      state,
      "card-moved-from-deck-by-effect",
      owner.seat,
      card,
      { from: "deck", to: "banish" },
    );
  }
  if (fromZone === "graveyard") {
    runtime.events.fireCardLeavesGraveyard(state, owner.seat, card, "banish");
  }
  return true;
}

/** Remove exactly one physical card from a possibly nested soul collection.
 * Any cards that were represented below the selected card remain in the soul
 * and are promoted to the same level. */
function removeSoulCard(
  cards: CardInstance[],
  instanceId: number,
): CardInstance | undefined {
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]!;
    if (card.instanceId === instanceId) {
      const promoted = card.subcards ?? [];
      cards.splice(index, 1, ...promoted);
      delete card.subcards;
      return card;
    }
    const nested = removeSoulCard(card.subcards ?? [], instanceId);
    if (nested) return nested;
  }
  return undefined;
}

export function banishHeroSoulCard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  instanceId: number,
): boolean {
  const card = removeSoulCard(player.soul, instanceId)
    ?? removeSoulCard(player.hero.subcards ?? [], instanceId);
  if (!card) return false;
  enterBanish(state, runtime, card, "soul");
  return true;
}

/** Remove a card object that is currently resolving. During a scripted choice
 * the same object is represented in both `resolving` and its stack layer, so
 * clear both representations and return the resolving copy as authoritative. */
export function removeFromStackResolution(
  state: GameStateInternal,
  instanceId: number,
): { owner: PlayerState; card: CardInstance; fromArena: false; fromZone: "stack" } | undefined {
  const resolving = removeFromArray(state.resolving, instanceId);
  let stackCard: CardInstance | undefined;
  for (const layer of state.stack) {
    if (layer.card?.instanceId !== instanceId) continue;
    stackCard ??= layer.card;
    delete layer.card;
  }
  const card = resolving ?? stackCard;
  if (!card) return undefined;
  return {
    owner: state.players[card.owner] as PlayerState,
    card,
    fromArena: false,
    fromZone: "stack",
  };
}

/** Remove a card from its resolving stack object or any of its owner's zones;
 * returns the card's owner. Effects may explicitly move their own source while
 * it is resolving, before the engine performs the default leave-stack move. */
export function removeFromOwnerZones(state: GameStateInternal, instanceId: number): { owner: PlayerState; card: CardInstance; fromArena: boolean; fromZone: string } | undefined {
  return removeFromStackResolution(state, instanceId)
    ?? findAndRemoveCard(state, instanceId, { includeEquipment: true, includeBanish: true });
}

/** Move one card to its owner's deck bottom with hidden-zone-safe logging. */
export function putCardOnDeckBottom(
  state: GameStateInternal,
  runtime: EngineRuntime,
  instanceId: number,
  asActivationCost = false,
): boolean {
  const found = removeFromOwnerZones(state, instanceId);
  if (!found) return false;
  found.owner.deck.push(found.card);
  const source = transitionZoneFromEngineZone(found.fromZone, found.owner.seat);
  runtime.transitions.move(
    found.card,
    source,
    transitionZone("deck", found.owner.seat, "bottom"),
    {
      from: source !== null && transitionZoneIsPrivate(source.kind, found.card.faceDown === true),
      to: true,
    },
  );
  if (found.fromZone === "graveyard") {
    runtime.events.fireCardLeavesGraveyard(state, found.owner.seat, found.card, "deck");
  }
  if (found.fromArena) fireLeaveArena(state, runtime, found.owner.seat, found.card, "deck", asActivationCost);
  const privateSource = found.fromZone === "hand" || found.fromZone === "deck"
    || (found.fromZone === "arsenal" && found.card.faceDown)
    || (found.fromZone === "banish" && found.card.faceDown);
  const detail = `${nameOf(state, found.card.cardId)} is put on the bottom of the deck`;
  if (privateSource) logPrivate(state, found.owner.seat, detail, "a card is put on the bottom of the deck");
  else logPublic(state, detail);
  return true;
}

/** Answer an engine-owned private deck-bottom ordering decision. */
export function answerDeckBottomOrder(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  if (
    !pd ||
    pd.player !== seat ||
    pd.chooseHook !== "engine-deck-bottom-order" ||
    !pd.deckBottomOrder
  ) {
    return "not your decision";
  }
  const chosen = Number(optionId);
  const index = pd.deckBottomOrder.remaining.indexOf(chosen);
  if (!Number.isSafeInteger(chosen) || index < 0) return "invalid option";

  const ordered = [...pd.deckBottomOrder.ordered, chosen];
  const remaining = pd.deckBottomOrder.remaining.filter((_, i) => i !== index);
  if (remaining.length > 1) {
    pd.options = remaining.map(String);
    pd.cardOptions = [...remaining];
    pd.deckBottomOrder = { ordered, remaining };
    return undefined;
  }

  state.pendingDecision = null;
  for (const instanceId of [...ordered, ...remaining]) {
    putCardOnDeckBottom(state, runtime, instanceId);
  }
  return undefined;
}
