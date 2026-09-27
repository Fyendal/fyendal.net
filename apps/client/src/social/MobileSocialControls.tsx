import { useIntl } from "react-intl";

export function UnreadMessageBadge({ count }: { count: number }) {
  const intl = useIntl();
  if (count <= 0) return null;
  return (
    <span
      className="social-unread-badge"
      aria-label={intl.formatMessage({ id: "social.unreadMessages" }, { count })}
    >
      {intl.formatNumber(count)}
    </span>
  );
}

export function SocialMenuButton({ onOpen }: { onOpen: () => void }) {
  const intl = useIntl();
  return (
    <button type="button" onClick={onOpen}>
      {intl.formatMessage({ id: "social.open" })}
    </button>
  );
}
