import type { GameMessage } from "@fyendal/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTestIntl, TestI18nProvider } from "./TestI18nProvider.js";
import { formatGameMessage, GameMessageText } from "./GameMessage.js";

describe("localized game-message symbols", () => {
  it.each([
    ["en", "Attack"],
    ["zh-Hans", "攻击"],
  ] as const)("renders {p} as the power icon in %s", (locale, attackLabel) => {
    const message = { id: "card.common.option.power.one" };
    const html = renderToStaticMarkup(
      <TestI18nProvider locale={locale}>
        <GameMessageText message={message} />
      </TestI18nProvider>,
    );

    expect(html).toContain('src="/icons/attack.png"');
    expect(html).toContain('class="ico game-message-power-icon"');
    expect(html).toContain(`alt="${attackLabel}"`);
    expect(html).not.toContain("{p}");
    expect(formatGameMessage(createTestIntl(locale), message)).toBe(`+1 ${attackLabel}`);
  });
});

describe("localized game-message terms", () => {
  it.each([
    ["en", "Stalagmite, Bastion of Isenloft triggers: When this defends"],
    ["zh-Hans", "Stalagmite, Bastion of Isenloft 触发：当此牌进行防守时"],
  ] as const)("composes nested trigger terms in %s", (locale, expected) => {
    const message = {
      id: "engine.log.trigger.card",
      values: {
        triggerSource: { kind: "card", cardId: "EVR018" },
        triggerEffect: { kind: "term", id: "engine.term.when.this.defends" },
        occurrences: 1,
      },
    } satisfies GameMessage;

    expect(formatGameMessage(createTestIntl(locale), message, {
      card: () => "Stalagmite, Bastion of Isenloft",
    })).toBe(expected);
  });
});
