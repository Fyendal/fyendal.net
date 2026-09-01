import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { EquipmentSlot } from "@fyendal/shared";
import type {
  ScriptCtx,
  TokenCreationContext,
} from "./scripts.js";
import { abilityList, oncePerTurnEffectFlagKey } from "./scripts.js";
import type { CardInstance, ChainLinkState, PendingArcane, PendingDecisionState, PlayerState } from "./state.js";
import { queueDecisionBehindCrank } from "./decisionQueue.js";
import { rngInt } from "./rng.js";
import {
  cardColorOf,
  cardHasType,
  cardNamesOf,
  cardTypesOf,
  dataOf,
  scriptOf,
} from "./cardProperties.js";

import {
  logForSeats,
  logNameOf,
  logPrivate,
  logPublic,
  nameOf,
  tagKnownLogCardNames,
} from "./gameLog.js";

import {
  currentLink,
  findCard,
  findCardAnywhere,
  findPermanent,
  globalCardInstances,
  opponent,
  removeFromArray,
} from "./zoneQueries.js";

import { controlledPermanents, hookSources, observingHookSources } from "./sourceQueries.js";
import {
  transitionZone,
  transitionZoneFromEngineZone,
  transitionZoneIsPrivate,
} from "./transitions.js";

/** Reveal a group as one event. Reveals make the selected identities public
 * for the event but do not move or otherwise mutate the cards. */
function revealCards(
  state: GameStateInternal,
  runtime: EngineRuntime,
  revealingSeat: number,
  instanceIds: number[],
): boolean {
  if (state.players.some((candidate) =>
    controlledPermanents(state, candidate.seat, { faceDownEquipment: false })
      .some((source) => scriptOf(state, source.cardId, source)?.prohibitsReveals === true)
  )) return false;
  const cards = [...new Set(instanceIds)].flatMap((instanceId) => {
    const found = findCardAnywhere(state, instanceId);
    return found ? [found.card] : [];
  });
  if (cards.length === 0) return false;
  const hero = state.players[revealingSeat] as PlayerState;
  logPublic(
    state,
    // the ⟦id⟧ tags let clients preview the exact printing of each reveal
    `${nameOf(state, hero.heroCardId)} reveals ${cards.map((card) => `${nameOf(state, card.cardId)}⟦${card.cardId}⟧`).join(", ")}`,
  );
  for (const controller of state.players as PlayerState[]) {
    for (const observer of hookSources(state, controller.seat, {
      board: true,
      arsenal: true,
      equipment: true,
      weapons: true,
    })) {
      scriptOf(state, observer.cardId, observer)?.onAnyHeroReveals?.(
        runtime.makeCtx(state, controller.seat, observer, currentLink(state)),
        revealingSeat,
        cards,
      );
    }
  }
  return true;
}

function nextArsenalSlot(player: PlayerState): number {
  const used = new Set(player.arsenal.map((card, index) => card.arsenalSlot ?? index));
  let slot = 0;
  while (used.has(slot)) slot++;
  return slot;
}

/** Find the largest unresolved damage event currently aimed at a hero. Card
 * scripts declare non-combat events on their stack layers; combat damage is
 * derived directly from the active link. Amounts are prospective and therefore
 * do not include prevention. */
function incomingDamage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  targetSeat: number,
): { sourceInstanceId: number; amount: number } | undefined {
  let largest: { sourceInstanceId: number; amount: number } | undefined;
  const consider = (sourceInstanceId: number, amount: number): void => {
    const normalized = Math.max(0, amount);
    if (!largest || normalized > largest.amount) {
      largest = { sourceInstanceId, amount: normalized };
    }
  };

  const link = currentLink(state);
  if (link && link.targetAllyId === undefined && opponent(link.attacker) === targetSeat) {
    consider(
      link.attackingCard.instanceId,
      runtime.commands.computeAttack(state, link) - runtime.commands.computeDefense(state, link),
    );
  }

  for (const layer of state.stack) {
    const source = findCardAnywhere(state, layer.sourceInstanceId);
    if (!source) continue;
    const events = scriptOf(state, source.card.cardId, source.card)?.prospectiveHeroDamage?.(
      runtime.makeCtx(state, source.seat, source.card, currentLink(state)),
      layer,
    ) ?? [];
    for (const event of events) {
      if (event.targetSeat !== targetSeat) continue;
      const packet: PendingArcane = {
        sourceInstanceId: source.card.instanceId,
        sourceSeat: source.seat,
        targetSeat,
        amount: Math.max(0, event.amount),
        arcane: false,
      };
      consider(source.card.instanceId, packet.amount + runtime.commands.effectDamageBonus(state, packet));
    }
  }

  return largest;
}

/** Create a named card directly in a player's hand. */
function createCardInHandFor(
  state: GameStateInternal,
  player: PlayerState,
  cardId: string,
): CardInstance {
  const card: CardInstance = {
    instanceId: state.nextInstanceId++,
    cardId,
    owner: player.seat,
  };
  player.hand.push(card);
  player.flags.createdThisTurn = (Number(player.flags.createdThisTurn) || 0) + 1;
  const createdName = nameOf(state, cardId).trim().toLowerCase().replace(/\s+/g, " ");
  player.flags[`createdName:${createdName}`] = true;
  player.flags[`createdNameCount:${createdName}`] =
    (Number(player.flags[`createdNameCount:${createdName}`]) || 0) + 1;
  logPublic(state, `${nameOf(state, player.heroCardId)} creates ${nameOf(state, cardId)} in their hand`);
  return card;
}

/** Create a named public card directly in a player's banished zone. */
function createCardInBanishFor(
  state: GameStateInternal,
  player: PlayerState,
  cardId: string,
): CardInstance {
  const card: CardInstance = {
    instanceId: state.nextInstanceId++,
    cardId,
    owner: player.seat,
  };
  player.banish.push(card);
  player.flags.createdThisTurn = (Number(player.flags.createdThisTurn) || 0) + 1;
  const createdName = nameOf(state, cardId).trim().toLowerCase().replace(/\s+/g, " ");
  player.flags[`createdName:${createdName}`] = true;
  player.flags[`createdNameCount:${createdName}`] =
    (Number(player.flags[`createdNameCount:${createdName}`]) || 0) + 1;
  for (const subtype of dataOf(state, cardId).subtypes ?? []) {
    player.flags[`createdSubtype:${subtype.toLowerCase()}`] = true;
    player.flags[`createdSubtypeCount:${subtype.toLowerCase()}`] =
      (Number(player.flags[`createdSubtypeCount:${subtype.toLowerCase()}`]) || 0) + 1;
  }
  logPublic(
    state,
    `${nameOf(state, player.heroCardId)} creates ${nameOf(state, cardId)} in their banished zone`,
  );
  return card;
}

interface ObservedReactionAttackPower {
  instanceId: number;
  before: number;
}

function observeReactionAttackPower(
  state: GameStateInternal,
  runtime: EngineRuntime,
): ObservedReactionAttackPower | undefined {
  const link = currentLink(state);
  if (!link || state.phase !== "reaction") return undefined;
  return {
    instanceId: link.attackingCard.instanceId,
    before: runtime.commands.computeAttack(state, link),
  };
}

/** Publish the gain caused by one mutation command. Comparing immediately
 * before and after that command prevents unrelated aggregate modifiers from
 * masquerading as an exact +1 effect. */
function publishReactionAttackPowerGain(
  state: GameStateInternal,
  runtime: EngineRuntime,
  observed: ObservedReactionAttackPower | undefined,
): void {
  if (!observed) return;
  const link = currentLink(state);
  if (!link || link.attackingCard.instanceId !== observed.instanceId) return;
  let gained = runtime.commands.computeAttack(state, link) - observed.before;
  if (gained <= 0) return;
  let replaced = scriptOf(state, link.attackingCard.cardId, link.attackingCard)?.replacePowerGain?.(
    runtime.makeCtx(state, link.attacker, link.attackingCard, link),
    gained,
  ) ?? gained;
  for (const defender of link.defendingEquipment) {
    const next = scriptOf(state, defender.cardId, defender)?.replacePowerGain?.(
      runtime.makeCtx(state, opponent(link.attacker), defender, link),
      replaced,
    );
    if (next !== undefined) replaced = next;
  }
  replaced = runtime.commands.replaceTemporalPowerGain(state, link, replaced);
  if (replaced !== gained) {
    state.modifiers.push({
      id: state.nextModifierId++,
      sourceInstanceId: link.attackingCard.instanceId,
      seat: link.attacker,
      scope: "chain-link",
      attack: replaced - gained,
    });
    gained = replaced;
  }
  scriptOf(state, link.attackingCard.cardId, link.attackingCard)?.onFriendlyAttackPowerGained?.(
    runtime.makeCtx(state, link.attacker, link.attackingCard, link),
    gained,
  );
  for (const source of hookSources(state, link.attacker, {
    board: true,
    equipment: true,
    weapons: true,
    heroLast: true,
  })) {
    if (source.instanceId === link.attackingCard.instanceId) continue;
    scriptOf(state, source.cardId, source)?.onFriendlyAttackPowerGained?.(
      runtime.makeCtx(state, link.attacker, source, link),
      gained,
    );
  }
}

interface ScriptedChoiceDetails {
  cardOptions?: (number | string | null)[];
  defaultOption?: string;
  minimumSelections?: number;
  maximumSelections?: number;
  revealedCardIds?: number[];
  lookedCardIds?: number[];
}

type CardChoiceDetails = Omit<ScriptedChoiceDetails, "cardOptions" | "defaultOption">;

export function makeCtx(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  self: CardInstance,
  link?: ChainLinkState,
  fromArsenal?: boolean,
  playTargetInstanceId?: number,
  leavingArenaAsActivationCost?: boolean,
  tokenCreationCause: TokenCreationContext = { kind: "effect", sourceCardId: self.cardId },
): ScriptCtx {
  const player = state.players[seat] as PlayerState;
  // Card scripts commonly build logs from `ctx.data.name` and
  // `ctx.cardData(id).name`. Remember those exact definitions so log-only
  // metadata can preserve pitch without making rule-facing names impure.
  const referencedLogCardIds = new Set<string>([self.cardId]);
  const deckSearchAllowed = (): boolean => !state.players.some((candidate) =>
    controlledPermanents(state, candidate.seat, { faceDownEquipment: false })
      .some((source) => scriptOf(state, source.cardId, source)?.prohibitsDeckSearches === true),
  );
  const requestScriptedChoice = (
    hook: string,
    prompt: string,
    options: string[],
    choiceSeat?: number,
    details: ScriptedChoiceDetails = {},
  ): void => {
    // An unacknowledged look-at float for the same player folds into this
    // choice: the looked cards stay visible as context alongside it.
    const existing = state.pendingDecision;
    const look =
      existing?.chooseHook === "engine-look" && existing.player === (choiceSeat ?? seat)
        ? existing
        : undefined;
    // An empty option list would deadlock the game on an unanswerable
    // decision — the effect simply finds no target and fizzles.
    if (options.length === 0) {
      logPublic(state, `(fizzled, no options: ${prompt})`);
      return;
    }
    const decision: PendingDecisionState = {
      player: choiceSeat ?? seat,
      kind: options.length === 2 && options.every((option) => option === "yes" || option === "no")
        ? "optional-effect"
        : "choose-target",
      prompt,
      options,
      sourceInstanceId: self.instanceId,
      chooseHook: hook,
      ...(tokenCreationCause.kind !== "effect" || tokenCreationCause.sourceCardId !== self.cardId
        ? { tokenCreationCause }
        : {}),
      ...(details.cardOptions ? { cardOptions: details.cardOptions } : {}),
      ...(details.defaultOption !== undefined && options.includes(details.defaultOption)
        ? { defaultOption: details.defaultOption }
        : {}),
      ...(details.minimumSelections === undefined
        ? {}
        : {
            minimumSelections: details.minimumSelections,
            maximumSelections: details.maximumSelections,
          }),
      ...(details.revealedCardIds?.length
        ? { revealedCardIds: [...new Set(details.revealedCardIds)] }
        : {}),
      ...(details.lookedCardIds?.length
        ? { lookedCardIds: [...new Set(details.lookedCardIds)] }
        : {}),
    };
    // Crank is an intervening enter-arena choice. Preserve later decisions
    // from the resolving effect until that choice has been answered.
    if (existing?.chooseHook && !look) {
      if (!queueDecisionBehindCrank(state, decision)) {
        logPublic(state, `(skipped duplicate choice: ${prompt})`);
      }
      return;
    }
    state.pendingDecision = decision;
    if (look?.lookedCardIds?.length && !decision.lookedCardIds?.length) {
      // Cards already offered as clickable options need no context copy.
      const offered = new Set(
        (details.cardOptions ?? []).filter((id): id is number => typeof id === "number"),
      );
      const carried = look.lookedCardIds.filter((id) => !offered.has(id));
      if (carried.length) decision.lookedCardIds = carried;
    }
  };
  const requestCardDecision = (
    hook: string,
    prompt: string,
    options: (number | string)[],
    choiceSeat?: number,
    details: CardChoiceDetails = {},
  ): void => {
    const deckIds = new Set((state.players as PlayerState[]).flatMap((candidate) =>
      candidate.deck.map((card) => card.instanceId),
    ));
    if (
      options.some((option) => typeof option === "number" && deckIds.has(option)) &&
      !deckSearchAllowed()
    ) {
      logPublic(state, "the deck search is prohibited");
      return;
    }
    requestScriptedChoice(hook, prompt, options.map(String), choiceSeat, {
      ...details,
      cardOptions: options.map((option) => typeof option === "number" ? option : null),
    });
  };
  const ctx: ScriptCtx = {
    state,
    seat,
    self,
    data: dataOf(state, self.cardId),
    link,
    fromArsenal: fromArsenal ?? false,
    ...(leavingArenaAsActivationCost ? { leavingArenaAsActivationCost: true } : {}),
    ...((playTargetInstanceId ?? self.playTargetInstanceId) !== undefined
      ? { playTargetInstanceId: playTargetInstanceId ?? self.playTargetInstanceId }
      : {}),
    addModifier(m, source) {
      const observed = observeReactionAttackPower(state, runtime);
      const active = currentLink(state);
      const origin = source ?? self;
      const originData = dataOf(state, origin.cardId);
      const targetLink = m.appliesToInstanceId === undefined
        ? active
        : state.chain.find((candidate) =>
            candidate.attackingCard.instanceId === m.appliesToInstanceId
          );
      const suppressGain =
        Number(m.attack ?? 0) > 0 &&
        targetLink?.attackCardType === "action" &&
        state.players.some((candidate) => candidate.flags.suppressAttackPowerEffectGains === true) &&
        (origin.instanceId === targetLink.attackingCard.instanceId || originData.cardType === "attack-reaction");
      const attack =
        Number(m.attack ?? 0) > 0 &&
        targetLink &&
        state.phase !== "reaction" &&
        m.scope === "chain-link"
          ? runtime.commands.replaceTemporalPowerGain(state, targetLink, Number(m.attack))
          : m.attack;
      const effectiveAttack = suppressGain ? 0 : attack;
      // A resolved link remains a legal target while it is still on the
      // combat chain. Its combat result is immutable, but later numeric
      // modifiers still change the public value shown for that past attack.
      if (
        targetLink?.resolved &&
        m.scope === "chain-link" &&
        m.appliesToInstanceId === targetLink.attackingCard.instanceId &&
        effectiveAttack !== undefined
      ) {
        targetLink.finalAttack = Number(targetLink.finalAttack ?? runtime.commands.computeAttack(state, targetLink)) + effectiveAttack;
        if (effectiveAttack !== 0) {
          (targetLink.finalAttackModifiers ??= []).push({
            sourceInstanceId: origin.instanceId,
            sourceCardId: origin.cardId,
            amount: effectiveAttack,
          });
          for (const candidate of state.players as PlayerState[]) {
            candidate.flags.cardEffectResourceLifeOrStatGainThisTurn = true;
          }
        }
        publishReactionAttackPowerGain(state, runtime, observed);
        return;
      }
      state.modifiers.push({
        ...m,
        createdTurn: state.turn,
        sourceCardId: origin.cardId,
        ...(effectiveAttack !== undefined ? { attack: effectiveAttack } : {}),
        id: state.nextModifierId++,
        sourceInstanceId: origin.instanceId,
        seat:
          m.seat ??
          (m.appliesToInstanceId !== undefined ? targetLink?.attacker : undefined) ??
          seat,
      });
      if (Number(m.attack ?? 0) > 0 || Number(m.defense ?? 0) > 0) {
        for (const candidate of state.players as PlayerState[]) {
          candidate.flags.cardEffectResourceLifeOrStatGainThisTurn = true;
        }
      }
      publishReactionAttackPowerGain(state, runtime, observed);
    },
    player(targetSeat) {
      return state.players[targetSeat] as PlayerState;
    },
    changeResources(targetSeat, delta) {
      const target = state.players[targetSeat] as PlayerState;
      target.resources = Math.max(0, target.resources + delta);
      if (delta > 0) {
        for (const candidate of state.players as PlayerState[]) {
          candidate.flags.cardEffectResourceLifeOrStatGainThisTurn = true;
        }
      }
    },
    changeChi(targetSeat, delta) {
      const target = state.players[targetSeat] as PlayerState;
      target.chi = Math.max(0, target.chi + delta);
    },
    changeActionPoints(targetSeat, delta) {
      const target = state.players[targetSeat] as PlayerState;
      target.actionPoints = Math.max(0, target.actionPoints + delta);
    },
    grantAdditionalActivation(instanceId, count = 1) {
      const found = findCardAnywhere(state, instanceId);
      if (!found || count <= 0) return;
      const abilities = abilityList(scriptOf(state, found.card.cardId, found.card));
      const target = state.players[found.seat] as PlayerState;
      for (let index = 0; index < abilities.length; index++) {
        const key = `additionalActivations:${instanceId}:${index}`;
        target.flags[key] = Number(target.flags[key] || 0) + count;
      }
    },
    setAttackActivationLimit(instanceId, limit) {
      const found = findCardAnywhere(state, instanceId);
      if (!found || !Number.isSafeInteger(limit) || limit <= 0) return;
      const abilities = abilityList(scriptOf(state, found.card.cardId, found.card));
      const target = state.players[found.seat] as PlayerState;
      for (let index = 0; index < abilities.length; index++) {
        if (abilities[index]?.isAttack !== true) continue;
        const key = runtime.commands.setAttackActivationLimitKey(instanceId);
        target.flags[key] = Math.max(Number(target.flags[key] || 0), limit);
      }
    },
    allowAbilitiesAsInstant(type) {
      player.flags[`abilitiesAsInstant:${type.toLowerCase()}`] = true;
    },
    getPlayerFlag(targetSeat, key) {
      return (state.players[targetSeat] as PlayerState).flags[key] ?? false;
    },
    setPlayerFlag(targetSeat, key, value) {
      (state.players[targetSeat] as PlayerState).flags[key] = value;
    },
    grantOwnedInstantDiscardPrevention(amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0) return;
      player.flags.ownedInstantDiscardPrevention = Math.max(
        Number(player.flags.ownedInstantDiscardPrevention ?? 0),
        amount,
      );
    },
    suppressHeroAbilitiesThroughNextTurn(targetSeat) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: targetSeat,
        suppressesHeroAbilities: true,
        expiresAtEndOfSeatTurn: targetSeat,
      });
    },
    suppressHeroAbilitiesPermanently(targetSeat) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return;
      (target.hero.counters ??= {}).abilitiesDisabledPermanently = 1;
      logPublic(state, `${nameOf(state, target.heroCardId)} loses all abilities`);
    },
    loseGame(targetSeat) {
      if (!state.players[targetSeat] || state.winner !== null) return;
      state.winner = opponent(targetSeat);
      state.phase = "game-over";
      state.pendingDecision = null;
      state.stack = [];
      logPublic(state, `${nameOf(state, (state.players[targetSeat] as PlayerState).heroCardId)} loses the game`);
    },
    takeExtraTurn(targetSeat) {
      if (targetSeat !== 0 && targetSeat !== 1) return;
      (state.extraTurnSeats ??= []).push(targetSeat);
      logPublic(state, `${nameOf(state, (state.players[targetSeat] as PlayerState).heroCardId)} will take an extra turn`);
    },
    suppressOwnedCardAbilitiesNextTurn(targetSeat) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return;
      const disabledTurn = state.turn + (targetSeat === state.activePlayer ? 2 : 1);
      const counters = (target.hero.counters ??= {});
      counters.ownedCardAbilitiesDisabledTurn = Math.max(
        Number(counters.ownedCardAbilitiesDisabledTurn ?? 0),
        disabledTurn,
      );
      logPublic(
        state,
        `${nameOf(state, target.heroCardId)}'s cards lose all abilities during their next turn`,
      );
    },
    randomInt(maxExclusive) {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) return 0;
      return rngInt(state, maxExclusive);
    },
    rollDie(sides = 6) {
      if (!Number.isSafeInteger(sides) || sides <= 0) return 0;
      return runtime.commands.recordDieRoll(state, player, sides);
    },
    requestDieRoll(hook, sides = 6) {
      if (!Number.isSafeInteger(sides) || sides <= 0) return;
      const extraDiceIgnoreLowest = state.modifiers.reduce(
        (total, modifier) => modifier.seat === seat && !modifier.consumed
          ? total + Number(modifier.extraDiceIgnoreLowest ?? 0)
          : total,
        0,
      );
      const result = runtime.commands.rollIgnoringLowest(state, sides, extraDiceIgnoreLowest);
      const replacement = state.players.flatMap((candidate) =>
        Object.values(candidate.equipment).flatMap((card) =>
          card && !card.faceDown && scriptOf(state, card.cardId, card)?.dieRollReplacement === true
            ? [{ card, seat: candidate.seat }]
            : []
        )
      )[0];
      if (!replacement) {
        logPublic(state, `${nameOf(state, player.heroCardId)} rolls ${result}`);
        runtime.commands.recordDieResult(state, player, result);
        scriptOf(state, self.cardId, self)?.onDieRollResolved?.(ctx, hook, result);
        return;
      }
      logPublic(state, `${nameOf(state, player.heroCardId)} rolls ${result}`);
      state.pendingDecision = {
        player: replacement.seat,
        kind: "optional-effect",
        prompt: `Destroy ${nameOf(state, replacement.card.cardId)} to reroll the ${result}?`,
        options: ["reroll", "keep"],
        sourceInstanceId: replacement.card.instanceId,
        chooseHook: "engine-die-roll-replacement",
        dieRoll: {
          rollingSourceInstanceId: self.instanceId,
          rollingSeat: seat,
          hook,
          sides,
          result,
          ...(extraDiceIgnoreLowest > 0 ? { extraDiceIgnoreLowest } : {}),
          replacementInstanceId: replacement.card.instanceId,
        },
      };
    },
    revealCards(instanceIds, revealingSeat = seat) {
      return revealCards(state, runtime, revealingSeat, instanceIds);
    },
    canSearchDeck: deckSearchAllowed,
    shuffleDeck(targetSeat = seat) {
      const target = state.players[targetSeat] as PlayerState;
      const deck = target.deck;
      // shuffleInPlace is kept inside the engine so all randomness advances
      // the persisted seeded RNG.
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rngInt(state, i + 1);
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
      }
      logPublic(state, `${nameOf(state, target.heroCardId)} shuffles their deck`);
    },
    destroyPermanent(instanceId, destroyingSeat = seat) {
      if (!state.players[destroyingSeat]) return false;
      const found = findPermanent(state, instanceId);
      if (!found) return false;
      return runtime.commands.destroyPermanent(state, destroyingSeat, found.card);
    },
    usurpRunechant(instanceId, attackingInstanceId) {
      const rune = findPermanent(state, instanceId);
      const attack = findCardAnywhere(state, attackingInstanceId)?.card;
      if (!rune || rune.seat !== seat || !attack) return false;
      const script = scriptOf(state, rune.card.cardId, rune.card);
      if (script?.runechantToken !== true) return false;
      script.onUsurped?.(
        runtime.makeCtx(state, seat, rune.card, currentLink(state)),
        attack,
      );
      player.flags.usurpedThisTurn = true;
      return runtime.commands.destroyPermanent(state, seat, rune.card);
    },
    destroyAttackingCard() {
      const link = currentLink(state);
      if (!link || link.flags.attackGone === true) return false;
      if (link.attackCardType !== "action") {
        const found = findPermanent(state, link.attackingCard.instanceId);
        return !!found && runtime.commands.destroyPermanent(state, seat, found.card);
      }
      link.flags.attackGone = true;
      runtime.commands.moveToGraveyard(state, link.attackingCard, "chain", seat);
      logPublic(state, `${nameOf(state, link.attackingCard.cardId)} is destroyed`);
      runtime.events.runHook(state, link.attacker, link.attackingCard, "onDestroyed", link);
      runtime.events.fireFriendlyDestroyed(state, link.attacker, link.attackingCard, seat);
      return true;
    },
    destroyDefendingCard(instanceId) {
      const permanent = findPermanent(state, instanceId);
      if (permanent) {
        const defending = state.chain.some((chainLink) =>
          chainLink.defendingEquipment.some((card) => card.instanceId === instanceId)
        );
        return defending && runtime.commands.destroyPermanent(state, seat, permanent.card);
      }
      for (const chainLink of state.chain) {
        const card = removeFromArray(chainLink.defendingCards, instanceId);
        if (!card) continue;
        runtime.commands.moveToGraveyard(state, card, "chain", seat);
        logPublic(state, `${nameOf(state, card.cardId)} is destroyed`);
        runtime.events.runHook(state, card.owner, card, "onDestroyed", chainLink);
        runtime.events.fireFriendlyDestroyed(state, card.owner, card, seat);
        return true;
      }
      return false;
    },
    destroySubcard(instanceId) {
      const found = findPermanent(state, instanceId);
      const card = found?.card.subcards?.pop();
      if (!found || !card) return false;
      runtime.commands.moveToGraveyard(state, card, "under", seat);
      logPublic(state, `${nameOf(state, card.cardId)} is destroyed from under ${nameOf(state, found.card.cardId)}`);
      runtime.events.runHook(state, found.seat, card, "onDestroyed");
      runtime.events.fireFriendlyDestroyed(state, found.seat, card);
      return true;
    },
    banishSubcard(instanceId, subcardInstanceId) {
      const found = findPermanent(state, instanceId);
      if (!found?.card.subcards?.length) return false;
      const index = subcardInstanceId === undefined
        ? found.card.subcards.length - 1
        : found.card.subcards.findIndex((candidate) => candidate.instanceId === subcardInstanceId);
      if (index < 0) return false;
      const [card] = found.card.subcards.splice(index, 1);
      if (!card) return false;
      (state.players[card.owner] as PlayerState).banish.push(card);
      logPublic(state, `${nameOf(state, card.cardId)} is banished from under ${nameOf(state, found.card.cardId)}`);
      return true;
    },
    putSelfUnder(instanceId) {
      const target = findPermanent(state, instanceId);
      if (!target || target.seat !== seat || target.card.instanceId === self.instanceId) return false;
      const found = runtime.commands.removeFromStackResolution(state, self.instanceId);
      if (!found) return false;
      (target.card.subcards ??= []).push(found.card);
      logPublic(state, `${nameOf(state, found.card.cardId)} is put under ${nameOf(state, target.card.cardId)}`);
      return true;
    },
    globalCards() {
      return globalCardInstances(state, seat);
    },
    destroyGlobal(instanceId) {
      const target = globalCardInstances(state, seat).find(
        (candidate) => candidate.instanceId === instanceId,
      );
      if (!target) return false;
      const index = state.globalCardIds.indexOf(target.cardId);
      if (index < 0) return false;
      state.globalCardIds.splice(index, 1);
      logPublic(state, `${nameOf(state, target.cardId)} is destroyed`);
      return true;
    },
    moveToGraveyard(instanceId, from = "effect") {
      const found = runtime.commands.removeFromOwnerZones(state, instanceId);
      if (!found) return false;
      runtime.commands.moveToGraveyard(state, found.card, from, seat);
      if (found.fromArena) runtime.commands.fireLeaveArena(state, found.owner.seat, found.card, "graveyard");
      return true;
    },
    moveToHand(instanceId) {
      const foundInOwnerZone = runtime.commands.removeFromOwnerZones(state, instanceId);
      let foundOnChain: CardInstance | undefined;
      for (const link of state.chain) {
        const chainCard = removeFromArray(link.defendingCards, instanceId)
          ?? removeFromArray(link.reactions, instanceId);
        foundOnChain ??= chainCard;
        const equipment = removeFromArray(link.defendingEquipment, instanceId);
        if (equipment) {
          foundOnChain ??= equipment;
          link.flags[`equipmentGone:${instanceId}`] = true;
        }
      }
      const found = foundInOwnerZone ?? (foundOnChain
        ? {
            owner: state.players[foundOnChain.owner] as PlayerState,
            card: foundOnChain,
            fromArena: false,
            fromZone: "chain",
          }
        : undefined);
      if (!found) return false;
      delete found.card.faceDown;
      found.owner.hand.push(found.card);
      if (found.fromZone === "graveyard") {
        runtime.events.fireCardLeavesGraveyard(state, found.owner.seat, found.card, "hand");
      }
      if (found.fromArena) runtime.commands.fireLeaveArena(state, found.owner.seat, found.card, "hand");
      if (found.fromZone === "deck") {
        runtime.events.queueTriggeredEvent(
          state,
          "card-moved-from-deck-by-effect",
          found.owner.seat,
          found.card,
          { from: "deck", to: "hand", causedBySeat: seat },
        );
      }
      return true;
    },
    moveInventoryToHand(instanceId) {
      const inventory = player.inventory;
      if (!inventory) return false;
      const card = removeFromArray(inventory, instanceId);
      if (!card) return false;
      player.hand.push(card);
      logPublic(state, `${nameOf(state, card.cardId)} is revealed from inventory and put into hand`);
      return true;
    },
    pitchCard(instanceId) {
      const located = findCardAnywhere(state, instanceId);
      if (!located) return false;
      const pitchingPlayer = state.players[located.seat] as PlayerState;
      if (runtime.commands.pitchProhibitedByEffect(state, pitchingPlayer, located.card)) return false;
      const found = runtime.commands.removeFromOwnerZones(state, instanceId);
      if (!found) return false;
      const pitch = runtime.commands.pitchValueOfInstance(state, found.card);
      runtime.commands.notePitch(state, found.owner, found.card);
      found.owner.pitch.push(found.card);
      runtime.commands.pitchIntoPool(state, found.owner, found.card, pitch);
      if (found.fromZone === "graveyard") {
        runtime.events.fireCardLeavesGraveyard(state, found.owner.seat, found.card, "pitch");
      }
      return true;
    },
    settleCard(instanceId, opts) {
      const located = findCardAnywhere(state, instanceId);
      if (!located || !runtime.commands.entersArena(dataOf(state, located.card.cardId))) return false;
      const controller = opts?.controllerSeat === undefined
        ? state.players[located.card.owner] as PlayerState | undefined
        : state.players[opts.controllerSeat] as PlayerState | undefined;
      if (!controller) return false;
      const found = runtime.commands.removeFromOwnerZones(state, instanceId);
      if (!found) return false;
      delete found.card.faceDown;
      runtime.commands.settlePlayedCard(state, controller, found.card, opts);
      if (found.fromZone === "graveyard") {
        runtime.events.fireCardLeavesGraveyard(state, found.owner.seat, found.card, "arena");
      }
      if (found.fromZone === "deck") {
        runtime.events.queueTriggeredEvent(
          state,
          "card-moved-from-deck-by-effect",
          found.owner.seat,
          found.card,
          { from: "deck", to: "arena", causedBySeat: seat },
        );
      }
      return true;
    },
    setCardFaceDown(instanceId, faceDown) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return false;
      if (faceDown) found.card.faceDown = true;
      else delete found.card.faceDown;
      return true;
    },
    addCardTempPower(instanceId, delta) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return false;
      const observed = observeReactionAttackPower(state, runtime);
      const active = currentLink(state);
      const targetLink = state.chain.find(
        (candidate) => candidate.attackingCard.instanceId === instanceId,
      );
      const suppressGain =
        delta > 0 &&
        active?.attackCardType === "action" &&
        active.attackingCard.instanceId === instanceId &&
        ((state.players[active.attacker] as PlayerState).flags.attacksCannotGainPower === true ||
          (state.players.some((candidate) => candidate.flags.suppressAttackPowerEffectGains === true) &&
            (self.instanceId === instanceId || dataOf(state, self.cardId).cardType === "attack-reaction")));
      let adjusted =
        suppressGain
          ? 0
          : delta > 0 && state.phase !== "reaction" && !found.card.faceDown
          ? scriptOf(state, found.card.cardId, found.card)?.replacePowerGain?.(
              runtime.makeCtx(state, found.seat, found.card, currentLink(state)),
              delta,
            ) ?? delta
          : delta;
      if (adjusted > 0 && state.phase !== "reaction" && active?.attackingCard.instanceId === instanceId) {
        for (const defender of active.defendingEquipment) {
          const next = scriptOf(state, defender.cardId, defender)?.replacePowerGain?.(
            runtime.makeCtx(state, opponent(active.attacker), defender, active),
            adjusted,
          );
          if (next !== undefined) adjusted = next;
        }
        adjusted = runtime.commands.replaceTemporalPowerGain(state, active, adjusted);
      }
      found.card.tempPower = (found.card.tempPower ?? 0) + adjusted;
      // A targeted effect can modify any attack still on the combat chain.
      // Once that link has resolved, update only its presentation snapshot;
      // combat damage, hit state, and triggers remain untouched.
      if (targetLink?.resolved && adjusted !== 0) {
        targetLink.finalAttack = Number(targetLink.finalAttack ?? runtime.commands.computeAttack(state, targetLink)) + adjusted;
        (targetLink.finalAttackModifiers ??= []).push({
          sourceInstanceId: self.instanceId,
          sourceCardId: self.cardId,
          amount: adjusted,
        });
      }
      publishReactionAttackPowerGain(state, runtime, observed);
      return true;
    },
    grantCardName(instanceId, name) {
      const found = findCardAnywhere(state, instanceId);
      const normalized = name.trim();
      if (!found || !normalized) return false;
      if (state.modifiers.some((modifier) =>
        modifier.seat === found.card.owner && modifier.suppressesOwnedNames === true
      )) return false;
      const names = (found.card.grantedNames ??= []);
      if (!names.some((candidate) => candidate.toLowerCase() === normalized.toLowerCase())) {
        names.push(normalized);
      }
      logPublic(state, `${nameOf(state, found.card.cardId)} gains the name ${normalized}`);
      return true;
    },
    setChosenName(name) {
      const normalized = name.trim();
      if (!normalized) return;
      self.chosenName = normalized;
      // A resolving card and its combat-chain representation can be distinct
      // snapshots of the same physical instance. Persist the choice on every
      // chain copy so abilities that remain functional while attacking or
      // defending observe the chosen name after resolution.
      for (const link of state.chain) {
        for (const card of [
          link.attackingCard,
          ...link.defendingCards,
          ...link.defendingEquipment,
          ...link.reactions,
        ]) {
          if (card.instanceId === self.instanceId) card.chosenName = normalized;
        }
      }
    },
    grantCardType(instanceId, type) {
      const found = findCardAnywhere(state, instanceId);
      const normalized = type.trim().toLowerCase();
      if (!found || !normalized) return false;
      const types = (found.card.grantedTypes ??= []);
      if (!types.includes(normalized)) types.push(normalized);
      logPublic(state, `${nameOf(state, found.card.cardId)} gains the type ${normalized}`);
      return true;
    },
    removeCardType(instanceId, type) {
      const found = findCardAnywhere(state, instanceId);
      const normalized = type.trim().toLowerCase();
      if (!found || !normalized || !found.card.grantedTypes) return false;
      found.card.grantedTypes = found.card.grantedTypes.filter((candidate) => candidate !== normalized);
      if (found.card.grantedTypes.length === 0) delete found.card.grantedTypes;
      return true;
    },
    setCardColor(instanceId, color) {
      const found = findCardAnywhere(state, instanceId);
      if (!found || ![1, 2, 3].includes(color)) return false;
      found.card.grantedColor = color;
      const label = color === 1 ? "red" : color === 2 ? "yellow" : "blue";
      logPublic(state, `${nameOf(state, found.card.cardId)} becomes ${label}`);
      return true;
    },
    grantBaseAbilities(instanceId, sourceCardId) {
      const found = findCardAnywhere(state, instanceId);
      if (!found || !state.cardsRef[sourceCardId]) return false;
      const active = currentLink(state);
      if (active?.flags.attackAbilitiesSuppressed === true && active.attackingCard.instanceId === instanceId) {
        return false;
      }
      if (!found.card.grantedBaseAbilitiesCardId) {
        found.card.grantedBaseAbilitiesCardId = sourceCardId;
      } else {
        (found.card.grantedBaseAbilitiesCardIds ??= []).push(sourceCardId);
      }
      return true;
    },
    becomeCardCopy(instanceId, sourceCardId) {
      const found = findCardAnywhere(state, instanceId);
      if (!found || !state.cardsRef[sourceCardId]) return false;
      found.card.copyOriginalCardId ??= found.card.cardId;
      found.card.cardId = sourceCardId;
      delete found.card.grantedBaseAbilitiesCardId;
      return true;
    },
    negateStackCard(instanceId) {
      const index = state.stack.findIndex((layer) => layer.card?.instanceId === instanceId);
      if (index < 0) return false;
      const [layer] = state.stack.splice(index, 1);
      const card = layer?.card;
      if (!card) return false;
      const owner = state.players[card.owner] as PlayerState;
      delete card.playTargetInstanceId;
      owner.graveyard.push(card);
      logPublic(state, `${nameOf(state, card.cardId)} is negated`);
      return true;
    },
    addCardTempDefense(instanceId, delta) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return false;
      found.card.tempDefense = (found.card.tempDefense ?? 0) + delta;
      // Equipment remains in its equipment slot while a JSON-cloned copy also
      // rides the chain. Keep the defending copy in sync because combat reads
      // defense from the chain object.
      for (const link of state.chain) {
        const defending = link.defendingEquipment.find((card) => card.instanceId === instanceId);
        if (defending && defending !== found.card) {
          defending.tempDefense = (defending.tempDefense ?? 0) + delta;
        }
      }
      return true;
    },
    setCardBaseDefenseForLink(instanceId, defense) {
      const current = link ?? currentLink(state);
      if (!current || !Number.isFinite(defense)) return false;
      const defending = [...current.defendingCards, ...current.defendingEquipment].some(
        (card) => card.instanceId === instanceId,
      );
      if (!defending) return false;
      current.flags[`baseDefense:${instanceId}`] = defense;
      return true;
    },
    addCardDefenseCounters(instanceId, delta) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return false;
      found.card.defCounters = Math.max(0, (found.card.defCounters ?? 0) + delta);
      return true;
    },
    grantCardKeyword(instanceId, keyword) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return false;
      const active = currentLink(state);
      if (active?.flags.attackAbilitiesSuppressed === true && active.attackingCard.instanceId === instanceId) {
        return false;
      }
      // Keep repeated grants distinct: multiple instances of a numerical
      // keyword such as Arcane Barrier can each apply to the same event.
      const normalized = keyword.toLowerCase();
      (found.card.grantedKeywords ??= []).push(normalized);
      if (normalized === "go again") {
        const layer = state.stack.find((candidate) => candidate.card?.instanceId === instanceId);
        if (layer) layer.goAgain = true;
      }
      return true;
    },
    suppressCardKeyword(instanceId, keyword) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return false;
      const normalized = keyword.toLowerCase();
      const keywords = (found.card.suppressedKeywords ??= []);
      if (!keywords.includes(normalized)) keywords.push(normalized);
      if (normalized === "go again") {
        for (const chainLink of state.chain) {
          if (chainLink.attackingCard.instanceId === instanceId) chainLink.goAgain = false;
        }
      }
      return true;
    },
    suppressAttackAbilities() {
      if (!link) return false;
      link.flags.attackAbilitiesSuppressed = true;
      link.goAgain = false;
      return true;
    },
    consumeModifier(modifierId) {
      const modifier = state.modifiers.find((candidate) => candidate.id === modifierId);
      if (!modifier) return false;
      modifier.consumed = true;
      return true;
    },
    basePower(cardOrId) {
      const observed = typeof cardOrId === "number"
        ? findCardAnywhere(state, cardOrId)?.card
        : cardOrId as CardInstance;
      if (!observed) return 0;
      return runtime.commands.basePowerOf(state, observed.owner, observed, dataOf(state, observed.cardId).attack ?? 0);
    },
    currentPower(cardOrId) {
      const observed = typeof cardOrId === "number"
        ? findCardAnywhere(state, cardOrId)?.card
        : cardOrId as CardInstance;
      if (!observed) return 0;
      return runtime.commands.currentPowerOf(state, observed, link);
    },
    currentAttackPower() {
      return link ? runtime.commands.computeAttack(state, link) : 0;
    },
    currentAttackHasDominate() {
      return link ? runtime.commands.attackHasDominate(state, link) : false;
    },
    currentAttackHasOverpower() {
      return link ? runtime.commands.attackHasOverpower(state, link) : false;
    },
    incomingDamage(targetSeat) {
      return incomingDamage(state, runtime, targetSeat);
    },
    previewArcaneDamage(n, opts) {
      const sourceInstanceId = opts?.sourceInstanceId ?? self.instanceId;
      const source = findCardAnywhere(state, sourceInstanceId);
      const packet: PendingArcane = {
        sourceInstanceId,
        sourceSeat: source?.seat ?? seat,
        targetSeat: seat,
        amount: Math.max(0, n),
        arcane: true,
      };
      if (packet.amount <= 0) return packet.amount;
      packet.amount += runtime.commands.boundArcaneCardBonus(state, packet);
      packet.amount += Math.max(
        0,
        Number((state.players[packet.sourceSeat] as PlayerState).flags.nextArcaneBonus ?? 0),
      );
      packet.amount += runtime.commands.effectDamageBonus(state, packet);
      return packet.amount;
    },
    attackBonusAboveBase(excludeSourceId) {
      return link ? runtime.commands.attackBonusAboveBase(state, link, excludeSourceId) : 0;
    },
    chainLinksControlled(targetSeat = seat, type) {
      return runtime.commands.chainLinksControlled(state, targetSeat, type);
    },
    currentAttackHasType(type) {
      return !!link && runtime.commands.linkAttackHasType(state, link, type);
    },
    hitsThisCombatChain(targetSeat) {
      return runtime.commands.hitsThisCombatChain(state, targetSeat);
    },
    currentChainLinkNumber() {
      return link ? runtime.commands.chainLinkNumber(state, link) : 0;
    },
    dealDamage(targetSeat, n, opts) {
      const sourceInstanceId = opts?.sourceInstanceId ?? self.instanceId;
      const liveSource = findCardAnywhere(state, sourceInstanceId);
      const damageSource =
        liveSource ??
        (sourceInstanceId === self.instanceId ? { seat, card: self } : undefined);
      const sourceIsAlly =
        !!damageSource &&
        (dataOf(state, damageSource.card.cardId).subtypes ?? []).includes("ally");
      const sourceIsRunechant =
        !!damageSource &&
        scriptOf(state, damageSource.card.cardId, damageSource.card)?.runechantToken === true;
      const packet: PendingArcane = {
        sourceInstanceId,
        sourceSeat: damageSource?.seat ?? seat,
        ...(sourceIsAlly ? { sourceIsAlly: true } : {}),
        ...(sourceIsRunechant ? { sourceIsRunechant: true } : {}),
        targetSeat,
        amount: n,
        arcane: opts?.arcane === true,
        ...(opts?.unpreventable ? { unpreventable: true } : {}),
        ...(opts?.countsAsHit ? { countsAsHit: true } : {}),
        ...(opts?.destroySourceAfterDamage ? { destroySourceAfterDamage: true } : {}),
        ...(opts?.targetAllyId !== undefined ? { targetAllyId: opts.targetAllyId } : {}),
      };
      return runtime.commands.dealEffectDamage(state, packet);
    },
    gainLife(targetSeat, n) {
      if (n > 0) {
        for (const candidate of state.players as PlayerState[]) {
          candidate.flags.cardEffectResourceLifeOrStatGainThisTurn = true;
        }
      }
      runtime.commands.gainHeroLife(state, targetSeat, n);
    },
    loseLife(targetSeat, n) {
      const target = state.players[targetSeat] as PlayerState;
      const lost = Math.max(0, n);
      target.life = Math.max(0, target.life - lost);
      if (lost > 0) target.flags.lostLifeThisTurn = true;
    },
    gainActionPoint() {
      // CR 8.5.7b: a non-turn-player cannot gain action points
      if (seat !== state.activePlayer) return;
      player.actionPoints += 1;
      logPublic(state, `${nameOf(state, player.heroCardId)} gains an action point`);
    },
    drawCards(targetSeat, n) {
      const p = state.players[targetSeat] as PlayerState;
      runtime.commands.drawCards(state, p, n, self);
      logPublic(state, `${nameOf(state, p.heroCardId)} draws ${n} card(s)`);
    },
    discardRandom(targetSeat, n) {
      const p = state.players[targetSeat] as PlayerState;
      const discarded: CardInstance[] = [];
      for (let i = 0; i < n && p.hand.length > 0; i++) {
        const c = p.hand.splice(rngInt(state, p.hand.length), 1)[0] as CardInstance;
        runtime.commands.discardToGraveyard(state, targetSeat, c, true, seat);
        discarded.push(c);
      }
      for (const c of discarded) runtime.commands.fireOnDiscard(state, targetSeat, c, true);
      return discarded;
    },
    banishRandomFromHandUntilEndPhase(targetSeat, returnTurn) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target || target.hand.length === 0 || !Number.isSafeInteger(returnTurn)) {
        return undefined;
      }
      const card = target.hand.splice(rngInt(state, target.hand.length), 1)[0] as CardInstance;
      card.faceDown = true;
      card.returnToHandAtTurn = returnTurn;
      target.banish.push(card);
      logPublic(state, `${nameOf(state, target.heroCardId)} banishes a random card face down`);
      return card;
    },
    discardCard(targetSeat, instanceId) {
      const p = state.players[targetSeat] as PlayerState;
      const c = removeFromArray(p.hand, instanceId);
      if (!c) return undefined;
      runtime.commands.discardToGraveyard(state, targetSeat, c, false, seat);
      runtime.commands.fireOnDiscard(state, targetSeat, c, false);
      return c;
    },
    intimidate(targetSeat = opponent(seat), count = 1) {
      if (!Number.isSafeInteger(count) || count <= 0) return;
      runtime.commands.resolveIntimidate(state, seat, count, targetSeat);
    },
    grantGoAgain(targetAttackInstanceId) {
      const target = targetAttackInstanceId === undefined
        ? link
        : state.chain.find((candidate) =>
            candidate.attackingCard.instanceId === targetAttackInstanceId
          );
      if (target && target.flags.attackGone !== true) runtime.events.grantLinkGoAgain(state, target);
    },
    crowdBoo(targetSeat) {
      runtime.commands.crowdBoo(state, targetSeat);
    },
    crowdCheer(targetSeat) {
      runtime.commands.crowdCheer(state, targetSeat);
    },
    requestClash(withSeat, resultHook) {
      runtime.commands.requestClash(state, seat, withSeat, self.instanceId, resultHook);
    },
    wager(withSeat, rewardCardIds, rewardLabel) {
      const activeLink = currentLink(state);
      if (!activeLink || activeLink.attacker !== seat || !state.players[withSeat]) return;
      activeLink.flags.wagered = true;
      activeLink.flags.wagerCount = Number(activeLink.flags.wagerCount ?? 0) + 1;
      const tokenNames = rewardCardIds.map((cardId) => nameOf(state, cardId));
      const publicReward = rewardLabel?.trim() || (tokenNames.length > 0
        ? `Winner creates ${tokenNames.join(tokenNames.length === 2 ? " and " : ", ")}`
        : "No specified prize");
      (activeLink.wagerRewards ??= []).push(publicReward);
      (activeLink.wagers ??= []).push({
        source: runtime.commands.snapshotSerializable(self),
        controllerSeat: seat,
        opposingSeat: withSeat,
        rewardCardIds: [...rewardCardIds],
        rewardLabel: publicReward,
      });
      logPublic(
        state,
        `${nameOf(state, (state.players[seat] as PlayerState).heroCardId)} wagers with ${nameOf(state, (state.players[withSeat] as PlayerState).heroCardId)}: ${publicReward}`,
      );
      runtime.events.queueTriggeredEvent(state, "wager-generated", seat, activeLink.attackingCard);
    },
    compareLife(aSeat, bSeat) {
      return runtime.commands.compareLife(state, aSeat, bSeat);
    },
    tap(instanceId) {
      return runtime.commands.tapPermanent(state, instanceId, true);
    },
    untap(instanceId) {
      return runtime.commands.tapPermanent(state, instanceId, false);
    },
    destroyAtEndPhase(instanceId) {
      const found = findPermanent(state, instanceId);
      if (!found) return false;
      state.pendingDestructions.push({ seat: found.seat, instanceId });
      logPublic(state, `${nameOf(state, found.card.cardId)} will be destroyed at the beginning of the end phase`);
      return true;
    },
    scheduleEndOfTurnTrigger(hook, label, subjectSeat = seat) {
      state.delayedTriggers.push({
        source: runtime.commands.snapshotSerializable(self),
        seat,
        subjectSeat,
        event: "end-of-turn",
        turn: state.turn,
        hook,
        label,
      });
    },
    lookAt(instanceId) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return;
      // the identity is private: logged to the looking player only (the ⟦id⟧
      // tag lets the client preview the exact printing/pitch) …
      logPrivate(state, seat, `You look at ${nameOf(state, found.card.cardId)}⟦${found.card.cardId}⟧`);
      // … and floated as card images with a pass button until acknowledged.
      // Successive looks coalesce into one float; if the effect follows up
      // with its own choice, requestChoice folds the float into that choice.
      const pd = state.pendingDecision;
      if (pd?.chooseHook === "engine-look" && pd.player === seat) {
        if (!(pd.lookedCardIds ?? []).includes(instanceId)) {
          pd.lookedCardIds = [...(pd.lookedCardIds ?? []), instanceId];
        }
        return;
      }
      // another decision is already open; the log line still stands
      if (pd?.chooseHook) return;
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: `${nameOf(state, self.cardId)}: look at`,
        options: ["pass"],
        sourceInstanceId: self.instanceId,
        chooseHook: "engine-look",
        lookedCardIds: [instanceId],
        defaultOption: "pass",
      };
    },
    lookAtForSeat(instanceId, lookingSeat) {
      const found = findCardAnywhere(state, instanceId);
      const lookingPlayer = state.players[lookingSeat];
      if (!found || !lookingPlayer) return;
      logPrivate(state, lookingSeat, `You look at ${nameOf(state, found.card.cardId)}⟦${found.card.cardId}⟧`);
      const pd = state.pendingDecision;
      if (pd?.chooseHook === "engine-look" && pd.player === lookingSeat) {
        if (!(pd.lookedCardIds ?? []).includes(instanceId)) {
          pd.lookedCardIds = [...(pd.lookedCardIds ?? []), instanceId];
        }
        return;
      }
      if (pd?.chooseHook) return;
      state.pendingDecision = {
        player: lookingSeat,
        kind: "choose-target",
        prompt: `${nameOf(state, self.cardId)}: look at`,
        options: ["pass"],
        sourceInstanceId: self.instanceId,
        chooseHook: "engine-look",
        lookedCardIds: [instanceId],
        defaultOption: "pass",
      };
    },
    steal(instanceId, opts) {
      // only opposing board permanents can be stolen (allies/items/auras/tokens)
      const opp = state.players[seat === 0 ? 1 : 0] as PlayerState;
      const idx = opp.board.findIndex((c) => c.instanceId === instanceId);
      if (idx < 0) return false;
      const card = opp.board.splice(idx, 1)[0] as CardInstance;
      player.board.push(card);
      runtime.commands.stampControlledName(state, player, card);
      player.flags.stolenThisTurn = (Number(player.flags.stolenThisTurn) || 0) + 1;
      for (const stolenName of cardNamesOf(state, card)) {
        player.flags[`stolenName:${stolenName}`] = true;
        player.flags[`stolenNameCount:${stolenName}`] =
          (Number(player.flags[`stolenNameCount:${stolenName}`]) || 0) + 1;
      }
      if ((opts?.duration ?? "action-phase") === "action-phase") {
        state.controlReturns.push({
          instanceId,
          thiefSeat: seat,
          homeSeat: opp.seat,
        });
        logPublic(state, `${nameOf(state, player.heroCardId)} steals ${nameOf(state, card.cardId)} until the end of the action phase`);
      } else {
        logPublic(state, `${nameOf(state, player.heroCardId)} gains control of ${nameOf(state, card.cardId)}`);
      }
      return true;
    },
    giveControl(instanceId, targetSeat) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target || targetSeat === seat) return false;
      const idx = player.board.findIndex((card) => card.instanceId === instanceId);
      if (idx < 0) return false;
      const card = player.board.splice(idx, 1)[0] as CardInstance;
      target.board.push(card);
      runtime.commands.stampControlledName(state, target, card);
      // A new indefinite control effect supersedes any scheduled action-phase
      // return applying to this object.
      state.controlReturns = state.controlReturns.filter(
        (entry) => entry.instanceId !== instanceId,
      );
      logPublic(
        state,
        `${nameOf(state, player.heroCardId)} gives control of ${nameOf(state, card.cardId)} to ${nameOf(state, target.heroCardId)}`,
      );
      return true;
    },
    annexFaceUpArsenalThroughNextTurn(targetSeat) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target || targetSeat === seat) return;
      const counters = (target.hero.counters ??= {});
      counters.faceUpArsenalAnnexedBySeat = seat;
      counters.faceUpArsenalAnnexedThroughTurn = state.turn + 2;
      logPublic(
        state,
        `${nameOf(state, player.heroCardId)} annexes ${nameOf(state, target.heroCardId)}'s face-up arsenal through their next turn`,
      );
    },
    notifyTrapTriggered() {
      runtime.events.queueTriggeredEvent(state, "trap-triggered", seat);
    },
    flipFaceUp() {
      if (!self.faceDown) return;
      self.faceDown = false;
      logPublic(state, `${nameOf(state, player.heroCardId)} turns ${nameOf(state, self.cardId)} face up`);
    },
    transcend() {
      // the resolving card leaves the stack-resolution flow into its owner's
      // hand, flipped (back face active) — returnSelfToHand precedent
      const owner = state.players[self.owner] as PlayerState;
      const fromGraveyard = owner.graveyard.some((card) => card.instanceId === self.instanceId);
      const removed = runtime.commands.removeFromOwnerZones(state, self.instanceId);
      let chainCard: CardInstance | undefined;
      for (const link of state.chain) {
        chainCard ??= removeFromArray(link.reactions, self.instanceId);
      }
      const card = removed?.card ?? chainCard;
      if (!card) return;
      card.flipped = true;
      owner.hand.push(card);
      owner.flags.transcendedThisTurn = true;
      logPublic(state, `${nameOf(state, card.cardId)} transcends into ${nameOf(state, owner.heroCardId)}'s hand`);
      if (fromGraveyard) runtime.events.fireCardLeavesGraveyard(state, owner.seat, card, "hand");
    },
    destroySelf() {
      const permanent = findPermanent(state, self.instanceId);
      if (permanent) {
        runtime.commands.destroyPermanent(state, seat, permanent.card);
        return;
      }
      const attack = state.chain.find((candidate) =>
        candidate.attacker === seat &&
        candidate.attackCardType === "action" &&
        candidate.attackingCard.instanceId === self.instanceId &&
        candidate.flags.attackGone !== true
      );
      if (!attack) return;
      attack.flags.attackGone = true;
      runtime.commands.moveToGraveyard(state, attack.attackingCard, "chain", seat);
      logPublic(state, `${nameOf(state, attack.attackingCard.cardId)} is destroyed`);
      runtime.events.runHook(state, attack.attacker, attack.attackingCard, "onDestroyed", attack);
      runtime.events.fireFriendlyDestroyed(state, attack.attacker, attack.attackingCard, seat);
    },
    charge(instanceId) {
      const p = state.players[seat] as PlayerState;
      const card = removeFromArray(p.hand, instanceId);
      if (!card) return undefined;
      runtime.commands.enterSoul(state, card, true);
      return card;
    },
    putIntoSoul(instanceId) {
      const found = runtime.commands.removeFromOwnerZones(state, instanceId);
      if (!found) return false;
      runtime.commands.enterSoul(state, found.card, false);
      if (found.fromZone === "graveyard") {
        runtime.events.fireCardLeavesGraveyard(state, found.owner.seat, found.card, "soul");
      }
      if (found.fromArena) runtime.commands.fireLeaveArena(state, found.owner.seat, found.card, "soul");
      if (found.fromZone === "deck") {
        runtime.events.queueTriggeredEvent(
          state,
          "card-moved-from-deck-by-effect",
          found.owner.seat,
          found.card,
          { from: "deck", to: "soul", causedBySeat: seat },
        );
      }
      return true;
    },
    banish(instanceId, opts) {
      const before = findCardAnywhere(state, instanceId);
      const moved = runtime.commands.banishCard(state, instanceId, seat, opts?.faceDown);
      if (moved && before && before.card.owner !== seat) {
        fireFriendlyBanishesOpponentCard(state, runtime, seat, before.card);
      }
      return moved;
    },
    banishAllDefendingCardsOnChainClose() {
      for (const chainLink of state.chain) {
        for (const card of [...chainLink.defendingCards, ...chainLink.defendingEquipment]) {
          chainLink.flags[`banishOnClose:${card.instanceId}`] = true;
        }
      }
    },
    returnSelfToHand() {
      const owner = state.players[self.owner] as PlayerState;
      const fromGraveyard = owner.graveyard.some((card) => card.instanceId === self.instanceId);
      const removed = runtime.commands.removeFromOwnerZones(state, self.instanceId);
      let attackingCard: CardInstance | undefined;
      for (const link of state.chain) {
        if (
          link.attackingCard.instanceId !== self.instanceId ||
          link.flags.attackGone === true
        ) continue;
        attackingCard ??= link.attackingCard;
        // The physical card changes zones, but the chain link retains last-known
        // information for projection and rules queries until the chain closes.
        link.attackingCard = runtime.commands.snapshotSerializable(link.attackingCard);
        link.flags.attackGone = true;
      }
      let chainCard: CardInstance | undefined;
      for (const link of state.chain) {
        chainCard ??= removeFromArray(link.reactions, self.instanceId);
      }
      const card = removed?.card ?? attackingCard ?? chainCard;
      if (!card) return false;
      owner.hand.push(card);
      logPublic(state, `${nameOf(state, card.cardId)} returns to ${nameOf(state, owner.heroCardId)}'s hand`);
      if (fromGraveyard) runtime.events.fireCardLeavesGraveyard(state, owner.seat, card, "hand");
      return true;
    },
    addCounter(instanceId, key, delta) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return;
      const observed = observeReactionAttackPower(state, runtime);
      const copies = [found.card];
      const activeAttack = currentLink(state)?.attackingCard;
      if (activeAttack?.instanceId === instanceId && activeAttack !== found.card) copies.push(activeAttack);
      for (const copy of copies) {
        const c = (copy.counters ??= {});
        c[key] = (c[key] ?? 0) + delta;
        if ((c[key] as number) <= 0) delete c[key];
      }
      publishReactionAttackPowerGain(state, runtime, observed);
    },
    setCardCounter(instanceId, key, value) {
      const found = findCardAnywhere(state, instanceId);
      if (!found) return;
      const observed = observeReactionAttackPower(state, runtime);
      (found.card.counters ??= {})[key] = value;
      const activeAttack = currentLink(state)?.attackingCard;
      if (activeAttack?.instanceId === instanceId && activeAttack !== found.card) {
        (activeAttack.counters ??= {})[key] = value;
      }
      publishReactionAttackPowerGain(state, runtime, observed);
    },
    setPermanentLife(instanceId, value) {
      const found = findPermanent(state, instanceId);
      if (!found || found.card.life === undefined) return false;
      found.card.life = Math.max(0, value);
      return true;
    },
    increaseFirstAttackCostNextTurn(targetSeat, amount) {
      if (amount <= 0) return;
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return;
      const turn = state.turn + (targetSeat === state.activePlayer ? 2 : 1);
      const counters = (target.hero.counters ??= {});
      const existing = Number(counters.firstAttackExtraCostTurn ?? 0) === turn
        ? Number(counters.firstAttackExtraCost ?? 0)
        : 0;
      counters.firstAttackExtraCostTurn = turn;
      counters.firstAttackExtraCost = existing + amount;
    },
    preventAuraTokenCreationNextTurn(targetSeat) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return;
      const counters = (target.hero.counters ??= {});
      counters.auraTokenCreationLockedUntilTurn = state.turn + 1;
    },
    createToken(cardId, tokenSeat) {
      const target =
        tokenSeat === undefined ? player : (state.players[tokenSeat] as PlayerState);
      return runtime.commands.createTokenFor(state, target, cardId, tokenCreationCause);
    },
    createTokenCopy(instanceId) {
      const source = findPermanent(state, instanceId);
      if (!source) return undefined;
      const token = runtime.commands.createTokenFor(state, player, source.card.cardId, tokenCreationCause);
      if (!token) return undefined;
      token.copyOriginalCardId = source.card.copyOriginalCardId ?? source.card.cardId;
      if (source.card.grantedTypes) token.grantedTypes = [...source.card.grantedTypes];
      if (source.card.grantedNames) token.grantedNames = [...source.card.grantedNames];
      if (source.card.grantedKeywords) token.grantedKeywords = [...source.card.grantedKeywords];
      if (source.card.grantedBaseAbilitiesCardId) {
        token.grantedBaseAbilitiesCardId = source.card.grantedBaseAbilitiesCardId;
      }
      if (source.card.grantedBaseAbilitiesCardIds) {
        token.grantedBaseAbilitiesCardIds = [...source.card.grantedBaseAbilitiesCardIds];
      }
      return token;
    },
    createTokens(cardId, count, tokenSeat) {
      const target =
        tokenSeat === undefined ? player : (state.players[tokenSeat] as PlayerState);
      return runtime.commands.createTokensFor(state, target, cardId, count, tokenCreationCause);
    },
    createCardInHand(cardId, targetSeat) {
      const target =
        targetSeat === undefined ? player : (state.players[targetSeat] as PlayerState);
      return createCardInHandFor(state, target, cardId);
    },
    createCardInBanish(cardId, targetSeat) {
      const target =
        targetSeat === undefined ? player : (state.players[targetSeat] as PlayerState);
      return createCardInBanishFor(state, target, cardId);
    },
    transformInto(cardId, transformedInstanceIds, existingPermanentInstanceId) {
      const uniqueIds = [...new Set(transformedInstanceIds)];
      if (uniqueIds.length !== transformedInstanceIds.length) return undefined;
      const transformed = uniqueIds.map((instanceId) => {
        const found = findPermanent(state, instanceId);
        if (!found) return undefined;
        const controller = state.players[found.seat] as PlayerState;
        const isExisting = instanceId === existingPermanentInstanceId;
        if (!isExisting && !controller.board.some((candidate) => candidate.instanceId === instanceId) &&
          !controller.weapons.some((candidate) => candidate.instanceId === instanceId) &&
          !Object.values(controller.equipment).some((candidate) => candidate?.instanceId === instanceId)) return undefined;
        return { ...found, controller };
      });
      if (transformed.some((found) => found === undefined)) return undefined;

      let permanent: CardInstance | undefined;
      if (existingPermanentInstanceId !== undefined) {
        const existing = findPermanent(state, existingPermanentInstanceId);
        if (existing) {
          if (existing.seat !== seat) return undefined;
          permanent = existing.card;
        } else {
          // Invocation/construct resolution can transform the resolving card
          // before its leave-stack step makes it a permanent. Mutate the
          // authoritative stack copy; the separate `resolving` copy exists
          // only so a paused onChoose hook can locate its source after cloning.
          const resolvingLayer = state.stack.find(
            (layer) => layer.card?.instanceId === existingPermanentInstanceId,
          );
          if (
            resolvingLayer?.seat !== seat ||
            !resolvingLayer.card ||
            !runtime.commands.settlesInArena(state, resolvingLayer.card)
          ) return undefined;
          permanent = state.resolving.find(
            (card) => card.instanceId === existingPermanentInstanceId,
          ) ?? resolvingLayer.card;
        }
      }

      const subcards: CardInstance[] = [];
      const transformEvents: { seat: number; from: CardInstance }[] = [];
      for (const found of transformed) {
        const entry = found!;
        if (entry.card.instanceId === existingPermanentInstanceId) {
          const subcard: CardInstance = {
            instanceId: state.nextInstanceId++,
            cardId: entry.card.cardId,
            owner: entry.card.owner,
            ...(entry.card.subcards ? { subcards: entry.card.subcards } : {}),
          };
          subcards.push(subcard);
          transformEvents.push({ seat: entry.seat, from: subcard });
          continue;
        }
        const equipmentSlot = Object.entries(entry.controller.equipment)
          .find(([, candidate]) => candidate?.instanceId === entry.card.instanceId)?.[0] as keyof PlayerState["equipment"] | undefined;
        const removed = removeFromArray(entry.controller.board, entry.card.instanceId)
          ?? removeFromArray(entry.controller.weapons, entry.card.instanceId)
          ?? (equipmentSlot ? entry.controller.equipment[equipmentSlot] : undefined);
        if (!removed) return undefined;
        if (equipmentSlot) delete entry.controller.equipment[equipmentSlot];
        runtime.commands.fireLeaveArena(state, entry.seat, removed, "subcard");
        const subcard: CardInstance = {
          instanceId: state.nextInstanceId++,
          cardId: removed.cardId,
          owner: removed.owner,
          ...(removed.subcards ? { subcards: removed.subcards } : {}),
        };
        subcards.push(subcard);
        transformEvents.push({ seat: entry.seat, from: subcard });
      }

      if (permanent) {
        if (existingPermanentInstanceId !== undefined && uniqueIds.includes(existingPermanentInstanceId)) {
          delete permanent.subcards;
        }
        permanent.cardId = cardId;
        const heroOwner = state.players.find((candidate) => candidate.hero.instanceId === permanent!.instanceId);
        if (heroOwner) {
          heroOwner.heroCardId = cardId;
          const transformedIntellect = dataOf(state, cardId).intellect;
          if (transformedIntellect !== undefined) heroOwner.intellect = transformedIntellect;
        }
        delete permanent.flipped;
        const life = dataOf(state, cardId).life;
        if (life === undefined) delete permanent.life;
        else permanent.life = life;
      } else permanent = runtime.commands.createTokenFor(state, player, cardId, tokenCreationCause);
      if (!permanent) return undefined;
      (permanent.subcards ??= []).push(...subcards);
      if (subcards.length > 0) {
        logPublic(state, `${subcards.map((card) => nameOf(state, card.cardId)).join(" and ")} transforms into ${nameOf(state, cardId)}`);
      }
      for (const event of transformEvents) {
        runtime.commands.fireTransformHook(state, event.seat, event.from, "into", permanent);
        runtime.commands.fireTransformHook(state, seat, permanent, "from", event.from);
      }
      return permanent;
    },
    becomeAllyUntilEndOfTurn(instanceId, power, life) {
      const found = findPermanent(state, instanceId);
      if (!found || found.seat !== seat || power < 0 || life < 0) return false;
      found.card.temporaryAlly = { power: Math.floor(power), life: Math.floor(life) };
      found.card.life = Math.floor(life);
      return true;
    },
    cardData(cardId) {
      referencedLogCardIds.add(cardId);
      return dataOf(state, cardId);
    },
    hasCardType(card, cardType) {
      const found = findCardAnywhere(state, card.instanceId)?.card;
      return cardHasType(state, found ?? card as CardInstance, cardType);
    },
    cardTypes(card) {
      const found = findCardAnywhere(state, card.instanceId)?.card;
      return cardTypesOf(state, found ?? card as CardInstance);
    },
    countEquipped(type, targetSeat = seat) {
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return 0;
      const normalized = type.trim().toLowerCase();
      const actual = Object.values(target.equipment).filter(
        (card): card is CardInstance => !!card && cardTypesOf(state, card).includes(normalized),
      ).length;
      const additional = controlledPermanents(state, targetSeat, {
        faceDownEquipment: false,
      }).reduce((sum, source) => {
        if (source.faceDown) return sum;
        const count = scriptOf(state, source.cardId, source)?.countsAsEquipped?.[normalized] ?? 0;
        return sum + Math.max(0, Math.floor(count));
      }, 0);
      return actual + additional;
    },
    cardNames(card) {
      const found = findCardAnywhere(state, card.instanceId)?.card;
      return cardNamesOf(state, found ?? card as CardInstance);
    },
    cardIdsNamed(cardName) {
      const normalized = cardName.trim().toLowerCase();
      return Object.values(state.cardsRef)
        .filter((candidate) => candidate.name.trim().toLowerCase() === normalized)
        .map((candidate) => candidate.id)
        .sort();
    },
    cardColor(card) {
      return cardColorOf(state, card);
    },
    hasVariablePlayCost(card) {
      const found = findCardAnywhere(state, card.instanceId)?.card;
      const source = found ?? card as CardInstance;
      return scriptOf(state, source.cardId, source)?.variablePlayCost !== undefined;
    },
    getFlag(scope, key) {
      const flags = scope === "player" ? player.flags : (link?.flags ?? {});
      return flags[key] ?? false;
    },
    setFlag(scope, key, value) {
      if (scope === "player") player.flags[key] = value;
      else if (link) link.flags[key] = value;
    },
    oncePerTurnEffectUsed() {
      return player.flags[oncePerTurnEffectFlagKey(self.instanceId)] === true;
    },
    markOncePerTurnEffectUsed() {
      player.flags[oncePerTurnEffectFlagKey(self.instanceId)] = true;
    },
    getCounter(key) {
      return self.counters?.[key] ?? 0;
    },
    setCounter(key, n) {
      const observed = observeReactionAttackPower(state, runtime);
      (self.counters ??= {})[key] = n;
      publishReactionAttackPowerGain(state, runtime, observed);
    },
    requestChoice(hook, prompt, options, choiceSeat, cardOptions, defaultOption) {
      requestScriptedChoice(hook, prompt, options, choiceSeat, { cardOptions, defaultOption });
    },
    requestCardChoice(hook, prompt, options, choiceSeat, revealedCardIds, lookedCardIds) {
      requestCardDecision(hook, prompt, options, choiceSeat, {
        revealedCardIds,
        lookedCardIds,
      });
    },
    requestCardChoices(
      hook,
      prompt,
      options,
      minimumSelections,
      maximumSelections,
      choiceSeat,
      revealedCardIds,
      lookedCardIds,
    ) {
      const maximum = Math.min(maximumSelections, options.length);
      if (
        !Number.isSafeInteger(minimumSelections) || minimumSelections < 0 ||
        !Number.isSafeInteger(maximumSelections) || maximumSelections < minimumSelections ||
        minimumSelections > maximum
      ) return;
      requestCardDecision(hook, prompt, options, choiceSeat, {
        minimumSelections,
        maximumSelections: maximum,
        revealedCardIds,
        lookedCardIds,
      });
    },
    requestNameChoice(hook, prompt, choiceSeat) {
      const decision: PendingDecisionState = {
        player: choiceSeat ?? seat,
        kind: "choose-name",
        prompt,
        sourceInstanceId: self.instanceId,
        chooseHook: hook,
      };
      if (state.pendingDecision?.chooseHook) {
        if (!queueDecisionBehindCrank(state, decision)) {
          logPublic(state, `(skipped duplicate choice: ${prompt})`);
        }
        return;
      }
      state.pendingDecision = decision;
    },
    requestPayment(hook, prompt, cost, choiceSeat) {
      const payingSeat = choiceSeat ?? seat;
      const paying = state.players[payingSeat] as PlayerState;
      const pitchOptions = runtime.commands.scriptedPaymentOptions(
        state,
        paying,
        cost,
        "paid",
      ) as Record<string, { cost: number; pitchIds: number[]; result: string }>;
      const options = Object.keys(pitchOptions);
      if (options.length === 0) return false;
      ctx.requestChoice(hook, prompt, [...options, "no"], payingSeat);
      const pd = state.pendingDecision;
      if (pd?.chooseHook === hook && pd.sourceInstanceId === self.instanceId) {
        pd.kind = "optional-effect";
        pd.payment = { pitchOptions };
        if (Object.values(pitchOptions).some((payment) => payment.pitchIds.length > 0)) {
          pd.resourcePayment = {
            cost,
            options: Object.entries(pitchOptions).map(([optionId, payment]) => ({
              optionId,
              pitchInstanceIds: payment.pitchIds,
            })),
          };
        }
      }
      return true;
    },
    requestPaymentFrom(sourceInstanceId, hook, prompt, cost, choiceSeat) {
      const found = findCardAnywhere(state, sourceInstanceId);
      if (!found) return false;
      return runtime.makeCtx(
        state,
        found.seat,
        found.card,
        link,
        undefined,
        undefined,
        undefined,
        tokenCreationCause,
      )
        .requestPayment(hook, prompt, cost, choiceSeat);
    },
    requestXPayment(hook, prompt, choiceSeat, requestedMaximum, requestedResourcesPerX) {
      const payingSeat = choiceSeat ?? seat;
      const paying = state.players[payingSeat] as PlayerState;
      const availableResources = paying.resources + paying.chi + paying.hand.reduce(
        (sum, card) => sum + (runtime.commands.pitchProhibitedByEffect(state, paying, card) ? 0 : runtime.commands.pitchValueOfInstance(state, card)),
        0,
      );
      const resourcesPerX = Math.max(1, Math.floor(requestedResourcesPerX ?? 1));
      const availableMaximum = Math.floor(availableResources / resourcesPerX);
      const maximum = requestedMaximum === undefined
        ? availableMaximum
        : Math.min(availableMaximum, Math.max(0, requestedMaximum));
      const choices: Record<string, { cost: number; result: string }> = {};
      for (let x = 0; x <= maximum; x++) {
        choices[`X = ${x}`] = { cost: x * resourcesPerX, result: `x:${x}` };
      }
      const options = Object.keys(choices);
      ctx.requestChoice(hook, prompt, options, payingSeat);
      const pd = state.pendingDecision;
      if (pd?.chooseHook === hook && pd.sourceInstanceId === self.instanceId) {
        pd.xPayment = { choices };
      }
    },
    allowPlayFrom(instanceId, zone, opts) {
      // card-scoped permission, lives on the instance; cleared at end of turn
      // (or the next one, with untilNextTurn)
      const found = opts?.forSeat === undefined
        ? (() => {
            const card = findCard(player, instanceId);
            return card ? { seat, card } : undefined;
          })()
        : findCardAnywhere(state, instanceId);
      if (!found || (opts?.forSeat === undefined && found.seat !== seat)) return;
      const card = found.card;
      const playableFrom = card.playableFrom ??= [];
      if (!playableFrom.includes(zone)) playableFrom.push(zone);
      card.playableFromSourceCardId = self.cardId;
      if (opts?.forSeat !== undefined) card.playableBySeat = opts.forSeat;
      if (opts?.costReduction !== undefined) {
        card.playCostReduction = (card.playCostReduction ?? 0) + opts.costReduction;
        if (opts.forSeat !== undefined) card.playCostReductionSeat = opts.forSeat;
      }
      if (opts?.untilNextTurn) {
        const permissionSeat = opts.forSeat ?? seat;
        card.playableFromUntilStartOfSeatTurn = permissionSeat;
        card.playableFromGrantedTurn = state.turn;
      }
      if (opts?.untilEndOfNextTurn) {
        card.playableFromUntilEndOfSeatTurn = opts.forSeat ?? seat;
        card.playableFromGrantedTurn = state.turn;
      }
      if (opts?.untilChainClose) card.playableFromUntilChainClose = true;
      if (opts?.graveyardReplacement) card.temporaryGraveyardReplacement = opts.graveyardReplacement;
      if (opts?.asInstant) card.playableAsInstant = true;
    },
    putIntoArsenal(instanceId, from, opts) {
      const owner = state.players.find((candidate) =>
        candidate.hand.some((card) => card.instanceId === instanceId) ||
        candidate.deck.some((card) => card.instanceId === instanceId) ||
        candidate.graveyard.some((card) => card.instanceId === instanceId),
      ) as PlayerState | undefined;
      if (!owner) return false;
      if (owner.arsenal.length >= runtime.commands.arsenalCapacity(state, owner.seat)) return false;
      const fromGraveyard = owner.graveyard.some((card) => card.instanceId === instanceId);
      const card =
        removeFromArray(owner.hand, instanceId) ?? removeFromArray(owner.deck, instanceId) ??
        removeFromArray(owner.graveyard, instanceId);
      if (!card) return false;
      card.faceDown = opts?.faceUp === false ? true : undefined;
      card.arsenalSlot = nextArsenalSlot(owner);
      owner.arsenal.push(card);
      if (fromGraveyard) {
        runtime.events.fireCardLeavesGraveyard(state, owner.seat, card, "arsenal");
      }
      if (card.faceDown) {
        logPrivate(
          state,
          owner.seat,
          `${nameOf(state, card.cardId)} is put face down into ${nameOf(state, owner.heroCardId)}'s arsenal`,
          `${nameOf(state, owner.heroCardId)} puts a card face down into arsenal`,
        );
      } else {
        logPublic(state, `${nameOf(state, card.cardId)} is put face up into ${nameOf(state, owner.heroCardId)}'s arsenal`);
      }
      if (!card.faceDown) fireEnterArsenal(state, runtime, owner.seat, card, from);
      if (!card.faceDown && from === "deck") {
        runtime.events.queueTriggeredEvent(
          state,
          "card-moved-from-deck-by-effect",
          owner.seat,
          card,
          { from: "deck", to: "arsenal", causedBySeat: seat },
        );
      }
      return true;
    },
    addDefenderFromDeck(instanceId) {
      const current = link ?? currentLink(state);
      if (!current) return false;
      const owner = state.players.find((candidate) =>
        candidate.deck.some((card) => card.instanceId === instanceId),
      ) as PlayerState | undefined;
      if (!owner || owner.seat === current.attacker) return false;
      const card = removeFromArray(owner.deck, instanceId);
      if (!card) return false;
      delete card.faceDown;
      current.defendingCards.push(card);
      runtime.commands.applyOneShotDefenseModifiers(state, current, [card]);
      const fragmentTriggered = runtime.commands.noteAttackDefendedBy(state, current, card);
      logPublic(state, `${nameOf(state, card.cardId)} is added to the chain link as a defending card`);
      runtime.commands.queueDefendEventLayersAfterCurrent(
        state,
        current,
        [{ card, fragmentTriggered }],
        false,
      );
      return true;
    },
    addDefenderFromArsenal(instanceId) {
      const current = link ?? currentLink(state);
      if (!current) return false;
      const owner = state.players.find((candidate) =>
        candidate.arsenal.some((card) => card.instanceId === instanceId),
      ) as PlayerState | undefined;
      if (!owner || owner.seat === current.attacker) return false;
      const card = owner.arsenal.find((candidate) => candidate.instanceId === instanceId);
      if (!card || dataOf(state, card.cardId).cardType !== "action") return false;
      removeFromArray(owner.arsenal, instanceId);
      delete card.faceDown;
      current.defendingCards.push(card);
      runtime.commands.applyOneShotDefenseModifiers(state, current, [card]);
      const fragmentTriggered = runtime.commands.noteAttackDefendedBy(state, current, card);
      logPublic(state, `${nameOf(state, card.cardId)} is added from arsenal as a defending card`);
      runtime.commands.queueDefendEventLayersAfterCurrent(
        state,
        current,
        [{ card, fragmentTriggered }],
        false,
      );
      return true;
    },
    addDefenderFromHand(instanceId) {
      const current = link ?? currentLink(state);
      if (!current) return false;
      const owner = state.players.find((candidate) =>
        candidate.hand.some((card) => card.instanceId === instanceId),
      ) as PlayerState | undefined;
      if (!owner || owner.seat === current.attacker) return false;
      const card = removeFromArray(owner.hand, instanceId);
      if (!card) return false;
      delete card.faceDown;
      current.defendingCards.push(card);
      runtime.commands.applyOneShotDefenseModifiers(state, current, [card]);
      current.flags.defendedFromHand = true;
      current.flags[`defendedFromHand:${card.instanceId}`] = true;
      current.flags.defendedFromHandCount = Number(current.flags.defendedFromHandCount ?? 0) + 1;
      const fragmentTriggered = runtime.commands.noteAttackDefendedBy(state, current, card);
      logPublic(state, `${nameOf(state, card.cardId)} is added from hand as a defending card`);
      runtime.commands.queueDefendEventLayersAfterCurrent(
        state,
        current,
        [{ card, fragmentTriggered }],
        true,
      );
      return true;
    },
    addSelfAsDefender() {
      const current = link ?? currentLink(state);
      if (!current || current.attacker === seat) return false;
      const owner = state.players[seat] as PlayerState;
      const live = Object.values(owner.equipment).find(
        (candidate) => candidate?.instanceId === self.instanceId,
      );
      if (!live || dataOf(state, live.cardId).cardType !== "equipment") return false;
      if (current.defendingEquipment.some((candidate) => candidate.instanceId === live.instanceId)) {
        return false;
      }
      current.defendingEquipment.push(live);
      runtime.commands.applyOneShotDefenseModifiers(state, current, [live]);
      const fragmentTriggered = runtime.commands.noteAttackDefendedBy(state, current, live);
      logPublic(state, `${nameOf(state, live.cardId)} is added to the chain link as a defending card`);
      runtime.commands.queueDefendEventLayersAfterCurrent(
        state,
        current,
        [{ card: live, fragmentTriggered }],
        false,
      );
      return true;
    },
    attackFromDeck(instanceId) {
      return runtime.commands.attackFromDeck(state, seat, instanceId);
    },
    attackWithPermanent(instanceId) {
      return runtime.commands.attackWithPermanent(state, seat, instanceId);
    },
    replaceAttackFromHand(instanceId, maximumCost) {
      return runtime.commands.replaceAttackFromHand(state, seat, instanceId, maximumCost);
    },
    replaceAttackFromBanish(instanceId, maximumCost) {
      return runtime.commands.replaceAttackFromBanish(state, seat, instanceId, maximumCost);
    },
    turnArsenalFaceUp(instanceId) {
      const owner = state.players.find((candidate) =>
        candidate.arsenal.some((card) => card.instanceId === instanceId),
      ) as PlayerState | undefined;
      const card = owner?.arsenal.find((candidate) => candidate.instanceId === instanceId);
      if (!card?.faceDown) return false;
      delete card.faceDown;
      logPublic(state, `${nameOf(state, card.cardId)} is turned face up in ${nameOf(state, owner!.heroCardId)}'s arsenal`);
      fireEnterArsenal(state, runtime, owner!.seat, card, "arsenal");
      return true;
    },
    putOnDeckTop(instanceId) {
      const found = runtime.commands.removeFromOwnerZones(state, instanceId);
      if (!found) return false;
      const toBottom = found.owner.flags.topDeckToBottom === true;
      if (toBottom) found.owner.deck.push(found.card);
      else found.owner.deck.unshift(found.card);
      const source = transitionZoneFromEngineZone(found.fromZone, found.owner.seat);
      runtime.transitions.move(
        found.card,
        source,
        transitionZone("deck", found.owner.seat, toBottom ? "bottom" : "top"),
        {
          from: source !== null && transitionZoneIsPrivate(
            source.kind,
            found.card.faceDown === true,
          ),
          to: true,
        },
      );
      if (found.fromZone === "graveyard") {
        runtime.events.fireCardLeavesGraveyard(state, found.owner.seat, found.card, "deck");
      }
      if (found.fromArena) runtime.commands.fireLeaveArena(state, found.owner.seat, found.card, "deck");
      const privateSource = found.fromZone === "hand" || found.fromZone === "deck"
        || (found.fromZone === "arsenal" && found.card.faceDown)
        || (found.fromZone === "banish" && found.card.faceDown);
      const detail = `${nameOf(state, found.card.cardId)} is put on the ${toBottom ? "bottom" : "top"} of the deck`;
      if (privateSource) logPrivate(state, found.owner.seat, detail, `a card is put on the ${toBottom ? "bottom" : "top"} of the deck`);
      else logPublic(state, detail);
      return true;
    },
    putOnDeckAtDepth(instanceId, depth) {
      if (!Number.isSafeInteger(depth) || depth < 1) return false;
      const found = runtime.commands.removeFromOwnerZones(state, instanceId);
      if (!found) return false;
      const index = Math.min(depth - 1, found.owner.deck.length);
      const position = index === 0
        ? "top" as const
        : index === found.owner.deck.length
          ? "bottom" as const
          : undefined;
      found.owner.deck.splice(index, 0, found.card);
      const source = transitionZoneFromEngineZone(found.fromZone, found.owner.seat);
      runtime.transitions.move(
        found.card,
        source,
        transitionZone("deck", found.owner.seat, position),
        {
          from: source !== null && transitionZoneIsPrivate(
            source.kind,
            found.card.faceDown === true,
          ),
          to: true,
        },
      );
      if (found.fromZone === "graveyard") {
        runtime.events.fireCardLeavesGraveyard(state, found.owner.seat, found.card, "deck");
      }
      if (found.fromArena) runtime.commands.fireLeaveArena(state, found.owner.seat, found.card, "deck");
      const privateSource = found.fromZone === "hand" || found.fromZone === "deck"
        || (found.fromZone === "arsenal" && found.card.faceDown)
        || (found.fromZone === "banish" && found.card.faceDown);
      const suffix = depth === 1 ? "st" : depth === 2 ? "nd" : depth === 3 ? "rd" : "th";
      const detail = `${nameOf(state, found.card.cardId)} is put ${depth}${suffix} from the top of the deck`;
      if (privateSource) {
        logPrivate(state, found.owner.seat, detail, `a card is put ${depth}${suffix} from the top of the deck`);
      } else {
        logPublic(state, detail);
      }
      return true;
    },
    putOnDeckBottom(instanceId) {
      return runtime.commands.putCardOnDeckBottom(state, instanceId);
    },
    putOnDeckBottomInChosenOrder(instanceIds, prompt) {
      const ids = [...new Set(instanceIds)].filter((instanceId) =>
        findCard(player, instanceId) !== undefined,
      );
      if (ids.length <= 1) {
        if (ids[0] !== undefined) runtime.commands.putCardOnDeckBottom(state, ids[0]);
        return;
      }
      state.pendingDecision = {
        player: seat,
        kind: "choose-target",
        prompt: prompt ?? "Choose the next card to put on the bottom of your deck",
        options: ids.map(String),
        cardOptions: [...ids],
        sourceInstanceId: self.instanceId,
        chooseHook: "engine-deck-bottom-order",
        deckBottomOrder: { ordered: [], remaining: ids },
      };
    },
    equipToken(cardId, tokenSeat) {
      const target =
        tokenSeat === undefined ? player : (state.players[tokenSeat] as PlayerState);
      const d = dataOf(state, cardId);
      if (d.cardType === "weapon") {
        const occupiedZones = target.weapons.reduce(
          (total, weapon) => total + (cardTypesOf(state, weapon).includes("2h") ? 2 : 1),
          0,
        );
        const requiredZones = (d.subtypes ?? []).includes("2h") ? 2 : 1;
        if (occupiedZones + requiredZones > 2) {
          logPublic(state, `${d.name} can't be equipped (no empty weapon zone)`);
          return undefined;
        }
        const token = runtime.commands.createTokenFor(state, target, cardId, tokenCreationCause);
        if (!token) return undefined;
        removeFromArray(target.board, token.instanceId);
        target.weapons.push(token);
        logPublic(state, `${d.name} is equipped to a weapon zone`);
        return token;
      }
      if (d.cardType === "equipment") {
        const slot = (["head", "chest", "arms", "legs"] as const).find((s) =>
          (d.subtypes ?? []).includes(s),
        );
        if (!slot || target.equipment[slot]) {
          logPublic(state, `${d.name} can't be equipped (no free equipment zone)`);
          return undefined;
        }
        const token = runtime.commands.createTokenFor(state, target, cardId, tokenCreationCause);
        if (!token) return undefined;
        removeFromArray(target.board, token.instanceId);
        target.equipment[slot] = token;
        logPublic(state, `${d.name} is equipped to the ${slot} zone`);
        return token;
      }
      logPublic(state, `${d.name} can't be equipped`);
      return undefined;
    },
    equipFromGraveyard(instanceId) {
      const owner = state.players.find((candidate) =>
        candidate.graveyard.some((card) => card.instanceId === instanceId),
      ) as PlayerState | undefined;
      const card = owner?.graveyard.find((candidate) => candidate.instanceId === instanceId);
      if (!owner || !card) return false;
      const d = dataOf(state, card.cardId);
      if (d.cardType === "weapon") {
        const hands = (d.subtypes ?? []).includes("2h") ? 2 : 1;
        if (owner.weapons.length + hands > 2) return false;
        removeFromArray(owner.graveyard, instanceId);
        owner.weapons.push(card);
        runtime.events.fireCardLeavesGraveyard(state, owner.seat, card, "arena");
        logPublic(state, `${d.name} is equipped from the graveyard`);
        runtime.events.runHook(state, owner.seat, card, "onEnterArena");
        runtime.events.fireFriendlyEnterArena(state, owner.seat, card);
        return true;
      }
      if (d.cardType === "equipment") {
        const slot = (["head", "chest", "arms", "legs"] as const).find((candidate) =>
          (d.subtypes ?? []).includes(candidate),
        );
        if (!slot || owner.equipment[slot]) return false;
        removeFromArray(owner.graveyard, instanceId);
        owner.equipment[slot] = card;
        runtime.events.fireCardLeavesGraveyard(state, owner.seat, card, "arena");
        logPublic(state, `${d.name} is equipped from the graveyard`);
        runtime.events.runHook(state, owner.seat, card, "onEnterArena");
        runtime.events.fireFriendlyEnterArena(state, owner.seat, card);
        return true;
      }
      return false;
    },
    equipFromBanish(instanceId) {
      const card = player.banish.find((candidate) => candidate.instanceId === instanceId);
      if (!card) return false;
      const d = dataOf(state, card.cardId);
      if (d.cardType === "weapon") {
        const hands = (d.subtypes ?? []).includes("2h") ? 2 : 1;
        const occupied = player.weapons.reduce((total, weapon) =>
          total + ((dataOf(state, weapon.cardId).subtypes ?? []).includes("2h") ? 2 : 1), 0);
        if (occupied + hands > 2) return false;
        removeFromArray(player.banish, instanceId);
        player.weapons.push(card);
      } else if (d.cardType === "equipment") {
        const slot = (["head", "chest", "arms", "legs"] as const).find((candidate) =>
          (d.subtypes ?? []).includes(candidate),
        );
        if (!slot || player.equipment[slot]) return false;
        removeFromArray(player.banish, instanceId);
        player.equipment[slot] = card;
      } else return false;
      logPublic(state, `${d.name} is equipped from banish`);
      runtime.events.runHook(state, player.seat, card, "onEnterArena");
      runtime.events.fireFriendlyEnterArena(state, player.seat, card);
      return true;
    },
    equipFromInventory(instanceId) {
      const inventory = player.inventory;
      if (!inventory) return false;
      const card = inventory.find((candidate) => candidate.instanceId === instanceId);
      if (!card) return false;
      const d = dataOf(state, card.cardId);
      if (d.cardType === "weapon") {
        const hands = (d.subtypes ?? []).includes("2h") ? 2 : 1;
        const occupied = player.weapons.reduce((total, weapon) =>
          total + ((dataOf(state, weapon.cardId).subtypes ?? []).includes("2h") ? 2 : 1), 0);
        if (occupied + hands > 2) return false;
        removeFromArray(inventory, instanceId);
        player.weapons.push(card);
      } else if (d.cardType === "equipment") {
        const slot = (["head", "chest", "arms", "legs"] as const).find((candidate) =>
          (d.subtypes ?? []).includes(candidate),
        );
        if (!slot || player.equipment[slot]) return false;
        removeFromArray(inventory, instanceId);
        player.equipment[slot] = card;
      } else return false;
      logPublic(state, `${d.name} is equipped from inventory`);
      runtime.events.runHook(state, player.seat, card, "onEnterArena");
      runtime.events.fireFriendlyEnterArena(state, player.seat, card);
      return true;
    },
    equipOpposingEquipment(instanceId) {
      const opposing = state.players[seat === 0 ? 1 : 0] as PlayerState;
      const ordinarySlot = (["head", "chest", "arms", "legs"] as const).find(
        (slot) => opposing.equipment[slot]?.instanceId === instanceId,
      );
      if (ordinarySlot) {
        if (player.equipment[ordinarySlot]) return false;
        const card = opposing.equipment[ordinarySlot];
        if (!card) return false;
        delete opposing.equipment[ordinarySlot];
        player.equipment[ordinarySlot] = card;
        logPublic(
          state,
          `${nameOf(state, player.heroCardId)} equips ${nameOf(state, card.cardId)} from ${nameOf(state, opposing.heroCardId)}`,
        );
        return true;
      }
      const weaponIndex = opposing.weapons.findIndex(
        (candidate) => candidate.instanceId === instanceId,
      );
      if (weaponIndex < 0) return false;
      const card = opposing.weapons[weaponIndex] as CardInstance;
      const d = dataOf(state, card.cardId);
      if (d.cardType !== "equipment") return false;
      const hands = (d.subtypes ?? []).includes("2h") ? 2 : 1;
      const occupiedHands = player.weapons.reduce((total, weapon) =>
        total + ((dataOf(state, weapon.cardId).subtypes ?? []).includes("2h") ? 2 : 1), 0);
      if (occupiedHands + hands > 2) return false;
      opposing.weapons.splice(weaponIndex, 1);
      player.weapons.push(card);
      logPublic(
        state,
        `${nameOf(state, player.heroCardId)} equips ${nameOf(state, card.cardId)} from ${nameOf(state, opposing.heroCardId)}`,
      );
      return true;
    },
    moveEquipmentToZone(instanceId, slot: EquipmentSlot) {
      const owner = state.players.find((candidate) =>
        Object.values(candidate.equipment).some((card) => card?.instanceId === instanceId),
      ) as PlayerState | undefined;
      if (!owner || owner.equipment[slot]) return false;
      const current = (Object.keys(owner.equipment) as EquipmentSlot[]).find(
        (candidate) => owner.equipment[candidate]?.instanceId === instanceId,
      );
      if (!current || current === slot) return false;
      const card = owner.equipment[current];
      if (!card) return false;
      delete owner.equipment[current];
      owner.equipment[slot] = card;
      logPublic(state, `${nameOf(state, card.cardId)} moves from the ${current} zone to the ${slot} zone`);
      return true;
    },
    becomeHero(cardId) {
      player.hero.originalHeroCardId ??= player.heroCardId;
      const oldName = nameOf(state, player.heroCardId);
      player.hero.cardId = cardId;
      player.heroCardId = cardId;
      logPublic(state, `${oldName} becomes ${nameOf(state, cardId)}`);
      scriptOf(state, cardId, player.hero)?.onBecomeHero?.(runtime.makeCtx(state, seat, player.hero));
    },
    becomeHeroFromInventory(instanceId) {
      const inventory = player.inventory;
      if (!inventory) return false;
      const inventoryCard = inventory.find((candidate) => candidate.instanceId === instanceId);
      if (!inventoryCard) return false;
      const next = state.cardsRef[inventoryCard.cardId];
      if (!next || next.cardType !== "hero") return false;
      removeFromArray(inventory, instanceId);
      const oldHero = player.hero;
      const oldName = nameOf(state, player.heroCardId);
      player.soul.push(oldHero);
      inventoryCard.originalHeroCardId ??= inventoryCard.cardId;
      player.hero = inventoryCard;
      player.heroCardId = inventoryCard.cardId;
      player.life = next.life ?? player.life;
      player.intellect = next.intellect ?? player.intellect;
      logPublic(state, `${oldName} transforms into ${nameOf(state, inventoryCard.cardId)}`);
      scriptOf(state, inventoryCard.cardId, inventoryCard)?.onBecomeHero?.(
        runtime.makeCtx(state, seat, inventoryCard),
      );
      return true;
    },
    becomeHeroUntilNextTurn(cardId) {
      const next = state.cardsRef[cardId];
      if (!next || next.cardType !== "hero") return;
      player.hero.originalHeroCardId ??= player.heroCardId;
      player.hero.temporaryHeroOriginalCardId ??= player.hero.cardId;
      player.hero.temporaryHeroUntilTurn = state.turn +
        (state.activePlayer === seat ? 2 : 1);
      const oldName = nameOf(state, player.heroCardId);
      player.hero.cardId = cardId;
      player.heroCardId = cardId;
      logPublic(state, `${oldName} becomes ${nameOf(state, cardId)} until the start of their next turn`);
      scriptOf(state, cardId, player.hero)?.onBecomeHero?.(runtime.makeCtx(state, seat, player.hero));
    },
    preventNextDamage(targetSeat, amount, sourceInstanceId) {
      const target = state.players[targetSeat] as PlayerState;
      if (sourceInstanceId === undefined) {
        // generic shield on the target hero (Seeker's Mitts, ...)
        target.flags.preventNextDamage =
          (Number(target.flags.preventNextDamage) || 0) + amount;
        logPublic(
          state,
          `the next ${amount} damage to ${nameOf(state, target.heroCardId)} will be prevented this turn`,
        );
        ctx.addModifier({
          scope: "until-end-of-turn",
          seat: targetSeat,
          preventNextDamagePool: amount,
        });
        return;
      }
      const src = findCardAnywhere(state, sourceInstanceId);
      if (!src) return;
      // the shield rides the source object: when it deals damage, it deducts
      // to a minimum of 0 (a later copy of the same-named card is not covered)
      src.card.damagePrevented = { targetSeat, amount };
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: targetSeat,
        preventNextDamagePool: amount,
        appliesToInstanceId: sourceInstanceId,
      });
      logPublic(
        state,
        `${nameOf(state, src.card.cardId)}'s next ${amount} damage to ${nameOf(state, (state.players[targetSeat] as PlayerState).heroCardId)} will be prevented this turn`,
      );
    },
    preventNextDamageAtMost(targetSeat, amount, maximumEventAmount) {
      if (amount <= 0 || maximumEventAmount <= 0 || !state.players[targetSeat]) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: targetSeat,
        preventNextDamageAmount: amount,
        maxDamageEventAmount: maximumEventAmount,
      });
      logPublic(
        state,
        `the next damage event of ${maximumEventAmount} or less to ${nameOf(state, (state.players[targetSeat] as PlayerState).heroCardId)} will have up to ${amount} damage prevented this turn`,
      );
    },
    preventNextDamageFromType(targetSeat, amount, sourceType) {
      if (amount <= 0 || !sourceType || !state.players[targetSeat]) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: targetSeat,
        preventNextDamageAmount: amount,
        appliesToDamageSourceType: sourceType,
      });
      logPublic(
        state,
        `the next ${amount} damage from a ${sourceType} source to ${nameOf(state, (state.players[targetSeat] as PlayerState).heroCardId)} will be prevented this turn`,
      );
    },
    preventNextDamageEvents(targetSeat, amount, events) {
      if (amount <= 0 || events <= 0 || !state.players[targetSeat]) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: targetSeat,
        preventDamagePerEvent: amount,
        preventDamageEventsRemaining: events,
      });
      logPublic(
        state,
        `the next ${events} damage events to ${nameOf(state, (state.players[targetSeat] as PlayerState).heroCardId)} will each have ${amount} damage prevented this turn`,
      );
    },
    redirectNextHeroDamage(fromSeat, toSeat, prevent) {
      if (!state.players[fromSeat] || !state.players[toSeat] || fromSeat === toSeat) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: fromSeat,
        redirectDamageFromSeat: fromSeat,
        redirectDamageToSeat: toSeat,
        redirectDamagePrevent: Math.max(0, prevent),
      });
      logPublic(
        state,
        `the next damage to ${nameOf(state, (state.players[fromSeat] as PlayerState).heroCardId)} will be redirected to ${nameOf(state, (state.players[toSeat] as PlayerState).heroCardId)} this turn`,
      );
    },
    preventNextPhysicalDamage(targetSeat, amount) {
      if (amount <= 0) return;
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return;
      target.flags.preventNextPhysicalDamage =
        (Number(target.flags.preventNextPhysicalDamage) || 0) + amount;
      logPublic(
        state,
        `the next physical damage event to ${nameOf(state, target.heroCardId)} will have up to ${amount} damage prevented this turn`,
      );
    },
    preventNextArcaneDamage(targetSeat, amount) {
      if (amount <= 0) return;
      const target = state.players[targetSeat] as PlayerState | undefined;
      if (!target) return;
      target.flags.preventNextArcaneDamage =
        (Number(target.flags.preventNextArcaneDamage) || 0) + amount;
      logPublic(
        state,
        `the next ${amount} arcane damage to ${nameOf(state, target.heroCardId)} will be prevented this turn`,
      );
    },
    logPublic(text) {
      logPublic(state, tagKnownLogCardNames(state, text, referencedLogCardIds));
    },
    logPrivate(targetSeat, privateText, publicText) {
      logPrivate(
        state,
        targetSeat,
        tagKnownLogCardNames(state, privateText, referencedLogCardIds),
        publicText === undefined
          ? undefined
          : tagKnownLogCardNames(state, publicText, referencedLogCardIds),
      );
    },
    logForSeats(entry) {
      logForSeats(state, {
        publicText: entry.publicText === null
          ? null
          : tagKnownLogCardNames(state, entry.publicText, referencedLogCardIds),
        ...(entry.seatText
          ? {
              seatText: entry.seatText.map((seatText) =>
                seatText === null
                  ? null
                  : tagKnownLogCardNames(state, seatText, referencedLogCardIds)
              ) as [string | null, string | null],
            }
          : {}),
      });
    },
  };
  return ctx;
}

/** Build a script context whose token commands retain the surrounding event's
 * provenance, such as tokens created by a scripted wager prize. */
export function makeCtxForTokenCreation(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  self: CardInstance,
  link: ChainLinkState | undefined,
  cause: TokenCreationContext,
): ScriptCtx {
  return runtime.makeCtx(state, seat, self, link, undefined, undefined, undefined, cause);
}

/** Push a discarded card to its owner's graveyard and log it. */
export function discardToGraveyard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  atRandom: boolean,
  causedBySeat?: number,
): void {
  const p = state.players[seat] as PlayerState;
  runtime.commands.moveToGraveyard(state, card, "hand", causedBySeat);
  logPublic(
    state,
    atRandom
      ? `${nameOf(state, p.heroCardId)} discards ${logNameOf(state, card.cardId)} at random`
      : `${nameOf(state, p.heroCardId)} discards ${logNameOf(state, card.cardId)}`,
  );
}

/** Fire onEnterArsenal for the entering card itself, then the controller's
 *  other permanents (hero, equipment, the weapon slots, board). */
function fireEnterArsenal(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  from: string,
): void {
  scriptOf(state, card.cardId, card)?.onEnterArsenal?.(runtime.makeCtx(state, seat, card), card, from);
  for (const src of hookSources(state, seat, { equipment: true, weapons: true, board: true })) {
    if (src.instanceId === card.instanceId) continue;
    scriptOf(state, src.cardId, src)?.onEnterArsenal?.(runtime.makeCtx(state, seat, src), card, from);
  }
}

export function fireTransformHook(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  source: CardInstance,
  direction: "from" | "into",
  other: CardInstance,
): void {
  scriptOf(state, source.cardId, source)?.onTransform?.(
    runtime.makeCtx(state, seat, source, currentLink(state)),
    direction,
    other,
  );
}
 
/** Record a discard event and create its triggered layers. The pending layers
 * are added to the stack by the next game state process, after the current
 * cost or resolving layer is complete. */
export function fireOnDiscard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  discarded: CardInstance,
  atRandom: boolean,
): void {
  const data = dataOf(state, discarded.cardId);
  const player = state.players[seat] as PlayerState;
  const payingBruteAttackCost = state.resolving.some((card) => {
    if (Number(card.counters?.payingAdditionalCost ?? 0) !== 1) return false;
    const resolvingData = dataOf(state, card.cardId);
    return resolvingData.cardType === "action" &&
      (resolvingData.subtypes ?? []).includes("attack") &&
      (resolvingData.classes ?? []).includes("brute");
  });
  const priorBruteCostFlag = player.flags.discardingForBruteAttackCost;
  if (payingBruteAttackCost) player.flags.discardingForBruteAttackCost = true;
  if (runtime.commands.basePowerOf(state, seat, discarded, data.attack ?? 0) >= 6) {
    player.flags.discardedSixPlusThisTurn = true;
  }
  runtime.events.queueTriggeredEvent(
    state,
    "card-discarded",
    seat,
    discarded,
    { atRandom },
  );
  if (payingBruteAttackCost) {
    if (priorBruteCostFlag === undefined) delete player.flags.discardingForBruteAttackCost;
    else player.flags.discardingForBruteAttackCost = priorBruteCostFlag;
  }
}

/** Notify active and lingering sources after their controller banishes an
 * opposing hero's card. The acting seat comes from the ScriptCtx command, so
 * owner-side banish observers remain distinct from player-performed effects. */
function fireFriendlyBanishesOpponentCard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  actingSeat: number,
  card: CardInstance,
): void {
  const sources = new Map<number, CardInstance>();
  for (const source of observingHookSources(state, actingSeat, {
    board: true,
    arsenal: true,
    equipment: true,
    weapons: true,
  })) sources.set(source.instanceId, source);

  // Face-up attack cards remain functional on every link of the open combat
  // chain. Defense-reaction Contracts are functional while defending. These
  // cards no longer occupy their owner's ordinary zones, so include their
  // combat-chain instances explicitly as event observers.
  for (const link of state.chain) {
    if (
      link.attacker === actingSeat &&
      link.flags.attackGone !== true &&
      !link.attackingCard.faceDown
    ) sources.set(link.attackingCard.instanceId, link.attackingCard);
    for (const reaction of [...link.defendingCards, ...link.reactions]) {
      if (
        reaction.owner === actingSeat &&
        !reaction.faceDown &&
        dataOf(state, reaction.cardId).cardType === "defense-reaction"
      ) sources.set(reaction.instanceId, reaction);
    }
  }

  for (const source of sources.values()) {
    scriptOf(state, source.cardId, source)?.onFriendlyBanishesOpponentCard?.(
      runtime.makeCtx(state, actingSeat, source, currentLink(state)),
      card,
    );
  }
}
