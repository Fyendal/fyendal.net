import { cardData, decklists, precon, scripts } from "@fyendal/cards";
import { createGame, projectStateFor } from "@fyendal/engine";
import type { CardView, Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseStarvoIntent } from "./starvo-policy.js";
import { starvoPresentationFor } from "./sideboard.js";

function starvoDeck(opponent: Decklist = decklists.dorinthea): Decklist {
  const pool = precon("bot-starvo-boss")!.pool;
  return { heroId: pool.heroId, ...starvoPresentationFor(opponent) };
}

function viewForTest() {
  const state = createGame({
    decklists: [starvoDeck(), decklists.dorinthea],
    cards: cardData,
    scripts,
    seed: 17_017,
    startPlayer: 0,
  });
  return projectStateFor(state, 0);
}

describe("Starvo policy", () => {
  it("accepts its optional start-of-turn hero trigger", () => {
    const view = viewForTest();
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Bravo, Star of the Show: Reveal Earth, Ice, and Lightning cards?",
      options: ["yes", "no"],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "yes" },
      { kind: "choose", optionId: "no" },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "yes" });
  });

  it("always takes an available Earth, Ice, and Lightning reveal", () => {
    const view = viewForTest();
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Reveal an Earth, an Ice, and a Lightning card",
      options: ["101:102:103", "104:102:103"],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "101:102:103" },
      { kind: "choose", optionId: "104:102:103" },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "101:102:103" });
  });

  it("uses both elements when Oaken Old can be fully fused", () => {
    const view = viewForTest();
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Fuse Oaken Old?",
      options: ["no", "earth:101", "ice:102", "both:101:102"],
    };
    const legal = view.pendingDecision.options!.map((optionId) => ({
      kind: "choose" as const,
      optionId,
    }));

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: "both:101:102" });
  });

  it("prioritizes Cadaverous Tilling while Decompose can advance toward four Earth", () => {
    const view = viewForTest();
    const tilling: CardView = { instanceId: 170_050, cardId: "ROS052", owner: 0 };
    const oaken: CardView = { instanceId: 170_051, cardId: "ELE005", owner: 0 };
    const blue: CardView = { instanceId: 170_052, cardId: "AJV020", owner: 0 };
    const pulse: CardView = { instanceId: 170_053, cardId: "ELE112", owner: 0 };
    view.players[0].hand = [tilling, oaken, blue, pulse];
    view.players[0].handCount = 4;
    view.players[0].graveyard = ["ROS046", "ROS047", "ROS097"].map((cardId, index) => ({
      instanceId: 170_060 + index,
      cardId,
      owner: 0,
    }));
    view.players[0].banish = [];
    view.phase = "action";
    view.activePlayer = 0;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const tillingPlay: GameIntent = {
      kind: "play-card",
      instanceId: tilling.instanceId,
      pitchInstanceIds: [blue.instanceId],
    };
    const oakenPlay: GameIntent = {
      kind: "play-card",
      instanceId: oaken.instanceId,
      pitchInstanceIds: [blue.instanceId],
    };
    const pulsePlay: GameIntent = {
      kind: "play-card",
      instanceId: pulse.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [oakenPlay, pulsePlay, tillingPlay, { kind: "pass" }],
      cards: cardData,
    })).toEqual(tillingPlay);
  });

  it("takes Cadaverous Tilling's earliest Decompose opportunity", () => {
    const view = viewForTest();
    const earth: CardView = { instanceId: 170_070, cardId: "ROS046", owner: 0 };
    view.priorityPlayer = 0;
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Cadaverous Tilling: decompose? Choose the first Earth card to banish",
      options: ["no", String(earth.instanceId)],
      optionCards: [null, earth],
    };
    const legal: GameIntent[] = [
      { kind: "choose", optionId: "no" },
      { kind: "choose", optionId: String(earth.instanceId) },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: String(earth.instanceId) });
  });

  it("prioritizes Felling of the Crown once four Earth cards make it 8 power", () => {
    const view = viewForTest();
    const felling: CardView = { instanceId: 170_080, cardId: "ROS031", owner: 0 };
    const oaken: CardView = { instanceId: 170_081, cardId: "ELE005", owner: 0 };
    const blue: CardView = { instanceId: 170_082, cardId: "AJV020", owner: 0 };
    const pulse: CardView = { instanceId: 170_083, cardId: "ELE112", owner: 0 };
    view.players[0].hand = [felling, oaken, blue, pulse];
    view.players[0].handCount = 4;
    view.players[0].banish = ["ROS046", "ROS047", "ROS048", "ROS052"]
      .map((cardId, index) => ({ instanceId: 170_090 + index, cardId, owner: 0 }));
    view.phase = "action";
    view.activePlayer = 0;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const fellingPlay: GameIntent = {
      kind: "play-card",
      instanceId: felling.instanceId,
      pitchInstanceIds: [blue.instanceId],
    };
    const oakenPlay: GameIntent = {
      kind: "play-card",
      instanceId: oaken.instanceId,
      pitchInstanceIds: [blue.instanceId],
    };
    const pulsePlay: GameIntent = {
      kind: "play-card",
      instanceId: pulse.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [oakenPlay, pulsePlay, fellingPlay, { kind: "pass" }],
      cards: cardData,
    })).toEqual(fellingPlay);
  });

  it.each([
    ["the opponent's turn", 1],
    ["its own turn without a follow-up attack", 0],
  ] as const)("does not play Pulse of Volthaven during %s", (_, activePlayer) => {
    const view = viewForTest();
    const pulse: CardView = { instanceId: 170_095, cardId: "ELE112", owner: 0 };
    view.players[0].hand = [pulse];
    view.players[0].handCount = 1;
    view.turn = 2;
    view.phase = "action";
    view.activePlayer = activePlayer;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const playPulse: GameIntent = {
      kind: "play-card",
      instanceId: pulse.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [playPulse, { kind: "pass" }],
      cards: cardData,
    })).toEqual({ kind: "pass" });
  });

  it("plays Pulse of Volthaven before a legal compatible attack on its own turn", () => {
    const view = viewForTest();
    const pulse: CardView = { instanceId: 170_096, cardId: "ELE112", owner: 0 };
    const oaken: CardView = { instanceId: 170_097, cardId: "ELE005", owner: 0 };
    const blue: CardView = { instanceId: 170_098, cardId: "AJV020", owner: 0 };
    view.players[0].hand = [pulse, oaken, blue];
    view.players[0].handCount = 3;
    view.turn = 2;
    view.phase = "action";
    view.activePlayer = 0;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const playPulse: GameIntent = {
      kind: "play-card",
      instanceId: pulse.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [
        playPulse,
        {
          kind: "play-card",
          instanceId: oaken.instanceId,
          pitchInstanceIds: [blue.instanceId],
        },
        { kind: "pass" },
      ],
      cards: cardData,
    })).toEqual(playPulse);
  });

  it("does not play Electromagnetic Somersault without a friendly attack to recover", () => {
    const view = viewForTest();
    const somersault: CardView = { instanceId: 170_099, cardId: "ROS087", owner: 0 };
    view.players[0].hand = [somersault];
    view.players[0].handCount = 1;
    view.turn = 3;
    view.phase = "action";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const playSomersault: GameIntent = {
      kind: "play-card",
      instanceId: somersault.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [playSomersault, { kind: "pass" }],
      cards: cardData,
    })).toEqual({ kind: "pass" });
  });

  it("uses Electromagnetic Somersault only on its own attack action cards", () => {
    const view = viewForTest();
    const ownDefender: CardView = { instanceId: 170_110, cardId: "ROS046", owner: 0 };
    const opposingAttack: CardView = { instanceId: 170_111, cardId: "WTR159", owner: 1 };
    view.phase = "reaction";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.chain = [{
      attackingCard: opposingAttack,
      defendingCards: [ownDefender],
      attackValue: 4,
      defenseValue: 3,
      damage: 1,
      resolved: false,
      reactions: [],
    }];
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose up to 2 attack actions to return when the link resolves",
      options: ["done", String(opposingAttack.instanceId), String(ownDefender.instanceId)],
      optionCards: [null, opposingAttack, ownDefender],
    };
    const legal: GameIntent[] = view.pendingDecision.options!.map((optionId) => ({
      kind: "choose",
      optionId,
    }));

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: String(ownDefender.instanceId) });

    view.pendingDecision.options = ["done", String(opposingAttack.instanceId)];
    view.pendingDecision.optionCards = [null, opposingAttack];
    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: legal.slice(0, 2),
      cards: cardData,
    })).toEqual({ kind: "choose", optionId: "done" });
  });

  it("plays Electromagnetic Somersault when it can recover its defender", () => {
    const view = viewForTest();
    const somersault: CardView = { instanceId: 170_120, cardId: "ROS087", owner: 0 };
    const ownDefender: CardView = { instanceId: 170_121, cardId: "ROS046", owner: 0 };
    view.players[0].hand = [somersault];
    view.players[0].handCount = 1;
    view.phase = "reaction";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    view.chain = [{
      attackingCard: { instanceId: 170_122, cardId: "WTR159", owner: 1 },
      defendingCards: [ownDefender],
      attackValue: 4,
      defenseValue: 3,
      damage: 1,
      resolved: false,
      reactions: [],
    }];
    const playSomersault: GameIntent = {
      kind: "play-card",
      instanceId: somersault.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [playSomersault, { kind: "pass" }],
      cards: cardData,
    })).toEqual(playSomersault);
  });

  it("sends a 7-power attack to the hero instead of an ordinary 2-life ally", () => {
    const view = viewForTest();
    const attack: CardView = { instanceId: 170_130, cardId: "ROS046", owner: 0 };
    const blue: CardView = { instanceId: 170_131, cardId: "AJV020", owner: 0 };
    const ally: CardView = {
      instanceId: 170_132,
      cardId: "SEA051",
      owner: 1,
      life: 2,
    };
    view.players[0].hand = [attack, blue];
    view.players[0].handCount = 2;
    view.players[1].board = [ally];
    view.turn = 2;
    view.phase = "action";
    view.activePlayer = 0;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const heroAttack: GameIntent = {
      kind: "play-card",
      instanceId: attack.instanceId,
      pitchInstanceIds: [blue.instanceId],
    };
    const allyAttack: GameIntent = { ...heroAttack, targetAllyId: ally.instanceId };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [allyAttack, heroAttack, { kind: "pass" }],
      cards: cardData,
    })).toEqual(heroAttack);
  });

  it.each([
    ["Chum", "SEA050"],
    ["Sawbones", "SEA264"],
  ])("allows an oversized attack to remove %s", (_, allyCardId) => {
    const view = viewForTest();
    const attack: CardView = { instanceId: 170_140, cardId: "ROS046", owner: 0 };
    const blue: CardView = { instanceId: 170_141, cardId: "AJV020", owner: 0 };
    const ally: CardView = {
      instanceId: 170_142,
      cardId: allyCardId,
      owner: 1,
      life: 2,
    };
    view.players[0].hand = [attack, blue];
    view.players[0].handCount = 2;
    view.players[1].board = [ally];
    view.turn = 2;
    view.phase = "action";
    view.activePlayer = 0;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    const heroAttack: GameIntent = {
      kind: "play-card",
      instanceId: attack.instanceId,
      pitchInstanceIds: [blue.instanceId],
    };
    const allyAttack: GameIntent = { ...heroAttack, targetAllyId: ally.instanceId };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [allyAttack, heroAttack, { kind: "pass" }],
      cards: cardData,
    })).toEqual(allyAttack);
  });

  it("spends a floating resource on Crown of Seeds while defending", () => {
    const view = viewForTest();
    const crown = view.players[0].equipment.head!;
    const arsenal: CardView = { instanceId: 170_100, cardId: "ROS052", owner: 0 };
    view.players[0].arsenal = [arsenal];
    view.players[0].arsenalCount = 1;
    view.players[0].resources = 1;
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "reaction";
    view.pendingDecision = { player: 0, kind: "priority-window", prompt: "Priority" };
    view.chain = [{
      attackingCard: { instanceId: 170_200, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 4,
      defenseValue: 0,
      damage: 4,
      resolved: false,
      reactions: [],
    }];
    const activation: GameIntent = {
      kind: "activate-ability",
      sourceInstanceId: crown.instanceId,
      pitchInstanceIds: [],
    };

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [{ kind: "pass" }, activation],
      cards: cardData,
    })).toEqual(activation);
  });

  it("reserves Stalagmite for an attack with go again", () => {
    const view = viewForTest();
    const stalagmite = view.players[0].weapons.find((card) => card.cardId === "EVR018")!;
    view.phase = "defend";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 170_300, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [stalagmite.instanceId] },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });

    view.chain[0]!.goAgain = true;
    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [stalagmite.instanceId] });
  });

  it("blocks from hand instead of spending Stalagmite when either covers the attack", () => {
    const view = viewForTest();
    const stalagmite = view.players[0].weapons.find((card) => card.cardId === "EVR018")!;
    const handCard: CardView = { instanceId: 170_325, cardId: "AJV020", owner: 0 };
    view.players[0].hand = [handCard];
    view.players[0].handCount = 1;
    view.phase = "defend";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 170_326, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 2,
      defenseValue: 0,
      damage: 2,
      resolved: false,
      reactions: [],
      goAgain: true,
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [handCard.instanceId] },
      { kind: "defend", instanceIds: [stalagmite.instanceId] },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData })).toEqual({
      kind: "defend",
      instanceIds: [handCard.instanceId],
    });
  });

  it("only defends with Fyendal's Spring Tunic against lethal damage", () => {
    const view = viewForTest();
    const tunic = view.players[0].equipment.chest!;
    expect(cardData[tunic.cardId]?.name).toBe("Fyendal's Spring Tunic");
    view.players[0].life = 2;
    view.phase = "defend";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 170_340, cardId: "WTR167", owner: 1 },
      defendingCards: [],
      attackValue: 1,
      defenseValue: 0,
      damage: 1,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [tunic.instanceId] },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "defend", instanceIds: [] });

    view.players[0].life = 1;
    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "stage-defenders", instanceIds: [tunic.instanceId] });
  });

  it.each([
    [40, "defend"],
    [20, "stage-defenders"],
  ] as const)("times its two-block Temper armor at %s life", (life, expectedKind) => {
    const view = viewForTest();
    const civicSteps = view.players[0].equipment.legs!;
    expect(cardData[civicSteps.cardId]?.name).toBe("Civic Steps");
    view.players[0].life = life;
    view.phase = "defend";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 170_350, cardId: "WTR159", owner: 1 },
      defendingCards: [],
      attackValue: 2,
      defenseValue: 0,
      damage: 2,
      resolved: false,
      reactions: [],
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "stage-defenders", instanceIds: [civicSteps.instanceId] },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData }).kind)
      .toBe(expectedKind);
  });

  it("does not spend Stalagmite to preserve an elemental turn when hand can cover", () => {
    const view = viewForTest();
    const stalagmite = view.players[0].weapons.find((card) => card.cardId === "EVR018")!;
    const [attack, earth, ice, lightning, spare] = [
      "ELE005", "ROS046", "ELE146", "ROS097", "AJV020",
    ]
      .map((cardId, index): CardView => ({
        instanceId: 170_400 + index,
        cardId,
        owner: 0,
      }));
    view.players[0].hand = [attack!, earth!, ice!, lightning!, spare!];
    view.players[0].handCount = 5;
    view.phase = "defend";
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.pendingDecision = { player: 0, kind: "defend", prompt: "Choose defenders" };
    view.chain = [{
      attackingCard: { instanceId: 170_500, cardId: "WTR123", owner: 1 },
      defendingCards: [],
      attackValue: 6,
      defenseValue: 0,
      damage: 6,
      resolved: false,
      reactions: [],
      goAgain: true,
    }];
    const legal: GameIntent[] = [
      { kind: "defend", instanceIds: [] },
      { kind: "defend", instanceIds: [ice!.instanceId, lightning!.instanceId] },
      { kind: "defend", instanceIds: [earth!.instanceId, spare!.instanceId] },
      { kind: "defend", instanceIds: [stalagmite.instanceId, spare!.instanceId] },
    ];

    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData })).toEqual({
      kind: "defend",
      instanceIds: [ice!.instanceId, lightning!.instanceId],
    });

    view.chain[0]!.attackingCard.cardId = "WTR167";
    expect(chooseStarvoIntent({ seat: 0, view, legal, cards: cardData })).toEqual({
      kind: "defend",
      instanceIds: [ice!.instanceId, lightning!.instanceId],
    });
  });
});
