import { useEffect, useMemo, useState } from "react";
import type { GameView } from "@fyendal/shared";
import { pitchFocusSource, type PitchFocusSource } from "./pitchFocusSource.js";
import type { Sel } from "./useActionAnnouncement.js";

interface FocusedAnnouncement {
  gameId: string;
  seat: number;
  source: PitchFocusSource;
}

/** Keep the focus through target/confirmation steps, until the announcement
 * is cancelled or the submitted play changes the presented game view. */
export function retainedPitchFocus(
  view: GameView | null,
  seat: number | null,
  selection: Sel,
  choosingPitch: boolean,
  enabled: boolean,
  previous: FocusedAnnouncement | null,
  submittedSourceId?: number,
): FocusedAnnouncement | null {
  if (!enabled || !view || seat === null) return null;
  if (choosingPitch) {
    const source = pitchFocusSource(view, seat, selection);
    return source ? { gameId: view.gameId, seat, source } : null;
  }
  if (!previous || previous.gameId !== view.gameId || previous.seat !== seat) return null;
  const activeSourceId = selection.kind === "activate" ? selection.sourceInstanceId
    : selection.kind !== "none" ? selection.instanceId
      : submittedSourceId ?? (view.pendingDecision?.player === seat
        ? view.pendingDecision.preStackSource?.card.instanceId : undefined);
  if (previous.source.card.instanceId !== activeSourceId ||
    view.stack.some((layer) => layer.card?.instanceId === activeSourceId) ||
    view.chain.some((link) => link.onStack && link.attackingCard.instanceId === activeSourceId)) return null;
  return previous;
}

export function usePitchFocus(
  view: GameView | null,
  seat: number | null,
  selection: Sel,
  choosingPitch: boolean,
  enabled: boolean,
  submittedSourceId?: number,
): PitchFocusSource | null {
  const [previous, setPrevious] = useState<FocusedAnnouncement | null>(null);
  const focus = useMemo(
    () => retainedPitchFocus(view, seat, selection, choosingPitch, enabled, previous, submittedSourceId),
    [view, seat, selection, choosingPitch, enabled, previous, submittedSourceId],
  );
  useEffect(() => {
    if (focus?.gameId !== previous?.gameId || focus?.seat !== previous?.seat ||
      focus?.source.card.instanceId !== previous?.source.card.instanceId ||
      focus?.source.card.cardId !== previous?.source.card.cardId ||
      focus?.source.fromHand !== previous?.source.fromHand) setPrevious(focus);
  }, [focus, previous]);
  return focus?.source ?? null;
}
