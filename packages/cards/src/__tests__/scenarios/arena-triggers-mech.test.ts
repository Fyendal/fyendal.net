import { describe, expect, it } from "vitest";
import { createGame, legalIntents } from "@fyendal/engine";
import { cardData, decklists, scripts } from "../../index.js";
import { printingId, scenario } from "../harness.js";
import type { Scenario } from "../harness.js";

// Mechanologist, Evo and Illusionist "When this enters / is equipped / leaves
// the arena" abilities are triggered layers that wait for priority.

/** Pass priority until `seat` holds an open priority window. */
function yieldTo(g: Scenario, seat: number): void {
  for (let i = 0; i < 12; i++) {
    const pd = g.state.pendingDecision;
    if (pd?.player === seat && pd.kind !== "defend") return;
    g.passPriority();
  }
  throw new Error(`seat ${seat} never received priority`);
}

function chooseTarget(g: Scenario, instanceId: number | "pass"): void {
  expect(g.state.pendingDecision?.chooseHook).toBe("trigger-target");
  g.doRaw({ kind: "choose", optionId: String(instanceId) });
}

function boardCount(g: Scenario, seat: number, key: string): number {
  return g.state.players[seat]!.board.filter((card) => card.cardId === printingId(key)).length;
}

describe("Mechanologist, Evo and Illusionist arena triggers use the stack", () => {
  it("Cogwerx base equipment gets its steam counter at game start without a trigger", () => {
    const base = decklists.rhinar;
    const state = createGame({
      globalCardIds: [],
      decklists: [
        { ...base, equipment: { ...base.equipment, head: printingId("cogwerx base head|0") } },
        decklists.dorinthea,
      ],
      seed: 1,
      cards: cardData,
      scripts,
    });

    expect(state.players[0]!.equipment.head?.counters?.steam).toBe(1);
    expect(state.stack).toEqual([]);
  });

  it("Evo Buzz Hive gains its resource only when its equip trigger resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["evo buzz hive|2"], equipment: { chest: "cogwerx base chest|0" } },
        { hero: "dorinthea" },
      ],
    });

    g.play("evo buzz hive|2", { settle: false });
    g.passUntilLayer("Gain 1 resource");
    g.expectEquipped(0, "chest", "evo buzz hive|2").expectResources(0, 0);

    g.passPriority().passPriority();
    expect(g.state.stack).toEqual([]);
    g.expectResources(0, 1);
  });

  it("instant evos can be played on the opponent's turn", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|3"] },
        {
          hero: "dorinthea",
          hand: ["evo zoom call|2", "evo buzz hive|2", "evo whizz bang|2", "evo zip line|2"],
          equipment: {
            head: "cogwerx base head|0",
            chest: "cogwerx base chest|0",
            arms: "cogwerx base arms|0",
            legs: "cogwerx base legs|0",
          },
        },
      ],
    });

    g.play("raging onslaught|3").blockWith();
    yieldTo(g, 1);
    const played = legalIntents(g.state, 1).flatMap((intent) =>
      intent.kind === "play-card" ? [g.state.players[1]!.hand.find((card) => card.instanceId === intent.instanceId)?.cardId] : [],
    );
    for (const evo of ["evo zoom call|2", "evo buzz hive|2", "evo whizz bang|2", "evo zip line|2"]) {
      expect(played).toContain(printingId(evo));
    }
  });

  it("Evo Heartdrive's next-attack discount waits for its equip trigger", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["evo heartdrive|3"], equipment: { chest: "cogwerx base chest|0" } },
        { hero: "dorinthea" },
      ],
    });

    g.play("evo heartdrive|3", { asInstant: true, settle: false });
    g.passUntilLayer("The next attack action card you play this turn costs 1 less to play");
    expect(g.state.modifiers).toEqual([]);

    g.passPriority().passPriority();
    expect(g.state.modifiers).toContainEqual(expect.objectContaining({ playCostReduction: 1 }));
  });

  for (const [evo, label, check] of [
    [
      "evo whizz bang|2",
      "Up to 1 target attack gets +1 power",
      (g: Scenario, attackId: number) =>
        expect(g.state.modifiers).toContainEqual(expect.objectContaining({ attack: 1, appliesToInstanceId: attackId })),
    ],
    [
      "evo zip line|2",
      "Up to 1 target attack gets go again",
      (g: Scenario) => expect(g.state.chain[0]?.goAgain).toBe(true),
    ],
  ] as const) {
    it(`${evo} declares up to 1 target attack as its equip trigger goes on the stack`, () => {
      const slot = evo === "evo zip line|2" ? "legs" : "arms";
      const g = scenario({
        seats: [
          {
            hero: "rhinar",
            resources: 3,
            hand: ["raging onslaught|3", evo],
            equipment: { [slot]: `cogwerx base ${slot}|0` },
          },
          { hero: "dorinthea" },
        ],
      });

      g.play("raging onslaught|3").blockWith();
      yieldTo(g, 0);
      const attackId = g.state.chain[0]!.attackingCard.instanceId;
      g.play(evo, { settle: false });
      while (g.state.stack[0]?.card) g.passPriority();

      chooseTarget(g, attackId);
      expect(g.stackLabels()).toContain(label);
      expect(() => check(g, attackId)).toThrow();

      g.passPriority().passPriority();
      check(g, attackId);
    });
  }

  it("evo whizz bang|2 may target any attack on the combat chain", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 3,
          hand: ["hunt to the ends of rathe|1", "raging onslaught|3", "evo whizz bang|2"],
          equipment: { arms: "cogwerx base arms|0" },
        },
        { hero: "dorinthea" },
      ],
    });

    g.play("hunt to the ends of rathe|1").blockWith().settle();
    g.play("raging onslaught|3").blockWith();
    yieldTo(g, 0);
    const [first, second] = g.state.chain.map((link) => link.attackingCard.instanceId);
    g.play("evo whizz bang|2", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();

    expect(g.state.pendingDecision?.options).toEqual(["pass", String(first), String(second)]);
    const resolvedPower = g.state.chain[0]!.finalAttack!;
    chooseTarget(g, first!);
    g.passPriority().passPriority();
    // The earlier link has resolved, so the bonus updates its final power.
    expect(g.state.chain[0]!.finalAttack).toBe(resolvedPower + 1);
  });

  const STASIS_LABEL =
    "Target equipment's activated abilities can't be activated until the end of its controller's next turn";

  it("Stasis Cell declares target equipment as its enter trigger goes on the stack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["stasis cell|3"] },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });
    const helm = g.state.players[1]!.equipment.head!.instanceId;

    g.play("stasis cell|3", { settle: false });
    while (g.state.stack[0]?.card) g.passPriority();
    chooseTarget(g, helm);
    expect(g.stackLabels()).toEqual([STASIS_LABEL]);
    expect(g.state.modifiers).toEqual([]);

    g.passPriority().passPriority();
    expect(g.state.modifiers).toContainEqual(
      expect.objectContaining({ suppressesActivatedAbilitiesOfInstanceId: helm, expiresAtEndOfSeatTurn: 1 }),
    );
  });

  it("Stasis Cell's leave trigger resolves before the ability that moved it", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["stasis cell|3"] },
        { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
      ],
    });
    const helm = g.state.players[1]!.equipment.head!.instanceId;

    g.activate("stasis cell|3", { settle: false });
    chooseTarget(g, helm);
    expect(g.stackLabels()[0]).toBe(STASIS_LABEL);
    expect(g.state.modifiers).toEqual([]);

    g.passPriority().passPriority();
    expect(g.state.modifiers).toContainEqual(
      expect.objectContaining({ suppressesActivatedAbilitiesOfInstanceId: helm }),
    );
  });

  it("Solitary Companion creates its Spectral Shield only when its enter trigger resolves", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", resources: 2, hand: ["solitary companion|3"] }, { hero: "dorinthea" }],
    });

    g.play("solitary companion|3", { settle: false });
    g.passUntilLayer("Create a Spectral Shield token");
    expect(boardCount(g, 0, "spectral shield|0")).toBe(0);

    g.passPriority().passPriority();
    expect(boardCount(g, 0, "spectral shield|0")).toBe(1);
  });

  it("Solitary Companion does not trigger while you control another Illusionist aura", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 2, hand: ["solitary companion|3"], board: ["spectral shield|0"] },
        { hero: "dorinthea" },
      ],
    });

    g.play("solitary companion|3");
    expect(g.state.stack).toEqual([]);
    expect(boardCount(g, 0, "spectral shield|0")).toBe(1);
  });

  it("Waning Vengeance's leave trigger checks for a blue pitch and then resolves", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|3"] },
        { hero: "dorinthea", board: ["waning vengeance|3"] },
      ],
    });
    g.state.players[1]!.flags["pitchedPitch:3"] = 1;

    g.play("raging onslaught|3").blockWith().settle();
    const ward = g.state.pendingDecision!;
    g.doRaw({ kind: "choose", optionId: ward.options!.find((option) => option.includes("destroy"))! });
    g.passUntilLayer("Create a Spectral Shield token");
    g.expectInZone(1, "waning vengeance|3", "graveyard");
    expect(boardCount(g, 1, "spectral shield|0")).toBe(0);

    g.passPriority().passPriority();
    expect(boardCount(g, 1, "spectral shield|0")).toBe(1);
  });

  it("Haze Bending and Waning Vengeance shields arrive after the damage that destroyed their sources", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|1"] },
        {
          hero: "dorinthea",
          board: ["haze bending|3", "waxing specter|2", "waning vengeance|1", "waxing specter|3"],
        },
      ],
    });
    g.state.players[1]!.flags["pitchedPitch:3"] = 1;
    const wards = g.state.players[1]!.board.slice(1).map((card) => card.instanceId);

    g.play("raging onslaught|1").blockWith().settle();
    for (const id of wards) {
      const decision = g.state.pendingDecision!;
      expect(decision.chooseHook).toBe("ward");
      expect(decision.cardOptions).toEqual(wards.filter((ward) => ward >= id));
      g.doRaw({ kind: "choose", optionId: `destroy ${id}` });
    }

    // 7 damage against Ward 2 + 3 + 1: the last point is dealt.
    g.expectLife(1, 19);
    expect(boardCount(g, 1, "spectral shield|0")).toBe(0);
    expect(g.state.pendingDecision?.kind).toBe("order-triggers");
    expect(g.state.pendingDecision?.optionLabels).toEqual([
      "Create a Spectral Shield token",
      "Create a Spectral Shield token",
    ]);

    g.settle();
    // Haze Bending triggers once per turn; Waning Vengeance adds the second.
    expect(boardCount(g, 1, "spectral shield|0")).toBe(2);
  });

  it("Haze Bending creates a Spectral Shield when it is destroyed itself", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", board: ["haze bending|3"] },
      ],
    });

    g.play("snatch|1", { targetAlly: "haze bending|3" });
    g.expectInZone(1, "haze bending|3", "graveyard");
    expect(boardCount(g, 1, "spectral shield|0")).toBe(1);
  });

  it("a Ward source created while Ward prevents damage cannot prevent that damage", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|1"] },
        { hero: "dorinthea", equipment: { arms: "wave of reality|0" } },
      ],
    });
    const wave = g.state.players[1]!.equipment.arms!;

    g.play("raging onslaught|1").blockWith().settle();
    expect(g.state.pendingDecision?.cardOptions).toEqual([wave.instanceId]);
    g.doRaw({ kind: "choose", optionId: `destroy ${wave.instanceId}` });

    g.settle();
    g.expectLife(1, 14);
    expect(boardCount(g, 1, "spectral shield|0")).toBe(1);
  });

  it("Wave of Reality's Spectral Shield arrives through a layer after Ward destroys it", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, hand: ["raging onslaught|1"] },
        { hero: "dorinthea", equipment: { arms: "wave of reality|0" } },
      ],
    });
    const wave = g.state.players[1]!.equipment.arms!;

    g.play("raging onslaught|1").blockWith().settle();
    g.doRaw({ kind: "choose", optionId: `destroy ${wave.instanceId}` });
    g.passUntilLayer("Create a Spectral Shield token");
    g.expectInZone(1, "wave of reality|0", "graveyard");
    expect(boardCount(g, 1, "spectral shield|0")).toBe(0);

    g.passPriority().passPriority();
    expect(boardCount(g, 1, "spectral shield|0")).toBe(1);
  });

  for (const haze of ["phantasmal haze|1", "phantasmal haze|3"]) {
    it(`${haze}'s Spectral Shield arrives through a layer after Phantasm destroys it`, () => {
      const g = scenario({
        seats: [
          { hero: "rhinar", resources: 3, hand: [haze] },
          { hero: "dorinthea", hand: ["raging onslaught|1"] },
        ],
      });

      g.play(haze).blockWith("raging onslaught|1");
      g.passUntilLayer("Create a Spectral Shield token");
      g.expectInZone(0, haze, "graveyard");
      expect(g.state.chain).toHaveLength(0);
      expect(boardCount(g, 0, "spectral shield|0")).toBe(0);

      g.passPriority().passPriority();
      expect(g.state.stack).toEqual([]);
      expect(boardCount(g, 0, "spectral shield|0")).toBe(1);
    });
  }

  it("Phantasmal Haze's layer survives a choice raised by the same Phantasm pop", () => {
    const g = scenario({
      seats: [
        {
          hero: "rhinar",
          resources: 6,
          equipment: { legs: "silent stilettos|0" },
          hand: ["phantasmal haze|3"],
        },
        { hero: "dorinthea", hand: ["raging onslaught|1"] },
      ],
    });

    g.play("phantasmal haze|3").blockWith("raging onslaught|1");
    g.passPriority().passPriority();
    // Silent Stilettos' payment offer opens while the Haze trigger is pending.
    expect(g.state.pendingDecision?.chooseHook).toBe("stilettos-pay");
    g.doRaw({ kind: "choose", optionId: "pay 3" });
    g.expectInZone(0, "silent stilettos|0", "graveyard");
    g.passUntilLayer("Create a Spectral Shield token");
    expect(boardCount(g, 0, "spectral shield|0")).toBe(0);

    g.passPriority().passPriority();
    expect(boardCount(g, 0, "spectral shield|0")).toBe(1);
  });
});
