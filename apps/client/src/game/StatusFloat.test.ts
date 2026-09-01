import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { damagePacketsFromLog, lifeChange, StatusFloat } from "./StatusFloat.js";

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
    const html = renderToStaticMarkup(createElement(StatusFloat, {
      dockRect: null,
      oppLife: 20,
      myLife: 19,
      oppHeroName: "Rhinar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 0,
      passLabel: "CONFIRM",
      onPass: vi.fn(),
    }));

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
    ["END TURN", "End turn (Space)"],
    ["PASS", "Pass (Space)"],
    ["NO BLOCK", "Confirm no blocks (Space)"],
  ])("renders the derived %s primary action", (passLabel, title) => {
    const html = renderToStaticMarkup(createElement(StatusFloat, {
      dockRect: null,
      oppLife: 20,
      myLife: 20,
      oppHeroName: "Rhinar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 1,
      passLabel,
      onPass: vi.fn(),
    }));

    expect(html).toContain(title);
    expect(html).toContain("game-hud");
  });

  it("disables the primary action while its room command is pending", () => {
    const html = renderToStaticMarkup(createElement(StatusFloat, {
      dockRect: null,
      oppLife: 20,
      myLife: 20,
      oppHeroName: "Rhinar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 1,
      passLabel: "END TURN",
      passDisabled: true,
      onPass: vi.fn(),
    }));

    expect(html).toContain("disabled");
    expect(html).toContain("End turn (Space)");
  });

  it("shows action points without duplicating the board's turn status", () => {
    const html = renderToStaticMarkup(createElement(StatusFloat, {
      dockRect: null,
      oppLife: 20,
      myLife: 20,
      oppHeroName: "Briar",
      myHeroName: "Briar",
      log: [],
      activeHeroName: "Briar",
      actionPoints: 2,
      passLabel: null,
      onPass: vi.fn(),
    }));

    expect(html).toContain("2 action points remaining");
    expect(html).not.toContain("TURN");
  });
});
