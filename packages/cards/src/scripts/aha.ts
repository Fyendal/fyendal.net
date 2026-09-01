import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, isSwordAttack } from "./shared-helpers.js";
import {
  resolveSharpenFollowup,
  SHARPEN_FOLLOWUP,
  sharpenSword,
} from "./aha/warrior-sharpen.js";

const FLURRY = "SBL036";

type Card = DeepReadonly<CardInstance>;

function isSword(ctx: ScriptCtx, card: Card): boolean {
  return ctx.cardTypes(card).some((type) => type.toLowerCase() === "sword");
}

function swords(ctx: ScriptCtx): readonly Card[] {
  return ctx.player(ctx.seat).weapons.filter((card) => isSword(ctx, card));
}

function chooseSword(ctx: ScriptCtx, hook: string, prompt: string): void {
  const choices = swords(ctx);
  if (choices.length === 1) sharpenSword(ctx, choices[0]!.instanceId);
  else if (choices.length > 1) ctx.requestCardChoice(hook, prompt, choices.map((card) => card.instanceId));
}

function sharpenAction(threshold: number, payoff: "flurry" | "discount"): CardScript {
  const finish = (ctx: ScriptCtx, id: number) => {
    sharpenSword(ctx, id, 1, {
      threshold,
      kind: payoff === "flurry" ? SHARPEN_FOLLOWUP.SBL_FLURRY : SHARPEN_FOLLOWUP.DISCOUNT,
    });
  };
  return {
    canPlay: (ctx) => swords(ctx).length > 0,
    onPlay(ctx) {
      const choices = swords(ctx);
      if (choices.length === 1) finish(ctx, choices[0]!.instanceId);
      else ctx.requestCardChoice("aha-sharpen", `${ctx.data.name}: choose a sword to sharpen`, choices.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "aha-sharpen") finish(ctx, Number(option)); },
  };
}

function weaponReaction(power: number, effect?: (ctx: ScriptCtx, weapon: Card) => void): CardScript {
  return {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "weapon",
    onPlay(ctx) {
      const weapon = ctx.link?.attackingCard;
      if (!weapon) return;
      ctx.addModifier({ scope: "chain-link", attack: power });
      effect?.(ctx, weapon);
    },
  };
}

function swordPath(power: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: power, appliesToSubtype: "sword" });
      ctx.setFlag("player", "ahaExtraSharpen", true);
    },
  };
}

export const aha: Record<string, CardScript> = {
  "hala, bladesaint of the vow|0": {
    activated: {
      cost: 3, isAttack: false, goAgain: true, tap: true,
      canActivate: (ctx) => swords(ctx).length > 0,
      onActivate(ctx) { chooseSword(ctx, "hala-sharpen", "Hala: choose a sword to sharpen"); },
    },
    onChoose(ctx, hook, option) { if (hook === "hala-sharpen") sharpenSword(ctx, Number(option)); },
  },
  "zenith blade|0": {
    activated: attackAbility(1),
    onAttackDeclared(ctx) {
      if (
        Number(ctx.self.counters?.sharpenedTurn) === ctx.state.turn &&
        Number(ctx.getFlag("player", `attackedInstance:${ctx.self.instanceId}`)) === 1
      ) ctx.grantGoAgain();
    },
  },
  "anticipating gaze|0": {
    onFriendlyCombatDamageDealt(ctx, source, target, amount) {
      if (amount <= 0 || target === ctx.seat || !isSword(ctx, source) || Number(source.counters?.power) < 1) return;
      ctx.setCounter("gazeSword", source.instanceId);
      ctx.requestChoice("gaze-draw", "Anticipating Gaze: remove a counter, destroy this, and draw?", ["yes", "no"]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "gaze-draw" || option !== "yes") return;
      const id = ctx.getCounter("gazeSword");
      ctx.addCounter(id, "power", -1);
      ctx.destroySelf();
      ctx.drawCards(ctx.seat, 1);
    },
  },
  "paragon plate|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", tap: true,
      canActivate: (ctx) => isSwordAttack(ctx) && Number(ctx.link?.attackingCard.counters?.power) > 0,
      onActivate(ctx) {
        const id = ctx.link?.attackingCard.instanceId;
        if (id !== undefined) ctx.addCounter(id, "power", -1);
        ctx.changeResources(ctx.seat, 1);
      },
    },
  },
  "reverent rerebrace|0": {
    onChoose(ctx, hook, option) {
      if (hook === "rerebrace-honed-top") {
        if (option !== "no") ctx.putOnDeckTop(Number(option));
        return;
      }
      if (hook !== "rerebrace-sharpen") return;
      const target = ctx.getCounter("sharpenTarget");
      const threshold = ctx.getCounter("sharpenFollowupThreshold");
      const payoff = ctx.getCounter("sharpenFollowupKind");
      ctx.setCardCounter(ctx.self.instanceId, "sharpenFollowupThreshold", 0);
      ctx.setCardCounter(ctx.self.instanceId, "sharpenFollowupKind", 0);
      if (option === "paid") {
        ctx.addCounter(target, "power", 1);
        ctx.destroySelf();
        ctx.logPublic("Reverent Rerebrace sharpens Zenith Blade an additional time");
      }
      resolveSharpenFollowup(ctx, target, threshold, payoff);
    },
  },
  "silverstride dodgers|0": {
    modifyDefense(ctx) {
      return ctx.player(ctx.seat).board.some((card) => ctx.cardData(card.cardId).name === "Flurry") ? 1 : 0;
    },
  },
  "deadly display|1": weaponReaction(3, (ctx, weapon) => {
    if (Number(weapon.counters?.sharpenedTurn) === ctx.state.turn) {
      ctx.addModifier({ scope: "chain-link", onHitCreateToken: { cardId: FLURRY, count: 1 } });
    }
  }),
  "deadly display|3": weaponReaction(1, (ctx, weapon) => {
    if (Number(weapon.counters?.sharpenedTurn) === ctx.state.turn) {
      ctx.addModifier({ scope: "chain-link", onHitCreateToken: { cardId: FLURRY, count: 1 } });
    }
  }),
  "gleam of the blade|1": {
    ...weaponReaction(3),
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => { ctx.createToken(FLURRY); } },
  },
  "polished blade|1": {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "weapon" &&
      isSword(ctx, ctx.link.attackingCard) && Number(ctx.link.attackingCard.counters?.power) > 0,
    additionalCost(ctx) {
      const weapon = ctx.link?.attackingCard;
      if (!weapon) return;
      ctx.setCounter("polishedSword", weapon.instanceId);
      const maximum = Math.min(2, Number(weapon.counters?.power ?? 0));
      ctx.requestChoice(
        "polished-counters",
        "Polished Blade: choose counters to remove",
        Array.from({ length: maximum }, (_, index) => `remove ${index + 1}`),
      );
    },
    onPlay(ctx) {
      const sword = ctx.getCounter("polishedSword");
      const modes = ctx.getCounter("polishedModes");
      if (modes & 1) ctx.grantGoAgain();
      if (modes & 2) ctx.setAttackActivationLimit(sword, 2);
      if (modes & 4) buffNextAttack(ctx, { attackActivationCostReduction: 1, appliesToInstanceId: sword });
    },
    onChoose(ctx, hook, option) {
      if (hook === "polished-counters") {
        const removed = Number(option.replace("remove ", ""));
        ctx.addCounter(ctx.getCounter("polishedSword"), "power", -removed);
        ctx.setCounter("polishedModesRemaining", removed + 1);
        ctx.setCounter("polishedModes", 0);
      } else if (hook === "polished-mode") {
        const bit = option === "go again" ? 1 : option === "additional attack" ? 2 : 4;
        ctx.setCounter("polishedModes", ctx.getCounter("polishedModes") | bit);
        ctx.setCounter("polishedModesRemaining", ctx.getCounter("polishedModesRemaining") - 1);
      } else return;
      const remaining = ctx.getCounter("polishedModesRemaining");
      if (remaining <= 0) return;
      const mask = ctx.getCounter("polishedModes");
      const modes = [
        ...(mask & 1 ? [] : ["go again"]),
        ...(mask & 2 ? [] : ["additional attack"]),
        ...(mask & 4 ? [] : ["activation discount"]),
      ];
      ctx.requestChoice("polished-mode", `Polished Blade: choose ${remaining} more mode(s)`, modes);
    },
  },
  "silverdrop downpour|1": {
    ...weaponReaction(4),
    modifyPlayCost(ctx, base) {
      return Number(ctx.link?.attackingCard.counters?.sharpenedTurn) === ctx.state.turn ? Math.max(0, base - 1) : base;
    },
  },
  "brimming blade|1": {
    canPlay: (ctx) => swords(ctx).length > 0,
    onPlay(ctx) {
      const choices = swords(ctx);
      if (choices.length === 1) sharpenSword(ctx, choices[0]!.instanceId, 2);
      else ctx.requestCardChoice("brimming", "Choose a sword to sharpen twice", choices.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "brimming") sharpenSword(ctx, Number(option), 2); },
  },
  "edict of steel|2": sharpenAction(2, "flurry"),
  "edict of steel|3": sharpenAction(3, "flurry"),
  "sharp incline|1": sharpenAction(1, "discount"),
  "sharp incline|2": sharpenAction(2, "discount"),
  "swordmaster's path|1": swordPath(3),
  "swordmaster's path|3": swordPath(1),
  "flurry foot dance|2": {
    modifyDefense(ctx) { return ctx.player(ctx.seat).board.some((card) => ctx.cardData(card.cardId).name === "Flurry") ? 2 : 0; },
  },
  "backside of the blade|3": weaponReaction(1, (ctx, weapon) => {
    if (ctx.link?.goAgain) ctx.grantAdditionalActivation(weapon.instanceId);
  }),
  "olé|3": weaponReaction(0, (ctx, weapon) => {
    if (Number(weapon.counters?.power) < 1) return;
    ctx.addCounter(weapon.instanceId, "power", -1);
    ctx.createToken(FLURRY);
    ctx.drawCards(ctx.seat, 1);
  }),
  "indefensibly honed|3": {
    canPlay: (ctx) => swords(ctx).length > 0,
    onPlay(ctx) {
      const choices = swords(ctx);
      if (choices.length === 1) {
        sharpenSword(ctx, choices[0]!.instanceId, 1, {
          threshold: 3,
          kind: SHARPEN_FOLLOWUP.DEFENDED_DAMAGE,
        });
      } else if (choices.length > 1) {
        ctx.requestCardChoice("indefensible-sharpen", "Choose a sword to sharpen", choices.map((card) => card.instanceId));
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "indefensible-sharpen") return;
      const id = Number(option);
      sharpenSword(ctx, id, 1, {
        threshold: 3,
        kind: SHARPEN_FOLLOWUP.DEFENDED_DAMAGE,
      });
    },
  },
  "shuck|3": { onPlay: (ctx) => { ctx.createToken(FLURRY); } },
  "visit the dawnsmith|3": {
    triggers: [{ event: "start-of-turn", label: "Destroy Visit the Dawnsmith and sharpen swords", effect(ctx) {
      ctx.destroySelf();
      for (const sword of swords(ctx)) sharpenSword(ctx, sword.instanceId);
    } }],
  },
};
