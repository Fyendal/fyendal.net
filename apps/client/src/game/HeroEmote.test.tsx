import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { EMOTE_OPTIONS, HeroEmote } from "./HeroEmote.js";

describe("hero emotes", () => {
  it("offers only the predefined table messages", () => {
    expect(EMOTE_OPTIONS).toEqual([
      "Hello!",
      "Good luck, have fun!",
      "Good game!",
      "Thanks!",
      "Sorry!",
      "Nice play!",
      "Thinking...",
      "Oops!",
    ]);
  });

  it("anchors a received message and the sender control to the hero", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <HeroEmote
          seat={1}
          event={{ id: 4, seat: 1, message: "Good game!" }}
          canSend={true}
          onSend={() => undefined}
        >
          <span>Hero card</span>
        </HeroEmote>
      </TestI18nProvider>,
    );

    expect(html).toContain("Hero card");
    expect(html).toContain("Good game!");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Send a message"');
  });

  it("localizes received wire messages while preserving the protocol value", () => {
    const event = { id: 4, seat: 1, message: "Good game!" as const };
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <HeroEmote seat={1} event={event} canSend={true} onSend={() => undefined} />
      </TestI18nProvider>,
    );

    expect(html).toContain("精彩对局！");
    expect(html).toContain('aria-label="发送消息"');
    expect(event.message).toBe("Good game!");
  });
});
