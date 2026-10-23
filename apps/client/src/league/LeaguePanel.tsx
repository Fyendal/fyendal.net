import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { LeagueAvailabilityWindow, LeagueMembership } from "@fyendal/shared";
import { apiLeaveLeague, apiSetLeagueAvailability } from "../auth/auth.js";
import { useStore } from "../store.js";
import { AvailabilityGrid } from "./AvailabilityGrid.js";
import { sameWindows } from "./availability.js";
import { leagueErrorMessage, leagueStart, leagueSummary } from "./leagueText.js";
import { LeagueMatchList } from "./LeagueMatchList.js";
import { TimeZoneSelect } from "./TimeZoneSelect.js";
import "../styles/league.css";

function statusMessageId(league: LeagueMembership): string {
  if (league.status === "signup") return league.signupOpen ? "league.status.signupOpen" : "league.status.signupClosed";
  return `league.status.${league.status}`;
}

function LeagueCard({ league }: { league: LeagueMembership }) {
  const intl = useIntl();
  const { authToken, refreshLeagues } = useStore(useShallow((state) => ({
    authToken: state.authToken,
    refreshLeagues: state.refreshLeagues,
  })));
  const [timeZone, setTimeZone] = useState(league.timeZone);
  const [availability, setAvailability] = useState<LeagueAvailabilityWindow[]>(league.availability);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const editable = league.status === "signup" || league.status === "season";
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
      await refreshLeagues();
    } else {
      setNotice({ text: leagueErrorMessage(intl, result, "league.availability.failed"), error: true });
    }
  };

  const leave = async () => {
    if (!authToken || !window.confirm(intl.formatMessage({ id: "league.leave.confirm" }, { name: league.name }))) return;
    setBusy(true);
    setNotice(null);
    const result = await apiLeaveLeague(authToken, league.id);
    setBusy(false);
    if (result.ok) await refreshLeagues();
    else setNotice({ text: leagueErrorMessage(intl, result, "league.leave.failed"), error: true });
  };

  const titleId = `league-${league.id}-title`;
  const availabilityId = `league-${league.id}-availability`;
  return (
    <section className="league-card" aria-labelledby={titleId}>
      <header className="league-card-header">
        <div>
          <h3 id={titleId}>{league.name}</h3>
          <p className="league-meta">{leagueSummary(intl, league)}</p>
        </div>
        <span className="league-status">{intl.formatMessage({ id: statusMessageId(league) })}</span>
      </header>
      {league.startsAt !== null ? <p className="league-meta">{leagueStart(intl, league.startsAt)}</p> : null}
      {league.status === "signup" ? <p className="muted">{intl.formatMessage({ id: "league.signup.next" })}</p> : null}
      {league.status === "season" || league.status === "playoffs"
        ? <LeagueMatchList league={league} onChanged={refreshLeagues} />
        : null}

      <h4 className="league-section-title">
        {intl.formatMessage({ id: "league.roster.title" }, { count: league.roster.length, max: league.maxPlayers })}
      </h4>
      <ul className="league-roster">
        {league.roster.map((member, index) => (
          <li key={member.username ?? `deleted-${index}`} className={member.you ? "you" : undefined}>
            {member.username === null
              ? intl.formatMessage({ id: "league.roster.deleted" })
              : member.you
                ? intl.formatMessage({ id: "league.roster.you" }, { username: member.username })
                : member.username}
          </li>
        ))}
      </ul>

      {editable ? (
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h4 className="league-section-title" id={availabilityId}>{intl.formatMessage({ id: "league.availability.title" })}</h4>
          <p className="muted">{intl.formatMessage({ id: "league.availability.help" })}</p>
          <TimeZoneSelect id={`league-${league.id}-zone`} value={timeZone} onChange={setTimeZone} disabled={busy} />
          <AvailabilityGrid value={availability} onChange={setAvailability} disabled={busy} labelledBy={availabilityId} />
          <div className="league-actions">
            <button type="submit" className="btn-primary" disabled={busy || !dirty}>
              {intl.formatMessage({ id: busy ? "league.availability.saving" : "league.availability.save" })}
            </button>
            {league.status === "signup" ? (
              <button type="button" className="btn-danger" disabled={busy} onClick={() => void leave()}>
                {intl.formatMessage({ id: "league.leave" })}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      {notice ? <p role={notice.error ? "alert" : "status"} className={notice.error ? "league-error" : "league-saved"}>{notice.text}</p> : null}
    </section>
  );
}

/** Opponents' proposals, ready marks, and rooms arrive by polling. */
const REFRESH_MS = 30_000;

export function LeaguePanel() {
  const intl = useIntl();
  const { leagues, refreshLeagues } = useStore(useShallow((state) => ({
    leagues: state.leagues,
    refreshLeagues: state.refreshLeagues,
  })));
  const running = leagues?.some((league) => league.status === "season" || league.status === "playoffs") ?? false;

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

  return (
    <div className="panel league-panel">
      <h2 className="panel-title">{intl.formatMessage({ id: "league.title" })}</h2>
      {leagues === null ? <p role="status" className="muted">{intl.formatMessage({ id: "common.loading" })}</p> : null}
      {leagues?.length === 0 ? <p className="muted">{intl.formatMessage({ id: "league.empty" })}</p> : null}
      {leagues?.map((league) => <LeagueCard key={league.id} league={league} />)}
    </div>
  );
}
