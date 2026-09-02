import type { PendingDecision } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  shouldHidePriorityGuidance,
  shouldShowDecisionPass,
} from "./decisionPass.js";

function decision(
  kind: PendingDecision["kind"],
  options: string[],
): PendingDecision {
  return { player: 0, kind, prompt: "Choose", options };
}

describe("decision pass button", () => {
  it("hides Pass when a yes/no decision already renders No", () => {
    expect(shouldShowDecisionPass(decision("optional-effect", ["yes", "no"]), true))
      .toBe(false);
  });

  it("also hides Pass for payment choices with an explicit No", () => {
    expect(shouldShowDecisionPass(decision("optional-effect", ["pay 2", "no"]), true))
      .toBe(false);
  });

  it("keeps distinct Pass controls and respects legality", () => {
    expect(shouldShowDecisionPass(decision("arsenal", ["1"]), true)).toBe(false);
    expect(shouldShowDecisionPass(decision("optional-effect", ["yes", "no"]), false))
      .toBe(false);
  });

  it.each(["priority-window", "attack-reaction", "defense-reaction"] as const)(
    "also keeps Pass beside the %s guidance",
    (kind) => {
      expect(shouldShowDecisionPass(decision(kind, []), true)).toBe(true);
    },
  );

  it("keeps Pass in decision panels that do not use the status float", () => {
    expect(shouldShowDecisionPass(decision("choose-target", ["1"]), true)).toBe(true);
  });
});

describe("priority guidance decisions", () => {
  const visible = {
    isMine: true,
    lessGuidance: false,
    mobileHandIsHidden: false,
  };

  it("keeps pass-only guidance visible by default", () => {
    expect(shouldHidePriorityGuidance(decision("priority-window", []), visible)).toBe(false);
  });

  it.each(["priority-window", "attack-reaction", "defense-reaction"] as const)(
    "hides %s guidance when Show guidance is off",
    (kind) => {
      expect(shouldHidePriorityGuidance(decision(kind, []), {
        ...visible,
        lessGuidance: true,
      })).toBe(true);
    },
  );

  it("hides pass-only guidance when the mobile hand is hidden", () => {
    expect(shouldHidePriorityGuidance(decision("defense-reaction", []), {
      ...visible,
      mobileHandIsHidden: true,
    })).toBe(true);
  });

  it("keeps required decisions and opponent status visible", () => {
    expect(shouldHidePriorityGuidance(decision("arsenal", ["1"]), {
      ...visible,
      lessGuidance: true,
    })).toBe(false);
    expect(shouldHidePriorityGuidance(decision("optional-effect", ["yes", "no"]), {
      ...visible,
      mobileHandIsHidden: true,
    })).toBe(false);
    expect(shouldHidePriorityGuidance(decision("priority-window", []), {
      ...visible,
      isMine: false,
      lessGuidance: true,
    })).toBe(false);
    expect(shouldHidePriorityGuidance(null, {
      ...visible,
      lessGuidance: true,
    })).toBe(false);
  });
});
