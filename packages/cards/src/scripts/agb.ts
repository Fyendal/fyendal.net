import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility } from "./shared-helpers.js";
import { sgb } from "./sgb.js";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function wateryGrave(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "watery grave");
}

function pirateAlly(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  const types = ctx.cardTypes(card);
  return types.includes("ally") && types.includes("pirate");
}

const gravyBones = sgb["gravy bones|0"] as CardScript;

export const agb: Record<string, CardScript> = {
  "gravy bones, shipwrecked looter|0": gravyBones,

  "tricorn of saltwater death|0": {
    onDefend(ctx) {
      const choices = ctx.player(ctx.seat).hand.filter((card) => wateryGrave(ctx, card));
      if (choices.length) ctx.requestCardChoice("tricorn-discard", "Discard a card with watery grave to draw?", ["pass", ...choices.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "tricorn-discard" || option === "pass") return;
      if (ctx.discardCard(ctx.seat, Number(option))) ctx.drawCards(ctx.seat, 1);
    },
  },

  "graven justaucorpse|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      effectCardCosts: [{ zone: "hand", move: "discard", count: 1, prompt: "Choose a card to discard" }],
      onCostPaid(ctx, paidCards) {
        const discarded = paidCards[0];
        if (discarded) ctx.changeResources(ctx.seat, ctx.cardData(discarded.cardId).pitch ?? 0);
      },
    },
  },

  "breakwater undertow|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat && pirateAlly(ctx, ctx.link.attackingCard),
      onActivate(ctx) {
        ctx.grantGoAgain();
        ctx.setFlag("link", "destroyAttackerOnChainClose", true);
      },
    },
  },

  "anka, drag under|2": {
    activated: [
      ...attackAbility(1, { tap: true, oncePerTurn: false }),
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "instant",
        tap: true,
        label: "Instant — discard watery grave: punish next draw",
        effectCardCosts: [{ zone: "hand", move: "discard", count: 1, keyword: "Watery Grave", prompt: "Discard a card with watery grave" }],
        onCostPaid(ctx) { ctx.setCounter("ankaDrawTrap", ctx.state.turn); },
      },
    ],
    onOpponentDraws(ctx, drawingSeat, count) {
      if (count <= 0 || ctx.getCounter("ankaDrawTrap") !== ctx.state.turn) return;
      ctx.setCounter("ankaDrawTrap", 0);
      const hand = ctx.player(drawingSeat).hand;
      if (!hand.length) return;
      ctx.setCounter("ankaDrawingSeat", drawingSeat + 1);
      ctx.requestCardChoice("anka-discard", "Anka: discard a card", hand.map((card) => card.instanceId), drawingSeat);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "anka-discard") return;
      const drawingSeat = ctx.getCounter("ankaDrawingSeat") - 1;
      if (drawingSeat >= 0) ctx.discardCard(drawingSeat, Number(option));
    },
  },

  "sawbones, dock hand|2": {
    activated: [
      ...attackAbility(1, { tap: true, oncePerTurn: false }),
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "instant",
        tap: true,
        label: "Instant — prevent the next 1 damage",
        onActivate(ctx) {
          ctx.addModifier({
            scope: "until-end-of-turn",
            preventNextDamageAmount: 1,
            appliesToDamageRecipientType: "pirate",
          });
        },
      },
    ],
  },

  "call to the grave|3": {
    onPlay(ctx) {
      const deck = ctx.player(ctx.seat).deck;
      if (deck.length) ctx.requestCardChoice("call-grave", "Choose a card to put into your graveyard", deck.map((card) => card.instanceId));
      else ctx.shuffleDeck();
    },
    onChoose(ctx, hook, option) {
      if (hook !== "call-grave") return;
      ctx.moveToGraveyard(Number(option), "deck");
      ctx.shuffleDeck();
    },
  },
};
