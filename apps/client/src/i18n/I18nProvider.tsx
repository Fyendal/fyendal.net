import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  RawIntlProvider,
  createIntl,
  createIntlCache,
  type IntlConfig,
} from "react-intl";
import {
  applyDocumentLocale,
  saveLocalePreference,
  type SupportedLocale,
} from "./locale.js";

export type LocaleMessages = NonNullable<IntlConfig["messages"]>;

const intlCache = createIntlCache();

export async function loadLocaleMessages(locale: SupportedLocale): Promise<LocaleMessages> {
  const englishCatalog = import("./compiled/en.json");
  if (locale === "en") return (await englishCatalog).default as LocaleMessages;
  const [english, selected] = await Promise.all([
    englishCatalog,
    import("./compiled/zh-Hans.json"),
  ]);
  return Object.assign(
    {},
    english.default as LocaleMessages,
    selected.default as LocaleMessages,
  ) as LocaleMessages;
}

interface LocaleContextValue {
  locale: SupportedLocale;
  loading: boolean;
  setLocale: (locale: SupportedLocale) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
  initialMessages,
}: {
  children: ReactNode;
  initialLocale: SupportedLocale;
  initialMessages: LocaleMessages;
}) {
  const [localeState, setLocaleState] = useState(() => ({
    locale: initialLocale,
    messages: initialMessages,
  }));
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    applyDocumentLocale(document.documentElement, localeState.locale);
  }, [localeState.locale]);

  const setLocale = useCallback(async (nextLocale: SupportedLocale) => {
    if (nextLocale === localeState.locale) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const messages = await loadLocaleMessages(nextLocale);
      if (request !== requestRef.current) return;
      saveLocalePreference(localStorage, nextLocale);
      startTransition(() => setLocaleState({ locale: nextLocale, messages }));
    } catch (error) {
      if (import.meta.env.DEV) console.error(`failed to load locale ${nextLocale}`, error);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [localeState.locale]);

  const intl = useMemo(() => createIntl({
    locale: localeState.locale,
    defaultLocale: "en",
    messages: localeState.messages,
  }, intlCache), [localeState]);

  const context = useMemo<LocaleContextValue>(() => ({
    locale: localeState.locale,
    loading,
    setLocale,
  }), [loading, localeState.locale, setLocale]);

  return (
    <LocaleContext.Provider value={context}>
      <RawIntlProvider value={intl}>{children}</RawIntlProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside I18nProvider");
  return context;
}
