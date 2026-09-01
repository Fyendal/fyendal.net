import {
  motionLocationKey,
  type GameMotionEvent,
  type MoveMotionEvent,
  type MotionLocation,
  type MotionVisual,
} from "./motionTypes.js";
import {
  motionTimelinePhase,
  scheduleMotionTimeline,
  type MotionTimelinePhase,
} from "./motionTimeline.js";

export const MOTION_TRAVEL_MS = 320;
export const MOTION_DECK_BOTTOM_MS = 560;
export const MOTION_PITCH_GATHER_MS = 180;
export const MOTION_STAGGER_MS = 45;
export const MOTION_DRAW_STAGGER_MS = 85;
export const MOTION_SEQUENCE_GAP_MS = 70;
export const MOTION_PULSE_MS = 460;
export const MOTION_CONNECT_MS = 180;
export const MAX_DETAILED_FLIGHTS = 24;

export interface MotionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MotionAnchorSnapshot {
  cards: ReadonlyMap<string, MotionRect>;
  zones: ReadonlyMap<string, MotionRect>;
}

export interface MeasuredMotionAnchors {
  snapshot: MotionAnchorSnapshot;
  cardElements: ReadonlyMap<string, HTMLElement>;
}

export interface MotionFlight {
  id: string;
  phase: MotionTimelinePhase;
  mode:
    | "move"
    | "reflow"
    | "arsenal"
    | "draw"
    | "hold"
    | "pitch-gather"
    | "deck-bottom"
    | "appear"
    | "settle";
  start: MotionRect;
  end: MotionRect;
  visual: MotionVisual;
  count: number;
  showCount: boolean;
  delayMs: number;
  durationMs?: number;
  destinationPresentationKey?: string;
  maskDestinationWhilePending?: true;
  holdAtSource?: true;
  destinationCoverVisual?: MotionVisual;
  destinationLayer?: "chain" | "stack";
}

export function motionFlightDurationMs(
  flight: Pick<MotionFlight, "mode" | "durationMs">,
): number {
  if (flight.durationMs !== undefined) return flight.durationMs;
  if (flight.mode === "deck-bottom") return MOTION_DECK_BOTTOM_MS;
  if (flight.mode === "pitch-gather") return MOTION_PITCH_GATHER_MS;
  return MOTION_TRAVEL_MS;
}

export interface MotionPulse {
  id: string;
  phase: MotionTimelinePhase;
  rect: MotionRect;
  delayMs: number;
}

export interface MotionConnector {
  id: string;
  phase: MotionTimelinePhase;
  start: MotionRect;
  end: MotionRect;
  delayMs: number;
  destinationPresentationKey?: string;
}

export interface GameMotionBatch {
  id: string;
  stage?: "end-turn" | "turn-start";
  flights: MotionFlight[];
  connectors: MotionConnector[];
  pulses: MotionPulse[];
  durationMs: number;
  reducedMotion?: true;
}

function motionRect(element: Element): MotionRect | null {
  const rect = element.getBoundingClientRect();
  if (
    !Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
  ) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Read all geometry before the coordinator performs any masking/class writes. */
export function measureMotionAnchors(root: ParentNode): MeasuredMotionAnchors {
  const cards = new Map<string, MotionRect>();
  const zones = new Map<string, MotionRect>();
  const cardElements = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-motion-card]")) {
    const key = element.dataset.motionCard;
    if (!key) continue;
    const rect = motionRect(element);
    if (!rect) continue;
    const keys = [
      key,
      ...(element.dataset.motionCardAliases?.split(/\s+/).filter(Boolean) ?? []),
    ];
    for (const presentationKey of keys) {
      if (cards.has(presentationKey)) continue;
      cards.set(presentationKey, rect);
      cardElements.set(presentationKey, element);
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-motion-zone]")) {
    const key = element.dataset.motionZone;
    if (!key || zones.has(key)) continue;
    const rect = motionRect(element);
    if (rect) zones.set(key, rect);
  }
  // Count-only zones such as the opponent's hidden hand still render real
  // card backs. Prefer that card-sized endpoint over the broad container so a
  // draw does not appear to land in the neighboring mirrored arsenal zone.
  for (const element of root.querySelectorAll<HTMLElement>("[data-motion-zone-anchor]")) {
    const key = element.dataset.motionZoneAnchor;
    if (!key) continue;
    const rect = motionRect(element);
    if (rect) zones.set(key, rect);
  }
  return { snapshot: { cards, zones }, cardElements };
}

function endpoint(
  anchors: MotionAnchorSnapshot,
  presentationKey: string | undefined,
  location: MotionLocation,
): { rect: MotionRect; exact: boolean } | null {
  const card = presentationKey ? anchors.cards.get(presentationKey) : undefined;
  if (card) return { rect: card, exact: true };
  const zone = anchors.zones.get(motionLocationKey(location));
  return zone ? { rect: zone, exact: false } : null;
}

function cardRectWithinZone(zone: MotionRect, reference?: MotionRect): MotionRect {
  const aspect = 300 / 413;
  let width = reference?.width ?? Math.min(124, zone.width, zone.height * aspect);
  let height = reference?.height ?? width / aspect;
  const scale = Math.min(1, zone.width / width, zone.height / height);
  width *= scale;
  height *= scale;
  return {
    left: zone.left + (zone.width - width) / 2,
    top: zone.top + (zone.height - height) / 2,
    width,
    height,
  };
}

function addPulse(
  pulses: MotionPulse[],
  pulseKeys: Set<string>,
  id: string,
  key: string,
  rect: MotionRect | undefined,
  phase: MotionTimelinePhase,
): void {
  if (!rect || pulseKeys.has(key)) return;
  pulseKeys.add(key);
  pulses.push({ id: `${id}:pulse:${pulses.length}`, phase, rect, delayMs: 0 });
}

function phaseStaggerMs(phase: MotionTimelinePhase): number {
  return phase === "draw" ? MOTION_DRAW_STAGGER_MS : MOTION_STAGGER_MS;
}

function sameRect(left: MotionRect, right: MotionRect): boolean {
  return left.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height;
}

function motionLayerForDestination(
  location: MotionLocation,
): MotionFlight["destinationLayer"] {
  if (location.kind === "stack-layer" || location.kind === "stack-attack") return "stack";
  return location.kind.startsWith("chain-") ? "chain" : undefined;
}

export function resolveMotionBatch(
  events: readonly GameMotionEvent[],
  previous: MotionAnchorSnapshot,
  current: MotionAnchorSnapshot,
  id: string | number,
): GameMotionBatch | null {
  const batchId = String(id);
  const flights: MotionFlight[] = [];
  const connectors: MotionConnector[] = [];
  const pulses: MotionPulse[] = [];
  const pulseKeys = new Set<string>();
  const boardAppearances = new Map<string, MotionFlight>();

  for (const event of events) {
    const phase = motionTimelinePhase(event);
    if (event.kind === "pulse") {
      const key = motionLocationKey(event.location);
      addPulse(pulses, pulseKeys, batchId, key, current.zones.get(key), phase);
      continue;
    }
    if (event.kind === "connect") {
      const source = endpoint(current, event.sourcePresentationKey, event.source)
        ?? endpoint(previous, event.sourcePresentationKey, event.source);
      const destination = endpoint(
        current,
        event.destinationPresentationKey,
        event.destination,
      );
      if (source && destination) {
        connectors.push({
          id: `${batchId}:connector:${connectors.length}`,
          phase,
          start: source.rect,
          end: destination.rect,
          delayMs: 0,
          destinationPresentationKey: event.destinationPresentationKey,
        });
      } else {
        const key = motionLocationKey(event.destination);
        addPulse(pulses, pulseKeys, batchId, key, current.zones.get(key), phase);
      }
      continue;
    }
    if (event.kind === "appear" || event.kind === "settle") {
      const groupedAppearanceKey = event.kind === "appear" && event.destination.kind === "board"
        ? `${motionLocationKey(event.destination)}:${
          event.visual.kind === "face" || event.visual.kind === "back-reveal"
            ? event.visual.card.cardId
            : "hidden"
        }`
        : null;
      const groupedAppearance = groupedAppearanceKey
        ? boardAppearances.get(groupedAppearanceKey)
        : undefined;
      if (groupedAppearance) {
        groupedAppearance.count += 1;
        continue;
      }
      const destination = endpoint(
        current,
        event.destinationPresentationKey,
        event.destination,
      );
      if (!destination) continue;
      const rect = destination.exact
        ? destination.rect
        : cardRectWithinZone(destination.rect);
      const destinationLayer = motionLayerForDestination(event.destination);
      if (flights.length < MAX_DETAILED_FLIGHTS) {
        const flight: MotionFlight = {
          id: `${batchId}:flight:${flights.length}`,
          phase,
          mode: event.kind,
          start: rect,
          end: rect,
          visual: event.visual,
          count: 1,
          showCount: false,
          delayMs: 0,
          destinationPresentationKey: event.destinationPresentationKey,
          ...(destinationLayer !== undefined
            ? { destinationLayer }
            : {}),
        };
        flights.push(flight);
        if (groupedAppearanceKey) boardAppearances.set(groupedAppearanceKey, flight);
      } else {
        const key = motionLocationKey(event.destination);
        addPulse(pulses, pulseKeys, batchId, key, current.zones.get(key), phase);
      }
      continue;
    }

    const source = endpoint(previous, event.sourcePresentationKey, event.source);
    const destination = endpoint(
      current,
      event.destinationPresentationKey,
      event.destination,
    );
    if (!source || !destination || flights.length >= MAX_DETAILED_FLIGHTS) {
      const key = motionLocationKey(event.destination);
      addPulse(pulses, pulseKeys, batchId, key, current.zones.get(key), phase);
      continue;
    }
    const start = source.exact
      ? source.rect
      : cardRectWithinZone(source.rect, destination.exact ? destination.rect : undefined);
    const end = destination.exact
      ? destination.rect
      : cardRectWithinZone(destination.rect, start);
    if (event.kind === "reflow" && sameRect(start, end)) continue;
    const mode = event.kind === "reflow"
      ? "reflow"
      : event.source.kind === "hand" && event.destination.kind === "arsenal"
      ? "arsenal"
      : event.source.kind === "deck" && event.destination.kind === "hand"
        ? "draw"
        : event.destination.kind === "deck" && event.destination.position === "bottom"
          ? "deck-bottom"
          : "move";
    const destinationLayer = motionLayerForDestination(event.destination);
    flights.push({
      id: `${batchId}:flight:${flights.length}`,
      phase,
      mode,
      start,
      end,
      visual: event.visual,
      count: event.kind === "move" ? event.count : 1,
      showCount: event.kind === "move" && event.count > 1,
      delayMs: 0,
      destinationPresentationKey: event.destinationPresentationKey,
      ...((event.kind === "reflow" || event.sourcePresentationKey !== undefined)
        ? { holdAtSource: true as const }
        : {}),
      ...(event.kind === "move" && event.destinationCoverVisual
        ? { destinationCoverVisual: event.destinationCoverVisual }
        : {}),
      ...(destinationLayer !== undefined
        ? { destinationLayer }
        : {}),
    });
  }

  if (flights.length === 0 && connectors.length === 0 && pulses.length === 0) return null;
  const delayById = scheduleMotionTimeline([
    ...flights.map((flight) => ({
      id: flight.id,
      phase: flight.phase,
      durationMs: motionFlightDurationMs(flight),
      staggerMs: flight.mode === "reflow" ? 0 : phaseStaggerMs(flight.phase),
    })),
    ...connectors.map((connector) => ({
      id: connector.id,
      phase: connector.phase,
      durationMs: MOTION_CONNECT_MS,
      staggerMs: phaseStaggerMs(connector.phase),
    })),
    ...pulses.map((pulse) => ({
      id: pulse.id,
      phase: pulse.phase,
      durationMs: MOTION_PULSE_MS,
      staggerMs: phaseStaggerMs(pulse.phase),
    })),
  ], MOTION_SEQUENCE_GAP_MS);
  for (const flight of flights) flight.delayMs = delayById.get(flight.id) ?? 0;
  for (const connector of connectors) connector.delayMs = delayById.get(connector.id) ?? 0;
  for (const pulse of pulses) pulse.delayMs = delayById.get(pulse.id) ?? 0;
  const durationMs = Math.max(
    0,
    ...flights.map((flight) => flight.delayMs + motionFlightDurationMs(flight)),
    ...connectors.map((connector) => connector.delayMs + MOTION_CONNECT_MS),
    ...pulses.map((pulse) => pulse.delayMs + MOTION_PULSE_MS),
  );
  return {
    id: batchId,
    flights,
    connectors,
    pulses,
    durationMs,
  };
}

type PitchBottomEvent = MoveMotionEvent & {
  source: Extract<MotionLocation, { kind: "pitch" }>;
  destination: Extract<MotionLocation, { kind: "deck" }> & { position: "bottom" };
};

function isPitchBottomEvent(event: GameMotionEvent): event is PitchBottomEvent {
  return event.kind === "move"
    && event.source.kind === "pitch"
    && event.destination.kind === "deck"
    && event.destination.position === "bottom";
}

function pitchBottomGroups(events: readonly GameMotionEvent[]): PitchBottomEvent[][] {
  const groups: PitchBottomEvent[][] = [];
  const groupBySeat = new Map<number, PitchBottomEvent[]>();
  for (const event of events) {
    if (!isPitchBottomEvent(event)) continue;
    let group = groupBySeat.get(event.destination.seat);
    if (!group) {
      group = [];
      groupBySeat.set(event.destination.seat, group);
      groups.push(group);
    }
    group.push(event);
  }
  return groups;
}

function pitchPacketVisual(visual: MotionVisual): MotionVisual {
  if (visual.kind === "face" || visual.kind === "back-reveal") {
    return { kind: "face-conceal", card: visual.card };
  }
  return visual;
}

function pitchGatherVisual(visual: MotionVisual): MotionVisual {
  if (visual.kind === "face-conceal" || visual.kind === "back-reveal") {
    return { kind: "face", card: visual.card };
  }
  return visual;
}

/** Multiple pitched cards first converge on one deck-sized packet. Reusing the
 * destination's Y position and dimensions makes the subsequent bottom-deck
 * flight strictly horizontal regardless of the pitch cards' fanned offsets. */
function resolvePitchPacketBatches(
  events: readonly PitchBottomEvent[],
  previous: MotionAnchorSnapshot,
  current: MotionAnchorSnapshot,
  id: string | number,
  groupIndex: number,
): GameMotionBatch[] {
  const resolved = resolveMotionBatch(
    events,
    previous,
    current,
    `${id}:pitch-source:${groupIndex}`,
  );
  if (!resolved || resolved.flights.length !== events.length) {
    return resolved ? [{ ...resolved, stage: "end-turn" }] : [];
  }

  const topFlight = resolved.flights.at(-1);
  if (!topFlight) return [];
  const packetStart: MotionRect = {
    left: topFlight.start.left,
    top: topFlight.end.top,
    width: topFlight.end.width,
    height: topFlight.end.height,
  };
  const gatherFlights = resolved.flights.map((flight, flightIndex): MotionFlight => {
    const {
      destinationPresentationKey: _destinationPresentationKey,
      destinationCoverVisual: _destinationCoverVisual,
      destinationLayer: _destinationLayer,
      ...sourceFlight
    } = flight;
    return {
      ...sourceFlight,
      id: `${id}:pitch-gather:${groupIndex}:flight:${flightIndex}`,
      mode: "pitch-gather",
      end: packetStart,
      visual: pitchGatherVisual(flight.visual),
      delayMs: 0,
      holdAtSource: true,
    };
  });
  const gatherBatch: GameMotionBatch = {
    id: `${id}:pitch-gather:${groupIndex}`,
    stage: "end-turn",
    flights: gatherFlights,
    connectors: [],
    pulses: [],
    durationMs: MOTION_PITCH_GATHER_MS,
  };

  const packetFlight: MotionFlight = {
    id: `${id}:pitch-bottom:${groupIndex}:flight:0`,
    phase: "cleanup",
    mode: "deck-bottom",
    start: packetStart,
    end: topFlight.end,
    visual: pitchPacketVisual(topFlight.visual),
    count: 1,
    showCount: false,
    delayMs: 0,
    ...(topFlight.destinationCoverVisual
      ? { destinationCoverVisual: topFlight.destinationCoverVisual }
      : {}),
  };
  const packetBatch: GameMotionBatch = {
    id: `${id}:pitch-bottom:${groupIndex}`,
    stage: "end-turn",
    flights: [packetFlight],
    connectors: [],
    pulses: [],
    durationMs: MOTION_DECK_BOTTOM_MS,
  };
  return [gatherBatch, packetBatch];
}

/** Keep identity-preserving cards at their pre-transition hand coordinates
 * while earlier callback batches play. Their authoritative destination nodes
 * can then remain masked until the real draw reflow takes over. */
function carryReflowSources(
  batch: GameMotionBatch,
  reflows: readonly MotionFlight[],
): GameMotionBatch {
  if (reflows.length === 0) return batch;
  const holds = reflows.map((reflow, index): MotionFlight => ({
    id: `${batch.id}:hold:${index}`,
    phase: reflow.phase,
    mode: "hold",
    start: reflow.start,
    end: reflow.start,
    visual: reflow.visual,
    count: 1,
    showCount: false,
    delayMs: 0,
    durationMs: batch.durationMs,
  }));
  return { ...batch, flights: [...batch.flights, ...holds] };
}

/** A turn boundary is a presentation barrier, not another delayed phase in a
 * single CSS timeline. The queue completes end-turn motion first, then mounts
 * the new-turn UI and starts this second batch from delay zero. */
export function resolveMotionBatches(
  events: readonly GameMotionEvent[],
  previous: MotionAnchorSnapshot,
  current: MotionAnchorSnapshot,
  id: string | number,
): GameMotionBatch[] {
  const endTurnEvents: GameMotionEvent[] = [];
  const turnStartEvents: GameMotionEvent[] = [];
  for (const event of events) {
    (motionTimelinePhase(event) === "turn-start" ? turnStartEvents : endTurnEvents).push(event);
  }
  const pitchGroups = pitchBottomGroups(endTurnEvents);
  const hasPitchPacket = pitchGroups.some((group) => group.length > 1);
  if (turnStartEvents.length === 0 && !hasPitchPacket) {
    const batch = resolveMotionBatch(endTurnEvents, previous, current, id);
    return batch ? [batch] : [];
  }

  const batches: GameMotionBatch[] = [];
  if (hasPitchPacket) {
    const beforePitch = endTurnEvents.filter((event) => (
      !isPitchBottomEvent(event) && motionTimelinePhase(event) !== "draw"
    ));
    const afterPitch = endTurnEvents.filter((event) => (
      !isPitchBottomEvent(event) && motionTimelinePhase(event) === "draw"
    ));
    const beforePitchBatch = resolveMotionBatch(
      beforePitch,
      previous,
      current,
      `${id}:end-turn:before-pitch`,
    );
    if (beforePitchBatch) batches.push({ ...beforePitchBatch, stage: "end-turn" });
    for (const [groupIndex, pitchGroup] of pitchGroups.entries()) {
      if (pitchGroup.length > 1) {
        batches.push(...resolvePitchPacketBatches(
          pitchGroup,
          previous,
          current,
          id,
          groupIndex,
        ));
      } else {
        const pitchBatch = resolveMotionBatch(
          pitchGroup,
          previous,
          current,
          `${id}:pitch-bottom:${groupIndex}`,
        );
        if (pitchBatch) batches.push({ ...pitchBatch, stage: "end-turn" });
      }
    }
    const afterPitchBatch = resolveMotionBatch(
      afterPitch,
      previous,
      current,
      `${id}:end-turn:after-pitch`,
    );
    if (afterPitchBatch) {
      const reflows = afterPitchBatch.flights.filter((flight) => flight.mode === "reflow");
      for (const [index, batch] of batches.entries()) {
        batches[index] = carryReflowSources(batch, reflows);
      }
      batches.push({
        ...afterPitchBatch,
        stage: "end-turn",
        flights: afterPitchBatch.flights.map((flight) => (
          flight.mode === "reflow"
            ? { ...flight, maskDestinationWhilePending: true as const }
            : flight
        )),
      });
    }
  } else {
    const endTurn = resolveMotionBatch(endTurnEvents, previous, current, `${id}:end-turn`);
    if (endTurn) batches.push({ ...endTurn, stage: "end-turn" });
  }
  const turnStart = resolveMotionBatch(
    turnStartEvents,
    previous,
    current,
    `${id}:turn-start`,
  );
  if (turnStart) batches.push({ ...turnStart, stage: "turn-start" });
  return batches;
}

export function reducedMotionBatch(
  batch: GameMotionBatch,
  current: MotionAnchorSnapshot,
): GameMotionBatch {
  const pulses = batch.pulses.map((pulse) => ({ ...pulse, delayMs: 0 }));
  const seen = new Set(pulses.map((pulse) => (
    `${pulse.rect.left}:${pulse.rect.top}:${pulse.rect.width}:${pulse.rect.height}`
  )));
  for (const flight of batch.flights) {
    const rect = flight.destinationPresentationKey
      ? current.cards.get(flight.destinationPresentationKey)
      : flight.end;
    if (!rect) continue;
    const key = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pulses.push({
      id: `${batch.id}:reduced:${pulses.length}`,
      phase: "result",
      rect,
      delayMs: 0,
    });
  }
  for (const connector of batch.connectors) {
    const key = `${connector.end.left}:${connector.end.top}:${connector.end.width}:${connector.end.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pulses.push({
      id: `${batch.id}:reduced:${pulses.length}`,
      phase: "result",
      rect: connector.end,
      delayMs: 0,
    });
  }
  return {
    ...batch,
    flights: [],
    connectors: [],
    pulses,
    durationMs: MOTION_PULSE_MS,
    reducedMotion: true,
  };
}
