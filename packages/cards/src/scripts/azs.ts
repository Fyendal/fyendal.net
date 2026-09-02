import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  ampNextArcane,
  commonOptionMessages,
  dealArcane,
  decisionPrompt,
  opponentSeat,
} from "./shared-helpers.js";

const FLOW = "OMN203";
const EMBODIMENT = "ROS026";

type Card = DeepReadonly<CardInstance>;

function isAura(ctx: ScriptCtx, card: Card): boolean {
  return ctx.cardTypes(card).includes("aura");
}

function isLightningAura(ctx: ScriptCtx, card: Card): boolean {
  const types = ctx.cardTypes(card);
  return types.includes("lightning") && types.includes("aura");
}

function holoChoices(ctx: ScriptCtx): readonly Card[] {
  return ctx.player(ctx.seat).board.filter((card) => isLightningAura(ctx, card) && Number(card.counters?.holo ?? 0) === 0);
}

function requestHoloBlink(ctx: ScriptCtx, hook: string): void {
  const choices = holoChoices(ctx);
  if (choices.length) ctx.requestCardChoice(
    hook,
    decisionPrompt(
      `${ctx.data.name}: give a Lightning aura a holo counter?`,
      "card.azs.holo.aura.choose",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId } },
        optionMessages: commonOptionMessages("no"),
      },
    ),
    ["no", ...choices.map((card) => card.instanceId)],
  );
}

function finishHoloBlink(ctx: ScriptCtx, hook: string, expected: string, option: string): boolean {
  if (hook !== expected) return false;
  if (option === "no") return true;
  const id = Number(option);
  if (ctx.banish(id)) {
    ctx.setCardCounter(id, "holo", 1);
    ctx.settleCard(id);
  }
  return true;
}

export const azs: Record<string, CardScript> = {
  "zyggy starlight|0": {
    activated: {
      cost: 2, isAttack: false, goAgain: false, timing: "instant", tap: true,
      effectCardCosts: [
        { zone: "arena", move: "destroy", count: 1, name: "Lightning Flow", prompt: "Choose a Lightning Flow to destroy" },
        { zone: "arena", move: "banish", count: 1, types: ["lightning", "aura"], withoutCounter: "holo", prompt: "Choose another Lightning aura to banish" },
      ],
      onCostPaid(ctx, paid) {
        const aura = paid.find((card) => ctx.player(ctx.seat).banish.some((candidate) => candidate.instanceId === card.instanceId));
        if (aura) ctx.setCounter("zyggyAura", aura.instanceId);
      },
      onActivate(ctx) {
        const id = ctx.getCounter("zyggyAura");
        if (id) { ctx.setCardCounter(id, "holo", 1); ctx.settleCard(id); }
      },
    },
    onFriendlyPlay(ctx, played) {
      if (ctx.getFlag("player", "azsNextAuraHolo") !== true || !isAura(ctx, played)) return;
      ctx.setFlag("player", "azsNextAuraHolo", false);
      ctx.setCardCounter(played.instanceId, "holo", 1);
    },
  },
  "aphrodias|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "instant", tap: true,
      canActivate: (ctx) => ctx.getFlag("player", "azsHoloEntered") === true,
      modifyCost: (ctx, base) => ctx.getFlag("player", "azsAphrodiasBoost") === true ? Math.max(0, base - 1) : base,
      onActivate(ctx) { dealArcane(ctx, opponentSeat(ctx), 2); },
    },
    onFriendlyEnterArena(ctx, entered) {
      if (isAura(ctx, entered) && Number(entered.counters?.holo) > 0) ctx.setFlag("player", "azsHoloEntered", true);
    },
    onDamageDealt(ctx, target, amount) {
      if (amount > 0 && target !== ctx.seat && ctx.getFlag("player", "azsAphrodiasBoost") === true) ctx.createToken(FLOW);
    },
  },
  "starfield veil|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("player", "fragmentedThisTurn") === true,
      onActivate(ctx) { ctx.setFlag("player", "azsNextAuraHolo", true); },
    },
  },
  "starfield carapace|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.setFlag("player", "azsAphrodiasBoost", true); } },
  },
  "starfield touch|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true,
      canActivate: (ctx) => ctx.player(ctx.seat).weapons.some((card) => ctx.cardData(card.cardId).name === "Aphrodias" && card.tapped),
      onActivate(ctx) {
        const weapon = ctx.player(ctx.seat).weapons.find((card) => ctx.cardData(card.cardId).name === "Aphrodias");
        if (weapon) ctx.untap(weapon.instanceId);
      },
    },
  },
  "blitz kicks|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedCardType:instant") === true,
      onActivate(ctx) { ctx.createToken(EMBODIMENT); },
    },
  },
  "miraging metamorph|1": {
    destroyOnChainCloseWhenDefendedByHigherDefense: true,
    onDestroyed(ctx) {
      const auras = ctx.player(ctx.seat).board.filter((card) =>
        ctx.cardTypes(card).includes("aura")
      );
      if (auras.length > 0) {
        ctx.requestCardChoice(
          "miraging-copy",
          decisionPrompt(
            "Miraging Metamorph: choose an aura to copy",
            "card.azs.miraging.aura.copy",
          ),
          auras.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "miraging-copy") ctx.createTokenCopy(Number(option));
    },
  },
  "shattering stardust|1": {
    onFragment(ctx) { ampNextArcane(ctx, 1); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { requestHoloBlink(ctx, "stardust-holo"); },
    onChoose(ctx, hook, option) { finishHoloBlink(ctx, hook, "stardust-holo", option); },
  },
  "stardust spike|1": {
    wardValue: () => 2,
    onLeaveArena(ctx) { ctx.changeResources(ctx.seat, 1); ampNextArcane(ctx, 1); },
  },
  "blur reality|3": {
    canPlay: (ctx) => holoChoices(ctx).length > 0,
    onPlay(ctx) {
      const choices = holoChoices(ctx);
      if (choices.length === 1) {
        const id = choices[0]!.instanceId;
        if (ctx.banish(id)) { ctx.setCardCounter(id, "holo", 1); ctx.settleCard(id); }
      } else if (choices.length > 1) {
        ctx.requestCardChoice(
          "blur-holo",
          decisionPrompt(
            "Blur Reality: choose a Lightning aura",
            "card.azs.blur.aura.choose",
          ),
          choices.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) { finishHoloBlink(ctx, hook, "blur-holo", option); },
  },
};
