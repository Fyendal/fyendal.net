import type { CardView, GameIntent } from "@fyendal/shared";
import { intentCard, ownCards, type BotPolicyInput } from "./policy.js";
import type { TurnPlan, TurnPlannerConfig } from "./turn-planner.js";
import { compareTuple, draconic, faiRole, nameOf, zeroPitchAggroIntent, type FaiAggroMemory } from "./fai-aggro-model.js";
import { collectFaiRouteFacts } from "./fai-route-facts.js";

export interface FaiRouteEvaluation {
  score: number;
  complete: boolean;
  damage: number;
  converted: number;
  stranded: number;
  arsenalId?: number;
  preference: number;
  retainedFealty: number;
  /** Opportunity, not damage or a promise of drawing a particular card. */
  drawReservePotential?: number;
}
export type FaiRoutePlan = TurnPlan<FaiRouteEvaluation>;

export interface FaiRouteOptions {
  equipment: boolean;
  arsenal?: boolean;
  /** hood measures all-card feasibility for a sampled redraw, not the live
   * attack ordering or a play-count condition for activating Hood. */
  objective?: "damage" | "conversion" | "turn1" | "hood";
  memory?: FaiAggroMemory;
  excludeIds?: ReadonlySet<number>;
  nodes?: number;
  /** Pre-sanitized public counterfactual (e.g. a sampled Hood hand). */
  sandboxed?: boolean;
  /** Internal: reserve branches have already been enumerated at this root. */
  reserveBranchesDone?: boolean;
  /** The actual first turn of the game must finish with one non-Flame card in
   * arsenal whenever a legal reserve route exists. Other Turn1-style attacks
   * keep the reviewed play-three/store-one preference rather than a mandate. */
  openingReserveRequired?: boolean;
  /** Fealty counterfactuals use the same hand/reserve and legal engine flow. */
  fealty?: "allow" | "preserve" | "activate-now";
}

export function compareAggroRoutes(left: FaiRouteEvaluation, right: FaiRouteEvaluation,
  objective: "damage" | "conversion" | "turn1" | "hood", target: number,
  openingReserveRequired = false): number {
  if (objective === "damage") return compareTuple(
    [left.damage, left.drawReservePotential ?? 0, left.retainedFealty, Number(left.complete)],
    [right.damage, right.drawReservePotential ?? 0, right.retainedFealty, Number(right.complete)],
  );
  const tuple = (value: FaiRouteEvaluation): number[] => [
    // Only Turn1 has an explicit play-three/reserve exception. Ordinary
    // attacks compare full-route damage, never hypothetical lethal shortcuts.
    ...(objective === "turn1" && openingReserveRequired
      ? [Number(value.arsenalId !== undefined), Number(value.converted >= target), -value.stranded,
          value.damage, value.converted, value.preference]
      : objective === "turn1"
        ? [Number(value.converted >= target), -value.stranded, value.preference]
        : []),
    ...(objective === "hood" ? [Number(value.converted >= target), -value.stranded] : []),
    value.damage, value.converted, -value.stranded, value.drawReservePotential ?? 0, value.retainedFealty, Number(value.complete),
  ];
  return compareTuple(tuple(left), tuple(right));
}

function orderCandidate(intent: GameIntent, input: BotPolicyInput): number {
  const card = intentCard(intent, ownCards(input));
  const name = card ? nameOf(card, input) : "";
  if (name === "rise from the ashes") return 0;
  if (name === "tearing shuko") return 1;
  if (name === "pouncing paws") return 2;
  if (name === "blood scent") return 3;
  if (name === "kunai of retribution") return 4;
  if (intent.kind === "activate-ability") return 5;
  if (name === "crouching tiger") return 6;
  if (card && faiRole(card, input) === "starter") return 7;
  if (card && faiRole(card, input) !== "ender") return 8;
  if (card) return 9;
  return intent.kind === "close-chain" ? 10 : 11;
}

/** Aggro's choices, not a shared Fai scoring model. The generic planTurn
 * search is already configurable; Midrange supplies its own configuration
 * instead of inheriting these zero-pitch, reserve and conversion rules.
 * Runtime callbacks are per-call only and never enter persisted game state. */
export function createFaiAggroRouteConfig(
  input: BotPolicyInput,
  start: BotPolicyInput,
  options: FaiRouteOptions,
  ports: {
    chooseForced(input: BotPolicyInput): GameIntent;
    knownDrawPool: readonly string[];
  },
): TurnPlannerConfig<FaiRouteEvaluation> {
  const me = start.view.players[input.seat];
  const rootCards = [...me.hand, ...(options.arsenal === false ? [] : me.arsenal)]
    .filter((card) => !options.memory || (options.memory.realIds.has(card.instanceId) &&
      !options.memory.playedIds.has(card.instanceId)));
  const realIds = new Set(rootCards.map((card) => card.instanceId));
  const previouslyPlayed = options.memory?.playedIds.size ?? 0;
  const target = options.memory?.conversionTarget(input) ?? realIds.size;
  const objective = options.objective ?? "damage";
  const nodes = options.nodes ?? 400;
  const knownDrawPool = ports.knownDrawPool;
  // Do not inspect the representative private draw chosen by the sandbox.
  // Only the known multiset gives the chance of a non-Flame arsenal candidate.
  const storableDrawChance = knownDrawPool.length === 0 ? 0 : knownDrawPool.filter((id) =>
    input.cards[id]?.name.toLowerCase() !== "phoenix flame").length / knownDrawPool.length;
  return {
    completeAfterForcedTurnAdvance: true,
    maxSearchNodes: nodes, maxTransitions: nodes * 12, maxRootCandidates: 12, maxActionDepth: 20,
    chooseForced: ports.chooseForced, cardOpportunity: () => 0,
    prepareCandidates(candidates, observed, context) {
      const own = ownCards(observed);
      const equipmentIds = new Set([...Object.values(observed.view.players[observed.seat].equipment),
        ...observed.view.players[observed.seat].weapons].flatMap((card) => card ? [card.instanceId] : []));
      const unique = new Set<string>();
      return candidates.filter((intent) => {
        if (!zeroPitchAggroIntent(intent, observed)) return false;
        if (intent.kind === "play-from-arsenal" && options.arsenal === false) return false;
        if ("instanceId" in intent && options.excludeIds?.has(intent.instanceId)) return false;
        const card = intentCard(intent, own);
        if (options.fealty === "activate-now" && context.depth === 0 &&
          (!card || nameOf(card, observed) !== "fealty")) return false;
        if (card && nameOf(card, observed) === "hope merchant's hood") return false;
        if (card && nameOf(card, observed) === "fealty") {
          if (options.fealty === "preserve") return false;
          const player = observed.view.players[observed.seat];
          const canBenefit = [...player.hand, ...player.arsenal, ...player.banish].some((candidate) =>
            !options.excludeIds?.has(candidate.instanceId) && !draconic(candidate, observed));
          if (!canBenefit) return false;
        }
        if (card && nameOf(card, observed) === "rise from the ashes" &&
          (observed.view.turnFacts?.players[observed.seat].attacks ?? 0) > 0) return false;
        if (!options.equipment && intent.kind === "activate-ability" && equipmentIds.has(intent.sourceInstanceId)) return false;
        // Aggro-only equivalence after the zero-pitch filter. Keep its exact
        // branch order/budget; a payable policy must distinguish payment choices.
        // Hand and arsenal never collapse.
        const signature = `${intent.kind}|${card?.cardId ?? JSON.stringify(intent)}|${"targetAllyId" in intent ? intent.targetAllyId : ""}`;
        if (unique.has(signature)) return false;
        unique.add(signature);
        return true;
      }).sort((a, b) => orderCandidate(a, observed) - orderCandidate(b, observed));
    },
    rankCandidate: (intent, observed) => -orderCandidate(intent, observed),
    evaluateEnd(_state, observed, root, complete): FaiRouteEvaluation {
      const end = observed.view.players[observed.seat];
      const facts = collectFaiRouteFacts(_state, observed, root);
      // Preserve the existing zero-pitch Aggro conversion definition exactly.
      // This is NOT a universal played-card count: payable Midrange routes
      // must account for pitch/discard separately, not reuse this subtraction.
      const remaining = new Set([...facts.locations.hand, ...facts.locations.arsenal,
        ...facts.locations.banish, ...facts.locations.deck]);
      const converted = previouslyPlayed + [...realIds].filter((id) => !remaining.has(id)).length;
      const { damage, currentHand } = facts;
      const drawReservePotential = input.faiDrawReserveTiebreak && observed.view.turn === root.turn &&
        observed.view.activePlayer === observed.seat &&
        (observed.view.phase === "action" || observed.view.phase === "layer") &&
        end.arsenalCount === 0 && currentHand.length === 0 &&
        end.hand.some((card) => root.deckIds.has(card.instanceId)) ? storableDrawChance : 0;
      const candidates = end.arsenalCount === 0 && options.arsenal !== false
        ? currentHand.filter((card) => nameOf(card, observed) !== "phoenix flame") : [];
      let arsenal: CardView | undefined;
      let preference = 0;
      for (const card of candidates) {
        const role = faiRole(card, observed);
        let rank = 0;
        if (objective === "turn1" && converted >= 3) {
          if (role === "starter" && (options.memory?.originalStarters ?? 0) >= 2) {
            const fealty = end.board.some((permanent) => nameOf(permanent, observed) === "fealty");
            rank = draconic(card, observed) !== fealty ? 3 : 2;
          } else if (role === "ender" && (options.memory?.originalEnders ?? 0) >= 2) rank = 1;
        }
        if (!arsenal || rank > preference) { arsenal = card; preference = rank; }
      }
      return { score: damage, damage, converted, complete,
        stranded: Math.max(0, currentHand.length - Number(arsenal !== undefined)),
        preference, retainedFealty: end.board.filter((card) => nameOf(card, observed) === "fealty").length,
        ...(input.faiDrawReserveTiebreak ? { drawReservePotential } : {}),
        ...(arsenal ? { arsenalId: arsenal.instanceId } : {}) };
    },
    compareEvaluations(left, right) {
      return compareAggroRoutes(left, right, objective, target, options.openingReserveRequired);
    },
  };
}
