#!/usr/bin/env node
/**
 * Snapshot the printed types of every registered card name from Fabrary's
 * card dataset, for the printed-types guard test in packages/cards.
 *
 *   node scripts/snapshot-printed-types.mjs 7.3.10
 *   node scripts/snapshot-printed-types.mjs ./cards-7.3.10.json
 *
 * The version is listed among fabrary.net's loaded resources
 * (https://content.fabrary.net/info/cards-<version>.json).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cardTypesOf } from "./lib/carddata.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "packages/cards/src/data/cards");
const out = join(root, "packages/cards/src/__tests__/printed-types.json");

const source = process.argv[2];
if (!source) throw new Error("usage: snapshot-printed-types.mjs <version | cards json path>");
const isVersion = /^\d+(\.\d+)*$/.test(source);
const version = isVersion ? source : /cards-([\d.]+)\.json$/.exec(source)?.[1] ?? source;
const dataset = isVersion
  ? await (await fetch(`https://content.fabrary.net/info/cards-${source}.json`)).json()
  : JSON.parse(readFileSync(source, "utf8"));

const local = new Set(readdirSync(dataDir)
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) => JSON.parse(readFileSync(join(dataDir, file), "utf8")))
  .map((card) => card.name.toLowerCase()));

// name -> types, or null when same-named cards disagree (Hyper Driver).
const byName = new Map();
for (const card of dataset.cards) {
  const name = card.name.toLowerCase();
  // Companions are allies, imported as actions.
  const words = card.types.map((type) => (type === "Companion" ? "Ally" : type));
  if (!local.has(name) || words.length === 0) continue;
  const types = cardTypesOf(words).join(",");
  byName.set(name, byName.has(name) && byName.get(name) !== types ? null : types);
}

const groups = {};
for (const [name, types] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
  if (types !== null) (groups[types] ??= []).push(name);
}
writeFileSync(out, `${JSON.stringify({ source: `fabrary cards-${version}`, types: groups }, null, 1)}\n`);
console.log(`${byName.size} names -> ${out}`);
