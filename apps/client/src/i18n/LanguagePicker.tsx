import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { useLocale } from "./I18nProvider.js";
import {
  LOCALE_AUTONYMS,
  LOCALE_MARKS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type SupportedLocale,
} from "./locale.js";

const OPTION_SELECTOR = 'button[role="menuitemradio"]';

/**
 * The header shows a round badge carrying the active language's mark and a
 * small menu of autonyms. The mobile More sheet and the in-game settings use
 * a native select, which keeps the platform picker and scales to any number
 * of languages.
 */
export function LanguagePicker({ placement }: { placement: "header" | "menu" | "settings" }) {
  if (placement === "header") return <LanguageBadgeMenu />;
  return placement === "menu" ? <LanguageRow /> : <LanguageSettingsRow />;
}

function LanguageSelect({ label }: { label: string }) {
  const { locale, loading, setLocale } = useLocale();
  return (
    <select
      aria-label={label}
      value={locale}
      disabled={loading}
      onChange={(event) => {
        if (isSupportedLocale(event.target.value)) void setLocale(event.target.value);
      }}
    >
      {SUPPORTED_LOCALES.map((option) => (
        <option key={option} value={option} lang={option}>{LOCALE_AUTONYMS[option]}</option>
      ))}
    </select>
  );
}

function LanguageRow() {
  const intl = useIntl();
  const { locale } = useLocale();
  const label = intl.formatMessage({ id: "language.label" });

  return (
    <label className="language-row">
      <span className="language-row-label">{label}</span>
      <span className="language-row-value" lang={locale}>{LOCALE_AUTONYMS[locale]}</span>
      <LanguageSelect label={label} />
    </label>
  );
}

function LanguageSettingsRow() {
  const intl = useIntl();
  const label = intl.formatMessage({ id: "language.label" });

  return (
    <label className="settings-control-row settings-language-row">
      <span className="settings-control-name">{label}</span>
      <LanguageSelect label={label} />
    </label>
  );
}

function LanguageBadgeMenu() {
  const intl = useIntl();
  const { locale, loading, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = intl.formatMessage({ id: "language.label" });

  useEffect(() => {
    if (loading) setOpen(false);
  }, [loading]);

  const focusSelected = () => {
    menuRef.current?.querySelector<HTMLButtonElement>(`${OPTION_SELECTOR}[aria-checked="true"]`)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusSelected();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("click", closeOnOutsideClick, true);
    return () => document.removeEventListener("click", closeOnOutsideClick, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (option: SupportedLocale) => {
    close();
    if (option !== locale) void setLocale(option);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(OPTION_SELECTOR)];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? options[(index + 1) % options.length]
      : event.key === "ArrowUp" ? options[(index - 1 + options.length) % options.length]
        : event.key === "Home" ? options[0]
          : event.key === "End" ? options.at(-1)
            : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div
      ref={rootRef}
      className="language-badge-menu"
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof Node && !event.currentTarget.contains(nextFocus)) setOpen(false);
      }}
    >
      <TooltipButton
        ref={triggerRef}
        className="language-badge"
        tooltip={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={loading}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (open) focusSelected();
          else setOpen(true);
        }}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="language-mark" lang={locale} aria-hidden="true">{LOCALE_MARKS[locale]}</span>
      </TooltipButton>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="language-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {SUPPORTED_LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              lang={option}
              aria-checked={option === locale}
              onClick={() => choose(option)}
            >
              <span className="language-mark" aria-hidden="true">{LOCALE_MARKS[option]}</span>
              <span>{LOCALE_AUTONYMS[option]}</span>
              {option === locale ? <UiIcon name="check" className="language-menu-check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
