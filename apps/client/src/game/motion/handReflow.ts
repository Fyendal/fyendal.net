import type { GamePresentations } from "./extractPresentations.js";
import { opaqueMotionPresentationKey, type GameMotionEvent, type HandReflowMotionEvent } from "./motionTypes.js";

const HAND_PHASE_RANK = {
  movement: 0, arsenal: 1, "effect-draw": 2, "effect-discard": 3, draw: 4,
} as const;

/** Only remaining, viewer-visible identities or anonymous hand slots slide.
 * The departing card has its own movement or focus presentation. */
export function handReflows(
  previous: GamePresentations,
  current: GamePresentations,
  events: readonly GameMotionEvent[],
  layoutChangedSeats: readonly number[] = [],
): HandReflowMotionEvent[] {
  const phases = new Map<number, HandReflowMotionEvent["phase"]>(
    layoutChangedSeats.map((seat) => [seat, "movement"]),
  );
  const setPhase = (seat: number, phase: HandReflowMotionEvent["phase"]) => {
    if (HAND_PHASE_RANK[phase] >= HAND_PHASE_RANK[phases.get(seat) ?? "movement"]) phases.set(seat, phase);
  };
  const departures = new Map<number, number>();
  const arrivals = new Map<number, number>();
  for (const event of events) {
    if (event.kind !== "move") continue;
    if (event.source.kind === "hand" && event.destination.kind !== "hand") {
      const seat = event.source.seat;
      departures.set(seat, (departures.get(seat) ?? 0) + event.count);
      setPhase(seat, event.timeline === "effect-discard"
        ? "effect-discard"
        : event.destination.kind === "arsenal" ? "arsenal" : "movement");
    }
    if (event.destination.kind === "hand" && event.source.kind !== "hand") {
      const seat = event.destination.seat;
      arrivals.set(seat, (arrivals.get(seat) ?? 0) + event.count);
      if (event.source.kind === "deck") setPhase(seat, event.timeline === "effect-draw" ? "effect-draw" : "draw");
    }
  }
  for (const count of previous.counts) {
    if (count.location.kind !== "hand") continue;
    const seat = count.location.seat;
    const next = current.counts.find((entry) => entry.location.kind === "hand" && entry.location.seat === seat);
    if (next && next.count < count.count) setPhase(seat, "movement");
  }
  const currentHand = new Map(current.cards.flatMap((card) => card.location.kind === "hand"
    ? [[`${card.location.seat}:${card.instanceId}`, card] as const] : []));
  const reflows: HandReflowMotionEvent[] = [];
  for (const before of previous.cards) {
    if (before.location.kind !== "hand") continue;
    const seat = before.location.seat;
    const phase = phases.get(seat);
    const after = currentHand.get(`${seat}:${before.instanceId}`);
    if (!phase || !after) continue;
    reflows.push({
      kind: "reflow", source: { kind: "hand", seat }, destination: { kind: "hand", seat },
      visual: after.card.hidden || after.card.cardId === "" ? { kind: "back" } : { kind: "face", card: after.card },
      instanceId: after.instanceId, sourcePresentationKey: before.key, destinationPresentationKey: after.key,
      phase,
    });
  }
  for (const [seat, phase] of phases) {
    const hand = { kind: "hand" as const, seat };
    const count = (presentations: GamePresentations) => presentations.counts.find((entry) =>
      entry.location.kind === "hand" && entry.location.seat === seat)?.count ?? 0;
    const persistentCount = Math.max(0, Math.min(
      count(previous) - (departures.get(seat) ?? 0), count(current) - (arrivals.get(seat) ?? 0),
    ));
    for (let index = 0; index < persistentCount; index++) {
      const key = opaqueMotionPresentationKey(hand, index);
      reflows.push({
        kind: "reflow", source: hand, destination: hand, visual: { kind: "back" },
        sourcePresentationKey: key, destinationPresentationKey: key, phase,
      });
    }
  }
  return reflows;
}

/** Focus removes a hand slot without changing authoritative card zones. */
export function focusHandReflows(
  previous: GamePresentations,
  current: GamePresentations,
  previousFocusIds: readonly number[],
  currentFocusIds: readonly number[],
): HandReflowMotionEvent[] {
  const changedIds = [...new Set([...previousFocusIds, ...currentFocusIds])]
    .filter((id) => previousFocusIds.includes(id) !== currentFocusIds.includes(id));
  const seats = new Set<number>();
  for (const card of [...previous.cards, ...current.cards]) {
    if (card.location.kind === "hand" && changedIds.includes(card.instanceId)) seats.add(card.location.seat);
  }
  return handReflows(previous, current, [], [...seats]);
}
