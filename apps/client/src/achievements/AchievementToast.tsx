import { useIntl } from "react-intl";
import type { AchievementId } from "@fyendal/protocol";
import { achievementMessageId } from "./catalog.js";
import "../styles/achievements.css";

export function AchievementToast({ achievements, percent, exiting, onViewAchievements }: {
  achievements: readonly AchievementId[];
  percent: number | null;
  exiting: boolean;
  onViewAchievements: () => void;
}) {
  const intl = useIntl();
  const first = achievements[0];
  if (!first) return null;
  const viewAllLabel = intl.formatMessage({ id: "achievements.viewAll" });
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
        <div className="achievement-toast-footer">
          {percent !== null ? <span className="achievement-toast-rarity">
            {percent > 0 && percent < .1
              ? intl.formatMessage({ id: "achievements.rarityCompactRare" })
              : intl.formatMessage({ id: "achievements.rarityCompact" }, {
                percent: intl.formatNumber(percent, { maximumFractionDigits: 1 }),
              })}
          </span> : null}
          <button type="button" className="achievement-toast-link" onClick={onViewAchievements}
            aria-label={viewAllLabel}>
            {intl.formatMessage({ id: "achievements.toast.viewAll" })}
          </button>
        </div>
      </div>
    </div>
  );
}
