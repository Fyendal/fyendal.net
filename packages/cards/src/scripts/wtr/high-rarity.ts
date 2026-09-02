import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { functionalKeyOf } from "../../functional.js";
import { commonOptionMessages, decisionMessage, decisionPrompt, isSixPlus, opponentSeat, previousAttackHasName, reprise } from "../shared-helpers.js";

const SEISMIC_SURGE = "WTR075B";

function nameOf(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): string {
  return functionalKeyOf(ctx.cardData(card.cardId)).split("|")[0]!;
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type);
}

function previousAttackNamed(ctx: ScriptCtx, name: string): boolean {
  return previousAttackHasName(ctx, name);
}

function rememberRandomDiscard(ctx: ScriptCtx): void {
  const discarded = ctx.discardRandom(ctx.seat, 1)[0];
  ctx.setCounter("discardedSixPlus", isSixPlus(ctx, discarded) ? 1 : 0);
}

function chooseDeckCard(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  messageId: string,
  predicate: (card: DeepReadonly<CardInstance>) => boolean,
): void {
  const cards = ctx.player(ctx.seat).deck.filter(predicate);
  if (cards.length > 0) ctx.requestCardChoice(hook, decisionPrompt(fallback, messageId), cards.map((card) => card.instanceId));
}

function finishSearchToHand(ctx: ScriptCtx, option: string): boolean {
  const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
  if (!card || !ctx.moveToHand(card.instanceId)) return false;
  ctx.shuffleDeck();
  return true;
}

function comboAttack(previous: string, bonus: number, onHit?: (ctx: ScriptCtx) => void): CardScript {
  return {
    modifyAttack: (ctx) => previousAttackNamed(ctx, previous) ? bonus : 0,
    onAttackDeclared(ctx) {
      if (previousAttackNamed(ctx, previous)) ctx.grantGoAgain();
    },
    canTriggerOnHit(ctx) {
      return previousAttackNamed(ctx, previous);
    },
    onHit(ctx) {
      onHit?.(ctx);
    },
  };
}

const heartOfFyendal: CardScript = {
  triggers: [{
    event: "card-pitched",
    sourceZone: "pitch",
    label: "Gain 1 life if behind",
    condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId,
    effect(ctx) {
      if (ctx.player(ctx.seat).life < ctx.player(opponentSeat(ctx)).life) ctx.gainLife(ctx.seat, 1);
    },
  }],
};

const bloodrushBellow: CardScript = {
  requiredHandCardsForAdditionalCost: 1,
  additionalCost: rememberRandomDiscard,
  onPlay(ctx) {
    ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToClass: "brute" });
    if (ctx.getCounter("discardedSixPlus") === 1) {
      ctx.drawCards(ctx.seat, 2);
      ctx.grantGoAgain();
    }
  },
};

const sandSketchedPlan: CardScript = {
  onPlay(ctx) {
    chooseDeckCard(ctx, "sand-search", "Sand Sketched Plan: choose a card", "card.wtr.sand.card.choose", () => true);
  },
  onChoose(ctx, hook, option) {
    if (hook !== "sand-search" || !finishSearchToHand(ctx, option)) return;
    const discarded = ctx.discardRandom(ctx.seat, 1)[0];
    if (isSixPlus(ctx, discarded)) ctx.changeActionPoints(ctx.seat, 2);
  },
};

const showTime: CardScript = {
  onEnterArena(ctx) {
    chooseDeckCard(ctx, "show-time-search", "Show Time!: choose a Guardian attack action", "card.wtr.showtime.attack.choose", (card) =>
      isAttackAction(ctx, card) && hasType(ctx, card, "guardian"));
  },
  onChoose(ctx, hook, option) {
    if (hook === "show-time-search") finishSearchToHand(ctx, option);
  },
  triggers: [{
    event: "begin-action-phase",
    label: "Destroy Show Time! and draw a card",
    effect(ctx) {
      ctx.destroySelf();
      ctx.drawCards(ctx.seat, 1);
    },
  }],
};

const maskOfMomentum: CardScript = {
  onSuppressedHit(ctx) {
    if (ctx.link?.attackCardType === "action" && ctx.currentChainLinkNumber() >= 3) {
      ctx.markOncePerTurnEffectUsed();
    }
  },
  canTriggerOnHit(ctx) {
    return ctx.link?.attackCardType === "action" && ctx.currentChainLinkNumber() >= 3 &&
      !ctx.oncePerTurnEffectUsed() && ctx.state.chain.slice(-3, -1).every((link) => link.hit);
  },
  onHit(ctx) {
    ctx.markOncePerTurnEffectUsed();
    ctx.drawCards(ctx.seat, 1);
  },
};

const lordOfWind: CardScript = {
  additionalCost(ctx) {
    if (previousAttackNamed(ctx, "mugenshi: release")) {
      ctx.requestXPayment("lord-wind-x", decisionPrompt("Lord of Wind: choose X", "card.wtr.lordwind.x"), ctx.seat);
    }
  },
  modifyAttack: (ctx) => ctx.getCounter("lordWindX"),
  onChoose(ctx, hook, option) {
    if (hook === "lord-wind-x" && option.startsWith("x:")) {
      const amount = Number(option.slice(2));
      ctx.setCounter("lordWindX", amount);
      ctx.setCounter("lordWindRemaining", amount);
      const eligible = ctx.player(ctx.seat).graveyard.filter((card) =>
        ["surging strike", "whelming gustwave", "mugenshi: release"].includes(nameOf(ctx, card)));
      if (amount > 0 && eligible.length > 0) {
        ctx.requestCardChoice("lord-wind-card", decisionPrompt("Lord of Wind: choose a combo-line card to shuffle in", "card.wtr.lordwind.card.choose", { optionMessages: commonOptionMessages("done") }), ["done", ...eligible.map((card) => card.instanceId)]);
      }
      return;
    }
    if (hook !== "lord-wind-card") return;
    if (option === "done") {
      ctx.shuffleDeck();
      return;
    }
    if (!ctx.putOnDeckBottom(Number(option))) return;
    const remaining = ctx.getCounter("lordWindRemaining") - 1;
    ctx.setCounter("lordWindRemaining", remaining);
    const eligible = ctx.player(ctx.seat).graveyard.filter((card) =>
      ["surging strike", "whelming gustwave", "mugenshi: release"].includes(nameOf(ctx, card)));
    if (remaining > 0 && eligible.length > 0) {
      ctx.requestCardChoice("lord-wind-card", decisionPrompt("Lord of Wind: choose another card", "card.wtr.lordwind.card.next", { optionMessages: commonOptionMessages("done") }), ["done", ...eligible.map((card) => card.instanceId)]);
    } else {
      ctx.shuffleDeck();
    }
  },
};

const mugenshiRelease = comboAttack("whelming gustwave", 1, (ctx) => {
  const cards = ctx.player(ctx.seat).deck.filter((card) => nameOf(ctx, card) === "lord of wind");
  for (const card of cards) ctx.moveToHand(card.instanceId);
  ctx.shuffleDeck();
});

const hurricaneTechnique = comboAttack("rising knee thrust", 1, (ctx) => {
  ctx.returnSelfToHand();
});

function requestRemembrance(ctx: ScriptCtx): void {
  const remaining = ctx.getCounter("remembranceRemaining");
  const actions = ctx.player(ctx.seat).graveyard.filter((card) => ctx.hasCardType(card, "action"));
  if (remaining > 0 && actions.length > 0) {
    ctx.requestCardChoice("remembrance-card", decisionPrompt("Remembrance: choose an action card", "card.wtr.remembrance.action.choose", { optionMessages: commonOptionMessages("done") }), ["done", ...actions.map((card) => card.instanceId)]);
  } else {
    ctx.shuffleDeck();
  }
}

export const wtrHighRarity: Record<string, CardScript> = {
  "heart of fyendal|3": heartOfFyendal,
  "scabskin leathers|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, oncePerTurn: true, onActivate(ctx) { ctx.requestDieRoll("scabskin", 6); } },
    onDieRollResolved(ctx, hook, roll) { if (hook === "scabskin") ctx.changeActionPoints(ctx.seat, Math.floor(roll / 2)); },
  },
  "bloodrush bellow|2": bloodrushBellow,
  "reckless swing|3": { requiredHandCardsForAdditionalCost: 1, additionalCost(ctx) { rememberRandomDiscard(ctx); if (ctx.getCounter("discardedSixPlus") && ctx.link) ctx.dealDamage(ctx.link.attacker, 2); } },
  "sand sketched plan|3": sandSketchedPlan,
  "bone head barrier|2": {
    onPlay(ctx) { ctx.requestDieRoll("bone-head", 6); },
    onDieRollResolved(ctx, hook, roll) { if (hook === "bone-head") ctx.preventNextDamage(ctx.seat, roll); },
  },

  "tectonic plating|0": { activated: { cost: 1, isAttack: false, goAgain: true, oncePerTurn: true, onActivate(ctx) { ctx.createToken(SEISMIC_SURGE); } } },
  "crippling crush|1": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4; }, onHit(ctx) { ctx.discardRandom(opponentSeat(ctx), 2); } },
  "cranial crush|3": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4; }, onHit(ctx) { const target = ctx.player(opponentSeat(ctx)); ctx.setPlayerFlag(target.seat, "cannotDrawNextActionPhase", true); ctx.setCardCounter(target.hero.instanceId, "cannotDrawActionTurn", ctx.state.turn + 1); } },
  "forged for war|2": {
    onEnterArena(ctx) { ctx.addModifier({ scope: "static", defense: 1, appliesToEquipment: true }); },
    onLeaveArena(ctx) { for (const modifier of ctx.state.modifiers) if (modifier.sourceInstanceId === ctx.self.instanceId) ctx.consumeModifier(modifier.id); },
    triggers: [{ event: "begin-action-phase", label: "Destroy Forged for War", effect: (ctx) => ctx.destroySelf() }],
  },
  "show time!|3": showTime,

  "mask of momentum|0": maskOfMomentum,
  "lord of wind|3": lordOfWind,
  "ancestral empowerment|1": { canPlay: (ctx) => ctx.link?.attackCardType === "action" && hasType(ctx, ctx.link.attackingCard, "ninja"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); ctx.drawCards(ctx.seat, 1); } },
  "mugenshi: release|2": mugenshiRelease,
  "hurricane technique|2": hurricaneTechnique,
  "pounding gale|1": { modifyCombatDamage: (ctx, amount) => previousAttackNamed(ctx, "open the center") ? amount * 2 : amount },

  "braveforge bracers|0": {
    onFriendlyCombatDamageDealt(ctx, source, target, amount) {
      if (amount > 0 && target !== ctx.seat && ctx.cardData(source.cardId).cardType === "weapon") {
        ctx.setFlag("player", "weaponHitThisTurn", true);
      }
    },
    activated: { cost: 1, isAttack: false, goAgain: true, oncePerTurn: true, canActivate: (ctx) => ctx.getFlag("player", "weaponHitThisTurn") === true, onActivate(ctx) { ctx.addModifier({ scope: "next-attack", attack: 1, appliesTo: "weapon" }); } },
  },
  "glint the quicksilver|3": { canPlay: (ctx) => ctx.link?.attackCardType === "weapon", onPlay(ctx) { ctx.grantGoAgain(); if (reprise(ctx)) ctx.drawCards(ctx.seat, 1); } },
  "steelblade supremacy|1": {
    onPlay(ctx) {
      const weapons = ctx.player(ctx.seat).weapons;
      if (weapons.length > 0) ctx.requestCardChoice("supremacy-weapon", decisionPrompt("Steelblade Supremacy: choose a weapon", "card.wtr.supremacy.weapon.choose"), weapons.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "supremacy-weapon") ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesTo: "weapon", appliesToInstanceId: Number(option), onHitDraw: 1 }); },
  },
  "rout|1": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      if (reprise(ctx)) {
        const defenders = ctx.link?.defendingCards ?? [];
        if (defenders.length > 0) ctx.requestCardChoice("rout-defender", decisionPrompt("Rout: return a defending card to hand?", "card.wtr.rout.defender.return", { optionMessages: commonOptionMessages("pass") }), ["pass", ...defenders.map((card) => card.instanceId)]);
      }
    },
    onChoose(ctx, hook, option) { if (hook === "rout-defender" && option !== "pass") ctx.moveToHand(Number(option)); },
  },
  "singing steelblade|2": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      if (reprise(ctx)) chooseDeckCard(ctx, "singing-search", "Singing Steelblade: choose an attack reaction", "card.wtr.singing.reaction.choose", (card) => ctx.cardData(card.cardId).cardType === "attack-reaction");
    },
    onChoose(ctx, hook, option) {
      if (hook !== "singing-search") return;
      const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
      if (!card || !ctx.banish(card.instanceId)) return;
      ctx.allowPlayFrom(card.instanceId, "banish", { untilChainClose: true });
      ctx.shuffleDeck();
    },
  },
  "ironsong determination|2": {
    onPlay(ctx) {
      const weapons = ctx.player(ctx.seat).weapons;
      if (weapons.length > 0) ctx.requestCardChoice("determination-weapon", decisionPrompt("Ironsong Determination: choose a weapon", "card.wtr.determination.weapon.choose"), weapons.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "determination-weapon") ctx.addModifier({ scope: "until-end-of-turn", attack: 1, dominate: true, appliesTo: "weapon", appliesToInstanceId: Number(option) }); },
  },

  "fyendal's spring tunic|0": {
    triggers: [{ event: "start-of-turn", optional: true, defaultOption: "yes", label: "Add an energy counter", condition: (ctx) => ctx.getCounter("energy") < 3, effect(ctx) { ctx.setCounter("energy", ctx.getCounter("energy") + 1); } }],
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", removeCounterCost: { key: "energy", amount: 3 }, onActivate(ctx) { ctx.changeResources(ctx.seat, 1); } },
  },
  "enlightened strike|1": {
    additionalCost(ctx) { ctx.requestCardChoice("estrike-bottom", decisionPrompt("Enlightened Strike: put a card from hand on the bottom of your deck", "card.wtr.estrike.hand.bottom"), ctx.player(ctx.seat).hand.map((card) => card.instanceId)); },
    onChoose(ctx, hook, option) {
      if (hook === "estrike-bottom") { if (ctx.putOnDeckBottom(Number(option))) ctx.requestChoice("estrike-mode", decisionPrompt("Choose a mode", "card.wtr.estrike.mode.choose", { optionMessages: { draw: decisionMessage("card.wtr.estrike.option.draw"), "+2": decisionMessage("card.wtr.estrike.option.power"), "go again": decisionMessage("card.wtr.estrike.option.goagain") } }), ["draw", "+2", "go again"]); return; }
      if (hook === "estrike-mode") ctx.setCounter("estrikeMode", option === "draw" ? 1 : option === "+2" ? 2 : 3);
    },
    onAttackDeclared(ctx) {
      const mode = ctx.getCounter("estrikeMode");
      if (mode === 1) ctx.drawCards(ctx.seat, 1);
      else if (mode === 2) ctx.addModifier({ scope: "chain-link", attack: 2 });
      else if (mode === 3) ctx.grantGoAgain();
    },
  },
  "tome of fyendal|2": { onPlay(ctx) { ctx.drawCards(ctx.seat, 2); if (ctx.fromArsenal) ctx.gainLife(ctx.seat, ctx.player(ctx.seat).hand.length); } },
  "last ditch effort|3": { triggers: [{ event: "card-played", sourceZone: "self", label: "Gain +4 attack and go again", condition: (ctx) => ctx.player(ctx.seat).deck.length === 0, effect(ctx, played) { if (!played) return; ctx.addCardTempPower(played.instanceId, 4); ctx.grantGoAgain(played.instanceId); } }] },
  "remembrance|2": {
    onPlay(ctx) { ctx.setCounter("remembranceRemaining", 3); requestRemembrance(ctx); },
    onChoose(ctx, hook, option) {
      if (hook !== "remembrance-card") return;
      if (option === "done") { ctx.shuffleDeck(); return; }
      if (!ctx.putOnDeckBottom(Number(option))) return;
      ctx.setCounter("remembranceRemaining", ctx.getCounter("remembranceRemaining") - 1);
      requestRemembrance(ctx);
    },
    graveyardReplacement: "banish",
  },
};
