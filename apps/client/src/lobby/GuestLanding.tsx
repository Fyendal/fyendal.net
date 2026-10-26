import { useIntl, type IntlShape } from "react-intl";
import { SiteFooterView } from "../legal/SiteFooter.js";

interface LandingStats {
  inGame: number;
  openRooms: number;
}

const FAQ_KEYS = [
  "howToPlay",
  "formats",
  "decks",
  "free",
  "download",
  "offline",
  "official",
  "support",
  "inPerson",
  "contribute",
] as const;

type FaqKey = (typeof FAQ_KEYS)[number];

function FaqAnswer({ intl, faq }: { intl: IntlShape; faq: FaqKey }) {
  const message = { id: `landing.faq.${faq}.answer` };

  if (faq === "support") {
    return intl.formatMessage(message, {
      discord: (chunks) => (
        <a href="https://discord.gg/DpTjVbfPVv" target="_blank" rel="noopener noreferrer">
          {chunks}
        </a>
      ),
    });
  }
  if (faq === "inPerson") {
    return intl.formatMessage(message, {
      events: (chunks) => (
        <a href="https://fabtcg.com/en/events/" target="_blank" rel="noopener noreferrer">
          {chunks}
        </a>
      ),
    });
  }
  if (faq === "contribute") {
    return intl.formatMessage(message, {
      github: (chunks) => (
        <a
          href="https://github.com/Fyendal/fyendal.net"
          target="_blank"
          rel="noopener noreferrer"
        >
          {chunks}
        </a>
      ),
      discord: (chunks) => (
        <a href="https://discord.gg/DpTjVbfPVv" target="_blank" rel="noopener noreferrer">
          {chunks}
        </a>
      ),
    });
  }

  return intl.formatMessage(message);
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
  const live = stats ? stats.inGame + stats.openRooms > 0 : false;
  return (
    <section className="intro-panel" aria-labelledby="guest-landing-title">
      <div className="intro-poster" aria-hidden="true" />
      <div className="intro-copy">
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
              {live ? <span className="home-play-live-dot" aria-hidden="true" /> : null}
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
      </div>
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
        <div className="landing-section-lead">
          <h2 id="ways-to-play-title">{intl.formatMessage({ id: "landing.ways.title" })}</h2>
          <div className="landing-ways">
            <article id="practice-bots" className="landing-way">
              <h3>{intl.formatMessage({ id: "landing.bots.title" })}</h3>
              <p>{intl.formatMessage({ id: "landing.bots.body" })}</p>
            </article>
            <article id="player-matches" className="landing-way">
              <h3>{intl.formatMessage({ id: "landing.matches.title" })}</h3>
              <p>{intl.formatMessage({ id: "landing.matches.body" })}</p>
            </article>
            <article id="watch-replays" className="landing-way">
              <h3>{intl.formatMessage({ id: "landing.replays.title" })}</h3>
              <p>{intl.formatMessage({ id: "landing.replays.body" })}</p>
            </article>
          </div>
        </div>
        <div className="landing-demo">
          <img
            className="landing-demo-image"
            src="/fyendal-gameplay-cindra-home.jpg"
            alt={intl.formatMessage({ id: "landing.demoAlt" })}
            width={1600}
            height={871}
            loading="lazy"
            decoding="async"
          />
        </div>
      </section>

      <section className="landing-section landing-faq" aria-labelledby="faq-title">
        <div className="landing-section-lead">
          <h2 id="faq-title">{intl.formatMessage({ id: "landing.faq.title" })}</h2>
        </div>
        <div className="landing-faq-list">
          {FAQ_KEYS.map((faq) => (
            <details key={faq}>
              <summary>{intl.formatMessage({ id: `landing.faq.${faq}.question` })}</summary>
              <p><FaqAnswer intl={intl} faq={faq} /></p>
            </details>
          ))}
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
        <div className="intro-grid stage-panel">
          <GuestLandingHeroView intl={intl} />
          <aside
            id="create-account"
            className="intro-auth stage-side landing-static-account"
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
