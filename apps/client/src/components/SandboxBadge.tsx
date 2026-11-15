import { useIntl } from "react-intl";

/** Marks an unrecorded sandbox room. */
export function SandboxBadge() {
  const intl = useIntl();
  return (
    <span className="sandbox-badge">
      {intl.formatMessage({ id: "common.sandbox.badge" })}
    </span>
  );
}
