import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  currentAttackIsOurs,
  currentLink,
  functionalKey,
  incomingAttackDamage,
  intentCard,
  isAttack,
  ownCards,
  preferredPitchIntents,
  shouldPreserveOpeningHand,
  type BotPolicyInput,
} from "./policy.js";
import {
  chooseJarlIntentWithTrace,
  type JarlIntentDecision,
} from "./jarl-policy.js";
import { evaluateOnHit } from "./value.js";

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

function firstPreferredPlay(
  input: BotPolicyInput,
  key: string,
): GameIntent | undefined {
  const own = ownCards(input);
  const matches = input.legal.filter((intent) => {
    if (intent.kind !== "play-card" && intent.kind !== "play-from-arsenal" &&
      intent.kind !== "play-from-zone") return false;
    const card = intentCard(intent, own);
    return functionalKey(input.cards[card?.cardId ?? ""]) === key;
  });
  return preferredPitchIntents(matches, input, own)[0];
}

function earthBanished(input: BotPolicyInput): number {
  return input.view.players[input.seat].banish.filter((card) =>
    hasSubtype(input.cards[card.cardId], "earth")
  ).length;
}

function canDecompose(input: BotPolicyInput): boolean {
  const graveyard = input.view.players[input.seat].graveyard;
  return graveyard.some((first) => hasSubtype(input.cards[first.cardId], "earth") &&
    graveyard.some((second) => second.instanceId !== first.instanceId &&
      hasSubtype(input.cards[second.cardId], "earth") && graveyard.some((action) =>
        action.instanceId !== first.instanceId && action.instanceId !== second.instanceId &&
        input.cards[action.cardId]?.cardType === "action"
      )
    )
  );
}

function starvoPriorityOverride(input: BotPolicyInput): GameIntent | undefined {
  const decision = input.view.pendingDecision;
  if (decision?.kind === "optional-effect" &&
    decision.prompt.toLowerCase().includes("bravo, star of the show") &&
    decision.prompt.toLowerCase().includes("reveal earth, ice, and lightning")) {
    return input.legal.find((intent) => intent.kind === "choose" && intent.optionId === "yes");
  }
  if (decision?.prompt.toLowerCase().includes("reveal an earth, an ice, and a lightning card")) {
    return input.legal.find((intent) =>
      intent.kind === "choose" && /^\d+:\d+:\d+$/.test(intent.optionId)
    );
  }
  if (decision?.prompt.toLowerCase().includes("cadaverous tilling") &&
    decision.prompt.toLowerCase().includes("decompose")) {
    return input.legal.find((intent) => intent.kind === "choose" && intent.optionId !== "no");
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

  // Once four Earth cards are banished, Felling is naturally 8 power before
  // Starvo's +2, dominate, and go-again bonus. Before that threshold, use a
  // live Cadaverous Tilling Decompose line to advance the banished Earth count.
  const felling = earthBanished(input) >= 4
    ? firstPreferredPlay(input, "felling of the crown|1")
    : undefined;
  if (felling) return felling;
  const tilling = earthBanished(input) < 4 && canDecompose(input)
    ? firstPreferredPlay(input, "cadaverous tilling|1")
    : undefined;
  if (tilling) return tilling;

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

function hasSubtype(data: CardData | undefined, subtype: string): boolean {
  return data?.subtypes?.some((value) => value.toLowerCase() === subtype) === true;
}

function hasClass(data: CardData | undefined, cardClass: string): boolean {
  return data?.classes?.some((value) => value.toLowerCase() === cardClass) === true;
}

function preservesStarvoPowerTurn(
  input: BotPolicyInput,
  intent: Extract<GameIntent, { kind: "defend" }>,
): boolean {
  const spent = new Set([...intent.instanceIds, ...(intent.pitchInstanceIds ?? [])]);
  const hand = input.view.players[input.seat].hand.filter((card) => !spent.has(card.instanceId));
  const earth = hand.filter((card) => hasSubtype(input.cards[card.cardId], "earth"));
  const ice = hand.filter((card) => hasSubtype(input.cards[card.cardId], "ice"));
  const lightning = hand.filter((card) => hasSubtype(input.cards[card.cardId], "lightning"));
  const canReveal = earth.some((earthCard) => ice.some((iceCard) =>
    iceCard.instanceId !== earthCard.instanceId && lightning.some((lightningCard) =>
      lightningCard.instanceId !== earthCard.instanceId &&
      lightningCard.instanceId !== iceCard.instanceId
    )
  ));
  if (!canReveal) return false;

  const resources = input.view.players[input.seat].resources;
  return hand.some((attack) => {
    const data = input.cards[attack.cardId];
    if (!data || !isAttack(data) || !hasClass(data, "guardian") || (data.cost ?? 0) < 3) {
      return false;
    }
    const availablePitch = hand.reduce((total, card) => card.instanceId === attack.instanceId
      ? total
      : total + Number(input.cards[card.cardId]?.pitch ?? 0), 0);
    return resources + availablePitch >= (data.cost ?? 0);
  });
}

function defenseValue(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return intent.instanceIds.reduce((total, instanceId) => {
    const card = own.get(instanceId);
    return total + Math.max(0, card?.defense ?? input.cards[card?.cardId ?? ""]?.defense ?? 0);
  }, 0);
}

function defenderIds(intent: GameIntent): readonly number[] {
  return intent.kind === "defend" || intent.kind === "stage-defenders"
    ? intent.instanceIds
    : [];
}

function usesEquipmentDefender(input: BotPolicyInput, intent: GameIntent): boolean {
  const me = input.view.players[input.seat];
  const equipmentIds = new Set([
    ...Object.values(me.equipment)
      .filter((card): card is CardView => card !== undefined)
      .map((card) => card.instanceId),
    ...me.weapons
      .filter((card) => input.cards[card.cardId]?.cardType === "equipment")
      .map((card) => card.instanceId),
  ]);
  return defenderIds(intent).some((instanceId) => equipmentIds.has(instanceId));
}

function fullHandDefense(input: BotPolicyInput): GameIntent | undefined {
  const link = currentLink(input);
  if (!link || link.damage <= 0) return undefined;
  const handIds = new Set(input.view.players[input.seat].hand.map((card) => card.instanceId));
  const own = ownCards(input);
  const candidates = input.legal.filter(
    (intent): intent is Extract<GameIntent, { kind: "defend" }> =>
      intent.kind === "defend" && intent.instanceIds.length > 0 &&
      intent.instanceIds.every((instanceId) => handIds.has(instanceId)) &&
      defenseValue(intent, input, own) >= link.damage,
  );
  if (candidates.length === 0) return undefined;
  return chooseJarlIntentWithTrace({ ...input, legal: candidates }).intent;
}

function starvoDefenseOverride(
  input: BotPolicyInput,
  sharedIntent: GameIntent,
): GameIntent | undefined {
  const link = currentLink(input);
  if (sharedIntent.kind !== "defend" || link?.goAgain !== true ||
    preservesStarvoPowerTurn(input, sharedIntent)) return undefined;

  const own = ownCards(input);
  const stalagmite = [...own.values()].find((card) =>
    functionalKey(input.cards[card.cardId]) === "stalagmite, bastion of isenloft|0"
  );
  if (!stalagmite) return undefined;

  const attacker = input.view.players[1 - input.seat]!;
  const meaningfulOnHit = evaluateOnHit({
    effects: link.onHitEffects ?? [],
    sourceText: input.cards[link.attackingCard.cardId]?.text,
    attackerCanContinue: true,
    attackerCanArsenal: attacker.arsenalCount === 0,
    defenderHasHand: input.view.players[input.seat].handCount > 0,
    defenderHasArsenal: input.view.players[input.seat].arsenalCount > 0,
  }).value > 0 || link.wagered === true;
  const incoming = Math.max(0, link.damage);
  const sharedDefense = defenseValue(sharedIntent, input, own);

  return input.legal
    .filter((intent): intent is Extract<GameIntent, { kind: "defend" }> =>
      intent.kind === "defend" && intent.instanceIds.includes(stalagmite.instanceId)
    )
    .filter((intent) => preservesStarvoPowerTurn(input, intent))
    .map((intent) => ({ intent, defense: defenseValue(intent, input, own) }))
    .filter(({ defense }) => {
      const sharedStopsHit = sharedDefense >= incoming;
      const candidateStopsHit = defense >= incoming;
      if (meaningfulOnHit && sharedStopsHit && !candidateStopsHit) return false;
      if (incoming - defense >= input.view.players[input.seat].life) return false;
      return Math.min(incoming, sharedDefense) - Math.min(incoming, defense) <= 1;
    })
    .sort((left, right) => right.defense - left.defense ||
      left.intent.instanceIds.length - right.intent.instanceIds.length)[0]?.intent;
}

/**
 * Starvo starts from the battle-tested Earth/Ice Guardian policy used by Jarl:
 * it protects disruptive hands, saves Stalagmite for a go-again link, favors
 * both-element fusion, and values Channel Lake Frigid into aggressive heroes.
 * Starvo additionally prefers a complete hand block over spending equipment;
 * its other overrides add the three-element reveal and equipment suite without
 * exposing any opponent-hidden information.
 */
export function chooseStarvoIntentWithTrace(input: BotPolicyInput): StarvoIntentDecision {
  const override = starvoPriorityOverride(input);
  if (override) return { intent: override };
  const sharedDecision = chooseJarlIntentWithTrace(input);
  const handDefense = fullHandDefense(input);
  if (handDefense && usesEquipmentDefender(input, sharedDecision.intent)) {
    return { intent: handDefense };
  }
  if (handDefense) return sharedDecision;
  const defense = starvoDefenseOverride(input, sharedDecision.intent);
  return defense ? { intent: defense } : sharedDecision;
}

export function chooseStarvoIntent(input: BotPolicyInput): GameIntent {
  return chooseStarvoIntentWithTrace(input).intent;
}
