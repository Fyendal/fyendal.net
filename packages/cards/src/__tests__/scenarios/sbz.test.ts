/**
 * SBZ (Silver Age: Blaze, Firemind precon) scenario tests — opt, energy
 * counters, the "next arcane +N" pool, instant-speed actions, Amp, Surge.
 *
 * Driving notes: floating resources are wiped at end of turn, so cards played
 * after endTurn() pitch fodder instead; scripted choices that must NOT
 * auto-settle (because the test still wants to act in the window that follows)
 * are answered with doRaw.
 */
import { describe, expect, it } from "vitest";
import { legalIntents } from "@fyendal/engine";
import { scenario } from "../harness.js";

const BLAZE = "blaze, firemind|0";
const FODDER = "raging onslaught|3"; // vanilla blue, pitches for 3

describe("SBZ — opt & Whisper of the Oracle", () => {
  it("opt 4: the last Top choice becomes the top card", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["whisper of the oracle|1"],
          deck: ["voltic bolt|1", "snapback|1", "emeritus scolding|1", "look tuff|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("whisper of the oracle|1"); // stops at the first opt choice
    expect(s.state.pendingDecision?.prompt).toBe("Whisper of the Oracle: Opt 4");
    s.chooseOption("bottom"); // voltic bolt goes under
    expect(s.state.pendingDecision?.prompt).toBe("Whisper of the Oracle: Opt 4 · 3 left");
    s.chooseOption("top");
    s.chooseOption("top");
    s.chooseOption("top");
    s.expectDeckTop(0, "look tuff|1")
      .expectDeckBottom(0, "voltic bolt|1")
      .expectAP(0, 1) // go again refunded
      .expectInZone(0, "whisper of the oracle|1", "graveyard");
  });

  it("opt 4: per-card options assign any card top/bottom in any click order", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["whisper of the oracle|1"],
          deck: ["voltic bolt|1", "snapback|1", "emeritus scolding|1", "look tuff|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("whisper of the oracle|1"); // stops at the opt choice
    const [a, b, c, d] = s.state.players[0]!.deck.slice(0, 4).map((x) => x.instanceId);
    const pd = s.state.pendingDecision!;
    expect(pd.options).toContain(`bottom:${b}`);
    s.doRaw({ kind: "choose", optionId: `bottom:${b}` }); // snapback under, out of order
    s.doRaw({ kind: "choose", optionId: `top:${a}` });
    s.doRaw({ kind: "choose", optionId: `bottom:${c}` });
    s.doRaw({ kind: "choose", optionId: `top:${d}` });
    // The last Top choice is outermost on top; the last Bottom choice is
    // outermost on the bottom.
    expect(s.state.players[0]!.deck.map((card) => card.instanceId)).toEqual([d, a, b, c]);
  });

  it("opt: passing finishes the opt and keeps the remaining cards in place", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          hand: ["whisper of the oracle|1"],
          deck: ["voltic bolt|1", "snapback|1", "emeritus scolding|1", "look tuff|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("whisper of the oracle|1"); // stops at the first opt choice
    expect(s.state.pendingDecision?.options).toContain("pass");
    expect(s.state.pendingDecision?.defaultOption).toBe("pass");
    s.chooseOption("bottom"); // voltic bolt goes under
    expect(s.state.pendingDecision?.prompt).toBe("Whisper of the Oracle: Opt 4 · 3 left");
    s.doRaw({ kind: "choose", optionId: "pass" }); // keep the rest on top, in order
    expect(s.state.pendingDecision).toBeNull();
    s.expectDeckTop(0, "snapback|1")
      .expectDeckBottom(0, "voltic bolt|1")
      .expectAP(0, 1) // go again refunded
      .expectInZone(0, "whisper of the oracle|1", "graveyard");
  });
});

describe("SBZ — Blaze, Firemind", () => {
  it("gains energy counters equal to the number of cards looked at while opting", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["whisper of the oracle|1"],
          deck: ["voltic bolt|1", "snapback|1", "emeritus scolding|1", "look tuff|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("whisper of the oracle|1");
    s.chooseOption("top").chooseOption("top").chooseOption("top").chooseOption("top");
    expect(s.state.players[0]!.hero.counters?.energy).toBe(4);
  });

  it("removes X counters to let a matching Wizard action be played as an instant on the opponent's turn", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["whisper of the oracle|1", "emeritus scolding|1"],
          deck: ["voltic bolt|1", "snapback|1", "look tuff|1", "wounded bull|1"],
        },
        { hero: "dorinthea", hand: ["wounded bull|1", FODDER] },
      ],
    });
    // opt 4 → 4 energy counters
    s.play("whisper of the oracle|1");
    s.chooseOption("top").chooseOption("top").chooseOption("top").chooseOption("top");
    expect(s.state.players[0]!.hero.counters?.energy).toBe(4);
    s.endTurn();
    // Dorinthea attacks; the attack window opens (Blaze's instant ability is live)
    s.play("wounded bull|1", { settle: false });
    s.passPriority(); // Dorinthea yields the window to Blaze
    s.activate(BLAZE, { settle: false }); // ability rides the stack
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; the ability resolves
    s.chooseOption("4"); // remove 4 counters (settles into the banish choice)
    expect(s.state.players[0]!.hero.counters?.energy).toBe(0);
    // answer the banish choice without settling — Blaze still needs the window
    const emeritus = s.state.players[0]!.hand.find((c) => c.cardId === "SBZ015")!;
    s.doRaw({ kind: "choose", optionId: String(emeritus.instanceId) });
    expect(s.state.players[0]!.hand.some((c) => c.instanceId === emeritus.instanceId)).toBe(false);
    expect(s.state.players[0]!.banish.some((c) => c.instanceId === emeritus.instanceId)).toBe(true);
    // Blaze's ability resolved: the turn player gets priority first, then
    // passes to Blaze. Emeritus is now playable as an instant and deals 6.
    s.passPriority();
    s.react("emeritus scolding|1", { settle: false });
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; Emeritus resolves
    s.chooseOption("opposing hero");
    s.expectLife(1, 20 - 6);
    // the attack still resolves
    s.blockWith(); // no defense
    s.settle();
    s.expectLife(1, 20 - 6);
  });

  it("can choose Nucleus Aetherbolt by removing 1 energy counter", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["nucleus aetherbolt|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.state.players[0]!.hero.counters = { energy: 1 };

    s.activate(BLAZE).chooseOption("1").chooseCard("nucleus aetherbolt|1");

    expect(s.state.players[0]!.hero.counters.energy).toBe(0);
    s.expectInZone(0, "nucleus aetherbolt|1", "banish");
  });
});

describe("SBZ — the next-arcane +N pool", () => {
  it("Crucible of Aetherweave makes the next arcane card deal +1", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: ["crucible of aetherweave|0"],
          hand: ["voltic bolt|1"],
          resources: 3,
        },
        { hero: "dorinthea" },
      ],
    });
    s.activate("crucible of aetherweave|0", { pitch: [] });
    s.play("voltic bolt|1", { pitch: [] }); // stops at the target choice
    expect(s.state.pendingDecision?.prompt).toBe("Voltic Bolt: deal 6 arcane damage to which target?");
    s.chooseOption("opposing hero");
    s.expectLog("Voltic Bolt would deal 6 arcane damage to Dorinthea")
      .expectLife(1, 20 - 6); // 5 + 1
  });

  it("Amp applies to the next arcane damage event even from a card already pending", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["voltic bolt|1", "photon splicing|3"],
          resources: 2,
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("voltic bolt|1", { pitch: [], settle: false }); // window opens (Amp is live)
    s.activate("photon splicing|3", { settle: false }); // discard: Amp 1
    s.settle(); // Amp resolves, then Voltic Bolt — stops at its target choice
    expect(s.state.pendingDecision?.prompt).toBe("Voltic Bolt: deal 6 arcane damage to which target?");
    s.chooseOption("opposing hero");
    s.expectLog("Voltic Bolt would deal 6 arcane damage to Dorinthea")
      .expectLife(1, 20 - 6)
      .expectInZone(0, "photon splicing|3", "graveyard");
  });

  it("a next-card arcane bonus does not apply to a card already pending", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: ["crucible of aetherweave|0"],
          hand: ["voltic bolt|1"],
          resources: 4,
        },
        { hero: "dorinthea" },
      ],
    });

    s.play("voltic bolt|1", { pitch: [], settle: false })
      .activate("crucible of aetherweave|0", { pitch: [], settle: false })
      .settle()
      .chooseOption("opposing hero")
      .expectLife(1, 15);
    expect(s.state.players[0]!.flags.nextArcaneCardBonus).toBe(1);
  });

  it("a Wizard defense reaction does not satisfy Snapback's non-attack action condition", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["absorb in aether|1", "snapback|1", FODDER, FODDER],
        },
        { hero: "dorinthea", hand: ["wounded bull|1", FODDER] },
      ],
    });
    s.endTurn();
    s.play("wounded bull|1"); // 7{p} (Dorinthea is not behind on life)
    s.blockWith(); // no defense → reaction step, attacker first
    s.passPriority(); // Dorinthea yields the reaction window
    s.react("absorb in aether|1", { pitch: [FODDER], settle: false });
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; Absorb resolves as a defending card
    s.passPriority(); // Dorinthea yields the reopened reaction window
    const snapId = s.state.players[0]!.hand.find((card) => card.cardId.includes("SBZ"))?.instanceId;
    const canPlaySnap = legalIntents(s.state, 0).some(
      (intent) =>
        (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
        intent.instanceId === snapId,
    );
    expect(canPlaySnap).toBe(false);
  });

  it("Cindering Foresight on the opponent's turn sets the pool for an instant Snapback", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["cindering foresight|3", "snapback|1", FODDER],
          deck: ["voltic bolt|1", "look tuff|1"],
        },
        { hero: "dorinthea", hand: ["wounded bull|1", FODDER] },
      ],
    });
    s.endTurn();
    s.play("wounded bull|1", { settle: false }); // attack window
    s.passPriority(); // Dorinthea yields
    s.react("cindering foresight|3", { settle: false }); // cost 0, as an instant
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; Cindering resolves — stops at opt 1
    // keep the card, stay in the window flow (opt options are per-card "top:<id>")
    const topId = s.state.players[0]!.deck[0]!.instanceId;
    s.doRaw({ kind: "choose", optionId: `top:${topId}` });
    // Cindering resolved: the turn player gets priority first, then yields to Blaze.
    s.passPriority();
    s.react("snapback|1", { settle: false }); // a Wizard card was played this turn
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; Snapback resolves
    s.chooseOption("opposing hero");
    s.expectLife(1, 20 - 4); // 3 + 1
    s.blockWith(); // no defense against the incoming 7
    s.settle();
    s.expectLife(0, 17 - 7); // Wounded Bull checked life when it was played, before Snapback resolved
  });
});

describe("SBZ — instant-speed actions", () => {
  it("Snapback is playable as an instant after another Wizard card on your own turn", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["cindering foresight|1", "snapback|1"],
          resources: 1,
          deck: ["voltic bolt|1", "look tuff|1", "wounded bull|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("cindering foresight|1", { settle: false }); // stack window opens (Snapback is live)
    s.react("snapback|1", { pitch: [], settle: false });
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; Snapback resolves
    s.chooseOption("opposing hero");
    s.expectLife(1, 20 - 3);
    s.chooseOption("top"); // Cindering Foresight's opt 1 resolves after
    s.expectInZone(0, "snapback|1", "graveyard");
  });

  it("Snapback is NOT playable at instant speed without a Wizard card played first", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["snapback|1", FODDER],
        },
        { hero: "dorinthea", hand: ["wounded bull|1", FODDER] },
      ],
    });
    s.endTurn();
    s.play("wounded bull|1");
    s.blockWith(); // no defense → defense-reaction window for Blaze
    const snaps = legalIntents(s.state, 0).filter(
      (i) =>
        i.kind === "play-card" &&
        s.state.players[0]!.hand.some(
          (c) => c.instanceId === (i as { instanceId: number }).instanceId,
        ),
    );
    expect(snaps).toEqual([]);
    s.settle();
  });
});

describe("SBZ — Surge", () => {
  it("Aether Quickening gains go again when pumped above 2", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: ["crucible of aetherweave|0"],
          hand: ["aether quickening|3"],
          resources: 3,
        },
        { hero: "dorinthea" },
      ],
    });
    s.activate("crucible of aetherweave|0", { pitch: [] });
    s.play("aether quickening|3", { pitch: [] });
    s.chooseOption("opposing hero");
    s.expectLife(1, 20 - 3) // 2 + 1
      .expectAP(0, 1); // Surge: go again refunded the action point
  });

  it("Open the Flood Gates draws 2 when pumped above 1", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["open the flood gates|3", "arcane twining|3"],
          resources: 2,
          deck: ["voltic bolt|1", "look tuff|1", "wounded bull|1", "snapback|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.activate("arcane twining|3"); // discard: Amp 1 before the arcane card is played
    s.play("open the flood gates|3", { pitch: [], settle: false });
    s.settle();
    s.chooseOption("opposing hero");
    s.expectLife(1, 20 - 2) // 1 + 1
      .expectHandSize(0, 2); // Surge: drew 2
  });
});

describe("SBZ — Aether Spindle", () => {
  it("deals arcane to the opposing hero, then opts that many", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["aether spindle|1"],
          resources: 2,
          deck: ["voltic bolt|1", "snapback|1", "emeritus scolding|1", "look tuff|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("aether spindle|1", { pitch: [] }); // 4 arcane, then opt 4
    s.chooseOption("bottom"); // voltic bolt under
    s.chooseOption("top").chooseOption("top").chooseOption("top");
    s.expectLife(1, 20 - 4)
      .expectDeckTop(0, "look tuff|1")
      .expectDeckBottom(0, "voltic bolt|1");
    expect(s.state.players[0]!.hero.counters?.energy).toBe(4); // Blaze charged
  });
});

describe("SBZ — Turn to Mindfire & Ponder", () => {
  it("resolves Ponder without End Phase priority even while an instant is playable", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          board: ["ponder|0"],
          hand: ["sigil of solace|1"],
          deck: ["voltic bolt|1", "look tuff|1", "wounded bull|1", "snapback|1"],
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    s.doRaw({ kind: "pass" });
    s.expectNotInZone(0, "ponder|0", "board");
    expect(s.state.pendingDecision?.kind).not.toBe("priority-window");
    expect(s.lastEvents.slice(0, 2).map(({ from, to }) => ({ from, to }))).toEqual([
      { from: { kind: "board", seat: 0 }, to: null },
      { from: { kind: "deck", seat: 0, position: "top" }, to: { kind: "hand", seat: 0 } },
    ]);
  });

  it("creates a Ponder token when it deals damage and the hero taps; Ponder draws at end phase", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["turn to mindfire|1"],
          resources: 2,
          deck: ["voltic bolt|1", "look tuff|1", "wounded bull|1", "snapback|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("turn to mindfire|1", { pitch: [] });
    s.chooseOption("opposing hero"); // 5 arcane
    s.expectLife(1, 20 - 5);
    s.chooseOption("yes"); // tap the hero for a Ponder token
    s.expectZoneSize(0, "board", 1);
    expect(s.state.players[0]!.hero.tapped).toBe(true);
    s.endTurn();
    s.expectZoneSize(0, "board", 0) // Ponder destroyed at the end phase
      .expectLog("Ponder");
  });

  it("non-combat damage to an ally counts as damage dealt by its non-ally source", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["turn to mindfire|1"],
          resources: 2,
        },
        { hero: "dorinthea", board: ["barnacle|2"] },
      ],
    });
    s.play("turn to mindfire|1", { pitch: [] });
    s.chooseOption("ally");
    expect(s.state.players[0]!.flags.dealtDamageThisTurn).toBe(true);
    expect(s.state.players[0]!.flags.arcaneDamageDealtThisTurn).toBe(true);
    expect(s.state.players[0]!.flags.arcaneDamageDealtToOpposingHeroThisTurn).not.toBe(true);
    expect(s.state.players[1]!.flags.arcaneDamageTakenThisTurn).not.toBe(true);
  });
});

describe("SBZ — equipment", () => {
  it("Spellfire Cloak: only on an opponent's turn — destroy to gain {r}", () => {
    const own = scenario({
      seats: [
        { hero: "rhinar", heroKey: BLAZE, weapons: [], equipment: { chest: "spellfire cloak|0" } },
        { hero: "dorinthea" },
      ],
    });
    const acts = legalIntents(own.state, 0).filter((i) => i.kind === "activate-ability");
    expect(acts).toEqual([]); // not activatable on your own turn

    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: BLAZE, weapons: [], equipment: { chest: "spellfire cloak|0" } },
        { hero: "dorinthea", hand: ["wounded bull|1", FODDER] },
      ],
    });
    s.endTurn();
    s.play("wounded bull|1", { settle: false }); // attack window
    s.passPriority();
    s.activate("spellfire cloak|0", { settle: false }); // ability rides the stack
    s.settle(); // both pass; it resolves — destroy + gain {r}; attack proceeds
    s.expectNoEquipment(0, "chest").expectResources(0, 1);
    s.blockWith();
    s.settle();
  });

  it("Seeker's Mitts: destroy to prevent the next 1 damage and opt 1", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          equipment: { arms: "seeker's mitts|0" },
          hand: [FODDER],
          deck: ["voltic bolt|1", "look tuff|1", "snapback|1", "wounded bull|1", "emeritus scolding|1", "cindering foresight|1"],
        },
        { hero: "dorinthea", hand: ["wounded bull|1", FODDER] },
      ],
    });
    s.endTurn();
    s.play("wounded bull|1", { settle: false }); // 7{p} attack
    s.passPriority();
    s.activate("seeker's mitts|0", { pitch: [FODDER], settle: false }); // {r} + destroy
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; the ability resolves — stops at opt 1
    s.chooseOption("top");
    s.blockWith(); // no defense
    s.settle();
    s.expectNoEquipment(0, "arms")
      .expectLife(0, 17 - 6); // 7 - 1 prevented
    expect(s.state.players[0]!.hero.counters?.energy).toBe(1); // Blaze charged by the opt
  });

  it("Talismanic Lens: destroy to opt 2", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          equipment: { head: "talismanic lens|0" },
          hand: ["wounded bull|1", FODDER],
          deck: ["voltic bolt|1", "snapback|1", "look tuff|1"],
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("wounded bull|1", { settle: false }); // attack window opens (Lens is live)
    s.activate("talismanic lens|0", { settle: false });
    s.passPriority(); // Blaze passes
    s.passPriority(); // Dorinthea passes; the ability resolves — stops at opt 2
    s.chooseOption("bottom"); // voltic bolt under
    s.chooseOption("top");
    s.expectNoEquipment(0, "head").expectDeckBottom(0, "voltic bolt|1");
    s.blockWith(); // Dorinthea takes the attack
    s.settle();
  });
});

describe("SBZ — attacks", () => {
  it("Look Tuff: pay {r} or it gets -1{p}", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: BLAZE, weapons: [], hand: ["look tuff|1"], resources: 4 },
        { hero: "dorinthea" },
      ],
    });
    s.play("look tuff|1", { pitch: [], settle: false }); // 1 floating left → the choice is offered
    s.chooseOption("pay 1");
    s.expectAttackValue(8);
    s.blockWith();
    s.settle();
    s.expectLife(1, 20 - 8);
  });

  it("Look Tuff: without floating resources it automatically gets -1{p}", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", heroKey: BLAZE, weapons: [], hand: ["look tuff|1"], resources: 3 },
        { hero: "dorinthea" },
      ],
    });
    s.play("look tuff|1", { pitch: [], settle: false });
    s.expectAttackValue(7);
    s.blockWith();
    s.settle();
  });

  it("Fyendal's Fighting Spirit: gain 1{h} when attacking while behind on life", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["fyendal's fighting spirit|1"],
          resources: 3,
          life: 10,
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("fyendal's fighting spirit|1", { pitch: [], settle: false });
    s.expectLife(0, 11);
    s.blockWith();
    s.settle();
  });

  it("Emeritus Scolding deals its base 4 on your own turn", () => {
    const s = scenario({
      seats: [
        {
          hero: "rhinar",
          heroKey: BLAZE,
          weapons: [],
          hand: ["emeritus scolding|1"],
          resources: 2,
        },
        { hero: "dorinthea" },
      ],
    });
    s.play("emeritus scolding|1", { pitch: [] });
    s.chooseOption("opposing hero");
    s.expectLife(1, 20 - 4);
  });
});
