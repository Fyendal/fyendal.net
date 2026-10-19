import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "./TestI18nProvider.js";
import { LanguagePicker } from "./LanguagePicker.js";

describe("LanguagePicker", () => {
  it("renders the header badge with the active language mark and an accessible label", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider><LanguagePicker placement="header" /></TestI18nProvider>,
    );

    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="language-mark" lang="en" aria-hidden="true">EN</span>');
  });

  it("labels the header badge from the Simplified Chinese catalog", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans"><LanguagePicker placement="header" /></TestI18nProvider>,
    );

    expect(html).toContain('aria-label="语言"');
    expect(html).toContain('lang="zh-Hans" aria-hidden="true">中</span>');
  });

  it("renders the More sheet row over a native select of every autonym", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="pt-BR"><LanguagePicker placement="menu" /></TestI18nProvider>,
    );

    expect(html).toContain('<span class="language-row-value" lang="pt-BR">Português</span>');
    expect(html).toContain('<select aria-label="Idioma">');
    expect(html).toContain('<option value="en" lang="en">English</option>');
    expect(html).toContain('<option value="zh-Hans" lang="zh-Hans">简体中文</option>');
    expect(html).toContain('<option value="pt-BR" lang="pt-BR" selected="">Português</option>');
    expect(html).toContain('<option value="es" lang="es">Español</option>');
  });

  it("renders the selected Spanish locale with its mark", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="es"><LanguagePicker placement="header" /></TestI18nProvider>,
    );

    expect(html).toContain('lang="es" aria-hidden="true">ES</span>');
  });
});
