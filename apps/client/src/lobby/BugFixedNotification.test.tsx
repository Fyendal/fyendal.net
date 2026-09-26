import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { BugFixedNotification } from "./BugFixedNotification.js";

describe("BugFixedNotification", () => {
  it("renders all notification copy in Simplified Chinese", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <BugFixedNotification notifications={[{ reportId: "fixed", fixedAt: 123 }]} onDismiss={() => undefined} />
      </TestI18nProvider>,
    );

    expect(html).toContain("问题已修复");
    expect(html).toContain("你报告的问题已经修复。感谢你帮助我们改进 Fyendal！");
    expect(html).toContain('aria-label="关闭问题报告通知"');
    expect(html).not.toContain("Bug fixed");
  });
  it("shows each clarification without claiming closed reports were fixed", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BugFixedNotification notifications={[
          { reportId: "first", fixedAt: null, closedAt: 123, message: "This interaction is intended.\nGo again applies at resolution." },
          { reportId: "second", fixedAt: null, closedAt: 124, message: "<script>plain text</script>" },
        ]} onDismiss={() => undefined} />
      </TestI18nProvider>,
    );
    expect(html).toContain("Bug report update");
    expect(html).toContain("This interaction is intended.");
    expect(html).toContain("Go again applies at resolution.");
    expect(html).toContain("&lt;script&gt;plain text&lt;/script&gt;");
    expect(html).not.toContain("Bug fixed");
  });
});
