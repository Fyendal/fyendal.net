import { useStore } from "../store.js";
import { useShallow } from "zustand/react/shallow";
import { useIntl } from "react-intl";
import { DeadlineCountdown } from "../prep/DeadlineCountdown.js";
import { AcceptHeroMatchup } from "../prep/AcceptHeroMatchup.js";

/** Holding screen before a game starts: the host waits for an opponent,
 *  a spectator for the match to begin (the board appears on game start). */
export function WaitingRoom() {
  const intl = useIntl();
  const {
    roomCode, leave, declineMatch, spectating, botGame, prep, matchAcceptanceRole, acceptMatch,
    pendingBotStart, botMatchTransition, acknowledgeBotMatchFallback, backgroundMatchmaking,
  } = useStore(
    useShallow((state) => ({
      roomCode: state.roomCode,
      leave: state.leave,
      declineMatch: state.declineMatch,
      spectating: state.spectating,
      botGame: state.botGame,
      prep: state.prep,
      matchAcceptanceRole: state.matchAcceptanceRole,
      acceptMatch: state.acceptMatch,
      pendingBotStart: state.pendingBotStart,
      botMatchTransition: state.botMatchTransition,
      acknowledgeBotMatchFallback: state.acknowledgeBotMatchFallback,
      backgroundMatchmaking: state.backgroundMatchmaking,
    })),
  );
  const url = roomCode ? `${location.origin}/${roomCode}` : "";
  const me = prep?.seats[prep.yourSeat] ?? null;
  const opponent = prep?.seats[1 - prep.yourSeat] ?? null;

  if (botMatchTransition === "fallback" && prep?.botGame === true) {
    return (
      <div className="lobby-page match-accept-page">
        <div
          className="panel waiting-panel match-accept-panel"
          role="dialog"
          aria-labelledby="bot-match-fallback-title"
          aria-describedby="bot-match-fallback-description"
          aria-live="polite"
        >
          <span className="match-accept-eyebrow">
            {intl.formatMessage({ id: "matchmaking.fallback.practice" })}
          </span>
          <h2 className="panel-title" id="bot-match-fallback-title">
            {intl.formatMessage({ id: "matchmaking.fallback.title" })}
          </h2>
          <p id="bot-match-fallback-description">
            {intl.formatMessage({ id: "matchmaking.fallback.description" }, { username: opponent?.username ?? "" })}
          </p>
          <AcceptHeroMatchup you={me} opponent={opponent} />
          {backgroundMatchmaking.state === "searching" && (
            <p className="muted">{intl.formatMessage({ id: "matchmaking.fallback.searching" })}</p>
          )}
          <button className="btn-primary match-accept-primary" onClick={acknowledgeBotMatchFallback}>
            {intl.formatMessage({ id: "matchmaking.fallback.continue" })}
          </button>
          <button onClick={leave}>{intl.formatMessage({ id: "common.cancel" })}</button>
        </div>
      </div>
    );
  }

  if (
    (matchAcceptanceRole === "joining" || pendingBotStart)
    && prep?.deadlinePhase === "accept"
    && prep.deadlineAt
  ) {
    return (
      <div className="lobby-page match-accept-page">
        <div
          className="panel waiting-panel match-accept-panel"
          role="dialog"
          aria-labelledby="joining-match-accept-title"
          aria-live="polite"
        >
          <span className="match-accept-eyebrow">{intl.formatMessage({ id: "lobby.waiting.matchFound" })}</span>
          <h2 className="panel-title" id="joining-match-accept-title">
            {intl.formatMessage({ id: me?.accepted ? "matchmaking.background.waiting" : "lobby.waiting.ready" })}
          </h2>
          <AcceptHeroMatchup you={me} opponent={opponent} />
          <p className="muted">
            {me?.accepted
              ? intl.formatMessage({ id: "lobby.waiting.accepted" })
              : opponent
              ? intl.formatMessage({ id: "lobby.waiting.namedOpponent" }, { username: opponent.username })
              : intl.formatMessage({ id: "lobby.waiting.opponent" })}
          </p>
          {me?.accepted ? (
            <p><DeadlineCountdown deadlineAt={prep.deadlineAt} /></p>
          ) : (
            <button className="btn-primary match-accept-primary" onClick={acceptMatch}>
              {intl.formatMessage({ id: "lobby.action.accept" })} · <DeadlineCountdown deadlineAt={prep.deadlineAt} />
            </button>
          )}
          <button onClick={declineMatch}>{intl.formatMessage({ id: "lobby.action.decline" })}</button>
        </div>
      </div>
    );
  }
  if (spectating) {
    return (
      <div className="lobby-page">
        <div className="panel waiting-panel">
          <h2 className="panel-title">{intl.formatMessage({ id: "lobby.waiting.spectating" })}</h2>
          <div className="room-code">{roomCode}</div>
          <p className="muted">
            {intl.formatMessage({ id: "lobby.waiting.playersPreparing" })}
          </p>
          <button onClick={leave}>{intl.formatMessage({ id: "common.leave" })}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="lobby-page">
      <div className="panel waiting-panel">
        <h2 className="panel-title">{intl.formatMessage({ id: "lobby.waiting.forOpponent" })}</h2>
        <div className="room-code">{roomCode}</div>
        <p>
          {intl.formatMessage({ id: "lobby.waiting.shareLink" })}{" "}
          <a className="room-link" href={`/${roomCode}`}>
            {url}
          </a>
        </p>
        <p className="muted">{intl.formatMessage({ id: "lobby.waiting.shareHint" })}</p>
        <button onClick={leave}>
          {intl.formatMessage({ id: botGame ? "common.endGame" : "common.cancel" })}
        </button>
      </div>
    </div>
  );
}
