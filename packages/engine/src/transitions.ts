import type {
  GameTransitionMove,
  GameTransitionZone,
} from "@fyendal/shared";
import type { CardInstance } from "./state.js";

export interface EngineTransitionMove {
  kind: "move";
  card: Pick<CardInstance, "instanceId" | "cardId" | "owner">;
  from: GameTransitionZone | null;
  to: GameTransitionZone | null;
  /** Whether the identity was hidden at the respective endpoint. */
  fromPrivate: boolean;
  toPrivate: boolean;
}

export interface TransitionRecorder {
  move(
    card: CardInstance,
    from: GameTransitionZone | null,
    to: GameTransitionZone | null,
    privacy?: { from?: boolean; to?: boolean },
  ): void;
}

const NOOP_TRANSITIONS: TransitionRecorder = Object.freeze({ move() {} });

export function createTransitionCollector(): {
  recorder: TransitionRecorder;
  events: EngineTransitionMove[];
} {
  const events: EngineTransitionMove[] = [];
  const recorder: TransitionRecorder = {
    move(card, from, to, privacy = {}) {
      events.push({
        kind: "move",
        card: {
          instanceId: card.instanceId,
          cardId: card.cardId,
          owner: card.owner,
        },
        from,
        to,
        fromPrivate: privacy.from === true,
        toPrivate: privacy.to === true,
      });
    },
  };
  return {
    events,
    recorder: Object.freeze(recorder),
  };
}

export function noopTransitionRecorder(): TransitionRecorder {
  return NOOP_TRANSITIONS;
}

/** Strip identities which this viewer could not know at either endpoint. */
export function projectTransitionEvents(
  events: readonly EngineTransitionMove[],
  viewer: number | null,
  revealAll = false,
): GameTransitionMove[] {
  return events.map((event) => {
    const ownsCard = viewer === event.card.owner;
    const publicEndpoint = (event.from !== null && !event.fromPrivate)
      || (event.to !== null && !event.toPrivate);
    const identityVisible = revealAll || ownsCard || publicEndpoint;
    return {
      kind: "move",
      from: event.from,
      to: event.to,
      count: 1,
      ...(identityVisible ? { instanceId: event.card.instanceId } : {}),
    };
  });
}

export function transitionZone(
  kind: GameTransitionZone["kind"],
  seat: number,
  position?: GameTransitionZone["position"],
): GameTransitionZone {
  return {
    kind,
    seat,
    ...(kind === "deck" && position !== undefined ? { position } : {}),
  };
}

/** Translate engine-internal zone labels into the stable transition contract.
 * Unknown/internal-only locations deliberately remain null. */
export function transitionZoneFromEngineZone(
  zone: string,
  seat: number,
  position?: GameTransitionZone["position"],
): GameTransitionZone | null {
  const kind = zone === "arena" ? "board" : zone;
  if (
    kind !== "hand" && kind !== "deck" && kind !== "arsenal"
    && kind !== "pitch" && kind !== "graveyard" && kind !== "banish"
    && kind !== "soul" && kind !== "board" && kind !== "equipment"
    && kind !== "weapon" && kind !== "stack" && kind !== "chain"
  ) return null;
  return transitionZone(kind, seat, kind === "deck" ? position : undefined);
}

export function transitionZoneIsPrivate(
  kind: GameTransitionZone["kind"],
  faceDown = false,
): boolean {
  return kind === "hand" || kind === "deck"
    || (kind === "arsenal" && faceDown)
    || (kind === "banish" && faceDown);
}
