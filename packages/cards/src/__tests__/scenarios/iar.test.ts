import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, isImplemented } from "../../index.js";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;
const RUNECHANT_ID = "ARC112";

function boardNames(game: ReturnType<typeof scenario>, seat: number): string[] {
  return game.state.players[seat]!.board.map((card) => cardData[card.cardId]!.name);
}

describe("IAR spoiled cards", () => {
  it("registers the latest spoiled collector numbers", () => {
    expect(Object.fromEntries([
      "IAR115",
      "IAR116",
      "IAR118",
      "IAR119",
      "IAR146",
      "IAR167",
      "IAR179",
      "IAR180",
      "IAR209",
      "IAR211",
      "IAR243",
      "IAR245",
      "IAR248",
      "IAR249",
      "IAR250",
      "IAR252",
      "IAR259",
    ].map((id) => [id, cardData[id]?.name]))).toEqual({
      IAR115: "Cullingsong Gloomblade",
      IAR116: "Plundersong Gloomblade",
      IAR118: "Vexing Gloomblade",
      IAR119: "Vexing Gloomblade",
      IAR146: "Runic Disposition",
      IAR167: "Countdown to Extinction",
      IAR179: "Dimenxxional Ferryman",
      IAR180: "Planar Chaos",
      IAR209: "Darkest Hour",
      IAR211: "Darkest Hour",
      IAR243: "Deadly Spinneret",
      IAR245: "Stoke Vengeance",
      IAR248: "Echoing Trap",
      IAR249: "Sigil of the Muse",
      IAR250: "Astral Ambience",
      IAR252: "Rush of Knowledge",
      IAR259: "Chains of Consecration",
    });
  });

  it("Forsaken Strike is a yellow zero-cost attack", () => {
    expect(cardData.IAR057).toMatchObject({ pitch: 2, cost: 0 });
  });

  it("Hex Gauntlet cannot be activated over an automatic End Phase Blood Debt trigger", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        life: 20,
        banish: ["grimoire of the haunt|0"],
        equipment: { ...NO_EQUIPMENT, arms: "hex gauntlet|0" },
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.doRaw({ kind: "pass" });
    expect(g.state.pendingDecision?.kind).not.toBe("priority-window");
    expect(g.state.stack).toHaveLength(0);
    expect(g.state.players[0]!.equipment.arms).toBeDefined();
    expect(g.state.players[0]!.banish.find((card) => card.cardId === "DTD136")?.faceDown)
      .not.toBe(true);
    g.expectLife(0, 19).expectTurn(2);
  });

  it.each([
    ["red", "shadowrealm strength|1", 10],
    ["blue", "shadowrealm strength|3", 12],
  ])("Shadowrealm Strength (%s) recovers a face-up zombie and buffs the next attack", (
    _color,
    strength,
    expectedLife,
  ) => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [strength, "raging onslaught|1"],
        banish: ["restless cleric|1"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play(strength).chooseCard("restless cleric|1");
    expect(g.state.players[0]!.graveyard).toContainEqual(
      expect.objectContaining({ cardId: "IAR084" }),
    );
    expect(g.state.players[0]!.actionPoints).toBe(1);

    g.play("raging onslaught|1").blockWith().settle().expectLife(1, expectedLife);
  });

  it("Shadowrealm Strength cannot choose a face-down banished card", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["shadowrealm strength|1", "raging onslaught|1"],
        banishFaceDown: ["restless cleric|1"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("shadowrealm strength|1");
    expect(g.state.pendingDecision).toBeNull();
    expect(g.state.players[0]!.banish).toContainEqual(
      expect.objectContaining({ cardId: "IAR084", faceDown: true }),
    );

    g.play("raging onslaught|1").blockWith().settle().expectLife(1, 13);
  });

  it("Restless Cleric gains life and then loses base life to Decay", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        life: 18,
        board: ["restless cleric|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("restless cleric|1").expectLife(0, 19);
    expect(g.state.players[0]!.actionPoints).toBe(1);

    g.endTurn();
    expect(g.state.players[0]!.board[0]).toEqual(expect.objectContaining({
      life: 2,
      counters: expect.objectContaining({ lifePenalty: 1 }),
    }));
  });

  it("Restless Magister banishes only when its own attack hits", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["raging onslaught|1", "titanium bauble|3"],
        board: ["restless magister|1"],
        weapons: ["vox necropolis|0"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        hand: ["sink below|1", "snatch|1"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.activate("restless magister|1")
      .blockWith()
      .settle()
      .chooseCard("sink below|1");

    expect(g.state.players[1]!.banish).toHaveLength(1);

    g.doRaw({ kind: "close-chain" }).endTurn().endTurn();
    g.play("raging onslaught|1", { pitch: ["titanium bauble|3"] }).blockWith().settle();

    expect(g.state.pendingDecision).toBeNull();
    expect(g.state.players[1]!.banish).toHaveLength(1);
  });

  it("Restless Quartermaster banishes only when its own attack hits", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["raging onslaught|1", "titanium bauble|3"],
        board: ["restless quartermaster|1"],
        weapons: ["vox necropolis|0"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        arsenal: ["sink below|1", "snatch|1"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.activate("restless quartermaster|1")
      .blockWith()
      .settle()
      .chooseCard("sink below|1");

    expect(g.state.players[1]!.banish).toHaveLength(1);

    g.doRaw({ kind: "close-chain" }).endTurn().endTurn();
    g.play("raging onslaught|1", { pitch: ["titanium bauble|3"] }).blockWith().settle();

    expect(g.state.pendingDecision).toBeNull();
    expect(g.state.players[1]!.banish).toHaveLength(1);
    expect(g.state.players[1]!.arsenal).toHaveLength(1);
  });

  it.each(["restless cleric|1", "restless corporal|1"])(
    "%s consumes an action point when played because only its activated ability has go again",
    (ally) => {
      const g = scenario({ seats: [
        {
          hero: "rhinar",
          hand: [ally],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ] });

      g.play(ally).expectAP(0, 0);
    },
  );

  it("Seven Sin Nebula unlocks after a banished-zone play and creates a Runechant on hit", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        banish: ["invert existence|3"],
        weapons: ["seven sin nebula|0"],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("invert existence|3", { fromZone: "banish" });
    g.attackWithWeapon("seven sin nebula|0").blockWith().settle().expectLife(1, 17);

    expect(g.state.players[0]!.board).toContainEqual(
      expect.objectContaining({ cardId: RUNECHANT_ID }),
    );
  });

  it("Usurp the Shadow Throne turns face-up banished cards down and swings life", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        life: 20,
        hand: ["usurp the shadow throne|3"],
        resources: 13,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        banish: ["raging onslaught|1", "raging onslaught|2"],
        banishFaceDown: ["raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("usurp the shadow throne|3").blockWith().settle();

    expect(g.state.players[1]!.banish.every((card) => card.faceDown)).toBe(true);
    g.expectLife(0, 22).expectLife(1, 5);
  });

  it("Otherworldly Sins creates a Runechant and buffs a matching next attack", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["otherworldly sins|1", "rift bind|1"],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("otherworldly sins|1");
    expect(g.state.players[0]!.board).toContainEqual(
      expect.objectContaining({ cardId: RUNECHANT_ID }),
    );

    g.play("rift bind|1").blockWith().settle().expectLife(1, 13);
  });

  it("Baalghor banishes pitched cards", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "baalghor, omen of the end|0",
        hand: ["raging onslaught|1", "titanium bauble|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("raging onslaught|1", { pitch: ["titanium bauble|3"], settle: false });

    expect(g.state.players[0]!.pitch).toHaveLength(0);
    expect(g.state.players[0]!.banish).toEqual([
      expect.objectContaining({ cardId: "DVR027" }),
    ]);
  });

  it("Baalghor gives attack actions played from banish +3 power", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "baalghor, omen of the end|0",
        banish: ["rift bind|1"],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("rift bind|1", { fromZone: "banish" }).blockWith().settle().expectLife(1, 14);
  });

  it("Gate to i'Arathael grants its chosen blood-debt action play access", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "baalghor, omen of the end|0",
        board: ["gate to i'arathael|0"],
        banish: ["rift bind|1"],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("gate to i'arathael|0").chooseCard("rift bind|1");

    expect(g.state.players[0]!.banish[0]?.playableFrom).toContain("banish");
    expect(g.state.players[0]!.board).toHaveLength(0);
  });

  it("Soul of Existence pitches for 4 and its trigger costs 1 life", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        life: 20,
        hand: ["beckoning hunger|1", "soul of existence|4"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("beckoning hunger|1", { pitch: ["soul of existence|4"] })
      .blockWith()
      .settle()
      .expectLife(0, 19)
      .expectLife(1, 13);

    expect(g.state.players[0]!.resources).toBe(1);
  });

  it("Usurp destroys a specialized Runechant and applies both power bonuses", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["demonbound gloomblade|1"],
        board: ["runechant of pride|2"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("demonbound gloomblade|1").chooseCard("runechant of pride|2")
      .blockWith()
      .settle()
      .expectLife(1, 13);

    expect(g.state.players[0]!.flags.usurpedThisTurn).toBe(true);
    expect(g.state.players[0]!.board).toHaveLength(0);
  });

  it("Runic Reaving can be discarded at instant speed to create a Runechant", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["runic reaving|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("runic reaving|1");

    expect(g.state.players[0]!.graveyard).toContainEqual(
      expect.objectContaining({ cardId: "FAB477" }),
    );
    expect(g.state.players[0]!.board).toContainEqual(
      expect.objectContaining({ cardId: RUNECHANT_ID }),
    );
  });

  it("Runic Disposition can be discarded at instant speed to create a Runechant", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["runic disposition|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("runic disposition|1")
      .expectInZone(0, "runic disposition|1", "graveyard")
      .expectInZone(0, "runechant|0", "board");
  });

  it("Runic Reaving usurps a Runechant for +2 power", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["runic reaving|1"],
        board: ["runechant|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("runic reaving|1")
      .chooseCard("runechant|0")
      .blockWith()
      .settle()
      .expectLife(1, 14);

    expect(g.state.players[0]!.board).toHaveLength(0);
  });

  it("Become the Shadow Lord and Open the Gate each create their Gate", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["become the shadow lord|3", "open the gate to i'arathael|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("become the shadow lord|3").chooseCard("open the gate to i'arathael|1");

    expect(g.state.players[0]!.banish).toContainEqual(
      expect.objectContaining({ cardId: "IAR166" }),
    );
    expect(g.state.players[0]!.board.filter((card) => card.cardId === "IAR222")).toHaveLength(2);
  });

  it("Pull from Beyond creates a Gate when the post-opt top card matches", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["pull from beyond|1"],
        deck: ["raging onslaught|1", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("pull from beyond|1").chooseOption("pass");

    expect(g.state.players[0]!.banish).toHaveLength(1);
    expect(g.state.players[0]!.board).toContainEqual(
      expect.objectContaining({ cardId: "IAR222" }),
    );
  });

  it("Viserai traverses after creating the third Runechant", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "viserai, between worlds|0",
        hand: ["otherworldly sins|1", "otherworldly sins|1", "otherworldly sins|1"],
        deck: ["raging onslaught|1", "raging onslaught|2", "raging onslaught|3"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("otherworldly sins|1")
      .play("otherworldly sins|1")
      .play("otherworldly sins|1");

    expect(g.state.players[0]!.heroCardId).toBe("IAR107B");
    expect(g.state.players[0]!.banish).toHaveLength(3);
    expect(g.state.players[0]!.life).toBe(20);
  });

  it("Viserai's Runechant ability uses a triggered layer", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "viserai, the forsaken|0",
        hand: ["runic reaving|1"],
        deck: ["raging onslaught|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("runic reaving|1", { settle: false })
      .passPriority()
      .passPriority();

    expect(g.state.players[0]!.board).toContainEqual(
      expect.objectContaining({ cardId: RUNECHANT_ID }),
    );
    expect(g.state.players[0]!.banish).toHaveLength(0);
    expect(g.state.stack[0]?.label).toContain("Banish the top card");
    expect(g.state.pendingDecision?.kind).toBe("priority-window");

    g.passPriority().passPriority();

    expect(g.state.players[0]!.banish).toHaveLength(1);
    expect(g.state.players[0]!.heroCardId).toBe("IAR106");
  });

  it("Viserai, Usurper gives the first blood-debt attack go again", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "IAR107B",
        hand: ["open the gate to i'arathael|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("open the gate to i'arathael|1").blockWith().settle();

    expect(g.state.players[0]!.actionPoints).toBe(1);
  });

  it("Viserai, Usurper counts a blood-debt attack played before traversing", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "viserai, between worlds|0",
        hand: [
          "captain's call|3",
          "open the gate to i'arathael|1",
          "otherworldly sins|1",
          "otherworldly sins|1",
          "otherworldly sins|1",
          "unbound by shadow|1",
        ],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 30, equipment: NO_EQUIPMENT },
    ] });

    g.play("captain's call|3")
      .chooseOption("go-again")
      .play("open the gate to i'arathael|1")
      .blockWith()
      .settle()
      .play("otherworldly sins|1")
      .play("otherworldly sins|1")
      .play("otherworldly sins|1");

    expect(g.state.players[0]!.heroCardId).toBe("IAR107B");

    g.play("unbound by shadow|1").blockWith().settle();

    expect(g.state.players[0]!.actionPoints).toBe(0);
  });

  it("Unique prevents a second Blasmophet token from entering", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["beckoning hunger|1"],
        board: ["blasmophet, the insatiable hunger|0"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("beckoning hunger|1").blockWith().settle();

    expect(g.state.players[0]!.board.filter((card) => card.cardId === "IAR221")).toHaveLength(1);
  });

  it("Bloodsong Gloomblade usurps and banishes an opposing aura on hit", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["bloodsong gloomblade|1"],
        board: ["runechant|0"],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        board: ["runechant of pride|2"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("bloodsong gloomblade|1")
      .chooseCard("runechant|0")
      .blockWith()
      .settle()
      .chooseCard("runechant of pride|2")
      .expectLife(1, 16)
      .expectInZone(1, "runechant of pride|2", "banish");
  });

  it("Cullingsong Gloomblade makes the hit hero banish a card from hand", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["cullingsong gloomblade|1"],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|1"],
        life: 20,
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("cullingsong gloomblade|1")
      .blockWith()
      .settle()
      .chooseCard("raging onslaught|1")
      .expectLife(1, 18)
      .expectInZone(1, "raging onslaught|1", "banish");
  });

  it.each([
    ["red", "vexing gloomblade|1", 13],
    ["yellow", "vexing gloomblade|2", 14],
    ["blue", "vexing gloomblade|3", 15],
  ])("Vexing Gloomblade (%s) deals its on-hit arcane damage to the chosen target", (
    _color,
    vexing,
    expectedLife,
  ) => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [vexing],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play(vexing)
      .blockWith()
      .settle()
      .chooseOption("opposing hero")
      .expectLife(1, expectedLife);
  });

  it("Embrace Sin grants dynamic Runechant-aura play access from banish", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [
          "embrace sin|2",
          "become the shadow lord|3",
          "runechant of pride|2",
          "raging onslaught|1",
        ],
        resources: 4,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("embrace sin|2")
      .play("become the shadow lord|3")
      .chooseCard("runechant of pride|2")
      .play("runechant of pride|2", { fromZone: "banish" });

    expect(g.state.players[0]!.board).toContainEqual(
      expect.objectContaining({ cardId: "IAR155" }),
    );
    g.play("raging onslaught|1").blockWith().settle().expectLife(1, 10);
  });

  it("Harbinger of Destruction creates two Gates after banishing a Shadow card", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["harbinger of destruction|1", "tribute to greater power|1"],
        resources: 8,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("harbinger of destruction|1")
      .chooseCard("tribute to greater power|1")
      .blockWith()
      .settle()
      .expectLife(1, 7);

    expect(g.state.players[0]!.board.filter((card) => card.cardId === "IAR222"))
      .toHaveLength(2);
  });

  it("Tribute to Greater Power gives only the next attack overpower", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["tribute to greater power|1", "raging onslaught|1"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|2", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.activate("tribute to greater power|1").play("raging onslaught|1");
    expect(() => g.blockWith("raging onslaught|2", "raging onslaught|3"))
      .toThrow(/no legal defend intent/);
    g.blockWith("raging onslaught|2").settle().expectLife(1, 16);
  });

  it("Crushing Headache removes only revealed non-attack actions", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["crushing headache|1"],
        resources: 6,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        hand: ["nimblism|1", "raging onslaught|1"],
        arsenalFaceDown: ["nimblism|2"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("crushing headache|1").blockWith().settle().expectLife(1, 10);

    g.expectInZone(1, "nimblism|1", "graveyard")
      .expectInZone(1, "nimblism|2", "graveyard")
      .expectInZone(1, "raging onslaught|1", "hand");
    expect(g.state.players[1]!.arsenal).toHaveLength(0);
  });

  it("Bone Barrier destroys an ally to gain 2 defense", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["raging onslaught|1"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        hand: ["bone barrier|3"],
        board: ["restless cleric|1"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("raging onslaught|1")
      .blockWith()
      .passPriority()
      .react("bone barrier|3")
      .chooseCard("restless cleric|1")
      .settle()
      .expectLife(1, 17);

    expect(g.state.players[1]!.board).toHaveLength(0);
  });

  it("Head Banging Chorus ignores earlier non-Guardian attacks", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["raging onslaught|1", "crushing headache|1"],
        deck: ["nimblism|1"],
        board: ["head banging chorus|2", "timesnap potion|3"],
        resources: 9,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 40, equipment: NO_EQUIPMENT },
    ] });

    g.activate("timesnap potion|3")
      .play("raging onslaught|1")
      .blockWith()
      .settle()
      .play("crushing headache|1")
      .blockWith()
      .settle()
      .expectHandSize(0, 1);
  });

  it("Head Banging Chorus does not grant its hit trigger to a second Guardian attack", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["crushing headache|1", "crushing headache|1"],
        deck: ["nimblism|1"],
        board: ["head banging chorus|2", "timesnap potion|3"],
        resources: 12,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 40, equipment: NO_EQUIPMENT },
    ] });

    g.activate("timesnap potion|3")
      .play("crushing headache|1")
      .blockWith()
      .settle()
      .play("crushing headache|1")
      .blockWith()
      .settle()
      .expectHandSize(0, 0);
  });

  it("Ice Aged Oak's Ice Bond grants dominate and fills exposed equipment zones", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["ice aged oak|3", "ice quake|3"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("ice aged oak|3", { pitch: ["ice quake|3"] });
    expect(g.state.chain.at(-1)?.flags.dominate).toBe(true);
    g.blockWith().settle().expectLife(1, 16);

    expect(g.state.players[0]!.board.filter((card) => card.cardId === "AJV028"))
      .toHaveLength(1);
    expect(g.state.players[1]!.board.filter((card) => card.cardId === "AJV029"))
      .toHaveLength(4);
  });

  it("Ancient Earth Oak's Earth Bond adds power and bottoms the attack on hit", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["ancient earth oak|1", "earthlore surge|3"],
        deck: ["nimblism|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("ancient earth oak|1", { pitch: ["earthlore surge|3"] })
      .blockWith()
      .settle()
      .expectLife(1, 12)
      .doRaw({ kind: "close-chain" })
      .expectDeckBottom(0, "ancient earth oak|1");

    expect(g.state.players[1]!.board.filter((card) => card.cardId === "AJV029"))
      .toHaveLength(1);
  });

  it("Apex Burster discards itself to destroy a defender of a 6-base-power attack", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["raging onslaught|1", "apex burster|3"],
        resources: 5,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        hand: ["raging onslaught|2", "raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("raging onslaught|1")
      .blockWith("raging onslaught|2", "raging onslaught|3")
      .activate("apex burster|3")
      .chooseCard("raging onslaught|2")
      .expectLife(1, 16)
      .expectInZone(0, "apex burster|3", "graveyard")
      .expectInZone(1, "raging onslaught|2", "graveyard");
  });

  it("Apex Burster does not count power above an attack's base power", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["nimblism|1", "snatch|1", "apex burster|3"],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|3"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("nimblism|1").play("snatch|1").blockWith("raging onslaught|3");
    expect(() => g.activate("apex burster|3"))
      .toThrow(/no legal intent to activate/);
  });

  it("Danse Macabre gives an entering ally's first attack go again, then destroys it", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        heroKey: "malice, domina of the dead|0",
        graveyard: ["restless cleric|1"],
        weapons: ["vox necropolis|0"],
        resources: 5,
        equipment: { ...NO_EQUIPMENT, legs: "danse macabre|0" },
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.activate("malice, domina of the dead|0")
      .chooseCard("restless cleric|1")
      .play("restless cleric|1", { fromZone: "graveyard" });
    const payment = g.state.pendingDecision?.options?.find((option) => option !== "no");
    expect(payment).toBeDefined();
    g.doRaw({ kind: "choose", optionId: payment! })
      .settle()
      .blockWith()
      .settle()
      .expectLife(1, 17)
      .expectAP(0, 1);
    expect(g.state.players[0]!.equipment.legs?.tapped).toBe(true);

    g.endTurn();
    expect(g.state.players[0]!.board).toHaveLength(0);
    expect(g.state.players[0]!.banish).toContainEqual(expect.objectContaining({
      cardId: "IAR084",
      faceDown: true,
    }));
  });

  it("Forsaken Strike destroys and discards zombies for independently chosen modes", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [
          "forsaken strike|2",
          "restless corporal|1",
          "restless magister|1",
        ],
        board: ["restless cleric|1", "restless quartermaster|1"],
        resources: 0,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });
    const strikeId = g.state.players[0]!.hand.find(
      (card) => cardData[card.cardId]?.name === "Forsaken Strike",
    )!.instanceId;
    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: strikeId,
      deferPlayPresentation: true,
    }));

    g.play("forsaken strike|2", {
      settle: false,
      alternativeCost: [
        "restless cleric|1",
        "restless corporal|1",
        "restless magister|1",
      ],
    });
    expect(g.state.pendingDecision).toMatchObject({
      prompt: "Forsaken Strike: choose effect 1 of 3",
      options: [
        "Create a Gate to i'Arathael",
        "Give Forsaken Strike +2 power",
        "Give Forsaken Strike go again",
      ],
    });
    expect(g.state.stack).toHaveLength(0);
    expect(projectStateFor(g.state, 0).pendingDecision?.preStackSource?.card.instanceId).toBe(strikeId);

    g.chooseOption("Create a Gate to i'Arathael");
    expect(g.state.pendingDecision?.prompt).toBe("Forsaken Strike: choose effect 2 of 3");
    expect(g.state.stack).toHaveLength(0);
    expect(projectStateFor(g.state, 0).pendingDecision?.preStackSource?.card.instanceId).toBe(strikeId);

    g.chooseOption("Give Forsaken Strike +2 power");
    expect(g.state.pendingDecision?.prompt).toBe("Forsaken Strike: choose effect 3 of 3");
    expect(g.state.stack).toHaveLength(0);
    expect(projectStateFor(g.state, 0).pendingDecision?.preStackSource?.card.instanceId).toBe(strikeId);

    g.chooseOption("Give Forsaken Strike go again");
    expect(projectStateFor(g.state, 0).pendingDecision?.preStackSource).toBeUndefined();
    g.blockWith()
      .settle()
      .expectLife(1, 15)
      .expectAP(0, 1)
      .expectInZone(0, "restless cleric|1", "graveyard")
      .expectInZone(0, "restless corporal|1", "graveyard")
      .expectInZone(0, "restless magister|1", "graveyard");

    expect(g.state.players[0]!.board.filter((card) => card.cardId === "IAR222"))
      .toHaveLength(1);
  });

  it("Restless Outlaw creates a Corrupted Corpse when it dies", () => {
    const g = scenario({ active: 1, seats: [
      {
        hero: "rhinar",
        board: ["restless outlaw|1"],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        resources: 3,
        weapons: ["titan's fist|0"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.attackWithWeapon("titan's fist|0", { targetAlly: "restless outlaw|1" });

    g.expectInZone(0, "restless outlaw|1", "graveyard")
      .expectInZone(0, "corrupted corpse|0", "banish");
  });

  it("Restless Corporal moves a face-up banished card to the graveyard", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        board: ["restless corporal|1"],
        banish: ["raging onslaught|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("restless corporal|1", { ability: 0 })
      .chooseCard("raging onslaught|1")
      .expectInZone(0, "raging onslaught|1", "graveyard")
      .expectAP(0, 1);

    expect(g.state.players[0]!.board[0]?.tapped).toBe(true);
  });

  it("Plundersong Gloomblade banishes a card chosen by the arsenal's owner", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        banish: ["plundersong gloomblade|1"],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        arsenalFaceDown: ["wounding blow|1"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("plundersong gloomblade|1", { fromZone: "banish" })
      .blockWith()
      .settle();

    expect(g.state.pendingDecision?.player).toBe(1);
    g.chooseCard("wounding blow|1")
      .expectLife(1, 18)
      .expectInZone(1, "wounding blow|1", "banish");
  });

  it("Countdown to Extinction creates a Gate and may search for Darkest Hour", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["countdown to extinction|1"],
        deck: ["darkest hour|1", "wounding blow|1"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("countdown to extinction|1")
      .blockWith()
      .settle()
      .chooseCard("darkest hour|1")
      .expectLife(1, 14)
      .expectInZone(0, "darkest hour|1", "banish")
      .expectInZone(0, "gate to i'arathael|0", "board");
  });

  it("Dimenxxional Ferryman bottoms itself and a chosen blood-debt action", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["dimenxxional ferryman|3"],
        banish: ["rift bind|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("dimenxxional ferryman|3")
      .chooseCard("rift bind|1")
      .chooseCard("dimenxxional ferryman|3")
      .expectInZone(0, "dimenxxional ferryman|3", "deck")
      .expectInZone(0, "rift bind|1", "deck")
      .expectZoneSize(0, "banish", 0)
      .expectAP(0, 1);
  });

  it("Planar Chaos lets the next Gate target an opponent's banished action", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["planar chaos|1"],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        life: 20,
        banish: ["rift bind|1"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("planar chaos|1")
      .activate("gate to i'arathael|0")
      .chooseCard("rift bind|1");

    expect(g.state.players[1]!.banish[0]).toMatchObject({
      playableFrom: ["banish"],
      playableBySeat: 0,
    });

    g.play("rift bind|1", { fromZone: "banish" })
      .blockWith()
      .settle()
      .expectLife(1, 16);
  });

  it.each([
    ["red", "darkest hour|1", 6, 14],
    ["blue", "darkest hour|3", 4, 16],
  ])("Darkest Hour (%s) uses its alternative cost and buffs the next Shadow attack", (
    _color,
    darkestHour,
    expectedAttack,
    expectedLife,
  ) => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: [darkestHour, "wounding blow|1", "plundersong gloomblade|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play(darkestHour, { alternativeCost: "wounding blow|1" })
      .expectDeckTop(0, "wounding blow|1")
      .play("plundersong gloomblade|1")
      .expectAttackValue(expectedAttack)
      .blockWith()
      .settle()
      .expectLife(1, expectedLife)
      .expectAP(0, 0);
  });

  it.each([
    ["Corrupted Corpse", "corrupted corpse|0"],
    ["another Malice zombie", "restless commander|1"],
  ])("Darkest Hour buffs %s attacks", (_label, zombie) => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["darkest hour|1", "wounding blow|1"],
        board: [zombie],
        resources: 1,
        weapons: ["vox necropolis|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("darkest hour|1", { alternativeCost: "wounding blow|1" })
      .activate(zombie)
      .expectAttackValue(7);
  });

  it("Stoke Vengeance buffs one following attack without retriggering when that attack hits", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        weapons: ["edge of autumn|0"],
        hand: ["stoke vengeance|1", "crouching tiger|0", "wounding blow|1"],
        resources: 4,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 30, equipment: NO_EQUIPMENT },
    ] });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("stoke vengeance|1")
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .play("crouching tiger|0")
      .expectAttackValue(2)
      .blockWith()
      .settle()
      .play("wounding blow|1")
      .expectAttackValue(4);
  });

  it("Echoing Trap ambushes a repeated attack and makes its hero discard", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["crouching tiger|0", "crouching tiger|0", "raging onslaught|1"],
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        arsenalFaceDown: ["echoing trap|3"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("crouching tiger|0")
      .blockWith()
      .settle()
      .play("crouching tiger|0")
      .blockWith("echoing trap|3")
      .settle();

    expect(g.state.pendingDecision?.player).toBe(0);
    g.chooseCard("raging onslaught|1")
      .expectInZone(0, "raging onslaught|1", "graveyard");
  });

  it("Deadly Spinneret equips a Graphene Chelicera in each empty weapon zone", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["deadly spinneret|1"],
        weapons: [],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("deadly spinneret|1")
      .expectInZone(0, "deadly spinneret|1", "graveyard");

    expect(g.state.players[0]!.weapons).toHaveLength(2);
    expect(g.state.players[0]!.weapons.every((card) =>
      cardData[card.cardId]?.name === "Graphene Chelicera"
    )).toBe(true);
  });

  it("Deadly Spinneret does not equip over a two-handed weapon", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["deadly spinneret|1"],
        weapons: ["vox necropolis|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.activate("deadly spinneret|1");

    expect(g.state.players[0]!.weapons).toHaveLength(1);
    expect(cardData[g.state.players[0]!.weapons[0]!.cardId]?.name).toBe("Vox Necropolis");
  });

  it("Rush of Knowledge may cash in a Ponder to draw and gain an action point", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["rush of knowledge|3"],
        deck: ["wounding blow|1"],
        board: ["ponder|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("rush of knowledge|3")
      .chooseCard("ponder|0")
      .blockWith()
      .settle()
      .expectInZone(0, "wounding blow|1", "hand")
      .expectNotInZone(0, "ponder|0", "board")
      .expectAP(0, 1)
      .expectLife(1, 16);
  });

  it("Sigil of the Muse replaces action-phase draws with Ponder tokens", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["rush of knowledge|3"],
        deck: ["wounding blow|1"],
        board: ["sigil of the muse|1", "ponder|0"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", equipment: NO_EQUIPMENT },
    ] });

    g.play("rush of knowledge|3")
      .chooseCard("ponder|0")
      .blockWith()
      .settle()
      .expectDeckTop(0, "wounding blow|1")
      .expectNotInZone(0, "wounding blow|1", "hand");

    expect(g.state.players[0]!.board.filter((card) =>
      cardData[card.cardId]?.name === "Ponder"
    )).toHaveLength(1);
  });

  it("Sigil of the Muse destroys itself for a Ponder at the beginning of its action phase", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          board: ["sigil of the muse|1"],
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", equipment: NO_EQUIPMENT },
      ],
    });

    g.endTurn()
      .expectInZone(0, "sigil of the muse|1", "graveyard")
      .expectInZone(0, "ponder|0", "board");
  });

  it("Chains of Consecration prevents a Shadow ally's damage and banishes it face-down", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["chains of consecration|2"],
        board: ["restless outlaw|1"],
        weapons: ["vox necropolis|0"],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("chains of consecration|2")
      .activate("restless outlaw|1")
      .blockWith()
      .settle()
      .expectLife(1, 20)
      .expectInZone(0, "restless outlaw|1", "banish");

    expect(g.state.players[0]!.banish.find((card) =>
      cardData[card.cardId]?.name === "Restless Outlaw"
    )?.faceDown).toBe(true);
  });

  it("Chains of Consecration also prevents the chosen ally from damaging another ally", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["chains of consecration|2"],
        board: ["restless outlaw|1"],
        weapons: ["vox necropolis|0"],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        board: ["restless magister|1"],
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("chains of consecration|2", { targetPermanent: "restless outlaw|1" })
      .activate("restless outlaw|1", { targetAlly: "restless magister|1" })
      .expectInZone(1, "restless magister|1", "board");

    expect(g.state.players[1]!.board.find((card) =>
      cardData[card.cardId]?.name === "Restless Magister"
    )?.life).toBe(3);
  });
});

describe("August 29–31 IAR and GEM Pack 6 spoilers", () => {
  it("registers all eight spoiled printings as implemented", () => {
    const expected = {
      IAR250: "Astral Ambience",
      GEM193: "Consuming Appetite",
      GEM198: "Ominous Toll",
      IAR078: "Ominous Toll",
      IAR079: "Ominous Toll",
      IAR080: "Ominous Toll",
      IAR160: "Reach of the Abyss",
      GEM205: "Embrace Ursur",
    } as const;

    expect(Object.fromEntries(
      Object.keys(expected).map((id) => [id, cardData[id]?.name]),
    )).toEqual(expected);
    expect(Object.keys(expected).every((id) => isImplemented(cardData[id]!))).toBe(true);
  });

  it("Astral Ambience creates a Spectral Shield when it fragments", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["astral ambience|2"],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      {
        hero: "dorinthea",
        hand: ["raging onslaught|1"],
        life: 20,
        equipment: NO_EQUIPMENT,
      },
    ] });

    g.play("astral ambience|2").blockWith("raging onslaught|1").settle();

    expect(boardNames(g, 0)).toContain("Spectral Shield");
    g.expectLife(1, 19);
  });

  it("Astral Ambience can destroy a Spectral Shield to get go again", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["astral ambience|2"],
        board: ["spectral shield|0"],
        resources: 2,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("astral ambience|2")
      .blockWith()
      .activate("astral ambience|2")
      .chooseCard("spectral shield|0")
      .settle();

    expect(boardNames(g, 0)).not.toContain("Spectral Shield");
    g.expectLife(1, 14).expectAP(0, 1);
  });

  it("Consuming Appetite grants Blasmophet a repeatable go-again attack", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["consuming appetite|2"],
        board: ["blasmophet, the insatiable hunger|0"],
        resources: 3,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.activate("consuming appetite|2")
      .expectInZone(0, "consuming appetite|2", "banish")
      .activate("blasmophet, the insatiable hunger|0")
      .blockWith()
      .settle()
      .activate("blasmophet, the insatiable hunger|0")
      .blockWith()
      .settle()
      .expectLife(1, 8)
      .expectAP(0, 1)
      .expectResources(0, 0);
  });

  it("Ominous Toll discards a zombie to create a Gate and has go again", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["ominous toll|1", "restless cleric|1"],
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("ominous toll|1")
      .chooseCard("restless cleric|1")
      .blockWith()
      .settle()
      .expectInZone(0, "restless cleric|1", "graveyard")
      .expectLife(1, 17)
      .expectAP(0, 1);

    expect(boardNames(g, 0)).toContain("Gate to i'Arathael");
  });

  it("Reach of the Abyss banishes every defending card when the chain closes", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          hand: ["raging onslaught|3", "sink below|1"],
          equipment: { ...NO_EQUIPMENT, arms: "reach of the abyss|0" },
        },
        {
          hero: "dorinthea",
          hand: ["snatch|1"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("snatch|1")
      .blockWith("reach of the abyss|0", "raging onslaught|3")
      .passPriority()
      .react("sink below|1")
      .chooseOption("pass")
      .endTurn()
      .expectNoEquipment(0, "arms")
      .expectInZone(0, "reach of the abyss|0", "banish")
      .expectInZone(0, "raging onslaught|3", "banish")
      .expectInZone(0, "sink below|1", "banish");
  });

  it("Reach of the Abyss stays equipped when it did not defend", () => {
    const g = scenario({
      active: 1,
      seats: [
        {
          hero: "rhinar",
          hand: ["raging onslaught|3"],
          equipment: { ...NO_EQUIPMENT, arms: "reach of the abyss|0" },
        },
        {
          hero: "dorinthea",
          hand: ["snatch|1"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.play("snatch|1")
      .blockWith("raging onslaught|3")
      .settle()
      .endTurn()
      .expectEquipped(0, "arms", "reach of the abyss|0")
      .expectInZone(0, "raging onslaught|3", "graveyard")
      .expectNotInZone(0, "reach of the abyss|0", "banish");
  });

  it("Embrace Ursur rewards both types on a Shadow Runeblade card", () => {
    const g = scenario({ seats: [
      {
        hero: "rhinar",
        hand: ["embrace ursur|1", "vexing gloomblade|1"],
        resources: 1,
        equipment: NO_EQUIPMENT,
      },
      { hero: "dorinthea", life: 20, equipment: NO_EQUIPMENT },
    ] });

    g.play("embrace ursur|1")
      .chooseCard("vexing gloomblade|1")
      .blockWith()
      .settle()
      .expectInZone(0, "vexing gloomblade|1", "banish")
      .expectLife(1, 17)
      .expectAP(0, 1);

    expect(boardNames(g, 0)).toContain("Runechant");
  });
});
