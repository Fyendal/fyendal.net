import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  bloodDebtScript as bloodDebt,
  buffNextAttack,
  markedStealthHeroScript,
  markContractCompleted,
  offerRetrieveDagger,
  opponentSeat,
  previousAttackNameContains,
  resolveRetrieveDagger,
  retrievableDaggerIds,
} from "./shared-helpers.js";

// HNT — The Hunted. Mark/Contract (CR 8.4.7, 8.5.39, 8.5.50, 9.3),
// Retrieve (CR 8.5.51), and Draconic chain-link counting are shared mechanics.
const GRAPHENE = "HNT053";
const FEALTY = "HNT167";

function dataTags(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): readonly string[] {
  return ctx.cardTypes(card);
}

function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return dataTags(ctx, card).includes("dagger");
}

function isDraconic(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return dataTags(ctx, card).includes("draconic");
}

function hasKeyword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, keyword: string): boolean {
  const normalized = keyword.toLowerCase();
  if ((card.suppressedKeywords ?? []).some((entry) => entry.toLowerCase() === normalized)) return false;
  return [
    ...(ctx.cardData(card.cardId).keywords ?? []),
    ...(card.grantedKeywords ?? []),
  ].some((entry) => entry.toLowerCase() === normalized);
}

function isMarked(ctx: ScriptCtx, seat: number): boolean {
  return (ctx.player(seat).hero.counters?.marked ?? 0) > 0;
}

function markHero(ctx: ScriptCtx, seat: number): void {
  const hero = ctx.player(seat).hero;
  if ((hero.counters?.marked ?? 0) > 0) return;
  ctx.addCounter(hero.instanceId, "marked", 1);
  ctx.logPublic(`${ctx.cardData(hero.cardId).name} is marked`);
}

function hitMarkedHero(ctx: ScriptCtx): boolean {
  return ctx.link?.flags.targetWasMarkedOnHit === true;
}

function heroIs(ctx: ScriptCtx, seat: number, name: string): boolean {
  return ctx.cardData(ctx.player(seat).heroCardId).name.toLowerCase() === name.toLowerCase();
}

function heroIsArakni(ctx: ScriptCtx, seat: number): boolean {
  return ctx.cardData(ctx.player(seat).heroCardId).name.toLowerCase().startsWith("arakni");
}

function currentDaggerAttack(ctx: ScriptCtx): boolean {
  return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat &&
    isDagger(ctx, ctx.link.attackingCard);
}

function grantSharpenedSensesGoAgain(ctx: ScriptCtx): void {
  if (
    ctx.link?.attackCardType === "weapon" &&
    ctx.link.attacker === ctx.seat &&
    ctx.currentAttackPower() > 2 * ctx.basePower(ctx.link.attackingCard)
  ) {
    ctx.grantGoAgain();
  }
}

function draconicLinks(ctx: ScriptCtx): number {
  return ctx.chainLinksControlled(ctx.seat, "draconic");
}

function currentAttackDraconic(ctx: ScriptCtx): boolean {
  return ctx.currentAttackHasType("draconic");
}

function equippedSelf(ctx: ScriptCtx): DeepReadonly<CardInstance> | undefined {
  return Object.values(ctx.player(ctx.seat).equipment).find((card) =>
    card?.instanceId === ctx.self.instanceId
  );
}

function offerBloodSplatteredVest(ctx: ScriptCtx): void {
  if (!equippedSelf(ctx)) return;
  ctx.requestChoice(
    "blood-splattered-vest",
    "Blood Splattered Vest: gain 1 resource and add a stain counter?",
    ["yes", "no"],
    ctx.seat,
    undefined,
    "no",
  );
}

function resolveBloodSplatteredVest(ctx: ScriptCtx, option: string): void {
  if (!equippedSelf(ctx)) return;
  if (option === "yes") {
    ctx.changeResources(ctx.seat, 1);
    ctx.addCounter(ctx.self.instanceId, "stain", 1);
  }
  // Effect-hit triggers carry last-known source information. Re-read the live
  // equipment so the third counter destroys Vest even when ctx.self is that
  // trigger snapshot.
  const vest = equippedSelf(ctx);
  if ((vest?.counters?.stain ?? 0) >= 3) ctx.destroyPermanent(ctx.self.instanceId);
}

function lastAttackWasDraconic(ctx: ScriptCtx): boolean {
  const current = ctx.link;
  const previous = [...ctx.state.chain].reverse().find((link) => link !== current);
  if (!previous) return false;
  if (previous.flags["grantedType:draconic"] === true) return true;
  return isDraconic(ctx, previous.attackingCard);
}

function playedAnotherRed(ctx: ScriptCtx): boolean {
  return Number(ctx.getFlag("player", "playedPitch:1")) >= 2;
}

function daggerOptions(ctx: ScriptCtx): number[] {
  return ctx.player(ctx.seat).weapons.filter((card) => isDagger(ctx, card))
    .map((card) => card.instanceId);
}

function offLinkDaggerOptions(ctx: ScriptCtx): number[] {
  const activeAttackId = ctx.link?.attackingCard.instanceId;
  return daggerOptions(ctx).filter((instanceId) => instanceId !== activeAttackId);
}

function offerDaggerDamage(ctx: ScriptCtx, hook: string): void {
  if (ctx.link?.targetAllyId !== undefined) return;
  const options = daggerOptions(ctx);
  if (options.length === 0) return;
  ctx.requestCardChoice(
    hook,
    `${ctx.data.name}: choose a dagger to deal 1 damage, then destroy it`,
    ["pass", ...options],
  );
}

function resolveDaggerDamage(ctx: ScriptCtx, hook: string, option: string, expected: string): boolean {
  if (hook !== expected) return false;
  if (option === "pass") return true;
  const dagger = ctx.player(ctx.seat).weapons.find((card) => card.instanceId === Number(option));
  if (!dagger || !isDagger(ctx, dagger)) return true;
  ctx.dealDamage(opponentSeat(ctx), 1, {
    sourceInstanceId: dagger.instanceId,
    countsAsHit: true,
  });
  ctx.destroyPermanent(dagger.instanceId);
  return true;
}

function daggerDamageAttack(hook: string, condition: (ctx: ScriptCtx) => boolean = () => true): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (condition(ctx)) offerDaggerDamage(ctx, hook);
    },
    onChoose(ctx, choiceHook, option) {
      resolveDaggerDamage(ctx, choiceHook, option, hook);
    },
  };
}

function availableDraconicDaggers(ctx: ScriptCtx): number[] {
  return retrievableDaggerIds(ctx).filter((instanceId) => {
    const card = ctx.player(ctx.seat).graveyard.find((candidate) => candidate.instanceId === instanceId);
    return !!card && isDraconic(ctx, card);
  });
}

function stealthPump(pump: number): CardScript {
  return {
    modifyPlayCost: (ctx, base) => isMarked(ctx, opponentSeat(ctx)) ? base - 1 : base,
    canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat &&
      hasKeyword(ctx, ctx.link.attackingCard, "stealth"),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: pump });
      ctx.grantGoAgain();
    },
  };
}

function markOnHit(): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit: (ctx) => markHero(ctx, opponentSeat(ctx)),
  };
}

function daggerReaction(pump: number, opts?: { mark?: boolean; reenableIfMarked?: boolean }): CardScript {
  return {
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({
        scope: "chain-link",
        attack: pump,
        ...(opts?.mark ? { onHitMark: true } : {}),
        ...(opts?.reenableIfMarked ? { onHitReenableAttackerIfMarked: true } : {}),
      });
    },
  };
}

function nextDagger(pump: number, opts?: { mark?: boolean; reenable?: boolean }): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: pump,
        appliesToSubtype: "dagger",
        ...(opts?.mark ? { onHitMark: true } : {}),
        ...(opts?.reenable ? { onHitReenableAttacker: true } : {}),
      });
    },
  };
}

function attackMarkedFealty(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId === undefined && isMarked(ctx, opponentSeat(ctx))) {
        ctx.createToken(FEALTY);
      }
    },
  };
}

function pitchSeries(name: string, factory: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return Object.fromEntries(([1, 2, 3] as const).map((pitch) => [`${name}|${pitch}`, factory(pitch)]));
}

export const hnt: Record<string, CardScript> = {
  // Assassin / marked
  ...pitchSeries("bite", () => daggerDamageAttack("bite-dagger")),
  ...pitchSeries("whittle from bone", () => ({
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId === undefined && isMarked(ctx, opponentSeat(ctx))) ctx.equipToken(GRAPHENE);
    },
  })),
  "stains of the redback|2": stealthPump(2),
  "stains of the redback|3": stealthPump(1),
  "orb-weaver spinneret|2": { onPlay(ctx) { ctx.equipToken(GRAPHENE); buffNextAttack(ctx, { attack: 2, appliesToKeyword: "stealth" }); } },
  "orb-weaver spinneret|3": { onPlay(ctx) { ctx.equipToken(GRAPHENE); buffNextAttack(ctx, { attack: 1, appliesToKeyword: "stealth" }); } },
  "defang the dragon|1": { canTriggerOnHit(ctx) { return hitMarkedHero(ctx) && heroIs(ctx, opponentSeat(ctx), "Fang"); }, onHit(ctx) { markContractCompleted(ctx); ctx.drawCards(ctx.seat, 1); } },
  "extinguish the flames|1": { canTriggerOnHit(ctx) { return hitMarkedHero(ctx) && heroIs(ctx, opponentSeat(ctx), "Cindra"); }, onHit(ctx) { markContractCompleted(ctx); ctx.drawCards(ctx.seat, 1); } },
  "mark of the black widow|2": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length) ctx.requestCardChoice("hnt-black-widow", "Banish a card from your hand", hand.map((card) => card.instanceId), opponentSeat(ctx));
    },
    onChoose(ctx, hook, option) { if (hook === "hnt-black-widow") ctx.banish(Number(option)); },
  },
  "mark of the funnel web|2": { canTriggerOnHit: hitMarkedHero, onHit(ctx) { const card = ctx.player(opponentSeat(ctx)).arsenal[0]; if (card) { ctx.setCardFaceDown(card.instanceId, false); ctx.banish(card.instanceId); } } },
  "mark of the funnel web|3": { canTriggerOnHit: hitMarkedHero, onHit(ctx) { const card = ctx.player(opponentSeat(ctx)).arsenal[0]; if (card) { ctx.setCardFaceDown(card.instanceId, false); ctx.banish(card.instanceId); } } },
  "mark the prey|2": markOnHit(),
  "mark the prey|3": markOnHit(),
  ...pitchSeries("plunge the prospect", () => ({ modifyAttack: (ctx) => isMarked(ctx, opponentSeat(ctx)) ? 1 : 0 })),
  "reaper's call|1": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)) } },
  "reaper's call|2": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)) } },
  ...pitchSeries("scuttle the canal", () => ({ onAttackDeclared(ctx) { if (isMarked(ctx, opponentSeat(ctx))) ctx.grantGoAgain(); } })),
  "hunted or hunter|1": { canTriggerOnDefend: (ctx) => !!ctx.link && ctx.link.flags[`reactionBySeat:${ctx.link.attacker}`] === true, onDefend(ctx) { if (ctx.link) ctx.loseLife(ctx.link.attacker, 1); } },

  // Cindra / Draconic Ninja
  "cindra|0": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) { ctx.createToken(FEALTY); },
    onFriendlyEffectHitCondition(_ctx, _source, _targetSeat, targetWasMarked) {
      return targetWasMarked;
    },
    onFriendlyEffectHit(ctx) { ctx.createToken(FEALTY); },
    activated: {
      cost: 3, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true,
      modifyCost: (ctx, base) => base - draconicLinks(ctx),
      canActivate: (ctx) => availableDraconicDaggers(ctx).length > 0,
      onActivate(ctx) {
        const ids = availableDraconicDaggers(ctx);
        ctx.requestCardChoice("cindra-equip:0", "Equip up to 2 Draconic daggers from your graveyard", ["pass", ...ids]);
      },
    },
    onChoose(ctx, hook, option) {
      if (!hook.startsWith("cindra-equip:") || option === "pass") return;
      const count = Number(hook.slice("cindra-equip:".length));
      const id = Number(option);
      const card = ctx.player(ctx.seat).graveyard.find((candidate) => candidate.instanceId === id);
      if (!card || !isDagger(ctx, card) || !isDraconic(ctx, card)) return;
      if (!ctx.equipFromGraveyard(id) || count >= 1) return;
      const ids = availableDraconicDaggers(ctx);
      if (ids.length) ctx.requestCardChoice("cindra-equip:1", "Equip one more Draconic dagger?", ["pass", ...ids]);
    },
  },
  "kunai of retribution|0": {
    activated: attackAbility(1, { goAgain: true }),
    onAttackDeclared(ctx) { if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId) ctx.setFlag("link", "destroyAttackerOnChainClose", true); },
  },
  "demonstrate devotion|1": { onAttackDeclared(ctx) { if (draconicLinks(ctx) >= 2) { ctx.grantGoAgain(); if (ctx.link?.targetAllyId === undefined) ctx.createToken(FEALTY); } } },
  "wrath of retribution|1": {
    modifyPlayCost: (ctx, base) => base - draconicLinks(ctx),
    onAttackDeclared(ctx) {
      ctx.addModifier({ scope: "combat-chain", attack: 1, appliesToSubtype: "dagger" });
      ctx.addModifier({ scope: "combat-chain", attackActivationCostReduction: 1, appliesToSubtype: "dagger" });
    },
  },
  "blood drop|1": { modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "blood line|1": { modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "burning blade dance|1": {
    onAttackDeclared(ctx) { if (draconicLinks(ctx) >= 2) ctx.grantGoAgain(); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && draconicLinks(ctx) >= 2; },
    onHit(ctx) { offerDaggerDamage(ctx, "burning-blade-dagger"); },
    onChoose(ctx, hook, option) { resolveDaggerDamage(ctx, hook, option, "burning-blade-dagger"); },
  },
  "mark with magma|1": { onAttackDeclared(ctx) { if (draconicLinks(ctx) >= 2) ctx.grantGoAgain(); }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && draconicLinks(ctx) >= 2; }, onHit(ctx) { markHero(ctx, opponentSeat(ctx)); } },
  "art of the dragon: claw|1": { onAttackDeclared(ctx) { if (currentAttackDraconic(ctx)) ctx.setFlag("link", "hntArtClaw", true); }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "hntArtClaw") === true; }, onHit(ctx) { for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal"); } },
  "art of the dragon: scale|1": {
    onAttackDeclared(ctx) { if (currentAttackDraconic(ctx)) ctx.setFlag("link", "hntArtScale", true); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "hntArtScale") === true; },
    onHit(ctx) {
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment).filter((card) => card !== undefined);
      if (equipment.length) ctx.requestCardChoice("art-scale", "Put a -1 defense counter on equipment", equipment.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "art-scale") return;
      const card = Object.values(ctx.player(opponentSeat(ctx)).equipment).find((candidate) => candidate?.instanceId === Number(option));
      if (!card) return;
      const oldCounters = card.defCounters ?? 0;
      ctx.addCardDefenseCounters(card.instanceId, 1);
      if (Math.max(0, (ctx.cardData(card.cardId).defense ?? 0) - oldCounters - 1) === 0) ctx.destroyPermanent(card.instanceId);
    },
  },
  "dragon power|1": { modifyAttack: (ctx) => currentAttackDraconic(ctx) ? 3 : 0 },
  "dragon power|2": { modifyAttack: (ctx) => currentAttackDraconic(ctx) ? 3 : 0 },
  ...pitchSeries("silver talons", () => daggerDamageAttack("silver-talons-dagger", currentAttackDraconic)),
  "fire tenet: strike first|2": { onAttackDeclared(ctx) { buffNextAttack(ctx, { attack: 1, appliesToSubtype: "draconic", expiresOnChainClose: true }); } },
  "fire tenet: strike first|3": { onAttackDeclared(ctx) { buffNextAttack(ctx, { attack: 1, appliesToSubtype: "draconic", expiresOnChainClose: true }); } },
  ...pitchSeries("grow claws", () => ({ modifyAttack: (ctx) => lastAttackWasDraconic(ctx) ? 1 : 0 })),
  ...pitchSeries("grow wings", () => ({ onAttackDeclared(ctx) { if (lastAttackWasDraconic(ctx)) ctx.grantGoAgain(); } })),
  ...pitchSeries("tag the target", () => markOnHit()),
  ...pitchSeries("trap and release", () => markOnHit()),

  // Fang / Draconic Warrior
  "fang|0": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) { ctx.createToken(FEALTY); },
    onFriendlyEffectHitCondition(_ctx, _source, _targetSeat, targetWasMarked) {
      return targetWasMarked;
    },
    onFriendlyEffectHit(ctx) { ctx.createToken(FEALTY); },
    modifyAttackActivationCost(ctx, attacker, base) {
      const fealty = ctx.player(ctx.seat).board.filter((card) => ctx.cardData(card.cardId).name === "Fealty").length;
      return fealty >= 3 && isDagger(ctx, attacker) ? base - 1 : base;
    },
  },
  "obsidian fire vein|0": {
    activated: attackAbility(1),
    modifyAttack(ctx) { return ctx.link?.attackingCard.instanceId === ctx.self.instanceId && ctx.getFlag("link", "playedType:draconic") ? 1 : 0; },
    onAttackDeclared(ctx) { if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId && ctx.getFlag("link", "playedType:draconic")) ctx.grantGoAgain(); },
    onFriendlyPlay(ctx, played) { if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId && isDraconic(ctx, played)) ctx.grantGoAgain(); },
  },
  "affirm loyalty|1": { ...daggerReaction(2), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 2 }); if (draconicLinks(ctx) >= 2) ctx.createToken(FEALTY); } },
  "endear devotion|1": { ...daggerReaction(3), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3 }); if (draconicLinks(ctx) >= 2) ctx.createToken(FEALTY); } },
  "fire and brimstone|1": { canPlay: currentDaggerAttack, modifyPlayCost: (ctx, base) => base - draconicLinks(ctx), onPlay(ctx) { ctx.addModifier({ scope: "combat-chain", attack: 1, appliesToSubtype: "dagger" }); for (const dagger of ctx.player(ctx.seat).weapons.filter((card) => isDagger(ctx, card))) ctx.grantAdditionalActivation(dagger.instanceId); } },
  "blistering blade|1": { canPlay: currentDaggerAttack, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: draconicLinks(ctx) >= 2 ? 3 : 2 }); } },
  "brothers of flame|1": { canPlay: (ctx) => currentDaggerAttack(ctx) && draconicLinks(ctx) >= 2, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 4 }); } },
  "dynastic dedication|1": { ...daggerReaction(3), modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "imperial intent|1": { ...daggerReaction(2), modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "scalding iron|1": { canPlay: currentDaggerAttack, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: draconicLinks(ctx) }); } },
  "searing gaze|1": { canPlay: currentDaggerAttack, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 2, ...(draconicLinks(ctx) >= 2 ? { onHitMark: true } : {}) }); } },
  "sisters of fire|1": { canPlay: (ctx) => currentDaggerAttack(ctx) && draconicLinks(ctx) >= 2, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3 }); } },
  "sizzling steel|1": { canPlay: currentDaggerAttack, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: draconicLinks(ctx) >= 2 ? 4 : 3 }); } },
  "stabbing pain|1": { canPlay: currentDaggerAttack, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3, ...(draconicLinks(ctx) >= 2 ? { onHitMark: true } : {}) }); } },
  ...pitchSeries("diced", (pitch) => ({ canPlay: currentDaggerAttack, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); buffNextAttack(ctx, { attack: 4 - pitch, appliesToSubtype: "dagger" }); } })),
  ...pitchSeries("twist and turn", (pitch) => nextDagger(5 - pitch, { reenable: true })),
  "agility stance|2": { triggers: [{ event: "start-of-turn", label: "Dagger attacks gain go again", effect(ctx) { ctx.destroySelf(); ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToSubtype: "dagger" }); } }] },
  "flurry stance|1": { triggers: [{ event: "start-of-turn", label: "Additional dagger attacks", effect(ctx) { ctx.destroySelf(); for (const dagger of ctx.player(ctx.seat).weapons.filter((card) => isDagger(ctx, card))) ctx.grantAdditionalActivation(dagger.instanceId); } }] },
  "power stance|3": { triggers: [{ event: "start-of-turn", label: "Dagger attacks get +1", effect(ctx) { ctx.destroySelf(); ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToSubtype: "dagger" }); } }] },
  ...pitchSeries("cut deep", (pitch) => nextDagger(5 - pitch)),
  ...pitchSeries("hunt a killer", (pitch) => nextDagger(5 - pitch, { mark: true })),
  ...pitchSeries("knife through butter", (pitch) => ({ onPlay(ctx) { buffNextAttack(ctx, { attack: 5 - pitch, appliesToSubtype: "dagger" }); ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToMarkedHero: true }); } })),
  ...pitchSeries("point of engagement", (pitch) => ({ onPlay(ctx) { buffNextAttack(ctx, { attack: 4 - pitch, appliesToSubtype: "dagger" }); ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToMarkedHero: true }); } })),
  ...pitchSeries("sworn vengeance", (pitch) => nextDagger(4 - pitch, { mark: true })),
  "vow of vengeance|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => ctx.link?.targetAllyId === undefined && heroIsArakni(ctx, opponentSeat(ctx)), onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)) } },
  "heart of vengeance|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          attackCostReduction: 1,
          appliesToTargetNamePrefix: "arakni",
          once: true,
        });
      },
    },
  },
  "hand of vengeance|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => ctx.link?.targetAllyId === undefined && heroIsArakni(ctx, opponentSeat(ctx)), onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); } } },
  "path of vengeance|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => ctx.link?.targetAllyId === undefined && heroIsArakni(ctx, opponentSeat(ctx)), onActivate: (ctx) => ctx.grantGoAgain() } },
  "coat of allegiance|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.changeResources(ctx.seat, 1);
        ctx.addModifier({ scope: "until-end-of-turn", restrictCardPlaysToType: "draconic" });
      },
    },
  },

  // Generic Draconic
  "compounding anger|1": { modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "hunt to the ends of rathe|1": { onAttackDeclared(ctx) { if (heroIsArakni(ctx, opponentSeat(ctx))) markHero(ctx, opponentSeat(ctx)); }, modifyAttack: (ctx) => isMarked(ctx, opponentSeat(ctx)) ? 2 : 0 },
  "march of loyalty|1": { onAttackDeclared(ctx) { if (ctx.getFlag("player", "createdName:fealty")) ctx.grantGoAgain(); } },
  "bubble to the surface|1": {
    modifyPlayCost: (ctx, base) => base - draconicLinks(ctx),
    onPlay(ctx) {
      const revealed = [];
      for (const card of ctx.player(ctx.seat).deck) {
        revealed.push(card);
        ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(card.cardId).name}`);
        if ((ctx.cardData(card.cardId).pitch ?? 0) === 1) break;
      }
      const red = revealed.find((card) => (ctx.cardData(card.cardId).pitch ?? 0) === 1);
      if (red) { ctx.banish(red.instanceId); ctx.allowPlayFrom(red.instanceId, "banish"); }
      ctx.shuffleDeck();
    },
  },
  "drop of dragon blood|1": { modifyPlayCost: (ctx, base) => base - draconicLinks(ctx), onPlay(ctx) { ctx.changeResources(ctx.seat, 1); ctx.drawCards(ctx.seat, 1); } },
  "rake over the coals|1": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToSubtype: "draconic" }); } },
  "for the dracai|1": attackMarkedFealty(),
  "for the emperor|1": attackMarkedFealty(),
  "for the realm|1": attackMarkedFealty(),
  "hunt the hunter|1": { onAttackDeclared(ctx) { if (ctx.link?.targetAllyId === undefined && playedAnotherRed(ctx)) markHero(ctx, opponentSeat(ctx)); } },
  "smoke out|1": { canTriggerOnDefend: (ctx) => !!ctx.link && (ctx.cardData(ctx.link.attackingCard.cardId).pitch ?? 0) === 1, onDefend(ctx) { if (ctx.link) markHero(ctx, ctx.link.attacker); } },
  "blessing of vynserakai|1": { triggers: [{ event: "start-of-turn", label: "Next attack is Draconic and +3", effect(ctx) { ctx.destroySelf(); buffNextAttack(ctx, { attack: 3, grantType: "draconic" }); } }] },
  "pledge fealty|1": { onPlay: (ctx) => { ctx.createToken(FEALTY); } },
  "proclaim vengeance|1": { onPlay(ctx) { const target = opponentSeat(ctx); markHero(ctx, target); if (heroIsArakni(ctx, target)) ctx.changeResources(ctx.seat, 1); } },
  "tooth of the dragon|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToSubtype: "draconic" }); } },

  // Assassin hybrids
  ...Object.fromEntries(
    ["leap frog vocal sac", "leap frog slime skin", "leap frog gloves", "leap frog leggings"].map(
      (name) => [
        `${name}|0`,
        {
          triggers: [{
            event: "attack-reaction" as const,
            whose: "any" as const,
            optional: true,
            label: "Add this to the active chain link as a defending card",
            condition: (ctx: ScriptCtx) => ctx.link?.attacker !== ctx.seat,
            effect: (ctx: ScriptCtx) => { ctx.addSelfAsDefender(); },
          }],
        },
      ],
    ),
  ),
  ...pitchSeries("cut through", () => ({ onAttackDeclared(ctx) { const hit = ctx.state.chain.some((link) => link.attacker === ctx.seat && ((link.hit && isDagger(ctx, link.attackingCard)) || Number(link.flags["effectDamageBySubtype:dagger"]) > 0)); if (hit) { ctx.addModifier({ scope: "chain-link", attack: 1 }); ctx.grantGoAgain(); } } })),
  "up sticks and run|1": { onPlay(ctx) { offerRetrieveDagger(ctx, "up-sticks-1"); buffNextAttack(ctx, { attack: 4, appliesToSubtype: "dagger" }); }, onChoose(ctx, hook, option) { resolveRetrieveDagger(ctx, hook, option, "up-sticks-1"); } },
  "up sticks and run|2": { onPlay(ctx) { offerRetrieveDagger(ctx, "up-sticks-2"); buffNextAttack(ctx, { attack: 3, appliesToSubtype: "dagger" }); }, onChoose(ctx, hook, option) { resolveRetrieveDagger(ctx, hook, option, "up-sticks-2"); } },
  "up sticks and run|3": { onPlay(ctx) { offerRetrieveDagger(ctx, "up-sticks-3"); buffNextAttack(ctx, { attack: 2, appliesToSubtype: "dagger" }); }, onChoose(ctx, hook, option) { resolveRetrieveDagger(ctx, hook, option, "up-sticks-3"); } },
  "pick up the point|1": { onAttackDeclared(ctx) { offerRetrieveDagger(ctx, "pick-point-1"); }, onChoose(ctx, hook, option) { resolveRetrieveDagger(ctx, hook, option, "pick-point-1"); } },
  "pick up the point|2": { onAttackDeclared(ctx) { offerRetrieveDagger(ctx, "pick-point-2"); }, onChoose(ctx, hook, option) { resolveRetrieveDagger(ctx, hook, option, "pick-point-2"); } },
  "pick up the point|3": { onAttackDeclared(ctx) { offerRetrieveDagger(ctx, "pick-point-3"); }, onChoose(ctx, hook, option) { resolveRetrieveDagger(ctx, hook, option, "pick-point-3"); } },
  ...pitchSeries("poisoned blade", () => ({
    onAttackDeclared(ctx) { ctx.addModifier({ scope: "until-end-of-turn", expiresOnChainClose: true }); },
    canTriggerOnHit(ctx) { return !!ctx.link && isDagger(ctx, ctx.link.attackingCard); },
    onHit(ctx) { ctx.loseLife(opponentSeat(ctx), 1); },
    onFriendlyEffectHitCondition(ctx, source) { return isDagger(ctx, source); },
    onFriendlyEffectHit(ctx, _source, targetSeat) { ctx.loseLife(targetSeat, 1); },
  })),
  ...pitchSeries("throw yourself at them", () => daggerDamageAttack("throw-dagger")),
  "red alert visor|0": { modifyDefense: (ctx) => ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0 },
  "red alert vest|0": { modifyDefense: (ctx) => ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0 },
  "red alert gloves|0": { modifyDefense: (ctx) => ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0 },
  "red alert boots|0": { modifyDefense: (ctx) => ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0 },
  "starting point|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => ctx.getFlag("link", `reactionBySeat:${ctx.seat}`) === true, onActivate: (ctx) => ctx.grantGoAgain() } },
  ...pitchSeries("to the point", (pitch) => ({ canPlay: currentDaggerAttack, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 4 - pitch + (isMarked(ctx, opponentSeat(ctx)) ? 1 : 0) }); } })),
  ...pitchSeries("cut from the same cloth", (pitch) => ({ onPlay(ctx) { const target = opponentSeat(ctx); const hand = ctx.player(target).hand; ctx.logPublic(`${ctx.cardData(ctx.player(target).heroCardId).name} reveals ${hand.map((card) => ctx.cardData(card.cardId).name).join(", ") || "an empty hand"}`); if (hand.some((card) => ctx.cardData(card.cardId).cardType === "attack-reaction")) markHero(ctx, target); buffNextAttack(ctx, { attack: 5 - pitch, appliesToSubtype: "dagger" }); } })),
  ...pitchSeries("incision", (pitch) => daggerReaction(4 - pitch)),
  "scar tissue|2": daggerReaction(2, { mark: true }),
  "scar tissue|3": daggerReaction(1, { mark: true }),
  ...pitchSeries("take a stab", (pitch) => daggerReaction(4 - pitch, { reenableIfMarked: true })),

  // Generic
  "bunker beard|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "defense-reaction", destroySelfCost: true, canActivate: (ctx) => !!ctx.player(ctx.seat).arsenal[0] && ctx.hasCardType(ctx.player(ctx.seat).arsenal[0]!, "action"), onActivate(ctx) { const card = ctx.player(ctx.seat).arsenal[0]; if (card) ctx.addDefenderFromArsenal(card.instanceId); } } },
  "pursue to the edge of oblivion|1": markOnHit(),
  "pursue to the pits of despair|1": markOnHit(),
  "sound the alarm|1": {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId !== undefined) return;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      ctx.logPublic(`${ctx.cardData(ctx.player(opponentSeat(ctx)).heroCardId).name} reveals their hand`);
      if (!hand.some((card) => ctx.cardData(card.cardId).cardType === "attack-reaction")) return;
      const reactions = ctx.player(ctx.seat).deck.filter((card) => ctx.cardData(card.cardId).cardType === "defense-reaction");
      if (reactions.length) ctx.requestCardChoice("sound-alarm", "Search for a defense reaction?", ["pass", ...reactions.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook !== "sound-alarm") return; if (option !== "pass") { const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option)); if (card) { ctx.logPublic(`${ctx.cardData(card.cardId).name} is revealed`); ctx.shuffleDeck(); ctx.putOnDeckTop(card.instanceId); return; } } ctx.shuffleDeck(); },
  },
  "imperial seal of command|1": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.setPlayerFlag(ctx.seat, "noDefenseReactionsThisTurn", true); if (dataTags(ctx, ctx.player(ctx.seat).hero).includes("royal")) ctx.addModifier({ scope: "until-end-of-turn" }); } }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) => modifier.scope === "until-end-of-turn" && modifier.sourceInstanceId === ctx.self.instanceId && !modifier.consumed); }, onHit(ctx) { for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.banish(card.instanceId); const mod = ctx.state.modifiers.find((modifier) => modifier.scope === "until-end-of-turn" && modifier.sourceInstanceId === ctx.self.instanceId && !modifier.consumed)!; ctx.consumeModifier(mod.id); } },
  "relentless pursuit|3": { onPlay(ctx) { markHero(ctx, opponentSeat(ctx)); if (ctx.getFlag("player", "attackedHeroThisTurn")) ctx.putOnDeckBottom(ctx.self.instanceId); } },
  "calming breeze|1": { onPlay: (ctx) => ctx.preventNextDamageEvents(ctx.seat, 1, 3) },
  ...pitchSeries("tip-off", () => ({ activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)) } })),
  "outed|1": { canPlay: (ctx) => !isMarked(ctx, ctx.seat), modifyAttack: (ctx) => isMarked(ctx, opponentSeat(ctx)) ? 1 : 0 },
  "lay low|2": { canPlay: (ctx) => !isMarked(ctx, ctx.seat) },
  "exposed|3": { canPlay: (ctx) => !isMarked(ctx, ctx.seat), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); markHero(ctx, opponentSeat(ctx)); } },
  ...pitchSeries("public bounty", (pitch) => ({ onPlay(ctx) { markHero(ctx, opponentSeat(ctx)); buffNextAttack(ctx, { attack: 4 - pitch, appliesToMarkedHero: true }); } })),
};

hnt["cindra, dracai of retribution|0"] = hnt["cindra|0"]!;
hnt["fang, dracai of blades|0"] = hnt["fang|0"]!;

const AGENTS = ["HNT003", "HNT004", "HNT005", "HNT006", "HNT007", "HNT008"] as const;
const randomAgent = (ctx: ScriptCtx) => ctx.becomeHero(AGENTS[ctx.randomInt(AGENTS.length)]!);
const dealWithDagger = (ctx: ScriptCtx, draw = false) => {
  const daggers = draw ? offLinkDaggerOptions(ctx) : daggerOptions(ctx);
  if (daggers.length) ctx.requestCardChoice(draw ? "deal-dagger-draw" : "deal-dagger", "Choose a dagger", daggers);
};

Object.assign(hnt, {
  "schism of chaos|3": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Each hero shuffles and arsenals their top card", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx) { for (const player of ctx.state.players) { ctx.shuffleDeck(player.seat); const top = ctx.player(player.seat).deck[0]; if (top) ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false }); } } }] },
  "arakni, marionette|0": markedStealthHeroScript(AGENTS),
  "mask of deceit|0": {
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined || !isMarked(ctx, attacker)) {
        randomAgent(ctx);
        return;
      }
      ctx.requestChoice(
        "mask-agent",
        "Mask of Deceit: choose an Agent of Chaos",
        AGENTS.map((cardId) => ctx.cardData(cardId).name),
        undefined,
        [...AGENTS],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "mask-agent") return;
      const agent = AGENTS.find((cardId) => ctx.cardData(cardId).name === option);
      if (agent) ctx.becomeHero(agent);
    },
  },
  "kiss of death|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      ctx.loseLife(opponentSeat(ctx), 1);
    },
    onEffectHit(ctx, targetSeat) {
      ctx.loseLife(targetSeat, 1);
    },
  },
  "under the trap-door|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx) { const traps = ctx.player(ctx.seat).graveyard.filter((card) => dataTags(ctx, card).includes("trap")); if (traps.length) ctx.requestCardChoice("trap-door", "Banish a trap", traps.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "trap-door" && ctx.banish(Number(option))) ctx.allowPlayFrom(Number(option), "banish", { graveyardReplacement: "banish" }); } },
  "tarantula toxin|1": {
    canPlay(ctx) {
      if (!ctx.link || ctx.link.attacker !== ctx.seat) return false;
      const daggerMode = isDagger(ctx, ctx.link.attackingCard);
      const defenseMode = hasKeyword(ctx, ctx.link.attackingCard, "stealth") &&
        [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0;
      return daggerMode || defenseMode;
    },
    additionalCost(ctx) {
      if (!ctx.link) return;
      const daggerMode = isDagger(ctx, ctx.link.attackingCard);
      const defenseMode = hasKeyword(ctx, ctx.link.attackingCard, "stealth") &&
        [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0;
      if (daggerMode && defenseMode) {
        ctx.requestChoice(
          "tarantula-mode",
          "Tarantula Toxin: choose 1 or both",
          ["+3 attack", "-3 defense", "both"],
        );
      }
    },
    onPlay(ctx) {
      if (!ctx.link) return;
      const daggerMode = isDagger(ctx, ctx.link.attackingCard);
      const defenseMode = hasKeyword(ctx, ctx.link.attackingCard, "stealth") &&
        [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0;
      const selectedMode = ctx.getCounter("tarantulaMode");
      if (daggerMode && (!defenseMode || selectedMode === 1 || selectedMode === 3)) {
        ctx.addModifier({ scope: "chain-link", attack: 3 });
      }
      if (defenseMode && (!daggerMode || selectedMode === 2 || selectedMode === 3)) {
        const defenders = [...ctx.link.defendingCards, ...ctx.link.defendingEquipment];
        ctx.requestCardChoice(
          "toxin-defender",
          "Give a defender -3 defense",
          defenders.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "tarantula-mode") {
        ctx.setCounter("tarantulaMode", option === "+3 attack" ? 1 : option === "-3 defense" ? 2 : 3);
        return;
      }
      if (hook === "toxin-defender") ctx.addCardTempDefense(Number(option), -3);
    },
  },
  "anaphylactic shock|3": { onPlay(ctx) { for (const player of ctx.state.players) if (player.seat !== ctx.seat && player.flags.dealtDamageThisTurn === true) ctx.loseLife(player.seat, 1); } },
  "blood runs deep|1": { modifyPlayCost: (ctx, base) => base - draconicLinks(ctx), onAttackDeclared(ctx) { for (const dagger of [...ctx.player(ctx.seat).weapons]) { ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: dagger.instanceId, countsAsHit: true }); ctx.destroyPermanent(dagger.instanceId); } ctx.grantGoAgain(); } },
  "ignite|1": { onAttackDeclared(ctx) { ctx.addModifier({ scope: "combat-chain", playCostReduction: 1, activationCostReduction: 1, appliesToSubtype: "draconic", once: true }); } },
  "art of the dragon: blood|1": { onAttackDeclared(ctx) { if (currentAttackDraconic(ctx)) { ctx.grantGoAgain(); ctx.addModifier({ scope: "until-end-of-turn", playCostReduction: 1, appliesToSubtype: "draconic", remainingCostUses: 3 }); } } },
  "devotion never dies|1": { canTriggerOnHit: lastAttackWasDraconic, onHit(ctx) { if (ctx.banish(ctx.self.instanceId)) ctx.allowPlayFrom(ctx.self.instanceId, "banish"); } },
  "prowess of agility|3": { onFriendlyAttackDeclared(ctx) { if (Number(ctx.getPlayerFlag(ctx.seat, "attacksDeclaredThisTurn")) === 4) { ctx.destroySelf(); ctx.drawCards(ctx.seat, 1); } }, triggers: [{ event: "end-of-turn", condition: (ctx) => Number(ctx.getPlayerFlag(ctx.seat, "attacksDeclaredThisTurn")) < 3, label: "Destroy Prowess of Agility", effect: (ctx) => ctx.destroySelf() }] },
  "hunt's end|1": { canPlay: (ctx) => ctx.player(ctx.seat).board.filter((card) => ctx.cardData(card.cardId).name === "Fealty").length >= 3 && currentDaggerAttack(ctx), onPlay: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 4 }) },
  "long whisker loyalty|1": { canPlay: currentDaggerAttack, onPlay(ctx) { const count = draconicLinks(ctx); if (count > 0) ctx.addModifier({ scope: "chain-link", attack: 2 }); if (count > 1 && ctx.link) ctx.grantAdditionalActivation(ctx.link.attackingCard.instanceId); if (count > 2 && ctx.link) ctx.addModifier({ scope: "until-end-of-turn", appliesToSubtype: "dagger", onHitMark: true, once: true }); } },
  "kabuto of imperial authority|0": { onDefend(ctx) { ctx.setPlayerFlag(opponentSeat(ctx), "cannotAttackWithWeaponsThisTurn", true); } },
  "jagged edge|1": { canPlay: (ctx) => !!ctx.link && ctx.link.attackCardType === "weapon", onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3 }); ctx.setFlag("link", "unpreventable", true); } },
  "provoke|3": {
    canPlay: (ctx) => !!ctx.link && ctx.link.attackCardType === "weapon",
    onPlay(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (hand.length) {
        ctx.requestCardChoice(
          "provoke-reveal",
          "Provoke: choose a card to reveal",
          hand.map((card) => card.instanceId),
          target,
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "provoke-reveal") return;
      const target = opponentSeat(ctx);
      const card = ctx.player(target).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.revealCards([card.instanceId], target);
      if (ctx.hasCardType(card, "action")) ctx.addDefenderFromHand(card.instanceId);
      else ctx.discardCard(target, card.instanceId);
    },
  },
  "sharpened senses|2": {
    onEnterArena(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" }); },
    onFriendlyAttackDeclared: grantSharpenedSensesGoAgain,
    onFriendlyAttackPowerGained: grantSharpenedSensesGoAgain,
    triggers: [{ event: "end-of-turn", label: "Destroy Sharpened Senses", effect: (ctx) => ctx.destroySelf() }],
  },
  "dragonscaler flight path|0": { activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, modifyCost: (ctx, base) => base - draconicLinks(ctx), canActivate: (ctx) => !!ctx.link && currentAttackDraconic(ctx), onActivate(ctx) { ctx.grantGoAgain(); if (ctx.link && (ctx.link.attackCardType === "weapon" || dataTags(ctx, ctx.link.attackingCard).includes("ally"))) ctx.grantAdditionalActivation(ctx.link.attackingCard.instanceId); } } },
  "oath of loyalty|1": { canPlay: (ctx) => Number(ctx.getPlayerFlag(ctx.seat, "actionsPlayedOrActivatedThisTurn")) === 0, triggers: [{ event: "card-played", sourceZone: "self", label: "You may only play Draconic cards this turn", effect: (ctx) => ctx.addModifier({ scope: "until-end-of-turn", restrictCardPlaysToType: "draconic" }) }] },
  "loyalty beyond the grave|1": { triggers: [{ event: "start-of-turn", sourceZone: "graveyard", optional: true, label: "Banish two Loyalty Beyond the Grave to draw", condition: (ctx) => ctx.player(ctx.seat).graveyard.filter((card) => ctx.cardData(card.cardId).name === "Loyalty Beyond the Grave").length >= 2, effect(ctx) { for (const card of ctx.player(ctx.seat).graveyard.filter((card) => ctx.cardData(card.cardId).name === "Loyalty Beyond the Grave").slice(0, 2)) ctx.banish(card.instanceId); ctx.drawCards(ctx.seat, 1); } }] },
  "blood splattered vest|0": {
    onFriendlyEffectHitCondition(ctx, source) { return isDagger(ctx, source); },
    onFriendlyEffectHit(ctx) { offerBloodSplatteredVest(ctx); },
    onFriendlyCombatDamageDealt(ctx, source, _target, amount) {
      if (amount > 0 && isDagger(ctx, source)) offerBloodSplatteredVest(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "blood-splattered-vest") resolveBloodSplatteredVest(ctx, option);
    },
  },
  "pain in the backside|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit: (ctx) => dealWithDagger(ctx), onChoose(ctx, hook, option) { if (hook === "deal-dagger") ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: Number(option), countsAsHit: true }); } },
  "throw dagger|3": {
    canPlay: (ctx) =>
      !!ctx.link && ctx.link.attacker === ctx.seat && offLinkDaggerOptions(ctx).length > 0,
    onPlay: (ctx) => dealWithDagger(ctx, true),
    onChoose(ctx, hook, option) {
      if (hook !== "deal-dagger-draw") return;
      const id = Number(option);
      if (!offLinkDaggerOptions(ctx).includes(id)) return;
      if (ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: id, countsAsHit: true }) > 0) {
        ctx.drawCards(ctx.seat, 1);
      }
      ctx.destroyPermanent(id);
    },
  },
  "perforate|2": { canPlay: currentDaggerAttack, onPlay(ctx) { if (ctx.link) { ctx.grantAdditionalActivation(ctx.link.attackingCard.instanceId); ctx.addModifier({ scope: "until-end-of-turn", attackActivationCostReduction: 1, appliesToSubtype: "dagger" }); } ctx.drawCards(ctx.seat, 1); } },
  "savor bloodshed|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4, appliesToSubtype: "dagger" });
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesToSubtype: "dagger",
        appliesToMarkedHero: true,
        onHitDraw: 1,
        once: true,
      });
    },
    onFriendlyEffectHitCondition(ctx, source, _targetSeat, targetWasMarked) {
      return targetWasMarked && isDagger(ctx, source);
    },
    onFriendlyEffectHit(ctx) {
      const delayedDraw = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "until-end-of-turn" &&
        modifier.onHitDraw === 1 &&
        !modifier.consumed
      );
      if (delayedDraw && ctx.consumeModifier(delayedDraw.id)) ctx.drawCards(ctx.seat, 1);
    },
  },
  "quickdodge flexors|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "defense-reaction", onActivate(ctx) { ctx.addSelfAsDefender(); ctx.addCardTempDefense(ctx.self.instanceId, 2); ctx.destroyAtEndPhase(ctx.self.instanceId); } } },
  "rotten remains|3": { onAttackDeclared(ctx) { const byOwner = ctx.state.players.every((player) => player.graveyard.some((card) => ctx.basePower(card) === 1)); if (byOwner) { for (const player of ctx.state.players) { const card = player.graveyard.find((candidate) => ctx.basePower(candidate) === 1); if (card) ctx.banish(card.instanceId); } ctx.addCardTempPower(ctx.self.instanceId, 1); } } },
  "shelter from the storm|1": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => ctx.preventNextDamageEvents(ctx.seat, 1, 3) } },
  "dual threat|2": { onPlay(ctx) { if (ctx.getPlayerFlag(ctx.seat, "attackedWithWeaponThisTurn") === true) buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action" }); if (ctx.getPlayerFlag(ctx.seat, "attackedWithAttackActionThisTurn") === true) buffNextAttack(ctx, { attack: 3, appliesTo: "weapon" }); } },
  "thick hide hunter|2": { onAttackDeclared: (ctx) => ctx.discardRandom(ctx.seat, 1), onDefend: (ctx) => ctx.discardRandom(ctx.seat, 1) },
  "tremorshield sabatons|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.preventNextArcaneDamage(ctx.seat, ctx.getPlayerFlag(ctx.seat, "createdName:seismic surge") === true ? 2 : 1); } } },
  "roiling fissure|3": { variablePlayCost: { base: 1, counterKey: "fissureX", prompt: "Choose X" }, onPlay(ctx) { const x = ctx.getCounter("fissureX"); const aura = ctx.state.players.flatMap((player) => player.board).find((card) => dataTags(ctx, card).includes("aura") && (ctx.cardData(card.cardId).cost ?? 0) <= x); if (aura) ctx.destroyPermanent(aura.instanceId); } },
  "retrace the past|3": {
    onAttackDeclared(ctx) {
      if (!previousAttackNameContains(ctx, "gustwave")) return;
      ctx.requestNameChoice("retrace-name", `${ctx.data.name}: name a card`);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "retrace-name") return;
      ctx.grantCardName(ctx.self.instanceId, option);
      ctx.addCardTempPower(ctx.self.instanceId, 2);
      ctx.grantGoAgain();
    },
  },
  "misfire dampener|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.preventNextArcaneDamage(ctx.seat, ctx.getPlayerFlag(ctx.seat, "boostedThisTurn") === true ? 2 : 1); } } },
  "null time zone|3": { prohibitsChosenName: true, onEnterArena(ctx) { ctx.setCounter("steam", 2); ctx.requestNameChoice("null-name", "Name a card"); }, onChoose(ctx, hook, option) { if (hook === "null-name") ctx.setChosenName(option); }, triggers: [{ event: "start-of-turn", label: "Remove a steam counter", effect(ctx) { if (ctx.getCounter("steam") <= 0) ctx.destroySelf(); else ctx.setCounter("steam", ctx.getCounter("steam") - 1); } }] },
  "enchanted quiver|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { const arrow = ctx.player(ctx.seat).arsenal.some((card) => !card.faceDown && dataTags(ctx, card).includes("arrow")); ctx.preventNextArcaneDamage(ctx.seat, arrow ? 2 : 1); } } },
  "chain reaction|2": { canTriggerOnDefend: (ctx) => ctx.link?.goAgain === true, onDefend(ctx) { const cards = ctx.player(ctx.seat).arsenal.filter((card) => ctx.hasCardType(card, "action") && !dataTags(ctx, card).includes("attack")); if (cards.length) ctx.requestCardChoice("chain-arsenal", "Turn a non-attack action face-up", cards.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "chain-arsenal") ctx.setCardFaceDown(Number(option), false); } },
  "douse in runeblood|1": { onAttackDeclared(ctx) { const count = Number(ctx.getPlayerFlag(ctx.seat, "nonAttackActionsPlayedThisTurn")); ctx.createTokens("ARC112", count); if (count >= 3) ctx.grantGoAgain(); } },
  "spur locked|3": { onPlay(ctx) { const mine = ctx.randomInt(6) + 1; const theirs = ctx.randomInt(6) + 1; if (mine === theirs) return; const loser = mine > theirs ? ctx.seat : opponentSeat(ctx); const amount = Math.max(mine, theirs); ctx.loseLife(loser, amount); const cards = ctx.player(loser).deck.filter((card) => (ctx.cardData(card.cardId).cost ?? 0) <= amount); if (cards.length) ctx.requestCardChoice("spur-search", "Choose a card", cards.map((card) => card.instanceId), loser); }, onChoose(ctx, hook, option) { if (hook === "spur-search") { ctx.revealCards([Number(option)]); ctx.moveToHand(Number(option)); ctx.shuffleDeck(); } } },
  "ring of roses|2": { onFriendlyDamageDealt(ctx, _source, target, amount, arcane) { const key = `ring:${ctx.state.turn}`; if (arcane && amount > 0 && target !== ctx.seat && !ctx.getCounter(key)) { ctx.setCounter(key, 1); ctx.gainLife(ctx.seat, 1); } } },
  "war cry of themis|2": {
    onPlay: (ctx) => buffNextAttack(ctx, { attack: 4, appliesToSubtype: "angel" }),
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      variableBanishSoulCost: {
        counterKey: "warCryThemisX",
        prompt: "Choose X cards to banish from your soul",
      },
      label: "Discard: turn X banished cards face-down",
      onActivate(ctx) {
        const remaining = ctx.getCounter("warCryThemisX");
        if (remaining <= 0) return;
        const targets = ctx.state.players.flatMap((player) =>
          player.banish.filter((card) => !card.faceDown),
        );
        if (targets.length) {
          ctx.requestCardChoice(
            "war-cry-themis-target",
            `Choose banished card 1 of ${remaining} to turn face-down`,
            targets.map((card) => card.instanceId),
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "war-cry-themis-target") return;
      const chosen = ctx.state.players.flatMap((player) => player.banish)
        .find((card) => card.instanceId === Number(option) && !card.faceDown);
      if (!chosen || !ctx.setCardFaceDown(chosen.instanceId, true)) return;
      const remaining = ctx.getCounter("warCryThemisX") - 1;
      ctx.setCounter("warCryThemisX", remaining);
      if (remaining <= 0) return;
      const targets = ctx.state.players.flatMap((player) =>
        player.banish.filter((card) => !card.faceDown),
      );
      if (targets.length) {
        ctx.requestCardChoice(
          "war-cry-themis-target",
          `Choose another banished card (${remaining} remaining)`,
          targets.map((card) => card.instanceId),
        );
      }
    },
  },
  "war cry of bellona|2": {
    canPlay: (ctx) => !!ctx.link && ctx.cardData(ctx.link.attackingCard.cardId).name === "Raydn, Duskbane",
    onPlay: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 2 }),
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      variableBanishSoulCost: {
        counterKey: "warCryBellonaX",
        prompt: "Choose X cards to banish from your soul",
      },
      label: "Discard: reflect a weapon's next X or less damage",
      onActivate(ctx) {
        const weapons = ctx.state.players.flatMap((player) => player.weapons);
        if (weapons.length) ctx.requestCardChoice(
          "war-cry-bellona-weapon",
          "Choose a weapon",
          weapons.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "war-cry-bellona-weapon") return;
      const target = ctx.state.players.flatMap((player) =>
        player.weapons.map((card) => ({ player, card })),
      ).find(({ card }) => card.instanceId === Number(option));
      const x = ctx.getCounter("warCryBellonaX");
      if (!target || x <= 0) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: ctx.seat,
        appliesToInstanceId: target.card.instanceId,
        preventNextDamageAmount: x,
        maxDamageEventAmount: x,
        reflectPreventedDamageToSeat: target.player.seat,
        reflectPreventedDamageUnpreventable: true,
      });
    },
  },
  "cull|1": bloodDebt({
    staticPlayableFrom: ["banish"],
    playAsInstant: (ctx) => ctx.state.players.some(
      (player) => player.flags.lostLifeThisTurn === true,
    ),
    onPlay(ctx) {
      for (const player of ctx.state.players) {
        if (player.hand.length) {
          ctx.banish(player.hand[ctx.randomInt(player.hand.length)]!.instanceId);
        }
      }
    },
    graveyardReplacement: "banish",
  }),
} satisfies Record<string, CardScript>);
