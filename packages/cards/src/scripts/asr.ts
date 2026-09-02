import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, commonOptionMessages, decisionPrompt, opponentSeat, previousAttackHasName, previousAttackNameContains, yesNoPrompt } from "./shared-helpers.js";
import { cruNinjaWarrior } from "./cru/ninja-warrior.js";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function normalizedName(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): string {
  return data(ctx, card).name.trim().toLowerCase();
}

function previousWasEdge(ctx: ScriptCtx): boolean {
  return previousAttackHasName(ctx, "edge of autumn");
}

function previousWasEdgeOrVengeance(ctx: ScriptCtx): boolean {
  return previousAttackHasName(ctx, "edge of autumn") ||
    previousAttackNameContains(ctx, "vengeance");
}

function ninjaAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack") &&
    ctx.cardTypes(card).includes("ninja");
}

function offerGiveAndTake(ctx: ScriptCtx): void {
  const choices = ctx.player(ctx.seat).graveyard.filter((card) =>
    ctx.hasCardType(card, "action") && (data(ctx, card).cost ?? 0) < ctx.currentAttackPower()
  );
  if (choices.length) ctx.requestCardChoice("give-take-top", decisionPrompt("Put an eligible action card from your graveyard on top of your deck?", "card.asr.graveyard.action.top", { optionMessages: commonOptionMessages("pass") }), ["pass", ...choices.map((card) => card.instanceId)]);
}

function seekVengeance(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (previousWasEdge(ctx)) ctx.grantGoAgain();
    },
  };
}

function bitteringThorns(): CardScript {
  return { onHit(ctx) { buffNextAttack(ctx, { attack: 1 }); } };
}

export const asr: Record<string, CardScript> = {
  "ira, scarlet revenger|0": cruNinjaWarrior["ira, crimson haze|0"] as CardScript,

  "iris of the blossom|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      discardCost: { count: 1 },
      canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, "dealtDamageThisTurn") === true,
      onActivate(ctx) {
        const choices = ctx.player(ctx.seat).deck.filter((card) => normalizedName(ctx, card) === "whirling mist blossom");
        if (choices.length) ctx.requestCardChoice("iris-blossom", decisionPrompt("Search for Whirling Mist Blossom to banish", "card.asr.whirlingmistblossom.banish"), choices.map((card) => card.instanceId));
        else ctx.shuffleDeck();
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iris-blossom") return;
      const id = Number(option);
      if (ctx.banish(id)) ctx.allowPlayFrom(id, "banish");
      ctx.shuffleDeck();
    },
  },

  "robe of autumn's fall|0": {
    onFriendlyCombatDamageDealt(ctx, source) {
      if (normalizedName(ctx, source) === "edge of autumn") {
        ctx.requestChoice("robe-autumn", yesNoPrompt("Destroy Robe of Autumn's Fall to gain a resource?", "card.asr.robe.destroy.resource"), ["yes", "no"]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "robe-autumn" || option !== "yes") return;
      ctx.destroySelf();
      ctx.changeResources(ctx.seat, 1);
    },
  },

  "okana scar wraps|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      tap: true,
      effectCardCosts: [{ zone: "arena", move: "banish", count: 1, name: "Edge of Autumn", prompt: "Banish an Edge of Autumn" }],
      canActivate: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat && ninjaAttack(ctx, ctx.link.attackingCard),
      onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); },
    },
    canTriggerOnHit(ctx) {
      return !!ctx.link && normalizedName(ctx, ctx.link.attackingCard).includes("vengeance");
    },
    onHit(ctx) {
      const choices = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && normalizedName(ctx, card) === "edge of autumn");
      if (choices.length) ctx.requestCardChoice("okana-equip", decisionPrompt("Equip an Edge of Autumn from banish?", "card.asr.edgeofautumn.equip", { optionMessages: commonOptionMessages("pass") }), ["pass", ...choices.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "okana-equip" && option !== "pass") ctx.equipFromBanish(Number(option));
    },
  },

  "bittering thorns|1": bitteringThorns(),
  "bittering thorns|3": bitteringThorns(),

  "enact vengeance|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && previousWasEdgeOrVengeance(ctx);
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      for (const card of [...ctx.player(target).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal");
    },
  },

  "give and take|1": {
    friendlyDefendedTrigger: {
      label: "Whenever an action card defends this",
      condition(ctx, defenders) {
        return ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
          defenders.some((card) => ctx.hasCardType(card, "action"));
      },
    },
    onFriendlyDefended(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      const actionDefenders = ctx.link.defendingCards.filter((card) =>
        ctx.hasCardType(card, "action")
      ).length;
      const seen = ctx.getCounter("giveTakeActionDefendersSeen");
      const triggers = Math.max(0, actionDefenders - seen);
      ctx.setCounter("giveTakeActionDefendersSeen", actionDefenders);
      if (triggers <= 0) return;
      ctx.setCounter("giveTakeRemaining", triggers);
      offerGiveAndTake(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "give-take-top") return;
      if (option !== "pass") ctx.putOnDeckTop(Number(option));
      const remaining = Math.max(0, ctx.getCounter("giveTakeRemaining") - 1);
      ctx.setCounter("giveTakeRemaining", remaining);
      if (remaining > 0) offerGiveAndTake(ctx);
    },
  },

  "seek vengeance|1": seekVengeance(),
  "seek vengeance|3": seekVengeance(),

  "vengeance never rests|3": {
    onAttackDeclared(ctx) {
      if (previousWasEdge(ctx)) ctx.grantGoAgain();
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && previousWasEdge(ctx);
    },
    onHit(ctx) {
      if (ctx.banish(ctx.self.instanceId)) {
        ctx.allowPlayFrom(ctx.self.instanceId, "banish");
      }
    },
  },

  "legacy of ikaru|3": {
    canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat &&
      ctx.cardTypes(ctx.link.attackingCard).includes("ninja"),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
    canTriggerOnHit: previousWasEdge,
    onHit(ctx) {
      ctx.drawCards(ctx.seat, 1);
    },
  },
};
