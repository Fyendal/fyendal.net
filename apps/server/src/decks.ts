import { randomBytes } from "node:crypto";
import type { DeckPool, EquipmentSlot, Format } from "@fyendal/shared";
import {
  cardData,
  equipmentFitsSlot,
  findPrinting,
  isImplemented,
  MIN_DECK_SIZE,
  normalizeCardName,
  precon,
} from "@fyendal/cards";
import type { FabraryMatchup } from "@fyendal/protocol";
export { validatePresentation } from "@fyendal/cards";
import type { Queryable } from "./db.js";
import type { FabraryClient, FabraryDeckResult } from "./fabrary.js";

/**
 * Saved user decks ("cc" / "silver-age" formats). Users import Fabrary export
 * text; we resolve every line against the card pool, validate the result and
 * store the resolved DeckPool (printing ids) — the registered pool a player
 * sideboards from in the pre-game prep room. Decks containing cards that are
 * unknown or not yet implemented are rejected with the full list.
 */

export interface DeckRow {
  id: string;
  userId: number;
  name: string;
  format: Format;
  fabraryUrl: string | null;
  decklist: DeckPool;
  /** display-only, derived from the hero printing */
  heroName: string;
  createdAt: number;
  updatedAt: number;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const PITCH_WORDS: Record<string, number> = {
  red: 1,
  yellow: 2,
  yel: 2,
  blue: 3,
  blu: 3,
  purple: 4,
  pur: 4,
};

type Section = "hero" | "deck" | "sideboard";

interface ParsedLine {
  qty: number;
  name: string;
  pitch?: number;
  section: Section;
}

/** Largest quantity one export line may claim (pools max out at 80 cards). */
const MAX_LINE_QTY = 99;

/**
 * Tolerant parser for decklist export text (Fabrary "copy decklist" and
 * similar). Understands `Nx Card Name` lines with an optional pitch suffix
 * (`(red)` / `(yellow)` / `(blue)` / `(purple)` / `(1|2|3|4)`), section headers
 * (`Hero:`, `Weapons:`, `Equipment:`, `Deck:`, `Sideboard:`…), and skips
 * comments/blank lines. Card classification ultimately comes from our own
 * card data (a weapon listed under "Deck:" is still a weapon).
 */
export function parseDecklistText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let section: Section = "deck";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const bareSection = /^(arena|deck|main|sideboard|maybeboard) cards?$/i.exec(line);
    if (bareSection) {
      section = /^(sideboard|maybeboard)$/i.test(bareSection[1]!) ? "sideboard" : "deck";
      continue;
    }
    if (
      /^made with love at (?:the )?fabrary$/i.test(line) ||
      /^see the full deck\s*@\s*https?:\/\/(?:www\.)?fabrary\.net\/decks\//i.test(line)
    ) continue;
    const header = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(line);
    if (header) {
      const h = header[1]!.toLowerCase();
      const rest = header[2]!;
      if (h === "name" || h === "format") continue;
      if (/^(hero|heroes)/.test(h)) section = "hero";
      else if (/^(sideboard|side)/.test(h)) section = "sideboard";
      else if (/^(deck|main|weapon|equipment|arena)/.test(h)) section = "deck";
      else continue;
      if (!rest) continue;
      // "Hero: Rhinar, Reckless Rampage" — header and value on one line
      out.push({ qty: 1, name: rest, section });
      continue;
    }
    const m = /^(\d+)\s*x?\s+(.+?)(?:\s*\((red|yellow|yel|blue|blu|purple|pur|[1234])\))?\s*$/i.exec(line);
    if (!m) {
      // bare card name (a hero line without a header)
      out.push({ qty: 1, name: line, section });
      continue;
    }
    const pitchRaw = m[3]?.toLowerCase();
    const pitch = pitchRaw
      ? (PITCH_WORDS[pitchRaw] ?? Number(pitchRaw))
      : undefined;
    // Clamp absurd quantities at parse time: validateDeck expands qty into
    // per-copy array pushes, so an unclamped "999999999x …" line is a DoS.
    // Anything over the cap still fails validation (copies/pool-size limits).
    out.push({ qty: Math.min(Number(m[1]), MAX_LINE_QTY), name: m[2]!, pitch, section });
  }
  return out;
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Maximum registered pool size (all non-hero cards: weapons + equipment +
 *  deck + sideboard). */
const MAX_POOL_SIZE: Record<"cc" | "silver-age", number> = {
  cc: 80,
  "silver-age": 55,
};
/** Weapons a player may present for one game: up to 2 one-hand weapons, or a
 *  single two-hand weapon alone — except that a quiver may accompany a
 *  two-hander bow (CR 8.2.15a; at most one quiver, 8.2.15b). */
const MAX_COPIES = 3;
const EQUIPMENT_SLOTS: EquipmentSlot[] = ["head", "chest", "arms", "legs"];
const INVENTORY_FRONT_ID_BY_BACK_ID = new Map(
  Object.values(cardData).flatMap((card) => card.backId ? [[card.backId, card.id] as const] : []),
);

export type ValidationResult =
  | { ok: true; decklist: DeckPool; heroName: string }
  | { ok: false; errors: string[]; missing: string[]; unimplemented: string[] };

/**
 * Resolve parsed lines against the card pool and validate its stable shape.
 * Strict on purpose: every card must resolve AND be implemented (scripted or
 * curated vanilla) — the missing/unimplemented lists double as the card
 * implementation TODO. The result is the registered pool (DeckPool); in-game
 * legality of the presented 60/40 is checked per game by validatePresentation.
 */
export function validateDeck(lines: ParsedLine[], format: Format): ValidationResult {
  const missing = new Set<string>();
  const unimplemented = new Set<string>();
  const errors: string[] = [];

  let heroId = "";
  let heroName = "";
  const weaponIds: string[] = [];
  const equipmentPool: string[] = [];
  const inventoryPool: string[] = [];
  const deck: string[] = [];
  const sideboard: string[] = [];
  const copies = new Map<string, number>(); // functional identity → count

  for (const line of lines) {
    const card = findPrinting(line.name, line.pitch);
    if (!card) {
      missing.add(line.name);
      continue;
    }
    if (!isImplemented(card)) {
      unimplemented.add(card.name);
      continue;
    }
    if (card.cardType === "hero") {
      // Demi-heroes are registered inventory cards despite sharing the hero
      // card type. Fabrary lists Levia, Redeemed among arena cards alongside
      // Levia's starting hero, so it must not be mistaken for a second hero.
      if (/\bwhile this is in your inventory\b/i.test(card.text)) {
        // Fabrary may identify the back face of a double-faced inventory card.
        // Store its front face so transformation hooks see the physical card in
        // the orientation they expect (Levia, Redeemed -> Blasmophet).
        const inventoryId = INVENTORY_FRONT_ID_BY_BACK_ID.get(card.id) ?? card.id;
        for (let i = 0; i < line.qty; i++) inventoryPool.push(inventoryId);
        continue;
      }
      if (heroId) {
        errors.push(`multiple heroes (${heroName}, ${card.name})`);
        continue;
      }
      heroId = card.id;
      heroName = card.name;
      continue;
    }
    if (card.cardType === "weapon") {
      for (let i = 0; i < line.qty; i++) weaponIds.push(card.id);
      continue;
    }
    // Evos are playable equipment cards: they begin in the main deck and are
    // equipped only after being played. Arena equipment has no `evo` subtype
    // and belongs in the registered equipment pool.
    if (card.cardType === "equipment" && !card.subtypes?.includes("evo")) {
      // off-hand / quiver equipment occupies a weapon slot (CR) — it joins the
      // weapons
      const slot = EQUIPMENT_SLOTS.find((s) => equipmentFitsSlot(card, s));
      if (!slot) {
        if (card.subtypes?.includes("off-hand") || card.subtypes?.includes("quiver")) {
          for (let i = 0; i < line.qty; i++) weaponIds.push(card.id);
          continue;
        }
        errors.push(`${card.name}: unknown equipment slot`);
        continue;
      }
      for (let i = 0; i < line.qty; i++) equipmentPool.push(card.id);
      continue;
    }
    if (card.cardType === "token") {
      errors.push(`${card.name} is a token and cannot be in a deck`);
      continue;
    }
    const target = line.section === "sideboard" ? sideboard : deck;
    for (let i = 0; i < line.qty; i++) target.push(card.id);
    const unlimited = card.keywords?.some(
      (keyword) => keyword.trim().toLowerCase() === "unlimited",
    ) === true;
    if (!unlimited) {
      const key = normalizeCardName(card.name) + "|" + (card.pitch ?? 0);
      copies.set(key, (copies.get(key) ?? 0) + line.qty);
    }
  }

  if (!heroId) errors.push("no hero found in the decklist");
  for (const [key, n] of copies) {
    if (n > MAX_COPIES) errors.push(`too many copies of ${key.split("|")[0]} (${n}, max ${MAX_COPIES})`);
  }
  const min = MIN_DECK_SIZE[format];
  if (min && deck.length + sideboard.length < min) {
    errors.push(
      `card pool too small (${deck.length + sideboard.length} main-deck cards, ${format} requires at least ${min})`,
    );
  }
  const max = MAX_POOL_SIZE[format as "cc" | "silver-age"];
  const poolSize = weaponIds.length + equipmentPool.length + inventoryPool.length + deck.length + sideboard.length;
  if (max && poolSize > max) {
    errors.push(`card pool too large (${poolSize} cards, ${format} allows at most ${max})`);
  }
  if (missing.size || unimplemented.size || errors.length) {
    return {
      ok: false,
      errors,
      missing: [...missing],
      unimplemented: [...unimplemented],
    };
  }
  return {
    ok: true,
    decklist: {
      heroId,
      weaponIds,
      equipmentPool,
      ...(inventoryPool.length > 0 ? { inventoryPool } : {}),
      deck,
      sideboard,
    },
    heroName,
  };
}

// ── Storage ─────────────────────────────────────────────────────────────────

const MAX_DB_STRING = 256;
const MAX_DB_URL = 2_048;

function corruptDeck(path: string, detail: string): never {
  throw new Error(`corrupt deck row at ${path}: ${detail}`);
}

function dbObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return corruptDeck(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function dbString(value: unknown, path: string, max = MAX_DB_STRING): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    return corruptDeck(path, `expected a non-empty string of at most ${max} characters`);
  }
  return value;
}

function dbStringArray(value: unknown, path: string, max = 100): string[] {
  if (!Array.isArray(value) || value.length > max) {
    return corruptDeck(path, `expected an array of at most ${max} card ids`);
  }
  return value.map((item, index) => dbString(item, `${path}[${index}]`));
}

function decodeDeckPool(value: unknown): DeckPool {
  const pool = dbObject(value, "decklist");
  const allowed = new Set(["heroId", "weaponIds", "equipmentPool", "inventoryPool", "deck", "sideboard"]);
  if (Object.keys(pool).some((key) => !allowed.has(key))) {
    return corruptDeck("decklist", "unknown field");
  }
  for (const key of ["heroId", "weaponIds", "equipmentPool", "deck"] as const) {
    if (!(key in pool)) return corruptDeck(`decklist.${key}`, "missing field");
  }
  return {
    heroId: dbString(pool.heroId, "decklist.heroId"),
    weaponIds: dbStringArray(pool.weaponIds, "decklist.weaponIds"),
    equipmentPool: dbStringArray(pool.equipmentPool, "decklist.equipmentPool"),
    ...(pool.inventoryPool === undefined
      ? {}
      : { inventoryPool: dbStringArray(pool.inventoryPool, "decklist.inventoryPool") }),
    deck: dbStringArray(pool.deck, "decklist.deck"),
    ...(pool.sideboard === undefined
      ? {}
      : { sideboard: dbStringArray(pool.sideboard, "decklist.sideboard") }),
  };
}

function dbSafeInteger(value: unknown, path: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    return corruptDeck(path, "expected a non-negative safe integer");
  }
  return number;
}

function toDeck(value: unknown): DeckRow {
  const r = dbObject(value, "row");
  if (!(r.format === "cc" || r.format === "silver-age")) {
    return corruptDeck("format", "expected cc or silver-age");
  }
  if (!(r.fabrary_url === null || typeof r.fabrary_url === "string" && r.fabrary_url.length <= MAX_DB_URL)) {
    return corruptDeck("fabrary_url", `expected null or a string of at most ${MAX_DB_URL} characters`);
  }
  return {
    id: dbString(r.id, "id"),
    userId: dbSafeInteger(r.user_id, "user_id"),
    name: dbString(r.name, "name"),
    format: r.format,
    fabraryUrl: r.fabrary_url,
    decklist: decodeDeckPool(r.decklist),
    heroName: dbString(r.hero_name, "hero_name"),
    createdAt: dbSafeInteger(r.created_at, "created_at"),
    updatedAt: dbSafeInteger(r.updated_at, "updated_at"),
  };
}

export async function getDeck(db: Queryable, id: string): Promise<DeckRow | null> {
  const { rows } = await db.query("SELECT * FROM decks WHERE id = $1", [id]);
  return rows.length ? toDeck(rows[0]) : null;
}

/**
 * Every deckId entry point resolves through here: the hardcoded precons
 * (including internal bot lists in @fyendal/cards) shadow the DB lookup —
 * `userId` is 0 for them (ownership checks must treat 0 as "no owner").
 * Player-facing catalog filtering is owned by @fyendal/cards. User decks come
 * from the `decks` table as before.
 */
export async function resolveDeck(db: Queryable, id: string): Promise<DeckRow | null> {
  const fixed = precon(id);
  if (fixed) {
    return {
      id: fixed.id,
      userId: 0,
      name: fixed.name,
      format: fixed.format,
      fabraryUrl: null,
      decklist: fixed.pool,
      heroName: cardData[fixed.pool.heroId]?.name ?? fixed.name,
      createdAt: 0,
      updatedAt: 0,
    };
  }
  return getDeck(db, id);
}

export type FreshDeckResult =
  | {
    ok: true;
    deck: DeckRow;
    matchups: FabraryMatchup[];
    selectedMatchupId?: string;
  }
  | {
    ok: false;
    status: 400 | 404 | 422 | 429 | 502 | 503;
    error: string;
    errors?: string[];
    missing?: string[];
    unimplemented?: string[];
  };

function fabraryFailure(result: Exclude<FabraryDeckResult, { ok: true }>): FreshDeckResult {
  return { ok: false, status: result.status, error: result.error };
}

/**
 * Resolve a playable deck and, when it remains linked to Fabrary, replace the
 * saved pool with the provider's latest default list. Matchup variants are
 * intentionally transient: they select a prep presentation without changing
 * the default list that will be fetched on the next game.
 */
export async function resolveFreshDeck(
  db: Queryable,
  userId: number,
  id: string,
  fabraryClient: FabraryClient,
  matchupId?: string,
): Promise<FreshDeckResult> {
  if (precon(id)?.botOnly === true) {
    return { ok: false, status: 404, error: "deck not found" };
  }
  const existing = await resolveDeck(db, id);
  if (!existing || (existing.userId !== 0 && existing.userId !== userId)) {
    return { ok: false, status: 404, error: "deck not found" };
  }
  if (!existing.fabraryUrl) {
    if (matchupId !== undefined) {
      return { ok: false, status: 400, error: "this deck has no Fabrary matchups" };
    }
    return { ok: true, deck: existing, matchups: [] };
  }

  const fetched = await fabraryClient.fetchDeck(existing.fabraryUrl, matchupId);
  if (!fetched.ok) return fabraryFailure(fetched);
  const validation = validateDeck(parseDecklistText(fetched.deck.text), existing.format);
  if (!validation.ok) {
    return {
      ok: false,
      status: 422,
      error: "the latest Fabrary deck is not playable in Fyendal",
      errors: validation.errors,
      missing: validation.missing,
      unimplemented: validation.unimplemented,
    };
  }

  const refreshed: DeckRow = {
    ...existing,
    fabraryUrl: fetched.deck.canonicalUrl,
    decklist: validation.decklist,
    heroName: validation.heroName,
  };
  if (matchupId !== undefined) {
    return {
      ok: true,
      deck: refreshed,
      matchups: fetched.deck.matchups,
      selectedMatchupId: matchupId,
    };
  }

  const now = Date.now();
  await db.query(
    `UPDATE decks
     SET fabrary_url=$2, decklist=$3, hero_name=$4, updated_at=$5
     WHERE id=$1 AND user_id=$6`,
    [
      existing.id,
      fetched.deck.canonicalUrl,
      JSON.stringify(validation.decklist),
      validation.heroName,
      now,
      userId,
    ],
  );
  const saved = await getDeck(db, existing.id);
  if (!saved) return { ok: false, status: 404, error: "deck not found" };
  return { ok: true, deck: saved, matchups: fetched.deck.matchups };
}

export async function listDecks(db: Queryable, userId: number): Promise<DeckRow[]> {
  const { rows } = await db.query(
    "SELECT * FROM decks WHERE user_id = $1 ORDER BY created_at",
    [userId],
  );
  return rows.map(toDeck);
}

export type ImportResult =
  | { ok: true; deck: DeckRow }
  | { ok: false; code: "DECK_NOT_FOUND" | "INVALID_DECK"; errors: string[]; missing: string[]; unimplemented: string[] };

export async function importDeck(
  db: Queryable,
  userId: number,
  input: { name: string; format: Format; fabraryUrl?: string; text: string },
): Promise<ImportResult> {
  const v = validateDeck(parseDecklistText(input.text), input.format);
  if (!v.ok) return { ok: false, code: "INVALID_DECK", errors: v.errors, missing: v.missing, unimplemented: v.unimplemented };
  const now = Date.now();
  const id = randomBytes(8).toString("hex");
  await db.query(
    `INSERT INTO decks (id, user_id, name, format, fabrary_url, decklist, hero_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, userId, input.name, input.format, input.fabraryUrl ?? null, JSON.stringify(v.decklist), v.heroName, now],
  );
  return { ok: true, deck: (await getDeck(db, id))! };
}

export async function updateDeck(
  db: Queryable,
  userId: number,
  id: string,
  input: { name?: string; fabraryUrl?: string; text?: string },
): Promise<ImportResult> {
  const existing = await getDeck(db, id);
  if (!existing || existing.userId !== userId) {
    return { ok: false, code: "DECK_NOT_FOUND", errors: ["deck not found"], missing: [], unimplemented: [] };
  }
  let decklist = existing.decklist;
  let heroName = existing.heroName;
  if (input.text !== undefined) {
    const v = validateDeck(parseDecklistText(input.text), existing.format);
    if (!v.ok) return { ok: false, code: "INVALID_DECK", errors: v.errors, missing: v.missing, unimplemented: v.unimplemented };
    decklist = v.decklist;
    heroName = v.heroName;
  }
  await db.query(
    "UPDATE decks SET name=$2, fabrary_url=$3, decklist=$4, hero_name=$5, updated_at=$6 WHERE id=$1",
    [id, input.name ?? existing.name, input.fabraryUrl ?? existing.fabraryUrl,
     JSON.stringify(decklist), heroName, Date.now()],
  );
  return { ok: true, deck: (await getDeck(db, id))! };
}

export async function deleteDeck(db: Queryable, userId: number, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    "DELETE FROM decks WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return rowCount === 1;
}
