import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { LeagueMatchView, LeagueMembership } from "@fyendal/shared";
import { apiLeagueMatchAction, apiProposeLeagueTime, type LeagueMatchAction } from "../auth/auth.js";
import { useStore } from "../store.js";
import { startOptions } from "./availability.js";
import { leagueErrorMessage } from "./leagueText.js";
import { canClaimForfeit, inReadyWindow, waitsOnYou } from "./pendingActions.js";
import { LeagueAvatar } from "./LeagueAvatar.js";
import { LeagueRoomModal } from "./LeagueRoomModal.js";

/** The row's accent: whose move it is, or how it ended. */
type MatchTone = "waiting" | "live" | "scheduled" | "open" | "won" | "lost" | "draw";

const SHORT_TIME: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

function MatchItem({ league, match, now, onChanged }: {
  league: LeagueMembership;
  match: LeagueMatchView;
  now: number;
  onChanged: () => Promise<void>;
}) {
  const intl = useIntl();
  const { authToken, joinRoom } = useStore(useShallow((state) => ({
    authToken: state.authToken,
    joinRoom: state.joinRoom,
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [choosingDeck, setChoosingDeck] = useState(false);
  const [proposal, setProposal] = useState("");

  const opponent = match.opponent === null
    ? null
    : match.opponent.username ?? intl.formatMessage({ id: "league.roster.deleted" });
  const time = (at: number, timeZone = league.timeZone) => intl.formatDate(at, { ...SHORT_TIME, timeZone });
  const theirTime = (at: number) => match.opponent
    ? intl.formatMessage({ id: "league.match.theirTime" }, { time: time(at, match.opponent.timeZone), opponent })
    : "";
  const options = proposing ? startOptions(match.overlap, league.matchMinutes, now) : [];
  const open = match.status !== "complete";
  const schedulable = open && match.status !== "in-room" && match.opponent !== null;
  const checkInOpen = inReadyWindow(match, now);
  const canClaim = canClaimForfeit(match, now);

  const run = async (request: (token: string) => ReturnType<typeof apiProposeLeagueTime>) => {
    if (!authToken) return;
    setBusy(true);
    setError(null);
    const result = await request(authToken);
    setBusy(false);
    if (!result.ok) {
      setError(leagueErrorMessage(intl, result, "league.match.failed"));
      return;
    }
    setProposing(false);
    setProposal("");
    await onChanged();
  };
  const action = (kind: LeagueMatchAction) => run((token) => apiLeagueMatchAction(token, kind, match.id));

  const round = match.stage === "season"
    ? intl.formatMessage({ id: "league.match.week" }, { week: match.week })
    : intl.formatMessage({ id: `league.match.stage.${match.stage}` });
  let headline: string;
  let caption: string | null = null;
  let tone: MatchTone;
  if (match.status === "complete") {
    const forfeit = match.result === "forfeit";
    headline = match.result === "bye"
      ? intl.formatMessage({ id: "league.match.bye" })
      : match.result === "double-forfeit"
        ? intl.formatMessage({ id: "league.match.result.doubleForfeit" })
        : match.won === null
          ? intl.formatMessage({ id: "league.match.result.draw" })
          : intl.formatMessage({ id: `league.match.result.${match.won ? "won" : "lost"}${forfeit ? "Forfeit" : ""}` });
    tone = match.result === "bye" || match.won === true ? "won" : match.won === false || match.result === "double-forfeit" ? "lost" : "draw";
  } else if (match.status === "in-room") {
    headline = intl.formatMessage({ id: "league.match.status.inRoom" });
    tone = "live";
  } else if (match.scheduledAt === null) {
    headline = intl.formatMessage({ id: "league.match.status.unscheduled" });
    tone = "open";
  } else {
    headline = time(match.scheduledAt);
    caption = intl.formatMessage({
      id: match.status === "scheduled"
        ? "league.match.time.scheduled"
        : match.proposedBy === "you"
          ? "league.match.time.youProposed"
          : match.proposedBy === "opponent" ? "league.match.time.theyProposed" : "league.match.time.suggested",
    }, { opponent });
    tone = match.status === "scheduled" ? "scheduled" : "open";
  }
  if (waitsOnYou(match, now)) tone = "waiting";

  return (
    <li className={`league-match is-${tone}`}>
      <div className="league-match-who">
        <span className="league-match-round">{round}</span>
        {opponent === null ? null : (
          <span className="league-match-opponent">
            <LeagueAvatar username={match.opponent?.username ?? null} />
            <strong>{opponent}</strong>
          </span>
        )}
      </div>
      <div className="league-match-when">
        <strong className="league-match-headline">{headline}</strong>
        {caption ? <span>{caption}</span> : null}
        {open && match.scheduledAt !== null && match.opponent ? <span>{theirTime(match.scheduledAt)}</span> : null}
      </div>
      <div className="league-match-actions">
        {match.status === "in-room" && match.roomCode ? (
          <button type="button" className="btn-primary" onClick={() => joinRoom(match.roomCode!)}>
            {intl.formatMessage({ id: "league.match.join" })}
          </button>
        ) : null}
        {schedulable ? (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => setChoosingDeck(true)}>
            {intl.formatMessage({ id: "league.match.start" })}
          </button>
        ) : null}
        {schedulable && match.status === "proposed" && match.proposedBy !== "you" ? (
          <button type="button" className="league-button" disabled={busy} onClick={() => void action("accept")}>
            {intl.formatMessage({ id: "league.match.accept" })}
          </button>
        ) : null}
        {checkInOpen && !match.youReady ? (
          <button type="button" className="league-button" disabled={busy} onClick={() => void action("ready")}>
            {intl.formatMessage({ id: "league.match.ready" })}
          </button>
        ) : null}
        {canClaim ? (
          <button type="button" className="league-button" disabled={busy} onClick={() => void action("claim")}>
            {intl.formatMessage({ id: "league.match.claim" })}
          </button>
        ) : null}
        {schedulable ? (
          <button
            type="button"
            className={`league-button league-button-quiet${proposing ? " is-open" : ""}`}
            disabled={busy}
            aria-expanded={proposing}
            onClick={() => setProposing(!proposing)}
          >
            {intl.formatMessage({ id: "league.match.propose" })}
          </button>
        ) : null}
      </div>
      {open ? (
        <p className="league-match-foot">
          <span>{intl.formatMessage({ id: "league.match.deadline" }, { time: time(match.deadlineAt) })}</span>
          {match.status === "scheduled" && match.youReady ? <span className="is-ready">{intl.formatMessage({ id: "league.match.ready.you" })}</span> : null}
          {match.status === "scheduled" && match.opponentReady
            ? <span className="is-ready">{intl.formatMessage({ id: "league.match.ready.opponent" }, { opponent })}</span>
            : null}
        </p>
      ) : null}
      {proposing ? (
        <form
          className="league-propose"
          onSubmit={(event) => {
            event.preventDefault();
            const at = options.length ? Number(proposal) : new Date(proposal).getTime();
            if (Number.isFinite(at)) void run((token) => apiProposeLeagueTime(token, match.id, at));
          }}
        >
          <label htmlFor={`league-propose-${match.id}`}>{intl.formatMessage({ id: "league.match.propose.label" })}</label>
          {options.length ? (
            <select id={`league-propose-${match.id}`} value={proposal} onChange={(event) => setProposal(event.target.value)} required>
              <option value="" disabled>{intl.formatMessage({ id: "league.match.propose.choose" })}</option>
              {options.map((at) => (
                <option key={at} value={at}>{`${time(at)} (${theirTime(at)})`}</option>
              ))}
            </select>
          ) : (
            <>
              <p className="history-note">{intl.formatMessage({ id: "league.match.propose.noOverlap" })}</p>
              <input
                id={`league-propose-${match.id}`}
                type="datetime-local"
                value={proposal}
                onChange={(event) => setProposal(event.target.value)}
                required
              />
            </>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !proposal}>
            {intl.formatMessage({ id: "league.match.propose.submit" })}
          </button>
        </form>
      ) : null}
      {error ? <p role="alert" className="league-error league-match-error">{error}</p> : null}
      {choosingDeck && opponent !== null ? (
        <LeagueRoomModal matchId={match.id} format={league.format} opponent={opponent} onClose={() => setChoosingDeck(false)} />
      ) : null}
    </li>
  );
}

/** The member's matches for this week or playoff round, with scheduling. */
export function LeagueMatchList({ league, onChanged }: { league: LeagueMembership; onChanged: () => Promise<void> }) {
  const intl = useIntl();
  const now = Date.now();
  return league.matches.length === 0
    ? <div className="history-empty"><p>{intl.formatMessage({ id: "league.matches.empty" })}</p></div>
    : (
      <ul className="league-matches">
        {league.matches.map((match) => (
          <MatchItem key={match.id} league={league} match={match} now={now} onChanged={onChanged} />
        ))}
      </ul>
    );
}
