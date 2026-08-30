import { describe, it, expect } from "vitest";
import { projectStateFor } from "@fyendal/engine";
import { scenario } from "../harness.js";

describe("REPRO — draw-then-discard duplication", () => {
  it("discarded card leaves the hand in state and projection", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["bare fangs|1", "raging onslaught|2", "dodge|3"],
          deck: ["pack hunt|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.play("bare fangs|1", { pitch: ["raging onslaught|2"], settle: false });
    const p = g.state.players[0]!;
    console.log("hand:", p.hand.map((c) => c.cardId));
    console.log("graveyard:", p.graveyard.map((c) => c.cardId));
    const view = projectStateFor(g.state, 0);
    console.log("view hand:", view.players[0]!.hand.map((c) => c.cardId));
    console.log("view graveyard:", view.players[0]!.graveyard.map((c) => c.cardId));
    // hand: dodge + drawn pack hunt = 2, then 1 discarded at random → 1 left
    expect(p.hand).toHaveLength(1);
    expect(p.graveyard).toHaveLength(1);
    const inHand = new Set(p.hand.map((c) => c.instanceId));
    for (const c of p.graveyard) expect(inHand.has(c.instanceId)).toBe(false);
    expect(view.players[0]!.hand).toHaveLength(1);
  });
});
