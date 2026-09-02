import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame, projectStateFor } from "@fyendal/engine";
import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import {
  chooseScoredIntent,
  allyLethalThreshold,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  nextTurnArsenalOpportunityCost,
  ownCards,
  plannedDefenseReactionPlan,
  responseEvaluation,
  scoreDefenseIntent,
  scoreDefenseIntentWithTrace,
  spendsOpeningArsenalReserve,
  wagerRewardValue,
  MAX_OPTIONAL_DEFENDERS,
  type BotPolicyInput,
  type BotPolicyScorers,
} from "./policy.js";

describe("opening-turn aggression", () => {
  function openingInput(): {
    input: BotPolicyInput;
    allIn: GameIntent;
    preserving: GameIntent;
  } {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 94_150,
      startPlayer: 0,
    });
    const first = state.players[0]!.hand[0]!;
    const reserve = state.players[0]!.hand[1]!;
    first.cardId = "ANQ031";
    state.players[0]!.hand = [first, reserve];
    state.players[1]!.hand = state.players[1]!.hand.slice(0, 2);
    const allIn: GameIntent = {
      kind: "play-card",
      instanceId: first.instanceId,
      pitchInstanceIds: [reserve.instanceId],
    };
    const preserving: GameIntent = {
      kind: "play-card",
      instanceId: first.instanceId,
      pitchInstanceIds: [],
    };
    const input: BotPolicyInput = {
      seat: 0,
      view: projectStateFor(state, 0),
      legal: [allIn, preserving, { kind: "pass" }],
      cards: cardData,
    };
    return { input, allIn, preserving };
  }

  it("prefers an attack that retains an arsenal card at exactly two opposing cards", () => {
    const { input, allIn, preserving } = openingInput();

    expect(spendsOpeningArsenalReserve(allIn, input)).toBe(true);
    expect(spendsOpeningArsenalReserve(preserving, input)).toBe(false);
  });

  it("allows an all-in first attack when no arsenal-preserving attack exists", () => {
    const { input, allIn } = openingInput();
    input.legal = [allIn, { kind: "pass" }];

    expect(spendsOpeningArsenalReserve(allIn, input)).toBe(false);
  });

  it("reserves the last card after the bot has attacked", () => {
    const { input } = openingInput();
    const last = input.view.players[0].hand[1]!;
    const followup: GameIntent = {
      kind: "play-card",
      instanceId: last.instanceId,
      pitchInstanceIds: [],
    };
    input.view.players[0].hand = [last];
    input.view.players[0].handCount = 1;
    input.view.turnFacts!.players[0].attacks = 1;
    input.legal = [followup, { kind: "pass" }];

    expect(spendsOpeningArsenalReserve(followup, input)).toBe(true);
  });
});

function defenderPruningChoice(count: number, maxNonBlockDefenders?: number): GameIntent {
  const state = createGame({
    decklists: [decklists.dorinthea, decklists.rhinar],
    cards: cardData,
    scripts,
    seed: 94_140 + count,
    startPlayer: 1,
  });
  const view = projectStateFor(state, 0);
  const defenders = Array.from({ length: count }, (_, index): CardView => ({
    instanceId: 100_000 + index,
    cardId: "WTR159",
    owner: 0,
    defense: 1,
  }));
  view.players[0].hand = defenders;
  view.players[0].handCount = defenders.length;
  view.phase = "defend";
  view.priorityPlayer = 0;
  view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
  view.chain = [{
    attackingCard: { instanceId: 200_000, cardId: "WTR001", owner: 1 },
    defendingCards: [],
    attackValue: count,
    defenseValue: 0,
    damage: count,
    resolved: false,
    reactions: [],
    ...(maxNonBlockDefenders !== undefined ? { maxNonBlockDefenders } : {}),
  }];
  const input: BotPolicyInput = {
    seat: 0,
    view,
    legal: [
      { kind: "defend", instanceIds: [] },
      ...defenders.map((card) => ({
        kind: "stage-defenders" as const,
        instanceIds: [card.instanceId],
      })),
    ],
    cards: cardData,
  };
  return chooseScoredIntent(input, {
    defend: (intent) => intent.instanceIds.reduce((total, id) => total + id, 0),
    choose: () => 0,
    play: () => 0,
    nextTurnArsenal: () => 0,
  });
}

describe("defender candidate bounds", () => {
  it("stages equipment when Palantir Aeronought withholds the defend intent", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 94_139,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const equipment = Object.values(view.players[0].equipment).find((card) => card !== undefined)!;
    const handCard = view.players[0].hand[0]!;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 200_001, cardId: "SEA012", owner: 1 },
      defendingCards: [],
      attackValue: 6,
      defenseValue: 0,
      damage: 6,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "stage-defenders", instanceIds: [handCard.instanceId] },
      { kind: "stage-defenders", instanceIds: [equipment.instanceId] },
      { kind: "concede" },
    ];

    expect(chooseScoredIntent({ seat: 0, view, legal, cards: cardData }, {
      defend: (intent) => intent.instanceIds.includes(handCard.instanceId) ? 100 : 0,
      choose: () => 0,
      play: () => 0,
      nextTurnArsenal: () => 0,
    })).toEqual({
      kind: "stage-defenders",
      instanceIds: [equipment.instanceId],
    });
  });

  it("enumerates every optional defender through the exact limit", () => {
    const intent = defenderPruningChoice(MAX_OPTIONAL_DEFENDERS);
    expect(intent).toMatchObject({ kind: "stage-defenders" });
    if (intent.kind !== "stage-defenders") return;
    expect(intent.instanceIds).toHaveLength(MAX_OPTIONAL_DEFENDERS);
  });

  it("deterministically retains the ten strongest individual defenders above the limit", () => {
    const first = defenderPruningChoice(MAX_OPTIONAL_DEFENDERS + 1);
    const second = defenderPruningChoice(MAX_OPTIONAL_DEFENDERS + 1);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ kind: "stage-defenders" });
    if (first.kind !== "stage-defenders") return;
    expect(first.instanceIds).toHaveLength(MAX_OPTIONAL_DEFENDERS);
    expect(first.instanceIds).not.toContain(100_000);
  });

  it("honors the attack's maximum number of non-block defenders", () => {
    const intent = defenderPruningChoice(4, 2);
    expect(intent).toEqual({
      kind: "stage-defenders",
      instanceIds: [100_002, 100_003],
    });
  });
});

describe("shared ally targeting", () => {
  it("requires three damage to kill an untapped Sawbones", () => {
    const setup = spectraInput([]);
    const sawbones: CardView = {
      instanceId: 94_130,
      cardId: "SEA264",
      owner: 1,
      life: 2,
    };
    setup.input.view.players[1].board = [sawbones];
    const source = setup.input.view.players[0].hand.find((card) =>
      card.instanceId === setup.snatch.instanceId
    )!;
    source.attack = 2;
    const hero: GameIntent = {
      kind: "play-card",
      instanceId: setup.snatch.instanceId,
      pitchInstanceIds: [],
    };
    const ally: GameIntent = { ...hero, targetAllyId: sawbones.instanceId };
    setup.input.legal = [ally, hero, { kind: "pass" }];

    expect(allyLethalThreshold(sawbones, setup.input)).toBe(3);
    expect(enforceAllyTargetPolicy(setup.input, ally)).toEqual(hero);

    setup.input.legal = [ally, { kind: "pass" }];
    expect(enforceAllyTargetPolicy(setup.input, ally)).toEqual({ kind: "pass" });

    source.attack = 3;
    setup.input.legal = [ally, hero, { kind: "pass" }];
    expect(enforceAllyTargetPolicy(setup.input, hero)).toEqual(ally);
  });
});

function equipmentDefenseScores(options: {
  turn?: number;
  life?: number;
  equipmentName?: string;
  equipmentDefense?: number;
  equipmentKeywords?: string[];
  attackType?: "action" | "weapon";
  onHit?: boolean;
  wagered?: boolean;
}) {
  const state = createGame({
    decklists: [decklists.dorinthea, decklists.rhinar],
    cards: cardData,
    scripts,
    seed: 9413,
    startPlayer: 1,
  });
  const equipmentCardId = "TEST_TIMED_EQUIPMENT";
  const attackCardId = "TEST_TIMED_ATTACK";
  const equipment: CardView = {
    instanceId: state.nextInstanceId++,
    cardId: equipmentCardId,
    owner: 0,
    defense: options.equipmentDefense ?? 2,
  };
  const cards: Record<string, CardData> = {
    ...cardData,
    [equipmentCardId]: {
      id: equipmentCardId,
      name: options.equipmentName ?? "Test Durable Armor",
      cardType: "equipment",
      text: (options.equipmentKeywords ?? ["Battleworn"]).join(". "),
      defense: options.equipmentDefense ?? 2,
      subtypes: ["head"],
      keywords: options.equipmentKeywords ?? ["Battleworn"],
    },
    [attackCardId]: {
      id: attackCardId,
      name: "Test Attack",
      cardType: options.attackType ?? "action",
      text: options.onHit ? "When this hits, draw a card." : "",
      ...(options.attackType === "weapon" ? {} : { subtypes: ["attack"] }),
      attack: 2,
    },
  };
  const view = projectStateFor(state, 0);
  view.turn = options.turn ?? 3;
  view.players[0].life = options.life ?? 40;
  view.players[0].hand = [];
  view.players[0].handCount = 0;
  view.players[0].equipment = { head: equipment };
  view.phase = "defend";
  view.priorityPlayer = 0;
  view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
  view.chain = [{
    attackingCard: { instanceId: state.nextInstanceId++, cardId: attackCardId, owner: 1 },
    defendingCards: [],
    attackValue: 2,
    defenseValue: 0,
    damage: 2,
    resolved: false,
    ...(options.onHit
      ? { onHitEffects: [{ sourceCardId: attackCardId, text: "When this hits, draw a card." }] }
      : {}),
    ...(options.wagered
      ? { wagered: true, wagerRewards: ["Winner creates Gold"] }
      : {}),
    reactions: [],
  }];
  const input: BotPolicyInput = { seat: 0, view, legal: [], cards };
  const own = ownCards(input);
  const config = {
    offensiveCards: () => [],
    evaluateResponse: () => responseEvaluation({}),
    cardOpportunity: () => 0,
  };
  return {
    block: scoreDefenseIntent({ kind: "defend", instanceIds: [equipment.instanceId] }, input, own, config),
    noBlock: scoreDefenseIntent({ kind: "defend", instanceIds: [] }, input, own, config),
  };
}

function cycleDefenseFixture(
  hand: readonly { id: string; attack: number; defense: number; pitch?: 1 | 2 | 3 }[],
  options: {
    attackValue?: number;
    goAgain?: boolean;
    onHitText?: string;
    life?: number;
  } = {},
) {
  const state = createGame({
    decklists: [decklists.dorinthea, decklists.rhinar],
    cards: cardData,
    scripts,
    seed: 9415,
    startPlayer: 1,
  });
  const cards: Record<string, CardData> = {
    ...cardData,
    TEST_CYCLE_ATTACK: {
      id: "TEST_CYCLE_ATTACK",
      name: "Test Cycle Attack",
      cardType: "action",
      text: "",
      attack: options.attackValue ?? 3,
      subtypes: ["attack"],
    },
  };
  const held = hand.map((spec, index): CardView => {
    cards[spec.id] = {
      id: spec.id,
      name: spec.id,
      cardType: "action",
      text: "",
      attack: spec.attack,
      defense: spec.defense,
      pitch: spec.pitch ?? 1,
      cost: 0,
      subtypes: ["attack"],
    };
    return {
      instanceId: 95_000 + index,
      cardId: spec.id,
      owner: 0,
      attack: spec.attack,
      defense: spec.defense,
    };
  });
  const view = projectStateFor(state, 0);
  view.turn = 3;
  view.players[0].life = options.life ?? 40;
  view.players[0].hand = held;
  view.players[0].handCount = held.length;
  view.players[0].arsenal = [];
  view.players[0].arsenalCount = 0;
  view.phase = "defend";
  view.priorityPlayer = 0;
  view.pendingDecision = {
    player: 0,
    kind: "defend",
    prompt: "Choose defenders",
    stagedCards: [],
    stagedDefense: 0,
  };
  view.chain = [{
    attackingCard: { instanceId: 95_100, cardId: "TEST_CYCLE_ATTACK", owner: 1 },
    defendingCards: [],
    attackValue: options.attackValue ?? 3,
    defenseValue: 0,
    damage: options.attackValue ?? 3,
    resolved: false,
    ...(options.goAgain ? { goAgain: true } : {}),
    ...(options.onHitText
      ? { onHitEffects: [{ sourceCardId: "TEST_CYCLE_ATTACK", text: options.onHitText }] }
      : {}),
    reactions: [],
  }];
  const input: BotPolicyInput = { seat: 0, view, legal: [], cards };
  const model = {
    offensiveCards: () => held,
    evaluateResponse: (remaining: readonly CardView[]) => responseEvaluation({
      damageThreatened: remaining.reduce(
        (total, card) => total + Math.max(0, cards[card.cardId]?.attack ?? 0),
        0,
      ),
    }),
    cardOpportunity: () => 0,
  };
  return { state, input, own: ownCards(input), held, cards, model };
}

function spectraInput(legal: readonly GameIntent[]): {
  input: BotPolicyInput;
  haze: CardView;
  tag: CardView;
  snatch: CardView;
  lava: CardView;
} {
  const state = createGame({
    decklists: [decklists.dorinthea, decklists.rhinar],
    cards: cardData,
    scripts,
    seed: 9412,
    startPlayer: 0,
  });
  const tag = { instanceId: state.nextInstanceId++, cardId: "HNT092", owner: 0 as const };
  const snatch = { instanceId: state.nextInstanceId++, cardId: "ANQ031", owner: 0 as const };
  const lava = { instanceId: state.nextInstanceId++, cardId: "SFA019", owner: 0 as const };
  const haze = { instanceId: state.nextInstanceId++, cardId: "APR024", owner: 1 as const };
  state.players[0]!.hand = [tag, snatch, lava];
  state.players[1]!.board = [haze];
  return {
    input: { seat: 0, view: projectStateFor(state, 0), legal, cards: cardData },
    haze,
    tag,
    snatch,
    lava,
  };
}

describe("shared Spectra targeting", () => {
  it("does not manufacture a Spectra attack when the hero policy passes", () => {
    const setup = spectraInput([]);
    const snatchHero: GameIntent = {
      kind: "play-card",
      instanceId: setup.snatch.instanceId,
      pitchInstanceIds: [],
    };
    setup.input.legal = [
      { ...snatchHero, targetAllyId: setup.haze.instanceId },
      snatchHero,
      { kind: "pass" },
    ];

    expect(enforceSpectraPolicy(setup.input, { kind: "pass" })).toEqual({ kind: "pass" });
  });

  it("keeps a continuing attack aimed at the hero while another attack remains", () => {
    const setup = spectraInput([]);
    const tagHero: GameIntent = {
      kind: "play-card",
      instanceId: setup.tag.instanceId,
      pitchInstanceIds: [],
    };
    const tagSpectra: GameIntent = { ...tagHero, targetAllyId: setup.haze.instanceId };
    const snatchHero: GameIntent = {
      kind: "play-card",
      instanceId: setup.snatch.instanceId,
      pitchInstanceIds: [],
    };
    const snatchSpectra: GameIntent = { ...snatchHero, targetAllyId: setup.haze.instanceId };
    setup.input.legal = [tagSpectra, tagHero, snatchSpectra, snatchHero, { kind: "pass" }];

    expect(enforceSpectraPolicy(setup.input, tagSpectra)).toEqual(tagHero);
  });

  it("keeps a go-again weapon aimed at the hero when its follow-up is not yet legal", () => {
    const setup = spectraInput([]);
    const kunai = { instanceId: 94_101, cardId: "HNT056", owner: 0 as const };
    const pitchedDemonstrate = { instanceId: 94_102, cardId: "HNT059", owner: 0 as const };
    const heldDemonstrate = { instanceId: 94_103, cardId: "HNT059", owner: 0 as const };
    setup.input.view.players[0].weapons = [kunai];
    setup.input.view.players[0].hand = [pitchedDemonstrate, heldDemonstrate];
    const kunaiHero: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: kunai.instanceId,
      pitchInstanceIds: [pitchedDemonstrate.instanceId],
      pitchRequired: 1,
    };
    const kunaiSpectra: GameIntent = { ...kunaiHero, targetAllyId: setup.haze.instanceId };
    // The second Demonstrate is not currently payable, but it is the reason
    // Cindra chose Kunai as a Draconic opener rather than a terminal attack.
    setup.input.legal = [kunaiSpectra, kunaiHero, { kind: "pass" }];

    expect(enforceSpectraPolicy(setup.input, kunaiSpectra)).toEqual(kunaiHero);
  });

  it("spends the smallest terminal attack on Spectra", () => {
    const setup = spectraInput([]);
    const snatchHero: GameIntent = {
      kind: "play-card",
      instanceId: setup.snatch.instanceId,
      pitchInstanceIds: [],
    };
    const snatchSpectra: GameIntent = { ...snatchHero, targetAllyId: setup.haze.instanceId };
    const lavaHero: GameIntent = {
      kind: "play-card",
      instanceId: setup.lava.instanceId,
      pitchInstanceIds: [],
    };
    const lavaSpectra: GameIntent = { ...lavaHero, targetAllyId: setup.haze.instanceId };
    setup.input.legal = [snatchSpectra, snatchHero, lavaSpectra, lavaHero, { kind: "pass" }];

    expect(enforceSpectraPolicy(setup.input, snatchHero)).toEqual(lavaSpectra);
  });

  it("uses the final remaining attack to clear Spectra even when it has go again", () => {
    const setup = spectraInput([]);
    setup.input.view.players[0].hand = [setup.tag];
    const tagHero: GameIntent = {
      kind: "play-card",
      instanceId: setup.tag.instanceId,
      pitchInstanceIds: [],
    };
    const tagSpectra: GameIntent = { ...tagHero, targetAllyId: setup.haze.instanceId };
    setup.input.legal = [tagSpectra, tagHero, { kind: "pass" }];

    expect(enforceSpectraPolicy(setup.input, tagHero)).toEqual(tagSpectra);
  });

  it("passes instead of playing an attack reaction on a Spectra target", () => {
    const setup = spectraInput([]);
    const reaction = { instanceId: 94_121, cardId: "WTR082", owner: 0 as const };
    setup.input.view.players[0].hand = [reaction];
    setup.input.view.phase = "reaction";
    setup.input.view.pendingDecision = {
      player: 0,
      kind: "attack-reaction",
      prompt: "Attack reactions",
    };
    setup.input.view.chain = [{
      attackingCard: setup.snatch,
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
      targetAllyName: "Haze Bending",
      targetAlly: setup.haze,
    }];
    const playReaction: GameIntent = {
      kind: "play-card",
      instanceId: reaction.instanceId,
      pitchInstanceIds: [],
    };
    setup.input.legal = [playReaction, { kind: "pass" }, { kind: "concede" }];

    expect(enforceSpectraPolicy(setup.input, playReaction)).toEqual({ kind: "pass" });
  });
});

describe("Wager reward valuation", () => {
  it("adds each prize in a multi-token wager", () => {
    expect(wagerRewardValue("Winner creates Gold, Might, Vigor"))
      .toBeGreaterThan(wagerRewardValue("Winner creates Courage"));
  });

  it("values cards and high-impact Warrior tokens above a small power token", () => {
    expect(wagerRewardValue("Winner draws a card"))
      .toBeGreaterThan(wagerRewardValue("Winner creates Might"));
    expect(wagerRewardValue("Winner creates Flurry"))
      .toBeGreaterThan(wagerRewardValue("Winner creates Courage"));
  });

  it("recognizes wagers that punish their winner", () => {
    expect(wagerRewardValue("Winner loses 1 life")).toBeLessThan(0);
    expect(wagerRewardValue("Winner discards a card")).toBeLessThan(0);
    expect(wagerRewardValue("Winner destroys a card in their own arsenal")).toBeLessThan(0);
  });
});

describe("shared equipment defense timing", () => {
  it.each([1, 3])("preserves ordinary durable equipment at high life on turn %s", (turn) => {
    const scores = equipmentDefenseScores({ turn });
    expect(scores.block).toBeLessThan(scores.noBlock);
  });

  it.each([
    ["a represented on-hit", { onHit: true }],
    ["a wager", { wagered: true }],
    ["lethal damage", { life: 2 }],
  ] as const)("uses durable equipment early to answer %s", (_label, options) => {
    const scores = equipmentDefenseScores(options);
    expect(scores.block).toBeGreaterThan(scores.noBlock);
  });

  it("starts spending two-block Battleworn and Temper equipment at 20 life", () => {
    for (const keyword of ["Battleworn", "Temper"] as const) {
      const scores = equipmentDefenseScores({ life: 20, equipmentKeywords: [keyword] });
      expect(scores.block).toBeGreaterThan(scores.noBlock);
    }
  });

  it("spends Blade Beckoner early for its full two defense against a weapon", () => {
    const scores = equipmentDefenseScores({
      equipmentName: "Blade Beckoner Helm",
      equipmentDefense: 1,
      equipmentKeywords: ["Guardwell"],
      attackType: "weapon",
    });
    expect(scores.block).toBeGreaterThan(scores.noBlock);
  });
});

describe("shared turn-cycle defense value", () => {
  function scoresAtLife(life: number) {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 9414,
      startPlayer: 1,
    });
    const blocker: CardView = {
      instanceId: state.nextInstanceId++,
      cardId: "TEST_VALUE_BLOCKER",
      owner: 0,
      defense: 3,
    };
    const cards: Record<string, CardData> = {
      ...cardData,
      TEST_VALUE_BLOCKER: {
        id: "TEST_VALUE_BLOCKER",
        name: "Test Value Blocker",
        cardType: "action",
        text: "",
        pitch: 1,
        cost: 0,
        attack: 4,
        defense: 3,
        subtypes: ["attack"],
      },
      TEST_VALUE_ATTACK: {
        id: "TEST_VALUE_ATTACK",
        name: "Test Value Attack",
        cardType: "action",
        text: "",
        attack: 4,
        subtypes: ["attack"],
      },
    };
    const view = projectStateFor(state, 0);
    view.turn = 3;
    view.players[0].life = life;
    view.players[0].hand = [blocker];
    view.players[0].handCount = 1;
    view.phase = "defend";
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: state.nextInstanceId++, cardId: "TEST_VALUE_ATTACK", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    const input: BotPolicyInput = { seat: 0, view, legal: [], cards };
    const own = ownCards(input);
    const config = {
      offensiveCards: () => [blocker],
      evaluateResponse: (held: readonly CardView[]) => responseEvaluation({
        damageThreatened: held.length * 4,
      }),
      cardOpportunity: () => 0,
    };
    return {
      block: scoreDefenseIntentWithTrace(
        { kind: "defend", instanceIds: [blocker.instanceId] }, input, own, config,
      ),
      noBlock: scoreDefenseIntentWithTrace(
        { kind: "defend", instanceIds: [] }, input, own, config,
      ),
    };
  }

  it("keeps the higher raw-value attack line above a life threshold", () => {
    const scores = scoresAtLife(20);
    expect(scores.noBlock.score).toBeGreaterThan(scores.block.score);
  });

  it("gives up one raw point to preserve low-life blocking flexibility", () => {
    const scores = scoresAtLife(5);
    expect(scores.noBlock.value.lifeThresholdRisk).toBe(4);
    expect(scores.block.value.lifeThresholdRisk).toBe(1);
    expect(scores.block.score).toBeGreaterThan(scores.noBlock.score);
  });

  it("maximizes prevention plus the attack-back value of the surviving hand", () => {
    const fixture = cycleDefenseFixture([
      { id: "HIGH_ATTACK_BLOCKER", attack: 4, defense: 3 },
      { id: "LOW_ATTACK_BLOCKER", attack: 0, defense: 2 },
    ]);
    const [highAttack, lowAttack] = fixture.held;
    const highAttackBlock = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [highAttack!.instanceId] },
      fixture.input,
      fixture.own,
      fixture.model,
    );
    const lowAttackBlock = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [lowAttack!.instanceId] },
      fixture.input,
      fixture.own,
      fixture.model,
    );

    expect(lowAttackBlock.value.damagePrevented).toBe(2);
    expect(lowAttackBlock.stopResponse.damageThreatened).toBe(4);
    expect(lowAttackBlock.score).toBeGreaterThan(highAttackBlock.score);
  });

  it.each([
    ["a represented on-hit", { onHitText: "When this hits, draw 2 cards." }],
    ["lethal damage", { attackValue: 4, life: 3 }],
  ] as const)("reverses attack retention to answer %s", (_label, options) => {
    const fixture = cycleDefenseFixture(
      [{ id: "VALUABLE_BLOCKER", attack: 4, defense: 3 }],
      options,
    );
    const blocker = fixture.held[0]!;
    const block = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [blocker.instanceId] },
      fixture.input,
      fixture.own,
      fixture.model,
    );
    const noBlock = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [] },
      fixture.input,
      fixture.own,
      fixture.model,
    );
    expect(block.score).toBeGreaterThan(noBlock.score);
  });

  it("preserves the more flexible response when another public attack is likely", () => {
    const fixture = cycleDefenseFixture([
      { id: "FLEXIBLE_ZERO_ATTACK", attack: 0, defense: 3 },
      { id: "INFLEXIBLE_THREE_ATTACK", attack: 3, defense: 1 },
    ], { attackValue: 1, goAgain: true });
    const [flexible, inflexible] = fixture.held;
    const spendFlexible = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [flexible!.instanceId] },
      fixture.input,
      fixture.own,
      fixture.model,
    );
    const preserveFlexible = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [inflexible!.instanceId] },
      fixture.input,
      fixture.own,
      fixture.model,
    );

    // Both stop branches are worth one: 3 + 1 - 3 overblock, or 0 + 1.
    expect(spendFlexible.stopResponse.damageThreatened).toBe(3);
    expect(preserveFlexible.stopResponse.damageThreatened).toBe(0);
    expect(spendFlexible.continuationDefenderIds).toEqual([]);
    expect(preserveFlexible.continuationDefenderIds).toEqual([flexible!.instanceId]);
    expect(preserveFlexible.score).toBeGreaterThan(spendFlexible.score);
  });

  it("records defenders, reaction pitch, prevention, and equipment exactly once", () => {
    const fixture = cycleDefenseFixture([
      { id: "CURRENT_DEFENDER", attack: 1, defense: 1 },
      { id: "PLANNED_REACTION", attack: 1, defense: 2 },
      { id: "REACTION_PITCH", attack: 1, defense: 3, pitch: 3 },
    ], { attackValue: 4 });
    const [defender, reaction, reactionPitch] = fixture.held;
    fixture.cards.PLANNED_REACTION = {
      ...fixture.cards.PLANNED_REACTION!,
      cardType: "defense-reaction",
      cost: 1,
      defense: 2,
    };
    const equipment: CardView = {
      instanceId: 95_050,
      cardId: "CYCLE_EQUIPMENT",
      owner: 0,
      defense: 1,
    };
    fixture.cards.CYCLE_EQUIPMENT = {
      id: "CYCLE_EQUIPMENT",
      name: "Cycle Equipment",
      cardType: "equipment",
      text: "Battleworn",
      defense: 1,
      keywords: ["Battleworn"],
      subtypes: ["head"],
    };
    fixture.input.view.players[0].equipment = { head: equipment };
    const model = {
      ...fixture.model,
      offensiveCards: () => [...fixture.held, equipment],
      evaluateResponse: (remaining: readonly CardView[]) => responseEvaluation({
        damageThreatened: remaining.length,
      }),
      equipmentUseIsFree: () => true,
    };
    const trace = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [defender!.instanceId, equipment.instanceId] },
      fixture.input,
      ownCards(fixture.input),
      model,
    );

    expect(trace.defenderIds).toEqual([defender!.instanceId, equipment.instanceId]);
    expect(trace.reactionIds).toEqual([reaction!.instanceId]);
    expect(trace.pitchIds).toEqual([reactionPitch!.instanceId]);
    expect(trace.equipmentIds).toEqual([equipment.instanceId]);
    expect(trace.consumedIds).toHaveLength(4);
    expect(new Set(trace.consumedIds)).toEqual(new Set([
      defender!.instanceId,
      equipment.instanceId,
      reaction!.instanceId,
      reactionPitch!.instanceId,
    ]));
    expect(trace.value.damagePrevented).toBe(2);
    expect(trace.stopResponse.damageThreatened).toBe(0);
  });

  it("produces the same intent and trace for identical projections with different hidden cards", () => {
    const fixture = cycleDefenseFixture([
      { id: "PROJECTION_BLOCKER", attack: 1, defense: 3 },
    ]);
    const blocker = fixture.held[0]!;
    const stateWithOtherHiddenCards = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 9_999,
      startPlayer: 1,
    });
    stateWithOtherHiddenCards.players[1]!.hand = stateWithOtherHiddenCards.players[1]!.deck
      .slice(0, stateWithOtherHiddenCards.players[1]!.hand.length);
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [blocker.instanceId] },
      { kind: "concede" },
    ];
    const firstInput = { ...fixture.input, legal, state: fixture.state };
    const secondInput = {
      ...fixture.input,
      view: structuredClone(fixture.input.view),
      legal,
      state: stateWithOtherHiddenCards,
    };
    const scorers: BotPolicyScorers = {
      defend: (intent, policyInput, own) =>
        scoreDefenseIntent(intent, policyInput, own, fixture.model),
      choose: () => 0,
      play: () => 0,
      nextTurnArsenal: () => 0,
    };
    const firstTrace = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [blocker.instanceId] },
      firstInput,
      ownCards(firstInput),
      fixture.model,
    );
    const secondTrace = scoreDefenseIntentWithTrace(
      { kind: "defend", instanceIds: [blocker.instanceId] },
      secondInput,
      ownCards(secondInput),
      fixture.model,
    );

    expect(chooseScoredIntent(firstInput, scorers)).toEqual(chooseScoredIntent(secondInput, scorers));
    expect(firstTrace).toEqual(secondTrace);
  });
});

describe("planned prevention", () => {
  it("accounts for pitching a hand card to play a defense reaction", () => {
    const state = createGame({
      decklists: [decklists.dorinthea, decklists.rhinar],
      cards: cardData,
      scripts,
      seed: 9411,
      startPlayer: 1,
    });
    const view = projectStateFor(state, 0);
    const reaction = { instanceId: 94_111, cardId: "TEST_REACTION", owner: 0 };
    const blue = { instanceId: 94_112, cardId: "TEST_BLUE", owner: 0 };
    view.players[0].hand = [reaction, blue];
    view.players[0].handCount = 2;
    view.players[0].resources = 0;
    view.phase = "defend";
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 94_113, cardId: "", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    const cards = {
      ...cardData,
      TEST_REACTION: {
        id: "TEST_REACTION",
        name: "Test Reaction",
        cardType: "defense-reaction" as const,
        text: "",
        cost: 1,
        defense: 4,
      },
      TEST_BLUE: {
        id: "TEST_BLUE",
        name: "Test Blue",
        cardType: "action" as const,
        subtypes: ["attack"],
        text: "",
        pitch: 3 as const,
        cost: 0,
        attack: 1,
        defense: 3,
      },
    };

    expect(plannedDefenseReactionPlan({ seat: 0, view, legal: [], cards }, {
      kind: "defend",
      instanceIds: [],
    })).toEqual({
      amount: 4,
      consumedIds: [reaction.instanceId, blue.instanceId],
      resourceCost: 1,
      reactionIds: [reaction.instanceId],
      pitchIds: [blue.instanceId],
      preventionIds: [],
    });
  });
});

function arsenalInput(legal: readonly GameIntent[] = []): {
  input: BotPolicyInput;
  shelter: CardView;
  cut: CardView;
  blunten: CardView;
} {
  const state = createGame({
    decklists: [decklists.dorinthea, decklists.rhinar],
    cards: cardData,
    scripts,
    seed: 9410,
    startPlayer: 0,
  });
  const shelter = { instanceId: state.nextInstanceId++, cardId: "PEN321", owner: 0 as const };
  const cut = { instanceId: state.nextInstanceId++, cardId: "PEN054", owner: 0 as const };
  const blunten = { instanceId: state.nextInstanceId++, cardId: "PEN049", owner: 0 as const };
  state.players[0]!.hand = [shelter, cut, blunten];
  return {
    input: { seat: 0, view: projectStateFor(state, 0), legal, cards: cardData },
    shelter,
    cut,
    blunten,
  };
}

describe("next-turn arsenal opportunity", () => {
  const nextTurnArsenal: BotPolicyScorers["nextTurnArsenal"] = (card) =>
    card.cardId === "PEN321" ? 100 : card.cardId === "PEN054" ? 60 : 30;

  it("charges only the margin over the best remaining arsenal card", () => {
    const { input, shelter, cut, blunten } = arsenalInput();
    expect(nextTurnArsenalOpportunityCost(input, new Set([blunten.instanceId]), nextTurnArsenal)).toBe(0);
    expect(nextTurnArsenalOpportunityCost(input, new Set([shelter.instanceId]), nextTurnArsenal)).toBe(40);
    expect(nextTurnArsenalOpportunityCost(
      input,
      new Set([shelter.instanceId, cut.instanceId]),
      nextTurnArsenal,
    )).toBe(70);
  });

  it("uses the same next-turn value when a card would be played, pitched, or blocked", () => {
    const { input, shelter, cut } = arsenalInput();
    const scorers: BotPolicyScorers = {
      defend: () => 0,
      choose: () => 0,
      play: () => 0,
      nextTurnArsenal,
    };
    const heroId = input.view.players[0].heroInstanceId;

    const played = chooseScoredIntent({
      ...input,
      legal: [
        { kind: "play-card", instanceId: shelter.instanceId, pitchInstanceIds: [] },
        { kind: "play-card", instanceId: cut.instanceId, pitchInstanceIds: [] },
      ],
    }, scorers);
    expect(played).toMatchObject({ kind: "play-card", instanceId: cut.instanceId });

    const pitched = chooseScoredIntent({
      ...input,
      legal: [
        { kind: "activate-ability", sourceInstanceId: heroId, pitchInstanceIds: [shelter.instanceId] },
        { kind: "activate-ability", sourceInstanceId: heroId, pitchInstanceIds: [cut.instanceId] },
      ],
    }, scorers);
    expect(pitched).toMatchObject({ kind: "activate-ability", pitchInstanceIds: [cut.instanceId] });

    const blocked = chooseScoredIntent({
      ...input,
      legal: [
        { kind: "defend", instanceIds: [shelter.instanceId] },
        { kind: "defend", instanceIds: [cut.instanceId] },
      ],
    }, scorers);
    expect(blocked).toEqual({ kind: "defend", instanceIds: [cut.instanceId] });
  });
});
