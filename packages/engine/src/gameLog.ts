import type { GameLogPayload } from "@fyendal/shared";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, GameLogEntry, PlayerState } from "./state.js";

function publicLogCardIds(state: GameStateInternal): Set<string> {
  const ids = new Set<string>();
  const add = (card: CardInstance | null | undefined): void => {
    if (!card || card.faceDown) return;
    ids.add(card.cardId);
    for (const subcard of card.subcards ?? []) add(subcard);
  };
  for (const player of state.players as PlayerState[]) {
    add(player.hero);
    player.weapons.forEach(add);
    Object.values(player.equipment).forEach(add);
    player.board.forEach(add);
    player.arsenal.forEach(add);
    player.pitch.forEach(add);
    player.graveyard.forEach(add);
    player.banish.forEach(add);
    player.soul.forEach(add);
  }
  for (const link of state.chain) {
    add(link.attackingCard);
    link.defendingCards.forEach(add);
    link.defendingEquipment.forEach(add);
    link.reactions.forEach(add);
  }
  for (const layer of state.stack) add(layer.card);
  return ids;
}

/** Keep the readable sentence contiguous for non-visual consumers while
 * retaining exact-printing metadata in a hidden suffix for the client. */
function moveLogCardTagsToEnd(text: string): string {
  const cardIds: string[] = [];
  const visibleText = text.replace(/⟦([A-Z0-9]+)⟧/g, (_tag, cardId: string) => {
    cardIds.push(cardId);
    return "";
  });
  return cardIds.length === 0
    ? text
    : `${visibleText}${cardIds.map((cardId) => `⟦${cardId}⟧`).join("")}`;
}

function appendLog(state: GameStateInternal, entry: GameLogEntry): void {
  const publicCardIds = publicLogCardIds(state);
  const tagPublic = (text: string): string => moveLogCardTagsToEnd(
    tagKnownLogCardNames(state, text, publicCardIds),
  );
  const publicText = entry.publicText === null ? null : tagPublic(entry.publicText);
  const seatText = entry.seatText?.map((text) =>
    text === null ? null : moveLogCardTagsToEnd(text)
  ) as [string | null, string | null] | undefined;
  const publicPayload = entry.publicPayload
    ? { ...entry.publicPayload, fallback: tagPublic(entry.publicPayload.fallback) }
    : undefined;
  const seatPayloads = entry.seatPayloads?.map((payload) =>
    payload === null
      ? null
      : { ...payload, fallback: moveLogCardTagsToEnd(payload.fallback) }
  ) as [GameLogPayload | null, GameLogPayload | null] | undefined;
  const structured = publicPayload !== undefined || seatPayloads !== undefined;
  const sequence = structured
    ? entry.sequence ?? state.nextLogSequence ?? 1
    : undefined;
  if (sequence !== undefined) {
    state.nextLogSequence = Math.max(state.nextLogSequence ?? 1, sequence + 1);
  }
  state.log.push({
    publicText,
    ...(seatText ? { seatText } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
    ...(publicPayload !== undefined ? { publicPayload } : {}),
    ...(seatPayloads ? { seatPayloads } : {}),
  });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

export function logPublic(state: GameStateInternal, entry: string | GameLogPayload): void {
  appendLog(state, typeof entry === "string"
    ? { publicText: entry }
    : { publicText: entry.fallback, publicPayload: entry });
}

export function logPrivate(
  state: GameStateInternal,
  seat: number,
  privateEntry: string | GameLogPayload,
  publicEntry?: string | GameLogPayload,
): void {
  const seatText: [string | null, string | null] = [null, null];
  seatText[seat] = typeof privateEntry === "string" ? privateEntry : privateEntry.fallback;
  const seatPayloads: [GameLogPayload | null, GameLogPayload | null] = [null, null];
  if (typeof privateEntry !== "string") seatPayloads[seat] = privateEntry;
  appendLog(state, {
    publicText: publicEntry === undefined
      ? null
      : typeof publicEntry === "string"
        ? publicEntry
        : publicEntry.fallback,
    seatText,
    ...(typeof privateEntry !== "string" ? { seatPayloads } : {}),
    ...(publicEntry !== undefined && typeof publicEntry !== "string"
      ? { publicPayload: publicEntry }
      : {}),
  });
}

export function logForSeats(state: GameStateInternal, entry: GameLogEntry): void {
  appendLog(state, {
    publicText: entry.publicText,
    ...(entry.seatText
      ? { seatText: [...entry.seatText] as [string | null, string | null] }
      : {}),
  });
}

export function nameOf(state: GameStateInternal, cardId: string): string {
  return state.cardsRef[cardId]?.name ?? cardId;
}

/** Encode the exact red/yellow/blue printing in human-readable log text.
 * Clients hide the tag while using it to resolve the correct card image. */
export function logNameOf(state: GameStateInternal, cardId: string): string {
  const data = state.cardsRef[cardId];
  if (!data) return cardId;
  return data.pitch === 1 || data.pitch === 2 || data.pitch === 3
    ? `${data.name}⟦${cardId}⟧`
    : data.name;
}

export function tagKnownLogCardNames(
  state: GameStateInternal,
  text: string,
  cardIds: ReadonlySet<string>,
): string {
  const cardIdByName = new Map<string, string | null>();
  for (const cardId of cardIds) {
    const data = state.cardsRef[cardId];
    if (!data || (data.pitch !== 1 && data.pitch !== 2 && data.pitch !== 3)) continue;
    const existing = cardIdByName.get(data.name);
    if (existing === undefined) cardIdByName.set(data.name, cardId);
    else if (existing !== cardId) cardIdByName.set(data.name, null);
  }
  const names = [...cardIdByName]
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .sort(([a], [b]) => b.length - a.length);
  if (names.length === 0) return text;
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${names.map(([name]) => escape(name)).join("|")})(?![\\p{L}\\p{N}]|⟦)`,
    "gu",
  );
  return text.replace(pattern, (_match, prefix: string, name: string) =>
    `${prefix}${name}⟦${cardIdByName.get(name)}⟧`
  );
}
