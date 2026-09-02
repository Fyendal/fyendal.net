import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import englishMessages from "./compiled/en.json";
import chineseMessages from "./compiled/zh-Hans.json";
import { createTestIntl } from "./TestI18nProvider.js";

const cardScriptsDirectory = fileURLToPath(
  new URL("../../../../packages/cards/src/scripts/", import.meta.url),
);
const cardTriggerMessagesFile = fileURLToPath(
  new URL("../../../../packages/cards/src/trigger-messages.ts", import.meta.url),
);
const engineSourceDirectory = fileURLToPath(
  new URL("../../../../packages/engine/src/", import.meta.url),
);
const serverStoreFile = fileURLToPath(
  new URL("../../../../apps/server/src/store.ts", import.meta.url),
);

function scriptFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const entryPath = `${path}/${entry.name}`;
    if (entry.isDirectory()) return scriptFiles(entryPath);
    return entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function rawPublicLogCalls(path: string): string[] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.Expression>();
  const collectDeclarations = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  const semanticFactories = new Set([
    "cardDestroyedLogMessage",
    "cardEntersArenaLogMessage",
    "cardPutOnDeckBottomLogMessage",
    "cardTappedLogMessage",
    "gameLogMessage",
    "triggerLogMessage",
  ]);
  const isSemantic = (expression: ts.Expression, seen = new Set<string>()): boolean => {
    if (ts.isParenthesizedExpression(expression)) {
      return isSemantic(expression.expression, seen);
    }
    if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
      return semanticFactories.has(expression.expression.text);
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.some((property) =>
        (ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "message") ||
        ts.isSpreadAssignment(property)
      );
    }
    if (ts.isConditionalExpression(expression)) {
      return isSemantic(expression.whenTrue, seen) && isSemantic(expression.whenFalse, seen);
    }
    if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
      const initializer = declarations.get(expression.text);
      if (!initializer) return false;
      const nextSeen = new Set(seen);
      nextSeen.add(expression.text);
      return isSemantic(initializer, nextSeen);
    }
    return false;
  };

  const violations: string[] = [];
  const inspect = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "logPublic" &&
      node.arguments.length >= 2 &&
      !isSemantic(node.arguments[1]!)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(`${path}:${line + 1}`);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return violations;
}

describe("locale catalogs", () => {
  it("keeps Simplified Chinese complete with the English source catalog", () => {
    expect(Object.keys(chineseMessages).sort()).toEqual(Object.keys(englishMessages).sort());
  });

  it("keeps wire-projected engine and card message IDs protocol-safe", () => {
    const semanticMessageId = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
    const wireMessageIds = Object.keys(englishMessages).filter(
      (id) => id.startsWith("engine.") || id.startsWith("card.") || id.startsWith("server."),
    );

    expect(wireMessageIds).not.toHaveLength(0);
    expect(wireMessageIds.filter((id) => !semanticMessageId.test(id))).toEqual([]);
  });

  it("contains every semantic message referenced by card scripts", () => {
    const referencedIds = new Set([...scriptFiles(cardScriptsDirectory), cardTriggerMessagesFile].flatMap((path) =>
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
    const referencedIds = new Set([...scriptFiles(engineSourceDirectory), serverStoreFile].flatMap((path) =>
      Array.from(
        readFileSync(path, "utf8").matchAll(/["']((?:engine|server)\.log\.[a-zA-Z0-9.]+)["']/g),
        (match) => match[1]!,
      )
    ));
    const catalogIds = new Set(Object.keys(englishMessages));

    expect(
      [...referencedIds].filter((id) => !catalogIds.has(id)).sort(),
    ).toEqual([]);
  });

  it("requires every engine public log producer to emit a semantic payload", () => {
    expect(scriptFiles(engineSourceDirectory).flatMap(rawPublicLogCalls)).toEqual([]);
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
