import type { GameTransitionView, GameView, PendingDecision } from "@fyendal/shared";
import type { ViewUpdate } from "../store/types.js";
import { classifyViewUpdate } from "./motion/classifyViewUpdate.js";
import { attackLayerPresentation } from "./attackLayerPresentation.js";

export interface OpponentPlayInput {
  view: GameView | null;
  update: ViewUpdate;
  viewerSeat: number | null;
  enabled: boolean;
  scope: string;
}

export interface OpponentPlayPresentation {
  input: OpponentPlayInput;
  view: GameView | null;
  update: ViewUpdate;
  pending?: {
    source: NonNullable<PendingDecision["preStackSource"]>;
    seat: number;
    baseline: GameView;
    transition: GameTransitionView;
  };
}

function appendTransition(
  previous: GameTransitionView,
  current: GameTransitionView | undefined,
): GameTransitionView {
  // Preserve known private-zone paths, such as a face-down bottom-deck cost.
  // The motion pipeline infers any remaining moves from displayed snapshots.
  return { ...previous, events: [...previous.events, ...(current?.events ?? [])] };
}

/** Buffer only presentation. Authoritative views, capabilities, and replay
 * recording keep receiving every decision in the store. */
export function opponentPlayPresentation(
  previous: OpponentPlayPresentation | null,
  input: OpponentPlayInput,
): OpponentPlayPresentation {
  const { view, update, viewerSeat, enabled } = input;
  if (!view || !enabled) return { input, view, update };

  const continuous = previous?.input.scope === input.scope && previous.input.enabled
    && previous.input.viewerSeat === viewerSeat && previous.input.update.source === update.source
    && update.transition === "forward"
    && classifyViewUpdate(previous.input.view, view, update).kind === "animate";
  const prior = continuous ? previous : null;
  const presentedUpdate: ViewUpdate = previous?.pending && !prior ? { ...update, transition: "replace" } : update;
  const decision = view.pendingDecision;
  const source = decision?.player !== viewerSeat ? decision?.preStackSource : undefined;
  // A weapon or reusable ability may already have an older layer/link with
  // this source. The pending announcement marks the new activation, not that layer.
  if (decision && source && view.phase !== "game-over") {
    const continuing = prior?.pending?.source.card.instanceId === source.card.instanceId ? prior.pending : undefined;
    // On initial load/reconnect we have no earlier board to reconstruct. Use
    // the received snapshot as the baseline and defer only subsequent changes.
    const baseline = continuing?.baseline ?? prior?.view ?? view;
    const transition = continuing
      ? appendTransition(continuing.transition, update.gameTransition)
      : {
          kind: "forward" as const,
          fromVersion: prior?.input.update.roomVersion ?? update.roomVersion ?? 0,
          events: prior ? (update.gameTransition?.events ?? []) : [],
        };
    return {
      input,
      view: {
        ...baseline,
        drawOfferSeat: view.drawOfferSeat,
        pendingDecision: { player: decision.player, kind: "choose-target", prompt: "" },
      },
      update: { ...presentedUpdate, gameTransition: update.gameTransition?.kind === "replace"
        ? update.gameTransition : undefined },
      pending: { source, seat: decision.player, baseline, transition },
    };
  }

  if (prior?.pending) {
    const { source, seat } = prior.pending;
    const transition = appendTransition(prior.pending.transition, update.gameTransition);
    const before = attackLayerPresentation(prior.input.view!);
    const after = attackLayerPresentation(view);
    const stackCount = (layers: typeof view.stack) =>
      layers.filter((layer) => layer.card?.instanceId === source.card.instanceId).length;
    const entersStack = stackCount(after.stack) > stackCount(before.stack);
    const entersChain = after.chain.some((link, index) => link.attackingCard.instanceId === source.card.instanceId
      && before.chain[index]?.attackingCard.instanceId !== source.card.instanceId);
    const sourceZone = source.zone;
    const cardPlay = sourceZone === "hand" || sourceZone === "arsenal"
      || sourceZone === "banish" || sourceZone === "graveyard" || sourceZone === "deck";
    // Arena abilities use the normal source-to-layer connection animation;
    // never invent a physical equipment/weapon/board move onto the stack.
    if (cardPlay && (entersStack || entersChain) && !transition.events.some((event) =>
      event.instanceId === source.card.instanceId && (event.to?.kind === "stack" || event.to?.kind === "chain"))) {
      // The card may have left hand in an earlier decision, including before
      // reconnect. Its public announcement still identifies the correct origin.
      transition.events.push({
        kind: "move", count: 1, instanceId: source.card.instanceId,
        from: { kind: sourceZone, seat },
        to: { kind: entersStack ? "stack" : "chain", seat },
      });
    }
    return { input, view, update: { ...presentedUpdate, gameTransition: transition } };
  }
  return { input, view, update: presentedUpdate };
}
