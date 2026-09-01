import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("Malice Armory Deck spoiled cards", () => {
  it("Malice grants a chosen graveyard zombie play access", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        graveyard: ["restless commander|1"],
        resources: 1,
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("malice, domina of the dead|0").chooseCard("restless commander|1");

    expect(g.state.players[0]!.graveyard[0]?.playableFrom).toContain("graveyard");
    expect(g.state.players[0]!.hero.tapped).toBe(true);
    expect(g.state.players[0]!.actionPoints).toBe(1);
  });

  it("Malice creates a Corrupted Corpse in banish when another zombie dies", () => {
    const g = scenario({ active: 1, seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        board: ["restless commander|1"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        resources: 3,
        weapons: ["titan's fist|0"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.attackWithWeapon("titan's fist|0", { targetAlly: "restless commander|1" });

    const banish = g.state.players[0]!.banish;
    expect(banish.find((card) => card.cardId === "AMA014")?.faceDown).toBe(true);
    expect(banish.find((card) => card.cardId === "IAR090")?.faceDown).not.toBe(true);
  });

  it("Corrupted Corpse cannot be pitched", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["corrupted corpse|0", "raging onslaught|3"],
        weapons: ["titan's fist|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    const corpseId = g.state.players[0]!.hand.find(
      (card) => card.cardId === "IAR090",
    )!.instanceId;
    const fistId = g.state.players[0]!.weapons[0]!.instanceId;
    const payments = legalIntents(g.state, 0).flatMap((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === fistId
        ? [intent.pitchInstanceIds]
        : []
    );

    expect(payments.length).toBeGreaterThan(0);
    expect(payments.every((payment) => !payment.includes(corpseId))).toBe(true);
  });

  it("Corrupted Corpse attacks with go again after Malice recurs it", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        graveyard: ["corrupted corpse|0"],
        resources: 3,
        weapons: ["vox necropolis|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("malice, domina of the dead|0")
      .chooseCard("corrupted corpse|0")
      .play("corrupted corpse|0", { fromZone: "graveyard" })
      .blockWith()
      .settle();

    expect(g.state.players[0]!.actionPoints).toBe(1);
  });

  it("Malice's permission does not follow a Dig for Souls zombie through death", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        hand: ["dig for souls|1"],
        graveyard: ["restless commander|1"],
        resources: 5,
        weapons: ["vox necropolis|0"],
        equipment: { ...NO_EQUIPMENT, legs: "danse macabre|0" },
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.activate("malice, domina of the dead|0")
      .chooseCard("restless commander|1")
      .play("dig for souls|1", { settle: false })
      .chooseOption("X = 0")
      .chooseOption("no")
      .play("restless commander|1", { fromZone: "graveyard" });

    const dansePayment = g.state.pendingDecision?.options?.find((option) => option !== "no");
    expect(dansePayment).toBeDefined();
    g.doRaw({ kind: "choose", optionId: dansePayment! })
      .settle()
      .blockWith()
      .settle();

    const commander = g.state.players[0]!.banish.find((card) => card.cardId === "AMA014");
    expect(commander).toMatchObject({ faceDown: true });
    expect(commander?.playableFrom).toBeUndefined();
    expect(g.state.players[0]!.graveyard.some((card) => card.cardId === "AMA014"))
      .toBe(false);
    expect(g.state.players[0]!.banish.some((card) => card.cardId === "IAR090" && !card.faceDown))
      .toBe(true);
  });

  it("Incarnate makes Corrupted Corpse cease to exist instead of dying", () => {
    const g = scenario({ active: 1, seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        board: ["corrupted corpse|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        resources: 3,
        weapons: ["titan's fist|0"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.attackWithWeapon("titan's fist|0", { targetAlly: "corrupted corpse|0" });

    expect(g.state.players[0]!.board).toHaveLength(0);
    expect(g.state.players[0]!.graveyard).toHaveLength(0);
    expect(g.state.players[0]!.banish).toHaveLength(0);
  });

  it("Corrupted Corpse's Blood Debt triggers while it is banished", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        life: 20,
        banish: ["corrupted corpse|0"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.endTurn().expectLife(0, 19);
  });

  it("Vox makes a zombie played from graveyard enter tapped and attack", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        graveyard: ["restless commander|1"],
        resources: 1,
        weapons: ["vox necropolis|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.activate("malice, domina of the dead|0")
      .chooseCard("restless commander|1")
      .play("restless commander|1", { fromZone: "graveyard" });

    expect(g.state.players[0]!.board[0]).toEqual(expect.objectContaining({ tapped: true }));
    expect(g.state.chain.at(-1)?.attackingCard.cardId).toBe("AMA014");
    g.blockWith().settle().expectLife(1, 16);
  });

  it("Corrupted Crown may banish a hand card for +1 defense", () => {
    const g = scenario({ active: 1, seats: [
      {
        hero: "rhinar",
        hand: ["titanium bauble|3"],
        equipment: { ...NO_EQUIPMENT, head: "corrupted crown|0" },
      },
      {
        hero: "dorinthea",
        hand: ["head jab|1"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("head jab|1").blockWith("corrupted crown|0")
      .passPriority().passPriority()
      .chooseCard("titanium bauble|3");

    expect(g.state.players[0]!.banish).toHaveLength(1);
    expect(g.state.chain.at(-1)?.finalDefense).toBe(2);
  });

  it("Restless Commander loses one base life to Decay", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        board: ["restless commander|1"],
        weapons: ["vox necropolis|0"],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.activate("restless commander|1").blockWith().settle().expectLife(1, 17);
    g.endTurn();

    expect(g.state.players[0]!.board[0]).toEqual(expect.objectContaining({
      life: 2,
      counters: expect.objectContaining({ lifePenalty: 1 }),
    }));
  });

  it("Dig for Souls declares and pays X before it is played", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["dig for souls|1", "titanium bauble|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });
    const dig = g.state.players[0]!.hand.find((card) => card.cardId === "AMA011")!;
    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: dig.instanceId,
      deferPlayPresentation: true,
    }));
    g.play("dig for souls|1", { settle: false });
    expect(g.state.pendingDecision?.options).toContain("X = 2");
    expect(g.state.players[0]!.hand.some((card) => card.cardId === "AMA011")).toBe(true);
    expect(g.state.stack).toHaveLength(0);
    expect(projectStateFor(g.state, 0).pendingDecision?.preStackSource).toMatchObject({
      card: { instanceId: dig.instanceId },
      zone: "hand",
    });

    g.chooseOption("X = 2");
    expect(g.state.pendingDecision?.resourcePayment?.cost).toBe(2);
    g.chooseOption("pitch Titanium Bauble");
    expect(g.state.players[0]!.hand.some((card) => card.cardId === "AMA011")).toBe(false);
    expect(g.state.stack).toHaveLength(1);
  });

  it("Dig for Souls pays X from floating resources without asking for pitch", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["dig for souls|1"],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("dig for souls|1", { settle: false });
    g.chooseOption("X = 2");

    expect(g.state.pendingDecision?.chooseHook).toBe("ama-dig-zombie");
    expect(g.state.players[0]!.resources).toBe(0);
    expect(g.state.players[0]!.hand.some((card) => card.cardId === "AMA011")).toBe(false);
    expect(g.state.stack).toHaveLength(1);
  });
});
