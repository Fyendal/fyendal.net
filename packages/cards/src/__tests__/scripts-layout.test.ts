import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { cardData } from "../catalog.js";
import { mergeSetScripts } from "../scripts/shared-helpers.js";
import * as canonicalTokens from "../scripts/tokens.js";

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
    .filter((name) => name !== "index" && name !== "shared-helpers" && name !== "tokens")
    .sort();
  const setDirectories = rootEntries
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
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

  it("refers only to printings that exist", () => {
    const unknown = scriptSources(scriptsDir).flatMap(({ path, source }) =>
      Array.from(source.matchAll(/"([A-Z0-9]{3}\d{3}[A-Z]?)"/g), (match) => match[1]!)
        .filter((id) => !cardData[id])
        .map((id) => `${path}:${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it("takes created-card ids only from tokens.ts", () => {
    const canonicalIds = new Set<string>(Object.values(canonicalTokens));
    const createdNames = new Set([...canonicalIds].map((id) => cardData[id]!.name));
    const local = scriptSources(scriptsDir)
      .filter(({ path }) => path !== "tokens.ts")
      .flatMap(({ path, source }) =>
        Array.from(source.matchAll(/"([A-Z0-9]{3}\d{3}[A-Z]?)"/g), (match) => match[1]!)
          .filter((id) => {
            const card = cardData[id];
            return card && (card.types.includes("token") || createdNames.has(card.name));
          })
          .map((id) => `${path}:${id}`),
      );
    expect(local).toEqual([]);
  });

  it("names each canonical created card after a full-size printing the engine creates", () => {
    const normalized = (name: string) =>
      name.toUpperCase().replace(/'/g, "").replace(/\bTHE\b/g, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const firstTokenByName = new Map<string, string>();
    for (const card of Object.values(cardData)) {
      if (card.types.includes("token") && !firstTokenByName.has(card.name)) firstTokenByName.set(card.name, card.id);
    }
    for (const [constant, id] of Object.entries(canonicalTokens)) {
      const card = cardData[id];
      expect(card, `${constant} = ${id}`).toBeDefined();
      const name = normalized(card!.name);
      expect(name === constant || name.startsWith(`${constant}_`), `${constant} = ${id} (${card!.name})`).toBe(true);
      // SUP239-SUP242 images are sheets of two sideways half cards.
      expect(id, constant).not.toMatch(/^SUP2(?:39|4[0-2])$/);
      if (card!.types.includes("token")) {
        expect(firstTokenByName.get(card!.name), `engine creates ${card!.name} as ${id}`).toBe(id);
      } else {
        expect(card!.keywords ?? [], `${constant} is a token or an ephemeral card`).toContain("Ephemeral");
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

  it("keeps every shared export used by more than one set or by other shared code", () => {
    // Single-set helpers that stay shared, each with why.
    const singleSetAllowlist: Record<string, string> = {
      galvanize: "Galvanize keyword mechanic, with its stored-decision hook",
      beatenChest: "reads the flag beatChest sets",
      withdrawNextArcaneDamageCard: "undoes buffNextArcaneDamageCard's pool bookkeeping",
    };
    // Shared exports only tests import, each with why.
    const testOnlyAllowlist: Record<string, string> = {
      printedDirectArcaneDamageEffect: "completeness.test.ts checks Wizard arcane markers against printed text",
    };
    const sources = scriptSources(scriptsDir);
    const sharedModules = sources.filter(({ path }) => path.startsWith("shared/"));
    const owner = new Map<string, { module: string; localUse: boolean }>();
    for (const { path, source } of sharedModules) {
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const exported = file.statements.flatMap((statement) => {
        if (!ts.canHaveModifiers(statement)) return [];
        if (!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
        if (ts.isVariableStatement(statement))
          return statement.declarationList.declarations.map((declaration) => (declaration.name as ts.Identifier).text);
        const name = (statement as ts.DeclarationStatement).name;
        return name && ts.isIdentifier(name) ? [name.text] : [];
      });
      const uses = new Map<string, number>();
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) uses.set(node.text, (uses.get(node.text) ?? 0) + 1);
        ts.forEachChild(node, visit);
      };
      visit(file);
      for (const name of exported) owner.set(name, { module: path, localUse: (uses.get(name) ?? 0) > 1 });
    }
    const setUsers = new Map<string, Set<string>>();
    const sharedUsers = new Map<string, Set<string>>();
    for (const { path, source } of sources) {
      if (path === "shared-helpers.ts") continue;
      for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
        const from = match[2]!;
        const fromShared = /(?:^|\/)(?:shared-helpers|shared\/[a-z-]+)\.js$/.test(from) ||
          (path.startsWith("shared/") && /^\.\/[a-z-]+\.js$/.test(from));
        if (!fromShared) continue;
        for (const specifier of match[1]!.split(",")) {
          const name = specifier.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!;
          if (!name) continue;
          const users = path.startsWith("shared/") ? sharedUsers : setUsers;
          const user = path.startsWith("shared/") ? path : path.split("/")[0]!.replace(/\.ts$/, "");
          users.set(name, (users.get(name) ?? new Set()).add(user));
        }
      }
    }
    const unused: string[] = [];
    const singleSet: string[] = [];
    for (const [name, { module, localUse }] of owner) {
      const sets = setUsers.get(name) ?? new Set();
      const shared = sharedUsers.get(name) ?? new Set();
      if (sets.size === 0 && shared.size === 0 && !(name in testOnlyAllowlist)) unused.push(`${module}:${name}`);
      else if (sets.size === 1 && shared.size === 0 && !localUse && !(name in singleSetAllowlist))
        singleSet.push(`${module}:${name} (only ${[...sets][0]})`);
    }
    expect(unused, "shared exports nothing imports; make them private or delete them").toEqual([]);
    expect(singleSet, "shared exports one set uses; move them into that set").toEqual([]);
    for (const name of [...Object.keys(singleSetAllowlist), ...Object.keys(testOnlyAllowlist)])
      expect(owner.has(name), `${name} is still shared`).toBe(true);
  });

  it("uses only common message ids in shared code", () => {
    const used = scriptSources(scriptsDir)
      .filter(({ path }) => path.startsWith("shared/"))
      .flatMap(({ source }) => Array.from(source.matchAll(/"(card\.[a-z0-9.]+)"/g), (match) => match[1]!))
      .filter((id) => !/^card\.(?:common|trigger\.common|log\.common)\./.test(id));
    expect([...new Set(used)].sort()).toEqual([]);
  });

  it("uses computed types whenever a card instance is available", () => {
    const rawTypeReads = scriptSources(scriptsDir).flatMap(({ path, source }) =>
      source.split("\n").flatMap((line) =>
        /\.(?:classes|subtypes)\b/.test(line)
          ? [`${path}:${line.trim()}`]
          : [],
      ),
    );

    expect(rawTypeReads).toEqual([
      "cru/high-rarity.ts:const heroClass = heroData.classes?.[0];",
      "pen.ts:return [...(d.classes ?? []), ...(d.subtypes ?? [])].includes(tag);",
    ]);
  });

  it("reads printed card types only for bare card ids", () => {
    const printedTypeReads = scriptSources(scriptsDir).flatMap(({ path, source }) =>
      source.split("\n").flatMap((line) =>
        /\b(?:hasType|hasPrintedType)\(/.test(line) && !line.trim().startsWith("import")
          ? [`${path}:${line.trim()}`]
          : [],
      ),
    );

    expect(printedTypeReads).toEqual([
      "hvy/high-rarity.ts:return cause.sourceCardId && hasType(ctx.cardData(cause.sourceCardId), \"action\") && count > 0",
      "mst.ts:ctx.cardIdsNamed(name).find((cardId) => hasPrintedType(ctx.cardData(cardId), \"token\"));",
      "pen.ts:const heroId = ctx.cardIdsNamed(name).find((cardId) => hasType(ctx.cardData(cardId), \"hero\"));",
      "pen.ts:const heroId = ctx.cardIdsNamed(option).find((cardId) => hasType(ctx.cardData(cardId), \"hero\"));",
    ]);
  });

  it("uses effective keywords whenever a card instance is available", () => {
    const rawKeywordReads = scriptSources(scriptsDir).flatMap(({ path, source }) =>
      source.split("\n").flatMap((line) =>
        /\.(?:keywords|grantedKeywords|suppressedKeywords)\b/.test(line) && !line.trim().startsWith("//")
          ? [`${path}:${line.trim()}`]
          : [],
      ),
    );

    expect(rawKeywordReads).toEqual([
      "shared/arsenal.ts:return (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase().includes(\"specialization\"));",
    ]);
  });
});
