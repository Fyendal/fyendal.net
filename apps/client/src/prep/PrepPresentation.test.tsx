import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeckPool } from "@fyendal/shared";
import { PrepPresentation } from "./PrepPresentation.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("PrepPresentation equipment controls", () => {
  it("hides main-deck controls during arena selection and disables equipment after lock", () => {
    const props = {
      pool: { heroId: "HVY195", weaponIds: ["SEA045"], equipmentPool: ["HVY195"], deck: ["HVY103"] },
      selection: { forDeck: "deck", weaponIndexes: [0], equipment: {}, main: new Map([["HVY103", 1]]) },
      selectionKey: "deck",
      showHero: true, mainCount: 1, minimumMainCount: 60, inventoryCount: 0, poolMainEntries: [["HVY103", 1]] as [string, number][],
      fixedInventoryCounts: new Map<string, number>(),
      onToggleWeapon: vi.fn(), onToggleEquipment: vi.fn(), onMoveMainCopy: vi.fn(),
    };
    const render = (sections: "arena" | "deck") => renderToStaticMarkup(createElement(
      TestI18nProvider, null,
      createElement(PrepPresentation, { ...props, sections, locked: sections === "arena" }),
    ));
    expect(render("arena")).not.toContain("prep-deck-zone");
    expect(render("arena")).not.toContain("panel prep-pool");
    expect(render("arena")).not.toContain("Your presentation");
    expect(render("arena")).toContain('disabled="" aria-pressed="true"');
    expect(render("deck")).not.toContain("prep-card-choice");
    expect(render("deck")).not.toContain("SEA045.webp");
    expect(render("deck")).toContain("prep-deck-zone");
    expect(render("deck")).toContain("Move one copy of Up the Ante to Inventory");
  });

  it("exposes weapon and equipment selection as pressed buttons", () => {
    const pool: DeckPool = {
      heroId: "HVY195",
      weaponIds: ["SEA045"],
      equipmentPool: ["HVY195"],
      deck: [],
    };
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      sections: "arena",
      showHero: true,
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
    expect(html).toContain("card-artwork-placeholder");
    expect(html).toContain("Compass of Sunken Depths");
  });

  it("shows copy counts through stacked card faces without a duplicate badge", () => {
    const pool: DeckPool = {
      heroId: "HVY195",
      weaponIds: [],
      equipmentPool: [],
      deck: [],
    };
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      sections: "deck",
      showHero: true,
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
    expect(html.match(/loading="eager"/g)).toHaveLength(3);
    expect(html.match(/card-artwork-placeholder/g)).toHaveLength(3);
    expect(html).toContain("Up the Ante");
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
      sections: "arena",
      showHero: true,
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
          sections="deck"
          showHero
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
  describe("deck sorting", () => {
    const renderDeck = () => renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      sections: "deck",
      showHero: true,
      pool: { heroId: "HVY195", weaponIds: [], equipmentPool: [], deck: [] },
      selection: {
        forDeck: "deck",
        weaponIndexes: [],
        equipment: {},
        // Sink Below (blue) is fully in inventory; Nimblism (yellow) is split.
        main: new Map([["WTR218", 1], ["WTR219", 1]]),
      },
      selectionKey: "deck",
      locked: false,
      mainCount: 2,
      minimumMainCount: 60,
      inventoryCount: 3,
      poolMainEntries: [["WTR217", 1], ["WTR219", 2], ["WTR218", 1]],
      fixedInventoryCounts: new Map([["WTR215", 1]]),
      onToggleWeapon: vi.fn(),
      onToggleEquipment: vi.fn(),
      onMoveMainCopy: vi.fn(),
    })));
    const order = (html: string, zone: number) =>
      [...html.split("prep-deck-zone")[zone + 1]!.matchAll(/prep-stack-button"[^>]*?data-cardid="([^"]+)"/g)].map((m) => m[1]);

    afterEach(() => vi.unstubAllGlobals());

    it("sorts both zones by name, then pitch, by default", () => {
      vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
      const html = renderDeck();
      expect(html).toContain('role="group" aria-label="Sort by"');
      expect(html).toContain('aria-pressed="true">Name</button>');
      expect(html).not.toContain("Zone order");
      expect(order(html, 0)).toEqual(["WTR218", "WTR219"]);
      expect(order(html, 1)).toEqual(["WTR219", "WTR215", "WTR217"]);
    });

    it("restores a remembered pitch sort", () => {
      vi.stubGlobal("localStorage", { getItem: () => "pitch", setItem: vi.fn() });
      const html = renderDeck();
      expect(html).toContain('aria-pressed="true"><span class="card-sort-pips"');
      expect(order(html, 0)).toEqual(["WTR218", "WTR219"]);
      expect(order(html, 1)).toEqual(["WTR215", "WTR219", "WTR217"]);
    });
  });
});
