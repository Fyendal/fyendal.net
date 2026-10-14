import { useIntl } from "react-intl";
import type { AchievementId } from "@fyendal/protocol";
import { UiIcon } from "../components/UiIcon.js";
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
        <UiIcon name="star" />
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
