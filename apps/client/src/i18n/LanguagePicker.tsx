import { useIntl } from "react-intl";
import { useLocale } from "./I18nProvider.js";
import { LOCALE_AUTONYMS, SUPPORTED_LOCALES, isSupportedLocale } from "./locale.js";

export function LanguagePicker() {
  const intl = useIntl();
  const { locale, loading, setLocale } = useLocale();
  const label = intl.formatMessage({ id: "language.label" });

  return (
    <label className="language-picker">
      <span className="language-picker-label">{label}</span>
      <select
        aria-label={label}
        value={locale}
        disabled={loading}
        onChange={(event) => {
          if (isSupportedLocale(event.target.value)) void setLocale(event.target.value);
        }}
      >
        {SUPPORTED_LOCALES.map((option) => (
          <option key={option} value={option}>{LOCALE_AUTONYMS[option]}</option>
        ))}
      </select>
    </label>
  );
}
