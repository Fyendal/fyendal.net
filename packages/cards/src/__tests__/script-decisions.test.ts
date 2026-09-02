import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  decisionMessage,
  decisionPrompt,
  yesNoPrompt,
} from "../scripts/shared-helpers.js";

const scriptsDirectory = fileURLToPath(new URL("../scripts/", import.meta.url));
const localizedSets = [
  "ako",
  "ajv",
  "ama",
  "amo",
  "apr",
  "arc",
  "asb",
  "aur",
  "azs",
  "cru",
  "ddd",
  "dyn",
  "ele",
  "evr",
  "gem",
  "hvy",
  "iar",
  "jdg",
  "lgs",
  "lss",
  "mon",
  "mpa",
  "mpw",
  "out",
  "sar",
  "saz",
  "sbz",
  "sda",
  "sdo",
  "sea",
  "sgb",
  "siy",
  "ska",
  "svi",
  "sup",
  "tcc",
  "ter",
  "wtr",
] as const;
const decisionPromptArgument = new Map([
  ["requestChoice", 1],
  ["requestCardChoice", 1],
  ["requestCardChoices", 1],
  ["requestNameChoice", 1],
  ["requestPayment", 1],
  ["requestPaymentFrom", 2],
  ["requestXPayment", 1],
]);

function rawDecisionPrompts(set: string): string[] {
  const raw: string[] = [];
  const partitionDirectory = `${scriptsDirectory}/${set}`;
  const paths = [
    `${scriptsDirectory}/${set}.ts`,
    ...(existsSync(partitionDirectory)
      ? readdirSync(partitionDirectory)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `${partitionDirectory}/${name}`)
      : []),
  ];

  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const argumentIndex = decisionPromptArgument.get(node.expression.name.text);
        const prompt = argumentIndex === undefined ? undefined : node.arguments[argumentIndex];
        if (prompt && !ts.isCallExpression(prompt) && !ts.isObjectLiteralExpression(prompt)) {
          const position = sourceFile.getLineAndCharacterOfPosition(prompt.getStart(sourceFile));
          raw.push(`${path.slice(scriptsDirectory.length + 1)}:${position.line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return raw;
}

describe("card-script decision presentation", () => {
  it("keeps completed sets free of raw player-facing decision prompts", () => {
    expect(localizedSets.flatMap(rawDecisionPrompts)).toEqual([]);
  });

  it("constructs prompt-only metadata with optional interpolation values", () => {
    expect(decisionPrompt(
      "Choose a target",
      "card.test.target.choose",
      { values: { amount: 2, optional: true } },
    )).toEqual({
      fallback: "Choose a target",
      message: {
        id: "card.test.target.choose",
        values: { amount: 2, optional: true },
      },
    });
  });

  it("supports dynamic and partially localized options keyed by stable value", () => {
    const prompt = decisionPrompt("Choose a target", "card.test.target.choose", {
      optionMessages: {
        "hero:1": decisionMessage("card.test.target.card", {
          card: { kind: "card", cardId: "HERO1" },
        }),
      },
    });

    expect(prompt.optionMessagesByValue).toEqual({
      "hero:1": {
        id: "card.test.target.card",
        values: { card: { kind: "card", cardId: "HERO1" } },
      },
    });
  });

  it("provides reusable yes/no option messages", () => {
    expect(yesNoPrompt("Use the effect?", "card.test.effect.use"))
      .toEqual({
        fallback: "Use the effect?",
        message: { id: "card.test.effect.use" },
        optionMessagesByValue: {
          yes: { id: "common.option.yes" },
          no: { id: "common.option.no" },
        },
      });
  });
});
