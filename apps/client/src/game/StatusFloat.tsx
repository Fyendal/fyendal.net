import { useEffect, useRef, useState, type CSSProperties } from "react";
import { heroImageUrl } from "../lobby/heroImage.js";

export type LifeChange = {
  amount: number;
  kind: "damage" | "gain";
};

export function lifeChange(previousLife: number, currentLife: number): LifeChange | null {
  const difference = currentLife - previousLife;
  if (difference === 0) return null;
  return {
    amount: Math.abs(difference),
    kind: difference > 0 ? "gain" : "damage",
  };
}

function appendedLogEntries(
  previousLog: readonly string[],
  currentLog: readonly string[],
): readonly string[] {
  const largestOverlap = Math.min(previousLog.length, currentLog.length);
  for (let overlap = largestOverlap; overlap > 0; overlap--) {
    const previousStart = previousLog.length - overlap;
    let matches = true;
    for (let i = 0; i < overlap; i++) {
      if (previousLog[previousStart + i] !== currentLog[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return currentLog.slice(overlap);
  }
  return [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Recover separate effect-damage packets that were folded into one server
 * broadcast. A single 3-damage event remains [3], while three Runechants are
 * [1, 1, 1]. Combat hits use a different log shape and safely fall back to
 * the aggregate life delta. */
export function damagePacketsFromLog(
  previousLog: readonly string[],
  currentLog: readonly string[],
  heroName: string,
  totalDamage: number,
): number[] | null {
  const pattern = new RegExp(
    `^${escapeRegExp(heroName)} takes (\\d+) (?:arcane )?damage \\(`,
  );
  const packets: number[] = [];
  let total = 0;
  for (const entry of appendedLogEntries(previousLog, currentLog)) {
    const match = pattern.exec(entry);
    if (!match) continue;
    const amount = Number(match[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    packets.push(amount);
    total += amount;
  }
  return packets.length > 0 && total === totalDamage ? packets : null;
}

function LifeStatus({
  life,
  side,
  heroName,
  log,
}: {
  life: number;
  side: "opp" | "me";
  heroName: string;
  log: readonly string[];
}) {
  const previousLife = useRef(life);
  const previousLog = useRef(log);
  const [change, setChange] = useState<LifeChange & {
    lifeAfter: number;
    sequence: number;
    damagePackets?: number[];
  } | null>(null);

  useEffect(() => {
    const nextChange = lifeChange(previousLife.current, life);
    const damagePackets = nextChange?.kind === "damage"
      ? damagePacketsFromLog(previousLog.current, log, heroName, nextChange.amount)
      : null;
    previousLife.current = life;
    previousLog.current = log;
    if (!nextChange) return;
    setChange((current) => ({
      ...nextChange,
      lifeAfter: life,
      sequence: (current?.sequence ?? 0) + 1,
      ...(damagePackets && damagePackets.length > 1 ? { damagePackets } : {}),
    }));
  }, [heroName, life, log]);

  const owner = side === "me" ? "Your" : "Opponent";
  const activeChange = change?.lifeAfter === life ? change : null;
  const displayedAmounts = activeChange?.damagePackets ??
    (activeChange ? [activeChange.amount] : []);
  const heroPortrait = (
    <img
      className="life-hero"
      src={heroImageUrl(heroName)}
      alt=""
      width={32}
      height={32}
      aria-hidden="true"
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
  return (
    <div className={`life life-${side}`} aria-label={`${owner} life: ${life}`}>
      {side === "me" ? heroPortrait : null}
      <span
        className={`life-impact ${activeChange ? `life-impact-${activeChange.kind}` : ""}`}
        key={activeChange?.sequence ?? 0}
        aria-hidden="true"
      >
        <img className="ico ico-lg" src="/icons/life.png" alt="" />
        <span>{life}</span>
      </span>
      {side === "opp" ? heroPortrait : null}
      {activeChange ? displayedAmounts.map((amount, index) => (
        <span
          className={`life-change-pop life-change-pop-${activeChange.kind}`}
          key={`${activeChange.kind}-${activeChange.sequence}-${index}`}
          style={{
            "--life-change-offset": `${(index - (displayedAmounts.length - 1) / 2) * 15}px`,
            animationDelay: `${index * 90}ms`,
          } as CSSProperties}
          aria-hidden="true"
        >
          {activeChange.kind === "gain" ? "+" : "−"}{amount}
        </span>
      )) : null}
      <span className="life-change-live" aria-live="polite">
        {activeChange?.kind === "damage"
          ? `${owner} hero took ${activeChange.amount} damage. ${life} life remaining.`
          : activeChange
            ? `${owner} hero gained ${activeChange.amount} life. ${life} life total.`
            : ""}
      </span>
    </div>
  );
}

export function PrimaryActionButton({
  label,
  disabled = false,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const actionName = label === "END TURN"
    ? "End turn"
    : label === "CONFIRM"
      ? "Confirm blocks"
      : label === "NO BLOCK"
        ? "Confirm no blocks"
        : "Pass";

  return (
    <button
      className="btn-primary btn-pass shortcut-button"
      onClick={onSelect}
      disabled={disabled}
      title={`${actionName} (Space)`}
      aria-keyshortcuts="Space"
    >
      <span>{label}</span>
      <kbd className="shortcut-key" aria-label="Space key" />
    </button>
  );
}

/** Fixed responsive game HUD: life + remaining AP + the current primary action.
 *  Pass-only decisions, defend confirmation, and the arsenal skip action use
 *  this button instead of adding another floating control surface. */
export function StatusFloat({
  dockRect: _dockRect,
  oppLife,
  myLife,
  oppHeroName,
  myHeroName,
  log,
  activeHeroName,
  actionPoints,
  passLabel,
  passDisabled = false,
  onPass,
}: {
  dockRect: DOMRect | null;
  oppLife: number;
  myLife: number;
  oppHeroName: string;
  myHeroName: string;
  log: readonly string[];
  activeHeroName: string;
  actionPoints: number;
  passLabel: string | null;
  passDisabled?: boolean;
  onPass: () => void;
}) {
  return (
    <div className="float status-float game-hud" aria-label="Game status and primary action">
      <LifeStatus life={oppLife} side="opp" heroName={oppHeroName} log={log} />
      <div
        className="ap-pip"
        title={`${activeHeroName}'s remaining action points`}
        aria-label={`${actionPoints} action ${actionPoints === 1 ? "point" : "points"} remaining`}
      >
        <span className="ap-count" aria-hidden="true">
          <span className="ap-abbr">AP</span>
          <strong>{actionPoints}</strong>
        </span>
      </div>
      {passLabel ? (
        <PrimaryActionButton
          label={passLabel}
          disabled={passDisabled}
          onSelect={onPass}
        />
      ) : null}
      <LifeStatus life={myLife} side="me" heroName={myHeroName} log={log} />
    </div>
  );
}
