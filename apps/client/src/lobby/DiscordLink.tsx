import { useIntl } from "react-intl";
import { DiscordIcon } from "../components/DiscordIcon.js";

/** Compact community link shared by both lobby header states. */
export function DiscordLink() {
  const intl = useIntl();

  return (
    <a
      className="topbar-icon-link"
      href="https://discord.gg/DpTjVbfPVv"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={intl.formatMessage({ id: "discord.label" })}
      title={intl.formatMessage({ id: "discord.title" })}
    >
      <DiscordIcon />
    </a>
  );
}
