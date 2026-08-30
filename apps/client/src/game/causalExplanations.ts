import type { CardView, GameIntent, GameView, PendingDecision } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";

export interface CausalStatus {
  kind: "priority" | "decision" | "waiting" | "action" | "complete";
  heading: string;
}

type TurnPhaseLabel = "START PHASE" | "ACTION PHASE" | "END PHASE" | "GAME OVER";

function stackTiming(view: GameView): string | undefined {
  const context = view.stackContext?.split(" · ")[0];
  if (!context) return undefined;
  if (context.endsWith(" STEP")) return `ACTION PHASE · ${context}`;
  if (context.endsWith(" PHASE")) return context;
  return undefined;
}

/** CR 4.0.3a phase, independent of the engine's internal flow state. */
export function gamePhaseLabel(view: GameView): TurnPhaseLabel {
  if (view.winner !== null || view.phase === "game-over") return "GAME OVER";
  const timing = stackTiming(view);
  if (timing?.startsWith("START PHASE")) return "START PHASE";
  if (timing?.startsWith("END PHASE")) return "END PHASE";
  if (view.phase === "start") return "START PHASE";
  if (view.phase === "end" || view.pendingDecision?.kind === "arsenal") return "END PHASE";
  return "ACTION PHASE";
}

/** CR phase followed by the combat step, when combat is active. */
export function gameTimingLabel(view: GameView): string {
  const timing = stackTiming(view);
  if (timing) return timing;
  const phase = gamePhaseLabel(view);
  if (phase !== "ACTION PHASE") return phase;
  const decision = view.pendingDecision?.kind;
  if (decision === "defend") return "ACTION PHASE · DEFEND STEP";
  if (decision === "attack-reaction" || decision === "defense-reaction" || view.phase === "reaction") {
    return "ACTION PHASE · REACTION STEP";
  }
  const latestLink = view.chain[view.chain.length - 1];
  if (latestLink?.onStack) return "ACTION PHASE · LAYER STEP";
  if (latestLink?.resolved) return "ACTION PHASE · RESOLUTION STEP";
  return phase;
}

/** Whether the game is at priority, excluding mandatory non-priority choices. */
export function gameHasPriority(view: GameView): boolean {
  if (view.winner !== null) return false;
  const decision = view.pendingDecision?.kind;
  if (decision === undefined) return view.phase === "action";
  return (
    decision === "priority-window" ||
    decision === "attack-reaction" ||
    decision === "defense-reaction"
  );
}

function actor(view: GameView, seat: number | null, player: number): string {
  if (seat === player) return "You";
  return view.players[player]?.heroName ?? "Opponent";
}

function priorityOwner(view: GameView, seat: number | null): string {
  return seat === view.priorityPlayer ? "YOUR PRIORITY" : `${actor(view, seat, view.priorityPlayer).toUpperCase()}'S PRIORITY`;
}

function decisionStatus(view: GameView, seat: number | null, pd: PendingDecision): CausalStatus {
  const mine = seat === pd.player;
  const decider = actor(view, seat, pd.player);
  switch (pd.kind) {
    case "defend":
      return {
        kind: mine ? "decision" : "waiting",
        heading: `ACTION PHASE · DEFEND STEP · ${mine ? "YOU" : "OPPONENT"} CHOOSING BLOCKS`,
      };
    case "attack-reaction":
      return {
        kind: mine ? "priority" : "waiting",
        heading: `ACTION PHASE · REACTION STEP · ${priorityOwner(view, seat)}`,
      };
    case "defense-reaction":
      return {
        kind: mine ? "priority" : "waiting",
        heading: `ACTION PHASE · REACTION STEP · ${priorityOwner(view, seat)}`,
      };
    case "priority-window": {
      return {
        kind: mine ? "priority" : "waiting",
        heading: `${gameTimingLabel(view)} · ${priorityOwner(view, seat)}`,
      };
    }
    case "arsenal":
      return {
        kind: mine ? "decision" : "waiting",
        heading: mine ? "END PHASE · CHOOSE ARSENAL" : `END PHASE · WAITING ON ${decider.toUpperCase()}`,
      };
    case "choose-name":
    case "choose-target":
    case "optional-effect":
      return {
        kind: mine ? "decision" : "waiting",
        heading: mine ? "EFFECT · CHOOSE" : `EFFECT · WAITING ON ${decider.toUpperCase()}`,
      };
    case "order-triggers":
      return {
        kind: mine ? "decision" : "waiting",
        heading: mine ? "EFFECT · ORDER TRIGGERS" : `EFFECT · WAITING ON ${decider.toUpperCase()}`,
      };
  }
}

export function causalStatus(view: GameView, seat: number | null): CausalStatus {
  if (view.winner !== null) {
    return { kind: "complete", heading: "GAME OVER" };
  }
  if (view.pendingDecision) return decisionStatus(view, seat, view.pendingDecision);
  if (view.phase === "action") {
    const latestLink = view.chain[view.chain.length - 1];
    if (latestLink?.resolved) {
      const mine = seat === view.priorityPlayer;
      return {
        kind: mine ? "action" : "waiting",
        heading: `ACTION PHASE · RESOLUTION STEP · ${priorityOwner(view, seat)}`,
      };
    }
    const mine = seat === view.activePlayer;
    return {
      kind: mine ? "action" : "waiting",
      heading: mine ? "ACTION PHASE · YOUR ACTION" : `ACTION PHASE · ${actor(view, seat, view.activePlayer).toUpperCase()} TO ACT`,
    };
  }
  return {
    kind: "waiting",
    heading: `${gameTimingLabel(view)} · WAITING`,
  };
}

function intentUsesCard(intent: GameIntent, instanceId: number): boolean {
  return (
    (intent.kind === "play-card" || intent.kind === "play-from-arsenal" || intent.kind === "play-from-zone") &&
    intent.instanceId === instanceId
  );
}

const LEGAL_CARD = { legal: true } as const;
const UNEXPLAINED_ILLEGAL_CARD = { legal: false } as const;

export function cardLegalityExplanation(
  view: GameView,
  seat: number,
  legal: readonly GameIntent[],
  card: CardView,
): { legal: boolean; text?: string } {
  if (legal.some((intent) => intentUsesCard(intent, card.instanceId))) {
    return LEGAL_CARD;
  }

  const data = cardData[card.cardId];
  const pd = view.pendingDecision;
  if (pd && pd.player !== seat) {
    return UNEXPLAINED_ILLEGAL_CARD;
  }
  if (pd?.kind === "defend") {
    if (data?.cardType === "defense-reaction") {
      return { legal: false, text: "Not legal in the defend step: defense reactions are played in the later defense reaction window." };
    }
    if (data?.defense === undefined) {
      return UNEXPLAINED_ILLEGAL_CARD;
    }
    return { legal: false, text: "Not legal as a blocker: an effect or attack restriction prevents this card from defending." };
  }
  return UNEXPLAINED_ILLEGAL_CARD;
}
