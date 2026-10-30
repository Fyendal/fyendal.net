import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { scenario } from "../harness.js";

const DR_MORTIMER = "dr. mortimer, blight of the pits|0";
const HUMOUR_PLUNGE = "humour plunge|0";
const MAD = "mutually assured destruction|1";
const DEMORALIZE = "demoralize the dracai|1";
const PREY = "prey on insecurity|1";
const FLIP = "flip the script|3";
const BRIBE = "bribe the guards|3";
const SICK_INTENT = "sick intent|1";
const REMEMBER = "remember the mists|3";
const PROLONGED = "prolonged illness|3";
const VIRAL_DIFFUSION = "viral diffusion|1";
const WIDESPREAD_RUIN = "widespread ruin|1";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const OUTBREAK = "outbreak|3";
const TAILORED = "tailored targeting|1";
const PHIAL = "phial of calamity|0";
const CADAVER = "cadaver handlers|0";
const WOUNDING_BLOW = "wounding blow|3";
const IRONROT_HELM = "ironrot helm|0";
const KUNAI = "kunai of retribution|0";
const KISS_OF_DEATH = "kiss of death|1";
const FRAILTY_TOKEN = "OUT235";
const INERTIA_TOKEN = "OUT236";

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

  it("Demoralize the Dracai banishes after friendly attack action hits and completes its contract on red cards", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [DEMORALIZE, "wounding blow|3"],
        resources: 3,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        deck: ["raging onslaught|1", "raging onslaught|3", "raging onslaught|2"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });
    game.state.players[0]!.actionPoints = 2;

    game.play(DEMORALIZE).blockWith().settle();
    game.play("wounding blow|3").blockWith().settle();

    const banished = game.state.players[1]!.banish.map((card) => card.cardId);
    expect(banished).toHaveLength(2);
    expect(banished.map((cardId) => cardData[cardId]!.pitch)).toEqual([1, 3]);
    expect(boardNames(game, 0).filter((name) => name === "Silver")).toHaveLength(1);
    game.expectLife(1, 20 - 5 - 2);
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

  it("Sick Intent creates the chosen disease on hit and completes its contract", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [SICK_INTENT], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(SICK_INTENT).blockWith().settle().chooseOption(FRAILTY_TOKEN).settle();

    game.expectLife(1, 14);
    expect(boardNames(game, 1)).toEqual(["Frailty"]);
    expect(boardNames(game, 0)).toEqual(["Silver"]);
  });

  it("Sick Intent completes its contract for each disease another effect creates under an opponent", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [SICK_INTENT, OUTBREAK], resources: 5, weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|1", "raging onslaught|2", "raging onslaught|3"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(SICK_INTENT).blockWith("raging onslaught|1", "raging onslaught|2")
      .react(OUTBREAK, { targetCard: SICK_INTENT }).settle()
      .chooseOption(INERTIA_TOKEN).settle();

    expect(boardNames(game, 1).sort()).toEqual(["Bloodrot Pox", "Frailty", "Inertia", "Inertia"]);
    expect(boardNames(game, 0)).toEqual(["Silver", "Silver", "Silver", "Silver"]);
  });

  it("Sick Intent's contract ignores a Plague Hive pitched to play it", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [SICK_INTENT, "plague hive|2"], weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|1", "raging onslaught|2", "raging onslaught|3"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(SICK_INTENT, { pitch: ["plague hive|2"] }).settle();

    expect(game.state.players[1]!.board).toHaveLength(1);
    expect(boardNames(game, 0)).toEqual([]);
  });

  it("Sick Intent creates no disease or Silver when fully defended", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [SICK_INTENT],
        resources: 2,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|1", "raging onslaught|2", "raging onslaught|3"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(SICK_INTENT).blockWith("raging onslaught|1", "raging onslaught|2", "raging onslaught|3").settle();

    expect(boardNames(game, 1)).toEqual([]);
    expect(boardNames(game, 0)).toEqual([]);
  });

  it("Bribe the Guards destroys a Silver to give a card defending it -1 defense", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [BRIBE],
        board: ["silver|0", "silver|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: { ...NO_EQUIPMENT, head: IRONROT_HELM } },
    ] });

    game.play(BRIBE).blockWith(IRONROT_HELM)
      .activate(BRIBE, { targetCard: IRONROT_HELM })
      .chooseCard("silver|0")
      .settle();

    game.expectLife(1, 19);
    expect(boardNames(game, 0)).toEqual(["Silver"]);
  });

  it("Bribe the Guards can't be activated without Silver or a defending card", () => {
    const withoutSilver = scenario({ seats: [
      { hero: "rhinar", hand: [BRIBE], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: { ...NO_EQUIPMENT, head: IRONROT_HELM } },
    ] });
    withoutSilver.play(BRIBE).blockWith(IRONROT_HELM);
    expect(() => withoutSilver.activate(BRIBE, { targetCard: IRONROT_HELM })).toThrow(/no legal intent/);

    const undefended = scenario({ seats: [
      { hero: "rhinar", hand: [BRIBE], board: ["silver|0"], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });
    undefended.play(BRIBE).blockWith();
    expect(() => undefended.activate(BRIBE)).toThrow(/no legal intent/);
  });

  it("Flip the Script gives Uzuri's replacement attack +1 power as it leaves the chain", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", heroKey: "uzuri|0", hand: [FLIP, REMEMBER], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(FLIP).blockWith().activate("uzuri|0").chooseCard(REMEMBER);

    const link = game.state.chain.at(-1)!;
    expect(cardData[link.attackingCard.cardId]!.name).toBe("Remember the Mists");
    expect(cardData[game.state.players[0]!.deck.at(-1)!.cardId]!.name).toBe("Flip the Script");
    expect(link.damage).toBe(4 + 2 + 1);
  });

  it("Flip the Script leaving at chain close empowers nothing", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [FLIP], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(FLIP).blockWith().settle().expectLife(1, 19);
    while (game.state.chain.length > 0) game.passPriority();
    game.settle();

    expect(game.state.players[0]!.graveyard.map((card) => cardData[card.cardId]!.name)).toContain("Flip the Script");
    expect(game.state.modifiers.filter((modifier) => modifier.attack)).toHaveLength(0);
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

  it("Cadaver Handlers destroys 2 Silver at the start of its controller's turn to equip from graveyard", () => {
    const game = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          graveyard: [CADAVER],
          board: ["silver|0", "silver|0", "silver|0"],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    game.endTurn().chooseOption("yes");

    expect(game.state.players[0]!.equipment.arms?.cardId).toBe("MPA007");
    game.expectNotInZone(0, CADAVER, "graveyard");
    expect(boardNames(game, 0)).toEqual(["Silver"]);
  });

  it("Cadaver Handlers stays in the graveyard while its controller has arms equipped", () => {
    const game = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          graveyard: [CADAVER],
          board: ["silver|0", "silver|0"],
          weapons: [],
          equipment: { ...NO_EQUIPMENT, arms: CADAVER },
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    game.endTurn();

    game.expectInZone(0, CADAVER, "graveyard");
    expect(boardNames(game, 0)).toEqual(["Silver", "Silver"]);
  });

  it("Cadaver Handlers gives every card defending an Assassin attack -1 defense against an infected hero", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [KISS_OF_DEATH],
        resources: 1,
        equipment: { ...NO_EQUIPMENT, arms: CADAVER },
      },
      {
        hero: "dorinthea",
        life: 20,
        hand: [WOUNDING_BLOW],
        board: [FRAILTY_TOKEN],
        weapons: [],
        equipment: { ...NO_EQUIPMENT, head: IRONROT_HELM },
      },
    ] });

    game.play(KISS_OF_DEATH).blockWith(WOUNDING_BLOW, IRONROT_HELM)
      .activate(CADAVER, { targetCard: KISS_OF_DEATH })
      .expectInZone(0, CADAVER, "graveyard")
      .passPriority();

    // 3 power into 2 defense, plus Kiss of Death's life loss on hit.
    game.expectLife(1, 18);
  });

  it("Cadaver Handlers can't be activated unless the defending hero is infected", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [KISS_OF_DEATH],
        resources: 1,
        equipment: { ...NO_EQUIPMENT, arms: CADAVER },
      },
      { hero: "dorinthea", hand: [WOUNDING_BLOW], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith(WOUNDING_BLOW);

    expect(() => game.activate(CADAVER, { targetCard: KISS_OF_DEATH })).toThrow(/no legal intent/);
  });

  it("Cadaver Handlers can't target a non-Assassin attack", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["wounding blow|1"],
        resources: 0,
        equipment: { ...NO_EQUIPMENT, arms: CADAVER },
      },
      { hero: "dorinthea", hand: [WOUNDING_BLOW], board: [FRAILTY_TOKEN], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play("wounding blow|1").blockWith(WOUNDING_BLOW);

    expect(() => game.activate(CADAVER, { targetCard: "wounding blow|1" })).toThrow(/no legal intent/);
  });

  it("Phial of Calamity destroys 2 Silver at the start of its controller's turn to equip from graveyard", () => {
    const game = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          graveyard: [PHIAL],
          board: ["silver|0", "silver|0", "silver|0"],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    game.endTurn().chooseOption("yes");

    game.expectInZone(0, PHIAL, "weapons").expectNotInZone(0, PHIAL, "graveyard");
    expect(boardNames(game, 0)).toEqual(["Silver"]);
  });

  it("Phial of Calamity stays in the graveyard without 2 Silver or a free weapon zone", () => {
    const game = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          graveyard: [PHIAL],
          board: ["silver|0", "silver|0"],
          weapons: [KUNAI, KUNAI],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
      ],
    });

    game.endTurn();

    game.expectInZone(0, PHIAL, "graveyard");
    expect(boardNames(game, 0)).toEqual(["Silver", "Silver"]);
  });

  it("Phial of Calamity gives a dagger attack a chosen disease on hit", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        weapons: [KUNAI, PHIAL],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.attackWithWeapon(KUNAI).blockWith()
      .activate(PHIAL, { targetCard: KUNAI })
      .expectInZone(0, PHIAL, "graveyard")
      .chooseOption(INERTIA_TOKEN);

    expect(boardNames(game, 1)).toEqual(["Inertia"]);
    expect(boardNames(game, 0)).toEqual([]);
  });

  it("Phial of Calamity can target a dagger attack action card", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        weapons: [PHIAL],
        hand: [KISS_OF_DEATH],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith()
      .activate(PHIAL, { targetCard: KISS_OF_DEATH })
      .chooseOption(INERTIA_TOKEN);

    game.expectLife(1, 16);
    expect(boardNames(game, 1)).toEqual(["Inertia"]);
  });

  it("Phial of Calamity's granted ability fires when the dagger is thrown", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        weapons: [KUNAI, PHIAL],
        hand: [PREY, "throw dagger|3"],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PREY).blockWith()
      .activate(PHIAL, { targetCard: KUNAI, settle: false })
      // Resolve the Phial before throwing, without closing the reaction step.
      .passPriority()
      .passPriority()
      .react("throw dagger|3")
      .chooseOption(FRAILTY_TOKEN);

    game.expectInZone(0, KUNAI, "graveyard");
    expect(boardNames(game, 1)).toEqual(["Frailty"]);
    expect(boardNames(game, 0)).toEqual([]);
  });

  it("Tailored Targeting banishes until a non-named card and completes its contract per named card", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [TAILORED], weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        deck: ["raging onslaught|1", "raging onslaught|3", "wounding blow|3", "raging onslaught|2"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(TAILORED).chooseName("Raging Onslaught").blockWith().settle();

    game.expectLife(1, 16);
    expect(game.state.players[1]!.banish.map((card) => card.cardId).map((id) => cardData[id]!.name)).toEqual([
      "Raging Onslaught", "Raging Onslaught", "Wounding Blow",
    ]);
    expect(game.state.players[1]!.deck).toHaveLength(1);
    expect(boardNames(game, 0).filter((name) => name === "Silver")).toHaveLength(2);
  });

  it("Tailored Targeting banishes nothing when its attack does not hit", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [TAILORED], weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        hand: ["wounding blow|3", "wounding blow|3"],
        deck: ["raging onslaught|1"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(TAILORED).chooseName("Raging Onslaught").blockWith("wounding blow|3", "wounding blow|3").settle();

    expect(game.state.players[1]!.banish).toHaveLength(0);
    expect(boardNames(game, 0)).not.toContain("Silver");
  });

  it("Tailored Targeting banishes when Flick Knives hits even if the attack is fully defended", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [TAILORED],
        weapons: [KUNAI],
        equipment: { ...NO_EQUIPMENT, arms: "flick knives|0" },
      },
      {
        hero: "dorinthea",
        hand: ["wounding blow|3", "wounding blow|3"],
        deck: ["raging onslaught|1", "wounding blow|3", "raging onslaught|2"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });
    const kunaiId = game.state.players[0]!.weapons[0]!.instanceId;

    game.play(TAILORED).chooseName("Raging Onslaught").blockWith("wounding blow|3", "wounding blow|3")
      .activate("flick knives|0")
      .doRaw({ kind: "choose", optionId: String(kunaiId) })
      .settle();

    game.expectLife(1, 19);
    expect(game.state.players[1]!.banish.map((card) => cardData[card.cardId]!.name)).toEqual([
      "Raging Onslaught", "Wounding Blow",
    ]);
    expect(boardNames(game, 0).filter((name) => name === "Silver")).toHaveLength(1);
  });

  it("Tailored Targeting banishes once per hit when Flick Knives and the attack both hit", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [TAILORED],
        weapons: [KUNAI],
        equipment: { ...NO_EQUIPMENT, arms: "flick knives|0" },
      },
      {
        hero: "dorinthea",
        deck: ["wounding blow|3", "wounding blow|3", "raging onslaught|2"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });
    const kunaiId = game.state.players[0]!.weapons[0]!.instanceId;

    game.play(TAILORED).chooseName("Raging Onslaught").blockWith()
      .activate("flick knives|0")
      .doRaw({ kind: "choose", optionId: String(kunaiId) })
      .settle();

    game.expectLife(1, 15);
    expect(game.state.players[1]!.banish.map((card) => cardData[card.cardId]!.name)).toEqual([
      "Wounding Blow", "Wounding Blow",
    ]);
  });
});

