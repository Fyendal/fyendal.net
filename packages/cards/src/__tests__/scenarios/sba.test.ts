import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { scenario } from "../harness.js";

/**
 * Scenarios for the SBA pool (Silver Age: Briar precon): Briar's Embodiments,
 * Runechants, arcane damage + Arcane Barrier, Fusion, Meld split cards, and
 * the Quickstrike / Lightning Flow label keywords.
 *
 * Briar has no registered decklist, so seats use `heroKey: "briar|0"` on top
 * of a base list; weapons/equipment are overridden per test.
 * Pitch fodder: "wrecker romp|3" (blue), "raging onslaught|2" (yellow),
 * "en garde|1" (red); "wrecker romp|1" is a non-Lightning hand filler.
 */

const briar = { hero: "rhinar" as const, heroKey: "briar|0", weapons: [] as string[] };

describe("SBA — Briar hero", () => {
  it("creates an Embodiment of Earth the first time an attack action deals damage", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["arcanic shockwave|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    // no Lightning card in hand (Wrecker Romp is Brute) — no fusion choice
    g.play("arcanic shockwave|1")
      .blockWith()
      .settle()
      .expectLife(1, 16)
      .expectInZone(0, "embodiment of earth|0", "board");
  });

  it("keeps Embodiment of Earth through the Start Phase and gives its action-phase trigger priority", () => {
    const g = scenario({
      active: 1,
      seats: [
        { ...briar, board: ["embodiment of earth|0"], hand: ["sigil of solace|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });

    g.doRaw({ kind: "pass" });
    expect(g.state.stackResume).toBe("end-action-phase");
    g.passPriority();
    expect(g.state.stackResume).toBe("grant-turn-action");
    expect(g.state.stack[0]?.label).toBe("Destroy Embodiment of Earth");
    expect(g.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    g.expectAP(0, 1).expectInZone(0, "embodiment of earth|0", "board");

    g.passPriority().passPriority()
      .expectNotInZone(0, "embodiment of earth|0", "board")
      .expectAP(0, 1);
  });

  it("does not put Briar's Earth ability on the stack after an earlier attack action hit", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["fry|1", "second strike|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("fry|1")
      .blockWith()
      .settle()
      .expectInZone(0, "embodiment of earth|0", "board")
      .play("second strike|1")
      .blockWith()
      .passPriority()
      .passPriority();

    expect(g.state.stack).toHaveLength(0);
    expect(g.state.pendingDecision).toBeNull();
    expect(g.state.chain.at(-1)?.resolved).toBe(true);
    g.expectZoneSize(0, "board", 1);
  });

  it("creates an Embodiment of Lightning on the second 'non-attack' action; the next attack gains go again", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          hand: ["sizzle|1", "sprout strength|1", "arcanic shockwave|1", "wrecker romp|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("sizzle|1")
      .expectAP(0, 1) // go again
      .play("sprout strength|1")
      .expectAP(0, 1)
      .expectInZone(0, "embodiment of lightning|0", "board")
      .play("arcanic shockwave|1") // 4 + 3 (Sizzle) + 3 (Sprout Strength)
      .expectAttackValue(10)
      .blockWith()
      .settle()
      .expectFinalAttack(10)
      .expectLife(1, 10)
      .expectAP(0, 1) // the Embodiment was destroyed to give the attack go again
      .expectNotInZone(0, "embodiment of lightning|0", "board")
      // …and the hit created an Embodiment of Earth
      .expectInZone(0, "embodiment of earth|0", "board");
  });

  it("does not stack Embodiment of Lightning with an attack that already has go again", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          hand: ["ravenous rabble|1"],
          deck: ["wrecker romp|1"],
          board: ["embodiment of lightning|0"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });

    g.play("ravenous rabble|1")
      .expectNotInZone(0, "embodiment of lightning|0", "board")
      .blockWith()
      .settle()
      .expectAP(0, 1);
  });

  it("counts melded Arcane Seeds // Life as one non-attack action for Briar", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["sizzle|1", "arcane seeds // life|1"], life: 13 },
        { hero: "rhinar", hand: [] },
      ],
    });

    g.play("sizzle|1")
      .play("arcane seeds // life|1", { meldSide: "both" })
      .expectLife(0, 14)
      .expectZoneSize(0, "board", 3)
      .expectInZone(0, "runechant|0", "board")
      .expectInZone(0, "embodiment of lightning|0", "board");

    expect(g.state.players[0]!.flags.nonAttackActionsPlayedThisTurn).toBe(2);
  });

  it("Embodiment of Earth gives 'non-attack' actions +1{d} and is destroyed at the start of Briar's turn", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          hand: ["arcanic shockwave|1", "sizzle|1", "wrecker romp|1", "wrecker romp|3"],
        },
        { hero: "rhinar", hand: ["raging onslaught|1", "wrecker romp|3"] },
      ],
    });
    g.play("arcanic shockwave|1") // Sizzle in hand is Lightning: fusion is offered
      .chooseOption("no")
      .blockWith()
      .settle()
      .expectInZone(0, "embodiment of earth|0", "board")
      .endTurn();
    g.play("raging onslaught|1", { pitch: ["wrecker romp|3"] })
      .blockWith("sizzle|1") // 2 defense + 1 from the Embodiment
      .settle()
      .expectFinalDefense(3);
    g.endTurn().expectZoneSize(0, "board", 0); // destroyed at the start of Briar's turn
  });
});

describe("SBA — Runechants and split cards", () => {
  it("Arcane Seeds creates two Runechants that arcane the opponent on the next attack", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["arcane seeds // life|1", "arcanic shockwave|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("arcane seeds // life|1", { meldSide: "left" })
      .expectZoneSize(0, "board", 2)
      .expectAP(0, 1) // spend 1 AP for Seeds, then go again refunds it
      .play("arcanic shockwave|1")
      .blockWith()
      .settle()
      .expectLife(1, 14) // 2 arcane (Runechants) + 4 combat
      .expectNotInZone(0, "runechant|0", "board")
      // …and the hit created an Embodiment of Earth
      .expectInZone(0, "embodiment of earth|0", "board");
  });

  it("two Runechants go on the stack together, are respondable, and ask no order", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["runechant|0", "runechant|0"], hand: ["wounded bull|1", "raging onslaught|3"] },
        { hero: "dorinthea", hand: ["sigil of solace|1"], life: 20 },
      ],
    });
    g.play("wounded bull|1", { settle: false });
    // both triggers queued simultaneously (identical — no ordering prompt),
    // tokens alive while the attack window is open for responses
    expect(g.state.stack).toHaveLength(2);
    expect(g.state.pendingDecision?.chooseHook).not.toBe("trigger-order");
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    g.expectZoneSize(0, "board", 2);
    g.passPriority(); // attacker yields
    g.react("sigil of solace|1"); // opponent responds to the triggers
    g.settle();
    g.expectLife(1, 21) // +3 Sigil, then 2 arcane as the triggers resolve
      .expectZoneSize(0, "board", 0);
  });

  it("both players can skip consecutive Runechant priority and Arcane Barrier", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["runechant|0", "runechant|0"], hand: ["wounded bull|1", "raging onslaught|3"] },
        {
          hero: "dorinthea",
          equipment: { head: "crown of dichotomy|0" },
          hand: ["sigil of solace|1", "wrecker romp|3"],
          life: 20,
        },
      ],
    });
    const skip = (seat: number): void => {
      expect(legalIntents(g.state, seat)).toContainEqual({ kind: "skip-runechant" });
      g.doRaw({ kind: "skip-runechant" });
    };

    g.play("wounded bull|1", { pitch: ["raging onslaught|3"], settle: false });
    skip(0); // attacker passes priority over the first Runechant
    skip(1); // defender passes priority; the Runechant resolves
    expect(g.state.pendingDecision?.chooseHook).toBe("arcane-barrier");
    expect(g.state.pendingDecision?.arcane?.sourceIsRunechant).toBe(true);
    skip(1); // defender chooses pay 0 without pitching
    g.expectLife(1, 19).expectZoneSize(1, "hand", 2);

    skip(0);
    skip(1);
    skip(1);
    g.expectLife(1, 18)
      .expectZoneSize(1, "hand", 2)
      .expectZoneSize(0, "board", 0);
    expect(legalIntents(g.state, g.state.pendingDecision?.player ?? 0))
      .not.toContainEqual({ kind: "skip-runechant" });
  });

  it("Life gains 1 life", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["arcane seeds // life|1"], life: 15 },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("arcane seeds // life|1", { meldSide: "right" }).expectLife(0, 16);
  });

  it("melded Burn Up // Shock: 1 arcane now, 4 arcane on the next hit, go again", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["burn up // shock|1", "fry|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("burn up // shock|1", { meldSide: "both" })
      .expectLife(1, 19) // Shock half
      .expectAP(0, 1) // the action half costs 1 AP; Burn Up's go again refunds it
      .play("fry|1")
      .blockWith()
      .passPriority()
      .passPriority()
      .expectLife(1, 16); // Fry's 3 combat damage is applied first
    expect(g.state.chain.at(-1)?.resolved).toBe(false);
    expect(g.state.pendingDecision?.chooseHook).toBe("trigger-order");
    const burnLayer = g.state.pendingDecision?.triggerOrder?.remaining.find((layer) =>
      layer.engineEffect?.kind === "on-hit-hook" &&
      g.state.cardsRef[layer.engineEffect.source.cardId]?.name === "Burn Up // Shock"
    );
    expect(burnLayer).toBeDefined();
    g.doRaw({ kind: "choose", optionId: `${burnLayer!.sourceInstanceId}:${burnLayer!.triggerIndex}` });
    expect(g.state.stack.some((layer) => layer.engineEffect?.kind === "on-hit-hook")).toBe(true);
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    g.settle()
      .expectLife(1, 12); // Burn Up's 4 arcane resolves from its layer
    expect(g.state.chain.at(-1)?.resolved).toBe(true);
  });

});

describe("SBA — Fusion", () => {
  it("Arcanic Shockwave fused deals 1 arcane when it attacks", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["arcanic shockwave|1", "fry|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("arcanic shockwave|1")
      .chooseCard("fry|1") // reveal a Lightning card to fuse
      .expectLog("fused")
      .blockWith()
      .settle()
      .expectLife(1, 15); // 4 combat + 1 arcane
  });

  it("Entwine Lightning gains go again only when fused", () => {
    const unfused = scenario({
      seats: [
        { ...briar, hand: ["entwine lightning|1", "fry|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    unfused
      .play("entwine lightning|1")
      .chooseOption("no") // decline the fusion reveal
      .blockWith()
      .settle()
      .expectLife(1, 16)
      .expectAP(0, 0) // no go again
      .expectNoLog("gains go again");

    const fused = scenario({
      seats: [
        { ...briar, hand: ["entwine lightning|1", "fry|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    fused
      .play("entwine lightning|1")
      .chooseCard("fry|1")
      .blockWith()
      .settle()
      .expectLife(1, 16)
      .expectAP(0, 1); // fused: go again refunded the action point
  });

  it("Weave Lightning: the next Elemental attack gets +3{p}, and go again when fused", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["weave lightning|1", "arcanic shockwave|1", "fry|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("weave lightning|1").expectAP(0, 1);
    expect(projectStateFor(g.state, 0).ongoing).not.toEqual([]);
    g.play("arcanic shockwave|1").chooseCard("fry|1");
    // Both the next-attack pump and the fused-go-again watcher are spent as
    // soon as the eligible attack is declared; no blank this-turn chip leaks.
    expect(projectStateFor(g.state, 0).ongoing).toEqual([]);
    g
      .expectAttackValue(7) // 4 + 3
      .blockWith()
      .settle()
      .expectFinalAttack(7)
      .expectLife(1, 12) // 7 combat + 1 arcane (fused Shockwave)
      .expectAP(0, 1); // Weave Lightning gave the fused attack go again
  });
});

describe("SBA — Arcane Barrier", () => {
  const barrierSeats = (hand: string[]): [{ hero: "rhinar"; heroKey: string; weapons: string[]; equipment: { head: string }; hand: string[] }, { hero: "rhinar"; heroKey: string; weapons: string[]; hand: string[] }] => [
    {
      ...briar,
      equipment: { head: "crown of dichotomy|0" }, // Arcane Barrier 1
      hand,
    },
    { ...briar, hand: ["path of same ends|1"] },
  ];

  it("the defender may pitch to pay Arcane Barrier 1 and prevent the arcane damage", () => {
    const g = scenario({ seats: barrierSeats(["wrecker romp|3"]), active: 1 });
    g.play("path of same ends|1") // deals 1 arcane when it attacks
      .chooseOption("1") // pay 1 for Arcane Barrier…
      .chooseCard("wrecker romp|3") // …by pitching
      .expectLog("prevents 1 arcane damage")
      .blockWith()
      .settle()
      .expectLife(0, 17) // only the 3 combat damage lands
      .expectNoLog("gains go again"); // no arcane dealt: Path of Same Ends stays slow
  });

  it("the defender may decline and take the arcane damage", () => {
    const g = scenario({ seats: barrierSeats(["wrecker romp|3"]), active: 1 });
    g.play("path of same ends|1")
      .chooseOption("0")
      .blockWith()
      .settle()
      .expectLife(0, 16) // 1 arcane + 3 combat
      .expectLog("gains go again"); // arcane dealt: Path of Same Ends gains go again
  });

  it("Path of Same Ends may activate its instant ability from the combat chain", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["path of same ends|1", "wrecker romp|3"] },
        {
          ...briar,
          equipment: { head: "crown of dichotomy|0" },
          hand: ["wrecker romp|3"],
        },
      ],
    });

    g.play("path of same ends|1")
      .chooseOption("1")
      .chooseCard("wrecker romp|3")
      .blockWith()
      .activate("path of same ends|1", { pitch: ["wrecker romp|3"] })
      .expectLog("activates Path of Same Ends")
      .expectAP(0, 1);
  });
});

describe("SBA — weapons", () => {
  it("Star Fall gets +1{p} and go again after a Lightning card was played", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          weapons: ["star fall|0"],
          hand: ["fry|1", "wrecker romp|3"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("fry|1")
      .blockWith()
      .settle()
      .expectLife(1, 17)
      .attackWithWeapon("star fall|0", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(2) // 1 + 1 (played a Lightning card)
      .blockWith()
      .settle()
      .expectFinalAttack(2)
      .expectLife(1, 15)
      .expectAP(0, 1); // go again
  });

  it("Star Fall is a plain 1{p} attack without a Lightning card played", () => {
    const g = scenario({
      seats: [
        { ...briar, weapons: ["star fall|0"], hand: ["wrecker romp|3"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.attackWithWeapon("star fall|0", { pitch: ["wrecker romp|3"] })
      .expectAttackValue(1)
      .blockWith()
      .settle()
      .expectFinalAttack(1)
      .expectAP(0, 0);
  });

  it("Scorpio, Comet Tail can only attack while you control a Lightning attack, and arcanes on hit", () => {
    const g = scenario({
      seats: [
        { ...briar, weapons: ["scorpio, comet tail|0"], hand: ["fry|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("fry|1").blockWith().settle().expectLife(1, 17);
    // the resolved Fry link is still a Lightning attack on the open chain
    g.attackWithWeapon("scorpio, comet tail|0")
      .expectAttackValue(1)
      .blockWith()
      .settle()
      .expectLife(1, 15); // 1 combat + 1 arcane

    const cold = scenario({
      seats: [
        { ...briar, weapons: ["scorpio, comet tail|0"], hand: ["wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    expect(() => cold.attackWithWeapon("scorpio, comet tail|0")).toThrow();
  });
});

describe("SBA — equipment", () => {
  it("Blade Beckoner Helm defends for +1 against weapon attacks, then Guardwell counters it", () => {
    const g = scenario({
      seats: [
        { ...briar, equipment: { head: "blade beckoner helm|0" }, hand: [] },
        { hero: "dorinthea", hand: ["wrecker romp|3"] },
      ],
      active: 1,
    });
    g.attackWithWeapon(undefined, { pitch: ["wrecker romp|3"] }) // Dawnblade, 2{p}
      .blockWith("blade beckoner helm|0")
      .settle()
      .expectFinalDefense(2) // 1 printed + 1 vs weapon attack
      .expectLife(0, 20);
    g.endTurn().expectEquipmentDefense(0, "head", 0);
    expect(g.state.players[0]!.equipment.head?.defCounters).toBe(2); // 2{d} at chain close
  });

  it("Crown of Dichotomy recurs a Runeblade attack action to the top of the deck", () => {
    // (no Runeblade 'non-attack' action exists in the pool yet, so only the
    // attack-action half of the choice chain is exercised here)
    const g = scenario({
      seats: [
        {
          ...briar,
          equipment: { head: "crown of dichotomy|0" },
          hand: ["wrecker romp|3"],
          graveyard: ["arcanic shockwave|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.activate("crown of dichotomy|0", { pitch: ["wrecker romp|3"] })
      .chooseCard("arcanic shockwave|1")
      .expectDeckTop(0, "arcanic shockwave|1")
      .expectNotInZone(0, "arcanic shockwave|1", "graveyard")
      .expectNoEquipment(0, "head");
  });

  it("Swiftstrike Bracers and Quick Clicks require a Nimblism played this turn", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          equipment: { arms: "swiftstrike bracers|0", legs: "quick clicks|0" },
          hand: ["nimblism|1", "arcanic shockwave|1", "wrecker romp|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("nimblism|1") // enables the equipment; +3 to the next cheap attack
      .activate("swiftstrike bracers|0")
      .expectAP(0, 1) // the ability has go again
      .activate("quick clicks|0")
      .expectAP(0, 1)
      .play("arcanic shockwave|1") // 4 + 3 (Nimblism) + 2 (Bracers), go again (Quick Clicks)
      .expectAttackValue(9)
      .blockWith()
      .settle()
      .expectFinalAttack(9)
      .expectAP(0, 1)
      .expectNoEquipment(0, "arms")
      .expectNoEquipment(0, "legs");

    const cold = scenario({
      seats: [
        {
          ...briar,
          equipment: { arms: "swiftstrike bracers|0" },
          hand: ["arcanic shockwave|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    expect(() => cold.activate("swiftstrike bracers|0")).toThrow();
  });
});

describe("SBA — attacks", () => {
  it("Jack Be Quick may banish a Nimblism for +1{p} and go again", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          hand: ["jack be quick|1", "wrecker romp|1"],
          graveyard: ["nimblism|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("jack be quick|1")
      .chooseCard("nimblism|1")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectFinalAttack(4)
      .expectInZone(0, "nimblism|1", "banish")
      .expectLife(1, 16)
      .expectAP(0, 1); // go again

    const cold = scenario({
      seats: [{ ...briar, hand: ["jack be quick|1"] }, { hero: "rhinar", hand: [] }],
    });
    cold
      .play("jack be quick|1")
      .expectAttackValue(3) // no Nimblism to banish, no go again
      .blockWith()
      .settle()
      .expectAP(0, 0);
  });

  it("Lightning Surge gains go again only from arsenal", () => {
    const fromArsenal = scenario({
      seats: [
        { ...briar, hand: ["wrecker romp|1"], arsenal: ["lightning surge|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    fromArsenal
      .play("lightning surge|1", { fromArsenal: true })
      .blockWith()
      .settle()
      .expectLife(1, 16)
      .expectAP(0, 1);

    const fromHand = scenario({
      seats: [
        { ...briar, hand: ["lightning surge|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    fromHand.play("lightning surge|1").blockWith().settle().expectAP(0, 0);
  });

  it("Ravenous Rabble reveals the top card and loses that much pitch in {p}", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["ravenous rabble|1"], deck: ["nimblism|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("ravenous rabble|1")
      .expectLog("reveals Nimblism")
      .expectAttackValue(4) // 5 - 1 (Nimblism pitches for 1)
      .blockWith()
      .settle()
      .expectFinalAttack(4)
      .expectLife(1, 16);
  });

  it("Rush of Power's Quickstrike gives +1{p} while it has go again; 1 arcane on hit", () => {
    const g = scenario({
      seats: [
        {
          ...briar,
          hand: ["sizzle|1", "sprout strength|1", "rush of power|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    // two 'non-attack' actions create the Embodiment of Lightning that gives
    // Rush of Power go again
    g.play("sizzle|1")
      .play("sprout strength|1")
      .play("rush of power|1") // 3 + 1 (Quickstrike) + 3 (Sizzle) + 3 (Sprout)
      .expectAttackValue(10)
      .blockWith()
      .settle()
      .expectFinalAttack(10)
      .expectLife(1, 9) // 10 combat + 1 arcane on hit
      .expectAP(0, 1);

    const cold = scenario({
      seats: [{ ...briar, hand: ["rush of power|1"] }, { hero: "rhinar", hand: [] }],
    });
    cold
      .play("rush of power|1")
      .expectAttackValue(3) // no go again, no Quickstrike bonus
      .blockWith()
      .settle()
      .expectLife(1, 16)
      .expectAP(0, 0);
  });

  it("Second Strike gets +1{p} and go again only after damage was dealt this turn", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["fry|1", "second strike|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("fry|1")
      .blockWith()
      .settle()
      .play("second strike|1")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectFinalAttack(4)
      .expectLife(1, 13)
      .expectAP(0, 1);

    const cold = scenario({
      seats: [{ ...briar, hand: ["second strike|1"] }, { hero: "rhinar", hand: [] }],
    });
    cold
      .play("second strike|1")
      .expectAttackValue(3)
      .blockWith()
      .settle()
      .expectAP(0, 0);
  });

  it("Static Shock's Lightning Flow deals 1 arcane on hit after a Lightning card was played", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["fry|1", "static shock|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("fry|1")
      .blockWith()
      .settle()
      .play("static shock|1")
      .blockWith()
      .settle()
      .expectLife(1, 12); // 3 + 4 combat + 1 arcane
  });

  it("Sigil of Suffering arcanes the attacker and defends for +1 after dealing arcane", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["sigil of suffering|1"] },
        { ...briar, hand: ["fry|1"] },
      ],
      active: 1,
    });
    g.play("fry|1")
      .blockWith()
      .passPriority()
      .react("sigil of suffering|1")
      .expectLife(1, 19) // 1 arcane to the attacking hero
      .expectFinalDefense(4) // 3 + 1 (dealt arcane damage this turn)
      .expectLife(0, 20); // fully defended
  });
});

describe("SBA — instants and buffs", () => {
  it("Lightning Press gives a cheap attack action +3{p} in the reaction window", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["fry|1", "lightning press|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("fry|1")
      .blockWith()
      .react("lightning press|1")
      .settle()
      .expectFinalAttack(6)
      .expectLife(1, 14);
  });

  it("Lightning Press can give an opposing cheap attack action +3{p}", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["fry|1"] },
        { hero: "rhinar", hand: ["lightning press|1"] },
      ],
    });

    g.play("fry|1")
      .blockWith()
      .passPriority()
      .react("lightning press|1")
      .expectFinalAttack(6)
      .expectLife(1, 14);
  });

  it("Cloud Cover prevents the next 3 damage, including combat damage", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["cloud cover|1"] },
        { ...briar, hand: ["fry|1"] },
      ],
      active: 1,
    });
    g.play("fry|1", { settle: false }) // layer window opens (Cloud Cover can respond)
      .passPriority() // seat 1 passes
      .react("cloud cover|1") // seat 0 plays it in the window
      .blockWith()
      .settle()
      .expectLog("prevents 3")
      .expectLife(0, 20); // all 3 combat damage prevented: no hit
  });

  it("Arcane Polarity gains 4 after arcane damage was taken, 1 otherwise", () => {
    // "this turn" — the arcane damage and the Polarity must happen in the same
    // turn, so it is played in the defense-reaction window
    const g = scenario({
      seats: [
        { ...briar, hand: ["arcane polarity|1"] },
        { ...briar, hand: ["path of same ends|1"] },
      ],
      active: 1,
    });
    g.play("path of same ends|1") // 1 arcane to seat 0 when it attacks
      .blockWith()
      .passPriority() // seat 1 passes the attack-reaction window
      .react("arcane polarity|1") // seat 0: +4 life (took arcane this turn)
      .settle()
      .expectLife(0, 20); // 20 - 1 arcane + 4 - 3 combat

    const fresh = scenario({
      seats: [
        { ...briar, hand: ["arcane polarity|1"], life: 15 },
        { hero: "rhinar", hand: [] },
      ],
    });
    fresh.play("arcane polarity|1").expectLife(0, 16); // +1
  });

  it("Sizzle and Sprout Strength buff the next attack", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["sizzle|1", "fry|1", "wrecker romp|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("sizzle|1")
      .play("fry|1") // Lightning: +3
      .expectAttackValue(6)
      .blockWith()
      .settle()
      .expectFinalAttack(6);

    const sprout = scenario({
      seats: [
        { ...briar, hand: ["sprout strength|1", "arcanic shockwave|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    sprout
      .play("sprout strength|1")
      .play("arcanic shockwave|1") // three separate +1 effects
      .expectAttackValue(7)
      .blockWith()
      .settle()
      .expectFinalAttack(7);
  });
});

describe("SBA — Jack Be Quick (Steal)", () => {
  it("untaps and steals an opposing ally until the end of the action phase", () => {
    const g = scenario({
      seats: [
        { ...briar, hand: ["jack be quick|1"], graveyard: ["nimblism|1"] },
        { hero: "dorinthea", board: ["barnacle|2"], hand: [] },
      ],
    });
    g.play("jack be quick|1", { settle: false })
      .chooseCard("nimblism|1") // banish for +1{p} and go again
      .blockWith()
      .settle()
      .expectLog("steals Barnacle until the end of the action phase")
      .expectInZone(0, "barnacle|2", "board")
      .expectNotInZone(1, "barnacle|2", "board")
      .expectAP(0, 1); // go again from the banish
    // the stolen ally is untapped and fights for the thief this turn
    g.activate("barnacle|2").blockWith().settle().expectLife(1, 12); // 4 (jack) + 4 (barnacle)
    g.endTurn(); // end of the action phase: the ally returns home
    g.expectNotInZone(0, "barnacle|2", "board").expectInZone(1, "barnacle|2", "board");
  });
});
