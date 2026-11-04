import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { cardData, findPrinting, isImplemented, precon } from "../../index.js";
import { scenario, type SeatSpec } from "../harness.js";

const DR_MORTIMER = "dr. mortimer, blight of the pits|0";
const HUMOUR_PLUNGE = "humour plunge|0";
const MAD = "mutually assured destruction|1";
const DEMORALIZE = "demoralize the dracai|1";
const PREY = "prey on insecurity|1";
const FLIP = "flip the script|3";
const COERCION = "continued coercion|2";
const BRIBE = "bribe the guards|3";
const SICK_INTENT = "sick intent|1";
const REMEMBER = "remember the mists|3";
const PROLONGED = "prolonged illness|3";
const VIRAL_DIFFUSION = "viral diffusion|1";
const WIDESPREAD_RUIN = "widespread ruin|1";
const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const OUTBREAK = "outbreak|3";
const PAINFUL_CHOICE = "painful choice|1";
const SPIKE_SLASHER = "spike slasher|1";
const TAILORED = "tailored targeting|1";
const PHIAL = "phial of calamity|0";
const CADAVER = "cadaver handlers|0";
const WOUNDING_BLOW = "wounding blow|3";
const IRONROT_HELM = "ironrot helm|0";
const KUNAI = "kunai of retribution|0";
const KISS_OF_DEATH = "kiss of death|1";
const FRAILTY_TOKEN = "OUT235";
const INERTIA_TOKEN = "OUT236";
const EXHAUSTION = "sickening exhaustion|3";
const ROT = "sickening rot|3";
const WEAKNESS = "sickening weakness|3";
const CONCOCT = "concoct agony|2";
const PLAGUE_HIVE = "plague hive|2";

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

  it("Painful Choice gets +4 power when the defending hero declines to banish", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [PAINFUL_CHOICE, FLIP], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: [OUTBREAK], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PAINFUL_CHOICE).chooseCard(FLIP).chooseOption("power");

    expect(cardData[game.state.players[0]!.deck.at(-1)!.cardId]!.name).toBe("Flip the Script");
    expect(game.state.players[1]!.hand).toHaveLength(1);
    game.expectAttackValue(7);
  });

  it("Painful Choice stays at base power when the defending hero banishes a card", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [PAINFUL_CHOICE, FLIP], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: [OUTBREAK], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PAINFUL_CHOICE).chooseCard(FLIP).chooseCard(OUTBREAK);

    expect(game.state.players[1]!.hand).toHaveLength(0);
    expect(cardData[game.state.players[1]!.banish.at(-1)!.cardId]!.name).toBe("Outbreak");
    game.expectAttackValue(3);
  });

  it("Painful Choice gets +4 power against an empty hand", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [PAINFUL_CHOICE, FLIP], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PAINFUL_CHOICE).chooseCard(FLIP);

    game.expectAttackValue(7);
  });

  it("Painful Choice does nothing when its controller passes", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [PAINFUL_CHOICE, FLIP], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: [OUTBREAK], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(PAINFUL_CHOICE).chooseOption("pass");

    expect(game.state.players[0]!.hand).toHaveLength(1);
    expect(game.state.players[1]!.hand).toHaveLength(1);
    game.expectAttackValue(3);
  });

  it("Spike Slasher makes attack reactions cost 1 less this chain link", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [SPIKE_SLASHER, OUTBREAK], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(SPIKE_SLASHER).blockWith().react(OUTBREAK, { targetCard: SPIKE_SLASHER });

    game.expectLife(1, 14);
    expect(game.state.players[0]!.resources).toBe(0);
  });

  it("Spike Slasher reduces attack reaction costs by only 1", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [SPIKE_SLASHER, OUTBREAK], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(SPIKE_SLASHER).blockWith();

    const outbreak = game.state.players[0]!.hand.find((card) => cardData[card.cardId]?.name === "Outbreak")!;
    expect(legalIntents(game.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: outbreak.instanceId,
    }));
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

  it("Mutually Assured Destruction triggers again when the same card attacks after returning from the graveyard", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [MAD, "lunging press|3"],
        deck: [
          "head jab|1",
          "codex of frailty|2",
          "lunging press|3",
          "wounding blow|3",
          "snatch|1",
          "head jab|1",
          "snatch|1",
          "head jab|1",
          "snatch|1",
        ],
        resources: 2,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        deck: Array.from({ length: 12 }, () => "raging onslaught|1"),
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(MAD).blockWith().react("lunging press|3").endTurn();
    game.passActionPhase().settle().chooseOption("no").expectTurn(3);
    const banishedBefore = game.state.players[0]!.banish.length;

    game.play("codex of frailty|2")
      .chooseCard(MAD)
      .chooseCard("snatch|1")
      .play(MAD, { fromArsenal: true, pitch: ["wounding blow|3"] })
      .blockWith()
      .react("lunging press|3");

    expect(game.state.players[0]!.banish).toHaveLength(banishedBefore + 1);
    expect(boardNames(game, 0).filter((name) => name === "Bloodrot Pox")).toHaveLength(1);
    expect(boardNames(game, 1).filter((name) => name === "Bloodrot Pox")).toHaveLength(1);
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
      { hero: "rhinar", hand: [SICK_INTENT, PLAGUE_HIVE], weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|1", "raging onslaught|2", "raging onslaught|3"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(SICK_INTENT, { pitch: [PLAGUE_HIVE] }).settle();

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

  it("Continued Coercion gives Uzuri's replacement attack go again as it leaves the chain", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", heroKey: "uzuri|0", hand: [COERCION, REMEMBER], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(COERCION).blockWith();
    expect(game.state.chain.at(-1)!.goAgain).toBe(false);
    game.activate("uzuri|0").chooseCard(REMEMBER);

    const link = game.state.chain.at(-1)!;
    expect(cardData[link.attackingCard.cardId]!.name).toBe("Remember the Mists");
    expect(cardData[game.state.players[0]!.deck.at(-1)!.cardId]!.name).toBe("Continued Coercion");
    expect(link.goAgain).toBe(true);
  });

  it("Continued Coercion leaving at chain close grants nothing", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [COERCION], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(COERCION).blockWith().settle().expectLife(1, 18);
    while (game.state.chain.length > 0) game.passPriority();
    game.settle();

    expect(game.state.players[0]!.graveyard.map((card) => cardData[card.cardId]!.name)).toContain("Continued Coercion");
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

    game.endTurn();
    expect(game.state.pendingDecision?.warningMessage).toBeUndefined();
    game.chooseOption("yes");

    expect(game.state.players[0]!.equipment.arms?.cardId).toBe("MPA007");
    game.expectNotInZone(0, CADAVER, "graveyard");
    expect(boardNames(game, 0)).toEqual(["Silver"]);
  });

  it("Cadaver Handlers still destroys Silver but stays in the graveyard while its controller has arms equipped", () => {
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

    game.endTurn().chooseOption("yes");

    game.expectInZone(0, CADAVER, "graveyard");
    expect(boardNames(game, 0)).toEqual([]);
  });

  it("Cadaver Handlers can't equip into an arms zone holding a Frostbite, which stays in that zone", () => {
    const game = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          graveyard: [CADAVER],
          board: ["silver|0", "silver|0"],
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "dorinthea",
          heroKey: "jarl vetreiði|0",
          hand: ["colors of aria|1"],
          resources: 3,
          weapons: [],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    game.play("colors of aria|1").chooseOption("arms").blockWith().settle();
    game.endTurn();
    expect(game.state.pendingDecision?.warningMessage?.id).toBe("card.trigger.common.silver.equip.blocked");
    game.chooseOption("yes");

    game.expectInZone(0, CADAVER, "graveyard");
    const seat = game.state.players[0]!;
    expect(seat.equipment.arms).toBeUndefined();
    expect(boardNames(game, 0)).toEqual(["Frostbite"]);
    expect(seat.board[0]!.scriptState?.["frostZone:arms"]).toBe(1);
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

  it("Cadaver Handlers' -1{d} ends with the chain link, before Temper checks at chain close", () => {
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
        board: [FRAILTY_TOKEN],
        weapons: [],
        equipment: { ...NO_EQUIPMENT, arms: "ironsong versus|0" },
      },
    ] });

    game.play(KISS_OF_DEATH).blockWith("ironsong versus|0")
      .activate(CADAVER, { targetCard: KISS_OF_DEATH })
      .passPriority();

    // 3 power into Ironsong's reduced 1 defense, plus Kiss of Death's life loss on hit.
    game.expectLife(1, 17);

    game.endTurn();

    const ironsong = game.state.players[1]!.equipment.arms;
    expect(ironsong?.cardId).toBe("DTD207");
    expect(ironsong?.defCounters).toBe(1);
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

  it("Tailored Targeting announces the named card publicly and stops when the top card differs", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [TAILORED], weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        deck: ["raging onslaught|1", "raging onslaught|3", "wounding blow|3"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(TAILORED).chooseName("wounding blow").blockWith().settle();

    expect(game.state.log.map((entry) => entry.publicPayload?.message)).toContainEqual({
      id: "engine.log.player.named.card",
      values: { player: { kind: "player", seat: 0 }, name: "Wounding Blow" },
    });
    expect(game.state.players[1]!.banish).toHaveLength(1);
    expect(boardNames(game, 0)).not.toContain("Silver");
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

  it("Sickening Exhaustion puts an infected defender's arsenal on the bottom of their deck", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH, EXHAUSTION], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        arsenalFaceDown: [WOUNDING_BLOW],
        deck: ["raging onslaught|1"],
        board: [FRAILTY_TOKEN],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play(KISS_OF_DEATH).blockWith().react(EXHAUSTION);

    game.expectZoneSize(1, "arsenal", 0).expectDeckBottom(1, WOUNDING_BLOW);
  });

  it("Sickening Exhaustion leaves an uninfected defender's arsenal alone", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH, EXHAUSTION], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", arsenalFaceDown: [WOUNDING_BLOW], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith().react(EXHAUSTION);

    game.expectInZone(1, WOUNDING_BLOW, "arsenal");
  });

  it("Sickening Exhaustion sees a disease created by pitching Plague Hive to pay for it", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH, EXHAUSTION, PLAGUE_HIVE], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", arsenalFaceDown: [WOUNDING_BLOW], deck: ["raging onslaught|1"], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith().react(EXHAUSTION, { pitch: [PLAGUE_HIVE] });

    game.expectZoneSize(1, "arsenal", 0).expectDeckBottom(1, WOUNDING_BLOW);
  });

  it("A pitch trigger from paying for a defense reaction goes above it, and the defender keeps priority", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["stormwind sheath|1", PLAGUE_HIVE], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith().passPriority()
      .react("stormwind sheath|1", { pitch: [PLAGUE_HIVE], settle: false });

    expect(game.stackLabels()).toEqual(["Create a random disease token", "Stormwind Sheath"]);
    expect(game.state.priorityPlayer).toBe(1);
  });

  it("A pitch trigger from paying for an instant in a layer window goes above it, and its player keeps priority", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: ["humble entrance|3"], weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["oasis respite|1", PLAGUE_HIVE], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play("humble entrance|3").passPriority()
      .react("oasis respite|1", { pitch: [PLAGUE_HIVE], settle: false });

    expect(game.stackLabels()).toEqual(["Create a random disease token", "Oasis Respite"]);
    expect(game.state.priorityPlayer).toBe(1);
  });

  it("Sickening Rot deals 2 to an infected defender who can't pay", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH, ROT], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: [], board: [FRAILTY_TOKEN], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith().react(ROT, { settle: false }).passPriority().passPriority();

    expect(game.state.players[1]!.life).toBe(18);
  });

  it("Sickening Rot can be paid off with {r}{r}{r}", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH, ROT], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: ["raging onslaught|3"], board: [FRAILTY_TOKEN], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith().react(ROT, { settle: false }).passPriority().passPriority();
    expect(game.state.pendingDecision?.player).toBe(1);
    game.chooseOption("pay 3");

    // Only Kiss of Death's 3 damage and 1 life loss land.
    expect(game.state.players[1]!.life).toBe(16);
    game.expectInZone(1, "raging onslaught|3", "pitch");
  });

  it("Sickening Rot does nothing to an uninfected defender", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH, ROT], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", hand: [], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(KISS_OF_DEATH).blockWith().react(ROT, { settle: false }).passPriority().passPriority();

    expect(game.state.players[1]!.life).toBe(20);
  });

  it("Sickening Weakness gives cards defending against an infected hero -1 defense", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [KISS_OF_DEATH, WEAKNESS], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        hand: [WOUNDING_BLOW],
        board: [FRAILTY_TOKEN],
        weapons: [],
        equipment: { ...NO_EQUIPMENT, head: IRONROT_HELM },
      },
    ] });

    game.play(KISS_OF_DEATH).blockWith(WOUNDING_BLOW, IRONROT_HELM).react(WEAKNESS).settle();

    // 3 power into 2 defense, plus Kiss of Death's life loss on hit.
    game.expectLife(1, 18);
  });

  it("Sickening Weakness also weakens a defense reaction that defends after it resolves", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: ["raging onslaught|1", WEAKNESS], resources: 4, weapons: [], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        hand: ["unmovable|3"],
        resources: 3,
        board: [FRAILTY_TOKEN],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play("raging onslaught|1").blockWith()
      .react(WEAKNESS, { settle: false })
      .passPriority()
      .passPriority()
      .passPriority()
      .react("unmovable|3");

    // 7 power into Unmovable's 5 defense, less Sickening Weakness's 1.
    game.expectLife(1, 17);
  });

  it("Concoct Agony gets +3 and banishes the arsenal on hit after 3 attack reactions", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [CONCOCT, WEAKNESS, WEAKNESS, WEAKNESS],
        resources: 3,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", arsenalFaceDown: [WOUNDING_BLOW], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(CONCOCT).blockWith().react(WEAKNESS, { settle: false })
      .react(WEAKNESS, { settle: false })
      .react(WEAKNESS)
      .settle();

    game.expectLife(1, 15).expectInZone(1, WOUNDING_BLOW, "banish");
  });

  it("Concoct Agony stays a 2-power attack with only 2 attack reactions", () => {
    const game = scenario({ seats: [
      { hero: "rhinar", hand: [CONCOCT, WEAKNESS, WEAKNESS], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
      { hero: "dorinthea", arsenalFaceDown: [WOUNDING_BLOW], weapons: [], equipment: NO_EQUIPMENT },
    ] });

    game.play(CONCOCT).blockWith().react(WEAKNESS, { settle: false }).react(WEAKNESS).settle();

    game.expectLife(1, 18).expectInZone(1, WOUNDING_BLOW, "arsenal");
  });

  describe("Mastery Pack Assassin infection and contract attacks", () => {
    const BLOODROT = "bloodrot pox|0";
    const FEVERISH = "feverish strike|1";
    const DESPERATE = "desperate drive|1";
    const HOT_ZONE = "in the hot zone|1";
    const SLICE = "slice the sickly|1";
    const DECAPITATE = "decapitate the disloyal|1";
    const VICTIM_SEAT: SeatSpec = { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT };
    const seat = (spec: Partial<SeatSpec>): SeatSpec => ({
      hero: "rhinar",
      weapons: [],
      equipment: NO_EQUIPMENT,
      ...spec,
    });
    const silverCount = (game: ReturnType<typeof scenario>) =>
      boardNames(game, 0).filter((name) => name === "Silver").length;

    it.each([
      ["infected", [BLOODROT], 13],
      ["not infected", [], 14],
    ])("Feverish Strike when its controller is %s", (_label, board, life) => {
      const game = scenario({ seats: [
        seat({ hand: [FEVERISH], resources: 2, board }),
        VICTIM_SEAT,
      ] });

      game.play(FEVERISH).blockWith().settle();

      game.expectLife(1, life);
    });

    it("Desperate Drive has go again only while its controller is infected", () => {
      const infected = scenario({ seats: [seat({ hand: [DESPERATE], board: [BLOODROT] }), VICTIM_SEAT] });
      infected.play(DESPERATE).blockWith().settle();
      infected.expectAP(0, 1);

      const clean = scenario({ seats: [seat({ hand: [DESPERATE] }), VICTIM_SEAT] });
      clean.play(DESPERATE).blockWith().settle();
      clean.expectAP(0, 0);
    });

    it("Desperate Drive loses go again when cured before the Resolution Step", () => {
      const game = scenario({ seats: [
        seat({ hand: [DESPERATE], board: [BLOODROT] }),
        { ...VICTIM_SEAT, heroKey: DR_MORTIMER },
      ] });

      game.play(DESPERATE).blockWith().passPriority();
      game.activate(DR_MORTIMER, { ability: 0 }).chooseCard(BLOODROT).settle();

      expect(boardNames(game, 0)).not.toContain("Bloodrot Pox");
      game.expectAP(0, 0);
    });

    it("Desperate Drive gains go again when infected after it attacks", () => {
      const game = scenario({ seats: [
        seat({ hand: [DESPERATE] }),
        { ...VICTIM_SEAT, hand: [VIRAL_DIFFUSION], resources: 3 },
      ] });

      game.play(DESPERATE).blockWith().passPriority().react(VIRAL_DIFFUSION).settle();

      game.expectAP(0, 1);
    });

    it("In the Hot Zone infects its controller, which later attacks can see", () => {
      const game = scenario({ seats: [
        seat({ hand: [HOT_ZONE, FEVERISH], resources: 3 }),
        VICTIM_SEAT,
      ] });
      game.state.players[0]!.actionPoints = 2;

      game.play(HOT_ZONE);
      expect(boardNames(game, 0)).toEqual(["Bloodrot Pox"]);
      expect(boardNames(game, 1)).toEqual([]);
      game.blockWith().settle();
      game.expectLife(1, 14);

      game.play(FEVERISH).blockWith().settle();
      game.expectLife(1, 7);
    });

    it.each([
      ["infected", [BLOODROT], 1],
      ["not infected", [], 0],
    ])("Slice the Sickly banishes on hit and pays Silver when the hit hero is %s", (_label, board, silver) => {
      const game = scenario({ seats: [
        seat({ hand: [SLICE] }),
        { ...VICTIM_SEAT, board, deck: ["head jab|1", "snatch|1"] },
      ] });

      game.play(SLICE).blockWith().settle();

      game.expectLife(1, 16);
      expect(game.state.players[1]!.banish.map((card) => cardData[card.cardId]!.name)).toEqual(["Head Jab"]);
      expect(silverCount(game)).toBe(silver);
    });

    it("Slice the Sickly doesn't banish when it doesn't hit", () => {
      const game = scenario({ seats: [
        seat({ hand: [SLICE] }),
        { ...VICTIM_SEAT, hand: [WOUNDING_BLOW, WOUNDING_BLOW], deck: ["head jab|1"] },
      ] });

      game.play(SLICE).blockWith(WOUNDING_BLOW, WOUNDING_BLOW).settle();

      game.expectLife(1, 20).expectZoneSize(1, "banish", 0);
    });

    it.each([
      ["a generic card", "wounding blow|3", 1],
      ["a class card", "head jab|1", 0],
      ["a talent card with no class", "polar blast|3", 0],
    ])("Decapitate the Disloyal's contract on %s", (_label, top, silver) => {
      const game = scenario({ seats: [
        seat({ hand: [DECAPITATE], resources: 2 }),
        { ...VICTIM_SEAT, deck: [top, "snatch|1"] },
      ] });

      game.play(DECAPITATE).blockWith().settle();

      game.expectLife(1, 14);
      game.expectZoneSize(1, "banish", 1);
      expect(silverCount(game)).toBe(silver);
    });
  });

  describe("Armory Deck decklist cards", () => {
    const VICTIM = { hero: "dorinthea" as const, weapons: [] as string[], equipment: NO_EQUIPMENT };

    it("registers the full decklist as an implemented precon of 60 cards", () => {
      const deck = precon("precon-amo");
      expect(deck?.pool.deck).toHaveLength(60);
      expect(deck?.pool.weaponIds).toEqual(["AMO002", "AMO002"]);
      expect(deck?.pool.equipmentPool.map((id) => cardData[id]!.name)).toEqual([
        "Plague Mask", "Isolation Vestment", "Surgical Gloves", "Second Salvos",
      ]);
      for (const id of deck!.pool.deck) expect(isImplemented(cardData[id]!), id).toBe(true);
    });

    it("resolves deck imports to released printings over unreleased AMO reprints", () => {
      expect(findPrinting("Excessive Bloodloss", 1)?.id).toBe("PEN144");
      expect(findPrinting("Seeker Kunai", 1)?.id).toBe("PEN142");
      expect(findPrinting("Escaped Subject", 1)?.id).toBe("AMO008");
    });

    it("Plague Mask stops disease tokens under its controller only for the turn", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["seed inertia|3"], weapons: [], equipment: { ...NO_EQUIPMENT, head: "plague mask|0" } },
        { hero: "dorinthea", hand: ["seed frailty|3"], weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.activate("plague mask|0").settle();
      game.play("seed inertia|3").settle();

      game.expectInZone(0, "plague mask|0", "graveyard");
      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1)).toEqual(["Inertia"]);
      game.expectLog("can't be created");

      game.endTurn();
      game.play("seed frailty|3").settle();
      expect(boardNames(game, 0)).toEqual(["Frailty"]);
    });

    it("Isolation Vestment discounts every Assassin attack at an infected hero this turn", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: ["wound extraction|1", "wound extraction|1"],
          weapons: [],
          equipment: { ...NO_EQUIPMENT, chest: "isolation vestment|0" },
        },
        { hero: "dorinthea", board: ["frailty|0"], weapons: [], equipment: NO_EQUIPMENT },
      ] });

      game.activate("isolation vestment|0").settle().expectAP(0, 1);
      game.play("wound extraction|1").blockWith().settle();

      game.expectResources(0, 0).expectInZone(0, "isolation vestment|0", "graveyard");
    });

    it("Isolation Vestment gives no discount against an uninfected hero", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          hand: ["wound extraction|1"],
          weapons: [],
          equipment: { ...NO_EQUIPMENT, chest: "isolation vestment|0" },
        },
        VICTIM,
      ] });

      game.activate("isolation vestment|0").settle();
      game.expectNoLegalPlay("wound extraction|1");
    });

    it("Surgical Gloves cures as a cost, shrinks the attack, and leaves at the end phase", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["wounding blow|3"], resources: 1, weapons: [], board: ["frailty|0"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: { ...NO_EQUIPMENT, arms: "surgical gloves|0" } },
      ] });

      game.play("wounding blow|3").blockWith().passPriority();
      game.activate("surgical gloves|0", { targetCard: "wounding blow|3" }).chooseCard("frailty|0").settle();

      expect(boardNames(game, 0)).toEqual([]);
      game.expectLife(1, 19);
      game.expectEquipped(1, "arms", "surgical gloves|0");
      game.endTurn();
      game.expectInZone(1, "surgical gloves|0", "graveyard");
    });

    it("Surgical Gloves can't be activated without an opposing disease", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["wounding blow|3"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", board: ["frailty|0"], weapons: [], equipment: { ...NO_EQUIPMENT, arms: "surgical gloves|0" } },
      ] });

      game.play("wounding blow|3").blockWith().passPriority();
      expect(legalIntents(game.state, 1).some((intent) => intent.kind === "activate-ability")).toBe(false);
    });

    it("Second Salvos untaps its hero and comes back for 2 Silver", () => {
      const game = scenario({ seats: [
        {
          hero: "rhinar",
          heroKey: DR_MORTIMER,
          weapons: [],
          equipment: { ...NO_EQUIPMENT, legs: "second salvos|0" },
          board: ["silver|0", "silver|0"],
        },
        { ...VICTIM, board: ["frailty|0"] },
      ] });

      game.activate(DR_MORTIMER, { ability: 0 }).chooseCard("frailty|0").settle();
      expect(game.state.players[0]!.hero.tapped).toBe(true);
      game.activate("second salvos|0").settle();
      expect(game.state.players[0]!.hero.tapped).toBeFalsy();
      game.expectInZone(0, "second salvos|0", "graveyard");
      game.endTurn().endTurn().chooseOption("yes");
      game.expectEquipped(0, "legs", "second salvos|0");
    });

    it("Escaped Subject has go again only against an infected hero", () => {
      const infected = scenario({ seats: [
        { hero: "rhinar", hand: ["escaped subject|1"], weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, board: ["frailty|0"] },
      ] });
      infected.play("escaped subject|1").blockWith().settle().expectAP(0, 1);

      const clean = scenario({ seats: [
        { hero: "rhinar", hand: ["escaped subject|1"], weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      clean.play("escaped subject|1").blockWith().settle();
      clean.expectAP(0, 0);
    });

    it("Eviscerate the Enervated pays Silver only for banishing an infected hero's card", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["eviscerate the enervated|1"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, board: ["frailty|0"], deck: ["wounding blow|3"] },
      ] });
      game.play("eviscerate the enervated|1").blockWith().settle();
      game.expectZoneSize(1, "banish", 1);
      expect(boardNames(game, 0)).toEqual(["Silver"]);

      const clean = scenario({ seats: [
        { hero: "rhinar", hand: ["eviscerate the enervated|1"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, deck: ["wounding blow|3"] },
      ] });
      clean.play("eviscerate the enervated|1").blockWith().settle();
      clean.expectZoneSize(1, "banish", 1);
      expect(boardNames(clean, 0)).toEqual([]);
    });

    it("Sneaking Rot poxes the hit hero only after its controller's attack reaction", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["sneaking rot|1", "shred|3"], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, hand: ["wounding blow|3"] },
      ] });
      game.play("sneaking rot|1").blockWith("wounding blow|3");
      game.react("shred|3").chooseCard("wounding blow|3");
      game.settle();
      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);

      const quiet = scenario({ seats: [
        { hero: "rhinar", hand: ["sneaking rot|1"], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      quiet.play("sneaking rot|1").blockWith().settle();
      expect(boardNames(quiet, 1)).toEqual([]);
    });

    it("Wound Extraction offers a disease only after a dagger hit this chain", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["wound extraction|1"], resources: 3, weapons: [HUMOUR_PLUNGE], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      game.attackWithWeapon(HUMOUR_PLUNGE).blockWith().settle();
      game.play("wound extraction|1").blockWith().settle();
      game.chooseOption(INERTIA_TOKEN).settle();
      expect(boardNames(game, 1)).toEqual(["Inertia"]);

      const clean = scenario({ seats: [
        { hero: "rhinar", hand: ["wound extraction|1"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      clean.play("wound extraction|1").blockWith().settle();
      expect(boardNames(clean, 1)).toEqual([]);
    });

    it("Act on Intel only targets contract attacks and makes the hit hero banish from hand", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["eviscerate the enervated|1", "act on intel: whereabouts|1"], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, board: ["frailty|0"], hand: ["wounding blow|3"], deck: ["wounding blow|1"] },
      ] });
      game.play("eviscerate the enervated|1").blockWith();
      game.react("act on intel: whereabouts|1").settle();
      game.chooseCard("wounding blow|3").settle();
      game.expectFinalAttack(6);
      game.expectInZone(1, "wounding blow|3", "banish");
      // Two banishes against an infected hero: top of deck and the chosen card.
      expect(boardNames(game, 0)).toEqual(["Silver", "Silver"]);

      const noContract = scenario({ seats: [
        { hero: "rhinar", hand: ["escaped subject|1", "act on intel: whereabouts|1"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      noContract.play("escaped subject|1").blockWith();
      noContract.expectNoLegalPlay("act on intel: whereabouts|1");
    });

    it("Pick Your Poison leaves the opponent with the two tokens they did not choose", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["pick your poison|2"], weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      game.play("pick your poison|2", { settle: false }).passPriority().passPriority();
      game.chooseOption(FRAILTY_TOKEN).settle();
      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1).sort()).toEqual(["Bloodrot Pox", "Inertia"]);
      game.expectAP(0, 1);
    });

    it("Pick Your Poison never offers or creates Exertion", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["pick your poison|2"], weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      game.play("pick your poison|2", { settle: false }).passPriority().passPriority();

      expect(game.state.pendingDecision?.options).toEqual([FRAILTY_TOKEN, INERTIA_TOKEN, "OUT234"]);
      game.chooseOption("OUT234").settle();
      expect(boardNames(game, 1).sort()).toEqual(["Frailty", "Inertia"]);
    });

    it("treats Exertion as a disease for infection, curing, and Plague Mask", () => {
      const infected = scenario({ seats: [
        { hero: "rhinar", hand: ["escaped subject|1"], weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, board: ["exertion|0"] },
      ] });
      infected.play("escaped subject|1").blockWith().settle().expectAP(0, 1);

      const cured = scenario({ seats: [
        { hero: "rhinar", hand: ["wounding blow|3"], resources: 1, weapons: [], board: ["exertion|0"], equipment: NO_EQUIPMENT },
        { hero: "dorinthea", weapons: [], equipment: { ...NO_EQUIPMENT, arms: "surgical gloves|0" } },
      ] });
      cured.play("wounding blow|3").blockWith().passPriority();
      cured.activate("surgical gloves|0", { targetCard: "wounding blow|3" }).chooseCard("exertion|0").settle();
      expect(boardNames(cured, 0)).toEqual([]);

      const masked = scenario({ seats: [
        { hero: "rhinar", hand: ["exertion bloom|2"], resources: 0, weapons: [], equipment: { ...NO_EQUIPMENT, head: "plague mask|0" } },
        VICTIM,
      ] });
      masked.activate("plague mask|0").settle();
      masked.play("exertion bloom|2").settle();
      expect(boardNames(masked, 0)).toEqual([]);
      expect(boardNames(masked, 1)).toEqual(["Exertion"]);
    });

    it("Languid Pace infects each hero when it attacks and when it defends", () => {
      const attacking = scenario({ seats: [
        { hero: "rhinar", hand: ["languid pace|3"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      attacking.play("languid pace|3").blockWith().settle();
      expect(boardNames(attacking, 0)).toEqual(["Inertia"]);
      expect(boardNames(attacking, 1)).toEqual(["Inertia"]);

      const defending = scenario({ seats: [
        { hero: "rhinar", hand: ["wounding blow|3"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, hand: ["languid pace|3"] },
      ] });
      defending.play("wounding blow|3").blockWith("languid pace|3").settle();
      expect(boardNames(defending, 0)).toEqual(["Inertia"]);
      expect(boardNames(defending, 1)).toEqual(["Inertia"]);
    });

    it("Viral Sampling completes its contract by hitting an infected hero", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["viral sampling|3"], weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, board: ["frailty|0"] },
      ] });
      game.play("viral sampling|3").blockWith().settle();
      expect(boardNames(game, 0)).toEqual(["Silver"]);

      const clean = scenario({ seats: [
        { hero: "rhinar", hand: ["viral sampling|3"], weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      clean.play("viral sampling|3").blockWith().settle();
      expect(boardNames(clean, 0)).toEqual([]);
    });
  });
});
