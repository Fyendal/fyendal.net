import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  StackFloat,
  stackActivityRevision,
  stackActivityShouldReveal,
  stackLayerLabel,
} from "./StackFloat.js";

describe("stack popup visibility", () => {
  it("reveals popups for new stack activity but not an unchanged or emptied stack", () => {
    const emptyRevision = stackActivityRevision([]);
    const triggerRevision = stackActivityRevision([
      { card: null, seat: 0, label: "On hit", optional: false },
    ]);
    const secondTriggerRevision = stackActivityRevision([
      { card: null, seat: 0, label: "On hit", optional: false },
      { card: null, seat: 1, label: "React", optional: false },
    ]);

    expect(emptyRevision).toBe("");
    expect(stackActivityShouldReveal(emptyRevision, triggerRevision)).toBe(true);
    expect(stackActivityShouldReveal(triggerRevision, triggerRevision)).toBe(false);
    expect(stackActivityShouldReveal(triggerRevision, secondTriggerRevision)).toBe(true);
    expect(stackActivityShouldReveal(triggerRevision, emptyRevision)).toBe(false);
  });

  it("treats a newly pending attack as stack activity", () => {
    const attackRevision = stackActivityRevision([], {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 0,
      resolved: false,
    });

    expect(stackActivityShouldReveal("", attackRevision)).toBe(true);
  });
});

describe("stack context", () => {
  it("presents Heave as an unresolved opportunity", () => {
    expect(stackLayerLabel("Heave 2")).toBe("Heave 2 opportunity");
    expect(stackLayerLabel("Destroy Runechant: 1 arcane damage"))
      .toBe("Destroy Runechant: 1 arcane damage");
  });

  it("shows which combat step created the stack", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [{ card: null, seat: 0, label: "On hit", optional: false }],
      context: "DAMAGE STEP · ON-HIT TRIGGERS",
    }));

    expect(html).toContain("The Stack");
    expect(html).toContain("stack-context");
    expect(html).toContain("DAMAGE STEP · ON-HIT TRIGGERS");
    expect(html).toContain('aria-label="Minimize stack"');
  });

  it("uses the canonical Runechant art for its stack trigger", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [{
        card: { instanceId: 42, cardId: "ROS162", owner: 0 },
        seat: 0,
        label: "Destroy Runechant: 1 arcane damage",
        optional: false,
      }],
    }));

    expect(html).toContain("https://content.fabrary.net/cards/ARC112.webp");
    expect(html).not.toContain("https://content.fabrary.net/cards/ROS162.webp");
  });

  it("offers the consecutive Runechant shortcut to either player", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [{
        card: { instanceId: 42, cardId: "ARC112", owner: 0 },
        seat: 0,
        label: "Destroy Runechant: 1 arcane damage",
        optional: false,
      }],
      onSkipRunechants: () => undefined,
    }));

    expect(html).toContain("Skip all Runechants");
    expect(html).toContain("Skip consecutive Runechants in this priority window");
  });

  it("hides trigger effect text with Less Guidance", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [{ card: null, seat: 0, label: "Create an Eloquence token", optional: true }],
      lessGuidance: true,
    }));

    expect(html).toContain("The Stack");
    expect(html).toContain("Trigger");
    expect(html).not.toContain("Create an Eloquence token");
    expect(html).not.toContain("(may)");
  });

  it("renders grouped Blood Debt as one life-loss tile", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [{
        card: { instanceId: 42, cardId: "PEN127", owner: 0 },
        seat: 0,
        label: "Blood Debt — lose 1 life",
        optional: false,
        count: 3,
      }],
      lessGuidance: true,
    }));

    expect(html).toContain("blood-debt-stack-tile");
    expect(html).toContain('aria-label="Blood Debt: lose 3 life"');
    expect(html).toContain("blood-debt-stack-amount\">3");
    expect(html).not.toContain("content.fabrary.net/cards/PEN127.webp");
    expect(html.match(/class="stack-layer"/g)).toHaveLength(1);
  });

  it("shows go again on a pending attack as a tooltip icon", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [],
      attack: {
        attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0, tapped: true },
        defendingCards: [],
        reactions: [],
        attackValue: 3,
        defenseValue: 0,
        damage: 0,
        resolved: false,
        goAgain: true,
      },
    }));

    expect(html).toContain("/icons/go-again.png");
    expect(html).toContain('role="tooltip">Go again');
    expect(html).not.toContain("stack-label\">Go again");
    expect(html).not.toContain("card-tapped");
  });

  it("shows dominate on a pending attack as a tooltip icon", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [],
      attack: {
        attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
        defendingCards: [],
        reactions: [],
        attackValue: 3,
        defenseValue: 0,
        damage: 0,
        resolved: false,
        dominate: true,
      },
    }));

    expect(html).toContain("/icons/dominate.png");
    expect(html).toContain('role="tooltip">Dominate');
    expect(html).not.toContain("stack-label\">Dominate");
  });

  it("shows overpower on a pending attack as a tooltip icon", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [],
      attack: {
        attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
        defendingCards: [],
        reactions: [],
        attackValue: 3,
        defenseValue: 0,
        damage: 0,
        resolved: false,
        overpower: true,
      },
    }));

    expect(html).toContain("/icons/overpower.svg");
    expect(html).toContain('role="tooltip">Overpower');
    expect(html).not.toContain("stack-label\">Overpower");
  });

  it("shows a completed wager on a pending attack as a tooltip icon", () => {
    const html = renderToStaticMarkup(createElement(StackFloat, {
      layers: [],
      attack: {
        attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
        defendingCards: [],
        reactions: [],
        attackValue: 3,
        defenseValue: 0,
        damage: 0,
        resolved: false,
        wagered: true,
        wagerRewards: ["Winner creates Might", "Winner creates Vigor"],
      },
    }));

    expect(html).toContain("/icons/wager.png");
    expect(html).toContain('role="tooltip">Wagered: Winner creates Might; Winner creates Vigor');
  });
});
