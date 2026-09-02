export const SUPPORTED_LOCALES = ["en", "zh-Hans"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Language choices are autonyms so they remain recognizable before and
 * after a locale switch. */
export const LOCALE_AUTONYMS: Readonly<Record<SupportedLocale, string>> = {
  en: "English",
  "zh-Hans": "简体中文",
};

export const LOCALE_STORAGE_KEY = "fyendal-locale";

interface StoredLocale {
  version: 1;
  locale: SupportedLocale;
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === "en" || value === "zh-Hans";
}

/** Match browser BCP-47 preferences without mapping Traditional Chinese to
 * Simplified Chinese. Explicit user choices are already canonical. */
export function matchSupportedLocale(languages: readonly string[]): SupportedLocale {
  for (const language of languages) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(language);
    } catch {
      continue;
    }
    if (locale.language === "en") return "en";
    if (locale.language !== "zh") continue;
    if (locale.script === "Hant" || locale.region === "HK" || locale.region === "MO" || locale.region === "TW") {
      continue;
    }
    return "zh-Hans";
  }
  return "en";
}

export function loadLocalePreference(
  storage: Pick<Storage, "getItem">,
): SupportedLocale | null {
  try {
    const raw = storage.getItem(LOCALE_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      record.version !== 1 ||
      !isSupportedLocale(record.locale)
    ) return null;
    return record.locale;
  } catch {
    return null;
  }
}

export function saveLocalePreference(
  storage: Pick<Storage, "setItem">,
  locale: SupportedLocale,
): void {
  const value: StoredLocale = { version: 1, locale };
  try {
    storage.setItem(LOCALE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A blocked or full localStorage must not prevent changing locale for the
    // current page lifetime.
  }
}

export function resolveInitialLocale(
  storage: Pick<Storage, "getItem">,
  languages: readonly string[],
): SupportedLocale {
  return loadLocalePreference(storage) ?? matchSupportedLocale(languages);
}

export function applyDocumentLocale(
  documentElement: Pick<HTMLElement, "lang" | "dir">,
  locale: SupportedLocale,
): void {
  documentElement.lang = locale;
  documentElement.dir = "ltr";
}
