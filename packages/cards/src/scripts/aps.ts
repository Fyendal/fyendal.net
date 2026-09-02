import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, commonOptionMessages, decisionPrompt, opponentSeat, yesNoPrompt } from "./shared-helpers.js";

const CONFIDENCE = "APS031";
const TOUGHNESS = "APS032";
type Card = DeepReadonly<CardInstance>;

function data(ctx: ScriptCtx, card: Card) { return ctx.cardData(card.cardId); }
function hasTag(ctx: ScriptCtx, card: Card, tag: string): boolean {
  return ctx.cardTypes(card).some((value) => value.toLowerCase() === tag.toLowerCase());
}
function named(ctx: ScriptCtx, card: Card, name: string): boolean {
  return data(ctx, card).name.toLowerCase() === name.toLowerCase();
}
function suspenseAura(ctx: ScriptCtx, card: Card): boolean {
  return hasTag(ctx, card, "aura") && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "suspense");
}
function suspenseTargets(ctx: ScriptCtx): Card[] {
  return ctx.player(ctx.seat).board.filter((card) => suspenseAura(ctx, card));
}
function removeSuspenseChoice(ctx: ScriptCtx, hook: string, prompt: string): void {
  const targets = suspenseTargets(ctx).filter((card) => (card.counters?.suspense ?? 0) > 0);
  if (targets.length) ctx.requestCardChoice(hook, decisionPrompt(
    prompt,
    hook === "aps-bodice" ? "card.aps.suspense.remove.resources" : "card.aps.suspense.remove.defense",
    { optionMessages: commonOptionMessages("pass") },
  ), ["pass", ...targets.map((card) => card.instanceId)]);
}
function resolveRemoveSuspense(ctx: ScriptCtx, option: string): boolean {
  if (option === "pass") return false;
  const target = suspenseTargets(ctx).find((card) => card.instanceId === Number(option));
  if (!target || (target.counters?.suspense ?? 0) <= 0) return false;
  ctx.setCardCounter(target.instanceId, "suspense", (target.counters?.suspense ?? 0) - 1);
  return true;
}
function suspense(onEnter?: (ctx: ScriptCtx) => void, onLeave?: (ctx: ScriptCtx) => void): CardScript {
  return {
    destroyAtZeroCounter: "suspense",
    onEnterArena(ctx) { ctx.setCounter("suspense", 2); onEnter?.(ctx); },
    onLeaveArena(ctx) {
      ctx.setFlag(
        "player",
        "suspenseAurasLeftThisTurn",
        Number(ctx.getFlag("player", "suspenseAurasLeftThisTurn")) + 1,
      );
      onLeave?.(ctx);
    },
    triggers: [{
      event: "start-of-turn",
      label: "Remove a suspense counter",
      effect(ctx) {
        const next = Math.max(0, ctx.getCounter("suspense") - 1);
        ctx.setCounter("suspense", next);
        if (next === 0) ctx.destroySelf();
      },
    }],
  };
}

function pleiades(): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      tap: true,
      timing: "instant",
      effectCardCosts: [{
        zone: "arena",
        move: "remove-counter",
        count: 1,
        subtype: "aura",
        counter: { key: "suspense", amount: 1 },
        prompt: decisionPrompt("Pleiades: choose an aura to remove a suspense counter from", "card.common.cost.aura.suspense.remove"),
      }],
      onActivate(ctx) {
        const targets = suspenseTargets(ctx);
        if (targets.length) ctx.requestCardChoice("aps-pleiades-add", decisionPrompt("Put a suspense counter on an aura of suspense?", "card.aps.suspense.counter.add.optional", { optionMessages: commonOptionMessages("pass") }), ["pass", ...targets.map((card) => card.instanceId)]);
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aps-pleiades-add" || option === "pass") return;
      const target = suspenseTargets(ctx).find((card) => card.instanceId === Number(option));
      if (target) ctx.setCardCounter(target.instanceId, "suspense", (target.counters?.suspense ?? 0) + 1);
    },
    onCheered(ctx) { ctx.createToken(CONFIDENCE); },
  };
}

function returnAttackToTop(ctx: ScriptCtx): void {
  const attacks = ctx.player(ctx.seat).graveyard.filter((card) =>
    ctx.hasCardType(card, "action") &&
    ctx.cardTypes(card).includes("attack") &&
    (hasTag(ctx, card, "revered") || hasTag(ctx, card, "guardian"))
  );
  if (attacks.length) ctx.requestCardChoice("aps-pedestal", decisionPrompt("Put a Revered or Guardian attack on top of your deck?", "card.aps.attack.top", { optionMessages: commonOptionMessages("pass") }), ["pass", ...attacks.map((card) => card.instanceId)]);
}

function beginThespianCheer(ctx: ScriptCtx): void {
  ctx.requestChoice(
    "aps-thespian-cheer",
    yesNoPrompt("Have the crowd cheer you?", "card.aps.crowd.cheer"),
    ["yes", "no"],
  );
}
function beginThespianReturn(ctx: ScriptCtx): void {
  const auras = ctx.player(ctx.seat).board.filter((card) => hasTag(ctx, card, "aura"));
  if (auras.length) ctx.requestCardChoice("aps-thespian-return", decisionPrompt("Return an aura you control to its owner's hand?", "card.aps.aura.return", { optionMessages: commonOptionMessages("pass") }), ["pass", ...auras.map((card) => card.instanceId)]);
}

export const aps: Record<string, CardScript> = {
  "pleiades, superstar|0": pleiades(),
  "moment maker|0": {
    activated: attackAbility(3),
    onAttackDeclared(ctx) {
      if (suspenseTargets(ctx).length < 3) return;
      ctx.addModifier({ scope: "chain-link", attack: 2 });
      ctx.setFlag("link", "momentMakerCheer", true);
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "momentMakerCheer") === true;
    },
    onHit(ctx) {
      ctx.crowdCheer(ctx.seat);
    },
  },
  "tiara of suspense|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("player", "cheeredThisTurn") === true && suspenseTargets(ctx).length > 0,
      onActivate(ctx) {
        const targets = suspenseTargets(ctx);
        ctx.requestCardChoice("aps-tiara", decisionPrompt("Put a suspense counter on an aura", "card.aps.suspense.counter.add"), targets.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aps-tiara") return;
      const target = suspenseTargets(ctx).find((card) => card.instanceId === Number(option));
      if (target) ctx.setCardCounter(target.instanceId, "suspense", (target.counters?.suspense ?? 0) + 1);
    },
  },
  "virtuoso bodice|0": {
    onDefend(ctx) { removeSuspenseChoice(ctx, "aps-bodice", "Remove a suspense counter to gain {r}{r}?"); },
    onChoose(ctx, hook, option) {
      if (hook === "aps-bodice" && resolveRemoveSuspense(ctx, option)) ctx.changeResources(ctx.seat, 2);
    },
  },
  "attention grabbers|0": {
    onDefend(ctx) { removeSuspenseChoice(ctx, "aps-grabbers", "Remove a suspense counter for +2 defense?"); },
    onChoose(ctx, hook, option) {
      if (hook === "aps-grabbers" && resolveRemoveSuspense(ctx, option)) ctx.addCardTempDefense(ctx.self.instanceId, 2);
    },
  },
  "boots to the boards|0": {
    onDefend(ctx) { ctx.requestXPayment("aps-boots", decisionPrompt("Pay up to {r}{r}{r} to create that many Toughness tokens", "card.aps.toughness.pay", { values: { maximum: 3 } }), undefined, 3); },
    onChoose(ctx, hook, option) {
      if (hook === "aps-boots" && option.startsWith("x:")) ctx.createTokens(TOUGHNESS, Number(option.slice(2)));
    },
  },
  "never give up|2": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromGraveyard: true,
      putSelfOnDeckBottomCost: true,
      canActivate(ctx) {
        if (!ctx.link || ctx.link.attacker === ctx.seat) return false;
        if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) >= 0) return false;
        if (ctx.getFlag("player", "cheeredThisTurn") !== true) return false;
        return ctx.link.defendingCards.some((card) => ctx.hasCardType(card, "action"));
      },
      onActivate(ctx) {
        const defenders = ctx.link?.defendingCards.filter((card) => ctx.hasCardType(card, "action")) ?? [];
        if (defenders.length) {
          ctx.requestCardChoice(
            "aps-never-give-up",
            decisionPrompt("Give a defending action card +3 defense", "card.aps.defender.defense", { values: { amount: 3 } }),
            defenders.map((card) => card.instanceId),
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "aps-never-give-up") ctx.addCardTempDefense(Number(option), 3);
    },
  },
  "spinal crush|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4;
    },
    onHit(ctx) {
      const target = ctx.player(opponentSeat(ctx));
      ctx.setCardCounter(target.hero.instanceId, "goAgainSuppressedPending", 1);
    },
  },
  "standing ovation|3": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined &&
        Number(ctx.getFlag("player", "suspenseAurasLeftThisTurn")) >= 3;
    },
    onHit(ctx) {
      ctx.takeExtraTurn(ctx.seat);
      const target = ctx.player(opponentSeat(ctx));
      ctx.setCardCounter(target.hero.instanceId, "drawUpToAtEndPhaseTurn", ctx.state.turn);
    },
  },
  "superstar|3": suspense((ctx) => ctx.crowdCheer(ctx.seat), (ctx) => ctx.crowdCheer(ctx.seat)),
  "tear asunder|3": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 1, dominate: true, appliesToClass: "guardian" });
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"
      );
    },
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length) ctx.requestCardChoice("aps-tear-first", decisionPrompt("Discard a card", "card.aps.card.discard.first"), hand.map((card) => card.instanceId), opponentSeat(ctx));
    },
    onChoose(ctx, hook, option) {
      if (hook === "aps-tear-first") {
        ctx.discardCard(opponentSeat(ctx), Number(option));
        const hand = ctx.player(opponentSeat(ctx)).hand;
        if (hand.length) ctx.requestCardChoice("aps-tear-second", decisionPrompt("Discard another card", "card.aps.card.discard.next"), hand.map((card) => card.instanceId), opponentSeat(ctx));
      } else if (hook === "aps-tear-second") {
        ctx.discardCard(opponentSeat(ctx), Number(option));
      }
    },
  },
  "thespian charm|2": {
    onPlay(ctx) {
      const tokens = ctx.state.players.flatMap((player) => player.board).filter((card) => named(ctx, card, "Might") || named(ctx, card, "Vigor"));
      if (tokens.length) ctx.requestCardChoice("aps-thespian-token", decisionPrompt("Destroy a Might or Vigor token?", "card.aps.token.destroy", { optionMessages: commonOptionMessages("pass") }), ["pass", ...tokens.map((card) => card.instanceId)]);
      else beginThespianCheer(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "aps-thespian-token") {
        if (option !== "pass") ctx.destroyPermanent(Number(option));
        beginThespianCheer(ctx);
      } else if (hook === "aps-thespian-cheer") {
        if (option === "yes") ctx.crowdCheer(ctx.seat);
        beginThespianReturn(ctx);
      } else if (hook === "aps-thespian-return" && option !== "pass") {
        ctx.moveToHand(Number(option));
      }
    },
  },
  "turning point|3": {
    canTriggerOnDefend: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0,
    onDefend(ctx) {
      if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) ctx.crowdCheer(ctx.seat);
    },
    modifyDefense(ctx) { return ctx.getFlag("player", "cheeredThisTurn") === true ? 3 : 0; },
  },
  "up on a pedestal|3": {
    ...suspense(returnAttackToTop, returnAttackToTop),
    onChoose(ctx, hook, option) {
      if (hook === "aps-pedestal" && option !== "pass") ctx.putOnDeckTop(Number(option));
    },
  },
};
