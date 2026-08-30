type PriorityLabel = "YOUR PRIORITY" | "OPPONENT'S PRIORITY";

export function combatPriorityTimingLabel(timingLabel: string): string {
  return timingLabel.startsWith("ACTION PHASE · ")
    ? timingLabel.slice("ACTION PHASE · ".length)
    : timingLabel;
}

/** Compact combat context shared by priority windows and required decisions. */
export function ChainTimingStatus({ label }: { label: string }) {
  const combatLabel = combatPriorityTimingLabel(label);
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
}: {
  turn: number;
  turnLabel: string;
  timingLabel: string;
}) {
  return (
    <div className="float priority-float" aria-live="polite">
      <span className="priority-turn">Turn {turn} · {turnLabel}</span>
      <span className="priority-timing">{timingLabel}</span>
    </div>
  );
}

export function PriorityFloat({
  turn,
  turnLabel,
  timingLabel,
  priorityLabel,
}: {
  turn: number;
  turnLabel: string;
  timingLabel: string;
  priorityLabel: PriorityLabel;
}) {
  return (
    <TurnTimingFloat
      turn={turn}
      turnLabel={turnLabel}
      timingLabel={`${timingLabel} · ${priorityLabel}`}
    />
  );
}

/** Compact priority context composed into an expanded combat-chain header. */
export function ChainPriorityStatus({
  timingLabel,
  priorityLabel,
}: {
  timingLabel: string;
  priorityLabel: PriorityLabel;
}) {
  return (
    <ChainTimingStatus label={`${timingLabel} · ${priorityLabel}`} />
  );
}
