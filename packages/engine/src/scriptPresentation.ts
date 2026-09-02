import type { ScriptDecisionPrompt, ScriptPrompt } from "./scripts.js";

export const DEFAULT_CHOOSE_X_PROMPT: ScriptDecisionPrompt = {
  fallback: "Choose X",
  message: { id: "engine.decision.x.choose" },
};

export function soulBanishCostPrompt(
  fallbackCardName: string,
  cardId: string,
  current: number,
  total: number,
): ScriptDecisionPrompt {
  return {
    fallback: `${fallbackCardName}: choose soul card ${current} of ${total} to banish as a cost`,
    message: {
      id: "engine.decision.soul.banishcost",
      values: {
        card: { kind: "card", cardId },
        current,
        total,
      },
    },
  };
}

export function scriptPromptParts(
  prompt: ScriptPrompt,
  options?: readonly string[],
): {
  fallback: string;
  promptMessage?: ScriptDecisionPrompt["message"];
  optionMessages?: (ScriptDecisionPrompt["message"] | null)[];
} {
  if (typeof prompt === "string") return { fallback: prompt };
  const messagesByValue = prompt.optionMessagesByValue;
  const optionMessages = options && messagesByValue
    ? options.map((option) =>
        Object.hasOwn(messagesByValue, option)
          ? messagesByValue[option] ?? null
          : null
      )
    : undefined;
  return {
    fallback: prompt.fallback,
    promptMessage: prompt.message,
    ...(optionMessages?.some((message) => message !== null)
      ? { optionMessages }
      : {}),
  };
}
