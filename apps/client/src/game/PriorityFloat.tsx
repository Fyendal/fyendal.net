import { useIntl } from "react-intl";
import { localizeTimingLabel } from "./timingLocalization.js";

/** Solo names the priority holder instead of "you"/"opponent"; both seats are the viewer's. */
export function soloPriorityLabel(solo: boolean, mine: boolean, heroName: string): string {
  if (solo) return `${heroName.toUpperCase()}'S PRIORITY`;
  return mine ? "YOUR PRIORITY" : "OPPONENT'S PRIORITY";
}

export function combatPriorityTimingLabel(timingLabel: string): string {
  return timingLabel.startsWith("ACTION PHASE · ")
    ? timingLabel.slice("ACTION PHASE · ".length)
    : timingLabel;
}

/** Compact combat context shared by priority windows and required decisions. */
export function ChainTimingStatus({ label }: { label: string }) {
  const intl = useIntl();
  const combatLabel = localizeTimingLabel(intl, combatPriorityTimingLabel(label));
  const separatorIndex = combatLabel.lastIndexOf(" · ");
  if (separatorIndex === -1) {
    return <span className="chain-priority-status">{combatLabel}</span>;
  }

  return (
    <span className="chain-priority-status chain-priority-status-split">
      <span>{combatLabel.slice(0, separatorIndex)}</span>
      <span className="chain-priority-separator" aria-hidden="true"> · </span>
      <span>{combatLabel.slice(separatorIndex + " · ".length)}</span>
    </span>
  );
}

/** Full timing surface used away from an expanded combat-chain window. */
export function TurnTimingFloat({
  turn,
  turnLabel,
  timingLabel,
  className,
}: {
  turn: number;
  turnLabel: string;
  timingLabel: string;
  className?: string;
}) {
  const intl = useIntl();
  return (
    <div className={`float priority-float${className ? ` ${className}` : ""}`} aria-live="polite">
      <span className="priority-turn">
        {intl.formatMessage({ id: "game.turn.status" }, { turn, owner: turnLabel })}
      </span>
      <span className="priority-timing">{localizeTimingLabel(intl, timingLabel)}</span>
    </div>
  );
}

export function PriorityFloat({
  turn,
  turnLabel,
  timingLabel,
  priorityLabel,
  mine = priorityLabel === "YOUR PRIORITY",
}: {
  turn: number;
  turnLabel: string;
  timingLabel: string;
  priorityLabel: string;
  mine?: boolean;
}) {
  return (
    <TurnTimingFloat
      turn={turn}
      turnLabel={turnLabel}
      timingLabel={`${timingLabel} · ${priorityLabel}`}
      className={mine ? "priority-float-mine" : undefined}
    />
  );
}

/** Compact priority context composed into an expanded combat-chain header. */
export function ChainPriorityStatus({
  timingLabel,
  priorityLabel,
  mine = priorityLabel === "YOUR PRIORITY",
}: {
  timingLabel: string;
  priorityLabel: string;
  mine?: boolean;
}) {
  return (
    <span className={mine ? "chain-priority-status-mine" : undefined}>
      <ChainTimingStatus label={`${timingLabel} · ${priorityLabel}`} />
    </span>
  );
}
