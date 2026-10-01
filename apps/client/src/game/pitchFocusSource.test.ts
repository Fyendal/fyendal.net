import type { GameView, PlayerView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { pitchFocusSource } from "./pitchFocusSource.js";
import { postPaymentPitchFocus, retainedPitchFocus } from "./usePitchFocus.js";

function paymentView(): GameView {
  const player: PlayerView = {
    seat: 0, heroCardId: "HERO", heroInstanceId: 1, heroName: "Hero",
    life: 20, actionPoints: 1, resources: 0,
    hand: [{ instanceId: 2, cardId: "HAND", owner: 0 }], handCount: 1,
    board: [{ instanceId: 3, cardId: "BOARD", owner: 0, tapped: true }],
    arsenal: [{ instanceId: 4, cardId: "ARSENAL", owner: 0 }], arsenalCount: 1,
    weapons: [], equipment: {}, deckCount: 0, pitch: [], pitchCount: 0,
    graveyard: [], banish: [], soul: [],
  };
  return {
    gameId: "payment", turn: 1, phase: "action", activePlayer: 0, priorityPlayer: 0,
    players: [player, { ...player, seat: 1, hand: [], board: [], arsenal: [] }],
    chain: [], stack: [], ongoing: [], pendingDecision: null, winner: null, log: [],
  };
}

describe("pitch focus source", () => {
  it("keeps a pitched play focused through boost, targets, and confirmation", () => {
    for (const step of ["boost", "target", "close-chain", "confirm"] as const) {
      expect(postPaymentPitchFocus(step, 1, "resource")).toBe(true);
      expect(postPaymentPitchFocus(step, 0, "resource")).toBe(false);
      expect(postPaymentPitchFocus(step, 1, "discard")).toBe(false);
    }
    expect(postPaymentPitchFocus("method", 1, "resource")).toBe(false);
    expect(postPaymentPitchFocus("payment", 1, "resource")).toBe(false);

    const view = paymentView();
    const selection = { kind: "play-hand" as const, instanceId: 2 };
    // The choice can follow a pitch in the same render, before the effect
    // that remembers the prior payment focus has run.
    const focused = retainedPitchFocus(view, 0, selection, true, true, null);
    expect(focused?.source.card.instanceId).toBe(2);
    expect(focused?.source.fromHand).toBe(true);
  });

  it("retains focus after pitching until submission, cancellation, or a different announcement", () => {
    const view = paymentView();
    const selection = { kind: "play-hand" as const, instanceId: 2 };
    const focused = retainedPitchFocus(view, 0, selection, true, true, null);
    expect(focused?.source.fromHand).toBe(true);
    expect(retainedPitchFocus(view, 0, selection, false, true, focused)).toBe(focused);
    expect(retainedPitchFocus(view, 0, { kind: "none" }, false, true, focused, 2)).toBe(focused);
    expect(retainedPitchFocus(view, 0, { kind: "none" }, false, true, focused)).toBeNull();
    expect(retainedPitchFocus(view, 0, { kind: "activate", sourceInstanceId: 3 }, false, true, focused)).toBeNull();
    expect(retainedPitchFocus(view, 0, selection, false, false, focused)).toBeNull();
    expect(retainedPitchFocus({ ...view, gameId: "another" }, 0, selection, false, true, focused)).toBeNull();
    view.stack = [{ card: view.players[0]!.hand[0]!, seat: 0, label: "Play", optional: false }];
    expect(retainedPitchFocus(view, 0, selection, false, true, focused)).toBeNull();
    expect(retainedPitchFocus(view, 0, { kind: "none" }, false, true, focused, 2)).toBeNull();
  });

  it("distinguishes hand plays and hand abilities from arena sources", () => {
    const view = paymentView();
    expect(pitchFocusSource(view, 0, { kind: "play-hand", instanceId: 2 }))
      .toEqual({ card: view.players[0]!.hand[0], fromHand: true });
    expect(pitchFocusSource(view, 0, { kind: "activate", sourceInstanceId: 2 })?.fromHand).toBe(true);
    expect(pitchFocusSource(view, 0, { kind: "activate", sourceInstanceId: 3 }))
      .toEqual({ card: view.players[0]!.board[0], fromHand: false });
    expect(pitchFocusSource(view, 0, { kind: "play-arsenal", instanceId: 4 })?.fromHand).toBe(false);
    expect(pitchFocusSource(view, 0, { kind: "activate", sourceInstanceId: 1 })?.card.cardId).toBe("HERO");
  });

  it("uses the authoritative pre-stack source even after it has left the hand", () => {
    const view = paymentView();
    const card = view.players[0]!.hand.pop()!;
    view.pendingDecision = {
      player: 0, kind: "choose-target", prompt: "Pay resources",
      preStackSource: { card, zone: "hand" },
      resourcePayment: { cost: 2, options: [] },
    };
    expect(pitchFocusSource(view, 0, { kind: "none" })).toEqual({ card, fromHand: true });
    expect(pitchFocusSource(view, 1, { kind: "none" })).toBeNull();
  });

  it("focuses the visible arena source of a scripted payment without a local selection", () => {
    const view = paymentView();
    view.pendingDecision = {
      player: 0, kind: "optional-effect", prompt: "Pay 2?",
      resourcePayment: { cost: 2, options: [], sourceInstanceId: 3 },
    };
    const selection = { kind: "none" as const };
    expect(pitchFocusSource(view, 0, selection)).toEqual({
      card: view.players[0]!.board[0], fromHand: false,
    });
    expect(pitchFocusSource(view, 1, selection)).toBeNull();
    const focus = retainedPitchFocus(view, 0, selection, true, true, null);
    expect(retainedPitchFocus(view, 0, selection, false, true, focus)).toBe(focus);
    view.pendingDecision = null;
    expect(retainedPitchFocus(view, 0, selection, false, true, focus)).toBeNull();
  });

  it("does not focus a hidden arena payment source", () => {
    const view = paymentView();
    view.players[0]!.board[0]!.hidden = true;
    view.pendingDecision = {
      player: 0, kind: "optional-effect", prompt: "Pay 2?",
      resourcePayment: { cost: 2, options: [], sourceInstanceId: 3 },
    };
    expect(pitchFocusSource(view, 0, { kind: "none" })).toBeNull();
  });

  it("resolves a payment source that is only visible on the stack", () => {
    const view = paymentView();
    const card = { instanceId: 8, cardId: "STACK", owner: 0 };
    view.stack = [{ card, seat: 0, label: "Effect", optional: true }];
    view.pendingDecision = {
      player: 0, kind: "optional-effect", prompt: "Pay 2?",
      resourcePayment: { cost: 2, options: [], sourceInstanceId: 8 },
    };
    expect(pitchFocusSource(view, 0, { kind: "none" })).toEqual({ card, fromHand: false });
  });

  it("does not invent a source for a hidden or missing card", () => {
    const view = paymentView();
    view.players[0]!.arsenal[0]!.hidden = true;
    expect(pitchFocusSource(view, 0, { kind: "play-arsenal", instanceId: 4 })).toBeNull();
    expect(pitchFocusSource(view, 0, { kind: "activate", sourceInstanceId: 99 })).toBeNull();
  });
});
