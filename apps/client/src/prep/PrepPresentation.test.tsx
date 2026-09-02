import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeckPool } from "@fyendal/shared";
import { PrepPresentation } from "./PrepPresentation.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("PrepPresentation equipment controls", () => {
  it("exposes weapon and equipment selection as pressed buttons", () => {
    const pool: DeckPool = {
      heroId: "HVY195",
      weaponIds: ["SEA045"],
      equipmentPool: ["HVY195"],
      deck: [],
    };
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      pool,
      selection: {
        forDeck: "deck",
        weaponIndexes: [0],
        equipment: {},
        main: new Map(),
      },
      selectionKey: "deck",
      locked: false,
      mainCount: 0,
      minimumMainCount: 60,
      inventoryCount: 0,
      poolMainEntries: [],
      fixedInventoryCounts: new Map(),
      onToggleWeapon: vi.fn(),
      onToggleEquipment: vi.fn(),
      onMoveMainCopy: vi.fn(),
    })));

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Remove Compass of Sunken Depths");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Select Balance of Justice for head");
    expect(html).toContain("prep-card-check");
  });

  it("shows copy counts through stacked card faces without a duplicate badge", () => {
    const pool: DeckPool = {
      heroId: "HVY195",
      weaponIds: [],
      equipmentPool: [],
      deck: [],
    };
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      pool,
      selection: {
        forDeck: "deck",
        weaponIndexes: [],
        equipment: {},
        main: new Map([["HVY103", 3]]),
      },
      selectionKey: "deck",
      locked: false,
      mainCount: 3,
      minimumMainCount: 60,
      inventoryCount: 0,
      poolMainEntries: [["HVY103", 3]],
      fixedInventoryCounts: new Map(),
      onToggleWeapon: vi.fn(),
      onToggleEquipment: vi.fn(),
      onMoveMainCopy: vi.fn(),
    })));

    expect(html.match(/HVY103\.webp/g)).toHaveLength(3);
    expect(html).not.toContain("prep-stack-count");
  });

  it("tracks separately registered copies of the same weapon independently", () => {
    const pool: DeckPool = {
      heroId: "HNT054",
      weaponIds: ["GEM003", "GEM003"],
      equipmentPool: [],
      deck: [],
    };
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      pool,
      selection: {
        forDeck: "deck",
        weaponIndexes: [0],
        equipment: {},
        main: new Map(),
      },
      selectionKey: "deck",
      locked: false,
      mainCount: 0,
      minimumMainCount: 60,
      inventoryCount: 0,
      poolMainEntries: [],
      fixedInventoryCounts: new Map(),
      onToggleWeapon: vi.fn(),
      onToggleEquipment: vi.fn(),
      onMoveMainCopy: vi.fn(),
    })));

    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(html).toContain("Remove Kunai of Retribution");
    expect(html).toContain("Select Kunai of Retribution");
  });

  it("renders deck-building controls in Simplified Chinese", () => {
    const pool: DeckPool = {
      heroId: "HVY195",
      weaponIds: [],
      equipmentPool: [],
      deck: [],
    };
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <PrepPresentation
          pool={pool}
          selection={{
            forDeck: "deck",
            weaponIndexes: [],
            equipment: {},
            main: new Map(),
          }}
          selectionKey="deck"
          locked={false}
          mainCount={0}
          minimumMainCount={60}
          inventoryCount={0}
          poolMainEntries={[]}
          fixedInventoryCounts={new Map()}
          onToggleWeapon={vi.fn()}
          onToggleEquipment={vi.fn()}
          onMoveMainCopy={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("对局配置");
    expect(html).toContain("主牌组（0 / 至少 60 张）");
    expect(html).toContain("备牌区中没有卡牌");
  });
});
