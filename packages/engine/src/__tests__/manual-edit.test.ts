import { describe, expect, it } from "vitest";
import type { ManualEdit } from "@fyendal/shared";
import { applyIntent, applyManualEdit, legalIntents, manualEditAllowed } from "../index.js";
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
