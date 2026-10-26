import { useMemo } from "react";
import { useIntl } from "react-intl";
import { supportedTimeZones } from "./availability.js";

export function TimeZoneSelect({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (timeZone: string) => void;
  disabled?: boolean;
}) {
  const intl = useIntl();
  const zones = useMemo(() => supportedTimeZones(value), [value]);
  return (
    <div className="league-field">
      <label htmlFor={id}>{intl.formatMessage({ id: "league.timeZone.label" })}</label>
      <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
      </select>
    </div>
  );
}
