import { describe, expect, it } from "vitest";
import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame, projectStateFor } from "@fyendal/engine";
import { decodeGameView } from "@fyendal/protocol";
import {
  CorruptRoomError,
  decodePersistedState,
  encodePersistedState,
  MAX_PERSISTED_STATE_BYTES,
} from "../persistedState.js";

function game() {
  return createGame({
    decklists: [decklists.rhinar, decklists.dorinthea],
    seed: 41,
    cards: cardData,
    scripts,
  });
}

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("PersistedStateV1", () => {
  it("round trips registered card definitions used as visual choice options", () => {
    const source = game();
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose an Agent of Chaos",
      options: ["Arakni, Black Widow"],
      cardOptions: ["HNT003"],
      sourceInstanceId: source.players[0]!.hero.instanceId,
      chooseHook: "agent-choice",
    };

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips a scripted decision's default option", () => {
    const source = game();
    source.pendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Add an energy counter?",
      options: ["yes", "no"],
      defaultOption: "yes",
      sourceInstanceId: source.players[0]!.hero.instanceId,
      chooseHook: "counter-choice",
    };

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips token provenance inherited by a delegated scripted choice", () => {
    const source = game();
    source.pendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Pay for the delegated effect?",
      options: ["paid", "no"],
      sourceInstanceId: source.players[0]!.hero.instanceId,
      chooseHook: "delegated-payment",
      tokenCreationCause: { kind: "effect", sourceCardId: "MPW104" },
    };

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips token replacement ordering while wager prizes are suspended", () => {
    const source = game();
    const replacements = source.players.map((player) => ({
      instanceId: player.hero.instanceId,
      kind: "global" as const,
    }));
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose the next token creation replacement to apply",
      options: replacements.map((replacement) => `global:${replacement.instanceId}`),
      cardOptions: replacements.map((replacement) => replacement.instanceId),
      chooseHook: "engine-token-replacement-order",
      tokenCreationReplacementOrder: {
        seat: 1,
        cardId: "HVY243",
        count: 1,
        cause: { kind: "wager", sourceCardId: "HVY216" },
        remainingReplacements: replacements,
        controllerSeats: [0, 1],
      },
      resume: { kind: "continue-wager-prizes", wagerIndex: 0 },
    };

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips token events queued behind a replacement decision", () => {
    const source = game();
    source.pendingTokenCreations = [{
      seat: 0,
      cardId: "HVY241",
      count: 1,
      cause: { kind: "effect", sourceCardId: "HVY176" },
    }];

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingTokenCreations).toEqual(source.pendingTokenCreations);
  });

  it("round trips wager-loss replacement ordering and continuation", () => {
    const source = game();
    const sourceIds = source.players[0]!.weapons.map((card) => card.instanceId);
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose the next wager-loss replacement to apply",
      options: sourceIds.map(String),
      cardOptions: sourceIds,
      chooseHook: "engine-wager-loss-replacement-order",
      wagerLossReplacementOrder: {
        wagerIndex: 0,
        remainingSourceInstanceIds: sourceIds,
      },
      resume: {
        kind: "continue-wager-loss-replacements",
        wagerIndex: 0,
        remainingSourceInstanceIds: sourceIds.slice(1),
      },
    };

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips an in-progress simultaneous trigger order", () => {
    const source = game();
    const [first, second] = source.players[0]!.hand;
    source.pendingDecision = {
      player: 0,
      kind: "order-triggers",
      prompt: "Order your triggered abilities",
      options: [`${first!.instanceId}:0`, `${second!.instanceId}:0`],
      optionLabels: ["First trigger", "Second trigger"],
      optionCounts: [3, null],
      cardOptions: [first!.instanceId, second!.instanceId],
      chooseHook: "trigger-order",
      triggerOrder: {
        remaining: [first!, second!].map((card, index) => ({
          sourceInstanceId: card.instanceId,
          seat: 0,
          triggerIndex: 0,
          ...(index === 0 ? { triggerCount: 3 } : {}),
          triggerSource: { ...card },
          triggerEventCard: { ...second! },
          label: `${card.instanceId} trigger`,
          optional: false,
        })),
        later: [],
        baseStack: [{
          sourceInstanceId: source.players[0]!.hero.instanceId,
          seat: 0,
          triggerIndex: -2,
          label: "Existing lower layer",
          optional: false,
          engineEffect: { kind: "gain-action-points", amount: 1 },
        }],
      },
    };

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("persists a final counted trigger occurrence without projecting count 1", () => {
    const source = game();
    const triggerSource = source.players[0]!.hero;
    source.stack = [{
      sourceInstanceId: triggerSource.instanceId,
      seat: 0,
      triggerIndex: 0,
      triggerCount: 1,
      triggerBatchStarted: true,
      triggerSource,
      label: "Blood Debt — lose 1 life",
      optional: false,
    }];

    const decoded = decodePersistedState(
      jsonCopy(encodePersistedState(source)),
      "ABC123",
      cardData,
      scripts,
    );
    const view = jsonCopy(projectStateFor(decoded, 0, "ABC123"));
    expect(view.stack[0]?.count).toBeUndefined();
    expect(decodeGameView(view)).not.toBeNull();
  });

  it("round trips both stages of a declared X payment", () => {
    const source = game();
    const sourceInstanceId = source.players[0]!.hero.instanceId;
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose X",
      options: ["X = 1"],
      sourceInstanceId,
      chooseHook: "test-x",
      xPayment: { choices: { "X = 1": { cost: 2, result: "x:1" } } },
    };

    const declared = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(declared), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);

    const pitchInstanceIds = source.players[0]!.hand.slice(0, 1)
      .map((card) => card.instanceId);
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Pay 2 resources",
      options: ["pay"],
      sourceInstanceId,
      chooseHook: "test-x",
      payment: {
        pitchOptions: { pay: { cost: 2, pitchIds: pitchInstanceIds, result: "x:1" } },
      },
      resourcePayment: {
        cost: 2,
        options: [{ optionId: "pay", pitchInstanceIds }],
      },
    };

    const paying = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(paying), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips both stages of a variable card play cost", () => {
    const source = game();
    const card = source.players[0]!.hand[0]!;
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose X",
      options: ["X = 0", "X = 1"],
      sourceInstanceId: card.instanceId,
      chooseHook: "engine-variable-play-x",
      variablePlayCost: {
        mode: "action",
        seat: 0,
        instanceId: card.instanceId,
        from: "hand",
        choices: {
          "X = 0": { x: 0, cost: 3 },
          "X = 1": { x: 1, cost: 4 },
        },
      },
    };

    const declaring = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(declaring), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);

    const pitchInstanceIds = source.players[0]!.hand.slice(1, 3)
      .map((candidate) => candidate.instanceId);
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Pay 4 resources",
      options: ["pay 4"],
      sourceInstanceId: card.instanceId,
      chooseHook: "engine-variable-play-payment",
      resourcePayment: {
        cost: 4,
        options: [{ optionId: "pay 4", pitchInstanceIds }],
      },
      variablePlayCost: {
        mode: "action",
        seat: 0,
        instanceId: card.instanceId,
        from: "hand",
        declaredX: 1,
        paymentOptions: { "pay 4": { pitchInstanceIds } },
      },
    };

    const paying = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(paying), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips a variable activated-ability payment", () => {
    const source = game();
    const equipment = Object.values(source.players[0]!.equipment).find(Boolean)!;
    const pitchInstanceIds = source.players[0]!.hand.slice(0, 1)
      .map((candidate) => candidate.instanceId);
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Pay 2 resources",
      options: ["pay 2"],
      sourceInstanceId: equipment.instanceId,
      chooseHook: "engine-variable-activation-payment",
      resourcePayment: {
        cost: 2,
        options: [{ optionId: "pay 2", pitchInstanceIds }],
      },
      variableActivationCost: {
        mode: "window",
        seat: 0,
        sourceInstanceId: equipment.instanceId,
        abilityIndex: 0,
        declaredX: 2,
        paymentOptions: { "pay 2": { pitchInstanceIds } },
      },
    };

    const encoded = encodePersistedState(source);
    expect(decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts)
      .pendingDecision).toEqual(source.pendingDecision);
  });

  it("round trips every persisted field and reattaches, but never stores, registries", () => {
    const source = game();
    source.globalCardIds = ["FYD-TREASURE-ISLAND"];
    const topCard = source.players[0]!.hand[0]!;
    topCard.grantedNames = ["Surging Strike"];
    topCard.grantedTypes = ["draconic"];
    topCard.grantedColor = 1;
    topCard.playableFrom = ["banish"];
    topCard.playableFromSourceCardId = source.players[0]!.hero.cardId;
    topCard.playableFromUntilChainClose = true;
    topCard.playableBySeat = 1;
    topCard.playCostReduction = 3;
    topCard.playCostReductionSeat = 1;
    source.players[0]!.hero.originalHeroCardId = source.players[0]!.hero.cardId;
    source.players[0]!.hero.temporaryHeroOriginalCardId = source.players[0]!.hero.cardId;
    source.players[0]!.hero.temporaryHeroUntilTurn = source.turn + 2;
    topCard.subcards = [{
      instanceId: source.nextInstanceId++,
      cardId: "UPR043",
      owner: 0,
    }];
    source.chain.push({
      attacker: 0,
      attackingCard: {
        instanceId: topCard.instanceId,
        cardId: topCard.cardId,
        owner: topCard.owner,
      },
      attackCardType: "action",
      defendingCards: [],
      defendingEquipment: [],
      reactions: [],
      resolvedReactionAbilitySources: [{
        instanceId: source.players[0]!.equipment.arms!.instanceId,
        cardId: source.players[0]!.equipment.arms!.cardId,
        owner: 0,
      }],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: true,
      finalAttack: 4,
      finalDefense: 0,
      finalAttackModifiers: [{
        sourceInstanceId: topCard.instanceId,
        sourceCardId: topCard.cardId,
        amount: 2,
      }],
      finalDefenseModifiers: [],
      wagerRewards: ["Winner creates Gold"],
      wagers: [{
        source: {
          instanceId: topCard.instanceId,
          cardId: topCard.cardId,
          owner: 0,
        },
        controllerSeat: 0,
        opposingSeat: 1,
        rewardCardIds: ["DYN243"],
        rewardLabel: "Winner creates Gold",
      }],
      flags: {},
    });
    const orderIds = source.players[0]!.hand.slice(0, 2).map((card) => card.instanceId);
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose the next card for the deck bottom",
      options: orderIds.map(String),
      cardOptions: [...orderIds],
      chooseHook: "engine-deck-bottom-order",
      deckBottomOrder: { ordered: [], remaining: orderIds },
      resume: { kind: "finish-wager-result", wagerIndex: 0 },
    };
    source.stack = [
      {
        sourceInstanceId: source.players[0]!.equipment.arms!.instanceId,
        seat: 0,
        triggerIndex: -1,
        label: "Attack reaction ability",
        optional: false,
        ability: true,
        abilityCard: source.players[0]!.equipment.arms!,
        resolvedReactionAbility: true,
      },
      {
        sourceInstanceId: orderIds[0]!,
        seat: 0,
        triggerIndex: -3,
        label: "Phantasm — destroy this attack",
        optional: false,
        engineEffect: { kind: "phantasm-destroy" },
      },
      {
        sourceInstanceId: orderIds[1]!,
        seat: 0,
        triggerIndex: -2,
        label: "Gain 1 action point",
        optional: false,
        engineEffect: { kind: "gain-action-points", amount: 1 },
      },
      {
        sourceInstanceId: orderIds[1]!,
        seat: 0,
        triggerIndex: -2,
        label: "Lose 1 life",
        optional: false,
        engineEffect: { kind: "lose-life", amount: 1 },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -2,
        label: "On hit",
        optional: false,
        engineEffect: {
          kind: "on-hit-hook",
          source: { instanceId: topCard.instanceId, cardId: topCard.cardId, owner: 0 },
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -8,
        label: "Effect hit",
        optional: false,
        engineEffect: {
          kind: "on-effect-hit-hook",
          source: { instanceId: topCard.instanceId, cardId: topCard.cardId, owner: 0 },
          targetSeat: 1,
        },
      },
      {
        sourceInstanceId: source.players[0]!.hero.instanceId,
        seat: 0,
        triggerIndex: -9,
        label: "Friendly effect hit",
        optional: false,
        engineEffect: {
          kind: "on-friendly-effect-hit-hook",
          source: source.players[0]!.hero,
          hitSource: { instanceId: topCard.instanceId, cardId: topCard.cardId, owner: 0 },
          targetSeat: 1,
          targetWasMarked: true,
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -99,
        label: "On hit",
        optional: false,
        engineEffect: {
          kind: "on-hit-modifier",
          modifier: {
            id: 9,
            sourceInstanceId: topCard.instanceId,
            seat: 0,
            scope: "until-end-of-turn",
            onHitGainResources: 1,
          },
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -4,
        label: "When this defends",
        optional: false,
        engineEffect: {
          kind: "on-defend-hook",
          source: { instanceId: topCard.instanceId, cardId: topCard.cardId, owner: 0 },
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -5,
        label: "When your attack is defended",
        optional: false,
        engineEffect: {
          kind: "on-friendly-defended-hook",
          source: { instanceId: topCard.instanceId, cardId: topCard.cardId, owner: 0 },
          defendedFromHand: true,
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -1009,
        label: "When the affected attack is defended by 1 or more cards",
        optional: false,
        engineEffect: {
          kind: "on-defended-modifier",
          modifier: {
            id: 9,
            sourceInstanceId: topCard.instanceId,
            seat: 0,
            scope: "chain-link",
            onDefendedDealDamage: 1,
            consumed: true,
          },
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -6,
        label: "Fragment",
        optional: false,
        engineEffect: {
          kind: "fragment",
          source: { instanceId: topCard.instanceId, cardId: topCard.cardId, owner: 0 },
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -7,
        label: "Whenever this fragments",
        optional: false,
        engineEffect: {
          kind: "on-fragment-hook",
          source: { instanceId: topCard.instanceId, cardId: topCard.cardId, owner: 0 },
        },
      },
      {
        sourceInstanceId: topCard.instanceId,
        seat: 0,
        triggerIndex: -2000,
        label: "Resolve wager: Winner creates Gold",
        optional: false,
        engineEffect: { kind: "wager-result", wagerIndex: 0 },
      },
    ];
    source.pendingTriggeredLayers = [{
      sourceInstanceId: source.players[0]!.hero.instanceId,
      seat: 0,
      triggerIndex: 0,
      triggerSource: source.players[0]!.hero,
      triggerEventCard: topCard,
      label: "Pending discard trigger",
      optional: false,
    }];
    source.stackResume = "finish-link-resolution";
    source.log.push({ publicText: "public", seatText: ["private zero", null] });
    const encoded = encodePersistedState(source, "sha256:release-one");
    const serialized = JSON.stringify(encoded);
    expect(serialized).not.toContain("cardsRef");
    expect(serialized).not.toContain("scriptsRef");

    const decoded = decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts, "sha256:release-one");
    expect(decoded.cardsRef).toBe(cardData);
    expect(decoded.scriptsRef).toBe(scripts);
    expect(encodePersistedState(decoded, "sha256:release-one")).toEqual(encoded);
  });

  it("round trips arsenal slots and other late-added runtime fields", () => {
    const source = game();
    const arsenalCard = source.players[1]!.hand.shift()!;
    arsenalCard.faceDown = true;
    arsenalCard.arsenalSlot = 0;
    arsenalCard.playableFromEndTurnExpiry = source.turn + 1;
    arsenalCard.playableFromUntilStartOfSeatTurn = 1;
    arsenalCard.playableFromUntilEndOfSeatTurn = 1;
    arsenalCard.playableFromGrantedTurn = source.turn;
    arsenalCard.grantedBaseAbilitiesCardIds = [source.players[1]!.hero.cardId];
    arsenalCard.temporaryAlly = { power: 2, life: 3 };
    arsenalCard.temporaryGraveyardReplacement = "banish";
    arsenalCard.playableAsInstant = true;
    source.players[1]!.arsenal.push(arsenalCard);

    source.modifiers.push({
      id: source.nextModifierId++,
      sourceInstanceId: arsenalCard.instanceId,
      sourceCardId: arsenalCard.cardId,
      seat: 1,
      scope: "until-end-of-turn",
      expiresAtStartOfTurn: source.turn + 2,
      expiresAtEndOfTurn: source.turn + 1,
      expiresAtStartOfSeatTurn: 1,
      expiresAtEndOfSeatTurn: 1,
      createdTurn: source.turn,
      attackActivationCostReduction: 1,
      activationCostReduction: 1,
      appliesToFirstDefenderOnly: true,
      overpower: true,
      preventNextDamagePool: 2,
      preventDamagePerEvent: 1,
      preventDamageEventsRemaining: 2,
      preventNextDamageFromPitch: 3,
      prohibitsName: "test name",
      grantsTypeToName: "test name",
      grantsType: "ninja",
      suppressesHeroAbilities: true,
      suppressesOwnedNames: true,
      suppressesOwnedClassTalentTypes: true,
      attackActionCardCap: 1,
      nonAttackActionCardCap: 2,
      restrictActionsToWeaponOrAttack: true,
      restrictActionsToNonWeaponNonAttack: true,
      prohibitsDefenseReactionNamesInGraveyard: true,
      goAgainIfDefendedByAttackAction: true,
      goAgainIfPlayedOrCreatedSubtype: "aura",
      suppressHitEffects: true,
      defendingPitchDefenseAdjustment: { pitch: 2, amount: -1, requiresAimCounter: true },
      onDestroyedDraw: 1,
      onBoostDominate: true,
      onActionPlayedGainActionPoints: 1,
      onFriendlyActivateCreateToken: "FYD-QUICKEN",
      extraDiceIgnoreLowest: 1,
      onHitClearHandAndArsenalAtEndPhase: true,
      onHitDealDamage: 2,
      replaceCombatDamageWithDefendingEquipment: true,
      onDamageDealtCreateTokenPerPoint: "FYD-COPPER",
      minBasePower: 3,
      appliesToInstanceId: arsenalCard.instanceId,
      appliesToTargetType: "guardian",
      appliesToMarkedHero: true,
      grantsPlayFromZone: "banish",
      grantsPlayFromNameContains: "runechant",
      appliesToPitch: 2,
      playCostReduction: 1,
      remainingCostUses: 3,
      appliesToRuneGated: true,
      appliesToCharged: true,
      noDefenseReactionsFromHand: true,
      onDefendedByAttackActionPowerCounters: 1,
    });
    source.pendingDecision = {
      player: 1,
      kind: "optional-effect",
      prompt: "Resolve replacement?",
      arcane: {
        sourceInstanceId: arsenalCard.instanceId,
        sourceSeat: 1,
        targetSeat: 0,
        amount: 3,
        arcane: false,
        sourceIsRunechant: true,
        arcaneBarrierResolved: true,
        destroySourceAfterDamage: true,
        targetWasMarked: true,
        combat: true,
        combatDamageEquipmentReplacementIds: [source.players[0]!.equipment.chest!.instanceId],
      },
      dieRoll: {
        rollingSourceInstanceId: arsenalCard.instanceId,
        rollingSeat: 1,
        hook: "test-roll",
        sides: 6,
        result: 5,
        extraDiceIgnoreLowest: 1,
        replacementInstanceId: source.players[1]!.hero.instanceId,
      },
    };

    const encoded = encodePersistedState(source);
    const decoded = decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts);
    expect(decoded.players[1]!.arsenal[0]).toMatchObject({
      instanceId: arsenalCard.instanceId,
      arsenalSlot: 0,
    });
    expect(encodePersistedState(decoded)).toEqual(encoded);
  });

  it("projects a persisted face-down graveyard card into reconnect-safe views", () => {
    const source = game();
    const hidden = source.players[1]!.hand.shift()!;
    hidden.faceDown = true;
    source.players[1]!.graveyard.push(hidden);

    const decoded = decodePersistedState(
      jsonCopy(encodePersistedState(source)),
      "ABC123",
      cardData,
      scripts,
    );

    for (const seat of [0, 1, null] as const) {
      const view = jsonCopy(projectStateFor(decoded, seat, "ABC123"));
      expect(decodeGameView(view), `seat ${seat}`).not.toBeNull();
    }
  });

  it("round trips delayed triggers independently of their source zone", () => {
    const source = game();
    const card = source.players[0]!.hand[0]!;
    source.delayedTriggers.push({
      source: jsonCopy(card),
      seat: 0,
      subjectSeat: 0,
      event: "end-of-turn",
      turn: source.turn,
      hook: "test-cleanup",
      label: "Resolve delayed cleanup",
    });

    const encoded = encodePersistedState(source);
    const decoded = decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts);
    expect(decoded.delayedTriggers).toEqual(source.delayedTriggers);
    expect(encodePersistedState(decoded)).toEqual(encoded);
  });

  it("hydrates pre-stats rooms and validates authoritative counters", () => {
    const legacy = jsonCopy(encodePersistedState(game())) as unknown as {
      state: Record<string, unknown>;
    };
    delete legacy.state.globalCardIds;
    delete legacy.state.extraTurnSeats;
    delete legacy.state.gameStats;
    delete legacy.state.delayedTriggers;
    const decoded = decodePersistedState(legacy, "ABC123", cardData, scripts);
    expect(decoded.globalCardIds).toEqual([]);
    expect(decoded.extraTurnSeats).toEqual([]);
    expect(decoded.gameStats).toEqual({ turns: [] });
    expect(decoded.delayedTriggers).toEqual([]);

    const corrupt = jsonCopy(encodePersistedState(game()));
    corrupt.state.gameStats!.turns[0]!.damageDealt[1] = -1;
    expect(() => decodePersistedState(corrupt, "ABC123", cardData, scripts))
      .toThrow(/damageDealt\[1\].*non-negative/);
  });

  it("round trips paused reaction costs and damage replacement modifiers", () => {
    const source = game();
    const card = source.players[0]!.hand.shift()!;
    source.resolving = [card];
    source.pendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Reveal a card to fuse?",
      options: ["no"],
      chooseHook: "earth-fusion",
      sourceInstanceId: card.instanceId,
      arcane: {
        sourceInstanceId: card.instanceId,
        sourceSeat: 1,
        targetSeat: 0,
        amount: 2,
        arcane: false,
        usedQuellSourceIds: [card.instanceId + 1],
        quellSourceInstanceId: card.instanceId + 2,
        payTotal: 1,
      },
      resume: { kind: "finish-reaction", seat: 0, card, from: "hand" },
    };
    source.modifiers.push({
      id: source.nextModifierId++,
      sourceInstanceId: card.instanceId,
      seat: 0,
      scope: "until-end-of-turn",
      damage: 1,
      attackCostReduction: 1,
      appliesToTargetNamePrefix: "arakni",
      restrictCardPlaysToType: "draconic",
      ongoingLabel: "Chosen mode",
      preventNextDamageAmount: 3,
      maxDamageEventAmount: 3,
      appliesToDamageSourceType: "shadow",
      redirectDamageFromSeat: 1,
      redirectDamageToSeat: 0,
      redirectDamagePrevent: 1,
      appliesTo: "attack",
      grantKeyword: "go again",
    });

    const encoded = encodePersistedState(source);
    const decoded = decodePersistedState(jsonCopy(encoded), "ABC123", cardData, scripts);
    expect(encodePersistedState(decoded)).toEqual(encoded);
  });

  it("round trips paused activation-card costs and clash replacements", () => {
    const source = game();
    const sourceCard = source.players[0]!.hand[0]!;
    sourceCard.pitchCount = 2;
    const revealed = source.players[0]!.deck[0]!;
    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose an effect-cost card",
      options: [String(sourceCard.instanceId)],
      cardOptions: [sourceCard.instanceId],
      revealedCardIds: [sourceCard.instanceId],
      chooseHook: "test-effect-cost",
      sourceInstanceId: sourceCard.instanceId,
      activationCost: {
        mode: "action",
        seat: 0,
        sourceInstanceId: sourceCard.instanceId,
        abilityIndex: 0,
        pitchInstanceIds: [],
        soulInstanceIds: [sourceCard.instanceId],
        discardInstanceIds: [source.players[0]!.hand[1]!.instanceId],
        effectCostInstanceIds: [sourceCard.instanceId],
      },
    };
    const activationEncoded = encodePersistedState(source);
    const activationDecoded = decodePersistedState(jsonCopy(activationEncoded), "ABC123", cardData, scripts);
    expect(encodePersistedState(activationDecoded)).toEqual(activationEncoded);

    source.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose a revealed card",
      options: [String(revealed.instanceId)],
      cardOptions: [revealed.instanceId],
      chooseHook: "victor-reclash-bottom",
      sourceInstanceId: sourceCard.instanceId,
      clash: {
        request: {
          sourceSeat: 0,
          sourceInstanceId: sourceCard.instanceId,
          opposingSeat: 1,
          resultHook: "test-clash",
        },
        attempt: {
          winner: -1,
          revealed: [{ seat: 0, instanceId: revealed.instanceId }],
        },
        replacementSeats: [0],
        replacementIndex: 0,
        stage: "bottom",
        chosenReplacementSeat: 0,
        queue: [],
      },
    };
    const clashEncoded = encodePersistedState(source);
    const clashDecoded = decodePersistedState(jsonCopy(clashEncoded), "ABC123", cardData, scripts);
    expect(encodePersistedState(clashDecoded)).toEqual(clashEncoded);
  });

  it("rejects corrupt nested fields and unknown nested keys", () => {
    const corrupt = jsonCopy(encodePersistedState(game()));
    corrupt.state.players[0].hero.instanceId = Number.MAX_SAFE_INTEGER + 1;
    expect(() => decodePersistedState(corrupt, "ABC123", cardData, scripts)).toThrowError(CorruptRoomError);

    const negativePitchCount = jsonCopy(encodePersistedState(game()));
    negativePitchCount.state.players[0].hero.pitchCount = -1;
    expect(() => decodePersistedState(negativePitchCount, "ABC123", cardData, scripts))
      .toThrow(/pitchCount.*non-negative/);

    const unknown = jsonCopy(encodePersistedState(game())) as unknown as {
      state: { players: Array<{ hero: Record<string, unknown> }> };
    };
    unknown.state.players[0]!.hero.poison = "PRIVATE-INSTANCE-999";
    expect(() => decodePersistedState(unknown, "ABC123", cardData, scripts)).toThrow(/unexpected field/);

    const modifierSource = game();
    modifierSource.modifiers.push({
      id: modifierSource.nextModifierId++,
      sourceInstanceId: modifierSource.players[0]!.hero.instanceId,
      seat: 0,
      scope: "until-end-of-turn",
      attack: 1,
    });
    const unknownModifier = jsonCopy(encodePersistedState(modifierSource)) as unknown as {
      state: { modifiers: Array<Record<string, unknown>> };
    };
    unknownModifier.state.modifiers[0]!.newEngineEffect = true;
    expect(() => decodePersistedState(unknownModifier, "ABC123", cardData, scripts))
      .toThrow(/state\.modifiers\[0\]\.newEngineEffect.*unexpected field/);
  });

  it("rejects missing, future, and cross-ruleset envelopes", () => {
    const encoded = jsonCopy(encodePersistedState(game(), "rules-a")) as unknown as Record<string, unknown>;
    delete encoded.schemaVersion;
    expect(() => decodePersistedState(encoded, "ABC123", cardData, scripts)).toThrow(/schemaVersion.*current schema version 1/);

    const future = jsonCopy(encodePersistedState(game())) as unknown as { schemaVersion: number };
    future.schemaVersion = 2;
    expect(() => decodePersistedState(future, "ABC123", cardData, scripts)).toThrow(/current schema version 1/);

    expect(() => decodePersistedState(encodePersistedState(game(), "rules-a"), "ABC123", cardData, scripts, "rules-b"))
      .toThrow(/another ruleset/);
  });

  it("rejects oversized state before traversing it", () => {
    const encoded = jsonCopy(encodePersistedState(game()));
    encoded.state.log.push({ publicText: "x".repeat(MAX_PERSISTED_STATE_BYTES), seatText: [null, null] });
    expect(() => decodePersistedState(encoded, "ABC123", cardData, scripts)).toThrow(/size limit/);
  });

  it("rejects recursive arcane queues beyond the configured depth", () => {
    const encoded = jsonCopy(encodePersistedState(game())) as unknown as {
      state: { pendingDecision: Record<string, unknown> | null };
    };
    let arcane: Record<string, unknown> = {
      sourceInstanceId: 1,
      sourceSeat: 0,
      targetSeat: 1,
      amount: 1,
      arcane: true,
    };
    const root = arcane;
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = {
        sourceInstanceId: 1,
        sourceSeat: 0,
        targetSeat: 1,
        amount: 1,
        arcane: true,
      };
      arcane.queue = [next];
      arcane = next;
    }
    encoded.state.pendingDecision = {
      player: 1,
      kind: "optional-effect",
      prompt: "Prevent?",
      arcane: root,
    };
    expect(() => decodePersistedState(encoded, "ABC123", cardData, scripts)).toThrow(/too deep/);
  });
});
