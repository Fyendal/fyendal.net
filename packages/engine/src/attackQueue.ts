/** The per-player attack queue (CR 5.3.1a / 7.2.2). Entries live in JSON-safe
 * player flags; queued attack cards wait in the resolving zone, while weapon
 * and ally attacks stay in the arena. */
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, ChainLinkState, PlayerState } from "./state.js";
import { CARD_PLAY_ORIGINS } from "./stackCore.js";
import type { CardPlayOrigin } from "./stackCore.js";

const EFFECT_ATTACK_QUEUE_HEAD = "effectAttackQueueHead";
const EFFECT_ATTACK_QUEUE_TAIL = "effectAttackQueueTail";
const ATTACK_CARD_TYPES: readonly ChainLinkState["attackCardType"][] = ["action", "weapon", "ally"];

/** A chain link announced before its attack-layer resolved, held in the
 * queue with the flags recorded when it was played. */
export type DeferredAttackLayer = {
  cardType: ChainLinkState["attackCardType"];
  flags: Record<string, number | boolean>;
};

export type QueuedAttack = {
  instanceId: number;
  targetAllyId?: number;
  cardOrigin?: CardPlayOrigin;
  layer?: DeferredAttackLayer;
};

/** Link flag: an attack resolved into the queue above this unresolved
 * attack-layer, so it reaches the chain first (CR 7.1.2a). */
export const ATTACKS_QUEUED_ABOVE_LAYER = "attacksQueuedAboveLayer";

const queueKey = (slot: number, field: string) => `effectAttackQueue:${slot}:${field}`;
const queueLinkFlagPrefix = (slot: number) => queueKey(slot, "linkFlag:");

export function enqueueAttack(player: PlayerState, entry: QueuedAttack): void {
  const tail = Number(player.flags[EFFECT_ATTACK_QUEUE_TAIL] ?? 0) + 1;
  if (Number(player.flags[EFFECT_ATTACK_QUEUE_HEAD] ?? 0) === 0) {
    player.flags[EFFECT_ATTACK_QUEUE_HEAD] = tail;
  }
  player.flags[EFFECT_ATTACK_QUEUE_TAIL] = tail;
  player.flags[queueKey(tail, "instance")] = entry.instanceId;
  if (entry.targetAllyId !== undefined) {
    player.flags[queueKey(tail, "target")] = entry.targetAllyId;
  }
  if (entry.cardOrigin !== undefined) {
    player.flags[queueKey(tail, "card")] = CARD_PLAY_ORIGINS.indexOf(entry.cardOrigin) + 1;
  }
  if (entry.layer) {
    player.flags[queueKey(tail, "layer")] = ATTACK_CARD_TYPES.indexOf(entry.layer.cardType) + 1;
    for (const [key, value] of Object.entries(entry.layer.flags)) {
      player.flags[`${queueLinkFlagPrefix(tail)}${key}`] = value;
    }
  }
}

export function dequeueAttack(player: PlayerState): QueuedAttack | undefined {
  const head = Number(player.flags[EFFECT_ATTACK_QUEUE_HEAD] ?? 0);
  const tail = Number(player.flags[EFFECT_ATTACK_QUEUE_TAIL] ?? 0);
  if (head <= 0 || tail < head) return undefined;
  const instanceKey = queueKey(head, "instance");
  const targetKey = queueKey(head, "target");
  const cardKey = queueKey(head, "card");
  const layerKey = queueKey(head, "layer");
  const instanceId = Number(player.flags[instanceKey] ?? 0);
  const target = player.flags[targetKey];
  const cardOrigin = CARD_PLAY_ORIGINS[Number(player.flags[cardKey] ?? 0) - 1];
  const layerType = ATTACK_CARD_TYPES[Number(player.flags[layerKey] ?? 0) - 1];
  const linkFlags: Record<string, number | boolean> = {};
  const linkFlagPrefix = queueLinkFlagPrefix(head);
  for (const key of Object.keys(player.flags)) {
    if (!key.startsWith(linkFlagPrefix)) continue;
    linkFlags[key.slice(linkFlagPrefix.length)] = player.flags[key] as number | boolean;
    delete player.flags[key];
  }
  delete player.flags[instanceKey];
  delete player.flags[targetKey];
  delete player.flags[cardKey];
  delete player.flags[layerKey];
  if (head === tail) {
    delete player.flags[EFFECT_ATTACK_QUEUE_HEAD];
    delete player.flags[EFFECT_ATTACK_QUEUE_TAIL];
  } else {
    player.flags[EFFECT_ATTACK_QUEUE_HEAD] = head + 1;
  }
  if (instanceId <= 0) return undefined;
  return {
    instanceId,
    ...(typeof target === "number" ? { targetAllyId: target } : {}),
    ...(cardOrigin !== undefined ? { cardOrigin } : {}),
    ...(layerType !== undefined ? { layer: { cardType: layerType, flags: linkFlags } } : {}),
  };
}

/** The objects waiting in a player's attack queue, first attack first. Cards
 * wait in the resolving zone; weapon and ally attacks stay in the arena. */
export function queuedAttackObjects(state: GameStateInternal, seat: number): CardInstance[] {
  const player = state.players[seat] as PlayerState;
  const head = Number(player.flags[EFFECT_ATTACK_QUEUE_HEAD] ?? 0);
  const tail = Number(player.flags[EFFECT_ATTACK_QUEUE_TAIL] ?? 0);
  if (head <= 0) return [];
  const objects: CardInstance[] = [];
  for (let slot = head; slot <= tail; slot++) {
    const instanceId = Number(player.flags[queueKey(slot, "instance")] ?? 0);
    const card = state.resolving.find((candidate) => candidate.instanceId === instanceId) ??
      player.weapons.find((candidate) => candidate.instanceId === instanceId) ??
      player.board.find((candidate) => candidate.instanceId === instanceId);
    if (card) objects.push(card);
  }
  return objects;
}
