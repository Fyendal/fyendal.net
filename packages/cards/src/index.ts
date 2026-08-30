import type { CardData } from "@fyendal/shared";
import type { CardScript } from "@fyendal/engine";
import { cardList } from "./catalog.js";
import { functionalKeyOf } from "./functional.js";
import { registry } from "./scripts/index.js";
import rawVanilla from "./data/vanilla.json" with { type: "json" };

export * from "./catalog.js";

/** Expand functional scripts to every printing that shares that identity. */
export function expandScripts(
  printings: CardData[],
  scriptRegistry: Record<string, CardScript> = registry,
): Record<string, CardScript> {
  const scripts: Record<string, CardScript> = {};
  for (const printing of printings) {
    const script = scriptRegistry[functionalKeyOf(printing)];
    if (script) scripts[printing.id] = script;
  }
  return scripts;
}

export const scripts: Record<string, CardScript> = expandScripts(cardList);

const vanillaKeys = new Set(Object.keys(rawVanilla));

/** True if the card is playable in the engine: scripted or curated vanilla. */
export function isImplemented(card: CardData): boolean {
  const key = functionalKeyOf(card);
  return key in registry || vanillaKeys.has(key);
}
