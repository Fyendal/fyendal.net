import type { CardInstance, CardScript, DeepReadonly, ScriptCtx, TriggerDef, TriggerTarget } from "@fyendal/engine";
import type { GameMessage } from "@fyendal/shared";
import {
  armDelayedEffect,
  attackAbility,
  bloodDebtScript as bloodDebt,
  buffNextAttack,
  cardNamed,
  commonOptionMessages,
  consumeDelayedEffect,
  decisionMessage,
  decisionPrompt,
  entersArenaTrigger,
  markedStealthHeroScript,
  markContractCompleted,
  localizedCardLog,
  offerRetrieveDagger,
  opponentSeat,
  pendingDelayedEffect,
  previousAttackNameContains,
  resolveRetrieveDagger,
  retrievableDaggerIds,
  yesNoPrompt,
  ongoingLabel,
} from "./shared-helpers.js";

// HNT — The Hunted. Mark/Contract (CR 8.4.7, 8.5.39, 8.5.50, 9.3),
// Retrieve (CR 8.5.51), and Draconic chain-link counting are shared mechanics.
const GRAPHENE = "HNT053";
const FEALTY = "HNT167";
const SPUR_NUMBERS = ["1", "2", "3", "4", "5", "6"];

function spurNumberPrompt() {
  return decisionPrompt("Secretly choose a number between 1 and 6", "card.hnt.spurlocked.number.choose");
}

function dataTags(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): readonly string[] {
  return ctx.cardTypes(card);
}

function equipmentCards(ctx: ScriptCtx, seat: number): DeepReadonly<CardInstance>[] {
  const player = ctx.player(seat);
  return [
    ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined),
    ...player.weapons.filter((card) => ctx.cardData(card.cardId).cardType === "equipment"),
  ];
}

function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return dataTags(ctx, card).includes("dagger");
}

function hitWithDaggerThisChain(ctx: ScriptCtx): boolean {
  return ctx.state.chain.some(
    (link) =>
      link.attacker === ctx.seat &&
      ((link.damage > 0 && isDagger(ctx, link.attackingCard)) ||
        Number(link.flags["effectDamageBySubtype:dagger"]) > 0),
  );
}

function isDraconic(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return dataTags(ctx, card).includes("draconic");
}

function hasKeyword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, keyword: string): boolean {
  const normalized = keyword.toLowerCase();
  if ((card.suppressedKeywords ?? []).some((entry) => entry.toLowerCase() === normalized)) return false;
  return [...(ctx.cardData(card.cardId).keywords ?? []), ...(card.grantedKeywords ?? [])].some(
    (entry) => entry.toLowerCase() === normalized,
  );
}

function attacksHero(ctx: ScriptCtx): boolean {
  return ctx.link?.targetAllyId === undefined;
}

/** "When this attacks …" — a triggered layer above the attack, not an
 * immediate declaration hook. */
function attackTrigger(
  label: string,
  labelMessage: GameMessage,
  effect: (ctx: ScriptCtx) => void,
  condition: (ctx: ScriptCtx) => boolean = () => true,
): TriggerDef {
  return { event: "attack-declared", sourceZone: "self", label, labelMessage, condition, effect };
}

function isMarked(ctx: ScriptCtx, seat: number): boolean {
  return (ctx.player(seat).hero.scriptState?.marked ?? 0) > 0;
}

function markHero(ctx: ScriptCtx, seat: number): void {
  const hero = ctx.player(seat).hero;
  if ((hero.scriptState?.marked ?? 0) > 0) return;
  ctx.addCardState(hero.instanceId, "marked", 1);
  ctx.logPublic(
    localizedCardLog(ctx, `${ctx.cardData(hero.cardId).name} is marked`, "card.log.common.hero.marked", {
      target: { kind: "card", cardId: hero.cardId },
    }),
  );
}

function loseLifeAndLog(ctx: ScriptCtx, targetSeat: number, amount: number): void {
  ctx.loseLife(targetSeat, amount);
  const target = ctx.player(targetSeat);
  ctx.logPublic(
    localizedCardLog(
      ctx,
      `${ctx.cardData(target.heroCardId).name} loses ${amount} life (${target.life} life)`,
      "card.log.common.hero.life.lost",
      { target: { kind: "player", seat: targetSeat }, amount, life: target.life },
    ),
  );
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
  return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat && isDagger(ctx, ctx.link.attackingCard);
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

const LONG_WHISKER_MODES = ["+2 attack", "additional attack", "mark on hit"] as const;

function isLongWhiskerMode(mode: string): mode is (typeof LONG_WHISKER_MODES)[number] {
  return LONG_WHISKER_MODES.some((candidate) => candidate === mode);
}

function longWhiskerModeBit(mode: (typeof LONG_WHISKER_MODES)[number]): number {
  if (mode === "+2 attack") return 1;
  if (mode === "additional attack") return 2;
  if (mode === "mark on hit") return 4;
  return 0;
}

function longWhiskerOptionMessages(): Record<(typeof LONG_WHISKER_MODES)[number], ReturnType<typeof decisionMessage>> {
  return {
    "+2 attack": decisionMessage("card.hnt.longwhisker.option.attack"),
    "additional attack": decisionMessage("card.hnt.longwhisker.option.additionalattack"),
    "mark on hit": decisionMessage("card.hnt.longwhisker.option.mark"),
  };
}

function requestLongWhiskerTarget(ctx: ScriptCtx): void {
  const modes = ctx.getState("longWhiskerModes");
  const daggers = daggerOptions(ctx);
  if ((modes & 2) !== 0 && ctx.getState("longWhiskerAdditionalAttackTarget") === 0) {
    ctx.requestCardChoice(
      "long-whisker-additional-attack-target",
      decisionPrompt(
        "Long Whisker Loyalty: choose a dagger to attack an additional time",
        "card.hnt.longwhisker.dagger.additionalattack",
      ),
      daggers,
    );
    return;
  }
  if ((modes & 4) !== 0 && ctx.getState("longWhiskerMarkTarget") === 0) {
    ctx.requestCardChoice(
      "long-whisker-mark-target",
      decisionPrompt("Long Whisker Loyalty: choose a dagger to mark on hit", "card.hnt.longwhisker.dagger.mark"),
      daggers,
    );
  }
}

function longWhiskerTarget(ctx: ScriptCtx, stateKey: string): DeepReadonly<CardInstance> | undefined {
  const targetId = ctx.getState(stateKey);
  return ctx.player(ctx.seat).weapons.find((card) => card.instanceId === targetId && isDagger(ctx, card));
}

function currentAttackDraconic(ctx: ScriptCtx): boolean {
  return ctx.currentAttackHasType("draconic");
}

function draconicAttackLinkIndexes(ctx: ScriptCtx): number[] {
  return ctx.state.chain.flatMap((link, index) =>
    link.flags.attackGone !== true && ctx.chainLinkAttackHasType(index, "draconic") ? [index] : [],
  );
}

function equippedSelf(ctx: ScriptCtx): DeepReadonly<CardInstance> | undefined {
  return Object.values(ctx.player(ctx.seat).equipment).find((card) => card?.instanceId === ctx.self.instanceId);
}

function offerBloodSplatteredVest(ctx: ScriptCtx): void {
  if (!equippedSelf(ctx)) return;
  ctx.requestChoice(
    "blood-splattered-vest",
    yesNoPrompt("Blood Splattered Vest: gain 1 resource and add a stain counter?", "card.hnt.vest.resource.stain"),
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
  return ctx.playedThisTurn("red") >= 2;
}

function daggerOptions(ctx: ScriptCtx): number[] {
  return ctx
    .player(ctx.seat)
    .weapons.filter((card) => isDagger(ctx, card))
    .map((card) => card.instanceId);
}

/** Every dagger you control: weapons, dagger permanents, and dagger attack
 * cards still on the combat chain. */
function controlledDaggerOptions(ctx: ScriptCtx): number[] {
  const player = ctx.player(ctx.seat);
  const candidates = [
    ...player.weapons,
    ...player.board,
    ...ctx.state.chain
      .filter((link) => link.attacker === ctx.seat && link.flags.attackGone !== true)
      .map((link) => link.attackingCard),
  ];
  return candidates
    .filter((card) => isDagger(ctx, card))
    .map((card) => card.instanceId)
    .filter((instanceId, index, ids) => ids.indexOf(instanceId) === index);
}

function offLinkDaggerOptions(ctx: ScriptCtx): number[] {
  const activeAttackId = ctx.link?.attackingCard.instanceId;
  return daggerOptions(ctx).filter((instanceId) => instanceId !== activeAttackId);
}

function daggerDealsDamage(ctx: ScriptCtx, instanceId: number): void {
  const dagger = ctx.player(ctx.seat).weapons.find((card) => card.instanceId === instanceId);
  if (!dagger || !isDagger(ctx, dagger)) return;
  ctx.dealDamage(opponentSeat(ctx), 1, {
    sourceInstanceId: dagger.instanceId,
    countsAsHit: true,
  });
  ctx.destroyPermanent(dagger.instanceId);
}

const OPTIONAL_DAGGER_TARGET: TriggerTarget = {
  options: daggerOptions,
  prompt: (ctx) =>
    decisionPrompt(
      `${ctx.data.name}: choose a dagger to deal 1 damage, then destroy it`,
      "card.hnt.dagger.damage.destroy",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 },
        optionMessages: commonOptionMessages("pass"),
      },
    ),
  optional: true,
};

function daggerDamageAttack(condition: (ctx: ScriptCtx) => boolean = () => true): CardScript {
  const trigger = attackTrigger(
    "You may have target dagger deal 1 damage to the defending hero",
    decisionMessage("card.trigger.common.dagger.damage.defender", { amount: 1 }),
    (ctx) => {
      if (ctx.playTargetInstanceId !== undefined) daggerDealsDamage(ctx, ctx.playTargetInstanceId);
    },
    (ctx) => attacksHero(ctx) && condition(ctx),
  );
  return { triggers: [{ ...trigger, target: OPTIONAL_DAGGER_TARGET }] };
}

function availableDraconicDaggers(ctx: ScriptCtx): number[] {
  return retrievableDaggerIds(ctx).filter((instanceId) => {
    const card = ctx.player(ctx.seat).graveyard.find((candidate) => candidate.instanceId === instanceId);
    return !!card && isDraconic(ctx, card);
  });
}

function stealthPump(pump: number): CardScript {
  return {
    modifyPlayCost: (ctx, base) => (isMarked(ctx, opponentSeat(ctx)) ? base - 1 : base),
    canPlay: (ctx) =>
      !!ctx.link && ctx.link.attacker === ctx.seat && hasKeyword(ctx, ctx.link.attackingCard, "stealth"),
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

function createFealtyTrigger(condition: (ctx: ScriptCtx) => boolean): TriggerDef {
  return attackTrigger(
    "Create a Fealty token",
    decisionMessage("card.trigger.common.fealty.create"),
    (ctx) => ctx.createToken(FEALTY),
    condition,
  );
}

function fireTenetStrikeFirstTrigger(): TriggerDef {
  return attackTrigger(
    "Your next Draconic attack this combat chain gets +1 power",
    decisionMessage("card.trigger.common.nextattack.draconic.attack", { amount: 1 }),
    (ctx) => buffNextAttack(ctx, { attack: 1, appliesToSubtype: "draconic", expiresOnChainClose: true }),
  );
}

function pickUpThePointTrigger(hook: string): TriggerDef {
  return attackTrigger(
    "You may retrieve a dagger from your graveyard",
    decisionMessage("card.trigger.common.dagger.retrieve"),
    (ctx) => offerRetrieveDagger(ctx, hook),
  );
}

function soundTheAlarm(ctx: ScriptCtx): void {
  const target = opponentSeat(ctx);
  const hand = ctx.player(target).hand;
  if (
    hand.length > 0 &&
    !ctx.revealCards(
      hand.map((card) => card.instanceId),
      target,
    )
  )
    return;
  if (!hand.some((card) => ctx.cardData(card.cardId).cardType === "attack-reaction")) return;
  const reactions = ctx
    .player(ctx.seat)
    .deck.filter((card) => ctx.cardData(card.cardId).cardType === "defense-reaction");
  if (reactions.length)
    ctx.requestCardChoice(
      "sound-alarm",
      decisionPrompt("Search for a defense reaction?", "card.hnt.defensereaction.search", {
        optionMessages: commonOptionMessages("pass"),
      }),
      ["pass", ...reactions.map((card) => card.instanceId)],
    );
}

function onePowerGraveyardCards(ctx: ScriptCtx, seat: number): number[] {
  return ctx
    .player(seat)
    .graveyard.filter((card) => ctx.basePower(card) === 1)
    .map((card) => card.instanceId);
}

/** Each repetition is optional and banishes one chosen card from each hero's
 * graveyard; it stops once either graveyard has none left. */
function offerRottenRemains(ctx: ScriptCtx): void {
  const own = onePowerGraveyardCards(ctx, ctx.seat);
  if (own.length === 0 || onePowerGraveyardCards(ctx, opponentSeat(ctx)).length === 0) return;
  ctx.requestCardChoice(
    "rotten-own",
    decisionPrompt("Banish a card with 1 power from your graveyard?", "card.hnt.graveyard.power.banish.own", {
      values: { power: 1 },
      optionMessages: commonOptionMessages("pass"),
    }),
    ["pass", ...own],
  );
}

function attackMarkedFealty(): CardScript {
  return { triggers: [createFealtyTrigger((ctx) => attacksHero(ctx) && isMarked(ctx, opponentSeat(ctx)))] };
}

function pitchSeries(name: string, factory: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return Object.fromEntries(([1, 2, 3] as const).map((pitch) => [`${name}|${pitch}`, factory(pitch)]));
}

export const hnt: Record<string, CardScript> = {
  // Assassin / marked
  ...pitchSeries("bite", () => daggerDamageAttack()),
  ...pitchSeries("whittle from bone", () => ({
    triggers: [
      attackTrigger(
        "Equip a Graphene Chelicera token",
        decisionMessage("card.trigger.common.graphenechelicera.equip"),
        (ctx) => ctx.equipToken(GRAPHENE),
        (ctx) => attacksHero(ctx) && isMarked(ctx, opponentSeat(ctx)),
      ),
    ],
  })),
  "stains of the redback|2": stealthPump(2),
  "stains of the redback|3": stealthPump(1),
  "orb-weaver spinneret|2": {
    onPlay(ctx) {
      ctx.equipToken(GRAPHENE);
      buffNextAttack(ctx, { attack: 2, appliesToKeyword: "stealth" });
    },
  },
  "orb-weaver spinneret|3": {
    onPlay(ctx) {
      ctx.equipToken(GRAPHENE);
      buffNextAttack(ctx, { attack: 1, appliesToKeyword: "stealth" });
    },
  },
  "defang the dragon|1": {
    canTriggerOnHit(ctx) {
      return hitMarkedHero(ctx) && heroIs(ctx, opponentSeat(ctx), "Fang");
    },
    onHit(ctx) {
      markContractCompleted(ctx);
      ctx.drawCards(ctx.seat, 1);
    },
  },
  "extinguish the flames|1": {
    canTriggerOnHit(ctx) {
      return hitMarkedHero(ctx) && heroIs(ctx, opponentSeat(ctx), "Cindra");
    },
    onHit(ctx) {
      markContractCompleted(ctx);
      ctx.drawCards(ctx.seat, 1);
    },
  },
  "mark of the black widow|2": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length)
        ctx.requestCardChoice(
          "hnt-black-widow",
          decisionPrompt("Banish a card from your hand", "card.hnt.hand.card.banish"),
          hand.map((card) => card.instanceId),
          opponentSeat(ctx),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "hnt-black-widow") ctx.banish(Number(option));
    },
  },
  "mark of the funnel web|2": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      const card = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (card) {
        ctx.setCardFaceDown(card.instanceId, false);
        ctx.banish(card.instanceId);
      }
    },
  },
  "mark of the funnel web|3": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      const card = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (card) {
        ctx.setCardFaceDown(card.instanceId, false);
        ctx.banish(card.instanceId);
      }
    },
  },
  "mark the prey|2": markOnHit(),
  "mark the prey|3": markOnHit(),
  ...pitchSeries("plunge the prospect", () => ({ modifyAttack: (ctx) => (isMarked(ctx, opponentSeat(ctx)) ? 1 : 0) })),
  "reaper's call|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)),
    },
  },
  "reaper's call|2": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)),
    },
  },
  ...pitchSeries("scuttle the canal", () => ({
    onAttackDeclared(ctx) {
      if (isMarked(ctx, opponentSeat(ctx))) ctx.grantGoAgain();
    },
  })),
  "hunted or hunter|1": {
    canTriggerOnDefend: (ctx) => !!ctx.link && ctx.link.flags[`reactionBySeat:${ctx.link.attacker}`] === true,
    onDefend(ctx) {
      if (ctx.link) ctx.loseLife(ctx.link.attacker, 1);
    },
  },

  // Cindra / Draconic Ninja
  "cindra|0": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      ctx.createToken(FEALTY);
    },
    onFriendlyEffectHitCondition(_ctx, _source, _targetSeat, targetWasMarked) {
      return targetWasMarked;
    },
    onFriendlyEffectHit(ctx) {
      ctx.createToken(FEALTY);
    },
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      modifyCost: (ctx, base) => base - draconicLinks(ctx),
      canActivate: (ctx) => availableDraconicDaggers(ctx).length > 0,
      onActivate(ctx) {
        ctx.requestCardChoices(
          "cindra-equip",
          decisionPrompt("Equip up to 2 Draconic daggers from your graveyard", "card.hnt.draconicdagger.equip.upto", {
            values: { count: 2 },
          }),
          availableDraconicDaggers(ctx),
          0,
          2,
        );
      },
    },
    onChooseMany(ctx, hook, options) {
      if (hook !== "cindra-equip") return;
      const chosen = new Set(options);
      const daggers = ctx
        .player(ctx.seat)
        .graveyard.filter((card) => chosen.has(String(card.instanceId)) && isDagger(ctx, card) && isDraconic(ctx, card))
        .map((card) => card.instanceId);
      for (const id of daggers) if (!ctx.equipFromGraveyard(id)) return;
    },
  },
  "kunai of retribution|0": {
    activated: attackAbility(1, { goAgain: true }),
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId)
        ctx.setFlag("link", "destroyAttackerOnChainClose", true);
    },
  },
  "demonstrate devotion|1": {
    onAttackDeclared(ctx) {
      if (draconicLinks(ctx) >= 2) ctx.grantGoAgain();
    },
    triggers: [createFealtyTrigger((ctx) => attacksHero(ctx) && draconicLinks(ctx) >= 2)],
  },
  "wrath of retribution|1": {
    modifyPlayCost: (ctx, base) => base - draconicLinks(ctx),
    triggers: [
      attackTrigger(
        "Daggers get +1 power and cost 1 less to activate this combat chain",
        decisionMessage("card.trigger.common.dagger.attack.discount", { amount: 1, cost: 1 }),
        (ctx) => {
          ctx.addModifier({ scope: "combat-chain", attack: 1, appliesToSubtype: "dagger" });
          ctx.addModifier({ scope: "combat-chain", attackActivationCostReduction: 1, appliesToSubtype: "dagger" });
        },
      ),
    ],
  },
  "blood drop|1": { modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "blood line|1": { modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "burning blade dance|1": {
    onAttackDeclared(ctx) {
      if (draconicLinks(ctx) >= 2) ctx.grantGoAgain();
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && draconicLinks(ctx) >= 2;
    },
    onHitTarget: OPTIONAL_DAGGER_TARGET,
    onHit(ctx) {
      if (ctx.playTargetInstanceId !== undefined) daggerDealsDamage(ctx, ctx.playTargetInstanceId);
    },
  },
  "mark with magma|1": {
    onAttackDeclared(ctx) {
      if (draconicLinks(ctx) >= 2) ctx.grantGoAgain();
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && draconicLinks(ctx) >= 2;
    },
    onHit(ctx) {
      markHero(ctx, opponentSeat(ctx));
    },
  },
  "art of the dragon: claw|1": {
    triggers: [
      attackTrigger(
        "Gain \"When this hits a hero, destroy all cards in their arsenal\"",
        decisionMessage("card.trigger.common.onhit.arsenal.destroy.gain"),
        (ctx) => ctx.setFlag("link", "hntArtClaw", true),
        currentAttackDraconic,
      ),
    ],
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "hntArtClaw") === true;
    },
    onHit(ctx) {
      for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal");
    },
  },
  "art of the dragon: scale|1": {
    triggers: [
      attackTrigger(
        "Gain \"When this hits a hero, put a -1 defense counter on an equipment they control\"",
        decisionMessage("card.trigger.common.onhit.equipment.defensecounter.gain", { amount: 1 }),
        (ctx) => ctx.setFlag("link", "hntArtScale", true),
        currentAttackDraconic,
      ),
    ],
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "hntArtScale") === true;
    },
    onHit(ctx) {
      const equipment = equipmentCards(ctx, opponentSeat(ctx));
      if (equipment.length)
        ctx.requestCardChoice(
          "art-scale",
          decisionPrompt("Put a -1 defense counter on equipment", "card.hnt.equipment.defensecounter"),
          equipment.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "art-scale") return;
      const card = equipmentCards(ctx, opponentSeat(ctx)).find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      const oldCounters = card.defCounters ?? 0;
      ctx.addCardDefenseCounters(card.instanceId, 1);
      if (Math.max(0, (ctx.cardData(card.cardId).defense ?? 0) - oldCounters - 1) === 0)
        ctx.destroyPermanent(card.instanceId);
    },
  },
  "dragon power|1": { modifyAttack: (ctx) => (currentAttackDraconic(ctx) ? 3 : 0) },
  "dragon power|2": { modifyAttack: (ctx) => (currentAttackDraconic(ctx) ? 3 : 0) },
  ...pitchSeries("silver talons", () => daggerDamageAttack(currentAttackDraconic)),
  "fire tenet: strike first|2": {
    triggers: [fireTenetStrikeFirstTrigger()],
  },
  "fire tenet: strike first|3": {
    triggers: [fireTenetStrikeFirstTrigger()],
  },
  ...pitchSeries("grow claws", () => ({ modifyAttack: (ctx) => (lastAttackWasDraconic(ctx) ? 1 : 0) })),
  ...pitchSeries("grow wings", () => ({
    onAttackDeclared(ctx) {
      if (lastAttackWasDraconic(ctx)) ctx.grantGoAgain();
    },
  })),
  ...pitchSeries("tag the target", () => markOnHit()),
  ...pitchSeries("trap and release", () => markOnHit()),

  // Fang / Draconic Warrior
  "fang|0": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      ctx.createToken(FEALTY);
    },
    onFriendlyEffectHitCondition(_ctx, _source, _targetSeat, targetWasMarked) {
      return targetWasMarked;
    },
    onFriendlyEffectHit(ctx) {
      ctx.createToken(FEALTY);
    },
    modifyAttackActivationCost(ctx, attacker, base) {
      const fealty = ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Fealty")).length;
      return fealty >= 3 && isDagger(ctx, attacker) ? base - 1 : base;
    },
  },
  "obsidian fire vein|0": {
    activated: attackAbility(1),
    modifyAttack(ctx) {
      return ctx.link?.attackingCard.instanceId === ctx.self.instanceId && ctx.getFlag("link", "playedType:draconic")
        ? 1
        : 0;
    },
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId && ctx.getFlag("link", "playedType:draconic"))
        ctx.grantGoAgain();
    },
    onFriendlyPlay(ctx, played) {
      if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId && isDraconic(ctx, played)) ctx.grantGoAgain();
    },
  },
  "affirm loyalty|1": {
    ...daggerReaction(2),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 2 });
      if (draconicLinks(ctx) >= 2) ctx.createToken(FEALTY);
    },
  },
  "endear devotion|1": {
    ...daggerReaction(3),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      if (draconicLinks(ctx) >= 2) ctx.createToken(FEALTY);
    },
  },
  "fire and brimstone|1": {
    canPlay: currentDaggerAttack,
    modifyPlayCost: (ctx, base) => base - draconicLinks(ctx),
    onPlay(ctx) {
      ctx.addModifier({ scope: "combat-chain", attack: 1, appliesToSubtype: "dagger" });
      for (const dagger of ctx.player(ctx.seat).weapons.filter((card) => isDagger(ctx, card)))
        ctx.grantAdditionalActivation(dagger.instanceId);
    },
  },
  "blistering blade|1": {
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: draconicLinks(ctx) >= 2 ? 3 : 2 });
    },
  },
  "brothers of flame|1": {
    canPlay: (ctx) => currentDaggerAttack(ctx) && draconicLinks(ctx) >= 2,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 4 });
    },
  },
  "dynastic dedication|1": { ...daggerReaction(3), modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "imperial intent|1": { ...daggerReaction(2), modifyPlayCost: (ctx, base) => base - draconicLinks(ctx) },
  "scalding iron|1": {
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: draconicLinks(ctx) });
    },
  },
  "searing gaze|1": {
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 2, ...(draconicLinks(ctx) >= 2 ? { onHitMark: true } : {}) });
    },
  },
  "sisters of fire|1": {
    canPlay: (ctx) => currentDaggerAttack(ctx) && draconicLinks(ctx) >= 2,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
    },
  },
  "sizzling steel|1": {
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: draconicLinks(ctx) >= 2 ? 4 : 3 });
    },
  },
  "stabbing pain|1": {
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3, ...(draconicLinks(ctx) >= 2 ? { onHitMark: true } : {}) });
    },
  },
  ...pitchSeries("diced", (pitch) => ({
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      buffNextAttack(ctx, { attack: 4 - pitch, appliesToSubtype: "dagger" });
    },
  })),
  ...pitchSeries("twist and turn", (pitch) => nextDagger(5 - pitch, { reenable: true })),
  "agility stance|2": {
    triggers: [
      {
        event: "start-of-turn",
        label: "Dagger attacks gain go again",
        effect(ctx) {
          ctx.destroySelf();
          ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToSubtype: "dagger" });
        },
      },
    ],
  },
  "flurry stance|1": {
    triggers: [
      {
        event: "start-of-turn",
        label: "Additional dagger attacks",
        effect(ctx) {
          ctx.destroySelf();
          for (const dagger of ctx.player(ctx.seat).weapons.filter((card) => isDagger(ctx, card)))
            ctx.grantAdditionalActivation(dagger.instanceId);
        },
      },
    ],
  },
  "power stance|3": {
    triggers: [
      {
        event: "start-of-turn",
        label: "Dagger attacks get +1",
        effect(ctx) {
          ctx.destroySelf();
          ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToSubtype: "dagger" });
        },
      },
    ],
  },
  ...pitchSeries("cut deep", (pitch) => nextDagger(5 - pitch)),
  ...pitchSeries("hunt a killer", (pitch) => nextDagger(5 - pitch, { mark: true })),
  ...pitchSeries("knife through butter", (pitch) => ({
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 5 - pitch, appliesToSubtype: "dagger" });
      ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToMarkedHero: true });
    },
  })),
  ...pitchSeries("point of engagement", (pitch) => ({
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4 - pitch, appliesToSubtype: "dagger" });
      ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToMarkedHero: true });
    },
  })),
  ...pitchSeries("sworn vengeance", (pitch) => nextDagger(4 - pitch, { mark: true })),
  "vow of vengeance|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.link?.targetAllyId === undefined && heroIsArakni(ctx, opponentSeat(ctx)),
      onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)),
    },
  },
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
  "hand of vengeance|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.link?.targetAllyId === undefined && heroIsArakni(ctx, opponentSeat(ctx)),
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link", attack: 1 });
      },
    },
  },
  "path of vengeance|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.link?.targetAllyId === undefined && heroIsArakni(ctx, opponentSeat(ctx)),
      onActivate: (ctx) => ctx.grantGoAgain(),
    },
  },
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
  "hunt to the ends of rathe|1": {
    triggers: [
      attackTrigger(
        "Mark the defending hero",
        decisionMessage("card.trigger.common.defender.mark"),
        (ctx) => markHero(ctx, opponentSeat(ctx)),
        (ctx) => attacksHero(ctx) && heroIsArakni(ctx, opponentSeat(ctx)),
      ),
    ],
    modifyAttack: (ctx) => (isMarked(ctx, opponentSeat(ctx)) ? 2 : 0),
  },
  "march of loyalty|1": {
    hasConditionalGoAgain: (ctx) => ctx.getFlag("player", "createdName:fealty") === true,
  },
  "bubble to the surface|1": {
    modifyPlayCost: (ctx, base) => base - draconicLinks(ctx),
    onPlay(ctx) {
      const revealed = [];
      for (const card of ctx.player(ctx.seat).deck) {
        revealed.push(card);
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.data.name} reveals ${ctx.cardData(card.cardId).name}`,
            "card.log.common.decktop.revealed",
            { revealed: { kind: "card", cardId: card.cardId } },
            { kind: "cards-revealed", cards: [{ cardId: card.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" },
          ),
        );
        if ((ctx.cardData(card.cardId).pitch ?? 0) === 1) break;
      }
      const red = revealed.find((card) => (ctx.cardData(card.cardId).pitch ?? 0) === 1);
      if (red) {
        ctx.banish(red.instanceId);
        ctx.allowPlayFrom(red.instanceId, "banish");
      }
      ctx.shuffleDeck();
    },
  },
  "drop of dragon blood|1": {
    modifyPlayCost: (ctx, base) => base - draconicLinks(ctx),
    onPlay(ctx) {
      ctx.changeResources(ctx.seat, 1);
      ctx.drawCards(ctx.seat, 1);
    },
  },
  "rake over the coals|1": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToSubtype: "draconic" });
    },
  },
  "for the dracai|1": attackMarkedFealty(),
  "for the emperor|1": attackMarkedFealty(),
  "for the realm|1": attackMarkedFealty(),
  "hunt the hunter|1": {
    triggers: [
      attackTrigger(
        "Mark the defending hero",
        decisionMessage("card.trigger.common.defender.mark"),
        (ctx) => markHero(ctx, opponentSeat(ctx)),
        (ctx) => attacksHero(ctx) && playedAnotherRed(ctx),
      ),
    ],
  },
  "smoke out|1": {
    canTriggerOnDefend: (ctx) => !!ctx.link && (ctx.cardData(ctx.link.attackingCard.cardId).pitch ?? 0) === 1,
    onDefend(ctx) {
      if (ctx.link) markHero(ctx, ctx.link.attacker);
    },
  },
  "blessing of vynserakai|1": {
    triggers: [
      {
        event: "start-of-turn",
        label: "Next attack is Draconic and +3",
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, { attack: 3, grantType: "draconic" });
        },
      },
    ],
  },
  "pledge fealty|1": {
    onPlay: (ctx) => {
      ctx.createToken(FEALTY);
    },
  },
  "proclaim vengeance|1": {
    onPlay(ctx) {
      const target = opponentSeat(ctx);
      markHero(ctx, target);
      if (heroIsArakni(ctx, target)) ctx.changeResources(ctx.seat, 1);
    },
  },
  "tooth of the dragon|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "draconic" });
    },
  },

  // Assassin hybrids
  ...Object.fromEntries(
    ["leap frog vocal sac", "leap frog slime skin", "leap frog gloves", "leap frog leggings"].map((name) => [
      `${name}|0`,
      {
        triggers: [
          {
            event: "attack-reaction" as const,
            whose: "any" as const,
            optional: true,
            label: "Add this to the active chain link as a defending card",
            condition: (ctx: ScriptCtx) => ctx.link?.attacker !== ctx.seat,
            effect: (ctx: ScriptCtx) => {
              ctx.addSelfAsDefender();
            },
          },
        ],
      },
    ]),
  ),
  ...pitchSeries("cut through", () => ({
    modifyAttack: (ctx) => (hitWithDaggerThisChain(ctx) ? 1 : 0),
    hasConditionalGoAgain: (ctx) => hitWithDaggerThisChain(ctx),
  })),
  "up sticks and run|1": {
    onPlay(ctx) {
      offerRetrieveDagger(ctx, "up-sticks-1");
      buffNextAttack(ctx, { attack: 4, appliesToSubtype: "dagger" });
    },
    onChoose(ctx, hook, option) {
      resolveRetrieveDagger(ctx, hook, option, "up-sticks-1");
    },
  },
  "up sticks and run|2": {
    onPlay(ctx) {
      offerRetrieveDagger(ctx, "up-sticks-2");
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "dagger" });
    },
    onChoose(ctx, hook, option) {
      resolveRetrieveDagger(ctx, hook, option, "up-sticks-2");
    },
  },
  "up sticks and run|3": {
    onPlay(ctx) {
      offerRetrieveDagger(ctx, "up-sticks-3");
      buffNextAttack(ctx, { attack: 2, appliesToSubtype: "dagger" });
    },
    onChoose(ctx, hook, option) {
      resolveRetrieveDagger(ctx, hook, option, "up-sticks-3");
    },
  },
  "pick up the point|1": {
    triggers: [pickUpThePointTrigger("pick-point-1")],
    onChoose(ctx, hook, option) {
      resolveRetrieveDagger(ctx, hook, option, "pick-point-1");
    },
  },
  "pick up the point|2": {
    triggers: [pickUpThePointTrigger("pick-point-2")],
    onChoose(ctx, hook, option) {
      resolveRetrieveDagger(ctx, hook, option, "pick-point-2");
    },
  },
  "pick up the point|3": {
    triggers: [pickUpThePointTrigger("pick-point-3")],
    onChoose(ctx, hook, option) {
      resolveRetrieveDagger(ctx, hook, option, "pick-point-3");
    },
  },
  ...pitchSeries("poisoned blade", () => ({
    onAttackDeclared(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        expiresOnChainClose: true,
        ...ongoingLabel("whenever a dagger you own hits a hero, they lose 1 life", "card.effect.hnt.poisonedblade"),
      });
    },
    canTriggerOnHit(ctx) {
      return !!ctx.link && isDagger(ctx, ctx.link.attackingCard);
    },
    onHit(ctx) {
      loseLifeAndLog(ctx, opponentSeat(ctx), 1);
    },
    onFriendlyEffectHitCondition(ctx, source) {
      return isDagger(ctx, source);
    },
    onFriendlyEffectHit(ctx, _source, targetSeat) {
      loseLifeAndLog(ctx, targetSeat, 1);
    },
  })),
  ...pitchSeries("throw yourself at them", () => daggerDamageAttack()),
  "red alert visor|0": { modifyDefense: (ctx) => (ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0) },
  "red alert vest|0": { modifyDefense: (ctx) => (ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0) },
  "red alert gloves|0": { modifyDefense: (ctx) => (ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0) },
  "red alert boots|0": { modifyDefense: (ctx) => (ctx.getFlag("link", "reactionPlayedOrActivated") ? 1 : 0) },
  "starting point|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("link", `reactionBySeat:${ctx.seat}`) === true,
      onActivate: (ctx) => ctx.grantGoAgain(),
    },
  },
  ...pitchSeries("to the point", (pitch) => ({
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 4 - pitch + (isMarked(ctx, opponentSeat(ctx)) ? 1 : 0) });
    },
  })),
  ...pitchSeries("cut from the same cloth", (pitch) => ({
    onPlay(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      const revealed =
        hand.length === 0 ||
        ctx.revealCards(
          hand.map((card) => card.instanceId),
          target,
        );
      if (revealed && hand.some((card) => ctx.cardData(card.cardId).cardType === "attack-reaction")) {
        markHero(ctx, target);
      }
      buffNextAttack(ctx, { attack: 5 - pitch, appliesToSubtype: "dagger" });
    },
  })),
  ...pitchSeries("incision", (pitch) => daggerReaction(4 - pitch)),
  "scar tissue|2": daggerReaction(2, { mark: true }),
  "scar tissue|3": daggerReaction(1, { mark: true }),
  ...pitchSeries("take a stab", (pitch) => daggerReaction(4 - pitch, { reenableIfMarked: true })),

  // Generic
  "bunker beard|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "defense-reaction",
      destroySelfCost: true,
      canActivate: (ctx) =>
        !!ctx.player(ctx.seat).arsenal[0] && ctx.hasCardType(ctx.player(ctx.seat).arsenal[0]!, "action"),
      onActivate(ctx) {
        const card = ctx.player(ctx.seat).arsenal[0];
        if (card) ctx.addDefenderFromArsenal(card.instanceId);
      },
    },
  },
  "pursue to the edge of oblivion|1": markOnHit(),
  "pursue to the pits of despair|1": markOnHit(),
  "sound the alarm|1": {
    triggers: [
      attackTrigger(
        "The defending hero reveals their hand",
        decisionMessage("card.trigger.common.defender.hand.reveal"),
        soundTheAlarm,
        attacksHero,
      ),
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "sound-alarm" || option === "pass") return;
      const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.logPublic(
        localizedCardLog(
          ctx,
          `${ctx.cardData(card.cardId).name} is revealed`,
          "card.log.common.card.revealed",
          { revealed: { kind: "card", cardId: card.cardId } },
          { kind: "cards-revealed", cards: [{ cardId: card.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" },
        ),
      );
      ctx.shuffleDeck();
      ctx.putOnDeckTop(card.instanceId);
    },
  },
  "imperial seal of command|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.setPlayerFlag(ctx.seat, "noDefenseReactionsThisTurn", true);
        if (dataTags(ctx, ctx.player(ctx.seat).hero).includes("royal"))
          armDelayedEffect(
            ctx,
            ongoingLabel(
              "destroy all cards in their arsenal the next time you hit a hero",
              "card.effect.hnt.imperialsealofcommand",
            ),
          );
      },
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && !!pendingDelayedEffect(ctx);
    },
    onHit(ctx) {
      for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.banish(card.instanceId);
      consumeDelayedEffect(ctx);
    },
  },
  "relentless pursuit|3": {
    onPlay(ctx) {
      markHero(ctx, opponentSeat(ctx));
      if (ctx.getFlag("player", "attackedHeroThisTurn")) ctx.putOnDeckBottom(ctx.self.instanceId);
    },
  },
  "calming breeze|1": { onPlay: (ctx) => ctx.preventNextDamageEvents(ctx.seat, 1, 3) },
  ...pitchSeries("tip-off", () => ({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate: (ctx) => markHero(ctx, opponentSeat(ctx)),
    },
  })),
  "outed|1": {
    canPlay: (ctx) => !isMarked(ctx, ctx.seat),
    modifyAttack: (ctx) => (isMarked(ctx, opponentSeat(ctx)) ? 1 : 0),
  },
  "lay low|2": { canPlay: (ctx) => !isMarked(ctx, ctx.seat) },
  "exposed|3": {
    canPlay: (ctx) => !isMarked(ctx, ctx.seat),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      markHero(ctx, opponentSeat(ctx));
    },
  },
  ...pitchSeries("public bounty", (pitch) => ({
    onPlay(ctx) {
      markHero(ctx, opponentSeat(ctx));
      buffNextAttack(ctx, { attack: 4 - pitch, appliesToMarkedHero: true });
    },
  })),
};

hnt["cindra, dracai of retribution|0"] = hnt["cindra|0"]!;
hnt["fang, dracai of blades|0"] = hnt["fang|0"]!;

const AGENTS = ["HNT003", "HNT004", "HNT005", "HNT006", "HNT007", "HNT008"] as const;
const randomAgent = (ctx: ScriptCtx) => ctx.becomeHero(AGENTS[ctx.randomInt(AGENTS.length)]!);
Object.assign(hnt, {
  "schism of chaos|3": {
    triggers: [
      {
        event: "card-pitched",
        sourceZone: "pitch",
        label: "Each hero shuffles and arsenals their top card",
        condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId,
        effect(ctx) {
          for (const player of ctx.state.players) {
            ctx.shuffleDeck(player.seat);
            const top = ctx.player(player.seat).deck[0];
            if (top) ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false });
          }
        },
      },
    ],
  },
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
        decisionPrompt("Mask of Deceit: choose an Agent of Chaos", "card.hnt.agentofchaos.choose"),
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
  "under the trap-door|3": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate(ctx) {
        const traps = ctx.player(ctx.seat).graveyard.filter((card) => dataTags(ctx, card).includes("trap"));
        if (traps.length)
          ctx.requestCardChoice(
            "trap-door",
            decisionPrompt("Banish a trap", "card.hnt.trap.banish"),
            traps.map((card) => card.instanceId),
          );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "trap-door" && ctx.banish(Number(option)))
        ctx.allowPlayFrom(Number(option), "banish", { graveyardReplacement: "banish" });
    },
  },
  "tarantula toxin|1": {
    canPlay(ctx) {
      if (!ctx.link || ctx.link.attacker !== ctx.seat) return false;
      const daggerMode = isDagger(ctx, ctx.link.attackingCard);
      const defenseMode =
        hasKeyword(ctx, ctx.link.attackingCard, "stealth") &&
        [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0;
      return daggerMode || defenseMode;
    },
    additionalCost(ctx) {
      if (!ctx.link) return;
      const daggerMode = isDagger(ctx, ctx.link.attackingCard);
      const defenseMode =
        hasKeyword(ctx, ctx.link.attackingCard, "stealth") &&
        [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0;
      if (daggerMode && defenseMode) {
        ctx.requestChoice(
          "tarantula-mode",
          decisionPrompt("Tarantula Toxin: choose 1 or both", "card.hnt.tarantula.mode", {
            optionMessages: {
              "+3 attack": decisionMessage("card.hnt.tarantula.option.attack"),
              "-3 defense": decisionMessage("card.hnt.tarantula.option.defense"),
              both: decisionMessage("common.option.both"),
            },
          }),
          ["+3 attack", "-3 defense", "both"],
        );
      }
    },
    onPlay(ctx) {
      if (!ctx.link) return;
      const daggerMode = isDagger(ctx, ctx.link.attackingCard);
      const defenseMode =
        hasKeyword(ctx, ctx.link.attackingCard, "stealth") &&
        [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0;
      const selectedMode = ctx.getState("tarantulaMode");
      if (daggerMode && (!defenseMode || selectedMode === 1 || selectedMode === 3)) {
        ctx.addModifier({ scope: "chain-link", attack: 3 });
      }
      if (defenseMode && (!daggerMode || selectedMode === 2 || selectedMode === 3)) {
        const defenders = [...ctx.link.defendingCards, ...ctx.link.defendingEquipment];
        ctx.requestCardChoice(
          "toxin-defender",
          decisionPrompt("Give a defender -3 defense", "card.hnt.defender.defense.reduce", { values: { amount: 3 } }),
          defenders.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "tarantula-mode") {
        ctx.setState("tarantulaMode", option === "+3 attack" ? 1 : option === "-3 defense" ? 2 : 3);
        return;
      }
      if (hook === "toxin-defender") ctx.addCardTempDefense(Number(option), -3);
    },
  },
  "anaphylactic shock|3": {
    onPlay(ctx) {
      for (const player of ctx.state.players)
        if (player.seat !== ctx.seat && player.flags.dealtDamageThisTurn === true) ctx.loseLife(player.seat, 1);
    },
  },
  "blood runs deep|1": {
    modifyPlayCost: (ctx, base) => base - draconicLinks(ctx),
    onAttackDeclared: (ctx) => ctx.grantGoAgain(),
    triggers: [
      attackTrigger(
        "Each dagger you control deals 1 damage to the defending hero",
        decisionMessage("card.trigger.common.daggers.damage.defender", { amount: 1 }),
        (ctx) => {
          for (const dagger of ctx.player(ctx.seat).weapons.filter((card) => isDagger(ctx, card))) {
            ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: dagger.instanceId, countsAsHit: true });
            ctx.destroyPermanent(dagger.instanceId);
          }
        },
        attacksHero,
      ),
    ],
  },
  "ignite|1": {
    triggers: [
      {
        event: "attack-declared",
        sourceZone: "self",
        label: "The next Draconic card costs 1 less to play or activate",
        labelMessage: decisionMessage("card.hnt.ignite.discount", { amount: 1 }),
        effect(ctx) {
          ctx.addModifier({
            scope: "combat-chain",
            playCostReduction: 1,
            activationCostReduction: 1,
            appliesToSubtype: "draconic",
            once: true,
          });
        },
      },
    ],
  },
  "art of the dragon: blood|1": {
    triggers: [
      attackTrigger(
        "Gain go again; the next 3 Draconic cards cost 1 less to play",
        decisionMessage("card.trigger.common.goagain.draconic.discount", { count: 3, amount: 1 }),
        (ctx) => {
          ctx.grantGoAgain();
          ctx.addModifier({
            scope: "until-end-of-turn",
            playCostReduction: 1,
            appliesToSubtype: "draconic",
            remainingCostUses: 3,
          });
        },
        currentAttackDraconic,
      ),
    ],
  },
  "devotion never dies|1": {
    canTriggerOnHit: lastAttackWasDraconic,
    onHit(ctx) {
      if (ctx.banish(ctx.self.instanceId)) ctx.allowPlayFrom(ctx.self.instanceId, "banish");
    },
  },
  "prowess of agility|3": {
    onFriendlyAttackDeclared(ctx) {
      if (Number(ctx.getPlayerFlag(ctx.seat, "attacksDeclaredThisTurn")) === 4) {
        ctx.destroySelf();
        ctx.drawCards(ctx.seat, 1);
      }
    },
    triggers: [
      {
        event: "end-of-turn",
        condition: (ctx) => Number(ctx.getPlayerFlag(ctx.seat, "attacksDeclaredThisTurn")) < 3,
        label: "Destroy Prowess of Agility",
        effect: (ctx) => ctx.destroySelf(),
      },
    ],
  },
  "hunt's end|1": {
    canPlay: (ctx) =>
      ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Fealty")).length >= 3 &&
      currentDaggerAttack(ctx),
    onPlay: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 4 }),
  },
  "long whisker loyalty|1": {
    canPlay: currentDaggerAttack,
    additionalCost(ctx) {
      const count = Math.min(LONG_WHISKER_MODES.length, draconicLinks(ctx));
      ctx.setState("longWhiskerModes", 0);
      ctx.setState("longWhiskerModesRemaining", count);
      ctx.setState("longWhiskerAdditionalAttackTarget", 0);
      ctx.setState("longWhiskerMarkTarget", 0);
      if (count > 0) {
        ctx.requestChoice(
          "long-whisker-mode",
          decisionPrompt(
            `Long Whisker Loyalty: choose ${count} mode${count === 1 ? "" : "s"}`,
            "card.hnt.longwhisker.modes.choose",
            { values: { amount: count }, optionMessages: longWhiskerOptionMessages() },
          ),
          [...LONG_WHISKER_MODES],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "long-whisker-mode") {
        if (!isLongWhiskerMode(option)) return;
        const bit = longWhiskerModeBit(option);
        const selected = ctx.getState("longWhiskerModes");
        if ((selected & bit) !== 0) return;
        const modeMessage = longWhiskerOptionMessages()[option];
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.player(ctx.seat).heroCardId).name} chooses ${option} for ${ctx.data.name}`,
            "card.log.hnt.longwhisker.mode.chosen",
            {
              player: { kind: "player", seat: ctx.seat },
              mode: { kind: "term", id: modeMessage.id },
            },
          ),
        );
        const updated = selected | bit;
        const remaining = ctx.getState("longWhiskerModesRemaining") - 1;
        ctx.setState("longWhiskerModes", updated);
        ctx.setState("longWhiskerModesRemaining", remaining);
        if (remaining > 0) {
          ctx.requestChoice(
            "long-whisker-mode",
            decisionPrompt(
              `Long Whisker Loyalty: choose ${remaining} more mode${remaining === 1 ? "" : "s"}`,
              "card.hnt.longwhisker.modes.more",
              { values: { amount: remaining }, optionMessages: longWhiskerOptionMessages() },
            ),
            LONG_WHISKER_MODES.filter((mode) => (updated & longWhiskerModeBit(mode)) === 0),
          );
        } else {
          requestLongWhiskerTarget(ctx);
        }
        return;
      }
      if (hook === "long-whisker-additional-attack-target") {
        ctx.setState("longWhiskerAdditionalAttackTarget", Number(option));
        requestLongWhiskerTarget(ctx);
        return;
      }
      if (hook === "long-whisker-mark-target") {
        ctx.setState("longWhiskerMarkTarget", Number(option));
      }
    },
    onPlay(ctx) {
      if (!ctx.link) return;
      const modes = ctx.getState("longWhiskerModes");
      if (modes & 1) ctx.addModifier({ scope: "chain-link", attack: 2 });
      const additionalAttackTarget = longWhiskerTarget(ctx, "longWhiskerAdditionalAttackTarget");
      if ((modes & 2) !== 0 && additionalAttackTarget) {
        ctx.grantAdditionalActivation(additionalAttackTarget.instanceId);
      }
      if (modes & 4) {
        const markTarget = longWhiskerTarget(ctx, "longWhiskerMarkTarget");
        if (!markTarget) return;
        ctx.addModifier({
          scope: "until-end-of-turn",
          appliesToInstanceId: markTarget.instanceId,
          onHitMark: true,
          once: true,
        });
      }
    },
  },
  "kabuto of imperial authority|0": {
    onDefend(ctx) {
      ctx.setPlayerFlag(opponentSeat(ctx), "cannotAttackWithWeaponsThisTurn", true);
    },
  },
  "jagged edge|1": {
    canPlay: (ctx) => !!ctx.link && ctx.link.attackCardType === "weapon",
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      ctx.setFlag("link", "unpreventable", true);
    },
  },
  "provoke|3": {
    canPlay: (ctx) => !!ctx.link && ctx.link.attackCardType === "weapon",
    onPlay(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (hand.length) {
        ctx.requestCardChoice(
          "provoke-reveal",
          decisionPrompt("Provoke: choose a card to reveal", "card.hnt.provoke.card.reveal"),
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
    onEnterArena(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
    },
    onFriendlyAttackDeclared: grantSharpenedSensesGoAgain,
    onFriendlyAttackPowerGained: grantSharpenedSensesGoAgain,
    triggers: [{ event: "end-of-turn", label: "Destroy Sharpened Senses", effect: (ctx) => ctx.destroySelf() }],
  },
  "dragonscaler flight path|0": {
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      modifyCost: (ctx, base) => base - draconicLinks(ctx),
      canActivate: (ctx) => draconicAttackLinkIndexes(ctx).length > 0,
      onActivate(ctx) {
        const indexes = draconicAttackLinkIndexes(ctx);
        ctx.requestChoice(
          "dragonscaler-flight-path",
          decisionPrompt("Dragonscaler Flight Path: choose a Draconic attack", "card.hnt.draconic.attack.choose"),
          indexes.map((index) => `chain:${index}`),
          ctx.seat,
          indexes.map((index) => ctx.state.chain[index]!.attackingCard.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "dragonscaler-flight-path") return;
      const match = /^chain:(\d+)$/.exec(option);
      const index = match ? Number(match[1]) : -1;
      const link = ctx.state.chain[index];
      if (!link || link.flags.attackGone === true || !ctx.chainLinkAttackHasType(index, "draconic")) return;
      ctx.grantChainLinkGoAgain(index);
      if (link.attackCardType === "weapon" || link.attackCardType === "ally") {
        ctx.grantAdditionalActivation(link.attackingCard.instanceId);
      }
    },
  },
  "oath of loyalty|1": {
    canPlay: (ctx) => Number(ctx.getPlayerFlag(ctx.seat, "actionsPlayedOrActivatedThisTurn")) === 0,
    triggers: [
      {
        event: "card-played",
        sourceZone: "self",
        label: "You may only play Draconic cards this turn",
        effect: (ctx) => ctx.addModifier({ scope: "until-end-of-turn", restrictCardPlaysToType: "draconic" }),
      },
    ],
  },
  "loyalty beyond the grave|1": {
    triggers: [
      {
        event: "start-of-turn",
        sourceZone: "graveyard",
        optional: true,
        label: "Banish two Loyalty Beyond the Grave to draw",
        condition: (ctx) =>
          ctx.player(ctx.seat).graveyard.filter((card) => cardNamed(ctx, card, "Loyalty Beyond the Grave"))
            .length >= 2,
        effect(ctx) {
          for (const card of ctx
            .player(ctx.seat)
            .graveyard.filter((card) => cardNamed(ctx, card, "Loyalty Beyond the Grave"))
            .slice(0, 2))
            ctx.banish(card.instanceId);
          ctx.drawCards(ctx.seat, 1);
        },
      },
    ],
  },
  "blood splattered vest|0": {
    onFriendlyEffectHitCondition(ctx, source) {
      return isDagger(ctx, source);
    },
    onFriendlyEffectHit(ctx) {
      offerBloodSplatteredVest(ctx);
    },
    canTriggerOnHit: (ctx) => !!ctx.link && isDagger(ctx, ctx.link.attackingCard),
    onHit: offerBloodSplatteredVest,
    onChoose(ctx, hook, option) {
      if (hook === "blood-splattered-vest") resolveBloodSplatteredVest(ctx, option);
    },
  },
  "pain in the backside|1": {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHitTarget: {
      options: controlledDaggerOptions,
      prompt: () => decisionPrompt("Choose a dagger", "card.hnt.dagger.choose"),
    },
    onHit(ctx) {
      const id = ctx.playTargetInstanceId;
      if (id === undefined || !controlledDaggerOptions(ctx).includes(id)) return;
      ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: id, countsAsHit: true });
    },
  },
  "throw dagger|3": {
    canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat && offLinkDaggerOptions(ctx).length > 0,
    playTargetOptions: offLinkDaggerOptions,
    onPlay(ctx) {
      const id = ctx.playTargetInstanceId;
      if (id === undefined || !offLinkDaggerOptions(ctx).includes(id)) return;
      if (ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: id, countsAsHit: true }) > 0) {
        ctx.drawCards(ctx.seat, 1);
      }
      ctx.destroyPermanent(id);
    },
  },
  "perforate|2": {
    canPlay: currentDaggerAttack,
    onPlay(ctx) {
      if (ctx.link) {
        ctx.grantAdditionalActivation(ctx.link.attackingCard.instanceId);
        ctx.addModifier({ scope: "until-end-of-turn", attackActivationCostReduction: 1, appliesToSubtype: "dagger" });
      }
      ctx.drawCards(ctx.seat, 1);
    },
  },
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
      if (consumeDelayedEffect(ctx, { match: (modifier) => modifier.onHitDraw === 1 })) ctx.drawCards(ctx.seat, 1);
    },
  },
  "quickdodge flexors|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "defense-reaction",
      onActivate(ctx) {
        ctx.addSelfAsDefender();
        ctx.setCardBaseDefenseForLink(ctx.self.instanceId, 2);
        ctx.destroyAtEndPhase(ctx.self.instanceId);
      },
    },
  },
  "rotten remains|3": {
    triggers: [
      attackTrigger(
        "You may banish a card with 1 power from each hero's graveyard for +1 power, then repeat",
        decisionMessage("card.trigger.common.graveyards.power.banish", { power: 1, amount: 1 }),
        offerRottenRemains,
      ),
    ],
    onChoose(ctx, hook, option) {
      if (hook === "rotten-own") {
        if (option === "pass") return;
        ctx.requestCardChoice(
          `rotten-opponent:${option}`,
          decisionPrompt(
            "Banish a card with 1 power from the opposing hero's graveyard",
            "card.hnt.graveyard.power.banish.opponent",
            { values: { power: 1 } },
          ),
          onePowerGraveyardCards(ctx, opponentSeat(ctx)),
        );
        return;
      }
      if (!hook.startsWith("rotten-opponent:")) return;
      const own = Number(hook.slice("rotten-opponent:".length));
      const theirs = Number(option);
      if (
        !onePowerGraveyardCards(ctx, ctx.seat).includes(own) ||
        !onePowerGraveyardCards(ctx, opponentSeat(ctx)).includes(theirs)
      )
        return;
      ctx.banish(own);
      ctx.banish(theirs);
      ctx.addCardTempPower(ctx.self.instanceId, 1);
      offerRottenRemains(ctx);
    },
  },
  "shelter from the storm|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate: (ctx) => ctx.preventNextDamageEvents(ctx.seat, 1, 3),
    },
  },
  "dual threat|2": {
    onPlay(ctx) {
      if (ctx.getPlayerFlag(ctx.seat, "attackedWithWeaponThisTurn") === true)
        buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action" });
      if (ctx.getPlayerFlag(ctx.seat, "attackedWithAttackActionThisTurn") === true)
        buffNextAttack(ctx, { attack: 3, appliesTo: "weapon" });
    },
  },
  "thick hide hunter|2": {
    triggers: [
      attackTrigger("Discard a random card", decisionMessage("card.trigger.common.card.discard.random"), (ctx) =>
        ctx.discardRandom(ctx.seat, 1),
      ),
    ],
    onDefend: (ctx) => ctx.discardRandom(ctx.seat, 1),
  },
  "tremorshield sabatons|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.preventNextArcaneDamage(
          ctx.seat,
          ctx.getPlayerFlag(ctx.seat, "createdName:seismic surge") === true ? 2 : 1,
        );
      },
    },
  },
  "roiling fissure|3": {
    variablePlayCost: {
      base: 1,
      stateKey: "fissureX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
    },
    onPlay(ctx) {
      const x = ctx.getState("fissureX");
      const aura = ctx.state.players
        .flatMap((player) => player.board)
        .find((card) => dataTags(ctx, card).includes("aura") && (ctx.cardData(card.cardId).cost ?? 0) <= x);
      if (aura) ctx.destroyPermanent(aura.instanceId);
    },
  },
  "retrace the past|3": {
    triggers: [
      attackTrigger(
        "Name a card; this gets that name, +2 power, and go again",
        decisionMessage("card.trigger.common.cardname.attack.goagain", { amount: 2 }),
        (ctx) =>
          ctx.requestNameChoice(
            "retrace-name",
            decisionPrompt(`${ctx.data.name}: name a card`, "card.hnt.card.name.named", {
              values: { card: { kind: "card", cardId: ctx.self.cardId } },
            }),
          ),
        (ctx) => previousAttackNameContains(ctx, "gustwave"),
      ),
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "retrace-name") return;
      ctx.grantCardName(ctx.self.instanceId, option);
      ctx.addCardTempPower(ctx.self.instanceId, 2);
      ctx.grantGoAgain();
    },
  },
  "misfire dampener|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.preventNextArcaneDamage(ctx.seat, ctx.getPlayerFlag(ctx.seat, "boostedThisTurn") === true ? 2 : 1);
      },
    },
  },
  "null time zone|3": {
    prohibitsChosenName: true,
    onEnterArena(ctx) {
      ctx.setCounter("steam", 2);
    },
    onChoose(ctx, hook, option) {
      if (hook === "null-name") ctx.setChosenName(option);
    },
    triggers: [
      entersArenaTrigger("Name a card", decisionMessage("card.trigger.common.cardname.choose"), (ctx) =>
        ctx.requestNameChoice("null-name", decisionPrompt("Name a card", "card.hnt.card.name")),
      ),
      {
        event: "start-of-turn",
        label: "Remove a steam counter",
        effect(ctx) {
          if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
          else ctx.setCounter("steam", ctx.getCounter("steam") - 1);
        },
      },
    ],
  },
  "enchanted quiver|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        const arrow = ctx
          .player(ctx.seat)
          .arsenal.some((card) => !card.faceDown && dataTags(ctx, card).includes("arrow"));
        ctx.preventNextArcaneDamage(ctx.seat, arrow ? 2 : 1);
      },
    },
  },
  "chain reaction|2": {
    canTriggerOnDefend: (ctx) => ctx.link?.goAgain === true,
    onDefend(ctx) {
      const cards = ctx
        .player(ctx.seat)
        .arsenal.filter((card) => ctx.hasCardType(card, "action") && !dataTags(ctx, card).includes("attack"));
      if (cards.length)
        ctx.requestCardChoice(
          "chain-arsenal",
          decisionPrompt("Turn a non-attack action face-up", "card.hnt.arsenal.nonattack.faceup"),
          cards.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "chain-arsenal") ctx.setCardFaceDown(Number(option), false);
    },
  },
  "douse in runeblood|1": {
    triggers: [
      attackTrigger(
        "Create a Runechant for each non-attack action card you've played this turn",
        decisionMessage("card.trigger.common.runechants.create.nonattack"),
        (ctx) => {
          const count = Number(ctx.getPlayerFlag(ctx.seat, "nonAttackActionsPlayedThisTurn"));
          ctx.createTokens("ARC112", count);
          if (count >= 3) ctx.grantGoAgain();
        },
      ),
    ],
  },
  "spur locked|3": {
    // Choices are sequential but secret: the controller's number waits in an
    // unprojected player flag until the opponent answers, then both reveal.
    onPlay(ctx) {
      ctx.requestChoice("spur-number", spurNumberPrompt(), SPUR_NUMBERS);
    },
    onChoose(ctx, hook, option) {
      if (hook === "spur-number") {
        ctx.setPlayerFlag(ctx.seat, "spurLockedNumber", Number(option));
        ctx.requestChoice("spur-opponent-number", spurNumberPrompt(), SPUR_NUMBERS, opponentSeat(ctx));
        return;
      }
      if (hook === "spur-opponent-number") {
        const opponent = opponentSeat(ctx);
        const mine = Number(ctx.getPlayerFlag(ctx.seat, "spurLockedNumber"));
        const theirs = Number(option);
        ctx.setPlayerFlag(ctx.seat, "spurLockedNumber", 0);
        const heroName = (seat: number) => ctx.cardData(ctx.player(seat).heroCardId).name;
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.data.name}: ${heroName(ctx.seat)} chose ${mine}, ${heroName(opponent)} chose ${theirs}`,
            "card.log.hnt.spurlocked.revealed",
            {
              player: { kind: "player", seat: ctx.seat },
              number: mine,
              opponent: { kind: "player", seat: opponent },
              opponentNumber: theirs,
            },
            {
              kind: "numbers-revealed",
              sourceCardId: ctx.self.cardId,
              choices: [
                { seat: ctx.seat, number: mine },
                { seat: opponent, number: theirs },
              ],
            },
          ),
        );
        if (mine === theirs) return;
        const loser = mine > theirs ? ctx.seat : opponent;
        const amount = Math.max(mine, theirs);
        ctx.loseLife(loser, amount);
        const cards = ctx.player(loser).deck.filter((card) => (ctx.cardData(card.cardId).cost ?? 0) <= amount);
        if (cards.length)
          ctx.requestCardChoice(
            "spur-search",
            decisionPrompt("Choose a card", "card.hnt.card.choose"),
            cards.map((card) => card.instanceId),
            loser,
          );
        return;
      }
      if (hook === "spur-search") {
        ctx.revealCards([Number(option)]);
        ctx.moveToHand(Number(option));
        ctx.shuffleDeck();
      }
    },
  },
  "ring of roses|2": {
    triggers: [
      {
        event: "damage-dealt",
        label: "Gain 1 life",
        labelMessage: { id: "card.trigger.common.life.gain", values: { amount: 1 } },
        condition: (_ctx, _eventCard, event) => event?.damage?.arcaneOrdinal === 1,
        effect: (ctx) => ctx.gainLife(ctx.seat, 1),
      },
    ],
  },
  "war cry of themis|2": {
    onPlay: (ctx) => buffNextAttack(ctx, { attack: 4, appliesToSubtype: "angel" }),
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      variableBanishSoulCost: {
        stateKey: "warCryThemisX",
        prompt: decisionPrompt("Choose X cards to banish from your soul", "card.common.cost.soul.banishx"),
      },
      label: "Discard: turn X banished cards face-down",
      onActivate(ctx) {
        const targets = ctx.state.players.flatMap((player) => player.banish.filter((card) => !card.faceDown));
        const n = Math.min(ctx.getState("warCryThemisX"), targets.length);
        if (n > 0)
          ctx.requestCardChoices(
            "war-cry-themis-target",
            decisionPrompt(
              `Choose ${n} banished ${n === 1 ? "card" : "cards"} to turn face-down`,
              "card.hnt.banished.facedown.choose",
              { values: { count: n } },
            ),
            targets.map((card) => card.instanceId),
            n,
            n,
          );
      },
    },
    onChooseMany(ctx, hook, options) {
      if (hook !== "war-cry-themis-target") return;
      for (const option of options) ctx.setCardFaceDown(Number(option), true);
    },
  },
  "war cry of bellona|2": {
    canPlay: (ctx) => !!ctx.link && cardNamed(ctx, ctx.link.attackingCard, "Raydn, Duskbane"),
    onPlay(ctx) {
      if (!ctx.link) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        attack: 2,
        appliesToInstanceId: ctx.link.attackingCard.instanceId,
      });
    },
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      variableBanishSoulCost: {
        stateKey: "warCryBellonaX",
        prompt: decisionPrompt("Choose X cards to banish from your soul", "card.common.cost.soul.banishx"),
      },
      label: "Discard: reflect a weapon's next X or less damage",
      onActivate(ctx) {
        const weapons = ctx.state.players.flatMap((player) => player.weapons);
        if (weapons.length)
          ctx.requestCardChoice(
            "war-cry-bellona-weapon",
            decisionPrompt("Choose a weapon", "card.hnt.weapon.choose"),
            weapons.map((card) => card.instanceId),
          );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "war-cry-bellona-weapon") return;
      const target = ctx.state.players
        .flatMap((player) => player.weapons.map((card) => ({ player, card })))
        .find(({ card }) => card.instanceId === Number(option));
      const x = ctx.getState("warCryBellonaX");
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
    playAsInstant: (ctx) => ctx.state.players.some((player) => player.flags.lostLifeThisTurn === true),
    onPlay(ctx) {
      const turnPlayer = ctx.state.activePlayer;
      const playerOrder = [
        ctx.state.players[turnPlayer],
        ...ctx.state.players.filter((player) => player.seat !== turnPlayer),
      ];
      for (const player of playerOrder) {
        if (!player) continue;
        if (player.hand.length) {
          ctx.requestCardChoice(
            `cull-hand:${player.seat}`,
            decisionPrompt("Banish a card from your hand", "card.hnt.hand.card.banish"),
            player.hand.map((card) => card.instanceId),
            player.seat,
          );
        }
      }
    },
    onChoose(ctx, hook, option) {
      if (!hook.startsWith("cull-hand:")) return;
      const choosingSeat = Number(hook.slice("cull-hand:".length));
      if (!Number.isSafeInteger(choosingSeat)) return;
      const chosen = ctx.state.players
        .find((player) => player.seat === choosingSeat)
        ?.hand.find((card) => card.instanceId === Number(option));
      if (chosen) ctx.banish(chosen.instanceId);
    },
  }),
} satisfies Record<string, CardScript>);
