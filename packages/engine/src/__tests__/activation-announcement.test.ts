import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "../index.js";
import type { CardInstance, GameState } from "../index.js";
import type { GameIntent } from "@fyendal/shared";
import { giveCard, makeGame, player } from "./fixtures.js";

function apply(state: GameState, matches: (intent: GameIntent) => boolean): GameState {
  const intent = legalIntents(state, 0).find(matches);
  expect(intent).toBeDefined();
  const result = applyIntent(state, 0, intent!);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("arena activation announcement projection", () => {
  it.each(["equipment", "weapon", "board", "hero"] as const)(
    "identifies the %s source through X, pitch, and discard-cost choices",
    (zone) => {
      let state = makeGame();
      const owner = player(state, 0);
      owner.hand = [];
      let source: CardInstance;
      if (zone === "equipment") {
        source = { instanceId: state.nextInstanceId++, cardId: "HELM", owner: 0 };
        owner.equipment.head = source;
      } else if (zone === "board") {
        source = { instanceId: state.nextInstanceId++, cardId: "IDOL", owner: 0 };
        owner.board.push(source);
      } else {
        source = zone === "hero" ? owner.hero : owner.weapons[0]!;
      }
      state.scriptsRef = { ...state.scriptsRef, [source.cardId]: {
        activated: {
          cost: 0, isAttack: zone === "weapon", goAgain: false,
          variableCost: { base: 0, counterKey: "announcedX", maximum: 2 },
          discardCost: { count: 1 },
          ...(zone === "board" ? { tap: true } : {}),
        },
      } };
      const pitchId = giveCard(state, 0, "BLUE");
      const discardId = giveCard(state, 0, "YEL");
      giveCard(state, 0, "INSTANT");
      giveCard(state, 1, "INSTANT");
      state = apply(state, (intent) => intent.kind === "activate-ability"
        && intent.sourceInstanceId === source.instanceId);

      const expectSource = () => {
        for (const viewer of [0, 1, null]) {
          const view = projectStateFor(state, viewer);
          expect(view.pendingDecision?.preStackSource).toMatchObject({
            zone, card: { instanceId: source.instanceId, cardId: source.cardId },
          });
          if (viewer !== 0) {
            expect(view.pendingDecision?.options).toBeUndefined();
            expect(view.pendingDecision?.resourcePayment).toBeUndefined();
            expect(view.pendingDecision?.prompt).toBe("");
            expect(JSON.stringify(view)).not.toContain('"cardId":"YEL"');
            expect(view.players[0]!.hand).toEqual([]);
          }
        }
      };
      expect(state.pendingDecision?.chooseHook).toBe("engine-variable-activation-x");
      expectSource();
      state = apply(state, (intent) => intent.kind === "choose" && intent.optionId === "X = 2");
      expect(state.pendingDecision?.chooseHook).toBe("engine-variable-activation-payment");
      expectSource();
      const payment = state.pendingDecision!.resourcePayment!.options.find((option) =>
        option.pitchInstanceIds.length === 1 && option.pitchInstanceIds[0] === pitchId)!;
      state = apply(state, (intent) => intent.kind === "choose" && intent.optionId === payment.optionId);
      expect(state.pendingDecision?.chooseHook).toBe("engine-activation-discard");
      expectSource();
      state = apply(state, (intent) => intent.kind === "choose" && intent.optionId === String(discardId));
      const view = projectStateFor(state, 1);
      expect(view.pendingDecision?.preStackSource).toBeUndefined();
      expect(view.players[0]!.pitch.some((card) => card.instanceId === pitchId)).toBe(true);
      expect(view.players[0]!.graveyard.some((card) => card.instanceId === discardId)).toBe(true);
      expect(zone === "weapon"
        ? view.chain.some((link) => link.attackingCard.instanceId === source.instanceId)
        : view.stack.some((layer) => layer.card?.instanceId === source.instanceId)).toBe(true);
    },
  );

  it("does not reveal face-down equipment while its activation costs are pending", () => {
    const state = makeGame();
    const source: CardInstance = {
      instanceId: state.nextInstanceId++, cardId: "HELM", owner: 0, faceDown: true,
    };
    player(state, 0).equipment.head = source;
    state.pendingDecision = {
      player: 0, kind: "choose-target", prompt: "Choose X", options: ["X = 0"],
      variableActivationCost: {
        mode: "action", seat: 0, sourceInstanceId: source.instanceId, abilityIndex: 0,
        choices: { "X = 0": { x: 0, cost: 0 } },
      },
    };
    expect(projectStateFor(state, 0).pendingDecision?.preStackSource?.card.cardId).toBe("HELM");
    for (const viewer of [1, null]) {
      expect(projectStateFor(state, viewer).pendingDecision?.preStackSource).toBeUndefined();
      expect(JSON.stringify(projectStateFor(state, viewer))).not.toContain('"cardId":"HELM"');
    }
  });
});
