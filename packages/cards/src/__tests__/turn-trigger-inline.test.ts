import { describe, expect, it } from "vitest";
import { projectStateFor } from "@fyendal/engine";
import { scenario, type SeatSpec } from "./harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function seat(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "rhinar", ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

describe("mandatory turn triggers resolve inline", () => {
  it("expires start-of-turn tokens with an order prompt but no stack layer or priority window", () => {
    const g = scenario({
      seats: [seat({ board: ["might|0", "confidence|0"] }), seat()],
    });
    g.endTurn();
    g.doRaw({ kind: "pass" });
    if (g.state.pendingDecision?.kind === "arsenal") g.doRaw({ kind: "choose", optionId: "pass" });
    // The opponent's end-of-action pass window is a real priority point.
    if (g.state.pendingDecision?.kind === "priority-window") g.doRaw({ kind: "pass" });
    // Distinct simultaneous triggers still let the controller order them.
    expect(g.state.pendingDecision?.kind).toBe("order-triggers");
    expect(projectStateFor(g.state, 0).stack).toHaveLength(0);
    g.doRaw({ kind: "order-triggers", optionIds: g.state.pendingDecision!.options! });
    expect(g.state.pendingDecision).toBeNull();
    expect(g.state.stack).toHaveLength(0);
    g.expectZoneSize(0, "board", 0);
    expect(g.state.log.some((entry) => entry.publicText?.includes("triggers"))).toBe(true);
  });
});
