import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { LeagueMatchView, LeagueMembership } from "@fyendal/shared";
import { apiLeagueMatchAction, apiProposeLeagueTime, type LeagueMatchAction } from "../auth/auth.js";
import { useStore } from "../store.js";
import { startOptions } from "./availability.js";
import { leagueErrorMessage } from "./leagueText.js";
import { canClaimForfeit, inReadyWindow } from "./pendingActions.js";
import { LeagueRoomModal } from "./LeagueRoomModal.js";

const SHORT_TIME: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

function MatchItem({ league, match, now, onChanged }: {
  league: LeagueMembership;
  match: LeagueMatchView;
  now: number;
  onChanged: () => Promise<void>;
}) {
  const intl = useIntl();
  const { authToken, inspectRoom } = useStore(useShallow((state) => ({
    authToken: state.authToken,
    inspectRoom: state.inspectRoom,
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
  let status: string;
  if (match.status === "complete") {
    const forfeit = match.result === "forfeit";
    status = match.result === "bye"
      ? intl.formatMessage({ id: "league.match.bye" })
      : match.result === "double-forfeit"
        ? intl.formatMessage({ id: "league.match.result.doubleForfeit" })
        : match.won === null
          ? intl.formatMessage({ id: "league.match.result.draw" })
          : intl.formatMessage({ id: `league.match.result.${match.won ? "won" : "lost"}${forfeit ? "Forfeit" : ""}` });
  } else if (match.status === "in-room") {
    status = intl.formatMessage({ id: "league.match.status.inRoom" });
  } else if (match.scheduledAt === null) {
    status = intl.formatMessage({ id: "league.match.status.unscheduled" });
  } else {
    const id = match.status === "scheduled"
      ? "league.match.status.scheduled"
      : match.proposedBy === "you"
        ? "league.match.status.youProposed"
        : match.proposedBy === "opponent" ? "league.match.status.theyProposed" : "league.match.status.suggested";
    status = intl.formatMessage({ id }, { time: time(match.scheduledAt), opponent });
  }

  return (
    <li className="league-match">
      <div className="league-match-heading">
        <strong>{round}</strong>
        <span>{opponent === null ? null : intl.formatMessage({ id: "league.match.versus" }, { opponent })}</span>
      </div>
      <p className="league-match-status">{status}</p>
      {open && match.scheduledAt !== null && match.opponent ? <p className="league-meta">{theirTime(match.scheduledAt)}</p> : null}
      {match.status === "scheduled" && (match.youReady || match.opponentReady) ? (
        <p className="league-meta">
          {[match.youReady ? intl.formatMessage({ id: "league.match.ready.you" }) : null,
            match.opponentReady ? intl.formatMessage({ id: "league.match.ready.opponent" }, { opponent }) : null]
            .filter(Boolean).join(" ")}
        </p>
      ) : null}
      {open ? <p className="league-meta">{intl.formatMessage({ id: "league.match.deadline" }, { time: time(match.deadlineAt) })}</p> : null}
      <div className="league-actions">
        {match.status === "in-room" && match.roomCode ? (
          <button type="button" className="btn-primary" onClick={() => inspectRoom(match.roomCode!)}>
            {intl.formatMessage({ id: "league.match.join" })}
          </button>
        ) : null}
        {schedulable ? (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => setChoosingDeck(true)}>
            {intl.formatMessage({ id: "league.match.start" })}
          </button>
        ) : null}
        {schedulable && match.status === "proposed" && match.proposedBy !== "you" ? (
          <button type="button" disabled={busy} onClick={() => void action("accept")}>
            {intl.formatMessage({ id: "league.match.accept" })}
          </button>
        ) : null}
        {checkInOpen && !match.youReady ? (
          <button type="button" disabled={busy} onClick={() => void action("ready")}>
            {intl.formatMessage({ id: "league.match.ready" })}
          </button>
        ) : null}
        {canClaim ? (
          <button type="button" disabled={busy} onClick={() => void action("claim")}>
            {intl.formatMessage({ id: "league.match.claim" })}
          </button>
        ) : null}
        {schedulable ? (
          <button type="button" className="history-link" disabled={busy} aria-expanded={proposing} onClick={() => setProposing(!proposing)}>
            {intl.formatMessage({ id: "league.match.propose" })}
          </button>
        ) : null}
      </div>
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
                <option key={at} value={at}>{`${time(at)} · ${theirTime(at)}`}</option>
              ))}
            </select>
          ) : (
            <>
              <p className="muted">{intl.formatMessage({ id: "league.match.propose.noOverlap" })}</p>
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
      {error ? <p role="alert" className="league-error">{error}</p> : null}
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
  return (
    <>
      <h4 className="league-section-title">{intl.formatMessage({ id: "league.matches.title" })}</h4>
      {league.matches.length === 0 ? <p className="muted">{intl.formatMessage({ id: "league.matches.empty" })}</p> : (
        <ul className="league-matches">
          {league.matches.map((match) => (
            <MatchItem key={match.id} league={league} match={match} now={now} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </>
  );
}
