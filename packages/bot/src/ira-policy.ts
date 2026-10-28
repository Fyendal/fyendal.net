import type { GameState } from "@fyendal/engine";
import type { CardData, CardView, GameIntent } from "@fyendal/shared";
import {
  allyLethalThreshold,
  chooseScoredIntent,
  currentAttackIsOurs,
  currentLink,
  enforceAllyTargetPolicy,
  enforceSpectraPolicy,
  functionalKey as key,
  intentCard,
  isAttack,
  optionCard,
  ownCards,
  pitchIds,
  pitchValue,
  scoreArsenalChoice,
  scoreBinaryChoice,
  scoreDefenseIntent,
  scoreDefenseReaction,
  scoreSpendCardChoice,
  shouldPreserveOpeningHand,
  spendsOpeningArsenalReserve,
  type BotPolicyInput,
  type ResponseModel,
} from "./policy.js";
import {
  evaluateOpponentResponse,
  evaluateTurnFuture,
  horizonScore,
  planTurn,
  POINTS_PER_DAMAGE,
  responseWeightedDamage,
  spentEquipmentValue,
  type TurnPlan,
  type TurnPlannerRoot,
} from "./turn-planner.js";
import { BLOCK_USE_RATE } from "./card-ev.js";
import { abilitySource, weaponCost, type HeroSolverRules, type SolverCardPatch } from "./card-model.js";
import type { PendingEffect, SolverCard, SolverFlags, SolverView } from "./hand-solver.js";
import { arsenalValuer, handDamage, handResponse, opportunityValuer } from "./hand-value.js";
import { iraPresentation } from "./sideboard.js";

const BLOSSOM_KEY = "whirling mist blossom|2";
const EDGE_KEY = "edge of autumn|0";
const TIGER_KEY = "crouching tiger|0";
const CROUCHING_TIGER_ID = "SFA036";
const IRA_DECK = iraPresentation().deck;

function irisHasSearchTarget(input: BotPolicyInput): boolean {
  if (input.state) {
    return input.state.players[input.seat].deck.some((card) =>
      key(input.cards[card.cardId]) === BLOSSOM_KEY
    );
  }

  // Reactive tasks have no simulation snapshot. Ira's fixed deck and all
  // visible non-deck zones still prove when every copy has left the deck.
  const visible = input.view.players.flatMap((player) => [
    ...player.hand, ...player.arsenal, ...player.pitch, ...player.graveyard,
    ...player.banish, ...player.soul, ...player.board, ...player.weapons,
    ...Object.values(player.equipment).flatMap((card) => card ? [card] : []),
  ]);
  visible.push(...input.view.chain.flatMap((link) => [
    link.attackingCard, ...link.defendingCards, ...link.reactions,
  ]));
  visible.push(...input.view.stack.flatMap((layer) => layer.card ? [layer.card] : []));
  if (input.view.pendingDecision?.preStackSource) {
    visible.push(input.view.pendingDecision.preStackSource.card);
  }
  const outsideDeck = new Set(visible.filter((card) =>
    card.owner === input.seat && key(input.cards[card.cardId]) === BLOSSOM_KEY
  ).map((card) => card.instanceId));
  const totalBlossoms = IRA_DECK.filter((id) => key(input.cards[id]) === BLOSSOM_KEY).length;
  return input.view.players[input.seat].deckCount > 0 && outsideDeck.size < totalBlossoms;
}

function withoutEmptyIrisSearch(input: BotPolicyInput): BotPolicyInput {
  if (irisHasSearchTarget(input)) return input;
  const irisId = input.view.players[input.seat].equipment.head?.instanceId;
  return {
    ...input,
    legal: input.legal.filter((intent) =>
      intent.kind !== "activate-ability" || intent.sourceInstanceId !== irisId
    ),
  };
}

function attacksThisTurn(input: BotPolicyInput): number {
  const projected = input.view.turnFacts?.players[input.seat].attacks;
  if (projected !== undefined) return projected;
  const stats = input.view.gameStats?.turns.find((turn) => turn.turn === input.view.turn);
  if (stats) return stats.attacks[input.seat];
  return input.view.chain.filter((link) => link.attackingCard.owner === input.seat).length;
}

function previousAttack(input: BotPolicyInput): CardData | undefined {
  const previous = [...input.view.chain]
    .reverse()
    .find((link) => link.resolved && link.attackingCard.owner === input.seat);
  return previous ? input.cards[previous.attackingCard.cardId] : undefined;
}

function previousAttackKey(input: BotPolicyInput): string {
  const previous = previousAttack(input);
  return previous ? key(previous) : "";
}

/** Aspect of Tiger's Combo: a red attack action card was the last attack. */
function isRedAttackAction(data: CardData | undefined): boolean {
  return data?.cardType === "action" && isAttack(data) && data.pitch === 1;
}

function isTigerCombo(functional: string): boolean {
  return functional.startsWith("pouncing qi|") || functional === "qi unleashed|3";
}

function currentAttackHasOrWillGetGoAgain(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  if (!link) return false;
  if (link.goAgain === true) return true;
  const attack = input.cards[link.attackingCard.cardId];
  const razorGrantsGoAgain = isAttack(attack) && (attack?.cost ?? Number.POSITIVE_INFINITY) <= 1;
  if (input.view.stack.some((layer) => {
    const pending = key(input.cards[layer.card?.cardId ?? ""]);
    return pending === "snapdragon scalers|0" ||
      (razorGrantsGoAgain && pending.startsWith("razor reflex|"));
  })) return true;
  if (link.defenseValue >= link.attackValue) return false;
  return link.onHitEffects?.some((effect) => /\bgo again\b/i.test(effect.text)) === true;
}

function currentAllyAttackIsAlreadyLethal(input: BotPolicyInput): boolean {
  const link = currentLink(input);
  return !!link?.targetAlly && link.attackValue >= allyLethalThreshold(link.targetAlly, input);
}

function likelyGoAgain(functional: string, data: CardData, previous: string, input: BotPolicyInput): boolean {
  if (data.cardType === "weapon") return functional === "edge of autumn|0";
  if (data.keywords?.includes("Go again")) return true;
  if (functional.startsWith("scar for a scar|")) {
    return input.view.players[input.seat].life < input.view.players[1 - input.seat]!.life;
  }
  if (functional.startsWith("soulbead strike|") || functional.startsWith("torrent of tempo|")) {
    return true;
  }
  if (functional.startsWith("seek vengeance|") || functional === "vengeance never rests|3") {
    return previous === EDGE_KEY;
  }
  if (functional.startsWith("pouncing qi|")) return previous === TIGER_KEY;
  if (functional === "aspect of tiger: body|1") return isRedAttackAction(previousAttack(input));
  return false;
}

function resourceCost(data: CardData | undefined): number {
  if (!data) return 0;
  return data.cardType === "weapon" ? weaponCost(data) : Math.max(0, data.cost ?? 0);
}

function isAttackSource(candidate: GameIntent, own: ReadonlyMap<number, CardView>, input: BotPolicyInput): boolean {
  if (
    candidate.kind !== "play-card" && candidate.kind !== "play-from-arsenal" &&
    candidate.kind !== "play-from-zone" && candidate.kind !== "activate-ability"
  ) return false;
  const data = input.cards[intentCard(candidate, own)?.cardId ?? ""];
  return isAttack(data) || data?.cardType === "weapon";
}

/** Whether another attack stays legal and affordable once this intent spends
 * its source, its pitched cards and its cost, so a granted action point would
 * be used. */
function remainingAttackAfter(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const used = intentCard(intent, own);
  const consumed = new Set([used?.instanceId, ...pitchIds(intent)]);
  const me = input.view.players[input.seat];
  const floating = Math.max(
    0,
    me.resources + (me.chi ?? 0) + pitchValue(intent, input, own) - resourceCost(input.cards[used?.cardId ?? ""]),
  );
  const pitchable = me.hand.filter((card) => !consumed.has(card.instanceId));
  return input.legal.some((candidate) => {
    if (!isAttackSource(candidate, own, input)) return false;
    const card = intentCard(candidate, own);
    if (!card || consumed.has(card.instanceId)) return false;
    const pitch = pitchable.reduce((total, other) =>
      other.instanceId === card.instanceId ? total : total + Number(input.cards[other.cardId]?.pitch ?? 0),
    0);
    return floating + pitch >= resourceCost(input.cards[card.cardId]);
  });
}

/** Whether a different attack is legal now, competing for this action point. */
function alternativeAttackNow(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const used = intentCard(intent, own)?.instanceId;
  return input.legal.some((candidate) =>
    isAttackSource(candidate, own, input) && intentCard(candidate, own)?.instanceId !== used
  );
}

function tigerInReserve(input: BotPolicyInput): boolean {
  return reserveCards(input).some((card) => key(input.cards[card.cardId]) === TIGER_KEY);
}

function comboInReserve(input: BotPolicyInput): boolean {
  return reserveCards(input).some((card) => isTigerCombo(key(input.cards[card.cardId])));
}

/** Cards Ira could still play this turn: hand, arsenal, and only those
 * banished cards an effect currently lets her play. */
function reserveCards(input: BotPolicyInput): CardView[] {
  const me = input.view.players[input.seat];
  return [
    ...me.hand,
    ...me.arsenal,
    ...me.banish.filter((card) => card.playableFromSourceCardId !== undefined),
  ];
}

function attackInReserve(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): boolean {
  const used = intentCard(intent, own);
  const consumed = new Set([used?.instanceId, ...pitchIds(intent)]);
  return reserveCards(input).some((card) =>
    !consumed.has(card.instanceId) && isAttack(input.cards[card.cardId])
  );
}

/** Whether a reserved attack can still be paid for from floating resources
 * and the rest of the hand, so a granted action point would be used. */
function affordableAttackInReserve(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
  extraResources = 0,
): boolean {
  const used = intentCard(intent, own);
  const consumed = new Set([used?.instanceId, ...pitchIds(intent)]);
  const me = input.view.players[input.seat];
  const pitchable = me.hand.filter((card) => !consumed.has(card.instanceId));
  const floating = me.resources + (me.chi ?? 0) + extraResources;
  return reserveCards(input).some((card) => {
    const data = input.cards[card.cardId];
    if (consumed.has(card.instanceId) || !isAttack(data)) return false;
    const pitch = pitchable.reduce((total, candidate) =>
      candidate.instanceId === card.instanceId
        ? total
        : total + Number(input.cards[candidate.cardId]?.pitch ?? 0),
    0);
    return floating + pitch >= Number(data?.cost ?? 0);
  });
}

const cardOpportunity = opportunityValuer(iraSolverRules);

/** Damage equivalents of Ira's non-damage on-hit riders. */
const DESTROY_ARSENAL_VALUE = 4;
const DRAW_TWO_VALUE = 6;
/** Blessing of Qi's next-turn Crouching Tiger: +3{p} with go again. */
const BLESSING_OF_QI_VALUE = 3;

/** Ira: her second attack each turn gets +1{p}. */
const IRA_SECOND_ATTACK: PendingEffect = {
  key: "ira-second-attack",
  uses: 1,
  power: 1,
  appliesTo: (_card, view) => view.flag("attacks") === 1,
};

function nextTigerPump(source: string, power: number, uses = 1): PendingEffect {
  return { key: source, uses, power, appliesTo: (card) => card.name === "Crouching Tiger" };
}

/** Hand-value rules: the second-attack bonus, on-hit go again (assumed to
 * connect, as the planner's public rollout does), Edge of Autumn combos,
 * Flying Kick, Bittering Thorns, Whirling Mist Blossom, Razor Reflex, and the
 * Crouching Tiger package. Tigers made mid-line are one reusable source gated
 * by the `tigers` flag. */
function iraSolverRules(input: BotPolicyInput): HeroSolverRules {
  const me = input.view.players[input.seat];
  const opponent = input.view.players[1 - input.seat]!;
  const behind = me.life < opponent.life;
  const wieldsEdge = me.weapons.some((weapon) => key(input.cards[weapon.cardId]) === EDGE_KEY);
  const tigerUses = `extraUse:${me.heroInstanceId}`;
  const makeTigers = (view: SolverView, count: number): SolverFlags => ({
    tigers: view.flag("tigers") + count,
    [tigerUses]: view.flag(tigerUses) + count,
  });
  const comboFlags = (data: CardData): SolverFlags => {
    const functional = key(data);
    return {
      lastEdge: functional === EDGE_KEY ? 1 : 0,
      lastTiger: functional === TIGER_KEY ? 1 : 0,
      lastRedAction: isRedAttackAction(data) ? 1 : 0,
      ...(functional === TIGER_KEY ? { tigerAttacked: 1 } : {}),
    };
  };
  const blessings = me.board.filter((card) => key(input.cards[card.cardId]) === "blessing of qi|1").length;
  return {
    name: "ira",
    trackedTraits: [],
    startFlags(observed, nextTurn): Record<string, number> {
      if (nextTurn) return blessings > 0 ? { tigers: blessings, [tigerUses]: blessings } : {};
      const previous = previousAttack(observed);
      return previous ? comboFlags(previous) : {};
    },
    startPending(observed, nextTurn) {
      const pending = nextTurn || attacksThisTurn(observed) < 2 ? [IRA_SECOND_ATTACK] : [];
      return nextTurn && blessings > 0 ? [...pending, nextTigerPump("blessing-of-qi", 3, blessings)] : pending;
    },
    abilities() {
      const tiger = input.cards[CROUCHING_TIGER_ID];
      if (!tiger) return [];
      return [abilitySource({
        instanceId: me.heroInstanceId,
        cardId: CROUCHING_TIGER_ID,
        name: "Crouching Tiger",
        cost: 0,
        kind: "attack",
        speed: undefined,
        goAgain: true,
        traits: ["ninja"],
        canPlay: (view) => view.flag("tigers") > 0,
        after: (view) => ({
          flags: { ...comboFlags(tiger), tigers: view.flag("tigers") - 1 },
        }),
      })];
    },
    equipment(data, card) {
      const functional = key(data);
      const destroy: SolverCardPatch = {
        kind: "equipment",
        speed: "instant",
        cost: 0,
        consumeCost: Math.max(0, card.defense ?? data.defense ?? 0) * BLOCK_USE_RATE,
      };
      if (functional === "pouncing paws|0") {
        return { ...destroy, after: (view) => ({ flags: makeTigers(view, 1) }) };
      }
      if (functional === "tearing shuko|0") {
        return { ...destroy, after: () => ({ pending: [nextTigerPump(`shuko#${card.instanceId}`, 2)] }) };
      }
      if (functional === "blood scent|0") {
        return {
          ...destroy,
          canPlay: (view) => view.flag("tigerAttacked") > 0,
          after: () => ({ resources: 1 }),
        };
      }
      return undefined;
    },
    card(data, card) {
      const functional = key(data);
      const power = card.attack ?? data.attack ?? 0;
      const patch: SolverCardPatch = {};
      if (isAttack(data) || functional === EDGE_KEY) {
        // Combo cards read the previous attack.
        patch.after = () => ({ flags: comboFlags(data) });
      }
      if (functional.startsWith("soulbead strike|") || functional.startsWith("torrent of tempo|")) {
        patch.goAgainIn = () => true;
        patch.uses = { reliableGoAgain: true };
      } else if (functional.startsWith("scar for a scar|")) {
        patch.goAgainIn = () => behind;
        patch.uses = { reliableGoAgain: behind };
      } else if (functional.startsWith("seek vengeance|") || functional === "vengeance never rests|3") {
        patch.goAgainIn = (view) => view.flag("lastEdge") > 0;
        // Edge of Autumn has go again, so its Combo is available every turn.
        patch.uses = { reliableGoAgain: wieldsEdge };
      } else if (functional === "enact vengeance|1") {
        patch.onHitIn = (view) => view.flag("lastEdge") > 0 && opponent.arsenalCount > 0 ? DESTROY_ARSENAL_VALUE : 0;
      } else if (functional.startsWith("flying kick|")) {
        patch.powerIn = (view) => power + (view.links >= 2 ? 2 : 0);
      } else if (functional === "whirling mist blossom|2") {
        // Draw two when it is the second or later chain link in a row to hit.
        patch.onHitIn = (view) => view.links >= 1 ? DRAW_TWO_VALUE : 0;
      } else if (functional.startsWith("bittering thorns|")) {
        patch.after = () => ({
          flags: comboFlags(data),
          pending: [{ key: `thorns#${card.instanceId}`, uses: 1, power: 1 }],
        });
      } else if (functional.startsWith("pouncing qi|")) {
        patch.powerIn = (view) => power + (view.flag("lastTiger") > 0 ? 1 : 0);
        patch.goAgainIn = (view) => view.flag("lastTiger") > 0;
      } else if (functional === "qi unleashed|3") {
        patch.powerIn = (view) => power + (view.flag("lastTiger") > 0 ? 4 : 0);
      } else if (functional === "aspect of tiger: body|1") {
        patch.goAgainIn = (view) => view.flag("lastRedAction") > 0;
        patch.after = (view) => ({
          flags: { ...comboFlags(data), ...(view.flag("lastRedAction") > 0 ? makeTigers(view, 1) : {}) },
        });
      } else if (functional === "growl|1" || functional === "untamed|1") {
        patch.replaceAfter = true;
        patch.after = () => ({
          flags: comboFlags(data),
          pending: [nextTigerPump(`growl#${card.instanceId}`, 1)],
        });
      } else if (functional === "blessing of qi|1") {
        patch.bonusIn = () => BLESSING_OF_QI_VALUE;
      } else if (functional === "bluster buff|1") {
        // Paying the extra {r} keeps its full power.
        patch.cost = 2;
      } else if (functional.startsWith("razor reflex|")) {
        const lowCost = (attack: SolverCard) => attack.kind === "attack" && attack.cost <= 1;
        patch.reactionPower = 3;
        patch.reactionTarget = (attack) => lowCost(attack) ||
          (attack.kind === "weapon" && (attack.traits.includes("sword") || attack.traits.includes("dagger")));
        // The low-cost mode also grants go again when the attack hits.
        patch.after = (view) => view.lastAttack && lowCost(view.lastAttack) && view.flag("lastAttackGoAgain") === 0
          ? { actionPoints: 1, flags: { lastAttackGoAgain: 1 } }
          : undefined;
      }
      return patch;
    },
  };
}

const iraResponse: ResponseModel = {
  offensiveCards: (input) => {
    const me = input.view.players[input.seat];
    return [...me.hand, ...me.arsenal];
  },
  evaluateResponse: (cards, input) => handResponse(cards, input, iraSolverRules),
};

function scoreDefend(
  intent: Extract<GameIntent, { kind: "defend" }>,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  return scoreDefenseIntent(intent, input, own, {
    ...iraResponse,
    cardOpportunity,
  });
}

function canFundBlossomAfterIris(
  intent: Extract<GameIntent, { kind: "activate-ability" }>,
  input: BotPolicyInput,
): boolean {
  const me = input.view.players[input.seat];
  const unavailable = new Set([
    ...intent.pitchInstanceIds,
    ...(intent.alternativeCostCardInstanceIds ?? []),
  ]);
  const discardable = me.hand.filter((card) => !unavailable.has(card.instanceId));
  if (discardable.length === 0) return false;

  // The following discard decision uses the same opportunity score, so model
  // the card the policy will actually spend before valuing the fetched attack.
  const discard = discardable.reduce((best, card) =>
    cardOpportunity(card, input) < cardOpportunity(best, input) ? card : best
  );
  const pitchFromActivation = intent.pitchInstanceIds.reduce((total, id) => {
    const card = me.hand.find((candidate) => candidate.instanceId === id);
    return total + Number(input.cards[card?.cardId ?? ""]?.pitch ?? 0);
  }, 0);
  const remainingPitch = discardable.reduce((total, card) =>
    card.instanceId === discard.instanceId
      ? total
      : total + Number(input.cards[card.cardId]?.pitch ?? 0),
  0);
  const floatingAfterActivation = Math.max(
    0,
    me.resources + pitchFromActivation - Number(intent.pitchRequired ?? 0),
  );
  return floatingAfterActivation + remainingPitch >= 1;
}

function canPlayActionNow(input: BotPolicyInput): boolean {
  if (input.view.activePlayer !== input.seat) return false;
  if (input.view.players[input.seat].actionPoints > 0) return true;
  return currentAttackIsOurs(input) && currentAttackHasOrWillGetGoAgain(input);
}

function scoreChoice(intent: Extract<GameIntent, { kind: "choose" }>, input: BotPolicyInput): number {
  const decision = input.view.pendingDecision;
  if (!decision) return 0;
  const card = optionCard(intent, input);
  const data = card ? input.cards[card.cardId] : undefined;
  const functional = key(data);

  if (decision.kind === "arsenal") {
    return scoreArsenalChoice(intent, input, arsenalValuer(iraSolverRules));
  }

  if (/sink below|bottom of your deck/i.test(decision.prompt)) {
    if (intent.optionId === "pass") return 1;
    return scoreSpendCardChoice(intent, input, cardOpportunity, 20, 0);
  }
  if (/whirling mist blossom/i.test(decision.prompt) && functional === "whirling mist blossom|2") {
    return 100;
  }
  if (/graveyard on top of your deck/i.test(decision.prompt)) {
    if (intent.optionId === "pass") return -5;
    return card ? 10 + cardOpportunity(card, input) : 0;
  }
  if (/equip an edge of autumn/i.test(decision.prompt)) {
    return intent.optionId === "pass" ? -20 : 100;
  }
  if (/discard/i.test(decision.prompt)) {
    return scoreSpendCardChoice(intent, input, cardOpportunity, 20, -5);
  }
  const binary = scoreBinaryChoice(intent.optionId, 10, -2);
  if (binary !== undefined) return binary;
  return card ? 10 + cardOpportunity(card, input) : 1;
}

function scorePlay(
  intent: GameIntent,
  input: BotPolicyInput,
  own: ReadonlyMap<number, CardView>,
): number {
  const card = intentCard(intent, own);
  const data = card ? input.cards[card.cardId] : undefined;
  if (!card || !data) return -20;
  if (shouldPreserveOpeningHand(input)) return -100;
  if (spendsOpeningArsenalReserve(intent, input, own)) return -100;

  const functional = key(data);
  const me = input.view.players[input.seat];
  const previous = previousAttackKey(input);
  const furtherAttack = remainingAttackAfter(intent, input, own);
  const reservedAttack = attackInReserve(intent, input, own);
  let score = 0;

  if (intent.kind === "activate-ability") {
    if (data.cardType === "weapon") {
      // A weapon swing that cannot continue the chain is only a fallback;
      // a competing attack for the last action point is scored on power.
      score = furtherAttack ? 30 : alternativeAttackNow(intent, input, own) ? data.attack ?? 0 : 7;
      if (furtherAttack && attacksThisTurn(input) === 0) score += 8;
    } else if (functional === "snapdragon scalers|0") {
      score = currentAttackIsOurs(input) && !currentAttackHasOrWillGetGoAgain(input) &&
          affordableAttackInReserve(intent, input, own)
        ? 28
        : -100;
    } else if (functional === "okana scar wraps|0") {
      const link = currentLink(input);
      const attackName = key(input.cards[link?.attackingCard.cardId ?? ""]);
      score = currentAttackIsOurs(input) && attackName.includes("vengeance") &&
          !!link && link.attackValue >= link.defenseValue
        ? 22
        : -40;
    } else if (functional === "iris of the blossom|0") {
      const alreadyHasBlossom = [...me.hand, ...me.arsenal, ...me.banish].some((candidate) =>
        key(input.cards[candidate.cardId]) === "whirling mist blossom|2"
      );
      // Whirling Mist Blossom is played at an action decision, so combat
      // windows (such as a Damage Step hit trigger) leave the fetch there,
      // where the plan values the discard.
      const midCombat = input.view.stack.length > 0 || currentLink(input) !== undefined;
      score = alreadyHasBlossom || midCombat || !canFundBlossomAfterIris(intent, input) ||
          !canPlayActionNow(input)
        ? -100
        : 12;
    } else if (functional === "energy potion|3") {
      score = me.resources < 2 ? 18 : -5;
    } else if (functional === "pouncing paws|0") {
      // The new tiger needs an action point and pays off through a Qi combo.
      score = canPlayActionNow(input) && comboInReserve(input) ? 20 : -100;
    } else if (functional === "tearing shuko|0") {
      score = canPlayActionNow(input) && tigerInReserve(input) ? 6 : -100;
    } else if (functional === "blood scent|0" || functional === "double cross strap|0") {
      // Only worth destroying when the resource pays for a reserved attack.
      score = !affordableAttackInReserve(intent, input, own) && affordableAttackInReserve(intent, input, own, 1)
        ? 16
        : -100;
    } else {
      score = 3;
    }
  } else if (isAttack(data)) {
    const attackNumber = attacksThisTurn(input) + 1;
    score = data.attack ?? 0;
    if (attackNumber === 2) score += 3;
    if (functional.startsWith("flying kick|") && attackNumber >= 3) score += 5;

    const goAgain = likelyGoAgain(functional, data, previous, input);
    if (goAgain && furtherAttack) score += 16;
    else if (!goAgain && furtherAttack) score -= 6;

    if (previous === "edge of autumn|0") {
      if (functional.startsWith("seek vengeance|")) score += 24;
      if (functional === "vengeance never rests|3") score += 22;
      if (functional === "enact vengeance|1") {
        score += 10 + input.view.players[1 - input.seat]!.arsenalCount * 8;
      }
    }
    if (previous === TIGER_KEY) {
      if (functional.startsWith("pouncing qi|")) score += 18;
      if (functional === "qi unleashed|3") score += 14;
    }
    if (functional === TIGER_KEY) {
      // Ephemeral and playable only this turn; it opens the Qi combos.
      score += 12 + (comboInReserve(input) ? 8 : 0);
    }
    if (functional === "aspect of tiger: body|1" && isRedAttackAction(previousAttack(input))) score += 10;
    if ((functional === "growl|1" || functional === "untamed|1") && tigerInReserve(input)) score += 4;
    if (functional.startsWith("bittering thorns|")) score += furtherAttack ? 7 : 0;
    if (functional === "whirling mist blossom|2") {
      const priorHit = [...input.view.chain].reverse().find((link) => link.resolved)?.hit === true;
      if (priorHit) score += 10;
      if (key(input.cards[card.playableFromSourceCardId ?? ""]) === "iris of the blossom|0") {
        score += 40;
      }
    }
    if (functional.startsWith("snatch|")) score += 4;
    if (intent.kind === "play-from-arsenal") score += 2;
  } else if (data.cardType === "attack-reaction") {
    if (!currentAttackIsOurs(input) || input.view.pendingDecision?.kind !== "attack-reaction") {
      score = -100;
    } else if (functional.startsWith("razor reflex|")) {
      score = currentAllyAttackIsAlreadyLethal(input) && currentAttackHasOrWillGetGoAgain(input)
        ? -100
        : 32 + (currentLink(input)?.goAgain === true || !reservedAttack ? 0 : 6);
    } else if (functional === "legacy of ikaru|3") {
      score = previous === "edge of autumn|0" ? 18 : 10;
    } else {
      score = 8;
    }
  } else if (data.cardType === "defense-reaction") {
    score = scoreDefenseReaction(data, input);
  } else if (functional === "energy potion|3") {
    score = furtherAttack ? -15 : 3;
  } else if (functional === "blessing of qi|1") {
    // An aura without go again ends the action phase.
    score = furtherAttack ? -4 : 9;
  } else if (functional === "arcane polarity|1") {
    score = input.view.turnFacts?.players[input.seat].arcaneDamageTaken ? 28 : -100;
  } else if (functional === "reinforce the line|1") {
    const link = currentLink(input);
    const target = link?.defendingCards.some((defender) => {
      const defending = input.cards[defender.cardId];
      return defender.owner === input.seat && defending?.cardType === "action" && isAttack(defending);
    }) === true;
    score = !currentAttackIsOurs(input) && target
      ? scoreDefenseReaction({ ...data, defense: 4 }, input)
      : -100;
  }

  for (const id of pitchIds(intent)) {
    const pitched = own.get(id);
    if (pitched) score -= 2 + cardOpportunity(pitched, input);
  }
  return score;
}

/** Deterministic, projection-only Ira policy. Equal scores retain engine order. */
function chooseIraReactiveIntent(input: BotPolicyInput): GameIntent {
  return chooseScoredIntent(withoutEmptyIrisSearch(input), {
    response: iraResponse,
    defend: scoreDefend,
    choose: scoreChoice,
    play: scorePlay,
    nextTurnArsenal: arsenalValuer(iraSolverRules),
  });
}

export interface IraTurnEvaluation {
  score: number;
  damage: number;
  attacks: number;
  futureValue: number;
  /** Damage-equivalent blocking value of equipment this line spent. */
  equipmentSpent: number;
  complete: boolean;
}

export type IraTurnPlan = TurnPlan<IraTurnEvaluation>;

function evaluateIraTurn(
  state: GameState,
  input: BotPolicyInput,
  root: TurnPlannerRoot,
  complete: boolean,
): IraTurnEvaluation {
  const opponent = input.view.players[1 - root.seat]!;
  const damage = Math.max(0, root.opponentLife - opponent.life);
  const opponentResponse = evaluateOpponentResponse(input, root);
  const attacks = input.view.turnFacts?.players[root.seat].attacks ?? attacksThisTurn(input);
  const future = evaluateTurnFuture(input, root, iraSolverRules);
  const equipmentSpent = spentEquipmentValue(input, root);
  const winnerScore = state.winner === root.seat
    ? 1_000_000
    : state.winner === 1 - root.seat
    ? -1_000_000
    : 0;
  const score = winnerScore
    + responseWeightedDamage(opponentResponse) * POINTS_PER_DAMAGE
    + future.score
    + attacks * 3
    - equipmentSpent * POINTS_PER_DAMAGE;
  return {
    score,
    damage,
    attacks,
    futureValue: future.score,
    equipmentSpent,
    complete,
  };
}

export interface IraIntentDecision {
  intent: GameIntent;
  plan?: IraTurnPlan;
}

const IRA_MAX_SEARCH_NODES = 4;
// Robe of Autumn's Fall's hit trigger is a Damage Step layer, so an Edge of
// Autumn opener spends four simulated priority passes before the next action.
const IRA_MAX_TRANSITIONS = 12;
const IRA_MAX_ROOT_CANDIDATES = 1;

export function chooseIraIntentWithTrace(input: BotPolicyInput): IraIntentDecision {
  input = withoutEmptyIrisSearch(input);
  if (shouldPreserveOpeningHand(input)) {
    return {
      intent: enforceAllyTargetPolicy(
        input,
        enforceSpectraPolicy(input, chooseIraReactiveIntent(input)),
      ),
    };
  }
  const plan = planTurn(input, {
    maxSearchNodes: IRA_MAX_SEARCH_NODES,
    maxTransitions: IRA_MAX_TRANSITIONS,
    maxRootCandidates: IRA_MAX_ROOT_CANDIDATES,
    chooseForced: (forced) => chooseIraReactiveIntent({ ...forced, state: undefined }),
    rankCandidate: (intent, observed) => scorePlay(intent, observed, ownCards(observed)),
    evaluateEnd: evaluateIraTurn,
    evaluateHorizon(state, observed, root) {
      const base = evaluateIraTurn(state, observed, root, false);
      const me = observed.view.players[root.seat];
      const remaining = handDamage([...me.hand, ...me.arsenal], observed, iraSolverRules);
      return { ...base, score: horizonScore(observed, root, base.score, base.futureValue, remaining), complete: false };
    },
  });
  const intent = enforceAllyTargetPolicy(
    input,
    enforceSpectraPolicy(input, plan?.intent ?? chooseIraReactiveIntent(input)),
  );
  return plan ? { intent, plan } : { intent };
}

/** Deterministic Ira policy with bounded whole-turn planning at clean action decisions. */
export function chooseIraIntent(input: BotPolicyInput): GameIntent {
  return chooseIraIntentWithTrace(input).intent;
}
