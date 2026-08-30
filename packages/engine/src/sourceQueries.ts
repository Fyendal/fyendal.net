import { scriptOf } from "./cardProperties.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardScript } from "./scripts.js";
import type { CardInstance, PlayerState } from "./state.js";
import { findCardAnywhere, globalCardInstances } from "./zoneQueries.js";

/** Permanents controlled by `seat` in the standard iteration order: hero,
 *  weapons, equipment, board. Used for untap, ability enumeration, and
 *  modifier hooks. `faceDownEquipment` defaults to true; `arsenal` adds
 *  face-up arsenal cards (mentor triggers) after the board. */
export function controlledPermanents(
  state: GameStateInternal,
  seat: number,
  opts?: {
    faceDownEquipment?: boolean;
    arsenal?: boolean;
    includeDisabledHero?: boolean;
  },
): CardInstance[] {
  const p = state.players[seat] as PlayerState;
  return [
    ...(opts?.includeDisabledHero === true || !heroAbilitiesDisabled(state, seat)
      ? [p.hero]
      : []),
    ...p.weapons,
    ...(Object.values(p.equipment).filter(
      (c): c is CardInstance => !!c && (opts?.faceDownEquipment !== false || !c.faceDown),
    )),
    ...p.board,
    ...(opts?.arsenal ? p.arsenal : []),
  ];
}

/**
 * Cards of `seat` that run hooks for game events. Always includes the hero;
 * `board`/`arsenal` opt in those zones (face-down arsenal cards are inert and
 * skipped). Returns a snapshot so hooks may mutate the zones. `heroLast`
 * orders the hero after the other sources (so granted effects are visible to
 * hero triggers).
 */
export function hookSources(
  state: GameStateInternal,
  seat: number,
  opts: {
    board?: boolean;
    arsenal?: boolean;
    equipment?: boolean;
    weapons?: boolean;
    heroLast?: boolean;
  } = {},
): CardInstance[] {
  const p = state.players[seat] as PlayerState;
  const rest: CardInstance[] = [
    ...(opts.board ? [...p.board] : []),
    ...(opts.arsenal ? p.arsenal.filter((c) =>
      !c.faceDown && scriptOf(state, c.cardId, c)?.activeWhileFaceUpInArsenal === true
    ) : []),
    ...(opts.equipment
      ? Object.values(p.equipment).filter((c): c is CardInstance => !!c && !c.faceDown)
      : []),
    ...(opts.weapons ? [...p.weapons] : []),
    ...globalHookSources(state, seat),
  ];
  if (heroAbilitiesDisabled(state, seat)) return rest;
  return opts.heroLast ? [...rest, p.hero] : [p.hero, ...rest];
}

/** Stable synthetic instances for rule-defined global objects. The ids are
 * negative so they cannot collide with ordinary monotonically allocated card
 * instances, and are reconstructed from the process registries after load. */
export function globalHookSources(state: GameStateInternal, seat: number): CardInstance[] {
  return globalCardInstances(state, seat).filter(
    (card) => state.scriptsRef[card.cardId]?.global === true,
  );
}

/** Cards outside the arena that still own an until-end-of-turn modifier.
 * Their scripts remain observable for delayed riders created by a resolved
 * card, without keeping the card itself in play. */
export function lingeringModifierSources(
  state: GameStateInternal,
  seat: number,
): CardInstance[] {
  const seen = new Set<number>();
  const cards: CardInstance[] = [];
  for (const modifier of state.modifiers) {
    if (
      modifier.seat !== seat ||
      (modifier.scope !== "until-end-of-turn" && modifier.scope !== "combat-chain") ||
      modifier.consumed
    ) continue;
    if (seen.has(modifier.sourceInstanceId)) continue;
    const found = findCardAnywhere(state, modifier.sourceInstanceId);
    if (!found || found.seat !== seat) continue;
    seen.add(found.card.instanceId);
    cards.push(found.card);
  }
  return cards;
}

/** Active arena observers plus resolved cards kept live by a temporal effect.
 * The result is stable, deduplicated by instance, and safe to snapshot before
 * hooks mutate zones or modifiers. */
export function observingHookSources(
  state: GameStateInternal,
  seat: number,
  opts: Parameters<typeof hookSources>[2] = {},
): CardInstance[] {
  const sources = new Map<number, CardInstance>();
  for (const card of hookSources(state, seat, opts)) sources.set(card.instanceId, card);
  for (const card of lingeringModifierSources(state, seat)) {
    if (!sources.has(card.instanceId)) sources.set(card.instanceId, card);
  }
  return [...sources.values()];
}

export type EventTriggerSourceZone =
  | "arena"
  | "hand"
  | "banish"
  | "graveyard"
  | "pitch"
  | "self"
  | "other";

export interface EventTriggerSource {
  card: CardInstance;
  physicalZone: EventTriggerSourceZone;
  active: boolean;
}

export function physicalEventTriggerZone(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): EventTriggerSourceZone {
  if (state.globalCardIds.includes(card.cardId)) return "arena";
  if (player.hand.some((candidate) => candidate.instanceId === card.instanceId)) return "hand";
  if (player.banish.some((candidate) => candidate.instanceId === card.instanceId)) return "banish";
  if (player.graveyard.some((candidate) => candidate.instanceId === card.instanceId)) {
    return "graveyard";
  }
  if (player.pitch.some((candidate) => candidate.instanceId === card.instanceId)) return "pitch";
  if (
    player.hero.instanceId === card.instanceId ||
    player.weapons.some((candidate) => candidate.instanceId === card.instanceId) ||
    Object.values(player.equipment).some((candidate) => candidate?.instanceId === card.instanceId) ||
    player.board.some((candidate) => candidate.instanceId === card.instanceId) ||
    player.arsenal.some((candidate) => candidate.instanceId === card.instanceId)
  ) return "arena";
  return "other";
}

export function eventTriggerSources(
  state: GameStateInternal,
  player: PlayerState,
): EventTriggerSource[] {
  const faceDownTriggerEquipment = Object.values(player.equipment).filter(
    (card): card is CardInstance =>
      !!card && card.faceDown === true &&
      scriptOf(state, card.cardId, card)?.triggersWhileFaceDown === true,
  );
  const triggerArsenal = player.arsenal.filter(
    (card) => scriptOf(state, card.cardId, card)?.activeWhileFaceUpInArsenal === true,
  );
  const active = [
    ...controlledPermanents(state, player.seat, { faceDownEquipment: false }),
    ...triggerArsenal,
    ...globalHookSources(state, player.seat),
    ...faceDownTriggerEquipment,
    ...player.hand,
    ...player.banish.filter((card) => !card.faceDown),
    ...player.graveyard.filter((card) => !card.faceDown),
    ...player.pitch,
  ];
  const sources = new Map<number, EventTriggerSource>();
  for (const card of active) {
    const physicalZone = physicalEventTriggerZone(state, player, card);
    sources.set(card.instanceId, {
      card,
      physicalZone,
      active: physicalZone === "arena",
    });
  }
  for (const card of lingeringModifierSources(state, player.seat)) {
    const existing = sources.get(card.instanceId);
    if (existing) existing.active = true;
    else {
      sources.set(card.instanceId, {
        card,
        physicalZone: physicalEventTriggerZone(state, player, card),
        active: true,
      });
    }
  }
  return [...sources.values()];
}

export function eventTriggerIsActive(
  source: EventTriggerSource,
  definition: NonNullable<CardScript["triggers"]>[number],
): boolean {
  if (definition.sourceZone === "any") return true;
  return definition.sourceZone === undefined
    ? source.active
    : definition.sourceZone === source.physicalZone;
}
