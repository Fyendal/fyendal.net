import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeckPool } from "@fyendal/shared";
import { PrepPresentation } from "./PrepPresentation.js";

describe("PrepPresentation equipment controls", () => {
  it("exposes weapon and equipment selection as pressed buttons", () => {
    const pool: DeckPool = {
      heroId: "HVY195",
      weaponIds: ["SEA045"],
      equipmentPool: ["HVY195"],
      deck: [],
    };
    const html = renderToStaticMarkup(createElement(PrepPresentation, {
      pool,
      selection: {
        forDeck: "deck",
        weapons: ["SEA045"],
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
    }));

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
    const html = renderToStaticMarkup(createElement(PrepPresentation, {
      pool,
      selection: {
        forDeck: "deck",
        weapons: [],
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
    }));

    expect(html.match(/HVY103\.webp/g)).toHaveLength(3);
    expect(html).not.toContain("prep-stack-count");
  });
});
