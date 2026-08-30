import { useEffect, type AnimationEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CARD_BACK_IMAGE_URL, cardImageUrl } from "../Card.js";
import {
  MOTION_CONNECT_MS,
  MOTION_TRAVEL_MS,
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
  return visual.kind === "face" || visual.kind === "back-reveal"
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
    "--motion-duration": `${MOTION_TRAVEL_MS}ms`,
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

export function GameMotionLayer({
  batch,
  onFlightArrive,
  onComplete,
}: {
  batch: GameMotionBatch | null;
  onFlightArrive: (batchId: number, destinationPresentationKey?: string) => void;
  onComplete: (batchId: number) => void;
}) {
  useEffect(() => {
    if (!batch) return;
    const timeout = window.setTimeout(() => onComplete(batch.id), batch.durationMs + 40);
    return () => window.clearTimeout(timeout);
  }, [batch, onComplete]);

  if (!batch || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="game-motion-layer"
      data-game-motion-batch={batch.id}
      aria-hidden="true"
    >
      {batch.connectors.map((connector) => (
        <div
          className="game-motion-connector"
          key={connector.id}
          style={connectorStyle(connector)}
        />
      ))}
      {batch.flights.map((flight) => (
        <div
          className={`game-motion-flight game-motion-flight-${flight.mode}`}
          key={flight.id}
          style={flightStyle(flight)}
          onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
            // Ignore the nested back/face reveal animations. The wrapper's
            // completion is the exact point at which the real card takes over.
            if (event.target !== event.currentTarget) return;
            onFlightArrive(batch.id, flight.destinationPresentationKey);
            event.currentTarget.style.visibility = "hidden";
          }}
        >
          <MotionCardVisual
            visual={flight.visual}
            count={flight.showCount ? flight.count : 1}
          />
        </div>
      ))}
      {batch.pulses.map((pulse) => (
        <div
          className="game-motion-pulse"
          key={pulse.id}
          style={{
            ...rectStyle(pulse.rect),
            animationDelay: `${pulse.delayMs}ms`,
          }}
        />
      ))}
    </div>,
    document.body,
  );
}
