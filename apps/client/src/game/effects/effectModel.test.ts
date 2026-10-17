import type { OngoingEffectView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { createTestIntl } from "../../i18n/TestI18nProvider.js";
import { effectLifetime, effectImposed, effectText, splitByPlacement, stackOngoingEffects } from "./effectModel.js";

const effect = (overrides: Partial<OngoingEffectView>): OngoingEffectView => ({
  seat: 0,
  cardId: "WTR160",
  label: "+1 attack · next attack",
  ...overrides,
});

describe("stackOngoingEffects", () => {
  it("collapses only effects with the same seat, card, label, and source", () => {
    const effects = [
      effect({}),
      effect({}),
      effect({ label: "Go again · next attack" }),
      effect({ cardId: "WTR161" }),
      effect({ seat: 1 }),
      effect({ sourceSeat: 1 }),
    ];

    expect(stackOngoingEffects(effects).map(({ effect: e, count }) => ({ e, count }))).toEqual([
      { e: effects[0], count: 2 },
      { e: effects[2], count: 1 },
      { e: effects[3], count: 1 },
      { e: effects[4], count: 1 },
      { e: effects[5], count: 1 },
    ]);
  });
});

describe("effectLifetime", () => {
  it("prefers the projected lifetime", () => {
    expect(effectLifetime(effect({ lifetime: "game", label: "x · this turn" }))).toBe("game");
  });

  it("infers a lifetime from legacy labels", () => {
    expect(effectLifetime(effect({ label: "+1 attack · next attack" }))).toBe("once");
    expect(effectLifetime(effect({ label: "x · next red action card" }))).toBe("once");
    expect(effectLifetime(effect({ label: "x · this combat chain" }))).toBe("chain");
    expect(effectLifetime(effect({ label: "x · this turn" }))).toBe("turn");
    expect(effectLifetime(effect({ label: "x · next turn" }))).toBe("later");
    expect(effectLifetime(effect({ label: "x · next action phase" }))).toBe("later");
    expect(effectLifetime(effect({ label: "no duration" }))).toBe("turn");
  });
});

describe("effect placement", () => {
  it("pins rest-of-game effects to the hero and orders the slot by lifetime", () => {
    const later = effect({ label: "a · next turn", lifetime: "later" });
    const once = effect({ label: "b · next attack", lifetime: "once" });
    const game = effect({ label: "c · rest of the game", lifetime: "game", sourceSeat: 1 });

    const { slot, pins } = splitByPlacement([later, game, once]);
    expect(slot.map((stack) => stack.effect)).toEqual([once, later]);
    expect(pins.map((stack) => stack.effect)).toEqual([game]);
    expect(effectImposed(game)).toBe(true);
    expect(effectImposed(once)).toBe(false);
  });
});

describe("effectText", () => {
  const draconicDiscount = effect({
    label: "+2 attack, costs 1 less to play or activate · next Draconic attack this combat chain",
    summaryMessage: {
      id: "engine.effect.summary.list.two",
      values: {
        attack: "+2",
        cost: 1,
        costChange: "less",
        costAction: "both",
        part0: { kind: "term", id: "engine.effect.part.attack" },
        part1: { kind: "term", id: "engine.effect.part.cost" },
      },
    },
    durationMessage: {
      id: "engine.effect.duration.next.subject.this.chain",
      values: {
        noun: "attack",
        typeCount: 1,
        type1: "Draconic",
        color: "any",
        via: "none",
        keyword: "none",
        limit: "none",
        target: "none",
        subject: { kind: "term", id: "engine.effect.subject.one" },
      },
    },
  });

  it("renders composed summaries and qualified durations in English", () => {
    expect(effectText(createTestIntl("en"), draconicDiscount)).toEqual({
      summary: "+2 power, costs 1 less to play or activate",
      duration: "next Draconic attack this combat chain",
    });
  });

  it("renders them in Chinese with the established terminology", () => {
    expect(effectText(createTestIntl("zh-Hans"), draconicDiscount)).toEqual({
      summary: "+2 力量，打出或启动费用减少 1 点",
      duration: "本次战斗链中下一次 龙族 (Draconic) 攻击",
    });
  });

  it("renders them in Brazilian Portuguese with gender agreement", () => {
    expect(effectText(createTestIntl("pt-BR"), draconicDiscount)).toEqual({
      summary: "+2 de poder, custa 1 a menos para jogar ou ativar",
      duration: "próximo ataque Draconic nesta combat chain",
    });
    expect(effectText(createTestIntl("pt-BR"), effect({
      durationMessage: {
        id: "engine.effect.duration.next.subject",
        values: {
          noun: "actionCard",
          typeCount: 0,
          color: "red",
          via: "arsenal",
          keyword: "none",
          limit: "none",
          target: "none",
          subject: { kind: "term", id: "engine.effect.subject.one" },
        },
      },
    })).duration).toBe("próxima carta de action vermelha do arsenal");
  });

  it("renders a plural subject with every qualifier in card-text order", () => {
    const stealthBlades = effect({
      durationMessage: {
        id: "engine.effect.duration.subject.this.turn",
        values: {
          noun: "attack",
          typeCount: 2,
          type1: "sword",
          type2: "dagger",
          color: "red",
          via: "none",
          keyword: "stealth",
          limit: "costMax",
          limitValue: 2,
          target: "none",
          subject: { kind: "term", id: "engine.effect.subject.other" },
        },
      },
    });

    expect(effectText(createTestIntl("en"), stealthBlades).duration)
      .toBe("red sword or dagger attacks with stealth with cost 2 or less this turn");
    expect(effectText(createTestIntl("pt-BR"), stealthBlades).duration)
      .toBe("ataques sword ou dagger vermelhos com stealth com custo 2 ou menos neste turno");
  });
});
