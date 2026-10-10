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
