import { useIntl, type IntlShape } from "react-intl";
import { HoverHint } from "./HoverHint.js";
import type { RecentForm, RecordTotals } from "./summarizeRecords.js";
import { winRate } from "./summarizeRecords.js";

/** "67%", or a dash before any decided game. */
export function formatWinRate(intl: IntlShape, totals: { wins: number; losses: number }): string {
  const share = winRate(totals);
  return share === null ? "—" : intl.formatNumber(share, { style: "percent", maximumFractionDigits: 0 });
}

export interface StatFigure {
  value: string;
  /** Hover text saying which games the figure covers. */
  title: string;
  tone?: "win" | "loss" | "all" | "bots";
}

export interface Stat {
  id: string;
  primary: StatFigure;
  trailing?: StatFigure[];
}

export function StatStrip({ stats }: { stats: readonly Stat[] }) {
  const intl = useIntl();
  return (
    <dl className="stat-strip">
      {stats.map((stat) => (
        <div className="stat" key={stat.id}>
          <dd>
            <HoverHint
              hint={stat.primary.title}
              className={`stat-primary${stat.primary.tone ? ` is-${stat.primary.tone}` : ""}`}
            >
              {stat.primary.value}
            </HoverHint>
            {stat.trailing?.length ? (
              <span className="stat-trailing">
                {stat.trailing.map((figure) => (
                  <HoverHint key={figure.title} hint={figure.title} className={figure.tone ? `is-${figure.tone}` : undefined}>
                    {figure.value}
                  </HoverHint>
                ))}
              </span>
            ) : null}
          </dd>
          <dt>{intl.formatMessage({ id: stat.id })}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Games, record and streak cover every completed game. Win rate leads with
 * the rate against players, the number that matters for ranking yourself,
 * and trails the rates against everyone and against bots. */
export function useRecordStats(
  totals: RecordTotals & { players: RecordTotals; bots: RecordTotals },
  recent: RecentForm | null,
): Stat[] {
  const intl = useIntl();
  const rateFigure = (value: { wins: number; losses: number }, id: string, tone?: StatFigure["tone"]): StatFigure => {
    const formatted = formatWinRate(intl, value);
    return { value: formatted, title: intl.formatMessage({ id }, { rate: formatted }), ...(tone ? { tone } : {}) };
  };
  const score = intl.formatMessage({ id: "history.record.score" }, { wins: totals.wins, losses: totals.losses });
  const gamesTitle = intl.formatMessage({ id: "history.stat.allGames" });
  const stats: Stat[] = [
    { id: "history.stat.games", primary: { value: intl.formatNumber(totals.games), title: gamesTitle } },
    {
      id: "history.stat.winRate",
      primary: rateFigure(totals.players, "history.stat.winRatePlayers"),
      trailing: [
        rateFigure(totals, "history.stat.winRateAll", "all"),
        rateFigure(totals.bots, "history.stat.winRateBots", "bots"),
      ],
    },
    { id: "history.stat.record", primary: { value: score, title: gamesTitle } },
  ];
  if (recent) {
    const streak = recent.streak;
    stats.push(streak
      ? {
          id: streak.kind === "win" ? "history.stat.winStreak" : "history.stat.lossStreak",
          primary: {
            value: `${intl.formatNumber(streak.length)}${streak.capped ? "+" : ""}`,
            title: gamesTitle,
            tone: streak.kind,
          },
        }
      : { id: "history.stat.streak", primary: { value: "—", title: gamesTitle } });
  }
  return stats;
}
