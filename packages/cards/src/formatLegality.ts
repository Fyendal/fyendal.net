import type { CardData, CardPoolMode, DeckPool, Format } from "@fyendal/shared";

/**
 * Product codes whose spoiled cards are implemented but not tournament-legal
 * yet. Remove a code when the product releases; imports remain usable either
 * way because release legality is checked when a game starts.
 */
export const FUTURE_SET_CODES: ReadonlySet<string> = new Set(["AMA", "AMO", "IAR", "MPA"]);

/**
 * Official policy source for this snapshot. Living Legend changes are checked
 * weekly by LSS, so this date must move whenever the lists below are refreshed.
 * https://fabtcg.com/rules-and-policy-center/card-legality-policy/
 */
export const CLASSIC_CONSTRUCTED_LEGALITY_CHECKED_ON = "2026-08-12";

/**
 * Silver Age season snapshot beginning with the Usurp the Shadow Throne
 * pre-release. Refresh the benched-hero and banned-card lists together when
 * the next standalone booster season begins.
 * https://fabtcg.com/rules-and-policy-center/card-legality-policy/
 */
export const SILVER_AGE_LEGALITY_CHECKED_ON = "2026-09-18";

const LIVING_LEGEND_HEROES = new Set([
  "aurora, shooting star",
  "azalea, ace in the hole",
  "bravo, star of the show",
  "briar, warden of thorns",
  "chane, bound by shadow",
  "dash, inventor extraordinaire",
  "dromai, ash artist",
  "enigma, ledger of ancestry",
  "florian, rotwood harbinger",
  "iyslander, stormbind",
  "kano, dracai of aether",
  "kayo, armed and dangerous",
  "lexi, livewire",
  "nuu, alluring desire",
  "oldhim, grandfather of eternity",
  "prism, awakener of sol",
  "prism, sculptor of arc light",
  "verdance, thorn of the rose",
  "victor goldmane, high and mighty",
  "viserai, rune blood",
  "zen, tamer of purpose",
]);

const LIVING_LEGEND_WEAPONS = new Set([
  "star fall",
  "death dealer",
  "rosetta thorn",
  "galaxxi black",
  "teklo plasma pistol",
  "storm of sandikai",
  "cosmo, scroll of ancestral tapestry",
  "rotwood reaper",
  "kraken's aethervein",
  "crucible of aetherweave",
  "mandible claw",
  "voltaire, strike twice",
  "beckoning mistblade",
  "winter's wail",
  "luminaris, angel's glow",
  "luminaris, celestial fury",
  "luminaris",
  "staff of verdant shoots",
  "miller's grindstone",
  "nebula blade",
  "tiger taming khakkara",
]);

/** Classic Constructed cards banned at every pitch. */
const CLASSIC_CONSTRUCTED_BANNED_CARD_NAMES = new Set([
  "art of war",
  "awakening",
  "ball lightning",
  "belittle",
  "berserk",
  "bloodsheath skeleta",
  "bonds of agony",
  "cash in",
  "channel lightning valley",
  "chart the high seas",
  "count your blessings",
  "crown of seeds",
  "drone of brutality",
  "duskblade",
  "entwine lightning",
  "high octane",
  "orihon of mystic tenets",
  "phantom tidemaw",
  "plume of evergrowth",
  "plunder run",
  "reaping blade",
  "remembrance",
  "stubby hammerers",
  "tome of aetherwind",
  "tome of divinity",
  "tome of fyendal",
  "tome of firebrand",
  "volzar, the lightning rod",
  "wrath of retribution",
  "zephyr needle",
]);

const CLASSIC_CONSTRUCTED_BANNED_FUNCTIONAL_KEYS = new Set([
  "bonds of ancestry|2",
  "bonds of ancestry|3",
  "electromagnetic somersault|1",
  "electromagnetic somersault|2",
  "golden tipple|1",
  "golden tipple|2",
  "orb-weaver spinneret|2",
  "orb-weaver spinneret|3",
]);

const SILVER_AGE_BENCHED_HERO_NAMES = new Set([
  "chane",
  "briar",
  "oldhim",
  "oscilio",
]);

/** Silver Age bans apply to every pitch of the named card. */
const SILVER_AGE_BANNED_CARD_NAMES = new Set([
  "absorb in aether",
  "aether flare",
  "aether ironweave",
  "ball lightning",
  "beaten trackers",
  "belittle",
  "bonds of ancestry",
  "bracers of belief",
  "count your blessings",
  "deadwood dirge",
  "drone of brutality",
  "ebon fold",
  "electromagnetic somersault",
  "emeritus scolding",
  "fate foreseen",
  "fiddler's green",
  "flic flak",
  "goliath gauntlet",
  "harmonized kodachi",
  "heartened cross strap",
  "honing hood",
  "lightning press",
  "mask of three tails",
  "nimby",
  "old knocker",
  "plunder run",
  "pulping",
  "ragamuffin's hat",
  "reality refractor",
  "reaping blade",
  "rosetta thorn",
  "sigil of solace",
  "sigil of suffering",
  "sink below",
  "snapback",
  "snapdragon scalers",
  "stubby hammerers",
  "vest of the first fist",
  "volzar, the lightning rod",
  "waning moon",
  "zephyr needle",
]);

const PITCH_NAMES: Record<NonNullable<CardData["pitch"]>, string> = {
  1: "Red",
  2: "Yellow",
  3: "Blue",
  4: "Colorless",
};

export type FormatLegalityIssue = {
  kind:
    | "living-legend-hero"
    | "living-legend-weapon"
    | "benched-hero"
    | "banned-card"
    | "future-card";
  cardId: string;
  cardName: string;
  message: string;
};

function normalizedName(card: CardData): string {
  return card.name.trim().toLowerCase();
}

function uniquePoolIds(pool: DeckPool): string[] {
  return [...new Set([
    pool.heroId,
    ...pool.weaponIds,
    ...pool.equipmentPool,
    ...(pool.inventoryPool ?? []),
    ...pool.deck,
    ...(pool.sideboard ?? []),
  ])];
}

/** Return every tracked ban-list, Living Legend, or release violation in a card-pool. */
export function formatLegalityIssues(
  cards: Record<string, CardData>,
  pool: DeckPool,
  format: Format,
  options: { cardPoolMode?: CardPoolMode } = {},
): FormatLegalityIssue[] {
  const mode = options.cardPoolMode ?? "legal";
  const issues: FormatLegalityIssue[] = [];
  for (const id of uniquePoolIds(pool)) {
    const card = cards[id];
    if (!card) continue;
    const name = normalizedName(card);
    if (
      mode !== "open" &&
      format === "silver-age" &&
      id === pool.heroId &&
      SILVER_AGE_BENCHED_HERO_NAMES.has(name)
    ) {
      issues.push({
        kind: "benched-hero",
        cardId: id,
        cardName: card.name,
        message: `${card.name} is benched and not legal in Silver Age`,
      });
      continue;
    }
    if (mode !== "open" && format === "cc" && id === pool.heroId && LIVING_LEGEND_HEROES.has(name)) {
      issues.push({
        kind: "living-legend-hero",
        cardId: id,
        cardName: card.name,
        message: `${card.name} has Living Legend status and is not legal in Classic Constructed`,
      });
      continue;
    }
    if (mode !== "open" && format === "cc" && card.cardType === "weapon" && LIVING_LEGEND_WEAPONS.has(name)) {
      issues.push({
        kind: "living-legend-weapon",
        cardId: id,
        cardName: card.name,
        message: `${card.name} is a Living Legend signature weapon and is not legal in Classic Constructed`,
      });
      continue;
    }
    const bannedAtEveryPitch = CLASSIC_CONSTRUCTED_BANNED_CARD_NAMES.has(name);
    const bannedAtThisPitch = CLASSIC_CONSTRUCTED_BANNED_FUNCTIONAL_KEYS.has(`${name}|${card.pitch ?? 0}`);
    if (mode !== "open" && format === "cc" && (bannedAtEveryPitch || bannedAtThisPitch)) {
      const pitchLabel = !bannedAtEveryPitch && card.pitch ? ` (${PITCH_NAMES[card.pitch]})` : "";
      issues.push({
        kind: "banned-card",
        cardId: id,
        cardName: card.name,
        message: `${card.name}${pitchLabel} is banned in Classic Constructed`,
      });
      continue;
    }
    if (mode !== "open" && format === "silver-age" && SILVER_AGE_BANNED_CARD_NAMES.has(name)) {
      issues.push({
        kind: "banned-card",
        cardId: id,
        cardName: card.name,
        message: `${card.name} is banned in Silver Age`,
      });
      continue;
    }
    if (mode === "legal" && card.set && FUTURE_SET_CODES.has(card.set)) {
      issues.push({
        kind: "future-card",
        cardId: id,
        cardName: card.name,
        message: `${card.name} is from the unreleased ${card.set} set`,
      });
    }
  }
  return issues;
}

export function formatLegalityErrors(
  cards: Record<string, CardData>,
  pool: DeckPool,
  format: Format,
  options: { cardPoolMode?: CardPoolMode } = {},
): string[] {
  return formatLegalityIssues(cards, pool, format, options).map((issue) => issue.message);
}
