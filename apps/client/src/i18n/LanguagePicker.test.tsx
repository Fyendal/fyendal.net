import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "./TestI18nProvider.js";
import { LanguagePicker } from "./LanguagePicker.js";

describe("LanguagePicker", () => {
  it("renders the selected English locale with an accessible label", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider><LanguagePicker /></TestI18nProvider>,
    );

    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('<option value="en" selected="">English</option>');
    expect(html).toContain('<option value="zh-Hans">简体中文</option>');
  });

  it("renders the selected Simplified Chinese locale from its catalog", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans"><LanguagePicker /></TestI18nProvider>,
    );

    expect(html).toContain('aria-label="语言"');
    expect(html).toContain('<option value="zh-Hans" selected="">简体中文</option>');
  });
});
