import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";

describe("Blood Debt and Rune Gate", () => {
  const runeGateCards = [
    "widespread annihilation|3",
    "widespread destruction|2",
    "widespread ruin|1",
    "deathly delight|1", "deathly delight|2", "deathly delight|3",
    "deathly wail|1", "deathly wail|2", "deathly wail|3",
    "rift skitter|1", "rift skitter|2", "rift skitter|3",
    "vantom banshee|1", "vantom banshee|2", "vantom banshee|3",
    "vantom wraith|1", "vantom wraith|2", "vantom wraith|3",
    "deep recesses of existence|3",
    "eloquent eulogy|1",
  ] as const;

  it("requires each Rune Gate card's printed cost in controlled Runechants", () => {
    for (const key of runeGateCards) {
      const cost = cardData[printingId(key)]!.cost!;
      const insufficient = scenario({
        seats: [
          { hero: "rhinar", banish: [key], board: Array(cost - 1).fill("runechant|0") as string[] },
          { hero: "dorinthea" },
        ],
      });
      const insufficientCard = insufficient.state.players[0]!.banish[0]!;
      expect(legalIntents(insufficient.state, 0).some(
        (intent) => intent.kind === "play-from-zone" && intent.instanceId === insufficientCard.instanceId,
      ), key).toBe(false);

      const enough = scenario({
        seats: [
          { hero: "rhinar", banish: [key], board: Array(cost).fill("runechant|0") as string[] },
          { hero: "dorinthea" },
        ],
      });
      const enoughCard = enough.state.players[0]!.banish[0]!;
      expect(legalIntents(enough.state, 0)).toContainEqual(expect.objectContaining({
        kind: "play-from-zone",
        zone: "banish",
        instanceId: enoughCard.instanceId,
        pitchInstanceIds: [],
      }));

      const normal = scenario({
        seats: [
          { hero: "rhinar", hand: [key], resources: cost },
          { hero: "dorinthea" },
        ],
      });
      const normalCard = normal.state.players[0]!.hand[0]!;
      expect(legalIntents(normal.state, 0)).toContainEqual(expect.objectContaining({
        kind: "play-card",
        instanceId: normalCard.instanceId,
        pitchInstanceIds: [],
      }));
    }
  }, 15_000);

  it("Eloquent Eulogy rune gates from banish with one Runechant", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", banish: ["eloquent eulogy|1"], board: ["runechant|0"] },
        { hero: "dorinthea" },
      ],
    });
    const eulogy = g.state.players[0]!.banish[0]!;

    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-from-zone",
      zone: "banish",
      instanceId: eulogy.instanceId,
      pitchInstanceIds: [],
    }));

    g.play("eloquent eulogy|1", { fromZone: "banish" })
      .expectZoneSize(0, "board", 0);
  });

  it("Eloquent Eulogy creates Eloquence on chain close and goes to graveyard", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", banish: ["eloquent eulogy|1"], board: ["runechant|0"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("eloquent eulogy|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .settle()
      .expectInZone(0, "eloquent eulogy|1", "graveyard")
      .expectNotInZone(0, "eloquent eulogy|1", "banish")
      .expectInZone(0, "eloquence|0", "board");
  });

  it("Blood Debt does not replace an attack's normal move to graveyard", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["shadowrealm horror|1"],
          graveyard: ["wounding blow|1", "wounding blow|2", "wounding blow|3"],
          resources: 2,
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("shadowrealm horror|1")
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .settle()
      .expectInZone(0, "shadowrealm horror|1", "graveyard")
      .expectNotInZone(0, "shadowrealm horror|1", "banish");
  });

  it("Widespread Annihilation lets each affected hero choose their hand card", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "vynnset, iron maiden|0",
          hand: ["fasting carcass|3", "wounding blow|1", "wounding blow|2"],
          banish: ["widespread annihilation|3"],
          board: Array(4).fill("runechant|0") as string[],
        },
        { hero: "dorinthea", hand: ["head jab|1", "head jab|2"] },
      ],
    });

    g.play("fasting carcass|3")
      .chooseOption("yes")
      .play("widespread annihilation|3", { fromZone: "banish" })
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .chooseCard("wounding blow|2")
      .chooseCard("head jab|2")
      .expectInZone(0, "wounding blow|2", "banish")
      .expectInZone(0, "wounding blow|1", "hand")
      .expectInZone(1, "head jab|2", "banish")
      .expectInZone(1, "head jab|1", "hand");
  });

  it("Widespread Destruction lets each affected hero choose and reveals the banished arsenal card", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          banish: ["widespread destruction|2"],
          board: Array(3).fill("runechant|0") as string[],
        },
        {
          hero: "dorinthea",
          arsenalFaceDown: ["wounding blow|1", "wounding blow|2"],
        },
      ],
    });

    g.play("widespread destruction|2", { fromZone: "banish" })
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .chooseCard("wounding blow|2")
      .expectInZone(1, "wounding blow|2", "banish")
      .expectInZone(1, "wounding blow|1", "arsenal");
    expect(g.state.players[1]!.banish[0]!.faceDown).not.toBe(true);
  });

  it("Widespread Ruin banishes only affected heroes' top cards", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          deck: ["wounding blow|1"],
          banish: ["widespread ruin|1"],
          board: Array(2).fill("runechant|0") as string[],
        },
        { hero: "dorinthea", deck: ["wounding blow|2", "wounding blow|3"] },
      ],
    });

    g.play("widespread ruin|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .settle()
      .expectInZone(0, "wounding blow|1", "deck")
      .expectInZone(1, "wounding blow|2", "banish")
      .expectInZone(1, "wounding blow|3", "deck");
  });

  it("Deathly Delight and Deathly Wail count heroes who lost life", () => {
    const delight = scenario({
      seats: [
        {
          hero: "rhinar",
          life: 10,
          banish: ["deathly delight|1"],
          board: Array(2).fill("runechant|0") as string[],
        },
        { hero: "dorinthea" },
      ],
    });
    delight.play("deathly delight|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .settle()
      .expectLife(0, 11);

    const wail = scenario({
      seats: [
        {
          hero: "rhinar",
          banish: ["deathly wail|1"],
          board: Array(3).fill("runechant|0") as string[],
        },
        { hero: "dorinthea" },
      ],
    });
    wail.play("deathly wail|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .settle()
      .expectZoneSize(0, "board", 1)
      .expectInZone(0, "runechant|0", "board");
  });

  it("Rift Skitter grants its printed go again after resolving", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          banish: ["rift skitter|1"],
          board: Array(3).fill("runechant|0") as string[],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("rift skitter|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("next-rune-gated bonuses survive ordinary attacks and combine on the gated attack", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 4,
          hand: ["head jab|1", "envelop in darkness|3"],
          banish: ["putrid stirrings|1", "eloquent eulogy|1"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("putrid stirrings|1", { fromZone: "banish" });
    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("putrid stirrings|1"),
      label: "+5 attack · next rune-gated attack",
    });

    g.play("head jab|1")
      .expectAttackValue(3)
      .blockWith()
      .settle()
      .play("envelop in darkness|3")
      .play("eloquent eulogy|1", { fromZone: "banish" })
      .expectAttackValue(10);
  });

  it("Deep Recesses is optional and its controller chooses affected graveyard cards", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "vynnset, iron maiden|0",
          hand: ["fasting carcass|3"],
          graveyard: ["wounding blow|1", "wounding blow|2"],
          banish: ["deep recesses of existence|3"],
          board: Array(4).fill("runechant|0") as string[],
        },
        {
          hero: "dorinthea",
          graveyard: ["head jab|1", "head jab|2"],
        },
      ],
    });

    g.play("fasting carcass|3")
      .chooseOption("yes")
      .play("deep recesses of existence|3", { fromZone: "banish" })
      .blockWith()
      .settle()
      .doRaw({ kind: "close-chain" })
      .chooseOption("yes")
      .chooseCard("wounding blow|2")
      .chooseCard("head jab|2")
      .expectInZone(0, "deep recesses of existence|3", "banish")
      .expectInZone(0, "wounding blow|2", "banish")
      .expectInZone(0, "wounding blow|1", "graveyard")
      .expectInZone(1, "head jab|2", "banish")
      .expectInZone(1, "head jab|1", "graveyard");
    expect(g.state.players[0]!.banish.find(
      (card) => card.cardId === printingId("deep recesses of existence|3"),
    )?.faceDown).toBe(true);
  });

  it("Fasting Carcass grants go again to a matching Rune Gate card from banish", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["fasting carcass|1"],
          banish: ["eloquent eulogy|1"],
          board: ["runechant|0"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("fasting carcass|1").expectAP(0, 1);
    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("fasting carcass|1"),
      label: "go again · next red action card",
    });

    g.play("eloquent eulogy|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .expectAP(0, 1);
    expect(projectStateFor(g.state, 0).ongoing).not.toContainEqual(
      expect.objectContaining({ cardId: printingId("fasting carcass|1") }),
    );
  });

  it("does not rune gate Oblivion, which has neither keyword", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          banish: ["oblivion|3"],
          board: Array(6).fill("runechant|0") as string[],
        },
        { hero: "dorinthea" },
      ],
    });
    const oblivion = g.state.players[0]!.banish[0]!;

    expect(legalIntents(g.state, 0).some(
      (intent) => intent.kind === "play-from-zone" && intent.instanceId === oblivion.instanceId,
    )).toBe(false);
  });

  it("tracks Blood Debt cards played for Eclipse's play condition", () => {
    const played = scenario({
      seats: [
        { hero: "rhinar", hand: ["cull|1"] },
        { hero: "dorinthea", hand: ["wounding blow|1"] },
      ],
    });
    played.play("cull|1");
    expect(played.state.players[0]!.flags.bloodDebtCardsPlayedThisTurn).toBe(1);

    const eclipse = scenario({
      seats: [
        { hero: "rhinar", banish: ["eclipse|3"] },
        { hero: "dorinthea" },
      ],
    });
    const eclipseCard = eclipse.state.players[0]!.banish[0]!;
    expect(legalIntents(eclipse.state, 0).some(
      (intent) => intent.kind === "play-from-zone" && intent.instanceId === eclipseCard.instanceId,
    )).toBe(false);

    eclipse.state.players[0]!.flags.bloodDebtCardsPlayedThisTurn = 6;
    expect(legalIntents(eclipse.state, 0).some(
      (intent) => intent.kind === "play-from-zone" && intent.instanceId === eclipseCard.instanceId,
    )).toBe(true);
  });

  it.each(["cull|1", "funeral moon|1"])(
    "%s becomes playable as an instant after combat damage on the opponent's turn",
    (key) => {
      const g = scenario({
        seats: [
          { hero: "rhinar", banish: [key] },
          { hero: "dorinthea", hand: ["wounding blow|1"] },
        ],
        active: 1,
      });
      const card = g.state.players[0]!.banish[0]!;
      const isInstantPlay = () => legalIntents(g.state, 0).some(
        (intent) => intent.kind === "play-from-zone" &&
          intent.instanceId === card.instanceId &&
          intent.asInstant === true,
      );

      g.play("wounding blow|1").blockWith().passPriority();
      expect(isInstantPlay()).toBe(false);

      g.passPriority();
      expect(g.state.players[0]!.flags.lostLifeThisTurn).toBe(true);
      expect(g.state.pendingDecision).toMatchObject({
        kind: "priority-window",
        player: 1,
      });

      g.passPriority();
      expect(isInstantPlay()).toBe(true);
      g.react(key, { settle: false }).expectAP(0, 0);
    },
  );

  it("each public Blood Debt card in banish loses 1 life", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", banish: ["eloquent eulogy|1", "shadowrealm horror|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.endTurn().expectLife(0, 18);
  });

  it("a face-down Blood Debt card does not trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", banish: ["eloquent eulogy|1"] },
        { hero: "dorinthea" },
      ],
    });
    g.state.players[0]!.banish[0]!.faceDown = true;

    g.endTurn().expectLife(0, 20);
  });

  it("only Levia suppresses Blood Debt after a six-power banish", () => {
    const ordinary = scenario({
      seats: [
        { hero: "rhinar", banish: ["shaden death hydra|2"] },
        { hero: "dorinthea" },
      ],
    });
    ordinary.state.players[0]!.flags.banishedSixPlusThisTurn = true;
    ordinary.endTurn().expectLife(0, 19);

    const levia = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "levia, shadowborn abomination|0",
          banish: ["shadow of blasmophet|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    levia.state.players[0]!.flags.banishedSixPlusThisTurn = true;
    levia.endTurn().expectLife(0, cardData[printingId("levia, shadowborn abomination|0")]!.life!);
  });

  it("Levia, Redeemed removes Blood Debt without a six-power banish", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "levia, redeemed|0", banish: ["eloquent eulogy|1"] },
        { hero: "dorinthea" },
      ],
    });

    g.endTurn().expectLife(0, cardData[printingId("levia, redeemed|0")]!.life!);
  });
});
