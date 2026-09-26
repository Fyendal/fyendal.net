import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { NoticeBanner } from "./NoticeBanner.js";

describe("NoticeBanner", () => {
  it("localizes controls and escapes operator text", () => {
    const html = renderToStaticMarkup(<TestI18nProvider locale="zh-Hans"><NoticeBanner notice={{ id: "one", message: "Maintenance <script>alert(1)</script>", expiresAt: null }} onDismiss={() => undefined} /></TestI18nProvider>);
    expect(html).toContain("公告");
    expect(html).toContain('aria-label="关闭公告"');
    expect(html).toContain('role="status"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
