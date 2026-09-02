import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTestIntl, TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { FormatName, formatSelectLabel } from "./FormatBadge.js";

describe("localized format names", () => {
  it("shows Chinese names with compact English subtitles", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <FormatName format="cc" />
        <FormatName format="silver-age" />
      </TestI18nProvider>,
    );

    expect(html).toContain("经典构筑");
    expect(html).toContain(">CC</span>");
    expect(html).toContain("白银时代");
    expect(html).toContain(">Silver Age</span>");
  });

  it("does not repeat English names when the interface is English", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <FormatName format="silver-age" />
      </TestI18nProvider>,
    );

    expect(html.match(/Silver Age/g)).toHaveLength(1);
    expect(html).not.toContain("format-name-subtitle");
  });

  it("combines both names in native Chinese select options", () => {
    const intl = createTestIntl("zh-Hans");

    expect(formatSelectLabel(intl, "cc")).toBe("经典构筑 · CC");
    expect(formatSelectLabel(intl, "silver-age")).toBe("白银时代 · Silver Age");
  });
});
