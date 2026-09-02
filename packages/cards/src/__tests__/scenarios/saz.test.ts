/**
 * SAZ (Silver Age: Azalea precon, Chapter 2) scenario tests — Azalea's hero
 * ability (with dominate grant), Death Dealer / Bull's Eye Bracers arrow
 * loading, Crow's Nest aim counters, Bolt'n Boots' reaction go again, the
 * arrow triggers (Dry Powder / Entangling / Ridge Rider / Spire Sniping /
 * Swift Shot), aim-counter conditionals (Drill Shot piercing, Infecting
 * Shot, Murkmire Grapnel), Bolt'n' Shot's above-base rider, Widowmaker, the
 * next-arrow pumps (Call in the Big Guns / Drop the Anchor / the Laces /
 * Read the Glide Path / Release the Tension / Scout the Periphery / Take
 * Aim), Memorial Ground, and the Bloodrot Pox / Frailty / Inertia tokens.
 *
 * Driving notes: arrows live in the arsenal (`play(key, { fromArsenal: true })`);
 * Death Dealer / Bull's Eye Bracers move them there from hand through a
 * scripted choice. Azalea's seat uses the dorinthea decklist as a base with
 * hero/weapons/equipment overridden. Aim counters are stamped directly in
 * setup (setup is the one place state is touched).
 */
import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { cardData } from "../../index.js";
import { printingId, scenario } from "../harness.js";

const AZALEA = "azalea|0";
const DEATH_DEALER = "death dealer|0";
const RONIN_FREE = "ravenous rabble|1"; // generic red 5{p} cost 0, go again
const BLUE = "wrecker romp|3"; // blue pitch fodder
const RED = "snatch|1"; // red pitch fodder

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function azaleaSeat(extra: Record<string, unknown> = {}) {
  return {
    hero: "dorinthea" as const,
    heroKey: AZALEA,
    weapons: [DEATH_DEALER],
    equipment: { ...NO_EQUIPMENT },
    ...extra,
  };
}

describe("SAZ — Azalea", () => {
  it("hero ability bottoms the arsenal card and loads the deck top, arrows gain dominate", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: [RONIN_FREE], deck: ["swift shot|1", BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(AZALEA)
      .expectAP(0, 1) // go again
      .expectDeckBottom(0, RONIN_FREE)
      .expectInZone(0, "swift shot|1", "arsenal")
      .expectLog("gains dominate until end of turn");
    const swift = s.state.players[0]!.arsenal[0]!;
    // dominate from Azalea, go again from Swift Shot's own arsenal trigger
    expect(swift.grantedKeywords ?? []).toEqual(expect.arrayContaining(["dominate", "go again"]));
    const ownerLog = projectStateFor(s.state, 0).logEntries ?? [];
    const opponentLog = projectStateFor(s.state, 1).logEntries ?? [];
    expect(ownerLog).toContainEqual(expect.objectContaining({
      message: {
        id: "card.log.saz.azalea.bottom.private",
        values: {
          result: { kind: "card", cardId: printingId(RONIN_FREE) },
          card: { kind: "card", cardId: printingId(AZALEA) },
        },
      },
      event: expect.objectContaining({ cardId: printingId(RONIN_FREE), from: "arsenal", to: "deck" }),
    }));
    const publicBottom = opponentLog.find(
      (entry) => "message" in entry && entry.message.id === "card.log.saz.azalea.bottom.public",
    );
    expect(publicBottom).toMatchObject({
      event: { kind: "card-moved", ownerSeat: 0, from: "arsenal", to: "deck" },
    });
    expect(JSON.stringify(publicBottom)).not.toContain(printingId(RONIN_FREE));
  });

  it("hero ability grants no dominate to a non-arrow", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: [RONIN_FREE], deck: [RED, BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(AZALEA).expectInZone(0, RED, "arsenal");
    expect(s.state.players[0]!.arsenal[0]!.grantedKeywords).toBeUndefined();
  });

  it("Swift Shot has go again from the arsenal grant", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: [RONIN_FREE], deck: ["swift shot|1", BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(AZALEA)
      .play("swift shot|1", { fromArsenal: true })
      .expectAttackValue(4)
      .blockWith().settle()
      .expectAP(0, 1); // go again refunded
  });

  it("an arrow in hand cannot be played", () => {
    const s = scenario({
      seats: [azaleaSeat({ hand: ["searing shot|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.expectNoLegalPlay("searing shot|1");
  });
});

describe("SAZ — loading the arsenal", () => {
  it("Death Dealer puts an arrow from hand into the arsenal and draws", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["bolt'n' shot|1", RED], deck: [BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(DEATH_DEALER, { pitch: [RED] })
      .chooseCard("bolt'n' shot|1")
      .expectInZone(0, "bolt'n' shot|1", "arsenal")
      .expectInZone(0, BLUE, "hand") // drew a card
      .expectAP(0, 1); // go again
  });

  it("Bull's Eye Bracers loads an arrow with +1{p} this turn", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          equipment: { ...NO_EQUIPMENT, arms: "bull's eye bracers|0" },
          hand: ["searing shot|1"],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate("bull's eye bracers|0")
      .chooseCard("searing shot|1")
      .expectNoEquipment(0, "arms")
      .expectInZone(0, "searing shot|1", "arsenal")
      .expectAP(0, 1) // go again
      .play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(5); // 4 base + 1
  });

  it("Crow's Nest pays {r} for an aim counter on a deck-loaded arrow", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          weapons: [DEATH_DEALER, "crow's nest|0"],
          arsenal: [RONIN_FREE],
          deck: ["drill shot|1", BLUE],
          resources: 1,
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(AZALEA) // loads Drill Shot from the deck → Crow's Nest offers {r}
      .chooseOption("pay 1")
      .expectResources(0, 0)
      .expectLog("aim counter");
    expect(s.state.players[0]!.arsenal[0]!.counters?.aim).toBe(1);
  });

  it("Dry Powder Shot gets +2{p} when loaded", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["dry powder shot|1", RED], deck: [BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(DEATH_DEALER, { pitch: [RED] })
      .chooseCard("dry powder shot|1")
      .play("dry powder shot|1", { fromArsenal: true })
      .expectAttackValue(5); // 3 base + 2
  });

  it("Entangling Shot taps target hero when loaded", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["entangling shot|1", RED], deck: [BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(DEATH_DEALER, { pitch: [RED] })
      .chooseCard("entangling shot|1") // the arrow to load
      .chooseCard("rhinar|0"); // the hero to tap
    expect(s.state.players[1]!.hero.tapped).toBe(true);
  });

  it("Ridge Rider Shot opts when loaded", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["ridge rider shot|1", RED], deck: [RONIN_FREE, BLUE, RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(DEATH_DEALER, { pitch: [RED] })
      .chooseCard("ridge rider shot|1") // load + draw (Ravenous Rabble)
      .chooseOption("bottom") // opt 1: Wrecker Romp to the bottom
      .expectDeckTop(0, RED);
  });

  it("Spire Sniping looks at and reorders the top 2 when loaded", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["spire sniping|2", RED], deck: [RONIN_FREE, BLUE, RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.activate(DEATH_DEALER, { pitch: [RED] })
      .chooseCard("spire sniping|2"); // load + draw (Ravenous Rabble)
    // the looked cards fold into the reorder choice as context images …
    const top2 = s.state.players[0]!.deck.slice(0, 2).map((card) => card.instanceId);
    expect(s.state.pendingDecision?.chooseHook).toBe("spire-sniping");
    expect(s.state.pendingDecision?.lookedCardIds).toEqual(top2);
    const ownView = projectStateFor(s.state, 0);
    expect(ownView.pendingDecision?.lookedCards).toHaveLength(2);
    expect(projectStateFor(s.state, 1).pendingDecision?.lookedCards).toBeUndefined();
    // … and the private log names them for the looking player only
    for (const key of [BLUE, RED]) {
      const name = cardData[printingId(key)]!.name;
      expect(ownView.log.some((line) => line.includes(`You look at ${name}`))).toBe(true);
    }
    s.chooseOption("swap") // top two: Wrecker Romp / Snatch → swapped
      .expectDeckTop(0, RED);
  });
});

describe("SAZ — arrows", () => {
  it("Bolt'n' Shot has go again and reloads on hit while above its base {p}", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["take aim|1", RED, BLUE], arsenal: ["bolt'n' shot|1"], deck: [BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("take aim|1") // +3 to the next Ranger attack action (no reload — arsenal full)
      .play("bolt'n' shot|1", { fromArsenal: true })
      .expectAttackValue(7) // 4 base + 3
      .blockWith().settle() // hits for 7 → reload choice
      .chooseCard(BLUE) // reload the blue into the arsenal
      .expectInZone(0, BLUE, "arsenal")
      .expectAP(0, 1); // go again refunded
  });

  it("Bolt'n' Shot at its base {p} has no go again", () => {
    const s = scenario({
      seats: [azaleaSeat({ arsenal: ["bolt'n' shot|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("bolt'n' shot|1", { fromArsenal: true })
      .expectAttackValue(4)
      .blockWith().settle()
      .expectAP(0, 0);
  });

  it("Bolt'n Boots give an above-base arrow attack go again for {r}", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          equipment: { ...NO_EQUIPMENT, legs: "bolt'n boots|0" },
          hand: ["take aim|1", RED],
          arsenal: ["drill shot|1"],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("take aim|1") // +3 to the next Ranger attack action (no reload — arsenal full)
      .play("drill shot|1", { fromArsenal: true })
      .expectAttackValue(7) // 4 base + 3
      .blockWith()
      .activate("bolt'n boots|0", { pitch: [RED] }) // in the attack-reaction window
      .chooseCard("bone vizier|0") // Drill Shot's on-hit -1{d} counter
      .expectNoEquipment(0, "legs")
      .expectAP(0, 1); // go again refunded
  });

  it("Drill Shot with an aim counter has piercing 1 and counters equipment on hit", () => {
    const s = scenario({
      seats: [azaleaSeat({ arsenal: ["drill shot|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.state.players[0]!.arsenal[0]!.counters = { aim: 1 }; // setup stamp
    s.play("drill shot|1", { fromArsenal: true })
      .blockWith("bone vizier|0") // equipment defense → piercing +1
      .settle()
      .chooseCard("ironhide legs|0") // the on-hit -1{d} counter
      .expectFinalAttack(5) // 4 base + 1 piercing
      .expectLife(1, 16); // 5 − 1
    expect(s.state.players[1]!.equipment.legs?.defCounters).toBe(1);
  });

  it.each([
    ["drill shot|2", 4],
    ["drill shot|3", 3],
  ] as const)("%s gains piercing 1 from its aim counter", (shot, expectedAttack) => {
    const s = scenario({
      seats: [azaleaSeat({ arsenal: [shot] }), { hero: "rhinar", hand: [] }],
    });
    s.state.players[0]!.arsenal[0]!.counters = { aim: 1 };
    s.play(shot, { fromArsenal: true })
      .blockWith("bone vizier|0")
      .expectAttackValue(expectedAttack);
  });

  it("Infecting Shot creates a Bloodrot Pox under the hit hero's control", () => {
    const s = scenario({
      seats: [azaleaSeat({ arsenal: ["infecting shot|1"], hand: [RED] }), { hero: "rhinar", hand: [] }],
    });
    s.play("infecting shot|1", { fromArsenal: true, pitch: [RED] }) // cost 1
      .expectAttackValue(5) // no aim counter
      .blockWith().settle()
      .expectLife(1, 15)
      .expectInZone(1, "bloodrot pox|0", "board");
  });

  it("Murkmire Grapnel with an aim counter gets +1{p}", () => {
    const s = scenario({
      seats: [azaleaSeat({ arsenal: ["murkmire grapnel|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.state.players[0]!.arsenal[0]!.counters = { aim: 1 }; // setup stamp
    s.play("murkmire grapnel|1", { fromArsenal: true }).expectAttackValue(5);
  });

  it("Searing Shot's hit makes the hero lose 1{h}", () => {
    const s = scenario({
      seats: [azaleaSeat({ arsenal: ["searing shot|1"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("searing shot|1", { fromArsenal: true })
      .blockWith().settle()
      .expectLife(1, 15) // 4 damage + 1 life loss
      .expectLog("loses 1 life");
  });

  it("Widowmaker bans defense reactions and gets +3{p} against fewer than 2 defenders", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ arsenal: ["widowmaker|2"], hand: [RED] }),
        { hero: "rhinar", hand: ["wax on|1"] },
      ],
    });
    s.play("widowmaker|2", { fromArsenal: true, pitch: [RED] }) // cost 1
      .expectAttackValue(6) // 3 base + 3
      .blockWith()
      .passPriority(); // defender's reaction window
    const waxId = s.state.players[1]!.hand.find((c) => c.cardId === printingId("wax on|1"))!;
    expect(
      legalIntents(s.state, 1).some((i) => i.kind === "play-card" && i.instanceId === waxId.instanceId),
    ).toBe(false);
    s.settle().expectLife(1, 14);
  });
});

describe("SAZ — next-arrow pumps", () => {
  it("Call in the Big Guns loads an arrow and pumps it by +3", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["call in the big guns|1", "searing shot|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("call in the big guns|1") // go again
      .chooseCard("searing shot|1") // load it
      .expectInZone(0, "searing shot|1", "arsenal")
      .play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(7); // 4 base + 3
  });

  it("Drop the Anchor taps the hit hero and their allies", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["drop the anchor|1"], arsenal: ["searing shot|1"] }),
        { hero: "rhinar", hand: [], board: ["barnacle|2"] },
      ],
    });
    s.play("drop the anchor|1")
      .play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(7)
      .blockWith().settle()
      .expectLife(1, 12); // 7 damage + 1 life loss
    expect(s.state.players[1]!.hero.tapped).toBe(true);
    const barnacle = s.state.players[1]!.board.find((c) => c.cardId === printingId("barnacle|2"))!;
    expect(barnacle.tapped).toBe(true);
  });

  it("Lace with Bloodrot creates the token under the hit hero's control", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["lace with bloodrot|1"], arsenal: ["searing shot|1"] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("lace with bloodrot|1")
      .play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(7)
      .blockWith().settle()
      .expectInZone(1, "bloodrot pox|0", "board");
  });

  it("Read the Glide Path pumps the next arrow and opts", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["read the glide path|1"], arsenal: ["searing shot|1"], deck: [BLUE, RED] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("read the glide path|1")
      .chooseOption("bottom") // opt 1: blue to the bottom
      .expectDeckTop(0, RED)
      .play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(7); // 4 base + 3
  });

  it("Release the Tension bans defense reactions from arsenal on the arrow's link", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["release the tension|1"], arsenal: ["searing shot|1"] }),
        { hero: "rhinar", hand: ["wax on|1"], arsenal: ["wax on|1"] },
      ],
    });
    s.play("release the tension|1")
      .play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(7)
      .blockWith()
      .passPriority(); // defender's reaction window
    const p1 = s.state.players[1]!;
    const handWax = p1.hand.find((c) => c.cardId === printingId("wax on|1"))!;
    const arsenalWax = p1.arsenal.find((c) => c.cardId === printingId("wax on|1"))!;
    const legal = legalIntents(s.state, 1);
    expect(legal.some((i) => i.kind === "play-card" && i.instanceId === handWax.instanceId)).toBe(true);
    expect(
      legal.some((i) => i.kind === "play-from-arsenal" && i.instanceId === arsenalWax.instanceId),
    ).toBe(false);
    s.settle().expectLife(1, 12); // 7 damage + 1 life loss
  });

  it("Scout the Periphery looks at a deck top and pumps the next attack from arsenal", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["scout the periphery|1"], arsenal: ["searing shot|1"] }),
        { hero: "rhinar", hand: [], deck: [BLUE, RED] },
      ],
    });
    s.play("scout the periphery|1")
      .chooseCard("rhinar|0") // look at the top of Rhinar's deck
      .play("searing shot|1", { fromArsenal: true })
      .expectAttackValue(7); // 4 base + 3 (from arsenal)
    // the looked-at card is logged privately to the looking player only
    const top = s.state.players[1]!.deck[0]!;
    const topName = cardData[top.cardId]!.name;
    expect(
      projectStateFor(s.state, 0).log.some((line) => line.includes(`You look at ${topName}`)),
    ).toBe(true);
    expect(projectStateFor(s.state, 1).log.some((line) => line.includes(topName))).toBe(false);
  });

  it("Take Aim reloads a card into the arsenal", () => {
    const s = scenario({
      seats: [azaleaSeat({ hand: ["take aim|1", BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.play("take aim|1")
      .chooseCard(BLUE) // reload it
      .expectInZone(0, BLUE, "arsenal");
    expect(s.state.players[0]!.arsenal[0]!.faceDown).toBe(true);
  });
});

describe("SAZ — Memorial Ground", () => {
  it("puts an attack action with cost 1 or less from the graveyard on deck top", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["memorial ground|2"], graveyard: ["bolt'n' shot|1"], deck: [BLUE] }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.play("memorial ground|2")
      .chooseCard("bolt'n' shot|1")
      .expectDeckTop(0, "bolt'n' shot|1");
  });

  it("is unplayable without a legal target in the graveyard", () => {
    const s = scenario({
      seats: [azaleaSeat({ hand: ["memorial ground|2"], graveyard: [BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.expectNoLegalPlay("memorial ground|2");
  });
});

describe("SAZ — tokens", () => {
  it("Bloodrot Pox deals 2 to its controller at their end phase when they can't pay", () => {
    const s = scenario({
      seats: [azaleaSeat({ board: ["bloodrot pox|0"], hand: [] }), { hero: "rhinar", hand: [] }],
    });
    s.endTurn(); // no floating resources: no choice, just destroy + 2 damage
    s.expectLife(0, 18).expectZoneSize(0, "board", 0);
  });

  it("Bloodrot Pox can be paid off with {r}{r}{r}", () => {
    const s = scenario({
      seats: [azaleaSeat({ board: ["bloodrot pox|0"], hand: [], resources: 3 }), { hero: "rhinar", hand: [] }],
    });
    s.settle();
    s.doRaw({ kind: "pass" }); // action phase → end phase; the trigger opens the choice
    expect(s.state.pendingDecision?.kind).not.toBe("priority-window");
    s.chooseOption("pay 3");
    s.expectTurn(2).expectLife(0, 20).expectZoneSize(0, "board", 0).expectLog("paid");
  });

  it("Frailty gives its controller's weapon attacks -1{p} until it dies", () => {
    const s = scenario({
      seats: [
        azaleaSeat({ hand: ["lace with frailty|1"], arsenal: ["searing shot|1"] }),
        { hero: "rhinar", hand: [BLUE] },
      ],
    });
    s.play("lace with frailty|1")
      .play("searing shot|1", { fromArsenal: true })
      .blockWith().settle()
      .expectInZone(1, "frailty|0", "board");
    s.endTurn(); // Rhinar's turn
    s.attackWithWeapon("bone basher|0", { pitch: [BLUE] })
      .expectAttackValue(3); // 4 base − 1 Frailty
    s.blockWith().settle(); // Azalea takes it
    s.endTurn(); // Rhinar's end phase: Frailty dies
    s.expectZoneSize(1, "board", 0);
  });

  it("Inertia bottoms its controller's hand and arsenal at their end phase", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          board: ["inertia|0"],
          hand: [RED],
          arsenal: ["searing shot|1"],
          deck: [BLUE, BLUE, BLUE, BLUE, BLUE, BLUE],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.settle();
    s.doRaw({ kind: "pass" }).chooseCard(RED)
      .expectZoneSize(0, "board", 0)
      .expectLog("put on the bottom of the deck")
      .expectDeckBottom(0, "searing shot|1") // arsenal cards bottom after hand cards
      .expectHandSize(0, 4); // the end-of-turn draw refills afterwards
  });

  it("journals Inertia bottoming before its same-intent draw-up", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          board: ["inertia|0"],
          hand: [RED],
          deck: [BLUE, BLUE, BLUE, BLUE, BLUE, BLUE],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.doRaw({ kind: "pass" });
    expect(s.lastEvents.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: { kind: "board", seat: 0 }, to: null },
      { from: { kind: "hand", seat: 0 }, to: { kind: "deck", seat: 0, position: "bottom" } },
      ...Array.from({ length: 4 }, () => ({
        from: { kind: "deck", seat: 0, position: "top" },
        to: { kind: "hand", seat: 0 },
      })),
    ]);
  });

  it("Inertia's controller chooses the relative bottom order", () => {
    const s = scenario({
      seats: [
        azaleaSeat({
          board: ["inertia|0"],
          hand: [RED, RONIN_FREE],
          arsenal: ["searing shot|1"],
          deck: [BLUE, BLUE, BLUE, BLUE, BLUE, BLUE],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });
    s.settle();
    s.doRaw({ kind: "pass" });
    const controllerDecision = projectStateFor(s.state, 0).pendingDecision;
    const opponentDecision = projectStateFor(s.state, 1).pendingDecision;
    expect(controllerDecision?.options).toHaveLength(3);
    expect(controllerDecision?.optionCards).toHaveLength(3);
    expect(opponentDecision?.prompt).toBe("");
    expect(opponentDecision?.options).toBeUndefined();
    expect(opponentDecision?.optionCards).toBeUndefined();

    s.chooseCard("searing shot|1")
      .chooseCard(RONIN_FREE)
      .expectDeckBottom(0, RED);
    expect(s.state.players[0]!.deck.slice(-3).map((card) => card.cardId)).toEqual([
      printingId("searing shot|1"),
      printingId(RONIN_FREE),
      printingId(RED),
    ]);
  });
});
