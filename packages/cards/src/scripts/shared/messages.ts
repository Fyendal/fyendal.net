import type { Modifier, ScriptCtx, ScriptDecisionPrompt } from "@fyendal/engine";
import type { GameLogEvent, GameLogPayload, GameMessage } from "@fyendal/shared";

interface DecisionPromptOptions {
  values?: GameMessage["values"];
  /** Labels keyed by option value; unlabeled options show the raw value. */
  optionMessages?: Readonly<Record<string, GameMessage>>;
  /** Modes already picked in a multi-mode choice, shown beside the rest. */
  chosen?: readonly string[];
}

const commonDecisionOptionIds = {
  yes: "common.option.yes",
  no: "common.option.no",
  pass: "common.option.pass",
  decline: "common.option.decline",
  none: "common.option.none",
  done: "common.option.done",
  keep: "common.option.keep",
  bottom: "common.option.bottom",
  top: "common.option.top",
  close: "common.option.close",
  remove: "common.option.remove",
  destroy: "common.option.destroy",
  both: "common.option.both",
  opponent: "common.option.opponent",
  self: "common.option.self",
  "opposing hero": "common.option.opposinghero",
  "your hero": "common.option.yourhero",
  "take damage": "common.option.takedamage",
} as const;

type CommonDecisionOption = keyof typeof commonDecisionOptionIds;

/** Catalog id plus values; the client resolves it, scripts never render a locale. */
export function decisionMessage(id: string, values?: GameMessage["values"]): GameMessage {
  return { id, ...(values === undefined ? {} : { values }) };
}

/** Ongoing-effect text for a modifier the projection can't describe; lowercase, no duration. */
export function ongoingLabel(
  fallback: string,
  id: string,
  values?: GameMessage["values"],
): Pick<Modifier, "ongoingLabel" | "ongoingLabelMessage"> {
  return { ongoingLabel: fallback, ongoingLabelMessage: decisionMessage(id, values) };
}

/** The projected text of a granted on-hit script hook, after "when it hits:". */
export function hitHookLabel(
  fallback: string,
  id: string,
  values?: GameMessage["values"],
): { label: string; labelMessage: GameMessage } {
  return { label: fallback, labelMessage: decisionMessage(id, values) };
}

/** Semantic log payload: English fallback, catalog message and optional machine event. */
export function localizedLog(
  fallback: string,
  id: string,
  values?: GameMessage["values"],
  event?: GameLogEvent,
): GameLogPayload {
  return {
    fallback,
    message: decisionMessage(id, values),
    ...(event === undefined ? {} : { event }),
  };
}

/** `localizedLog` with the script's own card as the `card` value. */
export function localizedCardLog(
  ctx: Pick<ScriptCtx, "self">,
  fallback: string,
  id: string,
  values?: GameMessage["values"],
  event?: GameLogEvent,
): GameLogPayload {
  return localizedLog(
    fallback,
    id,
    {
      ...values,
      card: { kind: "card", cardId: ctx.self.cardId },
    },
    event,
  );
}

/** Shared labels for recurring option values; the values themselves never change. */
export function commonOptionMessages(
  ...options: readonly CommonDecisionOption[]
): Readonly<Record<string, GameMessage>> {
  return Object.fromEntries(options.map((option) => [option, decisionMessage(commonDecisionOptionIds[option])]));
}

/** Localized prompt and option labels for any ScriptCtx decision API. */
export function decisionPrompt(
  fallback: string,
  id: string,
  options: DecisionPromptOptions = {},
): ScriptDecisionPrompt {
  return {
    fallback,
    message: decisionMessage(id, options.values),
    ...(options.optionMessages ? { optionMessagesByValue: options.optionMessages } : {}),
    ...(options.chosen?.length ? { chosenOptions: options.chosen } : {}),
  };
}

/** Yes/no prompt with shared option labels. */
export function yesNoPrompt(fallback: string, id: string, values?: GameMessage["values"]): ScriptDecisionPrompt {
  return decisionPrompt(fallback, id, {
    values,
    optionMessages: commonOptionMessages("yes", "no"),
  });
}

/** Warn the deciding player when a prompt's action point can't be gained now. */
export function warnIfNoActionPoint(ctx: ScriptCtx, prompt: ScriptDecisionPrompt): ScriptDecisionPrompt {
  return ctx.canGainActionPoint()
    ? prompt
    : { ...prompt, warningMessage: decisionMessage("card.common.actionpoint.nogain") };
}
