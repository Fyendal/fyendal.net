import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import type { GameView } from "@fyendal/shared";
import {
  averagePerRound,
  averageThreatPerAttack,
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
}: {
  view: GameView;
  seat: number;
  spectating: boolean;
  recordedViews: GameView[];
  onWatchReplay: (() => void) | null;
  onDownloadReplay: (() => void) | null;
  onBackToLobby: () => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const winner = view.winner;
  const initialSeat = (spectating ? winner ?? 0 : seat) === 1 ? 1 : 0;
  const [selectedSeat, setSelectedSeat] = useState<0 | 1>(initialSeat);
  const stats = useMemo(
    () => computeCycleStats(recordedViews.length > 0 ? recordedViews : [view]),
    [recordedViews, view],
  );
  if (winner === null) return null;

  const winnerName = view.players[winner]?.heroName ?? "";
  const headline = spectating
    ? intl.formatMessage({ id: "game.result.namedWinner" }, { winner: winnerName })
    : winner === seat
      ? intl.formatMessage({ id: "game.result.victory" })
      : intl.formatMessage({ id: "game.result.defeat" });
  const names: [string, string] = [
    view.players[0]?.heroName ?? intl.formatMessage({ id: "game.playerNumber" }, { number: 1 }),
    view.players[1]?.heroName ?? intl.formatMessage({ id: "game.playerNumber" }, { number: 2 }),
  ];
  const totalValue = stats.total.threatened[selectedSeat] + stats.total.blocked[selectedSeat];
  const fmt = (n: number) => intl.formatNumber(n, { maximumFractionDigits: 1 });
  const opponent = selectedSeat === 0 ? 1 : 0;

  return (
    <div className="overlay">
      <div className="overlay-panel gameover-panel">
        <div className="gameover-headline">{headline}</div>
        {!spectating ? (
          <div className="gameover-sub">
            {intl.formatMessage({ id: "game.over.winsGame" }, { winner: winnerName })}
          </div>
        ) : null}

        <div className="rail-actions gameover-actions">
          {onDownloadReplay ? (
            <button onClick={onDownloadReplay}>{intl.formatMessage({ id: "replay.controls.export" })}</button>
          ) : null}
          {onWatchReplay ? (
            <button onClick={onWatchReplay}>▶ {intl.formatMessage({ id: "game.over.watchReplay" })}</button>
          ) : null}
          <button onClick={onClose}>{intl.formatMessage({ id: "game.over.backToBoard" })}</button>
          <button className="btn-primary" onClick={onBackToLobby}>
            {intl.formatMessage({ id: "game.over.backToLobby" })}
          </button>
        </div>
        {!spectating ? (
          <p className="gameover-replay-retention">
            {intl.formatMessage({ id: "game.over.retention" })}
          </p>
        ) : null}

        <div className="gameover-body">
          <div className="gameover-player-picker">
            <span className="gameover-player-picker-label" id="gameover-player-picker-label">
              {intl.formatMessage({ id: "game.over.viewStatsFor" })}
            </span>
            <div
              className="gameover-player-tabs"
              role="group"
              aria-labelledby="gameover-player-picker-label"
            >
              {([0, 1] as const).map((playerSeat) => (
                <button
                  key={playerSeat}
                  type="button"
                  aria-pressed={selectedSeat === playerSeat}
                  className={selectedSeat === playerSeat ? "active" : ""}
                  onClick={() => setSelectedSeat(playerSeat)}
                >
                  {names[playerSeat]}
                  {winner === playerSeat ? (
                    <span className="gameover-winner-tag">{intl.formatMessage({ id: "game.over.winner" })}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <section
            className="gameover-selected-stats"
            aria-labelledby="gameover-selected-player"
          >
            <header className="gameover-selected-heading">
              <span>{intl.formatMessage({ id: "game.over.showingStatsFor" })}</span>
              <strong id="gameover-selected-player">{names[selectedSeat]}</strong>
              {winner === selectedSeat ? (
                <span className="gameover-winner-tag">{intl.formatMessage({ id: "game.over.winner" })}</span>
              ) : null}
            </header>

            <div className="gameover-key-stats">
              <div className="gameover-key-stat">
                <strong>{stats.total.threatened[selectedSeat]}</strong>
                <span>{intl.formatMessage({ id: "game.stats.damageThreatened" })}</span>
              </div>
              <div className="gameover-key-stat">
                <strong>{stats.total.damageDealt[selectedSeat]}</strong>
                <span>{intl.formatMessage({ id: "game.stats.damageDealt" })}</span>
              </div>
              <div className="gameover-key-stat">
                <strong>{stats.total.blocked[selectedSeat]}</strong>
                <span>{intl.formatMessage({ id: "game.stats.damageBlocked" })}</span>
              </div>
              <div className="gameover-key-stat gameover-value-stat">
                <strong>{totalPrevented(stats, selectedSeat)}</strong>
                <span>{intl.formatMessage({ id: "game.stats.damagePrevented" })}</span>
              </div>
            </div>

            <div className="gameover-summary-grid">
              <section className="gameover-summary-card">
                <h3>{intl.formatMessage({ id: "game.stats.averages" })}</h3>
                <dl>
                  <div><dt>{intl.formatMessage({ id: "game.stats.valuePerRound" })}</dt><dd>{fmt(averageValue(stats, selectedSeat))}</dd></div>
                  <div><dt>{intl.formatMessage({ id: "game.stats.threatPerRound" })}</dt><dd>{fmt(averagePerRound(stats, selectedSeat, "threatened"))}</dd></div>
                  <div><dt>{intl.formatMessage({ id: "game.stats.damagePerRound" })}</dt><dd>{fmt(averagePerRound(stats, selectedSeat, "damageDealt"))}</dd></div>
                  <div><dt>{intl.formatMessage({ id: "game.stats.threatPerAttack" })}</dt><dd>{fmt(averageThreatPerAttack(stats, selectedSeat))}</dd></div>
                </dl>
              </section>
              <section className="gameover-summary-card">
                <h3>{intl.formatMessage({ id: "game.stats.match" })}</h3>
                <dl>
                  <div><dt>{intl.formatMessage({ id: "game.stats.roundsPlayed" })}</dt><dd>{stats.cyclesPlayed[selectedSeat]}</dd></div>
                  <div><dt>{intl.formatMessage({ id: "game.stats.attacks" })}</dt><dd>{stats.total.attacks[selectedSeat]}</dd></div>
                  <div><dt>{intl.formatMessage({ id: "game.stats.finalLife" })}</dt><dd>{view.players[selectedSeat]?.life ?? 0}</dd></div>
                  <div><dt>{intl.formatMessage({ id: "game.stats.opponentFinalLife" })}</dt><dd>{view.players[opponent]?.life ?? 0}</dd></div>
                </dl>
              </section>
            </div>

            <section className="gameover-breakdown">
              <h3>{intl.formatMessage({ id: "game.stats.breakdown" })}</h3>
              <div className="gameover-table-wrap">
                <table className="gameover-table">
                  <thead>
                    <tr>
                      <th>{intl.formatMessage({ id: "game.stats.round" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.attacks" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.threatened" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.dealt" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.blocked" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.prevented" })}</th>
                      <th>{intl.formatMessage({ id: "game.stats.value" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.rows.map((row) => (
                      <tr key={row.cycle}>
                        <td>{row.cycle}</td>
                        <td>{row.attacks[selectedSeat]}</td>
                        <td>{row.threatened[selectedSeat]}</td>
                        <td>{row.damageDealt[selectedSeat]}</td>
                        <td>{row.blocked[selectedSeat]}</td>
                        <td>{preventedDamage(row, selectedSeat)}</td>
                        <td>{cycleValue(row, selectedSeat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{intl.formatMessage({ id: "game.stats.total" })}</td>
                      <td>{stats.total.attacks[selectedSeat]}</td>
                      <td>{stats.total.threatened[selectedSeat]}</td>
                      <td>{stats.total.damageDealt[selectedSeat]}</td>
                      <td>{stats.total.blocked[selectedSeat]}</td>
                      <td>{totalPrevented(stats, selectedSeat)}</td>
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
