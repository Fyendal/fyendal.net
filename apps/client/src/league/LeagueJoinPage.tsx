import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import type { LeagueAvailabilityWindow, LeagueJoinPreview } from "@fyendal/shared";
import { apiJoinLeague, apiLeaguePreview } from "../auth/auth.js";
import { Auth } from "../auth/AuthCard.js";
import { LobbyHeader } from "../lobby/LobbyHeader.js";
import { useStore } from "../store.js";
import { AvailabilityGrid } from "./AvailabilityGrid.js";
import { browserTimeZone } from "./availability.js";
import { leagueErrorMessage, leagueStart, leagueSummary } from "./leagueText.js";
import { TimeZoneSelect } from "./TimeZoneSelect.js";
import "../styles/league.css";

type Preview =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; league: LeagueJoinPreview };

/** `/league/join/<token>`: previews the league for anyone with the link and
 * lets a signed-in player join with their time zone and availability. */
export function LeagueJoinPage({ token, onLeave }: { token: string; onLeave: () => void }) {
  const intl = useIntl();
  const authToken = useStore((state) => state.authToken);
  const refreshLeagues = useStore((state) => state.refreshLeagues);
  const setLobbyRail = useStore((state) => state.setLobbyRail);
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [availability, setAvailability] = useState<LeagueAvailabilityWindow[]>([]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setPreview({ kind: "loading" });
    void apiLeaguePreview(token, authToken, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setPreview(result.ok
        ? { kind: "ready", league: result.league }
        : { kind: "error", message: leagueErrorMessage(intl, result, "league.join.loadFailed") });
    });
    return () => controller.abort();
  }, [authToken, intl, token]);

  const openLeague = async () => {
    await refreshLeagues();
    setLobbyRail("league");
    onLeave();
  };

  const join = async () => {
    if (!authToken) return;
    setJoining(true);
    setError(null);
    const result = await apiJoinLeague(authToken, { token, timeZone, availability });
    if (result.ok) {
      await openLeague();
      return;
    }
    setJoining(false);
    setError(leagueErrorMessage(intl, result, "league.join.failed"));
  };

  const league = preview.kind === "ready" ? preview.league : null;

  return (
    <div className="lobby-page">
      <LobbyHeader />
      <main id="main-content" className="league-join">
        <section className="panel league-join-panel" aria-labelledby="league-join-title">
          {preview.kind === "loading" ? <p role="status" className="muted">{intl.formatMessage({ id: "common.loading" })}</p> : null}
          {preview.kind === "error" ? (
            <>
              <h1 className="panel-title" id="league-join-title">{intl.formatMessage({ id: "league.join.unavailableTitle" })}</h1>
              <p role="alert">{preview.message}</p>
            </>
          ) : null}
          {league ? (
            <>
              <h1 className="panel-title" id="league-join-title">{intl.formatMessage({ id: "league.join.title" }, { name: league.name })}</h1>
              <p className="league-meta">{leagueSummary(intl, league)}</p>
              <p className="league-meta">
                {intl.formatMessage({ id: "league.join.seats" }, { members: league.members, max: league.maxPlayers })}
                {league.startsAt !== null ? <> · {leagueStart(intl, league.startsAt)}</> : null}
              </p>
              {!authToken ? (
                <>
                  <p>{intl.formatMessage({ id: "league.join.signIn" })}</p>
                  <div className="league-join-auth"><Auth initialMode="register" /></div>
                </>
              ) : league.joined ? (
                <>
                  <p role="status">{intl.formatMessage({ id: "league.join.alreadyJoined" })}</p>
                  <div className="deck-actions">
                    <button type="button" className="btn-primary" onClick={() => void openLeague()}>
                      {intl.formatMessage({ id: "league.join.open" })}
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={(event) => { event.preventDefault(); void join(); }}>
                  <TimeZoneSelect id="league-join-zone" value={timeZone} onChange={setTimeZone} disabled={joining} />
                  <h2 className="league-section-title" id="league-join-availability">
                    {intl.formatMessage({ id: "league.availability.title" })}
                  </h2>
                  <p className="muted">{intl.formatMessage({ id: "league.join.availabilityHelp" })}</p>
                  <AvailabilityGrid
                    value={availability}
                    onChange={setAvailability}
                    disabled={joining}
                    labelledBy="league-join-availability"
                  />
                  {error ? <p role="alert" className="league-error">{error}</p> : null}
                  <div className="deck-actions">
                    <button type="submit" className="btn-primary" disabled={joining}>
                      {intl.formatMessage({ id: joining ? "league.join.joining" : "league.join.submit" })}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : null}
          <div className="deck-actions">
            <button type="button" onClick={onLeave}>{intl.formatMessage({ id: "league.join.goHome" })}</button>
          </div>
        </section>
      </main>
    </div>
  );
}
