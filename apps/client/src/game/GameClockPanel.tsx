import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import type { GameClockView } from "@fyendal/shared";
import { TooltipLabel } from "../components/TooltipLabel.js";
import { UiIcon } from "../components/UiIcon.js";
import { LifeHeroPortrait } from "./LifeHeroPortrait.js";
import { formatDuration, liveClock } from "./gameClock.js";

const HOUR_MS = 3_600_000;

export interface ClockSeat {
  heroName: string;
  heroCardId: string;
}

/** Count-up game time and each seat's share; the awaited seat is lit in its seat colour. */
export function GameClockPanel({
  clock,
  receivedAt,
  seats,
  viewerSeat,
}: {
  clock: GameClockView;
  receivedAt: number;
  seats: [ClockSeat, ClockSeat];
  viewerSeat: 0 | 1;
}) {
  const intl = useIntl();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setNow(performance.now());
    if (clock.awaiting === null) return;
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clock, receivedAt]);
  const live = liveClock(clock, receivedAt, now);
  const order = [viewerSeat, viewerSeat === 0 ? 1 : 0] as const;
  return (
    <section
      className={`game-clock${live.totalMs >= HOUR_MS ? " game-clock-long" : ""}`}
      aria-label={intl.formatMessage({ id: "game.clock.title" })}>
      <TooltipLabel
        className="game-clock-total"
        label={intl.formatMessage({ id: "game.clock.total" }, { time: formatDuration(live.totalMs) })}
      >
        <UiIcon name="clock" />
        <span aria-hidden="true">{formatDuration(live.totalMs)}</span>
      </TooltipLabel>
      {order.map((seat) => {
        const time = formatDuration(live.seatMs[seat]);
        return (
          <TooltipLabel
            key={seat}
            className={`game-clock-seat ${seat === viewerSeat ? "game-clock-friendly" : "game-clock-opponent"}${
              live.awaiting === seat ? " game-clock-awaited" : ""
            }`}
            label={intl.formatMessage({ id: "game.time.playerUsed" }, { player: seats[seat].heroName, time })}
            aria-current={live.awaiting === seat ? "true" : undefined}
          >
            <span className="game-clock-portrait">
              <LifeHeroPortrait heroName={seats[seat].heroName} heroCardId={seats[seat].heroCardId} />
            </span>
            <span aria-hidden="true">{time}</span>
          </TooltipLabel>
        );
      })}
    </section>
  );
}
