import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import {
  cardHasType,
  dataOf,
  instanceDataOf,
  instanceHasKeyword,
  scriptOf,
} from "./cardProperties.js";

import { activeModifiers } from "./combatModifiers.js";
import {
  applyOneShotDefenseModifiers,
  attackHasDominate,
  attackHasOverpower,
  attackIntimidateCount,
  attackMaxNonBlockDefenders,
  computeAttack,
  computeDefense,
  currentPowerOf,
  noteAttackDefendedBy,
} from "./combatValues.js";
import { logPublic, nameOf } from "./gameLog.js";

import { rngInt } from "./rng.js";
import type { CardInstance, ChainLinkState, PlayerState, StackLayer } from "./state.js";

import {
  currentLink,
  findCardAnywhere,
  opponent,
  removeFromArray,
} from "./zoneQueries.js";
import { destroyPermanent, moveToGraveyard } from "./zoneMoves.js";
import { hookSources } from "./sourceQueries.js";

import { drawCards } from "./cardLifecycle.js";
import { snapshotSerializable } from "./ruleQueries.js";
import { cardProhibitedByChosenName } from "./restrictions.js";

/** The attack becomes a chain link and is now attacking: intimidate, then the defend decision. */
export function proceedWithAttack(state: GameStateInternal, runtime: EngineRuntime): void {
  state.pendingDecision = null;
  const link = currentLink(state);
  if (!link) return;
  const attacker = state.players[link.attacker] as PlayerState;
  runtime.events.runHook(
    state,
    link.attacker,
    link.attackingCard,
    "onAttackDeclaredTriggersResolved",
    link,
  );
  // intimidate queued by hero/mentor triggers (e.g. Rhinar discarding a 6+ card)
  const queued = Number(attacker.flags.pendingIntimidate) || 0;
  attacker.flags.pendingIntimidate = 0;
  const n = attackIntimidateCount(state, link) + queued;
  if (n > 0) resolveIntimidate(state, link.attacker, n);
  setupDefendDecision(state, runtime);
}

function setupDefendDecision(state: GameStateInternal, runtime: EngineRuntime): void {
  const link = currentLink(state);
  if (!link) return;
  // an attack targeting a non-hero object cannot be defended (CR 8.2.8d /
  // 8.3.14a): no defending cards may be declared — go straight to reactions
  if (link.targetAllyId !== undefined) {
    runtime.dispatchFlow("beginReactionStep", state);
    return;
  }
  const defender = opponent(link.attacker);
  state.phase = "defend";
  state.priorityPlayer = defender;
  state.pendingDecision = {
    player: defender,
    kind: "defend",
    prompt: `Defend against ${nameOf(state, link.attackingCard.cardId)} (${computeAttack(state, runtime, link)} attack)`,
    promptMessage: {
      id: "engine.decision.defend",
      values: {
        card: { kind: "card", cardId: link.attackingCard.cardId },
        attack: computeAttack(state, runtime, link),
      },
    },
  };
}

/**
 * Intimidate (8.5.10): the target banishes a *random* card from their hand
 * face down; it returns at the beginning of the end phase (see endTurn).
 * The player counts as intimidated even if they had no card to banish (8.5.10a).
 * Deliberately bypasses enterBanish: intimidate does not stamp
 * banishedThisTurn/banishedSixPlusThisTurn and does not fire onCardBanished.
 */
export function resolveIntimidate(
  state: GameStateInternal,
  attackerSeat: number,
  n: number,
  targetSeat = opponent(attackerSeat),
): void {
  const attacker = state.players[attackerSeat] as PlayerState;
  attacker.flags.intimidatedThisTurn = true;
  attacker.flags.intimidateCountThisTurn =
    (Number(attacker.flags.intimidateCountThisTurn) || 0) + n;
  const defender = state.players[targetSeat] as PlayerState;
  const count = Math.min(n, defender.hand.length);
  for (let i = 0; i < count; i++) {
    const idx = rngInt(state, defender.hand.length);
    const card = defender.hand.splice(idx, 1)[0] as CardInstance;
    card.faceDown = true;
    card.intimidated = true;
    defender.banish.push(card);
    logPublic(state, `${nameOf(state, defender.heroCardId)} banishes a random card face down (Intimidate)`);
  }
}

/**
 * Intimidate granted outside an attacking card (non-attack actions with the
 * Intimidate keyword like Barraging Beatdown, hero/mentor triggers) resolves
 * immediately: the opponent banishes from hand right away, then play continues.
 */
export function consumeQueuedIntimidate(state: GameStateInternal, seat: number): void {
  const player = state.players[seat] as PlayerState;
  const n = Number(player.flags.pendingIntimidate) || 0;
  if (n === 0) return;
  player.flags.pendingIntimidate = 0;
  resolveIntimidate(state, seat, n);
}

/** Attack-side defender restrictions from the attacking object, hero, and
 * active permanents. Every source must allow the proposed card. */
export function attackAllowsDefender(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  defending: CardInstance,
  fromHand: boolean,
): boolean {
  const sources = [
    link.attackingCard,
    ...hookSources(state, link.attacker, {
      board: true,
      equipment: true,
      weapons: true,
    }),
  ];
  const seen = new Set<number>();
  for (const source of sources) {
    if (seen.has(source.instanceId)) continue;
    seen.add(source.instanceId);
    const hook = scriptOf(state, source.cardId, source)?.canBeDefendedBy;
    if (hook && !hook(runtime.makeCtx(state, link.attacker, source, link), defending, fromHand)) {
      return false;
    }
  }
  return true;
}

export function legalDefenderCards(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
): { hand: CardInstance[]; arsenal: CardInstance[]; equipment: CardInstance[] } {
  const player = state.players[seat] as PlayerState;
  const link = currentLink(state);
  const equipmentAlreadyDefending = new Set(
    state.chain.flatMap((chainLink) =>
      chainLink.defendingEquipment.map((card) => card.instanceId),
    ),
  );
  // scripted extra legality ("this can only defend an attack with 3 or less
  // base {p}") is consulted with ctx.link set
  const allowed = (c: CardInstance, fromHand: boolean) =>
    !cardProhibitedByChosenName(state, c) &&
    (scriptOf(state, c.cardId, c)?.canDefend?.(runtime.makeCtx(state, seat, c, link)) ?? true) &&
    (!link || attackAllowsDefender(state, runtime, link, c, fromHand));
  const hand = player.hand.filter((c) => {
    const d = instanceDataOf(state, c);
    if (
      d.cardType === "defense-reaction" ||
      (d.defense === undefined && scriptOf(state, c.cardId, c)?.modifyDefense === undefined)
    ) return false;
    return allowed(c, true);
  });
  const arsenal = player.arsenal.filter((c) => {
    const d = instanceDataOf(state, c);
    const script = scriptOf(state, c.cardId, c);
    const registeredPermission = state.scriptsRef[c.cardId]?.canDefendFromArsenal;
    const scriptedPermission = script?.canDefendFromArsenal;
    const ambush = registeredPermission !== undefined
      ? typeof scriptedPermission === "function"
        ? scriptedPermission(runtime.makeCtx(state, seat, c, link))
        : scriptedPermission === true
      : instanceHasKeyword(state, c, "ambush");
    const attackActionPermission = player.flags.attackActionsDefendFromArsenal === true &&
      d.cardType === "action" && (d.subtypes ?? []).includes("attack");
    return (attackActionPermission || ambush) &&
      d.defense !== undefined && allowed(c, false);
  });
  // equipment may defend regardless of its defense value — even 0 (Ironhide)
  // or negative after Battleworn counters (it then defends for 0); only
  // equipment with no defense stat at all (e.g. Blossom of Spring) cannot.
  // Face-down (Cloaked) equipment has no defense property and cannot defend.
  const equippedCards = [
    ...Object.values(player.equipment),
    // Off-hands are equipment permanents equipped in a weapon zone (CR
    // 8.2.10a), so they defend through the same equipment rules.
    ...player.weapons.filter((card) => cardHasType(state, card, "equipment")),
    // A dual-type arena object may defend as equipment without occupying an
    // equipment slot (for example, a transformed demi-hero).
    ...[player.hero, ...player.board].filter((card) => cardHasType(state, card, "equipment")),
  ];
  const equipment = equippedCards.filter(
    (c): c is CardInstance =>
      !!c &&
      !c.faceDown &&
      // CR 7.3.2b: a card already defending on any open chain link cannot be
      // declared again until the combat chain closes.
      !equipmentAlreadyDefending.has(c.instanceId) &&
      !state.modifiers.some((modifier) =>
        !modifier.consumed && modifier.cannotDefendWithInstanceId === c.instanceId
      ) &&
      scriptOf(state, link?.attackingCard.cardId ?? "", link?.attackingCard)?.cannotBeDefendedByEquipment !== true &&
      dataOf(state, c.cardId).defense !== undefined &&
      allowed(c, false),
  );
  return { hand, arsenal, equipment };
}

/**
 * Stage (or clear) defenders for the active defend decision without
 * committing them. Declarative — the defender sends the full staged set each
 * time; the cards stay in their zones until the defend intent commits them.
 * Both players see the staging (the projection hides hand-card identities
 * from the opponent), so it is not an undo step on the server.
 */
export function stageDefenders(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceIds: number[],
): string | undefined {
  const pd = state.pendingDecision;
  if (!pd || pd.kind !== "defend" || pd.player !== seat) return "not your defend decision";
  const link = currentLink(state);
  if (!link) return "no attack to defend";
  const { hand, arsenal, equipment } = legalDefenderCards(state, runtime, seat);
  const unique = [...new Set(instanceIds)];
  const maxNonBlock = attackMaxNonBlockDefenders(state, link);
  let nonBlockCount = 0;
  for (const id of unique) {
    const card = hand.find((c) => c.instanceId === id) ??
      arsenal.find((c) => c.instanceId === id) ??
      equipment.find((c) => c.instanceId === id);
    if (!card) {
      return `card ${id} cannot defend`;
    }
    if (dataOf(state, card.cardId).cardType !== "block") {
      nonBlockCount++;
      if (maxNonBlock !== undefined && nonBlockCount > maxNonBlock) {
        return `this attack can't be defended by more than ${maxNonBlock} non-block cards`;
      }
    }
  }
  pd.staged = unique.length > 0 ? unique : undefined;
  return undefined;
}

/** Phantasm (8.3.13): is the link's phantasm attack defended by a
 *  non-Illusionist attack action card with 6 or more {p}? Re-evaluated when
 *  the triggered layer resolves, including current counters and temporary
 *  power changes (CR 5.3.2a). */
function phantasmDefender(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): boolean {
  if (!instanceHasKeyword(state, link.attackingCard, "phantasm")) return false;
  return link.defendingCards.some((c) => {
    const d = dataOf(state, c.cardId);
    if (d.cardType !== "action" || !(d.subtypes ?? []).includes("attack")) return false;
    if ((d.classes ?? []).some((cl) => cl.toLowerCase() === "illusionist")) return false;
    return currentPowerOf(state, runtime, c, link) >= 6;
  });
}

/** Resolve Spectra's triggered layer, then clear the attack because its sole
 *  non-hero target no longer exists as a legal attack target (7.2.2c). The
 *  attacking action card follows the normal close-chain path to graveyard;
 *  weapons and attacking allies remain in the arena. */
export function resolveSpectraLayer(
  state: GameStateInternal,
  runtime: EngineRuntime,
  sourceInstanceId: number,
): boolean {
  const link = currentLink(state);
  if (!link || link.targetAllyId !== sourceInstanceId) return false;
  const defender = state.players[opponent(link.attacker)] as PlayerState;
  const target = defender.board.find((card) => card.instanceId === sourceInstanceId);
  if (target) {
    destroyPermanent(state, runtime, defender.seat, target);
  } else {
    logPublic(state, "Spectra resolves without effect (its source is gone)");
  }
  link.resolved = true;
  link.damage = 0;
  link.hit = false;
  link.goAgain = false;
  state.modifiers = state.modifiers.filter((modifier) => modifier.scope !== "chain-link");
  runtime.dispatchFlow("closeChain", state);
  state.reactionPasses = 0;
  if (!state.pendingDecision?.chooseHook) state.pendingDecision = null;
  state.phase = "action";
  state.priorityPlayer = state.activePlayer;
  return true;
}

/** Resolve Phantasm's state-triggered layer. The condition is checked again;
 *  if a response removed Phantasm or reduced every qualifying defender below
 *  6{p}, the layer resolves without destroying the attack. */
export function resolvePhantasmLayer(
  state: GameStateInternal,
  runtime: EngineRuntime,
  sourceInstanceId: number,
): boolean {
  const link = currentLink(state);
  if (!link || link.attackingCard.instanceId !== sourceInstanceId || !phantasmDefender(state, runtime, link)) {
    logPublic(state, "Phantasm resolves without effect (its condition is no longer met)");
    return false;
  }
  phantasmDestroy(state, runtime, link);
  return true;
}

/** Build Phantasm's mandatory state-triggered layer. */
function phantasmLayer(state: GameStateInternal, link: ChainLinkState): StackLayer {
  logPublic(state, `${nameOf(state, link.attackingCard.cardId)} triggers Phantasm`);
  return {
    sourceInstanceId: link.attackingCard.instanceId,
    seat: link.attacker,
    triggerIndex: -3,
    label: "Phantasm — destroy this attack",
    optional: false,
    engineEffect: { kind: "phantasm-destroy" },
  };
}

interface DefendEventCard {
  card: CardInstance;
  fragmentTriggered: boolean;
}

function appendTriggerLayer(
  groups: { seat: number; layers: StackLayer[] }[],
  seat: number,
  layer: StackLayer,
): void {
  const group = groups.find((candidate) => candidate.seat === seat);
  if (group) group.layers.push(layer);
  else groups.push({ seat, layers: [layer] });
}

/** Collect every trigger generated by one defend event. Legacy script hooks
 * are snapshotted into engine layers so they obey the same priority and
 * simultaneous-trigger ordering rules as CardScript.triggers. */
function collectDefendEventLayers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  defenders: DefendEventCard[],
  defendedFromHand: boolean,
): { seat: number; layers: StackLayer[] }[] {
  const groups = runtime.dispatchFlow("collectEventTriggerLayers", state, "attack-defended", link.attacker);
  for (const { card } of defenders) {
    const script = scriptOf(state, card.cardId, card);
    if (!script?.onDefend) continue;
    const ctx = runtime.makeCtx(state, card.owner, card, link);
    if (script.canTriggerOnDefend && !script.canTriggerOnDefend(ctx)) continue;
    appendTriggerLayer(groups, card.owner, {
      sourceInstanceId: card.instanceId,
      seat: card.owner,
      triggerIndex: -4,
      label: "When this defends",
      optional: false,
      engineEffect: { kind: "on-defend-hook", source: snapshotSerializable(card) },
    });
    logPublic(state, `${nameOf(state, card.cardId)} triggers: When this defends`);
  }

  if (defenders.length > 0) {
    for (const modifier of activeModifiers(state, link, ["chain-link"])) {
      if (modifier.consumed || !modifier.onDefendedDealDamage) continue;
      modifier.consumed = true;
      appendTriggerLayer(groups, link.attacker, {
        sourceInstanceId: modifier.sourceInstanceId,
        seat: link.attacker,
        triggerIndex: -1000 - modifier.id,
        label: "When the affected attack is defended by 1 or more cards",
        optional: false,
        engineEffect: {
          kind: "on-defended-modifier",
          modifier: snapshotSerializable(modifier),
        },
      });
      const source = findCardAnywhere(state, modifier.sourceInstanceId)?.card;
      logPublic(
        state,
        `${source ? nameOf(state, source.cardId) : "A delayed effect"} triggers: ` +
          "When the affected attack is defended by 1 or more cards",
      );
    }
  }

  const friendlyDefendedSources = [
    link.attackingCard,
    ...hookSources(state, link.attacker, {
      board: true,
      equipment: true,
      weapons: true,
      heroLast: true,
    }).filter((source) => source.instanceId !== link.attackingCard.instanceId),
  ];
  for (const source of friendlyDefendedSources) {
    const script = scriptOf(state, source.cardId, source);
    if (!script?.onFriendlyDefended) continue;
    const trigger = script.friendlyDefendedTrigger;
    if (
      trigger?.condition &&
      !trigger.condition(
        runtime.makeCtx(state, link.attacker, source, link),
        defenders.map(({ card }) => card),
      )
    ) continue;
    const label = trigger?.label ?? "When your attack is defended";
    appendTriggerLayer(groups, link.attacker, {
      sourceInstanceId: source.instanceId,
      seat: link.attacker,
      triggerIndex: -5,
      label,
      optional: false,
      engineEffect: {
        kind: "on-friendly-defended-hook",
        source: snapshotSerializable(source),
        defendedFromHand,
      },
    });
    logPublic(state, `${nameOf(state, source.cardId)} triggers: ${label}`);
  }

  for (const { fragmentTriggered } of defenders) {
    if (!fragmentTriggered) continue;
    appendTriggerLayer(groups, link.attacker, {
      sourceInstanceId: link.attackingCard.instanceId,
      seat: link.attacker,
      triggerIndex: -6,
      label: "Fragment — this gets -2 power",
      optional: false,
      engineEffect: { kind: "fragment", source: snapshotSerializable(link.attackingCard) },
    });
    logPublic(state, `${nameOf(state, link.attackingCard.cardId)} triggers Fragment`);
  }

  if (
    phantasmDefender(state, runtime, link) &&
    !state.stack.some((layer) => layer.engineEffect?.kind === "phantasm-destroy")
  ) {
    appendTriggerLayer(groups, link.attacker, phantasmLayer(state, link));
  }
  return groups;
}

/** Queue defend-event triggers generated while another stack layer is
 * resolving. They sit immediately below that layer and receive priority as
 * soon as it finishes. A single defender-entry event has at most one legacy
 * trigger of each source, so stable group order is sufficient here. */
export function queueDefendEventLayersAfterCurrent(
  state: GameStateInternal,
  runtime: EngineRuntime,
  link: ChainLinkState,
  defenders: DefendEventCard[],
  defendedFromHand: boolean,
): void {
  const layers = collectDefendEventLayers(state, runtime, link, defenders, defendedFromHand)
    .flatMap((group) => group.layers);
  if (layers.length === 0) return;
  state.stack.splice(state.stack.length > 0 ? 1 : 0, 0, ...layers);
}

/** The phantasm attack is destroyed (8.3.13b): the attacking card goes to its
 *  owner's graveyard (onDestroyed / onCardToGraveyard fire), there is no
 *  damage step, no hit and no go-again refund, and the whole combat chain
 *  closes — defending cards are buried and defending equipment processes its
 *  close-of-chain keywords exactly as at normal link resolution. */
function phantasmDestroy(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): void {
  logPublic(state, `${nameOf(state, link.attackingCard.cardId)} is destroyed (Phantasm)`);
  runtime.events.fireFriendlyAttackLost(state, link.attacker, link.attackingCard, "phantasm");
  link.resolved = true; // let closeChain run
  link.damage = 0;
  link.hit = false;
  const destroyedDraw = activeModifiers(state, link, ["chain-link"])
    .reduce((sum, modifier) => sum + Number(modifier.onDestroyedDraw || 0), 0);
  // closeChain must not bury the attack a second time
  link.flags.attackGone = true;
  state.modifiers = state.modifiers.filter((m) => m.scope !== "chain-link");
  moveToGraveyard(state, runtime, link.attackingCard, "chain");
  runtime.events.runHook(state, link.attacker, link.attackingCard, "onDestroyed", link);
  runtime.events.fireFriendlyDestroyed(state, link.attacker, link.attackingCard);
  if (destroyedDraw > 0) drawCards(state, runtime, state.players[link.attacker] as PlayerState, destroyedDraw);
  runtime.dispatchFlow("closeChain", state);
  state.reactionPasses = 0;
  // a scripted choice queued during the pop (onFriendlyAttackLost — Silent
  // Stilettos' "you may pay {r}{r}{r}") survives the chain closing
  if (!state.pendingDecision?.chooseHook) state.pendingDecision = null;
  state.phase = "action";
  state.priorityPlayer = state.activePlayer;
}

export function assignDefenders(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  instanceIds: number[],
  pitchInstanceIds: number[] = [],
): string | undefined {
  const pd = state.pendingDecision;
  const link = currentLink(state);
  if (!pd || pd.kind !== "defend" || pd.player !== seat || !link) return "not your decision";
  const player = state.players[seat] as PlayerState;
  const { hand, arsenal, equipment } = legalDefenderCards(state, runtime, seat);
  const requiredEquipment = Math.min(
    equipment.length,
    Number(link.flags.mustDefendWithEquipmentCount ?? (link.flags.mustDefendWithEquipment === true ? 1 : 0)),
  );
  const selectedEquipment = instanceIds.filter((id) =>
    equipment.some((card) => card.instanceId === id),
  ).length;
  if (selectedEquipment < requiredEquipment) {
    return `this attack must be defended with ${requiredEquipment} equipment if able`;
  }
  const dominate = attackHasDominate(state, link);
  const overpower = attackHasOverpower(state, link);
  const maxNonBlock = attackMaxNonBlockDefenders(state, link);
  const seen = new Set<number>();
  let handCount = 0;
  let nonBlockCount = 0;
  // Overpower (8.3.22): at most one action card may defend (defense reactions,
  // block cards and equipment are unaffected)
  let actionDefenders = link.defendingCards.filter(
    (c) => dataOf(state, c.cardId).cardType === "action",
  ).length;
  for (const id of instanceIds) {
    // reject duplicates: the legal-defender snapshots above still contain a
    // card after it was removed from the live zone, so a repeated id would
    // otherwise defend (and trigger hooks) multiple times
    if (seen.has(id)) return `card ${id} cannot defend twice`;
    seen.add(id);
    const hc = hand.find((c) => c.instanceId === id);
    const ac = arsenal.find((c) => c.instanceId === id);
    const ec = equipment.find((c) => c.instanceId === id);
    if (!hc && !ac && !ec) return `card ${id} cannot defend`;
    if (dataOf(state, (hc ?? ac ?? ec)!.cardId).cardType !== "block") {
      nonBlockCount++;
      if (maxNonBlock !== undefined && nonBlockCount > maxNonBlock) {
        return `this attack can't be defended by more than ${maxNonBlock} non-block cards`;
      }
    }
    if (hc || ac) {
      const defendingCard = hc ?? ac as CardInstance;
      if (hc) handCount++;
      if (hc && dominate && handCount > 1) return "Dominate: at most 1 card from hand may defend";
      if (dataOf(state, defendingCard.cardId).cardType === "action") {
        actionDefenders++;
        if (overpower && actionDefenders > 1) {
          return "Overpower: this attack can't be defended by more than one action card";
        }
      }
      if (hc) removeFromArray(player.hand, id);
      else removeFromArray(player.arsenal, id);
      delete defendingCard.faceDown;
      link.defendingCards.push(defendingCard);
      if (hc) link.flags[`defendedFromHand:${id}`] = true;
    } else if (ec) {
      link.defendingEquipment.push(ec);
    }
  }
  const committedDefenders = instanceIds.flatMap((id) => {
    const defending =
      link.defendingCards.find((card) => card.instanceId === id) ??
      link.defendingEquipment.find((card) => card.instanceId === id);
    return defending ? [defending] : [];
  });
  applyOneShotDefenseModifiers(state, link, committedDefenders);
  const defendEventCards: DefendEventCard[] = [];
  for (const id of instanceIds) {
    const defending =
      link.defendingCards.find((card) => card.instanceId === id) ??
      link.defendingEquipment.find((card) => card.instanceId === id);
    if (defending) {
      defendEventCards.push({
        card: defending,
        fragmentTriggered: noteAttackDefendedBy(state, runtime, link, defending),
      });
    }
  }
  if (handCount > 0) {
    link.flags.defendedFromHand = true;
    link.flags.defendedFromHandCount = Number(link.flags.defendedFromHandCount ?? 0) + handCount;
  }
  if (pitchInstanceIds.length > 0) {
    return "defend-trigger costs are paid when their stack layers resolve";
  }
  if (instanceIds.length > 0) {
    logPublic(
      state,
      `${nameOf(state, player.heroCardId)} defends with ${instanceIds.length} card(s) (${computeDefense(state, runtime, link)} defense)`,
    );
  } else {
    logPublic(state, `${nameOf(state, player.heroCardId)} takes the attack (no defense)`);
  }
  if (
    link.defendingCards.some((card) => {
      const data = dataOf(state, card.cardId);
      return data.cardType === "action" && (data.subtypes ?? []).includes("attack");
    }) &&
    activeModifiers(state, link, ["chain-link"]).some(
      (modifier) => modifier.goAgainIfDefendedByAttackAction === true,
    )
  ) {
    runtime.events.grantLinkGoAgain(state, link);
  }
  // All abilities generated by the committed defense are simultaneous,
  // respondable triggered layers. This includes legacy onDefend and
  // onFriendlyDefended hooks, Fragment, Phantasm, and registered triggers.
  runtime.dispatchFlow("queueTriggeredLayers", state, collectDefendEventLayers(state, runtime, link, defendEventCards, handCount > 0), "start-reaction-step");
  return undefined;
}

/** Resolve one trigger created by a card becoming a defender. */
export function resolveDefendEventLayer(state: GameStateInternal,
  runtime: EngineRuntime, layer: StackLayer): void {
  const link = currentLink(state);
  if (!link) {
    logPublic(state, "A defend trigger resolves without effect (the chain link is gone)");
    return;
  }
  const effect = layer.engineEffect;
  if (effect?.kind === "on-defend-hook") {
    const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? effect.source;
    runtime.events.runHook(state, layer.seat, source, "onDefend", link);
    // Defender-side "when this defends, intimidate" (Scowling Flesh Bag) queues
    // on the defending seat; resolve it as the trigger resolves.
    consumeQueuedIntimidate(state, layer.seat);
    return;
  }
  if (effect?.kind === "on-friendly-defended-hook") {
    const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? effect.source;
    scriptOf(state, source.cardId, source)?.onFriendlyDefended?.(
      runtime.makeCtx(state, layer.seat, source, link),
      effect.defendedFromHand,
    );
    return;
  }
  if (effect?.kind === "on-defended-modifier") {
    runtime.makeCtx(state, link.attacker, link.attackingCard, link).dealDamage(
      opponent(link.attacker),
      effect.modifier.onDefendedDealDamage ?? 0,
      { sourceInstanceId: link.attackingCard.instanceId },
    );
    return;
  }
  if (effect?.kind === "on-fragment-hook") {
    const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? effect.source;
    scriptOf(state, source.cardId, source)?.onFragment?.(
      runtime.makeCtx(state, layer.seat, source, link),
    );
    return;
  }
  if (effect?.kind === "fragment") {
    if (link.attackingCard.instanceId !== layer.sourceInstanceId) {
      logPublic(state, "Fragment resolves without effect (the attack is gone)");
      return;
    }
    link.attackingCard.tempPower = (link.attackingCard.tempPower ?? 0) - 2;
    link.flags.fragmentCount = Number(link.flags.fragmentCount ?? 0) + 1;
    (state.players[link.attacker] as PlayerState).flags.fragmentedThisTurn = true;
    logPublic(state, `${nameOf(state, link.attackingCard.cardId)} fragments (-2 power)`);
    const source = findCardAnywhere(state, layer.sourceInstanceId)?.card ?? effect.source;
    if (scriptOf(state, source.cardId, source)?.onFragment) {
      state.stack.splice(state.stack[0] === layer ? 1 : 0, 0, {
        sourceInstanceId: source.instanceId,
        seat: layer.seat,
        triggerIndex: -7,
        label: "Whenever this fragments",
        optional: false,
        engineEffect: { kind: "on-fragment-hook", source: snapshotSerializable(source) },
      });
      logPublic(state, `${nameOf(state, source.cardId)} triggers: Whenever this fragments`);
    }
  }
}
