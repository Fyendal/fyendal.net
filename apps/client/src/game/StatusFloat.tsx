import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { useIntl } from "react-intl";
import type { GameLogViewEntry } from "@fyendal/shared";
import { cardImageUrl } from "./Card.js";
import { MARKED_TOKEN_ID } from "./cardBadges.js";
import { ControlIcon, undoWithoutFocus } from "./gameControls.js";
import { LifeHeroPortrait } from "./LifeHeroPortrait.js";

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
  heroCardId,
  marked,
  priority,
  priorityPulse,
  log,
  logEntries,
}: {
  life: number;
  side: "opp" | "me";
  seat: number;
  heroName: string;
  heroCardId: string;
  marked: boolean;
  /** Whether the game waits on this hero, on the other hero, or on nobody. */
  priority: "holder" | "waiting" | null;
  priorityPulse: boolean;
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
    <span className={`life-hero-frame${marked ? " life-hero-marked" : ""}`}>
      <LifeHeroPortrait heroName={heroName} heroCardId={heroCardId} />
      {marked ? (
        <span className="life-hero-brand" aria-hidden="true">
          <img src={cardImageUrl(MARKED_TOKEN_ID)} alt="" draggable={false} />
        </span>
      ) : null}
    </span>
  );
  const priorityClass = priority === "holder"
    ? ` life-priority-holder${priorityPulse ? " life-priority-pulse" : ""}`
    : priority === "waiting"
      ? " life-priority-waiting"
      : "";
  return (
    <div
      className={`life life-${side}${priorityClass}`}
      aria-label={intl.formatMessage(
        { id: marked ? "game.life.totalMarked" : "game.life.total" },
        { owner, life },
      )}
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
 *  this button instead of adding another floating control surface. The phone
 *  HUDs also show the viewer's resources, since floats cover pitch; in phone
 *  landscape the HUD becomes the side rail's two player plates. */
export function StatusFloat({
  dockRect: _dockRect,
  hostRef,
  oppLife,
  myLife,
  oppHeroName,
  myHeroName,
  oppHeroCardId,
  myHeroCardId,
  oppMarked = false,
  myMarked = false,
  mySeat = 0,
  priorityHolderSeat = null,
  priorityPulse = false,
  log,
  logEntries,
  activeHeroName,
  actionPoints,
  myResources,
  primaryAction,
  passDisabled = false,
  onPass,
  onUndo = null,
  undoDisabled = false,
  rail = null,
}: {
  dockRect: DOMRect | null;
  hostRef?: Ref<HTMLDivElement>;
  oppLife: number;
  myLife: number;
  oppHeroName: string;
  myHeroName: string;
  oppHeroCardId: string;
  myHeroCardId: string;
  oppMarked?: boolean;
  myMarked?: boolean;
  mySeat?: 0 | 1;
  /** Seat the game waits on; its portrait lights up and the other recedes. */
  priorityHolderSeat?: number | null;
  /** Breathe the lit portrait while the viewer holds priority. */
  priorityPulse?: boolean;
  log: readonly string[];
  logEntries?: readonly GameLogViewEntry[];
  activeHeroName: string;
  actionPoints: number;
  myResources: number;
  primaryAction: PrimaryAction | null;
  passDisabled?: boolean;
  onPass: () => void;
  /** Undo in the HUD; only the landscape bar shows it. */
  onUndo?: (() => void) | null;
  undoDisabled?: boolean;
  /** Phone landscape: mirrored player plates in the side rail instead of a float. */
  rail?: {
    oppIdentity: ReactNode;
    oppHand: ReactNode;
    myIdentity: ReactNode;
    /** Action points belong to the turn player, so they head that plate. */
    activeSeat: number;
  } | null;
}) {
  const intl = useIntl();
  const oppSeat = mySeat === 0 ? 1 : 0;
  const priorityFor = (seat: 0 | 1) => priorityHolderSeat === null
    ? null
    : priorityHolderSeat === seat ? "holder" : "waiting";
  const oppLifeStatus = (
    <LifeStatus
      life={oppLife}
      side="opp"
      seat={oppSeat}
      heroName={oppHeroName}
      heroCardId={oppHeroCardId}
      marked={oppMarked}
      priority={priorityFor(oppSeat)}
      priorityPulse={priorityPulse}
      log={log}
      logEntries={logEntries}
    />
  );
  const myLifeStatus = (
    <LifeStatus
      life={myLife}
      side="me"
      seat={mySeat}
      heroName={myHeroName}
      heroCardId={myHeroCardId}
      marked={myMarked}
      priority={priorityFor(mySeat)}
      priorityPulse={priorityPulse}
      log={log}
      logEntries={logEntries}
    />
  );
  const actionPointsPip = (
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
  );
  const resourcesPip = (
    <div
      className={`hud-resources${myResources > 0 ? "" : " hud-resources-empty"}`}
      role="img"
      aria-label={intl.formatMessage({ id: "game.resources.yours" }, { count: myResources })}
    >
      <span className="hud-resources-count" aria-hidden="true">{myResources}</span>
    </div>
  );
  const undoButton = onUndo ? (
    <button
      className="hud-undo"
      aria-label={intl.formatMessage({ id: "game.undoLast" })}
      title={intl.formatMessage({ id: "game.undoDescription" })}
      disabled={undoDisabled}
      onClick={(event) => undoWithoutFocus(event.currentTarget, onUndo)}
    >
      <ControlIcon kind="undo" />
    </button>
  ) : null;
  const primaryButton = primaryAction ? (
    <PrimaryActionButton
      action={primaryAction}
      disabled={passDisabled}
      onSelect={onPass}
    />
  ) : null;
  if (rail) {
    const plate = (seat: 0 | 1, side: "opp" | "me", identity: ReactNode, stats: ReactNode) => (
      <div className={`hud-plate hud-plate-${side}${priorityHolderSeat === seat ? " hud-plate-active" : ""}`}>
        <div className="hud-plate-head">
          {identity}
          {rail.activeSeat === seat ? actionPointsPip : null}
        </div>
        <div className="hud-plate-stats">{stats}</div>
        {side === "me" && (undoButton || primaryButton) ? (
          <div className="hud-plate-actions">
            {undoButton}
            {primaryButton}
          </div>
        ) : null}
      </div>
    );
    return (
      <div
        ref={hostRef}
        className="status-rail game-hud"
        aria-label={intl.formatMessage({ id: "game.hud.label" })}
      >
        {plate(oppSeat, "opp", rail.oppIdentity, <>{oppLifeStatus}{rail.oppHand}</>)}
        {plate(mySeat, "me", rail.myIdentity, <>{myLifeStatus}{resourcesPip}</>)}
      </div>
    );
  }
  return (
    <div
      ref={hostRef}
      className="float status-float game-hud"
      aria-label={intl.formatMessage({ id: "game.hud.label" })}
    >
      {oppLifeStatus}
      {actionPointsPip}
      {resourcesPip}
      {undoButton}
      {primaryButton}
      {myLifeStatus}
    </div>
  );
}
