import type {
  BotOpponent,
  Decklist,
  GameIntent,
  PresentedDeck,
} from "@fyendal/shared";
import { chooseBravoIntent, chooseBravoIntentWithTrace } from "./bravo-policy.js";
import { chooseBriarIntent, chooseBriarIntentWithTrace } from "./briar-policy.js";
import {
  chooseCindraContinuationIntent,
  chooseCindraIntent,
  chooseCindraIntentWithTrace,
} from "./cindra-policy.js";
import { chooseHalaIntent, chooseHalaIntentWithTrace } from "./hala-policy.js";
import { chooseIraIntent, chooseIraIntentWithTrace } from "./ira-policy.js";
import { chooseJarlIntent, chooseJarlIntentWithTrace } from "./jarl-policy.js";
import type { BotPolicyInput } from "./policy.js";
import type { TurnPlanCheckpoint, TurnPlannerCandidateTrace } from "./turn-planner.js";
import {
  bravoPresentationFor,
  briarPresentationFor,
  cindraPresentationFor,
  halaPresentationFor,
  iraPresentation,
  jarlPresentationFor,
} from "./sideboard.js";

export type ConstructedBotFormat = "cc" | "silver-age";

export interface BotDecision {
  intent: GameIntent;
  continuation?: readonly TurnPlanCheckpoint[];
  planning?: {
    nodes: number;
    transitions: number;
    candidateTrace: TurnPlannerCandidateTrace;
  };
}

export interface BotDefinition {
  id: BotOpponent;
  format: ConstructedBotFormat;
  deckId: string;
  username: string;
  deckName: string;
  chooseIntent(input: BotPolicyInput): GameIntent;
  /** Standard decision path used by the worker; planning telemetry is present
   * when the policy reached a bounded planner. */
  chooseDecision(input: BotPolicyInput): BotDecision;
  /** Reapply hero-specific root guardrails to an exactly matched cached step. */
  chooseContinuationIntent?(input: BotPolicyInput, proposed: GameIntent): GameIntent;
  presentationFor(
    opponent: Decklist,
    botTurnOrder: "first" | "second",
  ): PresentedDeck;
}

interface TracedPolicyDecision {
  intent: GameIntent;
  plan?: {
    checkpoints: readonly TurnPlanCheckpoint[];
    nodes: number;
    transitions: number;
    candidateTrace: TurnPlannerCandidateTrace;
  };
}

function botDecisionFromTrace(
  decision: TracedPolicyDecision,
  includeContinuation = false,
): BotDecision {
  if (!decision.plan) return { intent: decision.intent };
  return {
    intent: decision.intent,
    ...(includeContinuation ? { continuation: decision.plan.checkpoints } : {}),
    planning: {
      nodes: decision.plan.nodes,
      transitions: decision.plan.transitions,
      candidateTrace: decision.plan.candidateTrace,
    },
  };
}

export const BOT_DEFINITIONS = {
  bravo: {
    id: "bravo",
    format: "silver-age",
    deckId: "bot-bravo-flarvo",
    username: "Bravo Bot",
    deckName: "Flarvo - Skirmish Season 15 Winner!",
    chooseIntent: chooseBravoIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseBravoIntentWithTrace(input)),
    presentationFor: (opponent) => bravoPresentationFor(opponent),
  },
  briar: {
    id: "briar",
    format: "silver-age",
    deckId: "bot-briar-broccoli",
    username: "Briar Bot",
    deckName: "🥦 Broccoli Deck in Format",
    chooseIntent: chooseBriarIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseBriarIntentWithTrace(input)),
    presentationFor: (opponent, botTurnOrder) => briarPresentationFor(opponent, botTurnOrder),
  },
  cindra: {
    id: "cindra",
    format: "cc",
    deckId: "bot-cindra-head-jabs",
    username: "Cindra Bot",
    deckName: "Art of the Dragon: Head Jab",
    chooseIntent: chooseCindraIntent,
    chooseDecision: (input) =>
      botDecisionFromTrace(chooseCindraIntentWithTrace(input), true),
    chooseContinuationIntent: chooseCindraContinuationIntent,
    presentationFor: (opponent) => cindraPresentationFor(opponent),
  },
  ira: {
    id: "ira",
    format: "cc",
    deckId: "precon-asr",
    username: "Ira Bot",
    deckName: "Armory Deck: Ira, Scarlet Revenger",
    chooseIntent: chooseIraIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseIraIntentWithTrace(input)),
    presentationFor: () => iraPresentation(),
  },
  hala: {
    id: "hala",
    format: "cc",
    deckId: "precon-hala-masterclass",
    username: "Hala Bot",
    deckName: "Masterclass: Hala, Bladesaint of the Vow",
    chooseIntent: chooseHalaIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseHalaIntentWithTrace(input)),
    presentationFor: (opponent) => halaPresentationFor(opponent),
  },
  jarl: {
    id: "jarl",
    format: "cc",
    deckId: "bot-jarl",
    username: "Jarl Bot",
    deckName: "Jarl",
    chooseIntent: chooseJarlIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseJarlIntentWithTrace(input)),
    presentationFor: (opponent) => jarlPresentationFor(opponent),
  },
} as const satisfies Readonly<Record<BotOpponent, BotDefinition>>;

export const botDefinitions: readonly BotDefinition[] = Object.values(BOT_DEFINITIONS);

export function botDefinition(id: string | undefined): BotDefinition | undefined {
  return botDefinitions.find((definition) => definition.id === id);
}

export function botDefinitionForDeckId(deckId: string | undefined): BotDefinition | undefined {
  return botDefinitions.find((definition) => definition.deckId === deckId);
}
