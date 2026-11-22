import { useIntl } from "react-intl";

/** Marks a sandbox game, which keeps a replay but counts toward no history or stats. */
export function SandboxBadge() {
  const intl = useIntl();
  return (
    <span className="sandbox-badge">
      {intl.formatMessage({ id: "common.sandbox.badge" })}
    </span>
  );
}
