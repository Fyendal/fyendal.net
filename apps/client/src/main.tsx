import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initAnalytics } from "./analytics.js";
import { I18nProvider, loadLocaleMessages } from "./i18n/I18nProvider.js";
import { applyDocumentLocale, resolveInitialLocale } from "./i18n/locale.js";
import "./styles.css";

async function bootstrap(): Promise<void> {
  initAnalytics();
  const rootElement = document.getElementById("root")!;
  let locale = resolveInitialLocale(localStorage, navigator.languages);
  applyDocumentLocale(document.documentElement, locale);

  // Production HTML contains an English, logged-out prerender for crawlers.
  // index.html hides it before first paint when this client renders something
  // else; clear it so the empty-root splash shows until React mounts.
  const documentElement = document.documentElement;
  if (locale !== "en" || documentElement.classList.contains("app-boot")) rootElement.replaceChildren();
  documentElement.classList.remove("app-boot");

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
