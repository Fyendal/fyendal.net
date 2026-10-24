import { useEffect, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { LeagueAvailabilityWindow, LeagueMembership } from "@fyendal/shared";
import { apiLeaveLeague, apiSetLeagueAvailability } from "../auth/auth.js";
import { useStore } from "../store.js";
import { AvailabilityGrid } from "./AvailabilityGrid.js";
import { sameWindows } from "./availability.js";
import { leagueErrorMessage, leagueStart, leagueSummary } from "./leagueText.js";
import { LeagueMatchList } from "./LeagueMatchList.js";
import { LeagueBracket } from "./LeagueBracket.js";
import { LeagueStandings } from "./LeagueStandings.js";
import { LeagueAvatar } from "./LeagueAvatar.js";
import { TimeZoneSelect } from "./TimeZoneSelect.js";
import { waitsOnYou } from "./pendingActions.js";
import "../styles/match-history.css";
import "../styles/league.css";

type LeagueTab = "matches" | "standings" | "playoffs" | "availability";

const WEEK_MS = 7 * 24 * 60 * 60_000;

function statusMessageId(league: LeagueMembership): string {
  if (league.status === "signup") return league.signupOpen ? "league.status.signupOpen" : "league.status.signupClosed";
  return `league.status.${league.status}`;
}

function availabilityEditable(league: LeagueMembership): boolean {
  return league.status === "signup" || league.status === "season";
}

function leagueTabs(league: LeagueMembership): LeagueTab[] {
  const tabs: LeagueTab[] = [];
  if (league.status !== "signup") tabs.push("matches");
  if (league.bracket.length) tabs.push("playoffs");
  tabs.push("standings");
  if (availabilityEditable(league)) tabs.push("availability");
  return tabs;
}

/** Sign-up opens on availability, the one thing a member can do before pairing. */
function defaultTab(league: LeagueMembership): LeagueTab {
  if (league.status === "signup") return "availability";
  if (league.status === "complete" && league.bracket.length) return "playoffs";
  return "matches";
}

function LeagueStats({ league }: { league: LeagueMembership }) {
  const intl = useIntl();
  const you = league.standings.find((row) => row.you);
  if (!you) return null;
  const week = league.status === "season" && league.startsAt !== null
    ? Math.min(league.seasonWeeks, Math.max(1, Math.floor((Date.now() - league.startsAt) / WEEK_MS) + 1))
    : null;
  const stats = [
    { label: "league.stat.rank", value: intl.formatMessage({ id: "league.stat.rankValue" }, { rank: you.rank, total: league.standings.length }) },
    { label: "league.standings.points", value: intl.formatNumber(you.points) },
    {
      label: "league.standings.record",
      value: intl.formatMessage({ id: "league.standings.recordValue" }, { wins: you.wins, losses: you.losses, draws: you.draws }),
    },
  ];
  if (week !== null) {
    stats.push({ label: "league.stat.week", value: intl.formatMessage({ id: "league.stat.weekValue" }, { week, weeks: league.seasonWeeks }) });
  } else if (league.status === "playoffs") {
    const round = (["final", "semifinal", "quarterfinal"] as const).find((stage) =>
      league.bracket.some((match) => match.stage === stage));
    if (round) stats.push({ label: "league.stat.round", value: intl.formatMessage({ id: `league.match.stage.${round}` }) });
  }
  return (
    <dl className="stat-strip league-stats">
      {stats.map((stat) => (
        <div className="stat" key={stat.label}>
          <dt>{intl.formatMessage({ id: stat.label })}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlayersView({ league, onLeft }: { league: LeagueMembership; onLeft: () => Promise<void> }) {
  const intl = useIntl();
  const authToken = useStore((state) => state.authToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    if (!authToken || !window.confirm(intl.formatMessage({ id: "league.leave.confirm" }, { name: league.name }))) return;
    setBusy(true);
    setError(null);
    const result = await apiLeaveLeague(authToken, league.id);
    setBusy(false);
    if (result.ok) await onLeft();
    else setError(leagueErrorMessage(intl, result, "league.leave.failed"));
  };

  return (
    <>
      <p className="history-note">
        {intl.formatMessage({ id: "league.join.seats" }, { members: league.roster.length, max: league.maxPlayers })}
      </p>
      <ol className="league-roster">
        {league.roster.map((member, index) => (
          <li key={member.username ?? `deleted-${index}`} className={member.you ? "you" : undefined}>
            <LeagueAvatar username={member.username} />
            <span>
              {member.username === null
                ? intl.formatMessage({ id: "league.roster.deleted" })
                : member.you
                  ? intl.formatMessage({ id: "league.roster.you" }, { username: member.username })
                  : member.username}
            </span>
          </li>
        ))}
      </ol>
      {league.status === "signup" ? (
        <div className="league-footer">
          <p className="history-note">{intl.formatMessage({ id: "league.signup.next" })}</p>
          <button type="button" className="league-button league-button-danger" disabled={busy} onClick={() => void leave()}>
            {intl.formatMessage({ id: "league.leave" })}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="league-error">{error}</p> : null}
    </>
  );
}

function AvailabilityView({ league, onSaved }: { league: LeagueMembership; onSaved: () => Promise<void> }) {
  const intl = useIntl();
  const authToken = useStore((state) => state.authToken);
  const [timeZone, setTimeZone] = useState(league.timeZone);
  const [availability, setAvailability] = useState<LeagueAvailabilityWindow[]>(league.availability);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const dirty = timeZone !== league.timeZone || !sameWindows(availability, league.availability);

  useEffect(() => {
    setTimeZone(league.timeZone);
    setAvailability(league.availability);
  }, [league.availability, league.timeZone]);

  const save = async () => {
    if (!authToken) return;
    setBusy(true);
    setNotice(null);
    const result = await apiSetLeagueAvailability(authToken, { leagueId: league.id, timeZone, availability });
    setBusy(false);
    if (result.ok) {
      setNotice({ text: intl.formatMessage({ id: "league.availability.saved" }), error: false });
      await onSaved();
    } else {
      setNotice({ text: leagueErrorMessage(intl, result, "league.availability.failed"), error: true });
    }
  };

  const headingId = `league-${league.id}-availability`;
  return (
    <form className="league-availability" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="league-availability-grid">
        <AvailabilityGrid value={availability} onChange={setAvailability} disabled={busy} labelledBy={headingId} />
      </div>
      <aside className="league-availability-side">
        <h3 id={headingId}>{intl.formatMessage({ id: "league.availability.title" })}</h3>
        <p className="history-note">{intl.formatMessage({ id: "league.availability.help" })}</p>
        <TimeZoneSelect id={`league-${league.id}-zone`} value={timeZone} onChange={setTimeZone} disabled={busy} />
        <button type="submit" className="btn-primary" disabled={busy || !dirty}>
          {intl.formatMessage({ id: busy ? "league.availability.saving" : "league.availability.save" })}
        </button>
        {notice ? <p role={notice.error ? "alert" : "status"} className={notice.error ? "league-error" : "league-saved"}>{notice.text}</p> : null}
      </aside>
    </form>
  );
}

function LeagueView({ league, picker }: { league: LeagueMembership; picker: ReactNode }) {
  const intl = useIntl();
  const refreshLeagues = useStore((state) => state.refreshLeagues);
  const tabs = leagueTabs(league);
  const [chosen, setChosen] = useState<LeagueTab>(() => defaultTab(league));
  const tab = tabs.includes(chosen) ? chosen : tabs[0]!;
  const now = Date.now();
  const waiting = league.matches.filter((match) => waitsOnYou(match, now)).length;
  const panelId = `league-${league.id}-panel`;
  const tabLabel = (option: LeagueTab) => intl.formatMessage({
    id: option === "standings" && league.status === "signup" ? "league.tab.players" : `league.tab.${option}`,
  });

  return (
    <>
      <header className="league-header">
        <div className="league-heading">
          <h2 className="panel-title">{league.name}</h2>
          <span className={`league-status is-${league.status}`}>{intl.formatMessage({ id: statusMessageId(league) })}</span>
        </div>
        {picker}
      </header>
      <p className="league-meta">{leagueSummary(intl, league)}</p>
      {league.status === "signup" && league.startsAt !== null ? <p className="league-meta">{leagueStart(intl, league.startsAt)}</p> : null}
      <LeagueStats league={league} />

      <div className="lobby-panel-tabs league-tabs" role="tablist" aria-label={league.name}>
        {tabs.map((option) => (
          <button
            key={option}
            id={`league-${league.id}-tab-${option}`}
            type="button"
            role="tab"
            aria-selected={tab === option}
            aria-controls={panelId}
            className={tab === option ? "selected" : ""}
            onClick={() => setChosen(option)}
          >
            {tabLabel(option)}
            {option === "matches" && waiting > 0 ? <span>{waiting}</span> : null}
          </button>
        ))}
      </div>

      <div id={panelId} role="tabpanel" aria-labelledby={`league-${league.id}-tab-${tab}`} className="league-tab-panel">
        {tab === "matches" ? <LeagueMatchList league={league} onChanged={refreshLeagues} /> : null}
        {tab === "playoffs" ? <LeagueBracket matches={league.bracket} /> : null}
        {tab === "standings" ? (
          league.standings.length
            ? <LeagueStandings rows={league.standings} label={tabLabel("standings")} />
            : <PlayersView league={league} onLeft={refreshLeagues} />
        ) : null}
        {tab === "availability" ? <AvailabilityView league={league} onSaved={refreshLeagues} /> : null}
      </div>
    </>
  );
}

/** Opponents' proposals, ready marks, and rooms arrive by polling. */
const REFRESH_MS = 30_000;

/** Running leagues first, so the default is the one with matches to play. */
function preferredLeague(leagues: readonly LeagueMembership[]): LeagueMembership | undefined {
  return leagues.find((league) => league.status === "season" || league.status === "playoffs")
    ?? leagues.find((league) => league.status === "signup")
    ?? leagues[0];
}

export function LeaguePanel() {
  const intl = useIntl();
  const { leagues, refreshLeagues } = useStore(useShallow((state) => ({
    leagues: state.leagues,
    refreshLeagues: state.refreshLeagues,
  })));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const running = leagues?.some((league) => league.status === "season" || league.status === "playoffs") ?? false;
  const league = leagues?.find((entry) => entry.id === selectedId) ?? (leagues ? preferredLeague(leagues) : undefined);

  useEffect(() => {
    void refreshLeagues();
  }, [refreshLeagues]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshLeagues();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshLeagues, running]);

  const picker = leagues && leagues.length > 1 && league ? (
    <label className="league-picker">
      <span>{intl.formatMessage({ id: "league.picker.label" })}</span>
      <select value={league.id} onChange={(event) => setSelectedId(event.target.value)}>
        {leagues.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select>
    </label>
  ) : null;

  return (
    <div className="panel league-panel">
      {league ? <LeagueView key={league.id} league={league} picker={picker} /> : (
        <>
          <h2 className="panel-title">{intl.formatMessage({ id: "league.title" })}</h2>
          {leagues === null
            ? <p role="status" className="muted">{intl.formatMessage({ id: "common.loading" })}</p>
            : <div className="history-empty"><p>{intl.formatMessage({ id: "league.empty" })}</p></div>}
        </>
      )}
    </div>
  );
}
