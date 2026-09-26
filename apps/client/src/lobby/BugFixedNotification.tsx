import { useIntl } from "react-intl";
import type { FixedBugReportNotification } from "@fyendal/protocol";

export function BugFixedNotification({ notifications, onDismiss }: {
  notifications: FixedBugReportNotification[];
  onDismiss: () => void;
}) {
  const intl = useIntl();

  return (
    <div className="bug-fixed-notification" role="status" aria-live="polite">
      <span className="bug-fixed-notification-icon" aria-hidden="true">✓</span>
      <div className="bug-fixed-notification-content">
        {notifications.map((notification) => (
          <div className="bug-fixed-notification-report" key={notification.reportId}>
            <strong>{intl.formatMessage({ id: notification.fixedAt === null
              ? "lobby.bugreport.updated" : "lobby.bugFixed.title" })}</strong>
            <span>{intl.formatMessage({ id: notification.fixedAt === null
              ? "lobby.bugreport.reviewed" : "lobby.bugFixed.body" })}</span>
            {notification.message ? <p>{notification.message}</p> : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "lobby.bugreport.dismiss" })}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
