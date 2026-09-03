import { describe, expect, it } from "vitest";
import type { ActivatedAbility, CardScript } from "@fyendal/engine";
import { scripts } from "../index.js";
import { printingId } from "./harness.js";

function ability(key: string, index = 0): ActivatedAbility {
  const activated = (scripts[printingId(key)] as CardScript | undefined)?.activated;
  const found = Array.isArray(activated) ? activated[index] : activated;
  expect(found, `${key} ability ${index} is missing`).toBeDefined();
  return found!;
}

describe("printed activated counter costs", () => {
  it.each([
    ["teklo plasma pistol|0", 0, "steam"],
    ["plasma barrel shot|0", 0, "steam"],
    ["cognition nodes|3", 1, "steam"],
    ["convection amplifier|1", 0, "steam"],
    ["optekal monocle|3", 0, "steam"],
    ["ghostly touch|0", 0, "haunt"],
    ["restless coalescence|2", 0, "power"],
  ] as const)("%s removes its %s counter as an activation cost", (key, index, counter) => {
    expect(ability(key, index).removeCounterCost).toEqual({ key: counter, amount: 1 });
  });

  it.each([
    ["talishar, the lost prince|0", "rust"],
    ["spellbound creepers|0", "bind"],
  ] as const)("%s puts its %s counter on as an activation cost", (key, counter) => {
    expect(ability(key).putCounterCost).toEqual({ key: counter, amount: 1 });
  });

  it("Paragon Plate removes a power counter from the attacking sword as a cost", () => {
    expect(ability("paragon plate|0").removeAttackCounterCost).toEqual({ key: "power", amount: 1 });
  });

  it("Blaze declares and removes X energy counters as a variable activation cost", () => {
    expect(ability("blaze, firemind|0").variableCost).toMatchObject({
      resourcesPerX: 0,
      counterKey: "blazeX",
      removeCounterKey: "energy",
    });
  });
});
