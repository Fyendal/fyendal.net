import type { BotPolicyInput } from "@fyendal/bot";
import { describe, expect, it } from "vitest";
import { fallbackBotIntent } from "../botFallback.js";

describe("conservative bot fallback", () => {
  it("stages the strongest visible defender before accepting fallback damage", () => {
    const inputView = {
      pendingDecision: {
        player: 1,
        kind: "defend" as const,
        prompt: "Choose defending cards",
      },
      chain: [{
        attackingCard: { instanceId: 99, cardId: "", owner: 0 },
        defendingCards: [],
        attackValue: 8,
        defenseValue: 0,
        damage: 8,
        resolved: false,
        reactions: [],
      }],
      players: [
        {} as BotPolicyInput["view"]["players"][0],
        {
          hand: [
            { instanceId: 1, cardId: "weak", owner: 1, defense: 1 },
            { instanceId: 2, cardId: "strong", owner: 1, defense: 3 },
          ],
          arsenal: [],
          equipment: {},
        } as unknown as BotPolicyInput["view"]["players"][1],
      ],
    } as unknown as BotPolicyInput["view"];
    expect(fallbackBotIntent({
      seat: 1,
      view: inputView,
      cards: {},
      legal: [
        { kind: "defend", instanceIds: [] },
        { kind: "stage-defenders", instanceIds: [1] },
        { kind: "stage-defenders", instanceIds: [2] },
      ],
    })).toEqual({ kind: "stage-defenders", instanceIds: [2] });
  });

  it("commits staged defense instead of exceeding a non-block defender limit", () => {
    const stagedCards = [
      { instanceId: 1, cardId: "blocker", owner: 1 as const, defense: 3 },
      { instanceId: 2, cardId: "blocker", owner: 1 as const, defense: 3 },
    ];
    const inputView = {
      pendingDecision: {
        player: 1,
        kind: "defend" as const,
        prompt: "Choose defending cards",
        stagedCards,
        stagedDefense: 6,
      },
      chain: [{
        attackingCard: { instanceId: 99, cardId: "", owner: 0 },
        defendingCards: [],
        attackValue: 8,
        defenseValue: 0,
        damage: 8,
        resolved: false,
        maxNonBlockDefenders: 2,
        reactions: [],
      }],
      players: [
        {} as BotPolicyInput["view"]["players"][0],
        {
          hand: [...stagedCards, { instanceId: 3, cardId: "blocker", owner: 1, defense: 3 }],
          arsenal: [],
          equipment: {},
        } as unknown as BotPolicyInput["view"]["players"][1],
      ],
    } as unknown as BotPolicyInput["view"];

    expect(fallbackBotIntent({
      seat: 1,
      view: inputView,
      cards: {
        blocker: { id: "blocker", name: "Blocker", cardType: "action", defense: 3, text: "" },
      },
      legal: [
        { kind: "defend", instanceIds: [1, 2] },
        { kind: "stage-defenders", instanceIds: [1] },
        { kind: "stage-defenders", instanceIds: [2] },
        { kind: "stage-defenders", instanceIds: [3] },
      ],
    })).toEqual({ kind: "defend", instanceIds: [1, 2] });
  });

  it("uses an already-funded weapon attack instead of passing after a policy failure", () => {
    const weapon = { instanceId: 66, cardId: "MPW005", owner: 1 as const };
    const pass = { kind: "pass" as const };
    const attack = {
      kind: "activate-ability" as const,
      sourceInstanceId: weapon.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    };
    const inputView = {
      phase: "action" as const,
      activePlayer: 1 as const,
      priorityPlayer: 1 as const,
      pendingDecision: null,
      players: [
        {} as BotPolicyInput["view"]["players"][0],
        { weapons: [weapon] } as unknown as BotPolicyInput["view"]["players"][1],
      ],
    } as unknown as BotPolicyInput["view"];

    expect(fallbackBotIntent({
      seat: 1,
      view: inputView,
      cards: {},
      legal: [pass, attack],
    })).toEqual(attack);
  });

});
