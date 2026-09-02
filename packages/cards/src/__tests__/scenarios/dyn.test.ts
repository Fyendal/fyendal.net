import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, scripts } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
import { scenario } from "../harness.js";

const BLUE = "wrecker romp|3";
const RED = "wrecker romp|1";
const CONTRACT_PRINTINGS = Object.values(cardData)
  .filter((card) => (card.keywords ?? []).some((keyword) => keyword.toLowerCase() === "contract"))
  .sort((a, b) => a.id.localeCompare(b.id));

describe("DYN — registration and heroes", () => {
  it("registers every printing and all heroes", () => {
    expect(cardData.DYN001?.name).toBe("Emperor, Dracai of Aesir");
    expect(cardData.DYN025?.name).toBe("Yoji, Royal Protector");
    expect(cardData.DYN114?.name).toBe("Arakni");
    expect(Object.keys(cardData).filter((id) => id.startsWith("DYN"))).toHaveLength(249);
    expect(scripts.DYN001).toBeDefined();
    expect(scripts.DYN025).toBeDefined();
    expect(scripts.DYN114).toBeDefined();
  });

  it("keeps Contract rules text and structured keywords in sync", () => {
    for (const card of Object.values(cardData)) {
      const hasContractText = /(?:^|\n)Contract\s*-/i.test(card.text);
      const hasContractKeyword = (card.keywords ?? []).some(
        (keyword) => keyword.toLowerCase() === "contract",
      );
      expect(hasContractKeyword, card.id).toBe(hasContractText);
    }
  });

  it("provides a semantic label for Arakni, Huntsman's trigger", () => {
    expect(scripts.DYN113?.triggers?.[0]?.labelMessage).toEqual({
      id: "card.dyn.arakni.opponenttop.look",
    });
  });

  it("uses that semantic label for Arakni, Huntsman's optional decision", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, huntsman|0",
          hand: ["DYN133"],
          resources: 3,
        },
        { hero: "dorinthea", deck: ["head jab|1"] },
      ],
    });

    g.play("DYN133", { settle: false });
    expect(projectStateFor(g.state, 0).stack[0]?.labelMessage).toEqual({
      id: "card.dyn.arakni.opponenttop.look",
    });
    g.settle();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      promptMessage: { id: "card.dyn.arakni.opponenttop.look" },
    });
  });

  it.each(CONTRACT_PRINTINGS)("$id triggers Arakni, Huntsman when played", (contract) => {
    if (contract.cardType === "action") {
      const g = scenario({
        seats: [
          {
            hero: "rhinar",
            heroKey: "arakni, huntsman|0",
            hand: [contract.id],
            resources: 3,
          },
          { hero: "dorinthea" },
        ],
      });
      g.play(contract.id, { settle: false });
      expect(g.state.stack[0]).toMatchObject({
        sourceInstanceId: g.state.players[0]!.hero.instanceId,
        label: "Look at the opponent's top card?",
        defaultOption: "yes",
      });
      return;
    }

    if (contract.cardType === "defense-reaction") {
      const g = scenario({
        seats: [
          { hero: "rhinar", hand: ["head jab|1"] },
          {
            hero: "dorinthea",
            heroKey: "arakni, huntsman|0",
            hand: [contract.id],
            resources: 3,
          },
        ],
      });
      g.play("head jab|1")
        .blockWith()
        .passPriority()
        .react(contract.id, { settle: false });
      expect(g.state.stack[0]).toMatchObject({
        sourceInstanceId: g.state.players[1]!.hero.instanceId,
        label: "Look at the opponent's top card?",
        defaultOption: "yes",
      });
      return;
    }

    throw new Error(`add a Huntsman play scenario for Contract ${contract.cardType} ${contract.id}`);
  });

  it("puts Reincarnate on the deck bottom when it is discarded at random", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["madcap charger|1", "reincarnate|1", BLUE] },
        { hero: "dorinthea" },
      ],
    });
    s.play("madcap charger|1", { pitch: [BLUE] });
    s.expectDeckBottom(0, "reincarnate|1");
    s.blockWith().settle().expectAP(0, 1);
  });

  it("Blessing of Savagery buffs the next attack with enough base power", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["raging onslaught|1", BLUE], board: ["blessing of savagery|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.endTurn().play("raging onslaught|1", { pitch: [BLUE] }).expectAttackValue(10);
  });

  it("Pouncing Qi gets its combo bonus after Crouching Tiger and the Tiger ceases", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["crouching tiger|0", "pouncing qi|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.play("crouching tiger|0").blockWith().settle();
    s.expectNotInZone(0, "crouching tiger|0", "graveyard")
      .expectNotInZone(0, "crouching tiger|0", "banish")
      .play("pouncing qi|1")
      .expectAttackValue(4);
  });

  it("Precision Press adds its Piercing to Spider's Bite", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["precision press|1", BLUE], weapons: ["spider's bite|0"] },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });
    s.play("precision press|1", { pitch: [BLUE] })
      .activate("spider's bite|0")
      .blockWith("ironrot helm|0")
      .expectAttackValue(5);
    expect(s.state.players[0]!.weapons[0]!.grantedKeywords).toBeUndefined();
  });

  it("Piercing is a power gain and is suppressed when attacks can't gain power", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", resources: 2, weapons: ["spider's bite|0"] },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });
    s.state.players[0]!.flags.attacksCannotGainPower = true;
    s.attackWithWeapon("spider's bite|0")
      .blockWith("ironrot helm|0")
      .expectAttackValue(1);
  });

  it("Visit the Imperial Forge grants static Piercing only against equipment", () => {
    const defended = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["visit the imperial forge|1"], weapons: ["spider's bite|0"] },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });
    defended.play("visit the imperial forge|1")
      .attackWithWeapon("spider's bite|0")
      .blockWith("ironrot helm|0")
      .expectAttackValue(5); // 1 base + native piercing 1 + Forge piercing 3

    const undefended = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["visit the imperial forge|1"], weapons: ["spider's bite|0"] },
        { hero: "dorinthea" },
      ],
    });
    undefended.play("visit the imperial forge|1")
      .attackWithWeapon("spider's bite|0")
      .blockWith()
      .expectAttackValue(1);
  });

  it("Spider's Bite previews and applies its delayed defense penalty without a defend trigger", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "arakni, solitary confinement|0",
          resources: 2,
          hand: ["infect|1", "infect|1"],
          weapons: ["spider's bite|0"],
        },
        { hero: "dorinthea", hand: ["raging onslaught|1", "raging onslaught|1"] },
      ],
    });

    s.attackWithWeapon("spider's bite|0").blockWith().settle()
      .play("infect|1");

    const firstBlock = s.state.players[1]!.hand[0]!;
    s.doRaw({ kind: "stage-defenders", instanceIds: [firstBlock.instanceId] });
    expect(projectStateFor(s.state, 1).pendingDecision?.stagedDefense).toBe(2);

    s.blockWith("raging onslaught|1");
    expect(s.state.stack).toHaveLength(0);
    s.settle().expectLife(1, 18).play("infect|1");

    const secondBlock = s.state.players[1]!.hand[0]!;
    s.doRaw({ kind: "stage-defenders", instanceIds: [secondBlock.instanceId] });
    expect(projectStateFor(s.state, 1).pendingDecision?.stagedDefense).toBe(3);
  });

  it("Spider's Bite does not grant its printed Piercing to another attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["infect|1"], weapons: ["spider's bite|0"] },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });

    s.play("infect|1").blockWith("ironrot helm|0").expectAttackValue(3);
  });

  it("allows Rok to attack only when its controller has no cards in hand", () => {
    const holdingCard = scenario({
      seats: [
        { hero: "rhinar", hand: [BLUE], weapons: ["rok|0"] },
        { hero: "dorinthea" },
      ],
    });
    const heldRok = holdingCard.state.players[0]!.weapons[0]!;
    expect(legalIntents(holdingCard.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === heldRok.instanceId,
    )).toBe(false);

    const emptyHand = scenario({
      seats: [
        { hero: "rhinar", resources: 3, weapons: ["rok|0"] },
        { hero: "dorinthea" },
      ],
    });
    const readyRok = emptyHand.state.players[0]!.weapons[0]!;
    expect(legalIntents(emptyHand.state, 0).some((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === readyRok.instanceId,
    )).toBe(true);
    emptyHand.attackWithWeapon("rok|0").expectAttackValue(7);
  });

  it("Arakni looks at the opponent's top card and a completed Contract creates Silver", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: "arakni|0", hand: ["fleece the frail|1"] },
        { hero: "dorinthea", deck: ["flex claws|1"] },
      ],
    });
    s.play("fleece the frail|1");
    expect(s.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      defaultOption: "yes",
    });
    s
      .chooseOption("yes")
      .chooseOption("keep")
      .blockWith()
      .settle()
      .expectInZone(1, "flex claws|1", "banish")
      .expectInZone(0, "silver|0", "board");
  });

  it("Leave No Witnesses completes its contract when it banishes a red card from the deck", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["leave no witnesses|1"] },
        {
          hero: "dorinthea",
          deck: ["flex claws|1"],
          arsenalFaceDown: [BLUE],
        },
      ],
    });

    s.play("leave no witnesses|1")
      .blockWith()
      .settle()
      .expectInZone(1, "flex claws|1", "banish")
      .expectInZone(1, BLUE, "banish")
      .expectInZone(0, "silver|0", "board");
    expect(s.state.players[0]!.board.filter(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "silver|0",
    )).toHaveLength(1);
  });

  it("keeps destroyed Blacktek Whisperers visible on the chain after resolution", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["infect|1"],
          equipment: { legs: "blacktek whisperers|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("infect|1").blockWith()
      .activate("blacktek whisperers|0", { settle: false })
      .passPriority().passPriority();

    s.expectInZone(0, "blacktek whisperers|0", "graveyard");
    expect(projectStateFor(s.state, 0).chain.at(-1)?.reactions).toContainEqual(
      expect.objectContaining({ cardId: "DYN117" }),
    );
  });

  it("Annals of Sutcliffe observes both kinds of cards pitched to its ability", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          hand: [RED, "blessing of occult|1"],
          deck: ["pouncing qi|1"],
          weapons: ["annals of sutcliffe|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.activate("annals of sutcliffe|0", { pitch: [RED, "blessing of occult|1"] })
      .expectHandSize(0, 1)
      .expectInZone(0, "runechant|0", "board");
  });

  it("Blessing of Aether amplifies Aether Quickening enough to Surge", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["aether quickening|1", BLUE], board: ["blessing of aether|1"] },
        { hero: "dorinthea" },
      ],
    });
    s.endTurn()
      .play("aether quickening|1", { pitch: [BLUE] })
      .chooseOption("opposing hero")
      .expectLife(1, 13)
      .expectAP(0, 1);
  });
});

describe("DYN — rules regression coverage", () => {
  it("Emperor attacks directly with the searched Command and Conquer", () => {
    const originalCard = cardData.ARC159;
    const originalScript = scripts.ARC159;
    cardData.ARC159 = {
      id: "ARC159",
      name: "Command and Conquer",
      cardType: "action",
      text: "Defense reactions can't be played this chain link. When this hits a hero, destroy all cards in their arsenal.",
      pitch: 1,
      cost: 2,
      attack: 6,
      defense: 3,
      classes: ["generic"],
      subtypes: ["attack"],
      set: "ARC",
    };
    scripts.ARC159 = {};
    try {
      const s = scenario({
        seats: [
          { hero: "rhinar", heroKey: "emperor, dracai of aesir|0", hand: [BLUE], deck: ["ARC159"] },
          { hero: "dorinthea" },
        ],
      });
      s.activate("emperor, dracai of aesir|0", { pitch: [BLUE] });
      expect(s.state.chain.at(-1)?.attackingCard.cardId).toBe("ARC159");
      expect(projectStateFor(s.state, 0).logEntries).toContainEqual(expect.objectContaining({
        message: {
          id: "card.log.dyn.emperor.search.private",
          values: {
            result: { kind: "card", cardId: "ARC159" },
            card: { kind: "card", cardId: "DYN001" },
          },
        },
        event: expect.objectContaining({ cardId: "ARC159", from: "deck", to: "chain" }),
      }));
      const publicSearch = projectStateFor(s.state, 1).logEntries?.find(
        (entry) => "message" in entry && entry.message.id === "card.log.dyn.emperor.search.public",
      );
      expect(publicSearch).toMatchObject({
        event: { kind: "card-moved", ownerSeat: 0, from: "deck", to: "chain" },
      });
      expect(JSON.stringify(publicSearch)).not.toContain("ARC159");
    } finally {
      if (originalCard) cardData.ARC159 = originalCard;
      else delete cardData.ARC159;
      if (originalScript) scripts.ARC159 = originalScript;
      else delete scripts.ARC159;
    }
  });

  it("Yoji redirects another hero's damage event to himself", () => {
    const s = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", heroKey: "yoji, royal protector|0", hand: [BLUE] },
        { hero: "dorinthea", hand: ["aether quickening|1", BLUE] },
      ],
    });
    s.play("aether quickening|1", { pitch: [BLUE], settle: false }).passPriority()
      .activate("yoji, royal protector|0", { pitch: [BLUE] })
      .chooseOption("your hero")
      .expectLife(0, 19)
      .expectLife(1, 20);
  });
});

describe("DYN — granted hit effects", () => {
  it("Dead Eye grants an aimed arrow a look-and-discard hit effect", () => {
    const s = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "azalea|0",
          weapons: ["death dealer|0"],
          equipment: { head: null, chest: null, arms: null, legs: null },
          hand: ["dead eye|2", "wrecker romp|3"],
          arsenal: ["searing shot|1"],
        },
        { hero: "rhinar", hand: ["snatch|1"] },
      ],
    });
    s.state.players[0]!.arsenal[0]!.counters = { aim: 1 }; // setup stamp
    s.play("dead eye|2", { pitch: ["wrecker romp|3"] });
    s.play("searing shot|1", { fromArsenal: true }).expectAttackValue(7).blockWith().settle();
    // "When this hits a hero, look at their hand and choose a card. They discard it."
    expect(s.state.pendingDecision?.chooseHook).toBe("dead-eye-discard");
    const handIds = s.state.players[1]!.hand.map((card) => card.instanceId);
    expect(s.state.pendingDecision?.cardOptions).toEqual(handIds);
    s.chooseCard("snatch|1").expectInZone(1, "snatch|1", "graveyard");
  });

  it("Dead Eye without an aim counter only pumps the arrow", () => {
    const s = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "azalea|0",
          weapons: ["death dealer|0"],
          equipment: { head: null, chest: null, arms: null, legs: null },
          hand: ["dead eye|2", "wrecker romp|3"],
          arsenal: ["searing shot|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("dead eye|2", { pitch: ["wrecker romp|3"] });
    s.play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectLife(1, 12); // 7 damage + Searing Shot's 1 life loss
    // no aim counter: no granted hit effect, so no decision opens
    expect(s.state.pendingDecision).toBeNull();
  });
});
