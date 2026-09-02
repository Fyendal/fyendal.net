/**
 * SDO (Silver Age: Dorinthea precon, Chapter 2) scenario tests — Dawnblade's
 * hit-count counters and end-phase reset, Wreck Havoc's reaction lock and
 * arsenal reveal, Agile Engagement's Agility token, Out for Blood's reprise,
 * Puncture's granted piercing, Lead with Speed, Goblet of Bloodrun Wine and
 * the Vigor start-of-turn trigger, and Trot Along's base-power go again.
 *
 * Driving notes: the seat uses the dorinthea decklist as a base with the hero
 * (SDO Dorinthea — the dorinthea|0 hero script re-enables the weapon attack
 * on hit) and weapons overridden. Reaction plays use react() in the reaction
 * step; the extra action point in the Dawnblade test is a setup stamp (a
 * go-again refund would provide it in a real game).
 */
import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const DAWNBLADE = "dawnblade|0";
const BLUE = "wrecker romp|3"; // blue pitch fodder
const RED = "snatch|1"; // red pitch fodder

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function sdoSeat(extra: Record<string, unknown> = {}) {
  return {
    hero: "dorinthea" as const,
    heroKey: "dorinthea|0",
    weapons: [DAWNBLADE],
    equipment: { ...NO_EQUIPMENT },
    ...extra,
  };
}

describe("SDO — Dawnblade", () => {
  it("the second hit each turn puts a +1{p} counter on it", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: [RED, RED] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] }) // first hit — no counter
      .blockWith().settle(); // Dorinthea automatically permits an additional attack
    s.state.players[0]!.actionPoints = 1; // a go-again refund would provide this
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] }) // second hit — the counter
      .blockWith().settle()
      .expectLog("gets a +1{p} counter");
    expect(s.state.players[0]!.weapons[0]!.counters?.power).toBe(1);
    // the counter feeds future attacks
    s.endTurn().endTurn(); // back to Dorinthea — it hit last turn, counters stay
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] })
      .expectAttackValue(4); // 3 base + 1 counter
  });

  it("removes all +1{p} counters at the end phase of a turn it didn't hit", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: [RED, RED] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] })
      .blockWith().settle();
    s.state.players[0]!.actionPoints = 1;
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] }).blockWith().settle();
    expect(s.state.players[0]!.weapons[0]!.counters?.power).toBe(1);
    s.endTurn().endTurn(); // Dorinthea's next turn: it hit last turn — keep
    expect(s.state.players[0]!.weapons[0]!.counters?.power).toBe(1);
    s.endTurn(); // Rhinar's turn
    s.endTurn(); // Dorinthea's turn: no attack this turn → end phase removes them
    s.expectLog("+1{p} counters are removed");
    expect(s.state.players[0]!.weapons[0]!.counters?.power).toBeUndefined();
  });
});

describe("SDO — attacks", () => {
  it("Wreck Havoc bans defense reactions and destroys a revealed defense reaction in arsenal", () => {
    const s = scenario({
      seats: [
        sdoSeat({ hand: ["wreck havoc|1", BLUE] }),
        { hero: "rhinar", hand: ["wax on|1"], arsenal: ["wax on|1"] },
      ],
    });
    // The scenario DSL accepts direct zone fixtures; model the real arsenal
    // state explicitly so this regression exercises hidden projection.
    s.state.players[1]!.arsenal[0]!.faceDown = true;
    s.play("wreck havoc|1", { pitch: [BLUE] })
      .expectAttackValue(6)
      .blockWith()
      .passPriority(); // defender's reaction window — Wax On is banned
    const waxId = s.state.players[1]!.hand.find((c) => c.cardId === printingId("wax on|1"))!;
    expect(
      legalIntents(s.state, 1).some(
        (i) => i.kind === "play-card" && i.instanceId === waxId.instanceId,
      ),
    ).toBe(false);
    s.settle().expectLife(1, 14);

    const secret = s.state.players[1]!.arsenal[0]!;
    const secretCardId = secret.cardId;
    for (const viewer of [0, null] as const) {
      const serialized = JSON.stringify(projectStateFor(s.state, viewer));
      expect(serialized).not.toContain(secretCardId);
      expect(serialized).not.toContain(`"instanceId":${secret.instanceId}`);
    }
    expect(projectStateFor(s.state, 0).pendingDecision?.options).toEqual(["pass", "turn"]);

    s.chooseOption("turn") // turn their arsenal card face up — it is destroyed
      .expectInZone(1, "wax on|1", "graveyard")
      .expectZoneSize(1, "arsenal", 0);
    expect(projectStateFor(s.state, 0).logEntries).toContainEqual(expect.objectContaining({
      message: {
        id: "card.log.sdo.wreckhavoc.destroyed",
        values: {
          result: { kind: "card", cardId: printingId("wax on|1") },
          card: { kind: "card", cardId: printingId("wreck havoc|1") },
        },
      },
      event: expect.objectContaining({
        kind: "card-moved",
        cardId: printingId("wax on|1"),
        from: "arsenal",
        to: "graveyard",
      }),
    }));
  });
});

describe("SDO — attack reactions", () => {
  it("Agile Engagement pumps a Warrior attack and creates Agility against an attack action defender", () => {
    const s = scenario({
      seats: [
        sdoSeat({ hand: ["agile engagement|1", RED, RED] }),
        { hero: "rhinar", hand: ["ravenous rabble|1"] },
      ],
    });
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] })
      .blockWith("ravenous rabble|1") // an attack action card defends
      .react("agile engagement|1", { pitch: [RED] })
      .settle()
      .expectFinalAttack(6) // 3 base + 3
      .expectInZone(0, "agility|0", "board");
  });

  it("Out for Blood pumps a weapon attack; reprise arms the next attack", () => {
    const s = scenario({
      seats: [
        sdoSeat({ hand: ["out for blood|1", RED, RED] }),
        { hero: "rhinar", hand: [RED] },
      ],
    });
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] })
      .blockWith(RED) // defended from hand → reprise is on
      .react("out for blood|1", { pitch: [RED] })
      .settle()
      .expectFinalAttack(6) // 3 base + 3
      .expectLog("reprise");
    expect(
      s.state.modifiers.some((m) => m.scope === "next-attack" && m.attack === 1),
    ).toBe(true);
  });

  it("Puncture gives a sword attack +3{p} and piercing 1 against equipment", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: ["puncture|1", RED, RED] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] })
      .blockWith("bone vizier|0") // defended by an equipment → piercing kicks in
      .react("puncture|1", { pitch: [RED] })
      .settle()
      .expectFinalAttack(7) // 3 base + 3 + 1 piercing
      .expectLife(1, 14); // 7 − 1
  });

  it("blue Puncture is +1{p} and piercing 1", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: ["puncture|3", RED, RED] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] })
      .blockWith("bone vizier|0")
      .react("puncture|3", { pitch: [RED] })
      .settle()
      .expectFinalAttack(5); // 3 base + 1 + 1 piercing
  });

  it("yellow Puncture is +2{p} and piercing 1 without mutating the sword", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: ["puncture|2", RED, RED] }), { hero: "rhinar", hand: [] }],
    });
    s.attackWithWeapon(DAWNBLADE, { pitch: [RED] })
      .blockWith("bone vizier|0")
      .react("puncture|2", { pitch: [RED] })
      .settle()
      .expectFinalAttack(6); // 3 base + 2 + 1 piercing
    expect(s.state.players[0]!.weapons[0]!.grantedKeywords).toBeUndefined();
  });
});

describe("SDO — non-attack actions", () => {
  it("Lead with Speed creates Agility and pumps the next Warrior attack", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: ["lead with speed|1", RED, BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.play("lead with speed|1", { pitch: [RED] }) // cost 1, go again
      .expectInZone(0, "agility|0", "board")
      .attackWithWeapon(DAWNBLADE, { pitch: [BLUE] })
      .expectAttackValue(6); // 3 base + 3
  });

  it("Goblet of Bloodrun Wine creates Agility + Vigor; Vigor pays {r} at turn start", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: ["goblet of bloodrun wine|3"] }), { hero: "rhinar", hand: [] }],
    });
    s.play("goblet of bloodrun wine|3") // go again
      .expectInZone(0, "agility|0", "board")
      .expectInZone(0, "vigor|0", "board")
      .endTurn()
      .endTurn(); // Dorinthea's next turn starts — both token triggers fire
    s.expectLog("Vigor is destroyed: gain {r}")
      .expectNotInZone(0, "vigor|0", "board")
      .expectNotInZone(0, "agility|0", "board"); // Agility's own start-of-turn destroy
    expect(s.state.players[0]!.resources).toBe(1);
  });

  it("does not let Chum respond after ordering Agility and Vigor at turn start", () => {
    const s = scenario({
      active: 1,
      seats: [
        sdoSeat({
          board: ["agility|0", "vigor|0", "chum, friendly first mate|2"],
          hand: ["moray le fay|2"],
        }),
        { hero: "rhinar", hand: [] },
      ],
    });

    s.doRaw({ kind: "pass" });
    // Chum is a legal response to the opponent ending their Action Phase; pass
    // that real window before entering the next turn's automatic Start Phase.
    expect(s.state.stackResume).toBe("end-action-phase");
    s.passPriority();
    const order = s.state.pendingDecision;
    expect(order).toMatchObject({ kind: "order-triggers", player: 0 });
    expect(order?.options).toHaveLength(2);

    const chumId = s.state.players[0]!.board.find(
      (card) => card.cardId === printingId("chum, friendly first mate|2"),
    )!.instanceId;
    s.doRaw({ kind: "order-triggers", optionIds: order!.options! });

    const chum = s.state.players[0]!.board.find((card) => card.instanceId === chumId)!;
    expect(s.state.phase).toBe("action");
    expect(s.state.pendingDecision).toBeNull();
    expect(chum.tapped).not.toBe(true);
    expect(chum.counters?.["must-target-turn"]).toBeUndefined();
    s.expectNotInZone(0, "agility|0", "board")
      .expectNotInZone(0, "vigor|0", "board")
      .expectInZone(0, "moray le fay|2", "hand");
  });

  it("Trot Along gives an attack with 3 or less base {p} go again", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: ["trot along|3", RED] }), { hero: "rhinar", hand: [] }],
    });
    s.play("trot along|3") // go again
      .attackWithWeapon(DAWNBLADE, { pitch: [RED] }) // 3 base {p} → go again
      .blockWith().settle()
      .expectAP(0, 1);
  });

  it("Trot Along does not fire for a bigger attack and stays armed", () => {
    const s = scenario({
      seats: [sdoSeat({ hand: ["trot along|3", "wreck havoc|1", BLUE] }), { hero: "rhinar", hand: [] }],
    });
    s.play("trot along|3")
      .play("wreck havoc|1", { pitch: [BLUE] }) // 6 base {p} — no go again
      .blockWith().settle() // nothing in Rhinar's arsenal: no reveal choice
      .expectAP(0, 0);
    expect(
      s.state.modifiers.some((m) => m.scope === "next-attack" && m.goAgain === true),
    ).toBe(true);
  });
});
