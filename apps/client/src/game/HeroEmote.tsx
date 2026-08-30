import { useEffect, useState, type ReactNode } from "react";
import type { EmoteMessage } from "@fyendal/shared";
import type { EmoteEvent } from "../store/types.js";

export const EMOTE_OPTIONS: readonly EmoteMessage[] = [
  "Hello!",
  "Good luck, have fun!",
  "Good game!",
  "Thanks!",
  "Sorry!",
  "Nice play!",
  "Thinking...",
  "Oops!",
];

const EMOTE_VISIBLE_MS = 4_000;

export function HeroEmote({
  seat,
  event,
  canSend,
  onSend,
  children,
  placement = "hero",
}: {
  seat: number;
  event: EmoteEvent | null;
  canSend: boolean;
  onSend: (message: EmoteMessage) => void;
  children?: ReactNode;
  placement?: "hero" | "toolbar";
}) {
  const [open, setOpen] = useState(false);
  const [visibleEvent, setVisibleEvent] = useState<EmoteEvent | null>(
    () => event?.seat === seat ? event : null,
  );

  useEffect(() => {
    if (!event || event.seat !== seat) {
      setVisibleEvent(null);
      return;
    }
    setVisibleEvent(event);
    const timer = window.setTimeout(() => setVisibleEvent(null), EMOTE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [event, seat]);

  useEffect(() => {
    if (!canSend) setOpen(false);
  }, [canSend]);

  const pickerId = `hero-emote-picker-${seat}`;
  return (
    <div
      className={`hero-emote hero-emote-${placement}${open ? " hero-emote-open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {children}
      {visibleEvent ? (
        <div key={visibleEvent.id} className="hero-emote-toast" role="status" aria-live="polite">
          {visibleEvent.message}
        </div>
      ) : null}
      {canSend ? (
        <button
          type="button"
          className={placement === "toolbar" ? "emote-toolbar-button" : "hero-emote-button"}
          aria-label="Send a message"
          aria-expanded={open}
          aria-controls={pickerId}
          title="Send a message"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((current) => !current);
          }}
        >
          <svg
            className="game-control-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            data-control-icon="emote"
          >
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
          </svg>
        </button>
      ) : null}
      {canSend && open ? (
        <div
          id={pickerId}
          className="hero-emote-picker"
          role="dialog"
          aria-label="Choose a message"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="hero-emote-picker-title">Send a message</div>
          <div className="hero-emote-options">
            {EMOTE_OPTIONS.map((message) => (
              <button
                key={message}
                type="button"
                onClick={() => {
                  onSend(message);
                  setOpen(false);
                }}
              >
                {message}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
