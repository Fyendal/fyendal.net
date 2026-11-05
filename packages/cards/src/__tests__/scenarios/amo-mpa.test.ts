import { describe, expect, it } from "vitest";
import { legalIntents, type ScriptCtx } from "@fyendal/engine";
import { cardData, findPrinting, isImplemented, precon } from "../../index.js";
import { heroHasMoniker } from "../../scripts/shared-helpers.js";
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

const assassinSeat = (spec: Partial<SeatSpec>): SeatSpec => ({
  hero: "rhinar",
  weapons: [],
  equipment: NO_EQUIPMENT,
  ...spec,
});

function silverCount(game: ReturnType<typeof scenario>): number {
  return boardNames(game, 0).filter((name) => name === "Silver").length;
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

  it("Cadaver Handlers also weakens a defense reaction played after it resolves", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["sick intent|1"],
        resources: 2,
        weapons: [],
        equipment: { ...NO_EQUIPMENT, arms: CADAVER },
      },
      {
        hero: "dorinthea",
        hand: ["unmovable|3"],
        resources: 3,
        board: [FRAILTY_TOKEN],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play("sick intent|1").blockWith().activate(CADAVER, { targetCard: "sick intent|1", settle: false });
    game.passPriority().passPriority().passPriority().react("unmovable|3");

    // 6 power into Unmovable's 5 defense, less Cadaver Handlers' 1.
    game.expectLife(1, 18);
  });

  it("Cadaver Handlers doesn't weaken defenders until it is activated", () => {
    const game = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["sick intent|1"],
        resources: 2,
        weapons: [],
        equipment: { ...NO_EQUIPMENT, arms: CADAVER },
      },
      {
        hero: "dorinthea",
        hand: [WOUNDING_BLOW],
        board: [FRAILTY_TOKEN],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
    ] });

    game.play("sick intent|1").blockWith(WOUNDING_BLOW).settle();

    // 6 power into Wounding Blow's unmodified 3 defense.
    game.expectLife(1, 17);
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

    it.each([
      ["infected", [BLOODROT], 13],
      ["not infected", [], 14],
    ])("Feverish Strike when its controller is %s", (_label, board, life) => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH], resources: 2, board }),
        VICTIM_SEAT,
      ] });

      game.play(FEVERISH).blockWith().settle();

      game.expectLife(1, life);
    });

    it("Desperate Drive has go again only while its controller is infected", () => {
      const infected = scenario({ seats: [assassinSeat({ hand: [DESPERATE], board: [BLOODROT] }), VICTIM_SEAT] });
      infected.play(DESPERATE).blockWith().settle();
      infected.expectAP(0, 1);

      const clean = scenario({ seats: [assassinSeat({ hand: [DESPERATE] }), VICTIM_SEAT] });
      clean.play(DESPERATE).blockWith().settle();
      clean.expectAP(0, 0);
    });

    it("Desperate Drive loses go again when cured before the Resolution Step", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [DESPERATE], board: [BLOODROT] }),
        { ...VICTIM_SEAT, heroKey: DR_MORTIMER },
      ] });

      game.play(DESPERATE).blockWith().passPriority();
      game.activate(DR_MORTIMER, { ability: 0 }).chooseCard(BLOODROT).settle();

      expect(boardNames(game, 0)).not.toContain("Bloodrot Pox");
      game.expectAP(0, 0);
    });

    it("Desperate Drive gains go again when infected after it attacks", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [DESPERATE] }),
        { ...VICTIM_SEAT, hand: [VIRAL_DIFFUSION], resources: 3 },
      ] });

      game.play(DESPERATE).blockWith().passPriority().react(VIRAL_DIFFUSION).settle();

      game.expectAP(0, 1);
    });

    it("In the Hot Zone infects its controller, which later attacks can see", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [HOT_ZONE, FEVERISH], resources: 3 }),
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
        assassinSeat({ hand: [SLICE] }),
        { ...VICTIM_SEAT, board, deck: ["head jab|1", "snatch|1"] },
      ] });

      game.play(SLICE).blockWith().settle();

      game.expectLife(1, 16);
      expect(game.state.players[1]!.banish.map((card) => cardData[card.cardId]!.name)).toEqual(["Head Jab"]);
      expect(silverCount(game)).toBe(silver);
    });

    it("Slice the Sickly doesn't banish when it doesn't hit", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [SLICE] }),
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
        assassinSeat({ hand: [DECAPITATE], resources: 2 }),
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

    it("Act on Intel: Haunts targets contract attacks and banishes the top of the hit hero's deck", () => {
      const game = scenario({ seats: [
        { hero: "rhinar", hand: ["eviscerate the enervated|1", "act on intel: haunts|3"], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
        { ...VICTIM, board: ["frailty|0"], deck: ["wounding blow|1", "wounding blow|2"] },
      ] });
      game.play("eviscerate the enervated|1").blockWith();
      game.react("act on intel: haunts|3").settle();
      game.expectFinalAttack(6);
      game.expectInZone(1, "wounding blow|1", "banish");
      game.expectInZone(1, "wounding blow|2", "banish");
      // Two banishes against an infected hero: Eviscerate's and Haunts'.
      expect(boardNames(game, 0)).toEqual(["Silver", "Silver"]);

      const noContract = scenario({ seats: [
        { hero: "rhinar", hand: ["escaped subject|1", "act on intel: haunts|3"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      noContract.play("escaped subject|1").blockWith();
      noContract.expectNoLegalPlay("act on intel: haunts|3");
    });

    it("Just My Type banishes the attacker's named top card for a Silver and leaves a miss on top", () => {
      const defend = (named: string) => {
        const game = scenario({ seats: [
          { hero: "rhinar", hand: ["escaped subject|1"], deck: ["wounding blow|1"], resources: 1, weapons: [], equipment: NO_EQUIPMENT },
          { ...VICTIM, hand: ["just my type|1"] },
        ] });
        game.play("escaped subject|1").blockWith().passPriority();
        game.react("just my type|1").chooseName(named);
        return game;
      };

      const hit = defend("Wounding Blow");
      hit.expectInZone(0, "wounding blow|1", "banish");
      expect(boardNames(hit, 1)).toEqual(["Silver"]);

      const miss = defend("Escaped Subject");
      miss.expectDeckTop(0, "wounding blow|1");
      expect(boardNames(miss, 1)).toEqual([]);
    });

    it("Banger! gets +6 once defended, including by equipment, and discards for a Silver", () => {
      const attack = (defender: SeatSpec, ...blockers: string[]) => {
        const game = scenario({ seats: [
          { hero: "rhinar", hand: ["banger!|3"], resources: 2, weapons: [], equipment: NO_EQUIPMENT },
          defender,
        ] });
        game.play("banger!|3").blockWith(...blockers).settle();
        return game;
      };

      attack(VICTIM).expectFinalAttack(1);
      attack({ ...VICTIM, hand: ["wounding blow|3"] }, "wounding blow|3").expectFinalAttack(7);
      attack({ ...VICTIM, equipment: { ...NO_EQUIPMENT, head: "ironrot helm|0" } }, "ironrot helm|0").expectFinalAttack(7);

      const discard = scenario({ seats: [
        { hero: "rhinar", hand: ["banger!|3"], weapons: [], equipment: NO_EQUIPMENT },
        VICTIM,
      ] });
      discard.activate("banger!|3");
      discard.expectInZone(0, "banger!|3", "graveyard");
      expect(boardNames(discard, 0)).toEqual(["Silver"]);
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

  describe("Mastery Pack Assassin batch 2", () => {
    const SPIDERS_CUT = "the spider's cut|1";
    const EXPENSE = "expense not spared|2";
    const FESTERING = "festering rot|2";
    const PINPOINT = "pinpoint elimination|3";
    const MASK = "mask of one million eyes|0";
    const FEVERISH = "feverish strike|1";
    const SILVER = "silver|0";
    const VICTIM: SeatSpec = { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT };
    const publicLog = (game: ReturnType<typeof scenario>) =>
      game.state.log.map((entry) => entry.publicText ?? "").join("\n");

    it("The Spider's Cut is not legal without a Silver", () => {
      const game = scenario({ seats: [assassinSeat({ hand: [SPIDERS_CUT], resources: 1 }), VICTIM] });

      expect(() => game.play(SPIDERS_CUT)).toThrow(/no legal intent/);
      game.expectInZone(0, SPIDERS_CUT, "hand").expectResources(0, 1);
    });

    it("The Spider's Cut destroys exactly 1 Silver and creates 2 on hit", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [SPIDERS_CUT], resources: 1, board: [SILVER, SILVER] }),
        VICTIM,
      ] });

      game.play(SPIDERS_CUT);
      expect(silverCount(game)).toBe(1);

      game.blockWith().settle();
      game.expectLife(1, 14);
      expect(silverCount(game)).toBe(3);
    });

    it("The Spider's Cut does not create Silver when it is fully defended", () => {
      const BLUE_CUT = "the spider's cut|3";
      const game = scenario({ seats: [
        assassinSeat({ hand: [BLUE_CUT], resources: 1, board: [SILVER] }),
        { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW] },
      ] });

      game.play(BLUE_CUT).blockWith(WOUNDING_BLOW, WOUNDING_BLOW).settle();

      game.expectLife(1, 20);
      expect(silverCount(game)).toBe(0);
    });

    it("The Spider's Cut's Silver pays for the next copy, not the one that created it", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [SPIDERS_CUT, SPIDERS_CUT, FESTERING], resources: 3, board: ["EVR195"] }),
        VICTIM,
      ] });

      game.play(SPIDERS_CUT);
      expect(silverCount(game)).toBe(0);
      game.blockWith().react(FESTERING, { targetCard: SPIDERS_CUT }).settle();
      expect(silverCount(game)).toBe(2);

      game.play(SPIDERS_CUT);
      expect(silverCount(game)).toBe(1);
    });

    it("Expense Not Spared is not legal with 1 Silver", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH, EXPENSE], resources: 2, board: [SILVER] }),
        VICTIM,
      ] });

      game.play(FEVERISH).blockWith();

      expect(() => game.react(EXPENSE, { targetCard: FEVERISH })).toThrow();
      game.expectInZone(0, EXPENSE, "hand");
      expect(silverCount(game)).toBe(1);
    });

    it("Expense Not Spared has no legal target on a non-Assassin attack and keeps the Silver", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [WOUNDING_BLOW, EXPENSE], resources: 2, board: [SILVER, SILVER] }),
        VICTIM,
      ] });

      game.play(WOUNDING_BLOW).blockWith();

      expect(() => game.react(EXPENSE, { targetCard: WOUNDING_BLOW })).toThrow();
      expect(() => game.react(EXPENSE)).toThrow();
      expect(silverCount(game)).toBe(2);
    });

    it("Expense Not Spared destroys 2 Silver of any printing for +5", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH, EXPENSE], resources: 2, board: ["DYN245", "EVR195", SILVER] }),
        VICTIM,
      ] });

      game.play(FEVERISH).blockWith().react(EXPENSE, { targetCard: FEVERISH, settle: false });
      expect(silverCount(game)).toBe(1);

      game.settle();
      game.expectLife(1, 9);
    });

    it("Festering Rot grants go again and a Bloodrot Pox under the hit hero's control", () => {
      const game = scenario({ seats: [assassinSeat({ hand: [FEVERISH, FESTERING], resources: 3 }), VICTIM] });

      game.play(FEVERISH).blockWith().react(FESTERING, { targetCard: FEVERISH }).settle();

      game.expectAP(0, 1);
      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);
      expect(boardNames(game, 0)).toEqual([]);
    });

    it("Festering Rot cannot target a non-Assassin attack", () => {
      const game = scenario({ seats: [assassinSeat({ hand: [WOUNDING_BLOW, FESTERING], resources: 3 }), VICTIM] });

      game.play(WOUNDING_BLOW).blockWith();

      expect(() => game.react(FESTERING, { targetCard: WOUNDING_BLOW })).toThrow();
      expect(() => game.react(FESTERING)).toThrow();
    });

    it("Festering Rot's rider still applies when attacks cannot gain go again", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH, FESTERING], resources: 3, board: ["hypothermia|3"] }),
        VICTIM,
      ] });

      game.play(FEVERISH).blockWith().react(FESTERING, { targetCard: FEVERISH }).settle();

      game.expectAP(0, 0);
      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);
    });

    it("Festering Rot's rider fires when Flick Knives hits with its attack from an earlier link", () => {
      const game = scenario({ seats: [
        assassinSeat({
          hand: [KISS_OF_DEATH, FESTERING, WOUNDING_BLOW],
          resources: 6,
          equipment: { ...NO_EQUIPMENT, arms: "flick knives|0" },
        }),
        { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW] },
      ] });

      game.play(KISS_OF_DEATH).blockWith(WOUNDING_BLOW, WOUNDING_BLOW)
        .react(FESTERING, { targetCard: KISS_OF_DEATH }).settle();
      expect(boardNames(game, 1)).toEqual([]);

      game.play(WOUNDING_BLOW).blockWith().activate("flick knives|0").chooseCard(KISS_OF_DEATH).settle();

      expect(boardNames(game, 1)).toEqual(["Bloodrot Pox"]);
    });

    it("Outbreak's rider fires when Flick Knives hits with its attack from an earlier link", () => {
      const game = scenario({ seats: [
        assassinSeat({
          hand: [KISS_OF_DEATH, OUTBREAK, FESTERING, WOUNDING_BLOW],
          resources: 8,
          equipment: { ...NO_EQUIPMENT, arms: "flick knives|0" },
        }),
        { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW, WOUNDING_BLOW] },
      ] });

      game.play(KISS_OF_DEATH).blockWith(WOUNDING_BLOW, WOUNDING_BLOW, WOUNDING_BLOW)
        .react(OUTBREAK, { targetCard: KISS_OF_DEATH, settle: false })
        .passPriority()
        .passPriority()
        // Go again opens the later link the Flick Knives activation needs.
        .react(FESTERING, { targetCard: KISS_OF_DEATH }).settle();
      expect(boardNames(game, 1)).toEqual([]);

      game.play(WOUNDING_BLOW).blockWith().activate("flick knives|0").chooseCard(KISS_OF_DEATH).settle();

      expect(boardNames(game, 1).sort()).toEqual(["Bloodrot Pox", "Bloodrot Pox", "Frailty", "Inertia"]);
    });

    it("Pinpoint Elimination banishes a named top card and creates a Silver", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH, PINPOINT], resources: 2 }),
        { ...VICTIM, deck: [WOUNDING_BLOW, "raging onslaught|1"] },
      ] });

      game.play(FEVERISH).blockWith().react(PINPOINT).chooseName("Wounding Blow").settle();

      game.expectInZone(1, WOUNDING_BLOW, "banish").expectDeckTop(1, "raging onslaught|1");
      expect(silverCount(game)).toBe(1);
      expect(publicLog(game)).toContain("reveal");
    });

    it("Pinpoint Elimination leaves a revealed miss on top and creates nothing", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH, PINPOINT], resources: 2 }),
        { ...VICTIM, deck: ["raging onslaught|1", WOUNDING_BLOW] },
      ] });

      game.play(FEVERISH).blockWith().react(PINPOINT).chooseName("Wounding Blow").settle();

      game.expectZoneSize(1, "banish", 0).expectDeckTop(1, "raging onslaught|1").expectZoneSize(1, "deck", 2);
      expect(silverCount(game)).toBe(0);
      expect(publicLog(game)).toContain("reveal");
    });

    it("Pinpoint Elimination does nothing against an empty deck", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH, PINPOINT], resources: 2 }),
        { ...VICTIM, deck: [] },
      ] });

      game.play(FEVERISH).blockWith().react(PINPOINT).chooseName("Wounding Blow").settle();

      game.expectZoneSize(1, "banish", 0);
      expect(silverCount(game)).toBe(0);
    });

    it("Pinpoint Elimination's banish completes an active contract for both Silver rewards", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [TAILORED, PINPOINT] }),
        { ...VICTIM, deck: [WOUNDING_BLOW, "raging onslaught|1", "raging onslaught|2"] },
      ] });

      game.play(TAILORED).chooseName("Wounding Blow").blockWith().react(PINPOINT).chooseName("Wounding Blow");

      game.expectInZone(1, WOUNDING_BLOW, "banish");
      expect(silverCount(game)).toBe(2);
    });

    it("Mask of One Million Eyes draws, then bottoms a privately chosen hand card", () => {
      const game = scenario({ seats: [
        assassinSeat({
          hand: [FEVERISH, WOUNDING_BLOW],
          resources: 2,
          deck: ["raging onslaught|1", "raging onslaught|2"],
          equipment: { ...NO_EQUIPMENT, head: MASK },
        }),
        VICTIM,
      ] });

      game.play(FEVERISH).blockWith().activate(MASK);
      game.expectInZone(0, MASK, "graveyard");
      game.expectInZone(0, "raging onslaught|1", "hand");
      expect(publicLog(game)).not.toContain("Wounding Blow");
      game.chooseCard(WOUNDING_BLOW);

      game.expectDeckBottom(0, WOUNDING_BLOW).expectNotInZone(0, WOUNDING_BLOW, "hand");
      expect(publicLog(game)).not.toContain("Wounding Blow");
    });

    it("Mask of One Million Eyes still bottoms a card from an empty deck", () => {
      const game = scenario({ seats: [
        assassinSeat({
          hand: [FEVERISH, WOUNDING_BLOW],
          resources: 2,
          deck: [],
          equipment: { ...NO_EQUIPMENT, head: MASK },
        }),
        VICTIM,
      ] });

      game.play(FEVERISH).blockWith().activate(MASK).chooseCard(WOUNDING_BLOW);

      game.expectHandSize(0, 0).expectDeckBottom(0, WOUNDING_BLOW);
    });

    it("Mask of One Million Eyes asks nothing with no deck and no hand", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [FEVERISH], resources: 2, deck: [], equipment: { ...NO_EQUIPMENT, head: MASK } }),
        VICTIM,
      ] });

      game.play(FEVERISH).blockWith().activate(MASK);

      expect(game.state.pendingDecision?.chooseHook).toBeUndefined();
      game.expectInZone(0, MASK, "graveyard").expectZoneSize(0, "deck", 0);
    });

    it("Mask of One Million Eyes re-equips from the graveyard for 2 Silver", () => {
      const game = scenario({
        active: 1,
        seats: [assassinSeat({ graveyard: [MASK], board: [SILVER, SILVER, SILVER] }), VICTIM],
      });

      game.endTurn().chooseOption("yes");

      game.expectEquipped(0, "head", MASK).expectNotInZone(0, MASK, "graveyard");
      expect(silverCount(game)).toBe(1);
    });

    it("Mask of One Million Eyes stays in the graveyard with 1 Silver", () => {
      const game = scenario({ active: 1, seats: [assassinSeat({ graveyard: [MASK], board: [SILVER] }), VICTIM] });

      game.endTurn();

      game.expectInZone(0, MASK, "graveyard");
      expect(silverCount(game)).toBe(1);
    });
  });

  describe("Mastery Pack Assassin batch 3", () => {
    const ARAKNI = "arakni|0";
    const UZURI = "uzuri|0";
    const MORTIMER = "dr. mortimer|0";
    const BREAK_DOWN = "break down the bloodline|1";
    const RECON = "repeat reconnaissance|1";
    const TRIPLE_BLIND = "triple blind|1";
    const WRISTCUFF = "wristcuff injectors|0";
    const FEVERISH = "feverish strike|1";
    const FESTERING = "festering rot|2";
    const PINPOINT = "pinpoint elimination|3";
    const NON_ATTACK_COST_2 = "villainous pose|1";
    const GO_AGAIN_ATTACK = "head jab|1";
    const VICTIM: SeatSpec = { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT };
    const hook = (game: ReturnType<typeof scenario>) => game.state.pendingDecision?.chooseHook;

    describe("heroHasMoniker", () => {
      const heroNamed = (name: string) =>
        ({
          player: () => ({ heroCardId: "hero" }),
          cardData: () => ({ name }),
        }) as unknown as ScriptCtx;

      it.each([
        ["Mortimer", "Dr. Mortimer"],
        ["Mortimer", "Dr. Mortimer, Blight of the Pits"],
        ["Arakni", "Arakni"],
        ["Arakni", "Arakni, Marionette"],
        ["Arakni", "Arakni, Black Widow"],
        ["Arakni", "Arakni, 5L!p3d 7hRu 7h3 cR4X"],
        ["Uzuri", "Uzuri"],
        ["Uzuri", "Uzuri, Switchblade"],
      ])("%s matches %s", (moniker, name) => {
        expect(heroHasMoniker(heroNamed(name), 0, moniker)).toBe(true);
      });

      it.each([
        ["Mortimer", "Nuu, Alluring Desire"],
        ["Arakni", "Uzuri, Switchblade"],
        ["Uzuri", "Dr. Mortimer"],
        // A suffix is not part of the moniker.
        ["Arakni", "Nuu, Slayer of Arakni"],
        ["Mort", "Dr. Mortimer"],
      ])("%s does not match %s", (moniker, name) => {
        expect(heroHasMoniker(heroNamed(name), 0, moniker)).toBe(false);
      });
    });

    describe("Break Down the Bloodline", () => {
      it("as Arakni, banishes on hit and gives Silver for an Assassin card", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: ARAKNI, hand: [BREAK_DOWN], resources: 2 }),
          { ...VICTIM, deck: [FEVERISH, "snatch|1"] },
        ] });

        game.play(BREAK_DOWN).chooseOption("no").blockWith().settle();

        game.expectLife(1, 14).expectInZone(1, FEVERISH, "banish");
        expect(silverCount(game)).toBe(1);
      });

      it("as Arakni, banishes a non-Assassin card without completing the contract", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: ARAKNI, hand: [BREAK_DOWN], resources: 2 }),
          { ...VICTIM, deck: ["snatch|1", FEVERISH] },
        ] });

        game.play(BREAK_DOWN).chooseOption("no").blockWith().settle();

        game.expectInZone(1, "snatch|1", "banish");
        expect(silverCount(game)).toBe(0);
      });

      it("as a non-Arakni hero, neither banishes on hit nor completes the contract", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [BREAK_DOWN, PINPOINT], resources: 2 }),
          { ...VICTIM, deck: [FEVERISH, "snatch|1"] },
        ] });

        game.play(BREAK_DOWN).blockWith().react(PINPOINT).chooseName("Feverish Strike").settle();

        // Pinpoint's own Silver is the only one; the banish does not complete the contract.
        game.expectLife(1, 14).expectZoneSize(1, "banish", 1).expectDeckTop(1, "snatch|1");
        expect(silverCount(game)).toBe(1);
      });

      it("keeps the Contract keyword, so Arakni's hero ability triggers when it is played", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: ARAKNI, hand: [BREAK_DOWN], resources: 2 }),
          { ...VICTIM, deck: ["snatch|1", FEVERISH] },
        ] });

        game.play(BREAK_DOWN);
        expect(game.stackLabels().join()).toContain("Look at the opponent's top card");
      });
    });

    describe("Repeat Reconnaissance", () => {
      const blockers = { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW] };

      it("as Uzuri defended by 2 cards, may bottom a cost-2 attack action card", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [RECON], graveyard: [BREAK_DOWN], deck: ["snatch|1"] }),
          blockers,
        ] });

        game.play(RECON).blockWith(WOUNDING_BLOW, WOUNDING_BLOW).settle();
        expect(hook(game)).toBe("mpa-repeat-recon-bottom");
        expect(game.state.pendingDecision?.options).toContain("pass");
        game.chooseCard(BREAK_DOWN).settle();

        game.expectDeckBottom(0, BREAK_DOWN).expectNotInZone(0, BREAK_DOWN, "graveyard");
      });

      it("can be declined", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [RECON], graveyard: [BREAK_DOWN] }),
          blockers,
        ] });

        game.play(RECON).blockWith(WOUNDING_BLOW, WOUNDING_BLOW).settle().chooseOption("pass").settle();

        game.expectInZone(0, BREAK_DOWN, "graveyard");
      });

      it("counts a defending equipment as a card", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [RECON], graveyard: [BREAK_DOWN] }),
          {
            ...VICTIM,
            hand: [WOUNDING_BLOW],
            equipment: { ...NO_EQUIPMENT, head: IRONROT_HELM },
          },
        ] });

        game.play(RECON).blockWith(WOUNDING_BLOW, IRONROT_HELM).settle();

        expect(hook(game)).toBe("mpa-repeat-recon-bottom");
      });

      it("offers nothing with 1 defender", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [RECON], graveyard: [BREAK_DOWN] }),
          blockers,
        ] });

        game.play(RECON).blockWith(WOUNDING_BLOW).settle();

        expect(hook(game)).toBeUndefined();
        game.expectInZone(0, BREAK_DOWN, "graveyard");
      });

      it("offers nothing to a non-Uzuri hero", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: MORTIMER, hand: [RECON], graveyard: [BREAK_DOWN] }),
          blockers,
        ] });

        game.play(RECON).blockWith(WOUNDING_BLOW, WOUNDING_BLOW).settle();

        expect(hook(game)).toBeUndefined();
        game.expectInZone(0, BREAK_DOWN, "graveyard");
      });

      it.each([
        ["an empty graveyard", []],
        ["a cost-1 attack", [TRIPLE_BLIND]],
        ["a cost-2 non-attack action", [NON_ATTACK_COST_2]],
      ])("offers nothing with %s", (_label, graveyard) => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [RECON], graveyard }),
          blockers,
        ] });

        game.play(RECON).blockWith(WOUNDING_BLOW, WOUNDING_BLOW).settle();

        expect(hook(game)).toBeUndefined();
        game.expectZoneSize(0, "graveyard", graveyard.length);
      });

      it("fires when a defense reaction brings the defenders to 2", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [RECON], graveyard: [BREAK_DOWN] }),
          { ...VICTIM, hand: [WOUNDING_BLOW, "smoke out|1"], resources: 3 },
        ] });
        game.play(RECON).blockWith(WOUNDING_BLOW);
        expect(hook(game)).toBeUndefined();

        game.passPriority().react("smoke out|1");

        expect(hook(game)).toBe("mpa-repeat-recon-bottom");
      });

      it("fires once when a defense reaction adds a third defender", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [RECON], graveyard: [BREAK_DOWN, BREAK_DOWN] }),
          { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW, "smoke out|1"], resources: 3 },
        ] });

        game.play(RECON).blockWith(WOUNDING_BLOW, WOUNDING_BLOW);
        game.passPriority().passPriority();
        expect(hook(game)).toBe("mpa-repeat-recon-bottom");
        // chooseOption would settle past the reaction window.
        game.doRaw({ kind: "choose", optionId: "pass" });
        game.passPriority().react("smoke out|1");

        expect(hook(game)).toBeUndefined();
        game.expectZoneSize(0, "graveyard", 2);
      });
    });

    describe("Triple Blind", () => {
      it.each([MORTIMER, DR_MORTIMER])("as %s, the defender chooses the token created under their control", (heroKey) => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey, hand: [TRIPLE_BLIND], resources: 1 }),
          VICTIM,
        ] });

        game.play(TRIPLE_BLIND).blockWith().settle();
        expect(game.state.pendingDecision?.player).toBe(1);
        expect(hook(game)).toBe("mpa-triple-blind-disease");
        game.chooseOption(INERTIA_TOKEN).settle();

        expect(boardNames(game, 1)).toEqual(["Inertia"]);
        expect(boardNames(game, 0)).toEqual([]);
      });

      it("as a non-Mortimer hero, does nothing on hit", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: UZURI, hand: [TRIPLE_BLIND], resources: 1 }),
          VICTIM,
        ] });

        game.play(TRIPLE_BLIND).blockWith().settle();

        game.expectLife(1, 15);
        expect(boardNames(game, 1)).toEqual([]);
      });

      it("completes Sick Intent's token contract, since you create the token", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: MORTIMER, hand: [SICK_INTENT, FESTERING, TRIPLE_BLIND], resources: 6 }),
          { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW, WOUNDING_BLOW] },
        ] });

        game.play(SICK_INTENT).blockWith(WOUNDING_BLOW, WOUNDING_BLOW, WOUNDING_BLOW)
          .react(FESTERING, { targetCard: SICK_INTENT }).settle();
        expect(silverCount(game)).toBe(0);

        game.play(TRIPLE_BLIND).blockWith().settle().chooseOption(FRAILTY_TOKEN).settle();

        expect(boardNames(game, 1)).toEqual(["Frailty"]);
        expect(silverCount(game)).toBe(1);
      });
    });

    describe("Wristcuff Injectors", () => {
      const wristcuffSeat = (spec: Partial<SeatSpec>) =>
        assassinSeat({ heroKey: MORTIMER, equipment: { ...NO_EQUIPMENT, arms: WRISTCUFF }, ...spec });

      it("is not activatable as a non-Mortimer hero", () => {
        const game = scenario({ seats: [wristcuffSeat({ heroKey: UZURI }), VICTIM] });

        expect(() => game.activate(WRISTCUFF)).toThrow(/no legal/);
        game.expectEquipped(0, "arms", WRISTCUFF);
      });

      it("destroys itself with go again, and the next Assassin attack creates the attacker's chosen token", () => {
        const game = scenario({ seats: [wristcuffSeat({ hand: [FEVERISH], resources: 2 }), VICTIM] });

        game.activate(WRISTCUFF).settle();
        game.expectInZone(0, WRISTCUFF, "graveyard").expectAP(0, 1);

        game.play(FEVERISH).blockWith().settle();
        expect(game.state.pendingDecision?.player).toBe(0);
        expect(hook(game)).toBe("mpa-wristcuff-disease");
        game.chooseOption(FRAILTY_TOKEN).settle();

        expect(boardNames(game, 1)).toEqual(["Frailty"]);
      });

      it("waits past a non-Assassin attack for the next Assassin attack action card", () => {
        const game = scenario({ seats: [
          wristcuffSeat({ hand: [GO_AGAIN_ATTACK, FEVERISH], resources: 4 }),
          VICTIM,
        ] });

        game.activate(WRISTCUFF).settle();
        game.play(GO_AGAIN_ATTACK).blockWith().settle();
        expect(hook(game)).toBeUndefined();
        expect(boardNames(game, 1)).toEqual([]);

        game.play(FEVERISH).blockWith().settle().chooseOption(INERTIA_TOKEN).settle();

        expect(boardNames(game, 1)).toEqual(["Inertia"]);
      });

      it("applies only to the next Assassin attack action card", () => {
        const game = scenario({ seats: [
          wristcuffSeat({ hand: [KISS_OF_DEATH, FESTERING, FEVERISH], resources: 6 }),
          { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW] },
        ] });

        game.activate(WRISTCUFF).settle();
        // Blocked first attack still used the effect; Festering Rot gives it go again.
        game.play(KISS_OF_DEATH).blockWith(WOUNDING_BLOW, WOUNDING_BLOW)
          .react(FESTERING, { targetCard: KISS_OF_DEATH }).settle();
        expect(boardNames(game, 1)).toEqual([]);

        game.play(FEVERISH).blockWith().settle();

        expect(hook(game)).toBeUndefined();
        expect(boardNames(game, 1)).toEqual([]);
      });

      it("fires when Flick Knives hits with the attack from an earlier link", () => {
        const game = scenario({ seats: [
          // Both are arms; the harness only needs each one equipped.
          wristcuffSeat({
            hand: [KISS_OF_DEATH, FESTERING, WOUNDING_BLOW],
            resources: 6,
            equipment: { ...NO_EQUIPMENT, head: WRISTCUFF, arms: "flick knives|0" },
          }),
          { ...VICTIM, hand: [WOUNDING_BLOW, WOUNDING_BLOW] },
        ] });

        game.activate(WRISTCUFF).settle();
        game.play(KISS_OF_DEATH).blockWith(WOUNDING_BLOW, WOUNDING_BLOW)
          .react(FESTERING, { targetCard: KISS_OF_DEATH }).settle();
        expect(boardNames(game, 1)).toEqual([]);

        game.play(WOUNDING_BLOW).blockWith().activate("flick knives|0").chooseCard(KISS_OF_DEATH).settle();
        expect(hook(game)).toBe("mpa-wristcuff-disease");
        game.chooseOption(FRAILTY_TOKEN).settle();

        expect(boardNames(game, 1)).toContain("Frailty");
      });

      it("completes Sick Intent's token contract when it is the granted attack", () => {
        const game = scenario({ seats: [wristcuffSeat({ hand: [SICK_INTENT], resources: 2 }), VICTIM] });

        game.activate(WRISTCUFF).settle();
        game.play(SICK_INTENT).blockWith().settle();
        // Sick Intent's own hit and the rider each create a token and complete the contract.
        while (game.state.pendingDecision?.options?.includes(FRAILTY_TOKEN)) {
          game.chooseOption(FRAILTY_TOKEN).settle();
        }

        expect(boardNames(game, 1)).toEqual(["Frailty", "Frailty"]);
        expect(silverCount(game)).toBe(2);
      });

      it("expires at end of turn", () => {
        const game = scenario({ seats: [
          wristcuffSeat({ hand: [FEVERISH], deck: ["snatch|3", "snatch|3", "snatch|3", "snatch|3"] }),
          { ...VICTIM, deck: ["snatch|1", "snatch|2", "snatch|3"] },
        ] });

        game.activate(WRISTCUFF).settle();
        game.endTurn().endTurn().settle();
        game.expectTurn(3);

        game.play(FEVERISH).blockWith().settle();

        expect(hook(game)).toBeUndefined();
        expect(boardNames(game, 1)).toEqual([]);
      });

      it("is destroyed by Blade Break after defending", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [FEVERISH], resources: 2 }),
          { ...VICTIM, equipment: { ...NO_EQUIPMENT, arms: WRISTCUFF } },
        ] });

        game.play(FEVERISH).blockWith(WRISTCUFF).settle();
        game.expectEquipped(1, "arms", WRISTCUFF);

        game.endTurn();

        game.expectInZone(1, WRISTCUFF, "graveyard");
      });
    });
  });

  describe("Mastery Pack Assassin batch 4", () => {
    const VICTIM: SeatSpec = { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT };
    const attacker = (spec: Partial<SeatSpec>): SeatSpec => ({
      hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, ...spec,
    });
    const graveyardCount = (game: ReturnType<typeof scenario>, seat: number, name: string) =>
      game.state.players[seat]!.graveyard.filter((card) => cardData[card.cardId]!.name === name).length;

    describe("Free of Burdens", () => {
      const RED = "free of burdens|1";
      const BLUE = "free of burdens|3";

      it.each([[RED, 7], ["free of burdens|2", 6], [BLUE, 5]] as const)(
        "%s destroys an aura token to get +1 power",
        (card, damage) => {
          const game = scenario({ seats: [
            attacker({ hand: [card], board: ["frailty|0", "silver|0"], resources: 2 }),
            VICTIM,
          ] });

          game.play(card).blockWith().activate(card).chooseCard("frailty|0").settle();

          expect(boardNames(game, 0)).toEqual(["Silver"]);
          game.expectLife(1, 20 - damage);
        },
      );

      it("can't be paid with a non-token aura, a non-aura token, or an opponent's aura token", () => {
        const game = scenario({ seats: [
          attacker({ hand: [RED], board: ["forged for war|2", "silver|0"], resources: 2 }),
          { ...VICTIM, board: ["frailty|0"] },
        ] });

        game.play(RED).blockWith();

        expect(() => game.activate(RED)).toThrow(/no legal intent/);
      });

      it("only offers aura tokens when choosing what to destroy", () => {
        const game = scenario({ seats: [
          attacker({ hand: [RED], board: ["forged for war|2", "silver|0", "inertia|0"], resources: 2 }),
          { ...VICTIM, board: ["frailty|0"] },
        ] });

        game.play(RED).blockWith().activate(RED);

        const inertia = game.state.players[0]!.board.find((card) => cardData[card.cardId]!.name === "Inertia")!;
        expect(game.state.pendingDecision?.options).toEqual([String(inertia.instanceId)]);
        game.chooseCard("inertia|0").settle();
        expect(boardNames(game, 0).sort()).toEqual(["Forged for War", "Silver"]);
      });

      it("works only while it is the attack, not from hand", () => {
        const game = scenario({ seats: [
          attacker({ hand: [RED], board: ["frailty|0"], resources: 2 }),
          VICTIM,
        ] });

        expect(() => game.activate(RED)).toThrow(/no legal intent/);
      });

      it("doesn't work while defending", () => {
        const game = scenario({ seats: [
          attacker({ hand: [WOUNDING_BLOW] }),
          { ...VICTIM, hand: [RED], board: ["frailty|0"] },
        ] });

        game.play(WOUNDING_BLOW).blockWith(RED);

        expect(legalIntents(game.state, 1).some((intent) => intent.kind === "activate-ability")).toBe(false);
      });

      it("is once per turn per card, its +1 stays on this attack, and it ends when the link resolves", () => {
        const game = scenario({ seats: [
          attacker({ hand: [RED, BLUE], board: ["frailty|0", "frailty|0", "frailty|0"], resources: 4 }),
          { ...VICTIM, deck: ["snatch|1", "snatch|2", "snatch|3"] },
        ] });
        game.state.players[0]!.actionPoints = 2;

        game.play(RED).blockWith().activate(RED).chooseCard("frailty|0").settle();
        expect(() => game.activate(RED)).toThrow(/no legal intent/);
        game.expectLife(1, 13);

        game.play(BLUE).blockWith();
        // The first copy stays attacking on the chain but has used its activation.
        expect(() => game.activate(RED)).toThrow(/no legal intent/);
        game.activate(BLUE).chooseCard("frailty|0").settle();
        game.expectLife(1, 8);
        expect(boardNames(game, 0)).toEqual(["Frailty"]);
      });

      it("can still be activated on the chain after its link resolves", () => {
        const game = scenario({ seats: [
          attacker({ hand: [RED, BLUE], board: ["frailty|0"], resources: 4 }),
          { ...VICTIM, deck: ["snatch|1", "snatch|2", "snatch|3"] },
        ] });
        game.state.players[0]!.actionPoints = 2;

        game.play(RED).blockWith().settle();
        game.expectLife(1, 14);

        game.play(BLUE).blockWith().activate(RED).chooseCard("frailty|0").settle();

        expect(boardNames(game, 0)).toEqual([]);
        // The +1 is on the earlier attack, not on the blue copy's 4 damage.
        game.expectLife(1, 10);
      });

      it("gets a new once-per-turn activation when played again as a new object", () => {
        const SOMERSAULT = "electromagnetic somersault|1";
        const game = scenario({ seats: [
          attacker({ hand: [RED, SOMERSAULT], board: ["frailty|0", "frailty|0"], resources: 8 }),
          { ...VICTIM, deck: ["snatch|1", "snatch|2", "snatch|3"] },
        ] });
        game.state.players[0]!.actionPoints = 2;

        game.play(RED).blockWith().react(SOMERSAULT);
        game.chooseMany([String(game.state.chain.at(-1)!.attackingCard.instanceId)]);
        game.activate(RED).chooseCard("frailty|0").settle();
        game.expectInZone(0, RED, "hand");

        game.play(RED).blockWith().activate(RED).chooseCard("frailty|0").settle();

        expect(boardNames(game, 0)).toEqual([]);
      });

      it("can destroy Bloodrot Pox and fires Prolonged Illness", () => {
        const game = scenario({ seats: [
          attacker({ hand: [PROLONGED, RED], board: ["bloodrot pox|0"], resources: 2 }),
          VICTIM,
        ] });

        game.play(PROLONGED).settle();
        game.play(RED).blockWith().activate(RED).chooseCard("bloodrot pox|0").settle();

        expect(boardNames(game, 0)).toEqual(["Bloodrot Pox"]);
        game.expectLife(1, 13);
      });
    });

    describe("Patron's Lockbox: Valuables", () => {
      const LOCKBOX = "patron's lockbox: valuables|3";
      const LOCKBOX_NAME = "Patron's Lockbox: Valuables";
      const CONTRACT = "plunder the poor|1";
      const TARGET_DECK = { ...VICTIM, deck: ["head jab|1"] };

      it("has its own go again", () => {
        const game = scenario({ seats: [attacker({ hand: [LOCKBOX] }), VICTIM] });

        game.play(LOCKBOX).settle().expectAP(0, 1);

        expect(boardNames(game, 0)).toEqual([LOCKBOX_NAME]);
      });

      it("adds its reward to the contract's Silver, destroying itself", () => {
        const game = scenario({ seats: [
          attacker({ hand: [CONTRACT], board: [LOCKBOX], resources: 3 }),
          TARGET_DECK,
        ] });

        game.play(CONTRACT).blockWith().settle();

        expect(boardNames(game, 0)).toEqual(["Silver", "Silver", "Silver"]);
        expect(graveyardCount(game, 0, LOCKBOX_NAME)).toBe(1);
      });

      it("goes on the stack with priority after the contract's Silver has arrived", () => {
        const game = scenario({ seats: [
          attacker({ hand: [CONTRACT], board: [LOCKBOX], resources: 3 }),
          TARGET_DECK,
        ] });

        game.play(CONTRACT).blockWith();
        for (let i = 0; i < 12 && !game.state.stack.some((layer) => layer.label.startsWith("Destroy this")); i++) {
          game.passPriority();
        }

        expect(game.state.stack[0]?.label).toBe("Destroy this. If you do, create 2 Silver tokens");
        expect(boardNames(game, 0).sort()).toEqual([LOCKBOX_NAME, "Silver"].sort());
      });

      it("rewards once when two contracts complete from one banish", () => {
        const game = scenario({ seats: [
          {
            hero: "rhinar",
            hand: ["leave no witnesses|1", "excessive bloodloss|1"],
            arsenalFaceDown: ["the hand that pulls the strings|0"],
            board: [LOCKBOX],
            resources: 1,
          },
          { hero: "dorinthea", deck: ["wrecker romp|3", "head jab|1", "flex claws|1"] },
        ] });

        game.play("leave no witnesses|1")
          .blockWith()
          .activate("the hand that pulls the strings|0")
          .settle()
          .play("excessive bloodloss|1")
          .blockWith()
          .settle();

        expect(boardNames(game, 0).filter((name) => name === "Silver")).toHaveLength(6);
        expect(boardNames(game, 0)).not.toContain(LOCKBOX_NAME);
        expect(graveyardCount(game, 0, LOCKBOX_NAME)).toBe(1);
      });

      it("a later layer fails after the first destroys it when one contract completes three times", () => {
        const game = scenario({ seats: [
          attacker({ hand: ["eradicate|2"], board: [LOCKBOX], resources: 1 }),
          { ...VICTIM, deck: ["head jab|2", "flex claws|2", "wrecker romp|2", "head jab|1"] },
        ] });

        game.play("eradicate|2").blockWith().settle();

        // Three completions give three Silver; the Lockbox adds two only once.
        expect(boardNames(game, 0)).toEqual(Array(5).fill("Silver"));
        expect(graveyardCount(game, 0, LOCKBOX_NAME)).toBe(1);
      });

      it("each of two Lockboxes rewards once", () => {
        const game = scenario({ seats: [
          attacker({ hand: [CONTRACT], board: [LOCKBOX, LOCKBOX], resources: 3 }),
          TARGET_DECK,
        ] });

        game.play(CONTRACT).blockWith().settle();

        expect(boardNames(game, 0)).toEqual(Array(5).fill("Silver"));
        expect(graveyardCount(game, 0, LOCKBOX_NAME)).toBe(2);
      });

      it("ignores an opponent's contract", () => {
        const game = scenario({ seats: [
          attacker({ hand: [CONTRACT], resources: 3 }),
          { ...TARGET_DECK, board: [LOCKBOX] },
        ] });

        game.play(CONTRACT).blockWith().settle();

        expect(boardNames(game, 1)).toEqual([LOCKBOX_NAME]);
        expect(boardNames(game, 0)).toEqual(["Silver"]);
      });

      it("doesn't react from hand, graveyard or banish", () => {
        const game = scenario({ seats: [
          attacker({ hand: [CONTRACT, LOCKBOX], graveyard: [LOCKBOX], banish: [LOCKBOX], resources: 3 }),
          TARGET_DECK,
        ] });

        game.play(CONTRACT).blockWith().settle();

        expect(boardNames(game, 0)).toEqual(["Silver"]);
        game.expectInZone(0, LOCKBOX, "hand");
        expect(graveyardCount(game, 0, LOCKBOX_NAME)).toBe(1);
      });

      it("doesn't react when the contract isn't completed", () => {
        const game = scenario({ seats: [
          attacker({ hand: [CONTRACT], board: [LOCKBOX], resources: 3 }),
          { ...VICTIM, deck: ["raging onslaught|1"] },
        ] });

        game.play(CONTRACT).blockWith().settle();

        expect(boardNames(game, 0)).toEqual([LOCKBOX_NAME]);
      });

      it("reacts to the token contract path", () => {
        const game = scenario({ seats: [
          attacker({ hand: [SICK_INTENT], board: [LOCKBOX], resources: 2 }),
          VICTIM,
        ] });

        game.play(SICK_INTENT).blockWith().settle();
        game.chooseOption(FRAILTY_TOKEN).settle();

        expect(boardNames(game, 0)).toEqual(Array(3).fill("Silver"));
      });

      it("reacts to the direct Viral Sampling completion", () => {
        const game = scenario({ seats: [
          attacker({ hand: ["viral sampling|3"], board: [LOCKBOX] }),
          { ...VICTIM, board: ["frailty|0"] },
        ] });

        game.play("viral sampling|3").blockWith().settle();

        expect(boardNames(game, 0)).toEqual(Array(3).fill("Silver"));
      });

      it("reacts to a contract with no Silver reward", () => {
        const game = scenario({ seats: [
          { hero: "rhinar", hand: ["defang the dragon|1"], deck: ["wrecker romp|3"], board: [LOCKBOX] },
          { hero: "dorinthea", heroKey: "fang|0" },
        ] });
        game.state.players[1]!.hero.scriptState = { marked: 1 };

        game.play("defang the dragon|1").blockWith().settle();

        expect(boardNames(game, 0)).toEqual(["Silver", "Silver"]);
        expect(game.state.players[0]!.flags.contractCompletionsThisTurn).toBe(1);
      });
    });
  });

  describe("Mastery Pack Assassin variants", () => {
    const VICTIM = { hero: "dorinthea" as const, weapons: [] as string[], equipment: NO_EQUIPMENT };
    const INFECTED = { ...VICTIM, board: ["frailty|0"] };
    const ASSASSIN_VICTIM = { ...VICTIM, heroKey: DR_MORTIMER };
    const attacker = (spec: Partial<SeatSpec>) => assassinSeat({ resources: 3, ...spec });

    it("resolves the new printings with their pitch, power, type and keywords", () => {
      expect(findPrinting("Escaped Subject", 3)?.id).toBe("MPA078");
      expect(findPrinting("Viral Sampling", 1)?.id).toBe("MPA106");
      expect(findPrinting("Lab Rat", 2)?.attack).toBe(5);
      expect(findPrinting("Festering Weakness", 2)?.cardType).toBe("attack-reaction");
      expect(findPrinting("Professional Rivalry", 3)?.keywords).toEqual(["Stealth", "Contract"]);
    });

    it("Lab Rat gets +1 only against an infected hero", () => {
      const infected = scenario({ seats: [attacker({ hand: ["lab rat|1"] }), INFECTED] });
      infected.play("lab rat|1").blockWith().settle();
      infected.expectLife(1, 13);

      const clean = scenario({ seats: [attacker({ hand: ["lab rat|3"] }), VICTIM] });
      clean.play("lab rat|3").blockWith().settle();
      clean.expectLife(1, 16);
    });

    it("Escaped Subject's other pitches keep its infected go again", () => {
      const infected = scenario({ seats: [attacker({ hand: ["escaped subject|3"] }), INFECTED] });
      infected.play("escaped subject|3").blockWith().settle().expectAP(0, 1);

      const clean = scenario({ seats: [attacker({ hand: ["escaped subject|2"] }), VICTIM] });
      clean.play("escaped subject|2").blockWith().settle().expectAP(0, 0);
    });

    it("Eviscerate the Enervated's other pitches pay Silver only for an infected hero's card", () => {
      const infected = scenario({ seats: [
        attacker({ hand: ["eviscerate the enervated|2"] }),
        { ...INFECTED, deck: ["wounding blow|3"] },
      ] });
      infected.play("eviscerate the enervated|2").blockWith().settle();
      infected.expectZoneSize(1, "banish", 1);
      expect(silverCount(infected)).toBe(1);

      const clean = scenario({ seats: [
        attacker({ hand: ["eviscerate the enervated|3"] }),
        { ...VICTIM, deck: ["wounding blow|3"] },
      ] });
      clean.play("eviscerate the enervated|3").blockWith().settle();
      clean.expectZoneSize(1, "banish", 1);
      expect(silverCount(clean)).toBe(0);
    });

    it("Viral Sampling's other pitches complete their contract only on an infected hero", () => {
      const infected = scenario({ seats: [attacker({ hand: ["viral sampling|1"] }), INFECTED] });
      infected.play("viral sampling|1").blockWith().settle();
      expect(silverCount(infected)).toBe(1);
      expect(infected.state.players[0]!.flags.contractCompletionsThisTurn).toBe(1);

      const clean = scenario({ seats: [attacker({ hand: ["viral sampling|2"] }), VICTIM] });
      clean.play("viral sampling|2").blockWith().settle();
      expect(silverCount(clean)).toBe(0);
    });

    it.each([
      ["sneaking exhaustion|1", "Inertia"],
      ["sneaking weakness|1", "Frailty"],
    ])("%s creates %s on hit only after its controller's attack reaction", (key, token) => {
      const game = scenario({ seats: [
        attacker({ hand: [key, "shred|3"] }),
        { ...VICTIM, hand: ["wounding blow|3"] },
      ] });
      game.play(key).blockWith("wounding blow|3");
      game.react("shred|3").chooseCard("wounding blow|3");
      game.settle();
      expect(boardNames(game, 1)).toEqual([token]);

      const quiet = scenario({ seats: [attacker({ hand: [key] }), VICTIM] });
      quiet.play(key).blockWith().settle();
      expect(boardNames(quiet, 1)).toEqual([]);
    });

    it("Wound Excavation drains 1 life on hit only after a dagger hit this chain", () => {
      const game = scenario({ seats: [
        attacker({ hand: ["wound excavation|1"], weapons: [HUMOUR_PLUNGE] }),
        VICTIM,
      ] });
      game.attackWithWeapon(HUMOUR_PLUNGE).blockWith().settle();
      game.expectLife(1, 19);
      game.play("wound excavation|1").blockWith().settle();
      game.expectLife(1, 13);

      const clean = scenario({ seats: [attacker({ hand: ["wound excavation|1"] }), VICTIM] });
      clean.play("wound excavation|1").blockWith().settle();
      clean.expectLife(1, 15);
    });

    it("Wound Excision banishes 2 from the deck on hit only after a dagger hit this chain", () => {
      const deck = ["wounding blow|1", "wounding blow|2", "wounding blow|3"];
      const game = scenario({ seats: [
        attacker({ hand: ["wound excision|1"], weapons: [HUMOUR_PLUNGE] }),
        { ...VICTIM, deck },
      ] });
      game.attackWithWeapon(HUMOUR_PLUNGE).blockWith().settle();
      game.play("wound excision|1").blockWith().settle();
      game.expectInZone(1, "wounding blow|1", "banish");
      game.expectInZone(1, "wounding blow|2", "banish");
      game.expectDeckTop(1, "wounding blow|3");

      const clean = scenario({ seats: [
        attacker({ hand: ["wound excision|1"] }),
        { ...VICTIM, deck },
      ] });
      clean.play("wound excision|1").blockWith().settle();
      clean.expectZoneSize(1, "banish", 0);
    });

    it.each([
      ["festering exhaustion|2", "Inertia"],
      ["festering weakness|2", "Frailty"],
    ])("%s gives go again and creates %s when the target hits", (key, token) => {
      const game = scenario({ seats: [attacker({ hand: [PREY, key] }), VICTIM] });
      game.play(PREY).blockWith().react(key, { targetCard: PREY }).settle();
      game.expectAP(0, 1);
      expect(boardNames(game, 1)).toEqual([token]);
    });

    it("Festering's rider stays quiet when the target is fully defended", () => {
      const game = scenario({ seats: [
        attacker({ hand: [PREY, "festering weakness|2"] }),
        { ...VICTIM, hand: ["raging onslaught|1", "raging onslaught|2"] },
      ] });
      game.play(PREY).blockWith("raging onslaught|1", "raging onslaught|2")
        .react("festering weakness|2", { targetCard: PREY }).settle();
      expect(boardNames(game, 1)).toEqual([]);
    });

    it.each([
      ["spawn bloodrot|1", "Bloodrot Pox"],
      ["spawn frailty|1", "Frailty"],
      ["spawn inertia|1", "Inertia"],
    ])("%s creates %s only when it hits an Assassin hero", (key, token) => {
      const assassin = scenario({ seats: [attacker({ hand: [key] }), ASSASSIN_VICTIM] });
      assassin.play(key).blockWith().settle();
      expect(boardNames(assassin, 1)).toEqual([token]);

      const other = scenario({ seats: [attacker({ hand: [key] }), VICTIM] });
      other.play(key).blockWith().settle();
      expect(boardNames(other, 1)).toEqual([]);
    });

    it("Professional Rivalry completes its contract for Silver only on an Assassin hero", () => {
      const assassin = scenario({ seats: [attacker({ hand: ["professional rivalry|3"] }), ASSASSIN_VICTIM] });
      assassin.play("professional rivalry|3").blockWith().settle();
      expect(silverCount(assassin)).toBe(1);
      expect(assassin.state.players[0]!.flags.contractCompletionsThisTurn).toBe(1);

      const other = scenario({ seats: [attacker({ hand: ["professional rivalry|3"] }), VICTIM] });
      other.play("professional rivalry|3").blockWith().settle();
      expect(silverCount(other)).toBe(0);
    });
  });

  describe("Mastery Pack Assassin one-off printings", () => {
    const VICTIM: SeatSpec = { hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT };
    const INFECTED: SeatSpec = { ...VICTIM, board: ["frailty|0"] };
    const ESCAPED = "escaped subject|1";

    describe("Needlebane", () => {
      it.each([
        ["head", "needlebane cowl|0"],
        ["chest", "needlebane coat|0"],
        ["arms", "needlebane gauntlets|0"],
        ["legs", "needlebane steppers|0"],
      ])("%s piece gets +1 defense only against a dagger, then breaks", (slot, key) => {
        const defend = (attacker: SeatSpec, attack: (game: ReturnType<typeof scenario>) => void) => {
          const game = scenario({ seats: [attacker, { ...VICTIM, equipment: { ...NO_EQUIPMENT, [slot]: key } }] });
          attack(game);
          game.blockWith(key).settle();
          return game;
        };

        const dagger = defend(assassinSeat({ weapons: [KUNAI], resources: 2 }), (game) => game.attackWithWeapon(KUNAI));
        dagger.expectFinalDefense(2);
        dagger.passActionPhase().expectInZone(1, key, "graveyard");

        const other = defend(assassinSeat({ hand: [ESCAPED], resources: 1 }), (game) => game.play(ESCAPED));
        other.expectFinalDefense(1);
      });
    });

    describe("Puredew Panacea", () => {
      const PUREDEW = "puredew panacea|0";
      const owner = (board: string[]) => assassinSeat({ weapons: [PUREDEW], board, life: 10 });

      it("cures its only disease for 1 life with go again", () => {
        const game = scenario({ seats: [owner(["frailty|0"]), VICTIM] });
        game.activate(PUREDEW).settle();
        expect(boardNames(game, 0)).toEqual([]);
        game.expectLife(0, 11).expectAP(0, 1).expectInZone(0, PUREDEW, "graveyard");
      });

      it("asks which disease to cure when there are several", () => {
        const game = scenario({ seats: [owner(["frailty|0", "inertia|0"]), VICTIM] });
        game.activate(PUREDEW).chooseCard("inertia|0");
        expect(boardNames(game, 0)).toEqual(["Frailty"]);
        game.expectLife(0, 11);
      });

      it("gains no life without a disease to cure", () => {
        const game = scenario({ seats: [owner([]), VICTIM] });
        game.activate(PUREDEW).settle();
        game.expectLife(0, 10).expectAP(0, 1).expectInZone(0, PUREDEW, "graveyard");
      });
    });

    describe("Easy Prey", () => {
      it.each([
        ["easy prey|1", 3],
        ["easy prey|2", 2],
        ["easy prey|3", 1],
      ] as const)("%s adds %i only against an infected hero", (key, amount) => {
        const attack = (defender: SeatSpec) => {
          const game = scenario({ seats: [assassinSeat({ hand: [ESCAPED, key], resources: 1 }), defender] });
          game.play(ESCAPED).blockWith().react(key).settle();
          return game;
        };
        attack(INFECTED).expectFinalAttack(4 + amount);
        attack(VICTIM).expectFinalAttack(4);
      });

      it("can target an Assassin weapon attack", () => {
        const game = scenario({ seats: [
          assassinSeat({ weapons: [HUMOUR_PLUNGE], hand: ["easy prey|1"], resources: 2 }),
          INFECTED,
        ] });
        // Humour Plunge's own +1 applies against the infected hero too.
        game.attackWithWeapon(HUMOUR_PLUNGE).blockWith().react("easy prey|1").settle();
        game.expectFinalAttack(5);
      });

      it("cannot be played without an Assassin attack", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: ["wounding blow|1", "easy prey|1"], resources: 2 }),
          INFECTED,
        ] });
        game.play("wounding blow|1").blockWith();
        game.expectNoLegalPlay("easy prey|1");
      });

      it("stays live after resolving and drops when the defender is cured", () => {
        const game = scenario({ seats: [
          assassinSeat({ heroKey: DR_MORTIMER, hand: [ESCAPED, "easy prey|1"], resources: 1 }),
          INFECTED,
        ] });
        game.play(ESCAPED).blockWith().react("easy prey|1", { settle: false });
        game.passPriority().passPriority();
        game.expectInZone(0, "easy prey|1", "graveyard");
        game.expectAttackValue(7).expectAttackModifier("easy prey|1", 3);
        game.activate(DR_MORTIMER, { ability: 0 }).chooseCard("frailty|0");
        game.settle().expectFinalAttack(4);
        expect(boardNames(game, 1)).toEqual([]);
      });

      it("starts applying when the defender becomes infected after it resolves", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [ESCAPED, "easy prey|1", "viral accelerant|3"], resources: 1, board: ["frailty|0"] }),
          VICTIM,
        ] });
        game.play(ESCAPED).blockWith().react("easy prey|1", { settle: false });
        game.passPriority().passPriority();
        game.expectAttackValue(4);
        game.react("viral accelerant|3").expectFinalAttack(7);
      });
    });

    describe("Act on Intel: Plans", () => {
      const PLANS = "act on intel: plans|2";
      const CONTRACT = "eviscerate the enervated|1";
      const attack = (defender: Partial<SeatSpec>, ...blockers: string[]) => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [CONTRACT, PLANS], resources: 2 }),
          { ...INFECTED, ...defender },
        ] });
        game.play(CONTRACT).blockWith(...blockers).react(PLANS).settle();
        return game;
      };

      it("adds +1 and banishes a lone arsenal card on hit without asking", () => {
        const game = attack({ arsenalFaceDown: ["wounding blow|1"] });
        game.expectFinalAttack(6).expectInZone(1, "wounding blow|1", "banish");
        expect(game.state.pendingDecision).toBeNull();
      });

      it("lets the hit hero choose among several arsenal cards, privately", () => {
        const game = attack({ arsenalFaceDown: ["wounding blow|1", "raging onslaught|1"] });
        expect(game.state.pendingDecision?.player).toBe(1);
        game.chooseCard("raging onslaught|1");
        game.expectInZone(1, "raging onslaught|1", "banish").expectInZone(1, "wounding blow|1", "arsenal");
        const publicLog = game.state.log.map((entry) => entry.publicText ?? "").join("\n");
        expect(publicLog).not.toContain("Wounding Blow");
      });

      it("credits the attacker's contract when the hit hero banishes their chosen card", () => {
        const completions = (game: ReturnType<typeof attack>) =>
          Number(game.state.players[0]!.flags.contractCompletionsThisTurn ?? 0);
        const baseline = attack({});
        const game = attack({ arsenalFaceDown: ["wounding blow|1", "raging onslaught|1"] });
        game.chooseCard("raging onslaught|1");
        expect(completions(game)).toBe(completions(baseline) + 1);
      });

      it("does nothing on hit with an empty arsenal", () => {
        const game = attack({});
        game.expectFinalAttack(6).expectZoneSize(1, "arsenal", 0);
        expect(game.state.pendingDecision).toBeNull();
      });

      it("keeps the arsenal when the attack does not hit", () => {
        const game = attack(
          { arsenalFaceDown: ["wounding blow|1"], hand: ["raging onslaught|1", "raging onslaught|2"] },
          "raging onslaught|1",
          "raging onslaught|2",
        );
        game.expectInZone(1, "wounding blow|1", "arsenal");
      });

      it("needs an Assassin attack action card with contract", () => {
        const game = scenario({ seats: [assassinSeat({ hand: [ESCAPED, PLANS], resources: 1 }), VICTIM] });
        game.play(ESCAPED).blockWith();
        game.expectNoLegalPlay(PLANS);
      });
    });

    describe("Kill Confirmed", () => {
      const KILL = "kill confirmed|1";
      const attack = (named: string) => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [KILL], resources: 2 }),
          { ...VICTIM, deck: ["wounding blow|1", "wounding blow|2"] },
        ] });
        game.play(KILL).chooseName(named);
        return game;
      };

      it("banishes a matching top card for a Silver", () => {
        const game = attack("Wounding Blow");
        game.expectInZone(1, "wounding blow|1", "banish").expectDeckTop(1, "wounding blow|2");
        expect(silverCount(game)).toBe(1);
        game.blockWith().settle().expectFinalAttack(6);
      });

      it("leaves a missed top card on the deck", () => {
        const game = attack("Raging Onslaught");
        game.expectDeckTop(1, "wounding blow|1").expectZoneSize(1, "banish", 0);
        expect(silverCount(game)).toBe(0);
      });
    });

    describe("Funded Research", () => {
      const FUNDED = "funded research|3";
      const count = (names: string[], name: string) => names.filter((candidate) => candidate === name).length;

      it("creates all three diseases under the opponent after a completed contract", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: ["eviscerate the enervated|1", "festering rot|2", FUNDED], resources: 4 }),
          { ...INFECTED, deck: ["wounding blow|1"] },
        ] });
        game.play("eviscerate the enervated|1").blockWith()
          .react("festering rot|2", { targetCard: "eviscerate the enervated|1" })
          .settle();
        expect(game.state.players[0]!.flags.completedContractThisTurn).toBe(true);
        game.expectAP(0, 1);
        const before = boardNames(game, 1);

        game.play(FUNDED).settle();

        const after = boardNames(game, 1);
        for (const name of ["Frailty", "Inertia", "Bloodrot Pox"]) {
          expect(count(after, name)).toBe(count(before, name) + 1);
        }
        expect(boardNames(game, 0).filter((name) => name !== "Silver")).toEqual([]);
      });

      it("does nothing without a completed contract", () => {
        const game = scenario({ seats: [assassinSeat({ hand: [FUNDED] }), VICTIM] });
        game.play(FUNDED).settle();
        expect(boardNames(game, 1)).toEqual([]);
      });
    });

    describe("Viral Accelerant", () => {
      const VIRAL = "viral accelerant|3";

      it("copies one token per disease name, and the copies infect the defender", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [ESCAPED, VIRAL], resources: 1, board: ["frailty|0", "frailty|0", "inertia|0"] }),
          VICTIM,
        ] });
        game.play(ESCAPED).blockWith().react(VIRAL);
        expect(boardNames(game, 1).sort()).toEqual(["Frailty", "Inertia"]);
        expect(boardNames(game, 0).sort()).toEqual(["Frailty", "Frailty", "Inertia"]);
        // Escaped Subject has go again only against an infected hero.
        game.settle().expectAP(0, 1);
      });

      it("creates nothing without a disease token", () => {
        const game = scenario({ seats: [assassinSeat({ hand: [ESCAPED, VIRAL], resources: 1 }), VICTIM] });
        game.play(ESCAPED).blockWith().react(VIRAL).settle();
        expect(boardNames(game, 1)).toEqual([]);
        game.expectAP(0, 0);
      });

      it("counts toward Sick Intent's contract for each copy", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [SICK_INTENT, VIRAL], resources: 2, board: ["frailty|0", "inertia|0"] }),
          VICTIM,
        ] });
        game.play(SICK_INTENT).blockWith().react(VIRAL);
        expect(boardNames(game, 1).sort()).toEqual(["Frailty", "Inertia"]);
        expect(silverCount(game)).toBe(2);
        expect(game.state.players[0]!.flags.contractCompletionsThisTurn).toBe(2);
      });
    });

    describe("Emergency Services", () => {
      const EMERGENCY = "emergency services|3";
      const start = (defenderBoard: string[]) => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [EMERGENCY], board: ["bloodrot pox|0"] }),
          { ...VICTIM, board: defenderBoard },
        ] });
        game.play(EMERGENCY).settle();
        return game;
      };

      it("offers one disease per name and pays two Silver per cure", () => {
        const game = start(["frailty|0", "frailty|0", "inertia|0"]);
        const options = game.state.pendingDecision?.options ?? [];
        expect(options).toHaveLength(2);
        game.chooseMany(options).settle();
        expect(boardNames(game, 1)).toEqual(["Frailty"]);
        expect(silverCount(game)).toBe(4);
        expect(boardNames(game, 0)).toContain("Bloodrot Pox");
      });

      it("can cure a single disease", () => {
        const game = start(["frailty|0", "inertia|0"]);
        game.chooseMany([game.state.pendingDecision!.options![0]!]).settle();
        expect(boardNames(game, 1)).toHaveLength(1);
        expect(silverCount(game)).toBe(2);
      });

      it("can choose to cure nothing", () => {
        const game = start(["frailty|0"]);
        game.chooseMany([]).settle();
        expect(boardNames(game, 1)).toEqual(["Frailty"]);
        expect(silverCount(game)).toBe(0);
      });

      it("does not ask when the opponent has no disease", () => {
        const game = start([]);
        expect(game.state.pendingDecision).toBeNull();
        expect(silverCount(game)).toBe(0);
      });
    });
  });

  describe("Mastery Pack Assassin contract rewards and equipment", () => {
    const ARAKNI = "arakni|0";
    const UZURI = "uzuri|0";
    const CARRIERS = "patron's lockbox: carriers|3";
    const SERUMS = "patron's lockbox: serums|3";
    const STIMTEK = "stimtek vest|0";
    const BRIM = "bounty brim|0";
    const CLOAK = "scouting cloak|0";
    const SPREES = "murder sprees|0";
    const WRAPS = "plaguewarden's wraps|0";
    const STEP_OVERS = "step overs|0";
    const ONE_CONTRACT = "plunder the poor|1";
    const THREE_CONTRACTS = "eradicate|2";
    const FEVERISH = "feverish strike|1";
    const ONE_TARGET = ["head jab|1"];
    const THREE_TARGETS = ["head jab|2", "flex claws|2", "wrecker romp|2", "head jab|1"];
    const LONG_TARGET_DECK = Array<string>(12).fill("head jab|1");
    const victim = (deck: string[] = ONE_TARGET, spec: Partial<SeatSpec> = {}): SeatSpec => ({
      hero: "dorinthea", weapons: [], equipment: NO_EQUIPMENT, deck, ...spec,
    });
    const passTurnCycle = (game: ReturnType<typeof scenario>) => game.endTurn().endTurn();
    const playDecliningArakniLook = (game: ReturnType<typeof scenario>, key: string) =>
      game.play(key).chooseOption("no");
    const armedLabels = (game: ReturnType<typeof scenario>) =>
      game.state.modifiers.filter((modifier) => !modifier.consumed).map((modifier) => modifier.ongoingLabel);

    it("implements every printing, with Blade Break only on the pieces that print it", () => {
      for (const id of ["MPA013", "MPA014", "MPA016"]) expect(cardData[id]!.keywords).toEqual(["Blade Break"]);
      for (const id of ["MPA010", "MPA011", "MPA012"]) expect(cardData[id]!.keywords ?? []).toEqual([]);
      for (const id of ["MPA010", "MPA011", "MPA012", "MPA013", "MPA014", "MPA016", "MPA065", "MPA066"]) {
        expect(isImplemented(cardData[id]!)).toBe(true);
      }
    });

    describe("Patron's Lockbox: Carriers", () => {
      it("destroys itself for a disease of your choice under the opposing hero's control", () => {
        const game = scenario({ seats: [assassinSeat({ hand: [ONE_CONTRACT], board: [CARRIERS] }), victim()] });

        game.play(ONE_CONTRACT).blockWith().settle();
        expect(game.state.pendingDecision?.player).toBe(0);
        expect(game.state.pendingDecision?.chooseHook).toBe("mpa-carriers-disease");
        game.chooseOption(INERTIA_TOKEN).settle();

        expect(boardNames(game, 1)).toEqual(["Inertia"]);
        expect(boardNames(game, 0)).toEqual(["Silver"]);
        game.expectInZone(0, CARRIERS, "graveyard");
      });

      it("stays in play without a completed contract", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [ONE_CONTRACT], board: [CARRIERS] }),
          victim(["wrecker romp|1"]),
        ] });

        game.play(ONE_CONTRACT).blockWith().settle();

        expect(boardNames(game, 0)).toEqual(["Patron's Lockbox: Carriers"]);
        expect(boardNames(game, 1)).toEqual([]);
      });
    });

    describe("Patron's Lockbox: Serums", () => {
      it("destroys itself for an action point", () => {
        const game = scenario({ seats: [assassinSeat({ hand: [ONE_CONTRACT], board: [SERUMS] }), victim()] });

        game.play(ONE_CONTRACT).blockWith().settle();

        game.expectAP(0, 1).expectInZone(0, SERUMS, "graveyard");
      });

      it("grants one point when one contract completes three times", () => {
        const game = scenario({ seats: [
          assassinSeat({ hand: [THREE_CONTRACTS], board: [SERUMS], resources: 1 }),
          victim(THREE_TARGETS),
        ] });

        game.play(THREE_CONTRACTS).blockWith().settle();

        game.expectAP(0, 1);
      });
    });

    describe("Stimtek Vest", () => {
      const vest = (heroKey: string, spec: Partial<SeatSpec> = {}) =>
        assassinSeat({ heroKey, equipment: { ...NO_EQUIPMENT, chest: STIMTEK }, ...spec });

      it("as Uzuri, may be destroyed for 2 resources", () => {
        const game = scenario({ seats: [vest(UZURI, { hand: [ONE_CONTRACT] }), victim()] });

        game.play(ONE_CONTRACT).blockWith().settle();
        game.chooseOption("yes").settle();

        game.expectNoEquipment(0, "chest").expectInZone(0, STIMTEK, "graveyard").expectResources(0, 2);
      });

      it("as Uzuri, can be declined and stays equipped", () => {
        const game = scenario({ seats: [vest(UZURI, { hand: [ONE_CONTRACT] }), victim()] });

        game.play(ONE_CONTRACT).blockWith().settle();
        game.chooseOption("no").settle();

        game.expectEquipped(0, "chest", STIMTEK).expectResources(0, 0);
      });

      it("isn't offered again after it was destroyed by an earlier completion", () => {
        const game = scenario({ seats: [
          vest(UZURI, { hand: [THREE_CONTRACTS], resources: 1 }),
          victim(THREE_TARGETS),
        ] });

        game.play(THREE_CONTRACTS).blockWith().settle();
        game.chooseOption("yes").settle();

        expect(game.state.pendingDecision?.kind).not.toBe("optional-effect");
        game.expectResources(0, 2);
      });

      it("does nothing for another hero", () => {
        const game = scenario({ seats: [vest("dr. mortimer|0", { hand: [ONE_CONTRACT] }), victim()] });

        game.play(ONE_CONTRACT).blockWith().settle();

        game.expectEquipped(0, "chest", STIMTEK).expectResources(0, 0);
      });
    });

    describe("Bounty Brim", () => {
      const brim = (heroKey: string, spec: Partial<SeatSpec> = {}) =>
        assassinSeat({ heroKey, equipment: { ...NO_EQUIPMENT, head: BRIM }, ...spec });

      it("isn't activatable for another hero", () => {
        const game = scenario({ seats: [brim(UZURI), victim()] });

        expect(() => game.activate(BRIM)).toThrow(/no legal/);
        game.expectEquipped(0, "head", BRIM);
      });

      it("as Arakni, creates a Silver on every contract that turn, with go again", () => {
        const game = scenario({ seats: [
          brim(ARAKNI, { hand: [THREE_CONTRACTS], resources: 1 }),
          victim(THREE_TARGETS),
        ] });

        game.activate(BRIM).settle().expectAP(0, 1).expectInZone(0, BRIM, "graveyard");
        expect(armedLabels(game)).toContain("whenever you complete a contract, create a Silver token");
        playDecliningArakniLook(game, THREE_CONTRACTS).blockWith().settle();

        expect(silverCount(game)).toBe(6);
      });

      it("adds nothing unless activated", () => {
        const game = scenario({ seats: [brim(ARAKNI, { hand: [ONE_CONTRACT] }), victim()] });

        playDecliningArakniLook(game, ONE_CONTRACT).blockWith().settle();

        expect(silverCount(game)).toBe(1);
      });

      it("adds nothing on a later turn", () => {
        const game = scenario({ seats: [brim(ARAKNI, { hand: [ONE_CONTRACT] }), victim(LONG_TARGET_DECK)] });

        game.activate(BRIM).settle();
        passTurnCycle(game);
        expect(armedLabels(game)).toEqual([]);
        playDecliningArakniLook(game, ONE_CONTRACT).blockWith().settle();

        expect(silverCount(game)).toBe(1);
      });
    });

    describe("Scouting Cloak", () => {
      const cloak = (spec: Partial<SeatSpec> = {}) =>
        assassinSeat({ equipment: { ...NO_EQUIPMENT, chest: CLOAK }, ...spec });

      it("is an attack reaction, not an action", () => {
        const game = scenario({ seats: [cloak(), victim()] });

        expect(() => game.activate(CLOAK)).toThrow(/no legal/);
      });

      it("gains 1 life on every contract that turn", () => {
        const game = scenario({ seats: [cloak({ hand: [THREE_CONTRACTS], resources: 1 }), victim(THREE_TARGETS)] });
        const life = game.state.players[0]!.life;

        game.play(THREE_CONTRACTS).blockWith().activate(CLOAK).settle();
        game.expectInZone(0, CLOAK, "graveyard");

        game.expectLife(0, life + 3);
      });

      it("gains nothing unless activated", () => {
        const game = scenario({ seats: [cloak({ hand: [ONE_CONTRACT] }), victim()] });
        const life = game.state.players[0]!.life;

        game.play(ONE_CONTRACT).blockWith().settle();

        game.expectLife(0, life);
      });

      it("gains nothing on a later turn", () => {
        const game = scenario({ seats: [
          cloak({ hand: ["wounding blow|3", ONE_CONTRACT] }),
          victim(LONG_TARGET_DECK),
        ] });
        const life = game.state.players[0]!.life;

        game.play("wounding blow|3").blockWith().activate(CLOAK).settle();
        game.expectInZone(0, CLOAK, "graveyard");
        passTurnCycle(game);
        expect(armedLabels(game)).toEqual([]);
        game.play(ONE_CONTRACT).blockWith().settle();

        expect(silverCount(game)).toBe(1);
        game.expectLife(0, life);
      });
    });

    describe("Murder Sprees", () => {
      const sprees = (spec: Partial<SeatSpec> = {}) =>
        assassinSeat({ equipment: { ...NO_EQUIPMENT, legs: SPREES }, ...spec });

      it("gains only one action point when one contract completes three times", () => {
        const game = scenario({ seats: [sprees({ hand: [THREE_CONTRACTS], resources: 1 }), victim(THREE_TARGETS)] });

        game.activate(SPREES).settle().expectAP(0, 1).expectInZone(0, SPREES, "graveyard");
        expect(armedLabels(game)).toContain("the next time you complete a contract, gain an action point");
        game.play(THREE_CONTRACTS).blockWith().settle();

        game.expectAP(0, 1);
        expect(armedLabels(game)).toEqual([]);
      });

      it("gains nothing unless activated", () => {
        const game = scenario({ seats: [sprees({ hand: [ONE_CONTRACT] }), victim()] });

        game.play(ONE_CONTRACT).blockWith().settle();

        game.expectEquipped(0, "legs", SPREES).expectAP(0, 0);
      });

      it("gains nothing on a later turn", () => {
        const game = scenario({ seats: [sprees({ hand: [ONE_CONTRACT] }), victim(LONG_TARGET_DECK)] });

        game.activate(SPREES).settle();
        passTurnCycle(game);
        game.play(ONE_CONTRACT).blockWith().settle();

        expect(silverCount(game)).toBe(1);
        game.expectAP(0, 0);
      });
    });

    describe("Plaguewarden's Wraps", () => {
      const wraps = (spec: Partial<SeatSpec> = {}) =>
        assassinSeat({ equipment: { ...NO_EQUIPMENT, arms: WRAPS }, hand: [FEVERISH], resources: 2, ...spec });
      const hitWithWraps = (game: ReturnType<typeof scenario>) =>
        game.play(FEVERISH).blockWith().activate(WRAPS, { targetCard: FEVERISH }).settle();

      it("needs an Assassin attack action card to target", () => {
        const game = scenario({ seats: [
          wraps({ hand: ["wounding blow|3"], board: ["frailty|0"] }),
          victim(),
        ] });

        game.play("wounding blow|3").blockWith();

        expect(() => game.activate(WRAPS, { targetCard: "wounding blow|3" })).toThrow(/no legal/);
        game.expectEquipped(0, "arms", WRAPS);
      });

      it("hits with no disease and gives nothing", () => {
        const game = scenario({ seats: [wraps(), victim()] });

        hitWithWraps(game);

        game.expectInZone(0, WRAPS, "graveyard");
        expect(game.state.pendingDecision?.chooseHook).toBeUndefined();
        expect(boardNames(game, 1)).toEqual([]);
      });

      it("gives a lone disease without asking", () => {
        const game = scenario({ seats: [wraps({ board: ["frailty|0"] }), victim()] });

        hitWithWraps(game);

        expect(game.state.pendingDecision?.chooseHook).toBeUndefined();
        expect(boardNames(game, 0)).toEqual([]);
        expect(boardNames(game, 1)).toEqual(["Frailty"]);
      });

      it("asks which disease to give when you control several", () => {
        const game = scenario({ seats: [wraps({ board: ["frailty|0", "inertia|0"] }), victim()] });

        hitWithWraps(game);
        expect(game.state.pendingDecision?.chooseHook).toBe("mpa-plaguewarden-give");
        game.chooseCard("inertia|0").settle();

        expect(boardNames(game, 0)).toEqual(["Frailty"]);
        expect(boardNames(game, 1)).toEqual(["Inertia"]);
      });

      it("gives nothing without the activation", () => {
        const game = scenario({ seats: [wraps({ board: ["frailty|0"] }), victim()] });

        game.play(FEVERISH).blockWith().settle();

        expect(boardNames(game, 0)).toEqual(["Frailty"]);
        expect(boardNames(game, 1)).toEqual([]);
      });
    });

    describe("Step Overs", () => {
      const DEFENSE_REACTION = "unmovable|3";
      const steps = (spec: Partial<SeatSpec> = {}) =>
        assassinSeat({ equipment: { ...NO_EQUIPMENT, legs: STEP_OVERS }, hand: [FEVERISH], resources: 2, ...spec });
      const defenderSeat = (spec: Partial<SeatSpec>) => victim(["wrecker romp|1"], { resources: 3, ...spec });

      it("is illegal before the defending hero plays a defense reaction", () => {
        const game = scenario({ seats: [steps(), defenderSeat({ hand: [DEFENSE_REACTION] })] });

        game.play(FEVERISH).blockWith();

        expect(() => game.activate(STEP_OVERS, { targetCard: FEVERISH })).toThrow(/no legal/);
      });

      it.each<[string, Partial<SeatSpec>]>([
        ["hand", { hand: [DEFENSE_REACTION] }],
        ["arsenal", { arsenalFaceDown: [DEFENSE_REACTION] }],
      ])("grants go again after a defense reaction from %s", (_zone, spec) => {
        const game = scenario({ seats: [steps(), defenderSeat(spec)] });

        game.play(FEVERISH).blockWith().passPriority().react(DEFENSE_REACTION, { settle: false }).passPriority();
        game.activate(STEP_OVERS, { targetCard: FEVERISH }).settle();

        game.expectInZone(0, STEP_OVERS, "graveyard").expectAP(0, 1);
      });

      it("doesn't count a defense reaction from an earlier chain link", () => {
        const game = scenario({ seats: [
          steps({ hand: ["head jab|1", FEVERISH] }),
          defenderSeat({ hand: [DEFENSE_REACTION] }),
        ] });

        game.play("head jab|1").blockWith().passPriority().react(DEFENSE_REACTION).settle();
        game.play(FEVERISH).blockWith();

        expect(() => game.activate(STEP_OVERS, { targetCard: FEVERISH })).toThrow(/no legal/);
      });
    });

    it.each([
      [CLOAK, "chest"],
      [WRAPS, "arms"],
      [STEP_OVERS, "legs"],
    ] as const)("%s re-equips from the graveyard for 2 Silver", (key, slot) => {
      const game = scenario({
        active: 1,
        seats: [
          assassinSeat({ graveyard: [key], board: ["silver|0", "silver|0", "silver|0"] }),
          victim(),
        ],
      });

      game.endTurn();
      game.chooseOption("yes");

      game.expectEquipped(0, slot, key).expectNotInZone(0, key, "graveyard");
      expect(silverCount(game)).toBe(1);
    });

    it("isn't offered a re-equip with fewer than 2 Silver", () => {
      const game = scenario({
        active: 1,
        seats: [assassinSeat({ graveyard: [CLOAK], board: ["silver|0"] }), victim()],
      });

      game.endTurn();

      game.expectInZone(0, CLOAK, "graveyard");
      expect(game.state.pendingDecision?.chooseHook).toBeUndefined();
      expect(silverCount(game)).toBe(1);
    });
  });

  describe("Self-determination", () => {
    const SELF = "self-determination|3";
    const HEAD_JAB = "head jab|1";
    const ATTACKER: SeatSpec = { hero: "rhinar", weapons: [], equipment: NO_EQUIPMENT, resources: 5 };
    const PROTECTED: SeatSpec = { hero: "dorinthea", hand: [SELF], weapons: [], equipment: NO_EQUIPMENT };

    /** The attacker plays `key` and the defender discards Self-determination in response. */
    const respond = (attacker: Partial<SeatSpec>, key: string, defender: Partial<SeatSpec> = {}) => {
      const game = scenario({ seats: [
        { ...ATTACKER, ...attacker },
        { ...PROTECTED, ...defender, hand: [SELF, ...(defender.hand ?? [])] },
      ] });
      game.play(key, { settle: false }).passPriority().activate(SELF).settle();
      return game;
    };

    it("is a 4-power attack that discards as an instant in either player's turn", () => {
      const card = cardData.MPA142!;
      expect(card).toMatchObject({ name: "Self-determination", pitch: 3, cost: 2, attack: 4, defense: 3 });
      expect(isImplemented(card)).toBe(true);

      const own = scenario({ seats: [{ ...ATTACKER, hand: [SELF] }, PROTECTED] });
      own.activate(SELF);
      own.expectInZone(0, SELF, "graveyard");
      own.expectAP(0, 1);

      const opposing = respond({ hand: [HEAD_JAB] }, HEAD_JAB);
      opposing.expectInZone(1, SELF, "graveyard");

      const played = scenario({ seats: [{ ...ATTACKER, hand: [SELF] }, { ...PROTECTED, hand: [] }] });
      played.play(SELF).blockWith().settle().expectFinalAttack(4);
    });

    it("shows an ongoing effect for the rest of the turn", () => {
      const game = respond({ hand: [HEAD_JAB] }, HEAD_JAB);
      const modifier = game.state.modifiers.find((candidate) => candidate.prohibitsOpponentTokenCreation);
      expect(modifier).toMatchObject({
        seat: 1,
        scope: "until-end-of-turn",
        ongoingLabel: "opponents can't create tokens under your control",
        ongoingLabelMessage: { id: "card.effect.mpa.selfdetermination" },
      });
    });

    it("stops an on-hit token and leaves Sick Intent's contract incomplete", () => {
      const game = respond(assassinSeat({ hand: [SICK_INTENT], resources: 2 }), SICK_INTENT);
      game.blockWith().settle().chooseOption(FRAILTY_TOKEN).settle();

      expect(boardNames(game, 1)).toEqual([]);
      expect(silverCount(game)).toBe(0);
      expect(game.state.players[1]!.flags.createdThisTurn).toBeUndefined();
      game.expectLog("can't be created under");
    });

    it("stops Spawn Bloodrot's token on an Assassin hero", () => {
      const game = respond(assassinSeat({ hand: ["spawn bloodrot|1"], resources: 5 }), "spawn bloodrot|1", { heroKey: "uzuri|0" });
      game.blockWith().settle();
      expect(boardNames(game, 1)).toEqual([]);
    });

    it("stops Viral Accelerant's token copies", () => {
      const game = respond(
        { hand: [HEAD_JAB, "viral accelerant|3"], board: ["frailty|0", "inertia|0"] },
        HEAD_JAB,
      );
      game.blockWith().react("viral accelerant|3").settle();
      game.expectInZone(0, "viral accelerant|3", "graveyard");
      expect(boardNames(game, 1)).toEqual([]);
      expect(boardNames(game, 0).sort()).toEqual(["Frailty", "Inertia"]);
    });

    it("protects an attacker from defend triggers and Traps", () => {
      const defend = scenario({ seats: [
        { ...PROTECTED, hand: [SELF, HEAD_JAB], resources: 3 },
        { ...ATTACKER, hand: [VIRAL_DIFFUSION] },
      ] });
      defend.activate(SELF).play(HEAD_JAB).blockWith().passPriority().react(VIRAL_DIFFUSION).settle();
      expect(boardNames(defend, 0)).toEqual([]);

      const trap = scenario({ seats: [
        { ...PROTECTED, hand: [SELF, HEAD_JAB], resources: 3 },
        { ...ATTACKER, heroKey: "riptide|0", arsenal: ["frailty trap|1"] },
      ] });
      trap.activate(SELF).play(HEAD_JAB).blockWith().passPriority().react("frailty trap|1").settle();
      expect(boardNames(trap, 0)).toEqual([]);
    });

    it("blocks only the protected hero's token from an each-hero effect", () => {
      const game = respond({ hand: ["languid pace|3"] }, "languid pace|3");
      expect(boardNames(game, 0)).toEqual(["Inertia"]);
      expect(boardNames(game, 1)).toEqual([]);
    });

    it("keeps the controller's own creations, including under the opponent", () => {
      const game = scenario({ seats: [
        assassinSeat({ hand: [SELF, SICK_INTENT, "banger!|3"], resources: 2 }),
        { ...PROTECTED, hand: [] },
      ] });
      game.activate(SELF).activate("banger!|3");
      expect(boardNames(game, 0)).toEqual(["Silver"]);

      game.play(SICK_INTENT).blockWith().settle().chooseOption(FRAILTY_TOKEN).settle();
      expect(boardNames(game, 1)).toEqual(["Frailty"]);
      expect(silverCount(game)).toBe(2);
    });

    it("does not stop tokens the protected hero is told to create", () => {
      const clash = scenario({ seats: [
        { ...ATTACKER, hand: ["raging onslaught|1"], deck: ["snatch|3"] },
        { ...PROTECTED, hand: [SELF, "test of strength|1"], deck: ["raging onslaught|1"] },
      ] });
      clash.play("raging onslaught|1", { settle: false }).passPriority().activate(SELF).settle();
      clash.blockWith("test of strength|1").settle();
      clash.expectLog("wins the clash");
      expect(boardNames(clash, 1)).toEqual(["Gold"]);

      const missed = respond({ hand: ["take that!|1"] }, "take that!|1", {
        hand: ["raging onslaught|1", "raging onslaught|2", "raging onslaught|3"],
      });
      missed.blockWith("raging onslaught|1", "raging onslaught|2", "raging onslaught|3").settle();
      missed.passActionPhase();
      missed.expectLog("Quicksilver Prodigy creates Might");

      const wager = scenario({ seats: [
        {
          ...ATTACKER,
          heroKey: "olympia, prized fighter|0",
          weapons: ["golden grail|0"],
          hand: ["money where ya mouth is|1"],
        },
        { ...PROTECTED, hand: [SELF, "raging onslaught|1", "raging onslaught|2", "raging onslaught|3"] },
      ] });
      wager.play("money where ya mouth is|1", { settle: false }).passPriority().activate(SELF).settle();
      wager.attackWithWeapon("golden grail|0").chooseOption("yes");
      wager.blockWith("raging onslaught|1", "raging onslaught|2", "raging onslaught|3").settle();
      expect(boardNames(wager, 1)).toEqual(["Gold"]);
    });

    it("offers no replacement decision for a blocked token", () => {
      const seats = (hand: string[]): [SeatSpec, SeatSpec] => [
        { ...ATTACKER, hand: ["ancient earth oak|1"] },
        { ...PROTECTED, hand, graveyard: ["smoldering steel|1"] },
      ];
      const unprotected = scenario({ seats: seats([]) });
      unprotected.play("ancient earth oak|1").blockWith().settle();
      expect(unprotected.state.pendingDecision?.chooseHook).toBe("engine-token-creation-replacement");

      const game = scenario({ seats: seats([SELF]) });
      game.play("ancient earth oak|1", { settle: false }).passPriority().activate(SELF).settle();
      game.blockWith().settle();
      expect(game.state.pendingDecision?.chooseHook ?? "").not.toMatch(/^engine-token/);
      expect(game.state.pendingTokenCreations).toEqual([]);
      expect(boardNames(game, 1)).toEqual([]);
    });

    it("applies Ripple Away to the other hero's token without a replacement order", () => {
      const game = scenario({ seats: [
        { ...ATTACKER, hand: ["languid pace|3"] },
        { ...PROTECTED, hand: [SELF, "ripple away|3"] },
      ] });
      game.play("languid pace|3", { settle: false }).passPriority().activate(SELF, { settle: false }).activate("ripple away|3").settle();
      expect(game.state.pendingDecision?.chooseHook ?? "").not.toMatch(/^engine-token/);
      expect(boardNames(game, 0)).toEqual([]);
      expect(boardNames(game, 1)).toEqual([]);
    });

    it("expires at end of turn", () => {
      const game = scenario({ seats: [
        { ...ATTACKER, hand: [HEAD_JAB, VIRAL_DIFFUSION], deck: [] },
        { ...PROTECTED, hand: [SELF, HEAD_JAB], resources: 3 },
      ] });
      game.play(HEAD_JAB, { settle: false }).passPriority().activate(SELF).settle();
      game.blockWith().settle().endTurn();
      expect(game.state.modifiers.some((modifier) => modifier.prohibitsOpponentTokenCreation)).toBe(false);

      game.state.players[0]!.resources = 3;
      game.play(HEAD_JAB).blockWith().passPriority().react(VIRAL_DIFFUSION).settle();
      expect(boardNames(game, 1).sort()).toEqual(["Bloodrot Pox", "Frailty", "Inertia"]);
    });
  });
});
