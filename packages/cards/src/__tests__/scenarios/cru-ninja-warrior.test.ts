import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";

const ninja = {
  hero: "rhinar" as const,
  heroKey: "ira, crimson haze|0",
  weapons: [] as string[],
};

const warrior = {
  hero: "dorinthea" as const,
  heroKey: "dorinthea ironsong|0",
  weapons: [] as string[],
};

function expectHandDefenseLimit(g: Scenario, defender: number, max: number): void {
  const hand = new Set(g.state.players[defender]!.hand.map((card) => card.instanceId));
  const defends = legalIntents(g.state, defender).filter((intent) => intent.kind === "defend");
  expect(defends.length).toBeGreaterThan(0);
  expect(
    defends.every(
      (intent) =>
        intent.kind !== "defend" ||
        intent.instanceIds.filter((id) => hand.has(id)).length <= max,
    ),
  ).toBe(true);
}

describe("CRU — Ninja heroes and weapons", () => {
  it("Katsu discards a cost-0 card, searches a combo card, and permits it from banish", () => {
    const g = scenario({
      seats: [
        {
          ...ninja,
          heroKey: "katsu, the wanderer|0",
          hand: ["soulbead strike|1", "crane dance|3"],
          deck: ["rushing river|1", "raging onslaught|1"],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.play("soulbead strike|1").blockWith().settle().chooseCard("crane dance|3").chooseCard("rushing river|1");
    g.expectInZone(0, "rushing river|1", "banish");
    expect(
      legalIntents(g.state, 0).some(
        (intent) =>
          intent.kind === "play-from-zone" &&
          intent.zone === "banish" &&
          g.state.players[0]!.banish.some(
            (card) =>
              card.instanceId === intent.instanceId && card.cardId === printingId("rushing river|1"),
          ),
      ),
    ).toBe(true);
  });

  it("Ira gives the second attack +1 and Crane Dance gets its combo bonuses", () => {
    const g = scenario({
      seats: [
        { ...ninja, hand: ["soulbead strike|1", "crane dance|1"] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.play("soulbead strike|1")
      .blockWith()
      .settle()
      .play("crane dance|1")
      .expectAttackValue(5)
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("Benji's first attack-action hit buffs the next attack", () => {
    const g = scenario({
      seats: [
        {
          ...ninja,
          heroKey: "benji, the piercing wind|0",
          hand: ["soulbead strike|3", "bittering thorns|2", "raging onslaught|3"],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.play("soulbead strike|3")
      .blockWith()
      .settle()
      .play("bittering thorns|2", { pitch: ["raging onslaught|3"] })
      .expectAttackValue(4);
  });

  it("Benji prevents cards from hand defending a 2-power attack action", () => {
    const g = scenario({
      seats: [
        { ...ninja, heroKey: "benji, the piercing wind|0", hand: ["soulbead strike|3"] },
        { hero: "dorinthea", weapons: [], hand: ["raging onslaught|1"] },
      ],
    });

    g.play("soulbead strike|3");
    expectHandDefenseLimit(g, 1, 0);
  });

  it("Benji allows hand defenders after an attack action is increased above 2 power", () => {
    const g = scenario({
      seats: [
        {
          ...ninja,
          heroKey: "benji, the piercing wind|0",
          hand: ["nimblism|1", "soulbead strike|2"],
        },
        { hero: "dorinthea", weapons: [], hand: ["raging onslaught|1"] },
      ],
    });

    g.play("nimblism|1").play("soulbead strike|2");
    expectHandDefenseLimit(g, 1, 1);
  });

  it("Benji also prevents defense reactions from hand", () => {
    const g = scenario({
      seats: [
        { ...ninja, heroKey: "benji, the piercing wind|0", hand: ["soulbead strike|3"] },
        { hero: "dorinthea", weapons: [], hand: ["sink below|1"] },
      ],
    });

    g.play("soulbead strike|3").blockWith().passPriority();
    expect(() => g.react("sink below|1")).toThrow(/no legal intent/);
  });

  it("Harmonized Kodachi gets go again while a cost-0 card is pitched", () => {
    const g = scenario({
      seats: [
        {
          ...ninja,
          weapons: ["harmonized kodachi|0"],
          pitch: ["crane dance|3"],
          resources: 1,
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.attackWithWeapon("harmonized kodachi|0").blockWith().settle().expectAP(0, 1);
  });

  it("Zephyr Needle waits until the combat chain closes to break", () => {
    const g = scenario({
      seats: [
        { ...ninja, weapons: ["zephyr needle|0"], resources: 1 },
        { hero: "dorinthea", weapons: [], hand: ["raging onslaught|1"] },
      ],
    });

    g.attackWithWeapon("zephyr needle|0").blockWith("raging onslaught|1").settle();
    expect(g.state.players[0]!.weapons.some((card) => card.cardId === printingId("zephyr needle|0"))).toBe(true);
    g.doRaw({ kind: "close-chain" }).expectInZone(0, "zephyr needle|0", "graveyard");
  });
});

describe("CRU — Ninja attack actions and token", () => {
  it("Crane Dance combo rejects attack defenders above the chain-link count", () => {
    const g = scenario({
      seats: [
        { ...ninja, hand: ["soulbead strike|1", "crane dance|1"] },
        {
          hero: "dorinthea",
          weapons: [],
          hand: ["soulbead strike|3", "raging onslaught|1"],
        },
      ],
    });

    g.play("soulbead strike|1").blockWith().settle().play("crane dance|1");
    const allowed = g.state.players[1]!.hand.find(
      (card) => card.cardId === printingId("soulbead strike|3"),
    )!.instanceId;
    const rejected = g.state.players[1]!.hand.find(
      (card) => card.cardId === printingId("raging onslaught|1"),
    )!.instanceId;
    let staged = applyIntent(g.state, 1, { kind: "stage-defenders", instanceIds: [allowed] });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    g.state = staged.state;
    expect(legalIntents(g.state, 1)).toContainEqual({ kind: "defend", instanceIds: [allowed] });

    staged = applyIntent(g.state, 1, { kind: "stage-defenders", instanceIds: [rejected] });
    expect(staged.ok).toBe(false);
  });

  it("Rushing River combo draws for each hit and returns that many hand cards to deck top", () => {
    const g = scenario({
      seats: [
        {
          ...ninja,
          hand: ["torrent of tempo|1", "rushing river|1", "raging onslaught|3"],
          deck: ["raging onslaught|1", "raging onslaught|2"],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.play("torrent of tempo|1", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .play("rushing river|1")
      .blockWith()
      .settle()
      .chooseCard("raging onslaught|1")
      .chooseCard("raging onslaught|2")
      .expectDeckTop(0, "raging onslaught|2")
      .expectHandSize(0, 0);
  });

  it("Flying Kick gets +2 as chain link three", () => {
    const g = scenario({
      seats: [
        {
          ...ninja,
          hand: [
            "soulbead strike|1",
            "bittering thorns|2",
            "flying kick|1",
            "raging onslaught|3",
          ],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.play("soulbead strike|1")
      .blockWith()
      .settle()
      .play("bittering thorns|2", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .play("flying kick|1")
      .expectAttackValue(8);
  });

  it("Whirling Mist Blossom draws two after consecutive chain-link hits", () => {
    const g = scenario({
      seats: [
        {
          ...ninja,
          hand: ["soulbead strike|1", "whirling mist blossom|2", "raging onslaught|3"],
          deck: ["raging onslaught|1", "raging onslaught|2"],
        },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });

    g.play("soulbead strike|1")
      .blockWith()
      .settle()
      .play("whirling mist blossom|2", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .expectHandSize(0, 2);
  });

  it("Zen State removes its balance counter at maintenance", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...ninja, board: ["zen state|0"], hand: [] },
        { hero: "dorinthea", weapons: [], hand: [] },
      ],
    });
    g.state.players[0]!.board[0]!.counters = { balance: 1 };

    g.endTurn().chooseOption("remove");
    expect(g.state.players[0]!.board[0]!.counters?.balance).toBe(0);
  });

  it("Zen State prevents 1 damage from every damage event", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...ninja, board: ["zen state|0"], hand: [] },
        {
          hero: "dorinthea",
          weapons: [],
          hand: ["soulbead strike|1", "bittering thorns|2", "raging onslaught|3"],
        },
      ],
    });
    g.state.players[0]!.board[0]!.counters = { balance: 1 };

    g.play("soulbead strike|1")
      .blockWith()
      .settle()
      .play("bittering thorns|2", { pitch: ["raging onslaught|3"] })
      .blockWith()
      .settle()
      .expectLife(0, 15);
  });
});

describe("CRU — Warrior heroes, weapons, and actions", () => {
  it("Dorinthea re-enables a weapon after its first hit", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          weapons: ["cintari saber|0"],
          hand: ["hit and run|1"],
          resources: 2,
        },
        { hero: "rhinar", weapons: [], hand: [] },
      ],
    });

    g.play("hit and run|1")
      .attackWithWeapon("cintari saber|0")
      .blockWith()
      .settle();
    expect(
      legalIntents(g.state, 0).some(
        (intent) =>
          intent.kind === "activate-ability" &&
          g.state.players[0]!.weapons.some(
            (weapon) => weapon.instanceId === intent.sourceInstanceId,
          ),
      ),
    ).toBe(true);
  });

  it("Kassai discounts the second sword attack and creates Copper for weapon hits", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          heroKey: "kassai, cintari sellsword|0",
          weapons: ["cintari saber|0", "cintari saber|0"],
          hand: ["hit and run|1"],
          resources: 1,
        },
        { hero: "rhinar", weapons: [], hand: [] },
      ],
    });

    g.play("hit and run|1")
      .attackWithWeapon(undefined)
      .blockWith()
      .settle()
      .attackWithWeapon(undefined)
      .blockWith()
      .settle()
      .expectResources(0, 0)
      .endTurn();
    expect(g.state.players[0]!.board.filter((card) => card.cardId === "CRU197")).toHaveLength(2);
  });

  it("Cintari Saber gets +1 when defended by an attack action card", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          heroKey: "kassai|0",
          weapons: ["cintari saber|0"],
          resources: 1,
        },
        {
          hero: "rhinar",
          weapons: [],
          hand: ["raging onslaught|1", "sigil of solace|1"],
        },
      ],
    });

    g.attackWithWeapon("cintari saber|0");
    expect(projectStateFor(g.state, 0).chain.at(-1)?.onHitEffects).toBeUndefined();

    g.blockWith("raging onslaught|1")
      .expectAttackValue(2);
    expect(g.state.stack.at(-1)?.label).toBe(
      "When Cintari Saber is defended by an attack action card",
    );

    g.settle().expectFinalAttack(3);
  });

  it("Dauntless pumps the next weapon attack", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          weapons: ["cintari saber|0"],
          hand: ["dauntless|1", "raging onslaught|3"],
        },
        { hero: "rhinar", weapons: [], hand: [] },
      ],
    });

    g.play("dauntless|1", { pitch: ["raging onslaught|3"] })
      .attackWithWeapon("cintari saber|0")
      .expectAttackValue(5);
  });

  it("Dauntless taxes only the defender's next defense reaction", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          weapons: ["cintari saber|0"],
          hand: ["dauntless|1", "raging onslaught|3"],
        },
        {
          hero: "rhinar",
          weapons: [],
          hand: ["sink below|1", "sink below|2"],
          resources: 1,
        },
      ],
    });

    g.play("dauntless|1", { pitch: ["raging onslaught|3"] })
      .attackWithWeapon("cintari saber|0")
      .blockWith()
      .passPriority();
    g.react("sink below|1", { settle: false }).expectResources(1, 0);
    expect(
      legalIntents(g.state, 1).some(
        (intent) =>
          (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
          g.state.players[1]!.hand.some(
            (card) => card.instanceId === intent.instanceId && card.cardId === printingId("sink below|2"),
          ) &&
          intent.pitchInstanceIds.length === 0,
      ),
    ).toBe(true);
  });

  it("Out for Blood pumps the weapon and grants a reprise bonus to the next attack", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          weapons: ["cintari saber|0", "edge of autumn|0"],
          hand: ["hit and run|1", "out for blood|3", "raging onslaught|3"],
        },
        { hero: "rhinar", weapons: [], hand: ["raging onslaught|1"] },
      ],
    });

    g.play("hit and run|1")
      .attackWithWeapon("cintari saber|0", { pitch: ["raging onslaught|3"] })
      .blockWith("raging onslaught|1")
      .passPriority()
      .passPriority()
      .react("out for blood|3")
      .expectFinalAttack(4)
      .attackWithWeapon("edge of autumn|0")
      .expectAttackValue(2);
  });

  it("Hit and Run buffs the next attack after a weapon attack", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          weapons: ["edge of autumn|0"],
          hand: ["hit and run|1", "soulbead strike|1"],
          resources: 1,
        },
        { hero: "rhinar", weapons: [], hand: [] },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("hit and run|1")
      .play("soulbead strike|1")
      .expectAttackValue(7);
  });

  it("Push Forward grants dominate after an earlier weapon attack", () => {
    const g = scenario({
      seats: [
        {
          ...warrior,
          weapons: ["edge of autumn|0", "cintari saber|0"],
          hand: ["push forward|1", "raging onslaught|3"],
          resources: 1,
        },
        { hero: "rhinar", weapons: [], hand: ["raging onslaught|1", "raging onslaught|2"] },
      ],
    });

    g.attackWithWeapon("edge of autumn|0")
      .blockWith()
      .settle()
      .play("push forward|1", { pitch: ["raging onslaught|3"] })
      .attackWithWeapon("cintari saber|0");
    expectHandDefenseLimit(g, 1, 1);
  });
});
