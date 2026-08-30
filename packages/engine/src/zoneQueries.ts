import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, ChainLinkState, PlayerState } from "./state.js";

export function opponent(seat: number): number {
  return seat === 0 ? 1 : 0;
}

/** Find a card instance in any of a player's zones, including nested cards. */
export function findCard(
  player: PlayerState,
  instanceId: number,
): CardInstance | undefined {
  const arrays: CardInstance[][] = [
    player.hand,
    player.deck,
    player.arsenal,
    player.pitch,
    player.graveyard,
    player.banish,
    player.board,
    player.soul,
    ...(player.inventory ? [player.inventory] : []),
  ];
  for (const cards of arrays) {
    const card = findCardOrSubcard(cards, instanceId);
    if (card) return card;
  }
  for (const equipment of Object.values(player.equipment)) {
    if (!equipment) continue;
    const card = findCardOrSubcard([equipment], instanceId);
    if (card) return card;
  }
  return findCardOrSubcard(player.weapons, instanceId);
}

/** Stable synthetic instances for rule-defined global objects. The ids are
 * negative so they cannot collide with ordinary monotonically allocated card
 * instances, and are reconstructed from the process registries after load. */
export function globalCardInstances(state: GameStateInternal, seat: number): CardInstance[] {
  return [...state.globalCardIds]
    .sort()
    .map((cardId, index) => ({
      instanceId: -((index + 1) * 2 + seat),
      cardId,
      owner: seat,
    }));
}

/** Locate a card instance anywhere in the game, including synthetic global
 * objects, nested cards, the combat chain, resolving cards, and stack layers. */
export function findCardAnywhere(
  state: GameStateInternal,
  instanceId: number,
): { seat: number; card: CardInstance } | undefined {
  for (const seat of [0, 1]) {
    const global = globalCardInstances(state, seat).find(
      (card) => card.instanceId === instanceId,
    );
    if (global) return { seat, card: global };
  }
  for (const player of state.players) {
    if (player.hero.instanceId === instanceId) return { seat: player.seat, card: player.hero };
    const heroSubcard = findCardOrSubcard(player.hero.subcards ?? [], instanceId);
    if (heroSubcard) return { seat: player.seat, card: heroSubcard };
    const found = findCard(player, instanceId);
    if (found) return { seat: player.seat, card: found };
  }
  // A card returned from an earlier resolved link can be replayed while that
  // link's last-known snapshot remains on the chain. Prefer its newest link.
  for (let index = state.chain.length - 1; index >= 0; index--) {
    const link = state.chain[index]!;
    if (link.attackingCard.instanceId === instanceId) {
      return { seat: link.attacker, card: link.attackingCard };
    }
    for (const card of [
      ...link.defendingCards,
      ...link.defendingEquipment,
      ...link.reactions,
    ]) {
      if (card.instanceId === instanceId) return { seat: card.owner, card };
    }
  }
  const resolving = state.resolving.find((card) => card.instanceId === instanceId);
  if (resolving) return { seat: resolving.owner, card: resolving };
  for (const layer of state.stack) {
    if (layer.card?.instanceId === instanceId) return { seat: layer.seat, card: layer.card };
    if (layer.abilityCard?.instanceId === instanceId) {
      return { seat: layer.seat, card: layer.abilityCard };
    }
  }
  return undefined;
}

export function findCardOrSubcard(
  cards: readonly CardInstance[],
  instanceId: number,
): CardInstance | undefined {
  for (const card of cards) {
    if (card.instanceId === instanceId) return card;
    const nested = findCardOrSubcard(card.subcards ?? [], instanceId);
    if (nested) return nested;
  }
  return undefined;
}

function flattenCards(cards: readonly CardInstance[]): CardInstance[] {
  const flattened: CardInstance[] = [];
  for (const card of cards) {
    flattened.push(card, ...flattenCards(card.subcards ?? []));
  }
  return flattened;
}

/** Cards in a hero's soul, including transformed-hero subcards. */
export function heroSoulCards(player: PlayerState): CardInstance[] {
  return [
    ...flattenCards(player.soul),
    ...flattenCards(player.hero.subcards ?? []),
  ];
}

export function removeFromArray(
  cards: CardInstance[],
  instanceId: number,
): CardInstance | undefined {
  const index = cards.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) return undefined;
  return cards.splice(index, 1)[0];
}

export function currentLink(state: GameStateInternal): ChainLinkState | undefined {
  const link = state.chain[state.chain.length - 1];
  return link && !link.resolved ? link : undefined;
}

/** Permanents that can hold activated abilities. */
export function isPermanentSource(player: PlayerState, instanceId: number): boolean {
  return (
    player.hero.instanceId === instanceId ||
    player.weapons.some((weapon) => weapon.instanceId === instanceId) ||
    Object.values(player.equipment).some(
      (equipment) => equipment?.instanceId === instanceId,
    ) ||
    player.board.some((card) => card.instanceId === instanceId)
  );
}

/** Find an arena permanent by instance id. */
export function findPermanent(
  state: GameStateInternal,
  instanceId: number,
): { seat: number; card: CardInstance } | undefined {
  for (const player of state.players as PlayerState[]) {
    if (player.hero.instanceId === instanceId) {
      return { seat: player.seat, card: player.hero };
    }
    const weapon = player.weapons.find((card) => card.instanceId === instanceId);
    if (weapon) return { seat: player.seat, card: weapon };
    const equipment = Object.values(player.equipment)
      .find((card) => card?.instanceId === instanceId);
    if (equipment) return { seat: player.seat, card: equipment };
    const boardCard = player.board.find((card) => card.instanceId === instanceId);
    if (boardCard) return { seat: player.seat, card: boardCard };
  }
  return undefined;
}
