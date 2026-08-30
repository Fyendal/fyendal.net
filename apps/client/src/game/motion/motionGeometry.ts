import {
  motionLocationKey,
  type GameMotionEvent,
  type MotionLocation,
  type MotionVisual,
} from "./motionTypes.js";

export const MOTION_TRAVEL_MS = 320;
export const MOTION_STAGGER_MS = 45;
export const MOTION_DRAW_STAGGER_MS = 85;
export const MOTION_SEQUENCE_GAP_MS = 70;
export const MOTION_PULSE_MS = 460;
export const MOTION_CONNECT_MS = 180;
export const MAX_DETAILED_FLIGHTS = 6;

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
  mode: "move" | "arsenal" | "draw" | "appear" | "settle";
  start: MotionRect;
  end: MotionRect;
  visual: MotionVisual;
  count: number;
  showCount: boolean;
  delayMs: number;
  destinationPresentationKey?: string;
}

export interface MotionPulse {
  id: string;
  rect: MotionRect;
  delayMs: number;
}

export interface MotionConnector {
  id: string;
  start: MotionRect;
  end: MotionRect;
  delayMs: number;
}

export interface GameMotionBatch {
  id: number;
  flights: MotionFlight[];
  connectors: MotionConnector[];
  pulses: MotionPulse[];
  durationMs: number;
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
    if (!key || cards.has(key)) continue;
    const rect = motionRect(element);
    if (!rect) continue;
    cards.set(key, rect);
    cardElements.set(key, element);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-motion-zone]")) {
    const key = element.dataset.motionZone;
    if (!key || zones.has(key)) continue;
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
  id: number,
  key: string,
  rect: MotionRect | undefined,
  delayMs: number,
): void {
  if (!rect || pulseKeys.has(key)) return;
  pulseKeys.add(key);
  pulses.push({ id: `${id}:pulse:${pulses.length}`, rect, delayMs });
}

export function resolveMotionBatch(
  events: readonly GameMotionEvent[],
  previous: MotionAnchorSnapshot,
  current: MotionAnchorSnapshot,
  id: number,
): GameMotionBatch | null {
  const flights: MotionFlight[] = [];
  const connectors: MotionConnector[] = [];
  const pulses: MotionPulse[] = [];
  const pulseKeys = new Set<string>();
  const boardAppearances = new Map<string, MotionFlight>();

  for (const event of events) {
    if (event.kind === "pulse") {
      const key = motionLocationKey(event.location);
      addPulse(pulses, pulseKeys, id, key, current.zones.get(key), 0);
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
          id: `${id}:connector:${connectors.length}`,
          start: source.rect,
          end: destination.rect,
          delayMs: 0,
        });
      } else {
        const key = motionLocationKey(event.destination);
        addPulse(pulses, pulseKeys, id, key, current.zones.get(key), 0);
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
      if (flights.length < MAX_DETAILED_FLIGHTS) {
        const flight: MotionFlight = {
          id: `${id}:flight:${flights.length}`,
          mode: event.kind,
          start: rect,
          end: rect,
          visual: event.visual,
          count: 1,
          showCount: false,
          delayMs: flights.length * MOTION_STAGGER_MS,
          destinationPresentationKey: event.destinationPresentationKey,
        };
        flights.push(flight);
        if (groupedAppearanceKey) boardAppearances.set(groupedAppearanceKey, flight);
      } else {
        const key = motionLocationKey(event.destination);
        addPulse(pulses, pulseKeys, id, key, current.zones.get(key), 0);
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
      addPulse(pulses, pulseKeys, id, key, current.zones.get(key), 0);
      continue;
    }
    const start = source.exact
      ? source.rect
      : cardRectWithinZone(source.rect, destination.exact ? destination.rect : undefined);
    const end = destination.exact
      ? destination.rect
      : cardRectWithinZone(destination.rect, start);
    const mode = event.source.kind === "hand" && event.destination.kind === "arsenal"
      ? "arsenal"
      : event.source.kind === "deck" && event.destination.kind === "hand"
        ? "draw"
        : "move";
    const previousDraws = flights.filter((flight) => flight.mode === "draw").length;
    const arsenalFlight = mode === "draw"
      ? flights.find((flight) => flight.mode === "arsenal")
      : undefined;
    const ordinaryDelay = flights.length * MOTION_STAGGER_MS;
    const delayMs = arsenalFlight
      ? Math.max(
          ordinaryDelay,
          arsenalFlight.delayMs
            + MOTION_TRAVEL_MS
            + MOTION_SEQUENCE_GAP_MS
            + previousDraws * MOTION_DRAW_STAGGER_MS,
        )
      : ordinaryDelay;
    flights.push({
      id: `${id}:flight:${flights.length}`,
      mode,
      start,
      end,
      visual: event.visual,
      count: event.count,
      showCount: event.count > 1,
      delayMs,
      destinationPresentationKey: event.destinationPresentationKey,
    });
  }

  if (flights.length === 0 && connectors.length === 0 && pulses.length === 0) return null;
  const lastFlightDelay = flights.at(-1)?.delayMs ?? 0;
  return {
    id,
    flights,
    connectors,
    pulses,
    durationMs: Math.max(
      pulses.length > 0 ? MOTION_PULSE_MS : 0,
      connectors.length > 0 ? MOTION_CONNECT_MS : 0,
      flights.length > 0 ? lastFlightDelay + MOTION_TRAVEL_MS : 0,
    ),
  };
}

export function reducedMotionBatch(
  batch: GameMotionBatch,
  current: MotionAnchorSnapshot,
): GameMotionBatch {
  const pulses = [...batch.pulses];
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
    pulses.push({ id: `${batch.id}:reduced:${pulses.length}`, rect, delayMs: 0 });
  }
  for (const connector of batch.connectors) {
    const key = `${connector.end.left}:${connector.end.top}:${connector.end.width}:${connector.end.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pulses.push({ id: `${batch.id}:reduced:${pulses.length}`, rect: connector.end, delayMs: 0 });
  }
  return {
    ...batch,
    flights: [],
    connectors: [],
    pulses,
    durationMs: MOTION_PULSE_MS,
  };
}
