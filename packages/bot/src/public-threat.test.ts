import { cardData, decklists, scripts } from "@fyendal/cards";
import { createGame, projectStateFor } from "@fyendal/engine";
import type { CardView, ChainLinkView } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import type { BotPolicyInput } from "./policy.js";
import { publicCombatThreat, threatenedAttackDamage } from "./public-threat.js";

const ZEPPELIN_BLUE = "SEA020";
const DOVETAIL = "SEA011";
const BACKSPIN_THRUST = "SUP254";
const VOLTIC_IMPACT = "OMN154";
const BLUNDERBUSS = "SEA006";
const GOLDEN_COG = "SEA042";
const CONCEALED_OBJECT = "SLY031";
const AMETHYST_AMULET = "SEA189";
const FLICK_KNIVES = "OUT139";
const DAGGER = "AAC002";
const SPARK_SPRAY = "AST015";

let nextId = 70_000;

function card(cardId: string, extra: Partial<CardView> = {}): CardView {
  return { instanceId: nextId++, cardId, owner: 1, ...extra };
}

function threatFixture(options: {
  attacking: CardView;
  board?: CardView[];
  weapons?: CardView[];
  arms?: CardView;
  handCount?: number;
  resources?: number;
  link?: Partial<ChainLinkView>;
}): BotPolicyInput {
  const state = createGame({
    decklists: [decklists.dorinthea, decklists.rhinar],
    cards: cardData,
    scripts,
    seed: 4_711,
    startPlayer: 1,
  });
  const view = projectStateFor(state, 0);
  const attacker = view.players[1];
  attacker.board = options.board ?? [];
  attacker.weapons = options.weapons ?? [];
  attacker.equipment = options.arms ? { arms: options.arms } : {};
  attacker.arsenal = [];
  attacker.arsenalCount = 0;
  attacker.handCount = options.handCount ?? 0;
  attacker.resources = options.resources ?? 0;
  const attack = cardData[options.attacking.cardId]?.attack ?? 0;
  view.chain = [{
    attackingCard: options.attacking,
    defendingCards: [],
    attackValue: attack,
    defenseValue: 0,
    damage: attack,
    resolved: false,
    reactions: [],
    ...options.link,
  }];
  return { seat: 0, view, legal: [], cards: cardData };
}

const cogs = (count: number, tapped = false) =>
  Array.from({ length: count }, () => card(GOLDEN_COG, tapped ? { tapped: true } : {}));

describe("public combat threat", () => {
  it("counts each untapped cog the attack can still tap for power", () => {
    for (const [cogCount, bonus] of [[0, 0], [1, 1], [2, 2], [3, 2]] as const) {
      const input = threatFixture({ attacking: card(ZEPPELIN_BLUE), board: cogs(cogCount) });
      expect(publicCombatThreat(input)).toEqual({ attackBonus: bonus, directDamage: 0 });
    }
    const dovetail = threatFixture({ attacking: card(DOVETAIL), board: cogs(4) });
    expect(publicCombatThreat(dovetail).attackBonus).toBe(3);
  });

  it("subtracts activations already used this turn and ignores tapped cogs", () => {
    const partlyUsed = threatFixture({
      attacking: card(ZEPPELIN_BLUE, { remainingAbilityActivations: [1] }),
      board: cogs(2),
    });
    expect(publicCombatThreat(partlyUsed).attackBonus).toBe(1);
    const spent = threatFixture({
      attacking: card(ZEPPELIN_BLUE, { usedAbilityIndexes: [0] }),
      board: cogs(2),
    });
    expect(publicCombatThreat(spent).attackBonus).toBe(0);
    const tapped = threatFixture({ attacking: card(ZEPPELIN_BLUE), board: cogs(2, true) });
    expect(publicCombatThreat(tapped).attackBonus).toBe(0);
  });

  it("untaps tapped cogs for abilities that cost {u}", () => {
    const input = threatFixture({ attacking: card(BACKSPIN_THRUST), board: cogs(1, true) });
    expect(publicCombatThreat(input).attackBonus).toBe(1);
  });

  it("counts board sources that pump any attack but not next-attack effects", () => {
    const pump = threatFixture({ attacking: card(ZEPPELIN_BLUE), board: [card(CONCEALED_OBJECT)] });
    expect(publicCombatThreat(pump).attackBonus).toBe(1);
    const tapped = threatFixture({
      attacking: card(ZEPPELIN_BLUE),
      board: [card(CONCEALED_OBJECT, { tapped: true })],
    });
    expect(publicCombatThreat(tapped).attackBonus).toBe(0);
    const amulet = threatFixture({ attacking: card(ZEPPELIN_BLUE), board: [card(AMETHYST_AMULET)] });
    expect(publicCombatThreat(amulet).attackBonus).toBe(0);
  });

  it("ignores abilities that do not pump the current attack", () => {
    const input = threatFixture({
      attacking: card(ZEPPELIN_BLUE, { usedAbilityIndexes: [0] }),
      weapons: [card(BLUNDERBUSS)],
      board: cogs(2),
    });
    expect(publicCombatThreat(input).attackBonus).toBe(0);
  });

  it("funds resource pumps from floating resources and hidden hand pitch", () => {
    const floating = threatFixture({ attacking: card(VOLTIC_IMPACT), resources: 1 });
    expect(publicCombatThreat(floating).attackBonus).toBe(1);
    const pitched = threatFixture({ attacking: card(VOLTIC_IMPACT), handCount: 1 });
    expect(publicCombatThreat(pitched).attackBonus).toBe(2);
    const empty = threatFixture({ attacking: card(VOLTIC_IMPACT) });
    expect(publicCombatThreat(empty).attackBonus).toBe(0);
  });

  it("counts Spark Spray's paid pump only for a block that defends it", () => {
    const input = threatFixture({ attacking: card(SPARK_SPRAY), resources: 1 });
    expect(publicCombatThreat(input).attackBonus).toBe(0);
    expect(publicCombatThreat(input, true).attackBonus).toBe(1);
    const broke = threatFixture({ attacking: card(SPARK_SPRAY) });
    expect(publicCombatThreat(broke, true).attackBonus).toBe(0);
    const defended = threatFixture({
      attacking: card(SPARK_SPRAY),
      resources: 1,
      link: { defendingCards: [card(DAGGER)] },
    });
    expect(publicCombatThreat(defended, true).attackBonus).toBe(0);
  });

  it("counts an unused Flick Knives with a dagger off the active chain link", () => {
    const ready = threatFixture({
      attacking: card(ZEPPELIN_BLUE),
      arms: card(FLICK_KNIVES),
      weapons: [card(DAGGER)],
    });
    expect(publicCombatThreat(ready)).toEqual({ attackBonus: 0, directDamage: 1 });

    const used = threatFixture({
      attacking: card(ZEPPELIN_BLUE),
      arms: card(FLICK_KNIVES, { usedAbilityIndexes: [0] }),
      weapons: [card(DAGGER)],
    });
    expect(publicCombatThreat(used).directDamage).toBe(0);

    const attackingDagger = card(DAGGER);
    const onChain = threatFixture({
      attacking: attackingDagger,
      arms: card(FLICK_KNIVES),
      weapons: [attackingDagger],
    });
    expect(publicCombatThreat(onChain).directDamage).toBe(0);

    const noDagger = threatFixture({ attacking: card(ZEPPELIN_BLUE), arms: card(FLICK_KNIVES) });
    expect(publicCombatThreat(noDagger).directDamage).toBe(0);
  });

  it("lets existing overblocking absorb pumps but not direct damage", () => {
    const input = threatFixture({
      attacking: card(ZEPPELIN_BLUE),
      board: cogs(2),
      arms: card(FLICK_KNIVES),
      weapons: [card(DAGGER)],
      link: { defenseValue: 5, damage: 0 },
    });
    // 4 power + 2 pumps against 5 defense leaves 1, plus Flick Knives.
    expect(threatenedAttackDamage(input)).toBe(2);
  });

  it("does not threaten the hero when an ally is attacked", () => {
    const input = threatFixture({
      attacking: card(ZEPPELIN_BLUE),
      board: cogs(2),
      link: { targetAllyName: "Chum" },
    });
    expect(publicCombatThreat(input)).toEqual({ attackBonus: 0, directDamage: 0 });
  });
});
