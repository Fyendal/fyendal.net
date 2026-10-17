import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents } from "../index.js";
import type { GameStateInternal } from "../runtimeState.js";
import { giveCard, makeGame, player } from "./fixtures.js";

/** An opposing ally plus an attack that adds it as an additional target. */
function multiTargetGame(seed: number): { state: GameStateInternal; attackId: number; allyId: number } {
  const state = makeGame(seed);
  state.cardsRef = {
    ...state.cardsRef,
    ALLY: {
      id: "ALLY",
      name: "Test Ally",
      cardType: "action",
      subtypes: ["ally"],
      classes: ["generic"],
      attack: 1,
      life: 3,
      text: "",
    },
  };
  const allyId = state.nextInstanceId++;
  player(state, 1).board.push({ instanceId: allyId, cardId: "ALLY", owner: 1, life: 3 });
  state.scriptsRef = {
    ...state.scriptsRef,
    ATK4: {
      additionalCost(ctx) {
        ctx.declareAdditionalAttackTarget(allyId);
      },
      onHit(ctx) {
        const target = ctx.link?.targetAllyId ?? "hero";
        ctx.setFlag("player", `hit:${target}`, ctx.link?.damage ?? 0);
        ctx.setFlag("player", "hits", Number(ctx.getFlag("player", "hits") ?? 0) + 1);
      },
    },
  };
  const attackId = giveCard(state, 0, "ATK4");
  return { state, attackId, allyId };
}

function apply(state: GameStateInternal, seat: number, intent: Parameters<typeof applyIntent>[2]): GameStateInternal {
  const result = applyIntent(state, seat, intent);
  if (!result.ok) throw new Error(result.error);
  return result.state as GameStateInternal;
}

/** Pass priority and answer defend or ordering decisions until the chain closes. */
function resolveCombat(start: GameStateInternal, defenders: number[] = []): GameStateInternal {
  let state = start;
  for (let guard = 0; guard < 40 && state.chain.length > 0; guard++) {
    const decision = state.pendingDecision;
    if (decision?.kind === "defend") {
      state = apply(state, decision.player, { kind: "defend", instanceIds: defenders });
      continue;
    }
    const seat = decision?.player ?? state.priorityPlayer;
    const intents = legalIntents(state, seat);
    const next = intents.find((intent) => intent.kind === "pass") ??
      intents.find((intent) => intent.kind === "order-triggers" || intent.kind === "close-chain");
    if (!next) throw new Error(`no way to advance combat: ${JSON.stringify(intents)}`);
    state = apply(state, seat, next);
  }
  return state;
}

describe("attacks with additional targets", () => {
  it("defends only the hero target and triggers on-hit once per hit target", () => {
    const { state: initial, attackId, allyId } = multiTargetGame(611);
    const blockerId = giveCard(initial, 1, "BLOCK3");
    let state = apply(initial, 0, { kind: "play-card", instanceId: attackId, pitchInstanceIds: [] });

    expect(state.chain[0]).toMatchObject({ additionalTargetAllyIds: [allyId] });
    expect(state.chain[0]?.targetAllyId).toBeUndefined();

    state = resolveCombat(state, [blockerId]);

    expect(player(state, 1).life).toBe(19);
    expect(player(state, 1).board.some((card) => card.instanceId === allyId)).toBe(false);
    expect(player(state, 0).flags).toMatchObject({
      hits: 2,
      "hit:hero": 1,
      [`hit:${allyId}`]: 4,
    });
  });

  it("hits through an additional target when the hero target is fully defended", () => {
    const { state: initial, attackId, allyId } = multiTargetGame(612);
    const first = giveCard(initial, 1, "BLOCK3");
    const second = giveCard(initial, 1, "BLOCK3");
    let state = apply(initial, 0, { kind: "play-card", instanceId: attackId, pitchInstanceIds: [] });

    state = resolveCombat(state, [first, second]);

    expect(player(state, 1).life).toBe(20);
    expect(player(state, 0).flags).toMatchObject({ hits: 1, [`hit:${allyId}`]: 4 });
    expect(player(state, 0).flags["hit:hero"]).toBeUndefined();
  });

  it("keeps additional targets when its attack-layer is held behind the attack queue", () => {
    const { state: initial, attackId, allyId } = multiTargetGame(614);
    // Pause the play on an observer choice while its attack-layer is unresolved.
    initial.scriptsRef = {
      ...initial.scriptsRef,
      SWORD: {
        ...initial.scriptsRef.SWORD,
        onFriendlyPlay(ctx) {
          ctx.requestChoice("observe-attack", "Observe the attack", ["ok"]);
        },
      },
    };
    let state = apply(initial, 0, { kind: "play-card", instanceId: attackId, pitchInstanceIds: [] });
    expect(state.chain[0]?.flags.attackStepBegan).toBeUndefined();
    // An attack resolved into the queue above this unresolved attack-layer.
    state.chain[0]!.flags.attacksQueuedAboveLayer = true;

    state = apply(state, 0, { kind: "choose", optionId: "ok" });

    expect(state.chain).toHaveLength(1);
    expect(state.chain[0]).toMatchObject({
      attackingCard: { instanceId: attackId },
      additionalTargetAllyIds: [allyId],
      flags: { attackStepBegan: true },
    });
    expect(state.chain[0]?.flags.attacksQueuedAboveLayer).toBeUndefined();
    expect(state.chain[0]?.attackingCard.attackTargetIds).toBeUndefined();
  });

  it("refuses an additional target that is already an attack-target", () => {
    const { state: initial, attackId, allyId } = multiTargetGame(613);
    let declaredAgain: boolean | undefined;
    initial.scriptsRef = {
      ...initial.scriptsRef,
      ATK4: {
        additionalCost(ctx) {
          ctx.declareAdditionalAttackTarget(allyId);
          declaredAgain = ctx.declareAdditionalAttackTarget(allyId);
          expect(ctx.additionalAttackTargetOptions()).toEqual([]);
        },
      },
    };
    const state = apply(initial, 0, { kind: "play-card", instanceId: attackId, pitchInstanceIds: [] });

    expect(declaredAgain).toBe(false);
    expect(state.chain[0]).toMatchObject({ additionalTargetAllyIds: [allyId] });
  });
});
