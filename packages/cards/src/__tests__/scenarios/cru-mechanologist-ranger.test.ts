import { describe, expect, it } from "vitest";
import { applyIntent, createGame, legalIntents } from "@fyendal/engine";
import { cardData, decklists, scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";

const BLUE = "raging onslaught|3";
const DASH = "dash, inventor extraordinaire|0";
const DATA_DOLL = "data doll mkii|0";
const AZALEA = "azalea, ace in the hole|0";

function expectDominate(g: Scenario, defender: number): void {
  const hand = new Set(g.state.players[defender]!.hand.map((card) => card.instanceId));
  const defends = legalIntents(g.state, defender).filter((intent) => intent.kind === "defend");
  expect(defends.length).toBeGreaterThan(0);
  expect(
    defends.every(
      (intent) =>
        intent.kind !== "defend" ||
        intent.instanceIds.filter((instanceId) => hand.has(instanceId)).length <= 1,
    ),
  ).toBe(true);
}

function boardCard(g: Scenario, seat: number, key: string) {
  const id = printingId(key);
  const card = g.state.players[seat]!.board.find((candidate) => candidate.cardId === id);
  expect(card, `no ${key} on seat ${seat}'s board`).toBeTruthy();
  return card!;
}

describe("CRU — Mechanologist heroes and weapon", () => {
  it("Dash may start with an eligible Mechanologist item in the arena", () => {
    let state = createGame({
      decklists: [
        {
          heroId: printingId(DASH),
          weaponIds: [],
          equipment: {},
          deck: [printingId("aether sink|2"), ...Array(39).fill(printingId(BLUE))],
        },
        decklists.dorinthea,
      ],
      seed: 51,
      cards: cardData,
      scripts,
    });
    const item = state.players[0]!.deck.find(
      (card) => card.cardId === printingId("aether sink|2"),
    )!;
    const result = applyIntent(state, 0, { kind: "choose", optionId: String(item.instanceId) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    expect(state.players[0]!.board.some((card) => card.cardId === item.cardId)).toBe(true);
    expect(state.players[0]!.hand).toHaveLength(4);
  });

  it("Data Doll puts a qualifying item banished for Boost into the arena", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: DATA_DOLL,
          weapons: [],
          hand: ["zero to sixty|1"],
          deck: ["aether sink|2"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("zero to sixty|1", { boost: true })
      .expectInZone(0, "aether sink|2", "board")
      .blockWith()
      .settle();
    expect(boardCard(g, 0, "aether sink|2").counters?.steam).toBe(1);
  });

  it("Data Doll also moves qualifying items banished from deck by non-Boost effects", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["art of desire: body|1"] },
        {
          hero: "dorinthea",
          heroKey: DATA_DOLL,
          weapons: [],
          deck: ["aether sink|2"],
        },
      ],
    });

    g.play("art of desire: body|1")
      .blockWith()
      .settle()
      .expectInZone(1, "aether sink|2", "board");
  });

  it("Teklo Plasma Pistol loads, attacks, and spends its steam counter", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", weapons: ["teklo plasma pistol|0"], resources: 1 },
        { hero: "dorinthea" },
      ],
    });

    g.activate("teklo plasma pistol|0", { ability: 1 });
    expect(g.state.players[0]!.weapons[0]!.counters?.steam).toBe(1);
    g.activate("teklo plasma pistol|0", { ability: 0 })
      .expectAttackValue(2)
      .blockWith()
      .settle();
    expect(g.state.players[0]!.weapons[0]!.counters?.steam).toBe(0);
  });
});

describe("CRU — Mechanologist attacks and Workshop", () => {
  it("High Speed Impact gives the next boosted attack this chain dominate", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: DASH,
          weapons: [],
          hand: ["high speed impact|3", "zero to sixty|1", BLUE],
          deck: ["zipper hit|3", "zipper hit|3"],
        },
        { hero: "dorinthea", hand: ["raging onslaught|1", "raging onslaught|2"] },
      ],
    });

    g.play("high speed impact|3", { pitch: [BLUE], boost: true })
      .blockWith()
      .settle()
      .play("zero to sixty|1", { boost: true });
    expectDominate(g, 1);
  });

  it("Combustible Courier gives the next boosted attack this chain +3 power", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: DASH,
          weapons: [],
          hand: ["combustible courier|3", "zero to sixty|1", BLUE],
          deck: ["zipper hit|3", "zipper hit|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("combustible courier|3", { pitch: [BLUE], boost: true })
      .blockWith()
      .settle()
      .play("zero to sixty|1", { boost: true })
      .expectAttackValue(7);
  });

  it("Overblast gains power for earlier boosts on the open combat chain", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: DASH,
          weapons: [],
          hand: ["zero to sixty|1", "overblast|2", BLUE],
          deck: ["zipper hit|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("zero to sixty|1", { boost: true })
      .blockWith()
      .settle()
      .play("overblast|2", { pitch: [BLUE] })
      .expectAttackValue(5);
  });

  it("Teklovossen's Workshop opts for boosts this turn then puts a qualifying top item into arena", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: DASH,
          weapons: [],
          hand: ["zero to sixty|1", "zero to sixty|1", "teklovossen's workshop|2"],
          deck: ["zipper hit|3", "zipper hit|3", "zap|3", "aether sink|2"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("zero to sixty|1", { boost: true }).blockWith().settle();
    g.play("zero to sixty|1", { boost: true }).blockWith().settle();
    g.play("teklovossen's workshop|2")
      .chooseOption("bottom")
      .chooseOption("top")
      .expectInZone(0, "aether sink|2", "board");
  });
});

describe("CRU — Ranger hero, bow, and arrows", () => {
  it("Azalea cycles her arsenal and gives the loaded arrow dominate", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: AZALEA,
          weapons: ["red liner|0"],
          arsenal: [BLUE],
          deck: ["pathing helix|3"],
        },
        { hero: "dorinthea", hand: ["raging onslaught|1", "raging onslaught|2"] },
      ],
    });

    g.activate(AZALEA)
      .expectInZone(0, "pathing helix|3", "arsenal")
      .expectDeckBottom(0, BLUE)
      .play("pathing helix|3", { fromArsenal: true });
    expectDominate(g, 1);
  });

  it("Red Liner puts an arrow from hand face up into an empty arsenal", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["red liner|0"],
          hand: ["pathing helix|3"],
        },
        { hero: "dorinthea" },
      ],
    });

    g.activate("red liner|0")
      .chooseCard("pathing helix|3")
      .expectInZone(0, "pathing helix|3", "arsenal")
      .expectFaceDown(0, "pathing helix|3", false)
      .expectAP(0, 1);
  });

  it("Pathing Helix may reload a hand card face down after hitting", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["red liner|0"],
          arsenal: ["pathing helix|3"],
          hand: [BLUE],
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("pathing helix|3", { fromArsenal: true })
      .blockWith()
      .settle()
      .chooseCard(BLUE)
      .expectInZone(0, BLUE, "arsenal")
      .expectFaceDown(0, BLUE, true);
  });

  it("Sleep Dart suppresses the hit hero through the end of their next turn", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["red liner|0"],
          arsenal: ["sleep dart|1"],
          hand: [BLUE],
        },
        {
          hero: "dorinthea",
          heroKey: AZALEA,
          weapons: ["red liner|0"],
          arsenal: [BLUE],
          deck: ["pathing helix|3"],
        },
      ],
    });

    g.play("sleep dart|1", { fromArsenal: true, pitch: [BLUE] })
      .blockWith()
      .settle()
      .endTurn();
    const heroId = g.state.players[1]!.hero.instanceId;
    expect(
      legalIntents(g.state, 1).some(
        (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === heroId,
      ),
    ).toBe(false);
    g.endTurn().endTurn();
    expect(
      legalIntents(g.state, 1).some(
        (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === heroId,
      ),
    ).toBe(true);
  });

  it("Increase the Tension buffs an arrow and blocks defense reactions from hand only", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          weapons: ["red liner|0"],
          arsenal: ["pathing helix|3"],
          hand: ["increase the tension|1", BLUE],
        },
        {
          hero: "dorinthea",
          hand: ["sink below|1"],
          arsenal: ["fate foreseen|1"],
        },
      ],
    });

    g.play("increase the tension|1", { pitch: [BLUE] })
      .play("pathing helix|3", { fromArsenal: true })
      .expectAttackValue(5)
      .blockWith()
      .passPriority();
    const legal = legalIntents(g.state, 1);
    const handId = g.state.players[1]!.hand[0]!.instanceId;
    const arsenalId = g.state.players[1]!.arsenal[0]!.instanceId;
    expect(legal.some((intent) => intent.kind === "play-card" && intent.instanceId === handId)).toBe(false);
    expect(
      legal.some((intent) => intent.kind === "play-from-arsenal" && intent.instanceId === arsenalId),
    ).toBe(true);
  });
});

describe("CRU — Ranger traps", () => {
  it("a trap in hand cannot be declared as an initial defender", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["wounded bull|1", BLUE] },
        { hero: "dorinthea", hand: ["tripwire trap|1"] },
      ],
    });

    g.play("wounded bull|1", { pitch: [BLUE] });
    const trap = g.state.players[1]!.hand.find(
      (card) => card.cardId === printingId("tripwire trap|1"),
    )!;
    const defenses = legalIntents(g.state, 1).filter((intent) => intent.kind === "defend");
    expect(
      defenses.some(
        (intent) => intent.kind === "defend" && intent.instanceIds.includes(trap.instanceId),
      ),
    ).toBe(false);
  });

  it("Tripwire Trap suppresses hit effects when the attacker declines payment", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["come to fight|1", "snatch|1", BLUE],
          deck: ["zap|3"],
        },
        { hero: "dorinthea", arsenal: ["tripwire trap|1"] },
      ],
    });

    g.play("come to fight|1", { pitch: [BLUE] }).play("snatch|1").blockWith().passPriority();
    g.react("tripwire trap|1").chooseOption("no").expectHandSize(0, 0).expectLife(1, 17);
  });

  it("a Tripwire-suppressed first hit consumes Katsu's first-hit limit", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: "katsu, the wanderer|0",
          weapons: [],
          hand: [
            "come to fight|1",
            "bittering thorns|2",
            "soulbead strike|3",
            "crane dance|3",
            BLUE,
            "wrecker romp|3",
          ],
        },
        { hero: "dorinthea", arsenal: ["tripwire trap|1"], hand: [] },
      ],
    });

    g.play("come to fight|1", { pitch: [BLUE] })
      .play("bittering thorns|2")
      .blockWith()
      .passPriority();
    g.react("tripwire trap|1").chooseOption("no");
    g.play("soulbead strike|3").blockWith().settle();

    expect(g.state.players[0]!.flags.katsuWandererUsed).toBe(true);
    expect(g.state.pendingDecision).toBeNull();
  });

  it("Pitfall Trap deals 2 damage when the attacker cannot pay", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["wounded bull|1", BLUE] },
        { hero: "dorinthea", arsenal: ["pitfall trap|2"] },
      ],
    });

    g.play("wounded bull|1", { pitch: [BLUE] }).blockWith().passPriority();
    g.react("pitfall trap|2").expectLife(0, 18);
  });

  it("Rockslide Trap gives the attack -2 power when the attacker cannot pay", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["wounded bull|1", BLUE] },
        { hero: "dorinthea", arsenal: ["rockslide trap|3"] },
      ],
    });

    g.play("wounded bull|1", { pitch: [BLUE] }).blockWith().passPriority();
    g.react("rockslide trap|3").expectFinalAttack(5).expectLife(1, 17);
  });
});
