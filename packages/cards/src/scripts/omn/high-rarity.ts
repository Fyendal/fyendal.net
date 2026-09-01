import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { ampNextArcane, attackAbility, buffNextAttack, opponentSeat } from "../shared-helpers.js";
import { SHARPEN_FOLLOWUP, sharpenSword } from "../aha/warrior-sharpen.js";

const EMBODIMENT = "ROS026";
const FLOW = "OMN203";
const GOLD = "DYN243";
const PONDER = "ROS237";
const SPELLBANE = "DTD235";

type Card = DeepReadonly<CardInstance>;

function data(ctx: ScriptCtx, card: Card) { return ctx.cardData(card.cardId); }
function has(ctx: ScriptCtx, card: Card, type: string): boolean {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}
function named(ctx: ScriptCtx, card: Card, name: string): boolean {
  return ctx.cardNames(card).some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}
function isAura(ctx: ScriptCtx, card: Card): boolean { return has(ctx, card, "aura"); }
function isInstant(ctx: ScriptCtx, card: Card): boolean { return ctx.hasCardType(card, "instant"); }
function consumeMarker(ctx: ScriptCtx, scope: "until-end-of-turn" | "chain-link" | "combat-chain" = "until-end-of-turn") {
  const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === scope && !modifier.consumed);
  if (marker) ctx.consumeModifier(marker.id);
  return marker;
}
function swordAttack(ctx: ScriptCtx): boolean {
  return ctx.link?.attackCardType === "weapon" && !!ctx.link && has(ctx, ctx.link.attackingCard, "sword");
}
function shuriken(extra: CardScript = {}): CardScript {
  return {
    onPlay(ctx) { ctx.settleCard(ctx.self.instanceId); extra.onPlay?.(ctx); },
    activated: { cost: 1, isAttack: true, goAgain: true, tap: true, oncePerTurn: false },
    onCombatChainClosed(ctx) { if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId) ctx.destroyPermanent(ctx.self.instanceId); },
    ...extra,
  };
}

export const omnHighRarity: Record<string, CardScript> = {
  "voltaris|3": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Create a Lightning Flow token", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect: (ctx) => { ctx.createToken(FLOW); } }] },
  "unwinding finality|1": {
    onHit: (ctx) => { ctx.drawCards(ctx.seat, 1); },
    onFragment(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => isInstant(ctx, card) && has(ctx, card, "lightning"));
      if (cards.length) ctx.requestCardChoice("unwinding-top", "Put a Lightning instant on top?", ["no", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "unwinding-top" && option !== "no") ctx.putOnDeckTop(Number(option)); },
  },
  "flicker reality|3": {
    wardValue: () => 1,
    onLeaveArena(ctx) {
      const auras = ctx.player(ctx.seat).board.filter((card) => card.instanceId !== ctx.self.instanceId && has(ctx, card, "lightning") && isAura(ctx, card) && Number(card.counters?.holo ?? 0) === 0);
      if (auras.length) ctx.requestCardChoice("flicker-holo", "Blink a Lightning aura with a holo counter?", ["no", ...auras.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "flicker-holo" && option !== "no" && ctx.banish(Number(option))) { ctx.setCardCounter(Number(option), "holo", 1); ctx.settleCard(Number(option)); } },
  },
  "fractal creation|3": {
    onHit(ctx) { const auras = ctx.player(ctx.seat).board.filter((card) => isAura(ctx, card)); if (auras.length) ctx.requestCardChoice("fractal-copy", "Create a token copy of an aura?", ["no", ...auras.map((card) => card.instanceId)]); },
    onChoose(ctx, hook, option) { if (hook === "fractal-copy" && option !== "no") ctx.createTokenCopy(Number(option)); },
  },
  "aurora, legacy of tempest|0": {
    activated: {
      cost: 2, isAttack: false, goAgain: false, timing: "instant", tap: true,
      effectCardCosts: [{ zone: "arena", move: "destroy", count: 1, name: "Lightning Flow", prompt: "Destroy a Lightning Flow" }],
      onActivate: (ctx) => { ctx.createToken(EMBODIMENT); },
    },
  },
  "tempestuous kiss|1": {
    modifyAttack: (ctx) => ctx.link?.goAgain ? 1 : 0,
    onAttackDeclared(ctx) { if (ctx.link?.goAgain && ctx.link.targetAllyId === undefined) ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true }); },
    onDealsDamage(ctx, target, amount) {
      if (amount <= 0 || target === ctx.seat || ctx.getFlag("link", "tempestDiscard") === true) return;
      ctx.setFlag("link", "tempestDiscard", true); const hand = ctx.player(target).hand;
      if (hand.length) ctx.requestCardChoice("tempest-discard", "Discard a card", hand.map((card) => card.instanceId), target);
    },
    onChoose(ctx, hook, option) { if (hook === "tempest-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "arcanic reproach|3": {
    onHeroDealtDamage(ctx) {
      if (ctx.getFlag("player", "arcanicReproachUsed") === true) return;
      const cards = ctx.player(ctx.seat).hand.filter((card) => has(ctx, card, "lightning"));
      if (cards.length) ctx.requestCardChoice("reproach-reveal", "Reveal a Lightning card?", ["no", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "reproach-reveal" && option !== "no") { ctx.revealCards([Number(option)], ctx.seat); ctx.setFlag("player", "arcanicReproachUsed", true); ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true }); } },
    triggers: [{ event: "begin-action-phase", label: "Destroy an aura", effect(ctx) { const aura = ctx.player(ctx.seat).board.find((card) => isAura(ctx, card)); if (aura) ctx.destroyPermanent(aura.instanceId); } }],
  },
  "gauntlet of sword and sorcery|0": {
    activated: { cost: 2, isAttack: false, goAgain: true, tap: true, tapHeroCost: true, onActivate(ctx) { buffNextAttack(ctx, { appliesTo: "attack-action" }); ctx.addModifier({ scope: "until-end-of-turn" }); } },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link") || ctx.link?.targetAllyId !== undefined) return;
      const dealt = ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true }); if (dealt > 0) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  },
  "caress of the reaper|1": {
    onDealsDamage(ctx, target, amount) { if (amount <= 0 || target === ctx.seat) return; const aura = ctx.player(target).board.find((card) => isAura(ctx, card)); if (aura) ctx.destroyPermanent(aura.instanceId); },
  },
  "oscilio, forked continuum|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "instant", tap: true,
      effectCardCosts: [
        { zone: "arena", move: "destroy", count: 1, name: "Lightning Flow", prompt: "Destroy a Lightning Flow" },
      ],
      onActivate(ctx) {
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length) {
          ctx.requestCardChoice("oscilio-discard", "Discard a card", hand.map((card) => card.instanceId));
          return;
        }
        ctx.createToken(PONDER);
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "oscilio-discard") return;
      const discarded = ctx.discardCard(ctx.seat, Number(option));
      ctx.createToken(PONDER);
      if (discarded && isInstant(ctx, discarded)) ctx.allowPlayFrom(discarded.instanceId, "graveyard");
    },
  },
  "volzar, meteor storm|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, canActivate: (ctx) => ctx.getFlag("player", "graveCardType:instant") === true, onActivate: (ctx) => ampNextArcane(ctx, 1) } },
  "astral bridge|1": { arcaneDamageEffect: true, onPlay(ctx) {
    const top = ctx.player(ctx.seat).deck[0]; if (top && ctx.moveToGraveyard(top.instanceId, "deck") && isInstant(ctx, top)) ctx.allowPlayFrom(top.instanceId, "graveyard");
    if (ctx.getFlag("player", "graveCardType:instant") === true) ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true });
  } },
  "echoflash|2": {
    arcaneDamageEffect: true,
    onPlay: (ctx) => { ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true }); },
    triggers: [{
      event: "card-put-into-graveyard",
      sourceZone: "graveyard",
      label: "Your hero deals 1 arcane damage",
      condition: (ctx, card) => card?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.dealDamage(opponentSeat(ctx), 1, {
        arcane: true,
        sourceInstanceId: ctx.player(ctx.seat).hero.instanceId,
      }),
    }],
  },
  "tome of quandaries|3": { onPlay: (ctx) => { ctx.createTokens(PONDER, 2); } },
  "third eye of the sphinx|0": {
    activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", tap: true, effectCardCosts: [{ zone: "arena", move: "destroy", count: 1, name: "Ponder", prompt: "Destroy a Ponder" }], onActivate: (ctx) => ctx.drawCards(ctx.seat, 1) },
  },
  "plutonic starplate|0": {
    triggers: [{
      event: "card-played",
      whose: "any",
      label: "Gain {r}",
      condition(ctx, played, event) {
        return ctx.state.activePlayer !== ctx.seat &&
          event?.causedBySeat === ctx.seat &&
          played !== undefined &&
          has(ctx, played, "lightning") &&
          ctx.getFlag("player", "plutonicResource") !== true;
      },
      onTrigger(ctx) {
        ctx.setFlag("player", "plutonicResource", true);
      },
      effect(ctx) {
        ctx.changeResources(ctx.seat, 1);
      },
    }],
  },
  "astral strike|1": {
    onAttackDeclared(ctx) { if (ctx.getFlag("player", "destroyedName:lightning flow") === true) ctx.requestChoice("astral-mode", "Choose a mode", ["draw", "+2", "go again"]); },
    onChoose(ctx, hook, option) { if (hook !== "astral-mode") return; if (option === "draw") ctx.drawCards(ctx.seat, 1); else if (option === "+2") ctx.addModifier({ scope: "chain-link", attack: 2 }); else ctx.grantGoAgain(); },
  },
  "flowstate embodiment|1": {
    onAttackDeclared: (ctx) => ctx.addModifier({ scope: "combat-chain" }),
    triggers: [{ event: "card-played", label: "Create an Embodiment of Lightning or Lightning Flow", condition: (ctx, played) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId && !!played && isInstant(ctx, played), effect(ctx) { ctx.requestChoice("flowstate-token", "Create which token?", [EMBODIMENT, FLOW]); } }],
    onChoose(ctx, hook, option) { if (hook === "flowstate-token") ctx.createToken(option); },
  },
  "static shelter|2": { defendCost: 1, onDefend(ctx) { if (ctx.requestPayment("static-flow", "Pay 1 to create Lightning Flow?", 1)) return; }, onChoose(ctx, hook, option) { if (hook === "static-flow" && option === "paid") ctx.createToken(FLOW); } },
  "boots of omnis ward|0": {
    modifyDefense: (ctx) => ctx.getFlag("player", "arcaneDamageTakenThisTurn") === true ? 1 : 0,
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, tapHeroCost: true, onActivate: (ctx) => ctx.preventNextDamage(ctx.seat, 1) },
  },
  "browbeat|3": { modifyAttack: (ctx) => ctx.player(ctx.seat).hand.length },
  "step between|1": {
    opponentsCannotPlayOrActivateInstantsWhileActive: true,
    activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", tapHeroCost: true, canActivate: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId, onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); ctx.setFlag("link", "unpreventable", true); } },
  },
  "tempt over|2": { onAttackDeclared(ctx) {
    if (ctx.link?.targetAllyId !== undefined) return; const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => isAura(ctx, card) && has(ctx, card, "token"));
    if (auras.length) ctx.requestCardChoice("tempt-steal", "Steal an aura token", auras.map((card) => card.instanceId));
  }, onChoose(ctx, hook, option) { if (hook === "tempt-steal") ctx.steal(Number(option)); } },
  "unmake the underlings|3": {
    onAttackDeclared(ctx) { if (ctx.link?.targetAllyId !== undefined) return; const ally = ctx.player(opponentSeat(ctx)).graveyard.find((card) => has(ctx, card, "ally")); if (ally) ctx.setCardFaceDown(ally.instanceId, true); },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId !== undefined,
    onHit(ctx) { ctx.destroyPermanent(ctx.link!.targetAllyId!); },
  },
  "feral instinct|2": { modifyPlayCost: (ctx, base) => ctx.getFlag("player", "intimidatedThisTurn") === true ? Math.max(0, base - 3) : base },
  "pile driver|0": {
    activated: attackAbility(4, { tap: true }),
    triggers: [{ event: "attack-declared", optional: true, label: "Wager a Gold?", condition: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId, effect: (ctx) => ctx.wager(opponentSeat(ctx), [GOLD]) }],
  },
  "swift pickup|1": { onAttackDeclared(ctx) {
    const item = ctx.player(ctx.seat).graveyard.find((card) => has(ctx, card, "shuriken") && has(ctx, card, "item"));
    if (item && ctx.putOnDeckBottom(item.instanceId)) ctx.addModifier({ scope: "chain-link", attack: 1 });
  } },
  "evasive nageboshi|3": shuriken({ cannotBeDefendedByEquipment: true, canBeDefendedBy(_ctx, defending) { return data(_ctx, defending).cardType !== "attack-reaction" && data(_ctx, defending).cardType !== "defense-reaction"; } }),
  "razor ring|3": shuriken({ canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), defense: -1, appliesToCardType: "action", once: true, expiresOnChainClose: true }); } }),
  "stun star|3": shuriken({ canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { ctx.tap(ctx.player(opponentSeat(ctx)).hero.instanceId); } }),
  "gear turner|1": { onHit(ctx) {
    const cog = ctx.player(ctx.seat).deck.find((card) => has(ctx, card, "cog")); if (cog) ctx.settleCard(cog.instanceId); ctx.shuffleDeck();
  } },
  "arcbane grasp|3": {
    playableEquipment: true,
    playAsInstant: (ctx) => ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true,
    onEnterArena(ctx) { ctx.createToken(SPELLBANE); },
  },
  "settle the bill|1": {
    onPlay(ctx) { const arrows = ctx.player(ctx.seat).hand.filter((card) => has(ctx, card, "arrow")); if (arrows.length && ctx.player(ctx.seat).arsenal.length === 0) ctx.requestCardChoice("settle-arrow", "Put an arrow into arsenal?", ["no", ...arrows.map((card) => card.instanceId)]); },
    onChoose(ctx, hook, option) { if (hook === "settle-arrow" && option !== "no" && ctx.putIntoArsenal(Number(option), "hand", { faceUp: true })) { ctx.addCardTempPower(Number(option), 3); ctx.addModifier({ scope: "until-end-of-turn", appliesToInstanceId: Number(option) }); } },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"); },
    onHit(ctx) { for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal"); },
  },
  "beckon steel|3": {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && swordAttack(ctx),
    onPlay: (ctx) => ctx.addModifier({ scope: "chain-link" }),
    canTriggerOnHit(ctx) { return !!ctx.link && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link" && !modifier.consumed); },
    onHit(ctx) {
      consumeMarker(ctx, "chain-link");
      const attacker = ctx.link!.attackingCard;
      sharpenSword(ctx, attacker.instanceId, 1, {
        threshold: 3,
        kind: SHARPEN_FOLLOWUP.ATTACK_WITH_SWORD,
      });
    },
  },
  "crash site salvage|2": {
    additionalCost(ctx) { const choices = [...ctx.player(ctx.seat).board, ...Object.values(ctx.player(ctx.seat).equipment).filter((card): card is Card => !!card)].filter((card) => has(ctx, card, "item") || has(ctx, card, "equipment") || has(ctx, card, "token")); if (choices.length) ctx.requestCardChoice("salvage-scrap", "Scrap a permanent?", ["no", ...choices.map((card) => card.instanceId)]); },
    onChoose(ctx, hook, option) { if (hook !== "salvage-scrap" || option === "no") return; const card = [...ctx.player(ctx.seat).board, ...Object.values(ctx.player(ctx.seat).equipment).filter((candidate): candidate is Card => !!candidate)].find((candidate) => candidate.instanceId === Number(option)); if (card && ctx.destroyPermanent(card.instanceId)) { ctx.setCounter("scrapped", 1); if (has(ctx, card, "cog")) ctx.setCounter("scrappedCog", 1); } },
    onAttackDeclared(ctx) { if (ctx.getCounter("scrapped")) ctx.grantGoAgain(); if (ctx.getCounter("scrappedCog")) ctx.createToken(GOLD); },
  },
  "golden skull|2": { allZoneNames: ["Gold"] },
  "red lure harpoon|3": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("player", "activatedCannonThisTurn") === true; }, onHit(ctx) {
    const cards = ctx.player(opponentSeat(ctx)).graveyard.filter((card) => ctx.cardColor(card) === 1 && ctx.hasCardType(card, "action"));
    if (cards.length) ctx.requestCardChoice("harpoon-banish", "Banish a red action", cards.map((card) => card.instanceId));
  }, onChoose(ctx, hook, option) { if (hook === "harpoon-banish" && ctx.banish(Number(option))) ctx.allowPlayFrom(Number(option), "banish", { forSeat: ctx.seat, untilEndOfNextTurn: true }); } },
  "fortitude of anvilheim|0": { activated: {
    cost: 2, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, tapHeroCost: true,
    canActivate: (ctx) => ctx.link?.attackCardType === "weapon" && ctx.link.defendingCards.some((card) => ctx.hasCardType(card, "action")),
    onActivate(ctx) { const cards = ctx.link?.defendingCards.filter((card) => ctx.hasCardType(card, "action")) ?? []; if (cards.length) ctx.requestCardChoice("fortitude-return", "Return an action defender", cards.map((card) => card.instanceId)); },
  }, onChoose(ctx, hook, option) { if (hook === "fortitude-return") ctx.moveToHand(Number(option)); } },
  "a bit off the side|1": {
    onPlay: (ctx) => ctx.addModifier({ scope: "until-end-of-turn", appliesToSubtype: "axe" }),
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"); },
    onHit(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length) ctx.requestCardChoice("axe-discard", "Discard a card", hand.map((card) => card.instanceId), opponentSeat(ctx)); },
    onChoose(ctx, hook, option) { if (hook === "axe-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "blessing of aegis|2": {
    onCardPutIntoSoul: (ctx) => ctx.gainLife(ctx.seat, 1),
    triggers: [{ event: "start-of-turn", label: "Put Blessing of Aegis into soul", effect: (ctx) => { ctx.putIntoSoul(ctx.self.instanceId); } }],
  },
  "draco fire|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 2, attackCostReduction: 1, appliesToType: ["draconic"] }); },
    triggers: [{ event: "start-of-turn", sourceZone: "graveyard", optional: true, label: "Banish 2 Draco Fire to gain 1 resource", condition(ctx) { return ctx.player(ctx.seat).graveyard.filter((card) => named(ctx, card, "Draco Fire")).length >= 2; }, onAccept(ctx) { const cards = ctx.player(ctx.seat).graveyard.filter((card) => named(ctx, card, "Draco Fire")).slice(0, 2); for (const card of cards) ctx.banish(card.instanceId); ctx.changeResources(ctx.seat, 1); } }],
  },
  "induce panic|2": {
    onDefend: (ctx) => ctx.requestChoice("panic-color", "Choose a color", ["red", "yellow", "blue"]),
    onChoose(ctx, hook, option) {
      if (hook !== "panic-color") return; const wanted = option === "red" ? 1 : option === "yellow" ? 2 : 3;
      for (const player of ctx.state.players) { if (!player.hand.length) continue; const card = player.hand[ctx.randomInt(player.hand.length)]!; ctx.revealCards([card.instanceId], player.seat); if (ctx.cardColor(card) === wanted) ctx.discardCard(player.seat, card.instanceId); }
    },
  },
  "lionclaw maul|0": {
    activated: attackAbility(2, { tap: true }),
    modifyAttack(ctx) { return ctx.link?.attackingCard.instanceId === ctx.self.instanceId && ctx.attackBonusAboveBase() > 0 ? 1 : 0; },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { ctx.crowdBoo(ctx.seat); },
  },
};
