import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function isItem(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasType(ctx, card, "item");
}

function isMech(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasType(ctx, card, "mechanologist");
}

function crankItem(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return isItem(ctx, card) && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "crank");
}

function addSteamChoice(ctx: ScriptCtx, hook: string): void {
  const items = ctx.player(ctx.seat).board.filter((card) => crankItem(ctx, card));
  if (items.length) ctx.requestCardChoice(hook, "Put a steam counter on an item with crank", items.map((card) => card.instanceId));
}

function maintenanceItem(steam: number, extra: CardScript = {}): CardScript {
  return {
    ...extra,
    onEnterArena(ctx) {
      ctx.setCounter("steam", steam);
      extra.onEnterArena?.(ctx);
    },
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Remove a steam counter or destroy this",
        effect(ctx) {
          if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
          else ctx.requestChoice("aio-maintenance", "Remove a steam counter or destroy this?", ["remove", "destroy"]);
        },
      },
      ...(extra.triggers ?? []),
    ],
    onChoose(ctx, hook, option) {
      if (hook === "aio-maintenance") {
        if (option === "remove") ctx.setCounter("steam", Math.max(0, ctx.getCounter("steam") - 1));
        else ctx.destroySelf();
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

export const aio: Record<string, CardScript> = {
  "dash i/o|0": {
    lookAtTopDeck: true,
    allowsFriendlyCardPlayFrom(ctx, card, zone) {
      return zone === "deck" && ctx.player(ctx.seat).deck[0]?.instanceId === card.instanceId &&
        ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) && isMech(ctx, card) && (data(ctx, card).cost ?? 0) <= 1;
    },
    modifyFriendlyCardPlayCost(ctx, card, zone, baseCost) {
      return zone === "deck" && ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) && isMech(ctx, card) && (data(ctx, card).cost ?? 0) <= 1 ? baseCost + 1 : baseCost;
    },
    allowsFriendlyCardPlayAsInstant(ctx, card, zone) {
      return zone === "deck" && ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) && isMech(ctx, card) && (data(ctx, card).cost ?? 0) <= 1;
    },
    requiresFriendlyCardPlayAsInstant(ctx, card, zone) {
      return zone === "deck" && ctx.getFlag("player", "dashTopItemPlayedThisTurn") !== true &&
        isItem(ctx, card) && isMech(ctx, card) && (data(ctx, card).cost ?? 0) <= 1;
    },
    onFriendlyPlay(ctx, played, from) {
      if (from === "deck" && isItem(ctx, played) && isMech(ctx, played) && (data(ctx, played).cost ?? 0) <= 1) {
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
      ctx.requestChoice("symbiosis-steam", "Put a steam counter on Symbiosis Shot?", ["yes", "no"], undefined, undefined, "yes");
    },
    onChoose(ctx, hook, option) {
      if (hook === "symbiosis-steam" && option === "yes" && ctx.getCounter("steam") < 6) {
        ctx.setCounter("steam", ctx.getCounter("steam") + 1);
      }
    },
  },
  "heavy industry surveillance|0": {
    onDefend(ctx) {
      if (ctx.player(ctx.seat).deck.length) ctx.requestChoice("surveillance", "Banish the top card of your deck?", ["yes", "no"]);
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
      onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); },
    },
    onBoosted(ctx) {
      const activated = ctx.state.modifiers.some((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "until-end-of-turn" &&
        !modifier.consumed
      );
      if (!activated) return;
      ctx.changeResources(ctx.seat, 1);
      ctx.logPublic("Heavy Industry Power Plant: gain {r}");
    },
  },
  "heavy industry ram stop|0": {
    defendCost: 1,
    onDefend(ctx) { ctx.requestPayment("ram-stop", "Pay 1 resource for +1 defense?", 1); },
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
        ctx.changeActionPoints(ctx.seat, mech);
      },
    },
  },
  "fast and furious|1": {
    modifyAttack: (ctx) => ctx.getFlag("player", "crankedThisTurn") === true ? 1 : 0,
    onBanishedForBoost(ctx) { addSteamChoice(ctx, "fast-furious-steam"); },
    onChoose(ctx, hook, option) {
      if (hook === "fast-furious-steam") ctx.addCounter(Number(option), "steam", 1);
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
      onActivate(ctx) { ctx.drawCards(ctx.seat, 1); },
    },
  }),
};
