import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { DeadlineCountdown } from "../prep/DeadlineCountdown.js";

export function BackgroundMatchBar() {
  const intl = useIntl();
  const {
    status,
    acceptBackgroundMatch,
    declineBackgroundMatch,
    stopBackgroundMatchmaking,
  } = useStore(useShallow((state) => ({
    status: state.backgroundMatchmaking,
    acceptBackgroundMatch: state.acceptBackgroundMatch,
    declineBackgroundMatch: state.declineBackgroundMatch,
    stopBackgroundMatchmaking: state.stopBackgroundMatchmaking,
  })));

  if (status.state === "inactive" || status.state === "pending") return null;
  if (status.state === "searching") {
    return (
      <aside className="background-match-bar searching" role="status" aria-live="polite">
        <span>{intl.formatMessage({ id: "matchmaking.background.searching" })}</span>
        <button type="button" onClick={stopBackgroundMatchmaking}>
          {intl.formatMessage({ id: "matchmaking.background.stop" })}
        </button>
      </aside>
    );
  }

  return (
    <aside className="background-match-bar offer" role="alert" aria-live="assertive">
      <div className="background-match-copy">
        <strong>{intl.formatMessage({ id: "matchmaking.background.found" })}</strong>
        <span>{intl.formatMessage(
          { id: "matchmaking.background.opponent" },
          { username: status.opponent.username, hero: status.opponent.heroName },
        )}</span>
      </div>
      <div className="background-match-actions">
        {status.acceptedByYou ? (
          <strong>
            {intl.formatMessage({ id: "matchmaking.background.waiting" })} ·{" "}
            <DeadlineCountdown deadlineAt={status.deadlineAt} />
          </strong>
        ) : (
          <button type="button" className="btn-primary" onClick={acceptBackgroundMatch}>
            {intl.formatMessage({ id: "lobby.action.accept" })} ·{" "}
            <DeadlineCountdown deadlineAt={status.deadlineAt} />
          </button>
        )}
        <button type="button" onClick={declineBackgroundMatch}>
          {intl.formatMessage({ id: "matchmaking.background.keepBot" })}
        </button>
      </div>
    </aside>
  );
}
