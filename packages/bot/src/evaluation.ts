import { cardData, precon, scripts } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { botDefinition, type BotDefinition } from "./registry.js";

export interface BotMatchEvaluation {
  bots: [string, string];
  seed: number;
  winner: 0 | 1 | null;
  turns: number;
  steps: number;
  decisions: [number, number];
  totalDecisionMs: [number, number];
  maxDecisionMs: [number, number];
  actionDigest: string;
  complete: boolean;
}

export interface BotMatchEvaluationOptions {
  left: string;
  right: string;
  seed: number;
  maxSteps?: number;
  /** Injectable monotonic clock keeps harness tests deterministic. */
  now?: () => number;
}

function registeredPoolDeck(definition: BotDefinition): Decklist {
  const registered = precon(definition.deckId);
  if (!registered) throw new Error(`missing bot deck ${definition.deckId}`);
  return {
    heroId: registered.pool.heroId,
    weaponIds: [...registered.pool.weaponIds],
    equipment: {},
    deck: [...registered.pool.deck, ...(registered.pool.sideboard ?? [])],
  };
}

function presentedDeck(definition: BotDefinition, opponent: Decklist): Decklist {
  const registered = precon(definition.deckId);
  if (!registered) throw new Error(`missing bot deck ${definition.deckId}`);
  return {
    heroId: registered.pool.heroId,
    ...definition.presentationFor(opponent, "first"),
  };
}

function digestIntents(intents: readonly GameIntent[]): string {
  const text = intents.map((intent) => JSON.stringify(intent)).join("\n");
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic bot-vs-bot strength harness. It runs both policies through
 * authoritative legal intents and reports outcome, decision count, and
 * latency without changing production game flow. */
export function evaluateBotMatch(options: BotMatchEvaluationOptions): BotMatchEvaluation {
  const left = botDefinition(options.left);
  const right = botDefinition(options.right);
  if (!left || !right) throw new Error("unknown bot definition");
  if (left.format !== right.format) throw new Error("bots must share a format");
  const leftPool = registeredPoolDeck(left);
  const rightPool = registeredPoolDeck(right);
  let state = createGame({
    decklists: [presentedDeck(left, rightPool), presentedDeck(right, leftPool)],
    cards: cardData,
    scripts,
    seed: options.seed,
    startPlayer: 0,
  });
  const definitions = [left, right] as const;
  const decisions: [number, number] = [0, 0];
  const totalDecisionMs: [number, number] = [0, 0];
  const maxDecisionMs: [number, number] = [0, 0];
  const intents: GameIntent[] = [];
  const now = options.now ?? (() => performance.now());
  const maxSteps = options.maxSteps ?? 2_000;
  let steps = 0;
  for (; steps < maxSteps && state.winner === null; steps++) {
    const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
    const legal = legalIntents(state, actor).filter((intent) => intent.kind !== "concede");
    if (legal.length === 0) throw new Error(`bot ${definitions[actor].id} has no legal intent`);
    const startedAt = now();
    const intent = definitions[actor].chooseIntent({
      seat: actor,
      view: projectStateFor(state, actor),
      legal,
      cards: cardData,
      state,
    });
    const elapsed = Math.max(0, now() - startedAt);
    decisions[actor]++;
    totalDecisionMs[actor] += elapsed;
    maxDecisionMs[actor] = Math.max(maxDecisionMs[actor], elapsed);
    const applied = applyIntent(state, actor, intent);
    if (!applied.ok) throw new Error(`bot ${definitions[actor].id} returned ${intent.kind}: ${applied.error}`);
    intents.push(intent);
    state = applied.state;
  }
  return {
    bots: [left.id, right.id],
    seed: options.seed,
    winner: state.winner === 0 || state.winner === 1 ? state.winner : null,
    turns: state.turn,
    steps,
    decisions,
    totalDecisionMs,
    maxDecisionMs,
    actionDigest: digestIntents(intents),
    complete: state.winner !== null,
  };
}
