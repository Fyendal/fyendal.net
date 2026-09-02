import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { GameView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { cardImageUrl } from "./Card.js";
import { detectDeckCardEvents, type DeckCardEvent } from "./deckCardEvents.js";

const DISPLAY_MS = 2_600;
const EXIT_MS = 220;
const SHUFFLE_DISPLAY_MS = 900;
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useDeckCardFeedback(view: GameView | null, enabled: boolean): {
  activeEvent: DeckCardEvent | null;
  exiting: boolean;
  dismissActive: () => void;
  shuffledSeats: ReadonlySet<number>;
  toastHoverHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
} {
  const previousRef = useRef<GameView | null>(view);
  const shuffleTimersRef = useRef(new Map<number, number>());
  const [queue, setQueue] = useState<DeckCardEvent[]>([]);
  const [shuffledSeats, setShuffledSeats] = useState<ReadonlySet<number>>(() => new Set());
  const [hovered, setHovered] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => () => {
    for (const timeout of shuffleTimersRef.current.values()) window.clearTimeout(timeout);
    shuffleTimersRef.current.clear();
  }, []);

  useClientLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = view;
    if (!enabled || !previous || !view) {
      if (!enabled) {
        setQueue([]);
        setShuffledSeats(new Set());
        setHovered(false);
        setExiting(false);
      }
      return;
    }
    const events = detectDeckCardEvents(previous, view);
    const toastEvents = events.filter((event) => event.kind !== "shuffle");
    const seats = events.flatMap((event) => event.kind === "shuffle" && event.seat !== undefined ? [event.seat] : []);
    if (toastEvents.length > 0) setQueue((current) => [...current, ...toastEvents]);
    if (seats.length > 0) {
      setShuffledSeats((current) => new Set([...current, ...seats]));
      for (const seat of seats) {
        const oldTimeout = shuffleTimersRef.current.get(seat);
        if (oldTimeout !== undefined) window.clearTimeout(oldTimeout);
        const timeout = window.setTimeout(() => {
          shuffleTimersRef.current.delete(seat);
          setShuffledSeats((current) => {
            const next = new Set(current);
            next.delete(seat);
            return next;
          });
        }, SHUFFLE_DISPLAY_MS);
        shuffleTimersRef.current.set(seat, timeout);
      }
    }
  }, [enabled, view]);

  const active = queue[0] ?? null;
  // hovering the toast pins it — the user is reading the revealed cards
  useEffect(() => {
    if (!active || hovered || exiting) return;
    const timeout = window.setTimeout(() => setExiting(true), DISPLAY_MS);
    return () => window.clearTimeout(timeout);
  }, [active, hovered, exiting]);

  // the exit animation plays before the event leaves the queue
  useEffect(() => {
    if (!exiting) return;
    const timeout = window.setTimeout(() => {
      setQueue((current) => current.slice(1));
      setExiting(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timeout);
  }, [exiting]);

  const dismissActive = useCallback(() => setExiting(true), []);

  return {
    activeEvent: active,
    exiting,
    dismissActive,
    shuffledSeats,
    toastHoverHandlers: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
  };
}

export function DeckCardToast({
  event,
  viewerSeat,
  exiting = false,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: {
  event: DeckCardEvent | null;
  viewerSeat: number;
  exiting?: boolean;
  onDismiss?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const intl = useIntl();
  if (!event) return null;
  const names = event.cardIds.map((cardId) => cardData[cardId]?.name ?? cardId);

  return (
    <div
      className={`deck-card-toast deck-card-toast-${event.kind}${exiting ? " deck-card-toast-exiting" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="deck-card-toast-heading">{event.label}</div>
      <button
        type="button"
        className="deck-card-toast-close"
        aria-label={intl.formatMessage({ id: "common.dismiss" })}
        onClick={onDismiss}
      />
      {event.cardIds.length > 0 && (
        <div className="deck-card-toast-cards">
          {event.cardIds.map((cardId, index) => {
            const ownerSeat = event.cardSeats?.[index] ?? event.seat;
            return (
              <img
                key={`${cardId}-${index}`}
                className={
                  ownerSeat === undefined
                    ? undefined
                    : ownerSeat === viewerSeat
                      ? "toast-card-mine"
                      : "toast-card-theirs"
                }
                src={cardImageUrl(cardId)}
                alt={names[index]}
                data-cardid={cardId}
                draggable={false}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
