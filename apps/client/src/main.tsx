import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { I18nProvider, loadLocaleMessages } from "./i18n/I18nProvider.js";
import { applyDocumentLocale, resolveInitialLocale } from "./i18n/locale.js";
import "./styles.css";

async function bootstrap(): Promise<void> {
  const rootElement = document.getElementById("root")!;
  let locale = resolveInitialLocale(localStorage, navigator.languages);
  applyDocumentLocale(document.documentElement, locale);

  // Production HTML contains an English prerender for crawlers. Hide it while
  // a non-English catalog loads so users do not see a language flash.
  if (locale !== "en") rootElement.replaceChildren();

  let messages;
  try {
    messages = await loadLocaleMessages(locale);
  } catch {
    locale = "en";
    applyDocumentLocale(document.documentElement, locale);
    messages = await loadLocaleMessages(locale);
  }

  createRoot(rootElement).render(
    <React.StrictMode>
      <I18nProvider initialLocale={locale} initialMessages={messages}>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
