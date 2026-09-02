import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { GameMessage } from "@fyendal/shared";
import { dataOf, scriptOf } from "./cardProperties.js";
import {
  logCardValue,
  logPublic,
  nameOf,
  triggerLogMessage,
} from "./gameLog.js";
import type { ScriptCtx, TriggerEvent, TriggerEventContext } from "./scripts.js";
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
    const announcements: { group?: string; text: string; message?: GameMessage }[] = [];
    const sources = eventTriggerSources(state, player);
    if (
      event !== "card-played" && eventCard?.owner === seat &&
      !sources.some((source) => source.card.instanceId === eventCard.instanceId)
    ) {
      sources.push({ card: eventCard, physicalZone: "self", active: false });
    }
    for (const source of sources) {
      const { card } = source;
      if (maxSourceId !== undefined && card.instanceId >= maxSourceId) continue;
      scriptOf(state, card.cardId, card)?.triggers?.forEach((trigger, triggerIndex) => {
        if (trigger.event !== event || !eventTriggerIsActive(source, trigger)) return;
        if ((trigger.whose ?? "subject") === "subject" && seat !== subject) return;
        const ctx = runtime.makeCtx(state, seat, card, currentLink(state));
        if (trigger.condition && !trigger.condition(ctx, eventCard, eventContext)) return;
        trigger.onTrigger?.(ctx, eventCard, eventContext);
        layers.push({
          sourceInstanceId: card.instanceId,
          seat,
          triggerIndex,
          triggerSource: runtime.commands.snapshotSerializable(card),
          ...(eventCard ? { triggerEventCard: runtime.commands.snapshotSerializable(eventCard) } : {}),
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
        });
      });
    }
    const groupedCounts = new Map<string, number>();
    for (const announcement of announcements) {
      if (announcement.group) {
        groupedCounts.set(
          announcement.group,
          (groupedCounts.get(announcement.group) ?? 0) + 1,
        );
      }
    }
    const announcedGroups = new Set<string>();
    const announce = (announcement: (typeof announcements)[number], occurrences: number): void => {
      const fallback = `${announcement.text}${occurrences > 1 ? ` ×${occurrences}` : ""}`;
      if (!announcement.message) {
        logPublic(state, fallback);
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
        announce(announcement, 1);
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

/** Notify active friendly permanents after another permanent has entered. */
export function fireFriendlyEnterArena(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  entered: CardInstance,
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
    { causedBySeat: seat, to: "arena" },
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

/** Fire onFriendlyCrank after a player removes a steam counter for Crank. */
export function fireOnFriendlyCrank(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  cranked: CardInstance,
): void {
  for (const source of hookSources(state, seat, {
    board: true,
    equipment: true,
    weapons: true,
    heroLast: true,
  })) {
    scriptOf(state, source.cardId, source)?.onFriendlyCrank?.(
      runtime.makeCtx(state, seat, source, currentLink(state)),
      cranked,
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
  const destroyedName = destroyedData.name.trim().toLowerCase().replace(/\s+/g, " ");
  (state.players[seat] as PlayerState).flags[`destroyedName:${destroyedName}`] = true;
  (state.players[seat] as PlayerState).flags[`destroyedNameCount:${destroyedName}`] =
    Number((state.players[seat] as PlayerState).flags[`destroyedNameCount:${destroyedName}`] ?? 0) + 1;
  for (const subtype of destroyedData.subtypes ?? []) {
    (state.players[seat] as PlayerState).flags[`destroyedSubtype:${subtype.toLowerCase()}`] = true;
  }
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

/** Notify the owner's hero and permanents that one of their cards was banished. */
export function fireCardBanished(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  card: CardInstance,
  from: string,
): void {
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
): void {
  const script = scriptOf(state, card.cardId, card);
  const fn = script?.[hook];
  if (
    card.instanceId === state.players[seat]?.hero.instanceId &&
    heroAbilitiesDisabled(state, seat)
  ) return;
  const ctx = runtime.makeCtx(state, seat, card, link, fromArsenal);
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

/** Notify sources that their controller gained go again from a resolving non-attack action. */
export function notifyPlayerGainedGoAgain(state: GameStateInternal,
  runtime: EngineRuntime, seat: number): void {
  const active = hookSources(state, seat, {
    board: true,
    equipment: true,
    weapons: true,
  });
  const sources = [...active, ...lingeringModifierSources(state, seat).filter(
    (candidate) => !active.some((source) => source.instanceId === candidate.instanceId),
  )];
  for (const source of sources) runtime.events.runHook(state, seat, source, "onGainGoAgain");
}
