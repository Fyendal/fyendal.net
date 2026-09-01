// Shown in the lobby, logged in or out. Carries the two notices the
// Flesh and Blood Terms of Use for Licensed Assets mandate for third-party
// apps (https://fabtcg.com/resources/terms-use-licensed-assets/):
// the no-affiliation disclaimer and the © Legend Story Studios attribution
// for card images.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav className="site-footer-links">
        <a href="/terms/">Terms of Service</a>
        <a href="/privacy/">Privacy Policy</a>
      </nav>
      <p className="site-footer-legal">
        Fyendal is in no way affiliated with Legend Story Studios. Legend Story Studios®, Flesh and
        Blood™, and set names are trademarks of Legend Story Studios. Flesh and Blood characters,
        cards, logos, and art are property of Legend Story Studios. © Legend Story Studios.
      </p>
    </footer>
  );
}
