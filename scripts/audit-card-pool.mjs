#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "docs/card-pool-audit.json");
const dataDir = join(root, "packages/cards/src/data/cards");
const args = process.argv.slice(2);
const revisionIndex = args.indexOf("--revision");
const suppliedRevision = revisionIndex >= 0 ? args[revisionIndex + 1] : undefined;
const datasetPath = args.find((arg, index) =>
  !arg.startsWith("--") && !(revisionIndex >= 0 && index === revisionIndex + 1)
) ?? "/tmp/fab-cards.json";

if (!existsSync(datasetPath)) {
  throw new Error(`dataset not found: ${datasetPath}\nFetch the pinned source recorded in ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1) throw new Error("unsupported card-pool audit schema");
if (suppliedRevision && suppliedRevision !== manifest.upstreamRevision) {
  throw new Error(
    `dataset revision ${suppliedRevision} is not the classified revision ${manifest.upstreamRevision}; ` +
    "review the audit output, then update docs/card-pool-audit.json",
  );
}

const normalize = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");
const functionalKey = (card) => `${normalize(card.name)}|${Number(card.pitch) || 0}`;
const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
const importedCards = readdirSync(dataDir)
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) => JSON.parse(readFileSync(join(dataDir, file), "utf8")));
const importedKeys = new Set(importedCards.map(functionalKey));
const importedPrintingIds = new Set(importedCards.map((card) => card.id));
const importedPrintingKeys = new Map();
for (const card of importedCards) {
  const keys = importedPrintingKeys.get(card.id) ?? new Set();
  keys.add(functionalKey(card));
  importedPrintingKeys.set(card.id, keys);
}
const importedProductCodes = new Set(importedCards.map((card) => card.set).filter(Boolean));
const classifiedUnsupported = new Set(manifest.classifiedUnsupportedKeys);
const deferredCodes = new Set(Object.values(manifest.deferredProductCodes).flat());
const errors = [];
const datasetKeys = new Set();
let legalIdentities = 0;

for (const [printingId, keys] of importedPrintingKeys) {
  if (keys.size > 1) {
    errors.push(`printing id ${printingId} maps to multiple identities: ${[...keys].sort().join(", ")}`);
  }
}

for (const card of dataset) {
  if ((card.types ?? []).includes("Placeholder Card")) continue;
  const key = functionalKey(card);
  datasetKeys.add(key);
  const printings = card.printings ?? [];
  const setCodes = new Set(printings.map((printing) => printing.set_id).filter(Boolean));
  const deferred = setCodes.size > 0 && [...setCodes].every((code) => deferredCodes.has(code));
  const legal = [
    card.blitz_legal,
    card.cc_legal,
    card.commoner_legal,
    card.ll_legal,
    card.silver_age_legal,
  ].some(Boolean);
  if (legal) legalIdentities++;

  if (!importedKeys.has(key)) {
    if (!classifiedUnsupported.has(key) && !deferred) {
      errors.push(`${legal ? "legal " : ""}identity is absent and unclassified: ${key}`);
    }
    continue;
  }

  for (const printing of printings) {
    if (!printing.id || deferredCodes.has(printing.set_id)) continue;
    if (!importedPrintingIds.has(printing.id) && !importedPrintingIds.has(`${printing.id}B`)) {
      errors.push(`missing printing ${printing.id} (${printing.set_id}) for ${key}`);
    }
  }
}

for (const key of classifiedUnsupported) {
  if (!datasetKeys.has(key)) errors.push(`stale unsupported classification: ${key}`);
  if (importedKeys.has(key)) errors.push(`implemented identity remains classified unsupported: ${key}`);
}
for (const code of manifest.synchronizedProductCodes) {
  if (!importedProductCodes.has(code)) errors.push(`synchronized product has no imported data: ${code}`);
}
for (const [kind, codes] of Object.entries(manifest.deferredProductCodes)) {
  for (const code of codes) {
    if (!dataset.some((card) => card.printings?.some((printing) => printing.set_id === code))) {
      errors.push(`stale deferred product classification (${kind}): ${code}`);
    }
  }
}

if (errors.length) {
  console.error(`card-pool audit failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `card-pool audit passed at ${manifest.upstreamRevision}: ` +
  `${importedKeys.size} imported identities, ${importedPrintingIds.size} printings, ` +
  `${legalIdentities} upstream legal identities, ${classifiedUnsupported.size} classified special identities`,
);
