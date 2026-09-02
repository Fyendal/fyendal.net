import { describe, expect, it } from "vitest";
import englishMessages from "./compiled/en.json";
import chineseMessages from "./compiled/zh-Hans.json";
import { createTestIntl } from "./TestI18nProvider.js";

describe("locale catalogs", () => {
  it("keeps Simplified Chinese complete with the English source catalog", () => {
    expect(Object.keys(chineseMessages).sort()).toEqual(Object.keys(englishMessages).sort());
  });

  it("preserves canonical English game keywords in Chinese", () => {
    const intl = createTestIntl("zh-Hans");

    expect(intl.formatMessage({ id: "game.chain.onHit" })).toBe("On hit");
    expect(intl.formatMessage({ id: "game.chain.linksShort" })).toBe("Links");
    expect(intl.formatMessage({ id: "game.timing.actionPhase" })).toBe("ACTION PHASE");
    expect(intl.formatMessage({ id: "game.timing.layerStep" })).toBe("LAYER STEP");
    expect(intl.formatMessage({ id: "game.timing.damageStep" })).toBe("DAMAGE STEP");
    expect(intl.formatMessage(
      { id: "game.chain.link.progress" },
      { link: 2 },
    )).toBe("Link 2：进行中");
    expect(intl.formatMessage({ id: "game.decision.bloodMode.goAgain" }))
      .toBe("攻击获得 go again");
  });
});
