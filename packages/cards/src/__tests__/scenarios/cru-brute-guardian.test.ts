import { describe, expect, it } from "vitest";
import { legalIntents, projectStateFor } from "@fyendal/engine";
import { scenario } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function bruteSeat(heroKey: string, extra: Record<string, unknown> = {}) {
  return {
    hero: "rhinar" as const,
    heroKey,
    weapons: [],
    equipment: { ...NO_EQUIPMENT },
    ...extra,
  };
}

function guardianSeat(extra: Record<string, unknown> = {}) {
  return {
    hero: "rhinar" as const,
    heroKey: "bravo, showstopper|0",
    weapons: ["anothos|0"],
    equipment: { ...NO_EQUIPMENT },
    ...extra,
  };
}

function expectDominate(s: ReturnType<typeof scenario>, defender = 1): void {
  const defenses = legalIntents(s.state, defender).filter((intent) => intent.kind === "defend");
  expect(defenses.length).toBeGreaterThan(0);
  expect(defenses.every((intent) => intent.instanceIds.length <= 1)).toBe(true);
}

describe("CRU — Brute", () => {
  it("Rhinar intimidates after Swing Fist discards a 6+ card, and Romping Club gets +1", () => {
    const s = scenario({
      seats: [
        bruteSeat("rhinar, reckless rampage|0", {
          weapons: ["romping club|0"],
          hand: ["swing fist, think later|3", "raging onslaught|1"],
          resources: 3,
        }),
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
    });

    s.play("swing fist, think later|3")
      .expectPendingReturn(1, 1)
      .blockWith()
      .settle()
      .expectAP(0, 1)
      .attackWithWeapon("romping club|0")
      .expectAttackValue(5);
  });

  it("Kayo rolls to halve or double a base-6+ attack's base power", () => {
    const outcomes = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = scenario({
        seats: [
          bruteSeat("kayo, berserker runt|0", {
            hand: ["nimblism|1", "wartune herald|1"],
            resources: 3,
          }),
          { hero: "dorinthea", hand: [] },
        ],
        seed,
      });

      s.play("nimblism|1").play("wartune herald|1");
      const link = projectStateFor(s.state, 0).chain.find((candidate) => !candidate.resolved);
      expect(link).toBeDefined();
      // Kayo modifies Wartune Herald's odd base 7 (3 or 14), then
      // Nimblism's ordinary +3 is added — the total is not halved/doubled.
      expect([6, 17]).toContain(link!.attackValue);
      outcomes.add(link!.attackValue);
      const rollLog = s.state.log.find((entry) =>
        /Kayo, Berserker Runt: rolled [1-6]/.test(entry.publicText ?? ""),
      );
      expect(rollLog).toBeDefined();
      const roll = Number(/rolled ([1-6])/.exec(rollLog!.publicText ?? "")?.[1]);
      expect(link!.attackValue).toBe(roll <= 4 ? 6 : 17);
    }
    expect(outcomes).toEqual(new Set([6, 17]));
  });

  it("Barraging Big Horn has go again with fewer than 2 non-equipment defenders", () => {
    const oneDefender = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["barraging big horn|2", "raging onslaught|1"],
          resources: 2,
        },
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
    });
    oneDefender
      .play("barraging big horn|2")
      .blockWith("snatch|1")
      .settle()
      .expectAP(0, 1);

    const twoDefenders = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["barraging big horn|2", "raging onslaught|1"],
          resources: 2,
        },
        {
          hero: "dorinthea",
          hand: ["snatch|1", "raging onslaught|3"],
          equipment: { ...NO_EQUIPMENT },
        },
      ],
    });
    twoDefenders
      .play("barraging big horn|2")
      .blockWith("snatch|1", "raging onslaught|3")
      .settle()
      .expectAP(0, 0);
  });

  it("Predatory Assault gains dominate after a 6+ discard this turn", () => {
    const s = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["swing fist, think later|3", "raging onslaught|1"],
          arsenal: ["predatory assault|2"],
          resources: 3,
        },
        {
          hero: "dorinthea",
          hand: ["snatch|1", "raging onslaught|3"],
          equipment: { ...NO_EQUIPMENT },
        },
      ],
    });

    s.play("swing fist, think later|3")
      .blockWith()
      .settle()
      .play("predatory assault|2", { fromArsenal: true });
    expectDominate(s);
  });

  it("Riled Up gets +1 after a 6+ discard this turn", () => {
    const s = scenario({
      seats: [
        {
          hero: "dorinthea",
          hand: ["swing fist, think later|3", "raging onslaught|1"],
          arsenal: ["riled up|1"],
          resources: 4,
        },
        { hero: "dorinthea", hand: [] },
      ],
    });

    s.play("swing fist, think later|3")
      .blockWith()
      .settle()
      .play("riled up|1", { fromArsenal: true })
      .expectAttackValue(8);
  });
});

describe("CRU — Guardian", () => {
  it("Bravo gives cost-3+ attack action cards dominate", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["raging onslaught|3"], resources: 5 }),
        {
          hero: "dorinthea",
          hand: ["snatch|1", "raging onslaught|3"],
          equipment: { ...NO_EQUIPMENT },
        },
      ],
    });

    s.activate("bravo, showstopper|0").play("raging onslaught|3");
    expectDominate(s);
  });

  it("Anothos gets +2 with 2 cost-3+ cards in pitch", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["crush the weak|1", "crush the weak|2"] }),
        { hero: "dorinthea", hand: [] },
      ],
    });

    s.attackWithWeapon("anothos|0", {
      pitch: ["crush the weak|1", "crush the weak|2"],
    }).expectAttackValue(6);
  });

  it("Chokeslam's hero-only crush effect does not trigger from hitting an ally", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["chokeslam|2"], resources: 4 }),
        { hero: "dorinthea", hand: [], board: ["barnacle|2"] },
      ],
    });

    s.play("chokeslam|2", { targetAlly: "barnacle|2" });
    expect(
      s.state.players[1]!.hero.counters?.attackActionNoPowerGainUntilTurn,
    ).toBeUndefined();
  });

  it("Towering Titan destroys itself next action phase and buffs the next Guardian attack", () => {
    const s = scenario({
      seats: [
        guardianSeat({
          hand: ["towering titan|3", "crush the weak|3", "crush confidence|3"],
          resources: 9,
        }),
        { hero: "dorinthea", hand: [] },
      ],
    });

    s.play("towering titan|3")
      .expectInZone(0, "towering titan|3", "board")
      .expectZoneSize(0, "board", 1)
      .expectZoneSize(0, "graveyard", 0)
      .endTurn()
      .endTurn()
      .expectNotInZone(0, "towering titan|3", "board")
      .play("crush the weak|3", { pitch: ["crush confidence|3"] })
      .expectAttackValue(13);
  });

  it("Emerging Dominance buffs and grants dominate to the next Guardian attack", () => {
    const s = scenario({
      seats: [
        guardianSeat({
          hand: ["emerging dominance|2", "crush the weak|3", "crush confidence|3"],
          resources: 2,
        }),
        {
          hero: "dorinthea",
          hand: ["snatch|1", "raging onslaught|3"],
          equipment: { ...NO_EQUIPMENT },
        },
      ],
    });

    s.play("emerging dominance|2")
      .expectInZone(0, "emerging dominance|2", "board")
      .expectZoneSize(0, "board", 1)
      .endTurn()
      .endTurn()
      .play("crush the weak|3", { pitch: ["crush confidence|3"] })
      .expectAttackValue(7);
    expectDominate(s);
  });

  it("Crush the Weak prohibits low-base-power attacks in the next action phase", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["crush the weak|1"], resources: 3 }),
        { hero: "dorinthea", hand: ["head jab|3"] },
      ],
    });

    s.play("crush the weak|1")
      .blockWith()
      .settle()
      .endTurn()
      .expectNoLegalPlay("head jab|3");
  });

  it("Chokeslam stops attack action cards gaining power in the next action phase", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["chokeslam|2"], resources: 4 }),
        { hero: "dorinthea", hand: ["nimblism|1", "snatch|1"] },
      ],
    });

    s.play("chokeslam|2")
      .blockWith()
      .settle()
      .endTurn()
      .play("nimblism|1")
      .play("snatch|1")
      .expectAttackValue(4);
  });

  it("Blessing of Serenity prevents physical damage", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["blessing of serenity|1"] }),
        { hero: "dorinthea", hand: ["snatch|1"] },
      ],
      active: 1,
    });

    s.play("snatch|1", { settle: false })
      .passPriority()
      .react("blessing of serenity|1")
      .blockWith()
      .settle()
      .expectLife(0, 39); // Bravo 40, 4 physical damage with 3 prevented
  });

  it("Blessing of Serenity ignores arcane damage", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["blessing of serenity|1"] }),
        { hero: "dorinthea", hand: ["zap|1"] },
      ],
      active: 1,
    });

    s.play("zap|1", { settle: false })
      .passPriority()
      .react("blessing of serenity|1")
      .chooseOption("opposing hero")
      .expectLife(0, 37);
  });

  it("Blessing of Serenity expires after the next physical damage source", () => {
    const s = scenario({
      seats: [
        guardianSeat({ hand: ["blessing of serenity|1"] }),
        { hero: "dorinthea", hand: ["head jab|3", "snatch|1"] },
      ],
      active: 1,
    });

    s.play("head jab|3", { settle: false })
      .passPriority()
      .react("blessing of serenity|1")
      .blockWith()
      .settle()
      .play("snatch|1")
      .blockWith()
      .settle()
      .expectLife(0, 36);
  });
});
