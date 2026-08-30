#!/usr/bin/env node
/**
 * Imports one set from the the-fab-cube/flesh-and-blood-cards dataset into
 * the per-set card data layout (packages/cards/src/data/cards/<SET>.json).
 *
 * Usage:
 *   node scripts/import-set.mjs <SET_ID> [/path/to/card.json] [--out DIR] [--force]
 *           [--rarity C,R,...] [--young-heroes] [--known-only]
 *
 *   --rarity C,R     only import printings with one of these dataset rarity codes
 *   --young-heroes   also import Young heroes regardless of rarity (e.g. for
 *                    Silver Age: commons/rares + young heroes)
 *
 * Dataset: json/english/card.json from the-fab-cube/flesh-and-blood-cards.
 *   curl -sL https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json -o /tmp/fab-cards.json
 *
 * Behavior:
 *  - Extracts every card with a printing in <SET_ID> (deduped by printing id;
 *    edition/foiling variants of the same printing collapse to one entry).
 *  - Converts to the CardData shape used by packages/cards (same logic as
 *    generate-cards.mjs).
 *  - Classifies each functional key (name|pitch) against the existing data
 *    files and the script registry keys (grep-extracted from
 *    packages/cards/src/scripts/*.ts): reprint (auto-reuses an existing
 *    script) vs new key (SCRIPT NEEDED vs likely vanilla).
 *  - Writes <outDir>/<SET_ID>.json. Refuses to overwrite without --force.
 *  - With --known-only, omits identities not represented by another data
 *    file or a registered script. This keeps novelty promos out of automated
 *    reprint synchronization until they are explicitly classified.
 *
 * After importing, register the new file in packages/cards/src/index.ts and
 * packages/cards/src/scripts/index.ts — the exact lines are printed at the
 * end of the report.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { toCardData } from "./lib/carddata.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "packages/cards/src/data/cards");
const scriptsDir = join(root, "packages/cards/src/scripts");
const vanillaPath = join(root, "packages/cards/src/data/vanilla.json");

// --- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const valueFlags = new Set(["--out", "--rarity"]);
const flags = new Set(args.filter((a) => a.startsWith("--") && !valueFlags.has(a)));
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : dataDir;
const rarityIdx = args.indexOf("--rarity");
const rarities = rarityIdx >= 0 ? new Set((args[rarityIdx + 1] ?? "").split(",").filter(Boolean)) : null;
const youngHeroes = flags.has("--young-heroes");
const knownOnly = flags.has("--known-only");
const positional = args.filter(
  (a, i) =>
    !a.startsWith("--") &&
    !(outIdx >= 0 && i === outIdx + 1) &&
    !(rarityIdx >= 0 && i === rarityIdx + 1),
);
const setId = positional[0]?.toUpperCase();
const source = positional[1] ?? "/tmp/fab-cards.json";

if (!setId || flags.has("--help") || (outIdx >= 0 && !outDir) || (rarityIdx >= 0 && !rarities?.size)) {
  console.error("usage: node scripts/import-set.mjs <SET_ID> [/path/to/card.json] [--out DIR] [--force] [--rarity C,R,...] [--young-heroes] [--known-only]");
  process.exit(2);
}
if (!existsSync(source)) {
  console.error(`dataset not found: ${source}`);
  console.error("fetch it with:");
  console.error("  curl -sL https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json -o /tmp/fab-cards.json");
  process.exit(2);
}

// --- dataset -> CardData (shared with generate-cards.mjs: lib/carddata.mjs) --
function functionalKey(name, pitch) {
  return `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${pitch ?? 0}`;
}

// --- extract printings of this set ----------------------------------------
const dataset = JSON.parse(readFileSync(source, "utf8"));
const faceNamesByPrinting = new Map();
for (const c of dataset) {
  for (const p of c.printings ?? []) {
    if (p.set_id !== setId) continue;
    const names = faceNamesByPrinting.get(p.id) ?? new Set();
    names.add(c.name);
    faceNamesByPrinting.set(p.id, names);
  }
}
const byPrintingId = new Map(); // printing id (or synthetic back-face id) -> CardData
for (const c of dataset) {
  // Checklist/placeholder printings describe a family of physical cards but
  // are not themselves playable game objects (UPR225, Dragons of Legend).
  if ((c.types ?? []).includes("Placeholder Card")) continue;
  // one entry per distinct printing id in this set (edition/foiling variants
  // of the same printing share an id and collapse to one)
  const seen = new Set();
  const isYoungHero = (c.types ?? []).includes("Hero") && (c.types ?? []).includes("Young");
  for (const p of c.printings ?? []) {
    if (p.set_id !== setId || seen.has(p.id)) continue;
    if (rarities && !rarities.has(p.rarity) && !(youngHeroes && isYoungHero)) continue;
    seen.add(p.id);
    // Some recent products (notably AMX022) mark both printed faces with
    // `is_DFC: false` even though they still share a collector number and
    // provide the ordinary front/back metadata. The face relationship is the
    // authoritative signal; `is_DFC` is not consistently populated upstream.
    const doubleFace = p.double_sided_card_info?.[0];
    // Both faces of an invocation share the same printed collector number.
    // Keep the front at that id and give the back a stable registry-only id;
    // CardData.backId links the playable front to its permanent back face.
    const hasDistinctFaces = (faceNamesByPrinting.get(p.id)?.size ?? 0) > 1;
    const registryId = doubleFace?.is_front === false && hasDistinctFaces ? `${p.id}B` : p.id;
    if (byPrintingId.has(registryId)) continue;
    byPrintingId.set(registryId, toCardData(c, { ...p, id: registryId }));
  }
}
for (const [id, back] of byPrintingId) {
  if (!id.endsWith("B")) continue;
  const front = byPrintingId.get(id.slice(0, -1));
  if (front) front.backId = back.id;
}
let imported = [...byPrintingId.values()].sort((a, b) => a.id.localeCompare(b.id));
if (imported.length === 0) {
  console.error(`no printings found for set "${setId}" in ${source}`);
  process.exit(1);
}

// --- existing data + registry keys -----------------------------------------
// Skip the target set's own file: a re-import with --force must compare
// against *other* sets only, or every card looks like a reprint of itself.
const existingKeys = new Map(); // functional key -> existing printing ids (other sets)
for (const f of readdirSync(dataDir)) {
  if (!f.endsWith(".json") || f === `${setId}.json`) continue;
  const set = f.replace(/\.json$/, "");
  for (const c of JSON.parse(readFileSync(join(dataDir, f), "utf8"))) {
    const key = functionalKey(c.name, c.pitch);
    if (!existingKeys.has(key)) existingKeys.set(key, []);
    existingKeys.get(key).push(`${c.id} (${set})`);
  }
}

// Registry keys are `"name|pitch": {` literals at line starts in scripts/*.ts
// (including unmerged <set>/<class>.ts fragments from a parallel import).
const scriptedKeys = new Set();
const vanillaKeys = new Set(Object.keys(JSON.parse(readFileSync(vanillaPath, "utf8"))));
const scanScriptFile = (p) => {
  const src = readFileSync(p, "utf8");
  for (const m of src.matchAll(/^ {2}"([^"]+)":/gm)) scriptedKeys.add(m[1]);
};
for (const f of readdirSync(scriptsDir, { withFileTypes: true })) {
  if (f.isDirectory()) {
    for (const g of readdirSync(join(scriptsDir, f.name))) {
      if (g.endsWith(".ts")) scanScriptFile(join(scriptsDir, f.name, g));
    }
    continue;
  }
  if (!f.name.endsWith(".ts") || f.name === "index.ts" || f.name === "shared-helpers.ts") continue;
  scanScriptFile(join(scriptsDir, f.name));
}

const excludedUnknown = [];
if (knownOnly) {
  imported = imported.filter((card) => {
    const key = functionalKey(card.name, card.pitch);
    const known = existingKeys.has(key) || scriptedKeys.has(key) || vanillaKeys.has(key);
    if (!known) excludedUnknown.push(key);
    return known;
  });
  if (imported.length === 0) {
    console.error(`no known printings found for set "${setId}" in ${source}`);
    process.exit(1);
  }
}

// --- classify ---------------------------------------------------------------
// A card is likely vanilla when its text is empty or every line just restates
// a keyword it already has (the engine implements keyword behavior).
function looksVanilla(card) {
  const kws = (card.keywords ?? []).map((k) => k.toLowerCase());
  const lines = card.text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((l) => {
    const norm = l.replace(/\.$/, "").toLowerCase();
    return kws.some(
      (k) => norm === k || norm === `when this attacks, ${k}` || norm.startsWith(`${k} -`),
    );
  });
}

const groups = new Map(); // functional key -> CardData[]
for (const c of imported) {
  const key = functionalKey(c.name, c.pitch);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(c);
}

const reprints = []; // [key, ids, hasScript]
const newKeys = []; // [key, card, vanilla]
for (const [key, cards] of [...groups.entries()].sort()) {
  if (existingKeys.has(key)) reprints.push([key, cards.map((c) => c.id), scriptedKeys.has(key)]);
  else newKeys.push([key, cards[0], looksVanilla(cards[0])]);
}

// --- write -------------------------------------------------------------------
const outFile = join(outDir, `${setId}.json`);
if (existsSync(outFile) && !flags.has("--force")) {
  console.error(`refusing to overwrite existing ${outFile} (pass --force to replace it)`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(imported, null, 1) + "\n");

// --- report -------------------------------------------------------------------
console.log(`imported ${imported.length} printings of set ${setId} -> ${outFile}`);
console.log(`${groups.size} functional keys: ${newKeys.length} new, ${reprints.length} reprints of existing cards`);
if (excludedUnknown.length) {
  console.log(`\nexcluded by --known-only (${new Set(excludedUnknown).size} unsupported functional keys):`);
  for (const key of [...new Set(excludedUnknown)].sort()) console.log(`  ${key}`);
}
if (reprints.length) {
  console.log("\nreprints (auto-reuse any existing script):");
  for (const [key, ids, hasScript] of reprints) {
    console.log(`  ${key}  [${ids.join(", ")}]  existing: ${existingKeys.get(key).join(", ")}${hasScript ? "  (scripted)" : ""}`);
  }
}
if (newKeys.length) {
  console.log("\nnew functional keys:");
  for (const [key, card, vanilla] of newKeys) {
    console.log(`  ${vanilla ? "vanilla?  " : "SCRIPT NEEDED"}  ${key}`);
  }
  const needed = newKeys.filter(([, , v]) => !v).length;
  console.log(`\n${needed} new key(s) likely need a script, ${newKeys.length - needed} look vanilla (verify against data/vanilla.json rules).`);
}
console.log(`\nto register this set, add to packages/cards/src/index.ts:`);
console.log(`  import cards${setId} from "./data/cards/${setId}.json" with { type: "json" };`);
console.log(`  (and spread ...cards${setId} into rawCardList)`);
console.log(`and, if the set adds scripts, to packages/cards/src/scripts/index.ts:`);
console.log(`  import { ${setId.toLowerCase().replace(/^\d/, "_$&")} } from "./${setId.toLowerCase()}.js";  // plus a "${setId}" entry in setModules`);
