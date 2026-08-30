import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility } from "./shared-helpers.js";

const HYPER_DRIVER = "AMX028";
const BANK_BREAKER = "AMX022B";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return data(ctx, card).name.trim().toLowerCase() === name.toLowerCase();
}

function hasSubtype(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, subtype: string): boolean {
  return ctx.cardTypes(card).includes(subtype.toLowerCase());
}

function hyperDrivers(ctx: ScriptCtx) {
  return ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Hyper Driver"));
}

function wrenches(ctx: ScriptCtx) {
  return ctx.player(ctx.seat).weapons.filter((card) => hasSubtype(ctx, card, "wrench"));
}

function hyperDriver(steam: number): CardScript {
  return {
    destroyAtZeroCounter: "steam",
    onEnterArena(ctx) { ctx.setCounter("steam", steam); },
    onBoosted(ctx) {
      const used = `hyperDriverBoost:${ctx.self.instanceId}`;
      if (ctx.getPlayerFlag(ctx.seat, used) === true || ctx.getCounter("steam") <= 0) return;
      ctx.setPlayerFlag(ctx.seat, used, true);
      ctx.setCounter("steam", ctx.getCounter("steam") - 1);
      ctx.changeResources(ctx.seat, 1);
    },
  };
}

function requestConstructDriver(ctx: ScriptCtx): void {
  const chosen = [0, 1, 2]
    .map((index) => ctx.getCounter(`constructDriver${index}`))
    .filter((id) => id > 0);
  const choices = hyperDrivers(ctx).filter((card) => !chosen.includes(card.instanceId));
  if (choices.length === 0) return;
  ctx.requestCardChoice(
    "construct-driver",
    `Construct Bank Breaker: choose Hyper Driver ${chosen.length + 1} of 3`,
    choices.map((card) => card.instanceId),
  );
}

export const amx: Record<string, CardScript> = {
  "maxx 'the hype' nitro|0": {
    grantsCrankToFriendly(ctx, card) { return named(ctx, card, "Hyper Driver"); },
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, "boostedThisTurn") === true,
      onActivate(ctx) {
        const driver = ctx.createToken(HYPER_DRIVER);
        if (driver) ctx.setCardCounter(driver.instanceId, "steam", 2);
      },
    },
  },

  "banksy|0": {
    activated: attackAbility(1, {
      canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, "crankedThisTurn") === true,
    }),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const items = ctx.player(ctx.seat).board.filter((card) =>
        hasSubtype(ctx, card, "item") && (
          named(ctx, card, "Hyper Driver") ||
          (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "crank")
        )
      );
      if (items.length) ctx.requestCardChoice("banksy-steam", "Put a steam counter on an item with crank", items.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook === "banksy-steam") ctx.addCounter(Number(option), "steam", 1);
    },
  },

  "breaker helm protos|0": {
    onDefend(ctx) {
      const choices = ctx.player(ctx.seat).hand.filter((card) => named(ctx, card, "Hyper Driver"));
      if (choices.length) ctx.requestCardChoice("breaker-helm", "Discard a Hyper Driver to draw and get +1 defense?", ["pass", ...choices.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "breaker-helm" || option === "pass") return;
      if (!ctx.discardCard(ctx.seat, Number(option))) return;
      ctx.drawCards(ctx.seat, 1);
      ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  },

  "puffer jacket|0": {
    onFriendlyEnterArena(ctx, entered) {
      if (data(ctx, entered).cardType !== "token" && named(ctx, entered, "Hyper Driver")) {
        ctx.addCounter(entered.instanceId, "steam", 1);
      }
    },
  },

  "fist pump|0": {
    onBoosted(ctx, _boosted, banished) {
      if (!named(ctx, banished, "Hyper Driver")) return;
      const choices = wrenches(ctx);
      if (choices.length) ctx.requestCardChoice("fist-pump", "Target a wrench to get +1 power this turn", choices.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook === "fist-pump") ctx.addCardTempPower(Number(option), 1);
    },
  },

  "drive brake|0": {
    onBoosted(ctx, _boosted, banished) {
      if (named(ctx, banished, "Hyper Driver") && (ctx.self.defCounters ?? 0) > 0) {
        ctx.addCardDefenseCounters(ctx.self.instanceId, -1);
      }
    },
  },

  "heist|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const choices = ctx.state.players.flatMap((player) => player.banish).filter((card) => {
        const cardData = data(ctx, card);
        return !card.faceDown && hasSubtype(ctx, card, "item") && (cardData.cost ?? 0) <= 1;
      });
      if (choices.length) ctx.requestCardChoice("heist-item", "Put a cost 0 or 1 banished item into the arena?", ["pass", ...choices.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "heist-item" || option === "pass") return;
      ctx.settleCard(Number(option), { controllerSeat: ctx.seat });
    },
  },

  "twintek charging station|1": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", onBoostAttack: 3 });
      const choices = ctx.player(ctx.seat).graveyard.filter((card) => named(ctx, card, "Hyper Driver"));
      if (choices.length) ctx.requestCardChoice("twintek-driver", "Shuffle a Hyper Driver into your deck and gain a resource?", ["pass", ...choices.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "twintek-driver" || option === "pass") return;
      if (ctx.putOnDeckBottom(Number(option))) {
        ctx.shuffleDeck();
        ctx.changeResources(ctx.seat, 1);
      }
    },
  },

  "construct bank breaker|2": {
    canPlay: (ctx) => wrenches(ctx).length > 0 && hyperDrivers(ctx).length >= 3,
    onPlay(ctx) {
      ctx.requestCardChoice("construct-wrench", "Choose a wrench to transform", wrenches(ctx).map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook === "construct-wrench") {
        ctx.setCounter("constructWrench", Number(option));
        requestConstructDriver(ctx);
        return;
      }
      if (hook !== "construct-driver") return;
      const chosen = [0, 1, 2]
        .map((index) => ctx.getCounter(`constructDriver${index}`))
        .filter((id) => id > 0);
      if (chosen.includes(Number(option))) return;
      ctx.setCounter(`constructDriver${chosen.length}`, Number(option));
      if (chosen.length < 2) {
        requestConstructDriver(ctx);
        return;
      }
      const wrench = ctx.getCounter("constructWrench");
      ctx.transformInto(BANK_BREAKER, [wrench, ...chosen, Number(option)], wrench);
    },
  },

  "bank breaker|0": {
    activated: attackAbility(1, {
      activationsPerTurn: 2,
      canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, "crankedThisTurn") === true,
    }),
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      if (ctx.self.subcards?.length) {
        ctx.requestCardChoice("bank-breaker-material", "Banish a card from under Bank Breaker?", ["pass", ...ctx.self.subcards.map((card) => card.instanceId)]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "bank-breaker-material" || option === "pass") return;
      if (!ctx.banishSubcard(ctx.self.instanceId, Number(option))) return;
      ctx.setFlag("link", "overpower", true);
      ctx.grantGoAgain();
    },
  },

  "clamp press|3": {
    onEnterArena(ctx) { ctx.setCounter("steam", 2); },
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: "Remove a steam counter or destroy Clamp Press",
      effect(ctx) {
        if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
        else ctx.requestChoice("clamp-maintenance", "Remove a steam counter or destroy Clamp Press?", ["remove", "destroy"]);
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "clamp-maintenance") return;
      if (option === "remove") ctx.setCounter("steam", Math.max(0, ctx.getCounter("steam") - 1));
      else ctx.destroySelf();
    },
    modifyAttack(ctx) {
      return ctx.link?.attackCardType === "weapon" && hasSubtype(ctx, ctx.link.attackingCard, "wrench") ? 2 : 0;
    },
  },

  "hyper driver|0": hyperDriver(0),
};
