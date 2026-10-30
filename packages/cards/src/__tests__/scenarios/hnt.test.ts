import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { printingId, scenario } from "../harness.js";

function graveyardIds(g: ReturnType<typeof scenario>, seat: number, key: string): string[] {
  return g.state.players[seat]!.graveyard
    .filter((card) => card.cardId === printingId(key))
    .map((card) => String(card.instanceId));
}

it("registers every HNT printing as implemented", () => {
  const cards = Object.values(cardData).filter((card) => card.set === "HNT");
  expect(cards).toHaveLength(265);
  expect(cards.filter((card) => !isImplemented(card)).map((card) => card.id)).toEqual([]);
});

describe("HNT — Sound the Alarm", () => {
  it("reveals the defending hero's hand and offers every defense reaction when an attack reaction is present", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          hand: ["sound the alarm|1"],
          deck: ["sink below|1", "fate foreseen|2", "wrecker romp|3"],
        },
        {
          hero: "rhinar",
          heroKey: "briar|0",
          hand: ["razor reflex|1", "fry|1"],
        },
      ],
    });

    g.play("sound the alarm|1");

    const revealedView = projectStateFor(g.state, 0);
    expect(revealedView.log.at(-1)).toContain("Razor Reflex");
    expect(revealedView.log.at(-1)).toContain("Fry");
    expect(revealedView.log.at(-1)).toContain("from hand");
    const latestEntry = revealedView.logEntries?.at(-1);
    expect(latestEntry && "event" in latestEntry ? latestEntry.event : undefined).toMatchObject({
      kind: "cards-revealed",
      sourceZone: "hand",
    });
    expect(g.state.pendingDecision?.chooseHook).toBe("sound-alarm");
    const offered = g.state.players[0]!.deck.filter((card) =>
      g.state.pendingDecision?.options?.includes(String(card.instanceId))
    );
    expect(offered.map((card) => cardData[card.cardId]!.cardType)).toEqual([
      "defense-reaction",
      "defense-reaction",
    ]);
    // the revealed hand stays on the decision, so undo back to it shows it again
    expect(revealedView.pendingDecision?.revealedCards?.map((card) => card.cardId).sort()).toEqual(
      g.state.players[1]!.hand.map((card) => card.cardId).sort(),
    );

    g.chooseCard("sink below|1")
      .expectDeckTop(0, "sink below|1");
  });

  it("does not shuffle the deck when the optional defense reaction search is declined", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          hand: ["sound the alarm|1"],
          deck: ["sink below|1", "fate foreseen|2", "wrecker romp|3"],
        },
        {
          hero: "rhinar",
          heroKey: "briar|0",
          hand: ["razor reflex|1"],
        },
      ],
    });
    const originalDeckOrder = g.state.players[0]!.deck.map((card) => card.instanceId);

    g.play("sound the alarm|1").chooseOption("pass");

    expect(g.state.players[0]!.deck.map((card) => card.instanceId)).toEqual(originalDeckOrder);
    expect(projectStateFor(g.state, 0).log).not.toContain("Rhinar shuffles their deck");
  });

  it("reveals Briar's hand without offering a search for Lightning Press because it is an instant", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          hand: ["sound the alarm|1"],
          deck: ["sink below|1"],
        },
        {
          hero: "rhinar",
          heroKey: "briar|0",
          hand: ["lightning press|1", "fry|1"],
        },
      ],
    });

    g.play("sound the alarm|1");

    const revealedView = projectStateFor(g.state, 0);
    expect(revealedView.log.at(-1)).toContain("Lightning Press");
    expect(revealedView.log.at(-1)).toContain("Fry");
    expect(revealedView.log.at(-1)).toContain("from hand");
    expect(g.state.pendingDecision?.chooseHook).not.toBe("sound-alarm");
  });
});

describe("HNT — opposing hand reveals", () => {
  it.each([1, 2, 3] as const)(
    "Cut from the Same Cloth pitch %s reveals the whole hand and marks for an attack reaction",
    (pitch) => {
      const g = scenario({
        seats: [
          {
            hero: "rhinar",
            hand: [`cut from the same cloth|${pitch}`],
          },
          {
            hero: "dorinthea",
            hand: ["razor reflex|1", "fry|1"],
          },
        ],
      });

      g.play(`cut from the same cloth|${pitch}`);

      const revealed = projectStateFor(g.state, 0).log.filter((line) => line.includes("reveals")).at(-1);
      expect(revealed).toContain("Razor Reflex");
      expect(revealed).toContain("Fry");
      expect(revealed).toContain("from hand");
      expect(g.state.players[1]!.hero.scriptState?.marked).toBe(1);
    },
  );

  it("Cut from the Same Cloth still reveals the whole hand without marking for an instant", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["cut from the same cloth|1"] },
        { hero: "dorinthea", hand: ["lightning press|1", "fry|1"] },
      ],
    });

    g.play("cut from the same cloth|1");

    const revealed = projectStateFor(g.state, 0).log.filter((line) => line.includes("reveals")).at(-1);
    expect(revealed).toContain("Lightning Press");
    expect(revealed).toContain("Fry");
    expect(revealed).toContain("from hand");
    expect(g.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);
  });
});

describe("HNT — marked heroes and daggers", () => {
  it("Fire and Brimstone clears to graveyard while its combat-chain effect persists", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "fang|0",
          weapons: ["obsidian fire vein|0"],
          resources: 3,
          hand: ["fire and brimstone|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.attackWithWeapon("obsidian fire vein|0")
      .blockWith()
      .react("fire and brimstone|1")
      .expectInZone(0, "fire and brimstone|1", "graveyard")
      .attackWithWeapon("obsidian fire vein|0", { settle: false })
      .expectAttackValue(2);

    expect(g.state.chain[0]!.reactions).toEqual([]);
    expect(projectStateFor(g.state, 0).chain[0]!.reactions).toContainEqual(
      expect.objectContaining({ cardId: printingId("fire and brimstone|1") }),
    );
  });

  it("Quickdodge Flexors moves to the new link instead of appearing on both", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["oath of loyalty|1", "display loyalty|1"],
        },
        {
          hero: "dorinthea",
          resources: 2,
          equipment: { legs: "quickdodge flexors|0" },
        },
      ],
    });

    g.play("oath of loyalty|1")
      .blockWith()
      .passPriority()
      .activate("quickdodge flexors|0")
      .settle()
      .expectFinalDefense(2)
      .play("display loyalty|1")
      .blockWith()
      .passPriority()
      .activate("quickdodge flexors|0")
      .settle()
      .expectFinalDefense(2);

    expect(g.state.chain).toHaveLength(2);
    expect(g.state.chain[0]!.defendingEquipment).toHaveLength(0);
    expect(g.state.chain[1]!.defendingEquipment).toHaveLength(1);
    expect(g.state.chain[0]!.finalDefense).toBe(2);
    const projected = projectStateFor(g.state, 1).chain;
    expect(projected.flatMap((link) => [...link.defendingCards, ...link.reactions]).filter(
      (card) => card.cardId === printingId("quickdodge flexors|0"),
    )).toHaveLength(1);
  });

  it("Quickdodge Flexors can set its base defense after it is already defending", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["oath of loyalty|1"] },
        {
          hero: "dorinthea",
          resources: 1,
          equipment: { legs: "quickdodge flexors|0" },
        },
      ],
    });

    g.play("oath of loyalty|1")
      .blockWith("quickdodge flexors|0")
      .passPriority()
      .activate("quickdodge flexors|0")
      .settle()
      .expectFinalDefense(2);

    expect(g.state.chain[0]!.defendingEquipment).toHaveLength(1);
    const projected = projectStateFor(g.state, 1).chain[0]!;
    expect(projected.defendingCards[0]?.defense).toBe(2);
    expect([...projected.defendingCards, ...projected.reactions].filter(
      (card) => card.cardId === printingId("quickdodge flexors|0"),
    )).toHaveLength(1);
  });

  it("Kabuto of Imperial Authority prohibits subsequent weapon attacks this turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: ["kunai of retribution|0"],
          hand: ["head jab|3"],
          resources: 1,
        },
        {
          hero: "dorinthea",
          equipment: { head: "kabuto of imperial authority|0" },
        },
      ],
    });

    g.play("head jab|3")
      .blockWith("kabuto of imperial authority|0")
      .settle();

    const kunai = g.state.players[0]!.weapons[0]!;
    expect(legalIntents(g.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: kunai.instanceId,
    }));
    expect(applyIntent(g.state, 0, {
      kind: "activate-ability",
      sourceInstanceId: kunai.instanceId,
      pitchInstanceIds: [],
    })).toEqual({ ok: false, error: "cannot attack with weapons this turn" });
  });

  it("Dragonscaler Flight Path can target an earlier Draconic weapon attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "fai|0",
          weapons: ["searing emberblade|0"],
          equipment: { legs: "dragonscaler flight path|0" },
          hand: ["ronin renegade|1", "wounding blow|1", "wrecker romp|3"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("ronin renegade|1")
      .blockWith()
      .settle()
      .attackWithWeapon("searing emberblade|0", { pitch: ["wrecker romp|3"] })
      .blockWith()
      .settle()
      .play("wounding blow|1", { settle: false })
      .activate("dragonscaler flight path|0", { settle: false })
      .settle();

    const emberblade = g.state.players[0]!.weapons[0]!;
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "dragonscaler-flight-path",
      options: ["chain:0", "chain:1"],
      cardOptions: [
        g.state.chain[0]!.attackingCard.instanceId,
        emberblade.instanceId,
      ],
    });
    expect(g.state.players[0]!.equipment.legs).toBeUndefined();

    g.chooseOption("chain:1");
    expect(g.state.players[0]!.flags[`additionalActivations:${emberblade.instanceId}:0`]).toBe(1);
  });

  it("Dragonscaler Flight Path cannot restore go again suppressed by Spinal Crush", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["spinal crush|1"],
          resources: 5,
        },
        {
          hero: "dorinthea",
          heroKey: "cindra, dracai of retribution|0",
          equipment: { legs: "dragonscaler flight path|0" },
          hand: ["ignite|1", "wrecker romp|3"],
        },
      ],
    });

    g.play("spinal crush|1")
      .blockWith()
      .settle()
      .endTurn()
      .play("ignite|1")
      .blockWith()
      .activate("dragonscaler flight path|0", { pitch: ["wrecker romp|3"], settle: false })
      .settle();

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "dragonscaler-flight-path",
      options: ["chain:0"],
    });

    g.chooseOption("chain:0").expectAP(1, 0);
    expect(g.state.chain[0]!.goAgain).toBe(false);
  });

  it("Long Whisker Loyalty chooses distinct modes for its Draconic chain links", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "fang|0",
          weapons: ["obsidian fire vein|0"],
          resources: 1,
          hand: ["oath of loyalty|1", "long whisker loyalty|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("oath of loyalty|1")
      .blockWith()
      .settle()
      .attackWithWeapon("obsidian fire vein|0", { settle: false })
      .blockWith()
      .react("long whisker loyalty|1", { settle: false });

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "long-whisker-mode",
      options: ["+2 attack", "additional attack", "mark on hit"],
    });
    // Modes are declared before the card leaves hand.
    g.expectInZone(0, "long whisker loyalty|1", "hand");

    g.chooseOption("+2 attack");
    expect(g.state.log.at(-1)).toMatchObject({
      publicText: "Fang chooses +2 attack for Long Whisker Loyalty⟦HNT102⟧",
      publicPayload: {
        message: {
          id: "card.log.hnt.longwhisker.mode.chosen",
          values: {
            card: { kind: "card", cardId: "HNT102" },
            player: { kind: "player", seat: 0 },
            mode: { kind: "term", id: "card.hnt.longwhisker.option.attack" },
          },
        },
      },
    });
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "long-whisker-mode",
      options: ["additional attack", "mark on hit"],
    });

    g.chooseOption("mark on hit").chooseCard("obsidian fire vein|0").settle().expectFinalAttack(4);

    const dagger = g.state.players[0]!.weapons[0]!;
    expect(g.state.players[0]!.flags[`additionalActivations:${dagger.instanceId}:0`]).toBeUndefined();
    expect(g.state.players[1]!.hero.scriptState?.marked).toBe(1);
  });

  it("Long Whisker Loyalty can target the non-attacking dagger for its lasting modes", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          heroKey: "fang|0",
          weapons: ["obsidian fire vein|0", "kunai of retribution|0"],
          resources: 2,
          hand: ["oath of loyalty|1", "long whisker loyalty|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("oath of loyalty|1")
      .blockWith()
      .settle()
      .attackWithWeapon("obsidian fire vein|0", { settle: false })
      .blockWith()
      .react("long whisker loyalty|1", { settle: false })
      .chooseOption("additional attack")
      .chooseOption("mark on hit");

    const attackingDagger = g.state.players[0]!.weapons[0]!;
    const otherDagger = g.state.players[0]!.weapons[1]!;
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "long-whisker-additional-attack-target",
      options: [String(attackingDagger.instanceId), String(otherDagger.instanceId)],
    });

    g.chooseOption(String(otherDagger.instanceId));
    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "long-whisker-mark-target",
      options: [String(attackingDagger.instanceId), String(otherDagger.instanceId)],
    });

    g.chooseOption(String(otherDagger.instanceId)).settle().expectFinalAttack(2);

    expect(g.state.players[0]!.flags[`additionalActivations:${attackingDagger.instanceId}:0`]).toBeUndefined();
    expect(g.state.players[0]!.flags[`additionalActivations:${otherDagger.instanceId}:0`]).toBe(1);
    expect(g.state.players[1]!.hero.scriptState?.marked).toBeUndefined();

    g.attackWithWeapon("kunai of retribution|0").blockWith().settle();
    expect(g.state.players[1]!.hero.scriptState?.marked).toBe(1);
  });

  it("journals Relentless Pursuit's self-move as a deck-bottom placement", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["relentless pursuit|3"] },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.flags.attackedHeroThisTurn = true;

    g.play("relentless pursuit|3").expectDeckBottom(0, "relentless pursuit|3");
    expect(g.lastEvents).toContainEqual(expect.objectContaining({
      from: { kind: "stack", seat: 0 },
      to: { kind: "deck", seat: 0, position: "bottom" },
    }));
  });

  it.each([
    ["defang the dragon|1", "fang|0"],
    ["extinguish the flames|1", "cindra|0"],
  ] as const)("%s records its named-hero Contract completion", (contract, targetHero) => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: [contract], deck: ["wrecker romp|3"] },
        { hero: "dorinthea", heroKey: targetHero },
      ],
    });
    g.state.players[1]!.hero.scriptState = { marked: 1 };

    g.play(contract).blockWith().settle().expectHandSize(0, 1);
    expect(g.state.players[0]!.flags.completedContractThisTurn).toBe(true);
  });

  it("War Cry of Bellona gives Raydn +2{p} for every attack this turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["raydn, duskbane|0"],
          board: ["flurry|0"],
          hand: ["war cry of bellona|2"],
          resources: 2,
        },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    const openAttackValue = () =>
      [...projectStateFor(g.state, 0).chain].reverse().find((link) => !link.resolved)!.attackValue;

    g.attackWithWeapon("raydn, duskbane|0").blockWith();
    const base = openAttackValue();
    g.react("war cry of bellona|2", { settle: false }).passPriority().passPriority().expectAttackValue(base + 2).settle();

    g.attackWithWeapon("raydn, duskbane|0").expectAttackValue(base + 2);
  });

  it("War Cry of Bellona discards itself as a cost and reflects qualifying weapon damage", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          hand: ["war cry of bellona|2"],
          soul: ["soul food|2", "tome of divinity|2", "celestial cataclysm|2"],
        },
        { hero: "dorinthea", weapons: ["dawnblade|0"], hand: ["raging onslaught|3"] },
      ],
    });

    g.attackWithWeapon(undefined, { pitch: ["raging onslaught|3"], settle: false })
      .passPriority()
      .activate("war cry of bellona|2", { settle: false })
      .chooseOption("X = 3")
      .chooseCard("soul food|2")
      .chooseCard("tome of divinity|2")
      .chooseCard("celestial cataclysm|2")
      .chooseCard("dawnblade|0")
      .expectInZone(0, "war cry of bellona|2", "graveyard")
      .settle()
      .blockWith()
      .settle()
      .expectLife(0, 20)
      .expectLife(1, 17);
  });

  it("War Cry of Themis chooses X, pays from soul, then turns X banished cards face-down", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["war cry of themis|2"],
          soul: ["soul food|2", "tome of divinity|2"],
        },
        {
          hero: "dorinthea",
          banish: ["wounding blow|1", "wounding blow|2"],
        },
      ],
    });

    g.activate("war cry of themis|2", { settle: false });
    expect(g.state.pendingDecision?.options).toEqual(["X = 0", "X = 1", "X = 2"]);

    g.chooseOption("X = 2")
      .chooseCard("soul food|2")
      .chooseCard("tome of divinity|2")
      .settle();
    const pd = g.state.pendingDecision!;
    expect(pd.chooseHook).toBe("war-cry-themis-target");
    expect([pd.minimumSelections, pd.maximumSelections]).toEqual([2, 2]);
    g.chooseMany(g.state.players[1]!.banish.map((card) => String(card.instanceId)))
      .settle()
      .expectInZone(0, "war cry of themis|2", "graveyard")
      .expectZoneSize(0, "soul", 0);

    expect(g.state.players[1]!.banish).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: printingId("wounding blow|1"), faceDown: true }),
      expect.objectContaining({ cardId: printingId("wounding blow|2"), faceDown: true }),
    ]));
  });

  it("Mask of Deceit lets its controller choose an Agent when the attacking hero is marked", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        {
          hero: "dorinthea",
          heroKey: "arakni, marionette|0",
          equipment: { head: "mask of deceit|0" },
        },
      ],
    });
    g.state.players[0]!.hero.scriptState = { marked: 1 };

    g.play("snatch|1").blockWith("mask of deceit|0").settle();

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "mask-agent",
      prompt: "Mask of Deceit: choose an Agent of Chaos",
    });
    expect(g.state.pendingDecision?.options).toEqual([
      "Arakni, Black Widow",
      "Arakni, Funnel Web",
      "Arakni, Orb-Weaver",
      "Arakni, Redback",
      "Arakni, Tarantula",
      "Arakni, Trap-Door",
    ]);
    expect(projectStateFor(g.state, 1).pendingDecision?.optionCards?.map((card) => card?.cardId))
      .toEqual(["HNT003", "HNT004", "HNT005", "HNT006", "HNT007", "HNT008"]);

    g.chooseOption("Orb-Weaver");
    expect(g.state.players[1]!.heroCardId).toBe("HNT005");
  });

  it("Blood Runs Deep makes each controlled dagger hit and then destroys it", () => {
    const g = scenario({ seats: [{ hero: "rhinar", weapons: ["graphene chelicera|0"], hand: ["blood runs deep|1", "wrecker romp|3"] }, { hero: "dorinthea" }] });
    g.play("blood runs deep|1", { pitch: ["wrecker romp|3"] }).expectLife(1, 19);
    expect(g.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Cut Through gains +1 power and go again when Flick Knives makes a dagger hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["kunai of retribution|0"],
          equipment: { arms: "flick knives|0" },
          hand: ["cut through|1"],
        },
        { hero: "dorinthea", hand: ["wounding blow|1"] },
      ],
    });
    const kunaiId = g.state.players[0]!.weapons[0]!.instanceId;

    g.play("cut through|1")
      .blockWith("wounding blow|1")
      .expectAttackValue(3)
      .activate("flick knives|0")
      .doRaw({ kind: "choose", optionId: String(kunaiId) })
      .expectAttackValue(4)
      .settle()
      .expectFinalAttack(4)
      .expectAP(0, 1);
  });

  it("Poisoned Blade visibly makes the opposing hero lose life when Flick Knives makes a dagger hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          resources: 1,
          weapons: ["kunai of retribution|0"],
          equipment: { arms: "flick knives|0" },
          hand: ["poisoned blade|2"],
        },
        { hero: "dorinthea", hand: ["wounding blow|1"] },
      ],
    });

    g.play("poisoned blade|2")
      .blockWith("wounding blow|1")
      .activate("flick knives|0")
      .chooseCard("kunai of retribution|0")
      .expectLife(1, 18)
      .expectLog("loses 1 life (18 life)");
  });

  it("Poisoned Blade watches a later dagger hit on the combat chain", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          weapons: ["kunai of retribution|0"],
          hand: ["poisoned blade|2"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("poisoned blade|2").blockWith().settle()
      .expectNoLog("Poisoned Blade triggers: On hit");
    const lifeAfterBlade = g.state.players[1]!.life;
    g.attackWithWeapon("kunai of retribution|0").blockWith().settle()
      .expectLog("Poisoned Blade triggers: On hit")
      .expectLife(1, lifeAfterBlade - 2);
  });

  it("Throw Dagger targets an off-link dagger when it is played", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["kunai of retribution|0", "kunai of retribution|0"],
          hand: ["throw dagger|3"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.attackWithWeapon("kunai of retribution|0")
      .blockWith();

    const attackingDaggerId = g.state.chain.at(-1)!.attackingCard.instanceId;
    const otherDaggerId = g.state.players[0]!.weapons.find((card) =>
      card.instanceId !== attackingDaggerId
    )!.instanceId;
    const throwDagger = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("throw dagger|3"),
    )!;
    const intents = legalIntents(g.state, 0).filter((intent) =>
      intent.kind === "play-card" && intent.instanceId === throwDagger.instanceId
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ targetCardInstanceId: otherDaggerId });

    g.react("throw dagger|3");

    expect(g.state.players[0]!.weapons.some((card) => card.instanceId === attackingDaggerId))
      .toBe(true);
    expect(g.state.players[0]!.graveyard.some((card) => card.instanceId === otherDaggerId))
      .toBe(true);
  });

  it("Boots of Omnis Ward prevention is consumed by Throw Dagger", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["kunai of retribution|0", "kunai of retribution|0"],
          hand: ["throw dagger|3"],
        },
        {
          hero: "dorinthea",
          equipment: { legs: "boots of omnis ward|0" },
        },
      ],
    });

    g.attackWithWeapon("kunai of retribution|0")
      .blockWith()
      .react("throw dagger|3", { settle: false })
      .passPriority()
      .activate("boots of omnis ward|0", { settle: false })
      .settle();

    expect(g.state.players[1]!.flags.preventNextDamage).toBe(0);
    expect(projectStateFor(g.state, 1).ongoing.some((effect) =>
      effect.label.includes("prevent next 1 damage")
    )).toBe(false);
    g.expectHandSize(0, 0);
  });

  it("Throw Dagger cannot be played without an off-link dagger", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["kunai of retribution|0"],
          hand: ["throw dagger|3"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.attackWithWeapon("kunai of retribution|0").blockWith();

    const throwDagger = g.state.players[0]!.hand.find(
      (card) => card.cardId === printingId("throw dagger|3"),
    )!;
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-card" &&
      intent.instanceId === throwDagger.instanceId
    )).toBe(false);
  });

  it("Kunai of Retribution destroys itself when its combat chain closes", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 0,
          weapons: ["kunai of retribution|0"],
          hand: ["wrecker romp|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.attackWithWeapon("kunai of retribution|0", { pitch: ["wrecker romp|3"] })
      .blockWith()
      .settle();
    expect(g.state.players[0]!.weapons).toHaveLength(1);

    g.endTurn()
      .expectInZone(0, "kunai of retribution|0", "graveyard");
    expect(g.state.players[0]!.weapons).toHaveLength(0);
  });

  it("Cindra's returned Kunai survives the old attack's chain-close destruction", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          resources: 4,
          weapons: ["kunai of retribution|0"],
          equipment: { arms: "flick knives|0" },
          hand: ["head jab|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    const kunaiId = g.state.players[0]!.weapons[0]!.instanceId;
    g.attackWithWeapon("kunai of retribution|0")
      .blockWith()
      .settle()
      .play("head jab|1")
      .blockWith()
      .activate("flick knives|0")
      .chooseCard("kunai of retribution|0")
      .activate("cindra|0")
      .chooseMany(graveyardIds(g, 0, "kunai of retribution|0"))
      .settle()
      .endTurn();

    expect(g.state.players[0]!.weapons.map((card) => card.instanceId)).toContain(kunaiId);
    expect(g.state.players[0]!.graveyard.map((card) => card.instanceId)).not.toContain(kunaiId);
  });

  it("Cindra can attack again with a Kunai re-equipped from the graveyard", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          resources: 4,
          weapons: ["kunai of retribution|0"],
          equipment: { arms: "flick knives|0" },
          hand: ["head jab|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    const kunaiId = g.state.players[0]!.weapons[0]!.instanceId;

    g.attackWithWeapon("kunai of retribution|0")
      .blockWith()
      .settle()
      .play("head jab|1")
      .blockWith()
      .activate("flick knives|0")
      .chooseCard("kunai of retribution|0")
      .activate("cindra|0")
      .chooseMany(graveyardIds(g, 0, "kunai of retribution|0"))
      .settle()
      .attackWithWeapon("kunai of retribution|0")
      .blockWith()
      .settle();

    expect(g.state.chain.at(-1)?.attackingCard.instanceId).toBe(kunaiId);
  });

  it("Blood Splattered Vest is optional and is destroyed by its third stain counter", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          equipment: { chest: "blood splattered vest|0" },
          hand: ["bite|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    const vest = g.state.players[0]!.equipment.chest!;
    vest.counters = { stain: 2 };

    g.play("bite|1")
      .chooseCard("graphene chelicera|0");
    expect(g.state.pendingDecision).toMatchObject({
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
    });

    g.chooseOption("yes")
      .expectResources(0, 1)
      .expectInZone(0, "blood splattered vest|0", "graveyard");
    expect(g.state.players[0]!.equipment.chest).toBeUndefined();
  });

  it("Blood Splattered Vest gains no resource or stain when declined", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          equipment: { chest: "blood splattered vest|0" },
          hand: ["bite|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("bite|1")
      .chooseCard("graphene chelicera|0")
      .chooseOption("no")
      .expectResources(0, 0);
    expect(g.state.players[0]!.equipment.chest?.counters?.stain ?? 0).toBe(0);
  });

  it("Blood Splattered Vest asks before resolving a Flick Knives dagger hit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["kunai of retribution|0"],
          equipment: {
            arms: "flick knives|0",
            chest: "blood splattered vest|0",
          },
          hand: ["head jab|1"],
        },
        { hero: "dorinthea", hand: ["wounding blow|1"] },
      ],
    });

    g.play("head jab|1")
      .blockWith("wounding blow|1")
      .activate("flick knives|0")
      .chooseCard("kunai of retribution|0");

    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      kind: "optional-effect",
      prompt: "Blood Splattered Vest: gain 1 resource and add a stain counter?",
      options: ["yes", "no"],
      defaultOption: "no",
    });
    expect(projectStateFor(g.state, 0).pendingDecision).toMatchObject({
      player: 0,
      kind: "optional-effect",
      options: ["yes", "no"],
      defaultOption: "no",
    });
    g.chooseOption("no").expectResources(0, 0);
    expect(g.state.players[0]!.equipment.chest?.counters?.stain ?? 0).toBe(0);
  });

  it("Ignite discounts Cindra's Draconic hero activation and is consumed once", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: [],
          hand: ["ignite|1", "ignite|1", "demonstrate devotion|1"],
          graveyard: ["kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("ignite|1").blockWith().settle()
      .play("ignite|1").blockWith().settle();

    const hero = g.state.players[0]!.hero;
    expect(g.state.modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activationCostReduction: 1,
        appliesToSubtype: "draconic",
      }),
    ]));
    expect(legalIntents(g.state, 0)).toContainEqual({
      kind: "activate-ability",
      sourceInstanceId: hero.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });

    g.activate("cindra|0")
      .chooseMany(graveyardIds(g, 0, "kunai of retribution|0"))
      .settle()
      .expectNoLegalPlay("demonstrate devotion|1");
  });

  it("projects Cindra's spent recovery until the turn ends", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: [],
          resources: 3,
          graveyard: ["kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    expect(projectStateFor(g.state, 0).players[0]!.heroUsedAbilityIndexes).toBeUndefined();

    g.activate("cindra|0")
      .chooseMany(graveyardIds(g, 0, "kunai of retribution|0"))
      .settle();

    expect(projectStateFor(g.state, 0).players[0]!.heroUsedAbilityIndexes).toEqual([0]);
    expect(projectStateFor(g.state, 1).players[0]!.heroUsedAbilityIndexes).toEqual([0]);
    g.endTurn();
    expect(projectStateFor(g.state, 0).players[0]!.heroUsedAbilityIndexes).toBeUndefined();
  });

  it("Cindra equips up to 2 chosen Draconic daggers from the graveyard at once", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: [],
          resources: 3,
          graveyard: ["kunai of retribution|0", "kunai of retribution|0", "kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("cindra|0");
    const pd = g.state.pendingDecision!;
    expect(pd.chooseHook).toBe("cindra-equip");
    expect(pd.options).toHaveLength(3);
    expect([pd.minimumSelections, pd.maximumSelections]).toEqual([0, 2]);
    g.chooseMany(graveyardIds(g, 0, "kunai of retribution|0").slice(0, 2)).settle();

    g.expectZoneSize(0, "graveyard", 1);
    expect(g.state.players[0]!.weapons).toHaveLength(2);
  });

  it("Ignite grants its reduction only after its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "fai, rising rebellion|0",
          weapons: [],
          hand: [
            "ronin renegade|1",
            "ronin renegade|1",
            "ignite|1",
            "demonstrate devotion|1",
          ],
          graveyard: ["phoenix flame|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("ronin renegade|1").blockWith().settle()
      .play("ronin renegade|1").blockWith().settle()
      .play("ignite|1", { settle: false })
      .passPriority()
      .passPriority();

    expect(g.state.stack).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "The next Draconic card costs 1 less to play or activate",
      }),
    ]));
    expect(g.state.modifiers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        activationCostReduction: 1,
        appliesToSubtype: "draconic",
      }),
    ]));

    g.activate("fai, rising rebellion|0");

    expect(g.state.players[0]!.hand).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: printingId("phoenix flame|1") }),
    ]));
    const igniteReduction = g.state.modifiers.find((modifier) =>
      modifier.activationCostReduction === 1 &&
      modifier.appliesToSubtype === "draconic"
    );
    expect(igniteReduction?.consumed).not.toBe(true);
    expect(projectStateFor(g.state, 0).ongoing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "costs 1 less to play or activate · next Draconic card this combat chain",
        lifetime: "once",
        durationMessage: {
          id: "engine.effect.duration.next.subject.this.chain",
          values: {
            noun: "card",
            typeCount: 1,
            type1: "Draconic",
            color: "any",
            via: "none",
            keyword: "none",
            limit: "none",
            target: "none",
            subject: { kind: "term", id: "engine.effect.subject.one" },
          },
        },
      }),
    ]));

    g.blockWith().settle()
      .play("demonstrate devotion|1");
  });

  it("Hunt the Hunter marks through an attack trigger after another red card", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "fai, rising rebellion|0",
          weapons: [],
          hand: ["ronin renegade|1", "hunt the hunter|1", "sink below|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("ronin renegade|1").blockWith().settle()
      .play("hunt the hunter|1", { settle: false });

    expect(g.state.stack).toEqual([
      expect.objectContaining({ label: "Mark the defending hero" }),
    ]);
    expect(g.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);

    g.passPriority().passPriority();

    expect(g.state.stack).toEqual([]);
    expect(g.state.pendingDecision?.kind).toBe("defend");
    expect(g.state.players[1]!.hero.scriptState?.marked).toBe(1);
  });

  it("Hunt the Hunter does not trigger without another red card played this turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "fai, rising rebellion|0",
          weapons: [],
          hand: ["hunt the hunter|1", "sink below|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("hunt the hunter|1", { settle: false });

    expect(g.state.stack).toEqual([]);
    expect(g.state.pendingDecision?.kind).toBe("defend");
    expect(g.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);
  });

  it("Cindra cannot equip a face-down Draconic dagger from the graveyard", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: [],
          graveyard: ["kunai of retribution|0"],
          resources: 3,
        },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.graveyard[0]!.faceDown = true;

    const hero = g.state.players[0]!.hero;
    expect(legalIntents(g.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: hero.instanceId,
    }));
  });

  it("Art of the Dragon: Blood discounts exactly the next 3 Draconic plays", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["fealty|0"],
          hand: [
            "art of the dragon: blood|1",
            "demonstrate devotion|1",
            "demonstrate devotion|1",
            "demonstrate devotion|1",
            "demonstrate devotion|1",
          ],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("fealty|0")
      .play("art of the dragon: blood|1").blockWith().settle();
    for (let play = 0; play < 3; play++) {
      g.play("demonstrate devotion|1").blockWith().settle();
    }
    g.expectNoLegalPlay("demonstrate devotion|1");
  });

  it("Art of the Dragon: Blood does not get go again unless it is Draconic", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["art of the dragon: blood|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("art of the dragon: blood|1");

    expect(g.state.chain.at(-1)?.goAgain).toBe(false);
  });

  it("a dagger effect hit removes Mark and lets Cindra create Fealty", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: ["graphene chelicera|0"],
          hand: ["proclaim vengeance|1", "bite|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("proclaim vengeance|1")
      .play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectLife(1, 19)
      .expectInZone(0, "fealty|0", "board");
    expect(g.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);
  });

  it("Cindra does not trigger for a dagger effect hit on an unmarked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "cindra|0",
          weapons: ["graphene chelicera|0"],
          hand: ["bite|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectNoLog("Cindra triggers");
    expect(g.state.players[0]!.board).toHaveLength(0);
  });

  it("Savor Bloodshed ignores an unmarked hit, then draws when a dagger hits a marked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          weapons: ["graphene chelicera|0", "kunai of retribution|0"],
          hand: ["proclaim vengeance|1", "savor bloodshed|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("savor bloodshed|1")
      .attackWithWeapon("kunai of retribution|0")
      .blockWith()
      .settle()
      .expectHandSize(0, 1)
      .play("proclaim vengeance|1")
      .attackWithWeapon("graphene chelicera|0")
      .blockWith()
      .settle()
      .expectHandSize(0, 1);

    expect(g.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);
  });

  it("Savor Bloodshed draws when a dagger effect hits a marked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          hand: ["savor bloodshed|1", "bite|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });
    g.state.players[1]!.hero.scriptState = { marked: 1 };

    g.play("savor bloodshed|1")
      .play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectHandSize(0, 1);

    expect(g.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);
  });

  it("Savor Bloodshed does not trigger when a dagger effect hits an unmarked hero", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          hand: ["savor bloodshed|1", "bite|1"],
          deck: ["wrecker romp|3"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    g.play("savor bloodshed|1")
      .play("bite|1")
      .chooseCard("graphene chelicera|0")
      .expectHandSize(0, 0)
      .expectNoLog("Savor Bloodshed triggers");
  });

  it("Tarantula Toxin can choose both modes for Kiss of Death", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["kiss of death|1", "tarantula toxin|1"] },
        { hero: "dorinthea", hand: ["wrecker romp|1"] },
      ],
    });

    g.play("kiss of death|1")
      .blockWith("wrecker romp|1")
      .react("tarantula toxin|1");

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "tarantula-mode",
      options: ["+3 attack", "-3 defense", "both"],
    });

    g.chooseOption("both")
      .chooseCard("wrecker romp|1")
      .expectFinalAttack(6)
      .expectFinalDefense(0);
  });

  it("Tarantula Toxin can choose only its attack mode for a dagger with stealth", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["kiss of death|1", "tarantula toxin|1"] },
        { hero: "dorinthea", hand: ["wrecker romp|1"] },
      ],
    });

    g.play("kiss of death|1")
      .blockWith("wrecker romp|1")
      .react("tarantula toxin|1")
      .chooseOption("+3 attack")
      .expectFinalAttack(6)
      .expectFinalDefense(3);
  });

  it("Tarantula Toxin can choose only its defense mode for Graphene Chelicera", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["graphene chelicera|0"],
          hand: ["tarantula toxin|1"],
        },
        {
          hero: "dorinthea",
          equipment: { head: "ironrot helm|0" },
        },
      ],
    });

    g.attackWithWeapon("graphene chelicera|0")
      .blockWith("ironrot helm|0")
      .react("tarantula toxin|1");

    expect(g.state.pendingDecision?.options).toEqual(["+3 attack", "-3 defense", "both"]);

    g.chooseOption("-3 defense")
      .chooseCard("ironrot helm|0")
      .expectFinalAttack(1)
      .expectFinalDefense(0);
  });

  it("Retrieve pays one resource and equips the selected dagger", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          hand: ["up sticks and run|2", "wrecker romp|3"],
          graveyard: ["kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });
    g.play("up sticks and run|2").chooseCard("kunai of retribution|0");
    const payment = projectStateFor(g.state, 0).pendingDecision?.resourcePayment;
    expect(payment).toMatchObject({ cost: 1 });
    expect(payment?.options).toHaveLength(1);
    expect(payment?.options[0]?.pitchInstanceIds).toEqual([
      g.state.players[0]!.hand.find((card) => card.cardId === printingId("wrecker romp|3"))!.instanceId,
    ]);

    g.chooseOption(payment!.options[0]!.optionId).expectResources(0, 2);
    expect(g.state.players[0]!.weapons.some((card) => card.cardId === printingId("kunai of retribution|0"))).toBe(true);
    expect(g.state.players[0]!.pitch.some((card) => card.cardId === printingId("wrecker romp|3"))).toBe(true);
  });

  it("Retrieve offers dagger weapons but not Kiss of Death", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          resources: 1,
          hand: ["up sticks and run|2"],
          graveyard: ["kiss of death|1", "kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("up sticks and run|2");

    expect(projectStateFor(g.state, 0).pendingDecision?.optionCards?.map((card) => card?.cardId ?? null))
      .toEqual([null, printingId("kunai of retribution|0")]);
  });

  it("Calming Breeze prevents one damage from each of three events", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["calming breeze|1"] },
        { hero: "dorinthea" },
      ],
    });
    g.play("calming breeze|1");
    const breeze = g.state.modifiers.find((modifier) => modifier.preventDamagePerEvent === 1);
    expect(breeze?.preventDamageEventsRemaining).toBe(3);
  });

  it("projects Shelter from the Storm's remaining prevention events", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["shelter from the storm|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("shelter from the storm|1");

    expect(projectStateFor(g.state, 0).ongoing).toContainEqual(expect.objectContaining({
      seat: 0,
      cardId: printingId("shelter from the storm|1"),
      label: "prevent 1 damage the next 3 times you would be dealt damage · this turn",
    }));
  });
});

describe("HNT — rules regression coverage", () => {
  it("Cull can be played as an instant after life loss and lets each hero choose a card to banish", () => {
    const g = scenario({
      active: 1,
      seats: [
        { hero: "rhinar", hand: ["cull|1", "fry|1", "fate foreseen|2"] },
        {
          hero: "dorinthea",
          hand: ["wounding blow|1", "raging onslaught|3", "sink below|1"],
        },
      ],
    });

    g.play("wounding blow|1")
      .blockWith()
      .passPriority()
      .passPriority();
    expect(g.state.players[0]!.flags.lostLifeThisTurn).toBe(true);

    g.passPriority()
      .react("cull|1");

    expect(g.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "cull-hand:1",
    });

    g.chooseCard("sink below|1");
    expect(g.state.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "cull-hand:0",
    });

    g.chooseCard("fry|1")
      .expectInZone(0, "cull|1", "graveyard")
      .expectNotInZone(0, "cull|1", "banish")
      .expectInZone(0, "fry|1", "banish")
      .expectInZone(0, "fate foreseen|2", "hand")
      .expectInZone(1, "sink below|1", "banish")
      .expectInZone(1, "raging onslaught|3", "hand");
  });

  it("Cull goes to graveyard after defending", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["bittering thorns|2"], resources: 1 },
        { hero: "dorinthea", hand: ["cull|1"] },
      ],
    });

    g.play("bittering thorns|2")
      .blockWith("cull|1")
      .settle()
      .endTurn()
      .expectInZone(1, "cull|1", "graveyard")
      .expectNotInZone(1, "cull|1", "banish");
  });

  it("Retrace the Past names itself after a Gustwave attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: [
            "surging strike|1",
            "raging onslaught|3",
            "whelming gustwave|1",
            "retrace the past|3",
          ],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("surging strike|1", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .play("whelming gustwave|1")
      .blockWith()
      .settle()
      .play("retrace the past|3");

    expect(g.state.pendingDecision).toMatchObject({
      kind: "choose-name",
      chooseHook: "retrace-name",
    });

    g.chooseName("Head Jab").expectAttackValue(4);
    expect(g.state.chain.at(-1)?.attackingCard.grantedNames).toContain("Head Jab");
  });

  it("Sharpened Senses checks an already-buffed weapon attack when it is declared", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 1,
          hand: ["sharpened senses|2", "sharpen steel|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("sharpened senses|2")
      .play("sharpen steel|1")
      .attackWithWeapon("dawnblade|0");

    expect(g.state.chain.at(-1)).toMatchObject({ goAgain: true });
  });

  it("Sharpened Senses grants go again when a weapon attack becomes greater than twice its base", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 2,
          hand: ["sharpened senses|2", "jagged edge|1"],
        },
        { hero: "rhinar" },
      ],
    });

    g.play("sharpened senses|2").attackWithWeapon("dawnblade|0").blockWith();

    expect(g.state.chain.at(-1)).toMatchObject({ goAgain: false });

    g.react("jagged edge|1");

    expect(g.state.chain.at(-1)).toMatchObject({ goAgain: true });
  });

  it("Provoke lets the defending hero choose the revealed card", () => {
    const action = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 2,
          hand: ["provoke|3"],
        },
        { hero: "rhinar", hand: ["snatch|1", "sink below|1"] },
      ],
    });

    action.attackWithWeapon().blockWith().react("provoke|3");
    const actionOptions = action.state.players[1]!.hand.map((card) => String(card.instanceId));
    expect(action.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "provoke-reveal",
      prompt: "Provoke: choose a card to reveal",
      options: actionOptions,
    });

    action.chooseCard("snatch|1");
    expect(action.state.chain.at(-1)?.defendingCards).toContainEqual(
      expect.objectContaining({ cardId: printingId("snatch|1") }),
    );
    action.expectInZone(1, "sink below|1", "hand");

    const nonAction = scenario({
      seats: [
        {
          hero: "dorinthea",
          weapons: ["dawnblade|0"],
          resources: 2,
          hand: ["provoke|3"],
        },
        { hero: "rhinar", hand: ["snatch|1", "sink below|1"] },
      ],
    });

    nonAction.attackWithWeapon().blockWith().react("provoke|3").chooseCard("sink below|1")
      .expectInZone(1, "sink below|1", "graveyard")
      .expectInZone(1, "snatch|1", "hand");
  });

  it("Leap Frog equipment may add itself after an opposing attack reaction", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["snatch|1", "razor reflex|1"] },
        { hero: "dorinthea", equipment: { head: "leap frog vocal sac|0" } },
      ],
    });
    g.play("snatch|1").blockWith().react("razor reflex|1", { settle: false }).settle().chooseOption("yes");
    const link = g.state.chain[g.state.chain.length - 1]!;
    expect(link.defendingEquipment.some((card) => card.cardId === printingId("leap frog vocal sac|0"))).toBe(true);
  });

  it("Heart of Vengeance discounts the next attack targeting Arakni", () => {
    const cardAttack = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["compounding anger|1"],
          equipment: { chest: "heart of vengeance|0" },
        },
        { hero: "dorinthea", heroKey: "arakni|0" },
      ],
    });
    cardAttack.activate("heart of vengeance|0").play("compounding anger|1");

    const weaponAttack = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["kunai of retribution|0"],
          equipment: { chest: "heart of vengeance|0" },
        },
        { hero: "dorinthea", heroKey: "arakni|0" },
      ],
    });
    weaponAttack.activate("heart of vengeance|0").activate("kunai of retribution|0", { settle: false });
  });

  it("Coat of Allegiance restricts its controller to Draconic cards", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 2,
          hand: ["snatch|1", "compounding anger|1"],
          equipment: { chest: "coat of allegiance|0" },
        },
        { hero: "dorinthea" },
      ],
    });
    g.activate("coat of allegiance|0");
    expect(() => g.play("snatch|1")).toThrow();
    g.play("compounding anger|1", { settle: false });
  });

  it("Fealty lets a non-Draconic card satisfy Oath of Loyalty's play restriction", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["fealty|0"],
          hand: ["oath of loyalty|1", "art of the dragon: blood|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("oath of loyalty|1").blockWith().settle()
      .activate("fealty|0")
      .play("art of the dragon: blood|1");

    expect(g.state.chain.at(-1)?.attackingCard.grantedTypes).toContain("draconic");
  });
});

describe("HNT — attack triggers use the stack", () => {
  type Game = ReturnType<typeof scenario>;

  function expectAttackTrigger(g: Game, label: string): void {
    expect(g.state.stack).toEqual([expect.objectContaining({ label })]);
  }

  function resolveTrigger(g: Game): Game {
    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    return g;
  }

  function named(cards: readonly { cardId: string }[], key: string): number {
    const name = cardData[printingId(key)]!.name;
    return cards.filter((card) => cardData[card.cardId]!.name === name).length;
  }

  function weaponCount(g: Game, seat: number, key: string): number {
    return named(g.state.players[seat]!.weapons, key);
  }

  function boardCount(g: Game, seat: number, key: string): number {
    return named(g.state.players[seat]!.board, key);
  }

  function declareTarget(g: Game, option: string): Game {
    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
    return g.doRaw({ kind: "choose", optionId: option });
  }

  function weaponId(g: Game, seat: number, key: string): string {
    const name = cardData[printingId(key)]!.name;
    return String(g.state.players[seat]!.weapons.find((card) => cardData[card.cardId]!.name === name)!.instanceId);
  }

  it.each([
    { key: "bite|1", draconic: false },
    { key: "throw yourself at them|1", draconic: false },
    { key: "silver talons|1", draconic: true },
  ])("$key declares its target dagger as its attack trigger goes on the stack", ({ key, draconic }) => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          weapons: ["graphene chelicera|0"],
          board: draconic ? ["fealty|0"] : [],
          hand: [key],
        },
        { hero: "dorinthea" },
      ],
    });

    if (draconic) g.activate("fealty|0");
    g.play(key, { settle: false });

    const dagger = weaponId(g, 0, "graphene chelicera|0");
    expectAttackTrigger(g, "You may have target dagger deal 1 damage to the defending hero");
    expect(g.state.pendingDecision?.options).toEqual(["pass", dagger]);

    declareTarget(g, dagger);
    expect(g.state.stack[0]?.targetCardInstanceId).toBe(Number(dagger));
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    g.expectLife(1, 20).expectLog("targets Graphene Chelicera");

    resolveTrigger(g).expectLife(1, 19);
    expect(weaponCount(g, 0, "graphene chelicera|0")).toBe(0);
  });

  it("Bite may decline to target a dagger and then deals no damage", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["graphene chelicera|0"], hand: ["bite|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("bite|1", { settle: false });
    declareTarget(g, "pass");
    expectAttackTrigger(g, "You may have target dagger deal 1 damage to the defending hero");

    resolveTrigger(g).expectLife(1, 20);
    expect(weaponCount(g, 0, "graphene chelicera|0")).toBe(1);
  });

  it("Bite's trigger ceases to exist without a dagger to target", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["bite|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("bite|1", { settle: false });

    expect(g.state.stack).toEqual([]);
    expect(g.state.pendingDecision?.kind).toBe("defend");
    g.expectLog("Bite's triggered ability has no legal target");
  });

  it("Silver Talons does not trigger when it is not Draconic", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["graphene chelicera|0"], hand: ["silver talons|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("silver talons|1", { settle: false });

    expect(g.state.stack).toEqual([]);
    expect(g.state.pendingDecision?.kind).toBe("defend");
  });

  it("Whittle from Bone equips Graphene Chelicera when its trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: [], hand: ["whittle from bone|1"] },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[1]!.hero.scriptState = { marked: 1 };

    g.play("whittle from bone|1", { settle: false });

    expectAttackTrigger(g, "Equip a Graphene Chelicera token");
    expect(weaponCount(g, 0, "graphene chelicera|0")).toBe(0);

    resolveTrigger(g);
    expect(weaponCount(g, 0, "graphene chelicera|0")).toBe(1);
  });

  it.each(["for the dracai|1", "for the emperor|1", "for the realm|1"])(
    "%s creates Fealty from an attack trigger against a marked hero",
    (key) => {
      const g = scenario({
        seats: [
          { hero: "rhinar", resources: 2, hand: [key] },
          { hero: "dorinthea" },
        ],
      });
      g.state.players[1]!.hero.scriptState = { marked: 1 };

      g.play(key, { settle: false });

      expectAttackTrigger(g, "Create a Fealty token");
      expect(boardCount(g, 0, "fealty|0")).toBe(0);

      resolveTrigger(g);
      expect(boardCount(g, 0, "fealty|0")).toBe(1);
    },
  );

  it("For the Dracai does not trigger against an unmarked hero", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["for the dracai|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("for the dracai|1", { settle: false });

    expect(g.state.stack).toEqual([]);
    expect(g.state.pendingDecision?.kind).toBe("defend");
  });

  it("Demonstrate Devotion keeps static go again and creates Fealty through its granted trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["hunt to the ends of rathe|1", "demonstrate devotion|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("hunt to the ends of rathe|1").blockWith().settle()
      .play("demonstrate devotion|1", { settle: false });

    expectAttackTrigger(g, "Create a Fealty token");
    expect(g.state.chain.at(-1)?.goAgain).toBe(true);
    expect(boardCount(g, 0, "fealty|0")).toBe(0);

    resolveTrigger(g);
    expect(boardCount(g, 0, "fealty|0")).toBe(1);
  });

  it("Wrath of Retribution buffs and discounts daggers when its trigger resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          weapons: ["kunai of retribution|0"],
          hand: ["wrath of retribution|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("wrath of retribution|1", { settle: false });

    expectAttackTrigger(g, "Daggers get +1 power and cost 1 less to activate this combat chain");
    expect(g.state.modifiers.some((modifier) => modifier.attackActivationCostReduction === 1)).toBe(false);

    resolveTrigger(g).blockWith().settle()
      .attackWithWeapon("kunai of retribution|0")
      .expectAttackValue(2)
      .expectResources(0, 0);
  });

  it.each([
    { key: "art of the dragon: claw|1", flag: "hntArtClaw", label: "Gain \"When this hits a hero, destroy all cards in their arsenal\"" },
    { key: "art of the dragon: scale|1", flag: "hntArtScale", label: "Gain \"When this hits a hero, put a -1 defense counter on an equipment they control\"" },
  ])("$key gains its hit ability only when its attack trigger resolves", ({ key, flag, label }) => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, board: ["fealty|0"], hand: [key] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("fealty|0").play(key, { settle: false });

    expectAttackTrigger(g, label);
    expect(g.state.chain.at(-1)?.flags[flag]).toBeUndefined();

    resolveTrigger(g);
    expect(g.state.chain.at(-1)?.flags[flag]).toBe(true);
  });

  it("Art of the Dragon: Blood gets go again when its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["fealty|0"], hand: ["art of the dragon: blood|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("fealty|0").play("art of the dragon: blood|1", { settle: false });

    expectAttackTrigger(g, "Gain go again; the next 3 Draconic cards cost 1 less to play");
    expect(g.state.chain.at(-1)?.goAgain).toBe(false);

    resolveTrigger(g);
    expect(g.state.chain.at(-1)?.goAgain).toBe(true);
  });

  it("Fire Tenet: Strike First buffs the next Draconic attack after its trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["fire tenet: strike first|1", "for the dracai|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("fire tenet: strike first|1", { settle: false });

    expectAttackTrigger(g, "Your next Draconic attack this combat chain gets +1 power");

    resolveTrigger(g).expectAttackValue(3).blockWith().settle()
      .play("for the dracai|1")
      .expectAttackValue(5);
  });

  it("Hunt to the Ends of Rathe marks Arakni through its attack trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["hunt to the ends of rathe|1"] },
        { hero: "dorinthea", heroKey: "HNT001" },
      ],
    });

    g.play("hunt to the ends of rathe|1", { settle: false });

    expectAttackTrigger(g, "Mark the defending hero");
    expect(g.state.players[1]!.hero.scriptState?.marked ?? 0).toBe(0);
    g.expectAttackValue(2);

    resolveTrigger(g).expectAttackValue(4);
    expect(g.state.players[1]!.hero.scriptState?.marked).toBe(1);
  });

  it("Hunt to the Ends of Rathe does not trigger against a hero other than Arakni", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["hunt to the ends of rathe|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("hunt to the ends of rathe|1", { settle: false });

    expect(g.state.stack).toEqual([]);
    expect(g.state.pendingDecision?.kind).toBe("defend");
  });

  it("Pick Up the Point offers retrieve only when its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: [],
          hand: ["pick up the point|1", "wrecker romp|3"],
          graveyard: ["kunai of retribution|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("pick up the point|1", { settle: false });

    expectAttackTrigger(g, "You may retrieve a dagger from your graveyard");
    expect(g.state.pendingDecision?.chooseHook).toBeUndefined();

    resolveTrigger(g);
    expect(g.state.pendingDecision?.chooseHook).toBe("pick-point-1");

    g.chooseCard("kunai of retribution|0");
    const payment = projectStateFor(g.state, 0).pendingDecision?.resourcePayment;
    g.chooseOption(payment!.options[0]!.optionId);
    expect(weaponCount(g, 0, "kunai of retribution|0")).toBe(1);
  });

  it("Sound the Alarm reveals the defending hand only when its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["sound the alarm|1"], deck: ["sink below|1"] },
        { hero: "rhinar", heroKey: "briar|0", hand: ["razor reflex|1"] },
      ],
    });

    g.play("sound the alarm|1", { settle: false });

    expectAttackTrigger(g, "The defending hero reveals their hand");
    g.expectNoLog("Razor Reflex");

    resolveTrigger(g).expectLog("Razor Reflex");
    expect(g.state.pendingDecision?.chooseHook).toBe("sound-alarm");
  });

  it("Blood Runs Deep deals dagger damage only when its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["graphene chelicera|0"],
          hand: ["blood runs deep|1", "wrecker romp|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("blood runs deep|1", { pitch: ["wrecker romp|3"], settle: false });

    expectAttackTrigger(g, "Each dagger you control deals 1 damage to the defending hero");
    g.expectLife(1, 20);
    expect(weaponCount(g, 0, "graphene chelicera|0")).toBe(1);

    resolveTrigger(g).expectLife(1, 19);
    expect(weaponCount(g, 0, "graphene chelicera|0")).toBe(0);
  });

  it("Rotten Remains offers its optional banish only when its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["rotten remains|3"], graveyard: ["bite|3"] },
        { hero: "dorinthea", graveyard: ["bite|3"] },
      ],
    });

    g.play("rotten remains|3", { settle: false });

    expectAttackTrigger(
      g,
      "You may banish a card with 1 power from each hero's graveyard for +1 power, then repeat",
    );
    expect(g.state.pendingDecision?.chooseHook).toBeUndefined();

    resolveTrigger(g);
    expect(g.state.pendingDecision?.chooseHook).toBe("rotten-own");

    g.chooseCard("bite|3");
    expect(g.state.pendingDecision?.chooseHook).toMatch(/^rotten-opponent:/);
    g.chooseCard("bite|3")
      .expectInZone(0, "bite|3", "banish")
      .expectInZone(1, "bite|3", "banish")
      .expectAttackValue(2);
    expect(g.state.pendingDecision?.kind).toBe("defend");
  });

  it("Rotten Remains repeats until its controller stops banishing", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["rotten remains|3"],
          graveyard: ["bite|3", "whittle from bone|3", "pick up the point|3"],
        },
        { hero: "dorinthea", graveyard: ["bite|3", "whittle from bone|3"] },
      ],
    });

    g.play("rotten remains|3")
      .chooseCard("bite|3").chooseCard("bite|3")
      .chooseCard("whittle from bone|3").chooseCard("whittle from bone|3")
      .expectAttackValue(3);
    // The opposing graveyard has no 1-power card left, so the process stops.
    expect(g.state.pendingDecision?.kind).toBe("defend");
    g.expectInZone(0, "pick up the point|3", "graveyard");
  });

  it("Rotten Remains may stop before banishing", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["rotten remains|3"], graveyard: ["bite|3"] },
        { hero: "dorinthea", graveyard: ["bite|3"] },
      ],
    });

    g.play("rotten remains|3").chooseOption("pass")
      .expectInZone(0, "bite|3", "graveyard")
      .expectInZone(1, "bite|3", "graveyard")
      .expectAttackValue(1);
  });

  it("Thick Hide Hunter discards at random only when its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["thick hide hunter|2", "sink below|3"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("thick hide hunter|2", { settle: false });

    expectAttackTrigger(g, "Discard a random card");
    g.expectHandSize(0, 1);

    resolveTrigger(g).expectHandSize(0, 0).expectInZone(0, "sink below|3", "graveyard");
  });

  it("Thick Hide Hunter discards at random from a defend trigger on the stack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|3"] },
        { hero: "rhinar", hand: ["thick hide hunter|2", "sink below|3"] },
      ],
    });

    g.play("raging onslaught|3").blockWith("thick hide hunter|2");

    expect(g.state.stack).toEqual([expect.objectContaining({ label: "When this defends" })]);
    g.expectHandSize(1, 1);

    resolveTrigger(g).expectHandSize(1, 0).expectInZone(1, "sink below|3", "graveyard");
  });

  it("Retrace the Past names a card only when its combo trigger resolves", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["surging strike|1", "raging onslaught|3", "whelming gustwave|1", "retrace the past|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("surging strike|1", { pitch: ["raging onslaught|3"] }).blockWith().settle()
      .play("whelming gustwave|1").blockWith().settle()
      .play("retrace the past|3", { settle: false });

    expectAttackTrigger(g, "Name a card; this gets that name, +2 power, and go again");
    expect(g.state.pendingDecision?.kind).not.toBe("choose-name");

    resolveTrigger(g);
    expect(g.state.pendingDecision).toMatchObject({ kind: "choose-name", chooseHook: "retrace-name" });
  });

  it("Douse in Runeblood creates Runechants only when its attack trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 1, hand: ["nimblism|1", "douse in runeblood|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("nimblism|1").play("douse in runeblood|1", { settle: false });

    expectAttackTrigger(g, "Create a Runechant for each non-attack action card you've played this turn");
    expect(boardCount(g, 0, "runechant|0")).toBe(0);

    resolveTrigger(g);
    expect(boardCount(g, 0, "runechant|0")).toBe(1);
  });
});

describe("HNT — Spur Locked", () => {
  const spurScenario = () =>
    scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["spur locked|3"],
          deck: ["wrecker romp|3", "sink below|1"],
        },
        { hero: "rhinar", deck: ["fry|1"] },
      ],
    });

  it("lets each hero choose a number, hiding the first choice until both are revealed", () => {
    const g = spurScenario();
    const life = g.state.players[0]!.life;

    g.play("spur locked|3");
    expect(g.state.pendingDecision).toMatchObject({ player: 0, options: ["1", "2", "3", "4", "5", "6"] });

    g.chooseOption("5");
    expect(g.state.pendingDecision).toMatchObject({ player: 1, options: ["1", "2", "3", "4", "5", "6"] });
    const opposingView = projectStateFor(g.state, 1);
    expect(JSON.stringify(opposingView)).not.toContain("spurLockedNumber");
    expect(opposingView.log.join("\n")).not.toContain("chose 5");

    g.chooseOption("2").expectLog("chose 5").expectLog("chose 2").expectLife(0, life - 5);
    const reveal = projectStateFor(g.state, 1).logEntries?.at(-1);
    expect(reveal && "event" in reveal ? reveal.event : undefined).toMatchObject({
      kind: "numbers-revealed",
      choices: [{ seat: 0, number: 5 }, { seat: 1, number: 2 }],
    });
    expect(g.state.pendingDecision?.player).toBe(0);
    g.chooseCard("sink below|1");
    expect(g.state.players[0]!.hand.map((card) => cardData[card.cardId]!.name)).toContain("Sink Below");
    expect(g.state.players[0]!.flags.spurLockedNumber).toBe(0);
  });

  it("makes the opponent pay and search when they choose the higher number", () => {
    const g = spurScenario();
    const life = g.state.players[1]!.life;

    g.play("spur locked|3").chooseOption("1").chooseOption("3").expectLife(1, life - 3);
    expect(g.state.pendingDecision?.player).toBe(1);
  });

  it("does nothing further when both heroes choose the same number", () => {
    const g = spurScenario();
    const lives = g.state.players.map((player) => player.life);

    g.play("spur locked|3").chooseOption("4").chooseOption("4");
    expect(g.state.players.map((player) => player.life)).toEqual(lives);
    expect(g.state.pendingDecision?.chooseHook).not.toBe("spur-search");
  });
});

describe("HNT — Under the Trap-Door", () => {
  it("lets the banished trap be played only once", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["under the trap-door|3"], graveyard: ["rune snare|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.activate("under the trap-door|3").chooseCard("rune snare|1");
    g.play("rune snare|1", { fromZone: "banish" });

    const snare = g.state.players[0]!.banish.find((card) => card.cardId === printingId("rune snare|1"));
    expect(snare).toBeDefined();
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "play-from-zone" && intent.instanceId === snare!.instanceId,
    )).toBe(false);
  });
});
