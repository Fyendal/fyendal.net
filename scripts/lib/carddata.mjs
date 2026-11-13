/**
 * Shared dataset→CardData conversion for the card import scripts
 * (source: the-fab-cube/flesh-and-blood-cards, json/english/card.json).
 *
 * `toCardData(c, printing)` converts one dataset card + chosen printing to the
 * CardData shape used by packages/cards. Callers pick the printing themselves;
 * when it is undefined the id falls back to c.unique_id. import-set.mjs always
 * passes the printing of the set being imported.
 */
export const CLASS_NAMES = new Set([
  "Brute", "Warrior", "Generic", "Guardian", "Ninja", "Wizard", "Ranger",
  "Mechanologist", "Runeblade", "Assassin", "Illusionist", "Bard", "Merchant",
  "Shapeshifter", "Pirate", "Dragon", "Revolutionary", "Adjudicator", "Agent",
  "Chaos", "Royal", "Mystic",
]);
export const TYPE_WORDS = new Set([
  "Hero", "Weapon", "Equipment", "Action", "Attack Reaction",
  "Defense Reaction", "Instant", "Resource", "Mentor", "Token",
  "Young", "Adult", "Block", "Demi-Hero",
]);

// Upstream type words -> CardType, in CARD_TYPE_ORDER (packages/shared).
const TYPE_MAP = [
  // a demi-hero is the player's hero in-game when they control no other hero
  // (CR 8.1.11b) — imported as a hero (Arakni, Web of Deceit)
  [["Hero", "Demi-Hero"], "hero"],
  [["Weapon"], "weapon"],
  [["Equipment"], "equipment"],
  [["Attack Reaction"], "attack-reaction"],
  [["Defense Reaction"], "defense-reaction"],
  [["Instant"], "instant"],
  [["Resource"], "resource"],
  [["Block"], "block"],
  [["Mentor"], "mentor"],
  // Macro cards are shared arena objects supplied by a limited environment,
  // not deck cards; tokens keep them out of the playable deck pool.
  [["Token", "Macro"], "token"],
  // Allies are arena permanents represented as action cards with the "ally"
  // subtype.
  [["Action", "Ally"], "action"],
];

/** Every printed type of an upstream card, in canonical order. */
export function cardTypesOf(types, keywords = []) {
  const result = TYPE_MAP
    .filter(([words]) => words.some((word) => types.includes(word)))
    .map(([, type]) => type);
  if (result.length) return result;
  // Some reminder/marker cards in the upstream dataset (for example Marked)
  // omit their printed type line entirely. They are non-deck token cards.
  if (types.length === 0 && keywords.includes("Mark")) return ["token"];
  throw new Error(`no card type in ${types}`);
}

/** The primary type that keys card art (the first canonical type). */
export function primaryTypeOf(types, keywords = []) {
  return cardTypesOf(types, keywords)[0];
}

const num = (v) => {
  if (v === "" || v == null) return undefined;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function toCardData(c, printing) {
  const types = c.types;
  const data = {
    id: printing?.id ?? c.unique_id,
    name: c.name,
    types: cardTypesOf(types, c.card_keywords ?? []),
    text: c.functional_text_plain ?? "",
  };
  const pitch = num(c.pitch);
  if (pitch) data.pitch = pitch;
  const cost = num(c.cost);
  if (cost !== undefined) data.cost = cost;
  const attack = num(c.power);
  if (attack !== undefined) data.attack = attack;
  const defense = num(c.defense);
  if (defense !== undefined) data.defense = defense;
  const classes = types.filter((t) => CLASS_NAMES.has(t)).map((s) => s.toLowerCase());
  if (classes.length) data.classes = classes;
  const subtypes = types
    .filter((t) => !CLASS_NAMES.has(t) && !TYPE_WORDS.has(t))
    .map((s) => s.toLowerCase());
  if (subtypes.length) data.subtypes = subtypes;
  if ((c.card_keywords ?? []).length) data.keywords = c.card_keywords;
  const life = num(c.health);
  if (life !== undefined) data.life = life;
  const intellect = num(c.intelligence);
  if (intellect !== undefined) data.intellect = intellect;
  if (printing?.set_id) data.set = printing.set_id;
  return data;
}
