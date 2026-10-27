import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { functionalKeyOf } from "../../functional.js";
import { cardData, isImplemented } from "../../index.js";
import { printingId, scenario, type SeatSpec } from "../harness.js";

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

  it("Catch of the Day makes a Go Fish effect create two triggered layers", () => {
    const g = scenario({
      seats: [
        hero("marlynn, treasure hunter|0", {
          weapons: ["hammerhead, harpoon cannon|0"],
          hand: ["catch of the day|3", "blue fin harpoon|3"],
          arsenal: ["king kraken harpoon|1"],
        }),
        foe({ hand: ["lead the charge|3", "head jab|1"] }),
      ],
    });

    g.play("catch of the day|3")
      .play("king kraken harpoon|1", {
        fromArsenal: true,
        pitch: ["blue fin harpoon|3"],
      })
      .blockWith()
      .settle();

    expect(g.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "king-non-attack",
    });
    expect(g.state.log.filter(
      (entry) => entry.publicText?.includes("King Kraken Harpoon triggers: On hit"),
    )).toHaveLength(2);

    const nonAttack = g.state.players[1]!.hand.find(
      (card) => card.cardId === printingId("lead the charge|3"),
    )!;
    g.doRaw({ kind: "choose", optionId: String(nonAttack.instanceId) });

    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window" });
    expect(g.state.stack).toHaveLength(1);

    g.passPriority()
      .passPriority();
    expect(g.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "king-non-attack",
    });

    g.chooseCard("head jab|1");
    expect(g.state.players[0]!.board.filter(
      (card) => card.cardId === printingId("gold|0"),
    )).toHaveLength(1);
  });

  it("Battlefield Beacon chooses a token mode per soul banished this combat chain", () => {
    const yellow = "raging onslaught|2";
    const g = scenario({
      seats: [
        hero("ser boltyn, breaker of dawn|0", {
          hand: [
            "beaming bravado|1", yellow,
            "beaming bravado|1", yellow,
            "beaming bravado|1", yellow,
            "beaming bravado|1", yellow,
            "battlefield beacon|2",
          ],
        }),
        foe(),
      ],
    });

    for (let banished = 0; banished < 4; banished++) {
      g.play("beaming bravado|1")
        .chooseCard(yellow)
        .blockWith()
        .activate("ser boltyn, breaker of dawn|0", { settle: false });
      g.doRaw({
        kind: "choose",
        optionId: String(g.state.players[0]!.soul[0]!.instanceId),
      });
      g.passPriority()
        .passPriority()
        .settle();
    }

    g.play("battlefield beacon|2");
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "beacon-mode",
      options: ["courage", "toughness", "vigor"],
    });

    g.chooseOption("courage")
      .chooseOption("courage")
      .chooseOption("courage");
    expect(g.state.pendingDecision?.options).toEqual(["toughness", "vigor"]);
    g.chooseOption("toughness");

    expect(g.state.players[0]!.board.filter(
      (card) => card.cardId === printingId("courage|0"),
    )).toHaveLength(3);
    expect(g.state.players[0]!.board.filter(
      (card) => card.cardId === printingId("toughness|0"),
    )).toHaveLength(1);
    expect(g.state.players[0]!.board.filter(
      (card) => card.cardId === printingId("vigor|0"),
    )).toHaveLength(0);
  });

  it("Battlefield Beacon counts soul cards banished to play the opening attack", () => {
    const g = scenario({
      seats: [
        hero("ser boltyn, breaker of dawn|0", {
          hand: ["celestial cataclysm|2", "battlefield beacon|2"],
          soul: ["soul food|2", "tome of divinity|2", "beacon of victory|2"],
        }),
        foe(),
      ],
    });

    g.play("celestial cataclysm|2")
      .chooseMany(g.state.players[0]!.soul.map((card) => String(card.instanceId)))
      .settle()
      .blockWith()
      .settle()
      .play("battlefield beacon|2");

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "beacon-mode",
      promptMessage: { values: { amount: 3 } },
      options: ["courage", "toughness", "vigor"],
    });
  });

  it("Battlefield Beacon does not count soul cards banished on a closed combat chain", () => {
    const yellow = "raging onslaught|2";
    const g = scenario({
      seats: [
        hero("ser boltyn, breaker of dawn|0", {
          hand: ["beaming bravado|1", yellow, "lead the charge|3", "battlefield beacon|2"],
        }),
        foe(),
      ],
    });

    g.play("beaming bravado|1")
      .chooseCard(yellow)
      .blockWith()
      .activate("ser boltyn, breaker of dawn|0", { settle: false });
    g.doRaw({
      kind: "choose",
      optionId: String(g.state.players[0]!.soul[0]!.instanceId),
    });
    g.passPriority()
      .passPriority()
      .settle()
      .play("lead the charge|3")
      .play("battlefield beacon|2");

    expect(g.state.pendingDecision).toMatchObject({ kind: "defend" });
    expect(g.state.players[0]!.board).toHaveLength(0);
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

  it("Outside Interference may reveal a Reviled attack action from inventory into hand", () => {
    const g = scenario({
      seats: [
        hero("kayo, underhanded cheat|0", {
          hand: ["outside interference|3"],
          inventory: ["big bully|1", "wind up the crowd|3", "raging onslaught|1"],
        }),
        foe(),
      ],
    });
    const bigBully = g.state.players[0]!.inventory!.find(
      (card) => card.cardId === printingId("big bully|1"),
    )!;

    g.activate("outside interference|3");

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "outside-interference",
      options: ["pass", String(bigBully.instanceId)],
      cardOptions: [null, bigBully.instanceId],
    });
    expect(projectStateFor(g.state, 0).pendingDecision?.optionCards).toMatchObject([
      null,
      { instanceId: bigBully.instanceId, cardId: bigBully.cardId },
    ]);

    g.chooseCard("big bully|1")
      .expectInZone(0, "outside interference|3", "graveyard")
      .expectInZone(0, "big bully|1", "hand");
    expect(g.state.players[0]!.inventory!.map((card) => card.cardId)).toEqual([
      printingId("wind up the crowd|3"),
      printingId("raging onslaught|1"),
    ]);
  });

  it("Numbskull Charm resolves only the modes its controller chooses", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["numbskull charm|2"], deck: ["apex buster|2"], board: ["might|0"] },
        foe(),
      ],
    });

    g.play("numbskull charm|2", { settle: false });
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "numbskull-mode",
      options: ["destroy", "cheer", "pitch", "done"],
    });
    g.chooseOption("cheer");
    expect(g.state.pendingDecision?.options).toEqual(["destroy", "pitch", "done"]);
    // Modes are declared before the card leaves hand.
    g.expectInZone(0, "numbskull charm|2", "hand");
    g.chooseOption("done").settle();

    expect(g.state.players[0]!.flags.cheeredThisTurn).toBe(true);
    g.expectInZone(0, "apex buster|2", "deck");
    expect(g.state.players[0]!.board.map((card) => card.cardId)).toEqual([printingId("might|0")]);
  });

  it("Numbskull Charm destroys one chosen token and pitches a 6-power top card for Vigor", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          hand: ["numbskull charm|2"],
          deck: ["apex buster|2"],
          board: ["confidence|0"],
        },
        foe({ board: ["might|0"] }),
      ],
    });

    g.play("numbskull charm|2", { settle: false })
      .chooseOption("destroy")
      .chooseOption("pitch")
      .chooseOption("done")
      .settle();
    expect(g.state.pendingDecision).toMatchObject({ chooseHook: "numbskull-destroy" });
    g.chooseCard("might|0").settle();

    expect(g.state.players[1]!.board).toHaveLength(0);
    expect(g.state.players[0]!.board.map((card) => card.cardId)).toEqual([
      printingId("confidence|0"),
      printingId("vigor|0"),
    ]);
    expect(g.state.players[0]!.flags.cheeredThisTurn).not.toBe(true);
    g.expectInZone(0, "apex buster|2", "pitch");
  });

  it("Liar's Charm declares any number of modes, then a target hero, as it is played", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["liar's charm|2"] },
        foe({ hand: ["apex buster|2"] }),
      ],
    });
    const suppressed = (seat: number) =>
      g.state.modifiers.some((modifier) => modifier.seat === seat && modifier.suppressesHeroAbilities);

    g.play("liar's charm|2", { settle: false });
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "liar-mode",
      options: ["steal", "boo", "abilities", "done"],
    });
    g.chooseOption("abilities");
    expect(g.state.pendingDecision?.options).toEqual(["steal", "boo", "done"]);
    g.chooseOption("boo").chooseOption("done");
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "liar-target",
      options: g.state.players.map((player) => String(player.hero.instanceId)),
      defaultOption: String(g.state.players[1]!.hero.instanceId),
    });
    g.expectInZone(0, "liar's charm|2", "hand");
    g.doRaw({ kind: "choose", optionId: String(g.state.players[0]!.hero.instanceId) }).settle();

    expect(g.state.players[0]!.flags.booedThisTurn).toBe(true);
    expect(suppressed(0)).toBe(true);
    expect(suppressed(1)).toBe(false);
    g.expectHandSize(1, 1);
  });

  it("Liar's Charm suppresses the opposing hero only for this action phase", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", weapons: [], hand: ["liar's charm|2"] }, foe()],
    });

    g.play("liar's charm|2", { settle: false }).chooseOption("abilities").chooseOption("done");
    g.doRaw({ kind: "choose", optionId: String(g.state.players[1]!.hero.instanceId) }).settle();
    expect(g.state.modifiers.some((modifier) => modifier.seat === 1 && modifier.suppressesHeroAbilities)).toBe(true);

    g.endTurn();
    expect(g.state.modifiers.some((modifier) => modifier.suppressesHeroAbilities)).toBe(false);
  });

  it("Backspin Thrust untaps a cog, then chooses one bonus once per turn", () => {
    const g = scenario({
      seats: [
        hero("tuffnut, bumbling hulkster|0", {
          hand: ["backspin thrust|1"],
          board: ["golden cog|0"],
          equipment: { chest: "rust belt|0" },
        }),
        foe(),
      ],
    });

    g.play("backspin thrust|1")
      .blockWith()
      .activate("rust belt|0", { settle: false });
    let cogOption = g.state.pendingDecision?.options?.[0];
    expect(cogOption).toBeDefined();
    g.doRaw({ kind: "choose", optionId: cogOption! })
      .passPriority()
      .passPriority();
    expect(g.state.players[0]!.board[0]!.tapped).toBe(true);

    g.activate("backspin thrust|1", { settle: false });
    cogOption = g.state.pendingDecision?.options?.[0];
    expect(cogOption).toBeDefined();
    g.doRaw({ kind: "choose", optionId: cogOption! })
      .passPriority()
      .passPriority();
    expect(g.state.pendingDecision?.chooseHook).toBe("backspin-mode");
    g.doRaw({ kind: "choose", optionId: "power" })
      .expectAttackValue(5);
    expect(g.state.players[0]!.board[0]!.tapped).not.toBe(true);

    const attackId = g.state.chain.at(-1)!.attackingCard.instanceId;
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === attackId
    )).toBe(false);
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

  it("Jaws of Victory gets go again only after being cheered this turn", () => {
    const staleCheer = scenario({
      seats: [
        hero("tuffnut, bumbling hulkster|0", {
          life: 20,
          hand: ["jaws of victory|1", "raging onslaught|3"],
        }),
        foe({ life: 10 }),
      ],
    });
    staleCheer.state.players[0]!.flags.cheeredThisTurn = true;

    staleCheer
      .endTurn()
      .endTurn()
      .play("jaws of victory|1", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .expectAP(0, 0);

    const currentCheer = scenario({
      seats: [
        hero("tuffnut, bumbling hulkster|0", {
          life: 20,
          hand: ["jaws of victory|1"],
          resources: 2,
        }),
        foe({ life: 10 }),
      ],
    });
    currentCheer.state.players[0]!.flags.cheeredThisTurn = true;

    currentCheer
      .play("jaws of victory|1")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Jaws of Victory gets go again from a cheer during the reaction or damage step", () => {
    const tuffnutWithJaws = () => scenario({
      seats: [
        hero("tuffnut|0", {
          life: 20,
          hand: ["jaws of victory|1"],
          deck: ["old leather and vim|1"],
          resources: 2,
        }),
        foe({ life: 10 }),
      ],
    });

    const reaction = tuffnutWithJaws();
    reaction.play("jaws of victory|1")
      .blockWith()
      .activate("tuffnut|0")
      .expectLog("The crowd cheers Tuffnut")
      .settle()
      .expectAP(0, 1);

    const damage = tuffnutWithJaws();
    damage.play("jaws of victory|1")
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 4);
    expect(damage.state.players[0]!.flags.cheeredThisTurn).not.toBe(true);
    damage.activate("tuffnut|0")
      .expectLog("The crowd cheers Tuffnut")
      .settle()
      .expectAP(0, 1);
  });

  it("Buckwild gets go again from a 6-power card Tuffnut pitches during the reaction step", () => {
    for (const buckwild of ["buckwild|1", "buckwild|2", "buckwild|3"]) {
      const g = scenario({
        seats: [
          hero("tuffnut|0", { hand: [buckwild], deck: ["old leather and vim|1"], resources: 3 }),
          foe(),
        ],
      });

      g.play(buckwild).blockWith().activate("tuffnut|0").settle().expectAP(0, 1);
    }
  });

  it("Cries of Encore lets its controller pay to play one suspense aura from graveyard", () => {
    const g = scenario({
      seats: [
        hero("pleiades, superstar|0", {
          life: 10,
          hand: ["cries of encore|1"],
          graveyard: ["tension in the air|3", "up on a pedestal|3", "sigil of solace|1"],
          resources: 5,
        }),
        foe({ life: 20 }),
      ],
    });

    g.play("cries of encore|1")
      .blockWith()
      .settle();

    const graveyard = g.state.players[0]!.graveyard;
    const tension = graveyard.find((card) => functionalKeyOf(cardData[card.cardId]!) === "tension in the air|3")!;
    const pedestal = graveyard.find((card) => functionalKeyOf(cardData[card.cardId]!) === "up on a pedestal|3")!;
    const solace = graveyard.find((card) => functionalKeyOf(cardData[card.cardId]!) === "sigil of solace|1")!;
    const canPlayFromGraveyard = (instanceId: number): boolean => legalIntents(g.state, 0).some(
      (intent) => intent.kind === "play-from-zone" && intent.zone === "graveyard" && intent.instanceId === instanceId,
    );
    expect(canPlayFromGraveyard(tension.instanceId)).toBe(true);
    expect(canPlayFromGraveyard(pedestal.instanceId)).toBe(true);
    expect(canPlayFromGraveyard(solace.instanceId)).toBe(false);

    g.play("tension in the air|3", { fromZone: "graveyard" })
      .expectResources(0, 0)
      .expectInZone(0, "tension in the air|3", "board");

    expect(legalIntents(g.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "play-from-zone",
      instanceId: pedestal.instanceId,
      zone: "graveyard",
    }));
  });

  it("Overcrowded can Ambush from arsenal against Command and Conquer", () => {
    const g = scenario({
      seats: [
        foe({ hand: ["command and conquer|1"], resources: 2 }),
        hero("tuffnut, bumbling hulkster|0", {
          arsenalFaceDown: ["overcrowded|3"],
        }),
      ],
    });

    g.play("command and conquer|1", { settle: false });
    const overcrowded = g.state.players[1]!.arsenal[0]!;
    expect(legalIntents(g.state, 1)).toContainEqual({
      kind: "stage-defenders",
      instanceIds: [overcrowded.instanceId],
    });

    g.blockWith("overcrowded|3")
      .settle()
      .expectZoneSize(1, "arsenal", 0)
      .expectFinalDefense(2);
  });

  it("Overcrowded counts different aura token names, not aura cards", () => {
    const g = scenario({
      seats: [
        foe({ hand: ["command and conquer|1"], resources: 2, board: ["ponder|0", "sigil of brilliance|2"] }),
        hero("tuffnut, bumbling hulkster|0", {
          arsenalFaceDown: ["overcrowded|3"],
          board: ["ponder|0", "toughness|0", "core reaction|1"],
        }),
      ],
    });

    g.play("command and conquer|1", { settle: false });
    g.blockWith("overcrowded|3").settle().expectFinalDefense(4);
  });

  it("No Hero Stands Alone gains Ambush only after controlling a Toughness this turn", () => {
    const withoutToughness = scenario({
      active: 1,
      seats: [
        hero("tuffnut|0", { arsenalFaceDown: ["no hero stands alone|2"] }),
        foe({ hand: ["head jab|1"] }),
      ],
    });
    withoutToughness.play("head jab|1", { settle: false });
    const inactiveHero = withoutToughness.state.players[0]!.arsenal[0]!;
    expect(legalIntents(withoutToughness.state, 0)).not.toContainEqual({
      kind: "stage-defenders",
      instanceIds: [inactiveHero.instanceId],
    });

    const withToughness = scenario({
      seats: [
        hero("tuffnut|0", {
          arsenalFaceDown: ["no hero stands alone|2"],
          board: ["toughness|0"],
        }),
        foe({ hand: ["head jab|1"] }),
      ],
    });
    withToughness.endTurn().play("head jab|1", { settle: false });
    const activeHero = withToughness.state.players[0]!.arsenal[0]!;
    expect(legalIntents(withToughness.state, 0)).toContainEqual({
      kind: "stage-defenders",
      instanceIds: [activeHero.instanceId],
    });
  });

  it("Hunter or Hunted? creates a Silver per banish and resumes the reaction window", () => {
    const g = scenario({
      seats: [
        foe({
          heroKey: "hala, bladesaint of the vow|0",
          weapons: ["zenith blade|0"],
          hand: ["head jab|1"],
          deck: ["blunten|2", "blunten|2", "blunten|2", "blunten|2", "head jab|1"],
          arsenalFaceDown: ["raging onslaught|3"],
          resources: 1,
        }),
        hero("arakni, huntsman|0", {
          arsenalFaceDown: ["hunter or hunted?|3"],
          resources: 3,
        }),
      ],
    });

    g.attackWithWeapon("zenith blade|0")
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
      .doRaw({ kind: "choose", optionId: "Blunten" });

    expect(g.state.pendingDecision).toMatchObject({
      kind: "choose-target",
      chooseHook: "hunter-search",
      minimumSelections: 0,
      maximumSelections: 3,
    });
    const searchDecision = projectStateFor(g.state, 1).pendingDecision;
    expect(searchDecision?.optionCards?.filter(Boolean)).toHaveLength(3);
    expect(searchDecision?.lookedCards).toHaveLength(6);
    expect(searchDecision?.lookedCards?.map((card) => cardData[card.cardId]?.name)).toEqual(
      expect.arrayContaining(["Head Jab", "Raging Onslaught"]),
    );

    const options = g.state.pendingDecision!.options!;
    expect(legalIntents(g.state, 1)).toContainEqual({ kind: "choose-many", optionIds: [] });
    expect(applyIntent(g.state, 1, {
      kind: "choose-many",
      optionIds: [...options, "not-an-option"],
    })).toMatchObject({ ok: false, error: "invalid selection count" });

    const selected = options.slice(0, 2);
    g.chooseMany(selected);

    expect(g.state.players[0]!.banish.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "blunten|2",
    )).toHaveLength(3);
    expect(g.state.players[1]!.board.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "silver|0",
    )).toHaveLength(3);
    expect(g.state.pendingDecision).toMatchObject({ kind: "attack-reaction", player: 0 });
    expect(g.state.stack).toHaveLength(0);
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
      .expectAttackValue(6)
      .expectAttackModifier("kayo, strong-arm|0", 6 - cardData[printingId("offensive behavior|3")]!.attack!);
  });

  it("Gauntlets of Tyrannical Rex recognizes an active Diabolic Offering in pitch", () => {
    const g = scenario({
      seats: [
        hero("tuffnut|0", {
          equipment: { arms: "gauntlets of tyrannical rex|0" },
          pitch: ["diabolic offering|3"],
          resources: 1,
        }),
        foe(),
      ],
    });
    const gauntlets = g.state.players[0]!.equipment.arms!;
    expect(legalIntents(g.state, 0).some(
      (intent) => intent.kind === "activate-ability" &&
        intent.sourceInstanceId === gauntlets.instanceId,
    )).toBe(false);

    g.state.players[0]!.flags.banishedSixPlusThisTurn = true;

    g.activate("gauntlets of tyrannical rex|0");

    expect(g.state.players[0]!.equipment.arms?.tapped).toBe(true);
    expect(g.state.modifiers).toContainEqual(expect.objectContaining({ attack: 1 }));
  });

  it("Beat of the Ironsong offers one mode with no Dawnblade counters", () => {
    const g = scenario({
      seats: [
        foe({
          weapons: ["dawnblade|0"],
          hand: ["beat of the ironsong|3"],
          resources: 1,
        }),
        hero("tuffnut|0", { hand: ["head jab|1"] }),
      ],
    });

    g.attackWithWeapon("dawnblade|0")
      .blockWith("head jab|1")
      .react("beat of the ironsong|3", { settle: false });

    expect(g.state.pendingDecision?.chooseHook).toBe("beat-mode");
    expect(g.state.pendingDecision?.prompt).toContain("choose 1 mode");
    expect(g.state.pendingDecision?.options).toEqual([
      "+1 attack",
      "go again",
      "defending cards can't gain defense",
      "damage can't be prevented",
    ]);

    g.chooseOption("+1 attack")
      .expectFinalAttack(4)
      .expectFinalDefense(2);
  });

  it("Beat of the Ironsong chooses distinct modes and stops defending cards gaining defense", () => {
    const g = scenario({
      active: 1,
      seats: [
        foe({
          weapons: ["dawnblade|0"],
          hand: ["beat of the ironsong|3", "wrecker romp|3"],
        }),
        hero("tuffnut|0", {
          board: ["toughness|0"],
          hand: ["head jab|1"],
        }),
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 3 };

    g.endTurn()
      .attackWithWeapon("dawnblade|0", { pitch: ["wrecker romp|3"] })
      .blockWith("head jab|1")
      .react("beat of the ironsong|3", { settle: false })
      .chooseOption("+1 attack");
    expect(g.state.pendingDecision?.options).not.toContain("+1 attack");

    g.chooseOption("defending cards can't gain defense");
    expect(g.state.pendingDecision?.options).toEqual([
      "go again",
      "damage can't be prevented",
    ]);

    g.chooseOption("damage can't be prevented");
    expect(g.state.pendingDecision?.options).toEqual(["go again"]);
    // Modes are declared before the card leaves hand.
    g.expectInZone(0, "beat of the ironsong|3", "hand");

    g.chooseOption("go again")
      .expectFinalAttack(7)
      .expectFinalDefense(2);
    expect(g.state.chain.at(-1)?.flags.unpreventable).toBe(true);
    expect(g.state.players[0]!.actionPoints).toBe(1);
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

  it("Vigorous Smashup leaves its revealed card on top when its bottom choice is declined", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("levia|0", {
          hand: ["vigorous smashup|2", "rise to the challenge|3"],
          deck: ["vigorous smashup|2", "vigorous smashup|3"],
        }),
        foe({
          hand: ["path of same ends|1", "snatch|1"],
          deck: ["raging onslaught|1", "raging onslaught|2"],
        }),
      ],
    });

    g.play("path of same ends|1")
      .blockWith("vigorous smashup|2")
      .settle();
    // the clashed cards ride on the bottom choice, so undo back to it shows them again
    expect(g.state.pendingDecision?.chooseHook).toBe("clash-bottom");
    const revealed = projectStateFor(g.state, 1).pendingDecision?.revealedCards ?? [];
    expect(revealed.map((card) => card.instanceId)).toContain(g.state.players[0]!.deck[0]!.instanceId);
    expect(revealed.map((card) => card.owner).sort()).toEqual([0, 1]);
    g.chooseOption("no");

    expect(g.state.players[0]!.deck[0]?.cardId).toBe(printingId("vigorous smashup|2"));

    const logLengthBeforeRise = g.state.log.length;
    g.play("snatch|1")
      .blockWith("rise to the challenge|3")
      .settle();

    expect(g.state.players[0]!.deck[0]?.cardId).toBe(printingId("vigorous smashup|2"));
    expect(g.state.log.slice(logLengthBeforeRise).some(
      (entry) => entry.publicText?.includes("SUP165"),
    )).toBe(true);
  });

  it("Clench the Upper Hand boos its controller when attacking with more life", () => {
    const g = scenario({
      seats: [
        hero("kayo, strong-arm|0", {
          life: 20,
          hand: ["clench the upper hand|3"],
        }),
        foe({ life: 16 }),
      ],
    });

    g.play("clench the upper hand|3")
      .expectLog("The crowd boos Kayo, Strong-arm");
    expect(g.state.players[0]!.flags.booedThisTurn).toBe(true);
  });

  it("Clench the Upper Hand boos its controller when defending with more life", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("kayo, strong-arm|0", {
          life: 17,
          hand: ["clench the upper hand|3"],
        }),
        foe({ life: 14, hand: ["head jab|1"] }),
      ],
    });

    g.play("head jab|1")
      .blockWith("clench the upper hand|3")
      .settle()
      .expectLog("The crowd boos Kayo, Strong-arm");
    expect(g.state.players[0]!.flags.booedThisTurn).toBe(true);
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

  it("Disperse counts Toughness bonuses toward its 6-defense arsenal trigger", () => {
    const g = scenario({
      seats: [
        hero("pleiades|0", {
          board: ["toughness|0", "toughness|0", "toughness|0"],
          hand: ["disperse|3"],
        }),
        foe({ hand: ["head jab|1"], arsenal: ["raging onslaught|3"] }),
      ],
    });

    g.endTurn()
      .play("head jab|1")
      .blockWith("disperse|3")
      .settle()
      .expectFinalDefense(6) // 3 printed + 1 from each destroyed Toughness
      .expectNotInZone(1, "raging onslaught|3", "arsenal");
    expect(g.state.players[1]!.deck.at(-1)?.cardId).toBe(printingId("raging onslaught|3"));
  });

  it("Disperse leaves the arsenal alone below 6 defense", () => {
    const g = scenario({
      seats: [
        hero("pleiades|0", { board: ["toughness|0"], hand: ["disperse|3"] }),
        foe({ hand: ["head jab|1"], arsenal: ["raging onslaught|3"] }),
      ],
    });

    g.endTurn()
      .play("head jab|1")
      .blockWith("disperse|3")
      .settle()
      .expectFinalDefense(4)
      .expectInZone(1, "raging onslaught|3", "arsenal");
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

  it("No Hero Stands Alone shrinks a weapon only for that chain link", () => {
    const g = scenario({
      seats: [
        foe({
          heroKey: "hala, bladesaint of the vow|0",
          weapons: ["zenith blade|0"],
          hand: ["edict of steel|1"],
          resources: 2,
          deck: ["raging onslaught|3"],
        }),
        hero("tuffnut|0", { hand: ["no hero stands alone|2"], deck: ["raging onslaught|1"] }),
      ],
    });

    g.play("edict of steel|1").attackWithWeapon("zenith blade|0").expectAttackValue(4);
    g.blockWith("no hero stands alone|2").settle();
    g.chooseCard("zenith blade|0").expectFinalAttack(1);
    expect(g.state.log.some((line) => line.publicText?.includes("-3 power") === true)).toBe(true);
    g.attackWithWeapon("zenith blade|0").expectAttackValue(4);
  });

  it("Leave Them Hanging does not intimidate as it leaves at the start of its controller's turn", () => {
    const g = scenario({
      seats: [
        foe({ hand: ["head jab|1"] }),
        hero("pleiades|0", { board: ["leave them hanging|1"] }),
      ],
    });
    g.state.players[1]!.board[0]!.counters = { suspense: 1 };

    g.endTurn()
      .expectNotInZone(1, "leave them hanging|1", "board")
      .expectInZone(0, "head jab|1", "hand");
    expect(g.state.players[1]!.flags.pendingIntimidate ?? 0).toBe(0);
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

describe("SUP — intimidating attacks", () => {
  it.each([
    { card: "battered, beaten, and broken|2", intimidates: 1 },
    { card: "instill fear|1", intimidates: 1 },
    { card: "show no mercy|1", intimidates: 1 },
    { card: "tear down the idols|1", intimidates: 0 },
  ])("$card intimidates a non-Revered hero $intimidates time(s)", ({ card, intimidates }) => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: [card], resources: 3 },
        foe({ hand: ["head jab|1", "head jab|1", "head jab|1"] }),
      ],
    });

    g.play(card).expectPendingReturn(1, intimidates);
  });

  it.each([
    { card: "pack hunt|1", intimidates: 1 },
    { card: "instill fear|1", intimidates: 0 },
  ])("$card attacking an ally intimidates $intimidates time(s)", ({ card, intimidates }) => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: [card], resources: 3 },
        foe({ hand: ["head jab|1", "head jab|1", "head jab|1"], board: ["barnacle|2"] }),
      ],
    });

    g.play(card, { targetAlly: "barnacle|2" }).expectPendingReturn(1, intimidates);
  });

  it("Bully Tactics intimidates only as many times as was paid", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["bully tactics|1"], resources: 3 },
        foe({ hand: ["head jab|1", "head jab|1", "head jab|1"] }),
      ],
    });

    g.play("bully tactics|1").chooseOption("X = 0").expectPendingReturn(1, 0);
  });

  it("Battered, Beaten, and Broken destroys an intimidated card on hit with 3 auras", () => {
    const g = scenario({
      seats: [
        hero("pleiades|0", {
          hand: ["battered, beaten, and broken|2"],
          board: ["toughness|0", "toughness|0", "toughness|0"],
        }),
        foe({ hand: ["head jab|1", "head jab|1"] }),
      ],
    });

    g.play("battered, beaten, and broken|2")
      .expectAttackValue(4)
      .expectPendingReturn(1, 1)
      .blockWith()
      .settle()
      .chooseCard("head jab|1")
      .expectPendingReturn(1, 0)
      .expectInZone(1, "head jab|1", "graveyard");
  });

  it("Battered, Beaten, and Broken checks auras on hit after a reaction-step aura", () => {
    const g = scenario({
      seats: [
        hero("lyath goldmane, vile savant|0", {
          hand: ["battered, beaten, and broken|2"],
          board: ["toughness|0", "toughness|0"],
          resources: 2,
        }),
        foe({ hand: ["head jab|1", "head jab|1"] }),
      ],
    });

    g.play("battered, beaten, and broken|2")
      .expectAttackValue(1)
      .blockWith()
      .activate("lyath goldmane, vile savant|0", { settle: false })
      .passPriority()
      .passPriority()
      .expectInZone(0, "might|0", "board")
      .expectAttackValue(4)
      .settle()
      .chooseCard("head jab|1")
      .expectPendingReturn(1, 0)
      .expectInZone(1, "head jab|1", "graveyard");
  });
});

describe("SUP — Reckless Stampede", () => {
  function stampede(defenders: string[]) {
    const g = scenario({
      seats: [
        hero("kayo, strong-arm|0", {
          hand: ["reckless stampede|1"],
          resources: 2,
          deck: ["raging onslaught|1", "raging onslaught|1", "raging onslaught|1"],
        }),
        foe({ hand: defenders, deck: ["head jab|3", "head jab|3", "head jab|3"] }),
      ],
    });
    return g.play("reckless stampede|1").blockWith(...defenders).settle();
  }

  it("clashes once for each card that defends it", () => {
    const g = stampede(["head jab|1", "head jab|1", "head jab|1"]);
    for (let clash = 0; clash < 3; clash++) {
      g.expectLife(1, 20 - clash - 1);
      g.chooseOption("no").chooseOption("no");
    }
    g.expectLife(0, 20).expectLog("Reckless Stampede triggers: Whenever a card defends this");
  });

  it("lets each hero put their revealed card on the bottom", () => {
    const g = stampede(["head jab|1"]);
    expect(g.state.pendingDecision?.player).toBe(0);
    g.chooseOption("yes");
    expect(g.state.pendingDecision?.player).toBe(1);
    g.chooseOption("no");
    g.expectLife(1, 14) // 1 clash damage, then 7 power into 2 defense
      .expectDeckBottom(0, "raging onslaught|1")
      .expectDeckTop(1, "head jab|3");
  });
});

describe("SUP — Fix the Match", () => {
  it("shuffles before putting the searched card on top, so it is revealed in the clash", () => {
    const g = scenario({
      seats: [
        hero("kayo, strong-arm|0", {
          hand: ["fix the match|2"],
          deck: [...Array<string>(9).fill("raging onslaught|1"), "sink below|1"],
        }),
        foe({ hand: ["head jab|1"], deck: ["head jab|2", "head jab|2", "head jab|2"] }),
      ],
    });

    const logStart = g.state.log.length;
    g.play("fix the match|2").chooseCard("sink below|1").expectDeckTop(0, "sink below|1");
    const log = g.state.log.slice(logStart).map((entry) => entry.publicText ?? "");
    const shuffle = log.findIndex((text) => text.includes("shuffles their deck"));
    expect(shuffle).toBeGreaterThanOrEqual(0);
    expect(log.findIndex((text) => text.includes("put on the top of the deck"))).toBeGreaterThan(shuffle);

    g.blockWith("head jab|1").settle();
    expect(g.state.log.some((entry) => entry.publicText?.includes("reveals Sink Below"))).toBe(true);
  });
});

describe("SUP — The Old Switcheroo", () => {
  it("The Old Switcheroo swaps the revealed decks for its controller's next clash and makes a loser discard", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("levia|0", {
          hand: ["the old switcheroo|3", "vigorous smashup|3"],
          deck: ["inner chi|3"],
        }),
        foe({ hand: ["head jab|1", "snatch|1"], deck: ["raging onslaught|1"] }),
      ],
    });
    g.play("head jab|1", { settle: false })
      .passPriority()
      .activate("the old switcheroo|3")
      .blockWith("vigorous smashup|3")
      .settle()
      .expectLog("Levia reveals Raging Onslaught")
      .chooseCard("snatch|1")
      .chooseOption("no")
      .expectZoneSize(0, "board", 1)
      .expectInZone(1, "snatch|1", "graveyard")
      .expectDeckTop(1, "raging onslaught|1");
  });

  it("The Old Switcheroo swap is consumed by one clash and does not discard on a loss", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("levia|0", {
          hand: ["the old switcheroo|3", "vigorous smashup|3"],
          deck: ["raging onslaught|1"],
        }),
        foe({ hand: ["head jab|1", "snatch|1"], deck: ["inner chi|3"] }),
      ],
    });
    g.play("head jab|1", { settle: false })
      .passPriority()
      .activate("the old switcheroo|3")
      .blockWith("vigorous smashup|3")
      .settle()
      .chooseOption("no")
      .expectZoneSize(0, "board", 0)
      .expectHandSize(1, 1);
    expect(g.state.modifiers.some((modifier) => modifier.swapsNextClashWithSeat !== undefined && !modifier.consumed))
      .toBe(false);
  });
});
