import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTestIntl, TestI18nProvider } from "../i18n/TestI18nProvider.js";
import {
  GuestLandingDetails,
  GuestLandingHero,
  SeoPrerenderedLanding,
} from "./GuestLanding.js";

describe("guest search landing", () => {
  it("leads with the primary online-play intent", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <GuestLandingHero stats={{ inGame: 2, openRooms: 1 }} />
      </TestI18nProvider>,
    );

    expect(html).toContain("Play Flesh and Blood online");
    expect(html).toContain("Play for free in your browser");
    expect(html).toContain("Find opponents, practice against hero-specific bots");
    expect(html).not.toContain('class="intro-logo"');
    expect(html).toContain("<strong>2</strong> in game");
    expect(html).toContain("<strong>1</strong> open room");
  });

  it("describes the primary ways to play without redundant fragment links", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <GuestLandingDetails />
      </TestI18nProvider>,
    );

    expect(html).not.toContain('href="#create-account"');
    expect(html).not.toContain("See Fyendal in action");
    expect(html).not.toContain("<video");
    expect(html).toContain('src="/fyendal-gameplay-demo-poster.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('id="practice-bots"');
    expect(html).toContain("Fabrary");
    expect(html).toContain("Can I play Flesh and Blood against a bot?");
  });

  it("provides complete meaningful content for the initial HTML", () => {
    const html = renderToStaticMarkup(<SeoPrerenderedLanding intl={createTestIntl()} />);

    expect(html).toContain('<main id="main-content"');
    expect(html).toContain("Play Flesh and Blood online");
    expect(html).toContain("Terms of Service");
    expect(html).toContain("Privacy Policy");
  });

  it("renders the complete landing experience in Chinese", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <>
          <GuestLandingHero stats={{ inGame: 2, openRooms: 1 }} />
          <GuestLandingDetails />
        </>
      </TestI18nProvider>,
    );

    expect(html).toContain("在线畅玩 Flesh and Blood");
    expect(html).toContain("<strong>2</strong> 人正在对局");
    expect(html).toContain("常见问题");
    expect(html).toContain("我可以导入 Fabrary 牌组吗？");
  });
});
