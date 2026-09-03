import type { GameIntent } from "@fyendal/shared";
import {
  currentAttackIsOurs,
  currentLink,
  functionalKey,
  incomingAttackDamage,
  intentCard,
  ownCards,
  preferredPitchIntents,
  shouldPreserveOpeningHand,
  type BotPolicyInput,
} from "./policy.js";
import {
  chooseJarlIntentWithTrace,
  type JarlIntentDecision,
} from "./jarl-policy.js";

export type StarvoIntentDecision = JarlIntentDecision;

function firstPreferredAbility(
  input: BotPolicyInput,
  key: string,
): GameIntent | undefined {
  const own = ownCards(input);
  const matches = input.legal.filter((intent) => {
    if (intent.kind !== "activate-ability") return false;
    const card = intentCard(intent, own);
    return functionalKey(input.cards[card?.cardId ?? ""]) === key;
  });
  return preferredPitchIntents(matches, input, own)[0];
}

function starvoPriorityOverride(input: BotPolicyInput): GameIntent | undefined {
  const decision = input.view.pendingDecision;
  if (decision?.prompt.toLowerCase().includes("reveal an earth, an ice, and a lightning card")) {
    return input.legal.find((intent) =>
      intent.kind === "choose" && /^\d+:\d+:\d+$/.test(intent.optionId)
    );
  }

  // Free card and resource generation should happen before the shared
  // Elemental Guardian planner commits the rest of the turn.
  const balance = firstPreferredAbility(input, "balance of justice|0");
  if (balance) return balance;
  const tunic = firstPreferredAbility(input, "fyendal's spring tunic|0");
  if (tunic && input.view.activePlayer === input.seat) return tunic;

  // Crown is both damage prevention and the list's primary way to repair an
  // awkward elemental hand. Spend floating resources during combat rather
  // than pitching away the hand Starvo wants to reveal next turn.
  const crown = firstPreferredAbility(input, "crown of seeds|0");
  if (crown && input.view.players[input.seat].resources >= 1 &&
    currentLink(input)?.attackingCard.owner !== input.seat && incomingAttackDamage(input) > 0) {
    return crown;
  }

  // Heart of Ice is a high-value opening action after the turn-one refill
  // exception. Its go again lets the mature Guardian planner continue with
  // Channel Lake Frigid or a large attack.
  const heart = firstPreferredAbility(input, "heart of ice|0");
  if (heart && input.view.activePlayer === input.seat && !shouldPreserveOpeningHand(input)) {
    return heart;
  }

  // Convert otherwise floating resources into unavoidable damage only when
  // the current attack action is already getting through.
  const shockCharmers = firstPreferredAbility(input, "shock charmers|0");
  const link = currentLink(input);
  if (shockCharmers && currentAttackIsOurs(input) && link &&
    link.attackValue > link.defenseValue && input.view.players[input.seat].resources >= 2) {
    return shockCharmers;
  }
  return undefined;
}

/**
 * Starvo starts from the battle-tested Earth/Ice Guardian policy used by Jarl:
 * it protects disruptive two-card attacks, favors both-element fusion, values
 * Channel Lake Frigid into aggressive heroes, and blocks represented on-hits.
 * These overrides add Starvo's three-element reveal and the broken equipment
 * suite without exposing any opponent-hidden information.
 */
export function chooseStarvoIntentWithTrace(input: BotPolicyInput): StarvoIntentDecision {
  const override = starvoPriorityOverride(input);
  return override ? { intent: override } : chooseJarlIntentWithTrace(input);
}

export function chooseStarvoIntent(input: BotPolicyInput): GameIntent {
  return chooseStarvoIntentWithTrace(input).intent;
}
