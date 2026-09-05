import type { ChainLinkView, GameIntent, PlayerView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { abilityLabelForSource, deriveBoardLegalState } from "./boardModel.js";

describe("board legal projection", () => {
  it("indexes playable and activatable action candidates", () => {
    const candidates: GameIntent[] = [
      { kind: "play-card", instanceId: 1, pitchInstanceIds: [] },
      { kind: "play-from-arsenal", instanceId: 2, pitchInstanceIds: [] },
      { kind: "play-from-zone", instanceId: 3, zone: "banish", pitchInstanceIds: [] },
      { kind: "activate-ability", sourceInstanceId: 4, abilityIndex: 0, pitchInstanceIds: [] },
    ];

    const result = deriveBoardLegalState(candidates, []);

    expect([...result.playableHand]).toEqual([1]);
    expect([...result.playableArsenal]).toEqual([2]);
    expect([...result.playableZones]).toEqual([[3, "banish"]]);
    expect([...result.activatable]).toEqual([4]);
  });

  it("keeps pass, chain-close, and defender staging sourced from legal intents", () => {
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [8, 9] },
      { kind: "pass" },
      { kind: "close-chain" },
    ];

    const result = deriveBoardLegalState([], legal);

    expect([...result.stageableDefenders]).toEqual([8, 9]);
    expect(result.canPass).toBe(true);
    expect(result.canCloseChain).toBe(true);
  });

  it("disables every playable card and activated ability while a room command is pending", () => {
    const candidates: GameIntent[] = [
      { kind: "play-card", instanceId: 1, pitchInstanceIds: [] },
      { kind: "play-from-arsenal", instanceId: 2, pitchInstanceIds: [] },
      { kind: "play-from-zone", instanceId: 3, zone: "banish", pitchInstanceIds: [] },
      { kind: "activate-ability", sourceInstanceId: 4, abilityIndex: 0, pitchInstanceIds: [] },
    ];
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [8] },
      { kind: "pass" },
      { kind: "close-chain" },
    ];

    const result = deriveBoardLegalState(candidates, legal, true);

    expect([...result.playableHand]).toEqual([]);
    expect([...result.playableArsenal]).toEqual([]);
    expect([...result.playableZones]).toEqual([]);
    expect([...result.activatable]).toEqual([]);
    expect([...result.stageableDefenders]).toEqual([8]);
    expect(result.canPass).toBe(true);
    expect(result.canCloseChain).toBe(true);
  });

  it("finds ability labels on defending combat-chain cards", () => {
    const player = {
      heroInstanceId: 1,
      weapons: [],
      equipment: {},
      board: [],
      hand: [],
      arsenal: [],
      graveyard: [],
      banish: [],
    } as unknown as PlayerView;
    const chain = [{
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [{
        instanceId: 84,
        cardId: "SEA225",
        owner: 1,
        activatedAbilityLabels: ["Discard a card"],
      }],
      reactions: [],
      attackValue: 3,
      defenseValue: 2,
      damage: 1,
      resolved: false,
    }] satisfies ChainLinkView[];

    expect(abilityLabelForSource(player, chain, 84, 0)).toBe("Discard a card");
  });

  it("finds ability labels on graveyard cards", () => {
    const player = {
      heroInstanceId: 1,
      weapons: [],
      equipment: {},
      board: [],
      hand: [],
      arsenal: [],
      graveyard: [{
        instanceId: 245,
        cardId: "HVY245",
        owner: 0,
        activatedAbilityLabels: ["Attack", "Equip from graveyard"],
      }],
      banish: [],
    } as unknown as PlayerView;

    expect(abilityLabelForSource(player, [], 245, 1)).toBe("Equip from graveyard");
  });
});
