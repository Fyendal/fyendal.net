import { describe, expect, it } from "vitest";
import type { CardView, GameTransitionMove, GameView, PlayerView } from "@fyendal/shared";
import { opponentPlayPresentation, type OpponentPlayPresentation } from "./opponentPlayPresentation.js";
import { detectGameMotionEvents } from "./motion/detectMotionEvents.js";
import { transitionMotionEvents } from "./motion/transitionMotionEvents.js";
import { classifyViewUpdate } from "./motion/classifyViewUpdate.js";
import type { ViewUpdate } from "../store/types.js";

const card: CardView = { instanceId: 10, cardId: "ACTION", owner: 1 };
const pitch: CardView = { instanceId: 11, cardId: "BLUE", owner: 1 };

function player(seat: number): PlayerView {
  return {
    seat, heroCardId: "HERO", heroInstanceId: 100 + seat, heroName: "Hero", life: 20, actionPoints: 1, resources: 0,
    hand: [], handCount: 4, deckCount: 20, arsenal: [], arsenalCount: 0,
    pitch: [], pitchCount: 0, graveyard: [], banish: [], soul: [], weapons: [], equipment: {}, board: [],
  };
}

function view(): GameView {
  return {
    gameId: "game", turn: 1, phase: "action", activePlayer: 1, priorityPlayer: 1,
    players: [player(0), player(1)], chain: [], stack: [], ongoing: [], pendingDecision: null,
    winner: null, log: [],
  };
}

function choosing(): GameView {
  const current = view();
  current.players[1] = { ...player(1), handCount: 2, pitch: [pitch], pitchCount: 1, resources: 1 };
  current.pendingDecision = {
    player: 1, kind: "choose-target", prompt: "",
    preStackSource: { card, zone: "hand" },
  };
  current.log = ["Opponent plays ACTION", "Opponent pitches BLUE"];
  return current;
}

function finished(): GameView {
  const current = choosing();
  current.phase = "layer";
  current.pendingDecision = { player: 0, kind: "priority-window", prompt: "Respond" };
  current.stack = [{ card, seat: 1, label: "Action", optional: false }];
  return current;
}

const paymentMove: GameTransitionMove = {
  kind: "move", from: { kind: "hand", seat: 1 }, to: { kind: "pitch", seat: 1 },
  count: 1, instanceId: pitch.instanceId,
};

type ArenaZone = "equipment" | "weapon" | "board" | "hero";

function withArenaSource(view: GameView, zone: ArenaZone, source: CardView = card): GameView {
  const player = view.players[1]!;
  if (zone === "equipment") player.equipment.arms = source;
  else if (zone === "weapon") player.weapons = [source];
  else if (zone === "board") player.board = [source];
  else {
    player.heroInstanceId = source.instanceId;
    player.heroCardId = source.cardId;
  }
  return view;
}

function advance(
  previous: OpponentPlayPresentation | null,
  current: GameView | null,
  options: { update?: Partial<ViewUpdate>; viewerSeat?: number | null; enabled?: boolean; scope?: string } = {},
): OpponentPlayPresentation {
  const sequence = (previous?.input.update.sequence ?? 0) + 1;
  return opponentPlayPresentation(previous, {
    view: current,
    update: {
      sequence, roomVersion: sequence, source: "live", transition: previous ? "forward" : "replace",
      gameTransition: { kind: "forward", fromVersion: sequence - 1, events: [] },
      ...options.update,
    },
    enabled: options.enabled ?? true,
    viewerSeat: options.viewerSeat === undefined ? 0 : options.viewerSeat,
    scope: options.scope ?? "room:alice",
  });
}

describe("opponent play presentation", () => {
  it.each(["equipment", "weapon", "board", "hero"] as const)(
    "defers %s costs and then connects its ability to the stack without moving the source",
    (zone) => {
      const initial = advance(null, withArenaSource(view(), zone));
      const current = withArenaSource(choosing(), zone, { ...card, tapped: true });
      current.pendingDecision!.preStackSource = { card, zone };
      const paying = advance(initial, current, { update: {
        gameTransition: { kind: "forward", fromVersion: 1, events: [paymentMove] },
      } });
      expect(paying.pending?.source.zone).toBe(zone);
      expect(paying.view?.players).toBe(initial.view?.players);
      expect(detectGameMotionEvents(initial.view!, paying.view!)).toEqual([]);
      const modes = advance(paying, { ...current });
      expect(detectGameMotionEvents(paying.view!, modes.view!)).toEqual([]);

      const ready = advance(modes, withArenaSource(finished(), zone, { ...card, tapped: true }));
      const events = transitionMotionEvents(modes.view!, ready.view!, ready.update.gameTransition!, "forward");
      expect(events.filter((event) => event.kind === "connect" && event.instanceId === card.instanceId))
        .toEqual([expect.objectContaining({ source: expect.objectContaining({ kind: zone }) })]);
      expect(events.filter((event) => event.kind === "move" && event.instanceId === card.instanceId)).toEqual([]);
      expect(events.filter((event) => event.kind === "move" && event.instanceId === pitch.instanceId)).toHaveLength(1);
    },
  );

  it("defers a new weapon activation even when its earlier attack is still on the chain", () => {
    const before = withArenaSource(view(), "weapon");
    before.chain = [{
      attackingCard: card, defendingCards: [], reactions: [], attackValue: 3,
      defenseValue: 0, damage: 3, resolved: true,
    }];
    const current = withArenaSource(choosing(), "weapon");
    current.chain = before.chain;
    current.pendingDecision!.preStackSource = { card, zone: "weapon" };
    const pending = advance(advance(null, before), current);
    expect(pending.pending?.source.zone).toBe("weapon");
    expect(pending.view?.players).toBe(before.players);
    expect(detectGameMotionEvents(before, pending.view!)).toEqual([]);
  });

  it("releases a destroy-self cost with its ability without a duplicate move to the stack", () => {
    const initial = advance(null, withArenaSource(view(), "equipment"));
    const current = withArenaSource(choosing(), "equipment");
    current.pendingDecision!.preStackSource = { card, zone: "equipment" };
    const pending = advance(initial, current);
    const final = finished();
    final.players[1]!.graveyard = [card];
    const ready = advance(pending, final, { update: {
      gameTransition: { kind: "forward", fromVersion: 2, events: [{
        kind: "move", count: 1, instanceId: card.instanceId,
        from: { kind: "equipment", seat: 1 }, to: { kind: "graveyard", seat: 1 },
      }] },
    } });
    const events = transitionMotionEvents(pending.view!, ready.view!, ready.update.gameTransition!, "forward");
    expect(events.filter((event) => event.kind === "move" && event.instanceId === card.instanceId))
      .toEqual([expect.objectContaining({ destination: { kind: "graveyard", seat: 1 } })]);
    expect(events.filter((event) => event.kind === "connect" && event.instanceId === card.instanceId)).toHaveLength(1);
  });

  it("holds hand, payment, and log changes across choices, then animates one completed play", () => {
    const initial = advance(null, view());
    const paymentView = choosing();
    const paying = advance(initial, paymentView, { update: {
      gameTransition: { kind: "forward", fromVersion: 1, events: [paymentMove] },
    } });
    expect(paying.view?.players).toBe(initial.view?.players);
    expect(paying.view?.log).toEqual([]);
    expect(paying.view?.pendingDecision).toEqual({ player: 1, kind: "choose-target", prompt: "" });
    expect(paying.update.gameTransition).toBeUndefined();
    expect(detectGameMotionEvents(initial.view!, paying.view!)).toEqual([]);
    expect(paymentView.players[1]!.handCount).toBe(2);
    expect(paymentView.pendingDecision?.preStackSource?.card).toBe(card);

    const modes = advance(paying, { ...paymentView });
    expect(detectGameMotionEvents(paying.view!, modes.view!)).toEqual([]);
    const ready = advance(modes, finished());
    expect(ready.pending).toBeUndefined();
    expect(ready.view?.players[1]!.handCount).toBe(2);
    const events = transitionMotionEvents(modes.view!, ready.view!, ready.update.gameTransition!, "forward");
    expect(events.filter((event) => event.kind === "move" && event.instanceId === card.instanceId))
      .toEqual([expect.objectContaining({
        source: { kind: "hand", seat: 1 }, destination: { kind: "stack-layer", index: 0 },
        visual: { kind: "back-reveal", card },
      })]);
    expect(events.filter((event) => event.kind === "move" && event.instanceId === pitch.instanceId)).toHaveLength(1);
    const unchanged = advance(ready, ready.view);
    expect(transitionMotionEvents(ready.view!, unchanged.view!, unchanged.update.gameTransition!, "forward"))
      .toEqual([]);
  });

  it("preserves anonymous additional-cost movement until the play completes", () => {
    const initial = advance(null, view());
    const pending = advance(initial, choosing());
    const cost: GameTransitionMove = {
      kind: "move", from: { kind: "hand", seat: 1 }, to: { kind: "deck", seat: 1, position: "bottom" }, count: 1,
    };
    const modes = advance(pending, choosing(), { update: {
      gameTransition: { kind: "forward", fromVersion: 2, events: [cost] },
    } });
    const ready = advance(modes, finished());
    expect(ready.update.gameTransition?.events).toContainEqual(cost);
    expect(transitionMotionEvents(modes.view!, ready.view!, ready.update.gameTransition!, "forward"))
      .toContainEqual(expect.objectContaining({
        kind: "move", destination: { kind: "deck", seat: 1, position: "bottom" }, visual: { kind: "back" },
      }));
  });

  it.each(["hand", "arsenal"] as const)("animates completion after joining mid-choice from %s", (zone) => {
    const current = choosing();
    current.pendingDecision!.preStackSource!.zone = zone;
    const pending = advance(null, current);
    const ready = advance(pending, finished());
    const events = transitionMotionEvents(pending.view!, ready.view!, ready.update.gameTransition!, "forward");
    expect(events).toContainEqual(expect.objectContaining({
      kind: "move", source: { kind: zone, seat: 1 }, destination: { kind: "stack-layer", index: 0 },
      instanceId: card.instanceId,
    }));
  });

  it("releases attack cards onto their presented attack layer", () => {
    const pending = advance(advance(null, view()), choosing());
    const current = finished();
    current.stack = [];
    current.chain = [{
      attackingCard: card, defendingCards: [], reactions: [], attackValue: 5,
      defenseValue: 0, damage: 0, resolved: false, onStack: true,
    }];
    const ready = advance(pending, current);
    expect(transitionMotionEvents(pending.view!, ready.view!, ready.update.gameTransition!, "forward"))
      .toContainEqual(expect.objectContaining({
        instanceId: card.instanceId, destination: { kind: "stack-layer", index: 0 },
      }));
  });

  it("does not animate an interrupted announcement onto an older combat link", () => {
    const before = view();
    before.chain = [{
      attackingCard: card, defendingCards: [], reactions: [], attackValue: 3,
      defenseValue: 0, damage: 3, resolved: true,
    }];
    const current = { ...choosing(), chain: before.chain };
    const pending = advance(advance(null, before), current);
    const interrupted = { ...current, pendingDecision: {
      player: 0, kind: "choose-target" as const, prompt: "Choose prevention", options: ["no"],
    } };
    const result = advance(pending, interrupted);
    expect(result.view).toBe(interrupted);
    expect(result.update.gameTransition?.events).toEqual([]);
    expect(transitionMotionEvents(pending.view!, result.view!, result.update.gameTransition!, "forward"))
      .not.toContainEqual(expect.objectContaining({ kind: "move", instanceId: card.instanceId }));
  });

  it("keeps the deciding player's controls and replay snapshots immediate", () => {
    const current = choosing();
    for (const options of [{ viewerSeat: 1 }, { enabled: false }]) {
      const presented = advance(null, current, options);
      expect(presented.view).toBe(current);
      expect(presented.pending).toBeUndefined();
    }
  });

  it("also defers both players' announcements for live spectators", () => {
    const initial = advance(null, view(), { viewerSeat: null });
    const pending = advance(initial, choosing(), { viewerSeat: null });
    expect(pending.view?.players).toBe(initial.view?.players);
  });

  it.each(["replace", "jump", "backward"] as const)("drops buffered moves on %s", (transition) => {
    const pending = advance(advance(null, view()), choosing());
    const restored = view();
    const result = advance(pending, restored, { update: { transition, gameTransition: undefined } });
    expect(result.view).toBe(restored);
    expect(result.pending).toBeUndefined();
    expect(result.update.gameTransition).toBeUndefined();
  });

  it("settles a replacement during a choice and discards previously buffered costs", () => {
    const pending = advance(advance(null, view()), choosing(), { update: {
      gameTransition: { kind: "forward", fromVersion: 1, events: [paymentMove] },
    } });
    const replacement = choosing();
    const result = advance(pending, replacement, { update: {
      gameTransition: { kind: "replace", fromVersion: 2, events: [] },
    } });
    expect(result.view?.players).toBe(replacement.players);
    expect(result.pending?.transition.events).toEqual([]);
    expect(classifyViewUpdate(pending.view, result.view!, result.update).kind).toBe("settle");
  });

  it("preserves ordinary backward updates when no announcement is buffered", () => {
    const initial = advance(null, view());
    const result = advance(initial, view(), { update: { transition: "backward", gameTransition: undefined } });
    expect(result.update).toBe(result.input.update);
    expect(classifyViewUpdate(initial.view, result.view!, result.update))
      .toEqual({ kind: "animate", direction: "backward" });
  });

  it("resets on room, account, perspective, disconnect, or game changes", () => {
    const pending = advance(advance(null, view()), choosing());
    const resets = [{ scope: "other-room:alice" }, { scope: "room:bob" }, { viewerSeat: 1 }, { enabled: false }];
    for (const options of resets) {
      const result = advance(pending, finished(), options);
      expect(result.pending).toBeUndefined();
      expect(result.update.gameTransition?.events ?? []).toEqual([]);
    }
    const result = advance(pending, { ...finished(), gameId: "other-game" });
    expect(result.update.gameTransition?.events).toEqual([]);
    expect(advance(pending, null).view).toBeNull();
  });

  it("immediately shows a choice that requires the viewer's input or a game ending", () => {
    const pending = advance(advance(null, view()), choosing());
    const interrupted = choosing();
    interrupted.pendingDecision = { player: 0, kind: "choose-target", prompt: "Choose prevention", options: ["no"] };
    expect(advance(pending, interrupted).view).toBe(interrupted);
    const ended = { ...choosing(), phase: "game-over" as const, winner: 0 };
    expect(advance(pending, ended).view).toBe(ended);
  });
});
