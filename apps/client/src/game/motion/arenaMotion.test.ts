import { describe, expect, it } from "vitest";
import { planArenaMotion, type ArenaStackState } from "./arenaMotion.js";

const slot = (index: number, tapped = false) => ({
  left: 100 + index * 120 + (tapped ? -15 : 0),
  top: 50 + (tapped ? 15 : 0),
  width: tapped ? 130 : 100,
  height: tapped ? 100 : 130,
});

const stack = (
  index: number,
  ids: number[],
  options: { tapped?: boolean; overlays?: Record<string, string> } = {},
): ArenaStackState => ({
  members: ids.map((id) => `0:board:${id}`),
  rect: slot(index, options.tapped),
  tapped: options.tapped ?? false,
  overlays: options.overlays ?? {},
});

describe("planArenaMotion", () => {
  it("peels a tapped copy off its stack while the remainder keeps its slot", () => {
    const plan = planArenaMotion(
      new Map([["a", stack(0, [7, 8, 9])]]),
      new Map([["a", stack(0, [7, 8])], ["b", stack(1, [9], { tapped: true })]]),
    );

    expect(plan.merges).toEqual([]);
    expect(plan.stacks).toEqual([
      { id: "a", dx: 0, dy: 0, peel: false, countChanged: true, changedOverlays: [] },
      { id: "b", dx: -120, dy: 0, peel: true, countChanged: false, changedOverlays: [], tappedFrom: false },
    ]);
  });

  it("peels the stack that moves when the first copy is the one tapped", () => {
    const plan = planArenaMotion(
      new Map([["a", stack(0, [7, 8, 9])], ["z", stack(1, [20])]]),
      new Map([
        ["a", stack(0, [7], { tapped: true })],
        ["b", stack(1, [8, 9])],
        ["z", stack(2, [20])],
      ]),
    );

    expect(plan.stacks.find((motion) => motion.id === "a")).toMatchObject({ peel: false, tappedFrom: false });
    expect(plan.stacks.find((motion) => motion.id === "b")).toMatchObject({ peel: true, dx: -120 });
    expect(plan.stacks.find((motion) => motion.id === "z")).toMatchObject({ peel: false, dx: -120, dy: 0 });
  });

  it("glides an untapped card back onto the stack it now matches", () => {
    const plan = planArenaMotion(
      new Map([["a", stack(0, [7, 8])], ["b", stack(1, [9], { tapped: true })]]),
      new Map([["a", stack(0, [7, 8, 9])]]),
    );

    expect(plan.merges).toEqual([{ fromId: "b", intoId: "a", dx: -120, dy: 0, tappedTo: false }]);
    expect(plan.stacks).toEqual([
      { id: "a", dx: 0, dy: 0, peel: false, countChanged: true, changedOverlays: [] },
    ]);
  });

  it("peels a card off one stack and lands it on another", () => {
    const plan = planArenaMotion(
      new Map([["a", stack(0, [7, 8])], ["c", stack(1, [9], { tapped: true })]]),
      new Map([["a", stack(0, [7])], ["b", stack(1, [8, 9], { tapped: true })]]),
    );

    expect(plan.stacks.find((motion) => motion.id === "b")).toMatchObject({
      peel: true,
      dx: -120,
      tappedFrom: false,
    });
    expect(plan.merges).toEqual([{ fromId: "c", intoId: "b", dx: 0, dy: 0, tappedTo: true }]);
  });

  it("continues a stack whose first card left without a merge copy", () => {
    const plan = planArenaMotion(
      new Map([["a", stack(0, [7, 8])]]),
      new Map([["b", stack(0, [8])]]),
    );

    expect(plan).toEqual({ stacks: [], merges: [] });
  });

  it("leaves new arrivals and departures to the motion queue", () => {
    const plan = planArenaMotion(
      new Map([["a", stack(0, [7])]]),
      new Map([["b", stack(0, [12])]]),
    );

    expect(plan).toEqual({ stacks: [], merges: [] });
  });

  it("pops a counter that changes on a card that splits off", () => {
    const plan = planArenaMotion(
      new Map([["a", stack(0, [7, 8])]]),
      new Map([["a", stack(0, [7])], ["b", stack(1, [8], { overlays: { "c-plus1": "1" } })]]),
    );

    expect(plan.stacks.find((motion) => motion.id === "b")?.changedOverlays).toEqual(["c-plus1"]);
  });
});
