import { useId, type ReactNode } from "react";
import { useIntl } from "react-intl";

/** One setting: its name and description on the left, its control on the right. */
export function SettingRow({
  name,
  description,
  control,
  descriptionId,
  className = "",
}: {
  name: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  descriptionId?: string;
  className?: string;
}) {
  return (
    <div className={`settings-row${className ? ` ${className}` : ""}`}>
      <div className="settings-row-text">
        <span className="settings-row-name">{name}</span>
        {description ? <span className="settings-row-description" id={descriptionId}>{description}</span> : null}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  choices,
  value,
  onChange,
  label,
  describedBy,
  disabled = false,
}: {
  choices: readonly { value: T; labelId: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  const intl = useIntl();
  return (
    <div
      className="settings-segmented"
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      data-count={choices.length}
    >
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className={value === choice.value ? "settings-selected" : ""}
          aria-pressed={value === choice.value}
          disabled={disabled}
          onClick={() => onChange(choice.value)}
        >
          {intl.formatMessage({ id: choice.labelId })}
        </button>
      ))}
    </div>
  );
}
