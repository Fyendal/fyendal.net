// Terms of Service and Privacy Policy, rendered at /terms/ and /privacy/.
// Plain-language, matching what the service actually does — keep them in
// sync when data handling changes (accounts, decks, replays, and bug reports).

const CONTACT = "fyendalsupport@gmail.com";

interface Section {
  title: string;
  body: string[];
}

const TERMS: Section[] = [
  {
    title: "The service",
    body: [
      "Fyendal is a free, non-commercial fan project: an online platform for playing the Flesh and Blood trading card game in your browser, with an automated rules engine. It is provided as-is, may change or shut down at any time, and is not an official product.",
    ],
  },
  {
    title: "Not affiliated with Legend Story Studios",
    body: [
      "Fyendal is in no way affiliated with Legend Story Studios. Legend Story Studios®, Flesh and Blood™, and set names are trademarks of Legend Story Studios. Flesh and Blood characters, cards, logos, and art are property of Legend Story Studios. © Legend Story Studios.",
      "Card images and game text are used under the Flesh and Blood Terms of Use for Licensed Assets (fabtcg.com/resources/terms-use-licensed-assets). Fyendal is not sold and carries no paid features, in line with those terms.",
    ],
  },
  {
    title: "Accounts",
    body: [
      "Playing (not spectating) requires an account. You are responsible for your account and for anything done with it. One person, one account; don't share credentials.",
    ],
  },
  {
    title: "Acceptable use",
    body: [
      "Don't harass other players, don't cheat or exploit bugs for advantage (report them instead), don't automate access to the service or scrape it, and don't use the platform for anything unlawful. We may suspend accounts that break these rules.",
    ],
  },
  {
    title: "Your content",
    body: [
      "Decklists you import remain yours. You grant us the minimum needed to store and use them to run your games. Game records, including moves, results, room history, and full-information replays, may be kept to operate those features.",
      "When you submit a bug report, you grant us permission to use its description and attached room trace to diagnose and fix the problem.",
    ],
  },
  {
    title: "No warranty, limited liability",
    body: [
      "The service is provided “as is” without warranties of any kind. The rules engine may contain bugs; a game outcome produced by the engine is not an official ruling. To the extent permitted by law, we are not liable for damages arising from use of the service.",
    ],
  },
  {
    title: "Changes",
    body: [
      `These terms may change; the current version is always at /terms/. Continued use after a change means acceptance. Questions: ${CONTACT}.`,
    ],
  },
];

const PRIVACY: Section[] = [
  {
    title: "Information Fyendal stores",
    body: [
      "Account information includes your username, password hash, and any cosmetic entitlement attached to your account. Fyendal does not collect an email address during registration.",
      "Game data: your saved decklists, room membership, and the state and history of games you play (needed to run, reconnect, and resume games). Completed replays contain full-information frames, including both players' hidden zones; they are available only to the two signed-in participants and expire after 7 days.",
      "Bug reports: when you choose to submit one, we store your description, a report reference, and a server-side copy of the room's current state and recent history. The trace can contain both players' hidden game zones and is available only to service operators for diagnosis; it is not returned through the player-facing API.",
    ],
  },
  {
    title: "How Fyendal uses information",
    body: [
      "Fyendal uses this information to create and secure accounts, run and resume games, save decks and replays, provide account controls, prevent abuse, and diagnose problems reported by players.",
    ],
  },
  {
    title: "Information kept in your browser",
    body: [
      "Your session token, browser preferences, short-lived matchmaking avoidance list, and an in-progress fallback replay are kept in your browser's localStorage. Clearing site data removes those browser copies. Imported and exported replay files remain on your device.",
    ],
  },
  {
    title: "Service providers and sharing",
    body: [
      "Fyendal has no advertising or analytics, does not track you across other websites, and does not sell or share your information with third parties for their own purposes. Because there is no cross-site tracking, browser Do Not Track signals do not change how Fyendal operates.",
      "Fyendal uses Google Cloud to host and operate the service in the United States. Google processes network and stored service data on our behalf to provide hosting.",
      "Card and hero images are loaded directly from Fabrary's content servers. When your browser requests those images, Fabrary receives ordinary request metadata such as your IP address and browser user agent. Fyendal sends no account token or username with those requests.",
    ],
  },
  {
    title: "Retention",
    body: [
      "Rooms are normally deleted 15 minutes after a finished game or after all live presence is gone. Completed player replays expire 7 days after the game ends. Sessions expire after 30 days without renewal. Accounts, saved decks, and submitted bug reports persist until deletion.",
      "Encrypted disaster-recovery backups are retained for up to 7 days. They are used only for disaster recovery and expire automatically.",
    ],
  },
  {
    title: "Your choices",
    body: [
      "Signed-in users can download their account data or delete their account from the Account panel. Exports include retained player replays, bug-report descriptions, and trace references, but not hidden bug-report room-state attachments. Deletion removes the account, sessions, saved decks, replay copies, bug reports, and account-bound active rooms from Fyendal's active systems.",
      "Backups are not edited to remove individual records, but deleted information disappears as those backups expire.",
      `For a request you cannot complete while signed in, contact ${CONTACT}.`,
    ],
  },
  {
    title: "Security",
    body: [
      "Passwords are hashed with scrypt, tokens are stored hashed, and all traffic is served over HTTPS. No system is perfectly secure; use a unique password.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      `Effective September 1, 2026. This policy may change; the current version is always at /privacy/. Questions: ${CONTACT}.`,
    ],
  },
];

export function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const title = kind === "terms" ? "Terms of Service" : "Privacy Policy";
  const sections = kind === "terms" ? TERMS : PRIVACY;
  return (
    <div className="lobby-page legal-page">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="" />
          <span className="brand-name">Fyendal</span>
          <span className="brand-sub">Flesh and Blood online</span>
        </div>
        <div className="topbar-actions">
          <a className="legal-back" href="/">
            ← Back to lobby
          </a>
        </div>
      </header>
      <div className="panel legal-panel">
        <h1 className="legal-title">{title}</h1>
        {sections.map((s) => (
          <section key={s.title} className="legal-section">
            <h2>{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
