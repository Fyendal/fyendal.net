import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    const html = renderToStaticMarkup(createElement(HeroEmote, {
      seat: 1,
      event: { id: 4, seat: 1, message: "Good game!" },
      canSend: true,
      onSend: () => undefined,
      children: createElement("span", null, "Hero card"),
    }));

    expect(html).toContain("Hero card");
    expect(html).toContain("Good game!");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Send a message"');
  });
});
