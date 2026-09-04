// Terms of Service and Privacy Policy, rendered at /terms/ and /privacy/.
// Plain-language, matching what the service actually does — keep them in
// sync when data handling changes (accounts, games, social features, and reports).

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
      "Don't harass, threaten, impersonate, or spam other players. Don't send unlawful or abusive content, cheat or exploit bugs for advantage (report them instead), automate access to the service, scrape it, or use the platform for anything unlawful. We may restrict social features or suspend accounts that break these rules.",
    ],
  },
  {
    title: "Friends and messages",
    body: [
      "Friend requests, direct messages, and game invitations are provided for communication between players. Only send content you have the right to send, and don't share sensitive personal information through chat.",
      "Direct messages are visible to the sender and recipient. A recipient may copy or share what you send, so messages should not be treated as confidential.",
    ],
  },
  {
    title: "Your content",
    body: [
      "Decklists and messages you provide remain yours. You grant us the minimum permission needed to store, deliver, and use them to provide the features you choose. Game records, including moves, results, room history, and full-information replays, may be kept to operate those features.",
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
      "Account information includes your username, sign-in credentials, and any cosmetic entitlement attached to your account. Fyendal does not collect an email address during registration.",
      "Game data: your saved decklists, room membership, and the state and history of games you play (needed to run, reconnect, and resume games). Completed replays contain full-information frames, including both players' hidden zones; they are available only to the two signed-in participants and expire after 7 days.",
      "Social data: friend requests and connections, direct messages and their delivery or read information, whether friends are available, and game invitations. Your username, availability, and messages are shown only as needed to provide these features to the players involved.",
      "Bug reports: when you choose to submit one, we store your description, a report reference, and a server-side copy of the room's current state and recent history. The trace can contain both players' hidden game zones and is available only to service operators for diagnosis; it is not returned through the player-facing API.",
    ],
  },
  {
    title: "How Fyendal uses information",
    body: [
      "Fyendal uses this information to create and secure accounts, run and resume games, connect friends, deliver messages and invitations, show availability, save decks and replays, provide account controls, prevent abuse, and diagnose problems reported by players.",
    ],
  },
  {
    title: "Information kept in your browser",
    body: [
      "Your browser keeps information needed to stay signed in, reconnect to your games, remember your preferences, and preserve an in-progress fallback replay. Clearing site data removes those browser copies. Imported and exported replay files remain on your device.",
    ],
  },
  {
    title: "Service providers and sharing",
    body: [
      "Fyendal has no advertising or analytics, does not track you across other websites, and does not sell or share your information with third parties for their own purposes. Because there is no cross-site tracking, browser Do Not Track signals do not change how Fyendal operates.",
      "Service providers that help operate Fyendal may process information on Fyendal's behalf. They are not permitted to use it for their own purposes.",
      "Card and hero images come from a third-party content provider. Loading those images shares standard connection information with that provider, but Fyendal does not send your account credentials or username with the request.",
    ],
  },
  {
    title: "Retention",
    body: [
      "Direct messages are kept for up to 30 days. Removing a friendship deletes the retained conversation. Friend connections remain until either player removes the friendship, and pending requests remain until they are accepted, declined, or canceled. Availability and game invitations are short-lived.",
      "Rooms are normally deleted 15 minutes after a finished game or after everyone leaves. Completed player replays expire 7 days after the game ends. Sign-in sessions expire after 30 days without renewal. Accounts, saved decks, and submitted bug reports persist until deletion.",
      "Deleted information may remain briefly in routine backup copies before those copies expire automatically.",
    ],
  },
  {
    title: "Your choices",
    body: [
      "Signed-in users can download their account data or delete their account from the Account panel. Exports include friendships, pending friend requests, retained messages and replays, bug-report descriptions, and trace references, but not hidden bug-report room-state attachments. Deletion removes the account and associated social, game, and account data from Fyendal's active systems.",
      "Backups are not edited to remove individual records, but deleted information disappears as those backups expire.",
      `For a request you cannot complete while signed in, contact ${CONTACT}.`,
    ],
  },
  {
    title: "Security",
    body: [
      "Fyendal uses safeguards designed to protect account and service data. No system is perfectly secure; use a unique password and avoid sharing sensitive information in messages.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      `Effective September 3, 2026. This policy may change; the current version is always at /privacy/. Questions: ${CONTACT}.`,
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
