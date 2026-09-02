/**
 * SBL (Silver Age: Boltyn precon) scenario tests — Charge/the soul zone,
 * conditional charge bonuses, Boltyn's passive and reaction, Unity, Spellvoid,
 * +1{p} counters on weapons (Sharpen/Glisten), the Agility/Courage/Flurry
 * tokens, and the soul/hand redirects.
 *
 * Driving notes: "you may charge" is a card choice from hand (with a decline
 * option) that pauses the play; window abilities (Boltyn's reaction, Radiant Touch) are
 * driven with settle:false + passPriority like any reaction-window play.
 */
import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";

const BOLTYN = "boltyn|0";
const RAYDN = "raydn, duskbane|0";
const YELLOW = "raging onslaught|2"; // vanilla yellow, not Light — charge fodder
const RED_BLOCK = "raging onslaught|1"; // vanilla attack action, def 3

function boltynSeat(extra: Record<string, unknown> = {}) {
  return { hero: "rhinar" as const, heroKey: BOLTYN, weapons: [RAYDN], ...extra };
}

describe("SBL — Charge as an additional cost", () => {
  it("Beaming Bravado: charging a yellow card gives +1{p}", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["beaming bravado|1", YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("beaming bravado|1"); // stops at the charge choice
    s.chooseCard(YELLOW); // charges the yellow — stops at the defend decision
    s.expectZoneSize(0, "soul", 1);
    s.blockWith().settle();
    s.expectFinalAttack(4);
  });

  it("Beaming Bravado: declining the charge attacks for the printed 3", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["beaming bravado|1", YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("beaming bravado|1");
    s.chooseOption("no");
    s.expectZoneSize(0, "soul", 0);
    s.blockWith().settle();
    s.expectFinalAttack(3);
  });

  it("Take Flight gains go again when you've charged this turn", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["take flight|1", "snatch|1", YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("take flight|1", { pitch: ["snatch|1"] });
    s.chooseCard(YELLOW);
    s.blockWith().settle();
    s.expectFinalAttack(4).expectAP(0, 1); // go again refunded the action point
  });

  it("Bolt of Courage draws a card on hit when you've charged this turn", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["bolt of courage|1", YELLOW], deck: ["snatch|1"] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("bolt of courage|1");
    s.chooseCard(YELLOW);
    s.blockWith().settle(); // hits for 3
    s.expectHandSize(0, 1); // the on-hit draw
  });

  it("Light the Way gains go again on hit if a yellow card was charged for it", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["light the way|1", "beaming bravado|2"] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("light the way|1");
    s.chooseCard("beaming bravado|2"); // charges a yellow
    s.blockWith().settle();
    s.expectAP(0, 1); // go again granted on hit
  });

  it("V of the Vanguard: charge any number of times, +1{p} per Light card charged", () => {
    const s = scenario({
      seats: [
        boltynSeat({
          hand: ["v of the vanguard|2", "snatch|1", "beaming bravado|2", YELLOW],
        }),
        { hero: "dorinthea" },
      ],
    });
    s.play("v of the vanguard|2", { pitch: ["snatch|1"] });
    s.chooseCard("beaming bravado|2"); // Light
    s.chooseCard(YELLOW); // non-Light; hand empty, loop stops
    s.expectZoneSize(0, "soul", 2);
    s.blockWith().settle();
    s.expectFinalAttack(4); // 3 base + 1 Light card charged
  });
});

describe("SBL — soul payoffs", () => {
  it("Duty Bound Blitz cannot be played before a yellow card hits the soul", () => {
    const s = scenario({
      seats: [boltynSeat({ hand: ["duty bound blitz|1"] }), { hero: "dorinthea" }],
    });
    s.expectNoLegalPlay("duty bound blitz|1");
  });

  it("Duty Bound Blitz unlocks once a yellow card was charged this turn", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["light the way|1", "duty bound blitz|1", YELLOW], deck: ["snatch|1"] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("light the way|1"); // go again on hit keeps the action point
    s.chooseCard(YELLOW); // yellow into the soul
    s.blockWith().settle();
    s.play("duty bound blitz|1");
    s.blockWith().settle();
    s.expectFinalAttack(5);
  });

  it("Valiant Thrust gets +3{p} when you've charged this turn", () => {
    const s = scenario({
      seats: [
        boltynSeat({
          hand: ["light the way|1", "valiant thrust|2", "snatch|1", YELLOW],
        }),
        { hero: "dorinthea" },
      ],
    });
    s.play("light the way|1");
    s.chooseCard(YELLOW);
    s.blockWith().settle();
    s.play("valiant thrust|2", { pitch: ["snatch|1"] });
    s.blockWith().settle();
    s.expectFinalAttack(6);
  });

  it("Banneret of Salvation (Solflare): the next hit after charging it gains 1 life", () => {
    const s = scenario({
      seats: [
        boltynSeat({ life: 15, hand: ["beaming bravado|1", "banneret of salvation|2"] }),
        { hero: "dorinthea", life: 20 },
      ],
    });
    s.play("beaming bravado|1");
    s.chooseCard("banneret of salvation|2"); // Solflare arms, and it's yellow (+1{p})
    s.blockWith().settle();
    s.expectFinalAttack(4).expectLife(1, 16).expectLife(0, 16);
  });

  it("Engulfing Light goes to the soul on hit when you've charged this turn", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["engulfing light|1", YELLOW], deck: ["snatch|1"] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("engulfing light|1");
    s.chooseCard(YELLOW);
    s.blockWith().settle();
    s.endTurn(); // closes the chain — the attack moves to the soul
    s.expectInZone(0, "engulfing light|1", "soul");
    s.expectNotInZone(0, "engulfing light|1", "graveyard");
    s.expectZoneSize(0, "soul", 2); // the charged card + Engulfing Light
  });

  it("Illuminate goes to the soul on hit (no charge needed)", () => {
    const s = scenario({
      seats: [boltynSeat({ hand: ["illuminate|1"] }), { hero: "dorinthea" }],
    });
    s.play("illuminate|1");
    s.blockWith().settle();
    s.endTurn();
    s.expectInZone(0, "illuminate|1", "soul");
    s.expectZoneSize(0, "soul", 1);
  });
});

describe("SBL — Boltyn", () => {
  it("passive: charged this turn, attacks get +1{p} while defended by an attack action", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["beaming bravado|1", YELLOW] }),
        { hero: "dorinthea", hand: [RED_BLOCK] },
      ],
    });
    s.play("beaming bravado|1");
    s.chooseCard(YELLOW); // +1 from the yellow charge
    s.blockWith(RED_BLOCK); // defended by an attack action: +1 from Boltyn
    s.settle();
    s.expectFinalAttack(5).expectFinalDefense(3);
  });

  it("passive: no charge this turn, no bonus", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["beaming bravado|1", YELLOW] }),
        { hero: "dorinthea", hand: [RED_BLOCK] },
      ],
    });
    s.play("beaming bravado|1");
    s.chooseOption("no");
    s.blockWith(RED_BLOCK).settle();
    s.expectFinalAttack(3);
  });

  it("reaction: banish a soul card to give an above-base attack go again", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["beaming bravado|1", YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("beaming bravado|1", { settle: false });
    s.chooseCard(YELLOW); // charge the yellow — the attack is above base (3+1)
    s.blockWith(); // no defense — attack-reaction window opens for Boltyn
    s.activate(BOLTYN, { settle: false }); // choose/pay the soul cost before the layer exists
    s.doRaw({
      kind: "choose",
      optionId: String(s.state.players[0]!.soul[0]!.instanceId),
    });
    s.passPriority(); // Boltyn passes
    s.passPriority(); // Dorinthea passes; the ability resolves
    s.settle(); // finish the attack so go again refunds the action point
    s.expectZoneSize(0, "soul", 0);
    s.expectInZone(0, YELLOW, "banish");
    s.expectAP(0, 1); // go again refunded at resolution
  });
});

describe("SBL — Raydn, Duskbane", () => {
  it("attacks for 0 without a charge, 3 after charging", () => {
    const s = scenario({
      seats: [
        boltynSeat({
          hand: ["light the way|1"],
          // turn-1 end-of-turn draws put the yellow into hand for the later charge
          deck: [YELLOW, "snatch|1", "snatch|1", "snatch|1"],
        }),
        { hero: "dorinthea" },
      ],
    });
    s.attackWithWeapon(RAYDN);
    s.blockWith().settle();
    s.expectFinalAttack(0);
    s.endTurn(); // Dorinthea's turn — she does nothing
    s.endTurn(); // back to Boltyn
    s.play("light the way|1"); // go again on hit (yellow charged) keeps the AP
    s.chooseCard(YELLOW);
    s.blockWith().settle();
    s.attackWithWeapon(RAYDN);
    s.blockWith().settle();
    s.expectFinalAttack(3);
  });

  it("is once per turn unless a Flurry token re-enables it", () => {
    const s = scenario({
      seats: [
        // Courage pumps the 0-base Raydn above its base {p} so Boltyn's
        // reaction can give it go again — paying for the second attack's AP
        boltynSeat({ board: ["flurry|0", "courage|0"], soul: [YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.attackWithWeapon(RAYDN); // triggers: Flurry re-enables Raydn, Courage +1{p}
    s.blockWith(); // attack-reaction window
    s.activate(BOLTYN, { settle: false }); // banish a soul card: attack gains go again
    s.doRaw({
      kind: "choose",
      optionId: String(s.state.players[0]!.soul[0]!.instanceId),
    });
    s.passPriority(); // Boltyn passes
    s.passPriority(); // Dorinthea passes; the ability resolves
    s.settle();
    s.expectZoneSize(0, "board", 0);
    s.expectAP(0, 1); // go again refunded
    s.attackWithWeapon(RAYDN); // legal again thanks to Flurry
    s.blockWith().settle();
    expect(s.state.chain).toHaveLength(2);
  });
});

describe("SBL — tokens", () => {
  it("lets the controller order Courage and Flurry when a weapon attack is activated", () => {
    const s = scenario({
      seats: [
        boltynSeat({ board: ["courage|0", "flurry|0"] }),
        { hero: "dorinthea" },
      ],
    });

    const courageId = s.state.players[0]!.board.find(
      (card) => card.cardId === printingId("courage|0"),
    )!.instanceId;
    const flurryId = s.state.players[0]!.board.find(
      (card) => card.cardId === printingId("flurry|0"),
    )!.instanceId;

    s.attackWithWeapon(RAYDN, { settle: false });
    expect(s.state.pendingDecision).toMatchObject({
      player: 0,
      kind: "order-triggers",
      optionLabels: expect.arrayContaining([
        "Destroy Courage (attack +1{p})",
        "Destroy Flurry (you may attack with the weapon twice this turn)",
      ]),
    });

    s.doRaw({
      kind: "order-triggers",
      optionIds: [`${flurryId}:0`, `${courageId}:1`],
    });
    expect(s.state.stack.map((layer) => layer.sourceInstanceId)).toEqual([
      flurryId,
      courageId,
    ]);
  });

  it("Agility: at the start of your turn, destroy it and your next attack gains go again", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["beaming bravado|1"], board: ["agility|0"] }),
        { hero: "dorinthea" },
      ],
    });
    s.endTurn(); // Dorinthea passes
    s.endTurn(); // Boltyn's start of turn: Agility trigger resolves
    s.expectZoneSize(0, "board", 0);
    s.play("beaming bravado|1"); // empty hand — no charge choice
    s.blockWith().settle();
    s.expectAP(0, 1); // go again from Agility
  });

  it("Courage: when you attack, destroy it and the attack gets +1{p}", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["beaming bravado|1"], board: ["courage|0"] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("beaming bravado|1"); // empty deck — no charge choice
    s.blockWith().settle();
    s.expectFinalAttack(4);
    s.expectZoneSize(0, "board", 0);
  });
});

describe("SBL — equipment", () => {
  it("Unity: Helm of Unity gets +1{d} when defending together with a hand card", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", equipment: { head: "helm of unity|0" }, hand: [RED_BLOCK] },
      ],
    });
    s.play("snatch|1"); // 4 attack
    s.blockWith("helm of unity|0", RED_BLOCK).settle();
    s.expectFinalDefense(5); // 1 helm + 1 Unity + 3 from hand
  });

  it("Unity: no bonus when defending alone", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", equipment: { head: "helm of unity|0" } },
      ],
    });
    s.play("snatch|1");
    s.blockWith("helm of unity|0").settle();
    s.expectFinalDefense(1);
  });

  it("Unity: its defense modifier applies when Temper resolves", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", equipment: { arms: "gauntlets of unity|0" }, hand: [RED_BLOCK] },
      ],
    });
    s.play("snatch|1");
    s.blockWith("gauntlets of unity|0", RED_BLOCK).settle();
    s.expectFinalDefense(5); // 1 gauntlets + 1 Unity + 3 from hand

    s.endTurn(); // Temper makes it 1{d} during close; Unity then expires
    s.expectEquipped(1, "arms", "gauntlets of unity|0");
    s.expectEquipmentDefense(1, "arms", 0);
    expect(s.state.players[1]!.equipment.arms?.defCounters).toBe(1);
  });

  it("Spellvoid: destroy Halo of Illumination to prevent 2 arcane damage", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["voltic bolt|1", YELLOW] },
        { hero: "dorinthea", life: 20, equipment: { head: "halo of illumination|0" } },
      ],
    });
    s.play("voltic bolt|1", { pitch: [YELLOW] }); // 5 arcane — stops at the target choice
    s.chooseOption("opposing hero"); // stops at the Spellvoid decision
    s.chooseOption("destroy");
    s.expectNoEquipment(1, "head");
    s.expectLife(1, 17); // 5 - 2 prevented
  });

  it("Spellvoid: declining takes the full arcane damage", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["voltic bolt|1", YELLOW] },
        { hero: "dorinthea", life: 20, equipment: { head: "halo of illumination|0" } },
      ],
    });
    s.play("voltic bolt|1", { pitch: [YELLOW] });
    s.chooseOption("opposing hero");
    s.chooseOption("decline");
    s.expectEquipped(1, "head", "halo of illumination|0");
    s.expectLife(1, 15);
  });

  it("Halo of Illumination: pay {r}, destroy it, put a hand card into your soul (Light draws)", () => {
    const s = scenario({
      seats: [
        boltynSeat({
          equipment: { head: "halo of illumination|0" },
          hand: ["bolt of courage|1", "snatch|1"],
          deck: [YELLOW],
        }),
        { hero: "dorinthea" },
      ],
    });
    s.activate("halo of illumination|0", { pitch: ["snatch|1"] }); // stops at the hand-card choice
    s.chooseCard("bolt of courage|1"); // a Light card — draw
    s.expectNoEquipment(0, "head");
    s.expectInZone(0, "bolt of courage|1", "soul");
    s.expectHandSize(0, 1); // drew the deck top
  });

  it("Radiant Touch: banish itself and a soul card at instant speed to prevent 2", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        boltynSeat({
          hero: "dorinthea",
          life: 20,
          equipment: { arms: "radiant touch|0" },
          soul: [YELLOW],
        }),
      ],
    });
    s.play("snatch|1", { settle: false }); // 4 attack — Radiant Touch keeps the attack window open
    s.passPriority(); // attacker passes
    s.passPriority(); // defender passes — the attack becomes attacking
    s.passPriority(); // attacker passes in the Attack Step
    s.passPriority(); // defender passes — move to defense
    s.blockWith(); // take it — attack-reaction window
    s.passPriority(); // attacker yields to the defense-reaction window
    s.activate("radiant touch|0", { settle: false });
    s.doRaw({
      kind: "choose",
      optionId: String(s.state.players[1]!.soul[0]!.instanceId),
    }); // costs are paid before the ability layer opens
    s.passPriority(); // defender passes
    s.passPriority(); // attacker passes; the ability resolves
    s.settle();
    s.expectInZone(1, "radiant touch|0", "banish");
    s.expectZoneSize(1, "soul", 0);
    s.expectLife(1, 18); // 4 - 2 prevented
  });

  it("Garland of Spring: destroy to gain {r}, with go again", () => {
    const s = scenario({
      seats: [
        boltynSeat({ equipment: { chest: "garland of spring|0" } }),
        { hero: "dorinthea" },
      ],
    });
    s.activate("garland of spring|0");
    s.expectResources(0, 1).expectAP(0, 1).expectNoEquipment(0, "chest");
  });

  it("Flat Trackers: destroy to create an Agility token, with go again", () => {
    const s = scenario({
      seats: [
        boltynSeat({ equipment: { legs: "flat trackers|0" } }),
        { hero: "dorinthea" },
      ],
    });
    s.activate("flat trackers|0");
    s.expectInZone(0, "agility|0", "board").expectAP(0, 1).expectNoEquipment(0, "legs");
  });
});

describe("SBL — counters, prevention, redirects", () => {
  it("Edict of Steel: Sharpen puts a +1{p} counter on Raydn and creates a Flurry token", () => {
    const s = scenario({
      seats: [boltynSeat({ hand: ["edict of steel|1"] }), { hero: "dorinthea" }],
    });
    const edictId = s.state.players[0]!.hand[0]!.instanceId;
    s.play("edict of steel|1", { settle: false });
    expect(s.state.phase).toBe("layer");
    expect(s.state.pendingDecision?.kind).toBe("priority-window");
    expect(s.state.stack[0]?.card?.instanceId).toBe(edictId);
    expect(s.state.players[0]!.weapons[0]!.counters?.power ?? 0).toBe(0);
    expect(s.state.players[0]!.board).toHaveLength(0);

    // Edict resolves only after both players pass priority.
    s.passPriority().passPriority();
    s.expectLog("+1{p} counter");
    s.expectInZone(0, "flurry|0", "board");
    s.expectAP(0, 1); // go again
    s.attackWithWeapon(RAYDN); // 0 base + 1 counter (Flurry re-enables and is destroyed)
    s.blockWith().settle();
    s.expectFinalAttack(1);
  });

  it("Glisten: distribute +1{p} counters, wiped at the beginning of the end phase", () => {
    const s = scenario({
      seats: [boltynSeat({ hand: ["glisten|1", YELLOW] }), { hero: "dorinthea" }],
    });
    s.play("glisten|1", { pitch: [YELLOW] }); // stops at the distribution choice
    s.chooseOption("3"); // all three on Raydn
    s.attackWithWeapon(RAYDN);
    s.blockWith().settle();
    s.expectFinalAttack(3);
    s.endTurn();
    s.expectLog("+1{p} counters are removed");
  });

  it("Toe the Line: prevents 2 from the next damage event and creates a Flurry token", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", life: 20, hand: ["toe the line|1"] },
      ],
    });
    s.play("snatch|1", { settle: false }); // 4 attack — Toe the Line keeps the attack window open
    s.passPriority(); // attacker passes
    s.passPriority(); // defender passes — the attack becomes attacking
    s.passPriority(); // attacker passes in the Attack Step
    s.passPriority(); // defender passes — move to defense
    s.blockWith(); // take it — reaction step
    s.passPriority(); // attacker yields
    s.react("toe the line|1", { settle: false });
    s.passPriority();
    s.passPriority(); // Toe the Line resolves; the reaction window remains open
    s.expectDamageToPrevent(2, ["toe the line|1"]);
    s.settle(); // the attack lands
    s.expectLife(1, 18);
    s.expectInZone(1, "flurry|0", "board");
  });

  it("Toe the Line: expires its unused prevention after the first damage event", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["head jab|3", "wounding blow|1"] },
        { hero: "dorinthea", life: 20, hand: ["toe the line|1"] },
      ],
    });
    s.play("head jab|3", { settle: false });
    s.passPriority();
    s.passPriority();
    s.passPriority();
    s.passPriority();
    s.blockWith();
    s.passPriority();
    s.react("toe the line|1", { settle: false });
    s.settle();
    s.expectLife(1, 20).expectInZone(1, "flurry|0", "board");

    s.play("wounding blow|1").blockWith().settle();
    s.expectLife(1, 16);
  });

  it("Toe the Line: two copies that each prevent damage each create a Flurry token", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", life: 20, hand: ["toe the line|1", "toe the line|1"] },
      ],
    });
    s.play("snatch|1", { settle: false });
    s.passPriority();
    s.passPriority();
    s.passPriority();
    s.passPriority();
    s.blockWith();
    s.passPriority();
    s.react("toe the line|1", { settle: false });
    s.react("toe the line|1", { settle: false });
    s.settle();
    s.expectLife(1, 20);
    s.expectZoneSize(1, "board", 2);
    s.expectInZone(1, "flurry|0", "board");
  });

  it("Toe the Line: resolves rewards from mixed persisted shield representations", () => {
    const s = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", life: 20, hand: ["toe the line|1", "toe the line|1"] },
      ],
    });
    s.play("snatch|1", { settle: false });
    s.passPriority();
    s.passPriority();
    s.passPriority();
    s.passPriority();
    s.blockWith();
    s.passPriority();
    s.react("toe the line|1", { settle: false });
    s.passPriority();
    s.passPriority();
    s.passPriority();
    s.react("toe the line|1", { settle: false });
    s.passPriority();
    s.passPriority();

    const shields = s.state.modifiers.filter(
      (modifier) => modifier.preventNextDamageAmount === 2 &&
        modifier.sourceCardId === printingId("toe the line|1"),
    );
    expect(shields).toHaveLength(2);
    const combined = shields[1]!;
    const companion = s.state.modifiers.find(
      (modifier) => modifier.sourceInstanceId === combined.sourceInstanceId &&
        modifier.onPreventCreateToken !== undefined,
    );
    expect(companion).toBeDefined();
    combined.onPreventCreateToken = companion!.onPreventCreateToken;
    delete companion!.onPreventCreateToken;
    companion!.consumed = true;

    s.settle();
    s.expectLife(1, 20);
    s.expectZoneSize(1, "board", 2);
  });

  it("Roaring Beam: creates a Courage token; with an empty soul, returns to hand and charges", () => {
    const s = scenario({
      seats: [
        boltynSeat({ hand: ["snatch|1", "roaring beam|2"], deck: [YELLOW] }),
        { hero: "dorinthea" },
      ],
    });
    s.play("snatch|1", { settle: false });
    s.blockWith(); // attack-reaction window
    s.react("roaring beam|2"); // resolves: token, return to hand, charge
    s.expectInZone(0, "courage|0", "board");
    s.expectInZone(0, "roaring beam|2", "soul");
    s.expectInZone(0, YELLOW, "hand"); // Snatch draws the untouched deck card
  });

  it("Springboard Somersault defends for 2 from hand, 4 from arsenal", () => {
    const fromHand = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", hand: ["springboard somersault|2"] },
      ],
    });
    fromHand.play("snatch|1");
    fromHand.blockWith().passPriority().react("springboard somersault|2");
    fromHand.expectFinalDefense(2);

    const fromArsenal = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", arsenalFaceDown: ["springboard somersault|2"] },
      ],
    });
    fromArsenal.play("snatch|1", { settle: false });
    fromArsenal.blockWith(); // take it — defense-reaction window
    fromArsenal.passPriority(); // attacker yields
    fromArsenal.react("springboard somersault|2"); // from arsenal, resolves as a defender
    fromArsenal.expectFinalDefense(4);
  });
});
