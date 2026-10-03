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
  it("offers a bot after 10 seconds of matchmaking", () => {
    expect(BOT_PRACTICE_NUDGE_DELAY_MS).toBe(10_000);
  });

  it("only offers a bot to an unmatched constructed player while searching", () => {
    expect(shouldOfferBotPractice({
      format: "cc",
      matchmakingActive: true,
      opponentPresent: false,
    })).toBe(true);
    expect(shouldOfferBotPractice({
      format: "silver-age",
      matchmakingActive: true,
      opponentPresent: true,
    })).toBe(false);
    expect(shouldOfferBotPractice({
      format: "cc",
      matchmakingActive: false,
      opponentPresent: false,
    })).toBe(false);
    expect(shouldOfferBotPractice({
      format: "silver-age",
      matchmakingActive: true,
      opponentPresent: false,
    })).toBe(true);
    expect(shouldOfferBotPractice({
      format: "classic-battles",
      matchmakingActive: true,
      opponentPresent: false,
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

    expect(html).toContain("Challenge a competitive, hero-specific bot now.");
    expect(html).toContain("You can keep searching for a player while you play.");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Play vs bot");
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
    expect(html).toContain("挑战实力强劲的英雄专属机器人");
    expect(html).toContain("继续等待");
  });
});
