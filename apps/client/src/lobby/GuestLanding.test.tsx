import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GuestLandingDetails,
  GuestLandingHero,
  SeoPrerenderedLanding,
} from "./GuestLanding.js";

describe("guest search landing", () => {
  it("leads with the primary online-play intent", () => {
    const html = renderToStaticMarkup(<GuestLandingHero stats={{ inGame: 2, openRooms: 1 }} />);

    expect(html).toContain("Play Flesh and Blood online for free");
    expect(html).not.toContain('class="intro-logo"');
    expect(html).toContain("<strong>2</strong> in game");
    expect(html).toContain("<strong>1</strong> open room");
  });

  it("describes the primary ways to play without redundant fragment links", () => {
    const html = renderToStaticMarkup(<GuestLandingDetails />);

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
    const html = renderToStaticMarkup(<SeoPrerenderedLanding />);

    expect(html).toContain('<main id="main-content"');
    expect(html).toContain("Play Flesh and Blood online for free");
    expect(html).toContain("Terms of Service");
    expect(html).toContain("Privacy Policy");
  });
});
