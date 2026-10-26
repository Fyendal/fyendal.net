import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { GameView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { cardImageUrl } from "./Card.js";
import { decisionRevealEvent, detectDeckCardEvents, type DeckCardEvent } from "./deckCardEvents.js";

const DISPLAY_MS = 2_600;
// a die lingers a little longer: its result only shows once it lands
const ROLL_DISPLAY_MS = 3_200;
const EXIT_MS = 220;
const SHUFFLE_DISPLAY_MS = 900;
const SCRIPTED_CHOICE_KINDS: ReadonlySet<string> = new Set([
  "choose-target",
  "choose-name",
  "order-triggers",
  "optional-effect",
]);
function scriptedChoiceKey(view: GameView | null): string | null {
  const decision = view?.pendingDecision;
  if (!decision || !SCRIPTED_CHOICE_KINDS.has(decision.kind)) return null;
  return `${decision.player}:${decision.kind}:${decision.sourceInstanceId ?? ""}:${decision.prompt}`;
}
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Pip cells on a 3×3 grid, numbered row by row from the top left.
const PIP_CELLS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function DieFace({ value }: { value: number }) {
  return (
    <span className={`die-face die-face-${value}`}>
      {PIP_CELLS[value]?.map((cell) => <span key={cell} className={`die-pip die-pip-${cell}`} />)}
    </span>
  );
}

/** A d6 that drops, tumbles, and lands showing `result`. Other die sizes keep
 * the same motion on a single numbered face. */
function RollingDie({ result, sides, label }: { result: number; sides: number; label: string }) {
  const pips = sides === 6 && result >= 1 && result <= 6;
  return (
    <div className="die-roll" role="img" aria-label={label}>
      <span className="die-ground" />
      <span className="die-drop">
        {pips ? (
          <span className={`die-cube die-show-${result}`}>
            {[1, 2, 3, 4, 5, 6].map((value) => <DieFace key={value} value={value} />)}
          </span>
        ) : (
          <span className="die-cube die-numeral">{result}</span>
        )}
      </span>
    </div>
  );
}

function localizedDeckCardEventLabel(event: DeckCardEvent): string | null {
  if (event.kind === "banish" && event.sourceZone === "deck") {
    return "game.deckToast.banishedFromDeck";
  }
  if (event.kind === "banish" && event.sourceZone === "graveyard") {
    return "game.deckToast.banishedFromGraveyard";
  }
  if (event.kind === "graveyard" && event.sourceZone === "deck") {
    return "game.deckToast.sentFromDeckToGraveyard";
  }
  if (event.kind === "reveal" && event.sourceZone === "hand") {
    return "game.deckToast.revealedFromHand";
  }
  if (event.kind === "reveal" && event.sourceZone === "deck") {
    return "game.deckToast.revealedFromDeck";
  }
  return null;
}

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
  // the choice whose reveal was already shown, so a dismissal sticks
  const revealShownForRef = useRef<string | null>(null);
  const shuffleTimersRef = useRef(new Map<number, number>());
  const [queue, setQueue] = useState<{ event: DeckCardEvent; choiceKey: string | null }[]>([]);
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
    if (!enabled || !view) {
      if (!enabled) {
        setQueue([]);
        setShuffledSeats(new Set());
        setHovered(false);
        setExiting(false);
        revealShownForRef.current = null;
      }
      return;
    }
    const events = previous ? detectDeckCardEvents(previous, view) : [];
    const toastEvents = events.filter((event) => event.kind !== "shuffle");
    const seats = events.flatMap((event) => event.kind === "shuffle" && event.seat !== undefined ? [event.seat] : []);
    // a reveal shown beside a pending choice stays until that choice is answered or dismissed
    const choiceKey = scriptedChoiceKey(view);
    if (choiceKey !== scriptedChoiceKey(previous)) revealShownForRef.current = null;
    const restored = choiceKey !== null && revealShownForRef.current !== choiceKey &&
        !toastEvents.some((event) => event.kind === "reveal")
      ? decisionRevealEvent(view)
      : null;
    const queued = restored ? [...toastEvents, restored] : toastEvents;
    if (choiceKey !== null && queued.some((event) => event.kind === "reveal")) revealShownForRef.current = choiceKey;
    if (queued.length > 0) {
      setQueue((current) => [...current, ...queued.map((event) => ({ event, choiceKey }))]);
    }
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

  const activeEntry = queue[0] ?? null;
  const active = activeEntry?.event ?? null;
  const pinnedChoiceKey = activeEntry?.choiceKey ?? null;
  const pinned = pinnedChoiceKey !== null;
  const currentChoiceKey = enabled ? scriptedChoiceKey(view) : null;
  useEffect(() => {
    if (pinnedChoiceKey !== null && currentChoiceKey !== pinnedChoiceKey) setExiting(true);
  }, [pinnedChoiceKey, currentChoiceKey]);
  // hovering the toast pins it — the user is reading the revealed cards
  useEffect(() => {
    if (!active || pinned || hovered || exiting) return;
    const timeout = window.setTimeout(
      () => setExiting(true),
      active.kind === "roll" ? ROLL_DISPLAY_MS : DISPLAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [active, pinned, hovered, exiting]);

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
  const localizedLabelId = localizedDeckCardEventLabel(event);
  const label = localizedLabelId
    ? intl.formatMessage({ id: localizedLabelId })
    : event.kind === "numbers"
      ? intl.formatMessage({ id: "game.deckToast.numbersRevealed" }, { card: event.label })
      : event.roll
        ? event.roll.reroll
          ? intl.formatMessage({ id: "game.deckToast.roll.rerolled" })
          : intl.formatMessage(
            { id: "game.deckToast.roll.heading" },
            { hero: event.roll.heroName?.split(",")[0] ?? "" },
          )
        : event.label;
  const numbers = [...(event.numbers ?? [])].sort((a, b) =>
    Number(b.seat === viewerSeat) - Number(a.seat === viewerSeat));
  const tied = new Set(numbers.map((choice) => choice.number)).size < 2;
  const highest = tied ? undefined : Math.max(...numbers.map((choice) => choice.number));

  return (
    <div
      className={`deck-card-toast deck-card-toast-${event.kind}${
        event.roll?.seat === undefined ? "" : event.roll.seat === viewerSeat ? " die-roll-mine" : " die-roll-theirs"
      }${exiting ? " deck-card-toast-exiting" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="deck-card-toast-heading">{label}</div>
      <button
        type="button"
        className="deck-card-toast-close"
        aria-label={intl.formatMessage({ id: "common.dismiss" })}
        onClick={onDismiss}
      />
      {event.roll ? (
        <RollingDie
          result={event.roll.result}
          sides={event.roll.sides}
          label={intl.formatMessage({ id: "game.deckToast.roll.result" }, { result: event.roll.result })}
        />
      ) : null}
      {numbers.length ? (
        <div className="number-reveal">
          {numbers.map((choice, index) => (
            <Fragment key={choice.seat}>
              {index > 0 ? (
                <span className="number-reveal-divider">
                  {intl.formatMessage({ id: tied ? "game.deckToast.numbersTie" : "game.deckToast.numbersVersus" })}
                </span>
              ) : null}
              <div
                className={`number-reveal-side ${
                  choice.seat === viewerSeat ? "number-reveal-mine" : "number-reveal-theirs"
                }${choice.number === highest ? " number-reveal-highest" : ""}`}
              >
                <span className="number-reveal-value">{choice.number}</span>
                <span className="number-reveal-hero">{choice.heroName.split(",")[0]}</span>
              </div>
            </Fragment>
          ))}
        </div>
      ) : null}
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
