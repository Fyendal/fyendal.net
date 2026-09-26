import { cardData, scripts } from "@fyendal/cards";
import type { ClientBotTask, GameIntent } from "@fyendal/shared";
import { decodeSerializedStateEnvelope } from "@fyendal/protocol";
import type { GameState } from "@fyendal/engine";
import { botDefinition } from "./registry.js";
import { botObservationKey, isCleanActionDecision, type TurnPlanCheckpoint } from "./turn-planner.js";
import type { BotPolicyInput } from "./policy.js";
import { isAdvertisedBotIntent } from "./intents.js";

/** Disposable per-browser optimization. State and commands remain on the server. */
export class ClientBotPolicy {
  private continuation: {
    code: string; botId: string; turn: number; steps: readonly TurnPlanCheckpoint[];
  } | null = null;

  clear(): void { this.continuation = null; }

  decide(task: ClientBotTask): GameIntent {
    const definition = botDefinition(task.botId);
    if (!definition) throw new Error("unsupported bot task");
    let state: GameState | undefined;
    if (task.simulation) {
      const decoded = decodeSerializedStateEnvelope(task.simulation, task.code).state;
      state = {
        ...decoded,
        globalCardIds: decoded.globalCardIds ?? [], extraTurnSeats: decoded.extraTurnSeats ?? [],
        delayedTriggers: decoded.delayedTriggers ?? [], pendingTriggeredLayers: decoded.pendingTriggeredLayers ?? [],
        gameStats: decoded.gameStats ?? { turns: [] }, cardsRef: cardData, scriptsRef: scripts,
      };
    }
    const input: BotPolicyInput = { seat: task.seat, view: task.view, legal: task.legal, cards: cardData, state };
    const cached = this.continuation;
    if (cached && (cached.code !== task.code || cached.botId !== task.botId || cached.turn !== task.view.turn)) {
      this.clear();
    }
    if (state && isCleanActionDecision(state, task.seat) && this.continuation && definition.chooseContinuationIntent) {
      const [step, ...remaining] = this.continuation.steps;
      if (step && step.observationKey === botObservationKey(input) && isAdvertisedBotIntent(step.intent, task.legal)) {
        const guarded = definition.chooseContinuationIntent(input, step.intent);
        if (JSON.stringify(guarded) === JSON.stringify(step.intent)) {
          this.continuation.steps = remaining;
          return guarded;
        }
      }
      this.clear();
    }
    const decision = definition.chooseDecision(input);
    if (!isAdvertisedBotIntent(decision.intent, task.legal)) {
      this.clear();
      throw new Error("unadvertised bot intent");
    }
    if (decision.continuation) {
      const [root, ...steps] = decision.continuation;
      this.continuation = root && JSON.stringify(root.intent) === JSON.stringify(decision.intent)
        ? { code: task.code, botId: task.botId, turn: task.view.turn, steps } : null;
    }
    return decision.intent;
  }
}
