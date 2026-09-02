import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeSetScripts } from "../scripts/shared-helpers.js";

const scriptsDir = fileURLToPath(new URL("../scripts/", import.meta.url));
const cardsDir = fileURLToPath(new URL("../data/cards/", import.meta.url));

function entriesAt(path: string) {
  return readdirSync(path, { withFileTypes: true });
}

function scriptSources(path: string): Array<{ path: string; source: string }> {
  return entriesAt(path).flatMap((entry) => {
    const entryPath = `${path}/${entry.name}`;
    if (entry.isDirectory()) return scriptSources(entryPath);
    return entry.name.endsWith(".ts")
      ? [{ path: entryPath.slice(scriptsDir.length + 1), source: readFileSync(entryPath, "utf8") }]
      : [];
  });
}

describe("card script layout", () => {
  const rootEntries = entriesAt(scriptsDir);
  const setEntryPoints = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name.slice(0, -3))
    .filter((name) => name !== "index" && name !== "shared-helpers")
    .sort();
  const setDirectories = rootEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const dataSets = new Set(
    entriesAt(cardsDir)
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5).toLowerCase()),
  );

  it("uses one root entry point named after each scripted set", () => {
    expect(setEntryPoints.every((set) => dataSets.has(set))).toBe(true);
    expect(setEntryPoints.some((set) => set.includes("-"))).toBe(false);
  });

  it("keeps every set partition under its canonical entry point", () => {
    for (const set of setDirectories) {
      expect(setEntryPoints, `${set}/ has a ${set}.ts entry point`).toContain(set);

      const entryPoint = readFileSync(`${scriptsDir}/${set}.ts`, "utf8");
      const partitions = entriesAt(`${scriptsDir}/${set}`);
      expect(partitions.length, `${set}/ is not empty`).toBeGreaterThan(0);

      for (const partition of partitions) {
        expect(partition.isFile(), `${set}/${partition.name} is a file`).toBe(true);
        expect(partition.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/);
        expect(
          entryPoint.includes(`./${set}/${partition.name.slice(0, -3)}.js`),
          `${set}.ts imports ${set}/${partition.name}`,
        ).toBe(true);
      }
    }
  });

  it("rejects duplicate functional keys between set partitions", () => {
    expect(() => mergeSetScripts(
      "TST",
      { "example|1": {} },
      { "example|1": {} },
    )).toThrow('duplicate functional script key "example|1" within set TST');
  });

  it("registers set entry points in alphabetical path order", () => {
    const indexSource = readFileSync(`${scriptsDir}/index.ts`, "utf8");
    const registeredPaths = Array.from(
      indexSource.matchAll(/from "\.\/([^/"]+)\.js";/g),
      (match) => match[1]!,
    );
    const registeredCodes = Array.from(
      indexSource.matchAll(/^ {2}(?:"([A-Z0-9]+)"|([A-Z0-9]+)): [a-zA-Z0-9]+,$/gm),
      (match) => match[1] ?? match[2]!,
    );

    expect(registeredPaths).toEqual([...setEntryPoints].sort());
    expect(registeredCodes).toEqual(setEntryPoints.map((set) => set.toUpperCase()));
  });

  it("uses computed types whenever a card instance is available", () => {
    const rawTypeReads = scriptSources(scriptsDir).flatMap(({ path, source }) =>
      source.split("\n").flatMap((line, index) =>
        /\.(?:classes|subtypes)\b/.test(line)
          ? [`${path}:${index + 1}:${line.trim()}`]
          : [],
      ),
    );

    expect(rawTypeReads).toEqual([
      "cru/high-rarity.ts:408:const heroClass = heroData.classes?.[0];",
      "pen.ts:78:return [...(d.classes ?? []), ...(d.subtypes ?? [])].some(",
      "sea.ts:37:return [...(d.classes ?? []), ...(d.subtypes ?? [])].some((value) => value.toLowerCase() === wanted);",
    ]);
  });
});
