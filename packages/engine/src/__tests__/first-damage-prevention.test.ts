import { describe, expect, it } from "vitest";
import { engineRuntime } from "../engineRuntime.js";
import { projectOngoingEffects } from "../ongoingEffects.js";
import { makeGame, player } from "./fixtures.js";

function setup() {
  const state = makeGame(903);
  state.scriptsRef = {
    ...state.scriptsRef,
    HERO_B: {
      fixedDamagePrevention: {
        amount: 1,
        oncePerTurn: true,
        firstDamageEventEachTurn: true,
        condition: (ctx) => ctx.getFlag("player", "preventionEnabled") === true,
      },
    },
  };
  const target = player(state, 1);
  const damage = (amount: number, arcane = false, unpreventable = false) =>
    engineRuntime.commands.dealEffectDamage(state, {
      sourceInstanceId: player(state, 0).hero.instanceId,
      sourceSeat: 0,
      targetSeat: 1,
      amount,
      arcane,
      unpreventable,
    });
  return { state, target, damage };
}

describe("conditional first damage event prevention", () => {
  it.each([false, true])("prevents only the first event, including fully prevented damage (arcane: %s)", (arcane) => {
    const { target, damage } = setup();
    target.flags.preventionEnabled = true;
    damage(1, arcane);
    expect(target.life).toBe(20);
    damage(2, arcane);
    expect(target.life).toBe(18);
  });

  it.each(["ordinary", "prevented", "unpreventable"])("counts earlier %s damage even when the condition was false", (kind) => {
    const { target, damage } = setup();
    if (kind === "prevented") target.flags.preventNextDamage = 1;
    damage(1, false, kind === "unpreventable");
    const lifeAfterFirst = target.life;
    target.flags.preventionEnabled = true;
    damage(2, true);
    expect(target.life).toBe(lifeAfterFirst - 2);
  });

  it("counts an unpreventable first event even when the condition was true", () => {
    const { target, damage } = setup();
    target.flags.preventionEnabled = true;
    damage(1, false, true);
    damage(2);
    expect(target.life).toBe(17);
  });

  it("does not consume the first event on zero damage", () => {
    const { target, damage } = setup();
    target.flags.preventionEnabled = true;
    damage(0);
    damage(2);
    expect(target.life).toBe(19);
  });

  describe("lingering effect", () => {
    const shown = (state: ReturnType<typeof setup>["state"]) =>
      projectOngoingEffects(state, engineRuntime, 0).filter(
        (effect) => effect.summaryMessage?.id === "engine.effect.summary.prevent.first.damage",
      );

    it("appears only while the condition holds", () => {
      const { state, target } = setup();
      expect(shown(state)).toEqual([]);
      target.flags.preventionEnabled = true;
      expect(shown(state)).toEqual([expect.objectContaining({ seat: 1, cardId: "HERO_B", duration: "this turn" })]);
      expect(shown(state)[0]!.inactive).toBeUndefined();
    });

    it("turns inactive when the condition is met after an unprevented first event", () => {
      const { state, target, damage } = setup();
      damage(1);
      target.flags.preventionEnabled = true;
      expect(shown(state)).toEqual([expect.objectContaining({
        inactive: true,
        duration: "already dealt damage this turn",
        durationMessage: { id: "engine.effect.duration.first.damage.passed" },
      })]);
    });

    it("disappears once it has prevented damage", () => {
      const { state, target, damage } = setup();
      target.flags.preventionEnabled = true;
      damage(2);
      expect(shown(state)).toEqual([]);
    });
  });
});
