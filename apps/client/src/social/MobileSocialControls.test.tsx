import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { SocialMenuButton, UnreadMessageBadge } from "./MobileSocialControls.js";

describe("mobile social controls", () => {
  it("hides the unread badge when messages have been read", () => {
    expect(renderToStaticMarkup(
      <TestI18nProvider><UnreadMessageBadge count={0} /></TestI18nProvider>,
    )).toBe("");
  });

  it("shows the exact message count with a localized accessible label", () => {
    const render = (locale: "en" | "zh-Hans", count: number) => renderToStaticMarkup(
      <TestI18nProvider locale={locale}><UnreadMessageBadge count={count} /></TestI18nProvider>,
    );
    expect(render("en", 1)).toContain('aria-label="1 unread message"');
    expect(render("en", 120)).toContain('aria-label="120 unread messages">120</span>');
    expect(render("zh-Hans", 3)).toContain('aria-label="3 条未读消息">3</span>');
  });

  it("provides a localized Social entry in More", () => {
    expect(renderToStaticMarkup(
      <TestI18nProvider><SocialMenuButton onOpen={vi.fn()} /></TestI18nProvider>,
    )).toContain(">Social</button>");
  });
});
