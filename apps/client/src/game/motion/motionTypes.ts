import type { CardView, EquipmentSlot } from "@fyendal/shared";

export type MotionLocation =
  | { kind: "hand"; seat: number }
  | { kind: "deck"; seat: number }
  | { kind: "arsenal"; seat: number }
  | { kind: "pitch"; seat: number }
  | { kind: "graveyard"; seat: number }
  | { kind: "banish"; seat: number }
  | { kind: "soul"; seat: number }
  | { kind: "board"; seat: number }
  | { kind: "equipment"; seat: number; slot: EquipmentSlot }
  | { kind: "weapon"; seat: number; index: number }
  | { kind: "stack-layer"; index: number }
  | { kind: "stack-attack" }
  | { kind: "chain-attack"; link: number }
  | { kind: "chain-staged"; link: number; index: number }
  | { kind: "chain-defender"; link: number; index: number }
  | { kind: "chain-reaction"; link: number; index: number }
  | { kind: "chain-target"; link: number };

export type CountedMotionLocation = Extract<
  MotionLocation,
  { kind: "hand" | "deck" | "arsenal" | "pitch" }
>;

export type MotionVisual =
  | { kind: "face"; card: CardView }
  | { kind: "back" }
  | { kind: "back-reveal"; card: CardView };

export interface CardPresentation {
  key: string;
  role: "canonical" | "display";
  instanceId: number;
  card: CardView;
  location: MotionLocation;
}

export interface MotionZoneCount {
  location: CountedMotionLocation;
  count: number;
}

export interface MoveMotionEvent {
  kind: "move";
  source: MotionLocation;
  destination: MotionLocation;
  visual: MotionVisual;
  count: number;
  confidence: "exact" | "inferred";
  instanceId?: number;
  sourcePresentationKey?: string;
  destinationPresentationKey?: string;
}

export interface AppearMotionEvent {
  kind: "appear";
  destination: MotionLocation;
  visual: MotionVisual;
  instanceId: number;
  destinationPresentationKey: string;
}

export interface SettleMotionEvent {
  kind: "settle";
  destination: MotionLocation;
  visual: MotionVisual;
  instanceId: number;
  destinationPresentationKey: string;
}

export interface ConnectMotionEvent {
  kind: "connect";
  source: MotionLocation;
  destination: MotionLocation;
  instanceId: number;
  sourcePresentationKey: string;
  destinationPresentationKey: string;
}

export interface PulseMotionEvent {
  kind: "pulse";
  location: MotionLocation;
}

export type GameMotionEvent =
  | MoveMotionEvent
  | AppearMotionEvent
  | SettleMotionEvent
  | ConnectMotionEvent
  | PulseMotionEvent;

export function motionLocationKey(location: MotionLocation): string {
  switch (location.kind) {
    case "equipment":
      return `${location.seat}:equipment:${location.slot}`;
    case "weapon":
      return `${location.seat}:weapon:${location.index}`;
    case "stack-layer":
      return `stack:layer:${location.index}`;
    case "stack-attack":
      return "stack:attack";
    case "chain-attack":
      return `chain:${location.link}:attack`;
    case "chain-staged":
      return `chain:${location.link}:staged:${location.index}`;
    case "chain-defender":
      return `chain:${location.link}:defender:${location.index}`;
    case "chain-reaction":
      return `chain:${location.link}:reaction:${location.index}`;
    case "chain-target":
      return `chain:${location.link}:target`;
    default:
      return `${location.seat}:${location.kind}`;
  }
}

/** Stable card-presentation key shared by projected-view extraction and DOM
 * anchors. Stack-layer and staged-defender indexes are deliberately excluded
 * because removing an earlier sibling must not move every remaining card. */
export function motionPresentationKey(
  location: MotionLocation,
  instanceId: number,
  occurrence = 0,
): string {
  const identity = location.kind === "stack-layer"
    ? "stack:layer"
    : location.kind === "chain-staged"
      ? `chain:${location.link}:staged`
      : motionLocationKey(location);
  const base = `${identity}:${instanceId}`;
  return occurrence === 0 ? base : `${base}:${occurrence}`;
}

export function motionLocationSeat(location: MotionLocation): number | undefined {
  return "seat" in location ? location.seat : undefined;
}

export function countedMotionLocation(
  location: MotionLocation,
): CountedMotionLocation | null {
  return location.kind === "hand" || location.kind === "deck"
      || location.kind === "arsenal" || location.kind === "pitch"
    ? location
    : null;
}
