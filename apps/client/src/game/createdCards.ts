import { cardData } from "@fyendal/cards/client";
import { isHalfCardSheetPrinting, resolveCardImageUrl } from "./cardImageUrl.js";
import { cardPreviewFaceIds } from "./cardPreviewFaces.js";

export const CREATED_PANEL_GAP = 12;
export const CREATED_PANEL_WIDTH = 272;
/** How long the pointer rests on a card before its created cards dock. */
export const CREATED_CARDS_DWELL_MS = 250;
const VIEWPORT_PADDING = 8;

const QUANTITY = /^(?:(?:an?|another|(?:twice )?that many|up to \d+|\d+ or more|one or more|one|two|three|four|five|\d+|X)\s+)?/;
const SEPARATOR = /^(?:,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)/;
const NOT_AN_INSTRUCTION = /\b(?:whenever|when|if|would|can't|cannot|haven't|hasn't|unless)\b[^,.;:"\n]*$/i;

interface NameIndex {
  /** Names grouped by their first word, longest first. */
  byFirstWord: Map<string, readonly string[]>;
  ids: Map<string, readonly string[]>;
}

let nameIndex: NameIndex | null = null;

function firstWordKey(text: string): string {
  return text.split(/\s/, 1)[0]!.replace(/[,.;:"]+$/, "");
}

function getNameIndex(): NameIndex {
  if (nameIndex) return nameIndex;
  const byFirstWord = new Map<string, string[]>();
  const ids = new Map<string, string[]>();
  for (const card of Object.values(cardData)) {
    const existing = ids.get(card.name);
    if (existing) {
      existing.push(card.id);
      continue;
    }
    ids.set(card.name, [card.id]);
    const key = firstWordKey(card.name);
    byFirstWord.set(key, [...(byFirstWord.get(key) ?? []), card.name]);
  }
  for (const group of byFirstWord.values()) group.sort((a, b) => b.length - a.length);
  nameIndex = { byFirstWord, ids };
  return nameIndex;
}

/** The card name opening `text`, longest first, and how much text it covers. */
function matchName(text: string): { name: string; length: number } | null {
  const { byFirstWord } = getNameIndex();
  const key = firstWordKey(text);
  const candidates = [
    ...(byFirstWord.get(key) ?? []),
    ...(key.endsWith("s") ? byFirstWord.get(key.slice(0, -1)) ?? [] : []),
  ];
  for (const name of candidates) {
    if (!text.startsWith(name)) continue;
    const plural = text[name.length] === "s" ? 1 : 0;
    if (!/[\p{L}\p{N}]/u.test(text[name.length + plural] ?? "")) {
      return { name, length: name.length + plural };
    }
  }
  return null;
}

/** Names of the cards a rules text tells its controller to create. */
export function createdCardNames(text: string): string[] {
  const names = new Set<string>();
  for (const verb of text.matchAll(/\bcreates?\s/gi)) {
    if (NOT_AN_INSTRUCTION.test(text.slice(0, verb.index).replace(/\bif you do\b/gi, ""))) continue;
    let rest = text.slice(verb.index + verb[0].length);
    for (;;) {
      rest = rest.replace(QUANTITY, "");
      const match = matchName(rest);
      if (!match) break;
      names.add(match.name);
      rest = rest.slice(match.length).replace(/^\s+tokens?\b/, "");
      const separator = rest.match(SEPARATOR);
      if (!separator) break;
      rest = rest.slice(separator[0].length);
    }
  }
  return [...names];
}

/** The ids that pass `keep`, or all of them when none does. */
function prefer(ids: readonly string[], keep: (id: string) => boolean): readonly string[] {
  const kept = ids.filter(keep);
  return kept.length > 0 ? kept : ids;
}

/** A name can have many printings; prefer a token with a full single-face
 * image, then the source's own set. */
function createdPrinting(name: string, sourceSet: string | undefined): string | undefined {
  let pool = prefer(getNameIndex().ids.get(name) ?? [], (id) => cardData[id]?.cardType === "token");
  pool = prefer(pool, (id) => cardPreviewFaceIds(id).length === 1);
  pool = prefer(pool, (id) => !isHalfCardSheetPrinting(id));
  return pool.find((id) => cardData[id]?.set === sourceSet) ?? pool[0];
}

const createdIdsBySource = new Map<string, readonly string[]>();

/** The cards a card's faces create, as one printing each, in text order. */
export function createdCardIds(cardId: string): readonly string[] {
  const cached = createdIdsBySource.get(cardId);
  if (cached) return cached;
  const faces = cardPreviewFaceIds(cardId).flatMap((id) => cardData[id] ?? []);
  const sourceNames = new Set(faces.map((face) => face.name));
  const ids = new Set<string>();
  for (const face of faces) {
    for (const name of createdCardNames(face.text)) {
      if (sourceNames.has(name)) continue;
      const id = createdPrinting(name, face.set);
      if (id) ids.add(id);
    }
  }
  const result = [...ids];
  createdIdsBySource.set(cardId, result);
  return result;
}

const preloadedArt = new Set<string>();

/** Warm the browser cache with the art of the cards these cards create. */
export function preloadCreatedCardArt(cardIds: Iterable<string>): void {
  if (typeof Image === "undefined") return;
  for (const cardId of cardIds) {
    for (const id of createdCardIds(cardId)) {
      const url = resolveCardImageUrl(id, cardData[id]);
      if (preloadedArt.has(url)) continue;
      preloadedArt.add(url);
      new Image().src = url;
    }
  }
}

export type CreatedCardsDock = "left" | "right" | "below";

export interface CreatedCardsPlacement {
  ids: readonly string[];
  /** Beside the preview on the side away from the hovered card, or under it. */
  dock: CreatedCardsDock;
}

/** Whether a created-cards column fits beside a preview surface this wide. */
export function createdCardsFitBeside(surfaceWidth: number, viewportWidth: number): boolean {
  return viewportWidth - VIEWPORT_PADDING * 2 - surfaceWidth - CREATED_PANEL_GAP >= CREATED_PANEL_WIDTH;
}

/** The cards a preview creates and whether their column fits beside it. */
export function createdCardsFor(
  cardId: string,
  surfaceWidth: number,
  viewportWidth: number,
): { ids: readonly string[]; beside: boolean } | null {
  const ids = createdCardIds(cardId);
  if (ids.length === 0) return null;
  return { ids, beside: createdCardsFitBeside(surfaceWidth, viewportWidth) };
}
