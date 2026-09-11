#!/usr/bin/env node
/**
 * Fetches the public Card Vault product checklist and each card's canonical
 * rules record. The resulting JSON is an import source, not registered card
 * data; `import-card-vault-product.mjs` performs the CardData conversion.
 *
 * Usage:
 *   node scripts/fetch-card-vault-product.mjs <product-slug> [output.json]
 */
import { writeFile } from "node:fs/promises";

const API = "https://api.cardvault.fabtcg.com/carddb/api/v1";
const [, , productSlug, output = `/tmp/card-vault-${productSlug}.json`] = process.argv;

if (!productSlug) {
  console.error("usage: node scripts/fetch-card-vault-product.mjs <product-slug> [output.json]");
  process.exit(2);
}

async function fetchJson(path) {
  const response = await fetch(`${API}/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return response.json();
}

const product = await fetchJson(`product-cards/${encodeURIComponent(productSlug)}/`);
if (!Array.isArray(product.cards)) throw new Error("Card Vault product response has no cards array");

const cardIds = [...new Set(product.cards.map((card) => card.card_id))];
const details = new Array(cardIds.length);
let cursor = 0;

async function worker() {
  while (cursor < cardIds.length) {
    const index = cursor++;
    const cardId = cardIds[index];
    const response = await fetchJson(`card_id/${encodeURIComponent(cardId)}/`);
    const detail = response.results?.find((candidate) => candidate.card_id === cardId);
    if (!detail) throw new Error(`Card Vault returned no detail for ${cardId}`);
    details[index] = detail;
  }
}

await Promise.all(Array.from({ length: Math.min(8, cardIds.length) }, worker));
await writeFile(output, `${JSON.stringify({ product, details }, null, 2)}\n`);
console.log(`fetched ${product.cards.length} printings and ${details.length} card identities -> ${output}`);
