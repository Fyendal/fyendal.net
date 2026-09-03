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
    view.players[0].hand = [tilling, oaken, blue];
    view.players[0].handCount = 3;
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

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [oakenPlay, tillingPlay, { kind: "pass" }],
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
    view.players[0].hand = [felling, oaken, blue];
    view.players[0].handCount = 3;
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

    expect(chooseStarvoIntent({
      seat: 0,
      view,
      legal: [oakenPlay, fellingPlay, { kind: "pass" }],
      cards: cardData,
    })).toEqual(fellingPlay);
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
