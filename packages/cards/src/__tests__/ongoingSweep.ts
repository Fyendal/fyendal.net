import type { OngoingEffectView } from "@fyendal/shared";
import { projectStateFor } from "@fyendal/engine";
import { functionalKeyOf } from "../functional.js";
import { cardData, scripts } from "../index.js";
import { scenario } from "./harness.js";

export interface SweptEffect {
  /** Functional key of the card whose play left the effect. */
  key: string;
  effect: OngoingEffectView;
}

// Script source that can leave a lingering effect. Scripts without any of
// these words are skipped to keep the sweep fast.
const LINGERING_SOURCE = /Modifier|buffNext|nextAttack|Label|weave|Watcher|Wager|marker|prevent|arcane|\bamp/i;

function scriptSource(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === "function") return value.toString();
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  return Object.values(value).map((entry) => scriptSource(entry, seen)).join("\n");
}

/** Plays every scripted action and instant card that may leave a lingering
 *  effect from a well-resourced hand, passes the defend step when one opens,
 *  and collects each projected lingering effect. Cards that need setup the
 *  sweep doesn't provide are skipped, so it samples the registry rather than
 *  proving it exhaustively. */
export function sweepPlayedCardEffects(): SweptEffect[] {
  const keys = [...new Set(
    Object.values(cardData)
      .filter((card) => (card.cardType === "action" || card.cardType === "instant") &&
        LINGERING_SOURCE.test(scriptSource(scripts[card.id])))
      .map(functionalKeyOf),
  )].sort();
  const swept: SweptEffect[] = [];
  for (const key of keys) {
    let g: ReturnType<typeof scenario>;
    try {
      g = scenario({ seats: [{ hero: "rhinar", hand: [key], resources: 12 }, { hero: "dorinthea" }] });
      g.play(key);
    } catch {
      continue;
    }
    const collect = (): void => {
      for (const effect of projectStateFor(g.state, 0).ongoing) swept.push({ key, effect });
    };
    collect();
    try {
      g.blockWith();
    } catch {
      continue;
    }
    collect();
  }
  return swept;
}
