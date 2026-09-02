import { useIntl, type IntlShape } from "react-intl";

// Shown in the lobby, logged in or out. Carries the two notices the
// Flesh and Blood Terms of Use for Licensed Assets mandate for third-party
// apps (https://fabtcg.com/resources/terms-use-licensed-assets/):
// the no-affiliation disclaimer and the © Legend Story Studios attribution
// for card images.
export function SiteFooterView({ intl }: { intl: IntlShape }) {
  return (
    <footer className="site-footer">
      <nav className="site-footer-links">
        <a href="/terms/">{intl.formatMessage({ id: "footer.terms" })}</a>
        <a href="/privacy/">{intl.formatMessage({ id: "footer.privacy" })}</a>
      </nav>
      <p className="site-footer-legal">
        {intl.formatMessage({ id: "footer.legal" })}
      </p>
    </footer>
  );
}

export function SiteFooter() {
  return <SiteFooterView intl={useIntl()} />;
}
