import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, commonOptionMessages, decisionMessage, decisionPrompt, opponentSeat } from "./shared-helpers.js";

const FROSTBITE = "AJV029";
const EARTH = "AJV028";
const SEISMIC = "AJV030";
const SLOTS = ["head", "chest", "arms", "legs"] as const;

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function exposed(ctx: ScriptCtx, seat: number): string[] {
  const player = ctx.player(seat);
  return SLOTS.filter((slot) => !player.equipment[slot] && !player.board.some((card) => card.counters?.[`frostZone:${slot}`]));
}

function offerExposedFrostbite(ctx: ScriptCtx, hook: string, seat: number, optional = false): void {
  const slots = exposed(ctx, seat);
  if (slots.length) ctx.requestChoice(hook, decisionPrompt("Choose an exposed equipment zone for Frostbite", "card.ajv.frostbite.zone.choose", { optionMessages: {
    ...commonOptionMessages("none"),
    head: decisionMessage("card.common.option.head"),
    chest: decisionMessage("card.common.option.chest"),
    arms: decisionMessage("card.common.option.arms"),
    legs: decisionMessage("card.common.option.legs"),
  } }), [...(optional ? ["none"] : []), ...slots], seat === ctx.seat ? ctx.seat : undefined);
}

function createExposedFrostbite(ctx: ScriptCtx, seat: number, slot: string): void {
  if (!SLOTS.includes(slot as typeof SLOTS[number]) || !exposed(ctx, seat).includes(slot)) return;
  const token = ctx.createToken(FROSTBITE, seat);
  if (token) ctx.addCounter(token.instanceId, `frostZone:${slot}`, 1);
}

function allEquipment(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return ctx.state.players.flatMap((player) => [
    ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined),
    ...player.weapons.filter((card) => data(ctx, card).cardType === "equipment"),
  ]);
}

function fused(ctx: ScriptCtx, type?: "earth" | "ice"): boolean {
  return type ? ctx.getCounter(`fused${type === "earth" ? "Earth" : "Ice"}`) > 0 :
    ctx.getCounter("fusedEarth") > 0 || ctx.getCounter("fusedIce") > 0;
}

function elementalFusion(): Pick<CardScript, "additionalCost" | "onChoose"> {
  return {
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      const earth = hand.filter((card) => hasType(ctx, card, "earth"));
      const ice = hand.filter((card) => hasType(ctx, card, "ice"));
      const options = new Set<string>(["no"]);
      for (const card of earth) options.add(`earth:${card.instanceId}`);
      for (const card of ice) options.add(`ice:${card.instanceId}`);
      for (const card of hand) if (hasType(ctx, card, "earth") && hasType(ctx, card, "ice")) options.add(`both:${card.instanceId}:${card.instanceId}`);
      for (const e of earth) for (const i of ice) if (e.instanceId !== i.instanceId) options.add(`both:${e.instanceId}:${i.instanceId}`);
      const optionMessages: Record<string, ReturnType<typeof decisionMessage>> = { ...commonOptionMessages("no") };
      for (const option of options) {
        if (option === "no") continue;
        const [kind, firstText, secondText] = option.split(":");
        const first = hand.find((card) => card.instanceId === Number(firstText));
        const second = hand.find((card) => card.instanceId === Number(secondText));
        if (!first) continue;
        optionMessages[option] = kind === "both" && second
          ? first.instanceId === second.instanceId
            ? decisionMessage("card.ajv.fusion.option.both.single", { card: { kind: "card", cardId: first.cardId } })
            : decisionMessage("card.ajv.fusion.option.both", { first: { kind: "card", cardId: first.cardId }, second: { kind: "card", cardId: second.cardId } })
          : decisionMessage(kind === "earth" ? "card.ajv.fusion.option.earth" : "card.ajv.fusion.option.ice", { card: { kind: "card", cardId: first.cardId } });
      }
      if (options.size > 1) ctx.requestChoice("ajv-fusion", decisionPrompt(`${ctx.data.name}: reveal Earth and/or Ice cards to fuse?`, "card.ajv.fusion.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages }), [...options]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ajv-fusion" || option === "no") return;
      const [kind, firstText, secondText] = option.split(":");
      const first = ctx.player(ctx.seat).hand.find((card) => card.instanceId === Number(firstText));
      const second = ctx.player(ctx.seat).hand.find((card) => card.instanceId === Number(secondText));
      const earthCard = kind === "earth" ? first : kind === "both" ? first : undefined;
      const iceCard = kind === "ice" ? first : kind === "both" ? second : undefined;
      if (earthCard && hasType(ctx, earthCard, "earth")) ctx.setCounter("fusedEarth", 1);
      if (iceCard && hasType(ctx, iceCard, "ice")) ctx.setCounter("fusedIce", 1);
      const revealed = [...new Map([earthCard, iceCard].filter((card): card is DeepReadonly<CardInstance> => !!card).map((card) => [card.instanceId, card])).values()];
      if (revealed.length) {
        ctx.setFlag("player", "fusedThisTurn", true);
        if (earthCard) ctx.setFlag("player", "earthFusedThisTurn", true);
        if (iceCard) ctx.setFlag("player", "iceFusedThisTurn", true);
        ctx.logPublic(`${ctx.data.name} is fused (reveals ${revealed.map((card) => data(ctx, card).name).join(" and ")})`);
      }
    },
  };
}

function defendedWith(ctx: ScriptCtx, type: string): boolean {
  return ctx.link?.defendingCards.some((card) => card.instanceId !== ctx.self.instanceId && hasType(ctx, card, type)) === true;
}

export const ajv: Record<string, CardScript> = {
  "jarl vetreiði|0": {
    triggers: [{
      event: "card-played",
      label: "Create a Frostbite in an exposed equipment zone",
      condition: (ctx, played) => !!played && hasType(ctx, played, "ice"),
      effect: (ctx) => offerExposedFrostbite(ctx, "jarl-frostbite", opponentSeat(ctx)),
    }],
    onChoose(ctx, hook, option) {
      if (hook === "jarl-frostbite") createExposedFrostbite(ctx, opponentSeat(ctx), option);
    },
  },
  "summit, the unforgiving|0": {
    activated: attackAbility(6),
    modifyAttack: (ctx) => ctx.player(ctx.seat).weapons.length === 1 ? 2 : 0,
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      offerExposedFrostbite(ctx, "summit-frostbite", opponentSeat(ctx));
    },
    onChoose(ctx, hook, option) {
      if (hook === "summit-frostbite") createExposedFrostbite(ctx, opponentSeat(ctx), option);
    },
  },
  "ollin ice cap|0": {
    canTriggerOnDefend: (ctx) => defendedWith(ctx, "ice"),
    onDefend(ctx) { ctx.createToken(FROSTBITE, ctx.link?.attacker); },
  },
  "tectonic crust|0": {
    canTriggerOnDefend: (ctx) => defendedWith(ctx, "earth"),
    onDefend(ctx) { ctx.createToken(SEISMIC); },
  },
  "gauntlets of the boreal domain|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      onCostPaid(ctx, paid) {
        if (paid.some((card) => hasType(ctx, card, "earth"))) ctx.setCounter("earthPaid", 1);
        if (paid.some((card) => hasType(ctx, card, "ice"))) ctx.setCounter("icePaid", 1);
      },
      onActivate(ctx) {
        if (ctx.getCounter("earthPaid")) ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToName: "mangle" });
        if (ctx.getCounter("icePaid")) ctx.addModifier({ scope: "until-end-of-turn", dominate: true, appliesToName: "mangle" });
      },
    },
  },
  "root-bound trunks|0": {
    canTriggerOnDefend: (ctx) => defendedWith(ctx, "aura"),
    onDefend(ctx) { ctx.createToken(EARTH); },
  },
  "mangle|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4;
    },
    onHit(ctx) {
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment)
        .filter((card): card is DeepReadonly<CardInstance> => !!card && (card.defCounters ?? 0) > 0);
      if (equipment.length) ctx.requestCardChoice("mangle-equipment", decisionPrompt("Destroy equipment with a -1 defense counter", "card.ajv.equipment.destroy"), equipment.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "mangle-equipment") ctx.destroyPermanent(Number(option)); },
  },
  "channel mount isen|3": {
    triggers: [
      {
        event: "start-of-turn",
        whose: "any",
        label: "Lose life for Frostbites in equipment zones",
        effect(ctx) {
          const target = ctx.state.activePlayer;
          const count = ctx.player(target).board.filter((card) => SLOTS.some((slot) => card.counters?.[`frostZone:${slot}`])).length;
          if (count) ctx.loseLife(target, count);
        },
      },
      {
        event: "end-of-turn",
        whose: "subject",
        label: "Channel Ice",
        effect(ctx) {
          const flow = ctx.getCounter("flow") + 1;
          ctx.setCounter("flow", flow);
          const ice = ctx.player(ctx.seat).pitch.filter((card) => hasType(ctx, card, "ice"));
          if (ice.length < flow) ctx.destroySelf();
          else {
            ctx.setCounter("channelRemaining", flow);
            ctx.requestCardChoice("channel-ice", decisionPrompt("Choose an Ice card from pitch for Channel Ice, or destroy this", "card.ajv.channel.ice.choose", { optionMessages: commonOptionMessages("destroy") }), ["destroy", ...ice.map((card) => card.instanceId)]);
          }
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "channel-ice") return;
      if (option === "destroy") { ctx.destroySelf(); return; }
      if (!ctx.putOnDeckBottom(Number(option))) { ctx.destroySelf(); return; }
      const remaining = ctx.getCounter("channelRemaining") - 1;
      ctx.setCounter("channelRemaining", remaining);
      if (remaining <= 0) return;
      const ice = ctx.player(ctx.seat).pitch.filter((card) => hasType(ctx, card, "ice"));
      if (ice.length < remaining) ctx.destroySelf();
      else ctx.requestCardChoice("channel-ice", decisionPrompt("Choose another Ice card for Channel Ice, or destroy this", "card.ajv.channel.ice.next", { optionMessages: commonOptionMessages("destroy") }), ["destroy", ...ice.map((card) => card.instanceId)]);
    },
  },
  "crumble to eternity|3": {
    onEnterArena(ctx) {
      const equipment = allEquipment(ctx);
      if (equipment.length) ctx.requestCardChoice("crumble-counter", decisionPrompt("Put a -1 defense counter on an equipment?", "card.ajv.equipment.counter", { optionMessages: commonOptionMessages("none") }), ["none", ...equipment.map((card) => card.instanceId)]);
    },
    triggers: [{
      event: "begin-action-phase",
      whose: "subject",
      label: "Destroy this; next attack gains dominate",
      effect(ctx) { ctx.destroySelf(); buffNextAttack(ctx, { dominate: true }); },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "crumble-counter" && option !== "none") ctx.addCardDefenseCounters(Number(option), 1);
    },
  },
  "frozen to death|3": {
    ...elementalFusion(),
    onPlay(ctx) {
      if (fused(ctx)) {
        const equipment = allEquipment(ctx).filter((card) => (card.defCounters ?? 0) > 0);
        if (equipment.length) {
          ctx.requestCardChoice("frozen-destroy", decisionPrompt("Destroy an equipment with a -1 defense counter?", "card.ajv.equipment.destroy.optional", { optionMessages: commonOptionMessages("none") }), ["none", ...equipment.map((card) => card.instanceId)]);
          return;
        }
      }
      offerExposedFrostbite(ctx, "frozen-frostbite", opponentSeat(ctx), true);
    },
    onChoose(ctx, hook, option) {
      if (hook === "ajv-fusion") { elementalFusion().onChoose!(ctx, hook, option); return; }
      if (hook === "frozen-destroy") {
        if (option !== "none") ctx.destroyPermanent(Number(option));
        offerExposedFrostbite(ctx, "frozen-frostbite", opponentSeat(ctx), true);
      } else if (hook === "frozen-frostbite" && option !== "none") createExposedFrostbite(ctx, opponentSeat(ctx), option);
    },
  },
  "exposed to the elements|3": {
    ...elementalFusion(),
    onPlay(ctx) {
      if (fused(ctx, "earth")) {
        const equipment = allEquipment(ctx);
        if (equipment.length) { ctx.requestCardChoice("exposed-counter", decisionPrompt("Put a -1 defense counter on target equipment", "card.ajv.equipment.counter.choose"), equipment.map((card) => card.instanceId)); return; }
      }
      if (fused(ctx, "ice")) ctx.requestChoice("exposed-hero", decisionPrompt("Choose the hero for the Ice fusion effect", "card.ajv.ice.hero.choose", { optionMessages: Object.fromEntries(ctx.state.players.map((player) => [String(player.seat), decisionMessage("card.common.target.card", { card: { kind: "card", cardId: player.heroCardId } })])) }), ctx.state.players.map((player) => String(player.seat)));
    },
    onChoose(ctx, hook, option) {
      if (hook === "ajv-fusion") { elementalFusion().onChoose!(ctx, hook, option); return; }
      if (hook === "exposed-counter") {
        ctx.addCardDefenseCounters(Number(option), 1);
        if (fused(ctx, "ice")) ctx.requestChoice("exposed-hero", decisionPrompt("Choose the hero for the Ice fusion effect", "card.ajv.ice.hero.choose", { optionMessages: Object.fromEntries(ctx.state.players.map((player) => [String(player.seat), decisionMessage("card.common.target.card", { card: { kind: "card", cardId: player.heroCardId } })])) }), ctx.state.players.map((player) => String(player.seat)));
      } else if (hook === "exposed-hero") {
        const target = Number(option);
        ctx.setCounter("exposedTarget", target);
        if (!ctx.requestPayment("exposed-pay", decisionPrompt("Pay 2 resources or an equipment with 0 defense may be destroyed", "card.ajv.exposed.pay", { optionMessages: commonOptionMessages("no") }), 2, target)) {
          const equipment = Object.values(ctx.player(target).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && Math.max(0, (data(ctx, card).defense ?? 0) - (card.defCounters ?? 0)) === 0);
          if (equipment.length) ctx.requestCardChoice("exposed-destroy", decisionPrompt("Destroy an equipment with 0 defense", "card.ajv.zero.equipment.destroy"), equipment.map((card) => card.instanceId));
        }
      } else if (hook === "exposed-pay" && option === "declined") {
        const target = ctx.getCounter("exposedTarget");
        const equipment = Object.values(ctx.player(target).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && Math.max(0, (data(ctx, card).defense ?? 0) - (card.defCounters ?? 0)) === 0);
        if (equipment.length) ctx.requestCardChoice("exposed-destroy", decisionPrompt("Destroy an equipment with 0 defense", "card.ajv.zero.equipment.destroy"), equipment.map((card) => card.instanceId));
      } else if (hook === "exposed-destroy") ctx.destroyPermanent(Number(option));
    },
  },
  "unforgetting unforgiving|1": {
    canTriggerOnDefend(ctx) {
      const attacker = ctx.link?.attacker;
      return attacker !== undefined && Object.values(ctx.player(attacker).equipment)
        .some((card) => (card?.defCounters ?? 0) > 0);
    },
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined || !Object.values(ctx.player(attacker).equipment).some((card) => (card?.defCounters ?? 0) > 0)) return;
      const mangles = ctx.player(ctx.seat).deck.filter((card) => data(ctx, card).name.toLowerCase() === "mangle");
      if (mangles.length) ctx.requestCardChoice("unforgetting-mangle", decisionPrompt("Search for a Mangle, or decline", "card.ajv.mangle.search", { optionMessages: commonOptionMessages("none") }), ["none", ...mangles.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "unforgetting-mangle" || option === "none") return;
      const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
      if (!card || !ctx.banish(card.instanceId)) return;
      ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, card).name}`);
      ctx.shuffleDeck();
      ctx.allowPlayFrom(card.instanceId, "banish", { untilNextTurn: true });
    },
  },
};
