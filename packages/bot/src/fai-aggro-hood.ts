import type { BotPolicyInput } from "./policy.js";
import { FaiAggroMemory, compareTuple, faiRole, zeroPitchAggroIntent } from "./fai-aggro-model.js";
import { knownFaiDeck, observedAggro, planFaiRoute, aggroSandbox, type FaiRoutePlan } from "./fai-aggro-planner.js";

export interface FaiHoodEstimate {
  instanceIds: number[];
  successRate: number;
  noWasteRate: number;
  samples: number;
  method: "deterministic-sampling";
  /** Search success is witnessed, failure may be a search-budget miss. */
  allSampleRoutesComplete: boolean;
}

/** Aggro-specific selector: its memory, zero-pitch constraints and route score
 * must not be reused unchanged for Midrange. Equipment alone is not a policy.
 * Public-multiset sampling without replacement, including cards returned by
 * Hood. Fixed common seeds compare every nonempty subset reproducibly; these
 * are estimates, NOT claims of exact probabilities or omniscient optimality. */
export function chooseFaiHoodSubset(input: BotPolicyInput, memory: FaiAggroMemory,
  options: { requiredIds?: ReadonlySet<number>; plan?: FaiRoutePlan } = {}): FaiHoodEstimate | undefined {
  const start = aggroSandbox(input);
  if (!start) return undefined;
  const me = input.view.players[input.seat];
  if (!me.hand.length || me.hand.length > 6) return undefined;
  const deck = knownFaiDeck(input);
  const enders = [...me.hand, ...me.arsenal].filter((card) => faiRole(card, input) === "ender");
  const enderIds = new Set(enders.map((card) => card.instanceId));
  const usableEnderIds = new Set(input.legal.flatMap((intent) =>
    (intent.kind === "play-card" || intent.kind === "play-from-arsenal") &&
    enderIds.has(intent.instanceId) && zeroPitchAggroIntent(intent, input) ? [intent.instanceId] : []));
  const usedIds = new Set(options.plan?.line.flatMap((intent) =>
    "instanceId" in intent ? [intent.instanceId] : []) ?? []);
  let best: FaiHoodEstimate | undefined;
  let bestTuple: number[] = [];
  for (let mask = 1; mask < 2 ** me.hand.length; mask++) {
    const returned = me.hand.filter((_card, index) => (mask & 2 ** index) !== 0);
    // This selector runs only after the existing pressure/waste rule has
    // justified Hood.
    const instanceIds = returned.map((card) => card.instanceId);
    if ([...(options.requiredIds ?? [])].some((id) => !instanceIds.includes(id))) continue;
    // Keep useful non-finishers from the current route. Finishers compete as a
    // group: a free legal arsenal ender can replace the hand's stronger ender.
    if (returned.some((card) => usedIds.has(card.instanceId) && !enderIds.has(card.instanceId) &&
      !options.requiredIds?.has(card.instanceId))) continue;
    // An unplayable arsenal card is not a backup. Preserve one currently
    // usable finisher if there is one; redraws cannot promise its replacement.
    if (usableEnderIds.size && [...usableEnderIds].every((id) => instanceIds.includes(id))) continue;
    const pool = [...deck, ...returned.map((card) => card.cardId)].sort();
    let successes = 0;
    let noWaste = 0;
    let totalConverted = 0;
    let totalDamage = 0;
    let complete = true;
    const samples = 8;
    for (let sample = 0; sample < samples; sample++) {
      let rng = (0x9e3779b9 ^ Math.imul(sample + 1, 104729)) >>> 0;
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
        const j = (rng >>> 0) % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const state = { ...start, players: [...start.players] as typeof start.players };
      const player = { ...start.players[input.seat] };
      state.players[input.seat] = player;
      const drawn = shuffled.slice(0, returned.length).map((cardId, index) => ({
        instanceId: start.nextInstanceId + index, cardId, owner: input.seat,
      }));
      state.nextInstanceId += returned.length;
      player.hand = [...player.hand.filter((card) => !instanceIds.includes(card.instanceId)), ...drawn];
      player.deck = shuffled.slice(returned.length).map((cardId) => ({
        instanceId: state.nextInstanceId++, cardId, owner: input.seat,
      }));
      // Trial after Hood has resolved; it cannot supply a second reset.
      player.equipment = { ...player.equipment };
      delete player.equipment.head;
      const trialMemory = Object.assign(new FaiAggroMemory(), memory, {
        realIds: new Set([...memory.realIds, ...drawn.map((card) => card.instanceId)]),
        playedIds: new Set(memory.playedIds),
      });
      const observation = observedAggro(state, input);
      trialMemory.refreshRoles(observation);
      const trial = planFaiRoute(observation, {
        equipment: true, objective: "hood", memory: trialMemory, nodes: 96, sandboxed: true,
      });
      const converted = trial?.evaluation.converted ?? memory.playedIds.size;
      // Once Hood is justified by pressure/waste, prefer the probability of
      // converting the whole remaining hand. Arsenal is a no-waste fallback,
      // not a fixed play-count condition for activating Hood in the first place.
      successes += Number(converted >= trialMemory.conversionTarget(observation));
      noWaste += Number(trial?.evaluation.stranded === 0);
      totalConverted += converted;
      totalDamage += trial?.evaluation.damage ?? 0;
      complete &&= trial?.evaluation.complete ?? false;
    }
    const tuple = [successes, totalDamage, noWaste, totalConverted, -returned.length];
    if (!best || compareTuple(tuple, bestTuple) > 0) {
      bestTuple = tuple;
      best = { instanceIds, successRate: successes / samples, noWasteRate: noWaste / samples, samples,
        method: "deterministic-sampling", allSampleRoutesComplete: complete };
    }
  }
  return best;
}
