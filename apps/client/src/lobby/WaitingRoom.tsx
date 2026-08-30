import { useStore } from "../store.js";
import { useShallow } from "zustand/react/shallow";
import { DeadlineCountdown } from "../prep/DeadlineCountdown.js";
import { AcceptHeroMatchup } from "../prep/AcceptHeroMatchup.js";

/** Holding screen before a game starts: the host waits for an opponent,
 *  a spectator for the match to begin (the board appears on game start). */
export function WaitingRoom() {
  const { roomCode, leave, declineMatch, spectating, botGame, prep, matchAcceptanceRole, acceptMatch } = useStore(
    useShallow((state) => ({
      roomCode: state.roomCode,
      leave: state.leave,
      declineMatch: state.declineMatch,
      spectating: state.spectating,
      botGame: state.botGame,
      prep: state.prep,
      matchAcceptanceRole: state.matchAcceptanceRole,
      acceptMatch: state.acceptMatch,
    })),
  );
  const url = roomCode ? `${location.origin}/${roomCode}` : "";
  const me = prep?.seats[prep.yourSeat] ?? null;
  const opponent = prep?.seats[1 - prep.yourSeat] ?? null;

  if (
    matchAcceptanceRole === "joining"
    && prep?.deadlinePhase === "accept"
    && prep.deadlineAt
    && me?.accepted !== true
  ) {
    return (
      <div className="lobby-page match-accept-page">
        <div
          className="panel waiting-panel match-accept-panel"
          role="dialog"
          aria-labelledby="joining-match-accept-title"
          aria-live="polite"
        >
          <span className="match-accept-eyebrow">Match found</span>
          <h2 className="panel-title" id="joining-match-accept-title">Ready to play?</h2>
          <AcceptHeroMatchup you={me} opponent={opponent} />
          <p className="muted">
            {opponent ? `${opponent.username} is waiting for you.` : "Your opponent is waiting for you."}
          </p>
          <button className="btn-primary match-accept-primary" onClick={acceptMatch}>
            Accept · <DeadlineCountdown deadlineAt={prep.deadlineAt} />
          </button>
          <button onClick={declineMatch}>Decline</button>
        </div>
      </div>
    );
  }
  if (spectating) {
    return (
      <div className="lobby-page">
        <div className="panel waiting-panel">
          <h2 className="panel-title">Spectating — waiting for the game to start</h2>
          <div className="room-code">{roomCode}</div>
          <p className="muted">
            The players are still getting ready; the game board appears here once the match begins.
          </p>
          <button onClick={leave}>Leave</button>
        </div>
      </div>
    );
  }
  return (
    <div className="lobby-page">
      <div className="panel waiting-panel">
        <h2 className="panel-title">Waiting for opponent…</h2>
        <div className="room-code">{roomCode}</div>
        <p>
          Share this link:{" "}
          <a className="room-link" href={`/${roomCode}`}>
            {url}
          </a>
        </p>
        <p className="muted">Friends who open the link can choose a deck or hero and join.</p>
        <button onClick={leave}>{botGame ? "End Game" : "Cancel"}</button>
      </div>
    </div>
  );
}
