import { cardAbilitiesSuppressed, cardNamesOf, instanceDataOf, scriptOf } from "./cardProperties.js";
import type { GameStateInternal } from "./runtimeState.js";
import { controlledPermanents } from "./sourceQueries.js";
import type { CardInstance, PlayerState } from "./state.js";

/** Whether the opposing turn player's active permanents prohibit `seat` from
 * playing cards or activating abilities. This is checked by both intent
 * enumeration and applyIntent validation. */
export function opposingActionsProhibited(
  state: GameStateInternal,
  seat: number,
): boolean {
  if (seat === state.activePlayer) return false;
  return controlledPermanents(state, state.activePlayer, {
    faceDownEquipment: false,
  }).some((card) =>
    !card.faceDown &&
    scriptOf(state, card.cardId, card)?.opponentsCannotPlayOrActivateOnYourTurn === true
  );
}

export function cardProhibitedByChosenName(
  state: GameStateInternal,
  card: CardInstance,
): boolean {
  const names = cardNamesOf(state, card);
  if (state.modifiers.some((modifier) =>
    !!modifier.prohibitsName && names.includes(modifier.prohibitsName.trim().toLowerCase())
  )) return true;
  return state.players.some((candidate) =>
    controlledPermanents(state, candidate.seat).some((source) => {
      const chosen = source.chosenName?.trim().toLowerCase();
      return !!chosen && scriptOf(state, source.cardId, source)?.prohibitsChosenName === true &&
        names.includes(chosen);
    })
  );
}

/** Whether a live static effect caps this hero's non-attack action-card plays
 * and that cap has been reached. Activated abilities are deliberately
 * excluded. */
export function nonAttackActionCardLimitReached(
  state: GameStateInternal,
  player: PlayerState,
  card: CardInstance,
): boolean {
  const data = instanceDataOf(state, card);
  if (data.cardType !== "action" || (data.subtypes ?? []).includes("attack")) return false;
  const limits = (state.players as PlayerState[]).flatMap((controller) =>
    controlledPermanents(state, controller.seat, { faceDownEquipment: false })
      .map((source) => scriptOf(state, source.cardId, source)?.nonAttackActionCardLimit)
      .filter((limit): limit is number => limit !== undefined && limit >= 0)
  );
  if (limits.length === 0) return false;
  return Number(player.flags.nonAttackActionsPlayedThisTurn ?? 0) >= Math.min(...limits);
}

/** Whether an active static effect stops `seat` from playing or activating
 * the supplied owned card. Control is represented by arena placement while
 * ownership remains on the card instance, so opponent-owned permanents a
 * player controls are intentionally unaffected. */
export function ownedCardActionProhibited(
  state: GameStateInternal,
  seat: number,
  card: CardInstance,
): boolean {
  if (card.owner !== seat) return false;
  return controlledPermanents(state, seat, { faceDownEquipment: false }).some(
    (source) =>
      !cardAbilitiesSuppressed(state, source) &&
      scriptOf(state, source.cardId, source)?.controllerCannotPlayOrActivateOwnedCards === true,
  );
}
