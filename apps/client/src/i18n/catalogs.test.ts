import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import englishMessages from "./compiled/en.json";
import portugueseMessages from "./compiled/pt-BR.json";
import spanishMessages from "./compiled/es.json";
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
    "cardCeasesToExistLogMessage",
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

/** Every ICU argument name a compiled message references, including those
 * nested inside select, plural, and tag branches. */
function messageArguments(node: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) messageArguments(child, names);
    return names;
  }
  if (!node || typeof node !== "object") return names;
  const element = node as Record<string, unknown>;
  if (element.type !== 0 && typeof element.value === "string") names.add(element.value);
  if (Array.isArray(element.children)) messageArguments(element.children, names);
  if (element.options && typeof element.options === "object") {
    for (const option of Object.values(element.options)) {
      messageArguments((option as Record<string, unknown>).value, names);
    }
  }
  return names;
}

/** Values producers pass for grammar English does not mark, such as noun
 * classes for measure words or gender agreement. */
const GRAMMATICAL_ARGUMENTS = new Set(["noun"]);

const LOCALIZED_CATALOGS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["zh-Hans", chineseMessages],
  ["pt-BR", portugueseMessages],
  ["es", spanishMessages],
];

describe("locale catalogs", () => {
  it.each(LOCALIZED_CATALOGS)("keeps %s complete with the English source catalog", (_, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(englishMessages).sort());
  });

  it.each(LOCALIZED_CATALOGS)("keeps %s message arguments consistent with English", (_, messages) => {
    const english: Record<string, unknown> = englishMessages;
    expect(Object.entries(messages).flatMap(([id, message]) => {
      const expected = [...messageArguments(english[id])].sort();
      const actual = [...messageArguments(message)].sort();
      return actual.some((name) => !expected.includes(name) && !GRAMMATICAL_ARGUMENTS.has(name))
        ? [`${id}: ${actual.join(",")} not in ${expected.join(",")}`]
        : [];
    })).toEqual([]);
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

  it("contains every semantic message referenced by engine producers", () => {
    const referencedIds = new Set([...scriptFiles(engineSourceDirectory), serverStoreFile].flatMap((path) =>
      Array.from(
        readFileSync(path, "utf8").matchAll(
          /["']((?:engine\.(?:log|term|effect)|server\.log)\.[a-zA-Z0-9.]+)["']/g,
        ),
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

  it("keeps Flesh and Blood terms in English for Brazilian Portuguese", () => {
    const intl = createTestIntl("pt-BR");

    expect(intl.formatMessage({ id: "format.classicConstructed" })).toBe("Classic Constructed");
    expect(intl.formatMessage({ id: "format.silverAge" })).toBe("Silver Age");
    expect(intl.formatMessage({ id: "settings.priority.autoPassDescription" }))
      .toBe("Passar automaticamente: passa a prioridade imediatamente quando nenhum instant, reaction ou habilidade do tabuleiro puder ser usado");
    expect(intl.formatMessage(
      { id: "lobby.deck.heroAndCount" },
      { hero: "Bravo", count: 0 },
    )).toBe("Bravo · 0 cartas");
    expect(intl.formatMessage({ id: "game.chain.onHit" })).toBe("On hit");
    expect(intl.formatMessage({ id: "game.chain.linksShort" })).toBe("Links");
    expect(intl.formatMessage({ id: "game.chain.title" })).toBe("Combat Chain");
    expect(intl.formatMessage({ id: "game.timing.actionPhase" })).toBe("ACTION PHASE");
    expect(intl.formatMessage({ id: "game.timing.layerStep" })).toBe("LAYER STEP");
    expect(intl.formatMessage({ id: "game.timing.damageStep" })).toBe("DAMAGE STEP");
    expect(intl.formatMessage({ id: "game.zone.graveyard" })).toBe("Cemitério");
    expect(intl.formatMessage({ id: "game.zone.arsenal" })).toBe("Arsenal");
    expect(intl.formatMessage({ id: "game.decision.bloodMode.goAgain" }))
      .toBe("Ataques recebem go again");
    expect(intl.formatMessage({ id: "engine.effect.part.dominate" })).toBe("dominate");
    expect(intl.formatMessage(
      { id: "engine.log.card.destroyed" },
      { card: "Nimble Strike" },
    )).toBe("A carta Nimble Strike é destruída");
  });

  it("separates Chinese text from interpolated names with a space", () => {
    const tight = /[一-鿿]\{(?:card|source|player|name|hero)\}|\{(?:card|source|player|name|hero)\}[一-鿿]/;
    const source: unknown = JSON.parse(
      readFileSync(new URL("./catalogs/zh-Hans.json", import.meta.url), "utf8"),
    );
    expect(Object.entries(source as Record<string, unknown>)
      .filter(([, message]) => typeof message !== "string" || tight.test(message)))
      .toEqual([]);
    expect(createTestIntl("zh-Hans").formatMessage(
      { id: "game.decision.boost.prompt" },
      { card: "Zipper Hit" },
    )).toBe("推进 Zipper Hit？");
  });
});
