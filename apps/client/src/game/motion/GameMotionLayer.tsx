import { useEffect, useRef, type AnimationEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CARD_BACK_IMAGE_URL, cardImageUrl } from "../Card.js";
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

function MotionCardVisual({ visual, count }: { visual: MotionVisual; count: number }) {
  const faceUrl = visualFaceUrl(visual);
  return (
    <div className={`game-motion-visual game-motion-visual-${visual.kind}`}>
      {visual.kind !== "face" ? (
        <img className="game-motion-image game-motion-back" src={CARD_BACK_IMAGE_URL} alt="" />
      ) : null}
      {faceUrl ? (
        <img className="game-motion-image game-motion-face" src={faceUrl} alt="" />
      ) : null}
      {count > 1 ? <span className="game-motion-count">×{count}</span> : null}
    </div>
  );
}

function flightStyle(flight: MotionFlight): MotionStyle {
  const translateX = flight.end.left - flight.start.left;
  const translateY = flight.end.top - flight.start.top;
  return {
    ...rectStyle(flight.start),
    "--motion-x": `${translateX}px`,
    "--motion-y": `${translateY}px`,
    "--motion-scale-x": String(flight.end.width / flight.start.width),
    "--motion-scale-y": String(flight.end.height / flight.start.height),
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
  onFlightArrive,
  onCueComplete,
}: {
  batchId: string;
  flight: MotionFlight;
  onFlightArrive: (batchId: string, destinationPresentationKey?: string) => void;
  onCueComplete: (cueId: string) => void;
}) {
  return (
    <div
      className={`game-motion-flight game-motion-flight-${flight.mode}${
        flight.holdAtSource ? " game-motion-flight-hold-source" : ""
      }`}
      style={flightStyle(flight)}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        // Ignore the nested back/face reveal animations. The wrapper's
        // completion is the exact point at which the real card takes over.
        if (event.target !== event.currentTarget) return;
        onFlightArrive(batchId, flight.destinationPresentationKey);
        event.currentTarget.style.visibility = "hidden";
        onCueComplete(flight.id);
      }}
    >
      <MotionCardVisual
        visual={flight.visual}
        count={flight.showCount ? flight.count : 1}
      />
    </div>
  );
}

function MotionDeckCover({ flight }: { flight: MotionFlight }) {
  if (!flight.destinationCoverVisual) return null;
  return (
    <div
      className="game-motion-deck-cover"
      style={rectStyle(flight.end)}
    >
      <MotionCardVisual visual={flight.destinationCoverVisual} count={1} />
    </div>
  );
}

export function GameMotionLayer({
  batch,
  onFlightArrive,
  onComplete,
}: {
  batch: GameMotionBatch | null;
  onFlightArrive: (batchId: string, destinationPresentationKey?: string) => void;
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
            key={flight.id}
            onFlightArrive={onFlightArrive}
            onCueComplete={completeCue}
          />
        ))}
        {boardFlights.map((flight) => (
          <MotionDeckCover flight={flight} key={`${flight.id}:deck-cover`} />
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
              key={flight.id}
              onFlightArrive={onFlightArrive}
              onCueComplete={completeCue}
            />
          ))}
          {chainFlights.map((flight) => (
            <MotionDeckCover flight={flight} key={`${flight.id}:deck-cover`} />
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
              key={flight.id}
              onFlightArrive={onFlightArrive}
              onCueComplete={completeCue}
            />
          ))}
          {stackFlights.map((flight) => (
            <MotionDeckCover flight={flight} key={`${flight.id}:deck-cover`} />
          ))}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
