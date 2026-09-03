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
});
