import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { printingId, scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

describe("Armory Deck: Ira", () => {
  it("Channel Lake Frigid taxes Iris of the Blossom in addition to its discard cost", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", board: ["channel lake frigid|3"], equipment: NO_EQUIPMENT },
      {
        hero: "dorinthea",
        hand: ["nimblism|1", "blink|3"],
        equipment: { ...NO_EQUIPMENT, head: "iris of the blossom|0" },
      },
    ] });
    // Explicit mid-turn setup: Iris is functional only after its controller hit.
    g.state.players[1]!.flags.dealtDamageThisTurn = true;
    expect(g.state.players[1]!.flags.dealtDamageThisTurn).toBe(true);

    const irisId = g.state.players[1]!.equipment.head!.instanceId;
    const irisIntents = legalIntents(g.state, 1).filter(
      (intent): intent is Extract<GameIntent, { kind: "activate-ability" }> =>
        intent.kind === "activate-ability" && intent.sourceInstanceId === irisId,
    );
    expect(irisIntents.some((intent) => intent.pitchInstanceIds.length === 0)).toBe(false);

    const blinkId = g.state.players[1]!.hand.find(
      (card) => card.cardId === printingId("blink|3"),
    )!.instanceId;
    const irisIntent = irisIntents.find(
      (intent) => intent.pitchInstanceIds.length === 1 && intent.pitchInstanceIds[0] === blinkId,
    );
    expect(irisIntent).toBeDefined();
    g.doRaw(irisIntent!);
    expect(g.state.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "engine-activation-discard",
    });
    g.chooseCard("nimblism|1");

    expect(g.state.players[1]!.equipment.head?.tapped).toBe(true);
    expect(g.state.players[1]!.pitch.some(
      (card) => card.cardId === printingId("blink|3"),
    )).toBe(true);
    expect(g.state.players[1]!.graveyard.some(
      (card) => card.cardId === printingId("nimblism|1"),
    )).toBe(true);
  });
});

describe("ASR — Okana Scar Wraps", () => {
  it("banishes a Become the Bottle that gained Edge of Autumn's name", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "ira, scarlet revenger|0",
          weapons: ["edge of autumn|0"],
          hand: ["become the bottle|1"],
          resources: 1,
          equipment: { ...NO_EQUIPMENT, arms: "okana scar wraps|0" },
        },
        { hero: "dorinthea", hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("become the bottle|1")
      .chooseCard("edge of autumn|0")
      .blockWith()
      .activate("okana scar wraps|0")
      .chooseCard("become the bottle|1");

    expect(g.state.players[0]!.equipment.arms?.tapped).toBe(true);
    g.expectInZone(0, "become the bottle|1", "banish");
  });

  it("equips a banished Edge of Autumn when a Vengeance attack hits", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "ira, scarlet revenger|0",
          weapons: ["edge of autumn|0"],
          hand: ["seek vengeance|1"],
          resources: 2,
          equipment: { ...NO_EQUIPMENT, arms: "okana scar wraps|0" },
        },
        { hero: "dorinthea", hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("seek vengeance|1")
      .blockWith()
      .activate("okana scar wraps|0")
      .chooseCard("edge of autumn|0");

    expect(g.state.pendingDecision?.chooseHook).toBe("okana-equip");
    g.chooseCard("edge of autumn|0")
      .expectInZone(0, "edge of autumn|0", "weapons")
      .doRaw({ kind: "close-chain" });

    const reequippedEdge = g.state.players[0]!.weapons[0]!;
    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: reequippedEdge.instanceId,
    }));
  });

  it("puts Okana and Enact Vengeance hit triggers on the stack in the chosen order", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "ira, scarlet revenger|0",
          weapons: ["edge of autumn|0"],
          hand: ["enact vengeance|1"],
          resources: 3,
          equipment: { ...NO_EQUIPMENT, arms: "okana scar wraps|0" },
        },
        {
          hero: "dorinthea",
          hand: [],
          arsenal: ["nimblism|1"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("enact vengeance|1")
      .blockWith()
      .activate("okana scar wraps|0", { settle: false });

    const edge = g.state.players[0]!.weapons[0]!;
    expect(g.state.pendingDecision?.options).toContain(String(edge.instanceId));
    g.doRaw({ kind: "choose", optionId: String(edge.instanceId) })
      .passPriority()
      .passPriority() // resolve Okana's activated attack reaction
      .passPriority()
      .passPriority(); // end reactions; Enact hits

    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-order");
    const layers = g.state.pendingDecision?.triggerOrder?.remaining ?? [];
    const okanaLayer = layers.find((layer) =>
      layer.engineEffect?.kind === "on-hit-hook" &&
      layer.engineEffect.source.cardId === printingId("okana scar wraps|0")
    );
    const enactLayer = layers.find((layer) =>
      layer.engineEffect?.kind === "on-hit-hook" &&
      layer.engineEffect.source.cardId === printingId("enact vengeance|1")
    );
    expect(okanaLayer).toBeDefined();
    expect(enactLayer).toBeDefined();
    g.doRaw({
      kind: "order-triggers",
      optionIds: [
        `${okanaLayer!.sourceInstanceId}:${okanaLayer!.triggerIndex}`,
        `${enactLayer!.sourceInstanceId}:${enactLayer!.triggerIndex}`,
      ],
    });

    expect(g.state.stack).toHaveLength(2);
    expect(g.state.stack[0]?.sourceInstanceId).toBe(okanaLayer!.sourceInstanceId);
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    g.expectInZone(0, "edge of autumn|0", "banish")
      .expectInZone(1, "nimblism|1", "arsenal")
      .passPriority()
      .passPriority();

    expect(g.state.pendingDecision?.chooseHook).toBe("okana-equip");
    g.chooseCard("edge of autumn|0")
      .expectInZone(0, "edge of autumn|0", "weapons")
      .expectInZone(1, "nimblism|1", "graveyard");
  });
});

describe("ASR — Give and Take", () => {
  it("triggers for action-card defenders but not equipment", () => {
    const actionDefense = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          hand: ["give and take|1"],
          graveyard: ["head jab|1"],
        },
        { hero: "dorinthea", hand: ["wounding blow|1"] },
      ],
    });

    actionDefense.play("give and take|1")
      .blockWith("wounding blow|1")
      .settle();

    expect(actionDefense.state.pendingDecision?.chooseHook).toBe("give-take-top");
    expect(actionDefense.state.log.some((entry) =>
      entry.publicText?.includes("Give and Take triggers: Whenever an action card defends this")
    )).toBe(true);

    const equipmentDefense = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 1,
          hand: ["give and take|1"],
          graveyard: ["head jab|1"],
        },
        {
          hero: "dorinthea",
          equipment: { head: "ironrot helm|0" },
        },
      ],
    });

    equipmentDefense.play("give and take|1")
      .blockWith("ironrot helm|0");

    expect(equipmentDefense.state.stack.some((layer) =>
      layer.label === "Whenever an action card defends this"
    )).toBe(false);
    expect(equipmentDefense.state.log.some((entry) =>
      entry.publicText?.includes("Give and Take triggers")
    )).toBe(false);
  });
});

describe("ASR — Legacy of Ikaru", () => {
  it("grants its on-hit ability only to the attack it reacted to", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "ira, scarlet revenger|0",
          weapons: ["edge of autumn|0"],
          hand: ["legacy of ikaru|3", "vengeance never rests|3"],
          deck: ["nimblism|1"],
          resources: 2,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .react("legacy of ikaru|3")
      .settle()
      .play("vengeance never rests|3")
      .blockWith()
      .settle()
      .expectZoneSize(0, "deck", 1)
      .expectZoneSize(0, "hand", 0);
  });

  it("draws when the reacted-to attack hits an ally", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "ira, scarlet revenger|0",
          weapons: ["edge of autumn|0"],
          hand: ["vengeance never rests|3", "legacy of ikaru|3"],
          deck: ["nimblism|1"],
          resources: 2,
          equipment: NO_EQUIPMENT,
        },
        {
          hero: "dorinthea",
          hand: [],
          board: ["barnacle|2"],
          equipment: NO_EQUIPMENT,
        },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("vengeance never rests|3", { targetAlly: "barnacle|2", settle: false });
    for (let guard = 0; g.state.phase !== "reaction" && guard < 10; guard++) {
      g.doRaw({ kind: "pass" });
    }
    expect(g.state.phase).toBe("reaction");

    g.react("legacy of ikaru|3")
      .settle()
      .expectInZone(0, "nimblism|1", "hand")
      .expectInZone(1, "barnacle|2", "graveyard");
  });
});

describe("ASR — Vengeance Never Rests", () => {
  it("banishes itself when its combo hit trigger resolves, before the chain closes", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "ira, scarlet revenger|0",
          weapons: ["edge of autumn|0"],
          hand: ["vengeance never rests|3"],
          resources: 3,
          equipment: NO_EQUIPMENT,
        },
        { hero: "dorinthea", hand: [], equipment: NO_EQUIPMENT },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("vengeance never rests|3")
      .blockWith()
      .settle();

    const vengeanceId = g.state.players[0]!.banish.find(
      (card) => card.cardId === printingId("vengeance never rests|3"),
    )?.instanceId;
    expect(vengeanceId).toBeDefined();
    expect(g.state.chain).toHaveLength(2);
    expect(g.state.chain[1]).toMatchObject({
      resolved: true,
      flags: { attackGone: true },
    });
    expect(g.state.players[0]!.graveyard.some(
      (card) => card.instanceId === vengeanceId,
    )).toBe(false);
    expect(legalIntents(g.state, 0)).toContainEqual(expect.objectContaining({
      kind: "play-from-zone",
      zone: "banish",
      instanceId: vengeanceId,
    }));
  });
});
