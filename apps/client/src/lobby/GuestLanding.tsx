import { useIntl, type IntlShape } from "react-intl";
import { SiteFooterView } from "../legal/SiteFooter.js";

interface LandingStats {
  inGame: number;
  openRooms: number;
}

function LobbyBrandView({ intl }: { intl: IntlShape }) {
  return (
    <div className="brand">
      <img className="brand-logo" src="/logo.png" alt="" width={46} height={46} />
      <span className="brand-copy">
        <span className="brand-name">Fyendal</span>
        <span className="brand-sub">{intl.formatMessage({ id: "brand.subtitle" })}</span>
      </span>
    </div>
  );
}

export function LobbyBrand() {
  return <LobbyBrandView intl={useIntl()} />;
}

function GuestLandingHeroView({ intl, stats }: { intl: IntlShape; stats?: LandingStats | null }) {
  return (
    <section className="panel intro-panel" aria-labelledby="guest-landing-title">
      <h1 id="guest-landing-title" className="intro-title">
        {intl.formatMessage({ id: "landing.title" })}
      </h1>
      <p className="intro-subtitle">
        {intl.formatMessage({ id: "landing.subtitle" })}
      </p>
      {stats ? (
        <div
          className="intro-stats"
          aria-label={intl.formatMessage({ id: "landing.activityLabel" })}
        >
          <span>
            {intl.formatMessage(
              { id: "landing.inGame" },
              { count: stats.inGame, strong: (chunks) => <strong>{chunks}</strong> },
            )}
          </span>
          <span>
            {intl.formatMessage(
              { id: "landing.openRooms" },
              { count: stats.openRooms, strong: (chunks) => <strong>{chunks}</strong> },
            )}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function GuestLandingHero({ stats }: { stats?: LandingStats | null }) {
  return <GuestLandingHeroView intl={useIntl()} stats={stats} />;
}

function GuestLandingDetailsView({ intl }: { intl: IntlShape }) {
  return (
    <div className="landing-details">
      <section className="landing-section" aria-labelledby="ways-to-play-title">
        <div className="landing-section-heading">
          <p className="landing-kicker">{intl.formatMessage({ id: "landing.ways.kicker" })}</p>
          <h2 id="ways-to-play-title">{intl.formatMessage({ id: "landing.ways.title" })}</h2>
        </div>
        <div className="landing-play-layout">
          <div className="landing-card-grid">
            <article id="practice-bots" className="landing-info-card">
              <h3>{intl.formatMessage({ id: "landing.bots.title" })}</h3>
              <p>{intl.formatMessage({ id: "landing.bots.body" })}</p>
            </article>
            <article id="player-matches" className="landing-info-card">
              <h3>{intl.formatMessage({ id: "landing.matches.title" })}</h3>
              <p>{intl.formatMessage({ id: "landing.matches.body" })}</p>
            </article>
            <article id="watch-replays" className="landing-info-card">
              <h3>{intl.formatMessage({ id: "landing.replays.title" })}</h3>
              <p>{intl.formatMessage({ id: "landing.replays.body" })}</p>
            </article>
          </div>
          <div className="landing-demo">
            <img
              className="landing-demo-image"
              src="/fyendal-gameplay-demo-poster.jpg"
              alt={intl.formatMessage({ id: "landing.demoAlt" })}
              width={1280}
              height={720}
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>

      <section className="landing-section landing-faq" aria-labelledby="faq-title">
        <div className="landing-section-heading">
          <p className="landing-kicker">{intl.formatMessage({ id: "landing.faq.kicker" })}</p>
          <h2 id="faq-title">{intl.formatMessage({ id: "landing.faq.title" })}</h2>
        </div>
        <div className="landing-faq-grid">
          <details>
            <summary>{intl.formatMessage({ id: "landing.faq.free.question" })}</summary>
            <p>{intl.formatMessage({ id: "landing.faq.free.answer" })}</p>
          </details>
          <details>
            <summary>{intl.formatMessage({ id: "landing.faq.bot.question" })}</summary>
            <p>{intl.formatMessage({ id: "landing.faq.bot.answer" })}</p>
          </details>
          <details>
            <summary>{intl.formatMessage({ id: "landing.faq.import.question" })}</summary>
            <p>{intl.formatMessage({ id: "landing.faq.import.answer" })}</p>
          </details>
          <details>
            <summary>{intl.formatMessage({ id: "landing.faq.official.question" })}</summary>
            <p>{intl.formatMessage({ id: "landing.faq.official.answer" })}</p>
          </details>
        </div>
      </section>
    </div>
  );
}

export function GuestLandingDetails() {
  return <GuestLandingDetailsView intl={useIntl()} />;
}

/** Static guest content inserted into the built HTML before the client starts. */
export function SeoPrerenderedLanding({ intl }: { intl: IntlShape }) {
  return (
    <div className="lobby-page">
      <header className="topbar lobby-topbar lobby-topbar-guest">
        <LobbyBrandView intl={intl} />
      </header>
      <main id="main-content" className="guest-landing">
        <div className="intro-grid">
          <GuestLandingHeroView intl={intl} />
          <aside
            id="create-account"
            className="intro-auth landing-static-account"
            aria-label={intl.formatMessage({ id: "landing.startPlayingLabel" })}
          >
            <div className="auth-card">
              <h2>{intl.formatMessage({ id: "landing.startPlayingTitle" })}</h2>
              <p>{intl.formatMessage({ id: "landing.startPlayingBody" })}</p>
            </div>
          </aside>
        </div>
        <GuestLandingDetailsView intl={intl} />
      </main>
      <SiteFooterView intl={intl} />
    </div>
  );
}
