import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { scenario } from "../harness.js";

const BLUE = "wrecker romp|3";
const RED_SIX = "wrecker romp|1";

describe("EVR — registration and combat designs", () => {
  it("registers the young heroes and all imported printings", () => {
    expect(cardData.EVR019?.name).toBe("Valda Brightaxe");
    expect(cardData.EVR085?.name).toBe("Genis Wotchuneed");
    expect(cardData.EVR120?.name).toBe("Iyslander");
    expect(Object.keys(cardData).filter((id) => id.startsWith("EVR"))).toHaveLength(198);
    expect(scripts.EVR019).toBeDefined();
    expect(scripts.EVR085).toBeDefined();
  });

  it("Hundred Winds counts earlier copies on the combat chain", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["hundred winds|1", "hundred winds|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("hundred winds|1").blockWith().settle();
    expect(s.state.chain).toHaveLength(1);
    s.play("hundred winds|1");
    expect(s.state.chain).toHaveLength(2);
    s.expectAttackValue(4);
  });

  it("a boosted T-Bone requires an equipment defender when one is able", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["t-bone|3", BLUE], deck: ["payload|3"] },
        { hero: "dorinthea", hand: [RED_SIX, RED_SIX] },
      ],
    });
    s.play("t-bone|3", { boost: true });
    const defender = s.state.pendingDecision!.player;
    const equipmentIds = new Set(
      Object.values(s.state.players[defender]!.equipment)
        .filter((card) => card !== undefined)
        .map((card) => card.instanceId),
    );
    const equipmentId = [...equipmentIds][0]!;
    s.doRaw({ kind: "stage-defenders", instanceIds: [equipmentId] });
    const intents = legalIntents(s.state, defender).filter((intent) => intent.kind === "defend");
    expect(intents.length).toBeGreaterThan(0);
    expect(intents.every((intent) => intent.instanceIds.some((id) => equipmentIds.has(id)))).toBe(true);
  });

  it("puts Stalagmite's defend trigger on the stack before creating Frostbite", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "sigil of solace|1"] },
        {
          hero: "dorinthea",
          equipment: { head: "stalagmite, bastion of isenloft|0" },
        },
      ],
    });

    s.play("head jab|1").blockWith("stalagmite, bastion of isenloft|0");

    s.expectNotInZone(0, "frostbite|0", "board");
    expect(s.state.stack[0]?.engineEffect?.kind).toBe("on-defend-hook");
    expect(s.state.pendingDecision?.kind).toBe("priority-window");

    s.settle().expectInZone(0, "frostbite|0", "board");
  });

  it("Fatigue Shot halves only the first attack action played next turn", () => {
    const s = scenario({
      seats: [
        { hero: "dorinthea", hand: [BLUE], arsenal: ["fatigue shot|3"], weapons: ["death dealer|0"] },
        { hero: "rhinar", hand: ["raging onslaught|1", "raging onslaught|1", BLUE] },
      ],
    });
    s.play("fatigue shot|3", { pitch: [BLUE], fromArsenal: true }).blockWith().settle().endTurn()
      .play("raging onslaught|1", { pitch: [BLUE] }).expectAttackValue(4);
  });

  it("Valda creates one Seismic Surge for a card an opponent draws in the action phase", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", heroKey: "valda brightaxe|0" },
        { hero: "dorinthea", hand: ["snatch|1"], deck: [BLUE] },
      ],
    });
    s.play("snatch|1").blockWith().settle();
    s.expectInZone(0, "seismic surge|0", "board");
  });

  it("Pry presents the completed reveal group before the optional bottom", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["pry|3"] },
        { hero: "dorinthea", hand: ["raging onslaught|1", "wrecker romp|3"] },
      ],
    });

    s.play("pry|3");
    s.doRaw({
      kind: "choose",
      optionId: String(s.state.players[1]!.hero.instanceId),
    }).settle().chooseCard("raging onslaught|1");
    expect(s.state.pendingDecision?.chooseHook).toBe("pry-bottom");
    expect(s.state.pendingDecision?.revealedCardIds).toHaveLength(1);
    expect(projectStateFor(s.state, 0).pendingDecision?.revealedCards).toHaveLength(1);
    expect(projectStateFor(s.state, 1).pendingDecision?.revealedCards).toHaveLength(1);
    s.chooseOption("pass");
  });

  it("Mask of the Pouncing Lynx defaults its optional destruction to no", () => {
    const setup = () => scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["head jab|1"],
          deck: ["rising knee thrust|3"],
          equipment: { head: "mask of the pouncing lynx|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    const declined = setup();
    declined.play("head jab|1").blockWith().settle();
    expect(declined.state.pendingDecision).toMatchObject({
      chooseHook: "lynx-destroy",
      defaultOption: "no",
    });
    declined.chooseOption("no").expectEquipped(0, "head", "mask of the pouncing lynx|0");

    const accepted = setup();
    accepted.play("head jab|1").blockWith().settle().chooseOption("yes");
    expect(accepted.state.pendingDecision?.chooseHook).toBe("lynx-search");
    accepted.chooseCard("rising knee thrust|3")
      .expectNoEquipment(0, "head")
      .expectInZone(0, "rising knee thrust|3", "banish");
    const searched = accepted.state.players[0]!.banish.find(
      (card) => cardData[card.cardId]?.name === "Rising Knee Thrust",
    );
    expect(legalIntents(accepted.state, 0).some((intent) =>
      intent.kind === "play-from-zone" && intent.instanceId === searched?.instanceId
    )).toBe(true);
  });
});

describe("EVR — auras, items, and utility", () => {
  it("Imposing Visage pays X plus 3, finds any aura costing X or less, then shuffles on resolution", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["imposing visage|3", BLUE, BLUE],
          deck: ["passing mirage|3", "runeblood incantation|3", "nerves of steel|3", RED_SIX],
        },
        { hero: "dorinthea" },
      ],
    });
    const rngBeforePlay = s.state.rngState;

    s.play("imposing visage|3", { settle: false }).expectResources(0, 0);
    expect(s.state.pendingDecision).toMatchObject({
      chooseHook: "engine-variable-play-x",
      options: ["X = 0", "X = 1", "X = 2", "X = 3"],
    });
    s.expectInZone(0, "imposing visage|3", "hand").expectZoneSize(0, "pitch", 0);

    s.chooseOption("X = 2").expectResources(0, 0).expectZoneSize(0, "pitch", 0);
    expect(s.state.pendingDecision).toMatchObject({
      chooseHook: "engine-variable-play-payment",
      prompt: "Pay 5 resources",
    });

    s.chooseOption("pay 5").expectResources(0, 1).expectZoneSize(0, "pitch", 2);
    expect(s.state.rngState).toBe(rngBeforePlay);
    expect(s.state.pendingDecision?.chooseHook).toBe("visage-search");
    const offeredCardIds = (s.state.pendingDecision?.cardOptions ?? []).flatMap((instanceId) =>
      s.state.players[0]!.deck.find((card) => card.instanceId === instanceId)?.cardId ?? []
    );
    expect(offeredCardIds).toContain(cardData.EVR142!.id);
    expect(offeredCardIds).toContain(cardData.EVR109!.id);
    expect(offeredCardIds).not.toContain(cardData.EVR023!.id);

    s.chooseCard("runeblood incantation|3")
      .expectInZone(0, "runeblood incantation|3", "board")
      .expectInZone(0, "imposing visage|3", "graveyard")
      .expectResources(0, 1)
      .expectAP(0, 1);
    expect(s.state.rngState).not.toBe(rngBeforePlay);
  });

  it("Imposing Visage adds play-cost taxes after X is declared", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["imposing visage|3", BLUE, BLUE] },
        { hero: "dorinthea", board: ["channel lake frigid|3"] },
      ],
    });

    s.play("imposing visage|3", { settle: false });
    expect(s.state.pendingDecision?.options).toEqual(["X = 0", "X = 1", "X = 2"]);
    s.chooseOption("X = 2").expectZoneSize(0, "pitch", 0);
    expect(s.state.pendingDecision).toMatchObject({
      chooseHook: "engine-variable-play-payment",
      prompt: "Pay 6 resources",
    });
  });

  it("Revel in Runeblood creates Runechants after an attack and another non-attack action", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["runeblood incantation|3", BLUE, "head jab|1", "revel in runeblood|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("runeblood incantation|3", { pitch: [BLUE] })
      .play("head jab|1")
      .blockWith()
      .settle();

    expect(s.state.players[0]!.flags.playedAttackAction).toBe(true);
    expect(s.state.players[0]!.flags.attackActionsPlayedThisTurn).toBe(1);
    expect(s.state.players[0]!.flags.nonAttackActionsPlayedThisTurn).toBe(1);

    s.play("revel in runeblood|1");
    expect(s.state.players[0]!.board.filter((card) => cardData[card.cardId]?.name === "Runechant"))
      .toHaveLength(4);
  });

  it("Revel in Runeblood does not count itself as the other non-attack action", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|1", "revel in runeblood|1"] },
        { hero: "dorinthea" },
      ],
    });

    s.play("head jab|1").blockWith().settle().play("revel in runeblood|1");
    s.expectNotInZone(0, "runechant|0", "board");
  });

  it("Revel in Runeblood schedules Runechant cleanup independently of its later zone", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["revel in runeblood|1"], board: ["runechant|0"] },
        { hero: "dorinthea" },
      ],
    });

    s.play("revel in runeblood|1");
    const graveyard = s.state.players[0]!.graveyard;
    const index = graveyard.findIndex((card) => cardData[card.cardId]?.name === "Revel in Runeblood");
    expect(index).toBeGreaterThanOrEqual(0);
    s.state.players[0]!.banish.push(graveyard.splice(index, 1)[0]!);

    s.endTurn();
    s.expectNotInZone(0, "runechant|0", "board");
  });

  it("Revel in Runeblood does not trigger while face down in arsenal", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", arsenal: ["revel in runeblood|1"], board: ["runechant|0"] },
        { hero: "dorinthea" },
      ],
    });

    s.endTurn();
    s.expectInZone(0, "runechant|0", "board");
    expect(s.state.log.some((entry) => entry.publicText?.includes("face-down card triggers: Destroy Runechants"))).toBe(false);
  });

  it("Runeblood Incantation removes a verse and creates a Runechant at the next action phase", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["runeblood incantation|3", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("runeblood incantation|3", { pitch: [BLUE] }).endTurn().endTurn();
    s.expectInZone(0, "runechant|0", "board");
  });

  it("Talisman of Recompense replaces a one-resource pitch with three", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["runeblood incantation|3", RED_SIX], board: ["talisman of recompense|2"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("runeblood incantation|3", { pitch: [RED_SIX] })
      .expectResources(0, 2)
      .expectNotInZone(0, "talisman of recompense|2", "board")
      .expectInZone(0, "talisman of recompense|2", "graveyard");
  });

  it("Talisman of Tithes replaces an opponent's draw during its controller's action phase", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "genis wotchuneed|0", resources: 2, board: ["talisman of tithes|3"] },
        { hero: "dorinthea", hand: [RED_SIX], deck: [BLUE] },
      ],
    });
    s.activate("genis wotchuneed|0").chooseCard(RED_SIX);
    s.expectHandSize(1, 0)
      .expectNotInZone(0, "talisman of tithes|3", "board")
      .expectInZone(0, "talisman of tithes|3", "graveyard");
  });

  it("Vexing Quillhand is an action activation with go again", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", equipment: { arms: "vexing quillhand|0" } },
        { hero: "dorinthea" },
      ],
    });

    s.activate("vexing quillhand|0", { settle: false }).expectAP(0, 0);
    s.settle()
      .expectAP(0, 1)
      .expectNotInZone(0, "vexing quillhand|0", "board")
      .expectInZone(0, "vexing quillhand|0", "graveyard");
    expect(s.state.players[0]!.board.filter((card) => cardData[card.cardId]?.name === "Runechant"))
      .toHaveLength(2);
  });

  it("Timekeeper's Whim played on the opponent's turn goes to the bottom of its deck", () => {
    const s = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          heroKey: "iyslander|0",
          hand: [BLUE],
          arsenalFaceDown: ["timekeeper's whim|3"],
          deck: [BLUE, BLUE, BLUE, BLUE],
        },
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
    });
    s.play("snatch|1").blockWith().passPriority().react("timekeeper's whim|3", { pitch: [BLUE] });
    s.doRaw({ kind: "choose", optionId: String(s.state.players[1]!.hero.instanceId) }).settle().endTurn();
    s.expectInZone(0, "timekeeper's whim|3", "deck");
  });

  it("Potion of Luck shuffles hand and arsenal into the deck and redraws that many", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED_SIX], arsenalFaceDown: [BLUE], deck: ["snatch|1"], board: ["potion of luck|3"] },
        { hero: "dorinthea" },
      ],
    });
    s.activate("potion of luck|3").expectHandSize(0, 2).expectZoneSize(0, "arsenal", 0);
  });
});

describe("EVR — rules regression coverage", () => {
  it("Life of the Party can destroy Crazy Brew instead of paying and gets all modes", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", life: 18, hand: ["life of the party|1"], board: ["crazy brew|3"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("life of the party|1", { alternativeCost: "crazy brew|3" })
      .expectNotInZone(0, "crazy brew|3", "board")
      .expectInZone(0, "crazy brew|3", "graveyard")
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectLife(0, 20)
      .expectAP(0, 1);
  });

  it("Amulet of Intervention can answer lethal non-combat damage", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", life: 3, board: ["amulet of intervention|3"] },
        { hero: "dorinthea", hand: ["aether flare|1", BLUE] },
      ],
    });
    s.play("aether flare|1", { pitch: [BLUE], settle: false }).passPriority();
    s.activate("amulet of intervention|3")
      .expectLife(0, 1)
      .expectNotInZone(0, "amulet of intervention|3", "board")
      .expectInZone(0, "amulet of intervention|3", "graveyard");
  });

  it("Talisman of Featherfoot observes an exact +1 reaction-step effect", () => {
    const s = scenario({
      seats: [
        { hero: "dorinthea", hand: ["razor reflex|3", BLUE], board: ["talisman of featherfoot|2"] },
        { hero: "rhinar" },
      ],
    });
    s.attackWithWeapon(undefined, { pitch: [BLUE] }).blockWith().react("razor reflex|3").settle();
    s.expectAP(0, 1).expectNotInZone(0, "talisman of featherfoot|2", "board");
  });
});
