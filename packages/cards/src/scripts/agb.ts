import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, commonOptionMessages, decisionPrompt } from "./shared-helpers.js";
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
      if (choices.length)
        ctx.requestCardChoice(
          "tricorn-discard",
          decisionPrompt("Discard a card with watery grave to draw?", "card.agb.waterygrave.discard.draw", {
            optionMessages: commonOptionMessages("pass"),
          }),
          ["pass", ...choices.map((card) => card.instanceId)],
        );
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
      effectCardCosts: [
        {
          zone: "hand",
          move: "discard",
          count: 1,
          prompt: decisionPrompt("Choose a card to discard", "card.common.card.discard.choose"),
        },
      ],
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
        effectCardCosts: [
          {
            zone: "hand",
            move: "discard",
            count: 1,
            keyword: "Watery Grave",
            prompt: decisionPrompt("Discard a card with watery grave", "card.common.cost.waterygrave.discard"),
          },
        ],
        onActivate(ctx) {
          ctx.setState("ankaDrawTrap", ctx.state.turn);
        },
      },
    ],
    triggers: [
      {
        // One draw event queues one card-drawn event per card; the first
        // consumes the trap so a multi-card draw triggers once. The discard
        // resolves as a layer, after the drawing effect finishes.
        event: "card-drawn",
        whose: "any",
        label: "Anka: discard a card",
        labelMessage: { id: "card.agb.anka.card.discard" },
        condition: (ctx, drawn) =>
          drawn !== undefined &&
          drawn.owner !== ctx.seat &&
          ["action", "layer", "reaction"].includes(ctx.state.phase) &&
          ctx.getState("ankaDrawTrap") === ctx.state.turn,
        onTrigger(ctx, drawn) {
          ctx.setState("ankaDrawTrap", 0);
          ctx.setState("ankaDrawingSeat", drawn!.owner + 1);
        },
        effect(ctx) {
          const drawingSeat = ctx.getState("ankaDrawingSeat") - 1;
          const hand = ctx.player(drawingSeat).hand;
          if (!hand.length) return;
          ctx.requestCardChoice(
            "anka-discard",
            decisionPrompt("Anka: discard a card", "card.agb.anka.card.discard"),
            hand.map((card) => card.instanceId),
            drawingSeat,
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "anka-discard") return;
      const drawingSeat = ctx.getState("ankaDrawingSeat") - 1;
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
      if (deck.length)
        ctx.requestCardChoice(
          "call-grave",
          decisionPrompt("Choose a card to put into your graveyard", "card.agb.deck.card.graveyard"),
          deck.map((card) => card.instanceId),
        );
      else ctx.shuffleDeck();
    },
    onChoose(ctx, hook, option) {
      if (hook !== "call-grave") return;
      ctx.moveToGraveyard(Number(option), "deck");
      ctx.shuffleDeck();
    },
  },
};
