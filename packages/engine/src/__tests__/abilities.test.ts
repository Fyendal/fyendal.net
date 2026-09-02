import type { GameStateInternal } from "../runtimeState.js";
import { describe, expect, it } from "vitest";
import type { GameIntent } from "@fyendal/shared";
import { applyIntent, legalIntents, projectStateFor } from "../index.js";

import { giveCard, makeGame, player } from "./fixtures.js";

/** Play an instant from hand and pass it to resolution. */
function playInstant(s: GameStateInternal, seat: number, instanceId: number): GameStateInternal {
  let r = applyIntent(s, seat, { kind: "play-card", instanceId, pitchInstanceIds: [] });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  let cur = r.state;
  for (let i = 0; i < 4 && cur.pendingDecision; i++) {
    const who = cur.pendingDecision.player;
    r = applyIntent(cur, who, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    cur = r.state;
  }
  return cur;
}

function abilityIntents(s: GameStateInternal, seat: number, sourceId: number): GameIntent[] {
  return legalIntents(s, seat).filter(
    (i) => i.kind === "activate-ability" && i.sourceInstanceId === sourceId,
  );
}

/** Settle a card from hand onto the board and return its instance id. */
function boardCard(s: GameStateInternal, seat: number, cardId: string): { s: GameStateInternal; id: number } {
  const given = giveCard(s, seat, cardId);
  const after = playInstant(s, seat, given);
  const found = player(after, seat).board.find((c) => c.cardId === cardId);
  if (!found) throw new Error(`${cardId} did not enter the board`);
  return { s: after, id: found.instanceId };
}

function grantActionIdolInstantTiming(s: GameStateInternal, seat: number): number {
  const idolId = giveCard(s, seat, "IDOL");
  const idolIndex = player(s, seat).hand.findIndex((card) => card.instanceId === idolId);
  player(s, seat).board.push(player(s, seat).hand.splice(idolIndex, 1)[0]!);
  s.scriptsRef = {
    ...s.scriptsRef,
    IDOL: {
      activated: {
        cost: 0,
        isAttack: false,
        goAgain: true,
        timing: "action",
        onActivate(ctx) {
          ctx.gainLife(ctx.seat, 1);
        },
      },
    },
  };
  player(s, seat).flags["abilitiesAsInstant:item"] = true;
  return idolId;
}

describe("activated ability life costs", () => {
  it("requires and pays life before an attack ability is activated", () => {
    const s = makeGame(19);
    const weapon = player(s, 0).weapons[0]!;
    s.scriptsRef = {
      ...s.scriptsRef,
      SWORD: {
        activated: {
          cost: 0,
          lifeCost: 2,
          isAttack: true,
          goAgain: true,
          oncePerTurn: true,
        },
      },
    };
    player(s, 0).life = 1;

    expect(abilityIntents(s, 0, weapon.instanceId)).toHaveLength(0);
    const rejected = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: weapon.instanceId,
      pitchInstanceIds: [],
    });
    expect(rejected).toMatchObject({ ok: false, error: "not enough life" });

    player(s, 0).life = 2;
    const activation = abilityIntents(s, 0, weapon.instanceId)[0];
    expect(activation).toBeDefined();
    const accepted = applyIntent(s, 0, activation!);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(accepted.error);
    expect(player(accepted.state, 0).life).toBe(0);
    expect(player(accepted.state, 0).flags.lostLifeThisTurn).toBe(true);
    expect(accepted.state.winner).toBe(1);
  });
});

describe("multiple activated abilities per card", () => {
  it("projects spent once-per-turn weapon abilities to both players", () => {
    const s = makeGame(20);
    const weapon = player(s, 0).weapons[0]!;
    player(s, 0).flags[`activated:${weapon.instanceId}`] = true;

    expect(projectStateFor(s, 0).players[0]!.weapons[0]?.usedAbilityIndexes).toEqual([0]);
    expect(projectStateFor(s, 1).players[0]!.weapons[0]?.usedAbilityIndexes).toEqual([0]);
  });

  it("projects only remaining additional weapon activations", () => {
    const s = makeGame(201);
    const weapon = player(s, 0).weapons[0]!;
    player(s, 0).flags[`additionalActivations:${weapon.instanceId}:0`] = 1;

    for (const viewer of [0, 1]) {
      const projected = projectStateFor(s, viewer).players[0]!.weapons[0];
      expect(projected?.remainingAbilityActivations).toEqual([2]);
      expect(projected?.usedAbilityIndexes).toBeUndefined();
    }

    player(s, 0).flags[`activated:${weapon.instanceId}`] = true;
    for (const viewer of [0, 1]) {
      const projected = projectStateFor(s, viewer).players[0]!.weapons[0];
      expect(projected?.remainingAbilityActivations).toEqual([1]);
      expect(projected?.usedAbilityIndexes).toBeUndefined();
    }

    player(s, 0).flags[`activationCount:${weapon.instanceId}:0`] = 2;
    player(s, 0).flags[`additionalActivations:${weapon.instanceId}:0`] = 0;
    const spent = projectStateFor(s, 0).players[0]!.weapons[0];
    expect(spent?.remainingAbilityActivations).toBeUndefined();
    expect(spent?.usedAbilityIndexes).toEqual([0]);
  });

  it("enumerates each ability with its own index and tracks once-per-turn separately", () => {
    const settled = boardCard(makeGame(21), 0, "GADGET");
    let s = settled.s;
    const id = settled.id;
    const intents = abilityIntents(s, 0, id);
    const indexes = intents.map((i) => (i.kind === "activate-ability" ? (i.abilityIndex ?? 0) : -1));
    expect(new Set(indexes)).toEqual(new Set([0, 1])); // both abilities offered
    expect(
      projectStateFor(s, 0).players[0]!.board.find((card) => card.instanceId === id)
        ?.activatedAbilityLabels,
    ).toEqual(["Gain 1", "Gain 2"]);

    // index 1 (once-per-turn, +2 life)
    let r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: id,
      pitchInstanceIds: [],
      abilityIndex: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(player(s, 0).life).toBe(20); // the cost is paid, but the instant ability is on the stack
    for (let i = 0; i < 4 && s.pendingDecision; i++) {
      const who = s.pendingDecision.player;
      r = applyIntent(s, who, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(player(s, 0).life).toBe(22);
    expect(
      projectStateFor(s, 1).players[0]!.board.find((card) => card.instanceId === id)
        ?.usedAbilityIndexes,
    ).toEqual([1]);

    // index 1 is spent, index 0 still legal — the flags are per-ability
    const after = abilityIntents(s, 0, id).map((i) =>
      i.kind === "activate-ability" ? (i.abilityIndex ?? 0) : -1,
    );
    expect(new Set(after)).toEqual(new Set([0]));
    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: id,
      pitchInstanceIds: [],
      abilityIndex: 1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/once per turn/);

    r = applyIntent(s, 0, { kind: "activate-ability", sourceInstanceId: id, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    for (let i = 0; i < 4 && s.pendingDecision; i++) {
      const who = s.pendingDecision.player;
      r = applyIntent(s, who, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(player(s, 0).life).toBe(23);
  });

  it("resolves the right ability when it rides the stack as a window ability", () => {
    const settled = boardCard(makeGame(22), 0, "GADGET");
    let s = settled.s;
    const id = settled.id;
    // open a stack window by playing an instant, then activate index 1 in it
    const sigil = giveCard(s, 0, "INSTANT");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: sigil, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.pendingDecision?.kind).toBe("priority-window");
    const intents = abilityIntents(s, 0, id);
    const idx1 = intents.find((i) => i.kind === "activate-ability" && i.abilityIndex === 1);
    expect(idx1).toBeDefined();
    r = applyIntent(s, 0, idx1 as GameIntent);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    // pass the window through: the ability layer (+2) then the sigil (+1) resolve
    for (let i = 0; i < 6 && s.pendingDecision; i++) {
      const who = s.pendingDecision.player;
      r = applyIntent(s, who, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(player(s, 0).life).toBe(23);
  });
});

describe("empty-stack action-phase priority", () => {
  it("activates an action ability with granted instant timing at zero action points", () => {
    let s = makeGame(23);
    const idolId = grantActionIdolInstantTiming(s, 0);
    player(s, 0).actionPoints = 0;

    const activation = abilityIntents(s, 0, idolId)[0];
    expect(activation).toBeDefined();
    let result = applyIntent(s, 0, activation!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    expect(s.log.find((entry) =>
      entry.publicPayload?.message.id === "engine.log.card.activated"
    )?.publicPayload?.message).toMatchObject({
      values: {
        hero: { kind: "card", cardId: "HERO_A" },
        card: { kind: "card", cardId: "IDOL" },
      },
    });
    for (let i = 0; i < 2; i++) {
      result = applyIntent(s, s.priorityPlayer, { kind: "pass" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      s = result.state;
    }
    expect(player(s, 0).actionPoints).toBe(1);
    expect(player(s, 0).life).toBe(21);
  });

  it("defaults a granted-instant action ability to instant timing when an action point is available", () => {
    let s = makeGame(231);
    const idolId = grantActionIdolInstantTiming(s, 0);
    player(s, 0).actionPoints = 1;

    const activation = abilityIntents(s, 0, idolId)[0];
    expect(activation).toBeDefined();
    let result = applyIntent(s, 0, activation!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    expect(player(s, 0).actionPoints).toBe(1);
    expect(s.pendingDecision?.kind).toBe("priority-window");

    for (let i = 0; i < 2; i++) {
      result = applyIntent(s, s.priorityPlayer, { kind: "pass" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      s = result.state;
    }
    expect(player(s, 0).actionPoints).toBe(2);
    expect(player(s, 0).life).toBe(21);
  });

  it("retains go again when a granted-instant action ability is activated in a priority window", () => {
    let s = makeGame(230);
    const idolId = grantActionIdolInstantTiming(s, 0);
    player(s, 0).actionPoints = 0;
    const opener = giveCard(s, 0, "INSTANT");

    let result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: opener,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    const activation = abilityIntents(s, 0, idolId)[0];
    expect(activation).toBeDefined();
    result = applyIntent(s, 0, activation!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    for (let i = 0; i < 6 && s.pendingDecision; i++) {
      result = applyIntent(s, s.pendingDecision.player, { kind: "pass" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      s = result.state;
    }
    expect(player(s, 0).actionPoints).toBe(1);
    expect(player(s, 0).life).toBe(22);
  });

  it("lets the opponent activate an instant ability before the action phase ends", () => {
    let s = makeGame(24);
    const idolId = giveCard(s, 1, "IDOL");
    const idolIndex = player(s, 1).hand.findIndex((card) => card.instanceId === idolId);
    player(s, 1).board.push(player(s, 1).hand.splice(idolIndex, 1)[0]!);

    let r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.phase).toBe("layer");
    expect(s.stack).toHaveLength(0);
    expect(s.stackResume).toBe("end-action-phase");
    expect(s.pendingDecision).toMatchObject({ kind: "priority-window", player: 1 });
    expect(projectStateFor(s, 1).endTurnPassPending).toBe(true);

    const activation = abilityIntents(s, 1, idolId)[0];
    expect(activation).toBeDefined();
    r = applyIntent(s, 1, activation!);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.stack[0]?.ability).toBe(true);
    expect(projectStateFor(s, 1).endTurnPassPending).toBeUndefined();

    for (let i = 0; i < 2; i++) {
      r = applyIntent(s, s.priorityPlayer, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(player(s, 1).life).toBe(21);
    expect(s.phase).toBe("action");
    expect(s.priorityPlayer).toBe(0);
    expect(s.stackResume).toBeNull();
  });
});

describe("shared card-play announcement", () => {
  it("applies action penalties and observer-granted go again in a layer window", () => {
    let s = makeGame(25);
    const response = giveCard(s, 1, "BLOCK3");
    const opener = giveCard(s, 0, "INSTANT");
    s.scriptsRef = {
      ...s.scriptsRef,
      BLOCK3: { playAsInstant: () => true },
      HERO_B: {
        onFriendlyPlay(ctx, played) {
          ctx.grantCardKeyword(played.instanceId, "go again");
        },
      },
    };
    (player(s, 1).hero.counters ??= {}).loseLifeOnActionUntilTurn = s.turn;

    let result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: opener,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    result = applyIntent(s, 0, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;

    result = applyIntent(s, 1, {
      kind: "play-card",
      instanceId: response,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;

    expect(player(s, 1).life).toBe(20);
    expect(s.stack[0]).toMatchObject({ engineEffect: { kind: "lose-life", amount: 1 } });
    expect(s.stack[1]).toMatchObject({ card: { instanceId: response }, goAgain: true });

    result = applyIntent(s, 1, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    result = applyIntent(s, 0, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    s = result.state;
    expect(player(s, 1).life).toBe(19);
  });
});

describe("destroy at the beginning of the end phase", () => {
  it("a scheduled permanent is destroyed when the end phase begins", () => {
    const settled = boardCard(makeGame(23), 0, "IDOL");
    let s = settled.s;
    const id = settled.id;
    const rot = giveCard(s, 0, "ROT");
    s = playInstant(s, 0, rot);
    expect(player(s, 0).flags.rotOk).toBe(true);
    expect(player(s, 0).board.some((c) => c.instanceId === id)).toBe(true);

    let r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    if (s.pendingDecision?.kind === "arsenal") {
      r = applyIntent(s, 0, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(player(s, 0).board).toHaveLength(0);
    expect(player(s, 0).graveyard.some((c) => c.cardId === "IDOL")).toBe(true);
    expect(s.pendingDestructions).toHaveLength(0); // consumed
    expect(s.log.find((entry) =>
      entry.publicPayload?.message.id === "engine.log.card.destroyed"
    )?.publicPayload?.message).toMatchObject({
      values: { card: { kind: "card", cardId: "IDOL" } },
    });
  });
});
