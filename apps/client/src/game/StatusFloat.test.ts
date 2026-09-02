import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { damagePacketsFromLog, lifeChange, StatusFloat } from "./StatusFloat.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

function renderStatus(props: ComponentProps<typeof StatusFloat>, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(createElement(
    TestI18nProvider,
    { locale, children: createElement(StatusFloat, props) },
  ));
}

describe("life change animation", () => {
  it("describes damage when life decreases", () => {
    expect(lifeChange(20, 16)).toEqual({ amount: 4, kind: "damage" });
    expect(lifeChange(1, -2)).toEqual({ amount: 3, kind: "damage" });
  });

  it("describes life gain when life increases", () => {
    expect(lifeChange(16, 20)).toEqual({ amount: 4, kind: "gain" });
  });

  it("does not animate an unchanged total", () => {
    expect(lifeChange(20, 20)).toBeNull();
  });

  it("recovers separate damage packets from one batched server update", () => {
    const previous = ["Runechant triggers"];
    const current = [
      ...previous,
      "Dorinthea Ironsong takes 1 arcane damage (19 life left)",
      "Runechant is destroyed",
      "Dorinthea Ironsong takes 1 arcane damage (18 life left)",
      "Dorinthea Ironsong takes 1 arcane damage (17 life left)",
    ];

    expect(damagePacketsFromLog(previous, current, "Dorinthea Ironsong", 3))
      .toEqual([1, 1, 1]);
  });

  it("keeps one damage event as one popup and rejects unrelated log totals", () => {
    const previous = ["before"];
    const current = [
      ...previous,
      "Dorinthea Ironsong takes 3 arcane damage (17 life left)",
    ];

    expect(damagePacketsFromLog(previous, current, "Dorinthea Ironsong", 3))
      .toEqual([3]);
    expect(damagePacketsFromLog(previous, current, "Rhinar", 3)).toBeNull();
  });
});

describe("status action", () => {
  it("uses the status button to confirm staged blocks", () => {
    const html = renderStatus({
      dockRect: null,
      oppLife: 20,
      myLife: 19,
      oppHeroName: "Rhinar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 0,
      primaryAction: "confirm-blocks",
      onPass: vi.fn(),
    });

    expect(html).toContain("Confirm blocks (Space)");
    expect(html).toContain(">CONFIRM<");
    expect(html).toContain("https://content.fabrary.net/heroes/briar.webp");
    expect(html).toContain("https://content.fabrary.net/heroes/rhinar.webp");
    expect(html).toContain("0 action points remaining");
    expect(html).not.toContain("YOUR TURN");
    expect(html).not.toContain("THEIR TURN");
    expect(html).not.toContain(">YOU<");
    expect(html).not.toContain(">OPP<");
    expect(html).not.toContain("player-nameplate");
    expect(html).not.toContain("/logo.png");
  });

  it.each([
    ["end-turn", "End turn (Space)"],
    ["pass", "Pass (Space)"],
    ["confirm-no-blocks", "Confirm no blocks (Space)"],
  ] as const)("renders the derived %s primary action", (primaryAction, title) => {
    const html = renderStatus({
      dockRect: null,
      oppLife: 20,
      myLife: 20,
      oppHeroName: "Rhinar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 1,
      primaryAction,
      onPass: vi.fn(),
    });

    expect(html).toContain(title);
    expect(html).toContain("game-hud");
  });

  it("disables the primary action while its room command is pending", () => {
    const html = renderStatus({
      dockRect: null,
      oppLife: 20,
      myLife: 20,
      oppHeroName: "Rhinar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 1,
      primaryAction: "end-turn",
      passDisabled: true,
      onPass: vi.fn(),
    });

    expect(html).toContain("disabled");
    expect(html).toContain("End turn (Space)");
  });

  it("shows action points without duplicating the board's turn status", () => {
    const html = renderStatus({
      dockRect: null,
      oppLife: 20,
      myLife: 20,
      oppHeroName: "Briar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 2,
      primaryAction: null,
      onPass: vi.fn(),
    });

    expect(html).toContain("2 action points remaining");
    expect(html).not.toContain("TURN");
  });

  it("renders the primary game HUD in Simplified Chinese", () => {
    const html = renderStatus({
      dockRect: null,
      oppLife: 20,
      myLife: 18,
      oppHeroName: "Rhinar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 1,
      primaryAction: "end-turn",
      onPass: vi.fn(),
    }, "zh-Hans");

    expect(html).toContain("对局状态与主要操作");
    expect(html).toContain("结束回合");
    expect(html).toContain("剩余 1 个行动点");
  });
});
