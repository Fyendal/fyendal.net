import type { CardView, GameView } from "@fyendal/shared";
import { extractGamePresentations, type GamePresentations } from "./extractPresentations.js";
import {
  countedMotionLocation,
  motionLocationKey,
  motionLocationSeat,
  opaqueMotionPresentationKey,
  type CardPresentation,
  type CountedMotionLocation,
  type GameMotionEvent,
  type MotionLocation,
  type MotionVisual,
  type MotionZoneCount,
} from "./motionTypes.js";

function cardIsVisible(card: CardView): boolean {
  return card.hidden !== true && card.cardId !== "";
}

function motionVisual(
  source: CardPresentation | null,
  destination: CardPresentation,
): MotionVisual {
  const sourceVisible = source ? cardIsVisible(source.card) : false;
  const destinationVisible = cardIsVisible(destination.card);
  if (sourceVisible && destinationVisible) return { kind: "face", card: destination.card };
  if (!sourceVisible && destinationVisible) {
    return { kind: "back-reveal", card: destination.card };
  }
  return { kind: "back" };
}

function countMap(counts: readonly MotionZoneCount[]): Map<string, MotionZoneCount> {
  return new Map(counts.map((count) => [motionLocationKey(count.location), count]));
}

function zoneCount(
  counts: ReadonlyMap<string, MotionZoneCount>,
  location: CountedMotionLocation,
): number {
  return counts.get(motionLocationKey(location))?.count ?? 0;
}

function budgetMap(
  previous: readonly MotionZoneCount[],
  current: readonly MotionZoneCount[],
  direction: "departures" | "arrivals",
): Map<string, { location: CountedMotionLocation; remaining: number }> {
  const before = countMap(previous);
  const after = countMap(current);
  const result = new Map<string, { location: CountedMotionLocation; remaining: number }>();
  for (const [key, currentCount] of after) {
    const previousCount = before.get(key)?.count ?? 0;
    const delta = direction === "departures"
      ? previousCount - currentCount.count
      : currentCount.count - previousCount;
    if (delta > 0) result.set(key, { location: currentCount.location, remaining: delta });
  }
  return result;
}

function consumeBudget(
  budget: Map<string, { location: CountedMotionLocation; remaining: number }>,
  location: MotionLocation,
  amount = 1,
): void {
  const counted = countedMotionLocation(location);
  if (!counted) return;
  const entry = budget.get(motionLocationKey(counted));
  if (entry) entry.remaining = Math.max(0, entry.remaining - amount);
}

function availableForSeat(
  budget: Map<string, { location: CountedMotionLocation; remaining: number }>,
  seat: number,
): Array<{ location: CountedMotionLocation; remaining: number }> {
  return [...budget.values()].filter((entry) => (
    entry.remaining > 0 && entry.location.seat === seat
  ));
}

function sourceRank(
  source: CardPresentation,
  destination: CardPresentation,
  currentKeys: ReadonlySet<string>,
): number {
  let rank = currentKeys.has(source.key) ? 10 : 0;
  if (destination.role === "canonical" && source.role === "display") rank -= 2;
  if (destination.role === "display" && source.role === "canonical") rank -= 1;
  return rank;
}

function sourceForArrival(
  arrival: CardPresentation,
  previousByInstance: ReadonlyMap<number, readonly CardPresentation[]>,
  currentKeys: ReadonlySet<string>,
): CardPresentation | null {
  const candidates = (previousByInstance.get(arrival.instanceId) ?? [])
    .filter((candidate) => candidate.key !== arrival.key);
  candidates.sort((left, right) => (
    sourceRank(left, arrival, currentKeys) - sourceRank(right, arrival, currentKeys)
  ));
  return candidates[0] ?? null;
}

function triggerSourceRank(source: CardPresentation): number {
  switch (source.location.kind) {
    case "chain-defender":
      return 0;
    case "chain-staged":
      return 1;
    case "chain-attack":
    case "chain-reaction":
    case "chain-target":
      return 2;
    case "board":
    case "equipment":
    case "weapon":
      return 3;
    default:
      return 4;
  }
}

/** A trigger is a causal connection from a source that remains represented in
 * the current view, not a second physical copy of that card moving zones. */
function currentTriggerSource(
  arrival: CardPresentation,
  currentByInstance: ReadonlyMap<number, readonly CardPresentation[]>,
): CardPresentation | null {
  const candidates = (currentByInstance.get(arrival.instanceId) ?? [])
    .filter((candidate) => (
      candidate.key !== arrival.key && candidate.location.kind !== "stack-layer"
    ));
  candidates.sort((left, right) => triggerSourceRank(left) - triggerSourceRank(right));
  return candidates[0] ?? null;
}

function opaqueStagedSourceForDefender(
  destination: CardPresentation,
  previousCards: readonly CardPresentation[],
  consumedKeys: ReadonlySet<string>,
): CardPresentation | null {
  if (destination.location.kind !== "chain-defender") return null;
  const destinationLink = destination.location.link;
  return previousCards.find((candidate) => (
    candidate.location.kind === "chain-staged"
    && candidate.location.link === destinationLink
    && candidate.card.owner === destination.card.owner
    && candidate.card.hidden === true
    && candidate.instanceId < 0
    && !consumedKeys.has(candidate.key)
  )) ?? null;
}

function pulseOnce(
  events: GameMotionEvent[],
  pulsed: Set<string>,
  location: MotionLocation,
): void {
  const key = motionLocationKey(location);
  if (pulsed.has(key)) return;
  pulsed.add(key);
  events.push({ kind: "pulse", location });
}

function inferredArrivalRank(destination: CardPresentation): number {
  // A public combat/stack object is a stronger explanation for an anonymous
  // hidden-zone departure than a newly created arena object. Process it first
  // so an opponent's played attack claims the hand delta before its token.
  if (destination.role === "display") return 0;
  if (destination.location.kind === "board") return 2;
  return 1;
}

function detectFromPresentations(
  previous: GamePresentations,
  current: GamePresentations,
  options: { endPhaseCleanup: boolean },
): GameMotionEvent[] {
  const events: GameMotionEvent[] = [];
  const pulsed = new Set<string>();
  const consumedPreviousKeys = new Set<string>();
  const previousKeys = new Set(previous.cards.map((card) => card.key));
  const currentKeys = new Set(current.cards.map((card) => card.key));
  const previousByInstance = new Map<number, CardPresentation[]>();
  const currentByInstance = new Map<number, CardPresentation[]>();
  for (const card of previous.cards) {
    const entries = previousByInstance.get(card.instanceId) ?? [];
    entries.push(card);
    previousByInstance.set(card.instanceId, entries);
  }
  for (const card of current.cards) {
    const entries = currentByInstance.get(card.instanceId) ?? [];
    entries.push(card);
    currentByInstance.set(card.instanceId, entries);
  }
  const departures = budgetMap(previous.counts, current.counts, "departures");
  const arrivals = budgetMap(previous.counts, current.counts, "arrivals");
  const unmatched: CardPresentation[] = [];

  for (const destination of current.cards) {
    if (previousKeys.has(destination.key)) continue;
    if (destination.location.kind === "stack-layer") {
      const triggerSource = currentTriggerSource(destination, currentByInstance);
      if (triggerSource) {
        events.push({
          kind: "connect",
          source: triggerSource.location,
          destination: destination.location,
          instanceId: destination.instanceId,
          sourcePresentationKey: triggerSource.key,
          destinationPresentationKey: destination.key,
        });
        continue;
      }
    }
    const opaqueStagedSource = opaqueStagedSourceForDefender(
      destination,
      previous.cards,
      consumedPreviousKeys,
    );
    if (opaqueStagedSource) {
      events.push({
        kind: "settle",
        destination: destination.location,
        visual: motionVisual(opaqueStagedSource, destination),
        instanceId: destination.instanceId,
        destinationPresentationKey: destination.key,
      });
      consumedPreviousKeys.add(opaqueStagedSource.key);
      consumeBudget(departures, {
        kind: "hand",
        seat: opaqueStagedSource.card.owner,
      });
      consumeBudget(arrivals, destination.location);
      continue;
    }
    const source = sourceForArrival(destination, previousByInstance, currentKeys);
    if (!source) {
      unmatched.push(destination);
      continue;
    }
    if (
      source.location.kind === "chain-staged"
      && destination.location.kind === "chain-defender"
    ) {
      events.push({
        kind: "settle",
        destination: destination.location,
        visual: motionVisual(source, destination),
        instanceId: destination.instanceId,
        destinationPresentationKey: destination.key,
      });
      consumedPreviousKeys.add(source.key);
      consumeBudget(departures, source.location);
      // Hand defenders remain counted in hand while staged, then leave the
      // authoritative hand on confirmation. The visual source is already the
      // staged chain card, so consume that bookkeeping delta without emitting
      // a second hand pulse.
      consumeBudget(departures, { kind: "hand", seat: source.card.owner });
      consumeBudget(arrivals, destination.location);
      continue;
    }
    events.push({
      kind: "move",
      source: source.location,
      destination: destination.location,
      visual: motionVisual(source, destination),
      instanceId: destination.instanceId,
      sourcePresentationKey: source.key,
      destinationPresentationKey: destination.key,
      count: 1,
      confidence: "exact",
    });
    consumedPreviousKeys.add(source.key);
    consumeBudget(departures, source.location);
    consumeBudget(arrivals, destination.location);
  }

  unmatched.sort((left, right) => inferredArrivalRank(left) - inferredArrivalRank(right));
  for (const destination of unmatched) {
    const seat = motionLocationSeat(destination.location) ?? destination.card.owner;
    const possibleSources = availableForSeat(departures, seat);
    if (
      destination.location.kind === "chain-staged"
      && destination.card.hidden === true
      && destination.instanceId < 0
    ) {
      // The opponent's projected hand keeps its count while a defender is
      // staged and deliberately exposes no stable card identity. Its causal
      // origin is nevertheless unambiguous: show a back traveling from that
      // player's hand zone without attempting to correlate the opaque id.
      events.push({
        kind: "move",
        source: { kind: "hand", seat: destination.card.owner },
        destination: destination.location,
        visual: { kind: "back" },
        instanceId: destination.instanceId,
        destinationPresentationKey: destination.key,
        count: 1,
        confidence: "inferred",
      });
    } else if (
      options.endPhaseCleanup
      && destination.location.kind === "hand"
      && destination.role === "canonical"
    ) {
      // Draw-up happens after arsenaling and pitch cleanup, but all three can
      // arrive in one authoritative view. A newly visible hand identity that
      // had no prior presentation is therefore a deck draw, even when pitch
      // bottoming makes the raw count deltas otherwise ambiguous.
      events.push({
        kind: "move",
        source: { kind: "deck", seat },
        destination: destination.location,
        visual: motionVisual(null, destination),
        instanceId: destination.instanceId,
        destinationPresentationKey: destination.key,
        count: 1,
        confidence: "inferred",
      });
      consumeBudget(departures, { kind: "deck", seat });
      consumeBudget(arrivals, destination.location);
    } else if (possibleSources.length === 1) {
      const source = possibleSources[0]!;
      source.remaining -= 1;
      consumeBudget(arrivals, destination.location);
      events.push({
        kind: "move",
        source: source.location,
        destination: destination.location,
        visual: motionVisual(null, destination),
        instanceId: destination.instanceId,
        destinationPresentationKey: destination.key,
        count: 1,
        confidence: "inferred",
      });
    } else if (destination.role === "canonical" && destination.location.kind === "board") {
      events.push({
        kind: "appear",
        destination: destination.location,
        visual: cardIsVisible(destination.card)
          ? { kind: "face", card: destination.card }
          : { kind: "back" },
        instanceId: destination.instanceId,
        destinationPresentationKey: destination.key,
      });
    } else {
      pulseOnce(events, pulsed, destination.location);
    }
  }

  if (options.endPhaseCleanup) {
    const previousCounts = countMap(previous.counts);
    const currentCounts = countMap(current.counts);
    for (const seat of [0, 1]) {
      const hand = { kind: "hand", seat } as const;
      const deck = { kind: "deck", seat } as const;
      const arsenal = { kind: "arsenal", seat } as const;
      const arsenalIncrease = Math.max(
        0,
        zoneCount(currentCounts, arsenal) - zoneCount(previousCounts, arsenal),
      );
      const unresolvedArsenal = arrivals.get(motionLocationKey(arsenal));

      // Opponent projections expose only private-zone counts. When arsenaling
      // and draw-up are shortcut into one view, the hand can have no net
      // departure, which otherwise makes deck -> arsenal look like the only
      // count-balanced path. End-phase ordering makes the real cause safe to
      // infer: arsenal from hand, then replacement cards from deck.
      const inferredArsenalCount = Math.min(
        arsenalIncrease,
        unresolvedArsenal?.remaining ?? 0,
      );
      if (inferredArsenalCount > 0 && unresolvedArsenal) {
        unresolvedArsenal.remaining -= inferredArsenalCount;
        consumeBudget(departures, hand, inferredArsenalCount);
        events.push({
          kind: "move",
          source: hand,
          destination: arsenal,
          visual: { kind: "back" },
          destinationPresentationKey: opaqueMotionPresentationKey(arsenal),
          count: inferredArsenalCount,
          confidence: "inferred",
        });
      }

      const expectedDrawCount = Math.max(
        0,
        zoneCount(currentCounts, hand)
          - zoneCount(previousCounts, hand)
          + arsenalIncrease,
      );
      const representedDrawCount = events.reduce((total, event) => (
        event.kind === "move"
        && event.source.kind === "deck"
        && event.source.seat === seat
        && event.destination.kind === "hand"
        && event.destination.seat === seat
          ? total + event.count
          : total
      ), 0);
      const inferredDrawCount = Math.max(0, expectedDrawCount - representedDrawCount);
      if (inferredDrawCount > 0) {
        consumeBudget(departures, deck, inferredDrawCount);
        consumeBudget(arrivals, hand, inferredDrawCount);
        const firstDrawnHandIndex = Math.max(
          0,
          zoneCount(currentCounts, hand) - inferredDrawCount,
        );
        for (let index = 0; index < inferredDrawCount; index += 1) {
          events.push({
            kind: "move",
            source: deck,
            destination: hand,
            visual: { kind: "back" },
            destinationPresentationKey: opaqueMotionPresentationKey(
              hand,
              firstDrawnHandIndex + index,
            ),
            count: 1,
            confidence: "inferred",
          });
        }
      }
    }
  }

  for (const seat of [0, 1]) {
    const possibleSources = availableForSeat(departures, seat);
    const possibleDestinations = availableForSeat(arrivals, seat);
    if (possibleSources.length === 1 && possibleDestinations.length === 1) {
      const source = possibleSources[0]!;
      const destination = possibleDestinations[0]!;
      const count = Math.min(source.remaining, destination.remaining);
      if (count > 0) {
        source.remaining -= count;
        destination.remaining -= count;
        events.push({
          kind: "move",
          source: source.location,
          destination: destination.location,
          visual: { kind: "back" },
          count,
          confidence: "inferred",
        });
      }
    }
  }

  for (const entry of [...departures.values(), ...arrivals.values()]) {
    if (entry.remaining > 0) pulseOnce(events, pulsed, entry.location);
  }
  for (const source of previous.cards) {
    if (
      !currentKeys.has(source.key)
      && !consumedPreviousKeys.has(source.key)
      && !events.some((event) => (
        (
          event.kind === "move"
          || event.kind === "appear"
          || event.kind === "settle"
          || event.kind === "connect"
        )
        && event.instanceId === source.instanceId
      ))
    ) {
      pulseOnce(events, pulsed, source.location);
    }
  }
  return events;
}

/** Derive viewer-safe presentation changes from two already-projected views.
 * The detector deliberately emits pulses instead of inventing a path when a
 * private-zone count change has more than one plausible explanation. */
export function detectGameMotionEvents(
  previous: GameView,
  current: GameView,
): GameMotionEvent[] {
  const endPhaseCleanup = previous.phase === "end"
    || current.phase === "end"
    || previous.pendingDecision?.kind === "arsenal"
    || current.turn !== previous.turn;
  const events = detectFromPresentations(
    extractGamePresentations(previous),
    extractGamePresentations(current),
    { endPhaseCleanup },
  );
  // Draw-up, pitch bottoming, and other end-phase bookkeeping often change
  // several counted zones in one state. Their unmatched count deltas are not
  // useful causal feedback; keep exact flights (including arsenaling) and
  // omit only the generic gold ambiguity pulses.
  return endPhaseCleanup
    ? events.filter((event) => event.kind !== "pulse")
    : events;
}
