import type { TriggerDef } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import { cardList } from "../catalog.js";
import { functionalKeyOf } from "../functional.js";
import { registry } from "../scripts/index.js";

type TriggerEvent = TriggerDef["event"];

/** Printed self triggers on entering or leaving the arena must be stack
 * triggers, never the immediate onEnterArena / onLeaveArena hooks. */
const KNOWN_EXCEPTIONS: Record<string, string> = {};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The arena events a card's own printed trigger text requires. Granted
 * abilities in quotes belong to another object and are ignored. */
function requiredEvents(name: string, text: string): TriggerEvent[] {
  const unquoted = text.replace(/"[^"]*"/g, "");
  const subject = `(?:this|${escapeRegExp(name)})`;
  const clause = new RegExp(
    `\\b[Ww]hen ${subject} (?:attacks or )?(is equipped|enters or leaves the arena|enters the arena|leaves the arena)`,
    "g",
  );
  const events = new Set<TriggerEvent>();
  for (const match of unquoted.matchAll(clause)) {
    const phrase = match[1]!;
    if (phrase !== "leaves the arena") events.add("card-entered-arena");
    if (phrase.includes("leaves")) events.add("card-left-arena");
  }
  return [...events];
}

describe("arena entry and departure triggers", () => {
  it("implements every printed self enter/leave trigger as a stack trigger", () => {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const card of cardList) {
      const key = functionalKeyOf(card);
      if (seen.has(key) || key in KNOWN_EXCEPTIONS) continue;
      seen.add(key);
      const required = requiredEvents(card.name, card.text ?? "");
      if (required.length === 0) continue;
      const events = new Set((registry[key]?.triggers ?? []).map((trigger) => trigger.event));
      const absent = required.filter((event) => !events.has(event));
      if (absent.length > 0) missing.push(`${key}: ${absent.join(", ")}`);
    }
    expect(missing).toEqual([]);
  });

  it("keeps every documented exception printed with an arena trigger", () => {
    const byKey = new Map(cardList.map((card) => [functionalKeyOf(card), card]));
    for (const key of Object.keys(KNOWN_EXCEPTIONS)) {
      const card = byKey.get(key);
      expect(card, key).toBeDefined();
      expect(requiredEvents(card!.name, card!.text ?? ""), key).not.toEqual([]);
    }
  });
});
