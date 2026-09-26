import { FormattedMessage, useIntl } from "react-intl";
import type { GlobalNotice } from "@fyendal/shared";

export function NoticeBanner({ notice, onDismiss }: { notice: GlobalNotice; onDismiss: () => void }) {
  const intl = useIntl();
  return (
    <aside className="global-notice" role="status" aria-live="polite">
      <strong><FormattedMessage id="notice.label" /></strong>
      <span className="global-notice-message">{notice.message}</span>
      <button type="button" onClick={onDismiss} aria-label={intl.formatMessage({ id: "notice.dismiss" })}>×</button>
    </aside>
  );
}
