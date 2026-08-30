#!/usr/bin/env node
/**
 * Regenerates the Classic Battles card pool and decklists from the
 * the-fab-cube/flesh-and-blood-cards dataset (json/english/card.json).
 *
 * Usage: node scripts/generate-cards.mjs [/path/to/card.json] [--out DIR] [--force]
 *
 * Writes the cards used by the two "Classic Battles: Rhinar vs Dorinthea"
 * decks (official LSS box lists; 40 main-deck cards each — the mentor is an
 * ordinary deck card) split per set into packages/cards/src/data/cards/<SET>.json,
 * plus packages/cards/src/data/decklists.json.
 *
 * NOTE: this script only covers the Classic Battles pool. To import a full
 * set, use scripts/import-set.mjs instead.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { toCardData } from "./lib/carddata.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : join(root, "packages/cards/src/data");
const source = args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1) ?? "/tmp/fab-cards.json";
const dataset = JSON.parse(readFileSync(source, "utf8"));

// Classic Battles pool: prefer the box sets' printings (DVR/RNR).
function toCbCardData(c) {
  const printing =
    (c.printings ?? []).find((p) => p.set_id === "DVR" || p.set_id === "RNR") ??
    (c.printings ?? [])[0];
  return toCardData(c, printing);
}

function pick(cards, name, color) {
  const c = cards.find(
    (x) => x.name === name && (!color || x.color.toLowerCase() === color),
  );
  if (!c) throw new Error(`card not found: ${name} (${color ?? "any"})`);
  return c;
}

// [name, color, count] — color: red|yellow|blue (pitch 1|2|3), null for colorless
const RHINAR = {
  hero: ["Rhinar", null],
  weapons: [["Bone Basher", null]],
  equipment: {
    head: ["Bone Vizier", null],
    chest: ["Blossom of Spring", null],
    arms: ["Ironhide Gauntlet", null],
    legs: ["Ironhide Legs", null],
  },
  deck: [
    ["Chief Ruk'utan", null, 1],
    ["Alpha Rampage", "red", 1],
    ["Awakening Bellow", "red", 2],
    ["Bare Fangs", "red", 2],
    ["Beast Mode", "red", 2],
    ["Pack Hunt", "red", 2],
    ["Wild Ride", "red", 2],
    ["Wrecking Ball", "red", 2],
    ["Barraging Beatdown", "yellow", 2],
    ["Muscle Mutt", "yellow", 2],
    ["Pack Call", "yellow", 2],
    ["Raging Onslaught", "yellow", 2],
    ["Smash Instinct", "yellow", 2],
    ["Smash with Big Tree", "yellow", 2],
    ["Wounded Bull", "yellow", 2],
    ["Clearing Bellow", "blue", 2],
    ["Come to Fight", "blue", 2],
    ["Dodge", "blue", 2],
    ["Rally the Rearguard", "blue", 2],
    ["Titanium Bauble", "blue", 2],
    ["Wrecker Romp", "blue", 2],
  ],
};

const DORINTHEA = {
  hero: ["Dorinthea, Quicksilver Prodigy", null],
  weapons: [["Dawnblade, Resplendent", null]],
  equipment: {
    head: ["Ironrot Helm", null],
    chest: ["Blossom of Spring", null],
    arms: ["Gallantry Gold", null],
    legs: ["Ironrot Legs", null],
  },
  deck: [
    ["Hala Goldenhelm", null, 1],
    ["En Garde", "red", 2],
    ["Flock of the Feather Walkers", "red", 2],
    ["In the Swing", "red", 2],
    ["Ironsong Response", "red", 2],
    ["Second Swing", "red", 2],
    ["Sharpen Steel", "red", 2],
    ["Thrust", "red", 2],
    ["Warrior's Valor", "red", 2],
    ["Driving Blade", "yellow", 2],
    ["Glistening Steelblade", "yellow", 1],
    ["On a Knife Edge", "yellow", 2],
    ["Out for Blood", "yellow", 2],
    ["Run Through", "yellow", 2],
    ["Slice and Dice", "yellow", 2],
    ["Blade Flash", "blue", 2],
    ["Hit and Run", "blue", 2],
    ["Sigil of Solace", "blue", 2],
    ["Titanium Bauble", "blue", 2],
    ["Toughen Up", "blue", 2],
    ["Visit the Blacksmith", "blue", 2],
  ],
};

const wanted = new Map(); // key name|color -> CardData
const idFor = (name, color) => {
  const key = `${name}|${color ?? ""}`;
  if (!wanted.has(key)) wanted.set(key, toCbCardData(pick(dataset, name, color)));
  return wanted.get(key).id;
};

function buildDecklist(spec) {
  const deck = [];
  for (const [name, color, count] of spec.deck) {
    const id = idFor(name, color);
    for (let i = 0; i < count; i++) deck.push(id);
  }
  return {
    heroId: idFor(...spec.hero),
    weaponIds: spec.weapons.map((w) => idFor(...w)),
    equipment: Object.fromEntries(
      Object.entries(spec.equipment).map(([slot, w]) => [slot, idFor(...w)]),
    ),
    deck,
  };
}

const decklists = { rhinar: buildDecklist(RHINAR), dorinthea: buildDecklist(DORINTHEA) };
// token referenced by Flock of the Feather Walkers
idFor("Quicken", null);

const cards = [...wanted.values()];
const ids = new Set(cards.map((c) => c.id));
if (ids.size !== cards.length) throw new Error("duplicate card ids");
for (const dl of Object.values(decklists)) {
  for (const id of dl.deck) if (!ids.has(id)) throw new Error(`deck references unknown ${id}`);
  if (dl.deck.length !== 40) throw new Error(`deck size ${dl.deck.length} != 40`);
}

// Card data is split per set: packages/cards/src/data/cards/<SET>.json.
// Full-set imports go through scripts/import-set.mjs; this script only
// rewrites the sets the Classic Battles pool touches.
const bySet = new Map();
for (const c of cards) {
  const set = c.set ?? "UNKNOWN";
  if (!bySet.has(set)) bySet.set(set, []);
  bySet.get(set).push(c);
}
mkdirSync(join(outDir, "cards"), { recursive: true });
// This script only rewrites the Classic Battles subset of each set file —
// refuse to clobber an existing (possibly fuller) set file without --force.
for (const [set] of bySet) {
  const f = join(outDir, "cards", `${set}.json`);
  if (existsSync(f) && !force) {
    console.error(`refusing to overwrite existing ${f} (pass --force to replace it)`);
    process.exit(1);
  }
}
for (const [set, list] of [...bySet.entries()].sort()) {
  list.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(
    join(outDir, "cards", `${set}.json`),
    JSON.stringify(list, null, 1) + "\n",
  );
}
writeFileSync(join(outDir, "decklists.json"), JSON.stringify(decklists, null, 2) + "\n");
console.log(
  `wrote ${cards.length} unique cards across ${bySet.size} set files (${[...bySet.keys()].sort().join(", ")}); ` +
    `deck sizes: rhinar=${decklists.rhinar.deck.length}, dorinthea=${decklists.dorinthea.deck.length}`,
);
