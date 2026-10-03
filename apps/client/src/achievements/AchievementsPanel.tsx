import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { ACTIVE_ACHIEVEMENT_IDS, type AchievementsResponse } from "@fyendal/protocol";
import { apiAchievements } from "../auth/auth.js";
import { heroImageUrl } from "../lobby/heroImage.js";
import { useStore } from "../store.js";
import { ACHIEVEMENT_BOT_HEROES, ACHIEVEMENT_GROUPS, achievementMessageId } from "./catalog.js";
import "../styles/achievements.css";

export function AchievementsPanel() {
  const intl = useIntl();
  const token = useStore((state) => state.authToken);
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<"all" | "locked" | "unlocked">("all");

  useEffect(() => {
    setData(null);
    setError(false);
    if (!token) return;
    const controller = new AbortController();
    void apiAchievements(token, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) { setData(result); setError(false); }
      else setError(true);
    });
    return () => controller.abort();
  }, [token, revision]);

  const unlocked = new Map(data?.unlocks
    .filter((item) => ACTIVE_ACHIEVEMENT_IDS.includes(item.id))
    .map((item) => [item.id, item.unlockedAt]));
  const percentages = new Map(data?.percentages.map((item) => [item.id, item.percent]));
  const count = unlocked.size;
  const visibleCount = filter === "all" ? ACTIVE_ACHIEVEMENT_IDS.length
    : filter === "unlocked" ? count : ACTIVE_ACHIEVEMENT_IDS.length - count;
  const progressLabel = intl.formatMessage({ id: "achievements.progress" }, { count, total: ACTIVE_ACHIEVEMENT_IDS.length });

  return (
    <div className="panel achievements-panel">
      <header className="achievements-header">
        <div>
          <h2 className="panel-title">{intl.formatMessage({ id: "achievements.title" })}</h2>
          <p>{intl.formatMessage({ id: "achievements.intro" })}</p>
        </div>
        <div className="achievements-progress">
          <div className="achievements-progress-copy" aria-hidden="true">
            <span>{intl.formatMessage({ id: "achievements.unlocked" })}</span>
            <strong>{count}<span> / {ACTIVE_ACHIEVEMENT_IDS.length}</span></strong>
          </div>
          <progress value={count} max={ACTIVE_ACHIEVEMENT_IDS.length} aria-label={progressLabel} />
        </div>
      </header>
      {error ? (
        <div role="alert" className="achievements-error">
          {intl.formatMessage({ id: "achievements.loadError" })}{" "}
          <button onClick={() => setRevision((value) => value + 1)}>{intl.formatMessage({ id: "achievements.retry" })}</button>
        </div>
      ) : null}
      {!data && !error ? <p role="status" className="muted">{intl.formatMessage({ id: "common.loading" })}</p> : null}
      {data ? <div className="lobby-panel-tabs achievements-filters" role="group" aria-label={intl.formatMessage({ id: "achievements.filter.label" })}>
        {(["all", "locked", "unlocked"] as const).map((option) => (
          <button key={option} type="button" className={filter === option ? "selected" : ""} aria-pressed={filter === option} onClick={() => setFilter(option)}>
            {intl.formatMessage({ id: `achievements.filter.${option}` })}
            <span>{option === "all" ? ACTIVE_ACHIEVEMENT_IDS.length : option === "locked" ? ACTIVE_ACHIEVEMENT_IDS.length - count : count}</span>
          </button>
        ))}
      </div> : null}
      {data && visibleCount === 0 ? <p className="muted">{intl.formatMessage({ id: "achievements.filter.empty" })}</p> : null}
      {data ? ACHIEVEMENT_GROUPS.map((group) => {
        const ids = group.ids
          .filter((id) => filter === "all" || (filter === "unlocked") === unlocked.has(id))
          .sort((a, b) => Number(unlocked.has(b)) - Number(unlocked.has(a))
            || (unlocked.get(b) ?? 0) - (unlocked.get(a) ?? 0));
        if (ids.length === 0) return null;
        const groupCount = group.ids.filter((id) => unlocked.has(id)).length;
        return <section className="achievements-group" key={group.titleId}>
          <div className="achievements-group-heading">
            <h3>{intl.formatMessage({ id: group.titleId })}</h3>
            <span aria-label={intl.formatMessage({ id: "achievements.progress" }, { count: groupCount, total: group.ids.length })}>{groupCount} / {group.ids.length}</span>
          </div>
          <div className="achievements-list">
            {ids.map((id) => {
              const unlockedAt = unlocked.get(id);
              const earned = unlockedAt !== undefined;
              const percent = percentages.get(id) ?? 0;
              const botHero = ACHIEVEMENT_BOT_HEROES[id];
              const rare = percent > 0 && percent < .1;
              const rarityValues = { percent: intl.formatNumber(percent, { maximumFractionDigits: 1 }) };
              return (
                <article className={`achievement-row${earned ? " is-unlocked" : " is-locked"}`} key={id}>
                  {botHero ? <span className="achievement-portrait" aria-hidden="true">
                    <span>{botHero.slice(0, 1)}</span>
                    <img src={heroImageUrl(botHero)} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />
                  </span> : <span className="achievement-number" aria-hidden="true">
                    {String(group.ids.indexOf(id) + 1).padStart(2, "0")}
                  </span>}
                  <div className="achievement-copy">
                    <h4>{intl.formatMessage({ id: achievementMessageId(id, "name") })}</h4>
                    <p>{intl.formatMessage({ id: achievementMessageId(id, "description") })}</p>
                  </div>
                  <div className="achievement-meta">
                    <span className="achievement-state">{intl.formatMessage({ id: earned ? "achievements.earned" : "achievements.locked" })}</span>
                    <span className="achievement-rarity" aria-label={rare
                      ? intl.formatMessage({ id: "achievements.rarityRare" })
                      : intl.formatMessage({ id: "achievements.rarity" }, rarityValues)}>
                      {rare
                        ? intl.formatMessage({ id: "achievements.rarityCompactRare" })
                        : intl.formatMessage({ id: "achievements.rarityCompact" }, rarityValues)}
                    </span>
                    {earned ? <time dateTime={new Date(unlockedAt).toISOString()}>
                      {intl.formatMessage({ id: "achievements.earnedOn" }, { date: intl.formatDate(unlockedAt, { dateStyle: "medium" }) })}
                    </time> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>;
      }) : null}
      {data ? <p className="achievements-footnote">{intl.formatMessage({ id: "achievements.footnote" })}</p> : null}
    </div>
  );
}
