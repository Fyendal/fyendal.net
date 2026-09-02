import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import englishMessages from "./compiled/en.json";
import chineseMessages from "./compiled/zh-Hans.json";
import { createTestIntl } from "./TestI18nProvider.js";

const cardScriptsDirectory = fileURLToPath(
  new URL("../../../../packages/cards/src/scripts/", import.meta.url),
);
const engineSourceDirectory = fileURLToPath(
  new URL("../../../../packages/engine/src/", import.meta.url),
);

function scriptFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const entryPath = `${path}/${entry.name}`;
    if (entry.isDirectory()) return scriptFiles(entryPath);
    return entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

describe("locale catalogs", () => {
  it("keeps Simplified Chinese complete with the English source catalog", () => {
    expect(Object.keys(chineseMessages).sort()).toEqual(Object.keys(englishMessages).sort());
  });

  it("keeps wire-projected engine and card message IDs protocol-safe", () => {
    const semanticMessageId = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
    const wireMessageIds = Object.keys(englishMessages).filter(
      (id) => id.startsWith("engine.") || id.startsWith("card."),
    );

    expect(wireMessageIds).not.toHaveLength(0);
    expect(wireMessageIds.filter((id) => !semanticMessageId.test(id))).toEqual([]);
  });

  it("contains every semantic message referenced by card scripts", () => {
    const referencedIds = new Set(scriptFiles(cardScriptsDirectory).flatMap((path) =>
      Array.from(
        readFileSync(path, "utf8").matchAll(/["']((?:card|common\.option)\.[a-z0-9.]+)["']/g),
        (match) => match[1]!,
      )
    ));
    const catalogIds = new Set(Object.keys(englishMessages));

    expect(
      [...referencedIds].filter((id) => !catalogIds.has(id)).sort(),
    ).toEqual([]);
  });

  it("contains every semantic log message referenced by engine producers", () => {
    const referencedIds = new Set(scriptFiles(engineSourceDirectory).flatMap((path) =>
      Array.from(
        readFileSync(path, "utf8").matchAll(/["'](engine\.log\.[a-zA-Z0-9.]+)["']/g),
        (match) => match[1]!,
      )
    ));
    const catalogIds = new Set(Object.keys(englishMessages));

    expect(
      [...referencedIds].filter((id) => !catalogIds.has(id)).sort(),
    ).toEqual([]);
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
    expect(intl.formatMessage(
      { id: "card.log.common.goagain.gained" },
      { card: "Nimble Strike" },
    )).toBe("Nimble Strike 获得 go again");
    expect(intl.formatMessage(
      { id: "card.log.common.dominate.gained" },
      { card: "Regurgitating Slog" },
    )).toBe("Regurgitating Slog 获得压制 (dominate)");
  });
});
