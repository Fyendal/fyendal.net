import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceDirectory = fileURLToPath(new URL("..", import.meta.url));
const foundationalModules = [
  "zoneQueries.ts",
  "cardProperties.ts",
  "gameLog.ts",
  "combatModifiers.ts",
  "win.ts",
];
const forbiddenDependencies = new Set([
  "./actions.js",
  "./combat.js",
  "./triggers.js",
  "./turn.js",
  "./util.js",
]);
const focusedCombatModules = [
  "attacks.ts",
  "combatValues.ts",
  "defense.ts",
  "reactions.ts",
  "hits.ts",
  "wagers.ts",
  "damage.ts",
  "combatChain.ts",
];
const extractedUtilityModules = [
  "tokens.ts",
  "clash.ts",
  "zoneMoves.ts",
  "priority.ts",
  "eventSources.ts",
  "scriptContext.ts",
];

function localDependencyGraph(includeTypeOnly: boolean): Map<string, string[]> {
  const modules = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
  const known = new Set(modules);
  const graph = new Map(modules.map((name) => [name, [] as string[]]));

  for (const moduleName of modules) {
    const source = ts.createSourceFile(
      moduleName,
      readFileSync(`${sourceDirectory}/${moduleName}`, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith("./")) continue;

      const target = specifier.slice(2).replace(/\.js$/, ".ts");
      if (!known.has(target)) continue;
      if (!includeTypeOnly) {
        const declarationTypeOnly = ts.isImportDeclaration(statement)
          ? statement.importClause?.isTypeOnly === true
          : statement.isTypeOnly;
        const bindingsTypeOnly = ts.isImportDeclaration(statement)
          ? !statement.importClause?.name &&
            statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
            ? statement.importClause.namedBindings.elements.length > 0 &&
              statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)
            : false
          : statement.exportClause && ts.isNamedExports(statement.exportClause)
            ? statement.exportClause.elements.length > 0 &&
              statement.exportClause.elements.every((element) => element.isTypeOnly)
            : false;
        if (declarationTypeOnly || bindingsTypeOnly) continue;
      }
      graph.get(moduleName)!.push(target);
    }
  }
  return graph;
}

function stronglyConnectedComponents(graph: Map<string, string[]>): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(moduleName: string): void {
    indices.set(moduleName, nextIndex);
    lowLinks.set(moduleName, nextIndex++);
    stack.push(moduleName);
    onStack.add(moduleName);
    for (const dependency of graph.get(moduleName) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(moduleName, Math.min(lowLinks.get(moduleName)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(moduleName, Math.min(lowLinks.get(moduleName)!, indices.get(dependency)!));
      }
    }
    if (lowLinks.get(moduleName) !== indices.get(moduleName)) return;
    const component: string[] = [];
    let current: string;
    do {
      current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
    } while (current !== moduleName);
    if (component.length > 1 || graph.get(moduleName)?.includes(moduleName)) {
      components.push(component.sort());
    }
  }

  for (const moduleName of graph.keys()) {
    if (!indices.has(moduleName)) visit(moduleName);
  }
  return components;
}

describe("engine module boundaries", () => {
  it("keeps foundational modules independent from orchestration facades", () => {
    for (const moduleName of foundationalModules) {
      const fileName = `${sourceDirectory}/${moduleName}`;
      expect(existsSync(fileName), `${moduleName} exists`).toBe(true);
      const source = readFileSync(fileName, "utf8");
      const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
        .map((match) => match[1])
        .filter((dependency): dependency is string => dependency !== undefined);
      expect(
        imports.filter((dependency) => forbiddenDependencies.has(dependency)),
        `${moduleName} imports an orchestration module`,
      ).toEqual([]);
    }
  });

  it("keeps combat responsibilities in focused modules", () => {
    expect(existsSync(`${sourceDirectory}/combat.ts`), "combat facade is removed").toBe(false);
    for (const moduleName of focusedCombatModules) {
      expect(existsSync(`${sourceDirectory}/${moduleName}`), `${moduleName} exists`).toBe(true);
    }
    for (const moduleName of readdirSync(sourceDirectory).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(`${sourceDirectory}/${moduleName}`, "utf8");
      expect(source, `${moduleName} imports the removed combat facade`).not.toMatch(
        /\bfrom\s+["']\.\/combat\.js["']/,
      );
    }
  });

  it("keeps utility responsibilities in focused modules", () => {
    for (const moduleName of extractedUtilityModules) {
      expect(existsSync(`${sourceDirectory}/${moduleName}`), `${moduleName} exists`).toBe(true);
    }
    expect(existsSync(`${sourceDirectory}/util.ts`), "util facade is removed").toBe(false);
  });

  it.each([
    ["runtime", false],
    ["all including type-only", true],
  ] as const)("has no %s dependency cycles", (_label, includeTypeOnly) => {
    const cycles = stronglyConnectedComponents(localDependencyGraph(includeTypeOnly));
    expect(cycles, cycles.map((cycle) => cycle.join(" -> ")).join("\n")).toEqual([]);
  });
});
