import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents } from "@fyendal/engine";
import { functionalKeyOf } from "../../functional.js";
import { cardData, isImplemented } from "../../index.js";
import { scenario, type SeatSpec } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function hero(heroKey: string, spec: Partial<SeatSpec> = {}): SeatSpec {
  return {
    hero: "rhinar",
    heroKey,
    weapons: [],
    ...spec,
    equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) },
  };
}

function foe(spec: Partial<SeatSpec> = {}): SeatSpec {
  return {
    hero: "dorinthea",
    weapons: [],
    ...spec,
    equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) },
  };
}

describe("SUP — heroes and the crowd", () => {
  it("registers every SUP printing as an implemented identity", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "SUP");
    expect(cards).toHaveLength(276);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
    expect(new Set(cards.map(functionalKeyOf))).toHaveLength(276);
  });

  it("Light Up the Leaves requires and discards another Earth card for its instant mode", () => {
    const withoutEarth = scenario({
      seats: [hero("tuffnut, bumbling hulkster|0", { hand: ["light up the leaves|1"] }), foe()],
    });
    const sourceId = withoutEarth.state.players[0]!.hand[0]!.instanceId;
    expect(legalIntents(withoutEarth.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: sourceId,
    }));

    const g = scenario({
      seats: [
        hero("tuffnut, bumbling hulkster|0", {
          hand: ["light up the leaves|1", "autumn's touch|3"],
        }),
        foe(),
      ],
    });

    g.activate("light up the leaves|1", { settle: false });
    expect(g.state.pendingDecision?.cardOptions).toHaveLength(1);
    g.chooseCard("autumn's touch|3")
      .expectInZone(0, "light up the leaves|1", "graveyard")
      .expectInZone(0, "autumn's touch|3", "graveyard");
  });

  it("Good Natured Brutality defends for 6 and cheers from an empty hand", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("tuffnut, bumbling hulkster|0", { hand: ["good natured brutality|2"] }),
        foe({ hand: ["head jab|1"] }),
      ],
    });

    g.play("head jab|1")
      .blockWith("good natured brutality|2")
      .settle()
      .expectFinalDefense(6)
      .expectInZone(0, "toughness|0", "board");
  });

  it("Hunter or Hunted? triggers Huntsman before defending and creates a Silver per banish", () => {
    const g = scenario({
      seats: [
        foe({
          hand: ["head jab|1"],
          deck: ["flex claws|1", "flex claws|1", "flex claws|1", "flex claws|1"],
        }),
        hero("arakni, huntsman|0", {
          arsenalFaceDown: ["hunter or hunted?|3"],
          resources: 3,
        }),
      ],
    });

    g.play("head jab|1")
      .blockWith()
      .passPriority()
      .react("hunter or hunted?|3", { settle: false });

    expect(g.state.stack.map((layer) => layer.label)).toEqual([
      "Look at the opponent's top card?",
      "Hunter or Hunted?",
    ]);

    g.passPriority()
      .passPriority()
      .chooseOption("yes")
      .chooseOption("keep")
      .chooseName("Flex Claws");

    expect(g.state.players[0]!.banish.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "flex claws|1",
    )).toHaveLength(4);
    expect(g.state.players[1]!.board.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "silver|0",
    )).toHaveLength(4);
  });

  it("Bait stops its controller playing cards they own but leaves its own abilities usable", () => {
    const g = scenario({
      seats: [
        hero("tuffnut|0", { hand: ["take the bait|1"], deck: ["head jab|2"] }),
        foe({ hand: ["head jab|1"] }),
      ],
    });

    g.play("take the bait|1")
      .chooseCard("head jab|2")
      .endTurn();

    const bait = g.state.players[1]!.board.find(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "bait|0",
    );
    expect(bait?.owner).toBe(0);
    const intents = legalIntents(g.state, 1);
    expect(intents.some((intent) => intent.kind === "play-card")).toBe(false);
    expect(intents.some(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === bait?.instanceId,
    )).toBe(true);
    const ownedCard = g.state.players[1]!.hand.find(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "head jab|1",
    );
    expect(applyIntent(g.state, 1, {
      kind: "play-card",
      instanceId: ownedCard!.instanceId,
      pitchInstanceIds: [],
    })).toEqual({ ok: false, error: "cannot play or activate a card you own" });
  });

  it("Tuffnut pitches a 6-power deck top and cheering creates Toughness", () => {
    const g = scenario({
      seats: [hero("tuffnut|0", { deck: ["old leather and vim|1"] }), foe()],
    });

    g.activate("tuffnut|0")
      .expectLog("The crowd cheers Tuffnut")
      .expectInZone(0, "old leather and vim|1", "pitch")
      .expectInZone(0, "toughness|0", "board");
    expect(g.state.players[0]!.resources).toBe(1);
  });

  it("Kayo makes the current attack's base power 6", () => {
    const g = scenario({
      seats: [
        hero("kayo, strong-arm|0", {
          hand: ["offensive behavior|3", "prime the crowd|3", "prime the crowd|3"],
        }),
        foe(),
      ],
    });

    g.play("offensive behavior|3")
      .blockWith()
      .activate("kayo, strong-arm|0", { pitch: ["prime the crowd|3", "prime the crowd|3"], settle: false })
      .passPriority()
      .passPriority()
      .expectAttackValue(6);
  });

  it("Overturn the Results replaces a failed clash with a win and boos Kayo", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("kayo, strong-arm|0", {
          hand: ["vigorous smashup|3"],
          deck: ["overturn the results|3"],
        }),
        foe({ hand: ["head jab|1"], deck: ["raging onslaught|1"] }),
      ],
    });

    g.play("head jab|1")
      .blockWith("vigorous smashup|3")
      .settle()
      .chooseOption("no")
      .expectLog("The crowd boos Kayo, Strong-arm")
      .expectZoneSize(0, "board", 2);
    expect(g.state.players[0]!.board.every((card) => card.cardId.endsWith("036"))).toBe(true);
  });

  it("Song of Sinew lets its controller reorder the revealed cards", () => {
    const g = scenario({
      seats: [
        hero("tuffnut|0", {
          hand: ["song of sinew|2"],
          deck: ["head jab|1", "head jab|2", "head jab|3", "raging onslaught|1"],
        }),
        foe(),
      ],
    });

    g.play("song of sinew|2", { settle: false });
    expect(g.state.log.some((line) => line.publicText?.includes("reveals") === true)).toBe(false);
    g.expectNotInZone(0, "song of sinew|2", "graveyard")
      .passPriority()
      .passPriority()
      .expectInZone(0, "song of sinew|2", "graveyard");
    expect(g.state.stack.some(
      (layer) => layer.card && functionalKeyOf(cardData[layer.card.cardId]!) === "song of sinew|2",
    )).toBe(false);
    expect(g.state.pendingDecision?.prompt).toContain("bottommost card first");

    g.chooseCard("head jab|2")
      .chooseCard("head jab|1")
      .chooseCard("raging onslaught|1")
      .chooseCard("head jab|3");

    expect(g.state.players[0]!.deck.slice(0, 4).map(
      (card) => functionalKeyOf(cardData[card.cardId]!),
    )).toEqual(["head jab|3", "raging onslaught|1", "head jab|1", "head jab|2"]);
  });

  it("Song of Sinew's pass option keeps the remaining cards in their order", () => {
    const g = scenario({
      seats: [
        hero("tuffnut|0", {
          hand: ["song of sinew|2"],
          deck: ["head jab|1", "head jab|2", "head jab|3", "raging onslaught|1"],
        }),
        foe(),
      ],
    });

    g.play("song of sinew|2", { settle: false });
    g.passPriority().passPriority();
    expect(g.state.pendingDecision?.prompt).toContain("bottommost card first");
    expect(g.state.pendingDecision?.options).toContain("pass");

    g.chooseCard("head jab|3"); // bottommost choice rides on top for now
    g.doRaw({ kind: "choose", optionId: "pass" }); // keep the rest in order

    expect(g.state.pendingDecision).toBeNull();
    expect(g.state.players[0]!.deck.slice(0, 4).map(
      (card) => functionalKeyOf(cardData[card.cardId]!),
    )).toEqual(["head jab|3", "head jab|1", "head jab|2", "raging onslaught|1"]);
  });
});

describe("SUP — tokens and suspense", () => {
  it("Toughness buffs only the first action card used to defend on the opponent's turn", () => {
    const g = scenario({
      seats: [
        hero("tuffnut|0", {
          board: ["toughness|0"],
          hand: ["comeback kid|1", "fight from behind|1"],
        }),
        foe({ hand: ["head jab|1"] }),
      ],
    });

    g.endTurn()
      .expectNotInZone(0, "toughness|0", "board")
      .play("head jab|1")
      .blockWith("comeback kid|1", "fight from behind|1")
      .settle()
      .expectFinalDefense(6); // 3 + 2 printed defense, then Toughness gives the first +1
  });

  it("No Hero Stands Alone gets +3 from a Toughness destroyed at the start of the turn", () => {
    const g = scenario({
      seats: [
        hero("tuffnut|0", {
          board: ["toughness|0"],
          hand: ["no hero stands alone|2"],
          // end-of-turn draw takes the first three; the red one tops the clash
          deck: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2", "raging onslaught|1"],
        }),
        foe({ hand: ["head jab|1"], deck: ["raging onslaught|3"] }),
      ],
    });

    g.endTurn()
      .expectNotInZone(0, "toughness|0", "board") // destroyed at the start of the opponent's turn
      .play("head jab|1")
      .blockWith("no hero stands alone|2")
      .settle();
    g.chooseCard("head jab|1") // clash winner shrinks the attack, not the defender
      .expectFinalDefense(4); // 0 printed + 3 (controlled a Toughness this turn) + 1 (Toughness's bonus)
  });

  it("No Hero Stands Alone gets nothing without a Toughness controlled this turn", () => {
    const g = scenario({
      seats: [
        hero("tuffnut|0", {
          hand: ["no hero stands alone|2"],
          deck: ["raging onslaught|2", "raging onslaught|2", "raging onslaught|2", "raging onslaught|1"],
        }),
        foe({ hand: ["head jab|1"], deck: ["raging onslaught|3"] }),
      ],
    });

    g.endTurn()
      .play("head jab|1")
      .blockWith("no hero stands alone|2")
      .settle();
    g.chooseCard("head jab|1")
      .expectFinalDefense(0);
  });

  it("To Be Continued prevents one damage from the first damage event", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("pleiades|0", { board: ["to be continued...|3"] }),
        foe({ hand: ["head jab|1"] }),
      ],
    });

    g.play("head jab|1").blockWith().settle().expectLife(0, 18);
  });
});
