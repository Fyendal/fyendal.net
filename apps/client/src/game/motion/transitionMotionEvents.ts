import type {
  CardView,
  GameTransitionMove,
  GameTransitionView,
  GameTransitionZone,
  GameView,
} from "@fyendal/shared";
import { detectGameMotionEvents } from "./detectMotionEvents.js";
import { extractGamePresentations } from "./extractPresentations.js";
import {
  countedMotionLocation,
  motionLocationKey,
  opaqueMotionPresentationKey,
  type CardPresentation,
  type GameMotionEvent,
  type HandReflowMotionEvent,
  type MotionLocation,
  type MotionVisual,
} from "./motionTypes.js";

function zoneMatches(location: MotionLocation, zone: GameTransitionZone): boolean {
  if (zone.kind === "stack") {
    return location.kind === "stack-layer" || location.kind === "stack-attack";
  }
  if (zone.kind === "chain") return location.kind.startsWith("chain-");
  if (!("seat" in location) || location.seat !== zone.seat) return false;
  return location.kind === zone.kind;
}

function basicLocation(zone: GameTransitionZone): MotionLocation | null {
  switch (zone.kind) {
    case "deck":
      return { kind: "deck", seat: zone.seat, position: zone.position };
    case "hand": case "arsenal": case "pitch":
    case "graveyard": case "banish": case "soul": case "board":
      return { kind: zone.kind, seat: zone.seat };
    default:
      return null;
  }
}

function presentationFor(
  cards: readonly CardPresentation[],
  instanceId: number | undefined,
  zone: GameTransitionZone | null,
): CardPresentation | null {
  if (instanceId === undefined || zone === null) return null;
  return cards.find((candidate) => (
    candidate.instanceId === instanceId && zoneMatches(candidate.location, zone)
  )) ?? null;
}

function cardVisible(card: CardView): boolean {
  return card.hidden !== true && card.cardId !== "";
}

function visualFor(
  source: CardPresentation | null,
  destination: CardPresentation | null,
): MotionVisual {
  const sourceVisible = source !== null && cardVisible(source.card);
  const destinationVisible = destination !== null && cardVisible(destination.card);
  if (!destinationVisible) {
    return sourceVisible
      ? { kind: "face-conceal", card: source.card }
      : { kind: "back" };
  }
  // A card projected visibly in hand belongs to the viewer. Draw it face-up
  // from the start; hidden opponent hands have no visible destination card and
  // continue through the anonymous-back branch above.
  if (destination.location.kind === "hand") {
    return { kind: "face", card: destination.card };
  }
  return sourceVisible
    ? { kind: "face", card: destination.card }
    : { kind: "back-reveal", card: destination.card };
}

function reversedMove(event: GameTransitionMove): GameTransitionMove {
  return { ...event, from: event.to, to: event.from };
}

function countFor(
  presentations: ReturnType<typeof extractGamePresentations>,
  location: MotionLocation,
): number {
  return presentations.counts.find((entry) => (
    motionLocationKey(entry.location) === motionLocationKey(location)
  ))?.count ?? 0;
}

function deckCoverVisual(view: GameView, seat: number): MotionVisual {
  const top = view.players.find((player) => player.seat === seat)?.visibleDeckTop;
  return top && cardVisible(top) ? { kind: "face", card: top } : { kind: "back" };
}

function sameMove(
  inferred: GameMotionEvent,
  semantic: GameMotionEvent,
): boolean {
  if (inferred.kind !== "move" || semantic.kind !== "move") return false;
  if (inferred.instanceId !== undefined && semantic.instanceId !== undefined) {
    return inferred.instanceId === semantic.instanceId;
  }
  return motionLocationKey(inferred.source) === motionLocationKey(semantic.source)
    && motionLocationKey(inferred.destination) === motionLocationKey(semantic.destination);
}

function deferTurnStartStackEntry(event: GameMotionEvent): GameMotionEvent {
  if (event.kind === "connect") {
    return event.destination.kind === "stack-layer"
      ? { ...event, timeline: "turn-start" }
      : event;
  }
  if (event.kind !== "move") return event;
  return event.destination.kind === "stack-layer" || event.destination.kind === "stack-attack"
    ? { ...event, timeline: "turn-start" }
    : event;
}

/** Convert an authoritative domain transition into client motion while keeping
 * snapshot detection only for presentation-only changes not covered by it. */
export function transitionMotionEvents(
  previous: GameView,
  current: GameView,
  transition: GameTransitionView,
  direction: "forward" | "backward",
): GameMotionEvent[] {
  if (transition.kind === "replace") return [];
  const sourceView = direction === "forward" ? previous : current;
  const destinationView = direction === "forward" ? current : previous;
  const source = extractGamePresentations(sourceView);
  const destination = extractGamePresentations(destinationView);
  const moves = direction === "forward"
    ? transition.events
    : [...transition.events].reverse().map(reversedMove);
  const anonymousDestinationTotals = new Map<string, number>();
  const anonymousSourceTotals = new Map<string, number>();
  for (const move of moves) {
    if (move.instanceId === undefined && move.from !== null) {
      const location = basicLocation(move.from);
      const counted = location && countedMotionLocation(location);
      if (counted) {
        const key = motionLocationKey(counted);
        anonymousSourceTotals.set(key, (anonymousSourceTotals.get(key) ?? 0) + move.count);
      }
    }
    if (move.instanceId !== undefined || move.to === null) continue;
    const location = basicLocation(move.to);
    const counted = location && countedMotionLocation(location);
    if (!counted) continue;
    const key = motionLocationKey(counted);
    anonymousDestinationTotals.set(key, (anonymousDestinationTotals.get(key) ?? 0) + move.count);
  }
  const anonymousDestinationOffsets = new Map<string, number>();
  const anonymousSourceOffsets = new Map<string, number>();
  const semantic: GameMotionEvent[] = [];

  for (const move of moves) {
    const sourcePresentation = presentationFor(source.cards, move.instanceId, move.from);
    const destinationPresentation = presentationFor(destination.cards, move.instanceId, move.to);
    const sourceLocation = sourcePresentation?.location
      ?? (move.from ? basicLocation(move.from) : null);
    const destinationLocation = destinationPresentation?.location
      ?? (move.to ? basicLocation(move.to) : null);

    if (sourceLocation && destinationLocation) {
      let sourcePresentationKey = sourcePresentation?.key;
      const countedSource = countedMotionLocation(sourceLocation);
      if (!sourcePresentationKey && move.instanceId === undefined && countedSource
        && countedSource.kind !== "deck") {
        const key = motionLocationKey(countedSource);
        const total = anonymousSourceTotals.get(key) ?? 1;
        const offset = anonymousSourceOffsets.get(key) ?? 0;
        anonymousSourceOffsets.set(key, offset + 1);
        sourcePresentationKey = opaqueMotionPresentationKey(
          countedSource,
          Math.max(0, countFor(source, countedSource) - total) + offset,
        );
      }
      let destinationPresentationKey = destinationPresentation?.key;
      const countedDestination = countedMotionLocation(destinationLocation);
      // A deck pile exposes only its current top, never one DOM card per
      // position. A bottom insertion therefore targets the pile itself and
      // must not synthesize an opaque "top card" destination to mask.
      if (!destinationPresentationKey && countedDestination
        && countedDestination.kind !== "deck") {
        const key = motionLocationKey(countedDestination);
        const total = anonymousDestinationTotals.get(key) ?? 1;
        const offset = anonymousDestinationOffsets.get(key) ?? 0;
        anonymousDestinationOffsets.set(key, offset + 1);
        const finalCount = destination.counts.find((entry) => (
          motionLocationKey(entry.location) === key
        ))?.count ?? total;
        destinationPresentationKey = opaqueMotionPresentationKey(
          countedDestination,
          Math.max(0, finalCount - total) + offset,
        );
      }
      semantic.push({
        kind: "move",
        source: sourceLocation,
        destination: destinationLocation,
        visual: visualFor(sourcePresentation, destinationPresentation),
        count: move.count,
        confidence: move.instanceId === undefined ? "inferred" : "exact",
        ...(move.instanceId === undefined ? {} : { instanceId: move.instanceId }),
        ...(sourcePresentationKey ? { sourcePresentationKey } : {}),
        ...(destinationPresentationKey ? { destinationPresentationKey } : {}),
        ...(destinationLocation.kind === "deck" && destinationLocation.position === "bottom"
          ? { destinationCoverVisual: deckCoverVisual(destinationView, destinationLocation.seat) }
          : {}),
      });
    } else if (sourceLocation) {
      if (sourcePresentation && cardVisible(sourcePresentation.card)) {
        semantic.push({
          kind: "disappear",
          source: sourceLocation,
          visual: { kind: "face", card: sourcePresentation.card },
          instanceId: sourcePresentation.instanceId,
          sourcePresentationKey: sourcePresentation.key,
        });
      }
    }
  }

  const inferred = detectGameMotionEvents(previous, current).filter((event) => (
    !semantic.some((candidate) => sameMove(event, candidate))
  ));

  const drawSeats = new Set<number>();
  const arsenalSeats = new Set<number>();
  const handDepartures = new Map<number, number>();
  const handArrivals = new Map<number, number>();
  for (const event of semantic) {
    if (event.kind !== "move") continue;
    if (event.source.kind === "hand" && event.destination.kind !== "hand") {
      handDepartures.set(
        event.source.seat,
        (handDepartures.get(event.source.seat) ?? 0) + event.count,
      );
    }
    if (event.destination.kind === "hand" && event.source.kind !== "hand") {
      handArrivals.set(
        event.destination.seat,
        (handArrivals.get(event.destination.seat) ?? 0) + event.count,
      );
    }
    if (event.source.kind === "deck" && event.destination.kind === "hand") {
      drawSeats.add(event.destination.seat);
    }
    if (event.source.kind === "hand" && event.destination.kind === "arsenal") {
      arsenalSeats.add(event.source.seat);
    }
  }
  const reflows: HandReflowMotionEvent[] = [];
  for (const before of source.cards) {
    if (before.location.kind !== "hand") continue;
    const beforeHand = before.location;
    const after = destination.cards.find((candidate) => (
      candidate.instanceId === before.instanceId && candidate.location.kind === "hand"
      && candidate.location.seat === beforeHand.seat
    ));
    if (!after) continue;
    const seat = beforeHand.seat;
    const phase = drawSeats.has(seat) ? "draw" : arsenalSeats.has(seat) ? "arsenal" : null;
    if (!phase) continue;
    reflows.push({
      kind: "reflow",
      source: beforeHand,
      destination: after.location as Extract<MotionLocation, { kind: "hand" }>,
      visual: cardVisible(after.card) ? { kind: "face", card: after.card } : { kind: "back" },
      instanceId: before.instanceId,
      sourcePresentationKey: before.key,
      destinationPresentationKey: after.key,
      phase,
    });
  }
  for (const seat of new Set([...drawSeats, ...arsenalSeats])) {
    const hand = { kind: "hand" as const, seat };
    // Hidden hands have stable presentation slots but no card identities. A
    // slot that departs and is replaced in the same transition is not a card
    // that remained in hand: reflowing it would leave a second back behind
    // while its arsenal flight is already moving away.
    const persistentSourceCount = Math.max(
      0,
      countFor(source, hand) - (handDepartures.get(seat) ?? 0),
    );
    const persistentDestinationCount = Math.max(
      0,
      countFor(destination, hand) - (handArrivals.get(seat) ?? 0),
    );
    const shared = Math.min(persistentSourceCount, persistentDestinationCount);
    for (let index = 0; index < shared; index++) {
      const key = opaqueMotionPresentationKey(hand, index);
      reflows.push({
        kind: "reflow",
        source: hand,
        destination: hand,
        visual: { kind: "back" },
        sourcePresentationKey: key,
        destinationPresentationKey: key,
        phase: drawSeats.has(seat) ? "draw" : "arsenal",
      });
    }
  }
  const events = [...semantic, ...inferred, ...reflows];
  // End-phase cleanup and startTurn are committed as one authoritative edge.
  // A trigger already visible on the new turn's stack must nevertheless wait
  // for arsenal, pitch-bottoming, draw-up, and hand reflow to finish playing.
  return direction === "forward" && current.turn > previous.turn
    ? events.map(deferTurnStartStackEntry)
    : events;
}
