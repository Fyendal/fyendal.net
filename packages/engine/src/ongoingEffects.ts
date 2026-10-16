import type { EffectLifetime, GameMessage, OngoingEffectView } from "@fyendal/shared";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, Modifier, PlayerState } from "./state.js";
import { dataOf } from "./cardProperties.js";
import { firstActionExtraCost } from "./ruleQueries.js";
import { findCardAnywhere } from "./zoneQueries.js";

/** Short human-readable summary of a lingering modifier's effect. */
function modifierEffectLabel(state: GameStateInternal, m: Modifier): string {
  const parts: string[] = [];
  if (m.ongoingLabel) parts.push(m.ongoingLabel);
  if (m.attack) parts.push(`${m.attack > 0 ? "+" : ""}${m.attack} attack`);
  if (m.piercing) parts.push(`piercing ${m.piercing}`);
  if (m.defense) parts.push(`${m.defense > 0 ? "+" : ""}${m.defense} defense`);
  if (m.attackCostReduction) {
    parts.push(`attack costs ${m.attackCostReduction} less`);
  }
  if (m.playCostReduction) parts.push(`play costs ${m.playCostReduction} less`);
  if (m.activationCostReduction) parts.push(`activation costs ${m.activationCostReduction} less`);
  if (m.minimumAttackBasePower !== undefined) {
    parts.push(`only attacks with base attack ${m.minimumAttackBasePower}+`);
  }
  if (m.grantKeyword) parts.push(m.grantKeyword.toLowerCase());
  if (m.goAgain) parts.push("go again");
  if (m.onHitGoAgain) parts.push("go again on hit");
  if (m.goAgainIfPlayedOrCreatedSubtype) {
    parts.push(`go again if a ${m.goAgainIfPlayedOrCreatedSubtype} was played or created`);
  }
  if (m.goAgainIfAttackPowerAtLeast !== undefined) {
    parts.push(`go again with ${m.goAgainIfAttackPowerAtLeast} or more attack`);
  }
  if (m.onHitGainLife) parts.push(`gain ${m.onHitGainLife} life on next hit`);
  if (m.onHitDraw) parts.push(`draw ${m.onHitDraw} on next hit`);
  if (m.onHitDestroyTopDeckCards) {
    const { count, minimumDamage } = m.onHitDestroyTopDeckCards;
    parts.push(`destroy the top ${count} deck cards after dealing ${minimumDamage}+ damage`);
  }
  if (m.goAgainIfDefendedByAttackAction) parts.push("go again if defended by an attack action");
  if (m.onDefendedDealDamage) {
    parts.push(`deal ${m.onDefendedDealDamage} damage when defended by 1 or more cards`);
  }
  if (m.onHitCreateToken) {
    const { count } = m.onHitCreateToken;
    parts.push(`create ${count} token${count === 1 ? "" : "s"} on hit`);
  }
  if (m.dominate) parts.push("dominate");
  if (m.intimidate) parts.push(m.intimidate > 1 ? `intimidate ${m.intimidate}` : "intimidate");
  if (m.maxNonBlockDefenders !== undefined) {
    parts.push(`max ${m.maxNonBlockDefenders} non-block defenders`);
  }
  if (m.preventNextDamagePool) {
    const chosenSource = m.appliesToInstanceId === undefined
      ? undefined
      : findCardAnywhere(state, m.appliesToInstanceId)?.card;
    parts.push(
      `prevent next ${m.preventNextDamagePool} damage` +
      (chosenSource ? ` from ${dataOf(state, chosenSource.cardId).name}` : ""),
    );
  }
  if (m.preventDamagePerEvent && m.preventDamageEventsRemaining) {
    parts.push(
      `prevent ${m.preventDamagePerEvent} damage from each of the next ` +
      `${m.preventDamageEventsRemaining} damage events`,
    );
  }
  if (m.preventNextDamageAmount) {
    const sourceType = m.appliesToDamageSourceType
      ? ` from a ${m.appliesToDamageSourceType} source`
      : "";
    const eventLimit = m.maxDamageEventAmount !== undefined
      ? ` when the event is ${m.maxDamageEventAmount} or less`
      : "";
    parts.push(`prevent next ${m.preventNextDamageAmount} damage${sourceType}${eventLimit}`);
  }
  if (m.preventNextDamageFromPitch !== undefined) {
    parts.push(`prevent the next damage event from a pitch ${m.preventNextDamageFromPitch} source`);
  }
  if (m.preventAllDamageFromSource) {
    const chosenSource = m.appliesToInstanceId === undefined
      ? undefined
      : findCardAnywhere(state, m.appliesToInstanceId)?.card;
    parts.push(
      `prevent all damage${chosenSource ? ` from ${dataOf(state, chosenSource.cardId).name}` : " from the chosen source"}`,
    );
  }
  if (m.discardDamagePreventionAmount && m.discardDamagePreventionCardType) {
    parts.push(
      `discard a ${m.discardDamagePreventionCardType} to prevent ` +
      `${m.discardDamagePreventionAmount} damage`,
    );
  }
  if (m.onPreventCreateToken) {
    parts.push(`create ${dataOf(state, m.onPreventCreateToken).name} when damage is prevented`);
  }
  if (m.suppressesHeroAbilities) parts.push("hero abilities disabled");
  if (m.suppressesHeroAbilitiesDuringActionPhase) {
    parts.push("hero abilities disabled during action phase");
  }
  return parts.join(", ") || "ongoing effect";
}

interface EffectDuration {
  lifetime: EffectLifetime;
  text: string;
  message: GameMessage;
}

const message = (id: string, values?: GameMessage["values"]): GameMessage => ({
  id,
  ...(values ? { values } : {}),
});

const duration = (
  lifetime: EffectLifetime,
  text: string,
  id: string,
  values?: GameMessage["values"],
): EffectDuration => ({ lifetime, text, message: message(id, values) });

const PITCH_NAMES: Record<number, string> = { 1: "red", 2: "yellow", 3: "blue" };

function nextPlayDuration(m: Modifier): EffectDuration {
  const color = m.appliesToPitch === undefined ? undefined : PITCH_NAMES[m.appliesToPitch];
  const qualifiers = [color, m.appliesToCardType].filter((value): value is string => value !== undefined);
  return duration(
    "once",
    qualifiers.length > 0 ? `next ${qualifiers.join(" ")} card` : "next matching play",
    "engine.effect.duration.next.play",
    { color: color ?? "any", cardType: m.appliesToCardType ?? "any" },
  );
}

function modifierDuration(state: GameStateInternal, m: Modifier): EffectDuration {
  if (m.suppressesHeroAbilitiesDuringActionPhase) {
    return m.seat === state.activePlayer && ["action", "layer", "reaction", "defend"].includes(state.phase)
      ? duration("turn", "this action phase", "engine.effect.duration.this.action.phase")
      : duration("later", "next action phase", "engine.effect.duration.next.action.phase");
  }
  if (m.scope === "next-attack") {
    return m.appliesToRuneGated
      ? duration("once", "next rune-gated attack", "engine.effect.duration.next.rune.gated.attack")
      : duration("once", "next attack", "engine.effect.duration.next.attack");
  }
  if (m.scope === "next-play") return nextPlayDuration(m);
  if (m.scope === "combat-chain") return duration("chain", "this combat chain", "engine.effect.duration.this.combat.chain");
  if (
    m.expiresAtEndOfSeatTurn !== undefined &&
    !(m.expiresAtEndOfSeatTurn === state.activePlayer && Number(m.createdTurn ?? -1) < state.turn)
  ) {
    return duration("later", "next turn", "engine.effect.duration.next.turn");
  }
  return duration("turn", "this turn", "engine.effect.duration.this.turn");
}

/** Delayed triggers fire at a turn boundary of their subject. Recurring ones
 * never leave the schedule, so they are rest-of-game effects. */
function delayedTriggerDuration(trigger: GameStateInternal["delayedTriggers"][number]): EffectDuration {
  if (trigger.recurring) {
    return trigger.event === "end-of-turn"
      ? duration("game", "each of their end phases", "engine.effect.duration.each.end.phase")
      : duration("game", "the start of each of their turns", "engine.effect.duration.each.turn.start");
  }
  return trigger.event === "end-of-turn"
    ? duration("turn", "end of this turn", "engine.effect.duration.end.of.turn")
    : duration("later", "start of their next turn", "engine.effect.duration.start.of.next.turn");
}

interface ProjectedEffect {
  seat: number;
  cardId: string;
  sourceHidden?: true;
  sourceSeat?: number;
  summary: string;
  summaryMessage?: GameMessage;
  duration: EffectDuration;
  recurring?: true;
}

function effectView(effect: ProjectedEffect): OngoingEffectView {
  return {
    seat: effect.seat,
    cardId: effect.cardId,
    ...(effect.sourceHidden ? { sourceHidden: true as const } : {}),
    label: `${effect.summary} · ${effect.duration.text}`,
    ...(effect.sourceSeat !== undefined ? { sourceSeat: effect.sourceSeat } : {}),
    summary: effect.summary,
    ...(effect.summaryMessage ? { summaryMessage: effect.summaryMessage } : {}),
    lifetime: effect.duration.lifetime,
    duration: effect.duration.text,
    durationMessage: effect.duration.message,
    ...(effect.recurring ? { recurring: true as const } : {}),
  };
}

/** Lingering (invisible) effects worth surfacing on the mat, grouped by source
 *  card. The source's identity follows the usual face-down secrecy rules. */
export function projectOngoingEffects(
  state: GameStateInternal,
  viewer: number | null | undefined,
): OngoingEffectView[] {
  const byKey = new Map<string, ProjectedEffect>();
  const add = (key: string, effect: ProjectedEffect): void => {
    const entry = byKey.get(key);
    if (entry) {
      entry.summary += `, ${effect.summary}`;
      // A merged summary no longer matches either semantic message.
      delete entry.summaryMessage;
    } else {
      byKey.set(key, effect);
    }
  };
  const sourceIdentity = (card: CardInstance): Pick<ProjectedEffect, "cardId" | "sourceHidden"> =>
    viewer !== undefined && card.faceDown && card.owner !== viewer
      ? { cardId: "", sourceHidden: true }
      : { cardId: card.cardId };

  for (const m of state.modifiers) {
    if (m.consumed) continue;
    const surfacedCombatChainCost = m.scope === "combat-chain" &&
      (m.playCostReduction !== undefined || m.activationCostReduction !== undefined);
    if (!surfacedCombatChainCost &&
      m.scope !== "next-attack" && m.scope !== "next-play" && m.scope !== "until-end-of-turn") continue;
    const src = findCardAnywhere(state, m.sourceInstanceId);
    add(`${m.sourceInstanceId}:${m.seat}:${m.scope}`, {
      seat: m.seat,
      ...(src ? { ...sourceIdentity(src.card), sourceSeat: src.seat } : { cardId: m.sourceCardId ?? "" }),
      summary: modifierEffectLabel(state, m),
      duration: modifierDuration(state, m),
    });
  }

  state.delayedTriggers.forEach((trigger, index) => {
    add(`delayed:${index}`, {
      seat: trigger.subjectSeat,
      ...sourceIdentity(trigger.source),
      sourceSeat: trigger.seat,
      summary: trigger.label,
      ...(trigger.labelMessage ? { summaryMessage: trigger.labelMessage } : {}),
      duration: delayedTriggerDuration(trigger),
      ...(trigger.recurring ? { recurring: true as const } : {}),
    });
  });

  // Some effects are rules state on the affected hero (counters and flags)
  // rather than modifiers: delayed Crush restrictions, permanent ability loss,
  // prevention and amp pools. Surface them on that hero without a source card,
  // attributed to the seat that caused them, so an opponent's restriction is
  // not shown as the hero's own buff. The counters remain the rules authority
  // and control the lifetime; this projection adds no new mutable state.
  for (const player of state.players as PlayerState[]) {
    const counters = player.hero.counters;
    const heroKey = `hero:${player.hero.instanceId}`;
    const opponentSeat = 1 - player.seat;
    const addHeroEffect = (
      key: string,
      summary: string,
      summaryMessage: GameMessage,
      effectDuration: EffectDuration,
      sourceSeat: number,
    ): void =>
      add(`${heroKey}:${key}`, {
        seat: player.seat,
        cardId: "",
        sourceSeat,
        summary,
        summaryMessage,
        duration: effectDuration,
      });
    const addArcaneBonusPool = (
      flagKey: string,
      sourcePrefix: string,
      effectKey: string,
      effectDuration: EffectDuration,
    ): void => {
      let untrackedArcaneBonus = Number(player.flags[flagKey] ?? 0);
      if (untrackedArcaneBonus <= 0) return;
      for (const [key, value] of Object.entries(player.flags)) {
        if (!key.startsWith(sourcePrefix) || typeof value !== "number" || value <= 0) continue;
        const amount = Math.min(value, untrackedArcaneBonus);
        if (amount <= 0) continue;
        const sourceInstanceId = Number(key.slice(sourcePrefix.length));
        const source = Number.isSafeInteger(sourceInstanceId)
          ? findCardAnywhere(state, sourceInstanceId)
          : undefined;
        add(`${effectKey}:${sourceInstanceId}:${player.seat}`, {
          seat: player.seat,
          ...(source ? sourceIdentity(source.card) : { cardId: "" }),
          sourceSeat: player.seat,
          summary: `amp ${amount}`,
          summaryMessage: message("engine.effect.summary.amp", { amount }),
          duration: effectDuration,
        });
        untrackedArcaneBonus -= amount;
      }
      if (untrackedArcaneBonus > 0) {
        addHeroEffect(
          effectKey,
          `amp ${untrackedArcaneBonus}`,
          message("engine.effect.summary.amp", { amount: untrackedArcaneBonus }),
          effectDuration,
          player.seat,
        );
      }
    };
    addArcaneBonusPool(
      "nextArcaneBonus",
      "nextArcaneBonusSource:",
      "next-arcane-bonus",
      duration("once", "next arcane damage event", "engine.effect.duration.next.arcane.damage"),
    );
    addArcaneBonusPool(
      "nextArcaneCardBonus",
      "nextArcaneCardBonusSource:",
      "next-arcane-card-bonus",
      duration("once", "next arcane damage card", "engine.effect.duration.next.arcane.card"),
    );
    if (counters?.abilitiesDisabledPermanently === 1) {
      addHeroEffect(
        "abilities-lost",
        "hero loses all abilities",
        message("engine.effect.summary.loses.all.abilities"),
        duration("game", "rest of the game", "engine.effect.duration.rest.of.game"),
        opponentSeat,
      );
    }
    if (Number(counters?.halveBaseAttackActionUntil ?? 0) >= state.turn) {
      addHeroEffect(
        "halve-base",
        "attack action base attack and defense are halved",
        message("engine.effect.summary.halve.base"),
        duration("later", "through next turn", "engine.effect.duration.through.next.turn"),
        opponentSeat,
      );
    }
    if (Number(counters?.attackActionBasePowerLimitUntilTurn ?? 0) >= state.turn) {
      const limit = Number(counters?.attackActionBasePowerLimit ?? 0);
      addHeroEffect(
        "base-power-limit",
        `can't play attack actions with base attack ${limit} or less`,
        message("engine.effect.summary.base.power.limit", { limit }),
        duration("later", "next action phase", "engine.effect.duration.next.action.phase"),
        opponentSeat,
      );
    }
    if (Number(counters?.attackActionNoPowerGainUntilTurn ?? 0) >= state.turn) {
      addHeroEffect(
        "no-power-gain",
        "attack action cards can't gain attack",
        message("engine.effect.summary.no.power.gain"),
        duration("later", "next action phase", "engine.effect.duration.next.action.phase"),
        opponentSeat,
      );
    }
    if (Number(counters?.cannotDrawActionTurn ?? 0) >= state.turn) {
      addHeroEffect(
        "cannot-draw",
        "can't draw cards",
        message("engine.effect.summary.cannot.draw"),
        duration("later", "next action phase", "engine.effect.duration.next.action.phase"),
        opponentSeat,
      );
    }
    const nextActionExtraCost = firstActionExtraCost(state, player);
    if (nextActionExtraCost > 0) {
      addHeroEffect(
        "next-action-cost",
        `next action costs +${nextActionExtraCost} resource`,
        message("engine.effect.summary.next.action.cost", { amount: nextActionExtraCost }),
        duration("once", "next action", "engine.effect.duration.next.action"),
        opponentSeat,
      );
    }
    const trackedGenericPrevention = state.modifiers.reduce(
      (total, modifier) => total + (
        !modifier.consumed &&
        modifier.seat === player.seat &&
        modifier.scope === "until-end-of-turn" &&
        modifier.appliesToInstanceId === undefined
          ? Number(modifier.preventNextDamagePool ?? 0)
          : 0
      ),
      0,
    );
    const untrackedGenericPrevention = Math.max(
      0,
      Number(player.flags.preventNextDamage ?? 0) - trackedGenericPrevention,
    );
    const thisTurn = duration("turn", "this turn", "engine.effect.duration.this.turn");
    if (untrackedGenericPrevention > 0) {
      addHeroEffect(
        "prevent-next-damage",
        `prevent next ${untrackedGenericPrevention} damage`,
        message("engine.effect.summary.prevent.damage", { amount: untrackedGenericPrevention }),
        thisTurn,
        player.seat,
      );
    }
    const arcanePrevention = Number(player.flags.preventNextArcaneDamage ?? 0);
    if (arcanePrevention > 0) {
      addHeroEffect(
        "prevent-next-arcane",
        `prevent next ${arcanePrevention} arcane damage`,
        message("engine.effect.summary.prevent.arcane", { amount: arcanePrevention }),
        thisTurn,
        player.seat,
      );
    }
    const physicalPrevention = Number(player.flags.preventNextPhysicalDamage ?? 0);
    if (physicalPrevention > 0) {
      addHeroEffect(
        "prevent-next-physical",
        `prevent next ${physicalPrevention} physical damage`,
        message("engine.effect.summary.prevent.physical", { amount: physicalPrevention }),
        thisTurn,
        player.seat,
      );
    }
  }

  // Backward-compatible projection for source-filtered prevention created by
  // older persisted states, before source-aware modifier records were added.
  const seenSources = new Set<number>();
  const sourceCards = [
    ...state.players.flatMap((player) => [
      player.hero,
      ...player.hand,
      ...player.deck,
      ...player.arsenal,
      ...player.pitch,
      ...player.graveyard,
      ...player.banish,
      ...player.soul,
      ...(player.inventory ?? []),
      ...player.board,
      ...player.weapons,
      ...Object.values(player.equipment).filter((card): card is CardInstance => card !== undefined),
    ]),
    ...state.chain.flatMap((link) => [
      link.attackingCard,
      ...link.defendingCards,
      ...link.defendingEquipment,
      ...link.reactions,
    ]),
    ...state.resolving,
    ...state.stack.flatMap((layer) => [layer.card, layer.abilityCard].filter(
      (card): card is CardInstance => card !== undefined,
    )),
  ];
  for (const source of sourceCards) {
    if (seenSources.has(source.instanceId)) continue;
    seenSources.add(source.instanceId);
    const prevention = source.damagePrevented;
    if (!prevention || prevention.amount <= 0) continue;
    const tracked = state.modifiers.some((modifier) =>
      !modifier.consumed &&
      modifier.seat === prevention.targetSeat &&
      modifier.appliesToInstanceId === source.instanceId &&
      Number(modifier.preventNextDamagePool ?? 0) > 0
    );
    if (tracked) continue;
    add(
      `legacy-source-prevention:${source.instanceId}:${prevention.targetSeat}`,
      {
        seat: prevention.targetSeat,
        cardId: "",
        sourceSeat: prevention.targetSeat,
        summary: `prevent next ${prevention.amount} damage from ${dataOf(state, source.cardId).name}`,
        summaryMessage: message("engine.effect.summary.prevent.damage.from", {
          amount: prevention.amount,
          source: { kind: "card", cardId: source.cardId },
        }),
        duration: duration("turn", "this turn", "engine.effect.duration.this.turn"),
      },
    );
  }
  return [...byKey.values()].map(effectView);
}
