import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { GameMessage } from "@fyendal/shared";
import { cardNameKeysOf, dataOf, scriptOf } from "./cardProperties.js";
import {
  gameLogMessage,
  logCardValue,
  logPublic,
  nameOf,
  triggerLogMessage,
} from "./gameLog.js";
import { triggerOccurrenceCount } from "./scripts.js";
import type { DamageEventContext, ScriptCtx, TriggerEvent, TriggerEventContext } from "./scripts.js";
import type { CardInstance, ChainLinkState, PlayerState, StackLayer } from "./state.js";
import { tokenCreationCauseForModifier } from "./tokenQueries.js";
import { currentLink, opponent, removeFromArray } from "./zoneQueries.js";
import { heroAbilitiesDisabled } from "./stateQueries.js";
import { goAgainSuppressed } from "./ruleQueries.js";
import {
  eventTriggerIsActive,
  eventTriggerSources,
  hookSources,
  lingeringModifierSources,
  observingHookSources,
} from "./sourceQueries.js";

/** Collect and announce card-script triggers for an event. Immediate and
 * deferred callers share this path so source-zone semantics cannot drift. */
export function collectCardEventTriggerLayers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  event: TriggerEvent,
  subject: number,
  maxSourceId?: number,
  eventCard?: CardInstance,
  eventContext?: TriggerEventContext,
): { seat: number; layers: StackLayer[] }[] {
  const groups: { seat: number; layers: StackLayer[] }[] = [];
  for (const seat of [subject, opponent(subject)]) {
    const player = state.players[seat] as PlayerState;
    const layers: StackLayer[] = [];
    const announcements: { group?: string; text: string; message?: GameMessage; occurrences: number }[] = [];
    const sources = eventTriggerSources(state, player);
    if (
      event !== "card-played" && eventCard?.owner === seat &&
      !sources.some((source) => source.card.instanceId === eventCard.instanceId)
    ) {
      sources.push({ card: eventCard, physicalZone: "self", active: false });
    }
    for (const source of sources) {
      const { card } = source;
      const isEventCard = event !== "card-played" &&
        eventCard?.owner === seat &&
        card.instanceId === eventCard.instanceId;
      if (maxSourceId !== undefined && card.instanceId >= maxSourceId) continue;
      scriptOf(state, card.cardId, card)?.triggers?.forEach((trigger, triggerIndex) => {
        if (
          trigger.event !== event ||
          (!eventTriggerIsActive(source, trigger) &&
            !(isEventCard && trigger.sourceZone === "self"))
        ) return;
        if (
          isEventCard && eventContext?.combatRole === "defending" && trigger.whileDefending !== true
        ) return;
        if ((trigger.whose ?? "subject") === "subject" && seat !== subject) return;
        const ctx = runtime.makeCtx(state, seat, card, currentLink(state));
        if (trigger.condition && !trigger.condition(ctx, eventCard, eventContext)) return;
        const occurrences = triggerOccurrenceCount(trigger, ctx, eventCard, eventContext);
        if (occurrences === 0) return;
        for (let occurrence = 0; occurrence < occurrences; occurrence++) {
          trigger.onTrigger?.(ctx, eventCard, eventContext);
        }
        layers.push({
          sourceInstanceId: card.instanceId,
          seat,
          triggerIndex,
          ...(occurrences > 1 ? { triggerCount: occurrences } : {}),
          triggerSource: runtime.commands.snapshotSerializable(card),
          ...(eventCard ? { triggerEventCard: runtime.commands.snapshotSerializable(eventCard) } : {}),
          ...(eventContext?.damage ? { triggerDamage: { ...eventContext.damage } } : {}),
          label: trigger.label,
          optional: trigger.optional ?? false,
          ...(trigger.defaultOption ? { defaultOption: trigger.defaultOption } : {}),
        });
        const publicText = card.faceDown
          ? `${nameOf(state, player.heroCardId)}'s face-down card triggers: ${trigger.label}`
          : trigger.publicLog ?? `${nameOf(state, card.cardId)} triggers: ${trigger.label}`;
        const message = card.faceDown && trigger.labelMessage
          ? triggerLogMessage(
              publicText,
              player.heroCardId,
              trigger.labelMessage,
              1,
              "engine.log.trigger.facedown",
            ).message
          : trigger.publicLogMessage
            ? {
                ...trigger.publicLogMessage,
                values: {
                  ...trigger.publicLogMessage.values,
                  triggerSource: logCardValue(card.cardId),
                  occurrences: 1,
                },
              }
            : !trigger.publicLog && trigger.labelMessage
              ? triggerLogMessage(publicText, card.cardId, trigger.labelMessage).message
              : undefined;
        announcements.push({
          ...(trigger.simultaneousKey
            ? { group: `${trigger.simultaneousKey}\u0000${publicText}` }
            : {}),
          text: publicText,
          ...(message ? { message } : {}),
          occurrences,
        });
      });
    }
    const groupedCounts = new Map<string, number>();
    for (const announcement of announcements) {
      if (announcement.group) {
        groupedCounts.set(
          announcement.group,
          (groupedCounts.get(announcement.group) ?? 0) + announcement.occurrences,
        );
      }
    }
    const announcedGroups = new Set<string>();
    const announce = (announcement: (typeof announcements)[number], occurrences: number): void => {
      const fallback = `${announcement.text}${occurrences > 1 ? ` ×${occurrences}` : ""}`;
      if (!announcement.message) {
        logPublic(
          state,
          gameLogMessage(
            fallback,
            "engine.log.trigger.generic",
            { occurrences },
          ),
        );
        return;
      }
      logPublic(state, {
        fallback,
        message: {
          ...announcement.message,
          values: {
            ...announcement.message.values,
            occurrences,
          },
        },
      });
    };
    for (const announcement of announcements) {
      if (!announcement.group) {
        announce(announcement, announcement.occurrences);
        continue;
      }
      if (announcedGroups.has(announcement.group)) continue;
      announcedGroups.add(announcement.group);
      const count = groupedCounts.get(announcement.group) ?? 1;
      announce(announcement, count);
    }
    if (layers.length > 0) groups.push({ seat, layers });
  }
  return groups;
}

/** Queue an event raised while announcing or resolving another object without
 * re-entering the stack machine. The caller's normal continuation exposes the
 * new triggered layers at the next priority point. */
export function queueTriggeredEvent(
  state: GameStateInternal,
  runtime: EngineRuntime,
  event: TriggerEvent,
  subject: number,
  eventCard?: CardInstance,
  eventContext?: TriggerEventContext,
  maxSourceId?: number,
): void {
  for (const group of runtime.events.collectCardEventTriggerLayers(
    state,
    event,
    subject,
    maxSourceId,
    eventCard,
    eventContext,
  )) {
    (state.pendingTriggeredLayers ??= []).push(...group.layers);
  }
}

/** Raise the "damage-dealt" event for positive damage dealt to a hero or an
 * ally after prevention. Its triggered layers join the pending layers that the
 * damage step or the resolving layer exposes before the next priority point
 * (CR 6.6.6). Ordinals use turn-scoped player counts, so ordinal triggers see
 * damage dealt before their source existed (CR 6.6.5d). */
export function queueDamageDealt(
  state: GameStateInternal,
  runtime: EngineRuntime,
  source: CardInstance | undefined,
  damage: Omit<DamageEventContext, "opposingHeroOrdinal" | "arcaneOrdinal" | "fromOpposingHeroOrdinal">,
): void {
  if (damage.amount <= 0) return;
  const count = (player: PlayerState, flag: string): number => {
    const next = (Number(player.flags[flag]) || 0) + 1;
    player.flags[flag] = next;
    return next;
  };
  const dealer = state.players[damage.sourceSeat] as PlayerState;
  const target = state.players[damage.targetSeat] as PlayerState;
  const opposingHero = damage.byController &&
    damage.targetAllyInstanceId === undefined &&
    damage.targetSeat !== damage.sourceSeat;
  const ordinals = {
    ...(opposingHero ? { opposingHeroOrdinal: count(dealer, "opposingHeroDamageEvents") } : {}),
    ...(damage.byController && damage.arcane ? { arcaneOrdinal: count(dealer, "arcaneDamageEvents") } : {}),
    ...(opposingHero ? { fromOpposingHeroOrdinal: count(target, "damageEventsFromOpposingHeroes") } : {}),
  };
  queueTriggeredEvent(state, runtime, "damage-dealt", damage.sourceSeat, source, {
    damage: { ...damage, ...ordinals },
  });
}

/** Notify active sources after their controller's hero is actually dealt
 * positive damage. Damage prevention has already been applied by both callers;
 * life loss and ally damage intentionally bypass this event. */
export function fireHeroDealtDamage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  amount: number,
  arcane: boolean,
): void {
  if (amount <= 0) return;
  for (const source of hookSources(state, seat, {
    board: true,
    equipment: true,
    weapons: true,
  })) {
    scriptOf(state, source.cardId, source)?.onHeroDealtDamage?.(
      runtime.makeCtx(state, seat, source, currentLink(state)),
      amount,
      arcane,
    );
  }
}

/** Fire onFriendlyPlay for the player's active sources after a card is announced. */
export function fireOnFriendlyPlay(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  played: CardInstance,
  from: string,
): void {
  const alreadyResolving = state.resolving.some((card) => card.instanceId === played.instanceId);
  if (!alreadyResolving) state.resolving.push(played);
  const sources = observingHookSources(state, seat, {
    board: true,
    arsenal: true,
    equipment: true,
    weapons: true,
  });
  for (const src of sources) {
    scriptOf(state, src.cardId, src)?.onFriendlyPlay?.(
      runtime.makeCtx(state, seat, src, currentLink(state)),
      played,
      from,
    );
  }
  const opposingSeat = opponent(seat);
  const opposingSources = observingHookSources(state, opposingSeat, {
    board: true,
    arsenal: true,
    equipment: true,
    weapons: true,
  });
  for (const src of opposingSources) {
    scriptOf(state, src.cardId, src)?.onOpponentPlay?.(
      runtime.makeCtx(state, opposingSeat, src, currentLink(state)),
      played,
      from,
    );
  }
  if (!alreadyResolving) removeFromArray(state.resolving, played.instanceId);
}

/** Notify active friendly permanents after another permanent has entered.
 * `from` names the origin zone when the entering path knows it, so a trigger
 * such as "when this is equipped from anywhere other than your graveyard" can
 * read it from the event context. */
export function fireFriendlyEnterArena(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  entered: CardInstance,
  from?: "graveyard" | "banish" | "inventory",
): void {
  const maxSourceId = state.nextInstanceId;
  for (const source of hookSources(state, seat, {
    board: true,
    equipment: true,
    weapons: true,
  })) {
    if (source.instanceId === entered.instanceId) continue;
    scriptOf(state, source.cardId, source)?.onFriendlyEnterArena?.(
      runtime.makeCtx(state, seat, source, currentLink(state)),
      entered,
    );
  }
  runtime.events.queueTriggeredEvent(
    state,
    "card-entered-arena",
    seat,
    entered,
    { causedBySeat: seat, to: "arena", ...(from ? { from } : {}) },
    maxSourceId,
  );
}

/** Fire onFriendlyActivate after a player has paid an activated ability's costs. */
export function fireOnFriendlyActivate(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  activated: CardInstance,
  timing: "action" | "instant" | "attack-reaction" | "defense-reaction" = "action",
): void {
  for (const src of hookSources(state, seat, {
    board: true,
    arsenal: true,
    equipment: true,
    weapons: true,
  })) {
    scriptOf(state, src.cardId, src)?.onFriendlyActivate?.(
      runtime.makeCtx(state, seat, src, currentLink(state)),
      activated,
      timing,
    );
  }
  for (const modifier of state.modifiers) {
    if (
      modifier.seat !== seat ||
      modifier.consumed ||
      modifier.onFriendlyActivateCreateToken === undefined
    ) continue;
    runtime.commands.createTokenFor(
      state,
      state.players[seat] as PlayerState,
      modifier.onFriendlyActivateCreateToken,
      tokenCreationCauseForModifier(state, modifier),
    );
  }
  const opposingSeat = opponent(seat);
  const active = hookSources(state, opposingSeat, {
    board: true,
    equipment: true,
    weapons: true,
  });
  const sources = [...active, ...lingeringModifierSources(state, opposingSeat).filter(
    (candidate) => !active.some((source) => source.instanceId === candidate.instanceId),
  )];
  for (const src of sources) {
    scriptOf(state, src.cardId, src)?.onOpponentActivate?.(
      runtime.makeCtx(state, opposingSeat, src, currentLink(state)),
      activated,
      timing,
    );
  }
}

/** Notify the controller's other permanents that their attack was lost. */
export function fireFriendlyAttackLost(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  cause: "phantasm" | "ally-died",
): void {
  const p = state.players[seat] as PlayerState;
  const sources: CardInstance[] = [
    p.hero,
    ...Object.values(p.equipment).filter((c): c is CardInstance => !!c && !c.faceDown),
    ...p.board.filter((c) => !c.faceDown),
  ];
  for (const src of sources) {
    if (src.instanceId === card.instanceId) continue;
    scriptOf(state, src.cardId, src)?.onFriendlyAttackLost?.(
      runtime.makeCtx(state, seat, src, currentLink(state)),
      card,
      cause,
    );
  }
}

/** Notify surviving permanents that another permanent they controlled was destroyed. */
export function fireFriendlyDestroyed(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  destroyed: CardInstance,
  destroyingSeat?: number,
): void {
  const destroyedData = dataOf(state, destroyed.cardId);
  const flags = (state.players[seat] as PlayerState).flags;
  for (const destroyedName of cardNameKeysOf(state, destroyed)) {
    flags[`destroyedName:${destroyedName}`] = true;
    flags[`destroyedNameCount:${destroyedName}`] = Number(flags[`destroyedNameCount:${destroyedName}`] ?? 0) + 1;
  }
  for (const subtype of destroyedData.subtypes ?? []) {
    flags[`destroyedSubtype:${subtype.toLowerCase()}`] = true;
  }
  runtime.events.queueTriggeredEvent(state, "card-destroyed", seat, destroyed);
  scriptOf(state, destroyed.cardId, destroyed)?.onFriendlyDestroyed?.(
    runtime.makeCtx(state, seat, destroyed, currentLink(state)),
    destroyed,
    destroyingSeat,
  );
  for (const src of hookSources(state, seat, {
    board: true,
    equipment: true,
    weapons: true,
  })) {
    if (src.instanceId === destroyed.instanceId) continue;
    scriptOf(state, src.cardId, src)?.onFriendlyDestroyed?.(
      runtime.makeCtx(state, seat, src, currentLink(state)),
      destroyed,
      destroyingSeat,
    );
  }
}

/** Queue banish triggers for either player, then notify the owner's hero and permanents. */
export function fireCardBanished(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  from: string,
): void {
  runtime.events.queueTriggeredEvent(state, "card-banished", seat, card, { from, to: "banish" });
  for (const src of hookSources(state, seat, {
    board: true,
    equipment: true,
    weapons: true,
  })) {
    scriptOf(state, src.cardId, src)?.onCardBanished?.(
      runtime.makeCtx(state, seat, src, currentLink(state)),
      card,
      from,
    );
  }
}

/** Notify the owner's active sources after one of their cards leaves the graveyard. */
export function fireCardLeavesGraveyard(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  to: string,
): void {
  runtime.events.queueTriggeredEvent(state, "card-left-graveyard", seat, card);
  for (const src of hookSources(state, seat, {
    board: true,
    equipment: true,
    weapons: true,
  })) {
    if (src.instanceId === card.instanceId) continue;
    scriptOf(state, src.cardId, src)?.onCardLeavesGraveyard?.(
      runtime.makeCtx(state, seat, src, currentLink(state)),
      card,
      to,
    );
  }
}

/** Run a hook for a card if it has a script, swallowing nothing. */
export function runHook<K extends
  | "onPlay"
  | "onResolved"
  | "onAttackDeclared"
  | "onAttackDeclaredTriggersResolved"
  | "onFriendlyAttackDeclared"
  | "onGainGoAgain"
  | "onHit"
  | "onSuppressedHit"
  | "onMiss"
  | "onDefend"
  | "onDestroyed"
  | "onEnterArena"
  | "onBooed"
  | "onCheered"
>(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  hook: K,
  link?: ChainLinkState,
  fromArsenal?: boolean,
  playTargetInstanceId?: number,
): void {
  const script = scriptOf(state, card.cardId, card);
  const fn = script?.[hook];
  if (
    card.instanceId === state.players[seat]?.hero.instanceId &&
    heroAbilitiesDisabled(state, seat)
  ) return;
  const ctx = runtime.makeCtx(state, seat, card, link, fromArsenal, playTargetInstanceId);
  if (fn) (fn as (c: ScriptCtx) => void)(ctx);
  const inheritedIds = [
    ...(card.grantedBaseAbilitiesCardId ? [card.grantedBaseAbilitiesCardId] : []),
    ...(card.grantedBaseAbilitiesCardIds ?? []),
  ];
  for (const inheritedId of inheritedIds) {
    const inherited = state.scriptsRef[inheritedId]?.[hook];
    if (inherited) (inherited as (c: ScriptCtx) => void)(ctx);
  }
}

/** Notify that the link's attack has go again (attacking card + hero hooks). */
function notifyGoAgain(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): void {
  if (link.attackCardType === "weapon") {
    (state.players[link.attacker] as PlayerState).flags[
      `weaponGainedGoAgain:${link.attackingCard.instanceId}`
    ] = true;
  }
  runtime.events.runHook(state, link.attacker, link.attackingCard, "onGainGoAgain", link);
  const hero = (state.players[link.attacker] as PlayerState).hero;
  runtime.events.runHook(state, link.attacker, hero, "onGainGoAgain", link);
  const active = hookSources(state, link.attacker, {
    board: true,
    equipment: true,
    weapons: true,
  });
  for (const source of lingeringModifierSources(state, link.attacker)) {
    if (
      source.instanceId === link.attackingCard.instanceId ||
      source.instanceId === hero.instanceId
    ) continue;
    if (active.some((candidate) => candidate.instanceId === source.instanceId)) continue;
    runtime.events.runHook(state, link.attacker, source, "onGainGoAgain", link);
  }
}

/** Give the link go again. Idempotent; hooks fire only the first time it sticks. */
export function grantLinkGoAgain(state: GameStateInternal,
  runtime: EngineRuntime, link: ChainLinkState): void {
  if (
    link.goAgain ||
    link.flags.attackAbilitiesSuppressed === true ||
    goAgainSuppressed(state, link.attacker) ||
    (link.attackingCard.suppressedKeywords ?? []).includes("go again")
  ) return;
  link.goAgain = true;
  notifyGoAgain(state, runtime, link);
}

/** Raise "go-again-resolved" when go again grants its controller an action
 * point. Its triggered layers join the pending layers placed before the next
 * priority point. */
export function notifyGoAgainResolved(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): void {
  runtime.events.queueTriggeredEvent(state, "go-again-resolved", seat);
}
