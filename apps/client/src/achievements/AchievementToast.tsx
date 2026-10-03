import { useIntl } from "react-intl";
import type { AchievementId } from "@fyendal/protocol";
import { achievementMessageId } from "./catalog.js";
import "../styles/achievements.css";

export function AchievementToast({ achievements, exiting, onDismiss }: {
  achievements: readonly AchievementId[];
  exiting: boolean;
  onDismiss: () => void;
}) {
  const intl = useIntl();
  const first = achievements[0];
  if (!first) return null;
  return (
    <div className={`achievement-toast${exiting ? " achievement-toast-exiting" : ""}`} role="status">
      <span className="achievement-toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m12 2 2.9 6.7 7.1.6-5.4 4.8 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.3l7.1-.6L12 2Z" />
        </svg>
      </span>
      <div className="achievement-toast-copy">
        <span className="achievement-toast-label">{intl.formatMessage({ id: "achievements.toast.title" })}</span>
        <div className="achievement-toast-detail">
          <strong>{intl.formatMessage({ id: achievementMessageId(first, "name") })}</strong>
          {achievements.length > 1 ? <span>
            {intl.formatMessage({ id: "achievements.toast.more" }, { count: achievements.length - 1 })}
          </span> : null}
        </div>
      </div>
      <button type="button" onClick={onDismiss} aria-label={intl.formatMessage({ id: "achievements.toast.dismiss" })}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6 18 18M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
