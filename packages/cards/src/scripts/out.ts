import type { CardScript, DeepReadonly, CardInstance, ScriptCtx } from "@fyendal/engine";
import { functionalKeyOf } from "../functional.js";
import { buffNextAttack, commonOptionMessages, decisionMessage, decisionPrompt, mergeSetScripts, opponentSeat, optN, optOnChoose, previousAttackHasName, previousAttackNameContains, yesNoPrompt } from "./shared-helpers.js";
import { outHighRarity, uzuriAbility } from "./out/high-rarity.js";

// OUT — Outsiders common/rare cards and young heroes.
const BLOODROT = "SAZ034";
const FRAILTY = "SAZ035";
const INERTIA = "SAZ036";
const PONDER = "DYN244";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) { return ctx.cardData(card.cardId); }
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, tag: string): boolean {
  const key = tag.toLowerCase();
  return ctx.cardTypes(card).includes(key) || (data(ctx, card).keywords ?? []).some((x) => x.toLowerCase() === key);
}
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean { return has(ctx, card, "dagger"); }
function isStealth(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean { return has(ctx, card, "stealth"); }
function comboWith(ctx: ScriptCtx, ...names: string[]): boolean {
  return previousAttackHasName(ctx, ...names);
}
function myAttack(ctx: ScriptCtx): boolean { return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat; }
function sourceArmed(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some((m) => m.sourceInstanceId === ctx.self.instanceId && m.scope === "chain-link" && !m.consumed);
}
function tokenOnHit(tokenId: string): CardScript {
  return {
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { ctx.createToken(tokenId, opponentSeat(ctx)); },
  };
}
function aimAttack(tokenId?: string, unpreventable = false): CardScript {
  return {
    modifyAttack(ctx) { return ctx.self.counters?.aim ? 1 : 0; },
    onAttackDeclared(ctx) { if (unpreventable) ctx.setFlag("link", "unpreventable", true); },
    ...(tokenId ? {
      canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined; },
      onHit(ctx: ScriptCtx) { ctx.createToken(tokenId, opponentSeat(ctx)); },
    } : {}),
  };
}
function stealthToken(tokenId: string): CardScript { return tokenOnHit(tokenId); }
function noDefenseReactions(): CardScript {
  return { onAttackDeclared(ctx) { ctx.setFlag("link", "noDefenseReactions", true); } };
}
function stealthReaction(pump: number, token?: string): CardScript {
  return {
    canPlay(ctx) { return myAttack(ctx) && ctx.link!.attackCardType === "action" && isStealth(ctx, ctx.link!.attackingCard); },
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: pump });
      if (token) ctx.addModifier({ scope: "until-end-of-turn" });
    },
    ...(token ? {
      canTriggerOnHit(ctx: ScriptCtx) {
        return sourceArmed(ctx) && ctx.link?.targetAllyId === undefined;
      },
      onHit(ctx: ScriptCtx) {
                ctx.createToken(token, opponentSeat(ctx));
      },
    } : {}),
  };
}
function nextStealth(pump: number): CardScript {
  return { onAttackDeclared(ctx) { buffNextAttack(ctx, { attack: pump, appliesToKeyword: "stealth", expiresOnChainClose: true }); } };
}
function comboPower(name: string, power: number, reduction = 0): CardScript {
  return {
    modifyPlayCost(ctx, base) { return comboWith(ctx, name) ? Math.max(0, base - reduction) : base; },
    modifyAttack(ctx) { return comboWith(ctx, name) ? power : 0; },
  };
}
function comboHit(name: string, effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return comboWith(ctx, name) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) { effect(ctx); },
  };
}
function aimOnly(): CardScript { return aimAttack(); }
function widowmaker(): CardScript {
  return {
    onAttackDeclared(ctx) { ctx.setFlag("link", "noDefenseReactions", true); },
    modifyAttack(ctx) { return (ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0) < 2 ? 3 : 0; },
  };
}
function fletch(power: number, pitch: number): CardScript {
  return {
    onPlay(ctx) { buffNextAttack(ctx, { attack: power, appliesToSubtype: "arrow", defendingPitchDefenseAdjustment: { pitch, amount: -1, requiresAimCounter: true } }); },
  };
}
function scout(power: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: power, appliesTo: "attack-action", appliesToFromArsenal: true });
      ctx.requestCardChoice("scout", decisionPrompt("Look at the top card of target hero's deck", "card.out.scout.hero.choose"), ctx.state.players.map((p) => p.hero.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "scout") return;
      const p = ctx.state.players.find((candidate) => candidate.hero.instanceId === Number(option));
      if (p?.deck[0]) ctx.lookAt(p.deck[0].instanceId);
    },
  };
}
function springLoad(power: number): CardScript {
  return { modifyAttack(ctx) { return ctx.player(ctx.seat).hand.length === 0 ? power : 0; } };
}
function actionDefended(power: number): CardScript {
  return { modifyAttack(ctx) { return ctx.link?.defendingCards.some((card) => ctx.hasCardType(card, "action")) ? power : 0; } };
}
function onHitPonder(): CardScript { return { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { ctx.createToken(PONDER); } }; }
function humble(): CardScript { return { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { ctx.suppressHeroAbilitiesThroughNextTurn(opponentSeat(ctx)); } }; }
function infectiousHost(): CardScript {
  return { onAttackDeclared(ctx) {
    if (ctx.link?.targetAllyId !== undefined) return;
    const owned = ctx.player(ctx.seat).board;
    for (const token of [FRAILTY, INERTIA, BLOODROT]) if (owned.some((card) => card.cardId === token)) ctx.createToken(token, opponentSeat(ctx));
  } };
}
function lookingForScrap(): CardScript {
  return {
    additionalCost(ctx) {
      const choices = ctx.player(ctx.seat).graveyard.filter((card) => ctx.basePower(card) === 1);
      if (choices.length) ctx.requestCardChoice("scrap", decisionPrompt("Banish a 1 power card for +1 and go again?", "card.out.scrap.card.banish", { optionMessages: commonOptionMessages("pass") }), ["pass", ...choices.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "scrap" || option === "pass" || !ctx.banish(Number(option))) return;
      ctx.addCardTempPower(ctx.self.instanceId, 1);
      ctx.grantGoAgain();
    },
  };
}
function cutDown(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.player(opponentSeat(ctx)).hand.length >= 4;
    },
    onHit(ctx) {
      const seat = opponentSeat(ctx), hand = ctx.player(seat).hand;
      ctx.requestCardChoice("cut-down", decisionPrompt("Discard a card", "card.common.card.discard.choose"), hand.map((card) => card.instanceId), seat);
    },
    onChoose(ctx, hook, option) { if (hook === "cut-down") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  };
}
function wreckHavoc(): CardScript {
  return {
    ...noDefenseReactions(),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const arsenal = ctx.player(opponentSeat(ctx)).arsenal;
      if (arsenal.length) ctx.requestChoice("wreck", yesNoPrompt("Turn the arsenal card face up?", "card.out.arsenal.faceup"), ["yes", "no"]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "wreck" || option !== "yes") return;
      const card = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (!card) return;
      ctx.setCardFaceDown(card.instanceId, false);
      if (data(ctx, card).cardType === "defense-reaction" && !ctx.destroyPermanent(card.instanceId)) {
        ctx.moveToGraveyard(card.instanceId, "arsenal");
      }
    },
  };
}
function deathTouch(): CardScript {
  return {
    canPlay(ctx) { return !ctx.player(ctx.seat).hand.some((card) => card.instanceId === ctx.self.instanceId); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { ctx.requestChoice("affliction", decisionPrompt("Choose an affliction token", "card.out.affliction.choose", { optionMessages: Object.fromEntries([BLOODROT, FRAILTY, INERTIA].map((cardId) => [cardId, decisionMessage("card.common.target.card", { card: { kind: "card", cardId } })])) }), [BLOODROT, FRAILTY, INERTIA]); },
    onChoose(ctx, hook, option) { if (hook === "affliction") ctx.createToken(option, opponentSeat(ctx)); },
  };
}
function virulentTouch(): CardScript {
  const resolve = (ctx: ScriptCtx) => { if (ctx.link?.flags.defendedFromHand === true) ctx.createToken(BLOODROT, opponentSeat(ctx)); };
  return { canPlay(ctx) { return !ctx.player(ctx.seat).hand.some((card) => card.instanceId === ctx.self.instanceId); }, onHit: resolve, onMiss: resolve };
}
function toxicity(life: number): CardScript {
  return {
    onPlay(ctx) { ctx.addModifier({ scope: "next-attack", appliesToType: ["assassin", "ranger"], onHitLoseLife: life }); },
  };
}
function trap(condition: (ctx: ScriptCtx) => boolean, effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    canTriggerOnDefend: condition,
    onDefend(ctx) {
      ctx.notifyTrapTriggered();
      effect(ctx);
    },
  };
}
function seeker(): CardScript {
  return {
    activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, label: "Prevent 1 damage; opt 1", onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 1); optN(ctx, 1); } },
    onChoose(ctx, hook, option) { optOnChoose(ctx, hook, option); },
  };
}
function peace(prevent: number): CardScript {
  return { onPlay(ctx) { ctx.preventNextPhysicalDamage(ctx.seat, prevent); ctx.createToken(PONDER); } };
}
function brush(threshold: number): CardScript {
  return { onPlay(ctx) {
    ctx.preventNextDamageAtMost(ctx.seat, threshold, threshold);
  } };
}
function oneTwoPunch(): CardScript { return comboHit("head jab", (ctx) => ctx.dealDamage(opponentSeat(ctx), 2)); }
function recoil(): CardScript {
  return comboHit("head jab", (ctx) => {
    const seat = opponentSeat(ctx), hand = ctx.player(seat).hand;
    if (hand.length) ctx.requestCardChoice("recoil", decisionPrompt("Put a card from your hand on top of your deck", "card.out.hand.top"), hand.map((card) => card.instanceId), seat);
  });
}
function recoilChoose(ctx: ScriptCtx, hook: string, option: string): void { if (hook === "recoil") ctx.putOnDeckTop(Number(option)); }
function spinningWheel(): CardScript {
  return {
    modifyAttack(ctx) { return comboWith(ctx, "twin twisters", "spinning wheel kick") ? 1 : 0; },
    canTriggerOnHit(ctx) { return comboWith(ctx, "twin twisters", "spinning wheel kick"); },
    onHit(ctx) { ctx.setFlag("link", "attackToBottom", true); },
  };
}
function beLikeWater(): CardScript {
  return {
    onHit(ctx) {
      if (ctx.requestPayment("water-pay", decisionPrompt("Pay 1 to choose a combo name?", "card.out.water.pay", { optionMessages: commonOptionMessages("no") }), 1)) return;
    },
    onChoose(ctx, hook, option) {
      if (hook === "water-pay" && option === "paid") ctx.requestChoice("water-name", decisionPrompt("Choose a name", "card.out.combo.name.choose"), ["Head Jab", "Surging Strike", "Twin Twisters"]);
      if (hook === "water-name") ctx.grantCardName(ctx.self.instanceId, option);
    },
  };
}
function bonds(pitch: number): CardScript {
  return {
    modifyPlayCost(ctx, base) { return previousAttackNameContains(ctx, "gustwave") ? Math.max(0, base - 2) : base; },
    onAttackDeclared(ctx) {
      if (!previousAttackNameContains(ctx, "gustwave")) return;
      ctx.grantGoAgain();
      const combo = ctx.player(ctx.seat).graveyard.filter((card) => has(ctx, card, "combo"));
      if (combo.length) ctx.requestCardChoice(`bonds-grave:${pitch}`, decisionPrompt("Banish a combo card?", "card.out.combo.banish", { optionMessages: commonOptionMessages("pass") }), ["pass", ...combo.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (!hook.startsWith("bonds-grave") || option === "pass") return;
      const chosen = ctx.player(ctx.seat).graveyard.find((card) => card.instanceId === Number(option));
      if (!chosen || !ctx.banish(chosen.instanceId)) return;
      const key = functionalKeyOf(data(ctx, chosen));
      const matches = ctx.player(ctx.seat).deck.filter((card) => functionalKeyOf(data(ctx, card)).split("|")[0] === key.split("|")[0]);
      if (matches.length) ctx.requestCardChoice("bonds-search", decisionPrompt("Choose a same-name card", "card.out.same.name.choose"), matches.map((card) => card.instanceId));
      else ctx.shuffleDeck();
    },
  };
}
function bondsSearch(ctx: ScriptCtx, hook: string, option: string): void {
  if (hook !== "bonds-search") return;
  if (ctx.banish(Number(option))) ctx.allowPlayFrom(Number(option), "banish");
  ctx.shuffleDeck();
}
function backHeel(): CardScript {
  return {
    replacePowerGain(ctx, amount) {
      return amount > 0 && comboWith(ctx, "twin twisters") ? amount + 1 : amount;
    },
  };
}
function deadlyDuo(): CardScript { return { onHit(ctx) { buffNextAttack(ctx, { attack: 2, appliesTo: "attack-action", maxBasePower: 2, expiresOnChainClose: true }); } }; }
function bleedOut(): CardScript {
  return { modifyPlayCost(ctx, base) {
    const dealt = ctx.state.chain.reduce(
      (sum, link) => sum + (link.resolved && isDagger(ctx, link.attackingCard) ? link.damage : 0) + Number(link.flags["effectDamageBySubtype:dagger"] ?? 0),
      0,
    );
    return Math.max(0, base - dealt);
  } };
}
function hurl(): CardScript {
  return {
    additionalCost(ctx) { ctx.requestPayment("hurl-pay", decisionPrompt("Pay 1 to hurl a dagger?", "card.out.hurl.pay", { optionMessages: commonOptionMessages("no") }), 1); },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("hurlPaid") !== 1) return;
      const daggers = [...ctx.player(ctx.seat).weapons, ...ctx.player(ctx.seat).board].filter((card) => isDagger(ctx, card));
      if (daggers.length) ctx.requestCardChoice("hurl-dagger", decisionPrompt("Choose a dagger to deal 1 damage", "card.out.hurl.dagger.choose"), daggers.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook === "hurl-pay" && option === "paid") {
        ctx.setCounter("hurlPaid", 1);
      } else if (hook === "hurl-dagger") {
        const dagger = [...ctx.player(ctx.seat).weapons, ...ctx.player(ctx.seat).board].find((card) => card.instanceId === Number(option));
        if (!dagger) return;
        ctx.dealDamage(opponentSeat(ctx), 1, { countsAsHit: true, sourceInstanceId: dagger.instanceId });
        ctx.destroyPermanent(dagger.instanceId);
      }
    },
  };
}
function shortSharp(power: number): CardScript {
  return { canPlay(ctx) { return myAttack(ctx) && (isDagger(ctx, ctx.link!.attackingCard) || (ctx.link!.attackCardType === "action" && ctx.basePower(ctx.link!.attackingCard) <= 2)); }, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: power }); } };
}
function riptide(): CardScript {
  return {
    triggers: [{
      event: "card-played",
      label: "Put a card from hand face down into arsenal?",
      condition: (ctx, _played, event) => event?.from === "hand" &&
        ctx.player(ctx.seat).arsenal.length === 0 &&
        ctx.player(ctx.seat).hand.length > 0,
      effect(ctx) {
        ctx.requestCardChoice("riptide-arsenal", decisionPrompt("Put a card from hand face down into arsenal?", "card.out.hand.arsenal", { optionMessages: commonOptionMessages("pass") }), ["pass", ...ctx.player(ctx.seat).hand.map((card) => card.instanceId)]);
      },
    }, {
      event: "trap-triggered",
      whose: "subject",
      label: "Deal 1 damage to the attacking hero",
      effect(ctx) { ctx.dealDamage(opponentSeat(ctx), 1); },
    }],
    onChoose(ctx, hook, option) { if (hook === "riptide-arsenal" && option !== "pass") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false }); },
  };
}

const maskManyFaces: CardScript = {
  activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, label: "Name a card for the next attack", onActivate(ctx) {
    ctx.requestNameChoice("mask-name", decisionPrompt("Name a card", "card.common.card.name"));
  } },
  onChoose(ctx, hook, option) {
    if (hook === "mask-name") {
      ctx.addModifier({ scope: "next-attack", appliesTo: "attack-action", grantName: option });
    }
  },
};

const trapReaction = () => (ctx: ScriptCtx) => ctx.link?.flags.reactionPlayedOrActivated === true;
const trapPower = () => (ctx: ScriptCtx) => ctx.attackBonusAboveBase() > 0;
const trapGoAgain = () => (ctx: ScriptCtx) => ctx.link?.goAgain === true;

function offerDaggerCycle(ctx: ScriptCtx, source: DeepReadonly<CardInstance>): void {
  if (ctx.getPlayerFlag(ctx.seat, "maskDaggerCycle") !== true || !isDagger(ctx, source)) return;
  const hand = ctx.player(ctx.seat).hand;
  if (hand.length) ctx.requestCardChoice("mask-cycle", decisionPrompt("Put a hand card on bottom to draw?", "card.out.hand.bottom.draw", { optionMessages: commonOptionMessages("pass") }), ["pass", ...hand.map((card) => card.instanceId)]);
}

export const out: Record<string, CardScript> = mergeSetScripts("OUT", outHighRarity, {
  "uzuri|0": uzuriAbility,
  "arakni, solitary confinement|0": { onFriendlyAttackDeclared(ctx) { if (isStealth(ctx, ctx.link!.attackingCard) && ctx.getPlayerFlag(ctx.seat, "arakniStealth") !== true) { ctx.setPlayerFlag(ctx.seat, "arakniStealth", true); ctx.grantGoAgain(); } } },
  "back stab|1": noDefenseReactions(), "back stab|2": noDefenseReactions(), "back stab|3": noDefenseReactions(),
  "sneak attack|1": { modifyAttack: (ctx) => ctx.link?.flags.reactionPlayedOrActivated === true ? 4 : 0 }, "sneak attack|2": { modifyAttack: (ctx) => ctx.link?.flags.reactionPlayedOrActivated === true ? 4 : 0 }, "sneak attack|3": { modifyAttack: (ctx) => ctx.link?.flags.reactionPlayedOrActivated === true ? 4 : 0 },
  "spike with frailty|1": stealthReaction(3, FRAILTY), "spike with inertia|1": stealthReaction(3, INERTIA),
  "infect|2": stealthToken(BLOODROT), "infect|3": stealthToken(BLOODROT),
  "malign|1": { onAttackDeclared(ctx) { ctx.setFlag("link", "unpreventable", true); } }, "malign|2": { onAttackDeclared(ctx) { ctx.setFlag("link", "unpreventable", true); } }, "malign|3": { onAttackDeclared(ctx) { ctx.setFlag("link", "unpreventable", true); } },
  "prowl|1": nextStealth(1), "prowl|2": nextStealth(1), "prowl|3": nextStealth(1),
  "sedate|1": stealthToken(INERTIA), "sedate|2": stealthToken(INERTIA), "sedate|3": stealthToken(INERTIA),
  "wither|1": stealthToken(FRAILTY), "wither|2": stealthToken(FRAILTY), "wither|3": stealthToken(FRAILTY),
  "razor's edge|1": stealthReaction(3), "razor's edge|2": stealthReaction(2), "razor's edge|3": stealthReaction(1),

  "mask of many faces|0": maskManyFaces,
  "bonds of ancestry|1": { ...bonds(1), onChoose(ctx, h, o) { bonds(1).onChoose?.(ctx, h, o); bondsSearch(ctx, h, o); } },
  "bonds of ancestry|2": { ...bonds(2), onChoose(ctx, h, o) { bonds(2).onChoose?.(ctx, h, o); bondsSearch(ctx, h, o); } },
  "bonds of ancestry|3": { ...bonds(3), onChoose(ctx, h, o) { bonds(3).onChoose?.(ctx, h, o); bondsSearch(ctx, h, o); } },
  "recoil|1": { ...recoil(), onChoose: recoilChoose }, "recoil|2": { ...recoil(), onChoose: recoilChoose }, "recoil|3": { ...recoil(), onChoose: recoilChoose },
  "spinning wheel kick|1": spinningWheel(), "spinning wheel kick|2": spinningWheel(), "spinning wheel kick|3": spinningWheel(),
  "back heel kick|1": backHeel(), "back heel kick|2": backHeel(), "back heel kick|3": backHeel(),
  "be like water|1": beLikeWater(), "be like water|2": beLikeWater(), "be like water|3": beLikeWater(),
  "deadly duo|1": deadlyDuo(), "deadly duo|2": deadlyDuo(), "deadly duo|3": deadlyDuo(),
  "descendent gustwave|1": comboPower("surging strike", 2, 1), "descendent gustwave|2": comboPower("surging strike", 2, 1), "descendent gustwave|3": comboPower("surging strike", 2, 1),
  "one-two punch|1": oneTwoPunch(), "one-two punch|2": oneTwoPunch(), "one-two punch|3": oneTwoPunch(),

  "riptide|0": riptide(),
  "wayfinder's crest|0": { onDefend(ctx) { ctx.requestCardChoice("wayfinder", decisionPrompt("Look at the top card of target hero's deck", "card.out.scout.hero.choose"), ctx.state.players.map((p) => p.hero.instanceId)); }, onChoose(ctx, h, o) { if (h === "wayfinder") { const p = ctx.state.players.find((x) => x.hero.instanceId === Number(o)); if (p?.deck[0]) ctx.lookAt(p.deck[0].instanceId); } } },
  "boulder trap|2": { canTriggerOnDefend: trapPower(), onDefend(ctx) { ctx.notifyTrapTriggered(); const eq = Object.values(ctx.player(ctx.link!.attacker).equipment).filter((card): card is NonNullable<typeof card> => !!card); if (eq.length) ctx.requestCardChoice("boulder", decisionPrompt("Put a -1 defense counter on equipment", "card.out.equipment.counter"), eq.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "boulder") ctx.addCardDefenseCounters(Number(o), 1); } },
  "pendulum trap|2": trap(trapReaction(), (ctx) => { const p = ctx.player(ctx.link!.attacker); for (const card of p.deck.slice(0, 2)) ctx.moveToGraveyard(card.instanceId, "deck"); }),
  "tarpit trap|2": trap(trapGoAgain(), (ctx) => ctx.addModifier({ scope: "until-end-of-turn", seat: ctx.link!.attacker, appliesTo: "attack-action", suppressHitEffects: true })),
  "fletch a red tail|1": fletch(4, 1), "fletch a yellow tail|2": fletch(3, 2), "fletch a blue tail|3": fletch(2, 3),
  "falcon wing|1": aimOnly(), "falcon wing|2": aimOnly(), "falcon wing|3": aimOnly(),
  "infecting shot|3": aimAttack(BLOODROT),
  "murkmire grapnel|2": aimAttack(undefined, true), "murkmire grapnel|3": aimAttack(undefined, true),
  "sedation shot|1": aimAttack(INERTIA), "sedation shot|2": aimAttack(INERTIA), "sedation shot|3": aimAttack(INERTIA),
  "skybound shot|1": aimOnly(), "skybound shot|2": aimOnly(), "skybound shot|3": aimOnly(),
  "spire sniping|1": { onEnterArsenal(ctx) { const top = ctx.player(ctx.seat).deck.slice(0, 2); for (const card of top) ctx.lookAt(card.instanceId); if (top.length === 2) ctx.requestChoice("spire", decisionPrompt("Swap the top two cards?", "card.out.spire.swap", { optionMessages: { keep: decisionMessage("common.option.keep"), swap: decisionMessage("card.common.option.swap") } }), ["keep", "swap"]); }, onChoose(ctx, h, o) { if (h === "spire" && o === "swap") { const second = ctx.player(ctx.seat).deck[1]; if (second) ctx.putOnDeckTop(second.instanceId); } } },
  "spire sniping|3": { onEnterArsenal(ctx) { const top = ctx.player(ctx.seat).deck.slice(0, 2); for (const card of top) ctx.lookAt(card.instanceId); if (top.length === 2) ctx.requestChoice("spire", decisionPrompt("Swap the top two cards?", "card.out.spire.swap", { optionMessages: { keep: decisionMessage("common.option.keep"), swap: decisionMessage("card.common.option.swap") } }), ["keep", "swap"]); }, onChoose(ctx, h, o) { if (h === "spire" && o === "swap") { const second = ctx.player(ctx.seat).deck[1]; if (second) ctx.putOnDeckTop(second.instanceId); } } },
  "widowmaker|1": widowmaker(), "widowmaker|3": widowmaker(),
  "withering shot|1": aimAttack(FRAILTY), "withering shot|2": aimAttack(FRAILTY), "withering shot|3": aimAttack(FRAILTY),

  "mask of shifting perspectives|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, label: "Cycle after dagger hits", onActivate(ctx) { ctx.setPlayerFlag(ctx.seat, "maskDaggerCycle", true); ctx.addModifier({ scope: "until-end-of-turn" }); } }, onFriendlyCombatDamageDealt(ctx, source) { offerDaggerCycle(ctx, source); }, onFriendlyEffectHitCondition(ctx, source) { return ctx.getPlayerFlag(ctx.seat, "maskDaggerCycle") === true && isDagger(ctx, source); }, onFriendlyEffectHit(ctx, source) { offerDaggerCycle(ctx, source); }, onChoose(ctx, h, o) { if (h === "mask-cycle" && o !== "pass" && ctx.putOnDeckBottom(Number(o))) ctx.drawCards(ctx.seat, 1); } },
  "blade cuff|0": { activated: { cost: 2, isAttack: false, goAgain: true, destroySelfCost: true, label: "Daggers +1 this turn", onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToSubtype: "dagger" }); } } },
  "bleed out|1": bleedOut(), "bleed out|2": bleedOut(), "bleed out|3": bleedOut(),
  "hurl|1": hurl(), "hurl|2": hurl(), "hurl|3": hurl(),
  "plunge|1": { onHit(ctx) { buffNextAttack(ctx, { attack: 1, appliesToSubtype: "dagger" }); } }, "plunge|2": { onHit(ctx) { buffNextAttack(ctx, { attack: 1, appliesToSubtype: "dagger" }); } }, "plunge|3": { onHit(ctx) { buffNextAttack(ctx, { attack: 1, appliesToSubtype: "dagger" }); } },
  "short and sharp|1": shortSharp(3), "short and sharp|2": shortSharp(2), "short and sharp|3": shortSharp(1),

  "mask of malicious manifestations|0": { activated: { cost: 1, isAttack: false, goAgain: true, destroySelfCost: true, label: "Bottom a card; find an attack", canActivate: (ctx) => ctx.player(ctx.seat).hand.length + ctx.player(ctx.seat).arsenal.length > 0, onActivate(ctx) { const p = ctx.player(ctx.seat); ctx.requestCardChoice("malicious-bottom", decisionPrompt("Put a card from hand or arsenal on the bottom", "card.out.hand.arsenal.bottom"), [...p.hand, ...p.arsenal].map((card) => card.instanceId)); } }, onChoose(ctx, h, o) { if (h !== "malicious-bottom" || !ctx.putOnDeckBottom(Number(o))) return; const found = ctx.player(ctx.seat).deck.find((card) => isAttack(ctx, card)); if (found) ctx.moveToHand(found.instanceId); ctx.shuffleDeck(); } },
  "toxic tips|0": { activated: { cost: 1, isAttack: false, goAgain: true, destroySelfCost: true, label: "Next attack creates an affliction", onActivate(ctx) { ctx.addModifier({ scope: "next-attack", appliesTo: "attack-action" }); ctx.addModifier({ scope: "until-end-of-turn" }); } }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((m) => m.sourceInstanceId === ctx.self.instanceId && m.scope === "chain-link"); }, onHit(ctx) { const linked = ctx.state.modifiers.find((m) => m.sourceInstanceId === ctx.self.instanceId && m.scope === "chain-link")!; ctx.consumeModifier(linked.id); ctx.requestChoice("affliction", decisionPrompt("Choose an affliction token", "card.out.affliction.choose", { optionMessages: Object.fromEntries([BLOODROT, FRAILTY, INERTIA].map((cardId) => [cardId, decisionMessage("card.common.target.card", { card: { kind: "card", cardId } })])) }), [BLOODROT, FRAILTY, INERTIA]); }, onChoose(ctx, h, o) { if (h === "affliction") ctx.createToken(o, opponentSeat(ctx)); } },
  "death touch|1": deathTouch(), "death touch|2": deathTouch(), "death touch|3": deathTouch(),
  "toxicity|1": toxicity(5), "toxicity|2": toxicity(4), "toxicity|3": toxicity(3),
  "virulent touch|1": virulentTouch(), "virulent touch|2": virulentTouch(), "virulent touch|3": virulentTouch(),
  "bloodrot trap|1": trap(trapReaction(), (ctx) => ctx.createToken(BLOODROT, ctx.link!.attacker)),

  "seeker's hood|0": seeker(), "seeker's gilet|0": seeker(), "seeker's leggings|0": seeker(),
  "silken gi|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, label: "Next attack -1 power and -1 cost", onActivate(ctx) { ctx.setPlayerFlag(ctx.seat, "nextActionCostReduction", Number(ctx.getPlayerFlag(ctx.seat, "nextActionCostReduction")) + 1); buffNextAttack(ctx, { attack: -1, appliesTo: "attack-action" }); } } },
  "threadbare tunic|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, label: "Gain 1 resource", canActivate: (ctx) => ctx.player(ctx.seat).hand.length === 0, onActivate(ctx) { ctx.changeResources(ctx.seat, 1); } } },
  "fisticuffs|0": { activated: { cost: 2, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, label: "Attack action +1", canActivate: (ctx) => myAttack(ctx) && ctx.link!.attackCardType === "action", onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); } } },
  "fleet foot sandals|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, label: "Small attack gains go again", canActivate: (ctx) => myAttack(ctx) && ctx.basePower(ctx.link!.attackingCard) <= 1, onActivate(ctx) { ctx.grantGoAgain(); } } },
  "humble|1": humble(), "humble|2": humble(), "humble|3": humble(),
  "infectious host|1": infectiousHost(), "infectious host|2": infectiousHost(), "infectious host|3": infectiousHost(),
  "looking for a scrap|1": lookingForScrap(), "looking for a scrap|2": lookingForScrap(), "looking for a scrap|3": lookingForScrap(),
  "wreck havoc|2": wreckHavoc(), "wreck havoc|3": wreckHavoc(),
  "cut down to size|1": cutDown(), "cut down to size|2": cutDown(), "cut down to size|3": cutDown(),
  "destructive deliberation|1": onHitPonder(), "destructive deliberation|2": onHitPonder(), "destructive deliberation|3": onHitPonder(),
  "feisty locals|1": actionDefended(2), "feisty locals|2": actionDefended(2), "feisty locals|3": actionDefended(2),
  "freewheeling renegades|1": actionDefended(-2), "freewheeling renegades|2": actionDefended(-2), "freewheeling renegades|3": actionDefended(-2),
  "spring load|1": springLoad(3), "spring load|2": springLoad(2), "spring load|3": springLoad(1),
  "scout the periphery|2": scout(2), "scout the periphery|3": scout(1),
  "brush off|1": brush(3), "brush off|2": brush(2), "brush off|3": brush(1),
  "peace of mind|1": peace(4), "peace of mind|2": peace(3), "peace of mind|3": peace(2),
});
