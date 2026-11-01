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
      onToggleWeapon: vi.fn(), onToggleEquipment: vi.fn(), onMoveMainCopy: vi.fn(), onRestoreMain: vi.fn(), onInspectCard: vi.fn(),
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
    expect(render("deck")).toContain('aria-label="Main deck (1 / 60 min)"');
    expect(render("deck")).toContain('class="invalid">1</strong>');
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
      onRestoreMain: vi.fn(),
      onInspectCard: vi.fn(),
    })));

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Remove Compass of Sunken Depths");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Select Balance of Justice for head");
    expect(html).toContain("prep-card-check");
    expect(html).toContain("card-artwork-placeholder");
    expect(html).toContain("Compass of Sunken Depths");
  });

  it("lists each main-deck card once with a copy count and steppers", () => {
    const pool: DeckPool = {
      heroId: "HVY195",
      weaponIds: [],
      equipmentPool: [],
      deck: ["HVY103", "HVY103", "HVY103"],
    };
    const render = (main: Map<string, number>, mainCount: number) =>
      renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
        sections: "deck",
        showHero: true,
        pool,
        selection: { forDeck: "deck", weaponIndexes: [], equipment: {}, main },
        selectionKey: "deck",
        locked: false,
        mainCount,
        minimumMainCount: 60,
        inventoryCount: 3 - mainCount,
        poolMainEntries: [["HVY103", 3]],
        fixedInventoryCounts: new Map(),
        onToggleWeapon: vi.fn(),
        onToggleEquipment: vi.fn(),
        onMoveMainCopy: vi.fn(),
        onRestoreMain: vi.fn(),
        onInspectCard: vi.fn(),
      })));

    const full = render(new Map([["HVY103", 3]]), 3);
    expect(full.match(/HVY103\.webp/g)).toHaveLength(1);
    expect(full).toContain('class="prep-copies">3<');
    expect(full).toContain("Up the Ante");
    expect(full).toContain('aria-label="Move one copy of Up the Ante to Inventory"');
    // Every copy is already in: the add stepper waits, disabled.
    expect(full).toMatch(/Move one copy of Up the Ante to Main deck" class="prep-step" disabled=""/);
    expect(full).not.toContain("Reset deck");
    expect(full).toContain("3 blue");
    // The bar shows shares; the figures beside it carry the counts, zeros muted.
    expect(full).toContain('class="prep-pitch-3" style="flex-grow:3"></span>');
    expect(full).toContain('<span class="empty"><i class="prep-pitch prep-pitch-1"></i>0</span>');
    expect(full).toContain('<span><i class="prep-pitch prep-pitch-3"></i>3</span>');

    const trimmed = render(new Map([["HVY103", 2]]), 2);
    expect(trimmed).toContain("Reset deck");
    expect(trimmed).not.toMatch(/to Main deck" class="prep-step" disabled=""/);
    // The inventory row steps the same card from its own side.
    expect(trimmed.match(/aria-label="Move one copy of Up the Ante to Main deck"/g)).toHaveLength(2);
    // Inventory rows offer only the add step.
    expect(trimmed.split("prep-inventory-zone")[1]).not.toContain("minus.svg");
    expect(trimmed).toContain("2 blue");
  });

  it("labels non-attack rows by type and keeps inventory-only cards locked", () => {
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      sections: "deck",
      showHero: true,
      pool: { heroId: "HVY195", weaponIds: [], equipmentPool: [], deck: ["WTR218"] },
      selection: { forDeck: "deck", weaponIndexes: [], equipment: {}, main: new Map([["WTR218", 1]]) },
      selectionKey: "deck",
      locked: false,
      mainCount: 1,
      minimumMainCount: 60,
      inventoryCount: 1,
      poolMainEntries: [["WTR218", 1]],
      fixedInventoryCounts: new Map([["WTR215", 1]]),
      onToggleWeapon: vi.fn(),
      onToggleEquipment: vi.fn(),
      onMoveMainCopy: vi.fn(),
      onRestoreMain: vi.fn(),
      onInspectCard: vi.fn(),
    })));

    expect(html).toContain('class="prep-row-type">Action<');
    expect(html).toContain('class="prep-row-type">Stays in inventory<');
    expect(html).toContain('class="prep-row fixed"');
    expect(html).not.toContain("Move one copy of Sink Below to Main deck");
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
      onRestoreMain: vi.fn(),
      onInspectCard: vi.fn(),
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
          onRestoreMain={vi.fn()}
          onInspectCard={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("对局配置");
    expect(html).toContain("主牌组（0 / 至少 60 张）");
    expect(html).toContain("备牌区中没有卡牌");
  });
  describe("cards view", () => {
    const renderDeck = (compact: boolean, inventoryCount = 3) => renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(PrepPresentation, {
      sections: "deck",
      showHero: true,
      compact,
      pool: { heroId: "HVY195", weaponIds: [], equipmentPool: [], deck: ["WTR218", "WTR219", "WTR219"] },
      selection: {
        forDeck: "deck",
        weaponIndexes: [],
        equipment: {},
        // Nimblism is split; Sink Below keeps its one registered copy.
        main: new Map([["WTR218", 1], ["WTR219", 1]]),
      },
      selectionKey: "deck",
      locked: false,
      mainCount: 2,
      minimumMainCount: 60,
      inventoryCount,
      poolMainEntries: [["WTR219", 2], ["WTR218", 1]],
      fixedInventoryCounts: inventoryCount > 1 ? new Map([["WTR215", 1]]) : new Map(),
      onToggleWeapon: vi.fn(),
      onToggleEquipment: vi.fn(),
      onMoveMainCopy: vi.fn(),
      onRestoreMain: vi.fn(),
      onInspectCard: vi.fn(),
    })));

    afterEach(() => vi.unstubAllGlobals());

    it("defaults to the list on a fine pointer and offers the switch", () => {
      vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
      const html = renderDeck(false);
      expect(html).toContain('role="group" aria-label="View"');
      expect(html).toContain('aria-pressed="true">List</button>');
      // On a desktop the inventory column follows the chosen view.
      expect(html).toContain("prep-row");
      expect(html).not.toContain("prep-tile");
    });

    it("renders a remembered cards view as whole-card buttons with copy badges", () => {
      vi.stubGlobal("localStorage", { getItem: () => "cards", setItem: vi.fn() });
      const html = renderDeck(false);
      expect(html).toContain('aria-pressed="true">Cards</button>');
      expect(html).not.toContain("prep-step");
      expect(html).not.toContain("prep-ledger-head");
      const [main, inventory] = html.split("prep-inventory-zone");
      expect(main).toContain('class="prep-tile" data-cardid="WTR219"');
      expect(main).toContain('aria-label="Move one copy of Nimblism to Inventory"');
      expect(main).toContain('aria-hidden="true">×1</span><span class="prep-sr-only">1 copy</span>');
      expect(inventory).toContain('aria-label="Move one copy of Nimblism to Main deck"');
      // Inventory-only cards show as a locked, unpressable tile.
      expect(inventory).toContain('class="prep-tile fixed" data-cardid="WTR215"');
      expect(inventory).toContain('<span class="prep-tile-face" role="img" aria-label="Sink Below"');
      expect(inventory).toContain("prep-tile-lock");
    });

    it("docks inventory on phones as a collapsed bar in either view", () => {
      vi.stubGlobal("localStorage", { getItem: () => "list", setItem: vi.fn() });
      const html = renderDeck(true);
      expect(html).not.toContain("prep-inventory-zone");
      expect(html).toContain('class="prep-tray"');
      expect(html).toContain('aria-label="Inventory (3)"');
      expect(html).toContain('aria-label="Show all" aria-expanded="false"');
      const tray = html.split('class="prep-tray"')[1];
      expect(tray).not.toContain("prep-tile");
      expect(tray).not.toContain("prep-row");
      // The main deck still lists rows in list view.
      expect(html.split("prep-tray")[0]).toContain('class="prep-copies">1<');
    });

    it("explains the empty tray instead of offering to expand it", () => {
      vi.stubGlobal("localStorage", { getItem: () => "cards", setItem: vi.fn() });
      const html = renderDeck(true, 0);
      expect(html).toContain("Cards you set aside go here.");
      expect(html).not.toContain("Show all");
    });
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
      onRestoreMain: vi.fn(),
      onInspectCard: vi.fn(),
    })));
    const order = (html: string, zone: number) =>
      [...html.split("prep-deck-zone")[zone + 1]!.matchAll(/class="prep-(?:row|tile)[^"]*" data-cardid="([^"]+)"/g)].map((m) => m[1]);

    afterEach(() => vi.unstubAllGlobals());

    it("sorts both zones by name, then pitch, by default", () => {
      vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
      const html = renderDeck();
      expect(html).toContain('role="group" aria-label="Sort by"');
      expect(html).toContain('aria-pressed="true">Name</button>');
      expect(html).not.toContain("Zone order");
      expect(html).not.toContain("prep-group-title");
      expect(order(html, 0)).toEqual(["WTR218", "WTR219"]);
      expect(order(html, 1)).toEqual(["WTR219", "WTR215", "WTR217"]);
    });

    it("restores a remembered pitch sort", () => {
      vi.stubGlobal("localStorage", { getItem: () => "pitch", setItem: vi.fn() });
      const html = renderDeck();
      expect(html).toContain('aria-pressed="true"><span class="card-sort-pips"');
      // Groups name the color; the counts stay with the bar.
      expect(html).toContain('prep-pitch-2" aria-hidden="true"></i>Yellow</span>');
      expect(html).toContain('prep-pitch-3" aria-hidden="true"></i>Blue</span>');
      expect(html).toContain('prep-pitch-legend');
      expect(order(html, 0)).toEqual(["WTR218", "WTR219"]);
      expect(order(html, 1)).toEqual(["WTR215", "WTR219", "WTR217"]);
    });
  });
});
