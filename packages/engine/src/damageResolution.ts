import type { EngineRuntime } from "./runtimePorts.js";
import { cardAbilitiesSuppressed, cardColorOf, cardTypesOf, dataOf, instanceDataOf, scriptOf, wardValueOf } from "./cardProperties.js";

import { controlledPermanents, hookSources, lingeringModifierSources } from "./sourceQueries.js";

import { logPublic, nameOf } from "./gameLog.js";
import type { GameStateInternal } from "./runtimeState.js";

import type { CardInstance, Modifier, PendingArcane, PlayerState, StackLayer } from "./state.js";
import { recordEffectThreat, recordHeroDamage } from "./stats.js";
import { tokenCreationCauseForModifier } from "./tokenQueries.js";
import { createTokenFor, createTokensFor } from "./tokens.js";
import { destroyPermanent, moveToGraveyard } from "./zoneMoves.js";
import { currentLink, findCardAnywhere, findPermanent, removeFromArray } from "./zoneQueries.js";
import { drawCards } from "./cardLifecycle.js";
import { notePitch, payFromPools, pitchIntoPool, pitchProhibitedByEffect, pitchValueOfInstance } from "./resources.js";
import { removeMarkOnOpponentHit, snapshotSerializable } from "./ruleQueries.js";

/** Locate a card instance anywhere in the game (zones, permanents, chain, resolving). */
/** Reduce source-aware lingering-effect records alongside their authoritative
 * prevention pool. Older persisted states may have a pool without records. */
function consumeTrackedPrevention(
  state: GameStateInternal,
  targetSeat: number,
  amount: number,
  damageSourceInstanceId?: number,
): Modifier[] {
  const contributors: Modifier[] = [];
  let remaining = amount;
  for (const modifier of state.modifiers) {
    if (remaining <= 0) break;
    const tracked = Number(modifier.preventNextDamagePool ?? 0);
    if (
      modifier.consumed ||
      modifier.scope !== "until-end-of-turn" ||
      modifier.seat !== targetSeat ||
      tracked <= 0 ||
      modifier.appliesToInstanceId !== damageSourceInstanceId
    ) continue;
    const consumed = Math.min(tracked, remaining);
    modifier.preventNextDamagePool = tracked - consumed;
    remaining -= consumed;
    contributors.push(modifier);
    if (modifier.preventNextDamagePool <= 0) modifier.consumed = true;
  }
  return contributors;
}

/** Resolve rewards belonging to the individual prevention effects that
 * contributed to this damage event. A reward may ride the shield modifier or
 * a companion modifier created by the same source card. A shield may retain
 * prevention after its one-shot reward has resolved. */
function applyTrackedPreventionRewards(
  state: GameStateInternal,
  runtime: EngineRuntime,
  target: PlayerState,
  contributors: Modifier[],
): void {
  for (const contributor of contributors) {
    const reward = contributor.onPreventCreateToken
      ? contributor
      : state.modifiers.find((modifier) =>
          !modifier.consumed &&
          modifier.scope === "until-end-of-turn" &&
          modifier.seat === target.seat &&
          modifier.sourceInstanceId === contributor.sourceInstanceId &&
          modifier.onPreventCreateToken !== undefined
        );
    const tokenId = reward?.onPreventCreateToken;
    if (!tokenId) continue;
    delete reward.onPreventCreateToken;
    if (reward !== contributor) reward.consumed = true;
    createTokenFor(
      state,
      runtime,
      target,
      tokenId,
      tokenCreationCauseForModifier(state, reward),
    );
  }
}

/** Find a duration-based prevention effect that shields every object from
 * damage dealt by one chosen source (CR 6.4.10e). */
function sourceWidePrevention(
  state: GameStateInternal,
  source: CardInstance | undefined,
  preventable: boolean,
): Modifier | undefined {
  if (!source || !preventable) return undefined;
  return state.modifiers.find((candidate) =>
    !candidate.consumed &&
    candidate.scope === "until-end-of-turn" &&
    candidate.appliesToInstanceId === source.instanceId &&
    candidate.preventAllDamageFromSource === true
  );
}

function finishSourceWidePrevention(
  state: GameStateInternal,
  runtime: EngineRuntime,
  source: CardInstance | undefined,
  modifier: Modifier | undefined,
  prevented: number,
): void {
  if (!source || !modifier || prevented <= 0) return;
  const banishType = modifier.banishPreventedDamageSourceFaceDownIfType?.toLowerCase();
  if (banishType && cardTypesOf(state, source).includes(banishType)) {
    modifier.consumed = true;
    runtime.makeCtx(state, source.owner, source).banish(source.instanceId, { faceDown: true });
  }
}

/** Soak damage through prevention: the source's `damagePrevented` shield
 *  (Oasis Respite — scoped to the source object and its target hero), static
 *  source-bound replacements, then typed and generic shielding-prevention
 *  flags on the target. Returns the damage that gets through. Static
 *  replacements are still applied when damage can't be prevented so their
 *  additional modifications happen, but other shields remain untouched. */
function applyPreventionShields(
  state: GameStateInternal,
  runtime: EngineRuntime,
  target: PlayerState,
  amount: number,
  source?: CardInstance,
  opts?: { preventable?: boolean; arcane?: boolean },
): number {
  const sourceWide = sourceWidePrevention(state, source, opts?.preventable !== false);
  let remaining = sourceWide ? 0 : amount;
  if (sourceWide && source) {
    logPublic(state, `${nameOf(state, source.cardId)}'s ${amount} damage is prevented`);
  }
  const eventAmount = amount;
  const preventable = opts?.preventable !== false;
  const sh = preventable ? source?.damagePrevented : undefined;
  if (source && sh && sh.amount > 0 && sh.targetSeat === target.seat && remaining > 0) {
    const prevented = Math.min(sh.amount, remaining);
    remaining -= prevented;
    sh.amount -= prevented;
    const contributors = consumeTrackedPrevention(
      state,
      target.seat,
      prevented,
      source.instanceId,
    );
    applyTrackedPreventionRewards(state, runtime, target, contributors);
    if (sh.amount <= 0) delete source.damagePrevented;
    logPublic(
      state,
      `${nameOf(state, source.cardId)}'s damage to ${nameOf(state, target.heroCardId)} is prevented (${prevented})`,
    );
  }
  for (const preventionSource of controlledPermanents(state, target.seat, {
    faceDownEquipment: false,
  })) {
    if (remaining <= 0) break;
    const replacement = scriptOf(
      state,
      preventionSource.cardId,
      preventionSource,
    )?.fixedDamagePrevention;
    if (!replacement || replacement.amount <= 0) continue;
    if (
      replacement.oncePerTurn &&
      Number(preventionSource.counters?.fixedPreventionUsedTurn ?? -1) === state.turn
    ) continue;
    const prevented = preventable
      ? Math.min(replacement.amount, remaining)
      : 0;
    if (replacement.destroySource) {
      destroyPermanent(state, runtime, target.seat, preventionSource);
    } else if (replacement.banishSource) {
      runtime.makeCtx(state, target.seat, preventionSource).banish(preventionSource.instanceId);
    }
    if (prevented > 0) {
      if (replacement.oncePerTurn) {
        (preventionSource.counters ??= {}).fixedPreventionUsedTurn = state.turn;
      }
      remaining -= prevented;
      logPublic(
        state,
        `${nameOf(state, target.heroCardId)} prevents ${prevented} damage`,
      );
    }
  }
  if (preventable && remaining > 0) remaining = applyPitchSourcePrevention(state, target, remaining, source);
  if (preventable && remaining > 0) {
    const repeating = state.modifiers.find(
      (modifier) =>
        modifier.scope === "until-end-of-turn" &&
        modifier.seat === target.seat &&
        !modifier.consumed &&
        Number(modifier.preventDamagePerEvent || 0) > 0 &&
        Number(modifier.preventDamageEventsRemaining || 0) > 0,
    );
    if (repeating) {
      const prevented = Math.min(Number(repeating.preventDamagePerEvent), remaining);
      remaining -= prevented;
      repeating.preventDamageEventsRemaining =
        Number(repeating.preventDamageEventsRemaining) - 1;
      if (Number(repeating.preventDamageEventsRemaining) <= 0) repeating.consumed = true;
      logPublic(state, `${nameOf(state, target.heroCardId)} prevents ${prevented} damage`);
    }
  }
  if (preventable && remaining > 0) {
    for (const modifier of state.modifiers) {
      const requiredSourceType = modifier.appliesToDamageSourceType?.toLowerCase();
      const sourceTypes = source
        ? [
            ...(dataOf(state, source.cardId).classes ?? []),
            ...(dataOf(state, source.cardId).subtypes ?? []),
            ...(source.grantedTypes ?? []),
          ].map((type) => type.toLowerCase())
        : [];
      if (
        modifier.consumed ||
        modifier.seat !== target.seat ||
        modifier.scope !== "until-end-of-turn" ||
        !modifier.preventNextDamageAmount ||
        (modifier.maxDamageEventAmount !== undefined && eventAmount > modifier.maxDamageEventAmount) ||
        (modifier.appliesToInstanceId !== undefined && modifier.appliesToInstanceId !== source?.instanceId) ||
        (requiredSourceType !== undefined && !sourceTypes.includes(requiredSourceType))
      ) continue;
      const prevented = Math.min(modifier.preventNextDamageAmount, remaining);
      remaining -= prevented;
      modifier.consumed = true;
      if (prevented > 0) {
        logPublic(
          state,
          `${nameOf(state, target.heroCardId)} prevents ${prevented} damage`,
        );
        if (modifier.reflectPreventedDamageToSeat !== undefined) {
          const reflectionSource = modifier.sourceInstanceId === undefined
            ? undefined
            : findCardAnywhere(state, modifier.sourceInstanceId);
          dealEffectDamage(state, runtime, {
            sourceInstanceId: modifier.sourceInstanceId ?? target.hero.instanceId,
            sourceSeat: reflectionSource?.seat ?? target.seat,
            targetSeat: modifier.reflectPreventedDamageToSeat,
            amount: prevented,
            arcane: false,
            ...(modifier.reflectPreventedDamageUnpreventable ? { unpreventable: true } : {}),
          });
        }
      }
      break;
    }
  }
  const arcaneShield = preventable && opts?.arcane === true
    ? Number(target.flags.preventNextArcaneDamage) || 0
    : 0;
  if (arcaneShield > 0 && remaining > 0) {
    const prevented = Math.min(arcaneShield, remaining);
    remaining -= prevented;
    target.flags.preventNextArcaneDamage = arcaneShield - prevented;
    logPublic(
      state,
      `${nameOf(state, target.heroCardId)} prevents ${prevented} arcane damage`,
    );
  }
  const physicalShield = preventable && opts?.arcane !== true
    ? Number(target.flags.preventNextPhysicalDamage) || 0
    : 0;
  if (physicalShield > 0 && remaining > 0) {
    const prevented = Math.min(physicalShield, remaining);
    remaining -= prevented;
    // Fixed prevention modifies one matching event; unlike shielding
    // prevention, an unused remainder does not carry to another source.
    target.flags.preventNextPhysicalDamage = 0;
    logPublic(
      state,
      `${nameOf(state, target.heroCardId)} prevents ${prevented} physical damage`,
    );
  }
  const shield = preventable
    ? Number(target.flags.preventNextDamage) || 0
    : 0;
  if (shield > 0 && remaining > 0) {
    const prevented = Math.min(shield, remaining);
    remaining -= prevented;
    target.flags.preventNextDamage = shield - prevented;
    const contributors = consumeTrackedPrevention(state, target.seat, prevented);
    applyTrackedPreventionRewards(state, runtime, target, contributors);
    logPublic(state, `${nameOf(state, target.heroCardId)} prevents ${prevented} damage`);
  }
  if (
    opts?.arcane !== true && remaining < amount &&
    Number(target.flags.nextPhysicalPreventionReduction ?? 0) > 0
  ) {
    remaining = Math.min(amount, remaining + 1);
    target.flags.nextPhysicalPreventionReduction = 0;
    logPublic(state, "the prevention effect prevents 1 less physical damage");
  }
  finishSourceWidePrevention(state, runtime, source, sourceWide, amount - remaining);
  return remaining;
}

/** Apply a turn-long full-event prevention filtered by the damage source's
 * printed pitch. Kept separate because Ward destruction can create this
 * replacement during an already-open damage event (Essence of Ancestry). */
function applyPitchSourcePrevention(
  state: GameStateInternal,
  target: PlayerState,
  amount: number,
  source?: CardInstance,
): number {
  if (!source || amount <= 0) return amount;
  const modifier = state.modifiers.find((candidate) =>
    !candidate.consumed &&
    candidate.seat === target.seat &&
    candidate.scope === "until-end-of-turn" &&
    candidate.preventNextDamageFromPitch !== undefined &&
    cardColorOf(state, source) === candidate.preventNextDamageFromPitch,
  );
  if (!modifier) return amount;
  modifier.consumed = true;
  logPublic(state, `${nameOf(state, target.heroCardId)} prevents ${amount} damage`);
  return 0;
}

// ── effect damage (incl. arcane + Arcane Barrier) ──────────────────────────

/** Arcane Barrier N values of the player's live arena objects (each
 * all-or-nothing: pay exactly N to prevent exactly N, even when the damage is
 * less — 8.3.8). Includes temporary granted keywords; face-down objects are
 * non-functional. */
function arcaneBarrierPieces(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState): number[] {
  const out: number[] = [];
  for (const source of controlledPermanents(state, player.seat, { faceDownEquipment: false })) {
    if (source.faceDown || cardAbilitiesSuppressed(state, source)) continue;
    const suppressed = new Set((source.suppressedKeywords ?? []).map((kw) => kw.toLowerCase()));
    const keywords = [
      ...(dataOf(state, source.cardId).keywords ?? []),
      ...(source.grantedKeywords ?? []),
    ];
    for (const kw of keywords) {
      if (suppressed.has(kw.toLowerCase())) continue;
      const m = /^arcane barrier (\d+)$/i.exec(kw.trim());
      if (m) out.push(Number(m[1]));
    }
    const dynamic = Number(
      scriptOf(state, source.cardId, source)?.arcaneBarrierValue?.(
        runtime.makeCtx(state, player.seat, source, currentLink(state)),
      ) ?? 0,
    );
    if (dynamic > 0) out.push(dynamic);
  }
  return out;
}

function hasArcaneBarrierX(state: GameStateInternal, player: PlayerState): boolean {
  return controlledPermanents(state, player.seat, { faceDownEquipment: false }).some(
    (source) => !source.faceDown && scriptOf(state, source.cardId)?.arcaneBarrierX === true,
  );
}

/** Payable barrier totals: subset sums of the live barrier pieces the
 *  player can cover with floating resources plus chi plus pitchable hand cards. */
function arcaneBarrierOptions(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState, incoming: number): number[] {
  const pieces = arcaneBarrierPieces(state, runtime, player);
  const variable = hasArcaneBarrierX(state, player);
  if (pieces.length === 0 && !variable) return [];
  let payable = player.resources + player.chi;
  for (const c of player.hand) {
    if (!pitchProhibitedByEffect(state, player, c)) payable += pitchValueOfInstance(state, c);
  }
  const sums = new Set<number>();
  const rec = (i: number, sum: number) => {
    if (sum > payable || sums.size >= 8) return;
    if (i >= pieces.length) {
      if (sum > 0) sums.add(sum);
      return;
    }
    rec(i + 1, sum);
    rec(i + 1, sum + (pieces[i] as number));
  };
  rec(0, 0);
  if (variable) {
    for (let value = 1; value <= Math.min(payable, incoming); value++) sums.add(value);
  }
  return [...sums].sort((a, b) => a - b);
}

/** Record damage attributed to an effect's source. A non-ally source also
 * makes its controller/hero count as having dealt that damage (CR 8.5.3a),
 * while an ally source does not (CR 8.2.8e). Damage to an ally never counts
 * as damage dealt to its controller/hero (CR 8.2.8f). */
function noteEffectDamageDealer(
  state: GameStateInternal,
  packet: PendingArcane,
  source: ReturnType<typeof findCardAnywhere>,
  targetIsHero: boolean,
): void {
  if (packet.amount <= 0) return;
  if (effectSourceIsAlly(state, packet, source)) return;
  const dealer = state.players[packet.sourceSeat] as PlayerState;
  dealer.flags.dealtDamageThisTurn = true;
  if (!packet.arcane) {
    dealer.flags.physicalDamageDealtThisTurn = true;
    dealer.flags.physicalDamageAmountDealtThisTurn =
      (Number(dealer.flags.physicalDamageAmountDealtThisTurn) || 0) + packet.amount;
    return;
  }
  dealer.flags.arcaneDamageDealtThisTurn = true;
  dealer.flags[`arcaneDamageAmountToSeat:${packet.targetSeat}`] =
    (Number(dealer.flags[`arcaneDamageAmountToSeat:${packet.targetSeat}`]) || 0) + packet.amount;
  if (targetIsHero && packet.targetSeat !== packet.sourceSeat) {
    dealer.flags.arcaneDamageDealtToOpposingHeroThisTurn = true;
  }
}

function effectSourceIsAlly(
  state: GameStateInternal,
  packet: PendingArcane,
  source: ReturnType<typeof findCardAnywhere>,
): boolean {
  return packet.sourceIsAlly === true ||
    (!!source && (dataOf(state, source.card.cardId).subtypes ?? []).includes("ally"));
}

/** Complete a "source deals damage, then destroy it" effect. Permanents leave
 * the arena normally; attack action cards on an earlier chain link retain
 * last-known link information while the physical card goes to graveyard. */
function destroySourceAfterEffectDamage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
): void {
  if (!packet.destroySourceAfterDamage) return;
  const permanent = findPermanent(state, packet.sourceInstanceId);
  if (permanent) {
    destroyPermanent(state, runtime, packet.sourceSeat, permanent.card);
    return;
  }
  const link = state.chain.find((candidate) =>
    candidate.attacker === packet.sourceSeat &&
    candidate.attackCardType === "action" &&
    candidate.attackingCard.instanceId === packet.sourceInstanceId &&
    candidate.flags.attackGone !== true
  );
  if (!link) return;
  link.flags.attackGone = true;
  moveToGraveyard(state, runtime, link.attackingCard, "chain", packet.sourceSeat);
  logPublic(state, `${nameOf(state, link.attackingCard.cardId)} is destroyed`);
  runtime.events.runHook(state, link.attacker, link.attackingCard, "onDestroyed", link);
  runtime.events.fireFriendlyDestroyed(state, link.attacker, link.attackingCard, packet.sourceSeat);
}

/** Generate respondable triggered layers for an effect that explicitly says
 * its damage source has hit. A resolving card/ability remains at stack[0], so
 * generated triggers sit immediately below it; trigger hooks are removed from
 * the stack before they run, so their newly generated triggers go on top. */
function queueEffectHitTriggers(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
  hitSource: CardInstance,
): void {
  const layers: StackLayer[] = [];
  if (scriptOf(state, hitSource.cardId, hitSource)?.onEffectHit) {
    layers.push({
      sourceInstanceId: hitSource.instanceId,
      seat: packet.sourceSeat,
      triggerIndex: -8,
      label: "On hit",
      optional: false,
      engineEffect: {
        kind: "on-effect-hit-hook",
        source: snapshotSerializable(hitSource),
        targetSeat: packet.targetSeat,
      },
    });
    logPublic(state, `${nameOf(state, hitSource.cardId)} triggers: On hit`);
  }
  const active = hookSources(state, packet.sourceSeat, {
    board: true,
    equipment: true,
    weapons: true,
  });
  const observers = [...active, ...lingeringModifierSources(state, packet.sourceSeat).filter(
    (candidate) => !active.some((source) => source.instanceId === candidate.instanceId),
  )];
  for (const source of observers) {
    const observerScript = scriptOf(state, source.cardId, source);
    if (
      source.instanceId === hitSource.instanceId ||
      !observerScript?.onFriendlyEffectHit
    ) continue;
    const targetWasMarked = packet.targetWasMarked === true;
    if (observerScript.onFriendlyEffectHitCondition && !observerScript.onFriendlyEffectHitCondition(
      runtime.makeCtx(state, packet.sourceSeat, source, currentLink(state)),
      hitSource,
      packet.targetSeat,
      targetWasMarked,
    )) continue;
    layers.push({
      sourceInstanceId: source.instanceId,
      seat: packet.sourceSeat,
      triggerIndex: -9,
      label: "On friendly hit",
      optional: false,
      engineEffect: {
        kind: "on-friendly-effect-hit-hook",
        source: snapshotSerializable(source),
        hitSource: snapshotSerializable(hitSource),
        targetSeat: packet.targetSeat,
        targetWasMarked,
      },
    });
    logPublic(state, `${nameOf(state, source.cardId)} triggers: On friendly hit`);
  }
  if (layers.length === 0) return;
  const top = state.stack[0];
  const insertionIndex = top?.card || top?.ability ? 1 : 0;
  state.stack.splice(insertionIndex, 0, ...layers);
}

/** Apply the (fully prevented-or-not) damage: life, per-turn flags, log, and
 *  the source's onDamageDealt hook. */
function applyEffectDamage(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): void {
  const target = state.players[packet.targetSeat] as PlayerState;
  const found = findCardAnywhere(state, packet.sourceInstanceId);
  if (packet.amount > 0) {
    target.life -= packet.amount;
    target.flags.lostLifeThisTurn = true;
    noteEffectDamageDealer(state, packet, found, true);
    if (packet.targetSeat !== packet.sourceSeat && !effectSourceIsAlly(state, packet, found)) {
      recordHeroDamage(state, packet.sourceSeat, packet.amount);
    }
    target.flags.damageTakenThisTurn = true;
    if (packet.arcane) {
      target.flags.arcaneDamageTakenThisTurn = true;
    } else {
      target.flags.physicalDamageTakenThisTurn = true;
    }
  }
  logPublic(
    state,
    `${nameOf(state, target.heroCardId)} takes ${packet.amount} ${packet.arcane ? "arcane " : ""}damage (${target.life} life left)`,
  );
  if (packet.amount > 0 && packet.countsAsHit) {
    // A hit by any object during a chain link makes the active chain link
    // count as having hit. It does not make the active attack itself hit, so
    // only stamp the aggregate link result here; attack on-hit hooks remain
    // gated by combat damage in hits.ts.
    const link = currentLink(state);
    if (link) link.hit = true;
    packet.targetWasMarked = removeMarkOnOpponentHit(
      state,
      packet.sourceSeat,
      packet.targetSeat,
    );
  }
  if (packet.amount > 0) {
    runtime.events.fireHeroDealtDamage(state, packet.targetSeat, packet.amount, packet.arcane === true);
  }
  if (!found) {
    destroySourceAfterEffectDamage(state, runtime, packet);
    return;
  }
  if (packet.amount > 0 && !packet.arcane) {
    const link = currentLink(state);
    if (link) {
      for (const subtype of dataOf(state, found.card.cardId).subtypes ?? []) {
        const key = `effectDamageBySubtype:${subtype.toLowerCase()}`;
        link.flags[key] = Number(link.flags[key] ?? 0) + packet.amount;
      }
    }
  }
  scriptOf(state, found.card.cardId, found.card)?.onDamageDealt?.(
    runtime.makeCtx(state, found.seat, found.card, currentLink(state)),
    packet.targetSeat,
    packet.amount,
    packet.arcane === true,
  );
  if (packet.amount > 0) {
    scriptOf(state, found.card.cardId, found.card)?.onDealsDamage?.(
      runtime.makeCtx(state, found.seat, found.card, currentLink(state)),
      packet.targetSeat,
      packet.amount,
      packet.arcane === true,
    );
    const activeLink = currentLink(state);
    if (activeLink?.attackingCard.instanceId === packet.sourceInstanceId) {
      for (const modifier of state.modifiers) {
        const tokenId = modifier.onDamageDealtCreateTokenPerPoint;
        if (
          !tokenId ||
          modifier.scope !== "chain-link" ||
          modifier.seat !== packet.sourceSeat
        ) continue;
        createTokensFor(
          state, runtime,
          target,
          tokenId,
          packet.amount,
          tokenCreationCauseForModifier(state, modifier),
        );
      }
    }
  }
  if (packet.amount > 0) {
    const active = hookSources(state, packet.sourceSeat, {
      board: true,
      arsenal: true,
      equipment: true,
      weapons: true,
    });
    const sources = [...active, ...lingeringModifierSources(state, packet.sourceSeat).filter(
      (candidate) => !active.some((source) => source.instanceId === candidate.instanceId),
    )];
    for (const source of sources) {
      if (source.instanceId === found.card.instanceId) continue;
      scriptOf(state, source.cardId, source)?.onFriendlyDamageDealt?.(
        runtime.makeCtx(state, packet.sourceSeat, source, currentLink(state)),
        found.card,
        packet.targetSeat,
        packet.amount,
        packet.arcane === true,
      );
    }
  }
  if (packet.amount > 0 && packet.countsAsHit) {
    queueEffectHitTriggers(state, runtime, packet, found.card);
  }
  destroySourceAfterEffectDamage(state, runtime, packet);
}

/** Spellvoid N values of the player's equipped gear and arena permanents
 *  (8.3.15: "If you would be
 *  dealt arcane damage, you may destroy this to prevent N of that damage").
 *  Face-down (Cloaked) equipment's abilities are non-functional. Equipment
 *  whose value is not a fixed number ("Spellvoid X, where X is …") provides it
 *  via the spellvoidValue script hook. */
function spellvoidPieces(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState): { id: number; n: number }[] {
  const out: { id: number; n: number }[] = [];
  const sources = [
    ...Object.values(player.equipment).filter((card): card is CardInstance => card !== undefined),
    ...player.board,
  ];
  for (const eq of sources) {
    if (eq.faceDown || cardAbilitiesSuppressed(state, eq)) continue;
    let matched = false;
    for (const kw of dataOf(state, eq.cardId).keywords ?? []) {
      const m = /^spellvoid (\d+)$/i.exec(kw.trim());
      if (m) {
        out.push({ id: eq.instanceId, n: Number(m[1]) });
        matched = true;
      }
    }
    if (matched) continue;
    if (
      scriptOf(state, eq.cardId, eq)?.runechantToken === true &&
      [...controlledPermanents(state, player.seat, { faceDownEquipment: false }), ...lingeringModifierSources(state, player.seat)]
        .some((source) => scriptOf(state, source.cardId, source)?.grantsSpellvoidToRunechants === true)
    ) {
      out.push({ id: eq.instanceId, n: 1 });
      continue;
    }
    const dynamic = scriptOf(state, eq.cardId, eq)?.spellvoidValue;
    if (dynamic) {
      const n = dynamic(runtime.makeCtx(state, player.seat, eq));
      if (n > 0) out.push({ id: eq.instanceId, n });
    }
  }
  return out;
}

function quellPieces(
  state: GameStateInternal,
  player: PlayerState,
  packet: PendingArcane,
): { id: number; amount: number; cost: number }[] {
  const used = new Set(packet.usedQuellSourceIds ?? []);
  return controlledPermanents(state, player.seat, { faceDownEquipment: false })
    .flatMap((source) => {
      if (used.has(source.instanceId)) return [];
      const quell = scriptOf(state, source.cardId, source)?.quell;
      return quell && quell.amount > 0 && quell.cost >= 0
        ? [{ id: source.instanceId, amount: quell.amount, cost: quell.cost }]
        : [];
    });
}

function canPayResourceCost(state: GameStateInternal, player: PlayerState, cost: number): boolean {
  return player.resources + player.chi + player.hand.reduce(
    (sum, card) => sum + (pitchProhibitedByEffect(state, player, card) ? 0 : pitchValueOfInstance(state, card)),
    0,
  ) >= cost;
}

/** Open Quell inside the damage event. The player chooses a source (or
 * declines), then pays from pools and/or pitches before prevention occurs. */
function openQuellDecision(state: GameStateInternal, packet: PendingArcane): boolean {
  if (packet.amount <= 0 || packet.unpreventable) return false;
  const target = state.players[packet.targetSeat] as PlayerState;
  const pieces = quellPieces(state, target, packet).filter((piece) =>
    canPayResourceCost(state, target, piece.cost),
  );
  if (pieces.length === 0) return false;
  state.pendingDecision = {
    player: target.seat,
    kind: "optional-effect",
    prompt: `Quell: you would be dealt ${packet.amount} damage — pay to prevent some of it?`,
    promptMessage: {
      id: "engine.decision.damage.quell",
      values: { amount: packet.amount },
    },
    options: [...pieces.map((piece) => `use ${piece.id}`), "decline"],
    optionMessages: [...pieces.map(() => null), { id: "common.option.decline" }],
    cardOptions: [...pieces.map((piece) => piece.id as number | null), null],
    sourceInstanceId: packet.sourceInstanceId,
    chooseHook: "quell",
    arcane: packet,
  };
  return true;
}

function optionalDamagePreventionPieces(
  state: GameStateInternal,
  player: PlayerState,
  arcane: boolean,
): { id: number; amount: number; moveSource: "destroy" | "banish" }[] {
  return controlledPermanents(state, player.seat, { faceDownEquipment: false })
    .flatMap((source) => {
      const replacement = scriptOf(state, source.cardId, source)?.optionalDamagePrevention;
      return replacement && replacement.amount > 0 && (!replacement.arcaneOnly || arcane)
        ? [{ id: source.instanceId, amount: replacement.amount, moveSource: replacement.moveSource }]
        : [];
    });
}

function discardDamagePreventionPieces(
  state: GameStateInternal,
  player: PlayerState,
  packet: PendingArcane,
): Array<{ modifierId: number; amount: number; draw: number; cardType: string; cards: CardInstance[] }> {
  if (packet.sourceSeat === player.seat) return [];
  const used = new Set(packet.usedDiscardDamagePreventionModifierIds ?? []);
  return state.modifiers.flatMap((modifier) => {
    const cardType = modifier.discardDamagePreventionCardType;
    const amount = Number(modifier.discardDamagePreventionAmount ?? 0);
    if (
      modifier.seat !== player.seat ||
      modifier.scope !== "until-end-of-turn" ||
      modifier.consumed ||
      used.has(modifier.id) ||
      !cardType ||
      amount <= 0
    ) return [];
    const cards = player.hand.filter(
      (card) => instanceDataOf(state, card).cardType.toLowerCase() === cardType.toLowerCase(),
    );
    return cards.length > 0 ? [{
      modifierId: modifier.id,
      amount,
      draw: Math.max(0, Number(modifier.discardDamagePreventionDraw ?? 0)),
      cardType,
      cards,
    }] : [];
  });
}

/** Offer one repeatable discard-based prevention replacement. Each modifier
 * may apply once to a damage event but remains available for later events. */
function openDiscardDamagePrevention(
  state: GameStateInternal,
  packet: PendingArcane,
): boolean {
  if (packet.amount <= 0 || packet.unpreventable) return false;
  const target = state.players[packet.targetSeat] as PlayerState;
  const piece = discardDamagePreventionPieces(state, target, packet)[0];
  if (!piece) return false;
  state.pendingDecision = {
    player: target.seat,
    kind: "optional-effect",
    prompt: `You would be dealt ${packet.amount} damage — discard a ${piece.cardType} card to prevent ${piece.amount} and draw ${piece.draw}?`,
    promptMessage: {
      id: "engine.decision.damage.discardprevent",
      values: {
        damage: packet.amount,
        prevent: piece.amount,
        draw: piece.draw,
      },
    },
    options: [...piece.cards.map((card) => String(card.instanceId)), "decline"],
    optionMessages: [...piece.cards.map(() => null), { id: "common.option.decline" }],
    cardOptions: [...piece.cards.map((card) => card.instanceId as number | null), null],
    sourceInstanceId: packet.sourceInstanceId,
    chooseHook: "discard-damage-prevention",
    arcane: packet,
  };
  return true;
}

/** Offer optional self-moving prevention replacements before paid or mandatory
 * prevention. Declining skips the remaining optional replacements for this
 * event; applying one re-opens the choice if more remain. */
function openOptionalDamagePrevention(
  state: GameStateInternal,
  packet: PendingArcane,
): boolean {
  if (packet.amount <= 0 || packet.unpreventable) return false;
  const target = state.players[packet.targetSeat] as PlayerState;
  const pieces = optionalDamagePreventionPieces(state, target, packet.arcane);
  if (pieces.length === 0) return false;
  state.pendingDecision = {
    player: target.seat,
    kind: "optional-effect",
    prompt: `You would be dealt ${packet.amount} damage — use a prevention effect?`,
    promptMessage: {
      id: "engine.decision.damage.prevent",
      values: { amount: packet.amount },
    },
    options: [...pieces.map((piece) => `use ${piece.id}`), "decline"],
    optionMessages: [...pieces.map(() => null), { id: "common.option.decline" }],
    cardOptions: [...pieces.map((piece) => piece.id as number | null), null],
    sourceInstanceId: packet.sourceInstanceId,
    chooseHook: "optional-damage-prevention",
    arcane: packet,
  };
  return true;
}

/** Offer one mandatory soul-banish prevention replacement. The affected
 * player chooses the exact soul card; each source can replace an original
 * damage event only once. */
function openSoulDamagePrevention(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
): boolean {
  if (packet.amount <= 0 || packet.unpreventable) return false;
  const target = state.players[packet.targetSeat] as PlayerState;
  const used = new Set(packet.usedSoulDamagePreventionSourceIds ?? []);
  const sources = controlledPermanents(state, target.seat, { faceDownEquipment: false });
  for (const source of sources) {
    const amount = Number(scriptOf(state, source.cardId, source)?.banishSoulToPreventDamage ?? 0);
    if (amount <= 0 || used.has(source.instanceId)) continue;
    if (target.soul.length === 0) {
      destroyPermanent(state, runtime, target.seat, source);
      continue;
    }
    packet.soulDamagePreventionSourceInstanceId = source.instanceId;
    state.pendingDecision = {
      player: target.seat,
      kind: "choose-target",
      prompt: `You would be dealt ${packet.amount} damage — choose a soul card to banish and prevent ${amount}`,
      promptMessage: {
        id: "engine.decision.damage.soulprevent",
        values: { damage: packet.amount, prevent: amount },
      },
      options: target.soul.map((card) => String(card.instanceId)),
      cardOptions: target.soul.map((card) => card.instanceId),
      sourceInstanceId: packet.sourceInstanceId,
      chooseHook: "soul-damage-prevention",
      arcane: packet,
    };
    return true;
  }
  return false;
}

/** Ward N sources of the player (8.3.20: "If you would be dealt damage,
 *  destroy this to prevent N of that damage") — equipment AND board permanents
 *  (ward auras like Spectral Shield). Face-down (Cloaked) equipment's Ward is
 *  non-functional. */
export function wardPieces(state: GameStateInternal,
  runtime: EngineRuntime, player: PlayerState): { id: number; n: number }[] {
  const out: { id: number; n: number }[] = [];
  const sources: CardInstance[] = [
    ...(Object.values(player.equipment).filter((c): c is CardInstance => !!c && !c.faceDown)),
    ...player.board,
  ];
  for (const c of sources) {
    if (cardAbilitiesSuppressed(state, c)) continue;
    const dynamic = scriptOf(state, c.cardId, c)?.wardValue;
    const n = dynamic
      ? Math.max(0, dynamic(runtime.makeCtx(state, player.seat, c, currentLink(state))))
      : wardValueOf(dataOf(state, c.cardId));
    if (n !== undefined && n > 0) out.push({ id: c.instanceId, n });
  }
  return out;
}

/** Open the target's Ward decision for a packet. Ward is NOT optional (CR
 *  8.3.20): the target must destroy ward sources one at a time — their only
 *  choice is which source to destroy first — until the damage is prevented or
 *  no sources remain. Options are tagged with the card so clients render card
 *  images, not raw "destroy <instanceId>" strings. Returns false when there is
 *  nothing to prevent with. The packet stays parked until the decision is
 *  answered (see continueAfterWard). */
function openWardDecision(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): boolean {
  const target = state.players[packet.targetSeat] as PlayerState;
  const pieces = wardPieces(state, runtime, target);
  if (packet.amount <= 0 || pieces.length === 0) return false;
  state.pendingDecision = {
    player: packet.targetSeat,
    kind: "choose-target",
    prompt: packet.unpreventable
      ? `Ward: you would be dealt ${packet.amount} damage that can't be prevented — Ward is still destroyed`
      : `Ward: you would be dealt ${packet.amount} damage — destroy a card with Ward to prevent some of it`,
    promptMessage: {
      id: packet.unpreventable
        ? "engine.decision.damage.ward.unpreventable"
        : "engine.decision.damage.ward",
      values: { amount: packet.amount },
    },
    options: pieces.map((p) => `destroy ${p.id}`),
    cardOptions: pieces.map((p) => p.id),
    sourceInstanceId: packet.sourceInstanceId,
    chooseHook: "ward",
    arcane: packet,
  };
  return true;
}

/** Open the target's Arcane Barrier decision for a packet; returns false when
 *  no payment is possible and the damage was applied immediately. */
function tryOpenBarrierDecision(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): boolean {
  if (packet.arcaneBarrierResolved) return false;
  const target = state.players[packet.targetSeat] as PlayerState;
  const options = arcaneBarrierOptions(state, runtime, target, packet.amount);
  if (options.length === 0) {
    packet.arcaneBarrierResolved = true;
    return false;
  }
  state.pendingDecision = {
    player: packet.targetSeat,
    kind: "choose-target",
    prompt: packet.unpreventable
      ? "Warning: this damage cannot be prevented."
      : `Arcane Barrier: you would be dealt ${packet.amount} arcane damage — pay {r} to prevent that much?`,
    promptMessage: packet.unpreventable
      ? { id: "engine.decision.damage.unpreventable" }
      : {
          id: "engine.decision.damage.arcane.barrier",
          values: { amount: packet.amount },
        },
    // "pay N" (not bare numbers) so option ids can never collide with card
    // instance ids in other choice prompts
    options: ["pay 0", ...options.map((n) => `pay ${n}`)],
    optionMessages: [0, ...options].map((amount) => ({
      id: "common.option.pay",
      values: { amount },
    })),
    sourceInstanceId: packet.sourceInstanceId,
    chooseHook: "arcane-barrier",
    arcane: packet,
  };
  return true;
}

/** Open the arcane-damage prevention decisions for a packet: Spellvoid first
 *  (destroy an equipment to prevent N — optional, "you may destroy"), then
 *  Arcane Barrier. Returns false when neither applies and the damage should be
 *  applied immediately. */
function openArcaneDecision(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): boolean {
  const target = state.players[packet.targetSeat] as PlayerState;
  const pieces = spellvoidPieces(state, runtime, target);
  if (packet.amount > 0 && pieces.length > 0) {
    state.pendingDecision = {
      player: packet.targetSeat,
      kind: "choose-target",
      prompt: `Spellvoid: you would be dealt ${packet.amount} arcane damage — destroy an equipment with Spellvoid to prevent some of it?`,
      promptMessage: {
        id: "engine.decision.damage.spellvoid",
        values: { amount: packet.amount },
      },
      options: [...pieces.map((p) => `destroy ${p.id}`), "decline"],
      optionMessages: [...pieces.map(() => null), { id: "common.option.decline" }],
      cardOptions: [...pieces.map((p) => p.id as number | null), null],
      sourceInstanceId: packet.sourceInstanceId,
      chooseHook: "spellvoid",
      arcane: packet,
    };
    return true;
  }
  return tryOpenBarrierDecision(state, runtime, packet);
}

/** Process queued arcane packets one at a time (a new prevention decision pauses the rest). */
function drainDamageQueue(state: GameStateInternal,
  runtime: EngineRuntime, packets: PendingArcane[]): void {
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i] as PendingArcane;
    beginHeroDamage(state, runtime, packet);
    if (state.pendingDecision?.arcane) {
      packet.queue = packets.slice(i + 1);
      return;
    }
  }
}

function lethalDamagePreventionCards(
  state: GameStateInternal,
  player: PlayerState,
  cardName: string,
): CardInstance[] {
  const normalized = cardName.trim().toLowerCase();
  return [...player.hand, ...player.arsenal].filter(
    (card) => dataOf(state, card.cardId).name.trim().toLowerCase() === normalized,
  );
}

/** Offer a one-shot optional replacement for the final damage event. Effects
 * which made the event nonlethal stay ready for a later event; the first
 * lethal event consumes the replacement whether its controller applies it or
 * declines it. */
function openLethalDamagePrevention(
  state: GameStateInternal,
  packet: PendingArcane,
): boolean {
  const target = state.players[packet.targetSeat] as PlayerState;
  if (packet.amount <= 0 || packet.amount < target.life) return false;
  for (const modifier of state.modifiers) {
    const cardName = modifier.preventLethalDamageByBanishingNamedCard;
    if (
      modifier.seat !== target.seat ||
      modifier.scope !== "until-end-of-turn" ||
      modifier.consumed ||
      !cardName
    ) continue;
    const cards = lethalDamagePreventionCards(state, target, cardName);
    if (cards.length === 0) {
      modifier.consumed = true;
      continue;
    }
    packet.lethalDamagePreventionModifierId = modifier.id;
    state.pendingDecision = {
      player: target.seat,
      kind: "optional-effect",
      prompt: `You would be dealt ${packet.amount} lethal damage — banish ${cardName} from hand or arsenal to prevent it?`,
      promptMessage: {
        id: "engine.decision.damage.lethalprevent",
        values: { amount: packet.amount, card: cardName },
      },
      options: [...cards.map((card) => String(card.instanceId)), "decline"],
      optionMessages: [...cards.map(() => null), { id: "common.option.decline" }],
      cardOptions: [...cards.map((card) => card.instanceId as number | null), null],
      sourceInstanceId: packet.sourceInstanceId,
      chooseHook: "lethal-damage-prevention",
      arcane: packet,
    };
    return true;
  }
  return false;
}

/** Apply a damage packet only after every earlier replacement and prevention
 * has established whether its remaining amount is lethal. */
function finishHeroDamage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
): number {
  if (openLethalDamagePrevention(state, packet)) return 0;
  if (packet.combat) {
    runtime.dispatchFlow("resumeCombatDamage", state, packet);
    return packet.amount;
  }
  applyEffectDamage(state, runtime, packet);
  drainDamageQueue(state, runtime, packet.queue ?? []);
  return packet.amount;
}

/** After a Spellvoid answer: continue the packet through any remaining
 *  prevention decisions (Spellvoid again after a destroy, Arcane Barrier
 *  unless declined into it), then apply and drain the queue. */
function continueArcaneDamage(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
  allowSpellvoid: boolean,
): void {
  if (packet.amount > 0) {
    const opened = allowSpellvoid
      ? openArcaneDecision(state, runtime, packet)
      : tryOpenBarrierDecision(state, runtime, packet);
    if (opened) return;
  }
  finishHeroDamage(state, runtime, packet);
}

/** After a Ward answer: Ward is mandatory — re-offer it while damage and
 *  sources remain (one source destroyed at a time, the player only picks the
 *  order), then continue the packet — combat damage resumes the paused
 *  chain-link resolution; arcane damage falls through to the remaining
 *  Spellvoid / Arcane Barrier decisions; anything else applies. */
function continueAfterWard(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): void {
  if (!packet.unpreventable && packet.amount > 0) {
    const target = state.players[packet.targetSeat] as PlayerState;
    const source = findCardAnywhere(state, packet.sourceInstanceId)?.card;
    packet.amount = applyPitchSourcePrevention(state, target, packet.amount, source);
  }
  if (packet.amount > 0 && openWardDecision(state, runtime, packet)) return;
  if (packet.amount > 0 && packet.arcane) {
    if (openArcaneDecision(state, runtime, packet)) return;
  }
  finishHeroDamage(state, runtime, packet);
}

/**
 * Deal effect damage to an ally permanent (CR 8.2.8): the damage reduces the
 * ally's life and destroys it at 0 (firing onDestroyed / "ally-died" exactly
 * like combat damage to an ally, via destroyPermanent). Hero-side defenses
 * never apply to allies — no prevention shields, no Ward, no Arcane Barrier
 * or Spellvoid, even for arcane damage. The ally's controller is not considered
 * to have been dealt damage, but a non-ally source's controller is still
 * considered to have dealt it. Returns the damage dealt (0 when the target is
 * not a living ally).
 */
export function dealAllyDamage(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): number {
  const src = findCardAnywhere(state, packet.sourceInstanceId);
  const found = findPermanent(state, packet.targetAllyId as number);
  const ally = found?.card;
  if (
    !found ||
    !ally ||
    !(dataOf(state, ally.cardId).subtypes ?? []).includes("ally") ||
    ally.life === undefined
  ) {
    logPublic(state, `${src ? nameOf(state, src.card.cardId) : "The source"} finds no target (the ally is gone)`);
    return 0;
  }
  applyBoundArcaneCardBonus(state, packet);
  applyArcaneAmp(state, packet);
  packet.amount += effectDamageBonus(state, packet);
  const sourceWide = sourceWidePrevention(state, src?.card, packet.unpreventable !== true);
  if (sourceWide && src) {
    const prevented = packet.amount;
    packet.amount = 0;
    logPublic(state, `${nameOf(state, src.card.cardId)}'s ${prevented} damage is prevented`);
    finishSourceWidePrevention(state, runtime, src.card, sourceWide, prevented);
  }
  if (packet.amount <= 0) return 0;
  if (!packet.unpreventable && packet.amount > 0) {
    const recipientTypes = [
      ...(dataOf(state, ally.cardId).classes ?? []),
      ...(dataOf(state, ally.cardId).subtypes ?? []),
      ...(ally.grantedTypes ?? []),
    ].map((type) => type.toLowerCase());
    const shield = state.modifiers.find((modifier) =>
      !modifier.consumed &&
      modifier.seat === found.seat &&
      modifier.scope === "until-end-of-turn" &&
      Number(modifier.preventNextDamageAmount ?? 0) > 0 &&
      modifier.appliesToDamageRecipientType !== undefined &&
      recipientTypes.includes(modifier.appliesToDamageRecipientType.toLowerCase())
    );
    if (shield) {
      const prevented = Math.min(Number(shield.preventNextDamageAmount), packet.amount);
      packet.amount -= prevented;
      shield.consumed = true;
      logPublic(state, `${nameOf(state, ally.cardId)} prevents ${prevented} damage`);
    }
  }
  const replacement = scriptOf(state, ally.cardId, ally)?.replaceDamageToSelf?.(
    runtime.makeCtx(state, found.seat, ally, currentLink(state)),
    packet.amount,
    packet.arcane,
  );
  const dealt = Math.max(0, replacement ?? packet.amount);
  packet.amount = dealt;
  ally.life -= dealt;
  if (!packet.combat) noteEffectDamageDealer(state, packet, src, false);
  logPublic(
    state,
    packet.combat && src
      ? `${nameOf(state, src.card.cardId)} hits ${nameOf(state, ally.cardId)} for ${dealt} (${Math.max(0, ally.life)} life left)`
      : `${nameOf(state, ally.cardId)} takes ${dealt} ${packet.arcane ? "arcane " : ""}damage (${Math.max(0, ally.life)} life left)`,
  );
  if (dealt > 0) {
    scriptOf(state, ally.cardId, ally)?.onDealtDamage?.(
      runtime.makeCtx(state, found.seat, ally, currentLink(state)),
      dealt,
      packet.arcane,
    );
  }
  // the source's onDamageDealt hook still fires — the target seat is the
  // ally's controller (who is NOT considered to have been dealt damage)
  if (src && dealt > 0) {
    scriptOf(state, src.card.cardId, src.card)?.onDamageDealt?.(
      runtime.makeCtx(state, src.seat, src.card, currentLink(state)),
      found.seat,
      dealt,
      packet.arcane === true,
    );
    scriptOf(state, src.card.cardId, src.card)?.onDealsDamage?.(
      runtime.makeCtx(state, src.seat, src.card, currentLink(state)),
      found.seat,
      dealt,
      packet.arcane === true,
    );
  }
  if (ally.life <= 0 && findPermanent(state, ally.instanceId)) {
    destroyPermanent(state, runtime, found.seat, ally);
  }
  return dealt;
}

/** Replacement bonuses such as "a matching action card would deal that much
 * plus 1." These are applied before prevention and only when the source would
 * already deal a positive amount. */
export function effectDamageBonus(state: GameStateInternal, packet: PendingArcane): number {
  if (packet.amount <= 0) return 0;
  const source = findCardAnywhere(state, packet.sourceInstanceId)?.card;
  if (!source) return 0;
  const data = dataOf(state, source.cardId);
  const tags = new Set(
    [...(data.classes ?? []), ...(data.subtypes ?? []), ...(source.grantedTypes ?? [])]
      .map((tag) => tag.toLowerCase()),
  );
  return state.modifiers.reduce((sum, mod) => {
    if (
      !mod.damage ||
      mod.consumed ||
      mod.seat !== packet.sourceSeat ||
      !["chain-link", "combat-chain", "until-end-of-turn", "static"].includes(mod.scope)
    ) return sum;
    if (mod.appliesTo === "weapon" || mod.appliesTo === "sword") return sum;
    if (
      mod.appliesTo === "attack" &&
      data.cardType !== "weapon" &&
      (data.cardType !== "action" || !(data.subtypes ?? []).includes("attack"))
    ) return sum;
    if (
      mod.appliesTo === "attack-action" &&
      (data.cardType !== "action" || !(data.subtypes ?? []).includes("attack"))
    ) return sum;
    if (mod.appliesToCardType && data.cardType !== mod.appliesToCardType) return sum;
    if (mod.appliesToPitch !== undefined && cardColorOf(state, source) !== mod.appliesToPitch) return sum;
    if (mod.appliesToClass && !tags.has(mod.appliesToClass.toLowerCase())) return sum;
    if (mod.appliesToSubtype) {
      const wanted = Array.isArray(mod.appliesToSubtype) ? mod.appliesToSubtype : [mod.appliesToSubtype];
      if (!wanted.some((tag) => tags.has(tag.toLowerCase()))) return sum;
    }
    if (mod.appliesToType && !mod.appliesToType.some((tag) => tags.has(tag.toLowerCase()))) {
      return sum;
    }
    return sum + mod.damage;
  }, 0);
}

export function boundArcaneCardBonus(state: GameStateInternal, packet: PendingArcane): number {
  if (!packet.arcane || packet.amount <= 0) return 0;
  return Math.max(
    0,
    Number(findCardAnywhere(state, packet.sourceInstanceId)?.card.counters?.arcaneBonus ?? 0),
  );
}

/** Apply the legacy bonus bound to the next arcane-damage card when it was
 * played. Keeping this in the engine makes direct ScriptCtx damage calls and
 * shared card helpers use the same first positive event. */
function applyBoundArcaneCardBonus(state: GameStateInternal, packet: PendingArcane): void {
  const bonus = boundArcaneCardBonus(state, packet);
  if (bonus <= 0) return;
  const source = findCardAnywhere(state, packet.sourceInstanceId)?.card;
  if (!source) return;

  const base = packet.amount;
  packet.amount += bonus;
  (source.counters ??= {}).arcaneBonus = 0;
  logPublic(state, `${nameOf(state, source.cardId)} deals ${base} + ${bonus} arcane damage`);
}

/** Amp replaces the next positive arcane-damage event its controller would
 * generate, regardless of whether that event comes from a played card, an
 * activated ability, or a triggered ability. Apply it before prevention and
 * consume the complete accumulated Amp pool for that event. */
function applyArcaneAmp(state: GameStateInternal, packet: PendingArcane): void {
  if (!packet.arcane || packet.amount <= 0) return;
  const player = state.players[packet.sourceSeat] as PlayerState;
  const bonus = Math.max(0, Number(player.flags.nextArcaneBonus ?? 0));
  if (bonus <= 0) return;

  packet.amount += bonus;
  player.flags.nextArcaneBonus = 0;
  for (const key of Object.keys(player.flags)) {
    if (key.startsWith("nextArcaneBonusSource:")) delete player.flags[key];
  }
}

/** Apply the first matching one-shot hero-damage redirection before any of the
 * destination hero's prevention replacements are considered. */
function applyHeroDamageRedirect(
  state: GameStateInternal,
  packet: PendingArcane,
): void {
  if (packet.amount <= 0 || packet.targetAllyId !== undefined) return;
  const replacement = state.modifiers.find((modifier) =>
    modifier.scope === "until-end-of-turn" &&
    !modifier.consumed &&
    modifier.redirectDamageFromSeat === packet.targetSeat &&
    modifier.redirectDamageToSeat !== undefined,
  );
  if (!replacement) return;
  const original = packet.targetSeat;
  packet.targetSeat = replacement.redirectDamageToSeat as number;
  const prevented = Math.min(Math.max(0, replacement.redirectDamagePrevent ?? 0), packet.amount);
  packet.amount -= prevented;
  replacement.consumed = true;
  logPublic(
    state,
    `${nameOf(state, (state.players[original] as PlayerState).heroCardId)}'s damage is redirected to ${nameOf(state, (state.players[packet.targetSeat] as PlayerState).heroCardId)}${prevented > 0 ? ` and ${prevented} is prevented` : ""}`,
  );
}

/**
 * Deal effect damage. A prevention shield ("the next time you would be dealt
 *  damage this turn, prevent N") soaks first. Arcane Barrier is offered before
 *  Ward so its controller can choose to pay before Ward's mandatory
 *  destroy-to-prevent replacement applies; choosing pay 0 declines Arcane
 *  Barrier for this event. Ward applies to any remaining damage (combat damage
 *  opens the same decision from resolveLink), then Spellvoid is offered. The damage is deferred until it is
 *  answered (or queued behind an already-open prevention decision), and the
 *  result reaches scripts via onDamageDealt. Ally targets bypass all of that
 *  (see dealAllyDamage). Returns the damage dealt
 *  immediately (0 when deferred).
 */
function continueHeroDamageAfterQuell(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
): number {
  const target = state.players[packet.targetSeat] as PlayerState;
  const source = findCardAnywhere(state, packet.sourceInstanceId)?.card;
  packet.amount = applyPreventionShields(state, runtime, target, packet.amount, source, {
    arcane: packet.arcane,
    preventable: !packet.unpreventable,
  });
  if (packet.amount > 0 && packet.arcane && tryOpenBarrierDecision(state, runtime, packet)) return 0;
  if (packet.amount > 0 && openWardDecision(state, runtime, packet)) return 0;
  if (packet.amount > 0 && packet.arcane && openArcaneDecision(state, runtime, packet)) return 0;
  return finishHeroDamage(state, runtime, packet);
}

function continueAfterPaidQuell(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): void {
  if (packet.amount > 0 && openQuellDecision(state, packet)) return;
  continueHeroDamageAfterQuell(state, runtime, packet);
}

function continueAfterOptionalDamagePrevention(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
  offerAnother: boolean,
): void {
  if (offerAnother && openOptionalDamagePrevention(state, packet)) return;
  if (openQuellDecision(state, packet)) return;
  continueHeroDamageAfterQuell(state, runtime, packet);
}

function continueAfterSoulDamagePrevention(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
): void {
  if (openSoulDamagePrevention(state, runtime, packet)) return;
  if (openDiscardDamagePrevention(state, packet)) return;
  if (openOptionalDamagePrevention(state, packet)) return;
  if (openQuellDecision(state, packet)) return;
  continueHeroDamageAfterQuell(state, runtime, packet);
}

function continueAfterDiscardDamagePrevention(
  state: GameStateInternal,
  runtime: EngineRuntime,
  packet: PendingArcane,
  offerAnother: boolean,
): void {
  if (offerAnother && openDiscardDamagePrevention(state, packet)) return;
  if (openOptionalDamagePrevention(state, packet)) return;
  if (openQuellDecision(state, packet)) return;
  continueHeroDamageAfterQuell(state, runtime, packet);
}

/** Run a hero damage packet through redirection and the target hero's complete
 * prevention sequence. Combat packets resume and finish their paused link. */
export function beginHeroDamage(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): number {
  const open = state.pendingDecision;
  if (open?.arcane && ["combat-damage-equipment-replacement", "lethal-damage-prevention", "soul-damage-prevention", "discard-damage-prevention", "optional-damage-prevention", "quell", "quell-pitch", "ward", "spellvoid", "arcane-barrier", "arcane-barrier-pitch"].includes(open.chooseHook ?? "")) {
    (open.arcane.queue ??= []).push(packet);
    return 0;
  }
  const replacementIds = packet.combatDamageEquipmentReplacementIds ?? [];
  if (replacementIds.length > 0) {
    state.pendingDecision = {
      player: packet.sourceSeat,
      kind: "optional-effect",
      prompt: "Replace combat damage by destroying defending equipment?",
      promptMessage: { id: "engine.decision.damage.combatequipment" },
      options: ["no", ...replacementIds.map(String)],
      optionMessages: [{ id: "common.option.no" }, ...replacementIds.map(() => null)],
      cardOptions: [null, ...replacementIds],
      sourceInstanceId: packet.sourceInstanceId,
      chooseHook: "combat-damage-equipment-replacement",
      arcane: packet,
    };
    return 0;
  }
  applyHeroDamageRedirect(state, packet);
  const target = state.players[packet.targetSeat] as PlayerState;
  if (!packet.unpreventable && packet.amount > 0) {
    for (const source of controlledPermanents(state, target.seat, { faceDownEquipment: false })) {
      const replace = scriptOf(state, source.cardId, source)?.replaceDamageToController;
      if (!replace || packet.amount <= 0) continue;
      packet.amount = Math.max(0, Math.min(
        packet.amount,
        Math.floor(replace(runtime.makeCtx(state, target.seat, source, currentLink(state)), packet.amount, packet.arcane)),
      ));
    }
  }
  if (!packet.combat && packet.arcane && packet.amount > 0) {
    const source = findCardAnywhere(state, packet.sourceInstanceId);
    if (source) {
      logPublic(
        state,
        `${nameOf(state, source.card.cardId)} would deal ${packet.amount} arcane damage to ${nameOf(state, target.heroCardId)}`,
      );
    }
  }
  if (packet.arcane && packet.amount > 0) {
    const permanentSources = controlledPermanents(state, target.seat, { faceDownEquipment: false });
    const permanentPrevention = permanentSources
      .reduce((sum, source) => sum + Number(scriptOf(state, source.cardId, source)?.preventArcaneDamage || 0), 0);
    const link = currentLink(state);
    const transient = [
      ...state.resolving.filter((card) => card.owner === target.seat),
      ...(link?.attackingCard.owner === target.seat ? [link.attackingCard] : []),
      ...(link?.defendingCards.filter((card) => card.owner === target.seat) ?? []),
    ];
    const seen = new Set<number>();
    const activePrevention = transient.reduce((sum, source) => {
      if (seen.has(source.instanceId)) return sum;
      seen.add(source.instanceId);
      return sum + Number(
        scriptOf(state, source.cardId, source)?.preventArcaneDamageWhileActive || 0,
      );
    }, 0);
    const fixed = permanentPrevention + activePrevention;
    if (fixed > 0) {
      const prevented = packet.unpreventable ? 0 : Math.min(fixed, packet.amount);
      packet.amount -= prevented;
      if (prevented > 0) {
        logPublic(state, `${nameOf(state, target.heroCardId)} prevents ${prevented} arcane damage`);
      }
      let observed = prevented;
      for (const source of permanentSources) {
        const contribution = Math.min(observed, Number(scriptOf(state, source.cardId, source)?.preventArcaneDamage || 0));
        if (contribution <= 0) continue;
        observed -= contribution;
        scriptOf(state, source.cardId, source)?.onPreventsDamage?.(
          runtime.makeCtx(state, target.seat, source, currentLink(state)), contribution, true,
        );
      }
    }
  }
  if (openSoulDamagePrevention(state, runtime, packet)) return 0;
  if (openDiscardDamagePrevention(state, packet)) return 0;
  if (openOptionalDamagePrevention(state, packet)) return 0;
  if (openQuellDecision(state, packet)) return 0;
  return continueHeroDamageAfterQuell(state, runtime, packet);
}

export function dealEffectDamage(state: GameStateInternal,
  runtime: EngineRuntime, packet: PendingArcane): number {
  if (packet.targetAllyId !== undefined) return dealAllyDamage(state, runtime, packet);
  applyBoundArcaneCardBonus(state, packet);
  applyArcaneAmp(state, packet);
  packet.amount += effectDamageBonus(state, packet);
  const sourceLocation = findCardAnywhere(state, packet.sourceInstanceId);
  if (
    packet.targetSeat !== packet.sourceSeat &&
    !effectSourceIsAlly(state, packet, sourceLocation)
  ) {
    recordEffectThreat(state, packet.sourceSeat, packet.amount);
  }
  return beginHeroDamage(state, runtime, packet);
}

/** Apply a resolved packet (payment chosen), then drain any queued packets. */
function finishArcanePacket(state: GameStateInternal,
  runtime: EngineRuntime, arc: PendingArcane, paid: number): void {
  arc.arcaneBarrierResolved = true;
  const prevented = arc.unpreventable ? 0 : Math.min(paid, arc.amount);
  if (prevented > 0) {
    arc.amount -= prevented;
    logPublic(
      state,
      `${nameOf(state, (state.players[arc.targetSeat] as PlayerState).heroCardId)} prevents ${prevented} arcane damage (Arcane Barrier)`,
    );
  }
  if (paid > 0 && arc.unpreventable) {
    logPublic(
      state,
      `${nameOf(state, (state.players[arc.targetSeat] as PlayerState).heroCardId)}'s Arcane Barrier can't prevent this damage`,
    );
  }
  if (arc.amount > 0 && openWardDecision(state, runtime, arc)) return;
  continueArcaneDamage(state, runtime, arc, true);
}

function pitchableHandOptions(state: GameStateInternal, player: PlayerState): string[] {
  return player.hand
    .filter((c) => pitchValueOfInstance(state, c) > 0 && !pitchProhibitedByEffect(state, player, c))
    .map((c) => String(c.instanceId));
}

/**
 * Answer an Arcane Barrier decision (chooseHook "arcane-barrier": the chosen
 * total; "arcane-barrier-pitch": one pitch card at a time until the total is
 * covered). The pending decision is cleared on completion; a chained pitch
 * decision replaces it otherwise (the caller's resume transfers to it).
 */
export function answerArcaneBarrier(
  state: GameStateInternal,
  runtime: EngineRuntime,
  seat: number,
  optionId: string,
): string | undefined {
  const pd = state.pendingDecision;
  const arc = pd?.arcane;
  if (!pd || !arc || pd.player !== seat) return "not your decision";
  const player = state.players[seat] as PlayerState;
  if (pd.chooseHook === "combat-damage-equipment-replacement") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    const eligibleIds = arc.combatDamageEquipmentReplacementIds ?? [];
    if (optionId !== "no") {
      const equipmentId = Number(optionId);
      if (!eligibleIds.includes(equipmentId)) return "equipment is not eligible for the replacement";
      const link = currentLink(state);
      const defending = link?.defendingEquipment.find((card) => card.instanceId === equipmentId);
      const live = findCardAnywhere(state, equipmentId)?.card;
      if (!link || !defending || !live) return "equipment is not eligible for the replacement";
      state.pendingDecision = null;
      delete arc.combatDamageEquipmentReplacementIds;
      destroyPermanent(state, runtime, live.owner, live);
      link.flags[`equipmentGone:${equipmentId}`] = true;
      logPublic(
        state,
        `${nameOf(state, link.attackingCard.cardId)}'s damage is replaced by destroying ${nameOf(state, defending.cardId)}`,
      );
      arc.amount = 0;
      runtime.dispatchFlow("resumeCombatDamage", state, arc);
      return undefined;
    }
    state.pendingDecision = null;
    delete arc.combatDamageEquipmentReplacementIds;
    beginHeroDamage(state, runtime, arc);
    return undefined;
  }
  if (pd.chooseHook === "lethal-damage-prevention") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    const modifierId = arc.lethalDamagePreventionModifierId;
    const modifier = state.modifiers.find((candidate) =>
      candidate.id === modifierId &&
      candidate.seat === seat &&
      candidate.consumed !== true &&
      candidate.preventLethalDamageByBanishingNamedCard !== undefined
    );
    if (!modifier) return "lethal prevention effect not found";
    const cardName = modifier.preventLethalDamageByBanishingNamedCard as string;
    modifier.consumed = true;
    delete arc.lethalDamagePreventionModifierId;
    state.pendingDecision = null;
    if (optionId !== "decline") {
      const card = lethalDamagePreventionCards(state, player, cardName)
        .find((candidate) => candidate.instanceId === Number(optionId));
      if (!card) return "lethal prevention card not found";
      if (!runtime.commands.banishCard(state, card.instanceId, seat, false)) {
        return "lethal prevention card could not be banished";
      }
      const prevented = arc.unpreventable ? 0 : arc.amount;
      arc.amount -= prevented;
      logPublic(state, `${nameOf(state, player.heroCardId)} prevents ${prevented} lethal damage`);
    }
    finishHeroDamage(state, runtime, arc);
    return undefined;
  }
  if (pd.chooseHook === "discard-damage-prevention") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    if (optionId === "decline") {
      state.pendingDecision = null;
      continueAfterDiscardDamagePrevention(state, runtime, arc, false);
      return undefined;
    }
    const cardId = Number(optionId);
    const piece = discardDamagePreventionPieces(state, player, arc)[0];
    const card = piece?.cards.find((candidate) => candidate.instanceId === cardId);
    if (!piece || !card) return "discard prevention card not found";
    removeFromArray(player.hand, card.instanceId);
    runtime.commands.discardToGraveyard(state, seat, card, false, seat);
    runtime.commands.fireOnDiscard(state, seat, card, false);
    const prevented = Math.min(piece.amount, arc.amount);
    arc.amount -= prevented;
    (arc.usedDiscardDamagePreventionModifierIds ??= []).push(piece.modifierId);
    logPublic(state, `${nameOf(state, player.heroCardId)} prevents ${prevented} damage`);
    if (piece.draw > 0) {
      drawCards(state, runtime, player, piece.draw);
      logPublic(state, `${nameOf(state, player.heroCardId)} draws ${piece.draw} card(s)`);
    }
    state.pendingDecision = null;
    continueAfterDiscardDamagePrevention(state, runtime, arc, true);
    return undefined;
  }
  if (pd.chooseHook === "soul-damage-prevention") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    const sourceId = arc.soulDamagePreventionSourceInstanceId;
    const source = sourceId === undefined
      ? undefined
      : controlledPermanents(state, seat, { faceDownEquipment: false })
        .find((candidate) => candidate.instanceId === sourceId);
    const soulCard = player.soul.find((candidate) => candidate.instanceId === Number(optionId));
    const amount = source
      ? Number(scriptOf(state, source.cardId, source)?.banishSoulToPreventDamage ?? 0)
      : 0;
    if (!source || amount <= 0) return "prevention source not found";
    if (!soulCard) return "soul card not found";
    state.pendingDecision = null;
    runtime.makeCtx(state, seat, source).banish(soulCard.instanceId);
    const prevented = Math.min(amount, arc.amount);
    arc.amount -= prevented;
    (arc.usedSoulDamagePreventionSourceIds ??= []).push(source.instanceId);
    delete arc.soulDamagePreventionSourceInstanceId;
    logPublic(state, `${nameOf(state, player.heroCardId)} prevents ${prevented} damage`);
    if (player.soul.length === 0) {
      const live = findPermanent(state, source.instanceId)?.card;
      if (live) destroyPermanent(state, runtime, seat, live);
    }
    continueAfterSoulDamagePrevention(state, runtime, arc);
    return undefined;
  }
  if (pd.chooseHook === "optional-damage-prevention") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    if (optionId === "decline") {
      state.pendingDecision = null;
      continueAfterOptionalDamagePrevention(state, runtime, arc, false);
      return undefined;
    }
    const id = Number(optionId.slice("use ".length));
    const piece = optionalDamagePreventionPieces(state, player, arc.arcane)
      .find((candidate) => candidate.id === id);
    if (!piece) return "prevention source not found";
    const source = controlledPermanents(state, seat, { faceDownEquipment: false })
      .find((candidate) => candidate.instanceId === id);
    if (!source) return "prevention source not found";
    state.pendingDecision = null;
    if (piece.moveSource === "destroy") destroyPermanent(state, runtime, seat, source);
    else runtime.makeCtx(state, seat, source).banish(source.instanceId);
    const prevented = Math.min(piece.amount, arc.amount);
    arc.amount -= prevented;
    logPublic(
      state,
      `${nameOf(state, player.heroCardId)} prevents ${prevented} damage`,
    );
    continueAfterOptionalDamagePrevention(state, runtime, arc, true);
    return undefined;
  }
  if (pd.chooseHook === "quell") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    if (optionId === "decline") {
      state.pendingDecision = null;
      continueHeroDamageAfterQuell(state, runtime, arc);
      return undefined;
    }
    const id = Number(optionId.slice("use ".length));
    const piece = quellPieces(state, player, arc).find((candidate) => candidate.id === id);
    if (!piece) return "Quell source not found";
    arc.quellSourceInstanceId = id;
    arc.payTotal = piece.cost;
    if (piece.cost > player.resources + player.chi) {
      const options = pitchableHandOptions(state, player);
      if (options.length === 0) return "cannot pay for Quell";
      state.pendingDecision = {
        ...pd,
        prompt: `Pitch cards to pay ${piece.cost} for Quell`,
        promptMessage: {
          id: "engine.decision.damage.quellpay",
          values: { cost: piece.cost },
        },
        options,
        cardOptions: options.map(Number),
        chooseHook: "quell-pitch",
        resume: undefined,
      };
      return undefined;
    }
    payFromPools(player, piece.cost);
    state.pendingDecision = null;
    const prevented = Math.min(piece.amount, arc.amount);
    arc.amount -= prevented;
    (arc.usedQuellSourceIds ??= []).push(id);
    if (!state.pendingDestructions.some((entry) => entry.instanceId === id)) {
      state.pendingDestructions.push({ seat, instanceId: id });
    }
    delete arc.payTotal;
    delete arc.quellSourceInstanceId;
    logPublic(state, `${nameOf(state, player.heroCardId)} pays ${piece.cost} to prevent ${prevented} damage (Quell ${piece.amount})`);
    continueAfterPaidQuell(state, runtime, arc);
    return undefined;
  }
  if (pd.chooseHook === "quell-pitch") {
    const id = Number(optionId);
    const card = player.hand.find((candidate) => candidate.instanceId === id);
    if (!card) return "card not in hand";
    const pitch = pitchValueOfInstance(state, card);
    if (pitch <= 0) return `${nameOf(state, card.cardId)} has no pitch value`;
    if (pitchProhibitedByEffect(state, player, card)) return "that card cannot be pitched this turn";
    removeFromArray(player.hand, id);
    player.pitch.push(card);
    notePitch(state, player, card);
    pitchIntoPool(state, runtime, player, card, pitch);
    const total = arc.payTotal ?? 0;
    if (total > player.resources + player.chi) {
      const options = pitchableHandOptions(state, player);
      if (options.length === 0) return "cannot cover the remaining Quell cost";
      state.pendingDecision = {
        ...pd,
        options,
        cardOptions: options.map(Number),
        resume: undefined,
      };
      return undefined;
    }
    const sourceId = arc.quellSourceInstanceId;
    const piece = sourceId === undefined
      ? undefined
      : quellPieces(state, player, arc).find((candidate) => candidate.id === sourceId);
    if (!piece) return "Quell source not found";
    payFromPools(player, total);
    state.pendingDecision = null;
    const prevented = Math.min(piece.amount, arc.amount);
    arc.amount -= prevented;
    (arc.usedQuellSourceIds ??= []).push(piece.id);
    if (!state.pendingDestructions.some((entry) => entry.instanceId === piece.id)) {
      state.pendingDestructions.push({ seat, instanceId: piece.id });
    }
    delete arc.payTotal;
    delete arc.quellSourceInstanceId;
    logPublic(state, `${nameOf(state, player.heroCardId)} pays ${total} to prevent ${prevented} damage (Quell ${piece.amount})`);
    continueAfterPaidQuell(state, runtime, arc);
    return undefined;
  }
  if (pd.chooseHook === "ward") {
    // Ward is mandatory: every option is a destroy (no decline)
    if (!pd.options?.includes(optionId)) return "invalid option";
    const id = Number(optionId.slice("destroy ".length));
    const piece = wardPieces(state, runtime, player).find((p) => p.id === id);
    if (!piece) return "ward source not found";
    const source =
      Object.values(player.equipment).find((c) => c?.instanceId === id) ??
      player.board.find((c) => c.instanceId === id);
    if (!source) return "ward source not found";
    state.pendingDecision = null;
    // destroyed as part of applying the ward — normal destruction hooks fire
    destroyPermanent(state, runtime, seat, source);
    const prevented = arc.unpreventable ? 0 : Math.min(piece.n, arc.amount);
    arc.amount -= prevented;
    logPublic(state, arc.unpreventable
      ? `${nameOf(state, player.heroCardId)} destroys Ward ${piece.n}, but the damage can't be prevented`
      : `${nameOf(state, player.heroCardId)} prevents ${prevented} damage (Ward ${piece.n})`);
    // further ward sources must still apply to the rest of the packet
    continueAfterWard(state, runtime, arc);
    return undefined;
  }
  if (pd.chooseHook === "spellvoid") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    if (optionId !== "decline") {
      const id = Number(optionId.slice("destroy ".length));
      const eq = [
        ...Object.values(player.equipment).filter((card): card is CardInstance => card !== undefined),
        ...player.board,
      ].find((card) => card.instanceId === id);
      if (!eq) return "Spellvoid source not found";
      const piece = spellvoidPieces(state, runtime, player).find((p) => p.id === id);
      if (!piece) return "Spellvoid source not found";
      state.pendingDecision = null;
      destroyPermanent(state, runtime, seat, eq);
      const prevented = arc.unpreventable ? 0 : Math.min(piece.n, arc.amount);
      arc.amount -= prevented;
      logPublic(state, arc.unpreventable
        ? `${nameOf(state, player.heroCardId)} destroys Spellvoid ${piece.n}, but the damage can't be prevented`
        : `${nameOf(state, player.heroCardId)} prevents ${prevented} arcane damage (Spellvoid ${piece.n})`);
      // further Spellvoid pieces may still apply to the rest of the packet
      continueArcaneDamage(state, runtime, arc, true);
      return undefined;
    }
    state.pendingDecision = null;
    // declined Spellvoid: fall through to the Arcane Barrier decision
    continueArcaneDamage(state, runtime, arc, false);
    return undefined;
  }
  if (pd.chooseHook === "arcane-barrier") {
    if (!pd.options?.includes(optionId)) return "invalid option";
    if (!optionId.startsWith("pay ")) return "invalid option";
    const total = Number(optionId.slice(4));
    // chi points pay resource costs and must be spent before resource points
    if (total > player.resources + player.chi) {
      const need = total - player.resources - player.chi;
      const options = pitchableHandOptions(state, player);
      if (options.length === 0) return "cannot pay for Arcane Barrier";
      arc.payTotal = total;
      state.pendingDecision = {
        ...pd,
        prompt: arc.unpreventable
          ? "Warning: this damage cannot be prevented."
          : `Pitch cards to pay ${total} for Arcane Barrier (${need} more needed)`,
        promptMessage: arc.unpreventable
          ? { id: "engine.decision.damage.unpreventable" }
          : {
              id: "engine.decision.damage.arcane.barrier.pay",
              values: { total, need },
            },
        options,
        cardOptions: options.map(Number), // hand instance ids — own hand, visible
        chooseHook: "arcane-barrier-pitch",
        resume: undefined,
      };
      return undefined;
    }
    payFromPools(player, total);
    if (total > 0) logPublic(state, `${nameOf(state, player.heroCardId)} pays ${total} (Arcane Barrier)`);
    state.pendingDecision = null;
    finishArcanePacket(state, runtime, arc, total);
    return undefined;
  }
  if (pd.chooseHook !== "arcane-barrier-pitch") return "not an Arcane Barrier decision";
  const id = Number(optionId);
  const card = player.hand.find((c) => c.instanceId === id);
  if (!card) return "card not in hand";
  const pitch = pitchValueOfInstance(state, card);
  if (pitch <= 0) return `${nameOf(state, card.cardId)} has no pitch value`;
  if (pitchProhibitedByEffect(state, player, card)) return "that card cannot be pitched this turn";
  removeFromArray(player.hand, id);
  player.pitch.push(card);
  notePitch(state, player, card);
  pitchIntoPool(state, runtime, player, card, pitch);
  const total = arc.payTotal ?? 0;
  const need = total - player.resources - player.chi;
  if (need > 0) {
    const options = pitchableHandOptions(state, player);
    if (options.length === 0) return "cannot cover the remaining cost";
    state.pendingDecision = {
      ...pd,
      prompt: arc.unpreventable
        ? "Warning: this damage cannot be prevented."
        : `Pitch cards to pay ${total} for Arcane Barrier (${need} more needed)`,
      promptMessage: arc.unpreventable
        ? { id: "engine.decision.damage.unpreventable" }
        : {
            id: "engine.decision.damage.arcane.barrier.pay",
            values: { total, need },
          },
      options,
      cardOptions: options.map(Number),
      resume: undefined,
    };
    return undefined;
  }
  payFromPools(player, total);
  logPublic(state, `${nameOf(state, player.heroCardId)} pays ${total} (Arcane Barrier)`);
  state.pendingDecision = null;
  finishArcanePacket(state, runtime, arc, total);
  return undefined;
}

/** Apply hero life gain after continuous restrictions such as Reaping Blade. */
export function gainHeroLife(state: GameStateInternal,
  runtime: EngineRuntime, targetSeat: number, n: number): void {
  const player = state.players[targetSeat] as PlayerState;
  const isAhead = state.players.every(
    (other) => other.seat === targetSeat || player.life > other.life,
  );
  const lifeGainLocked = state.players.some((controller) =>
    controlledPermanents(state, controller.seat, { faceDownEquipment: false }).some(
      (card) => scriptOf(state, card.cardId, card)?.preventsLifeGainWhileAhead === true,
    ),
  );
  if (isAhead && lifeGainLocked) {
    logPublic(state, `${nameOf(state, player.heroCardId)} can't gain life while ahead on life`);
    return;
  }
  let amount = Math.max(0, n);
  for (const controller of state.players as PlayerState[]) {
    const active = hookSources(state, controller.seat, {
      board: true,
      equipment: true,
      weapons: true,
      heroLast: true,
    });
    const sources = [...active, ...lingeringModifierSources(state, controller.seat).filter(
      (candidate) => !active.some((source) => source.instanceId === candidate.instanceId),
    )];
    for (const source of sources) {
      const replacement = scriptOf(state, source.cardId, source)?.replaceHeroLifeGain?.(
        runtime.makeCtx(state, controller.seat, source, currentLink(state)),
        targetSeat,
        amount,
      );
      if (replacement !== undefined) amount = Math.max(0, Math.floor(replacement));
    }
  }
  if (amount <= 0) return;
  player.life += amount;
  player.flags.lifeGainedThisTurn = (Number(player.flags.lifeGainedThisTurn) || 0) + amount;
  logPublic(state, `${nameOf(state, player.heroCardId)} gains ${amount} life (${player.life} life)`);
  for (const source of controlledPermanents(state, targetSeat, { faceDownEquipment: false })) {
    scriptOf(state, source.cardId, source)?.onHeroGainedLife?.(
      runtime.makeCtx(state, targetSeat, source, currentLink(state)),
      amount,
    );
  }
}
