import type { CardInstance, CardScript, DeepReadonly, Modifier, ScriptCtx } from "@fyendal/engine";
import {
  ampNextArcane,
  buffNextAttack,
  dealArcane,
  mergeSetScripts,
  opponentSeat,
  optN,
  optOnChoose,
} from "./shared-helpers.js";
import { omnHighRarity } from "./omn/high-rarity.js";

// Omens of the Third Age (OMN) — complete set and tokens.

const FLOW = "OMN203";
const EMBODIMENT = "ROS026";
const PONDER = "ROS237";
const OMENS = "OMN227";

type Card = DeepReadonly<CardInstance>;

function data(ctx: ScriptCtx, card: Card) { return ctx.cardData(card.cardId); }
function hasTag(ctx: ScriptCtx, card: Card, tag: string): boolean {
  return ctx.cardTypes(card).includes(tag.toLowerCase());
}
function isAura(ctx: ScriptCtx, card: Card): boolean { return hasTag(ctx, card, "aura"); }
function isInstant(ctx: ScriptCtx, card: Card): boolean { return ctx.hasCardType(card, "instant"); }
function isAttackAction(ctx: ScriptCtx, card: Card): boolean {
  return ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack");
}
function isNamed(ctx: ScriptCtx, card: Card, name: string): boolean {
  return data(ctx, card).name.trim().toLowerCase() === name.toLowerCase();
}
function isTokenAura(ctx: ScriptCtx, card: Card): boolean {
  return data(ctx, card).cardType === "token" && isAura(ctx, card);
}
function flows(ctx: ScriptCtx, seat = ctx.seat): Card[] {
  return ctx.player(seat).board.filter((card) => isNamed(ctx, card, "Lightning Flow"));
}
function starfall(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "graveCardType:instant") === true;
}
function pitches(name: string, make: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return Object.fromEntries(([1, 2, 3] as const).map((pitch) => [`${name}|${pitch}`, make(pitch)]));
}

function requestAnyTarget(ctx: ScriptCtx, hook: string, prompt: string, heroesOnly = false): void {
  const options = ["opposing hero", "your hero"];
  const cardOptions: (number | null)[] = [null, null];
  if (!heroesOnly) {
    for (const player of ctx.state.players) {
      for (const card of player.board) {
        if (!hasTag(ctx, card, "ally")) continue;
        options.push(`ally:${player.seat}:${card.instanceId}`);
        cardOptions.push(card.instanceId);
      }
    }
  }
  ctx.requestChoice(hook, prompt, options, ctx.seat, cardOptions);
}

function dealToChoice(
  ctx: ScriptCtx,
  option: string,
  amount: number,
  opts: { arcane?: boolean; sourceInstanceId?: number } = { arcane: true },
): number {
  const ally = /^ally:(\d+):(\d+)$/.exec(option);
  const targetSeat = ally
    ? Number(ally[1])
    : option === "your hero" ? ctx.seat : opponentSeat(ctx);
  if (opts.arcane !== false && opts.sourceInstanceId === undefined) {
    return dealArcane(ctx, targetSeat, amount, ally ? Number(ally[2]) : undefined);
  }
  return ctx.dealDamage(targetSeat, amount, {
    arcane: opts.arcane !== false,
    ...(ally ? { targetAllyId: Number(ally[2]) } : {}),
    ...(opts.sourceInstanceId !== undefined ? { sourceInstanceId: opts.sourceInstanceId } : {}),
  });
}

function arcaneAny(
  amount: number | ((ctx: ScriptCtx) => number),
  printedAmount = typeof amount === "number" ? amount : 0,
): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [printedAmount],
    onPlay(ctx) {
      const base = typeof amount === "function" ? amount(ctx) : amount;
      requestAnyTarget(ctx, "arcane-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(base)} arcane damage to a target`);
    },
    onChoose(ctx, hook, option) {
      if (hook === "arcane-target") dealToChoice(ctx, option, typeof amount === "function" ? amount(ctx) : amount);
    },
  };
}

function arcaneHero(amount: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    onPlay: (ctx) => requestAnyTarget(ctx, "arcane-hero", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to a hero`, true),
    onChoose(ctx, hook, option) { if (hook === "arcane-hero") dealToChoice(ctx, option, amount); },
  };
}

function starfallAny(base: number, bonus: number): CardScript {
  return arcaneAny((ctx) => base + (starfall(ctx) ? bonus : 0), base);
}

function createOnStarfall(base: number): CardScript {
  const spell = arcaneAny(base);
  return {
    ...spell,
    onPlay(ctx) {
      if (starfall(ctx)) ctx.createToken(FLOW);
      spell.onPlay?.(ctx);
    },
  };
}

function beginningAura(effect?: (ctx: ScriptCtx) => void, leave?: (ctx: ScriptCtx) => void): CardScript {
  return {
    triggers: [{ event: "begin-action-phase", label: "Destroy aura", effect(ctx) {
      ctx.destroySelf();
      effect?.(ctx);
    } }],
    ...(leave ? { onLeaveArena: leave } : {}),
  };
}

function destroyFlowChoice(ctx: ScriptCtx, hook: string, prompt: string): void {
  const cards = flows(ctx);
  if (cards.length) ctx.requestCardChoice(hook, prompt, ["no", ...cards.map((card) => card.instanceId)]);
}

function fragment(effect: (ctx: ScriptCtx) => void): CardScript {
  return { onFragment: effect };
}

function holoBlink(): CardScript {
  return {
    ...fragment((ctx) => {
      const auras = ctx.player(ctx.seat).board.filter(
        (card) => hasTag(ctx, card, "lightning") && isAura(ctx, card) && (card.counters?.holo ?? 0) === 0,
      );
      if (auras.length) ctx.requestCardChoice("holo-blink", `${ctx.data.name}: give an aura a holo counter?`, ["no", ...auras.map((card) => card.instanceId)]);
    }),
    onChoose(ctx, hook, option) {
      if (hook !== "holo-blink" || option === "no") return;
      const id = Number(option);
      if (!ctx.banish(id)) return;
      ctx.setCardCounter(id, "holo", 1);
      ctx.settleCard(id);
    },
  };
}

function fragmentWard(amount: number, leaveDamage = false): CardScript {
  return {
    wardValue: (ctx) => ctx.getCounter("holo") > 0 ? amount : 1,
    ...(leaveDamage ? {
      triggers: [{
        event: "card-left-arena",
        sourceZone: "any",
        label: "Deal 1 arcane damage to target hero",
        condition: (ctx: ScriptCtx, left: Card | undefined) => left?.instanceId === ctx.self.instanceId,
        effect(ctx: ScriptCtx) {
          requestAnyTarget(ctx, "space-dust-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(1)} arcane damage to a hero`, true);
        },
      }],
      onChoose(ctx: ScriptCtx, hook: string, option: string) {
        if (hook === "space-dust-target") dealToChoice(ctx, option, 1);
      },
    } : {}),
  };
}

function auraEnterAttack(opts: { attack?: number; goAgain?: boolean; fragmentOnly?: boolean; holoAttack?: number }): CardScript {
  const isEligibleAttack = (ctx: ScriptCtx, link: NonNullable<ScriptCtx["link"]>): boolean => {
    return (
      !opts.fragmentOnly ||
      (data(ctx, link.attackingCard).keywords ?? []).some((kw) => kw.toLowerCase() === "fragment")
    );
  };

  const eligibleAttacks = (ctx: ScriptCtx) => ctx.state.chain.filter(
    (link) => link.flags.attackGone !== true && isEligibleAttack(ctx, link),
  );

  return {
    onEnterArena(ctx) {
      const attacks = eligibleAttacks(ctx);
      if (attacks.length === 0) return;
      ctx.requestCardChoice(
        "aura-enter-attack-target",
        `${ctx.data.name}: choose up to 1 target attack`,
        ["no", ...attacks.map((link) => link.attackingCard.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aura-enter-attack-target" || option === "no") return;
      const link = eligibleAttacks(ctx).find(
        (candidate) => candidate.attackingCard.instanceId === Number(option),
      );
      if (!link) return;
      const attack = ctx.getCounter("holo") > 0 ? (opts.holoAttack ?? opts.attack ?? 0) : (opts.attack ?? 0);
      if (attack) {
        ctx.addModifier({
          scope: "chain-link",
          attack,
          appliesToInstanceId: link.attackingCard.instanceId,
        });
      }
      if (opts.goAgain) ctx.grantGoAgain(link.attackingCard.instanceId);
    },
  };
}

function discardArcaneFlow(): CardScript {
  return {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate(ctx) {
        requestAnyTarget(ctx, "discard-bolt", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(1)} arcane damage to a hero`, true);
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "discard-bolt") return;
      dealToChoice(ctx, option, 1);
      ctx.createToken(FLOW);
    },
  };
}

function arcaneAndDiscardFlow(amount: number): CardScript {
  const spell = arcaneAny(amount);
  const discard = discardArcaneFlow();
  return {
    ...spell,
    activated: discard.activated,
    onChoose(ctx, hook, option) {
      spell.onChoose?.(ctx, hook, option);
      discard.onChoose?.(ctx, hook, option);
    },
  };
}

function quickstrike(opts: { attack?: number; attackArcane?: boolean; firstDamage?: (ctx: ScriptCtx) => void }): CardScript {
  return {
    modifyAttack: (ctx) => ctx.link?.goAgain ? (opts.attack ?? 0) : 0,
    onAttackDeclared(ctx) {
      if (opts.attackArcane && ctx.link?.goAgain && ctx.link.targetAllyId === undefined) {
        dealArcane(ctx, opponentSeat(ctx), 1);
      }
    },
    onDealsDamage(ctx, targetSeat, amount) {
      if (amount <= 0 || targetSeat === ctx.seat || ctx.getFlag("link", "quickstrikeDamage") === true) return;
      ctx.setFlag("link", "quickstrikeDamage", true);
      opts.firstDamage?.(ctx);
    },
  };
}

function chooseGraveInstantBottom(ctx: ScriptCtx, hook: string, optional = true): void {
  const instants = ctx.player(ctx.seat).graveyard.filter((card) => isInstant(ctx, card));
  if (instants.length) ctx.requestCardChoice(hook, `${ctx.data.name}: put an instant on the bottom`, [...(optional ? ["no"] : []), ...instants.map((card) => card.instanceId)]);
}

function chooseGraveAttackBottom(ctx: ScriptCtx, hook: string): void {
  const attacks = ctx.player(ctx.seat).graveyard.filter((card) => isAttackAction(ctx, card));
  if (attacks.length) {
    ctx.requestCardChoice(hook, `${ctx.data.name}: put an attack action on the bottom`, [
      "no",
      ...attacks.map((card) => card.instanceId),
    ]);
  }
}

function consumeSourceModifier(ctx: ScriptCtx, predicate?: (mod: DeepReadonly<Modifier>) => boolean): DeepReadonly<Modifier> | undefined {
  const modifier = ctx.state.modifiers.find((candidate) =>
    candidate.sourceInstanceId === ctx.self.instanceId &&
    candidate.scope === "until-end-of-turn" &&
    !candidate.consumed &&
    (predicate?.(candidate) ?? true),
  );
  if (modifier) ctx.consumeModifier(modifier.id);
  return modifier;
}

function nextAttackDamageRider(
  kind: "memory" | "renown" | "vitality",
): CardScript {
  const damage = (ctx: ScriptCtx, source: Card, targetSeat: number, amount: number) => {
    if (amount <= 0 || targetSeat === ctx.seat) return;
    const marker = ctx.state.modifiers.find((modifier) =>
      modifier.sourceInstanceId === ctx.self.instanceId &&
      modifier.scope === "until-end-of-turn" &&
      modifier.appliesToInstanceId === source.instanceId &&
      !modifier.consumed,
    );
    if (!marker) return;
    if (kind === "vitality") ctx.gainLife(ctx.seat, 1);
    else if (kind === "memory") chooseGraveAttackBottom(ctx, "leech-memory");
    else {
      const auras = ctx.player(targetSeat).board.filter((card) => isTokenAura(ctx, card));
      if (auras.length) ctx.requestCardChoice("leech-renown", "Destroy an aura token", auras.map((card) => card.instanceId));
    }
  };
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action" });
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      const marker = consumeSourceModifier(ctx, (modifier) => modifier.appliesToInstanceId === undefined);
      if (marker && ctx.link) ctx.addModifier({ scope: "until-end-of-turn", appliesToInstanceId: ctx.link.attackingCard.instanceId });
    },
    onFriendlyDamageDealt(ctx, source, targetSeat, amount) { damage(ctx, source, targetSeat, amount); },
    onFriendlyCombatDamageDealt(ctx, source, targetSeat, amount) { damage(ctx, source, targetSeat, amount); },
    onChoose(ctx, hook, option) {
      if (hook === "leech-memory" && option !== "no") ctx.putOnDeckBottom(Number(option));
      if (hook === "leech-renown") ctx.destroyPermanent(Number(option));
    },
  };
}

function preventEquipment(token?: string): CardScript {
  return {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.preventNextDamage(ctx.seat, 1);
        if (token) ctx.addModifier({ scope: "until-end-of-turn", onPreventCreateToken: token });
      },
    },
  };
}

function sanctuaryEquipment(): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tapHeroCost: true,
      destroySelfCost: true,
      onActivate: (ctx) => ctx.preventNextDamage(ctx.seat, 1),
    },
  };
}

function chainAttackTargets(ctx: ScriptCtx, type?: string): number[] {
  return ctx.state.chain
    .filter((link) => link.flags.attackGone !== true)
    .map((link) => link.attackingCard)
    .filter((attack) => !type || hasTag(ctx, attack, type))
    .map((attack) => attack.instanceId);
}

function targetAttack(effect: (ctx: ScriptCtx) => void, type?: string): CardScript {
  return {
    playTargetOptions: (ctx) => chainAttackTargets(ctx, type),
    onPlay: effect,
  };
}

function pathOfSameEnds(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId === undefined) dealArcane(ctx, opponentSeat(ctx), 1);
    },
    onDamageDealt(ctx, _target, amount, arcane) {
      if (arcane && amount > 0) ctx.grantGoAgain();
    },
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Pay {r}: This gets go again",
      canActivate: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId,
      onActivate: (ctx) => ctx.grantGoAgain(),
    },
  };
}

function rushOfPower(): CardScript {
  return {
    modifyAttack: (ctx) => ctx.link?.goAgain ? 1 : 0,
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  };
}

function quickSuccession(count: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { goAgain: true, appliesToType: ["runeblade", "lightning"] });
      ctx.setCounter("quickRemaining", count);
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      const remaining = ctx.getCounter("quickRemaining");
      if (remaining <= 0 || !ctx.link) return;
      ctx.setFlag("link", `quickSuccession:${ctx.self.instanceId}`, true);
      ctx.setCounter("quickRemaining", remaining - 1);
    },
    modifyAttack(ctx) {
      return ctx.link?.goAgain && ctx.getFlag("link", `quickSuccession:${ctx.self.instanceId}`) === true
        ? 1
        : 0;
    },
  };
}

function mercurialSkies(amount: number): CardScript {
  const dealRider = (ctx: ScriptCtx, source: Card, targetSeat: number, dealt: number) => {
    if (dealt <= 0 || targetSeat === ctx.seat) return;
    const marker = ctx.state.modifiers.find((modifier) =>
      modifier.sourceInstanceId === ctx.self.instanceId &&
      modifier.scope === "until-end-of-turn" &&
      modifier.appliesToInstanceId === source.instanceId &&
      !modifier.consumed,
    );
    if (!marker || flows(ctx).length === 0) return;
    ctx.consumeModifier(marker.id);
    destroyFlowChoice(ctx, "mercurial-flow", `${ctx.data.name}: destroy a Lightning Flow to deal ${ctx.previewArcaneDamage(amount)} arcane damage?`);
  };
  return {
    onPlay(ctx) {
      ctx.setCounter("mercurialDamage", amount);
      ctx.addModifier({
        scope: "until-end-of-turn",
        goAgain: true,
        appliesToCardType: "action",
        appliesToSubtype: ["runeblade", "lightning"],
      });
    },
    onFriendlyAttackDeclared(ctx) {
      const marker = consumeSourceModifier(ctx, (modifier) => modifier.goAgain === true);
      if (marker && ctx.link) {
        ctx.addModifier({ scope: "until-end-of-turn", appliesToInstanceId: ctx.link.attackingCard.instanceId });
      }
    },
    onFriendlyDamageDealt(ctx, source, targetSeat, dealt) { dealRider(ctx, source, targetSeat, dealt); },
    onFriendlyCombatDamageDealt(ctx, source, targetSeat, dealt) { dealRider(ctx, source, targetSeat, dealt); },
    onChoose(ctx, hook, option) {
      if (hook !== "mercurial-flow" || option === "no" || !ctx.destroyPermanent(Number(option))) return;
      dealArcane(ctx, opponentSeat(ctx), ctx.getCounter("mercurialDamage"));
    },
  };
}

function attackDestroysFlow(): CardScript {
  return {
    onAttackDeclared(ctx) {
      destroyFlowChoice(ctx, "attack-flow", `${ctx.data.name}: destroy a Lightning Flow for +2 power?`);
    },
    onChoose(ctx, hook, option) {
      if (hook === "attack-flow" && option !== "no" && ctx.destroyPermanent(Number(option))) {
        ctx.addModifier({ scope: "chain-link", attack: 2 });
      }
    },
  };
}

function attackDestroysFlowForGoAgain(): CardScript {
  return {
    onAttackDeclared(ctx) {
      destroyFlowChoice(ctx, "stellar-flow", `${ctx.data.name}: destroy a Lightning Flow for go again?`);
    },
    onChoose(ctx, hook, option) {
      if (hook === "stellar-flow" && option !== "no" && ctx.destroyPermanent(Number(option))) ctx.grantGoAgain();
    },
  };
}

function twicePump(): CardScript {
  return {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      activationsPerTurn: 2,
      canActivate: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId,
      onActivate(ctx) {
        ctx.addCardTempPower(ctx.self.instanceId, 1);
      },
    },
    onHit: (ctx) => ctx.createToken(FLOW),
  };
}

function playedInstantBonus(amount: number, goAgain = false): CardScript {
  return {
    modifyAttack: (ctx) => ctx.link?.flags.playedInstant === true ? amount : 0,
    ...(goAgain ? {} : { onHit: (ctx: ScriptCtx) => ctx.createToken(FLOW) }),
  };
}

function stingingSprite(): CardScript {
  const trigger = (ctx: ScriptCtx) => requestAnyTarget(ctx, "sprite-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(1)} arcane damage to a hero`, true);
  return {
    onAttackDeclared: trigger,
    onDefend: trigger,
    onChoose(ctx, hook, option) { if (hook === "sprite-target") dealToChoice(ctx, option, 1); },
  };
}

function destroyAuraTokenOnHit(): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => isTokenAura(ctx, card));
      if (auras.length) ctx.requestCardChoice("destroy-token-aura", `${ctx.data.name}: destroy an aura token`, auras.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "destroy-token-aura") ctx.destroyPermanent(Number(option)); },
  };
}

function clearConscience(): CardScript {
  const ask = (ctx: ScriptCtx, seat: number, hook: string) => {
    const hand = ctx.player(seat).hand;
    if (hand.length) ctx.requestCardChoice(hook, "Put a card from your hand on the bottom", hand.map((card) => card.instanceId), seat);
    else {
      ctx.createToken(PONDER, seat);
      if (seat !== ctx.seat) ask(ctx, ctx.seat, "conscience-self");
    }
  };
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ask(ctx, opponentSeat(ctx), "conscience-opponent");
    },
    onChoose(ctx, hook, option) {
      if (hook === "conscience-opponent") {
        ctx.putOnDeckBottom(Number(option));
        ctx.createToken(PONDER, opponentSeat(ctx));
        ask(ctx, ctx.seat, "conscience-self");
      } else if (hook === "conscience-self") {
        ctx.putOnDeckBottom(Number(option));
        ctx.createToken(PONDER);
      }
    },
  };
}

function arcRamp(amount: number): CardScript {
  return {
    onPlay(ctx) {
      ampNextArcane(ctx, amount);
      destroyFlowChoice(ctx, "arc-ramp-flow", `${ctx.data.name}: destroy a Lightning Flow for go again?`);
    },
    onChoose(ctx, hook, option) {
      if (hook === "arc-ramp-flow" && option !== "no" && ctx.destroyPermanent(Number(option))) ctx.gainActionPoint();
    },
  };
}

function damageThenTap(amount: number, payoff: (ctx: ScriptCtx) => void): CardScript {
  const spell = arcaneAny(amount);
  return {
    ...spell,
    onDamageDealt(ctx, _target, dealt, arcane) {
      if (arcane && dealt > 0 && !ctx.player(ctx.seat).hero.tapped) {
        ctx.requestChoice("tap-payoff", `${ctx.data.name}: tap your hero for its bonus?`, ["yes", "no"]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "tap-payoff" && option === "yes" && ctx.tap(ctx.player(ctx.seat).hero.instanceId)) payoff(ctx);
      else spell.onChoose?.(ctx, hook, option);
    },
  };
}

function cosmicSuture(amount: number): CardScript {
  return {
    arcaneDamageEffect: true,
    onPlay(ctx) {
      ctx.preventNextDamage(ctx.seat, amount);
      if (starfall(ctx)) requestAnyTarget(ctx, "suture-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(1)} arcane damage to a hero`, true);
    },
    onChoose(ctx, hook, option) { if (hook === "suture-target") dealToChoice(ctx, option, 1); },
  };
}

function constellaStarfall(token?: string): CardScript {
  return {
    arcaneDamageEffect: true,
    onPlay(ctx) {
      if (token) ctx.createToken(token);
      if (starfall(ctx)) requestAnyTarget(ctx, "constella-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(1)} arcane damage to a hero`, true);
    },
    onChoose(ctx, hook, option) { if (hook === "constella-target") dealToChoice(ctx, option, 1); },
  };
}

function chromatic(pitch: number): CardScript {
  const consumeDamage = (ctx: ScriptCtx, source: Card, amount: number) => {
    if (amount <= 0) return;
    consumeSourceModifier(ctx, (modifier) => modifier.damage === 1 && modifier.appliesToInstanceId === source.instanceId);
  };
  return {
    ...beginningAura((ctx) => ctx.addModifier({
      scope: "until-end-of-turn",
      playCostReduction: 1,
      appliesToPitch: pitch,
    })),
    onFriendlyPlay(ctx, played) {
      const marker = consumeSourceModifier(ctx, (modifier) =>
        modifier.playCostReduction === 1 && modifier.appliesToPitch === pitch,
      );
      if (marker) ctx.addModifier({ scope: "until-end-of-turn", damage: 1, appliesToInstanceId: played.instanceId });
    },
    onFriendlyDamageDealt(ctx, source, _target, amount) { consumeDamage(ctx, source, amount); },
    onFriendlyCombatDamageDealt(ctx, source, _target, amount) { consumeDamage(ctx, source, amount); },
  };
}

export const omn: Record<string, CardScript> = mergeSetScripts("OMN", omnHighRarity, {
  "omens of arcana|0": {
    global: true,
    onGameStart: (ctx) => ctx.createToken(FLOW),
  },
  "lightning flow|0": {
    spellvoidValue: (ctx) => ctx.state.globalCardIds.includes(OMENS) ? 1 : 0,
  },
  "zyggy|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      effectCardCosts: [
        { zone: "arena", move: "destroy", count: 1, name: "Lightning Flow", prompt: "Choose a Lightning Flow to destroy" },
        { zone: "arena", move: "banish", count: 1, types: ["lightning", "aura"], withoutCounter: "holo", prompt: "Choose another Lightning aura to banish" },
      ],
      onCostPaid(ctx, paid) {
        const banished = paid.find((card) => ctx.player(ctx.seat).banish.some((candidate) => candidate.instanceId === card.instanceId));
        if (banished) ctx.setCounter("zyggyAura", banished.instanceId);
      },
      onActivate(ctx) {
        const id = ctx.getCounter("zyggyAura");
        if (!id) return;
        ctx.setCardCounter(id, "holo", 1);
        ctx.settleCard(id);
      },
    },
  },
  "blink of an eye|1": holoBlink(),
  "fraying lifeforce|1": fragment((ctx) => ctx.gainLife(ctx.seat, 1)),
  "scattering conflux|1": fragment((ctx) => ctx.createToken(EMBODIMENT)),
  ...pitches("polarus pulse ray", () => fragment((ctx) => {
    if (ctx.link?.targetAllyId === undefined) dealArcane(ctx, opponentSeat(ctx), 1);
  })),
  ...pitches("corrosive space dust", (pitch) => fragmentWard(5 - pitch, true)),
  ...pitches("cosmic duality", () => discardArcaneFlow()),
  ...pitches("ebbing arcstride", () => fragment((ctx) => ctx.grantGoAgain())),
  ...pitches("pulsing cardia", () => fragment((ctx) => ctx.changeResources(ctx.seat, 1))),
  ...pitches("shattering flowtide", () => fragment((ctx) => ctx.createToken(FLOW))),
  ...pitches("auric shards", (pitch) => auraEnterAttack({ attack: 1, fragmentOnly: true, holoAttack: 5 - pitch })),
  ...pitches("holo shield", (pitch) => fragmentWard(5 - pitch)),
  "circular flowtide|2": { onLeaveArena: (ctx) => ctx.createToken(FLOW) },
  "elliptical conflux|2": { onLeaveArena: (ctx) => ctx.createToken(EMBODIMENT) },
  "nebulus cycle|2": { onLeaveArena: (ctx) => ctx.createToken(PONDER) },
  "crackle from afar|3": auraEnterAttack({ attack: 1 }),
  "fleeing starbreeze|3": auraEnterAttack({ goAgain: true }),
  "nourishing glow|3": { onEnterArena: (ctx) => ctx.gainLife(ctx.seat, 1) },
  "fingers of fragmentation|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.link?.attackCardType === "action" && Number(ctx.getFlag("link", "fragmentCount")) > 0,
      onActivate: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 2 }),
    },
  },
  ...pitches("clear conscience", () => clearConscience()),

  "aurora, emissary of lightning|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      effectCardCosts: [{ zone: "arena", move: "destroy", count: 1, name: "Lightning Flow", prompt: "Choose a Lightning Flow to destroy" }],
      onActivate: (ctx) => ctx.createToken(EMBODIMENT),
    },
  },
  "snap fingers|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.link?.attackCardType === "action" && ctx.currentAttackHasType("lightning"),
      onActivate(ctx) {
        if (ctx.link?.targetAllyId === undefined) dealArcane(ctx, opponentSeat(ctx), 1);
      },
    },
  },
  "dashing flashfoot|2": quickstrike({ attack: 1, attackArcane: true, firstDamage: (ctx) => ctx.createToken(EMBODIMENT) }),
  "electryn mindmeld|2": {
    ...quickstrike({ attack: 1, attackArcane: true, firstDamage: (ctx) => chooseGraveInstantBottom(ctx, "mindmeld-bottom") }),
    onChoose(ctx, hook, option) { if (hook === "mindmeld-bottom" && option !== "no") ctx.putOnDeckBottom(Number(option)); },
  },
  "prophetic quickstep|2": quickstrike({ attack: 1, attackArcane: true, firstDamage: (ctx) => ctx.createToken(PONDER) }),
  ...pitches("stinging sprite", () => stingingSprite()),
  ...pitches("mercurial skies", (pitch) => mercurialSkies(4 - pitch)),
  ...pitches("destructive fleetfoot", () => ({
    ...quickstrike({ attack: 1 }),
    ...destroyAuraTokenOnHit(),
  })),
  "path of same ends|2": pathOfSameEnds(),
  "path of same ends|3": pathOfSameEnds(),
  "rush of power|2": rushOfPower(),
  "rush of power|3": rushOfPower(),
  ...pitches("singeing flowstride", () => quickstrike({ attackArcane: true, firstDamage: (ctx) => ctx.createToken(FLOW) })),
  ...pitches("stunning swipe", () => quickstrike({
    attackArcane: true,
    firstDamage(ctx) {
      const enemy = ctx.player(opponentSeat(ctx));
      if (!hasTag(ctx, enemy.hero, "lightning")) return;
      const options = [enemy.hero, ...enemy.weapons].filter((card) => !card.tapped);
      if (options.length) ctx.requestCardChoice("stunning-tap", "Tap the Lightning hero or a weapon", options.map((card) => card.instanceId));
    },
  })),
  ...pitches("voltbound duality", () => discardArcaneFlow()),
  ...pitches("electryn joltstep", (pitch) => ({ onPlay(ctx) {
    buffNextAttack(ctx, { attack: 4 - pitch, appliesToType: ["runeblade", "lightning"] });
    ctx.createToken(FLOW);
  } })),
  ...pitches("quick succession", (pitch) => quickSuccession(4 - pitch)),
  ...pitches("arcanic cunning", () => ({ preventArcaneDamageWhileActive: 1 })),
  "leech memory|1": nextAttackDamageRider("memory"),
  "leech renown|1": nextAttackDamageRider("renown"),
  "leech vitality|1": nextAttackDamageRider("vitality"),

  "oscilio, scion of the third age|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      effectCardCosts: [
        { zone: "arena", move: "destroy", count: 1, name: "Lightning Flow", prompt: "Choose a Lightning Flow to destroy" },
      ],
      onActivate(ctx) {
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length) {
          ctx.requestCardChoice("oscilio-scion-discard", "Discard a card", hand.map((card) => card.instanceId));
          return;
        }
        ctx.createToken(PONDER);
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "oscilio-scion-discard") return;
      const discarded = ctx.discardCard(ctx.seat, Number(option));
      ctx.createToken(PONDER);
      if (discarded && isInstant(ctx, discarded)) ctx.allowPlayFrom(discarded.instanceId, "graveyard");
    },
  },
  "constella waves|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tapHeroCost: true,
      destroySelfCost: true,
      onActivate: (ctx) => ampNextArcane(ctx, 1),
    },
  },
  ...pitches("arc ramp", (pitch) => arcRamp(4 - pitch)),
  ...pitches("core reaction", (pitch) => ({
    triggers: [{ event: "begin-action-phase", label: "Core Reaction", effect(ctx) {
      ctx.destroySelf();
      const amount = 5 - pitch;
      requestAnyTarget(ctx, "core-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to a target`);
    } }],
    arcaneDamageEffect: true,
    onChoose(ctx, hook, option) { if (hook === "core-target") dealToChoice(ctx, option, 5 - pitch); },
  })),
  ...pitches("flash bolt", (pitch) => arcaneHero(4 - pitch)),
  ...pitches("comet collision", (pitch) => starfallAny(4 - pitch, 1)),
  ...pitches("enion surge", (pitch) => damageThenTap(4 - pitch, (ctx) => ctx.createToken(FLOW))),
  ...pitches("lightning overload", (pitch) => createOnStarfall(5 - pitch)),
  ...pitches("meteoric impact", (pitch) => starfallAny(4 - pitch, 2)),
  ...pitches("nebula duality", (pitch) => arcaneAndDiscardFlow(4 - pitch)),
  ...pitches("tap lessons past", (pitch) => damageThenTap(5 - pitch, (ctx) => chooseGraveInstantBottom(ctx, "lessons-bottom", false))),
  ...pitches("cosmic suture", (pitch) => cosmicSuture(5 - pitch)),
  "constella contemplation|2": constellaStarfall(PONDER),
  "constella flowslide|2": constellaStarfall(FLOW),
  "constella uplift|2": {
    ...constellaStarfall(),
    onPlay(ctx) {
      const staffs = ctx.player(ctx.seat).weapons.filter((card) => hasTag(ctx, card, "staff") && card.tapped);
      if (staffs.length) ctx.untap(staffs[0]!.instanceId);
      if (starfall(ctx)) requestAnyTarget(ctx, "constella-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(1)} arcane damage to a hero`, true);
    },
  },
  "aethersling|1": damageThenTap(4, (ctx) => ctx.gainActionPoint()),
  "nucleus aetherbolt|1": {
    ...damageThenTap(3, (ctx) => {
      const sourceInstanceId = ctx.player(ctx.seat).hero.instanceId;
      requestAnyTarget(ctx, "nucleus-target", `Your hero deals ${ctx.previewArcaneDamage(1, { sourceInstanceId })} arcane damage to a target`);
    }),
    arcaneDamageEffectAmounts: [3, 1],
    onChoose(ctx, hook, option) {
      if (hook === "nucleus-target") dealToChoice(ctx, option, 1, { arcane: true, sourceInstanceId: ctx.player(ctx.seat).hero.instanceId });
      else if (hook === "tap-payoff" && option === "yes" && ctx.tap(ctx.player(ctx.seat).hero.instanceId)) {
        const sourceInstanceId = ctx.player(ctx.seat).hero.instanceId;
        requestAnyTarget(ctx, "nucleus-target", `Your hero deals ${ctx.previewArcaneDamage(1, { sourceInstanceId })} arcane damage to a target`);
      } else if (hook === "arcane-target") dealToChoice(ctx, option, 3);
    },
  },
  ...pitches("haven veil", (pitch) => ({
    ...beginningAura(),
    onEnterArena: (ctx) => ctx.preventNextArcaneDamage(ctx.seat, 4 - pitch),
  })),

  "constella tiara|0": preventEquipment(PONDER),
  "starflow robes|0": preventEquipment(FLOW),
  "laced lightning|0": preventEquipment(EMBODIMENT),
  "helm of astral sanctuary|0": sanctuaryEquipment(),
  "robe of astral sanctuary|0": sanctuaryEquipment(),
  "gloves of astral sanctuary|0": sanctuaryEquipment(),
  "boots of astral sanctuary|0": sanctuaryEquipment(),

  "beckoning brilliance|1": {
    onAttackDeclared(ctx) {
      ctx.addModifier({ scope: "combat-chain", playCostReduction: 1, appliesToCardType: "instant" });
    },
    onFriendlyPlay(ctx, played) {
      if (!ctx.hasCardType(played, "instant")) return;
      const marker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "combat-chain" &&
        modifier.playCostReduction === 1 &&
        !modifier.consumed,
      );
      if (marker) ctx.consumeModifier(marker.id);
    },
  },
  "flowshard elemental|1": {
    onAttackDeclared(ctx) {
      const instants = ctx.player(ctx.seat).hand.filter((card) => isInstant(ctx, card));
      if (instants.length) ctx.requestCardChoice("flowshard-discard", "Discard an instant for Lightning Flow and go again?", ["no", ...instants.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "flowshard-discard" && option !== "no" && ctx.discardCard(ctx.seat, Number(option))) {
        ctx.createToken(FLOW);
        ctx.grantGoAgain();
      }
    },
  },
  "visionary of orbits|1": {
    onHit: (ctx) => chooseGraveInstantBottom(ctx, "visionary-bottom"),
    onChoose(ctx, hook, option) { if (hook === "visionary-bottom" && option !== "no") ctx.putOnDeckBottom(Number(option)); },
  },
  "flowing stormstrike|1": twicePump(),
  "meteoric rise|1": twicePump(),
  "voltic impact|1": twicePump(),
  ...pitches("rift breaker", () => ({
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const cards = flows(ctx, opponentSeat(ctx));
      if (cards.length) ctx.requestCardChoice("rift-flow", "Destroy a Lightning Flow", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "rift-flow") ctx.destroyPermanent(Number(option)); },
  })),
  "flow through|3": targetAttack((ctx) => {
    if (ctx.playTargetInstanceId === undefined) return;
    ctx.addModifier({ scope: "chain-link", attack: 1, appliesToInstanceId: ctx.playTargetInstanceId, onHitCreateToken: { cardId: FLOW, count: 1 } });
  }, "lightning"),
  "livewire press|1": {
    ...targetAttack((ctx) => {
      if (ctx.playTargetInstanceId !== undefined) ctx.addModifier({ scope: "until-end-of-turn", appliesToInstanceId: ctx.playTargetInstanceId });
    }, "lightning"),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.appliesToInstanceId === ctx.link?.attackingCard.instanceId
      );
    },
    onHit(ctx) {
      consumeSourceModifier(ctx, (modifier) => modifier.appliesToInstanceId === ctx.link?.attackingCard.instanceId);
      ctx.dealDamage(opponentSeat(ctx), 4);
    },
  },
  ...pitches("astral assault", () => attackDestroysFlow()),
  ...pitches("flittering spike", () => playedInstantBonus(2)),
  ...pitches("glide through starlight", () => ({
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate(ctx) {
        ctx.preventNextDamage(ctx.seat, 1);
        ctx.addModifier({ scope: "until-end-of-turn", onPreventCreateToken: FLOW });
      },
    },
  })),
  ...pitches("stellar glide", () => attackDestroysFlowForGoAgain()),
  ...pitches("volatile fluxor", (pitch) => ({
    modifyAttack: (ctx) => ctx.link?.flags.playedInstant === true ? 4 - pitch : 0,
    onHit: (ctx) => ctx.createToken(FLOW),
  })),
  ...pitches("flittering forcefield", () => ({ modifyDefense: (ctx) => ctx.link?.flags.playedInstant === true ? 1 : 0 })),
  ...pitches("calmveil of volthaven", (pitch) => ({ onPlay(ctx) {
    ctx.preventNextDamage(ctx.seat, 4 - pitch);
    ctx.addModifier({ scope: "until-end-of-turn", onPreventCreateToken: FLOW });
  } })),
  "cosmic flare|1": { onPlay: (ctx) => ctx.changeResources(ctx.seat, 3) },
  "starworld warning|2": { onPlay: (ctx) => ctx.createTokens(FLOW, 2) },
  "starlight road|3": {
    onPlay: (ctx) => ctx.requestChoice("starlight-token", "Choose a token", [EMBODIMENT, FLOW]),
    onChoose(ctx, hook, option) { if (hook === "starlight-token") ctx.createToken(option); },
  },
  "stormshard|1": {
    alternativePlayCost: { kind: "destroy-controlled-named", options: [{ name: "Lightning Flow", count: 1 }] },
    ...targetAttack((ctx) => {
      if (ctx.playTargetInstanceId !== undefined) ctx.addCardTempPower(ctx.playTargetInstanceId, 3);
    }, "lightning"),
  },
  "stormshatter|2": {
    alternativePlayCost: { kind: "destroy-controlled-named", options: [{ name: "Lightning Flow", count: 1 }] },
    ...targetAttack((ctx) => {
      if (ctx.playTargetInstanceId !== undefined) ctx.addCardTempPower(ctx.playTargetInstanceId, -3);
    }, "lightning"),
  },
  "stormwhirl|3": {
    alternativePlayCost: { kind: "destroy-controlled-named", options: [{ name: "Lightning Flow", count: 1 }] },
    ...targetAttack((ctx) => ctx.grantGoAgain(ctx.playTargetInstanceId), "lightning"),
  },
  ...pitches("chromatic refinement", (pitch) => chromatic(pitch)),
  ...pitches("thunderous retort", () => beginningAura((ctx) => buffNextAttack(ctx, { goAgain: true }))),
  "sigil of astral flow|3": beginningAura(undefined, (ctx) => ctx.createToken(FLOW)),
  "spellbane sigil|3": { ...beginningAura(), arcaneBarrierX: true },

  "ominous aggression|1": targetAttack((ctx) => {
    if (ctx.playTargetInstanceId !== undefined) ctx.addCardTempPower(ctx.playTargetInstanceId, ctx.getFlag("player", "destroyedSubtype:aura") === true ? 4 : 2);
  }),
  "ominous excavation|3": {
    onPlay(ctx) {
      const instants = ctx.player(ctx.seat).graveyard.filter((card) => isInstant(ctx, card));
      if (instants.length) ctx.requestCardChoice("excavate", "Shuffle an instant into your deck?", ["no", ...instants.map((card) => card.instanceId)]);
      else if (ctx.getFlag("player", "destroyedSubtype:aura") === true) ctx.createToken(PONDER);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "excavate") return;
      if (option !== "no" && ctx.putOnDeckBottom(Number(option))) ctx.shuffleDeck();
      if (ctx.getFlag("player", "destroyedSubtype:aura") === true) ctx.createToken(PONDER);
    },
  },
  "ominous respite|2": { onPlay: (ctx) => ctx.gainLife(ctx.seat, ctx.getFlag("player", "destroyedSubtype:aura") === true ? 3 : 2) },
  ...pitches("conflicting thoughts", () => ({
    onAttackDeclared: (ctx) => optN(ctx, 1),
    onChoose(ctx, hook, option) { optOnChoose(ctx, hook, option); },
  })),
});

// Choice handlers shared by pitch cycles whose primary helpers do not need a
// bespoke object per pitch.
for (const pitch of [1, 2, 3] as const) {
  const stunning = omn[`stunning swipe|${pitch}`]!;
  stunning.onChoose = (ctx, hook, option) => {
    if (hook === "stunning-tap") ctx.tap(Number(option));
  };
  const lessons = omn[`tap lessons past|${pitch}`]!;
  const baseChoose = lessons.onChoose;
  lessons.onChoose = (ctx, hook, option) => {
    if (hook === "lessons-bottom") ctx.putOnDeckBottom(Number(option));
    else baseChoose?.(ctx, hook, option);
  };
}
