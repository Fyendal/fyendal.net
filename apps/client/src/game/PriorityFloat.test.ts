import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ChainPriorityStatus,
  ChainTimingStatus,
  PriorityFloat,
  TurnTimingFloat,
  combatPriorityTimingLabel,
} from "./PriorityFloat.js";

describe("PriorityFloat", () => {
  it("shows turn ownership and rules timing", () => {
    const html = renderToStaticMarkup(createElement(PriorityFloat, {
      turn: 4,
      turnLabel: "Opponent's turn",
      timingLabel: "ACTION PHASE · REACTION STEP",
      priorityLabel: "YOUR PRIORITY",
    }));

    expect(html).toContain("Turn 4 · Opponent&#x27;s turn");
    expect(html).toContain("ACTION PHASE · REACTION STEP · YOUR PRIORITY");
  });

  it("can identify opponent priority", () => {
    const html = renderToStaticMarkup(createElement(PriorityFloat, {
      turn: 4,
      turnLabel: "Your turn",
      timingLabel: "ACTION PHASE",
      priorityLabel: "OPPONENT'S PRIORITY",
    }));

    expect(html).toContain("ACTION PHASE · OPPONENT&#x27;S PRIORITY");
  });

  it("keeps turn and timing visible without claiming a mandatory decision is priority", () => {
    const html = renderToStaticMarkup(createElement(TurnTimingFloat, {
      turn: 1,
      turnLabel: "Your turn",
      timingLabel: "START PHASE",
    }));

    expect(html).toContain("Turn 1 · Your turn");
    expect(html).toContain("START PHASE");
    expect(html).not.toContain("PRIORITY");
  });

  it("removes redundant action-phase context inside the combat chain", () => {
    expect(combatPriorityTimingLabel("ACTION PHASE · REACTION STEP")).toBe("REACTION STEP");
    const html = renderToStaticMarkup(createElement(ChainPriorityStatus, {
      timingLabel: "ACTION PHASE · REACTION STEP",
      priorityLabel: "YOUR PRIORITY",
    }));

    expect(html).toContain(">REACTION STEP</span>");
    expect(html).toContain(">YOUR PRIORITY</span>");
    expect(html).toContain('class="chain-priority-separator"');
    expect(html).not.toContain("ACTION PHASE");
    expect(html).not.toContain("Turn");
  });

  it("shows a defend decision in the combat-chain header without calling it priority", () => {
    const html = renderToStaticMarkup(createElement(ChainTimingStatus, {
      label: "ACTION PHASE · DEFEND STEP · YOU CHOOSING BLOCKS",
    }));

    expect(html).toContain(">DEFEND STEP</span>");
    expect(html).toContain(">YOU CHOOSING BLOCKS</span>");
    expect(html).toContain('class="chain-priority-separator"');
    expect(html).not.toContain("ACTION PHASE");
    expect(html).not.toContain("PRIORITY");
  });
});
