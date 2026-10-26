import { useIntl } from "react-intl";
import type { LeagueStandingView } from "@fyendal/shared";
import { LeagueAvatar } from "./LeagueAvatar.js";

/** The season table; ties are already broken server-side, so rank is final. */
export function LeagueStandings({ rows, label }: { rows: readonly LeagueStandingView[]; label: string }) {
  const intl = useIntl();
  const showByes = rows.some((row) => row.byes > 0);
  const showSeeds = rows.some((row) => row.playoffSeed !== null);
  return (
    <div className="league-table-wrap">
      <table className="league-standings" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{intl.formatMessage({ id: "league.standings.rank" })}</th>
            <th scope="col">{intl.formatMessage({ id: "league.standings.player" })}</th>
            <th scope="col">{intl.formatMessage({ id: "league.standings.points" })}</th>
            <th scope="col">{intl.formatMessage({ id: "league.standings.record" })}</th>
            {showByes ? <th scope="col">{intl.formatMessage({ id: "league.standings.byes" })}</th> : null}
            <th scope="col">{intl.formatMessage({ id: "league.standings.omw" })}</th>
            {showSeeds ? <th scope="col">{intl.formatMessage({ id: "league.standings.seed" })}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.rank}-${row.username ?? "deleted"}`} className={`${row.you ? "you" : ""}${row.dropped ? " dropped" : ""}`}>
              <td className="league-rank">{row.rank}</td>
              <th scope="row">
                <LeagueAvatar username={row.username} />
                {row.username ?? intl.formatMessage({ id: "league.roster.deleted" })}
                {row.dropped ? <span className="league-dropped"> {intl.formatMessage({ id: "league.standings.dropped" })}</span> : null}
              </th>
              <td className="league-points">{row.points}</td>
              <td>{intl.formatMessage({ id: "league.standings.recordValue" }, { wins: row.wins, losses: row.losses, draws: row.draws })}</td>
              {showByes ? <td>{row.byes}</td> : null}
              <td>{intl.formatNumber(row.opponentMatchWinRate, { style: "percent", maximumFractionDigits: 0 })}</td>
              {showSeeds ? <td>{row.playoffSeed ?? "—"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
