import type { CardData } from "@fyendal/shared";
import type { CardScript } from "@fyendal/engine";
import { cardList } from "./catalog.js";
import { functionalKeyOf } from "./functional.js";
import { registry } from "./scripts/index.js";
import rawVanilla from "./data/vanilla.json" with { type: "json" };

export * from "./catalog.js";

const TARGET_ATTACK = /\btarget\b(?:(?!\bdefending\b)[^.:\n])*?(?<!-)\battack\b([^.:\n]*)/i;
const ABILITY_LINE = /^(?:[A-Za-z]+ per Turn )?(?:Attack Reaction|Instant) - [^\n]*?:\s*(.*)$/;
const ANY_ABILITY_LINE = /^(?:[A-Za-z]+ per Turn )?[A-Za-z ]+ - /;

// A card in another zone, or a defending card's {d}, isn't the active attack.
function namesActiveAttack(text: string): boolean {
  const match = TARGET_ATTACK.exec(text);
  return !!match && !/\bfrom (?:your|their|a|an|the)\b[^,.]*\b(?:graveyard|deck|hand|banished)\b/i.test(match[1]!) &&
    !/\+\d+\{d\}/.test(match[1]!);
}

/** Which of this printing's undeclared attack reaction or instant effects target an attack. */
function attackTargetFlags(
  printing: CardData,
  script: CardScript,
): Pick<CardScript, "targetsAttackingCard" | "abilityTargetsAttackingCard"> {
  const lines = (printing.text ?? "").split("\n");
  const abilities = lines.map((line) => ABILITY_LINE.exec(line)?.[1]).filter((line) => line !== undefined);
  const played = printing.cardType === "attack-reaction" || printing.cardType === "instant"
    ? lines.filter((line) => !ANY_ABILITY_LINE.test(line) && !line.startsWith("When this enters the arena"))
    : [];
  const declaresAbilityTarget = [script.activated].flat().some((ability) => ability?.targetCardOptions);
  return {
    ...(!script.playTargetOptions && played.some(namesActiveAttack) ? { targetsAttackingCard: true } : {}),
    ...(!declaresAbilityTarget && abilities.some(namesActiveAttack) ? { abilityTargetsAttackingCard: true } : {}),
  };
}

/** Expand functional scripts to every printing that shares that identity. */
export function expandScripts(
  printings: CardData[],
  scriptRegistry: Record<string, CardScript> = registry,
): Record<string, CardScript> {
  const scripts: Record<string, CardScript> = {};
  for (const printing of printings) {
    const script = scriptRegistry[functionalKeyOf(printing)];
    if (!script) continue;
    const flags = attackTargetFlags(printing, script);
    scripts[printing.id] = Object.keys(flags).length > 0 ? { ...script, ...flags } : script;
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
