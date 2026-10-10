import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import { cardAbilitiesSuppressed, dataOf } from "./cardProperties.js";
import { nameOf } from "./gameLog.js";
import type { CardInstance, PendingDecisionState, PlayerState } from "./state.js";
import { findPermanent } from "./zoneQueries.js";
import { clearPermanent } from "./zoneMoves.js";

export const UNIQUE_CHOICE_HOOK = "engine-unique-clear";
/** Option that keeps every non-unique card of the set. */
const CLEAR_UNIQUE_OPTION = "clear-unique";

/** Name and moniker identities (CR 2.7.3). A suffix written after a comma is
 * not part of the moniker: "Blasmophet, the Soul Harvester" is a Blasmophet. */
function identities(state: GameStateInternal, card: CardInstance): string[] {
  const name = nameOf(state, card.cardId).trim().toLowerCase();
  const comma = name.indexOf(",");
  return comma > 0 ? [name, name.slice(0, comma).trim()] : [name];
}

function isUnique(state: GameStateInternal, card: CardInstance): boolean {
  return !cardAbilitiesSuppressed(state, card) &&
    (dataOf(state, card.cardId).keywords ?? []).some(
      (keyword) => keyword.trim().toLowerCase() === "unique",
    );
}

function controlledPermanentsOf(player: PlayerState): CardInstance[] {
  return [
    player.hero,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is CardInstance => card !== undefined),
    ...player.board,
  ];
}

/** First set of two or more same-name-or-moniker permanents containing a
 * Unique card (CR 8.3.48a). */
function uniqueConflict(state: GameStateInternal, player: PlayerState): CardInstance[] | undefined {
  const permanents = controlledPermanentsOf(player);
  for (const unique of permanents) {
    if (!isUnique(state, unique)) continue;
    const ids = new Set(identities(state, unique));
    const set = permanents.filter((card) => identities(state, card).some((id) => ids.has(id)));
    if (set.length > 1) return set;
  }
  return undefined;
}

/** Choices that resolve the set without clearing the controller's hero:
 * keep one unique card, or clear every unique card and keep the rest. */
function resolutionOptions(state: GameStateInternal, player: PlayerState, set: CardInstance[]): string[] {
  const includesHero = set.some((card) => card.instanceId === player.hero.instanceId);
  const keepOne = includesHero
    ? []
    : set.filter((card) => isUnique(state, card)).map((card) => String(card.instanceId));
  const clearUnique = set.some((card) => !isUnique(state, card)) ? [CLEAR_UNIQUE_OPTION] : [];
  return [...keepOne, ...clearUnique];
}

function applyResolution(
  state: GameStateInternal,
  runtime: EngineRuntime,
  player: PlayerState,
  set: CardInstance[],
  option: string,
): void {
  const cleared = option === CLEAR_UNIQUE_OPTION
    ? set.filter((card) => isUnique(state, card))
    : set.filter((card) => String(card.instanceId) !== option);
  for (const card of cleared) {
    if (findPermanent(state, card.instanceId)?.seat === player.seat) {
      clearPermanent(state, runtime, player.seat, card);
    }
  }
}

/**
 * Unique game-state action (CR 8.3.48a). A set with one sensible resolution
 * is cleared at once; otherwise its controller chooses what to keep. Game-state
 * actions wait while a resolving effect awaits a scripted choice. An open
 * priority window resumes through the caller; any other window follows.
 */
export function enforceUnique(
  state: GameStateInternal,
  runtime: EngineRuntime,
): void {
  if (state.pendingDecision?.chooseHook) return;
  for (const player of state.players as PlayerState[]) {
    for (let set = uniqueConflict(state, player); set; set = uniqueConflict(state, player)) {
      const options = resolutionOptions(state, player, set);
      if (options.length === 1) {
        applyResolution(state, runtime, player, set, options[0]!);
        continue;
      }
      const decision: PendingDecisionState = {
        player: player.seat,
        kind: "choose-target",
        prompt: "Unique: choose which card to keep",
        promptMessage: { id: "engine.decision.unique.keep" },
        options,
        optionMessages: options.map((option) =>
          option === CLEAR_UNIQUE_OPTION ? { id: "engine.option.unique.clear" } : null
        ),
        cardOptions: options.map((option) => option === CLEAR_UNIQUE_OPTION ? null : Number(option)),
        chooseHook: UNIQUE_CHOICE_HOOK,
      };
      const existing = state.pendingDecision;
      if (existing && existing.kind !== "priority-window") decision.followUpDecisions = [existing];
      state.pendingDecision = decision;
      return;
    }
  }
}

/** Apply the controller's Unique choice against the current conflict. */
export function answerUniqueChoice(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const player = state.players[seat] as PlayerState;
  const set = uniqueConflict(state, player);
  if (!set || !resolutionOptions(state, player, set).includes(optionId)) return "invalid option";
  state.pendingDecision = null;
  applyResolution(state, runtime, player, set, optionId);
  return undefined;
}
