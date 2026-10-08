import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { scenario } from "../harness.js";

const DR_MORTIMER = "dr. mortimer, blight of the pits|0";
const HUMOUR_PLUNGE = "humour plunge|0";
const MAD = "mutually assured destruction|1";
const PREY = "prey on insecurity|1";
const REMEMBER = "remember the mists|3";
const PROLONGED = "prolonged illness|3";
const VIRAL_DIFFUSION = "viral diffusion|1";
const WIDESPREAD_RUIN = "widespread ruin|1";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const OUTBREAK = "outbreak|1";

function boardNames(game: ReturnType<typeof scenario>, seat: number): string[] {
  return game.state.players[seat]!.board.map((card) => cardData[card.cardId]!.name);
}

describe("Armory Deck Mortimer and Mastery Pack Assassin spoilers", () => {
  it("applies the Disease Aura errata to every affected token printing", () => {
    const diseaseNames = new Set(["Bloodrot Pox", "Frailty", "Inertia"]);
    const printings = Object.values(cardData).filter((card) => diseaseNames.has(card.name));

    expect(printings.length).toBeGreaterThan(0);
    for (const printing of printings) {
      expect(printing.subtypes).toEqual(expect.arrayContaining(["disease", "aura"]));
    }
  });

  it("Humour Plunge gets +1 against an infected hero and applies piercing", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        weapons: [HUMOUR_PLUNGE],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        board: ["frailty|0"],
        weapons: [],
        equipment: { ...NO_EQUIPMENT, head: "ironrot helm|0" },
      },
    ] });

    game.attackWithWeapon(HUMOUR_PLUNGE).blockWith("ironrot helm|0").settle();

    game.expectLife(1, 18).expectAP(0, 1);
    expect(game.state.players[0]!.weapons[0]?.tapped).toBe(true);
  });

  it("Dr. Mortimer cures an opposing disease and creates Silver", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: DR_MORTIMER,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        board: ["frailty|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.activate(DR_MORTIMER, { ability: 0 }).chooseCard("frailty|0");

    expect(boardNames(game, 1)).not.toContain("Frailty");
    expect(boardNames(game, 0)).toContain("Silver");
    expect(game.state.players[0]!.hero.tapped).toBe(true);
  });

  it("Dr. Mortimer destroys 2 Silver to give an Assassin attack go again", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: DR_MORTIMER,
        hand: [MAD],
        board: ["silver|0", "silver|0"],
        resources: 2,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(MAD)
      .blockWith()
      .activate(DR_MORTIMER, { ability: 1 })
      .chooseCard("silver|0")
      .chooseCard("silver|0");

    expect(boardNames(game, 0)).not.toContain("Silver");
    expect(game.state.players[0]!.hero.tapped).toBe(true);
    expect(game.state.players[0]!.actionPoints).toBe(1);
  });

  it.each([
    ["seed bloodrot|3", "Bloodrot Pox"],
    ["seed frailty|3", "Frailty"],
    ["seed inertia|3", "Inertia"],
  ])("%s creates a disease under each hero", (seed, disease) => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [seed], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(seed);

    expect(boardNames(game, 0)).toContain(disease);
    expect(boardNames(game, 1)).toContain(disease);
  });

  it("Outbreak gives an Assassin attack +3 and all three diseases on a hero hit", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [PREY, OUTBREAK],
        resources: 3,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PREY).blockWith().react(OUTBREAK, { targetCard: PREY });

    game.expectLife(1, 14);

    expect(boardNames(game, 1)).toEqual(expect.arrayContaining([
      "Frailty", "Inertia", "Bloodrot Pox",
    ]));
    expect(boardNames(game, 0)).not.toContain("Frailty");
  });

  it("Outbreak's disease rider does not trigger when the attack is fully defended", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [PREY, OUTBREAK],
        resources: 3,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|1", "raging onslaught|2"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(PREY).blockWith("raging onslaught|1", "raging onslaught|2")
      .react(OUTBREAK, { targetCard: PREY }).settle();

    expect(boardNames(game, 1)).not.toContain("Frailty");
    expect(boardNames(game, 1)).not.toContain("Inertia");
    expect(boardNames(game, 1)).not.toContain("Bloodrot Pox");
  });

  it("Outbreak cannot target a non-Assassin attack action card", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["head jab|1", OUTBREAK],
        resources: 3,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play("head jab|1").blockWith();

    const outbreak = game.state.players[0]!.hand.find((card) => cardData[card.cardId]?.name === "Outbreak")!;
    expect(legalIntents(game.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: outbreak.instanceId,
    }));
  });

  it("Prolonged Illness copies only the first destroyed token of each disease name", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [PROLONGED],
        board: ["frailty|0", "frailty|0", "inertia|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PROLONGED).endTurn();

    expect(boardNames(game, 0).filter((name) => name === "Frailty")).toHaveLength(1);
    expect(boardNames(game, 0).filter((name) => name === "Inertia")).toHaveLength(1);
    expect(boardNames(game, 1)).not.toContain("Frailty");
  });

  it("Prolonged Illness copies a disease under the hero whose token was destroyed", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: DR_MORTIMER,
        hand: [PROLONGED],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        board: ["frailty|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(PROLONGED).activate(DR_MORTIMER, { ability: 0 }).chooseCard("frailty|0");

    expect(boardNames(game, 1)).toContain("Frailty");
    expect(boardNames(game, 0)).not.toContain("Frailty");
  });

  it("Prolonged Illness does not copy a disease already destroyed earlier this turn", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: DR_MORTIMER,
        hand: [PROLONGED],
        board: ["frailty|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        board: ["frailty|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.activate(DR_MORTIMER, { ability: 0 }).chooseCard("frailty|0")
      .play(PROLONGED).endTurn();

    expect(boardNames(game, 0)).not.toContain("Frailty");
    expect(boardNames(game, 1)).not.toContain("Frailty");
  });

  it("Prolonged Illness expires when the turn ends", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [PROLONGED], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", board: ["frailty|0"], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PROLONGED).endTurn().endTurn();

    expect(boardNames(game, 1)).not.toContain("Frailty");
  });

  it("Viral Diffusion creates all three diseases under the attacking hero", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["head jab|1"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        heroKey: DR_MORTIMER,
        hand: [VIRAL_DIFFUSION],
        resources: 3,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play("head jab|1").blockWith().passPriority().react(VIRAL_DIFFUSION);

    expect(boardNames(game, 0)).toEqual(expect.arrayContaining([
      "Frailty",
      "Inertia",
      "Bloodrot Pox",
    ]));
  });

  it("Mutually Assured Destruction triggers for each hero's first reaction and completes its contract", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [MAD, "lunging press|3"],
        deck: ["head jab|1", "snatch|1"],
        resources: 2,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["evasive leap|1"],
        deck: ["raging onslaught|1", "raging onslaught|2"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(MAD)
      .blockWith()
      .react("lunging press|3", { settle: false })
      .passPriority()
      .react("evasive leap|1", { settle: false })
      .settle();

    expect(game.state.players[0]!.banish).toHaveLength(2);
    expect(game.state.players[1]!.banish).toHaveLength(2);
    expect(boardNames(game, 0).filter((name) => name === "Bloodrot Pox")).toHaveLength(2);
    expect(boardNames(game, 1).filter((name) => name === "Bloodrot Pox")).toHaveLength(2);
    expect(boardNames(game, 0).filter((name) => name === "Silver")).toHaveLength(2);
  });

  it("Prey on Insecurity destroys itself to empower a later stealth attack", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: DR_MORTIMER,
        hand: [PREY, "infect|1", "raging onslaught|3"],
        board: ["silver|0", "silver|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PREY)
      .blockWith()
      .activate(DR_MORTIMER, { ability: 1 })
      .chooseCard("silver|0")
      .chooseCard("silver|0")
      .play("infect|1")
      .blockWith()
      .activate(PREY)
      .chooseCard("raging onslaught|3");

    game.expectLife(1, 11);
    expect(game.state.players[0]!.graveyard.map((card) => cardData[card.cardId]!.name))
      .toContain("Prey on Insecurity");
    expect(cardData[game.state.players[0]!.deck.at(-1)!.cardId]!.name).toBe("Raging Onslaught");
  });

  it("Remember the Mists banishes a card on hit and lets its owner play it", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [REMEMBER],
        resources: 2,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["head jab|1"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(REMEMBER).blockWith().settle().chooseCard("head jab|1");

    const banished = game.state.players[1]!.banish[0]!;
    expect(cardData[banished.cardId]!.name).toBe("Head Jab");
    expect(banished.playableFrom).toContain("banish");
    expect(banished.playableBySeat).toBe(1);
    expect(banished.playableFromUntilEndOfSeatTurn).toBe(1);
  });

  it("Painful Passage can give its banished attack +3 power", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["painful passage|1", WIDESPREAD_RUIN],
        board: ["runechant|0", "runechant|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play("painful passage|1")
      .chooseCard(WIDESPREAD_RUIN)
      .chooseOption("power")
      .play(WIDESPREAD_RUIN, { fromZone: "banish" })
      .expectAttackValue(9);
  });

  it("Painful Passage can give its banished attack go again", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["painful passage|1", WIDESPREAD_RUIN],
        board: ["runechant|0", "runechant|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play("painful passage|1")
      .chooseCard(WIDESPREAD_RUIN)
      .chooseOption("go-again")
      .play(WIDESPREAD_RUIN, { fromZone: "banish" })
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Painful Passage does not let a banished attack bypass Rune Gate", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["painful passage|1", WIDESPREAD_RUIN, "wounding blow|3"],
        board: ["runechant|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play("painful passage|1")
      .chooseCard(WIDESPREAD_RUIN)
      .chooseOption("power");

    const ruin = game.state.players[0]!.banish.find(
      (card) => cardData[card.cardId]!.name === "Widespread Ruin",
    )!;
    expect(ruin.playableFrom).toBeUndefined();
    expect(legalIntents(game.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "play-from-zone",
      zone: "banish",
      instanceId: ruin.instanceId,
    }));
  });
});
