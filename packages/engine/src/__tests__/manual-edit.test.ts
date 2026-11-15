import { describe, expect, it } from "vitest";
import type { ManualEdit } from "@fyendal/shared";
import {
  applyIntent,
  applyManualEdit,
  legalIntents,
  manualEditAllowed,
  manualEditRefusal,
  projectStateFor,
  projectStateRevealedFor,
} from "../index.js";
import { cloneState, type GameStateInternal } from "../runtimeState.js";
import { giveCard, makeGame, player } from "./fixtures.js";

function ok(state: GameStateInternal, seat: number, edit: ManualEdit): GameStateInternal {
  const result = applyManualEdit(state, seat, edit);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function step(state: GameStateInternal, seat: number, intent: Parameters<typeof applyIntent>[2]): GameStateInternal {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function defendPending(): GameStateInternal {
  const s = makeGame(2);
  const atk = giveCard(s, 0, "ATK4");
  const next = step(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
  expect(next.pendingDecision?.kind).toBe("defend");
  return next;
}

function reactionWindow(): GameStateInternal {
  const next = step(defendPending(), 1, { kind: "defend", instanceIds: [] });
  expect(next.pendingDecision?.kind).toBe("attack-reaction");
  return next;
}

function silentParts(state: GameStateInternal) {
  return JSON.stringify({
    flags: state.players.map((p) => p.flags),
    gameStats: state.gameStats,
    pendingTriggeredLayers: state.pendingTriggeredLayers,
    stack: state.stack,
    pendingDecision: state.pendingDecision,
    chi: state.players.map((p) => p.chi),
  });
}

describe("applyManualEdit", () => {
  it("sets life and logs the old and new value publicly", () => {
    const s = makeGame();
    const next = ok(s, 1, { kind: "set-life", life: 7 });
    expect(player(next, 1).life).toBe(7);
    expect(player(s, 1).life).toBe(20);
    const entry = next.log.at(-1)!;
    expect(entry.seatText).toBeUndefined();
    expect(entry.publicPayload?.message).toEqual({
      id: "engine.log.manual.life",
      values: { player: { kind: "player", seat: 1 }, from: 20, to: 7 },
    });
  });

  it("sets floating resources and logs them", () => {
    const s = makeGame();
    const next = ok(s, 0, { kind: "set-resources", resources: 5 });
    expect(player(next, 0).resources).toBe(5);
    expect(next.log.at(-1)?.publicPayload?.message).toEqual({
      id: "engine.log.manual.resources",
      values: { player: { kind: "player", seat: 0 }, from: 0, to: 5 },
    });
  });

  it("rejects out-of-range and non-integer values", () => {
    const s = makeGame();
    for (const life of [0, -1, 1000, 1.5, Number.NaN]) {
      expect(applyManualEdit(s, 0, { kind: "set-life", life }).ok).toBe(false);
    }
    for (const resources of [-1, 100, 0.5]) {
      expect(applyManualEdit(s, 0, { kind: "set-resources", resources }).ok).toBe(false);
    }
    expect(manualEditAllowed(s, 0, { kind: "set-life", life: 1 })).toBe(true);
    expect(manualEditAllowed(s, 0, { kind: "set-life", life: 999 })).toBe(true);
    expect(manualEditAllowed(s, 0, { kind: "set-resources", resources: 99 })).toBe(true);
    expect(applyManualEdit(s, 2, { kind: "set-life", life: 5 }).ok).toBe(false);
  });

  it("refuses at game over", () => {
    const s = cloneState(makeGame());
    s.phase = "game-over";
    expect(applyManualEdit(s, 0, { kind: "set-life", life: 5 })).toEqual({ ok: false, error: "game is over" });
    expect(applyManualEdit(s, 0, { kind: "set-resources", resources: 1 }).ok).toBe(false);
  });

  it("refuses resources while a payment is pending but still allows life", () => {
    const base = defendPending();
    const pendingCosts = [
      { payment: { pitchOptions: {} } },
      { xPayment: { choices: {} } },
      { variablePlayCost: { mode: "action", seat: 1, instanceId: 1, from: "hand" } },
      { activationCost: { mode: "action", seat: 1, sourceInstanceId: 1, abilityIndex: 0, pitchInstanceIds: [] } },
    ] as const;
    for (const extra of pendingCosts) {
      const s = cloneState(base);
      Object.assign(s.pendingDecision!, extra);
      expect(applyManualEdit(s, 1, { kind: "set-resources", resources: 3 }).ok).toBe(false);
      expect(applyManualEdit(s, 1, { kind: "set-life", life: 3 }).ok).toBe(true);
    }
  });

  it("cannot end the game", () => {
    const next = ok(makeGame(), 1, { kind: "set-life", life: 1 });
    expect(next.phase).not.toBe("game-over");
    expect(next.winner ?? null).toBeNull();
  });

  it("is silent: no flags, stats, triggers, stack, or decision changes", () => {
    for (const s of [makeGame(), defendPending(), reactionWindow()]) {
      const before = silentParts(s);
      let next = ok(s, 0, { kind: "set-life", life: 30 });
      next = ok(next, 1, { kind: "set-life", life: 3 });
      next = ok(next, 0, { kind: "set-resources", resources: 4 });
      expect(silentParts(next)).toBe(before);
      expect(next.log).toHaveLength(s.log.length + 3);
    }
  });

  it("keeps every legal intent applicable after an edit", () => {
    for (const s of [makeGame(), defendPending(), reactionWindow()]) {
      for (const edit of [
        { kind: "set-life", life: 1 },
        { kind: "set-life", life: 999 },
        { kind: "set-resources", resources: 0 },
        { kind: "set-resources", resources: 99 },
      ] satisfies ManualEdit[]) {
        for (const seat of [0, 1]) {
          const next = ok(s, seat, edit);
          for (const actor of [0, 1]) {
            for (const intent of legalIntents(next, actor)) {
              const applied = applyIntent(next, actor, intent);
              expect(applied.ok, `${JSON.stringify(edit)} then ${JSON.stringify(intent)}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("survives a JSON round trip", () => {
    const next = ok(reactionWindow(), 1, { kind: "set-resources", resources: 6 });
    const { cardsRef, scriptsRef, ...serializable } = next;
    const restored = { ...JSON.parse(JSON.stringify(serializable)), cardsRef, scriptsRef } as GameStateInternal;
    expect(restored).toEqual(next);
    expect(legalIntents(restored, 0)).toEqual(legalIntents(next, 0));
  });
});

function deckIds(state: GameStateInternal, seat: number): number[] {
  return player(state, seat).deck.map((card) => card.instanceId);
}

describe("deck edits", () => {
  it("applies a reorder top-first and logs no cards or positions", () => {
    const s = makeGame();
    const order = deckIds(s, 0).reverse();
    const next = ok(s, 0, { kind: "reorder-deck", instanceIds: order });
    expect(deckIds(next, 0)).toEqual(order);
    expect(deckIds(next, 1)).toEqual(deckIds(s, 1));
    expect(deckIds(s, 0)).toEqual([...order].reverse());
    const entry = next.log.at(-1)!;
    expect(entry.seatText).toBeUndefined();
    expect(entry.publicPayload?.message).toEqual({
      id: "engine.log.manual.deck.reordered",
      values: { player: { kind: "player", seat: 0 } },
    });
    expect(entry.publicPayload?.event).toBeUndefined();
  });

  it("draws the chosen top card next", () => {
    const s = makeGame();
    const ids = deckIds(s, 0);
    const chosen = ids.at(-1)!;
    const next = ok(s, 0, { kind: "reorder-deck", instanceIds: [chosen, ...ids.slice(0, -1)] });
    expect(player(next, 0).deck[0]!.instanceId).toBe(chosen);
  });

  it("requires an exact permutation of the current deck", () => {
    const s = makeGame();
    const ids = deckIds(s, 0);
    const foreign = player(s, 1).deck[0]!.instanceId;
    const bad: number[][] = [
      ids.slice(1),
      [...ids, ids[0]!],
      [ids[1]!, ...ids.slice(1)],
      [foreign, ...ids.slice(1)],
      [...ids.slice(0, -1), 99_999],
      [],
    ];
    for (const instanceIds of bad) {
      expect(applyManualEdit(s, 0, { kind: "reorder-deck", instanceIds }).ok, JSON.stringify(instanceIds)).toBe(false);
    }
    expect(manualEditRefusal(s, 0, { kind: "reorder-deck", instanceIds: ids.slice(1) }))
      .toBe("the new order must list every card in the deck");
    expect(manualEditRefusal(s, 0, { kind: "reorder-deck", instanceIds: [ids[1]!, ...ids.slice(1)] }))
      .toBe("the new order lists a card twice");
    expect(manualEditRefusal(s, 0, { kind: "reorder-deck", instanceIds: [foreign, ...ids.slice(1)] }))
      .toBe("the new order names a card that is not in the deck");
    expect(manualEditAllowed(s, 0, { kind: "reorder-deck", instanceIds: ids })).toBe(true);
  });

  it("shuffles deterministically with the seeded RNG", () => {
    const s = makeGame();
    const a = ok(s, 1, { kind: "shuffle-deck" });
    const b = ok(s, 1, { kind: "shuffle-deck" });
    expect(deckIds(a, 1)).toEqual(deckIds(b, 1));
    expect(a.rngState).toBe(b.rngState);
    expect(a.rngState).not.toBe(s.rngState);
    expect(deckIds(a, 1)).not.toEqual(deckIds(s, 1));
    expect([...deckIds(a, 1)].sort()).toEqual([...deckIds(s, 1)].sort());
    expect(deckIds(a, 0)).toEqual(deckIds(s, 0));
    const entry = a.log.at(-1)!;
    expect(entry.publicPayload?.message).toEqual({
      id: "engine.log.manual.deck.shuffled",
      values: { player: { kind: "player", seat: 1 } },
    });
    expect(entry.publicPayload?.event).toEqual({ kind: "shuffle", seat: 1 });
  });

  it("is allowed in plain windows and refused at game over or mid-decision", () => {
    for (const s of [makeGame(), defendPending(), reactionWindow()]) {
      expect(manualEditAllowed(s, 0, { kind: "shuffle-deck" })).toBe(true);
    }
    const over = cloneState(makeGame());
    over.phase = "game-over";
    expect(manualEditRefusal(over, 0, { kind: "shuffle-deck" })).toBe("game is over");

    const base = reactionWindow();
    const refused: Record<string, unknown>[] = [
      { kind: "choose-target", options: ["a"] },
      { kind: "optional-effect" },
      { kind: "order-triggers" },
      { kind: "arsenal" },
      { chooseHook: "some-script-hook" },
      { followUpDecisions: [] },
      { deckBottomOrder: { ordered: [], remaining: [player(base, 0).deck[0]!.instanceId] } },
      { lookedCardIds: [player(base, 0).deck[0]!.instanceId] },
      { cardOptions: [player(base, 0).deck[0]!.instanceId] },
      { payment: { pitchOptions: {} } },
      { activationCost: { mode: "window", seat: 0, sourceInstanceId: 1, abilityIndex: 0, pitchInstanceIds: [] } },
      { resume: { kind: "stack-card", seat: 0, card: player(base, 0).hand[0] } },
    ];
    for (const extra of refused) {
      const s = cloneState(base);
      Object.assign(s.pendingDecision!, extra);
      const ids = deckIds(s, 0);
      expect(manualEditAllowed(s, 0, { kind: "shuffle-deck" }), JSON.stringify(extra)).toBe(false);
      expect(manualEditAllowed(s, 0, { kind: "reorder-deck", instanceIds: ids }), JSON.stringify(extra)).toBe(false);
      expect(applyManualEdit(s, 0, { kind: "set-life", life: 5 }).ok).toBe(true);
    }
  });

  it("is silent and keeps every legal intent applicable", () => {
    for (const s of [makeGame(), defendPending(), reactionWindow()]) {
      const before = silentParts(s);
      for (const seat of [0, 1]) {
        for (const edit of [
          { kind: "reorder-deck", instanceIds: deckIds(s, seat).reverse() },
          { kind: "shuffle-deck" },
        ] satisfies ManualEdit[]) {
          const next = ok(s, seat, edit);
          expect(silentParts(next)).toBe(before);
          expect(next.log).toHaveLength(s.log.length + 1);
          for (const actor of [0, 1]) {
            for (const intent of legalIntents(next, actor)) {
              expect(applyIntent(next, actor, intent).ok, `${edit.kind} then ${JSON.stringify(intent)}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("survives a JSON round trip", () => {
    const s = reactionWindow();
    const next = ok(ok(s, 0, { kind: "reorder-deck", instanceIds: deckIds(s, 0).reverse() }), 1, { kind: "shuffle-deck" });
    const { cardsRef, scriptsRef, ...serializable } = next;
    const restored = { ...JSON.parse(JSON.stringify(serializable)), cardsRef, scriptsRef } as GameStateInternal;
    expect(restored).toEqual(next);
    expect(legalIntents(restored, 1)).toEqual(legalIntents(next, 1));
  });

  it("reveals only the viewer's own deck, and only when asked", () => {
    const s = makeGame();
    const next = ok(ok(s, 0, { kind: "reorder-deck", instanceIds: deckIds(s, 0).reverse() }), 0, { kind: "shuffle-deck" });
    const own = projectStateFor(next, 0, "g", { revealOwnDeck: true });
    expect(own.players[0]!.deck?.map((card) => card.instanceId)).toEqual(deckIds(next, 0));
    expect(own.players[1]!.deck).toBeUndefined();
    expect(projectStateFor(next, 0).players[0]!.deck).toBeUndefined();

    const solo = projectStateRevealedFor(next, 1, "g", { revealOwnDeck: true });
    expect(solo.players[0]!.deck?.map((card) => card.instanceId)).toEqual(deckIds(next, 0));
    expect(solo.players[1]!.deck?.map((card) => card.instanceId)).toEqual(deckIds(next, 1));
    expect(projectStateRevealedFor(next, 1).players.map((p) => p.deck)).toEqual([undefined, undefined]);

    for (const view of [projectStateFor(next, 1), projectStateFor(next, null)]) {
      expect(view.players.map((p) => p.deck)).toEqual([undefined, undefined]);
      expect(view.players[0]!.deckCount).toBe(deckIds(next, 0).length);
    }
    expect(projectStateFor(next, null, "g", { revealOwnDeck: true }).players.map((p) => p.deck))
      .toEqual([undefined, undefined]);

    const editEntries = next.log.slice(s.log.length);
    const deckCardIds = new Set(player(next, 0).deck.map((card) => card.instanceId));
    for (const entry of editEntries) {
      expect(entry.seatText).toBeUndefined();
      expect(entry.seatPayloads).toBeUndefined();
      const values = Object.values(entry.publicPayload?.message.values ?? {});
      expect(values).toEqual([{ kind: "player", seat: 0 }]);
      expect(JSON.stringify(entry)).not.toMatch(/"cardId"/);
      for (const id of deckCardIds) expect(JSON.stringify(entry)).not.toContain(`"instanceId":${id}`);
    }
    const opponentLog = projectStateFor(next, 1).log.slice(-2);
    expect(opponentLog).toEqual(projectStateFor(next, null).log.slice(-2));
    expect(opponentLog.join("\n")).not.toMatch(/ATK4|BLOCK3|Attack|Block/i);
  });
});

type MoveTo = Extract<ManualEdit, { kind: "move-card" }>["to"];
type MoveZone = "hand" | "deck" | "graveyard" | "banish";

function move(instanceId: number, to: MoveTo): ManualEdit {
  return { kind: "move-card", instanceId, to };
}

function zoneIds(state: GameStateInternal, seat: number, zone: MoveZone): number[] {
  return player(state, seat)[zone].map((card) => card.instanceId);
}

/** A game where seat 0 has one card of its own in each move source zone. */
function zonedGame(): { s: GameStateInternal; ids: Record<MoveZone, number> } {
  const s = makeGame();
  const p = player(s, 0);
  const grave = p.deck.pop()!;
  const banished = p.deck.pop()!;
  p.graveyard.push(grave);
  p.banish.push(banished);
  return {
    s,
    ids: { hand: p.hand[0]!.instanceId, deck: p.deck[3]!.instanceId, graveyard: grave.instanceId, banish: banished.instanceId },
  };
}

function stackPending(): GameStateInternal {
  const s = makeGame();
  const instant = giveCard(s, 0, "INSTANT");
  const next = step(s, 0, { kind: "play-card", instanceId: instant, pitchInstanceIds: [] });
  expect(next.stack.length).toBeGreaterThan(0);
  return next;
}

describe("move-card edits", () => {
  const sources: MoveZone[] = ["hand", "deck", "graveyard", "banish"];
  const destinations: MoveTo[] = ["hand", "deck-top", "deck-bottom", "graveyard", "banish"];

  it("moves between every source and destination pair", () => {
    for (const from of sources) {
      for (const to of destinations) {
        const { s, ids } = zonedGame();
        const id = ids[from];
        const target: MoveZone = to === "deck-top" || to === "deck-bottom" ? "deck" : to;
        const edit = move(id, to);
        if (from === target && from !== "deck") {
          expect(manualEditRefusal(s, 0, edit), `${from} -> ${to}`).toBe("the card is already there");
          continue;
        }
        const result = applyManualEdit(s, 0, edit);
        if (!result.ok) throw new Error(`${from} -> ${to}: ${result.error}`);
        const next = result.state;
        for (const zone of sources) {
          expect(zoneIds(next, 0, zone).includes(id), `${from} -> ${to} in ${zone}`).toBe(zone === target);
        }
        const total = (state: GameStateInternal) => sources.reduce((n, zone) => n + zoneIds(state, 0, zone).length, 0);
        expect(total(next)).toBe(total(s));
        if (to === "deck-top") expect(zoneIds(next, 0, "deck")[0]).toBe(id);
        if (to === "deck-bottom") expect(zoneIds(next, 0, "deck").at(-1)).toBe(id);
        if (target !== "deck") expect(zoneIds(next, 0, target).at(-1)).toBe(id);
        expect(zoneIds(s, 0, from)).toContain(id);
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
          kind: "move",
          card: { instanceId: id, owner: 0 },
          from: { kind: from, seat: 0 },
          to: { kind: target, seat: 0 },
          fromPrivate: from === "hand" || from === "deck",
          toPrivate: target === "hand" || target === "deck",
        });
      }
    }
  });

  it("repositions a deck card on top or bottom and draws it next", () => {
    const { s, ids } = zonedGame();
    const others = zoneIds(s, 0, "deck").filter((id) => id !== ids.deck);
    const top = ok(s, 0, move(ids.deck, "deck-top"));
    expect(zoneIds(top, 0, "deck")).toEqual([ids.deck, ...others]);
    const bottom = ok(s, 0, move(ids.deck, "deck-bottom"));
    expect(zoneIds(bottom, 0, "deck")).toEqual([...others, ids.deck]);
    expect(ok(bottom, 0, move(ids.deck, "deck-top")).players[0]!.deck[0]!.instanceId).toBe(ids.deck);
  });

  it("refuses cards outside the seat's own movable zones", () => {
    const { s, ids } = zonedGame();
    const p = player(s, 0);
    const arsenal = p.deck.pop()!;
    p.arsenal.push(arsenal);
    const faceDown = { ...p.deck.pop()!, faceDown: true };
    p.banish.push(faceDown);
    const foreignOwned = p.deck.pop()!;
    player(s, 1).hand.push({ ...foreignOwned });
    const stolen = { instanceId: s.nextInstanceId++, cardId: "ATK4", owner: 1 };
    p.graveyard.push(stolen);
    const token = { instanceId: s.nextInstanceId++, cardId: "TOKEN", owner: 0 };
    p.graveyard.push(token);
    const notHere = "that card is not in your hand, deck, graveyard, or banished zone";
    expect(manualEditRefusal(s, 0, move(arsenal.instanceId, "hand"))).toBe(notHere);
    expect(manualEditRefusal(s, 0, move(faceDown.instanceId, "hand"))).toBe("face-down banished cards cannot be moved");
    expect(manualEditRefusal(s, 0, move(foreignOwned.instanceId, "graveyard"))).toBe(notHere);
    expect(manualEditRefusal(s, 0, move(player(s, 1).hand[0]!.instanceId, "graveyard"))).toBe(notHere);
    expect(manualEditRefusal(s, 1, move(ids.hand, "graveyard"))).toBe(notHere);
    expect(manualEditRefusal(s, 0, move(stolen.instanceId, "hand"))).toBe("you can only move cards you own");
    expect(manualEditRefusal(s, 0, move(token.instanceId, "hand"))).toBe("tokens cannot be moved");
    expect(manualEditRefusal(s, 0, move(99_999, "hand"))).toBe(notHere);
    expect(manualEditRefusal(s, 0, move(p.hero.instanceId, "hand"))).toBe(notHere);

    const stacked = stackPending();
    expect(manualEditRefusal(stacked, 0, move(stacked.stack.at(-1)!.sourceInstanceId, "hand"))).toBe(notHere);

    const chain = reactionWindow();
    const attacker = chain.chain.at(-1)!.attackingCard!;
    expect(manualEditRefusal(chain, 0, move(attacker.instanceId, "hand"))).toBe(notHere);
  });

  it("refuses mid-stack, during deck-referencing decisions, and at game over", () => {
    const stacked = stackPending();
    expect(manualEditRefusal(stacked, 0, move(player(stacked, 0).hand[0]!.instanceId, "graveyard")))
      .toBe("cards cannot move while the stack is in use");
    const pendingLayer = cloneState(makeGame());
    pendingLayer.pendingTriggeredLayers = [stackPending().stack[0]!];
    expect(manualEditAllowed(pendingLayer, 0, move(player(pendingLayer, 0).hand[0]!.instanceId, "graveyard"))).toBe(false);

    const base = reactionWindow();
    const s = cloneState(base);
    Object.assign(s.pendingDecision!, { lookedCardIds: [player(s, 0).deck[0]!.instanceId] });
    expect(manualEditRefusal(s, 0, move(player(s, 0).deck[0]!.instanceId, "hand"))).toBe("the deck cannot change during this decision");
    const choice = cloneState(base);
    choice.pendingDecision = { kind: "choose-target", player: 0, options: ["a"] } as never;
    expect(manualEditAllowed(choice, 0, move(player(choice, 0).hand[0]!.instanceId, "graveyard"))).toBe(false);

    const over = cloneState(makeGame());
    over.phase = "game-over";
    expect(manualEditRefusal(over, 0, move(player(over, 0).hand[0]!.instanceId, "graveyard"))).toBe("game is over");
    for (const state of [makeGame(), defendPending(), reactionWindow()]) {
      expect(manualEditAllowed(state, 1, move(player(state, 1).hand[0]!.instanceId, "graveyard"))).toBe(true);
    }
  });

  it("drops a moved hand card from the staged defenders", () => {
    let s = defendPending();
    const [a, b] = player(s, 1).hand.map((card) => card.instanceId) as [number, number];
    s = step(s, 1, { kind: "stage-defenders", instanceIds: [a, b] });
    expect(s.pendingDecision?.staged).toEqual([a, b]);
    const one = ok(s, 1, move(a, "graveyard"));
    expect(one.pendingDecision?.staged).toEqual([b]);
    const none = ok(one, 1, move(b, "deck-top"));
    expect(none.pendingDecision).not.toHaveProperty("staged");
    for (const state of [one, none]) {
      for (const intent of legalIntents(state, 1)) {
        expect(applyIntent(state, 1, intent).ok, JSON.stringify(intent)).toBe(true);
      }
    }
  });

  it("resets per-card object state so the card is ordinary in its new zone", () => {
    const { s, ids } = zonedGame();
    const card = player(s, 0).banish.find((c) => c.instanceId === ids.banish)!;
    Object.assign(card, {
      playableFrom: ["banish"], playableFromSourceCardId: "X", playCostReduction: 1, playableAsInstant: true,
      tempPower: 2, grantedKeywords: ["Go again"], intimidated: true, returnToHandAtTurn: 3,
      lastKnownCounters: { steam: 1 }, pitchCount: 2, flipped: true, scriptState: { marked: 1, note: 4 },
      temporaryGraveyardReplacement: "banish", arsenalSlot: 0, chosenName: "x",
    });
    const moved = player(ok(s, 0, move(ids.banish, "hand")), 0).hand.at(-1)!;
    expect(moved).toEqual({
      instanceId: ids.banish, cardId: card.cardId, owner: 0, pitchCount: 2, flipped: true, scriptState: { note: 4 },
    });
    const toBanish = player(ok(s, 0, move(ids.hand, "banish")), 0).banish.at(-1)!;
    expect(toBanish.faceDown).toBeUndefined();
  });

  it("is silent and keeps every legal intent applicable", () => {
    for (const base of [makeGame(), defendPending(), reactionWindow()]) {
      for (const seat of [0, 1]) {
        const s = cloneState(base);
        const p = player(s, seat);
        p.graveyard.push(p.deck.pop()!);
        const before = silentParts(s);
        const edits: ManualEdit[] = [
          move(p.hand[0]!.instanceId, "deck-top"),
          move(p.deck[2]!.instanceId, "hand"),
          move(p.deck[5]!.instanceId, "graveyard"),
          move(p.graveyard.at(-1)!.instanceId, "banish"),
        ];
        for (const edit of edits) {
          const next = ok(s, seat, edit);
          expect(silentParts(next), JSON.stringify(edit)).toBe(before);
          expect(next.log).toHaveLength(s.log.length + 1);
          for (const actor of [0, 1]) {
            for (const intent of legalIntents(next, actor)) {
              expect(applyIntent(next, actor, intent).ok, `${JSON.stringify(edit)} then ${JSON.stringify(intent)}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("makes a card moved to hand playable and a card put on top drawn next", () => {
    const s = makeGame();
    const atk = player(s, 0).deck.find((card) => card.cardId === "ATK4")!.instanceId;
    const inHand = ok(s, 0, move(atk, "hand"));
    expect(legalIntents(inHand, 0)).toContainEqual(expect.objectContaining({ kind: "play-card", instanceId: atk }));
    expect(step(inHand, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] }).pendingDecision?.kind).toBe("defend");

    const handCard = player(s, 0).hand[0]!.instanceId;
    const onTop = ok(s, 0, move(handCard, "deck-top"));
    expect(player(onTop, 0).deck[0]!.instanceId).toBe(handCard);
  });

  it("survives a JSON round trip", () => {
    const { s, ids } = zonedGame();
    const next = ok(ok(s, 0, move(ids.graveyard, "deck-bottom")), 0, move(ids.hand, "banish"));
    const { cardsRef, scriptsRef, ...serializable } = next;
    const restored = { ...JSON.parse(JSON.stringify(serializable)), cardsRef, scriptsRef } as GameStateInternal;
    expect(restored).toEqual(next);
    expect(legalIntents(restored, 0)).toEqual(legalIntents(next, 0));
  });

  it("names hidden-to-hidden cards only to their owner and public cards to everyone", () => {
    const { s, ids } = zonedGame();
    const cardId = player(s, 0).hand[0]!.cardId;
    const hidden = ok(s, 0, move(ids.hand, "deck-top"));
    const entry = hidden.log.at(-1)!;
    expect(entry.seatPayloads?.[0]?.message).toEqual({
      id: "engine.log.manual.card.moved",
      values: { player: { kind: "player", seat: 0 }, card: { kind: "card", cardId }, from: "hand", to: "deckTop" },
    });
    expect(entry.seatPayloads?.[1]).toBeNull();
    expect(entry.publicPayload?.message).toEqual({
      id: "engine.log.manual.card.moved.hidden",
      values: { player: { kind: "player", seat: 0 }, from: "hand", to: "deckTop" },
    });
    const name = cardId === "ATK4" ? "Attack Four" : "Blocker";
    expect(projectStateFor(hidden, 0).log.at(-1)).toContain(name);
    for (const view of [projectStateFor(hidden, 1), projectStateFor(hidden, null)]) {
      expect(view.log.at(-1)).toMatch(/moves a card from their hand to the top of their deck/);
      expect(JSON.stringify(view.log) + JSON.stringify(view.logEntries ?? [])).not.toContain(name);
      expect(JSON.stringify(view.logEntries ?? [])).not.toContain(`"cardId":"${cardId}"`);
      expect(view.players[0]!.deck).toBeUndefined();
      expect(view.players[0]!.handCount).toBe(player(hidden, 0).hand.length);
    }
    expect(projectStateRevealedFor(hidden, 1).log.at(-1)).toContain(name);

    const drawn = ok(s, 0, move(ids.deck, "hand"));
    const drawnName = player(drawn, 0).hand.at(-1)!.cardId === "ATK4" ? "Attack Four" : "Blocker";
    expect(projectStateFor(drawn, 0).log.at(-1)).toContain(drawnName);
    expect(projectStateFor(drawn, 1).log.at(-1)).toMatch(/moves a card from their deck to their hand/);

    const graved = ok(s, 0, move(ids.hand, "graveyard"));
    expect(graved.log.at(-1)!.seatText).toBeUndefined();
    for (const view of [projectStateFor(graved, 1), projectStateFor(graved, null)]) {
      expect(view.log.at(-1)).toContain(name);
    }
  });
});
