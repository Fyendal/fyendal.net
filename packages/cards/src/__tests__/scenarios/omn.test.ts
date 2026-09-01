import { describe, expect, it } from "vitest";
import { createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData, decklists, isImplemented, scripts } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";
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

describe("OMN — wager targeting", () => {
  it("Pile Driver may wager with the defending hero when it attacks an ally", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", weapons: ["pile driver|0"], resources: 4, equipment: NO_EQUIPMENT },
      { hero: "dorinthea", board: ["barnacle|2"], equipment: NO_EQUIPMENT },
    ] });
    g.attackWithWeapon("pile driver|0", { targetAlly: "barnacle|2", settle: false }).settle();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      options: ["yes", "no"],
    });
  });
});

describe("OMN — import and set mechanics", () => {
  it("registers every eligible OMN printing as implemented", () => {
    const cards = Object.values(cardData).filter((card) => card.set === "OMN");
    expect(cards).toHaveLength(251);
    expect(cards.every((card) => isImplemented(card))).toBe(true);
    expect(new Set(cards.map(functionalKeyOf))).toHaveLength(251);
  });

  it("Fragment reduces an attack when a 3-defense card defends it", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["erode authority|1", "cosmic duality|3"] }),
        foe({ hand: ["arcanic cunning|1"] }),
      ],
    });

    g.play("erode authority|1", { pitch: ["cosmic duality|3"] })
      .blockWith("arcanic cunning|1")
      .passPriority()
      .passPriority()
      .expectAttackValue(5)
      .settle()
      .expectFinalDefense(3)
      .expectLife(1, 18);
  });

  it("Astral Strike declares its attack mode before defense or priority", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["astral strike|1", "cosmic duality|3"] }),
        foe(),
      ],
    });
    g.state.players[0]!.flags["destroyedName:lightning flow"] = true;

    g.play("astral strike|1", { pitch: ["cosmic duality|3"], settle: false });

    expect(g.state.pendingDecision).toMatchObject({
      chooseHook: "astral-mode",
      options: ["draw", "+2", "go again"],
    });
    expect(legalIntents(g.state, 0).some((intent) => intent.kind === "pass")).toBe(false);

    g.chooseOption("+2");
    expect(g.state.pendingDecision?.kind).toBe("defend");
    g.blockWith().expectAttackValue(7);
  });

  it("Boots of Omnis Ward stops defending when destroyed for its ability", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["snatch|1"] }),
        foe({ equipment: { legs: "boots of omnis ward|0" } }),
      ],
    });

    g.play("snatch|1")
      .blockWith("boots of omnis ward|0")
      .passPriority()
      .activate("boots of omnis ward|0", { settle: false });

    const link = g.state.chain.at(-1)!;
    expect(link.defendingEquipment).toHaveLength(0);
    expect(link.resolved).toBe(false);
    expect(g.state.players[1]!.equipment.legs).toBeUndefined();
    g.expectInZone(1, "boots of omnis ward|0", "graveyard")
      .settle()
      .expectFinalDefense(0)
      .expectLife(1, 17);
  });

  it("Plutonic Starplate gains its resource from a once-per-opponent-turn trigger", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("zyggy|0", {
          hand: ["holo shield|3", "holo shield|3"],
          equipment: { chest: "plutonic starplate|0" },
          resources: 2,
        }),
        foe({ hand: ["head jab|3", "head jab|3"] }),
      ],
    });
    const starplate = g.state.players[0]!.equipment.chest!;

    g.play("head jab|3")
      .blockWith()
      .passPriority()
      .react("holo shield|3", { settle: false });

    expect(g.state.players[0]!.resources).toBe(1);
    expect(g.state.stack).toHaveLength(2);
    expect(g.state.stack[0]).toMatchObject({
      sourceInstanceId: starplate.instanceId,
      label: "Gain {r}",
    });

    g.passPriority().passPriority();
    expect(g.state.players[0]!.resources).toBe(2);
    expect(g.state.stack).toHaveLength(1);
    g.passPriority().passPriority();

    g.passPriority()
      .react("holo shield|3", { settle: false });
    expect(g.state.stack).toHaveLength(1);
    expect(g.state.players[0]!.resources).toBe(1);
  });

  it("Beckon Steel queues its free sword attack behind the hit chain link", () => {
    const g = scenario({
      seats: [
        hero("hala|0", {
          resources: 1,
          weapons: ["durendal|0"],
          hand: ["beckon steel|3"],
        }),
        foe(),
      ],
    });
    const sword = g.state.players[0]!.weapons[0]!;
    sword.counters = { power: 2 };

    g.activate("durendal|0")
      .blockWith()
      .react("beckon steel|3")
      .blockWith();

    expect(g.state.chain).toHaveLength(2);
    // Sharpen changes the live sword before the resolved-link value snapshot;
    // combat damage for that link was already calculated at 5.
    expect(g.state.chain[0]).toMatchObject({ resolved: true, finalAttack: 6, damage: 5 });
    expect(g.state.chain[1]).toMatchObject({ resolved: false, attackingCard: { instanceId: sword.instanceId } });
    g.expectAP(0, 0)
      .expectResources(0, 0)
      .settle()
      .expectFinalAttack(6)
      .expectLife(1, 9);
  });

  it("Reverent Rerebrace replaces Beckon Steel before its counter threshold", () => {
    const g = scenario({
      seats: [
        hero("hala, bladesaint of the vow|0", {
          resources: 2,
          weapons: ["zenith blade|0"],
          hand: ["beckon steel|3"],
          equipment: { arms: "reverent rerebrace|0" },
        }),
        foe(),
      ],
    });
    const sword = g.state.players[0]!.weapons[0]!;
    sword.counters = { power: 1 };

    g.attackWithWeapon("zenith blade|0")
      .blockWith()
      .react("beckon steel|3")
      .settle();

    expect(g.state.pendingDecision?.prompt).toContain("Reverent Rerebrace");
    g.chooseOption("pay 1");
    expect(g.state.players[0]!.weapons[0]!.counters?.power).toBe(3);
    expect(g.state.chain).toHaveLength(2);
    expect(g.state.chain[1]).toMatchObject({
      resolved: false,
      attackingCard: { instanceId: sword.instanceId },
    });
  });

  it("Beckon Steel chooses a fresh target for its queued sword attack", () => {
    const g = scenario({
      seats: [
        hero("hala|0", {
          resources: 1,
          weapons: ["durendal|0"],
          hand: ["beckon steel|3"],
        }),
        foe({ board: ["barnacle|2"] }),
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2 };
    const barnacleId = g.state.players[1]!.board[0]!.instanceId;

    g.activate("durendal|0")
      .blockWith()
      .react("beckon steel|3");

    expect(g.state.pendingDecision).toMatchObject({
      kind: "choose-target",
      prompt: "Durendal: choose an attack target",
    });
    g.chooseCard("barnacle|2");
    expect(g.state.chain).toHaveLength(2);
    expect(g.state.chain[1]!.targetAllyId).toBe(barnacleId);
  });

  it("queues multiple Beckon Steel attacks in order", () => {
    const g = scenario({
      seats: [
        hero("hala|0", {
          resources: 1,
          weapons: ["durendal|0"],
          hand: ["beckon steel|3", "beckon steel|3"],
        }),
        foe(),
      ],
    });
    g.state.players[0]!.weapons[0]!.counters = { power: 2 };

    g.activate("durendal|0")
      .blockWith()
      .react("beckon steel|3", { settle: false })
      .react("beckon steel|3")
      .blockWith()
      .settle()
      .blockWith()
      .settle();

    expect(g.state.chain).toHaveLength(3);
    expect(g.state.chain.every((link) => link.resolved)).toBe(true);
    g.expectAP(0, 0).expectLife(1, 1);
  });

  it("projects Boots of Omnis Ward's prevention as a lingering effect", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { equipment: { legs: "boots of omnis ward|0" } }),
        foe(),
      ],
    });

    g.activate("boots of omnis ward|0");

    expect(projectStateFor(g.state, 0).ongoing).toContainEqual({
      seat: 0,
      cardId: printingId("boots of omnis ward|0"),
      label: "prevent next 1 damage · this turn",
    });
  });

  it("Starfall sees an instant put into the graveyard earlier this turn", () => {
    const g = scenario({
      seats: [
        hero("oscilio, scion of the third age|0", {
          hand: ["cosmic flare|1", "meteoric impact|1"],
        }),
        foe(),
      ],
    });

    g.play("cosmic flare|1")
      .play("meteoric impact|1")
      .chooseOption("opposing hero")
      .expectLife(1, 15);
  });

  it("Echoflash triggers when discarded by Oscilio, Forked Continuum", () => {
    const g = scenario({
      seats: [
        hero("oscilio, forked continuum|0", {
          board: ["lightning flow|0"],
          hand: ["echoflash|2"],
          resources: 1,
        }),
        foe(),
      ],
    });

    g.activate("oscilio, forked continuum|0", { settle: false });
    const flow = g.state.players[0]!.board[0]!;
    g.doRaw({ kind: "choose", optionId: String(flow.instanceId) });

    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(g.state.stack[0]?.ability).toBe(true);
    g.expectInZone(0, "echoflash|2", "hand")
      .passPriority()
      .passPriority();

    expect(g.state.pendingDecision).toMatchObject({ chooseHook: "oscilio-discard" });
    const echoflash = g.state.players[0]!.hand[0]!;
    g.doRaw({ kind: "choose", optionId: String(echoflash.instanceId) })
      .expectLife(1, 20)
      .expectInZone(0, "echoflash|2", "graveyard");
    expect(g.state.stack[0]?.label).toBe("Your hero deals 1 arcane damage");

    g.passPriority().passPriority().expectLife(1, 19);
  });

  it("Oscilio, Scion discards on resolution and triggers Echoflash", () => {
    const g = scenario({
      seats: [
        hero("oscilio, scion of the third age|0", {
          board: ["lightning flow|0"],
          hand: ["echoflash|2"],
          resources: 1,
        }),
        foe(),
      ],
    });

    g.activate("oscilio, scion of the third age|0", { settle: false });
    const flow = g.state.players[0]!.board[0]!;
    g.doRaw({ kind: "choose", optionId: String(flow.instanceId) });
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window" });
    g.expectInZone(0, "echoflash|2", "hand")
      .passPriority()
      .passPriority();

    expect(g.state.pendingDecision).toMatchObject({ chooseHook: "oscilio-scion-discard" });
    const echoflash = g.state.players[0]!.hand[0]!;
    g.doRaw({ kind: "choose", optionId: String(echoflash.instanceId) });
    expect(g.state.stack[0]?.label).toBe("Your hero deals 1 arcane damage");
    g.passPriority().passPriority().expectLife(1, 19);
  });

  it("Quickstrike turns on when Quick Succession grants go again", () => {
    const g = scenario({
      seats: [
        hero("aurora, emissary of lightning|0", {
          hand: ["quick succession|3", "dashing flashfoot|2", "cosmic duality|3"],
        }),
        foe(),
      ],
    });

    g.play("quick succession|3")
      .play("dashing flashfoot|2", { pitch: ["cosmic duality|3"] })
      .expectAttackValue(5)
      .expectLife(1, 19)
      .blockWith()
      .settle()
      .expectLife(1, 14);
  });

  it("Crackle from Afar lets its controller choose the attack that gets +1", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["snatch|1", "crackle from afar|3"] }),
        foe(),
      ],
    });

    g.play("snatch|1")
      .blockWith()
      .react("crackle from afar|3");

    const attack = g.state.chain.at(-1)!.attackingCard;
    expect(g.state.pendingDecision).toMatchObject({
      kind: "choose-target",
      options: ["no", String(attack.instanceId)],
      cardOptions: [null, attack.instanceId],
    });

    g.chooseCard("snatch|1")
      .expectFinalAttack(5)
      .expectLife(1, 15);
  });

  it("Crackle from Afar can give an opposing attack +1", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["snatch|1"] }),
        foe({ hand: ["crackle from afar|3"] }),
      ],
    });

    g.play("snatch|1")
      .blockWith()
      .passPriority()
      .react("crackle from afar|3")
      .chooseCard("snatch|1")
      .expectAttackValue(5);
  });

  it("Crackle from Afar can choose no attack", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["snatch|1", "crackle from afar|3"] }),
        foe(),
      ],
    });

    g.play("snatch|1")
      .blockWith()
      .react("crackle from afar|3")
      .chooseOption("no")
      .expectFinalAttack(4)
      .expectLife(1, 16);
  });

  it("Fleeing Starbreeze can give an opposing attack go again", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["snatch|1"] }),
        foe({ hand: ["fleeing starbreeze|3"] }),
      ],
    });

    g.play("snatch|1")
      .blockWith()
      .passPriority()
      .react("fleeing starbreeze|3")
      .chooseCard("snatch|1");

    expect(g.state.chain.at(-1)?.goAgain).toBe(true);
  });

  it("Fleeing Starbreeze can target an attack on the chain after no defense", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["spears of surreality|1", "nourishing glow|3", "AZS027"],
        }),
        foe(),
      ],
    });

    g.play("spears of surreality|1", { pitch: ["nourishing glow|3"] })
      .blockWith();

    const starbreeze = g.state.players[0]!.hand.find(
      (card) => card.cardId === "AZS027",
    );
    const attack = g.state.chain.at(-1)!.attackingCard;
    expect(starbreeze).toBeDefined();
    expect(legalIntents(g.state, 0)).toContainEqual({
      kind: "play-card",
      instanceId: starbreeze!.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 0,
    });

    g.react("AZS027");
    expect(g.state.pendingDecision).toMatchObject({
      kind: "choose-target",
      options: ["no", String(attack.instanceId)],
      cardOptions: [null, attack.instanceId],
    });
    g.chooseCard("spears of surreality|1");
    expect(g.state.chain.at(-1)?.goAgain).toBe(true);
  });

  it("optional target-attack auras can play without a target, but mandatory targets cannot", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: [
            "fleeing starbreeze|3",
            "crackle from afar|3",
            "auric shards|1",
            "ominous aggression|1",
          ],
          resources: 3,
        }),
        foe(),
      ],
    });

    g.expectNoLegalPlay("ominous aggression|1")
      .play("fleeing starbreeze|3")
      .expectInZone(0, "fleeing starbreeze|3", "board")
      .play("crackle from afar|3")
      .expectInZone(0, "crackle from afar|3", "board")
      .play("auric shards|1")
      .expectInZone(0, "auric shards|1", "board");
  });

  it("target-attack auras can modify resolved attacks without resolving them again", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["snatch|1", "snatch|1", "crackle from afar|3"],
        }),
        foe(),
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    g.play("snatch|1").blockWith().settle();
    const pastAttack = g.state.chain[0]!.attackingCard;
    expect(g.state.chain[0]?.finalAttack).toBe(4);
    g.expectLife(1, 16);

    g.play("snatch|1").blockWith().react("crackle from afar|3");
    const currentAttack = g.state.chain[1]!.attackingCard;
    expect(g.state.pendingDecision).toMatchObject({
      options: ["no", String(pastAttack.instanceId), String(currentAttack.instanceId)],
      cardOptions: [null, pastAttack.instanceId, currentAttack.instanceId],
    });

    g.chooseCard("snatch|1");
    expect(g.state.chain[0]?.finalAttack).toBe(5);
    expect(g.state.chain[1]?.finalAttack).toBe(4);
    g.expectLife(1, 12);
  });

  it("announced target-attack instants offer past combat-chain links", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["snatch|1", "snatch|1", "ominous aggression|1"],
          resources: 2,
        }),
        foe(),
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    g.play("snatch|1").blockWith().settle();
    const pastAttack = g.state.chain[0]!.attackingCard;
    g.play("snatch|1").blockWith();
    const aggression = g.state.players[0]!.hand.find(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "ominous aggression|1",
    );
    const intent = legalIntents(g.state, 0).find(
      (candidate) =>
        candidate.kind === "play-card" &&
        candidate.instanceId === aggression?.instanceId &&
        candidate.targetCardInstanceId === pastAttack.instanceId,
    );
    expect(intent).toBeDefined();

    g.doRaw(intent!).settle();
    expect(g.state.chain[0]?.finalAttack).toBe(6);
    expect(g.state.chain[1]?.finalAttack).toBe(4);
    g.expectLife(1, 12);
  });

  it("go again granted to a resolved target attack is not applied retroactively", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["snatch|1", "snatch|1", "fleeing starbreeze|3"],
        }),
        foe(),
      ],
    });
    g.state.players[0]!.actionPoints = 2;

    g.play("snatch|1").blockWith().settle();
    const pastAttack = g.state.chain[0]!.attackingCard;
    g.play("snatch|1").blockWith().react("fleeing starbreeze|3");
    const currentAttack = g.state.chain[1]!.attackingCard;
    expect(g.state.pendingDecision?.options).toEqual([
      "no",
      String(pastAttack.instanceId),
      String(currentAttack.instanceId),
    ]);

    g.chooseCard("snatch|1");
    expect(g.state.chain[0]?.goAgain).toBe(true);
    expect(g.state.chain[1]?.goAgain).toBe(false);
    g.expectAP(0, 0).expectLife(1, 12);
  });

  it("Fleeing Starbreeze grants go again too late during the Resolution Step", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["heaven's claws|1", "nourishing glow|3", "fleeing starbreeze|3"],
        }),
        foe(),
      ],
    });

    g.play("heaven's claws|1", { pitch: ["nourishing glow|3"] })
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 15);
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    expect(g.state.chain[0]?.flags.resolutionStepBegan).not.toBe(true);
    expect(projectStateFor(g.state, 0).stackContext).toBe("DAMAGE STEP · PRIORITY");
    expect(g.state.chain[0]?.goAgain).toBe(false);
    g.expectAP(0, 0);

    g.passPriority()
      .passPriority();
    expect(g.state.chain[0]?.resolved).toBe(true);
    expect(g.state.chain[0]?.flags.resolutionStepBegan).toBe(true);
    expect(projectStateFor(g.state, 0).stackContext).toBeUndefined();

    g.react("fleeing starbreeze|3")
      .chooseCard("heaven's claws|1")
      .expectAP(0, 0);
    expect(g.state.chain[0]?.goAgain).toBe(true);
  });

  it("Fleeing Starbreeze grants go again in time during the Damage Step", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["heaven's claws|1", "nourishing glow|3", "fleeing starbreeze|3"],
        }),
        foe(),
      ],
    });

    g.play("heaven's claws|1", { pitch: ["nourishing glow|3"] })
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 15);
    expect(projectStateFor(g.state, 0).stackContext).toBe("DAMAGE STEP · PRIORITY");

    g.react("fleeing starbreeze|3")
      .chooseCard("heaven's claws|1")
      .settle()
      .expectAP(0, 1);
    expect(g.state.chain[0]?.goAgain).toBe(true);
  });

  it("Fleeing Starbreeze cannot grant go again after its play returns Gone in a Flash", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["gone in a flash|1", "fleeing starbreeze|3"],
        }),
        foe(),
      ],
    });

    g.play("gone in a flash|1")
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 16)
      .react("fleeing starbreeze|3", { settle: false })
      .passPriority()
      .passPriority();
    expect(g.state.pendingDecision).toMatchObject({
      kind: "optional-effect",
      options: ["yes", "no"],
    });

    g.chooseOption("yes")
      .expectInZone(0, "gone in a flash|1", "hand")
      .settle()
      .expectInZone(0, "fleeing starbreeze|3", "board")
      .expectAP(0, 0);
    expect(g.state.chain[0]?.goAgain).toBe(false);
  });

  it("Zyggy blinks a Lightning aura back with a holo counter", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          resources: 2,
          board: ["lightning flow|0", "holo shield|1"],
        }),
        foe(),
      ],
    });

    g.activate("zyggy|0")
      .chooseCard("lightning flow|0")
      .chooseCard("holo shield|1")
      .expectNotInZone(0, "lightning flow|0", "board")
      .expectInZone(0, "holo shield|1", "board");
    const shield = g.state.players[0]!.board.find(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "holo shield|1",
    );
    expect(shield?.counters?.holo).toBe(1);
  });

  it("Corrosive Space Dust creates a leave-arena trigger when Zyggy blinks it", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          resources: 2,
          board: ["lightning flow|0", "corrosive space dust|1"],
        }),
        foe(),
      ],
    });

    g.activate("zyggy|0")
      .chooseCard("lightning flow|0");
    const spaceDust = g.state.players[0]!.board.find(
      (card) => functionalKeyOf(cardData[card.cardId]!) === "corrosive space dust|1",
    );
    expect(spaceDust).toBeDefined();
    g.doRaw({ kind: "choose", optionId: String(spaceDust!.instanceId) });

    expect(g.state.stack[0]).toMatchObject({
      label: "Deal 1 arcane damage to target hero",
      optional: false,
    });
    g.expectLife(1, 20)
      .passPriority()
      .passPriority()
      .chooseOption("opposing hero")
      .expectLife(1, 19)
      .expectInZone(0, "corrosive space dust|1", "board");
  });

  it("preserves Corrosive Space Dust's leave trigger when Zyggy responds to a layer", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", {
          hand: ["nourishing glow|3"],
          resources: 2,
          board: ["lightning flow|0", "corrosive space dust|1"],
        }),
        foe(),
      ],
    });

    g.play("nourishing glow|3", { settle: false })
      .activate("zyggy|0")
      .chooseCard("lightning flow|0")
      .chooseCard("corrosive space dust|1")
      .chooseOption("opposing hero")
      .expectLife(1, 19)
      .expectInZone(0, "corrosive space dust|1", "board");
  });

  it("Cosmic Duality can be discarded from hand for its instant ability", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["cosmic duality|1", "cosmic duality|3"] }),
        foe(),
      ],
    });

    g.activate("cosmic duality|1", { pitch: ["cosmic duality|3"] })
      .chooseOption("opposing hero")
      .expectLife(1, 19)
      .expectInZone(0, "cosmic duality|1", "graveyard")
      .expectInZone(0, "lightning flow|0", "board");
  });

  it("Haven Veil prevents the next arcane damage dealt that turn", () => {
    const g = scenario({
      seats: [
        hero("oscilio, scion of the third age|0", {
          hand: ["haven veil|1", "meteoric impact|1"],
          resources: 1,
        }),
        foe(),
      ],
    });

    g.play("haven veil|1")
      .play("meteoric impact|1")
      .chooseOption("your hero")
      .expectLife(0, 19);
  });

  it("Spellbane Sigil's Arcane Barrier X accepts a chosen payment", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("oscilio, scion of the third age|0", { board: ["spellbane sigil|3"], resources: 3 }),
        hero("oscilio, scion of the third age|0", { hand: ["flash bolt|1"], resources: 2 }),
      ],
    });

    g.play("flash bolt|1")
      .chooseOption("opposing hero")
      .chooseOption("pay 3")
      .expectLife(0, 19)
      .expectResources(0, 0)
      .expectInZone(0, "spellbane sigil|3", "board");
  });

  it("Chromatic Refinement discounts its color and adds 1 to its first damage", () => {
    const g = scenario({
      seats: [
        hero("oscilio, scion of the third age|0", {
          board: ["chromatic refinement|1"],
          hand: ["meteoric impact|1"],
        }),
        foe(),
      ],
    });

    g.endTurn()
      .endTurn()
      .expectInZone(0, "chromatic refinement|1", "graveyard")
      .play("meteoric impact|1");
    expect(g.state.pendingDecision?.prompt).toBe("Meteoric Impact: deal 6 arcane damage to a target");
    g
      .chooseOption("opposing hero")
      .expectLog("Meteoric Impact would deal 6 arcane damage to Dorinthea")
      .expectLife(1, 14);
  });

  it("Beckoning Brilliance discounts the next instant only on its chain link", () => {
    const g = scenario({
      seats: [
        hero("aurora, emissary of lightning|0", {
          hand: ["beckoning brilliance|1", "flash bolt|1"],
          resources: 1,
        }),
        foe(),
      ],
    });

    g.play("beckoning brilliance|1")
      .blockWith()
      .react("flash bolt|1")
      .chooseOption("opposing hero")
      .expectLife(1, 13);
  });

  it("Step Between prohibits opposing instants while it is attacking", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["step between|1"], resources: 1 }),
        foe({ hand: ["flash bolt|1"], resources: 2 }),
      ],
    });
    g.play("step between|1").blockWith().passPriority();
    expect(legalIntents(g.state, 1).some((intent) =>
      (intent.kind === "play-card" || intent.kind === "play-from-arsenal" || intent.kind === "play-from-zone") &&
      g.state.players[1]!.hand.some((card) => card.instanceId === intent.instanceId && card.cardId === printingId("flash bolt|1")),
    )).toBe(false);
  });

  it("Flowing Stormstrike can activate twice before either ability resolves", () => {
    const g = scenario({
      seats: [
        hero("zyggy|0", { hand: ["flowing stormstrike|1"], resources: 2 }),
        foe(),
      ],
    });

    g.play("flowing stormstrike|1")
      .blockWith()
      .activate("flowing stormstrike|1", { settle: false })
      .expectAttackValue(4)
      .activate("flowing stormstrike|1", { settle: false })
      .expectAttackValue(4);

    expect(g.state.stack.filter((layer) => layer.ability)).toHaveLength(2);
    expect(legalIntents(g.state, 0).some((intent) =>
      intent.kind === "activate-ability" &&
      g.state.chain.at(-1)?.attackingCard.instanceId === intent.sourceInstanceId,
    )).toBe(false);

    g.passPriority().passPriority().expectAttackValue(5);
    g.passPriority().passPriority().expectAttackValue(6);
  });

  it("Omens of Arcana starts both heroes with spellvoid Lightning Flow", () => {
    const initial = createGame({
      decklists: [decklists.rhinar, decklists.dorinthea],
      cards: cardData,
      scripts,
      globalCardIds: [printingId("omens of arcana|0")],
      seed: 1,
    });
    for (const player of initial.players) {
      expect(player.board.some((card) => functionalKeyOf(cardData[card.cardId]!) === "lightning flow|0")).toBe(true);
    }

    const g = scenario({
      active: 1,
      globals: ["omens of arcana|0"],
      seats: [
        hero("zyggy|0", { board: ["lightning flow|0"] }),
        hero("oscilio, scion of the third age|0", { hand: ["flash bolt|1"], resources: 2 }),
      ],
    });
    g.play("flash bolt|1")
      .chooseOption("opposing hero")
      .chooseOption("destroy")
      .expectLife(0, 18)
      .expectNotInZone(0, "lightning flow|0", "board");
  });

  it("Arcanic Cunning prevents arcane damage while defending", () => {
    const g = scenario({
      active: 1,
      seats: [
        hero("aurora, emissary of lightning|0", { hand: ["arcanic cunning|1"] }),
        hero("oscilio, scion of the third age|0", {
          hand: ["head jab|1", "flash bolt|1"],
          resources: 2,
        }),
      ],
    });

    g.play("head jab|1")
      .blockWith("arcanic cunning|1")
      .react("flash bolt|1")
      .chooseOption("opposing hero")
      .expectLife(0, 18);
  });

  it("Voltaris creates a Lightning Flow when pitched", () => {
    const g = scenario({
      seats: [
        hero("oscilio, scion of the third age|0", { hand: ["meteoric impact|1", "voltaris|3"] }),
        foe(),
      ],
    });
    const voltaris = g.state.players[0]!.hand.find((card) => functionalKeyOf(cardData[card.cardId]!) === "voltaris|3")!;

    g.play("meteoric impact|1", { pitch: ["voltaris|3"], settle: false })
      .expectNotInZone(0, "lightning flow|0", "board");
    expect(g.state.stack).toHaveLength(2);
    expect(g.state.stack[0]).toMatchObject({
      sourceInstanceId: voltaris.instanceId,
      label: "Create a Lightning Flow token",
    });
    expect(functionalKeyOf(cardData[g.state.stack[1]!.card!.cardId]!)).toBe("meteoric impact|1");

    g.passPriority().passPriority()
      .expectInZone(0, "lightning flow|0", "board")
      .passPriority().passPriority()
      .chooseOption("opposing hero")
      .settle();
  });
});
