import { describe, expect, it } from "vitest";
import { scripts } from "../index.js";
import { printingId } from "./harness.js";

describe("printed variable costs", () => {
  it.each([
    ["dig for souls|1", 0, 1],
    ["germinate|3", 0, 2],
    ["hyper scrapper|3", 0, 1],
    ["ice eternal|3", 0, 2],
    ["imposing visage|3", 3, 1],
    ["meganetic lockwave|3", 0, 3],
    ["moonshot|2", 0, 2],
    ["ransack and raze|3", 0, 1],
    ["recede to mistform|3", 0, 1],
    ["reel in|3", 0, 1],
    ["roiling fissure|3", 1, 1],
    ["scour|3", 0, 1],
    ["sonata arcanix|1", 0, 2],
    ["sonata fantasmia|3", 0, 2],
    ["sonata galaxia|1", 0, 2],
    ["spark of genius|2", 0, 2],
    ["supercell|3", 0, 1],
    ["system reset|2", 0, 1],
    ["tectonic rift|3", 0, 1],
    ["up the ante|3", 0, 1],
    ["visit anvilheim|3", 0, 1],
  ] as const)("%s uses base %i and %i resource(s) per X", (key, base, resourcesPerX) => {
    const variable = scripts[printingId(key)]?.variablePlayCost;
    expect(variable, `${key} should declare X before pitching`).toBeDefined();
    expect(variable?.base).toBe(base);
    expect(variable?.resourcesPerX ?? 1).toBe(resourcesPerX);
  });

  it("Touch of Reality declares its activated X cost before pitching", () => {
    const activated = scripts[printingId("touch of reality|0")]?.activated;
    expect(Array.isArray(activated) ? activated[0]?.variableCost : activated?.variableCost)
      .toEqual(expect.objectContaining({ base: 0, counterKey: "wardX" }));
  });
});
