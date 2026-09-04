import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { BugFixedNotification } from "./BugFixedNotification.js";

describe("BugFixedNotification", () => {
  it("renders all notification copy in Simplified Chinese", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <BugFixedNotification onDismiss={() => undefined} />
      </TestI18nProvider>,
    );

    expect(html).toContain("问题已修复");
    expect(html).toContain("你报告的问题已经修复。感谢你帮助我们改进 Fyendal！");
    expect(html).toContain('aria-label="关闭问题已修复通知"');
    expect(html).not.toContain("Bug fixed");
  });
});
