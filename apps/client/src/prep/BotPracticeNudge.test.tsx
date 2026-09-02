import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BOT_PRACTICE_NUDGE_DELAY_MS,
  BotPracticeNudge,
  botPracticeFormat,
  shouldOfferBotPractice,
} from "./BotPracticeNudge.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("bot practice nudge", () => {
  it("waits 30 seconds before appearing", () => {
    expect(BOT_PRACTICE_NUDGE_DELAY_MS).toBe(30_000);
  });

  it("only offers practice to an unmatched constructed player in an empty queue", () => {
    expect(shouldOfferBotPractice({
      format: "cc",
      matchmakingActive: true,
      opponentPresent: false,
      queueCount: 0,
    })).toBe(true);
    expect(shouldOfferBotPractice({
      format: "silver-age",
      matchmakingActive: true,
      opponentPresent: true,
      queueCount: 0,
    })).toBe(false);
    expect(shouldOfferBotPractice({
      format: "cc",
      matchmakingActive: false,
      opponentPresent: false,
      queueCount: 0,
    })).toBe(false);
    expect(shouldOfferBotPractice({
      format: "cc",
      matchmakingActive: true,
      opponentPresent: false,
      queueCount: 1,
    })).toBe(true);
    expect(shouldOfferBotPractice({
      format: "cc",
      matchmakingActive: true,
      opponentPresent: false,
      queueCount: 2,
    })).toBe(false);
    expect(botPracticeFormat("classic-battles")).toBeNull();
  });

  it("names the available opponent and lets the player keep waiting", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BotPracticeNudge
          format="cc"
          busy={false}
          onPlay={vi.fn()}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("No other active player is looking for a game right now.");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Play vs Bot");
    expect(html).not.toContain("Hala");
    expect(html).toContain("Keep waiting");
  });

  it("renders the offer in Simplified Chinese", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <BotPracticeNudge
          format="silver-age"
          busy={false}
          onPlay={vi.fn()}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("暂未找到对局");
    expect(html).toContain("与AI对战测试你的牌组");
    expect(html).toContain("继续等待");
  });
});
