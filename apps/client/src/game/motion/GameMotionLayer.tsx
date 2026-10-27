import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CARD_BACK_IMAGE_URL, CardBack, CardFace, cardImageUrl, useCardArt } from "../Card.js";
import {
  MOTION_CONNECT_MS,
  motionFlightDurationMs,
  type GameMotionBatch,
  type MotionConnector,
  type MotionFlight,
  type MotionRect,
  type MotionDeparture,
} from "./motionGeometry.js";
import type { MotionVisual } from "./motionTypes.js";

type MotionStyle = CSSProperties & Record<`--motion-${string}`, string>;

function rectStyle(rect: MotionRect): CSSProperties {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function visualFaceUrl(visual: MotionVisual, artImage: string | undefined): string | null {
  return visual.kind === "face" || visual.kind === "face-conceal"
    || visual.kind === "back-reveal"
    ? cardImageUrl(visual.card.cardId, artImage)
    : null;
}

/** The board's square cards have a different aspect ratio from hand and float
 * cards. Use the destination shape so the flying copy matches the card that
 * replaces it, including on responsive desktop layouts. */
export function squareMotionFlight(flight: MotionFlight, squareCardsEnabled: boolean): boolean {
  return squareCardsEnabled
    && flight.destinationLayer === undefined
    && flight.end.width / flight.end.height >= .9;
}

/** A card charged into the soul is tucked beneath its hero card. */
export function motionFlightSoulSeat(flight: MotionFlight): number | null {
  const match = /^(\d+):soul:/.exec(flight.destinationPresentationKey ?? "");
  return match ? Number(match[1]) : null;
}

/** Clip everything but a hole over the hero so charged cards slide under it. */
export function heroHoleClipPath(hero: MotionRect): string {
  const { left, top, width, height } = hero;
  const right = left + width;
  const bottom = top + height;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
}

function MotionUnderHeroLayer({ seat, reducedMotion, children }: {
  seat: number;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const [clipPath, setClipPath] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const hero = document.querySelector<HTMLElement>(`[data-motion-card^="${seat}:hero:"]`);
    const rect = hero?.getBoundingClientRect();
    setClipPath(rect && rect.width > 0 ? heroHoleClipPath(rect) : undefined);
  }, [seat]);
  return (
    <div
      className={`game-motion-layer${reducedMotion ? " game-motion-layer-reduced" : ""}`}
      style={{ clipPath }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

/** Stack departures must clear their source float as well as their destination. */
export function motionFlightLayer(flight: MotionFlight): "stack" | "chain" | undefined {
  return flight.sourceMaskPresentationKey ? "stack" : flight.destinationLayer;
}

/** A queued transition can still mask or replace the real destination. Keep
 * the landed copy until the next batch mounts instead of exposing an empty slot. */
export function motionFlightHandsOff(flight: MotionFlight, destinationVisible: boolean): boolean {
  return destinationVisible
    || (flight.destinationPresentationKey === undefined && flight.mode !== "reflow");
}

/** A face-up card leaving a full-size slot for a compact zone. The flight box
 * already has the compact shape, so the full card is drawn inside it at its
 * source size and cropped down to the compact window while it travels. */
export interface MotionMorph {
  fromWidth: number;
  fromHeight: number;
  scale: number;
  crop: number;
}

export function motionFlightMorph(flight: MotionFlight, squareCardsEnabled: boolean): MotionMorph | null {
  if (flight.visual.kind !== "face" || !squareMotionFlight(flight, squareCardsEnabled)) return null;
  const { start, end } = flight;
  if (start.width / start.height >= .9) return null;
  const scale = end.width / start.width;
  return {
    fromWidth: start.width,
    fromHeight: start.height,
    scale,
    crop: Math.max(0, (start.height - end.height / scale) / 2),
  };
}

function morphStyle(morph: MotionMorph): MotionStyle {
  return {
    "--motion-from-width": `${morph.fromWidth}px`,
    "--motion-from-height": `${morph.fromHeight}px`,
    "--motion-morph-scale": String(morph.scale),
    "--motion-morph-crop": `${morph.crop}px`,
  };
}

export function MotionCardVisual({
  visual,
  count,
  square = false,
  morph = null,
}: {
  visual: MotionVisual;
  count: number;
  square?: boolean;
  morph?: MotionMorph | null;
}) {
  const cardArt = useCardArt();
  const faceUrl = visualFaceUrl(visual, "card" in visual ? cardArt(visual.card.owner, visual.card.cardId) : undefined);
  const morphing = square && morph !== null && faceUrl !== null;
  return (
    <div
      className={`game-motion-visual game-motion-visual-${visual.kind}${square ? " game-motion-visual-square" : ""}${morphing ? " game-motion-visual-morph" : ""}`}
      style={morphing ? morphStyle(morph) : undefined}
    >
      {morphing ? (
        <img className="game-motion-image game-motion-morph-full" src={faceUrl} alt="" />
      ) : null}
      {visual.kind !== "face" ? (
        square ? (
          <span className="game-motion-card-side game-motion-back">
            <CardBack label="" square />
          </span>
        ) : (
          <img className="game-motion-image game-motion-back" src={CARD_BACK_IMAGE_URL} alt="" />
        )
      ) : null}
      {faceUrl ? (
        square && visual.kind !== "back" ? (
          <span className="game-motion-card-side game-motion-face">
            <CardFace card={visual.card} size="zone" squareArt showOverlays={false} showTapped={false} />
          </span>
        ) : (
          <img className="game-motion-image game-motion-face" src={faceUrl} alt="" />
        )
      ) : null}
      {count > 1 ? <span className="game-motion-count">×{count}</span> : null}
    </div>
  );
}

/** When a flight crosses between compact and full presentations, show the
 * destination card at its natural proportions for the entire trip. */
export function motionFlightStartRect(flight: MotionFlight, squareCardsEnabled: boolean): MotionRect {
  const sourceIsSquare = flight.start.width / flight.start.height >= .9;
  const destinationIsFull = flight.end.width / flight.end.height < .9;
  const useDestinationSize = squareMotionFlight(flight, squareCardsEnabled)
    || (squareCardsEnabled && sourceIsSquare && destinationIsFull);
  return useDestinationSize ? {
    left: flight.start.left + (flight.start.width - flight.end.width) / 2,
    top: flight.start.top + (flight.start.height - flight.end.height) / 2,
    width: flight.end.width,
    height: flight.end.height,
  } : flight.start;
}

function flightStyle(flight: MotionFlight, squareCardsEnabled: boolean): MotionStyle {
  const start = motionFlightStartRect(flight, squareCardsEnabled);
  const translateX = flight.end.left - start.left;
  const translateY = flight.end.top - start.top;
  return {
    ...rectStyle(start),
    "--motion-x": `${translateX}px`,
    "--motion-y": `${translateY}px`,
    "--motion-scale-x": String(flight.end.width / start.width),
    "--motion-scale-y": String(flight.end.height / start.height),
    "--motion-delay": `${flight.delayMs}ms`,
    "--motion-duration": `${motionFlightDurationMs(flight)}ms`,
  };
}

function connectorStyle(connector: MotionConnector): MotionStyle {
  const startX = connector.start.left + connector.start.width / 2;
  const startY = connector.start.top + connector.start.height / 2;
  const endX = connector.end.left + connector.end.width / 2;
  const endY = connector.end.top + connector.end.height / 2;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  return {
    left: startX,
    top: startY,
    width: Math.hypot(deltaX, deltaY),
    "--motion-angle": `${Math.atan2(deltaY, deltaX)}rad`,
    "--motion-delay": `${connector.delayMs}ms`,
    "--motion-duration": `${MOTION_CONNECT_MS}ms`,
  };
}

function MotionFlightOverlay({
  batchId,
  flight,
  squareCardsEnabled,
  onFlightArrive,
  onFlightDepart,
  onCueComplete,
}: {
  batchId: string;
  flight: MotionFlight;
  squareCardsEnabled: boolean;
  onFlightArrive: (batchId: string, destinationPresentationKey?: string) => boolean;
  onFlightDepart: (batchId: string, flight: MotionDeparture) => void;
  onCueComplete: (cueId: string) => void;
}) {
  const lingerTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (lingerTimerRef.current !== null) window.clearTimeout(lingerTimerRef.current);
  }, []);
  return (
    <div
      className={`game-motion-flight game-motion-flight-${flight.mode}${
        flight.holdAtSource ? " game-motion-flight-hold-source" : ""
      }${flight.stackDepth ? " game-motion-stacked" : ""}`}
      data-stack-depth={flight.stackDepth}
      style={flightStyle(flight, squareCardsEnabled)}
      onAnimationStart={(event: AnimationEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
          onFlightDepart(batchId, flight);
        }
      }}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        // Ignore the nested back/face reveal animations. The wrapper's
        // completion is the exact point at which the real card takes over.
        if (event.target !== event.currentTarget) return;
        onFlightDepart(batchId, flight);
        const destinationVisible = onFlightArrive(batchId, flight.destinationPresentationKey);
        const element = event.currentTarget;
        const lingerMs = Math.max(0,
          (flight.lingerUntilMs ?? 0) - flight.delayMs - motionFlightDurationMs(flight),
        );
        if (lingerMs > 0) {
          lingerTimerRef.current = window.setTimeout(() => {
            element.style.visibility = "hidden";
            lingerTimerRef.current = null;
          }, lingerMs);
        } else if (motionFlightHandsOff(flight, destinationVisible)) {
          element.style.visibility = "hidden";
        }
        onCueComplete(flight.id);
      }}
    >
      <MotionCardVisual
        visual={flight.visual}
        count={flight.showCount ? flight.count : 1}
        square={squareMotionFlight(flight, squareCardsEnabled)}
        morph={motionFlightMorph(flight, squareCardsEnabled)}
      />
    </div>
  );
}

function MotionDeckCover({ flight, squareCardsEnabled }: { flight: MotionFlight; squareCardsEnabled: boolean }) {
  if (!flight.destinationCoverVisual) return null;
  return (
    <div
      className="game-motion-deck-cover"
      style={rectStyle(flight.end)}
    >
      <MotionCardVisual visual={flight.destinationCoverVisual} count={1} square={squareMotionFlight(flight, squareCardsEnabled)} />
    </div>
  );
}

function QueuedSource({ flight, squareCardsEnabled }: { flight: MotionFlight; squareCardsEnabled: boolean }) {
  return (
    <div
      className={`game-motion-queued-source${
        flight.mode === "reflow" ? " game-motion-queued-source-reflow" : ""
      }${flight.stackDepth ? " game-motion-stacked" : ""}`}
      data-stack-depth={flight.stackDepth}
      style={rectStyle(flight.start)}
    >
      <MotionCardVisual
        visual={flight.visual}
        count={flight.showCount ? flight.count : 1}
        square={squareCardsEnabled && flight.start.width / flight.start.height >= .9}
      />
    </div>
  );
}

export function GameMotionLayer({
  batch,
  queuedSources,
  squareCardsEnabled,
  onFlightArrive,
  onFlightDepart,
  onComplete,
}: {
  batch: GameMotionBatch | null;
  queuedSources: readonly MotionFlight[];
  squareCardsEnabled: boolean;
  onFlightArrive: (batchId: string, destinationPresentationKey?: string) => boolean;
  onFlightDepart: (batchId: string, flight: MotionDeparture) => void;
  onComplete: (batchId: string) => void;
}) {
  const completedCuesRef = useRef<{
    batchId: string;
    cueIds: Set<string>;
    finished: boolean;
  } | null>(null);
  if (batch && completedCuesRef.current?.batchId !== batch.id) {
    completedCuesRef.current = {
      batchId: batch.id,
      cueIds: new Set(),
      finished: false,
    };
  }
  const cueCount = batch
    ? batch.flights.length + batch.connectors.length
    : 0;
  const completeCue = (cueId: string) => {
    if (!batch) return;
    const tracker = completedCuesRef.current;
    if (!tracker || tracker.batchId !== batch.id || tracker.finished) return;
    tracker.cueIds.add(cueId);
    if (tracker.cueIds.size !== cueCount) return;
    tracker.finished = true;
    onComplete(batch.id);
  };

  useEffect(() => {
    if (!batch) return;
    // Animation events drive normal sequencing. This remains only as a
    // watchdog for interrupted CSS animations or browser lifecycle quirks.
    const timeout = window.setTimeout(() => onComplete(batch.id), batch.durationMs + 40);
    return () => window.clearTimeout(timeout);
  }, [batch, onComplete]);

  if (!batch || typeof document === "undefined") return null;
  const appearanceFlights: MotionFlight[] = [];
  const boardFlights: MotionFlight[] = [];
  const chainFlights: MotionFlight[] = [];
  const stackFlights: MotionFlight[] = [];
  const soulFlights = new Map<number, MotionFlight[]>();
  for (const flight of batch.flights) {
    const layer = motionFlightLayer(flight);
    const soulSeat = layer === undefined && flight.mode !== "appear" ? motionFlightSoulSeat(flight) : null;
    if (soulSeat !== null) soulFlights.set(soulSeat, [...(soulFlights.get(soulSeat) ?? []), flight]);
    else if (layer === "chain") chainFlights.push(flight);
    else if (layer === "stack") stackFlights.push(flight);
    else if (flight.mode === "appear") appearanceFlights.push(flight);
    else boardFlights.push(flight);
  }
  return createPortal(
    <>
      {appearanceFlights.length > 0 ? (
        <div
          className="game-motion-layer game-motion-layer-under-floats"
          aria-hidden="true"
        >
          {appearanceFlights.map((flight) => (
            <MotionFlightOverlay
              batchId={batch.id}
              flight={flight}
              squareCardsEnabled={squareCardsEnabled}
              key={flight.id}
              onFlightArrive={onFlightArrive}
              onFlightDepart={onFlightDepart}
              onCueComplete={completeCue}
            />
          ))}
        </div>
      ) : null}
      <div
        className={`game-motion-layer${batch.reducedMotion ? " game-motion-layer-reduced" : ""}`}
        data-game-motion-batch={batch.id}
        aria-hidden="true"
      >
        {queuedSources.map((flight) => (
          <QueuedSource flight={flight} squareCardsEnabled={squareCardsEnabled} key={flight.id} />
        ))}
        {batch.connectors.map((connector) => (
          <div
            className="game-motion-connector"
            key={connector.id}
            style={connectorStyle(connector)}
            onAnimationStart={(event) => {
              if (event.target === event.currentTarget) {
                onFlightDepart(batch.id, { id: connector.id, destinationLayer: "stack" });
              }
            }}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              onFlightArrive(batch.id, connector.destinationPresentationKey);
              event.currentTarget.style.visibility = "hidden";
              completeCue(connector.id);
            }}
          />
        ))}
        {boardFlights.map((flight) => (
          <MotionFlightOverlay
            batchId={batch.id}
            flight={flight}
            squareCardsEnabled={squareCardsEnabled}
            key={flight.id}
            onFlightArrive={onFlightArrive}
            onFlightDepart={onFlightDepart}
            onCueComplete={completeCue}
          />
        ))}
        {boardFlights.map((flight) => (
          <MotionDeckCover flight={flight} squareCardsEnabled={squareCardsEnabled} key={`${flight.id}:deck-cover`} />
        ))}
      </div>
      {[...soulFlights].map(([seat, flights]) => (
        <MotionUnderHeroLayer seat={seat} reducedMotion={batch.reducedMotion === true} key={`soul:${seat}`}>
          {flights.map((flight) => (
            <MotionFlightOverlay
              batchId={batch.id}
              flight={flight}
              squareCardsEnabled={squareCardsEnabled}
              key={flight.id}
              onFlightArrive={onFlightArrive}
              onFlightDepart={onFlightDepart}
              onCueComplete={completeCue}
            />
          ))}
        </MotionUnderHeroLayer>
      ))}
      {chainFlights.length > 0 ? (
        <div
          className="game-motion-layer game-motion-layer-chain"
          aria-hidden="true"
        >
          {chainFlights.map((flight) => (
            <MotionFlightOverlay
              batchId={batch.id}
              flight={flight}
              squareCardsEnabled={squareCardsEnabled}
              key={flight.id}
              onFlightArrive={onFlightArrive}
              onFlightDepart={onFlightDepart}
              onCueComplete={completeCue}
            />
          ))}
          {chainFlights.map((flight) => (
            <MotionDeckCover flight={flight} squareCardsEnabled={squareCardsEnabled} key={`${flight.id}:deck-cover`} />
          ))}
        </div>
      ) : null}
      {stackFlights.length > 0 ? (
        <div
          className="game-motion-layer game-motion-layer-stack"
          aria-hidden="true"
        >
          {stackFlights.map((flight) => (
            <MotionFlightOverlay
              batchId={batch.id}
              flight={flight}
              squareCardsEnabled={squareCardsEnabled}
              key={flight.id}
              onFlightArrive={onFlightArrive}
              onFlightDepart={onFlightDepart}
              onCueComplete={completeCue}
            />
          ))}
          {stackFlights.map((flight) => (
            <MotionDeckCover flight={flight} squareCardsEnabled={squareCardsEnabled} key={`${flight.id}:deck-cover`} />
          ))}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
