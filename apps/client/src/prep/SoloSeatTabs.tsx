import { useRef, useState, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import type { PrepSeatView, PrepView } from "@fyendal/shared";
import { heroImageUrl } from "../lobby/heroImage.js";
import { soloSeatStatus } from "./soloSeats.js";

export const SOLO_SEAT_PANEL_ID = "solo-seat-panel";

export function soloSeatTabId(seat: 0 | 1): string {
  return `solo-seat-tab-${seat}`;
}

function SeatHeadshot({ seat }: { seat: PrepSeatView }) {
  const [available, setAvailable] = useState(true);
  return available ? (
    <img src={heroImageUrl(seat.heroName)} alt="" width={36} height={36} onError={() => setAvailable(false)} />
  ) : (
    <span className="solo-seat-tab-fallback" aria-hidden="true">{seat.heroName.charAt(0)}</span>
  );
}

/** Self-play prep: one tab per seat with its hero and what it still has to do. */
export function SoloSeatTabs({ prep, onSelect }: { prep: PrepView; onSelect: (seat: 0 | 1) => void }) {
  const intl = useIntl();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const seat: 0 | 1 = event.key === "Home" ? 0 : event.key === "End" ? 1 : (1 - prep.yourSeat) as 0 | 1;
    tabs.current[seat]?.focus();
    onSelect(seat);
  };
  return (
    <div
      className="solo-seat-tabs"
      role="tablist"
      aria-label={intl.formatMessage({ id: "prep.solo.seatsAria" })}
      onKeyDown={onKeyDown}
    >
      {([0, 1] as const).map((seat) => {
        const view = prep.seats[seat];
        const selected = prep.yourSeat === seat;
        const status = soloSeatStatus(prep, seat);
        return (
          <button
            key={seat}
            ref={(element) => { tabs.current[seat] = element; }}
            id={soloSeatTabId(seat)}
            type="button"
            role="tab"
            className={`solo-seat-tab${selected ? " selected" : ""}${status ? ` ${status}` : ""}`}
            aria-selected={selected}
            aria-controls={SOLO_SEAT_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(seat)}
          >
            {view ? <SeatHeadshot seat={view} /> : null}
            <span className="solo-seat-tab-copy">
              <span className="solo-seat-tab-name">
                <small>{intl.formatMessage({ id: "prep.solo.player" }, { player: seat + 1 })}</small>
                {view?.heroName ?? ""}
              </span>
              {status ? (
                <span className="solo-seat-tab-status">
                  {intl.formatMessage({ id: `prep.solo.status.${status}` })}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
