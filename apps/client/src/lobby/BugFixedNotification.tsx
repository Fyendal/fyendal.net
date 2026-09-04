import { useIntl } from "react-intl";

export function BugFixedNotification({ onDismiss }: { onDismiss: () => void }) {
  const intl = useIntl();

  return (
    <div className="bug-fixed-notification" role="status" aria-live="polite">
      <span className="bug-fixed-notification-icon" aria-hidden="true">✓</span>
      <span>
        <strong>{intl.formatMessage({ id: "lobby.bugFixed.title" })}</strong>
        {intl.formatMessage({ id: "lobby.bugFixed.body" })}
      </span>
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "lobby.bugFixed.dismiss" })}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
