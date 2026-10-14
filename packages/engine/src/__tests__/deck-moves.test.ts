import { describe, expect, it } from "vitest";
import { engineRuntime } from "../engineRuntime.js";
import { giveCard, makeGame, player } from "./fixtures.js";

describe("shuffleIntoDeck", () => {
  it("moves cards into the deck with one shuffle and one hidden-zone-safe log line per card", () => {
    const s = makeGame(7);
    const p = player(s, 0);
    const fromHand = giveCard(s, 0, "BIG");
    const banished = giveCard(s, 0, "DOM");
    p.banish.push(...p.hand.splice(p.hand.findIndex((card) => card.instanceId === banished), 1));
    const deckSize = p.deck.length;
    const logStart = s.log.length;

    const moved = engineRuntime.makeCtx(s, 0, p.hero).shuffleIntoDeck([fromHand, banished, fromHand]);

    expect(moved).toBe(2);
    expect(p.deck).toHaveLength(deckSize + 2);
    expect(p.hand.some((card) => card.instanceId === fromHand)).toBe(false);
    expect(p.banish).toEqual([]);
    const entries = s.log.slice(logStart);
    expect(entries.map((entry) => entry.publicText)).toEqual([
      "A card is shuffled into Hero A's deck",
      "Dominator is shuffled into Hero A's deck",
    ]);
    expect(entries[0]!.seatText?.[0]).toBe("Big Swing is shuffled into Hero A's deck");
    expect(entries[0]!.seatText?.[1]).toBeNull();
    expect(entries.filter((entry) => entry.publicPayload?.event?.kind === "shuffle")).toHaveLength(1);
    expect(entries.some((entry) => entry.publicText?.includes("bottom"))).toBe(false);
  });
});
