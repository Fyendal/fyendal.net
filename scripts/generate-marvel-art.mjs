#!/usr/bin/env node
/** Build client-only Marvel artwork metadata from the-fab-cube's English
 * card.json. Images remain hotlinked from Fabrary; no game data is changed.
 * Usage: node scripts/generate-marvel-art.mjs /path/to/card.json
 * Source: https://github.com/the-fab-cube/flesh-and-blood-cards
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { cardTypeOf } from "./lib/carddata.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = process.argv[2];
if (!source) throw new Error("usage: node scripts/generate-marvel-art.mjs /path/to/card.json");

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
const directory = join(root, "packages/cards/src/data/cards");
for (const file of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
  for (const value of list(JSON.parse(readFileSync(join(directory, file), "utf8")), file)) {
    const card = record(value, file);
    localKeys.add(key(text(card.cardType, file), text(card.name, file), pitchNumber(card.pitch, file)));
    localNames.add(text(card.name, file));
  }
}

const candidates = new Map();
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
    const rarity = text(printing.rarity, name);
    const imageUrl = printing.image_url == null ? "" : text(printing.image_url, name);
    if (rarity !== "V" && !/-MV[A-Z]?(?:_BACK)?\.webp$/.test(imageUrl)) continue;
    if (!imageUrl) throw new Error(`${name}: Marvel printing has no image`);
    const url = new URL(imageUrl);
    const imageId = url.pathname.split("/").at(-1)?.replace(/\.webp$/, "");
    const id = text(printing.id, name);
    // Retain the source's face suffix: Marvel faces can be reversed relative
    // to the ordinary printing (notably Levia, Redeemed / Blasmophet).
    if (url.protocol !== "https:" || !imageId || !imageId.startsWith(id)
      || !/^[A-Z0-9]{6}(?:[-_][A-Z0-9_]+)*$/.test(imageId)) continue;
    const images = candidates.get(identity) ?? new Set();
    images.add(imageId);
    candidates.set(identity, images);
  }
}

function rank(imageId) {
  // One stable image per identity keeps grouped tokens consistent. Prefer
  // the front when both faces show the same card, then a main-set printing.
  return `${imageId.endsWith("_BACK") ? 1 : 0}${/^(FAB|HER|JDG|LGS|GEM)/.test(imageId) ? 1 : 0}${imageId}`;
}
const output = Object.fromEntries([...candidates].sort(([a], [b]) => a.localeCompare(b)).map(([identity, images]) => [
  identity,
  [...images].sort((a, b) => rank(a).localeCompare(rank(b)))[0],
]));
// Official Card Vault records fill gaps in newer sets until the community
// dataset catches up. Keep these additions across ordinary regeneration.
const supplementPath = join(root, "scripts/data/marvel-art-supplement.json");
const supplement = record(JSON.parse(readFileSync(supplementPath, "utf8")), supplementPath);
for (const [identity, value] of Object.entries(record(supplement.artByCard, supplementPath))) {
  const imageId = text(value, identity);
  if (!localKeys.has(identity) || !/^[A-Z0-9]{6}(?:[-_][A-Z0-9_]+)*$/.test(imageId)) {
    throw new Error(`invalid supplemental Marvel artwork: ${identity} -> ${imageId}`);
  }
  output[identity] ??= imageId;
}
const target = join(root, "apps/client/src/game/marvelArt.json");
writeFileSync(target, `${JSON.stringify(Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
console.log(`Generated ${Object.keys(output).length} Marvel artwork identities -> ${target}`);
