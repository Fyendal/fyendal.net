import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTestIntl, TestI18nProvider } from "../i18n/TestI18nProvider.js";
import {
  ChainPriorityStatus,
  ChainTimingStatus,
  PriorityFloat,
  TurnTimingFloat,
  combatPriorityTimingLabel,
  soloPriorityLabel,
} from "./PriorityFloat.js";
import { localizeTimingLabel } from "./timingLocalization.js";

function renderLocalized(node: ReturnType<typeof createElement>, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(createElement(TestI18nProvider, { locale, children: node }));
}

describe("PriorityFloat", () => {
  it("shows turn ownership and rules timing", () => {
    const html = renderLocalized(createElement(PriorityFloat, {
      turn: 4,
      turnLabel: "Opponent's turn",
      timingLabel: "ACTION PHASE · REACTION STEP",
      priorityLabel: "YOUR PRIORITY",
    }));

    expect(html).toContain("Turn 4 · Opponent&#x27;s turn");
    expect(html).toContain("ACTION PHASE · REACTION STEP · YOUR PRIORITY");
    expect(html).toContain("priority-float-mine");
  });

  it("can identify opponent priority", () => {
    const html = renderLocalized(createElement(PriorityFloat, {
      turn: 4,
      turnLabel: "Your turn",
      timingLabel: "ACTION PHASE",
      priorityLabel: "OPPONENT'S PRIORITY",
    }));

    expect(html).toContain("ACTION PHASE · OPPONENT&#x27;S PRIORITY");
    expect(html).not.toContain("priority-float-mine");
  });

  it("highlights the defender's priority in the timing float and combat chain", () => {
    const props = {
      timingLabel: "ACTION PHASE · DEFEND STEP",
      priorityLabel: "YOUR PRIORITY" as const,
    };
    const float = renderLocalized(createElement(PriorityFloat, {
      ...props,
      turn: 1,
      turnLabel: "Opponent's turn",
    }));
    const chain = renderLocalized(createElement(ChainPriorityStatus, props));

    expect(float).toContain("DEFEND STEP · YOUR PRIORITY");
    expect(float).toContain("priority-float-mine");
    expect(chain).toContain(">DEFEND STEP</span>");
    expect(chain).toContain(">YOUR PRIORITY</span>");
    expect(chain).toContain("chain-priority-status-mine");
  });

  it("keeps turn and timing visible without claiming a mandatory decision is priority", () => {
    const html = renderLocalized(createElement(TurnTimingFloat, {
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
    const html = renderLocalized(createElement(ChainPriorityStatus, {
      timingLabel: "ACTION PHASE · REACTION STEP",
      priorityLabel: "YOUR PRIORITY",
    }));

    expect(html).toContain(">REACTION STEP</span>");
    expect(html).toContain(">YOUR PRIORITY</span>");
    expect(html).toContain("chain-priority-status-mine");
    expect(html).toContain('class="chain-priority-separator"');
    expect(html).not.toContain("ACTION PHASE");
    expect(html).not.toContain("Turn");
  });

  it("shows a defend decision in the combat-chain header without calling it priority", () => {
    const html = renderLocalized(createElement(ChainTimingStatus, {
      label: "ACTION PHASE · DEFEND STEP · YOU CHOOSING BLOCKS",
    }));

    expect(html).toContain(">DEFEND STEP</span>");
    expect(html).toContain(">YOU CHOOSING BLOCKS</span>");
    expect(html).toContain('class="chain-priority-separator"');
    expect(html).not.toContain("ACTION PHASE");
    expect(html).not.toContain("PRIORITY");
  });

  it("localizes turn, phase, step, and priority labels in Chinese", () => {
    const html = renderLocalized(createElement(PriorityFloat, {
      turn: 4,
      turnLabel: "对手的回合",
      timingLabel: "ACTION PHASE · REACTION STEP",
      priorityLabel: "YOUR PRIORITY",
    }), "zh-Hans");

    expect(html).toContain("第 4 回合 · 对手的回合");
    expect(html).toContain("ACTION PHASE · REACTION STEP · 你的优先权");
  });
});

describe("timing localization", () => {
  it("covers every authoritative stack context while preserving On hit", () => {
    const intl = createTestIntl("zh-Hans");
    const contexts = new Map([
      ["RESOLUTION STEP · EFFECTS", "RESOLUTION STEP · 效果"],
      ["DAMAGE STEP · PRIORITY", "DAMAGE STEP · 优先权"],
      ["DAMAGE STEP · ON-HIT TRIGGERS", "DAMAGE STEP · On hit"],
      ["LAYER STEP · ATTACK", "LAYER STEP · 攻击"],
      ["ATTACK STEP · TRIGGERS", "ATTACK STEP · 触发"],
      ["REACTION STEP · REACTIONS", "REACTION STEP · 反应"],
      ["DEFEND STEP · TRIGGERS", "DEFEND STEP · 触发"],
      ["END PHASE · TRIGGERS", "END PHASE · 触发"],
      ["START PHASE · START-OF-TURN TRIGGERS", "START PHASE · 回合开始时触发"],
      ["ACTION PHASE · BEGINNING TRIGGERS", "ACTION PHASE · 阶段开始时触发"],
      ["ACTION PHASE · EFFECTS", "ACTION PHASE · 效果"],
    ]);

    for (const [source, expected] of contexts) {
      expect(localizeTimingLabel(intl, source)).toBe(expected);
    }
  });
});

describe("soloPriorityLabel", () => {
  it("names the priority holder in solo and keeps you/opponent otherwise", () => {
    expect(soloPriorityLabel(true, true, "Kayo")).toBe("KAYO'S PRIORITY");
    expect(soloPriorityLabel(true, false, "Kayo")).toBe("KAYO'S PRIORITY");
    expect(soloPriorityLabel(false, true, "Kayo")).toBe("YOUR PRIORITY");
    expect(soloPriorityLabel(false, false, "Kayo")).toBe("OPPONENT'S PRIORITY");
  });

  it("localizes named priority and named blocking segments", () => {
    const intl = createTestIntl("zh-Hans");
    expect(localizeTimingLabel(intl, "ACTION PHASE · KAYO'S PRIORITY")).not.toContain("'S PRIORITY");
    expect(localizeTimingLabel(createTestIntl("en"), "ACTION PHASE · DEFEND STEP · KAYO CHOOSING BLOCKS"))
      .toBe("ACTION PHASE · DEFEND STEP · KAYO CHOOSING BLOCKS");
    expect(localizeTimingLabel(intl, "DEFEND STEP · KAYO CHOOSING BLOCKS")).toContain("KAYO 正在选择防御牌");
  });

  it("styles a solo priority float as the viewer's own", () => {
    const html = renderLocalized(createElement(PriorityFloat, {
      turn: 2,
      turnLabel: "Kayo's turn",
      timingLabel: "ACTION PHASE",
      priorityLabel: soloPriorityLabel(true, false, "Kayo"),
      mine: true,
    }));
    expect(html).toContain("KAYO&#x27;S PRIORITY");
    expect(html).toContain("priority-float-mine");
  });
});
