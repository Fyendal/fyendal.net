export interface ValueBreakdown {
  damageThreatened: number;
  damagePrevented: number;
  onHitValue: number;
  futureHandValue: number;
  arsenalValue: number;
  boardValue: number;
  opponentConversionDenied: number;
  equipmentCost: number;
  cardOpportunityCost: number;
  resourceWaste: number;
  overblockCost: number;
  lifeThresholdRisk: number;
  fatigueCost: number;
  strategicAdjustment: number;
  total: number;
}

export type ValueComponents = Partial<Omit<ValueBreakdown, "total">>;

export function valueBreakdown(components: ValueComponents): ValueBreakdown {
  const value: Omit<ValueBreakdown, "total"> = {
    damageThreatened: components.damageThreatened ?? 0,
    damagePrevented: components.damagePrevented ?? 0,
    onHitValue: components.onHitValue ?? 0,
    futureHandValue: components.futureHandValue ?? 0,
    arsenalValue: components.arsenalValue ?? 0,
    boardValue: components.boardValue ?? 0,
    opponentConversionDenied: components.opponentConversionDenied ?? 0,
    equipmentCost: components.equipmentCost ?? 0,
    cardOpportunityCost: components.cardOpportunityCost ?? 0,
    resourceWaste: components.resourceWaste ?? 0,
    overblockCost: components.overblockCost ?? 0,
    lifeThresholdRisk: components.lifeThresholdRisk ?? 0,
    fatigueCost: components.fatigueCost ?? 0,
    strategicAdjustment: components.strategicAdjustment ?? 0,
  };
  return {
    ...value,
    total: value.damageThreatened
      + value.damagePrevented
      + value.onHitValue
      + value.futureHandValue
      + value.arsenalValue
      + value.boardValue
      + value.opponentConversionDenied
      + value.strategicAdjustment
      - value.equipmentCost
      - value.cardOpportunityCost
      - value.resourceWaste
      - value.overblockCost
      - value.lifeThresholdRisk
      - value.fatigueCost,
  };
}

export function adjustValueBreakdown(
  value: ValueBreakdown,
  changes: ValueComponents,
): ValueBreakdown {
  const { total: _total, ...components } = value;
  return valueBreakdown({ ...components, ...changes });
}

export interface LifeThreshold {
  atOrBelow: number;
  cost: number;
}

export const DEFAULT_LIFE_THRESHOLDS: readonly LifeThreshold[] = [
  { atOrBelow: 1, cost: 4 },
  { atOrBelow: 2, cost: 2.5 },
  { atOrBelow: 4, cost: 1 },
];

/** Damage-equivalent loss of flexibility after crossing a low-life
 * breakpoint. The tiers are alternatives, not cumulative penalties. */
export function lifeThresholdRisk(
  lifeAfterDamage: number,
  thresholds: readonly LifeThreshold[] = DEFAULT_LIFE_THRESHOLDS,
): number {
  if (lifeAfterDamage <= 0) return Number.POSITIVE_INFINITY;
  return [...thresholds]
    .sort((left, right) => left.atOrBelow - right.atOrBelow)
    .find((threshold) => lifeAfterDamage <= threshold.atOrBelow)?.cost ?? 0;
}

export interface PublicOnHitEffect {
  text: string;
  impact?: {
    damage?: number;
    delayedDamage?: number;
    drawCards?: number;
    discardCards?: number;
    destroysArsenal?: true;
    damagesEquipment?: true;
    createsToken?: true;
    grantsTempo?: true;
  };
}

export interface OnHitValueContext {
  effects: readonly PublicOnHitEffect[];
  sourceText?: string;
  attackerCanContinue: boolean;
  attackerCanArsenal: boolean;
  defenderHasHand: boolean;
  defenderHasArsenal: boolean;
}

export interface OnHitEvaluation {
  value: number;
  cardDraw: number;
  delayedDamage: number;
  handCardsLost: number;
  destroysOccupiedArsenal: boolean;
  equipmentDamage: boolean;
  tokenCreation: boolean;
}

const EMPTY_ON_HIT_EVALUATION: OnHitEvaluation = {
  value: 0,
  cardDraw: 0,
  delayedDamage: 0,
  handCardsLost: 0,
  destroysOccupiedArsenal: false,
  equipmentDamage: false,
  tokenCreation: false,
};

function firstAmount(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : undefined;
}

function cardCount(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  if (!match) return undefined;
  const count = match[1]?.toLowerCase();
  if (count === "a" || count === "one") return 1;
  if (count === "two") return 2;
  if (count === "three") return 3;
  return Number(count);
}

function combineOnHit(
  left: OnHitEvaluation,
  right: OnHitEvaluation,
): OnHitEvaluation {
  return {
    value: left.value + right.value,
    cardDraw: left.cardDraw + right.cardDraw,
    delayedDamage: left.delayedDamage + right.delayedDamage,
    handCardsLost: left.handCardsLost + right.handCardsLost,
    destroysOccupiedArsenal: left.destroysOccupiedArsenal || right.destroysOccupiedArsenal,
    equipmentDamage: left.equipmentDamage || right.equipmentDamage,
    tokenCreation: left.tokenCreation || right.tokenCreation,
  };
}

/** Structured damage-equivalent value of public on-hit effects. This is
 * deliberately conservative: it prices only information represented in the
 * combat projection and never infers a hidden card identity. */
export function evaluateOnHit(context: OnHitValueContext): OnHitEvaluation {
  const conversionBonus = context.attackerCanContinue || context.attackerCanArsenal ? 1 : 0;
  const evaluateImpact = (effect: PublicOnHitEffect): OnHitEvaluation | undefined => {
    const impact = effect.impact;
    if (!impact) return undefined;
    const damage = impact.damage ?? 0;
    const delayedDamage = impact.delayedDamage ?? 0;
    const draw = impact.drawCards ?? 0;
    const handCardsLost = context.defenderHasHand ? (impact.discardCards ?? 0) : 0;
    const destroysOccupiedArsenal = impact.destroysArsenal === true && context.defenderHasArsenal;
    const value = damage + draw * (3 + conversionBonus) + handCardsLost * 3 +
      (destroysOccupiedArsenal ? 4 : 0) + (impact.damagesEquipment ? 2 : 0) +
      (impact.createsToken ? 2 : 0) + (impact.grantsTempo ? 1 : 0);
    return {
      value,
      cardDraw: draw,
      delayedDamage,
      handCardsLost,
      destroysOccupiedArsenal,
      equipmentDamage: impact.damagesEquipment === true,
      tokenCreation: impact.createsToken === true,
    };
  };
  const evaluateEffect = (effectText: string): OnHitEvaluation => {
    const text = effectText.trim().toLowerCase();
    const damage = firstAmount(text, /(?:deal|deals|lose|loses)\D{0,24}(\d+)\s+(?:arcane\s+)?(?:damage|life)/);
    if (damage !== undefined) {
      const delayed = /(?:end|beginning|next turn|bloodrot)/.test(text) ? damage : 0;
      return { ...EMPTY_ON_HIT_EVALUATION, value: damage, delayedDamage: delayed };
    }
    const draw = cardCount(text, /draws?\s+(a|one|two|three|\d+)\s+cards?/);
    if (draw !== undefined) {
      return {
        ...EMPTY_ON_HIT_EVALUATION,
        value: draw * (3 + conversionBonus),
        cardDraw: draw,
      };
    }
    const handLoss = cardCount(
      text,
      /(?:discard(?:s)?|put)\s+(a|one|two|three|\d+)(?:\s+random)?\s+cards?\s+from\s+(?:their|your)\s+hand/,
    ) ?? (/discard|put a card from (?:their|your) hand on top/.test(text) ? 1 : undefined);
    if (handLoss !== undefined) {
      const actualLoss = context.defenderHasHand ? handLoss : 0;
      return {
        ...EMPTY_ON_HIT_EVALUATION,
        value: actualLoss * 3,
        handCardsLost: actualLoss,
      };
    }
    if (/(?:destroy|put) (?:a card|it) from (?:their|your) arsenal|destroy[^.]{0,40}arsenal/.test(text)) {
      return {
        ...EMPTY_ON_HIT_EVALUATION,
        value: context.defenderHasArsenal ? 4 : 0,
        destroysOccupiedArsenal: context.defenderHasArsenal,
      };
    }
    if (/create(?:s)? (?:a )?bloodrot pox/.test(text)) {
      return {
        ...EMPTY_ON_HIT_EVALUATION,
        value: 2,
        delayedDamage: 2,
        tokenCreation: true,
      };
    }
    if (/create(?:s)? (?:a )?(?:gold|agility|might|vigor)/.test(text)) {
      return { ...EMPTY_ON_HIT_EVALUATION, value: 2, tokenCreation: true };
    }
    if (/create(?:s)? (?:a )?(?:runechant|embodiment of earth|embodiment of lightning)/.test(text)) {
      return { ...EMPTY_ON_HIT_EVALUATION, value: 1, tokenCreation: true };
    }
    if (/action point|resource|put a counter/.test(text)) {
      return { ...EMPTY_ON_HIT_EVALUATION, value: 1 };
    }
    if (/equipment/.test(text)) {
      return { ...EMPTY_ON_HIT_EVALUATION, value: 2, equipmentDamage: true };
    }
    return { ...EMPTY_ON_HIT_EVALUATION, value: 2 };
  };

  if (context.effects.length > 0) {
    return context.effects.reduce(
      (total, effect) => combineOnHit(total, evaluateImpact(effect) ?? evaluateEffect(effect.text)),
      EMPTY_ON_HIT_EVALUATION,
    );
  }
  return /when (?:this|you) hits|on hit/i.test(context.sourceText ?? "")
    ? { ...EMPTY_ON_HIT_EVALUATION, value: 2 }
    : EMPTY_ON_HIT_EVALUATION;
}

export function expectedOnHitValue(context: OnHitValueContext): number {
  return evaluateOnHit(context).value;
}
