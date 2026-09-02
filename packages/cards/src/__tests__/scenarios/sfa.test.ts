/**
 * SFA (Silver Age: Fai precon, Chapter 2) scenario tests — Fai's game-start
 * Phoenix Flame and discounted hero ability, granted Draconic types (Brand
 * with Cinderclaw / Enflame the Firebrand / Fealty), "Draconic chain links
 * you control" thresholds (Searing Emberblade, Display Loyalty, Cinderskin
 * Devotion, Phoenix Flame, Hot on Their Heels), Rupture (Lava Burst), hits-
 * this-chain (Salt the Wound, Double Cross Strap), banish-and-play on-hit
 * (Mounting Anger / Rising Resentment), the Crouching Tiger equipment package
 * (Pouncing Paws / Tearing Shuko / Blood Scent + Ephemeral), Spellvoid X
 * (Mask of the Swarming Claw), Wax On, Nip at the Heels, Mark, and the
 * Phoenix Flame support cards (Fire that Burns Within, Flamecall Awakening,
 * Rise from the Ashes).
 *
 * Driving notes: Fai's seat uses the dorinthea decklist as a base with the
 * hero/weapons/equipment overridden. Scripted choices pause mid-declare or
 * mid-resolution — answer them with chooseCard()/chooseOption() before the
 * defend decision. playFromZone covers the banished-and-playable cards.
 */
import { describe, expect, it } from "vitest";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { cardData, decklists, scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";

const FAI = "fai|0";
const EMBERBLADE = "searing emberblade|0";
const RONIN = "ronin renegade|1"; // 3{p} 0-cost Draconic attack, go again
const FLAME = "phoenix flame|1";
const BLUE = "wrecker romp|3"; // blue pitch fodder
const RED = "snatch|1"; // red pitch fodder

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function faiSeat(extra: Record<string, unknown> = {}) {
  return {
    hero: "dorinthea" as const,
    heroKey: FAI,
    weapons: [EMBERBLADE],
    equipment: { ...NO_EQUIPMENT },
    ...extra,
  };
}

/** Play a banished/granted card from an off zone (see the WTR ninja tests). */
function playFromZone(s: Scenario, key: string, zone: "banish" | "graveyard", pitchKeys: string[] = []) {
  const seat = s.state.activePlayer;
  const id = printingId(key);
  const card = s.state.players[seat]![zone].find((c) => c.cardId === id);
  if (!card) throw new Error(`no "${key}" in seat ${seat}'s ${zone}`);
  const pitchInstanceIds = pitchKeys.map((k) => {
    const pid = printingId(k);
    const c = s.state.players[seat]!.hand.find((x) => x.cardId === pid);
    if (!c) throw new Error(`no "${k}" in seat ${seat}'s hand to pitch`);
    return c.instanceId;
  });
  const r = applyIntent(s.state, seat, {
    kind: "play-from-zone",
    zone,
    instanceId: card.instanceId,
    pitchInstanceIds,
  });
  if (!r.ok) throw new Error(`play-from-zone "${key}" rejected: ${r.error}`);
  s.state = r.state;
  return s;
}

function abilityIntentsOn(s: Scenario, seat: number, key: string) {
  const id = printingId(key);
  return legalIntents(s.state, seat).filter(
    (i): i is Extract<GameIntent, { kind: "activate-ability" }> =>
      i.kind === "activate-ability" &&
      s.state.players[seat]!.hero.instanceId === i.sourceInstanceId &&
      printingId(s.state.players[seat]!.hero.cardId) === id,
  );
}

describe("SFA — Fai", () => {
  it("starts the game with a Phoenix Flame from the deck in the graveyard", () => {
    const faiDeck: Decklist = {
      heroId: printingId(FAI),
      weaponIds: [printingId(EMBERBLADE)],
      equipment: {},
      deck: [
        printingId(FLAME),
        printingId(FLAME),
        ...Array.from({ length: 38 }, () => printingId(RONIN)),
      ],
    };
    let state = createGame({
      decklists: [faiDeck, decklists.dorinthea],
      seed: 7,
      cards: cardData,
      scripts,
    });
    const accepted = applyIntent(state, 0, { kind: "choose", optionId: "yes" });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) state = accepted.state;
    const fai = state.players[0]!;
    const flamesInGrave = fai.graveyard.filter((c) => c.cardId === printingId(FLAME));
    expect(flamesInGrave).toHaveLength(1);
    // one Phoenix Flame left the deck; opening hand was drawn after the move
    expect(fai.deck.filter((c) => c.cardId === printingId(FLAME))).toHaveLength(1);
    expect(state.log.some((l) => l.publicText?.includes("Phoenix Flame starts the game"))).toBe(true);
  });

  it("hero ability returns a Phoenix Flame for {r}{r}{r}, discounted per Draconic chain link", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: [RONIN, RONIN, BLUE], graveyard: [FLAME] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    // two Draconic attacks → two Draconic chain links → the ability costs {r}
    s.play(RONIN).blockWith().settle()
      .play(RONIN).blockWith().settle()
      .activate(FAI, { pitch: [BLUE] }); // 3 pitched, 1 paid
    s.chooseCard(FLAME)
      .expectInZone(0, FLAME, "hand")
      .expectResources(0, 2);
    // once per turn: no further activation is offered
    expect(abilityIntentsOn(s, 0, FAI)).toHaveLength(0);
  });

  it("hero ability at full cost with no Draconic chain links", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [BLUE], graveyard: [FLAME] }), { hero: "rhinar", hand: [] }],
    });
    s.activate(FAI, { pitch: [BLUE] }); // 3 pitched, 3 paid
    s.chooseCard(FLAME)
      .expectInZone(0, FLAME, "hand")
      .expectResources(0, 0);
  });

  it("does not discount the hero ability for an unresolved attack layer", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: [RONIN, BLUE], graveyard: [FLAME] }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play(RONIN, { settle: false });

    expect(s.state.phase).toBe("layer");
    expect(s.state.stackResume).toBe("start-attack-step");
    expect(abilityIntentsOn(s, 0, FAI)).toContainEqual(
      expect.objectContaining({ pitchRequired: 3 }),
    );
  });

  it("charges {r} after Brand grants Display Loyalty a redundant Draconic type", () => {
    const s = scenario({
      seats: [
        faiSeat({
          hand: ["brand with cinderclaw|1", "display loyalty|1", RED],
          graveyard: [FLAME],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.play("brand with cinderclaw|1").blockWith().settle()
      .play("display loyalty|1").blockWith().settle();

    expect(s.state.chain).toHaveLength(2);
    const intents = abilityIntentsOn(s, 0, FAI);
    expect(intents.some((intent) => intent.pitchInstanceIds.length === 0)).toBe(false);
    expect(intents.some((intent) => intent.pitchInstanceIds.length === 1)).toBe(true);

    const rejected = applyIntent(s.state, 0, {
      kind: "activate-ability",
      sourceInstanceId: s.state.players[0]!.hero.instanceId,
      pitchInstanceIds: [],
    });
    expect(rejected.ok).toBe(false);

    s.activate(FAI, { pitch: [RED] })
      .chooseCard(FLAME)
      .expectInZone(0, FLAME, "hand")
      .expectResources(0, 0);
  });

  it("charges {r} after Pouncing Paws' Crouching Tiger and two Draconic chain links", () => {
    const s = scenario({
      seats: [
        faiSeat({
          equipment: { ...NO_EQUIPMENT, legs: "pouncing paws|0" },
          hand: ["brand with cinderclaw|1", "hot on their heels|1", RED],
          graveyard: [FLAME],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.activate("pouncing paws|0");
    playFromZone(s, "crouching tiger|0", "banish");
    s.settle().blockWith().settle()
      .play("brand with cinderclaw|1").blockWith().settle()
      .play("hot on their heels|1", { settle: false });

    for (
      let guard = 0;
      !s.state.log.at(-1)?.publicText?.includes("attacks with Hot on Their Heels") && guard < 12;
      guard++
    ) {
      s.passPriority();
    }

    expect(s.state.chain).toHaveLength(3);
    expect(s.state.log.at(-1)?.publicText).toContain("attacks with Hot on Their Heels");
    const intents = abilityIntentsOn(s, 0, FAI);
    expect(intents.some((intent) => intent.pitchInstanceIds.length === 0)).toBe(false);
    expect(intents.some((intent) => intent.pitchInstanceIds.length === 1)).toBe(true);

    s.activate(FAI, { pitch: [RED] })
      .chooseCard(FLAME)
      .expectInZone(0, FLAME, "hand")
      .expectResources(0, 0);
  });
});

describe("SFA — granted Draconic types", () => {
  it("Brand with Cinderclaw makes the next attack Draconic (Dragon Power gets +3)", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: ["brand with cinderclaw|1", "dragon power|3", RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("brand with cinderclaw|1").blockWith().settle()
      .play("dragon power|3", { pitch: [RED] })
      .expectAttackValue(5) // 2 base + 3 Draconic bonus
      .expectLog("your next attack this combat chain is Draconic");
  });

  it("Dragon Power is not Draconic without a grant", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["dragon power|3", RED] }), { hero: "rhinar", hand: [] }],
    });
    s.play("dragon power|3", { pitch: [RED] }).expectAttackValue(2);
  });

  it("Enflame the Firebrand: 2/3/4-link thresholds", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: [RONIN, RONIN, RONIN, "enflame the firebrand|1", "dragon power|3", RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play(RONIN).blockWith().settle()
      .play(RONIN).blockWith().settle()
      .play(RONIN).blockWith().settle()
      // 4 Draconic chain links at declaration: go again, attacks are Draconic, +2{p}
      .play("enflame the firebrand|1")
      .expectAttackValue(4) // 2 base + 2
      .expectLog("your attacks are Draconic this combat chain")
      .blockWith().settle()
      .expectAP(0, 1) // go again refunded
      // the combat-chain grant makes even the non-Draconic Dragon Power Draconic
      .play("dragon power|3", { pitch: [RED] })
      .expectAttackValue(5);
  });

  it("Fealty's ability makes the next card played Draconic", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: [RONIN, "display loyalty|1", "dragon power|3", RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play(RONIN).blockWith().settle()
      .play("display loyalty|1") // 2 Draconic links → go again + Fealty token
      .blockWith().settle()
      .expectInZone(0, "fealty|0", "board")
      .activate("fealty|0") // destroy: the next card played is Draconic
      .expectNotInZone(0, "fealty|0", "board")
      .play("dragon power|3", { pitch: [RED] })
      .expectAttackValue(5) // granted Draconic → +3
      .expectLog("draconic in addition to its other types");
  });

  it("destroys Fealty as an activation cost so it cannot be activated repeatedly", () => {
    const s = scenario({
      seats: [faiSeat({ board: ["fealty|0"] }), { hero: "rhinar", hand: [] }],
    });
    const fealtyId = s.state.players[0]!.board[0]!.instanceId;

    s.activate("fealty|0", { settle: false })
      .expectNotInZone(0, "fealty|0", "board");

    expect(legalIntents(s.state, 0)).not.toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: fealtyId,
    }));
  });

  it("Fealty is destroyed at the end phase unless a Fealty was created or a Draconic card played", () => {
    const destroyed = scenario({
      seats: [faiSeat({ board: ["fealty|0"], hand: [RED] }), { hero: "rhinar", hand: [] }],
    });
    destroyed.play(RED).blockWith().settle().endTurn();
    destroyed.expectZoneSize(0, "board", 0);

    const survives = scenario({
      seats: [faiSeat({ board: ["fealty|0"], hand: [RONIN] }), { hero: "rhinar", hand: [] }],
    });
    survives.play(RONIN).blockWith().settle().endTurn();
    survives.expectZoneSize(0, "board", 1);
  });
});

describe("SFA — Draconic chain link thresholds", () => {
  it("Searing Emberblade attacks get go again with 2+ Draconic chain links", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle()
      // the Emberblade itself is Draconic — attacking with it is the 2nd link
      .attackWithWeapon(EMBERBLADE, { pitch: [BLUE] })
      .blockWith().settle()
      .expectAP(0, 1) // go again refunded
      .expectLife(1, 14); // 3 (Ronin) + 3 (Emberblade)
  });

  it("Searing Emberblade has no go again without 2 Draconic chain links", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(EMBERBLADE, { pitch: [BLUE] }).blockWith().settle().expectAP(0, 0);
  });

  it("Display Loyalty gets go again and creates a Fealty token at 2+ Draconic links", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, "display loyalty|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle()
      .play("display loyalty|1")
      .expectAttackValue(3)
      .blockWith().settle()
      .expectAP(0, 1) // go again refunded
      .expectInZone(0, "fealty|0", "board");
  });

  it("Cinderskin Devotion only gets go again at 2+ Draconic links", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, "cinderskin devotion|3", RED] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle()
      .play("cinderskin devotion|3", { pitch: [RED] })
      .blockWith().settle()
      .expectAP(0, 1);

    const noGo = scenario({
      seats: [faiSeat({ hand: ["cinderskin devotion|3", RED] }), { hero: "rhinar", hand: [] }],
    });
    noGo.play("cinderskin devotion|3", { pitch: [RED] }).blockWith().settle().expectAP(0, 0);
  });

  it("Phoenix Flame gets +1{p} at 2+ Draconic chain links", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, FLAME] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle().play(FLAME).expectAttackValue(1);
  });

  it("Hot on Their Heels marks the defending hero on hit at 2+ Draconic links", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, "hot on their heels|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle()
      .play("hot on their heels|1")
      .blockWith().settle()
      .expectAP(0, 1) // go again refunded
      .expectLog("is marked");
    expect(s.state.players[1]!.hero.counters?.marked).toBe(1);
  });

  it("Mark is removed after the marked hero is hit by an opponent", () => {
    const s = scenario({
      active: 1,
      seats: [faiSeat({ hand: [] }), { hero: "rhinar", hand: ["head jab|2"] }],
    });
    s.state.players[0]!.hero.counters = { marked: 1 };
    s.play("head jab|2").blockWith().settle();
    expect(s.state.players[0]!.hero.counters?.marked ?? 0).toBe(0);
  });
});

describe("SFA — Rupture and hits-this-chain", () => {
  it("Lava Burst has +3{p} as chain link 4 or higher", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, RONIN, RONIN, "lava burst|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle()
      .play(RONIN).blockWith().settle()
      .play(RONIN).blockWith().settle()
      .play("lava burst|1")
      .expectAttackValue(5); // 2 base + 3 Rupture
  });

  it("Lava Burst is a plain 2{p} below chain link 4", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["lava burst|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("lava burst|1").expectAttackValue(2);
  });

  it("Salt the Wound gets +1{p} per attack that has hit this combat chain", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, "salt the wound|2"] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle() // one hit
      .play("salt the wound|2")
      .expectAttackValue(3); // 2 base + 1 hit
  });

  it("Double Cross Strap gains {r} after 2+ hits this combat chain", () => {
    const s = scenario({
      seats: [
        faiSeat({ equipment: { ...NO_EQUIPMENT, chest: "double cross strap|0" }, hand: [RONIN, RONIN] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play(RONIN).blockWith().settle()
      .play(RONIN).blockWith().settle()
      .activate("double cross strap|0")
      .expectResources(0, 1)
      .expectNoEquipment(0, "chest");
  });
});

describe("SFA — banish-and-play on hit", () => {
  it("Mounting Anger banishes a cheaper attack that gains +1{p} and may be played", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["mounting anger|1", RONIN, RED] }), { hero: "rhinar", hand: [] }],
    });
    s.play("mounting anger|1", { pitch: [RED] })
      .blockWith().settle() // hits for 4 — the banish choice opens
      .chooseCard(RONIN) // cost 0 < 1 Draconic link
      .expectInZone(0, RONIN, "banish");
    expect(projectStateFor(s.state, 1).logEntries).toContainEqual(expect.objectContaining({
      message: {
        id: "card.log.sfa.banished.power",
        values: {
          amount: 1,
          result: { kind: "card", cardId: printingId(RONIN) },
          card: { kind: "card", cardId: printingId("mounting anger|1") },
        },
      },
      event: expect.objectContaining({
        kind: "card-moved",
        cardId: printingId(RONIN),
        from: "hand",
        to: "banish",
      }),
    }));
    playFromZone(s, RONIN, "banish");
    s.expectAttackValue(4); // 3 base + the +1{p} counter
  });

  it("Rising Resentment banishes a cheaper attack that costs {r} less to play", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: [RONIN, "rising resentment|1", "art of the dragon: fire|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play(RONIN).blockWith().settle()
      .play("rising resentment|1")
      .blockWith().settle() // hits — 2 Draconic links, so cost-1 cards qualify
      .chooseCard("art of the dragon: fire|1")
      .expectInZone(0, "art of the dragon: fire|1", "banish");
    // cost 1 − {r} = free
    playFromZone(s, "art of the dragon: fire|1", "banish");
    s.expectAttackValue(5);
  });
});

describe("SFA — Crouching Tiger package", () => {
  it("Pouncing Paws creates a playable Crouching Tiger in the banished zone; Blood Scent unlocks", () => {
    const s = scenario({
      seats: [
        faiSeat({
          equipment: { ...NO_EQUIPMENT, chest: "blood scent|0", legs: "pouncing paws|0" },
          hand: [],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    // Blood Scent is locked before any Crouching Tiger attack
    expect(
      legalIntents(s.state, 0).filter(
        (i) =>
          i.kind === "activate-ability" &&
          i.sourceInstanceId === s.state.players[0]!.equipment.chest?.instanceId,
      ),
    ).toHaveLength(0);
    s.activate("pouncing paws|0")
      .expectInZone(0, "crouching tiger|0", "banish")
      .expectNoEquipment(0, "legs");
    playFromZone(s, "crouching tiger|0", "banish");
    s.settle() // pass the attack-declared window (Blood Scent is live now)
      .expectAttackValue(0).blockWith().settle()
      .activate("blood scent|0")
      .expectResources(0, 1);
    // Ephemeral: the Tiger ceases to exist when the chain closes
    s.doRaw({ kind: "close-chain" });
    s.expectNotInZone(0, "crouching tiger|0", "graveyard")
      .expectLog("ceases to exist (Ephemeral)");
  });

  it("Tearing Shuko gives the next Crouching Tiger +2{p}", () => {
    const s = scenario({
      seats: [
        faiSeat({
          equipment: { ...NO_EQUIPMENT, arms: "tearing shuko|0", legs: "pouncing paws|0" },
          hand: [],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate("tearing shuko|0").activate("pouncing paws|0");
    playFromZone(s, "crouching tiger|0", "banish");
    s.expectAttackValue(2);
  });
});

describe("SFA — Mask of the Swarming Claw", () => {
  it("Spellvoid X prevents arcane damage equal to the chain links you control", () => {
    const s = scenario({
      seats: [
        faiSeat({ equipment: { ...NO_EQUIPMENT, head: "mask of the swarming claw|0" }, hand: [RONIN] }),
        { hero: "rhinar", hand: ["burn up // shock|1"] },
      ],
    });
    s.play(RONIN) // 1 chain link controlled while the attack is open
      .blockWith()
      .passPriority() // defender's reaction window
      .react("burn up // shock|1", { meldSide: "right", settle: false })
      .passPriority()
      .passPriority(); // Shock resolves and deals 1 arcane damage
    expect(
      s.state.pendingDecision?.chooseHook,
      JSON.stringify({
        life: s.state.players.map((player) => player.life),
        chain: s.state.chain.map((link) => ({ attacker: link.attacker, resolved: link.resolved })),
        stack: s.state.stack,
        pending: s.state.pendingDecision,
        log: s.state.log.slice(-5),
      }),
    ).toBe("spellvoid");
    s.chooseOption("destroy") // Spellvoid 1: destroy the Mask to prevent it
      .expectLife(0, 20) // fully prevented
      .expectNoEquipment(0, "head")
      .expectLife(1, 17); // the Ronin hit still landed
  });
});

describe("SFA — defense", () => {
  it("Wax On gains +2{d} while defending a 0-cost attack action", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN] }), { hero: "rhinar", hand: ["wax on|1"] }],
    });
    s.play(RONIN).blockWith().passPriority().react("wax on|1")
      .expectFinalDefense(5) // 3 + 2
      .expectLife(1, 20);
  });

  it("Wax On is a plain 3{d} against an attack with cost 1+", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["mounting anger|1", BLUE] }), { hero: "rhinar", hand: ["wax on|1"] }],
    });
    s.play("mounting anger|1", { pitch: [BLUE] })
      .blockWith()
      .passPriority()
      .react("wax on|1") // 4 − 3 = 1 through
      .expectFinalDefense(3)
      .expectLife(1, 19);
  });

  it("Nip at the Heels pumps an attack with 3 or less base {p}", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, "nip at the heels|3"] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().react("nip at the heels|3").settle()
      .expectFinalAttack(4)
      .expectLife(1, 16);
  });

  it("Nip at the Heels cannot target an attack with 4+ base {p}", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: ["art of the dragon: fire|1", "nip at the heels|3", RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("art of the dragon: fire|1", { pitch: [RED] }).blockWith();
    const nipId = printingId("nip at the heels|3");
    const plays = legalIntents(s.state, 0).filter(
      (i) => i.kind === "play-card" && i.instanceId ===
        s.state.players[0]!.hand.find((c) => c.cardId === nipId)?.instanceId,
    );
    expect(plays).toHaveLength(0);
    s.settle().expectFinalAttack(5);
  });
});

describe("SFA — Phoenix Flame support", () => {
  it("Fire that Burns Within waits for its attack-layer to resolve before triggering", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: ["fire that burns within|1", FLAME, BLUE] }),
        { hero: "rhinar", hand: ["sigil of solace|1"] },
      ],
    });

    s.play("fire that burns within|1", { pitch: [BLUE], settle: false });

    expect(s.state.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    expect(s.state.pendingDecision?.chooseHook).toBeUndefined();
    expect(projectStateFor(s.state, 0).chain.at(-1)?.onStack).toBe(true);
    expect(projectStateFor(s.state, 0).stackContext).toBe("LAYER STEP · ATTACK");

    s.passPriority().passPriority();

    expect(s.state.pendingDecision).toMatchObject({ chooseHook: "fire-that-burns", player: 0 });
    expect(projectStateFor(s.state, 0).chain.at(-1)?.onStack).toBeUndefined();
    expect(projectStateFor(s.state, 0).stackContext).toBe("ATTACK STEP · TRIGGERS");
  });

  it("Fire that Burns Within: discard a Phoenix Flame to draw and get +2{p}", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["fire that burns within|1", FLAME, BLUE], deck: [BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.play("fire that burns within|1", { pitch: [BLUE] })
      .chooseCard(FLAME) // discard the flame
      .expectAttackValue(4) // 2 base + 2
      .expectInZone(0, BLUE, "hand") // drew a card
      .expectInZone(0, FLAME, "graveyard");
  });

  it("Fire that Burns Within without the discard is a plain 2{p}", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["fire that burns within|1", FLAME, BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.play("fire that burns within|1", { pitch: [BLUE] })
      .chooseOption("pass")
      .expectAttackValue(2);
  });

  it("Flamecall Awakening searches a Phoenix Flame after another red card", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: [RONIN, "flamecall awakening|1", RED], deck: [FLAME, BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play(RONIN).blockWith().settle()
      .play("flamecall awakening|1", { pitch: [RED] })
      .chooseCard(FLAME) // searched, revealed, into hand; deck shuffled
      .expectInZone(0, FLAME, "hand")
      .expectAttackValue(3);
  });

  it("Rise from the Ashes pumps the next Draconic/Ninja attack and returns a Phoenix Flame", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["rise from the ashes|1", RONIN], graveyard: [FLAME] }), { hero: "rhinar", hand: [] }],
    });
    s.play("rise from the ashes|1")
      .chooseCard(FLAME) // returned from the graveyard
      .expectInZone(0, FLAME, "hand")
      .play(RONIN)
      .expectAttackValue(6); // 3 base + 3
  });

  it("Art of the Dragon: Fire deals 2 damage to any target when Draconic", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: ["brand with cinderclaw|1", "art of the dragon: fire|1", RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("brand with cinderclaw|1").blockWith().settle()
      .play("art of the dragon: fire|1", { pitch: [RED] })
      .chooseCard("rhinar|0") // deal 2 to the opposing hero
      .expectLife(1, 15) // 20 − 3 (Brand's hit) − 2
      .expectAttackValue(5);
  });

  it("Art of the Dragon: Fire can target an opposing ally", () => {
    const s = scenario({
      seats: [
        faiSeat({ hand: ["brand with cinderclaw|1", "art of the dragon: fire|1", RED] }),
        { hero: "rhinar", hand: [], board: ["barnacle|2", "limpit, hop-a-long|2"] },
      ],
    });
    s.play("brand with cinderclaw|1").blockWith().settle()
      .play("art of the dragon: fire|1", { pitch: [RED] })
      .chooseCard("limpit, hop-a-long|2") // 2 damage to the 1-life ally → destroyed
      .expectLife(1, 17) // only Brand's hit landed — the hero took no effect damage
      .expectNotInZone(1, "limpit, hop-a-long|2", "board")
      .expectInZone(1, "limpit, hop-a-long|2", "graveyard");
    // the other ally is untouched and still alive
    const barnacle = s.state.players[1]!.board.find((c) => c.cardId === printingId("barnacle|2"));
    expect(barnacle?.life).toBe(3);
  });

  it("Fire Tenet: Strike First pumps the next Draconic attack by +1{p}", () => {
    const s = scenario({
      seats: [faiSeat({ hand: ["fire tenet: strike first|1", RONIN] }), { hero: "rhinar", hand: [] }],
    });
    s.play("fire tenet: strike first|1").blockWith().settle()
      .play(RONIN)
      .expectAttackValue(4); // 3 base + 1
  });

  it("Blaze Headlong gets go again only after another red card", () => {
    const s = scenario({
      seats: [faiSeat({ hand: [RONIN, "blaze headlong|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play(RONIN).blockWith().settle()
      .play("blaze headlong|1")
      .blockWith().settle()
      .expectAP(0, 1);

    const noGo = scenario({
      seats: [faiSeat({ hand: ["blaze headlong|1"] }), { hero: "rhinar", hand: [] }],
    });
    noGo.play("blaze headlong|1").blockWith().settle().expectAP(0, 0);
  });
});
