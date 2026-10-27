#!/usr/bin/env node
/** Build the alternate card art catalog from the-fab-cube's English card.json.
 * Images remain hotlinked from Fabrary; no game data is changed.
 * Usage: node scripts/generate-card-art.mjs /path/to/card.json [--verify]
 * --verify drops images Fabrary does not serve (one HEAD request per image).
 * Source: https://github.com/the-fab-cube/flesh-and-blood-cards
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { cardTypeOf } from "./lib/carddata.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const verify = args.includes("--verify");
if (!source) throw new Error("usage: node scripts/generate-card-art.mjs /path/to/card.json [--verify]");

// Non-English printings carry a language prefix, e.g. KO_HER172-RF.
const IMAGE_ID = /^(?:[A-Z]{2}_)?[A-Z0-9]{6}(?:[-_][A-Z0-9_]+)*$/;
const RARITIES = new Set(["C", "R", "S", "M", "L", "F", "V", "P", "T", "B"]);
const FOILS = new Set(["S", "R", "C", "G"]);
const VARIATIONS = ["FA", "EA", "AA", "AB", "AT"];
// White-border History Pack art duplicates the black-border originals.
const EXCLUDED_SETS = new Set(["1HP"]);
// Misprinted rules text; the client shows a correct printing instead.
const EXCLUDED_IMAGES = new Set(["AKO015"]);

function record(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context}: expected object`);
  return value;
}

function list(value, context) {
  if (!Array.isArray(value)) throw new Error(`${context}: expected array`);
  return value;
}

function text(value, context) {
  if (typeof value !== "string") throw new Error(`${context}: expected string`);
  return value;
}

function pitchNumber(value, context) {
  if (value === undefined || value === "") return 0;
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${context}: invalid pitch`);
  const pitch = Number(value);
  if (!Number.isSafeInteger(pitch) || pitch < 0 || pitch > 4) throw new Error(`${context}: invalid pitch`);
  return pitch;
}

function key(type, name, pitch) {
  return `${type}|${name.trim().toLowerCase().replace(/\s+/g, " ")}|${pitch}`;
}

const localKeys = new Set();
const localNames = new Set();
/** identity -> local printing ids, whose plain images are the standard art. */
const localIds = new Map();
const directory = join(root, "packages/cards/src/data/cards");
for (const file of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
  for (const value of list(JSON.parse(readFileSync(join(directory, file), "utf8")), file)) {
    const card = record(value, file);
    const identity = key(text(card.cardType, file), text(card.name, file), pitchNumber(card.pitch, file));
    localKeys.add(identity);
    localNames.add(text(card.name, file));
    localIds.set(identity, (localIds.get(identity) ?? new Set()).add(text(card.id, file)));
  }
}

/** @type {Map<string, Map<string, {image: string, set: string, rarity: string, foil?: string, variation?: string}>>} */
const catalog = new Map();
function add(identity, entry) {
  const images = catalog.get(identity) ?? new Map();
  if (!images.has(entry.image)) images.set(entry.image, entry);
  catalog.set(identity, images);
}

for (const value of list(JSON.parse(readFileSync(source, "utf8")), source)) {
  const card = record(value, source);
  const name = text(card.name, "card.name");
  if (!localNames.has(name)) continue;
  const types = list(card.types, name).map((type) => text(type, name));
  const keywords = list(card.card_keywords ?? [], name).map((keyword) => text(keyword, name));
  if (types.includes("Placeholder Card")) continue;
  const identity = key(cardTypeOf(types, keywords), name, pitchNumber(card.pitch, name));
  if (!localKeys.has(identity)) continue;
  for (const value of list(card.printings, name)) {
    const printing = record(value, name);
    const id = text(printing.id, name);
    const set = text(printing.set_id, name);
    const rarity = text(printing.rarity, name);
    const foil = text(printing.foiling, name);
    if (EXCLUDED_SETS.has(set) || EXCLUDED_IMAGES.has(id) || !RARITIES.has(rarity) || !FOILS.has(foil)) continue;
    if (printing.image_url == null) continue;
    const url = new URL(text(printing.image_url, name));
    const image = url.pathname.split("/").at(-1)?.replace(/\.webp$/, "");
    // Unlimited (U-) and other prefixed scans repeat a first-edition image.
    if (url.protocol !== "https:" || !image || !image.startsWith(id) || !IMAGE_ID.test(image)) continue;
    const variations = list(printing.art_variations ?? [], name).map((variation) => text(variation, name));
    const variation = VARIATIONS.find((candidate) => variations.includes(candidate));
    add(identity, {
      image,
      set,
      rarity,
      ...(foil === "S" ? {} : { foil }),
      ...(variation ? { variation } : {}),
    });
  }
}

// Card Vault Marvel records fill gaps until the community dataset catches up.
const marvelArt = record(JSON.parse(readFileSync(join(root, "apps/client/src/game/marvelArt.json"), "utf8")), "marvelArt");
for (const [identity, value] of Object.entries(marvelArt)) {
  const image = text(value, identity);
  if (!localKeys.has(identity) || !IMAGE_ID.test(image)) continue;
  const images = catalog.get(identity);
  if (images?.has(image)) {
    images.set(image, { ...images.get(image), rarity: "V" });
  } else {
    add(identity, { image, set: image.slice(0, 3), rarity: "V" });
  }
}

async function headWithRetry(url, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { method: "HEAD" });
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Curated printings the community dataset lacks, such as language-only promos.
const supplementPath = join(root, "scripts/data/card-art-supplement.json");
const supplement = record(JSON.parse(readFileSync(supplementPath, "utf8")), supplementPath);
for (const [identity, value] of Object.entries(record(supplement.artByCard, supplementPath))) {
  if (!localKeys.has(identity)) throw new Error(`unknown card art identity: ${identity}`);
  for (const item of list(value, identity)) {
    const entry = record(item, identity);
    const image = text(entry.image, identity);
    if (!IMAGE_ID.test(image) || !RARITIES.has(text(entry.rarity, identity))) {
      throw new Error(`invalid supplemental card art: ${identity} -> ${image}`);
    }
    add(identity, entry);
  }
}

// A Marvel promo's _BACK object can repeat the same face as full-bleed art.
for (const entries of catalog.values()) {
  for (const image of [...entries.keys()]) {
    if (image.endsWith("_BACK") && entries.has(image.slice(0, -"_BACK".length))) entries.delete(image);
  }
}

if (verify) {
  const images = [...new Set([...catalog.values()].flatMap((entries) => [...entries.keys()]))];
  const missing = new Set();
  let next = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (next < images.length) {
      const image = images[next++];
      const response = await headWithRetry(`https://content.fabrary.net/cards/${image}.webp`);
      if (response.status === 404 || response.status === 403) missing.add(image);
      else if (!response.ok) throw new Error(`${image}: HTTP ${response.status}`);
    }
  }));
  for (const [identity, entries] of catalog) {
    for (const image of entries.keys()) if (missing.has(image)) entries.delete(image);
    if (entries.size === 0) catalog.delete(identity);
  }
  console.log(`Dropped ${missing.size} of ${images.length} images Fabrary does not serve`);
}

// Only cards with an image beyond their own printings' standard art need an entry.
const output = Object.fromEntries([...catalog]
  .filter(([identity, entries]) => [...entries.keys()].some((image) => !localIds.get(identity)?.has(image)))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([identity, entries]) => [identity, [...entries.values()].sort((a, b) => a.image.localeCompare(b.image))]));
const target = join(root, "packages/cards/src/data/cardArt.json");
writeFileSync(target, `${JSON.stringify(output)}\n`);
console.log(`Generated ${Object.keys(output).length} card art identities -> ${target}`);
