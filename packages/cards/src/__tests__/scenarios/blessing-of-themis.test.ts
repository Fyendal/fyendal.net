import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario, type Scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function expectBanishedFaceDown(g: Scenario, seat: number, key: string, faceDown: boolean): void {
  const card = g.state.players[seat]!.banish.find((entry) => entry.cardId === printingId(key));
  expect(card, `${key} in seat ${seat}'s banished zone`).toBeDefined();
  expect(!!card!.faceDown).toBe(faceDown);
}

describe("Blessing of Themis", () => {
  it("names a card through an enter-arena trigger and turns all matching pitches face-down in both banished zones", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "ser boltyn, breaker of dawn|0",
        hand: ["blessing of themis|2", "ghostly visit|3"],
        banish: ["ghostly visit|1", "ghostly visit|2", "head jab|1"],
        banishFaceDown: ["wounding blow|1"],
        equipment: NO_EQUIPMENT,
        resources: 1,
      },
      { hero: "dorinthea", banish: ["ghostly visit|3", "head jab|2"], equipment: NO_EQUIPMENT },
    ] });

    g.play("blessing of themis|2", { settle: false });
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    g.passPriority().passPriority();
    g.expectInZone(0, "blessing of themis|2", "board");
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(g.state.stack.some((layer) => layer.label.includes("Name a card"))).toBe(true);
    g.settle();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "choose-name", player: 0, promptMessage: { id: "card.pen.card.name" },
    });
    g.chooseName("Ghostly Visit").expectAP(0, 1);

    expect(g.state.players[0]!.board[0]!.chosenName).toBe("Ghostly Visit");
    for (const [seat, key] of [[0, "ghostly visit|1"], [0, "ghostly visit|2"], [1, "ghostly visit|3"]] as const) {
      expectBanishedFaceDown(g, seat, key, true);
    }
    expectBanishedFaceDown(g, 0, "head jab|1", false);
    expectBanishedFaceDown(g, 1, "head jab|2", false);
    expectBanishedFaceDown(g, 0, "wounding blow|1", true);
    g.expectInZone(0, "ghostly visit|3", "hand");
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "play-from-zone" && intent.zone === "banish")).toBe(false);
    const publicBanish = projectStateFor(g.state, null).players[0]!.banish;
    expect(publicBanish.filter((card) => card.hidden)).toHaveLength(3);
    expect(publicBanish.filter((card) => card.hidden).every((card) => card.cardId === "" && card.instanceId < 0)).toBe(true);
  });

  it("offers a name even with empty banished zones", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["blessing of themis|2"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of themis|2").chooseName("Ghostly Visit");
    expect(g.state.players[0]!.board[0]!.chosenName).toBe("Ghostly Visit");
  });

  it("queues matching future banishes for either hero and waits for priority before turning them face-down", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar", hand: ["blessing of themis|2", "pound of flesh|3", "ghostly visit|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", hand: ["ghostly visit|2"], equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of themis|2").chooseName("Ghostly Visit").play("pound of flesh|3");
    g.chooseCard("ghostly visit|1");
    const opponentCard = g.state.players[1]!.hand[0]!;
    g.doRaw({ kind: "choose", optionId: String(opponentCard.instanceId) });
    expectBanishedFaceDown(g, 0, "ghostly visit|1", false);
    expectBanishedFaceDown(g, 1, "ghostly visit|2", false);
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(g.state.stack.filter((layer) => layer.label === "Turn the named banished card face-down")).toHaveLength(2);
    g.settle();
    expectBanishedFaceDown(g, 0, "ghostly visit|1", true);
    expectBanishedFaceDown(g, 1, "ghostly visit|2", true);
    g.endTurn().expectLife(0, 19);
  });

  it("remembers the name on the opponent's turn and stops triggering after entering soul", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar", hand: ["blessing of themis|2"],
        deck: ["pound of flesh|3", "ghostly visit|1", "ghostly visit|3"], equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", hand: ["pound of flesh|3", "ghostly visit|2"], equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of themis|2").chooseName("Ghostly Visit").endTurn()
      .expectInZone(0, "blessing of themis|2", "board")
      .play("pound of flesh|3").chooseCard("ghostly visit|2").chooseCard("ghostly visit|1");
    expectBanishedFaceDown(g, 0, "ghostly visit|1", true);
    expectBanishedFaceDown(g, 1, "ghostly visit|2", true);
    g.endTurn().expectInZone(0, "blessing of themis|2", "soul")
      .play("pound of flesh|3").chooseCard("ghostly visit|3");
    expectBanishedFaceDown(g, 0, "ghostly visit|3", false);
  });

  it("does not trigger for a different named card banished later", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["blessing of themis|2", "pound of flesh|3", "head jab|1"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of themis|2").chooseName("Ghostly Visit")
      .play("pound of flesh|3").chooseCard("head jab|1")
      .expectNoLog("Turn the named banished card face-down");
    expectBanishedFaceDown(g, 0, "head jab|1", false);
  });

  it("resolves an already queued banish trigger after Themis leaves the arena", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["blessing of themis|2", "pound of flesh|3", "thespian charm|2", "ghostly visit|1"], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of themis|2").chooseName("Ghostly Visit").play("pound of flesh|3");
    const ghost = g.state.players[0]!.hand.find((card) => card.cardId === printingId("ghostly visit|1"))!;
    g.doRaw({ kind: "choose", optionId: String(ghost.instanceId) });
    expectBanishedFaceDown(g, 0, "ghostly visit|1", false);
    g.react("thespian charm|2").chooseOption("no").chooseCard("blessing of themis|2")
      .expectInZone(0, "blessing of themis|2", "hand");
    expectBanishedFaceDown(g, 0, "ghostly visit|1", true);
  });

  it("does not reuse an earlier visit's name before its new enter-arena trigger resolves", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar", heroKey: "kano|0", resources: 3,
        hand: ["blessing of themis|2", "thespian charm|2"], deck: ["pound of flesh|3"], equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    g.play("blessing of themis|2").chooseName("Pound of Flesh")
      .play("thespian charm|2").chooseOption("no").chooseCard("blessing of themis|2")
      .play("blessing of themis|2", { settle: false }).passPriority().passPriority()
      .activate("kano|0").chooseCard("pound of flesh|3");
    expectBanishedFaceDown(g, 0, "pound of flesh|3", false);
    g.chooseName("Ghostly Visit");
    expectBanishedFaceDown(g, 0, "pound of flesh|3", false);
    g.expectNoLog("Turn the named banished card face-down");
  });
});
