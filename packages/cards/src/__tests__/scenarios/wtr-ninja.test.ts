import { describe, expect, it } from "vitest";
import { applyIntent, projectStateFor, type GameState } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

/** Swap seat 0 over to the Katsu hero card for hero-ability tests. */
function swapToKatsu(g: ReturnType<typeof scenario>) {
  const state = g.state as GameState;
  state.players[0]!.heroCardId = "WTR077";
  state.players[0]!.hero.cardId = "WTR077";
  state.players[0]!.weapons = [];
}

/** Answer an open scripted choice with the instance of `key` in `zone`. */
function chooseCard(
  g: ReturnType<typeof scenario>,
  seat: number,
  key: string,
  zone: "hand" | "deck",
) {
  const id = printingId(key);
  const card = g.state.players[seat]![zone].find((c) => c.cardId === id);
  if (!card) throw new Error(`no "${key}" in seat ${seat}'s ${zone}`);
  const r = applyIntent(g.state, seat, { kind: "choose", optionId: String(card.instanceId) });
  if (!r.ok) throw new Error(`choose "${key}" rejected: ${r.error}`);
  g.state = r.state;
  return g.settle();
}

/** Play a card from banish/graveyard (the harness only exposes hand/arsenal plays). */
function playFromZone(
  g: ReturnType<typeof scenario>,
  key: string,
  zone: "banish" | "graveyard",
  pitchKeys: string[] = [],
) {
  const seat = g.state.activePlayer;
  const id = printingId(key);
  const card = g.state.players[seat]![zone].find((c) => c.cardId === id);
  if (!card) throw new Error(`no "${key}" in seat ${seat}'s ${zone}`);
  const pitchInstanceIds = pitchKeys.map((k) => {
    const pid = printingId(k);
    const c = g.state.players[seat]!.hand.find((x) => x.cardId === pid);
    if (!c) throw new Error(`no "${k}" in seat ${seat}'s hand to pitch`);
    return c.instanceId;
  });
  const r = applyIntent(g.state, seat, {
    kind: "play-from-zone",
    zone,
    instanceId: card.instanceId,
    pitchInstanceIds,
  });
  if (!r.ok) throw new Error(`play-from-zone "${key}" rejected: ${r.error}`);
  g.state = r.state;
  return g;
}

describe("WTR Ninja — combo attacks", () => {
  it("Blackout Kick gains +3 attack after Rising Knee Thrust", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["rising knee thrust|1", "blackout kick|1", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("rising knee thrust|1") // cost 0, go again
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .play("blackout kick|1") // cost 1
      .expectAttackValue(7) // 4 + 3
      .blockWith()
      .settle()
      .expectLife(1, 10); // 3 + 7
  });

  it("Open the Center gains +1, go again, and dominate after Head Jab", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["head jab|1", "open the center|1", "raging onslaught|2"],
        },
        { hero: "rhinar", hand: ["raging onslaught|2", "raging onslaught|2"] },
      ],
    });
    g.play("head jab|1")
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .play("open the center|1", { pitch: ["raging onslaught|2"] })
      .expectAttackValue(6) // 5 + 1
      .blockWith("raging onslaught|2") // dominate: only one hand card
      .settle()
      .expectAP(0, 1)
      .expectLife(1, 14); // 3 + 3
  });

  it("Rising Knee Thrust gains +2 attack and go again after Leg Tap", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["leg tap|1", "rising knee thrust|1", "raging onslaught|2"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("leg tap|1", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .play("rising knee thrust|1")
      .expectAttackValue(5) // 3 + 2
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectLife(1, 11); // 4 + 5
  });

  it("Whelming Gustwave gains +1, go again, and draws on hit after Surging Strike", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["surging strike|1", "whelming gustwave|1", "raging onslaught|2"],
          deck: ["raging onslaught|2"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("surging strike|1", { pitch: ["raging onslaught|2"] })
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .play("whelming gustwave|1")
      .expectAttackValue(4) // 3 + 1
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectHandSize(0, 1)
      .expectInZone(0, "raging onslaught|2", "hand")
      .expectLife(1, 11); // 5 + 4
  });

  it("Whelming Gustwave recognizes Surging Strike gained by Be Like Water", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          resources: 1,
          hand: ["be like water|1", "whelming gustwave|1"],
          deck: ["raging onslaught|2"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("be like water|1")
      .blockWith()
      .settle()
      .chooseOption("pay 1")
      .chooseOption("Surging Strike");

    expect(g.state.chain[0]!.attackingCard.grantedNames).toContain("Surging Strike");

    g.play("whelming gustwave|1")
      .expectAttackValue(4)
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .expectHandSize(0, 1)
      .expectInZone(0, "raging onslaught|2", "hand");
  });

  it("Fluster Fist gains +1 for each hit this chain after Open the Center", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["open the center|1", "fluster fist|1", "raging onslaught|2"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("open the center|1", { pitch: ["raging onslaught|2"] })
      .expectAttackValue(5)
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .play("fluster fist|1")
      .expectAttackValue(5) // 4 + 1 hit
      .blockWith()
      .settle()
      .expectLife(1, 10); // 5 + 5
  });
});

describe("WTR Ninja — Flic Flak", () => {
  it("Flic Flak gives +2 defense to the next combo card defended later this turn", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["head jab|3", "head jab|3"] },
        { hero: "rhinar", hand: ["flic flak|1", "rising knee thrust|1"] },
      ],
    });
    g.play("head jab|3")
      .blockWith()
      .passPriority()
      .react("flic flak|1")
      .expectLog("Flic Flak: the next combo card you defend with this turn gains +2 defense")
      .play("head jab|3")
      .blockWith("rising knee thrust|1")
      .settle()
      .expectLife(1, 20); // 1 attack vs 4 + (3 + 2) defense
  });
});

describe("WTR Ninja — Breaking Scales", () => {
  it("pumps a combo attack in the attack-reaction window", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["rising knee thrust|1"], equipment: { arms: "breaking scales|0" } },
        { hero: "rhinar", hand: [] },
      ],
    });
    g.play("rising knee thrust|1", { settle: false }) // combo attack, 3 attack
      .blockWith()
      .activate("breaking scales|0") // attack-reaction window, attacker's priority
      .expectLog("Breaking Scales: target combo attack gains +1 attack")
      .settle()
      .expectNoEquipment(0, "arms")
      .expectLife(1, 16); // 3 + 1
  });
});

describe("WTR Ninja — Mask of Momentum", () => {
  it("queues the third consecutive hit as a triggered ability before drawing", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["head jab|1", "head jab|1", "head jab|1"],
          deck: ["raging onslaught|2"],
          equipment: { head: "mask of momentum|0" },
        },
        { hero: "rhinar", hand: [] },
      ],
    });

    g.play("head jab|1").blockWith().settle()
      .play("head jab|1").blockWith().settle()
      .play("head jab|1").blockWith()
      .expectHandSize(0, 0);

    const projectedHitEffects = projectStateFor(g.state, 0).chain.at(-1)?.onHitEffects ?? [];
    expect(projectedHitEffects.some((effect) =>
      g.state.cardsRef[effect.sourceCardId]?.name === "Mask of Momentum"
    )).toBe(true);

    g.passPriority().passPriority().expectHandSize(0, 0);

    const trigger = g.state.stack[0];
    expect(trigger?.engineEffect?.kind).toBe("on-hit-hook");
    if (trigger?.engineEffect?.kind !== "on-hit-hook") throw new Error("Mask trigger not queued");
    expect(g.state.cardsRef[trigger.engineEffect.source.cardId]?.name).toBe("Mask of Momentum");
    expect(g.state.pendingDecision?.kind).toBe("priority-window");
    expect(g.state.chain.at(-1)?.resolved).toBe(false);

    g.passPriority().passPriority()
      .expectHandSize(0, 1)
      .expectInZone(0, "raging onslaught|2", "hand");

    const maskId = g.state.players[0]!.equipment.head!.instanceId;
    expect(projectStateFor(g.state, 0).turnFacts?.players[0].usedOncePerTurnEffectSourceIds)
      .toContain(maskId);
  });
});

describe("WTR Ninja — Katsu hero", () => {
  it("first attack-action hit lets you discard a 0-cost card, search a combo card, and play it", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["head jab|1", "head jab|3", "raging onslaught|3"],
          deck: ["blackout kick|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    swapToKatsu(g);
    g.play("head jab|1")
      .blockWith()
      .settle(); // hit: Katsu offers the discard
    chooseCard(g, 0, "head jab|3", "hand"); // discard a 0-cost card…
    chooseCard(g, 0, "blackout kick|1", "deck") // …then search a combo card
      .expectInZone(0, "blackout kick|1", "banish")
      .expectInZone(0, "head jab|3", "graveyard")
      .expectLog("Katsu: banished Blackout Kick face up");
    expect(projectStateFor(g.state, 1).logEntries).toContainEqual(expect.objectContaining({
      message: {
        id: "card.log.wtr.katsu.search.banished",
        values: {
          card: { kind: "card", cardId: "WTR077" },
          result: { kind: "card", cardId: printingId("blackout kick|1") },
        },
      },
      event: expect.objectContaining({
        kind: "card-moved",
        cardId: printingId("blackout kick|1"),
        from: "deck",
        to: "banish",
      }),
    }));
    // "you may play it this turn": straight from the banish zone
    playFromZone(g, "blackout kick|1", "banish", ["raging onslaught|3"])
      .blockWith()
      .settle()
      .expectLife(1, 13) // 3 (Head Jab) + 4 (no combo: last attack was Head Jab)
      .expectNotInZone(0, "blackout kick|1", "banish");
  });

  it("a banished card without permission cannot be played", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["raging onslaught|3"] }, { hero: "rhinar", hand: [] }],
    });
    const state = g.state as GameState;
    state.players[0]!.banish.push({
      instanceId: 9999,
      cardId: printingId("blackout kick|1"),
      owner: 0,
    });
    const pitch = state.players[0]!.hand[0]!;
    const r = applyIntent(g.state, 0, {
      kind: "play-from-zone",
      zone: "banish",
      instanceId: 9999,
      pitchInstanceIds: [pitch.instanceId],
    });
    expect(r.ok).toBe(false);
  });

  it("the searched card is only playable the turn it was found", () => {
    const g = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["head jab|1", "head jab|3", "raging onslaught|3"],
          deck: ["blackout kick|1"],
        },
        { hero: "rhinar", hand: [] },
      ],
    });
    swapToKatsu(g);
    g.play("head jab|1").blockWith().settle();
    chooseCard(g, 0, "head jab|3", "hand");
    chooseCard(g, 0, "blackout kick|1", "deck");
    g.endTurn().endTurn(); // permission expires with the turn
    const card = g.state.players[0]!.banish.find(
      (c) => c.cardId === printingId("blackout kick|1"),
    )!;
    expect(card.playableFrom).toBeUndefined();
    const pitch = g.state.players[0]!.hand.find(
      (c) => c.cardId === printingId("raging onslaught|3"),
    )!;
    const r = applyIntent(g.state, 0, {
      kind: "play-from-zone",
      zone: "banish",
      instanceId: card.instanceId,
      pitchInstanceIds: [pitch.instanceId],
    });
    expect(r.ok).toBe(false);
  });

  it("the Katsu player may decline the discard", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["head jab|1", "head jab|3"], deck: ["blackout kick|1"] },
        { hero: "rhinar", hand: [] },
      ],
    });
    swapToKatsu(g);
    g.play("head jab|1")
      .blockWith()
      .settle()
      .chooseOption("pass")
      .expectInZone(0, "blackout kick|1", "deck")
      .expectInZone(0, "head jab|3", "hand");
  });
});
