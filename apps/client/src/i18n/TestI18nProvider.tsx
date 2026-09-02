import type { ReactNode } from "react";
import { createIntl, createIntlCache } from "react-intl";
import type { LocaleMessages } from "./I18nProvider.js";
import { I18nProvider } from "./I18nProvider.js";
import type { SupportedLocale } from "./locale.js";
import englishMessages from "./compiled/en.json";
import chineseMessages from "./compiled/zh-Hans.json";

const TEST_MESSAGES: Record<SupportedLocale, LocaleMessages> = {
  en: englishMessages as LocaleMessages,
  "zh-Hans": chineseMessages as LocaleMessages,
};

const testIntlCache = createIntlCache();

export function createTestIntl(locale: SupportedLocale = "en") {
  return createIntl(
    { locale, defaultLocale: "en", messages: TEST_MESSAGES[locale] },
    testIntlCache,
  );
}

export function TestI18nProvider({
  children,
  locale = "en",
}: {
  children: ReactNode;
  locale?: SupportedLocale;
}) {
  return (
    <I18nProvider initialLocale={locale} initialMessages={TEST_MESSAGES[locale]}>
      {children}
    </I18nProvider>
  );
}
