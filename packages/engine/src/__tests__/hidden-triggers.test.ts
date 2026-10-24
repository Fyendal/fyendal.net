import { describe, expect, it } from "vitest";
import { applyIntent, projectStateFor } from "../index.js";
import type { GameStateInternal } from "../runtimeState.js";
import { giveCard, makeGame } from "./fixtures.js";

/** Seat 1 holds BLUE, whose hidden ability triggers whenever a card is played. */
function heldHiddenTrigger(canAccept = true): { s: GameStateInternal; held: number } {
  const s = makeGame();
  s.scriptsRef = {
    ...s.scriptsRef,
    BLUE: {
      triggers: [{
        event: "card-played",
        whose: "any",
        sourceZone: "hand",
        label: "Hidden effect",
        canAccept: () => canAccept,
        effect: () => {},
      }],
    },
  };
  const held = giveCard(s, 1, "BLUE");
  const instant = giveCard(s, 0, "INSTANT");
  const played = applyIntent(s, 0, { kind: "play-card", instanceId: instant, pitchInstanceIds: [] });
  if (!played.ok) throw new Error(played.error);
  return { s: played.state as GameStateInternal, held };
}

function opponentSees(s: GameStateInternal, held: number): { stack: boolean; log: boolean } {
  const view = projectStateFor(s, 0);
  const logs = JSON.stringify(view.logEntries ?? []);
  return {
    stack: view.stack.some((layer) => layer.card?.instanceId === held || layer.label === "Hidden effect"),
    log: logs.includes("Blue Resource") || logs.includes("\"BLUE\""),
  };
}

describe("hidden triggered abilities (CR 5.4.7b)", () => {
  it("offers a private-zone trigger only to its owner and keeps it off the opponent's stack", () => {
    const { s, held } = heldHiddenTrigger();

    expect(s.pendingDecision).toMatchObject({ player: 1, chooseHook: "hidden-trigger" });
    expect(s.stack.some((layer) => layer.sourceInstanceId === held && layer.hiddenSource)).toBe(true);
    expect(opponentSees(s, held)).toEqual({ stack: false, log: false });
    expect(projectStateFor(s, 0).pendingDecision?.prompt).toBe("");
    expect(projectStateFor(s, 1).pendingDecision?.sourceInstanceId).toBe(held);
    expect(projectStateFor(s, 1).pendingDecision?.promptMessage?.values?.card)
      .toEqual({ kind: "card", cardId: "BLUE" });
    expect(projectStateFor(s, 0).pendingDecision?.promptMessage).toBeUndefined();
  });

  it("names the source publicly once its owner decides to trigger it", () => {
    const { s, held } = heldHiddenTrigger();
    const accepted = applyIntent(s, 1, { kind: "choose", optionId: "yes" });
    if (!accepted.ok) throw new Error(accepted.error);

    const next = accepted.state as GameStateInternal;
    expect(next.stack.find((layer) => layer.sourceInstanceId === held)?.hiddenSource).toBeUndefined();
    expect(opponentSees(next, held)).toEqual({ stack: true, log: true });
  });

  it("leaves no public trace when declined or when it could do nothing", () => {
    const { s, held } = heldHiddenTrigger();
    const declined = applyIntent(s, 1, { kind: "choose", optionId: "no" });
    if (!declined.ok) throw new Error(declined.error);
    const next = declined.state as GameStateInternal;
    expect(next.stack.some((layer) => layer.sourceInstanceId === held)).toBe(false);
    expect(opponentSees(next, held)).toEqual({ stack: false, log: false });

    const useless = heldHiddenTrigger(false);
    expect(useless.s.pendingDecision?.chooseHook).not.toBe("hidden-trigger");
    expect(useless.s.stack.some((layer) => layer.sourceInstanceId === useless.held)).toBe(false);
    expect(opponentSees(useless.s, useless.held)).toEqual({ stack: false, log: false });
  });
});
