/**
 * SEN (Silver Age: Enigma precon) scenario tests — Enigma's chi ability and
 * Spectral Shield discount, Cosmo's aura attacks, the transcend instants,
 * phantasm (Chimera/Haze/Rider), ward (Spectral Shield, Waning Vengeance,
 * Uphold Tradition), cloaked equipment, Put in Context's defend restriction,
 * the created-a-card conditionals, Test of Strength's clash, Astral Etchings,
 * and Silent Stilettos.
 *
 * Driving notes: ward destructions are choose-target decisions ("destroy" /
 * "decline"); scripted yes/no choices (Silent Stilettos) are optional-effect.
 * Reaction-window plays use settle:false + passPriority like the SBL tests.
 * Aura attacks are activate-ability intents on the aura itself.
 */
import { describe, expect, it } from "vitest";
import { applyIntent, legalIntents, projectStateFor } from "@fyendal/engine";
import type { GameIntent } from "@fyendal/shared";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";
import { cardData } from "../../index.js";
import { functionalKeyOf } from "../../functional.js";

const ENIGMA = "enigma|0";
const COSMO = "cosmo, scroll of ancestral tapestry|0";
const SHIELD = "spectral shield|0";
const RED_7 = "raging onslaught|1"; // vanilla 7{p} attack action (phantasm popper)
const YELLOW = "raging onslaught|2"; // vanilla yellow pitch fodder
const BLUE = "wrecker romp|3"; // vanilla blue pitch fodder
const RED = "snatch|1"; // vanilla red, 4{p} cost 0

function enigmaSeat(extra: Record<string, unknown> = {}) {
  return { hero: "rhinar" as const, heroKey: ENIGMA, weapons: [COSMO], ...extra };
}

function boardCard(s: Scenario, seat: number, key: string) {
  const c = s.state.players[seat]!.board.find((x) => functionalKeyOf(cardData[x.cardId]!) === key);
  expect(c, `no "${key}" on seat ${seat}'s board`).toBeTruthy();
  return c!;
}

/** activate-ability intents (optionally on one source) for a seat. */
function abilityIntents(s: Scenario, seat: number, sourceInstanceId?: number) {
  return legalIntents(s.state, seat).filter(
    (i): i is Extract<GameIntent, { kind: "activate-ability" }> =>
      i.kind === "activate-ability" &&
      (sourceInstanceId === undefined || i.sourceInstanceId === sourceInstanceId),
  );
}

/** Defend intents for seat 1 that use both named hand cards together. */
function defendWithBoth(s: Scenario, keyA: string, keyB: string) {
  const hand = s.state.players[1]!.hand;
  const a = hand.find((c) => c.cardId === printingId(keyA))!;
  const b = hand.find((c) => c.cardId === printingId(keyB))!;
  const staged = applyIntent(s.state, 1, {
    kind: "stage-defenders",
    instanceIds: [a.instanceId, b.instanceId],
  });
  if (!staged.ok) return [];
  s.state = staged.state;
  return legalIntents(s.state, 1).filter(
    (i): i is Extract<GameIntent, { kind: "defend" }> =>
      i.kind === "defend" && i.instanceIds.includes(a.instanceId) && i.instanceIds.includes(b.instanceId),
  );
}

/** Pass reaction/priority windows until `seat` holds one. Windows with no
 *  possible response are skipped by the engine, so fixed pass counts don't
 *  work — walk to the window instead. */
function yieldToWindow(s: Scenario, seat: number): void {
  for (let i = 0; i < 12; i++) {
    const pd = s.state.pendingDecision;
    if (!pd) throw new Error(`no window for seat ${seat} — nothing pending`);
    if (pd.kind === "defend" || pd.kind === "choose-target" || pd.kind === "optional-effect") {
      throw new Error(`yieldToWindow hit a ${pd.kind} decision`);
    }
    if (pd.player === seat) return;
    s.passPriority();
  }
  throw new Error("yieldToWindow did not converge");
}

describe("SEN — Enigma", () => {
  it("chi ability: {c}{c}{c} creates a Spectral Shield with a +1{p} counter, once per turn", () => {
    const s = scenario({
      seats: [enigmaSeat({ hand: ["inner chi|3"] }), { hero: "dorinthea" }],
    });
    s.activate(ENIGMA, { pitch: ["inner chi|3"] }); // 3 chi in, 3 chi paid
    const shield = boardCard(s, 0, SHIELD);
    expect(shield.counters?.power).toBe(1);
    expect(s.state.players[0]!.chi).toBe(0);
    expect(s.state.players[0]!.resources).toBe(0);
    expect(s.state.players[0]!.actionPoints).toBe(1); // instant timing, no AP
    // once per turn: not offered again
    const hero = s.state.players[0]!.hero.instanceId;
    expect(abilityIntents(s, 0, hero)).toHaveLength(0);
  });

  it("discount: the first Spectral Shield attack each turn costs {r} less", () => {
    const s = scenario({
      seats: [
        enigmaSeat({ board: [SHIELD, SHIELD], hand: [RED] }),
        { hero: "dorinthea" },
      ],
    });
    const shieldIds = s.state
      .players[0]!.board.filter((c) => c.cardId === printingId(SHIELD))
      .map((c) => c.instanceId);
    // discounted to 0: an empty-pitch attack variant is offered
    const first = abilityIntents(s, 0).filter((i) => shieldIds.includes(i.sourceInstanceId));
    expect(first.some((i) => i.pitchInstanceIds.length === 0)).toBe(true);
    s.activate(SHIELD); // pickIntent prefers the free (discounted) attack
    s.expectAttackValue(1); // ward 1
    s.blockWith().settle();
    s.expectLife(1, 19).expectAP(0, 0); // no counter → no go again
    // the second Spectral Shield attack this turn is full price
    s.state.players[0]!.actionPoints = 1; // test setup tweak (engine-test precedent)
    const second = abilityIntents(s, 0).filter((i) => shieldIds.includes(i.sourceInstanceId));
    expect(second.length).toBeGreaterThan(0); // the other shield is still fresh
    expect(second.every((i) => i.pitchInstanceIds.length > 0)).toBe(true);
  });
});

describe("SEN — Cosmo aura attacks", () => {
  it("a ward aura attacks for its ward value, once per turn", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", weapons: [COSMO], board: [SHIELD], hand: [RED] },
        { hero: "dorinthea" },
      ],
    });
    const aura = boardCard(s, 0, SHIELD);
    s.activate(SHIELD, { pitch: [RED] });
    s.expectAttackValue(1);
    s.blockWith().settle();
    s.expectLife(1, 19).expectAP(0, 0); // no counter → no go again
    expect(boardCard(s, 0, SHIELD)).toBeTruthy(); // the aura stays in play
    // once per turn
    s.state.players[0]!.actionPoints = 1;
    expect(abilityIntents(s, 0, aura.instanceId)).toHaveLength(0);
  });

  it("an aura attack with a +1{p} counter gets go again", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", weapons: [COSMO], board: [SHIELD], hand: [RED] },
        { hero: "dorinthea" },
      ],
    });
    const aura = boardCard(s, 0, SHIELD);
    (aura.counters ??= {}).power = 1; // setup: as if Astral Etchings had put it there
    s.activate(SHIELD, { pitch: [RED] });
    s.expectAttackValue(2); // ward 1 + counter
    s.blockWith().settle();
    s.expectLife(1, 18).expectAP(0, 1); // go again refunded the action point
  });
});

describe("SEN — transcend", () => {
  it("a transcend instant with another blue played returns to hand flipped and pitches for chi", () => {
    const s = scenario({
      seats: [
        enigmaSeat({
          hand: ["spears of surreality|3", "homage to ancestors|3", "second tenet of chi: wind|3", "fluid motion|3"],
        }),
        { hero: "dorinthea" },
      ],
    });
    s.play("spears of surreality|3", { pitch: ["fluid motion|3"] }); // blue attack, native go again
    s.blockWith().settle();
    s.expectAP(0, 1);
    s.play("homage to ancestors|3"); // cost 0; resolves: +1{h}, then transcends
    s.expectLife(0, 21);
    s.expectInZone(0, "homage to ancestors|3", "hand");
    const flipped = s.state.players[0]!.hand.find((c) => c.cardId === printingId("homage to ancestors|3"))!;
    expect(flipped.flipped).toBe(true);
    s.expectNotInZone(0, "homage to ancestors|3", "graveyard");
    // the flipped card pitches as Inner Chi (3 chi) — here paying Second Tenet's cost
    s.play("second tenet of chi: wind|3", { pitch: ["homage to ancestors|3"] });
    expect(s.state.players[0]!.chi).toBe(0); // 3 chi in, 3 spent (chi before resources)
    const pitched = s.state.players[0]!.pitch.find((c) => c.cardId === printingId("homage to ancestors|3"))!;
    expect(pitched.flipped).toBeUndefined(); // leaving the hand reverts the flip
    s.blockWith().settle();
    s.expectFinalAttack(5).expectAP(0, 1); // transcended this turn → go again
  });

  it("no transcend without another blue card played this turn", () => {
    const s = scenario({
      seats: [enigmaSeat({ hand: ["homage to ancestors|3"] }), { hero: "dorinthea" }],
    });
    s.play("homage to ancestors|3");
    s.expectLife(0, 21);
    s.expectInZone(0, "homage to ancestors|3", "graveyard");
  });

  it("A Drop in the Ocean: target attack gets -1{p}; needs an attack on the chain", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["enigma chimera|1", YELLOW] },
        { hero: "dorinthea", hand: ["a drop in the ocean|3"] },
      ],
    });
    s.play("enigma chimera|1", { pitch: [YELLOW] }); // 8{p} — lands on the defend decision
    s.blockWith(); // take it — reaction step
    yieldToWindow(s, 1);
    s.react("a drop in the ocean|3"); // resolves: -1{p}, no second blue → no transcend
    s.expectFinalAttack(7);
    // a resolved instant rides the chain link until the chain closes
    s.doRaw({ kind: "close-chain" });
    s.expectInZone(1, "a drop in the ocean|3", "graveyard");

    const idle = scenario({
      seats: [enigmaSeat({ hand: ["a drop in the ocean|3"] }), { hero: "dorinthea" }],
    });
    idle.expectNoLegalPlay("a drop in the ocean|3");
  });

  it("Pass Over banishes a card from the opponent's graveyard", () => {
    const s = scenario({
      seats: [enigmaSeat({ hand: ["pass over|3"] }), { hero: "dorinthea", graveyard: [RED] }],
    });
    s.play("pass over|3"); // stops at the graveyard choice
    s.chooseCard(RED);
    s.expectInZone(1, RED, "banish");
    s.expectZoneSize(1, "graveyard", 0);

    const empty = scenario({
      seats: [enigmaSeat({ hand: ["pass over|3"] }), { hero: "dorinthea" }],
    });
    empty.expectNoLegalPlay("pass over|3");
  });

  it("Preserve Tradition puts an action card from your graveyard on the bottom of your deck", () => {
    const s = scenario({
      seats: [
        enigmaSeat({ hand: ["preserve tradition|3"], graveyard: [RED], deck: [YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("preserve tradition|3");
    s.chooseCard(RED);
    s.expectDeckBottom(0, RED);
    // only the resolved Preserve Tradition itself is left in the graveyard
    s.expectZoneSize(0, "graveyard", 1);
    s.expectInZone(0, "preserve tradition|3", "graveyard");

    const none = scenario({
      seats: [enigmaSeat({ hand: ["preserve tradition|3"] }), { hero: "dorinthea" }],
    });
    none.expectNoLegalPlay("preserve tradition|3");
  });

  it.each([
    { cardId: "SEN033", graveyardSeat: 1 },
    { cardId: "SEN034", graveyardSeat: 0 },
  ])("$cardId waits for its choice before transcending", ({ cardId, graveyardSeat }) => {
    const s = scenario({
      seats: [
        enigmaSeat({
          hand: ["homage to ancestors|3", cardId],
          ...(graveyardSeat === 0 ? { graveyard: [RED] } : {}),
        }),
        { hero: "dorinthea", ...(graveyardSeat === 1 ? { graveyard: [RED] } : {}) },
      ],
    });

    s.play("homage to ancestors|3"); // another blue was played, enabling transcend
    s.play(cardId);
    expect(s.state.stack[0]?.card?.cardId).toBe(cardId);
    expect(s.state.players[0]!.hand.some((card) => card.cardId === cardId)).toBe(false);

    s.chooseCard(RED);
    const transcended = s.state.players[0]!.hand.find((card) => card.cardId === cardId);
    expect(transcended?.flipped).toBe(true);
    expect(projectStateFor(s.state, 0).players[0]!.hand.find(
      (card) => card.instanceId === transcended?.instanceId,
    )?.cardId).toBe("FAB232B");
  });

  it("Rising Sun, Setting Moon bottoms a card before returning to hand as Inner Chi", () => {
    const s = scenario({
      seats: [
        enigmaSeat({ hand: ["homage to ancestors|3", "SEN035", RED], deck: [YELLOW] }),
        { hero: "dorinthea" },
      ],
    });

    s.play("homage to ancestors|3"); // another blue was played, enabling transcend
    s.play("SEN035"); // draws the yellow, then stops at the hand choice

    expect(s.state.players[0]!.hand.map((card) => card.cardId)).toEqual([
      printingId(RED),
      printingId(YELLOW),
    ]);
    expect(s.state.stack[0]?.card?.cardId).toBe("SEN035");
    expect(projectStateFor(s.state, 0).pendingDecision?.optionCards?.map((card) => card?.cardId))
      .toEqual([printingId(RED), printingId(YELLOW)]);

    s.chooseCard(RED);
    s.expectDeckBottom(0, RED);
    s.expectHandSize(0, 2); // the drawn yellow and transcended Rising Sun stay
    const transcended = s.state.players[0]!.hand.find((card) => card.cardId === "SEN035");
    expect(transcended?.flipped).toBe(true);
    expect(projectStateFor(s.state, 0).players[0]!.hand.find(
      (card) => card.instanceId === transcended?.instanceId,
    )?.cardId).toBe("FAB232B");
  });
});

describe("SEN — phantasm", () => {
  it("a 6+ power non-Illusionist attack defender destroys Enigma Chimera and closes the chain", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["enigma chimera|1", YELLOW] },
        { hero: "dorinthea", hand: [RED_7] },
      ],
    });
    s.play("enigma chimera|1", { pitch: [YELLOW] });
    s.blockWith(RED_7); // 7{p} attack action defender — phantasm pops
    s.settle();
    s.expectInZone(0, "enigma chimera|1", "graveyard");
    s.expectInZone(1, RED_7, "graveyard");
    s.expectLife(1, 20); // no damage step
    expect(s.state.chain).toHaveLength(0);
    expect(s.state.phase).toBe("action");
  });

  it("Phantasmal Haze creates a Spectral Shield when destroyed by phantasm", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["phantasmal haze|3", BLUE] },
        { hero: "dorinthea", hand: [RED_7] },
      ],
    });
    s.play("phantasmal haze|3", { pitch: [BLUE] });
    s.blockWith(RED_7);
    s.settle();
    s.expectInZone(0, "phantasmal haze|3", "graveyard");
    expect(boardCard(s, 0, SHIELD)).toBeTruthy();
  });

  it("Spectral Rider gains overpower while you control a Spectral Shield", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", board: [SHIELD], hand: ["spectral rider|3", BLUE] },
        { hero: "dorinthea", hand: [RED_7, RED] },
      ],
    });
    s.play("spectral rider|3", { pitch: [BLUE] });
    // overpower: the two action cards can't defend together (equipment could)
    const twoHandDefends = defendWithBoth(s, RED_7, RED);
    expect(twoHandDefends).toHaveLength(0);
    s.blockWith(RED); // a single 4{p} action defender is fine (under 6 — no phantasm pop)
    s.settle();
    s.expectLife(1, 16); // 6 - 2
  });

  it("Spectral Rider without a Spectral Shield has no overpower", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["spectral rider|3", BLUE] },
        { hero: "dorinthea", hand: [RED_7, RED] },
      ],
    });
    s.play("spectral rider|3", { pitch: [BLUE] });
    expect(defendWithBoth(s, RED_7, RED).length).toBeGreaterThan(0);
  });
});

describe("SEN — ward", () => {
  it("Spectral Shield destroys itself to prevent 1 damage", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED] },
        { hero: "dorinthea", board: [SHIELD] },
      ],
    });
    s.play(RED); // 4{p}
    s.blockWith();
    s.settle(); // stops at the ward decision
    s.chooseOption("destroy");
    s.expectLife(1, 17); // 4 - 1 prevented
    s.expectZoneSize(1, "board", 0);
  });

  it("ward is not optional: no decline — the shield must pop", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED] },
        { hero: "dorinthea", board: [SHIELD] },
      ],
    });
    s.play(RED);
    s.blockWith();
    s.settle(); // stops at the ward decision
    expect(s.state.pendingDecision?.options).not.toContain("decline");
    s.chooseOption("destroy");
    s.expectLife(1, 17); // 4 - 1 prevented
    s.expectZoneSize(1, "board", 0);
  });

  it("Waning Vengeance creates a Spectral Shield when its ward consumes it after a blue pitch", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["enigma chimera|1", YELLOW] },
        { hero: "dorinthea", board: ["waning vengeance|1"], hand: ["unmovable|3", "big blue sky|3"] },
      ],
    });
    s.play("enigma chimera|1", { pitch: [YELLOW] }); // 8{p} — lands on the defend decision
    s.blockWith();
    yieldToWindow(s, 1);
    s.react("unmovable|3", { pitch: ["big blue sky|3"], settle: false }); // pitches a blue this turn
    s.settle(); // Unmovable resolves (defends 5), then 8 - 5 = 3 damage → ward decision
    s.chooseOption("destroy"); // Waning Vengeance (Ward 3) prevents it all
    s.expectLife(1, 20);
    s.expectInZone(1, "waning vengeance|1", "graveyard");
    expect(boardCard(s, 1, SHIELD)).toBeTruthy();
  });

  it("Waning Vengeance without a blue pitch this turn creates nothing", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["enigma chimera|1", YELLOW] },
        { hero: "dorinthea", board: ["waning vengeance|1"], hand: ["unmovable|3", YELLOW, RED] },
      ],
    });
    s.play("enigma chimera|1", { pitch: [YELLOW] });
    s.blockWith();
    yieldToWindow(s, 1);
    s.react("unmovable|3", { pitch: [YELLOW, RED], settle: false }); // no blue pitched
    s.settle();
    s.chooseOption("destroy");
    s.expectLife(1, 20);
    s.expectNotInZone(1, SHIELD, "board");
  });

  it("Waxing Specter enters with a +1{p} counter if you've pitched blue this turn", () => {
    const s = scenario({
      seats: [enigmaSeat({ hand: ["waxing specter|1", BLUE] }), { hero: "dorinthea" }],
    });
    s.play("waxing specter|1", { pitch: [BLUE] });
    const aura = boardCard(s, 0, "waxing specter|1");
    expect(aura.counters?.power).toBe(1);
  });

  it("Waxing Specter without a blue pitch enters plain", () => {
    const s = scenario({
      seats: [enigmaSeat({ hand: ["waxing specter|1", YELLOW] }), { hero: "dorinthea" }],
    });
    s.play("waxing specter|1", { pitch: [YELLOW] });
    const aura = boardCard(s, 0, "waxing specter|1");
    expect(aura.counters?.power ?? 0).toBe(0);
  });
});

describe("SEN — Uphold Tradition (cloaked)", () => {
  it("enters face-down, hidden from the opponent; its flip puts a +1{p} counter on a ward aura", () => {
    const s = scenario({
      seats: [
        enigmaSeat({ equipment: { arms: "uphold tradition|0" }, board: [SHIELD], hand: [RED] }),
        { hero: "dorinthea" },
      ],
    });
    const arms = s.state.players[0]!.equipment.arms!;
    expect(arms.faceDown).toBe(true);
    const oppView = projectStateFor(s.state, 1).players[0]!.equipment.arms!;
    expect(oppView.hidden).toBe(true);
    expect(oppView.cardId).toBe("");
    s.activate("uphold tradition|0", { pitch: [RED] }); // flips face-up, stops at the aura choice
    s.chooseCard(SHIELD);
    expect(s.state.players[0]!.equipment.arms?.faceDown).toBe(false);
    expect(boardCard(s, 0, SHIELD).counters?.power).toBe(1);
  });

  it("Ward 1 functions once face-up", () => {
    const s = scenario({
      seats: [
        // no ward aura on board: the flip's counter effect fizzle-logs, which
        // also keeps Uphold Tradition the only ward source below
        enigmaSeat({ equipment: { arms: "uphold tradition|0" }, hand: [RED] }),
        { hero: "dorinthea", hand: [RED] },
      ],
      active: 0,
    });
    s.activate("uphold tradition|0", { pitch: [RED] }); // flips face-up
    expect(s.state.players[0]!.equipment.arms?.faceDown).toBe(false);
    s.endTurn(); // Dorinthea's turn
    s.play(RED); // 4{p} at Enigma
    s.blockWith();
    s.settle(); // ward decision (face-up Uphold Tradition)
    s.chooseOption("destroy");
    s.expectLife(0, 17); // 4 - 1 prevented
    s.expectNoEquipment(0, "arms");
  });
});

describe("SEN — Put in Context", () => {
  it("cannot defend an attack with more than 3 base power", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["enigma chimera|1", YELLOW] },
        { hero: "dorinthea", hand: ["put in context|3"] },
      ],
    });
    s.play("enigma chimera|1", { pitch: [YELLOW] }); // base 8
    s.blockWith().passPriority();
    const pic = s.state.players[1]!.hand.find((c) => c.cardId === printingId("put in context|3"))!;
    const defends = legalIntents(s.state, 1).filter(
      (i) => i.kind === "play-card" && i.instanceId === pic.instanceId,
    );
    expect(defends).toHaveLength(0);
    s.settle();
    s.expectLife(1, 12);
  });

  it("defends a small attack", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["surging strike|3", YELLOW] },
        { hero: "dorinthea", hand: ["put in context|3"] },
      ],
    });
    s.play("surging strike|3", { pitch: [YELLOW] }); // base 3
    s.blockWith().passPriority().react("put in context|3");
    s.expectFinalDefense(3);
    s.expectLife(1, 20);
  });
});

describe("SEN — created a card this turn", () => {
  it("Fluid Motion gets go again only after you've created a card", () => {
    const created = scenario({
      seats: [
        enigmaSeat({ hand: ["spectral manifestations|1", "fluid motion|3", YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    created.play("spectral manifestations|1", { pitch: [YELLOW] }); // creates a shield, native go again
    created.expectAP(0, 1);
    created.play("fluid motion|3"); // cost 0, go again from the creation
    created.blockWith().settle();
    created.expectFinalAttack(2);
    created.expectAP(0, 1);

    const plain = scenario({
      seats: [enigmaSeat({ hand: ["fluid motion|3"] }), { hero: "dorinthea" }],
    });
    plain.play("fluid motion|3");
    plain.blockWith().settle();
    plain.expectAP(0, 0); // no go again
  });

  it("Manifest Muscle gets +1{p} only after you've created a card", () => {
    const created = scenario({
      seats: [
        enigmaSeat({ hand: ["spectral manifestations|1", "manifest muscle|3", YELLOW, BLUE] }),
        { hero: "dorinthea" },
      ],
    });
    created.play("spectral manifestations|1", { pitch: [YELLOW] });
    created.play("manifest muscle|3", { pitch: [BLUE] });
    created.blockWith().settle();
    created.expectFinalAttack(6);

    const plain = scenario({
      seats: [enigmaSeat({ hand: ["manifest muscle|3", BLUE] }), { hero: "dorinthea" }],
    });
    plain.play("manifest muscle|3", { pitch: [BLUE] });
    plain.blockWith().settle();
    plain.expectFinalAttack(5);
  });

  it("Spectral Manifestations puts three counters on the shield only with no other Illusionist aura", () => {
    const s = scenario({
      seats: [
        enigmaSeat({ hand: ["spectral manifestations|1", YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("spectral manifestations|1", { pitch: [YELLOW] });
    expect(boardCard(s, 0, SHIELD).counters?.power).toBe(3);

    const other = scenario({
      seats: [
        enigmaSeat({ board: ["waxing specter|1"], hand: ["spectral manifestations|1", YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    other.play("spectral manifestations|1", { pitch: [YELLOW] });
    expect(boardCard(other, 0, SHIELD).counters?.power ?? 0).toBe(0);
  });
});

describe("SEN — Test of Strength", () => {
  it("the defender wins the clash and creates the Gold", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED], deck: ["snatch|3"] }, // top: 2{p}
        { hero: "dorinthea", hand: ["test of strength|1"], deck: [RED_7] }, // top: 7{p}
      ],
    });
    s.play(RED);
    s.blockWith("test of strength|1").settle();
    s.expectLog("wins the clash");
    expect(boardCard(s, 1, "gold|0")).toBeTruthy();
    s.expectNotInZone(0, "gold|0", "board");
  });

  it("the attacker wins the clash and creates the Gold", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED], deck: [RED_7] }, // top: 7{p}
        { hero: "dorinthea", hand: ["test of strength|1"], deck: ["snatch|3"] }, // top: 2{p}
      ],
    });
    s.play(RED);
    s.blockWith("test of strength|1").settle();
    expect(boardCard(s, 0, "gold|0")).toBeTruthy();
    s.expectNotInZone(1, "gold|0", "board");
  });
});

describe("SEN — Astral Etchings", () => {
  it("puts three +1{p} counters on an aura with ward you control", () => {
    const s = scenario({
      seats: [
        enigmaSeat({ board: [SHIELD], hand: ["astral etchings|1", RED] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("astral etchings|1", { pitch: [RED] }); // stops at the aura choice
    s.chooseCard(SHIELD);
    expect(boardCard(s, 0, SHIELD).counters?.power).toBe(3);
  });

  it("is playable as an instant while you control a Spectral Shield", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED] },
        { hero: "dorinthea", board: [SHIELD], hand: ["astral etchings|1", RED] },
      ],
    });
    s.play(RED); // 4{p} — lands on the defend decision
    s.blockWith();
    yieldToWindow(s, 1); // the defender's reaction window
    s.react("astral etchings|1", { pitch: [RED], settle: false });
    s.passPriority(); // attacker passes
    s.passPriority(); // defender passes — it resolves, stopping at the aura choice
    s.chooseCard(SHIELD);
    expect(boardCard(s, 1, SHIELD).counters?.power).toBe(3);
  });

  it("is not playable in a reaction window without a Spectral Shield", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED] },
        { hero: "dorinthea", hand: ["astral etchings|1", RED] },
      ],
    });
    s.play(RED);
    s.blockWith();
    // walk the reaction step: whenever the defender holds a window, the
    // etchings must not be playable
    const etchings = s.state.players[1]!.hand.find(
      (c) => c.cardId === printingId("astral etchings|1"),
    )!;
    for (let i = 0; i < 12 && s.state.pendingDecision; i++) {
      const pd = s.state.pendingDecision!;
      if (pd.kind === "choose-target" || pd.kind === "optional-effect") break;
      if (pd.player === 1) {
        const plays = legalIntents(s.state, 1).filter(
          (i) => i.kind === "play-card" && i.instanceId === etchings.instanceId,
        );
        expect(plays).toHaveLength(0);
      }
      s.passPriority();
    }
    s.settle();
    s.expectLife(1, 16); // the attack landed without the etchings ever being legal
  });
});

describe("SEN — Silent Stilettos", () => {
  it("on a phantasm pop you may pay {r}{r}{r}: destroy it and gain 1 action point", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", equipment: { legs: "silent stilettos|0" }, resources: 5, hand: ["enigma chimera|1"] },
        { hero: "dorinthea", hand: [RED_7] },
      ],
    });
    s.play("enigma chimera|1"); // cost 2 from the floating 5
    s.blockWith(RED_7); // phantasm pops — the Stilettos offer opens
    s.passPriority().passPriority();
    s.chooseOption("pay 3");
    s.expectResources(0, 0); // 5 - 2 (cost) - 3 (trigger)
    s.expectAP(0, 1); // 1 spent on the attack, 1 gained
    s.expectNoEquipment(0, "legs");
    s.expectInZone(0, "silent stilettos|0", "graveyard");
  });

  it("does nothing when the payment cannot be made", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", equipment: { legs: "silent stilettos|0" }, resources: 4, hand: ["enigma chimera|1"] },
        { hero: "dorinthea", hand: [RED_7] },
      ],
    });
    s.play("enigma chimera|1"); // cost 2 from the floating 4 — 2 left
    s.blockWith(RED_7);
    s.expectEquipped(0, "legs", "silent stilettos|0");
    s.expectAP(0, 0);
  });
});

describe("SEN — misc", () => {
  it("Big Blue Sky gets +1{d} for each blue card pitched this turn", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["enigma chimera|1", YELLOW] },
        { hero: "dorinthea", hand: ["unmovable|3", "big blue sky|3", "enigma chimera|3"] },
      ],
    });
    s.play("enigma chimera|1", { pitch: [YELLOW] }); // 8{p} — lands on the defend decision
    s.blockWith();
    yieldToWindow(s, 1);
    s.react("unmovable|3", { pitch: ["enigma chimera|3"], settle: false }); // pitches a blue
    yieldToWindow(s, 1); // attacker passed; defender's window again
    s.react("big blue sky|3", { settle: false }); // 2 + 1 blue pitched
    s.settle(); // both reactions resolve, then the combat: 8 - (5 + 3)
    s.expectFinalDefense(8);
    s.expectLife(1, 20);
  });

  it("On the Horizon: look at the top card of your deck when it defends", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: [RED] },
        { hero: "dorinthea", hand: ["on the horizon|1"], deck: [YELLOW] },
      ],
    });
    s.play(RED);
    s.blockWith("on the horizon|1").settle();
    s.expectFinalDefense(4);
    s.expectLog("look at the top card");
  });
});
