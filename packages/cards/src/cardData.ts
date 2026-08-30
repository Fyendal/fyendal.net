import type { CardData, CardType } from "@fyendal/shared";

const CARD_TYPES = new Set<CardType>([
  "hero",
  "weapon",
  "equipment",
  "action",
  "attack-reaction",
  "defense-reaction",
  "instant",
  "block",
  "resource",
  "token",
  "mentor",
]);

const CARD_KEYS = new Set([
  "id",
  "name",
  "pitch",
  "cost",
  "cardType",
  "subtypes",
  "classes",
  "attack",
  "defense",
  "keywords",
  "text",
  "backId",
  "intellect",
  "life",
  "set",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown, allowEmpty = true): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isString(item, false));
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function invalidField(card: Record<string, unknown>): string | null {
  const unknownKey = Object.keys(card).find((key) => !CARD_KEYS.has(key));
  if (unknownKey) return unknownKey;
  if (!isString(card.id, false)) return "id";
  if (!isString(card.name, false)) return "name";
  if (!CARD_TYPES.has(card.cardType as CardType)) return "cardType";
  if (!isString(card.text)) return "text";
  if (!(card.pitch === undefined || card.pitch === 1 || card.pitch === 2 || card.pitch === 3 || card.pitch === 4)) return "pitch";
  for (const field of ["cost", "attack", "defense", "intellect", "life"] as const) {
    if (!isOptionalNonNegativeInteger(card[field])) return field;
  }
  for (const field of ["subtypes", "classes", "keywords"] as const) {
    if (!(card[field] === undefined || isStringArray(card[field]))) return field;
  }
  for (const field of ["backId", "set"] as const) {
    if (!(card[field] === undefined || isString(card[field], false))) return field;
  }
  return null;
}

/** Decode imported JSON before it reaches the typed card registry. */
export function decodeCardDataList(value: unknown, source = "card data"): CardData[] {
  if (!Array.isArray(value)) throw new Error(`${source}: expected an array`);
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) throw new Error(`${source}[${index}]: expected an object`);
    const field = invalidField(candidate);
    if (field) throw new Error(`${source}[${index}].${field}: invalid card data`);
  }
  return value as CardData[];
}
