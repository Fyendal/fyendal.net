import type { CardInstance, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import type { GameMessage } from "@fyendal/shared";
import { BLOODROT_POX, FRAILTY, INERTIA } from "../tokens.js";
import { hasCardSubtype } from "./cards.js";
import { decisionMessage, decisionPrompt } from "./messages.js";
import { opponentSeat, targetsHero } from "./state.js";

export const NAMED_DISEASE_TOKENS: readonly string[] = [FRAILTY, INERTIA, BLOODROT_POX];

export function isDisease(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "disease");
}

export function isDiseaseToken(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "token") && isDisease(ctx, card);
}

export function controlledDiseases(ctx: ScriptCtx, seat: number): DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) => isDisease(ctx, card));
}

export function isInfected(ctx: ScriptCtx, seat: number): boolean {
  return controlledDiseases(ctx, seat).length > 0;
}

export function defenderInfected(ctx: ScriptCtx): boolean {
  return targetsHero(ctx) && isInfected(ctx, opponentSeat(ctx));
}

/** Create the disease chosen through `requestDiseaseTokenChoice` under the opponent's control. */
export function createChosenDisease(ctx: ScriptCtx, option: string): void {
  if (NAMED_DISEASE_TOKENS.includes(option)) ctx.createToken(option, opponentSeat(ctx));
}

/** Ask the controller which of the given disease token printings to create.
 * The chosen token id is delivered to `onChoose` under `hook`. */
export function requestDiseaseTokenChoice(
  ctx: ScriptCtx,
  hook: string,
  tokenIds: readonly string[] = NAMED_DISEASE_TOKENS,
  chooser?: number,
): void {
  ctx.requestChoice(
    hook,
    decisionPrompt("Choose a disease token", "card.common.disease.token.choose", {
      optionMessages: diseaseTokenOptionMessages(tokenIds),
    }),
    [...tokenIds],
    chooser,
  );
}

export function diseaseTokenOptionMessages(tokenIds: readonly string[]): Record<string, GameMessage> {
  return Object.fromEntries(
    tokenIds.map((cardId) => [cardId, decisionMessage("card.common.target.card", { card: { kind: "card", cardId } })]),
  );
}
