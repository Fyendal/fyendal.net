import { useIntl } from "react-intl";

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
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.27 5.33A16.3 16.3 0 0 0 15 4c-.18.33-.39.78-.53 1.13a16.1 16.1 0 0 0-4.95 0C9.38 4.78 9.16 4.33 8.98 4a16.4 16.4 0 0 0-4.27 1.34C2 9.4 1.28 13.35 1.65 17.25c1.78 1.33 3.5 2.14 5.2 2.68.42-.58.79-1.2 1.11-1.85-.61-.23-1.19-.52-1.75-.86l.43-.35c3.38 1.59 7.05 1.59 10.39 0l.43.35c-.56.34-1.15.63-1.76.86.32.65.69 1.27 1.11 1.85 1.7-.54 3.43-1.35 5.2-2.68.44-4.52-.75-8.43-2.74-11.92ZM8.52 14.85c-1.02 0-1.85-.95-1.85-2.12s.81-2.12 1.85-2.12 1.87.96 1.85 2.12c0 1.17-.82 2.12-1.85 2.12Zm6.96 0c-1.02 0-1.85-.95-1.85-2.12s.81-2.12 1.85-2.12 1.87.96 1.85 2.12c0 1.17-.81 2.12-1.85 2.12Z" />
      </svg>
    </a>
  );
}
