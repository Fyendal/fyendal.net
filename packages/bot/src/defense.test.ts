import { cardData, findPrinting } from "@fyendal/cards";
import { describe, expect, it } from "vitest";
import { requiredEquipmentStageIntent } from "./defense.js";
import type { BotPolicyInput } from "./policy.js";

describe("requiredEquipmentStageIntent", () => {
  it("stages equipped equipment, not an Evo still in hand", () => {
    const evo = { instanceId: 1, cardId: findPrinting("Evo Recall", 3)!.id };
    const helm = { instanceId: 2, cardId: findPrinting("Ironrot Helm")!.id };
    const input = (equipped: boolean) => ({
      seat: 0,
      cards: cardData,
      view: {
        pendingDecision: { kind: "defend", stagedCards: [] },
        players: [{ hand: [evo], arsenal: [], equipment: equipped ? { head: helm } : {}, weapons: [] }],
      },
      legal: [{ kind: "stage-defenders", instanceIds: equipped ? [1, 2] : [1] }],
    }) as unknown as BotPolicyInput;

    expect(requiredEquipmentStageIntent(input(true))).toEqual({ kind: "stage-defenders", instanceIds: [2] });
    expect(requiredEquipmentStageIntent(input(false))).toBeUndefined();
  });
});
