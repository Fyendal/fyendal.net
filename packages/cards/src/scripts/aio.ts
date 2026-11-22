import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  decisionMessage,
  decisionPrompt,
  isItem,
  localizedCardLog,
  maintenanceItem,
  ongoingLabel,
  yesNoPrompt,
  hasLiveTurnEffect,
  hasCardSubtype,
  requestCrankSteam,
  resolveCrankSteam,
} from "./shared-helpers.js";

function isMech(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "mechanologist");
}

export const aio: Record<string, CardScript> = {
  "dash i/o|0": {
    lookAtTopDeck: true,
    allowsFriendlyCardPlayFrom(ctx, card, zone) {
      return (
        zone === "deck" &&
        ctx.player(ctx.seat).deck[0]?.instanceId === card.instanceId &&
        ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) &&
        isMech(ctx, card) &&
        (ctx.cardData(card.cardId).cost ?? 0) <= 1
      );
    },
    modifyFriendlyCardPlayCost(ctx, card, zone, baseCost) {
      return zone === "deck" &&
        ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) &&
        isMech(ctx, card) &&
        (ctx.cardData(card.cardId).cost ?? 0) <= 1
        ? baseCost + 1
        : baseCost;
    },
    allowsFriendlyCardPlayAsInstant(ctx, card, zone) {
      return (
        zone === "deck" &&
        ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) &&
        isMech(ctx, card) &&
        (ctx.cardData(card.cardId).cost ?? 0) <= 1
      );
    },
    requiresFriendlyCardPlayAsInstant(ctx, card, zone) {
      return (
        zone === "deck" &&
        ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) &&
        isMech(ctx, card) &&
        (ctx.cardData(card.cardId).cost ?? 0) <= 1
      );
    },
    onFriendlyPlay(ctx, played, from) {
      if (from === "deck" && isItem(ctx, played) && isMech(ctx, played) && (ctx.cardData(played.cardId).cost ?? 0) <= 1) {
        ctx.setFlag("player", "dashTopItemPlayedThisTurn", true);
      }
    },
  },
  "symbiosis shot|0": {
    activated: {
      cost: 0,
      isAttack: true,
      goAgain: false,
      oncePerTurn: false,
      removeCounterCost: { key: "steam", amount: 1 },
    },
    onFriendlyEnterArena(ctx, entered) {
      if (!isItem(ctx, entered) || !isMech(ctx, entered) || ctx.getCounter("steam") >= 6) return;
      ctx.requestChoice(
        "symbiosis-steam",
        yesNoPrompt("Put a steam counter on Symbiosis Shot?", "card.aio.symbiosisshot.steam"),
        ["yes", "no"],
        undefined,
        undefined,
        "yes",
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "symbiosis-steam" && option === "yes" && ctx.getCounter("steam") < 6) {
        ctx.setCounter("steam", ctx.getCounter("steam") + 1);
      }
    },
  },
  "heavy industry surveillance|0": {
    onDefend(ctx) {
      if (ctx.player(ctx.seat).deck.length)
        ctx.requestChoice(
          "surveillance",
          yesNoPrompt("Banish the top card of your deck?", "card.aio.deck.top.banish"),
          ["yes", "no"],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "surveillance" || option !== "yes") return;
      const top = ctx.player(ctx.seat).deck[0];
      if (!top || !ctx.banish(top.instanceId)) return;
      if (isMech(ctx, top)) ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  },
  "heavy industry power plant|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          ...ongoingLabel("gain 1 resource whenever you boost", "card.effect.aio.heavyindustrypowerplant"),
        });
      },
    },
    onBoosted(ctx) {
      if (!hasLiveTurnEffect(ctx)) return;
      ctx.gainResources(ctx.seat, 1);
      ctx.logPublic(
        localizedCardLog(ctx, "Heavy Industry Power Plant: gain {r}", "card.log.common.resources.gained", {
          amount: 1,
        }),
      );
    },
  },
  "heavy industry ram stop|0": {
    defendCost: 1,
    onDefend(ctx) {
      ctx.requestPayment(
        "ram-stop",
        decisionPrompt("Pay 1 resource for +1 defense?", "card.aio.defense.pay", { values: { amount: 1 } }),
        1,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "ram-stop" && option === "paid") ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  },
  "heavy industry gear shift|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      destroySelfCost: true,
      onActivate(ctx) {
        let mech = 0;
        for (let i = 0; i < 2; i += 1) {
          const top = ctx.player(ctx.seat).deck[0];
          if (!top) break;
          if (isMech(ctx, top)) mech += 1;
          ctx.banish(top.instanceId);
        }
        ctx.gainActionPoints(ctx.seat, mech);
      },
    },
  },
  "fast and furious|1": {
    modifyAttack: (ctx) => (ctx.getFlag("player", "crankedThisTurn") === true ? 1 : 0),
    triggers: [
      {
        event: "card-banished-for-boost",
        sourceZone: "self",
        label: "Put a steam counter on an item with crank",
        labelMessage: decisionMessage("card.common.crankitem.steam"),
        effect(ctx) {
          requestCrankSteam(ctx, "fast-furious-steam");
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "fast-furious-steam") resolveCrankSteam(ctx, option);
    },
  },
  "maximum velocity|1": {
    canPlay: (ctx) => Number(ctx.getFlag("player", "boostCountThisTurn")) >= 3,
  },
  "cerebellum processor|3": maintenanceItem(2, {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      onActivate(ctx) {
        ctx.drawCards(ctx.seat, 1);
      },
    },
  }),
};
