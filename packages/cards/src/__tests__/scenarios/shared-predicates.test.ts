import { describe, expect, it } from "vitest";
import {
  anyDamageTarget,
  anyTargetChoice,
  bothHeroSeats,
  cardNameContains,
  controlledPermanents,
  crushTriggered,
  dealArcaneToAnyTargetChoice,
  dealToAnyTarget,
  defendsTogetherWithCardFromHand,
  duringActionPhase,
  effectiveCardName,
  equipmentZoneCards,
  equippedCards,
  faceUpGraveyard,
  heroHasMoniker,
  heroTarget,
  hitWithDaggerThisChain,
  isAttackAction,
  isCard,
  isNonAttackAction,
  isOnCombatChain,
  isOwnAttack,
  previousAttackHasName,
  previousAttackNameContains,
  requestAnyTargetChoice,
  requestHeroChoice,
  sharesName,
  targetHeroSeat,
  upToOneTargetAttack,
} from "../../scripts/shared-helpers.js";
import { fakeCtx, fakePlayer, type FakeCard } from "../fakeCtx.js";

describe("effectiveCardName", () => {
  const cardData = {
    FRONT: { name: "Front Face", backId: "BACK" },
    BACK: { name: "Back Face" },
  };
  const nameOf = (card: FakeCard) => effectiveCardName(fakeCtx({ cardData }).ctx, card as never);

  it.each([
    ["keeps the printed name", { instanceId: 1, cardId: "FRONT", names: ["Front Face"] }, "Front Face"],
    ["uses the active back face", { instanceId: 1, cardId: "FRONT", flipped: true, names: ["Back Face"] }, "Back Face"],
    ["falls back to a name gained by an effect", { instanceId: 1, cardId: "FRONT", names: ["Gained"] }, "gained"],
    ["has no name while its names are suppressed", { instanceId: 1, cardId: "FRONT", names: [] }, undefined],
  ])("%s", (_case, card, expected) => {
    expect(nameOf(card)).toBe(expected);
  });

});

describe("names", () => {
  const { ctx } = fakeCtx({ cardData: { A: { name: "Wild Ride", pitch: 1 } } });

  it("cardNameContains matches whole words across every effective name", () => {
    const card = { instanceId: 1, names: ["Crouching Tiger", "Lunging Press"] } as never;
    expect(cardNameContains(ctx, card, "tiger")).toBe(true);
    expect(cardNameContains(ctx, card, "lunging press")).toBe(true);
    expect(cardNameContains(ctx, card, "tig")).toBe(false);
    expect(cardNameContains(ctx, card, "tiger lunging")).toBe(false);
  });

  it("sharesName compares effective names", () => {
    expect(sharesName(ctx, { instanceId: 1, names: ["A", "B"] } as never, { instanceId: 2, names: ["b"] } as never)).toBe(true);
    expect(sharesName(ctx, { instanceId: 1, names: [] } as never, { instanceId: 2, names: [] } as never)).toBe(false);
  });

  it("isCard compares functional identity, so any printing matches", () => {
    expect(isCard(ctx, "A", "wild ride", 1)).toBe(true);
    expect(isCard(ctx, "A", "Wild Ride", 2)).toBe(false);
  });

  it("heroHasMoniker ignores the suffix after the comma", () => {
    const named = (name: string) => fakeCtx({ cardData: { HERO0: { name } } }).ctx;
    expect(heroHasMoniker(named("Arakni, Marionette"), 0, "arakni")).toBe(true);
    expect(heroHasMoniker(named("Arakni, Marionette"), 0, "marionette")).toBe(false);
    expect(heroHasMoniker(named("Young Levia"), 0, "levia")).toBe(true);
  });

  it("previous-attack names read the latest resolved link", () => {
    const link = (names: string[], resolved: boolean) => ({ resolved, attackingCard: { instanceId: 1, names } });
    const { ctx: c } = fakeCtx({ chain: [link(["Old Strike"], true), link(["New Strike"], true), link(["Active"], false)] });
    expect(previousAttackHasName(c, "New Strike")).toBe(true);
    expect(previousAttackHasName(c, "Old Strike", "Active")).toBe(false);
    expect(previousAttackNameContains(c, "strike")).toBe(true);
    expect(previousAttackHasName(fakeCtx().ctx, "anything")).toBe(false);
  });
});

describe("card type predicates", () => {
  const { ctx } = fakeCtx();
  it.each([
    [{ cardTypes: ["action"], types: ["attack"] }, true, false],
    [{ cardTypes: ["action"], types: [] }, false, true],
    [{ cardTypes: ["instant"], types: ["attack"] }, false, false],
  ])("%j: attack action %s, non-attack action %s", (card, attack, nonAttack) => {
    expect(isAttackAction(ctx, { instanceId: 1, ...card } as never)).toBe(attack);
    expect(isNonAttackAction(ctx, { instanceId: 1, ...card } as never)).toBe(nonAttack);
  });
});

describe("zones", () => {
  const weapon = { instanceId: 20, cardTypes: ["weapon"] };
  const equipmentWeapon = { instanceId: 21, cardTypes: ["weapon", "equipment"] };
  const head = { instanceId: 30, cardTypes: ["equipment"] };
  const ally = { instanceId: 40, types: ["ally"] };
  const players = [
    fakePlayer(0, {
      weapons: [weapon, equipmentWeapon],
      equipment: { head },
      board: [ally],
      graveyard: [{ instanceId: 50 }, { instanceId: 51, faceDown: true }],
    }),
    fakePlayer(1),
  ];
  const { ctx } = fakeCtx({ players, seat: 0 });

  it("equippedCards adds equipment-typed weapons to the equipment zones", () => {
    expect(equipmentZoneCards(players[0]! as never).map((card) => card.instanceId)).toEqual([30]);
    expect(equippedCards(ctx, 0).map((card) => card.instanceId)).toEqual([30, 21]);
    expect(equippedCards(ctx, 1)).toEqual([]);
  });

  it("controlledPermanents covers board, weapons and equipment", () => {
    expect(controlledPermanents(ctx).map((card) => card.instanceId)).toEqual([40, 20, 21, 30]);
  });

  it("faceUpGraveyard hides face-down cards", () => {
    expect(faceUpGraveyard(ctx).map((card) => card.instanceId)).toEqual([50]);
  });

  it("bothHeroSeats lists the controller first", () => {
    expect(bothHeroSeats(fakeCtx({ seat: 1 }).ctx)).toEqual([1, 0]);
  });
});

describe("combat chain predicates", () => {
  const link = (spec: Record<string, unknown>) => ({
    attacker: 0,
    resolved: false,
    hit: true,
    damage: 4,
    flags: {},
    attackingCard: { instanceId: 1 },
    defendingCards: [],
    defendingEquipment: [],
    reactions: [],
    ...spec,
  });

  it.each([
    ["4 damage to a hero", link({}), true],
    ["3 damage", link({ damage: 3 }), false],
    ["an ally target", link({ targetAllyId: 9 }), false],
    ["no hit", link({ hit: false }), false],
    ["no link", undefined, false],
  ])("crushTriggered: %s → %s", (_case, active, expected) => {
    expect(crushTriggered(fakeCtx({ link: active }).ctx)).toBe(expected);
  });

  it("isOwnAttack needs an unresolved attack by this seat", () => {
    expect(isOwnAttack(fakeCtx({ link: link({}) }).ctx)).toBe(true);
    expect(isOwnAttack(fakeCtx({ link: link({ resolved: true }) }).ctx)).toBe(false);
    expect(isOwnAttack(fakeCtx({ link: link({ attacker: 1 }) }).ctx)).toBe(false);
  });

  it("isOnCombatChain finds attacks, defenders and reactions", () => {
    const { ctx } = fakeCtx({ chain: [link({ defendingEquipment: [{ instanceId: 5 }], reactions: [{ instanceId: 6 }] })] });
    expect([1, 5, 6, 7].map((id) => isOnCombatChain(ctx, id))).toEqual([true, true, true, false]);
  });

  it("defendsTogetherWithCardFromHand discounts this card's own hand defense", () => {
    const flags = (count: number, self: boolean) => ({ defendedFromHandCount: count, ...(self ? { "defendedFromHand:1": true } : {}) });
    expect(defendsTogetherWithCardFromHand(fakeCtx({ link: link({ flags: flags(1, true) }) }).ctx)).toBe(false);
    expect(defendsTogetherWithCardFromHand(fakeCtx({ link: link({ flags: flags(2, true) }) }).ctx)).toBe(true);
    expect(defendsTogetherWithCardFromHand(fakeCtx({ link: link({ flags: flags(1, false) }) }).ctx)).toBe(true);
  });

  it("hitWithDaggerThisChain counts dagger hits and dagger effect damage on own links", () => {
    const dagger = { instanceId: 1, types: ["dagger"] };
    expect(hitWithDaggerThisChain(fakeCtx({ chain: [link({ attackingCard: dagger })] }).ctx)).toBe(true);
    expect(hitWithDaggerThisChain(fakeCtx({ chain: [link({ attackingCard: dagger, damage: 0 })] }).ctx)).toBe(false);
    expect(hitWithDaggerThisChain(fakeCtx({ chain: [link({ damage: 0, flags: { "effectDamageBySubtype:dagger": 1 } })] }).ctx))
      .toBe(true);
    expect(hitWithDaggerThisChain(fakeCtx({ chain: [link({ attacker: 1, attackingCard: dagger })] }).ctx)).toBe(false);
  });

  it.each([
    ["action", undefined, true],
    ["reaction", undefined, true],
    ["layer", "begin-action-phase", false],
    ["layer", "end-phase", false],
    ["layer", undefined, true],
    ["end", undefined, false],
  ])("duringActionPhase: phase %s, resuming %s → %s", (phase, stackResume, expected) => {
    const { ctx } = fakeCtx();
    Object.assign(ctx.state, { phase, stackResume });
    expect(duringActionPhase(ctx)).toBe(expected);
  });
});

describe("hero and any-target choices", () => {
  it("requestHeroChoice offers both heroes, defaulting as asked", () => {
    const { ctx, called } = fakeCtx();
    requestHeroChoice(ctx, "hook", "Choose", "id", { defaultOption: "your hero" });
    const [hook, prompt, options, chooser, cardOptions, defaultOption] = called("requestChoice")[0]!;
    expect([hook, options, chooser, cardOptions, defaultOption]).toEqual(["hook", ["opposing hero", "your hero"], undefined, undefined, "your hero"]);
    expect(Object.keys((prompt as { optionMessagesByValue: object }).optionMessagesByValue)).toEqual(["opposing hero", "your hero"]);
  });

  it("requestHeroChoice narrows to eligible seats and offers pass first when optional", () => {
    const { ctx, called } = fakeCtx({ seat: 1 });
    requestHeroChoice(ctx, "hook", "Choose", "id", { seats: [0], optional: true });
    expect(called("requestChoice")[0]?.[2]).toEqual(["pass", "opposing hero"]);
  });

  it("requestAnyTargetChoice lists heroes then every ally, previewing this source's damage", () => {
    const players = [fakePlayer(0, { board: [{ instanceId: 2, types: ["ally"] }] }), fakePlayer(1, { board: [{ instanceId: 4, types: ["ally"] }, { instanceId: 5 }] })];
    const { ctx, called } = fakeCtx({ players, returns: { previewArcaneDamage: (amount: number) => amount + 1 } });
    requestAnyTargetChoice(ctx, "hook", 2, { sourceInstanceId: 9 });

    expect(called("previewArcaneDamage")).toEqual([[2, { sourceInstanceId: 9 }]]);
    const [, prompt, options, chooser, cardOptions, defaultOption] = called("requestChoice")[0]!;
    expect(options).toEqual(["opposing hero", "your hero", "ally:0:2", "ally:1:4"]);
    expect([chooser, cardOptions, defaultOption]).toEqual([0, [null, null, 2, 4], "opposing hero"]);
    expect((prompt as { message: { values: { amount: number } } }).message.values.amount).toBe(3);
  });

  it("requestAnyTargetChoice with heroesOnly offers no allies", () => {
    const players = [fakePlayer(0), fakePlayer(1, { board: [{ instanceId: 4, types: ["ally"] }] })];
    const { ctx, called } = fakeCtx({ players, returns: { previewArcaneDamage: (amount: number) => amount } });
    requestAnyTargetChoice(ctx, "hook", 1, { heroesOnly: true, optional: true });
    expect(called("requestChoice")[0]?.[2]).toEqual(["no", "opposing hero", "your hero"]);
    expect((called("requestChoice")[0]?.[1] as { message: { id: string } }).message.id).toBe("card.common.arcane.hero.choose");
  });

  it("anyTargetChoice and dealArcaneToAnyTargetChoice resolve allies, heroes and a decline", () => {
    const { ctx, called } = fakeCtx();
    expect(anyTargetChoice(ctx, "ally:1:4")).toEqual({ seat: 1, allyId: 4 });
    expect(anyTargetChoice(ctx, "your hero")).toEqual({ seat: 0 });
    expect(dealArcaneToAnyTargetChoice(ctx, "no", 3)).toBeUndefined();
    dealArcaneToAnyTargetChoice(ctx, "ally:1:4", 3);
    expect(called("dealDamage")).toEqual([[1, 3, { arcane: true, targetAllyId: 4 }]]);
  });
});

describe("trigger targets", () => {
  const players = [
    fakePlayer(0, { board: [{ instanceId: 2, types: ["ally"] }] }),
    fakePlayer(1, { board: [{ instanceId: 4, types: ["ally"] }] }),
  ];

  it("heroTarget lists eligible heroes and is optional only when asked", () => {
    const { ctx } = fakeCtx({ players });
    expect(heroTarget().options(ctx)).toEqual([100, 101]);
    expect(heroTarget({ eligible: (_ctx, seat) => seat === 1 }).options(ctx)).toEqual([101]);
    expect(heroTarget().optional).toBeUndefined();
    expect(heroTarget({ optional: true }).optional).toBe(true);
  });

  it("targetHeroSeat reads the declared hero", () => {
    expect(targetHeroSeat(fakeCtx({ players, props: { playTargetInstanceId: 101 } }).ctx)).toBe(1);
    expect(targetHeroSeat(fakeCtx({ players, props: { playTargetInstanceId: undefined } }).ctx)).toBeUndefined();
  });

  it("anyDamageTarget declares heroes and allies, opposing-only and optional when asked", () => {
    const { ctx } = fakeCtx({ players });
    const prompt = () => "prompt";
    expect(anyDamageTarget(prompt).options(ctx)).toEqual([100, 2, 101, 4]);
    const opposing = anyDamageTarget(prompt, { opposing: true, optional: true });
    expect(opposing.options(ctx)).toEqual([101, 4]);
    expect(opposing.optional).toBe(true);
  });

  it("dealToAnyTarget hits a hero or an ally still in the arena", () => {
    const { ctx, called } = fakeCtx({ players, returns: { dealDamage: (_seat: number, amount: number) => amount } });
    expect(dealToAnyTarget(ctx, 101, 2)).toBe(2);
    expect(dealToAnyTarget(ctx, 4, 1, { arcane: true })).toBe(1);
    expect(dealToAnyTarget(ctx, 99, 1)).toBe(0);
    expect(dealToAnyTarget(ctx, undefined, 1)).toBe(0);
    expect(called("dealDamage")).toEqual([[1, 2, {}], [1, 1, { arcane: true, targetAllyId: 4 }]]);
  });

  it("upToOneTargetAttack skips attacks that ceased to be attacks and is optional", () => {
    const chain = [
      { flags: {}, attackingCard: { instanceId: 1 } },
      { flags: { attackGone: true }, attackingCard: { instanceId: 2 } },
      { flags: {}, attackingCard: { instanceId: 3 } },
    ];
    const { ctx } = fakeCtx({ chain });
    const target = upToOneTargetAttack((_ctx, attack) => attack.instanceId !== 3);
    expect(target.options(ctx)).toEqual([1]);
    expect(target.optional).toBe(true);
  });
});
