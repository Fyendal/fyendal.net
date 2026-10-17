import { useIntl } from "react-intl";
import { Auth } from "../auth/AuthCard.js";

/** Shown when a share link refuses the current viewer. Signing in keeps the
 * link in the address bar, so the app retries it with the new session. */
export function SharedReplayGate({
  reason,
  onLeave,
}: {
  reason: "sign-in" | "friends-only";
  onLeave: () => void;
}) {
  const intl = useIntl();
  return (
    <div className="modal-backdrop">
      <div
        className="deck-pick-modal shared-replay-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-replay-gate-title"
      >
        <h2 className="panel-title" id="shared-replay-gate-title">
          {intl.formatMessage({ id: "replay.shared.gateTitle" })}
        </h2>
        <p className="muted">
          {intl.formatMessage({
            id: reason === "sign-in" ? "replay.shared.signInRequired" : "replay.shared.friendsOnly",
          })}
        </p>
        {reason === "sign-in" ? <Auth initialMode="login" /> : null}
        <div className="deck-actions">
          <button type="button" onClick={onLeave}>
            {intl.formatMessage({ id: "replay.shared.goHome" })}
          </button>
        </div>
      </div>
    </div>
  );
}
