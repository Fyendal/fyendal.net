import { SiteFooter } from "../legal/SiteFooter.js";

interface LandingStats {
  inGame: number;
  openRooms: number;
}

export function LobbyBrand() {
  return (
    <div className="brand">
      <img className="brand-logo" src="/logo.png" alt="" width={46} height={46} />
      <span className="brand-copy">
        <span className="brand-name">Fyendal</span>
        <span className="brand-sub">Flesh and Blood online</span>
      </span>
    </div>
  );
}

export function GuestLandingHero({ stats }: { stats?: LandingStats | null }) {
  return (
    <section className="panel intro-panel" aria-labelledby="guest-landing-title">
      <h1 id="guest-landing-title" className="intro-title">
        Play Flesh and Blood online for free
      </h1>
      {stats ? (
        <div className="intro-stats" aria-label="Current activity">
          <span>
            <strong>{stats.inGame}</strong> in game
          </span>
          <span>
            <strong>{stats.openRooms}</strong> open {stats.openRooms === 1 ? "room" : "rooms"}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function GuestLandingDetails() {
  return (
    <div className="landing-details">
      <section className="landing-section" aria-labelledby="ways-to-play-title">
        <div className="landing-section-heading">
          <p className="landing-kicker">Play your way</p>
          <h2 id="ways-to-play-title">Online matches and focused practice</h2>
        </div>
        <div className="landing-play-layout">
          <div className="landing-card-grid">
            <article id="practice-bots" className="landing-info-card">
              <h3>Practice against bots</h3>
              <p>Test decks against hero-specific bots with their own strategies.</p>
            </article>
            <article id="player-matches" className="landing-info-card">
              <h3>Find or host a match</h3>
              <p>Queue, join an open room, or invite a friend to a private game.</p>
            </article>
            <article id="watch-replays" className="landing-info-card">
              <h3>Spectate and review</h3>
              <p>Watch games through a room link, then review or export saved replays.</p>
            </article>
          </div>
          <div className="landing-demo">
            <img
              className="landing-demo-image"
              src="/fyendal-gameplay-demo-poster.jpg"
              alt="A Fyendal game between Briar and a Bravo practice bot"
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
          <p className="landing-kicker">Common questions</p>
          <h2 id="faq-title">About playing on Fyendal</h2>
        </div>
        <div className="landing-faq-grid">
          <details>
            <summary>Is Fyendal free?</summary>
            <p>Yes. Fyendal is a free, non-commercial community project.</p>
          </details>
          <details>
            <summary>Can I play Flesh and Blood against a bot?</summary>
            <p>Yes. Fyendal offers hero-specific practice bots in both supported formats.</p>
          </details>
          <details>
            <summary>Can I import a Fabrary deck?</summary>
            <p>Yes. Import a public Fabrary URL or Fabrary export text. Every card must be supported by Fyendal.</p>
          </details>
          <details>
            <summary>Is Fyendal official?</summary>
            <p>No. Fyendal is an unofficial fan project and its game results are not official rules rulings.</p>
          </details>
        </div>
      </section>
    </div>
  );
}

/** Static guest content inserted into the built HTML before the client starts. */
export function SeoPrerenderedLanding() {
  return (
    <div className="lobby-page">
      <header className="topbar lobby-topbar lobby-topbar-guest">
        <LobbyBrand />
      </header>
      <main id="main-content" className="guest-landing">
        <div className="intro-grid">
          <GuestLandingHero />
          <aside id="create-account" className="intro-auth landing-static-account" aria-label="Start playing">
            <div className="auth-card">
              <h2>Start playing</h2>
              <p>Create a free account to play matches and practice against bots.</p>
            </div>
          </aside>
        </div>
        <GuestLandingDetails />
      </main>
      <SiteFooter />
    </div>
  );
}
