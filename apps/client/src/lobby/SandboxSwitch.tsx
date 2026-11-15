import { useIntl } from "react-intl";

/** Opt-in for an unrecorded private room whose players may edit their own side. */
export function SandboxSwitch({
  checked,
  onChange,
  privateOnly = false,
}: {
  checked: boolean;
  onChange: (enabled: boolean) => void;
  /** The surface also creates public rooms, which cannot be sandbox. */
  privateOnly?: boolean;
}) {
  const intl = useIntl();
  return (
    <label className="bot-matchmaking-option sandbox-option">
      <span className="bot-matchmaking-copy">
        <strong>{intl.formatMessage({ id: "lobby.sandbox.label" })}</strong>
        <small>
          {intl.formatMessage({ id: privateOnly ? "lobby.sandbox.descriptionPrivateOnly" : "lobby.sandbox.description" })}
        </small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" />
    </label>
  );
}
