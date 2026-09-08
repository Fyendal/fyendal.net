import { intentCard, ownCards, type BotPolicyInput } from "./policy.js";
import { draconic, nameOf } from "./fai-aggro-model.js";
import { planFaiRoute, type FaiRouteOptions, type FaiRoutePlan } from "./fai-aggro-planner.js";

export interface FaiFealtyTrace {
  withoutFealtyDamage: number;
  withFealtyDamage: number;
  marginalDamage: number;
  unlocksFreeFlameReturn: boolean;
}

/** FEALTY-001: compare actual engine routes, not a bonus for owning/using a
 * token. The next played card (not Fealty itself) becomes Draconic. A useful
 * extra link may unlock the free hero return and a playable Phoenix Flame.
 * Keep Turn1's planned arsenal unchanged; later turns may convert that card. */
export function improveFaiRouteWithFealty(input: BotPolicyInput, plan: FaiRoutePlan | undefined,
  options: FaiRouteOptions): { plan: FaiRoutePlan | undefined; fealty?: FaiFealtyTrace } {
  const own = ownCards(input);
  const activation = input.legal.find((intent) => {
    const card = intentCard(intent, own);
    return intent.kind === "activate-ability" && card && nameOf(card, input) === "fealty";
  });
  if (!plan || !activation) return { plan };
  const excludeIds = new Set(options.excludeIds);
  if (options.objective === "turn1" && plan.evaluation.arsenalId !== undefined) excludeIds.add(plan.evaluation.arsenalId);
  const me = input.view.players[input.seat];
  if (![...me.hand, ...me.arsenal, ...me.banish].some((card) =>
    !excludeIds.has(card.instanceId) && !draconic(card, input))) return { plan };
  const comparison: FaiRouteOptions = {
    ...options, objective: "damage", reserveBranchesDone: true, excludeIds,
  };
  const without = planFaiRoute(input, { ...comparison, fealty: "preserve" });
  const withFealty = planFaiRoute(input, { ...comparison, fealty: "activate-now" });
  if (!without || !withFealty) return { plan };
  const gain = withFealty.evaluation.damage - without.evaluation.damage;
  const heroId = input.view.players[input.seat].heroInstanceId;
  const returnsFlame = (route: FaiRoutePlan): boolean => route.line.some((intent) =>
    intent.kind === "activate-ability" && intent.sourceInstanceId === heroId);
  const unlocksFreeFlameReturn = returnsFlame(withFealty) && !returnsFlame(without);
  if ((gain > 0 || (gain === 0 && unlocksFreeFlameReturn)) &&
    withFealty.evaluation.converted >= without.evaluation.converted &&
    withFealty.evaluation.stranded <= without.evaluation.stranded) {
    return { plan: withFealty, fealty: { withoutFealtyDamage: without.evaluation.damage,
      withFealtyDamage: withFealty.evaluation.damage, marginalDamage: gain, unlocksFreeFlameReturn } };
  }
  const chosenCard = intentCard(plan.intent, own);
  // Equal damage saves the token. If another action was already selected,
  // keep that stage decision and reconsider Fealty at the next observation.
  return { plan: chosenCard && nameOf(chosenCard, input) === "fealty" ? without : plan };
}
