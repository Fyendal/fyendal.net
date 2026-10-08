import { engineRuntime } from "../engineRuntime.js";
import { describe, expect, it } from "vitest";
import { applyIntent, projectStateFor } from "../index.js";
import { oncePerTurnEffectFlagKey } from "../scripts.js";
import { makeCtx } from "../scriptContext.js";
import { giveCard, makeGame, player } from "./fixtures.js";

describe("authoritative match stats", () => {
  it("records attack threat, actual blocked value, and hero damage without overblock", () => {
    let state = makeGame(81);
    const attack = giveCard(state, 0, "ATK4");
    const firstBlock = giveCard(state, 1, "BLOCK3");
    const secondBlock = giveCard(state, 1, "BLOCK3");

    let result = applyIntent(state, 0, {
      kind: "play-card",
      instanceId: attack,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    result = applyIntent(state, 1, {
      kind: "defend",
      instanceIds: [firstBlock, secondBlock],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    result = applyIntent(state, 0, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    result = applyIntent(state, 1, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.gameStats.turns[0]).toMatchObject({
      attacks: [1, 0],
      threatened: [4, 0],
      blocked: [0, 4],
      damageDealt: [0, 0],
    });
  });

  it("credits off-turn effect damage to its source seat", () => {
    const state = makeGame(82);
    const sourceId = giveCard(state, 1, "INSTANT");
    const source = player(state, 1).hand.find((card) => card.instanceId === sourceId)!;

    makeCtx(state, engineRuntime, 1, source).dealDamage(0, 3, { arcane: true });

    expect(state.activePlayer).toBe(0);
    expect(state.gameStats.turns[0]).toMatchObject({
      activePlayer: 0,
      threatened: [0, 3],
      damageDealt: [0, 3],
    });
    expect(projectStateFor(state, 0, "game").gameStats).toEqual(state.gameStats);
    expect(projectStateFor(state, 0, "game").turnFacts?.players[1]).toMatchObject({
      attacks: 0,
      weaponAttacks: 0,
      dealtDamage: true,
      arcaneDamageDealt: true,
    });
  });

  it("projects the six-power banish fact only to its owner", () => {
    const state = makeGame(83);
    expect(projectStateFor(state, 0, "game").turnFacts?.players[0].banishedSixPlusThisTurn).toBe(false);
    state.players[0]!.flags.banishedSixPlusThisTurn = true;
    expect(projectStateFor(state, 0, "game").turnFacts?.players[0].banishedSixPlusThisTurn).toBe(true);
    expect(projectStateFor(state, 1, "game").turnFacts?.players[0].banishedSixPlusThisTurn).toBeUndefined();
  });

  it("records Blood Debt-like life loss and life gain separately from damage", () => {
    const state = makeGame(85);
    const sourceId = giveCard(state, 0, "INSTANT");
    const source = player(state, 0).hand.find((card) => card.instanceId === sourceId)!;
    const ctx = makeCtx(state, engineRuntime, 0, source);

    ctx.loseLife(0, 1);
    ctx.gainLife(0, 2);

    expect(player(state, 0).life).toBe(21);
    expect(state.gameStats.turns[0]).toMatchObject({
      damageDealt: [0, 0],
      lifeGained: [2, 0],
      lifeLost: [1, 0],
    });
  });

  it("credits damage dealt to an opponent's ally as the defender's separate value", () => {
    const state = makeGame(84);
    state.cardsRef = {
      ...state.cardsRef,
      TEST_ALLY: {
        id: "TEST_ALLY", name: "Test Ally", cardType: "action",
        subtypes: ["ally"], classes: ["generic"], life: 10, text: "",
      },
    };
    const allyId = state.nextInstanceId++;
    player(state, 1).board.push({
      instanceId: allyId, cardId: "TEST_ALLY", owner: 1, life: 10,
    });
    const sourceId = giveCard(state, 0, "INSTANT");
    const source = player(state, 0).hand.find((card) => card.instanceId === sourceId)!;

    makeCtx(state, engineRuntime, 0, source).dealDamage(1, 4, { targetAllyId: allyId });

    expect(state.gameStats.turns[0]).toMatchObject({
      allyAbsorbed: [0, 4],
      blocked: [0, 0],
      damageDealt: [0, 0],
    });
    expect(player(state, 1).life).toBe(20);
    expect(player(state, 1).board[0]?.life).toBe(6);

    const ownSourceId = giveCard(state, 1, "INSTANT");
    const ownSource = player(state, 1).hand.find((card) => card.instanceId === ownSourceId)!;
    makeCtx(state, engineRuntime, 1, ownSource).dealDamage(1, 1, { targetAllyId: allyId });
    expect(state.gameStats.turns[0]?.allyAbsorbed).toEqual([0, 4]);
  });

  it("projects current-turn rules facts without requiring log inference", () => {
    const state = makeGame(83);
    player(state, 0).flags.attacksDeclaredThisTurn = 2;
    player(state, 0).flags.weaponAttackCount = 1;
    player(state, 0).flags["playedSubtype:lightning"] = true;
    player(state, 0).flags["playedSubtype:attack"] = true;
    player(state, 0).flags[oncePerTurnEffectFlagKey(17)] = true;
    player(state, 0).flags.damageTakenThisTurn = true;
    player(state, 0).flags.physicalDamageTakenThisTurn = true;

    expect(projectStateFor(state, 1, "game").turnFacts?.players[0]).toEqual({
      attacks: 2,
      weaponAttacks: 1,
      playedSubtypes: ["attack", "lightning"],
      usedOncePerTurnEffectSourceIds: [17],
      dealtDamage: false,
      physicalDamageDealt: false,
      arcaneDamageDealt: false,
      damageTaken: true,
      physicalDamageTaken: true,
      arcaneDamageTaken: false,
    });
  });
});
