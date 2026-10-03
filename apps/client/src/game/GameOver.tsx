import { useId, useMemo, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import type { GameView } from "@fyendal/shared";
import type { AchievementId } from "@fyendal/protocol";
import { heroImageUrl } from "../lobby/heroImage.js";
import { achievementMessageId } from "../achievements/catalog.js";
import "../styles/achievements.css";
import {
  averagePerRound,
  averageValue,
  computeCycleStats,
  cycleValue,
  preventedDamage,
  totalPrevented,
} from "../replay/stats.js";

/** Talishar-style end-game summary: one selected player's key match totals,
 * averages, and a compact round-by-round breakdown. All values come from
 * authoritative engine counters, with corrected resolved-link inference for
 * legacy replays. */
export function GameOver({
  view,
  seat,
  spectating,
  recordedViews,
  onWatchReplay,
  onDownloadReplay,
  onBackToLobby,
  onClose,
  replaying = false,
  friendAction = null,
  matchAchievements = [],
  onViewAchievements,
}: {
  view: GameView;
  seat: number;
  spectating: boolean;
  recordedViews: GameView[];
  onWatchReplay: (() => void) | null;
  onDownloadReplay: (() => void) | null;
  onBackToLobby: () => void;
  onClose: () => void;
  replaying?: boolean;
  friendAction?: ReactNode;
  matchAchievements?: AchievementId[];
  onViewAchievements?: () => void;
}) {
  const intl = useIntl();
  const openingTooltipId = useId();
  const winner = view.winner;
  const initialSeat = (spectating ? winner ?? 0 : seat) === 1 ? 1 : 0;
  const [selectedSeat, setSelectedSeat] = useState<0 | 1>(initialSeat);
  const stats = useMemo(
    () => computeCycleStats(recordedViews.length > 0 ? recordedViews : [view]),
    [recordedViews, view],
  );
  if (view.phase !== "game-over") return null;

  const winnerName = winner === null ? "" : view.players[winner]?.heroName ?? "";
  const headline = winner === null
    ? intl.formatMessage({ id: "game.result.draw" })
    : intl.formatMessage({ id: "game.result.namedWinner" }, { winner: winnerName });
  const resultLabel = winner === null || spectating || replaying
    ? intl.formatMessage({ id: "game.over.matchComplete" })
    : intl.formatMessage({ id: winner === seat ? "game.result.victory" : "game.result.defeat" });
  const names: [string, string] = [
    view.players[0]?.heroName ?? intl.formatMessage({ id: "game.playerNumber" }, { number: 1 }),
    view.players[1]?.heroName ?? intl.formatMessage({ id: "game.playerNumber" }, { number: 2 }),
  ];
  const totalValue = stats.rows.reduce((sum, row) => sum + cycleValue(row, selectedSeat), 0);
  const fmt = (n: number) => intl.formatNumber(n, { maximumFractionDigits: 1 });

  return (
    <div className="overlay gameover-overlay">
      <div className="overlay-panel gameover-panel">
        <header className="gameover-header">
          <div className="gameover-result">
            {winner !== null ? <HeroPortrait name={winnerName} className="gameover-result-portrait" /> : null}
            <div className="gameover-result-copy">
              <span className="gameover-eyebrow">{resultLabel}</span>
              <h2 className="gameover-headline">{headline}</h2>
            </div>
          </div>
          <div className="rail-actions gameover-actions">
            {friendAction}
            {onDownloadReplay ? (
              <button onClick={onDownloadReplay}>{intl.formatMessage({ id: "replay.controls.export" })}</button>
            ) : null}
            {onWatchReplay ? (
              <button onClick={onWatchReplay}>▶ {intl.formatMessage({ id: "game.over.watchReplay" })}</button>
            ) : null}
            <button onClick={onClose}>{intl.formatMessage({ id: "game.over.backToBoard" })}</button>
            <button className="btn-primary" onClick={onBackToLobby}>
              {intl.formatMessage({ id: replaying ? "replay.controls.exit" : "game.over.backToLobby" })}
            </button>
          </div>
        </header>

        {!spectating && !replaying ? (
          <p className="gameover-replay-retention">
            {intl.formatMessage({ id: "game.over.retention" })}
          </p>
        ) : null}

        {matchAchievements.length > 0 ? (
          <section className="gameover-achievements">
            <div className="gameover-achievements-heading">
              <h3>{intl.formatMessage({ id: "achievements.matchEarned" })}</h3>
              {onViewAchievements ? <button type="button" className="gameover-achievements-link" onClick={onViewAchievements}>
                {intl.formatMessage({ id: "achievements.viewAll" })}<span aria-hidden="true">→</span>
              </button> : null}
            </div>
            <ul>{matchAchievements.map((id) => (
              <li key={id}>{intl.formatMessage({ id: achievementMessageId(id, "name") })}</li>
            ))}</ul>
          </section>
        ) : null}

        <div className="gameover-switcher">
          <span className="gameover-switcher-label">{intl.formatMessage({ id: "game.over.playerStats" })}</span>
          <div
            className="gameover-player-tabs"
            role="group"
            aria-label={intl.formatMessage({ id: "game.over.viewStatsFor" })}
          >
            {([0, 1] as const).map((playerSeat) => (
              <button
                key={playerSeat}
                id={`gameover-player-tab-${playerSeat}`}
                type="button"
                aria-pressed={selectedSeat === playerSeat}
                className={selectedSeat === playerSeat ? "active" : ""}
                onClick={() => setSelectedSeat(playerSeat)}
              >
                <HeroPortrait name={names[playerSeat]} className="gameover-tab-portrait" />
                <span className="gameover-player-name">{names[playerSeat]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="gameover-body">
          <section
            className="gameover-selected-stats"
            aria-labelledby={`gameover-player-tab-${selectedSeat}`}
          >
            <section className="gameover-average-stats" aria-label={intl.formatMessage({ id: "game.stats.averages" })}>
              <div
                className="gameover-average-stat gameover-average-value"
                tabIndex={0}
                aria-describedby={openingTooltipId}
              >
                <strong>{fmt(averageValue(stats, selectedSeat))}</strong>
                <span>{intl.formatMessage({ id: "game.stats.valuePerTurn" })}</span>
                <span className="gameover-tooltip-mark" aria-hidden="true">i</span>
                <span className="gameover-average-tooltip" id={openingTooltipId} role="tooltip">
                  {intl.formatMessage({ id: "game.stats.openingExcluded" })}
                </span>
              </div>
              <div className="gameover-average-stat">
                <strong>{fmt(averagePerRound(stats, selectedSeat, "threatened"))}</strong>
                <span>{intl.formatMessage({ id: "game.stats.threatPerTurn" })}</span>
              </div>
              <div className="gameover-average-stat">
                <strong>{fmt(averagePerRound(stats, selectedSeat, "damageDealt"))}</strong>
                <span>{intl.formatMessage({ id: "game.stats.damagePerTurn" })}</span>
              </div>
              <div className="gameover-average-stat">
                <strong>{fmt(averagePerRound(stats, selectedSeat, "blocked"))}</strong>
                <span>{intl.formatMessage({ id: "game.stats.blockedPerTurn" })}</span>
              </div>
            </section>

            <section className="gameover-match-strip" aria-label={intl.formatMessage({ id: "game.stats.match" })}>
              <div><span>{intl.formatMessage({ id: "game.stats.turnsCounted" })}</span><strong>{stats.cyclesPlayed[selectedSeat]}</strong></div>
              <div><span>{intl.formatMessage({ id: "game.stats.finalLife" })}</span><strong>{view.players[selectedSeat]?.life ?? 0}</strong></div>
              <div><span>{intl.formatMessage({ id: "game.stats.damageThreatened" })}</span><strong>{stats.total.threatened[selectedSeat]}</strong></div>
              <div><span>{intl.formatMessage({ id: "game.stats.damageDealt" })}</span><strong>{stats.total.damageDealt[selectedSeat]}</strong></div>
              <div><span>{intl.formatMessage({ id: "game.stats.damageBlocked" })}</span><strong>{stats.total.blocked[selectedSeat]}</strong></div>
            </section>

            <section className="gameover-breakdown">
              <h3>{intl.formatMessage({ id: "game.stats.breakdown" })}</h3>
              <div className="gameover-table-wrap">
                <table className="gameover-table">
                  <thead>
                    <tr>
                      <th>{intl.formatMessage({ id: "game.stats.round" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.threatened" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.dealt" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.blocked" })}</th>
                      <th
                        aria-label={intl.formatMessage({ id: "game.stats.allyAbsorbed" })}
                        title={intl.formatMessage({ id: "game.stats.allyAbsorbed" })}
                      >{intl.formatMessage({ id: "game.stats.allies" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.prevented" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.lifeGained" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.lifeLost" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.value" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.rows.map((row) => (
                      <tr key={row.cycle}>
                        <td>{row.cycle === 0
                          ? intl.formatMessage({ id: "game.stats.openingTurn" })
                          : row.cycle}</td>
                        <td>{row.threatened[selectedSeat]}</td>
                        <td>{row.damageDealt[selectedSeat]}</td>
                        <td>{row.blocked[selectedSeat]}</td>
                        <td>{row.allyAbsorbed[selectedSeat]}</td>
                        <td>{preventedDamage(row, selectedSeat)}</td>
                        <td>{row.lifeGained[selectedSeat]}</td>
                        <td>{row.lifeLost[selectedSeat]}</td>
                        <td>{cycleValue(row, selectedSeat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{intl.formatMessage({ id: "game.stats.total" })}</td>
                      <td>{stats.total.threatened[selectedSeat]}</td>
                      <td>{stats.total.damageDealt[selectedSeat]}</td>
                      <td>{stats.total.blocked[selectedSeat]}</td>
                      <td>{stats.total.allyAbsorbed[selectedSeat]}</td>
                      <td>{totalPrevented(stats, selectedSeat)}</td>
                      <td>{stats.total.lifeGained[selectedSeat]}</td>
                      <td>{stats.total.lifeLost[selectedSeat]}</td>
                      <td>{totalValue}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </section>
        </div>
      </div>
    </div>
  );
}

function HeroPortrait({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`gameover-hero-portrait ${className}`.trim()} aria-hidden="true">
      <span>{name.charAt(0)}</span>
      <img
        src={heroImageUrl(name)}
        alt=""
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
    </span>
  );
}
