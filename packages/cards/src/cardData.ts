import { CARD_TYPE_ORDER, type CardData, type CardType } from "@fyendal/shared";

const CARD_TYPES = new Set<CardType>(CARD_TYPE_ORDER);

const CARD_KEYS = new Set([
  "id",
  "name",
  "color",
  "pitch",
  "cost",
  "types",
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

/** A non-empty list of distinct card types in canonical order. */
function validTypes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every((type) => CARD_TYPES.has(type as CardType))) return false;
  const order = value.map((type) => CARD_TYPE_ORDER.indexOf(type as CardType));
  return order.every((rank, index) => index === 0 || rank > order[index - 1]!);
}

function invalidField(card: Record<string, unknown>): string | null {
  const unknownKey = Object.keys(card).find((key) => !CARD_KEYS.has(key));
  if (unknownKey) return unknownKey;
  if (!isString(card.id, false)) return "id";
  if (!isString(card.name, false)) return "name";
  if (!validTypes(card.types)) return "types";
  if (!isString(card.text)) return "text";
  if (!(card.color === undefined || card.color === 1 || card.color === 2 || card.color === 3 || card.color === 4)) return "color";
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
