import type {
  BotOpponent,
  Format,
  GameIntent,
  PresentedDeck,
  PresentedArena,
} from "@fyendal/shared";
import { chooseBoltynIntent, chooseBoltynIntentWithTrace } from "./boltyn-policy.js";
import { chooseBravoIntent, chooseBravoIntentWithTrace } from "./bravo-policy.js";
import { chooseKayoIntent, chooseKayoIntentWithTrace } from "./kayo-policy.js";
import { chooseBriarIntent, chooseBriarIntentWithTrace } from "./briar-policy.js";
import {
  chooseCindraContinuationIntent,
  chooseCindraIntent,
  chooseCindraIntentWithTrace,
} from "./cindra-policy.js";
import { chooseHalaIntent, chooseHalaIntentWithTrace } from "./hala-policy.js";
import { chooseIraIntent, chooseIraIntentWithTrace } from "./ira-policy.js";
import { chooseJarlIntent, chooseJarlIntentWithTrace } from "./jarl-policy.js";
import { chooseLeviaIntent, chooseLeviaIntentWithTrace } from "./levia-policy.js";
import {
  chooseStarvoContinuationIntent,
  chooseStarvoIntent,
  chooseStarvoIntentWithTrace,
} from "./starvo-policy.js";
import type { BotPrepOpponent } from "./sideboard.js";
import type { BotPolicyInput } from "./policy.js";
import { chooseUpkeepPayment, reserveLethalUpkeep } from "./upkeep.js";
import { chooseBaitIntent } from "./bait.js";
import {
  MAX_BOT_CONTINUATION_STEPS,
  type TurnPlanCheckpoint,
  type TurnPlannerCandidateTrace,
} from "./turn-planner.js";
import {
  boltynPresentationFor,
  bravoPresentationFor,
  briarPresentationFor,
  kayoPresentationFor,
  cindraPresentationFor,
  halaPresentationFor,
  iraPresentation,
  iraSagePresentationFor,
  jarlPresentationFor,
  leviaPresentationFor,
  starvoPresentationFor,
} from "./sideboard.js";


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
  format: Format;
  deckId: string;
  username: string;
  deckName: string;
  chooseIntent(input: BotPolicyInput): GameIntent;
  /** Standard decision path used by the worker; planning telemetry is present
   * when the policy reached a bounded planner. */
  chooseDecision(input: BotPolicyInput): BotDecision;
  /** Reapply hero-specific root guardrails to an exactly matched cached step. */
  chooseContinuationIntent?(input: BotPolicyInput, proposed: GameIntent): GameIntent;
  arenaFor(opponent: Pick<BotPrepOpponent, "heroId">, botTurnOrder: "first" | "second"): PresentedArena;
  deckFor(opponent: BotPrepOpponent, arena: PresentedArena, botTurnOrder: "first" | "second"): PresentedDeck;
  presentationFor(
    opponent: BotPrepOpponent,
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
    ...(includeContinuation
      ? { continuation: decision.plan.checkpoints.slice(0, MAX_BOT_CONTINUATION_STEPS) }
      : {}),
    planning: {
      nodes: decision.plan.nodes,
      transitions: decision.plan.transitions,
      candidateTrace: decision.plan.candidateTrace,
    },
  };
}

/** Cross-hero guard: pay end-phase upkeep, withhold plays that leave too
 * little to pay one that would be lethal, and attack with an opponent's Bait. */
function guardedDecisions(
  definition: Omit<BotDefinition, "arenaFor" | "deckFor">,
): Pick<BotDefinition, "chooseIntent" | "chooseDecision" | "chooseContinuationIntent"> {
  const forced = (input: BotPolicyInput) => chooseUpkeepPayment(input) ?? chooseBaitIntent(input);
  const chooseIntent = (input: BotPolicyInput): GameIntent =>
    forced(input) ?? definition.chooseIntent(reserveLethalUpkeep(input));
  const continuation = definition.chooseContinuationIntent;
  return {
    chooseIntent,
    chooseDecision(input) {
      const intent = forced(input);
      return intent ? { intent } : definition.chooseDecision(reserveLethalUpkeep(input));
    },
    ...(continuation
      ? {
        chooseContinuationIntent(input: BotPolicyInput, proposed: GameIntent) {
          const guarded = reserveLethalUpkeep(input);
          const proposedKey = JSON.stringify(proposed);
          return guarded.legal.some((intent) => JSON.stringify(intent) === proposedKey)
            ? continuation(guarded, proposed)
            : chooseIntent(input);
        },
      }
      : {}),
  };
}

/** Stage the existing matchup plans while keeping equipment fixed at reveal. */
function stagedDefinition(definition: Omit<BotDefinition, "arenaFor" | "deckFor">): BotDefinition {
  return {
    ...definition,
    ...guardedDecisions(definition),
    arenaFor: (opponent, order) => {
      const selection = definition.presentationFor({ ...opponent, weaponIds: [], equipment: {} }, order);
      return { weaponIds: [...selection.weaponIds], equipment: { ...selection.equipment } };
    },
    deckFor: (opponent, arena, order) => ({
      weaponIds: [...arena.weaponIds],
      equipment: { ...arena.equipment },
      deck: definition.presentationFor(opponent, order).deck,
    }),
  };
}

export const BOT_DEFINITIONS = {
  bravo: stagedDefinition({
    id: "bravo",
    format: "silver-age",
    deckId: "bot-bravo-flarvo",
    username: "Bravo Bot",
    deckName: "Flarvo - Skirmish Season 15 Winner!",
    chooseIntent: chooseBravoIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseBravoIntentWithTrace(input)),
    presentationFor: (opponent) => bravoPresentationFor(opponent),
  }),
  kayo: stagedDefinition({
    id: "kayo",
    format: "silver-age",
    deckId: "bot-kayo-sage",
    username: "Kayo Bot",
    deckName: "SAGE Kayo",
    chooseIntent: chooseKayoIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseKayoIntentWithTrace(input)),
    presentationFor: (opponent) => kayoPresentationFor(opponent),
  }),
  briar: stagedDefinition({
    id: "briar",
    format: "silver-age",
    deckId: "bot-briar-broccoli",
    username: "Briar Bot",
    deckName: "🥦 Broccoli Deck in Format",
    chooseIntent: chooseBriarIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseBriarIntentWithTrace(input)),
    presentationFor: (opponent, botTurnOrder) => briarPresentationFor(opponent, botTurnOrder),
  }),
  "ira-sage": stagedDefinition({
    id: "ira-sage",
    format: "silver-age",
    deckId: "bot-ira-sage",
    username: "SAGE Ira Bot",
    deckName: "Sunday Showdown: Kyoto 1st",
    chooseIntent: chooseIraIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseIraIntentWithTrace(input)),
    presentationFor: (opponent) => iraSagePresentationFor(opponent),
  }),
  cindra: stagedDefinition({
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
  }),
  ira: stagedDefinition({
    id: "ira",
    format: "cc",
    deckId: "precon-asr",
    username: "Ira Bot",
    deckName: "Armory Deck: Ira, Scarlet Revenger",
    chooseIntent: chooseIraIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseIraIntentWithTrace(input)),
    presentationFor: () => iraPresentation(),
  }),
  hala: stagedDefinition({
    id: "hala",
    format: "cc",
    deckId: "precon-hala-masterclass",
    username: "Hala Bot",
    deckName: "Masterclass: Hala, Bladesaint of the Vow",
    chooseIntent: chooseHalaIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseHalaIntentWithTrace(input)),
    presentationFor: (opponent) => halaPresentationFor(opponent),
  }),
  jarl: stagedDefinition({
    id: "jarl",
    format: "cc",
    deckId: "bot-jarl",
    username: "Jarl Bot",
    deckName: "Jarl",
    chooseIntent: chooseJarlIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseJarlIntentWithTrace(input)),
    presentationFor: (opponent) => jarlPresentationFor(opponent),
  }),
  levia: stagedDefinition({
    id: "levia",
    format: "cc",
    deckId: "bot-levia-gates",
    username: "Levia Bot",
    deckName: "Levia — Gates and Bloodrush",
    chooseIntent: chooseLeviaIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseLeviaIntentWithTrace(input)),
    presentationFor: (opponent) => leviaPresentationFor(opponent),
  }),
  starvo: stagedDefinition({
    id: "starvo",
    format: "cc",
    deckId: "bot-starvo-boss",
    username: "Starvo Bot",
    deckName: "Bravo, Star of the Show — Boss Battle",
    chooseIntent: chooseStarvoIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseStarvoIntentWithTrace(input), true),
    chooseContinuationIntent: chooseStarvoContinuationIntent,
    presentationFor: (opponent) => starvoPresentationFor(opponent),
  }),
  boltyn: stagedDefinition({
    id: "boltyn",
    format: "cc",
    deckId: "bot-boltyn-raydn",
    username: "Boltyn Bot",
    deckName: "Raydn Boltyn",
    chooseIntent: chooseBoltynIntent,
    chooseDecision: (input) => botDecisionFromTrace(chooseBoltynIntentWithTrace(input)),
    presentationFor: (opponent) => boltynPresentationFor(opponent),
  }),
} as const satisfies Readonly<Record<BotOpponent, BotDefinition>>;

export const botDefinitions: readonly BotDefinition[] = Object.values(BOT_DEFINITIONS);

export function botDefinition(id: string | undefined): BotDefinition | undefined {
  return botDefinitions.find((definition) => definition.id === id);
}

export function botDefinitionForDeckId(deckId: string | undefined): BotDefinition | undefined {
  return botDefinitions.find((definition) => definition.deckId === deckId);
}
