import { describe, expect, it } from "vitest";
import { engineRuntime } from "../engineRuntime.js";
import { projectStateFor } from "../index.js";
import type { GameStateInternal } from "../runtimeState.js";
import type { CardInstance } from "../state.js";
import { giveCard, makeGame, player } from "./fixtures.js";

function auraWithCountersAndState(s: GameStateInternal): CardInstance {
  const p = player(s, 0);
  const id = giveCard(s, 0, "AURA");
  const aura = p.hand.splice(p.hand.findIndex((card) => card.instanceId === id), 1)[0]!;
  aura.counters = { verse: 2, holo: 1 };
  aura.scriptState = { fused: 1, attacked: 1, privateChoice: 7 };
  p.board.push(aura);
  return aura;
}

describe("card counters and script state", () => {
  it("projects rules counters and public statuses but never private script state", () => {
    const s = makeGame(11);
    const aura = auraWithCountersAndState(s);

    for (const seat of [0, 1]) {
      const view = projectStateFor(s, seat).players[0]!.board.find((card) => card.instanceId === aura.instanceId);
      expect(view?.counters).toEqual({ verse: 2, holo: 1, fused: 1, attacked: 1 });
    }
  });

  it("removes every counter when a card leaves the arena, keeping them only as last-known information", () => {
    const s = makeGame(12);
    const aura = auraWithCountersAndState(s);

    expect(engineRuntime.makeCtx(s, 0, player(s, 0).hero).moveToHand(aura.instanceId)).toBe(true);

    const returned = player(s, 0).hand.find((card) => card.instanceId === aura.instanceId)!;
    expect(returned.counters).toBeUndefined();
    expect(returned.lastKnownCounters).toEqual({ verse: 2, holo: 1 });
    // Arena-only statuses end with the object; other script state is private
    // bookkeeping that survives the move.
    expect(returned.scriptState).toEqual({ fused: 1, privateChoice: 7 });
    expect(projectStateFor(s, 0).players[0]!.hand.find((card) => card.instanceId === aura.instanceId)?.counters)
      .toBeUndefined();
  });

  it("removes counters for every inactive destination", () => {
    for (const move of ["banish", "putOnDeckBottom"] as const) {
      const s = makeGame(13);
      const aura = auraWithCountersAndState(s);
      expect(engineRuntime.makeCtx(s, 0, player(s, 0).hero)[move](aura.instanceId)).toBe(true);
      const p = player(s, 0);
      const moved = [...p.banish, ...p.deck].find((card) => card.instanceId === aura.instanceId)!;
      expect(moved.counters).toBeUndefined();
      expect(moved.lastKnownCounters).toEqual({ verse: 2, holo: 1 });
    }
  });
});
