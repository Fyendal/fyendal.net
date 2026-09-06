import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useIntl } from "react-intl";
import type { GameLogViewEntry } from "@fyendal/shared";
import { heroImageUrl } from "../lobby/heroImage.js";

export type PrimaryAction = "end-turn" | "confirm-blocks" | "confirm-no-blocks" | "pass";

export type LifeChange = {
  amount: number;
  kind: "damage" | "gain";
};

export type DamageAnimation = "default" | "slash" | "zap";

export type DamagePacket = {
  amount: number;
  animation: DamageAnimation;
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

/** Prefer semantic damage metadata when available. Combat logs have stable
 * engine message ids, while arcane damage is identified directly by its
 * damage event. Other physical damage keeps the default life-loss effect. */
export function damagePacketsFromLogEntries(
  previousEntries: readonly GameLogViewEntry[] | undefined,
  currentEntries: readonly GameLogViewEntry[] | undefined,
  targetSeat: number,
  totalDamage: number,
): DamagePacket[] | null {
  if (!currentEntries) return null;
  const previousSequence = previousEntries?.reduce((highest, entry) => (
    "sequence" in entry ? Math.max(highest, entry.sequence) : highest
  ), 0) ?? 0;
  const packets: DamagePacket[] = [];
  let total = 0;
  for (const entry of currentEntries) {
    if (!("sequence" in entry) || entry.sequence <= previousSequence) continue;
    const event = entry.event;
    if (event?.kind !== "damage" || event.targetSeat !== targetSeat) continue;
    const combat = event.damageType === "physical" && (
      entry.message.id === "engine.log.damage.hit"
      || entry.message.id === "engine.log.damage.redirected"
    );
    packets.push({
      amount: event.amount,
      animation: event.damageType === "arcane" ? "zap" : combat ? "slash" : "default",
    });
    total += event.amount;
  }
  return packets.length > 0 && total === totalDamage ? packets : null;
}

function LifeStatus({
  life,
  side,
  seat,
  heroName,
  log,
  logEntries,
}: {
  life: number;
  side: "opp" | "me";
  seat: number;
  heroName: string;
  log: readonly string[];
  logEntries?: readonly GameLogViewEntry[];
}) {
  const intl = useIntl();
  const previousLife = useRef(life);
  const previousLog = useRef(log);
  const previousLogEntries = useRef(logEntries);
  const [change, setChange] = useState<LifeChange & {
    lifeAfter: number;
    sequence: number;
    damagePackets?: DamagePacket[];
  } | null>(null);

  useEffect(() => {
    const nextChange = lifeChange(previousLife.current, life);
    const semanticDamagePackets = nextChange?.kind === "damage"
      ? damagePacketsFromLogEntries(
          previousLogEntries.current,
          logEntries,
          seat,
          nextChange.amount,
        )
      : null;
    const legacyDamagePackets = nextChange?.kind === "damage" && !semanticDamagePackets
      ? damagePacketsFromLog(previousLog.current, log, heroName, nextChange.amount)
      : null;
    const damagePackets = semanticDamagePackets ?? legacyDamagePackets?.map((amount) => ({
      amount,
      animation: "default" as const,
    })) ?? null;
    previousLife.current = life;
    previousLog.current = log;
    previousLogEntries.current = logEntries;
    if (!nextChange) return;
    setChange((current) => ({
      ...nextChange,
      lifeAfter: life,
      sequence: (current?.sequence ?? 0) + 1,
      ...(damagePackets ? { damagePackets } : {}),
    }));
  }, [heroName, life, log, logEntries, seat]);

  const owner = intl.formatMessage({ id: side === "me" ? "game.owner.your" : "game.owner.opponent" });
  const activeChange = change?.lifeAfter === life ? change : null;
  const displayedPackets = activeChange?.damagePackets ?? (activeChange ? [{
    amount: activeChange.amount,
    animation: "default" as const,
  }] : []);
  const impactAnimation = activeChange?.kind === "damage"
    ? displayedPackets.find((packet) => packet.animation !== "default")?.animation ?? "damage"
    : activeChange?.kind;
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
    <div
      className={`life life-${side}`}
      aria-label={intl.formatMessage({ id: "game.life.total" }, { owner, life })}
    >
      {side === "me" ? heroPortrait : null}
      <span
        className={`life-impact ${impactAnimation ? `life-impact-${impactAnimation}` : ""}`}
        key={activeChange?.sequence ?? 0}
        aria-hidden="true"
      >
        <img className="ico ico-lg" src="/icons/life.png" alt="" />
        <span>{life}</span>
      </span>
      {side === "opp" ? heroPortrait : null}
      {activeChange ? displayedPackets.map((packet, index) => (
        <span
          className={`life-change-pop life-change-pop-${activeChange.kind} life-change-pop-${packet.animation}`}
          key={`${activeChange.kind}-${activeChange.sequence}-${index}`}
          style={{
            "--life-change-offset": `${(index - (displayedPackets.length - 1) / 2) * 15}px`,
            animationDelay: `${index * 90}ms`,
          } as CSSProperties}
          aria-hidden="true"
        >
          {activeChange.kind === "damage" && packet.animation !== "default" ? (
            <span
              className={`life-damage-fx life-damage-fx-${packet.animation}`}
              style={{ animationDelay: `${index * 90}ms` }}
            />
          ) : null}
          {activeChange.kind === "gain" ? "+" : "−"}{packet.amount}
        </span>
      )) : null}
      <span className="life-change-live" aria-live="polite">
        {activeChange?.kind === "damage"
          ? intl.formatMessage(
              { id: "game.life.damage" },
              { owner, amount: activeChange.amount, life },
            )
          : activeChange
            ? intl.formatMessage(
                { id: "game.life.gain" },
                { owner, amount: activeChange.amount, life },
              )
            : ""}
      </span>
    </div>
  );
}

export function PrimaryActionButton({
  action,
  disabled = false,
  onSelect,
}: {
  action: PrimaryAction;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const intl = useIntl();
  const actionName = intl.formatMessage({ id: `game.action.${action}` });
  const shortLabel = intl.formatMessage({ id: `game.action.${action}.short` });

  return (
    <button
      className="btn-primary btn-pass shortcut-button"
      onClick={onSelect}
      disabled={disabled}
      title={intl.formatMessage({ id: "common.shortcut.space" }, { label: actionName })}
      aria-keyshortcuts="Space"
    >
      <span>{shortLabel}</span>
      <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
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
  mySeat = 0,
  log,
  logEntries,
  activeHeroName,
  actionPoints,
  primaryAction,
  passDisabled = false,
  onPass,
}: {
  dockRect: DOMRect | null;
  oppLife: number;
  myLife: number;
  oppHeroName: string;
  myHeroName: string;
  mySeat?: 0 | 1;
  log: readonly string[];
  logEntries?: readonly GameLogViewEntry[];
  activeHeroName: string;
  actionPoints: number;
  primaryAction: PrimaryAction | null;
  passDisabled?: boolean;
  onPass: () => void;
}) {
  const intl = useIntl();
  return (
    <div
      className="float status-float game-hud"
      aria-label={intl.formatMessage({ id: "game.hud.label" })}
    >
      <LifeStatus
        life={oppLife}
        side="opp"
        seat={mySeat === 0 ? 1 : 0}
        heroName={oppHeroName}
        log={log}
        logEntries={logEntries}
      />
      <div
        className="ap-pip"
        title={intl.formatMessage({ id: "game.actionPoints.hero" }, { hero: activeHeroName })}
        aria-label={intl.formatMessage({ id: "game.actionPoints.remaining" }, { count: actionPoints })}
      >
        <span className="ap-count" aria-hidden="true">
          <span className="ap-abbr">AP</span>
          <strong>{actionPoints}</strong>
        </span>
      </div>
      {primaryAction ? (
        <PrimaryActionButton
          action={primaryAction}
          disabled={passDisabled}
          onSelect={onPass}
        />
      ) : null}
      <LifeStatus
        life={myLife}
        side="me"
        seat={mySeat}
        heroName={myHeroName}
        log={log}
        logEntries={logEntries}
      />
    </div>
  );
}
