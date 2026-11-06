import { cardData } from "@fyendal/cards/client";
import { CARD_IMAGE_ASPECT_RATIO } from "./Card.js";
import { cardPreviewFaceIds } from "./cardPreviewFaces.js";

export const CREATED_PANEL_GAP = 12;
const PANEL_CHROME_WIDTH = 18;
const PANEL_CHROME_HEIGHT = 46;
const PANEL_CARD_GAP = 8;
const MULTI_CARD_MAX_SCALE = 0.72;
const MIN_CARD_WIDTH = 110;
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

/** A name can have many printings; prefer a token, then the source's own set. */
function createdPrinting(name: string, sourceSet: string | undefined): string | undefined {
  const ids = getNameIndex().ids.get(name) ?? [];
  const tokens = ids.filter((id) => cardData[id]?.cardType === "token");
  const named = tokens.length > 0 ? tokens : ids;
  const singleFaced = named.filter((id) => cardPreviewFaceIds(id).length === 1);
  const pool = singleFaced.length > 0 ? singleFaced : named;
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

export interface CreatedCardsLayout {
  columns: number;
  cardWidth: number;
  cardHeight: number;
  width: number;
  height: number;
}

/** Largest grid that keeps the panel no taller than the card it sits beside. */
export function createdCardsLayout(
  count: number,
  faceHeight: number,
  maxWidth: number,
): CreatedCardsLayout | null {
  if (count === 0) return null;
  const heightLimit = count === 1 ? Infinity : faceHeight * MULTI_CARD_MAX_SCALE;
  let best: CreatedCardsLayout | null = null;
  for (let rows = 1; rows <= count; rows += 1) {
    const columns = Math.ceil(count / rows);
    const widthEach = (maxWidth - PANEL_CHROME_WIDTH - PANEL_CARD_GAP * (columns - 1)) / columns;
    const heightEach = (faceHeight - PANEL_CHROME_HEIGHT - PANEL_CARD_GAP * (rows - 1)) / rows;
    const cardHeight = Math.floor(
      Math.min(widthEach / CARD_IMAGE_ASPECT_RATIO, heightEach, heightLimit),
    );
    const cardWidth = Math.round(cardHeight * CARD_IMAGE_ASPECT_RATIO);
    if (cardWidth < MIN_CARD_WIDTH || (best && cardHeight <= best.cardHeight)) continue;
    best = {
      columns,
      cardWidth,
      cardHeight,
      width: PANEL_CHROME_WIDTH + cardWidth * columns + PANEL_CARD_GAP * (columns - 1),
      height: PANEL_CHROME_HEIGHT + cardHeight * rows + PANEL_CARD_GAP * (rows - 1),
    };
  }
  return best;
}

export interface CreatedCardsPlacement {
  ids: readonly string[];
  layout: CreatedCardsLayout;
  side: "left" | "right";
}

/** Size the created-cards panel for a preview, or nothing when none fits. */
export function createdCardsFor(
  cardId: string,
  surface: { width: number; height: number },
  viewportWidth: number,
): Omit<CreatedCardsPlacement, "side"> | null {
  const ids = createdCardIds(cardId);
  const layout = createdCardsLayout(
    ids.length,
    surface.height,
    viewportWidth - VIEWPORT_PADDING * 2 - surface.width - CREATED_PANEL_GAP,
  );
  return layout ? { ids, layout } : null;
}
