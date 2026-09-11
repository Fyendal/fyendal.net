#!/usr/bin/env node
/**
 * Converts a fetched Card Vault product snapshot into the repository CardData
 * shape and merges printings that are not already present in the target set.
 *
 * Usage:
 *   node scripts/import-card-vault-product.mjs <SET> <snapshot.json> [baseline-ref]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , setIdArg, snapshotPath, baselineRef] = process.argv;
const setId = setIdArg?.toUpperCase();

if (!setId || !snapshotPath) {
  console.error(
    "usage: node scripts/import-card-vault-product.mjs <SET> <snapshot.json> [baseline-ref]",
  );
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
if (!Array.isArray(snapshot.product?.cards) || !Array.isArray(snapshot.details)) {
  throw new Error("expected a snapshot produced by fetch-card-vault-product.mjs");
}

const canonicalKeyword = new Map([
  ["ambush", "Ambush"],
  ["bind", "Bind"],
  ["binds", "Bind"],
  ["blade break", "Blade Break"],
  ["blood debt", "Blood Debt"],
  ["channel lightning", "Channel Lightning"],
  ["charge", "Charge"],
  ["combo", "Combo"],
  ["crush", "Crush"],
  ["decay", "Decay"],
  ["dominate", "Dominate"],
  ["earth bond", "Earth Bond"],
  ["fragment", "Fragment"],
  ["go again", "Go again"],
  ["ice bond", "Ice Bond"],
  ["incarnate", "Incarnate"],
  ["legendary", "Legendary"],
  ["legendary viserai specialization", "Legendary Viserai Specialization"],
  ["mark", "Mark"],
  ["opt 1", "Opt 1"],
  ["opt 2", "Opt 2"],
  ["overpower", "Overpower"],
  ["phantasm", "Phantasm"],
  ["shadow resist 1", "Shadow Resist 1"],
  ["sharpen", "Sharpen"],
  ["solflare", "Solflare"],
  ["stealth", "Stealth"],
  ["suspense", "Suspense"],
  ["temper", "Temper"],
  ["traverse", "Traverse"],
  ["unique", "Unique"],
  ["usurp", "Usurp"],
  ["viserai specialization", "Viserai Specialization"],
]);

function normalizeText(text) {
  return text
    .replaceAll("{br}", "\n")
    .replace(/\*\*\s*([^*]+?)\s*\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\s+--\s+/g, " - ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function keywordsOf(text) {
  const keywords = [];
  for (const match of text.matchAll(/\*\*\s*([^*]+?)\s*\*\*/g)) {
    const normalized = match[1].trim().toLowerCase();
    const lineStart = Math.max(
      text.lastIndexOf("{br}", match.index) + 4,
      text.lastIndexOf("\n", match.index) + 1,
    );
    const prefix = text.slice(lineStart, match.index).toLowerCase();
    if (
      ["dominate", "go again", "overpower"].includes(normalized) &&
      /\b(?:get|gets|gain|gains|grant|grants)\s*$/.test(prefix)
    ) continue;
    const keyword = canonicalKeyword.get(normalized);
    if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
  }
  return keywords;
}

function numeric(value) {
  if (value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function cardTypeOf(core) {
  const types = core.core_types.map((type) => type.name_en ?? type.name);
  const subtypes = core.core_subtypes.map((type) => type.name_en ?? type.name);
  if (types.includes("Hero")) return "hero";
  if (types.includes("Weapon")) return "weapon";
  if (types.includes("Equipment")) return "equipment";
  if (types.includes("Attack Reaction")) return "attack-reaction";
  if (types.includes("Defense Reaction")) return "defense-reaction";
  if (types.includes("Instant")) return "instant";
  if (types.includes("Resource")) return "resource";
  if (types.includes("Block")) return "block";
  if (types.includes("Mentor")) return "mentor";
  if (types.includes("Token") || subtypes.includes("Token")) return "token";
  if (types.includes("Action")) return "action";
  throw new Error(`unsupported Card Vault type line: ${core.typebox}`);
}

function normalizedPrintId(printId) {
  return printId.replace(/-(?:RF|CF|GF)$/i, "");
}

function toCardData(print, detail) {
  const core = detail.cores.find((candidate) => candidate.layout_position === 10) ?? detail.cores[0];
  if (!core) throw new Error(`${print.card_id}: Card Vault record has no front face`);
  const printedFace = detail.card_prints
    .flatMap((cardPrint) => cardPrint.faces ?? [])
    .find((face) => face.face_language === "en" && face.face_id === print.print_id);
  const rulesText = printedFace?.printed_rules_text ?? core.textbox ?? "";
  const data = {
    id: normalizedPrintId(print.print_id),
    name: print.printed_name,
    cardType: cardTypeOf(core),
    text: normalizeText(rulesText),
  };
  const pitch = numeric(core.pitch);
  if (pitch) data.pitch = pitch;
  for (const [source, target] of [
    ["cost", "cost"],
    ["power", "attack"],
    ["defense", "defense"],
    ["intellect", "intellect"],
    ["life", "life"],
  ]) {
    const value = numeric(core[source]);
    if (value !== undefined) data[target] = value;
  }
  const classes = core.core_classes.map((type) => (type.name_en ?? type.name).toLowerCase());
  if (classes.length) data.classes = [...new Set(classes)];
  const printedTypebox = (print.printed_typebox ?? core.typebox ?? "").toLowerCase();
  const orderedCoreSubtypes = [...core.core_subtypes].sort((left, right) => {
    const leftAt = printedTypebox.indexOf((left.name_en ?? left.name).toLowerCase());
    const rightAt = printedTypebox.indexOf((right.name_en ?? right.name).toLowerCase());
    if (leftAt < 0) return rightAt < 0 ? 0 : 1;
    if (rightAt < 0) return -1;
    return leftAt - rightAt;
  });
  const subtypes = [
    ...core.core_talents.map((type) => (type.name_en ?? type.name).toLowerCase()),
    ...orderedCoreSubtypes.map((type) => (type.name_en ?? type.name).toLowerCase()),
  ];
  if (subtypes.length) data.subtypes = [...new Set(subtypes)];
  const keywords = keywordsOf(rulesText);
  if (keywords.length) data.keywords = keywords;
  data.set = setId;
  return data;
}

const detailsById = new Map(snapshot.details.map((detail) => [detail.card_id, detail]));
const imported = snapshot.product.cards.map((print) => {
  const detail = detailsById.get(print.card_id);
  if (!detail) throw new Error(`${print.card_id}: missing detail record`);
  return toCardData(print, detail);
});
const uniqueImported = [...new Map(imported.map((card) => [card.id, card])).values()];

const outputPath = join(root, `packages/cards/src/data/cards/${setId}.json`);
const existing = JSON.parse(readFileSync(outputPath, "utf8"));
const existingIds = new Set(existing.map((card) => card.id));
const additions = uniqueImported.filter((card) => !existingIds.has(card.id));
const baselineIds = baselineRef
  ? new Set(JSON.parse(execFileSync(
      "git",
      ["show", `${baselineRef}:packages/cards/src/data/cards/${setId}.json`],
      { cwd: root, encoding: "utf8" },
    )).map((card) => card.id))
  : new Set();
const importedById = new Map(uniqueImported.map((card) => [card.id, card]));
const merged = [
  ...existing.map((card) =>
    baselineRef && !baselineIds.has(card.id) ? importedById.get(card.id) ?? card : card
  ),
  ...additions,
].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`);

console.log(`Card Vault product: ${snapshot.product.cards.length} printings`);
console.log(`added ${additions.length} new ${setId} printings -> ${outputPath}`);
for (const card of additions) console.log(`  ${card.id}  ${card.name}`);
