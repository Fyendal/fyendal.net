export const BLOOD_DEBT_TRIGGER_LABEL = "Blood Debt — lose 1 life";

export function isBloodDebtTrigger(label: string): boolean {
  return label === BLOOD_DEBT_TRIGGER_LABEL;
}

/** Shared summary used wherever a consolidated Blood Debt trigger appears. */
export function BloodDebtTriggerTile({ count }: { count: number }) {
  const intl = useIntl();
  return (
    <div
      className="blood-debt-stack-tile"
      aria-label={intl.formatMessage({ id: "game.bloodDebt.summary" }, { count })}
    >
      <span className="blood-debt-stack-title">{intl.formatMessage({ id: "game.bloodDebt" })}</span>
      <span className="blood-debt-stack-amount">{count}</span>
    </div>
  );
}
import { useIntl } from "react-intl";
