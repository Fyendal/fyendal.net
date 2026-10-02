import { useEffect, useRef, type AnimationEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CARD_BACK_IMAGE_URL, CardBack, CardFace, cardImageUrl } from "../Card.js";
import {
  MOTION_CONNECT_MS,
  motionFlightDurationMs,
  type GameMotionBatch,
  type MotionConnector,
  type MotionFlight,
  type MotionRect,
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

function visualFaceUrl(visual: MotionVisual): string | null {
  return visual.kind === "face" || visual.kind === "face-conceal"
    || visual.kind === "back-reveal"
    ? cardImageUrl(visual.card.cardId)
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

export function MotionCardVisual({
  visual,
  count,
  square = false,
}: {
  visual: MotionVisual;
  count: number;
  square?: boolean;
}) {
  const faceUrl = visualFaceUrl(visual);
  return (
    <div className={`game-motion-visual game-motion-visual-${visual.kind}${square ? " game-motion-visual-square" : ""}`}>
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
  onCueComplete,
}: {
  batchId: string;
  flight: MotionFlight;
  squareCardsEnabled: boolean;
  onFlightArrive: (batchId: string, destinationPresentationKey?: string) => boolean;
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
      }`}
      style={flightStyle(flight, squareCardsEnabled)}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        // Ignore the nested back/face reveal animations. The wrapper's
        // completion is the exact point at which the real card takes over.
        if (event.target !== event.currentTarget) return;
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
        } else if (flight.mode !== "reflow" || destinationVisible) {
          element.style.visibility = "hidden";
        }
        onCueComplete(flight.id);
      }}
    >
      <MotionCardVisual
        visual={flight.visual}
        count={flight.showCount ? flight.count : 1}
        square={squareMotionFlight(flight, squareCardsEnabled)}
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

function QueuedHandSource({ flight }: { flight: MotionFlight }) {
  return (
    <div
      className={`game-motion-queued-source${
        flight.mode === "reflow" ? " game-motion-queued-source-reflow" : ""
      }`}
      style={rectStyle(flight.start)}
    >
      <MotionCardVisual visual={flight.visual} count={flight.showCount ? flight.count : 1} />
    </div>
  );
}

export function GameMotionLayer({
  batch,
  queuedHandSources,
  squareCardsEnabled,
  onFlightArrive,
  onComplete,
}: {
  batch: GameMotionBatch | null;
  queuedHandSources: readonly MotionFlight[];
  squareCardsEnabled: boolean;
  onFlightArrive: (batchId: string, destinationPresentationKey?: string) => boolean;
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
  for (const flight of batch.flights) {
    if (flight.destinationLayer === "chain") chainFlights.push(flight);
    else if (flight.destinationLayer === "stack") stackFlights.push(flight);
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
        {queuedHandSources.map((flight) => (
          <QueuedHandSource flight={flight} key={flight.id} />
        ))}
        {batch.connectors.map((connector) => (
          <div
            className="game-motion-connector"
            key={connector.id}
            style={connectorStyle(connector)}
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
            onCueComplete={completeCue}
          />
        ))}
        {boardFlights.map((flight) => (
          <MotionDeckCover flight={flight} squareCardsEnabled={squareCardsEnabled} key={`${flight.id}:deck-cover`} />
        ))}
      </div>
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
