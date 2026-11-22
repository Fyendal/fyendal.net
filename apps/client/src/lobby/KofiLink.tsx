import { useIntl } from "react-intl";

export const KOFI_URL = "https://ko-fi.com/fyendal/";

/** Ko-fi call to action; the gem previews the supporter badge it earns. */
export function KofiLink({ placement = "header" }: { placement?: "header" | "menu" }) {
  const intl = useIntl();

  return (
    <a
      className={placement === "header" ? "topbar-kofi-link" : "mobile-more-kofi"}
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={intl.formatMessage({ id: "kofi.title" })}
    >
      <img src="/badges/supporter-gem.png" width={22} height={22} alt="" />
      <span className="kofi-link-text">{intl.formatMessage({ id: "kofi.cta" })}</span>
      <span className="kofi-link-heart" aria-hidden="true">💜</span>
    </a>
  );
}
