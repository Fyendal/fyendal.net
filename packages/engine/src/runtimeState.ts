import type { CardData, Decklist, EquipmentSlot } from "@fyendal/shared";
import { shuffleInPlace } from "./rng.js";
import type { CardScript } from "./scripts.js";
import type { CardInstance, GameState, PlayerState } from "./state.js";

export interface GameConfig {
  /** Exactly two decklists, seat 0 and seat 1. */
  decklists: [Decklist, Decklist];
  seed: number;
  cards: Record<string, CardData>;
  scripts?: Record<string, CardScript>;
  /** Rule-defined global objects supplied by the selected format. */
  globalCardIds?: string[];
  /** Seat taking the first turn (pre-game die-roll winner's pick). Default 0. */
  startPlayer?: 0 | 1;
}

/** Trusted process registries attached to otherwise serializable game state. */
export interface GameStateInternal extends GameState {
  cardsRef: Record<string, CardData>;
  scriptsRef: Record<string, CardScript>;
}

function makePlayer(seat: number, decklist: Decklist, state: GameStateInternal): PlayerState {
  const mk = (cardId: string): CardInstance => ({
    instanceId: state.nextInstanceId++,
    cardId,
    owner: seat,
  });
  const heroCardId = decklist.heroId;
  const heroData = state.cardsRef[heroCardId];
  const player: PlayerState = {
    seat,
    hero: { ...mk(heroCardId), originalHeroCardId: heroCardId },
    heroCardId,
    life: heroData?.life ?? 20,
    intellect: heroData?.intellect ?? 4,
    hand: [],
    deck: decklist.deck.map(mk),
    arsenal: [],
    pitch: [],
    graveyard: [],
    banish: [],
    soul: [],
    inventory: (decklist.inventory ?? []).map(mk),
    board: [],
    equipment: {},
    weapons: decklist.weaponIds.map(mk),
    resources: 0,
    chi: 0,
    actionPoints: 0,
    flags: {},
  };
  for (const [slot, cardId] of Object.entries(decklist.equipment)) {
    if (!cardId) continue;
    const equipment = mk(cardId);
    const data = state.cardsRef[cardId];
    if (data?.keywords?.some((keyword) => keyword.trim().toLowerCase() === "cloaked")) {
      equipment.faceDown = true;
    }
    player.equipment[slot as EquipmentSlot] = equipment;
  }
  return player;
}

export function createGame(config: GameConfig): GameStateInternal {
  const state: GameStateInternal = {
    seed: config.seed,
    rngState: config.seed | 0,
    nextInstanceId: 1,
    nextModifierId: 1,
    globalCardIds: [...(config.globalCardIds ?? [])],
    turn: 1,
    activePlayer: config.startPlayer ?? 0,
    priorityPlayer: config.startPlayer ?? 0,
    phase: "start",
    players: [] as unknown as [PlayerState, PlayerState],
    chain: [],
    resolving: [],
    pendingDecision: null,
    pendingTokenCreations: [],
    reactionPasses: 0,
    stack: [],
    pendingTriggeredLayers: [],
    stackPasses: 0,
    stackResume: null,
    modifiers: [],
    delayedTriggers: [],
    pendingDestructions: [],
    controlReturns: [],
    extraTurnSeats: [],
    gameStats: { turns: [] },
    log: [],
    winner: null,
    cardsRef: config.cards,
    scriptsRef: config.scripts ?? {},
  };
  state.players = [
    makePlayer(0, config.decklists[0], state),
    makePlayer(1, config.decklists[1], state),
  ];
  for (const player of state.players) shuffleInPlace(state, player.deck);
  return state;
}

/** JSON-safe clone with trusted process registries reattached. */
export function cloneState(state: GameStateInternal): GameStateInternal {
  const { cardsRef, scriptsRef, ...serializable } = state;
  const copy = JSON.parse(JSON.stringify(serializable)) as GameStateInternal;
  copy.cardsRef = cardsRef;
  copy.scriptsRef = scriptsRef;
  return copy;
}
