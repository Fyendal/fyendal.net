import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { functionalKeyOf } from "../../functional.js";
import { cardData, isImplemented } from "../../index.js";
import { printingId, scenario } from "../harness.js";

function countOnBoard(g: ReturnType<typeof scenario>, seat: number, key: string): number {
  const wanted = functionalKeyOf(cardData[printingId(key)]!);
  return g.state.players[seat]!.board.filter(
    (card) => functionalKeyOf(cardData[card.cardId]!) === wanted,
  ).length;
}

describe("SEA — High Seas heroes and cogs", () => {
  it("registers every SEA printing as an implemented identity", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "SEA");
    expect(cards).toHaveLength(265);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
    expect(new Set(cards.map(functionalKeyOf))).toHaveLength(265);
  });

  it("Briar creates its own Embodiment when Jack hits without stealing the opposing aura", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "briar|0",
          weapons: [],
          hand: ["jack be nimble|1"],
        },
        {
          hero: "rhinar",
          board: ["embodiment of earth|0"],
          hand: [],
        },
      ],
    });

    g.play("jack be nimble|1")
      .blockWith()
      .settle()
      .expectInZone(0, "embodiment of earth|0", "board")
      .expectInZone(1, "embodiment of earth|0", "board")
      .expectLog("Briar creates Embodiment of Earth");
    expect(g.state.pendingDecision).toBeNull();
  });

  it("Jack Be Nimble returns a stolen item at the end of the action phase", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["jack be nimble|1"] },
        { hero: "dorinthea", board: ["gold|0"], hand: [] },
      ],
    });

    g.play("jack be nimble|1")
      .blockWith()
      .settle()
      .chooseCard("gold|0")
      .expectInZone(0, "gold|0", "board")
      .expectNotInZone(1, "gold|0", "board")
      .endTurn()
      .expectNotInZone(0, "gold|0", "board")
      .expectInZone(1, "gold|0", "board")
      .expectLog("Gold returns to Dorinthea");
    expect(g.state.controlReturns).toEqual([]);
  });

  it("Burn Bare can discard itself to destroy a phantasm attacking its hero", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["enigma chimera|3"] },
        { hero: "dorinthea", hand: ["burn bare|0"] },
      ],
    });

    g.play("enigma chimera|3")
      .blockWith()
      .passPriority()
      .activate("burn bare|0")
      .expectInZone(1, "burn bare|0", "graveyard")
      .expectInZone(0, "enigma chimera|3", "graveyard");
  });

  it("Burn Bare previews and deals a bound next-card arcane bonus", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["crucible of aetherweave|0"],
          hand: ["burn bare|0"],
          resources: 7,
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("crucible of aetherweave|0", { pitch: [] })
      .play("burn bare|0");
    expect(g.state.pendingDecision?.prompt).toBe("Choose a target for 7 arcane damage");
    expect(g.state.pendingDecision?.promptMessage).toEqual({
      id: "card.sea.damage.arcane.target",
      values: { amount: 7 },
    });
    expect(g.state.pendingDecision?.optionMessages).toHaveLength(
      g.state.pendingDecision?.options?.length ?? 0,
    );
    expect(g.state.pendingDecision?.optionMessages?.every(
      (message) => message?.id === "card.sea.target.card",
    )).toBe(true);
    g.chooseOption("hero:1")
      .expectLog("Burn Bare would deal 7 arcane damage to Dorinthea")
      .expectLife(1, 13);
  });

  it("Riches of Trōpal-Dhani creates Gold when pitched", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["jolly bludger|2", "riches of trōpal-dhani|2"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("jolly bludger|2", { pitch: ["riches of trōpal-dhani|2"] })
      .expectInZone(0, "gold|0", "board");
  });

  it("Tip the Barkeep gives away Gold and returns to the deck", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["tip the barkeep|3"], board: ["gold|0"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("tip the barkeep|3", { settle: false })
      .passPriority()
      .passPriority()
      .chooseCard("gold|0")
      .expectInZone(1, "gold|0", "board")
      .expectInZone(0, "tip the barkeep|3", "deck");

    const transferredGold = g.state.players[1]!.board.find(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "gold|0",
    );
    expect(transferredGold?.owner).toBe(0);
  });

  it("Puffin draws on the second crank each turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "puffin|0",
          hand: ["copper cog|3", "copper cog|3"],
          deck: ["rusty harpoon|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("copper cog|3", { settle: false })
      .passPriority()
      .passPriority();
    const copperCogId = printingId("copper cog|3");
    expect(g.state.log.find((entry) =>
      entry.publicPayload?.message.id === "engine.log.card.enters.arena"
    )?.publicPayload?.message).toMatchObject({
      values: { card: { kind: "card", cardId: copperCogId } },
    });
    expect(g.state.pendingDecision?.defaultOption).toBe("yes");
    g.chooseOption("yes");
    expect(g.state.log.find((entry) =>
      entry.publicPayload?.message.id === "engine.log.card.cranked"
    )?.publicPayload?.message).toMatchObject({
      values: { card: { kind: "card", cardId: copperCogId } },
    });
    g
      .play("copper cog|3", { settle: false })
      .passPriority()
      .passPriority();
    expect(g.state.pendingDecision?.defaultOption).toBe("yes");
    g
      .chooseOption("yes")
      .expectInZone(0, "rusty harpoon|3", "hand");
  });

  it("defaults a created Golden Cog token to Crank", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "puffin|0", board: ["gold|0"] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("puffin|0", { settle: false })
      .chooseCard("gold|0");

    expect(g.state.pendingDecision?.chooseHook).toBe("engine-crank");
    expect(g.state.pendingDecision?.defaultOption).toBe("yes");
    expect(g.state.pendingDecision?.promptMessage).toMatchObject({
      id: "engine.decision.crank",
    });
    expect(g.state.pendingDecision?.optionMessages).toEqual([
      { id: "common.option.yes" },
      { id: "common.option.no" },
    ]);
    expect(projectStateFor(g.state, 0).pendingDecision?.promptMessage).toBeDefined();
    expect(projectStateFor(g.state, 1).pendingDecision?.promptMessage).toBeUndefined();
  });

  it("Cog in the Machine offers Crank for both Golden Cogs before its tap choice", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "puffin|0",
          hand: ["cog in the machine|1", "copper cog|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("cog in the machine|1", {
      pitch: ["copper cog|3"],
      settle: false,
    }).passPriority().passPriority();

    const firstCogId = g.state.pendingDecision?.sourceInstanceId;
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-crank");
    g.chooseOption("yes");

    expect(g.state.pendingDecision?.chooseHook).toBe("engine-crank");
    expect(g.state.pendingDecision?.sourceInstanceId).not.toBe(firstCogId);
    g.chooseOption("yes");

    expect(g.state.pendingDecision?.chooseHook).toBe("cog-machine");
    g.chooseCard("golden cog|0")
      .expectInZone(0, "cog in the machine|1", "deck");
    expect(countOnBoard(g, 0, "golden cog|0")).toBe(2);
    expect(g.state.players[0]!.board.filter((card) => card.tapped).length).toBe(1);
    expect(g.state.players[0]!.actionPoints).toBe(2);
    expect(g.state.log.some((entry) =>
      entry.publicPayload?.message.id === "engine.log.card.tapped" &&
      entry.publicPayload.message.values?.card &&
      typeof entry.publicPayload.message.values.card === "object" &&
      "cardId" in entry.publicPayload.message.values.card &&
      entry.publicPayload.message.values.card.cardId === printingId("golden cog|0")
    )).toBe(true);
    expect(g.state.log.some((entry) =>
      entry.publicPayload?.message.id === "engine.log.card.put.on.deck.bottom" &&
      entry.publicPayload.message.values?.card &&
      typeof entry.publicPayload.message.values.card === "object" &&
      "cardId" in entry.publicPayload.message.values.card &&
      entry.publicPayload.message.values.card.cardId === printingId("cog in the machine|1")
    )).toBe(true);
    expect(g.state.log.some(
      (entry) => entry.publicText?.includes("skipped duplicate choice"),
    )).toBe(false);
  });

  it("Golden Skywarden repeats Galvanize after destroying a Golden Cog", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|1"] },
        {
          hero: "dorinthea",
          hand: ["golden skywarden|2"],
          board: ["golden cog|0"],
        },
      ],
    });

    g.play("raging onslaught|1")
      .blockWith("golden skywarden|2")
      .passPriority()
      .passPriority()
      .chooseCard("golden cog|0");

    expect(g.state.pendingDecision?.chooseHook).toBe("skywarden");
    g.chooseCard("gold|0")
      .settle()
      .expectFinalDefense(4)
      .expectLife(1, 17);
  });

  it("Palantir Aeronought requires an equipment defender when one is able", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["palantir aeronought|1", "raging onslaught|3"],
        },
        {
          hero: "dorinthea",
          hand: ["raging onslaught|1"],
          equipment: {
            head: "ironrot helm|0",
            chest: null,
            arms: null,
            legs: null,
          },
        },
      ],
    });

    g.play("palantir aeronought|1", { pitch: ["raging onslaught|3"] });
    const defender = g.state.pendingDecision!.player;
    const equipmentId = g.state.players[defender]!.equipment.head!.instanceId;
    const beforeStaging = legalIntents(g.state, defender);
    expect(beforeStaging.some((intent) => intent.kind === "defend")).toBe(false);
    expect(beforeStaging).toContainEqual({
      kind: "stage-defenders",
      instanceIds: [equipmentId],
    });

    g.blockWith("ironrot helm|0");
    expect(g.state.chain.at(-1)?.defendingEquipment.map((card) => card.instanceId))
      .toEqual([equipmentId]);
  });

  it("Marlynn may put an arrow drawn by Gold face-up into arsenal", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "marlynn|0",
          board: ["gold|0"],
          resources: 2,
          deck: ["rusty harpoon|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("gold|0", { settle: false })
      .passPriority()
      .passPriority()
      .chooseCard("rusty harpoon|3")
      .expectInZone(0, "rusty harpoon|3", "arsenal")
      .expectFaceDown(0, "rusty harpoon|3", false);
  });

  it("Rust Belt taps a cog as an effect cost before gaining a resource", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["golden cog|0"],
          equipment: { chest: "rust belt|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("rust belt|0", { settle: false })
      .chooseCard("golden cog|0")
      .expectResources(0, 1)
      .expectNoEquipment(0, "chest");
    expect(g.state.players[0]!.board[0]!.tapped).toBe(true);
  });

  it("Everbloom // Life can meld twice in one turn after each left half resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["everbloom // life|3", "everbloom // life|3"],
          graveyard: ["seek vengeance|1", "snatch|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("everbloom // life|3", { meldSide: "both" })
      .chooseCard("seek vengeance|1")
      .expectAP(0, 1)
      .play("everbloom // life|3", { meldSide: "both" })
      .chooseCard("snatch|1")
      .expectAP(0, 1)
      .expectLife(0, 22);
  });

  it("Life alone does not grant an action point", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["everbloom // life|3"],
          life: 18,
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("everbloom // life|3", { meldSide: "right" })
      .expectLife(0, 19)
      .expectAP(0, 1);
  });

  it("Everbloom can choose an action/instant split card from a graveyard", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["everbloom // life|3"],
          graveyard: ["arcane seeds // life|1"],
          life: 18,
        },
        { hero: "dorinthea" },
      ],
    });

    const everbloom = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("everbloom // life|3"),
    )!;
    g.play("everbloom // life|3", { meldSide: "both" });

    expect(g.state.players[0]!.graveyard.some(
      (card) => card.instanceId === everbloom.instanceId,
    )).toBe(false);
    expect(g.state.stack[0]?.card?.instanceId).toBe(everbloom.instanceId);
    expect(g.state.pendingDecision?.options).not.toContain(String(everbloom.instanceId));

    g.chooseCard("arcane seeds // life|1")
      .expectInZone(0, "arcane seeds // life|1", "deck")
      .expectInZone(0, "everbloom // life|3", "graveyard")
      .expectLife(0, 19);
  });
});

describe("SEA — pirate and generic attacks", () => {
  it("Conqueror of the High Seas gets go again only with 2 blue cards in pitch", () => {
    const dry = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["conqueror of the high seas|1", "titanium bauble|3"],
          resources: 1,
        },
        { hero: "dorinthea" },
      ],
    });

    dry.play("conqueror of the high seas|1", { pitch: ["titanium bauble|3"] })
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectAP(0, 0);

    const highTide = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["conqueror of the high seas|1", "titanium bauble|3"],
          pitch: ["murderous rabble|3"],
          resources: 1,
        },
        { hero: "dorinthea" },
      ],
    });

    highTide.play("conqueror of the high seas|1", { pitch: ["titanium bauble|3"] })
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Not So Fast replaces an opponent's Gold draw from the graveyard", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", heroKey: "scurv, stowaway|0", hand: ["not so fast|2"], deck: ["rusty harpoon|3"] },
        { hero: "dorinthea", hand: ["nimblism|3"], board: ["gold|0"], resources: 2, deck: ["nimblism|2"] },
      ],
    });

    g.play("nimblism|3", { settle: false })
      .passPriority()
      .react("not so fast|2")
      .activate("gold|0")
      .expectInZone(0, "rusty harpoon|3", "hand")
      .expectDeckTop(1, "nimblism|2");
  });

  it("Goldkiss Rum gives the next action go again and keeps a non-Pirate hero tapped", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["goldkiss rum|0"], hand: ["snatch|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("goldkiss rum|0");
    expect(g.state.players[0]!.flags.nextActionGoAgain).toBe(true);
    g.play("snatch|1", { settle: false })
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .endTurn();
    expect(g.state.players[0]!.hero.tapped).toBe(true);
  });

  it("Goldkiss Rum gives an ally attack action go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "gravy bones, shipwrecked looter|0",
          board: ["goldkiss rum|0", "riggermortis|2"],
          resources: 1,
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("goldkiss rum|0");
    expect(g.state.players[0]!.flags.nextActionGoAgain).toBe(true);
    g.activate("riggermortis|2")
      .blockWith()
      .settle()
      .expectLog("Riggermortis has Go again")
      .expectAP(0, 1);
    expect(g.state.players[0]!.flags.nextActionGoAgain).toBe(false);
  });

  it("Saltwater Swell pitches a revealed blue card when it attacks", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["saltwater swell|2", "rusty harpoon|3"], deck: ["nimblism|3"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("saltwater swell|2", { pitch: ["rusty harpoon|3"], settle: false })
      .expectInZone(0, "nimblism|3", "pitch")
      .expectResources(0, 5);
  });

  it("Gold-Baited Hook creates Gold on a Pirate hit when the defending hero controls none", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          equipment: { arms: "gold-baited hook|0" },
          hand: ["saltwater swell|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("gold-baited hook|0")
      .play("saltwater swell|3")
      .blockWith()
      .settle()
      .expectInZone(0, "gold|0", "board")
      .endTurn()
      .expectEquipped(0, "arms", "gold-baited hook|0");
  });

  it("Gold-Baited Hook steals an opposing Gold on a Pirate hit and survives the end phase", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          equipment: { arms: "gold-baited hook|0" },
          hand: ["saltwater swell|3"],
        },
        { hero: "dorinthea", board: ["gold|0"] },
      ],
    });
    const gold = g.state.players[1]!.board[0]!;

    g.activate("gold-baited hook|0")
      .play("saltwater swell|3")
      .blockWith()
      .settle();

    expect(g.state.players[0]!.board).toContainEqual(gold);
    expect(g.state.players[1]!.board).not.toContainEqual(gold);
    expect(g.state.players[0]!.flags["stolenName:gold"]).toBe(true);
    g.endTurn().expectEquipped(0, "arms", "gold-baited hook|0");
  });

  it("Gold-Baited Hook does not destroy itself on a turn when it was not activated", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", equipment: { arms: "gold-baited hook|0" } },
        { hero: "dorinthea" },
      ],
    });

    g.endTurn()
      .expectEquipped(0, "arms", "gold-baited hook|0")
      .expectNotInZone(0, "gold-baited hook|0", "graveyard");
  });

  it("Gold-Baited Hook destroys itself after activation if its controller creates or steals no Gold", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", equipment: { arms: "gold-baited hook|0" } },
        { hero: "dorinthea" },
      ],
    });

    g.activate("gold-baited hook|0")
      .endTurn()
      .expectNoEquipment(0, "arms")
      .expectInZone(0, "gold-baited hook|0", "graveyard");
  });

  it("Scooba does not trigger when another card is the declared attacker", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["scooba, salty sea dog|2"],
          graveyard: ["nimblism|2"],
          hand: ["snatch|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("snatch|1", { settle: false });

    expect(g.state.pendingDecision?.chooseHook).not.toBe("scooba-yellow");
  });

  it("Crash Down the Gates compares power and destroys the defender's deck top on hit", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["crash down the gates|1"] },
        { hero: "dorinthea", deck: ["nimblism|1", "nimblism|2"] },
      ],
    });

    g.play("crash down the gates|1", { settle: false })
      .expectAttackValue(8)
      .blockWith()
      .settle()
      .expectInZone(1, "nimblism|1", "graveyard")
      .expectDeckTop(1, "nimblism|2");
  });
});

describe("SEA — rules regression coverage", () => {
  it("Treasure Island starts and functions without a High Seas hero", () => {
    const g = scenario({
      globals: ["treasure island|0"],
      seats: [
        { hero: "rhinar", hand: ["expedition to azuro keys|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("expedition to azuro keys|1", { settle: false })
      .chooseOption("yes")
      .blockWith()
      .settle();
    expect(countOnBoard(g, 0, "gold|0")).toBe(2);
  });
});
