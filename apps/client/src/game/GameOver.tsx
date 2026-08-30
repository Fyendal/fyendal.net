import { useMemo, useState } from "react";
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
    ? `${winnerName} wins!`
    : winner === seat
      ? "Victory!"
      : "Defeat";
  const names: [string, string] = [
    view.players[0]?.heroName ?? "Player 1",
    view.players[1]?.heroName ?? "Player 2",
  ];
  const totalValue = stats.total.threatened[selectedSeat] + stats.total.blocked[selectedSeat];
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const opponent = selectedSeat === 0 ? 1 : 0;

  return (
    <div className="overlay">
      <div className="overlay-panel gameover-panel">
        <div className="gameover-headline">{headline}</div>
        {!spectating && <div className="gameover-sub">{winnerName} wins the game</div>}

        <div className="rail-actions gameover-actions">
          {onDownloadReplay ? <button onClick={onDownloadReplay}>Export replay</button> : null}
          {onWatchReplay ? <button onClick={onWatchReplay}>▶ Watch replay</button> : null}
          <button onClick={onClose}>Back to board</button>
          <button className="btn-primary" onClick={onBackToLobby}>Back to lobby</button>
        </div>
        {!spectating ? (
          <p className="gameover-replay-retention">
            This replay will be available in My Replays for 7 days. Export it to keep it longer.
          </p>
        ) : null}

        <div className="gameover-body">
          <div className="gameover-player-picker">
            <span className="gameover-player-picker-label" id="gameover-player-picker-label">
              View statistics for
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
                  {winner === playerSeat ? <span className="gameover-winner-tag">Winner</span> : null}
                </button>
              ))}
            </div>
          </div>

          <section
            className="gameover-selected-stats"
            aria-labelledby="gameover-selected-player"
          >
            <header className="gameover-selected-heading">
              <span>Showing stats for</span>
              <strong id="gameover-selected-player">{names[selectedSeat]}</strong>
              {winner === selectedSeat ? <span className="gameover-winner-tag">Winner</span> : null}
            </header>

            <div className="gameover-key-stats">
              <div className="gameover-key-stat">
                <strong>{stats.total.threatened[selectedSeat]}</strong>
                <span>Damage threatened</span>
              </div>
              <div className="gameover-key-stat">
                <strong>{stats.total.damageDealt[selectedSeat]}</strong>
                <span>Damage dealt</span>
              </div>
              <div className="gameover-key-stat">
                <strong>{stats.total.blocked[selectedSeat]}</strong>
                <span>Damage blocked</span>
              </div>
              <div className="gameover-key-stat gameover-value-stat">
                <strong>{totalPrevented(stats, selectedSeat)}</strong>
                <span>Damage prevented</span>
              </div>
            </div>

            <div className="gameover-summary-grid">
              <section className="gameover-summary-card">
                <h3>Averages</h3>
                <dl>
                  <div><dt>Value per round</dt><dd>{fmt(averageValue(stats, selectedSeat))}</dd></div>
                  <div><dt>Threat per round</dt><dd>{fmt(averagePerRound(stats, selectedSeat, "threatened"))}</dd></div>
                  <div><dt>Damage per round</dt><dd>{fmt(averagePerRound(stats, selectedSeat, "damageDealt"))}</dd></div>
                  <div><dt>Threat per attack</dt><dd>{fmt(averageThreatPerAttack(stats, selectedSeat))}</dd></div>
                </dl>
              </section>
              <section className="gameover-summary-card">
                <h3>Match</h3>
                <dl>
                  <div><dt>Rounds played</dt><dd>{stats.cyclesPlayed[selectedSeat]}</dd></div>
                  <div><dt>Attacks</dt><dd>{stats.total.attacks[selectedSeat]}</dd></div>
                  <div><dt>Final life</dt><dd>{view.players[selectedSeat]?.life ?? 0}</dd></div>
                  <div><dt>Opponent final life</dt><dd>{view.players[opponent]?.life ?? 0}</dd></div>
                </dl>
              </section>
            </div>

            <section className="gameover-breakdown">
              <h3>Round-by-round breakdown</h3>
              <div className="gameover-table-wrap">
                <table className="gameover-table">
                  <thead>
                    <tr>
                      <th>Round</th>
                      <th>Attacks</th>
                      <th>Threatened</th>
                      <th>Dealt</th>
                      <th>Blocked</th>
                      <th>Prevented</th>
                      <th>Value</th>
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
                      <td>Total</td>
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
