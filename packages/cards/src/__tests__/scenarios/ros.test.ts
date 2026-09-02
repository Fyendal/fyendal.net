import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const BLUE = "raging onslaught|3";

it("registers every ROS printing as implemented", () => {
  const cards = Object.values(cardData).filter((card) => card.set === "ROS");
  expect(cards).toHaveLength(258);
  expect(cards.filter((card) => !isImplemented(card)).map((card) => card.id)).toEqual([]);
});

describe("ROS — Earth heroes and Decompose", () => {
  it("Fruits of the Forest can discard itself for 2 life in a priority window", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", life: 15, hand: ["fruits of the forest|1"] },
      ],
    });

    g.play("snatch|1", { settle: false })
      .passPriority()
      .activate("fruits of the forest|1")
      .expectLife(1, 17)
      .expectInZone(1, "fruits of the forest|1", "graveyard");
  });

  it("Florian adds one Runechant to a grouped token-creation effect", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "florian|0",
          weapons: [],
          hand: ["arcane seeds // life|1"],
          banish: ["autumn's touch|1", "autumn's touch|2", "autumn's touch|3", "earth form|3"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("arcane seeds // life|1", { meldSide: "left" }).expectZoneSize(0, "board", 3);
  });

  it("Cadaverous Tilling pays three distinct Decompose cards for +2 power", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["cadaverous tilling|1", BLUE],
          graveyard: ["wounding blow|1", "autumn's touch|1", "autumn's touch|2"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("cadaverous tilling|1", { pitch: [BLUE] })
      .chooseCard("autumn's touch|1")
      .chooseCard("autumn's touch|2")
      .chooseCard("wounding blow|1")
      .expectAttackValue(8)
      .expectZoneSize(0, "banish", 3);
  });

  it("Felling of the Crown makes each hero put a hand card on the bottom", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["felling of the crown|1", BLUE, "autumn's touch|3"],
          graveyard: ["wounding blow|1", "autumn's touch|1", "autumn's touch|2"],
        },
        { hero: "dorinthea", hand: ["snatch|1", "scar for a scar|3"] },
      ],
    });

    g.play("felling of the crown|1", { pitch: [BLUE] })
      .chooseCard("autumn's touch|1")
      .chooseCard("autumn's touch|2")
      .chooseCard("wounding blow|1");

    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      prompt: "Put a card from your hand on the bottom of your deck",
    });
    g.chooseCard("autumn's touch|3");
    expect(g.state.pendingDecision).toMatchObject({
      player: 1,
      prompt: "Put a card from your hand on the bottom of your deck",
    });
    g.chooseCard("snatch|1")
      .expectInZone(0, "autumn's touch|3", "deck")
      .expectInZone(1, "snatch|1", "deck")
      .expectZoneSize(0, "banish", 3);
    expect(g.state.players[0]!.deck.at(-1)?.cardId).toBe(printingId("autumn's touch|3"));
    expect(g.state.players[1]!.deck.at(-1)?.cardId).toBe(printingId("snatch|1"));
  });

  it("Plow Under clears arsenal-only state before the card is drawn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["plow under|2", BLUE],
          graveyard: ["wounding blow|1", "autumn's touch|1", "autumn's touch|2"],
        },
        {
          hero: "dorinthea",
          hand: [BLUE],
          arsenal: ["swordmaster's path|3"],
        },
      ],
    });

    g.play("plow under|2", { pitch: [BLUE] })
      .chooseCard("autumn's touch|1")
      .chooseCard("autumn's touch|2")
      .chooseCard("wounding blow|1");

    expect(g.state.players[1]!.deck.at(-1)).toMatchObject({
      cardId: printingId("swordmaster's path|3"),
    });
    expect(g.state.players[1]!.deck.at(-1)).not.toHaveProperty("faceDown");
    expect(g.state.players[1]!.deck.at(-1)).not.toHaveProperty("arsenalSlot");

    g.blockWith()
      .settle()
      .endTurn()
      .play("swordmaster's path|3", { pitch: [BLUE] })
      .expectAP(1, 1);
  });

  it("Rootbound Carapace counts face-up Colors of Aria as Earth for Decompose", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          hand: ["rootbound carapace|1"],
          graveyard: ["fruits of the forest|1", "colors of aria|1", "wounding blow|1"],
        },
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
    });

    g.play("snatch|1")
      .blockWith()
      .passPriority()
      .react("rootbound carapace|1");
    expect(g.state.pendingDecision?.prompt).toMatch(/first Earth/i);
    g.chooseCard("fruits of the forest|1");
    expect(g.state.pendingDecision?.prompt).toMatch(/second Earth/i);
    g.chooseCard("colors of aria|1");
    expect(g.state.pendingDecision?.prompt).toMatch(/action card/i);
    g.chooseCard("wounding blow|1")
      .expectZoneSize(0, "banish", 3)
      .expectFinalDefense(4)
      .expectLife(0, 20);
  });

  it("Verdance observes life gain and may deal arcane damage during her turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "verdance|0",
          weapons: [],
          life: 10,
          hand: ["fertile ground|1", BLUE],
          banish: ["autumn's touch|1", "autumn's touch|2", "autumn's touch|3", "earth form|3"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("fertile ground|1", { pitch: [BLUE] })
      .chooseOption("opposing hero")
      .expectLife(0, 15)
      .expectLife(1, 19);
  });

  it("Sigil of Sanctuary destroys itself for Arcane Shelter and creates an Earth embodiment", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["chorus of the amphitheater|1", BLUE] },
        { hero: "dorinthea", board: ["sigil of sanctuary|3"] },
      ],
    });
    g.play("chorus of the amphitheater|1", { pitch: [BLUE] })
      .chooseOption("opposing hero")
      .chooseOption("use")
      .expectLife(1, 17)
      .expectInZone(1, "sigil of sanctuary|3", "graveyard")
      .expectInZone(1, "embodiment of earth|0", "board");
  });

  it("Arcane Shelter is not offered for physical damage", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", board: ["sigil of sanctuary|3"] },
      ],
    });
    g.play("snatch|1").blockWith().settle()
      .expectInZone(1, "sigil of sanctuary|3", "board")
      .expectLife(1, 16);
  });
});

describe("ROS — Lightning and Runeblade", () => {
  it("Spellbound Creepers and Machinations stack their action points and give the next Runeblade attack go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 4,
          equipment: { legs: "spellbound creepers|0" },
          hand: [
            "sigil of silphidae|3",
            "head jab|1",
            "machinations of dominion|3",
            "deathly wail|1",
          ],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("sigil of silphidae|3")
      .play("head jab|1")
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .activate("spellbound creepers|0")
      .play("machinations of dominion|3", { asInstant: true })
      .expectAP(0, 2)
      .play("deathly wail|1")
      .expectAP(0, 1);

    expect(projectStateFor(g.state, 0).chain.at(-1)).toMatchObject({
      goAgain: true,
      overpower: true,
    });

    g.blockWith().settle().expectAP(0, 2);
  });

  it("Machinations grants go again when an aura is created after attack declaration", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          hand: [
            "machinations of dominion|3",
            "deathly wail|1",
            "haunting rendition|1",
          ],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("machinations of dominion|3")
      .play("deathly wail|1")
      .expectAP(0, 0);
    expect(projectStateFor(g.state, 0).chain.at(-1)).toMatchObject({
      goAgain: false,
      overpower: true,
    });

    g.blockWith()
      .activate("haunting rendition|1");
    expect(projectStateFor(g.state, 0).chain.at(-1)?.goAgain).toBe(true);

    g.settle().expectAP(0, 1);
  });

  it("Lightning Greaves grants an action point when an instant resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          equipment: { legs: "lightning greaves|0" },
          resources: 1,
          // Keep a second instant available so the first remains visibly on
          // the stack before both players pass priority.
          hand: ["sigil of lightning|3", "sigil of lightning|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("lightning greaves|0")
      .play("sigil of lightning|3", { settle: false })
      .expectAP(0, 1)
      .settle()
      .expectAP(0, 2);
  });

  it("can activate Lightning Greaves with a resource gained from Tunic during Damage Step priority", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["head jab|1"],
          equipment: {
            chest: "fyendal's spring tunic|0",
            legs: "lightning greaves|0",
          },
        },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.equipment.chest!.counters = { energy: 3 };

    g.play("head jab|1")
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 17);
    expect(projectStateFor(g.state, 0).stackContext).toBe("DAMAGE STEP · PRIORITY");

    g.activate("fyendal's spring tunic|0", { settle: false })
      .passPriority()
      .passPriority()
      .expectResources(0, 1);

    expect(g.state.pendingDecision).toMatchObject({
      kind: "priority-window",
      player: 0,
    });
    expect(projectStateFor(g.state, 0).stackContext).toBe("DAMAGE STEP · PRIORITY");

    g.activate("lightning greaves|0")
      .expectResources(0, 0)
      .expectNoEquipment(0, "legs");
  });

  it("Aurora creates an Embodiment of Lightning after a Lightning card was played", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "aurora|0",
          weapons: [],
          resources: 2,
          hand: ["sigil of lightning|3"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("sigil of lightning|3").activate("aurora|0").expectInZone(0, "embodiment of lightning|0", "board");
  });

  it("Electromagnetic Somersault returns the selected attack when the link resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["fry|1"] },
        { hero: "dorinthea", hand: ["electromagnetic somersault|1"] },
      ],
    });
    g.play("fry|1", { settle: false })
      .passPriority()
      .react("electromagnetic somersault|1")
      .chooseCard("fry|1")
      .blockWith()
      .settle()
      .expectInZone(0, "fry|1", "hand")
      .expectNotInZone(0, "fry|1", "graveyard");
  });

  it("Gone in a Flash returns before damage, remains projected on the link, and deals no damage", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["gone in a flash|1", "sigil of lightning|3"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("gone in a flash|1")
      .blockWith()
      .react("sigil of lightning|3", { settle: false })
      .passPriority()
      .passPriority();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      options: ["yes", "no"],
      defaultOption: "yes",
    });

    g.doRaw({ kind: "choose", optionId: "yes" });
    expect(g.state.chain).toHaveLength(1);
    expect(g.state.chain[0]!.flags.attackGone).toBe(true);
    expect(g.state.chain[0]!.attackingCard.cardId).toBe(printingId("gone in a flash|1"));
    expect(projectStateFor(g.state, 0).chain[0]?.attackingCard.cardId)
      .toBe(printingId("gone in a flash|1"));
    g.expectInZone(0, "gone in a flash|1", "hand")
      .settle()
      .expectLife(1, 20)
      .expectAP(0, 0);
    expect(g.state.chain).toHaveLength(0);
  });

  it("Gone in a Flash may return after damage and still grants its existing go again", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["embodiment of lightning|0"],
          hand: ["gone in a flash|1", "sigil of lightning|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("gone in a flash|1")
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 16);
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    expect(projectStateFor(g.state, 0).stackContext).toBe("DAMAGE STEP · PRIORITY");

    g.react("sigil of lightning|3", { settle: false })
      .passPriority()
      .passPriority()
      .chooseOption("yes")
      .expectInZone(0, "gone in a flash|1", "hand")
      .expectLife(1, 16)
      .expectAP(0, 1);
  });

  it("Gone in a Flash keeps Embodiment go again when returned during Damage Step priority", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["embodiment of lightning|0"],
          hand: ["gone in a flash|1", "sigil of lightning|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("gone in a flash|1");
    expect(g.state.chain[0]?.goAgain).toBe(true);

    g.blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 16)
      .expectAP(0, 0);
    expect(projectStateFor(g.state, 0).stackContext).toBe("DAMAGE STEP · PRIORITY");

    g.react("sigil of lightning|3", { settle: false })
      .passPriority()
      .passPriority()
      .chooseOption("yes")
      .expectInZone(0, "gone in a flash|1", "hand")
      .expectAP(0, 1);
  });

  it("Gone in a Flash can return again after being replayed on the next chain link", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["embodiment of lightning|0"],
          hand: ["gone in a flash|1", "sigil of lightning|3", "sigil of lightning|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("gone in a flash|1")
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 16)
      .react("sigil of lightning|3", { settle: false })
      .passPriority()
      .passPriority()
      .chooseOption("yes")
      .expectInZone(0, "gone in a flash|1", "hand")
      .expectAP(0, 1)
      .play("gone in a flash|1")
      .blockWith()
      .react("sigil of lightning|3", { settle: false })
      .passPriority()
      .passPriority();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      options: ["yes", "no"],
    });

    g.chooseOption("yes")
      .expectInZone(0, "gone in a flash|1", "hand")
      .settle()
      .expectLife(1, 16);
  });

  it("Gone in a Flash cannot return during the Resolution Step", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["gone in a flash|1", "sigil of lightning|3"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("gone in a flash|1")
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 16)
      .passPriority()
      .passPriority();
    expect(g.state.chain[0]?.resolved).toBe(true);

    g.react("sigil of lightning|3", { settle: false })
      .passPriority()
      .passPriority()
      .passPriority()
      .passPriority()
      .expectNotInZone(0, "gone in a flash|1", "hand")
      .expectInZone(0, "gone in a flash|1", "graveyard");
    expect(g.state.chain).toHaveLength(0);
  });

  it("Arcane Cussing creates the printed Runechant batch when damage destroys it", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["arcane cussing|1"], hand: ["chorus of the amphitheater|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    g.play("chorus of the amphitheater|3", { pitch: [BLUE] })
      .chooseOption("opposing hero")
      .expectInZone(0, "arcane cussing|1", "graveyard")
      .expectZoneSize(0, "board", 3);
  });

  it("Succumb to Temptation may be played as an instant after Runechant damage", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["runechant|0"],
          hand: ["ball lightning|1", "succumb to temptation|2"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("ball lightning|1")
      .expectLife(1, 19)
      .blockWith();

    expect(g.state.players[0]!.flags.arcaneDamageDealtThisTurn).toBe(true);
    expect(g.state.chain).toHaveLength(1);
    const succumb = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("succumb to temptation|2"),
    )!;
    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: succumb.instanceId,
    }));

    g.react("succumb to temptation|2")
      .expectNotInZone(0, "succumb to temptation|2", "hand");
  });

  it("Succumb to Temptation makes the next Runeblade attack-action hit discard", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: Array(3).fill("runechant|0") as string[],
          hand: ["succumb to temptation|2"],
          banish: ["deathly wail|1"],
        },
        { hero: "dorinthea", hand: ["snatch|1", "scar for a scar|3"] },
      ],
    });

    g.play("deathly wail|1", { fromZone: "banish" })
      .blockWith()
      .react("succumb to temptation|2", { settle: false })
      .passPriority()
      .passPriority();

    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("succumb to temptation|2"),
      label: expect.stringMatching(/next Runeblade attack-action hit/i),
    });
    expect(projectStateFor(g.state, 0).chain.at(-1)?.onHitEffects).toContainEqual({
      sourceCardId: printingId("succumb to temptation|2"),
      text: expect.stringMatching(/look at their hand.*discard/i),
      impact: { discardCards: 1 },
    });

    g.settle();

    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      prompt: expect.stringMatching(/choose a card.*discard/i),
    });
    g.chooseCard("snatch|1")
      .expectInZone(1, "snatch|1", "graveyard")
      .expectZoneSize(1, "hand", 1);
    expect(projectStateFor(g.state, 0).ongoing).not.toContainEqual(
      expect.objectContaining({ cardId: printingId("succumb to temptation|2") }),
    );
  });

  it("Bloodtorn Bodice destroys the chosen aura as an announced activation cost", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", equipment: { chest: "bloodtorn bodice|0" }, board: ["sigil of lightning|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.activate("bloodtorn bodice|0", { settle: false });
    expect(g.state.pendingDecision?.chooseHook).toBe("bloodtorn-cost");
    g.expectInZone(0, "sigil of lightning|3", "board")
      .chooseCard("sigil of lightning|3")
      .expectNotInZone(0, "sigil of lightning|3", "board")
      .expectResources(0, 1);
  });

  it("Flittering Charge gains go again when its controller plays an instant card on its active link", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["flittering charge|1", "sigil of solace|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("flittering charge|1")
      .blockWith()
      .react("sigil of solace|1")
      .settle()
      .expectAP(0, 1);
  });

  it("Flittering Charge does not count an activated ability with instant timing", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          equipment: { legs: "boots of omnis ward|0" },
          hand: ["flittering charge|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("flittering charge|1")
      .blockWith()
      .activate("boots of omnis ward|0")
      .settle()
      .expectAP(0, 0);
  });
});

describe("ROS — Wizard and generic", () => {
  it("Calming Gesture creates a Spectral Shield token", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "zyggy starlight|0",
          equipment: { arms: "calming gesture|0" },
          hand: ["nourishing glow|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("calming gesture|0", { pitch: ["nourishing glow|3"] })
      .expectNoEquipment(0, "arms")
      .expectInZone(0, "spectral shield|0", "board")
      .expectNotInZone(0, "single minded determination|2", "board");
  });

  it("Will of Arcana amps the next arcane damage when pitched", () => {
    const g = scenario({ seats: [{ hero: "rhinar", hand: ["chorus of the amphitheater|3", "will of arcana|3"] }, { hero: "dorinthea" }] });
    g.play("chorus of the amphitheater|3", { pitch: ["will of arcana|3"] }).chooseOption("opposing hero").expectLife(1, 17);
  });

  it("Amp binds to Open the Flood Gates and Surge draws two cards", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["exploding aether|1", "open the flood gates|1", BLUE, "autumn's touch|3"],
          deck: ["wounding blow|1", "wounding blow|2"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("exploding aether|1", { pitch: [BLUE] })
      .play("open the flood gates|1", { pitch: ["autumn's touch|3"] })
      .chooseOption("opposing hero")
      .expectLife(1, 14)
      .expectHandSize(0, 2);
  });

  it("Oscilio's discard cost accepts only an instant and draws a card", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "oscilio|0", weapons: [], hand: ["arcane polarity|3"], deck: ["wounding blow|1"] },
        { hero: "dorinthea" },
      ],
    });
    g.activate("oscilio|0", { settle: false })
      .chooseCard("arcane polarity|3")
      .expectInZone(0, "arcane polarity|3", "graveyard")
      .expectInZone(0, "wounding blow|1", "hand");
  });

  it("Oscilio puts Echoflash's discard trigger above its ability in a reaction window", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1"] },
        {
          hero: "dorinthea",
          heroKey: "oscilio, constella intelligence|0",
          weapons: [],
          hand: ["echoflash|2"],
          deck: ["wounding blow|1"],
        },
      ],
    });

    g.play("head jab|1")
      .blockWith()
      .passPriority()
      .activate("oscilio, constella intelligence|0", { settle: false });
    expect(g.state.pendingDecision).toMatchObject({ chooseHook: "engine-activation-discard" });

    const echoflash = g.state.players[1]!.hand[0]!;
    g.doRaw({ kind: "choose", optionId: String(echoflash.instanceId) })
      .expectLife(0, 20)
      .expectHandSize(1, 0);
    expect(g.state.stack[0]?.label).toBe("Your hero deals 1 arcane damage");
    expect(g.state.stack[1]?.ability).toBe(true);

    g.passPriority().passPriority().expectLife(0, 19).expectHandSize(1, 0);
    g.passPriority().passPriority().expectHandSize(1, 1);
  });

  it("Volzar amps the arcane damage from Echoflash's discard trigger", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "oscilio, constella intelligence|0",
          weapons: ["volzar, meteor storm|0"],
          hand: ["echoflash|2"],
          deck: ["wounding blow|1"],
        },
        {
          hero: "dorinthea",
          resources: 1,
          equipment: { head: "nullrune hood|0" },
        },
      ],
    });

    g.activate("oscilio, constella intelligence|0", { settle: false });
    const echoflash = g.state.players[0]!.hand[0]!;
    g.doRaw({ kind: "choose", optionId: String(echoflash.instanceId) })
      .activate("volzar, meteor storm|0", { settle: false })
      .passPriority()
      .passPriority();

    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(1);
    g.passPriority().passPriority();
    expect(g.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "arcane-barrier",
      options: ["pay 0", "pay 1"],
      arcane: { amount: 2 },
    });
    g.expectLog("Oscilio, Constella Intelligence would deal 2 arcane damage to Dorinthea, Quicksilver Prodigy");
    g.chooseOption("pay 1")
      .expectResources(1, 0)
      .expectLife(1, 19);
    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(0);
  });

  it("Sigil of Aether deals arcane damage when it leaves and amps after dealing damage", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["sigil of aether|3"],
          hand: ["deadwood dirge|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("deadwood dirge|3")
      .chooseCard("sigil of aether|3");
    expect(g.state.pendingDecision?.prompt).toBe("Deal 1 arcane damage to a target");
    g.chooseOption("opposing hero")
      .expectLife(1, 19);
    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(1);
  });

  it("Aether Bindings triggers when a Sigil leaves and can amp Sigil of Aether's damage", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          equipment: { arms: "aether bindings of the third age|0" },
          board: ["sigil of aether|3"],
          hand: ["deadwood dirge|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("aether bindings of the third age|0")
      .play("deadwood dirge|3");
    const sigil = g.state.players[0]!.board.find((card) => card.cardId === printingId("sigil of aether|3"))!;
    g.doRaw({ kind: "choose", optionId: String(sigil.instanceId) });

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-order");
    const ampIndex = g.state.pendingDecision!.optionLabels!.indexOf("Amp 1");
    expect(ampIndex).toBeGreaterThanOrEqual(0);
    g.doRaw({ kind: "choose", optionId: g.state.pendingDecision!.options![ampIndex]! })
      .passPriority().passPriority();
    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(1);

    g.passPriority().passPriority();
    expect(g.state.pendingDecision?.prompt).toBe("Deal 2 arcane damage to a target");
    g.chooseOption("opposing hero")
      .expectLog("Sigil of Aether would deal 2 arcane damage to Dorinthea")
      .expectLife(1, 18);
    expect(g.state.players[0]!.flags.nextArcaneBonus).toBe(1);
  });

  it("Hand Behind the Pen reveals then banishes a matching arsenal card", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["hand behind the pen|1", BLUE] },
        { hero: "dorinthea", arsenalFaceDown: ["mauvrion skies|1"] },
      ],
    });
    g.play("hand behind the pen|1", { pitch: [BLUE] })
      .blockWith()
      .settle()
      .chooseCard("mauvrion skies|1")
      .expectInZone(1, "mauvrion skies|1", "banish");
  });
});

describe("ROS — delayed end-phase effects", () => {
  it("Plan for the Worst discards the target's hand and destroys their arsenal at their next end phase", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["plan for the worst|3"] },
        { hero: "dorinthea", hand: ["snatch|1"], arsenal: ["wrecker romp|3"] },
      ],
    });
    g.play("plan for the worst|3"); // look + trap search (no traps in deck)
    g.endTurn(); // Rhinar's turn ends
    g.endTurn(); // at the beginning of Dorinthea's end phase the effect fires
    // her hand was discarded before drawing up, and her arsenal was destroyed
    expect(
      g.state.players[1]!.hand.some((card) => card.cardId === printingId("snatch|1")),
    ).toBe(false);
    expect(g.state.players[1]!.arsenal).toHaveLength(0);
  });
});

describe("ROS — wager triggers", () => {
  it("Drink 'Em Under the Table offers its wager only when attacking a hero", () => {
    const heroAttack = scenario({ seats: [
      { hero: "rhinar", hand: ["drink 'em under the table|1"], resources: 4 },
      { hero: "dorinthea" },
    ] });
    heroAttack.play("drink 'em under the table|1", { settle: false }).settle();
    expect(heroAttack.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      options: ["yes", "no"],
    });

    const allyAttack = scenario({ seats: [
      { hero: "rhinar", hand: ["drink 'em under the table|1"], resources: 4 },
      { hero: "dorinthea", board: ["barnacle|2"] },
    ] });
    allyAttack.play("drink 'em under the table|1", { targetAlly: "barnacle|2" }).settle();
    expect(allyAttack.state.log.some((entry) => entry.publicText?.includes("wagers with"))).toBe(false);
  });
});
