/**
 * Shared dataset→CardData conversion for generate-cards.mjs and import-set.mjs
 * (source: the-fab-cube/flesh-and-blood-cards, json/english/card.json).
 *
 * `toCardData(c, printing)` converts one dataset card + chosen printing to the
 * CardData shape used by packages/cards. Callers pick the printing themselves:
 * generate-cards.mjs prefers the Classic Battles box sets (DVR/RNR) and may
 * pass undefined (id then falls back to c.unique_id); import-set.mjs always
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

export function cardTypeOf(types, keywords = []) {
  // a demi-hero is the player's hero in-game when they control no other hero
  // (CR 8.1.11b) — imported as a hero (Arakni, Web of Deceit)
  if (types.includes("Hero") || types.includes("Demi-Hero")) return "hero";
  if (types.includes("Weapon")) return "weapon";
  if (types.includes("Equipment")) return "equipment";
  if (types.includes("Attack Reaction")) return "attack-reaction";
  if (types.includes("Defense Reaction")) return "defense-reaction";
  if (types.includes("Instant")) return "instant";
  if (types.includes("Resource")) return "resource";
  if (types.includes("Block")) return "block";
  if (types.includes("Mentor")) return "mentor";
  if (types.includes("Token")) return "token";
  // Macro cards are shared arena objects supplied by a limited environment,
  // not deck cards. Represent them as tokens so they can live in the card
  // registry without being mistaken for playable actions.
  if (types.includes("Macro")) return "token";
  // Allies are arena permanents represented by the engine as action cards
  // with the "ally" subtype.
  if (types.includes("Ally")) return "action";
  if (types.includes("Action")) return "action";
  // Some reminder/marker cards in the upstream dataset (for example Marked)
  // omit their printed type line entirely. They are non-deck token cards.
  if (types.length === 0 && keywords.includes("Mark")) return "token";
  throw new Error(`no card type in ${types}`);
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
    cardType: cardTypeOf(types, c.card_keywords ?? []),
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
