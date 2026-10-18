import type { CardInstance, CardScript, DeepReadonly, ScriptCtx, TriggerDef } from "@fyendal/engine";
import {
  armDelayedEffect,
  attackAbility,
  buffNextAttack,
  cardNameContains,
  commonOptionMessages,
  consumeDelayedEffect,
  contractWithSilver,
  decisionMessage,
  decisionPrompt,
  entersArenaTrigger,
  leavesArenaTrigger,
  ongoingLabel,
  opponentSeat,
  requestDiscardChoice,
  resolveDiscardChoice,
  sharesName,
  yesNoPrompt,
} from "../shared-helpers.js";

const QUICKEN = "EVO250";
const RUNECHANT = "DTD214";
const SEISMIC = "DTD204";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string) {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}
function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string) {
  return ctx.cardNames(card).some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}
function isItem(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return has(ctx, card, "item");
}

const TICK_TOCK_ITEM = "tick-tock-item";

/** Tick Tock Clock: offer up to 2 other items in the arena, then deal damage
 * equal to the items destroyed, counting the clock itself. */
function tickTockNextItem(ctx: ScriptCtx): void {
  const items = ctx.state.players.flatMap((player) =>
    player.board.filter((card) => card.instanceId !== ctx.self.instanceId && isItem(ctx, card)),
  );
  if (ctx.getState("tickTockChosen") < 2 && items.length) {
    ctx.requestCardChoice(
      TICK_TOCK_ITEM,
      decisionPrompt("Destroy another item?", "card.evo.ticktock.item.destroy", {
        optionMessages: commonOptionMessages("done"),
      }),
      ["done", ...items.map((card) => card.instanceId)],
    );
    return;
  }
  const destroyed = ctx.getState("tickTockDestroyed");
  if (destroyed > 0) ctx.dealDamage(opponentSeat(ctx), destroyed);
}

function isMechAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack") && has(ctx, card, "mechanologist");
}
function equippedEvos(ctx: ScriptCtx) {
  return ctx.countEquipped("evo");
}
function emboldenedBladeReveal(ctx: ScriptCtx, instanceId: number): void {
  if (!ctx.turnArsenalFaceUp(instanceId)) return;
  const card = ctx.state.players
    .flatMap((player) => player.arsenal)
    .find((candidate) => candidate.instanceId === instanceId);
  if (card && data(ctx, card).cardType === "defense-reaction" && ctx.moveToGraveyard(instanceId, "arsenal"))
    buffNextAttack(ctx, { attack: 1, appliesTo: "weapon" });
}
const FABRICATE_MODES = ["equip", "defense", "under", "hand"] as const;
function recordFabricateMode(ctx: ScriptCtx, mode: string) {
  ctx.setState(`fabricate-mode:${mode}`, 1);
  const used = ctx.getState("fabricate-modes") + 1;
  ctx.setState("fabricate-modes", used);
  if (used < 2) {
    ctx.requestChoice(
      "fabricate-mode",
      decisionPrompt("Choose the second Fabricate mode", "card.evo.fabricate.mode.next", {
        optionMessages: {
          equip: decisionMessage("card.evo.fabricate.option.equip"),
          defense: decisionMessage("card.evo.fabricate.option.defense"),
          under: decisionMessage("card.evo.fabricate.option.under"),
          hand: decisionMessage("card.evo.fabricate.option.hand"),
        },
      }),
      FABRICATE_MODES.filter((candidate) => ctx.getState(`fabricate-mode:${candidate}`) === 0),
    );
  }
}
function applyFabricateHandMode(ctx: ScriptCtx): void {
  if (ctx.getState("fabricate-mode:hand") <= 0) return;
  const evo = ctx.player(ctx.seat).hand.find((card) => has(ctx, card, "evo"));
  if (evo && ctx.banish(evo.instanceId)) ctx.drawCards(ctx.seat, 1);
}
function baseSlot(ctx: ScriptCtx): "head" | "chest" | "arms" | "legs" | undefined {
  return (["head", "chest", "arms", "legs"] as const).find((slot) => ctx.cardTypes(ctx.self).includes(slot));
}
function evoEquipment(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    playableEquipment: true,
    canPlay(ctx) {
      const slot = baseSlot(ctx);
      const base = slot ? ctx.player(ctx.seat).equipment[slot] : undefined;
      return !!base && has(ctx, base, "base") && (extra.canPlay?.(ctx) ?? true);
    },
    playAsInstant(ctx) {
      return ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true || (extra.playAsInstant?.(ctx) ?? false);
    },
  };
}
function allEquipment(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return ctx.state.players.flatMap((player) =>
    Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => !!card),
  );
}
function equipmentController(ctx: ScriptCtx, instanceId: number): number | undefined {
  return ctx.state.players.find((player) =>
    Object.values(player.equipment).some((card) => card?.instanceId === instanceId),
  )?.seat;
}
const STASIS_EQUIPMENT_TARGET: TriggerDef["target"] = {
  options: (ctx) => allEquipment(ctx).map((card) => card.instanceId),
  prompt: () =>
    decisionPrompt("Choose equipment whose abilities can't be activated", "card.evo.equipment.abilities.disable"),
};
function suppressTargetEquipmentAbilities(ctx: ScriptCtx): void {
  const targetId = ctx.playTargetInstanceId;
  const owner = targetId === undefined ? undefined : equipmentController(ctx, targetId);
  if (targetId === undefined || owner === undefined) return;
  ctx.addModifier({
    scope: "until-end-of-turn",
    seat: owner,
    suppressesActivatedAbilitiesOfInstanceId: targetId,
    expiresAtEndOfSeatTurn: owner,
  });
}
function steelSoulTriggerCount(ctx: ScriptCtx, other: DeepReadonly<CardInstance>): number {
  if (!ctx.cardTypes(other).some((type) => type.toLowerCase() === "evo")) return 0;
  if (sharesName(ctx, other, ctx.self)) return 0;
  return ctx.cardData(other.cardId).cardType === "hero" ? 2 : 1;
}
function steelControllerTargets(ctx: ScriptCtx) {
  return ctx
    .player(ctx.seat)
    .graveyard.filter(
      (card) => ctx.hasCardType(card, "action") && has(ctx, card, "attack") && ctx.basePower(card) >= 6,
    );
}
function requestSteelControllerChoice(ctx: ScriptCtx) {
  const cards = steelControllerTargets(ctx);
  if (cards.length === 0) return;
  ctx.requestCardChoice(
    "steel-controller",
    decisionPrompt("Put an attack fifth from top?", "card.evo.attack.fifthfromtop", {
      optionMessages: commonOptionMessages("no"),
    }),
    ["no", ...cards.map((card) => card.instanceId)],
  );
}
function chooseItem(ctx: ScriptCtx, hook: string, optional = false) {
  const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card));
  if (items.length)
    ctx.requestCardChoice(
      hook,
      decisionPrompt("Destroy an item for +2 defense?", "card.evo.galvanize.item", {
        values: { amount: 2 },
        ...(optional ? { optionMessages: commonOptionMessages("no") } : {}),
      }),
      [...(optional ? ["no"] : []), ...items.map((card) => card.instanceId)],
    );
}
function galvanize(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    onDefend(ctx) {
      chooseItem(ctx, "evo-galvanize", true);
      extra.onDefend?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "evo-galvanize" && option !== "no" && ctx.destroyPermanent(Number(option)))
        ctx.addModifier({ scope: "chain-link", defense: 2 });
      else extra.onChoose?.(ctx, hook, option);
    },
  };
}
function scrap(extra: CardScript = {}, count = 1): CardScript {
  return {
    ...extra,
    declareAdditionalCost(ctx) {
      const cards = ctx
        .player(ctx.seat)
        .graveyard.filter((card) => isItem(ctx, card) || data(ctx, card).cardType === "equipment");
      if (cards.length)
        ctx.requestCardChoice(
          "evo-scrap",
          decisionPrompt("Scrap an item or equipment from your graveyard?", "card.evo.scrap.choose", {
            optionMessages: commonOptionMessages("none"),
          }),
          ["none", ...cards.map((card) => card.instanceId)],
        );
      extra.declareAdditionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "evo-scrap") {
        extra.onChoose?.(ctx, hook, option);
        return;
      }
      if (option === "none") return;
      const card = ctx
        .player(ctx.seat)
        .graveyard.find(
          (candidate) =>
            candidate.instanceId === Number(option) &&
            (isItem(ctx, candidate) || data(ctx, candidate).cardType === "equipment"),
        );
      if (!card || !ctx.banish(card.instanceId)) return;
      const scrapped = ctx.getState("scrapped") + 1;
      ctx.setState("scrapped", scrapped);
      if (scrapped >= count) return;
      const cards = ctx
        .player(ctx.seat)
        .graveyard.filter((candidate) => isItem(ctx, candidate) || data(ctx, candidate).cardType === "equipment");
      if (cards.length)
        ctx.requestCardChoice(
          "evo-scrap",
          decisionPrompt("Scrap another item or equipment from your graveyard?", "card.evo.scrap.choose.next", {
            optionMessages: commonOptionMessages("none"),
          }),
          ["none", ...cards.map((candidate) => candidate.instanceId)],
        );
    },
  };
}
function breakerEvo(extra: CardScript = {}): CardScript {
  return evoEquipment({
    ...extra,
    additionalCost(ctx) {
      const drivers = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "hyper driver"));
      if (drivers.length)
        ctx.requestCardChoice(
          "breaker-driver",
          decisionPrompt("Choose Hyper Drivers to transform", "card.evo.hyperdrivers.transform", {
            optionMessages: commonOptionMessages("done"),
          }),
          ["done", ...drivers.map((card) => card.instanceId)],
        );
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "breaker-driver" && option !== "done") {
        const n = ctx.getState("breaker-count") + 1;
        ctx.setState("breaker-count", n);
        ctx.setState(`breaker-driver-${n}`, Number(option));
        const chosen = new Set(Array.from({ length: n }, (_, i) => ctx.getState(`breaker-driver-${i + 1}`)));
        const drivers = ctx
          .player(ctx.seat)
          .board.filter((card) => named(ctx, card, "hyper driver") && !chosen.has(card.instanceId));
        if (drivers.length)
          ctx.requestCardChoice(
            "breaker-driver",
            decisionPrompt("Choose another Hyper Driver?", "card.evo.hyperdriver.transform.next", {
              optionMessages: commonOptionMessages("done"),
            }),
            ["done", ...drivers.map((card) => card.instanceId)],
          );
      } else extra.onChoose?.(ctx, hook, option);
    },
    onEnterArena(ctx) {
      const ids = Array.from({ length: ctx.getState("breaker-count") }, (_, i) =>
        ctx.getState(`breaker-driver-${i + 1}`),
      ).filter(Boolean);
      if (ids.length) {
        ctx.transformInto(ctx.self.cardId, ids, ctx.self.instanceId);
        ctx.preventNextDamage(ctx.seat, ids.length * 2);
      }
      extra.onEnterArena?.(ctx);
    },
  });
}
function optionalBreakerBoost(effect: (ctx: ScriptCtx, boostedInstanceId: number) => void): CardScript {
  const requestChoice = (ctx: ScriptCtx) =>
    ctx.requestChoice(
      "breaker-boost",
      yesNoPrompt(`Destroy a card under ${ctx.data.name}?`, "card.evo.breaker.card.destroy.optional", {
        card: { kind: "card", cardId: ctx.self.cardId },
      }),
      ["yes", "no"],
    );
  return {
    onBoosted(ctx, boosted) {
      if (!ctx.self.subcards?.length) return;
      const pending = ctx.getState("breaker-boost-pending");
      ctx.setState(`breaker-boosted-instance:${pending + 1}`, boosted.instanceId);
      ctx.setState("breaker-boost-pending", pending + 1);
      if (pending === 0) requestChoice(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "breaker-boost") return;
      const boostedInstanceId = ctx.getState("breaker-boosted-instance:1");
      if (option === "yes" && boostedInstanceId > 0 && ctx.destroySubcard(ctx.self.instanceId)) {
        effect(ctx, boostedInstanceId);
      }
      const pending = Math.max(0, ctx.getState("breaker-boost-pending") - 1);
      for (let i = 1; i <= pending; i += 1) {
        ctx.setState(`breaker-boosted-instance:${i}`, ctx.getState(`breaker-boosted-instance:${i + 1}`));
      }
      ctx.setState("breaker-boost-pending", pending);
      if (pending > 0 && ctx.self.subcards?.length) requestChoice(ctx);
      else if (pending > 0) ctx.setState("breaker-boost-pending", 0);
    },
  };
}
function evoThreshold(onHit?: (ctx: ScriptCtx) => void): CardScript {
  return {
    modifyPlayCost(ctx, base) {
      return equippedEvos(ctx) >= 2 ? Math.max(0, base - 3) : base;
    },
    onAttackDeclared(ctx) {
      if (equippedEvos(ctx) >= 3) ctx.setFlag("link", "overpower", true);
    },
    modifyAttack: (ctx) => (equippedEvos(ctx) >= 4 ? 3 : 0),
    onHit,
  };
}
function crankItem(extra: CardScript = {}, damageOnEmpty = 0): CardScript {
  return {
    ...extra,
    onEnterArena(ctx) {
      ctx.setCounter("steam", 1);
      extra.onEnterArena?.(ctx);
    },
    triggers: [
      ...(extra.triggers ?? []),
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Remove steam or destroy",
        effect(ctx) {
          if (ctx.getCounter("steam") > 0) ctx.addCounter(ctx.self.instanceId, "steam", -1);
          else {
            ctx.destroySelf();
            if (damageOnEmpty) ctx.dealDamage(ctx.seat, damageOnEmpty);
          }
        },
      },
    ],
  };
}
export const evoHighRarity: Record<string, CardScript> = {
  "master cog|2": {
    triggers: [
      {
        event: "card-pitched",
        sourceZone: "pitch",
        label: "Put a steam counter on an item with crank?",
        condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId,
        effect(ctx) {
          const items = ctx
            .player(ctx.seat)
            .board.filter((card) => isItem(ctx, card) && data(ctx, card).text.includes("Crank"));
          if (items.length)
            ctx.requestCardChoice(
              "master-cog",
              decisionPrompt("Put a steam counter on an item with crank?", "card.evo.crankitem.steam.add.optional", {
                optionMessages: commonOptionMessages("no"),
              }),
              ["no", ...items.map((card) => card.instanceId)],
            );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "master-cog" && option !== "no") ctx.addCounter(Number(option), "steam", 1);
    },
  },
  "teklovossen, esteemed magnate|0": {
    allowsFriendlyCardPlayFrom: (ctx, card, zone) => zone === "banish" && has(ctx, card, "evo"),
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      label: "Play next Evo as an instant",
      onActivate(ctx) {
        ctx.setPlayerFlag(ctx.seat, "nextEvoAsInstant", true);
        ctx.setPlayerFlag(ctx.seat, "teklovossenNextEvoDraw", true);
      },
    },
    triggers: [
      {
        event: "card-played",
        label: "Draw a card",
        condition: (ctx, card) =>
          !!card && has(ctx, card, "evo") && ctx.getPlayerFlag(ctx.seat, "teklovossenNextEvoDraw") === true,
        onTrigger(ctx) {
          ctx.setPlayerFlag(ctx.seat, "teklovossenNextEvoDraw", false);
        },
        effect(ctx) {
          ctx.drawCards(ctx.seat, 1);
        },
      },
    ],
  },
  "teklo leveler|0": {
    activated: {
      ...attackAbility(3)[0]!,
      canActivate: (ctx) => equippedEvos(ctx) >= 1,
      modifyCost: (ctx, base) => (equippedEvos(ctx) >= 2 ? Math.max(0, base - 2) : base),
    },
    onAttackDeclared(ctx) {
      if (equippedEvos(ctx) >= 3) ctx.grantGoAgain();
    },
    modifyAttack: (ctx) => (equippedEvos(ctx) >= 4 ? 1 : 0),
  },
  "singularity|1": {
    canPlay: (ctx) => equippedEvos(ctx) >= 4 && ctx.player(ctx.seat).weapons.length > 0,
    onPlay(ctx) {
      const player = ctx.player(ctx.seat);
      const evos = Object.values(player.equipment)
        .filter((card): card is DeepReadonly<CardInstance> => !!card && has(ctx, card, "evo"))
        .slice(0, 4);
      const weapon = player.weapons[0];
      if (weapon && evos.length === 4)
        ctx.transformInto(
          "EVO010B",
          [player.hero.instanceId, weapon.instanceId, ...evos.map((card) => card.instanceId)],
          player.hero.instanceId,
        );
    },
    onChoose() {},
  },
  "teklovossen, the mechropotent|0": {
    additionalCardTypes: ["equipment"],
    countsAsEquipped: { evo: 4 },
    activated: { cost: 3, banishSoulCost: 2, isAttack: true, goAgain: false, label: "Attack" },
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId)
        requestDiscardChoice(
          ctx,
          "mechropotent-discard",
          decisionPrompt("Choose a card to discard", "card.evo.card.discard"),
          opponentSeat(ctx),
        );
    },
    onFriendlyPlay(ctx, card) {
      if (isMechAttack(ctx, card)) ctx.grantCardKeyword(card.instanceId, "go again");
    },
    onChoose(ctx, hook, option) {
      if (hook === "mechropotent-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx));
    },
  },
  "hyper-x3|0": {
    onBoosted(ctx, _boosted, banished) {
      if (!named(ctx, banished, "Hyper Driver") ||
          !ctx.putBanishedUnder(banished.instanceId, ctx.self.instanceId)) return;
      const driverCount = ctx.self.subcards?.filter((card) => named(ctx, card, "Hyper Driver")).length ?? 0;
      if (driverCount >= 3 && !ctx.oncePerTurnEffectUsed()) {
        ctx.markOncePerTurnEffectUsed();
        ctx.drawCards(ctx.seat, 1);
      }
    },
  },
  "adaptive plating|0": galvanize({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      canActivate: (ctx: ScriptCtx) =>
        (["head", "chest", "arms", "legs"] as const).some((slot) => !ctx.player(ctx.seat).equipment[slot]),
      onActivate(ctx: ScriptCtx) {
        const slots = (["head", "chest", "arms", "legs"] as const).filter(
          (slot) => !ctx.player(ctx.seat).equipment[slot],
        );
        ctx.requestChoice(
          "adaptive-plating-zone",
          decisionPrompt("Choose an equipment zone", "card.evo.equipment.zone.choose", {
            optionMessages: Object.fromEntries(
              slots.map((slot) => [slot, decisionMessage(`card.common.option.${slot}`)]),
            ),
          }),
          slots,
        );
      },
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "adaptive-plating-zone") return;
      if (option === "head" || option === "chest" || option === "arms" || option === "legs") {
        ctx.moveEquipmentToZone(ctx.self.instanceId, option);
      }
    },
  }),
  "evo steel soul memory|3": evoEquipment({
    onTransform(ctx, _direction, other) {
      const count = steelSoulTriggerCount(ctx, other);
      if (count > 0)
        ctx.setPlayerFlag(ctx.seat, "bonusIntellect", Number(ctx.getPlayerFlag(ctx.seat, "bonusIntellect")) + count);
    },
  }),
  "evo steel soul processor|3": evoEquipment({
    onTransform(ctx, _direction, other) {
      const count = steelSoulTriggerCount(ctx, other);
      if (count > 0) ctx.changeResources(ctx.seat, count * 3);
    },
  }),
  "evo steel soul controller|3": evoEquipment({
    onTransform(ctx, _direction, other) {
      const count = steelSoulTriggerCount(ctx, other);
      if (count <= 0) return;
      ctx.setState("steel-controller-triggers", count);
      requestSteelControllerChoice(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "steel-controller") return;
      if (option !== "no") ctx.putOnDeckAtDepth(Number(option), 5);
      const remaining = Math.max(0, ctx.getState("steel-controller-triggers") - 1);
      ctx.setState("steel-controller-triggers", remaining);
      if (remaining > 0) requestSteelControllerChoice(ctx);
    },
  }),
  "evo steel soul tower|3": evoEquipment({
    onTransform(ctx, _direction, other) {
      const count = steelSoulTriggerCount(ctx, other);
      if (count > 0) ctx.changeActionPoints(ctx.seat, count);
    },
  }),
  "evo circuit breaker|1": breakerEvo({
    additionalCost() {},
    ...optionalBreakerBoost((ctx) => {
      const attacks = ctx
        .player(ctx.seat)
        .banish.filter((card) => !card.faceDown && isMechAttack(ctx, card))
        .slice(0, 2);
      for (const attack of attacks) ctx.putOnDeckBottom(attack.instanceId);
      if (attacks.length) ctx.shuffleDeck();
    }),
  }),
  "evo atom breaker|1": breakerEvo(optionalBreakerBoost((ctx) => ctx.changeResources(ctx.seat, 2))),
  "evo face breaker|1": breakerEvo(
    optionalBreakerBoost((ctx, boostedInstanceId) => {
      ctx.addCardTempPower(boostedInstanceId, 2);
    }),
  ),
  "evo mach breaker|1": breakerEvo(optionalBreakerBoost((ctx) => ctx.createToken(QUICKEN))),
  "annihilator engine|1": evoThreshold((ctx) => {
    if (equippedEvos(ctx) >= 1 && ctx.link)
      for (const card of [...ctx.link.defendingCards, ...ctx.link.defendingEquipment])
        ctx.moveToGraveyard(card.instanceId, "chain");
  }),
  "terminator tank|1": {
    ...evoThreshold((ctx) => {
      if (equippedEvos(ctx) >= 1)
        requestDiscardChoice(
          ctx,
          "terminator-discard",
          decisionPrompt("Choose a card to discard", "card.evo.card.discard"),
          opponentSeat(ctx),
        );
    }),
    onChoose(ctx, hook, option) {
      if (hook === "terminator-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx));
    },
  },
  "war machine|1": evoThreshold((ctx) => {
    if (equippedEvos(ctx) >= 1)
      for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal");
  }),
  "demolition protocol|1": {
    onAttackDeclared(ctx) {
      ctx.setState("upgrades", equippedEvos(ctx));
      const cards = [
        ...ctx.player(opponentSeat(ctx)).board,
        ...ctx.player(opponentSeat(ctx)).weapons,
        ...Object.values(ctx.player(opponentSeat(ctx)).equipment).filter(
          (card): card is DeepReadonly<CardInstance> => !!card,
        ),
      ].filter((card) => (card.counters?.steam ?? 0) > 0);
      if (cards.length && equippedEvos(ctx) > 0)
        ctx.requestCardChoice(
          "demolition",
          decisionPrompt("Remove steam counters from up to X permanents", "card.evo.permanent.steam.remove.uptox", {
            optionMessages: commonOptionMessages("done"),
          }),
          ["done", ...cards.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "demolition" || option === "done") return;
      ctx.setCardCounter(Number(option), "steam", 0);
      const n = ctx.getState("demolished") + 1;
      ctx.setState("demolished", n);
      const cards = [
        ...ctx.player(opponentSeat(ctx)).board,
        ...ctx.player(opponentSeat(ctx)).weapons,
        ...Object.values(ctx.player(opponentSeat(ctx)).equipment).filter(
          (card): card is DeepReadonly<CardInstance> => !!card,
        ),
      ].filter((card) => (card.counters?.steam ?? 0) > 0);
      if (n < ctx.getState("upgrades") && cards.length)
        ctx.requestCardChoice(
          "demolition",
          decisionPrompt("Remove steam from another permanent?", "card.evo.permanent.steam.remove.next", {
            optionMessages: commonOptionMessages("done"),
          }),
          ["done", ...cards.map((card) => card.instanceId)],
        );
    },
  },
  "pulsewave protocol|2": {
    onAttackDeclared(ctx) {
      const count = equippedEvos(ctx);
      const hand = ctx.player(opponentSeat(ctx)).hand.slice(0, count);
      const revealedIds = hand.map((card) => card.instanceId);
      if (!ctx.revealCards(revealedIds, opponentSeat(ctx))) return;
      const legal = hand.filter((card) => ctx.hasCardType(card, "action") && (data(ctx, card).defense ?? 0) < count);
      ctx.requestCardChoice(
        "pulsewave",
        decisionPrompt(
          legal.length ? "Choose a revealed card to defend" : "No revealed cards can defend",
          legal.length ? "card.evo.revealed.card.defend" : "card.evo.revealed.card.none",
          { optionMessages: { Close: decisionMessage("common.option.close") } },
        ),
        legal.length ? legal.map((card) => card.instanceId) : ["Close"],
        undefined,
        revealedIds,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pulsewave" && option !== "Close") {
        ctx.addDefenderFromHand(Number(option));
      }
    },
  },
  "meganetic protocol|3": {
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "mustDefendWithEquipmentCount", equippedEvos(ctx));
    },
    canBeDefendedBy: () => true,
    onDefendedByEquipment(ctx, defending) {
      ctx.setCardCounter(defending.instanceId, "defense", Number(defending.counters?.defense ?? 0) - 1);
    },
  },
  "steel street enforcement|3": { modifyDefense: (ctx) => equippedEvos(ctx) },
  "grinding gears|3": crankItem({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Destroy top deck card",
      onActivate(ctx) {
        const top = ctx.player(opponentSeat(ctx)).deck[0];
        if (top) ctx.moveToGraveyard(top.instanceId, "deck");
      },
    },
  }),
  "prismatic lens|2": crankItem({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      label: "Reveal top and recover matching item",
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        ctx.revealCards([top.instanceId]);
        const cards = ctx
          .player(ctx.seat)
          .banish.filter((card) => !card.faceDown && isItem(ctx, card) && ctx.cardColor(card) === ctx.cardColor(top));
        if (cards.length)
          ctx.requestCardChoice(
            "lens",
            decisionPrompt("Put a matching item on top", "card.evo.matching.item.top"),
            cards.map((card) => card.instanceId),
          );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "lens") ctx.putOnDeckTop(Number(option));
    },
  }),
  "quantum processor|2": crankItem({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      label: "Put a small item into arena",
      onActivate(ctx) {
        const cards = ctx.player(ctx.seat).hand.filter((card) => isItem(ctx, card) && (data(ctx, card).cost ?? 0) <= 1);
        if (cards.length)
          ctx.requestCardChoice(
            "processor",
            decisionPrompt("Put an item into arena", "card.evo.item.arena"),
            cards.map((card) => card.instanceId),
          );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "processor") ctx.settleCard(Number(option));
    },
  }),
  "stasis cell|3": {
    triggers: [
      entersArenaTrigger(
        "Target equipment's activated abilities can't be activated until the end of its controller's next turn",
        decisionMessage("card.trigger.evo.stasiscell.abilities.suppress"),
        suppressTargetEquipmentAbilities,
        { target: STASIS_EQUIPMENT_TARGET },
      ),
      leavesArenaTrigger(
        "Target equipment's activated abilities can't be activated until the end of its controller's next turn",
        decisionMessage("card.trigger.evo.stasiscell.abilities.suppress"),
        suppressTargetEquipmentAbilities,
        { target: STASIS_EQUIPMENT_TARGET },
      ),
    ],
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      putSelfOnDeckBottomCost: true,
      label: "Disable equipment defense",
      onActivate(ctx) {
        const equipment = allEquipment(ctx);
        if (equipment.length)
          ctx.requestCardChoice(
            "stasis-defense",
            decisionPrompt("Choose equipment that can't defend", "card.evo.equipment.defense.disable"),
            equipment.map((card) => card.instanceId),
          );
      },
    },
    onChoose(ctx, hook, option) {
      const targetId = Number(option);
      const owner = equipmentController(ctx, targetId);
      if (hook === "stasis-defense" && owner !== undefined) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          seat: owner,
          cannotDefendWithInstanceId: targetId,
        });
      }
    },
  },
  "tick tock clock|1": crankItem(
    {
      canTriggerOnHit: (ctx) =>
        !!ctx.link && ctx.link.targetAllyId === undefined && isMechAttack(ctx, ctx.link.attackingCard),
      onHit(ctx) {
        const inArena = () => ctx.player(ctx.seat).board.some((card) => card.instanceId === ctx.self.instanceId);
        const wasInArena = inArena();
        ctx.destroySelf();
        ctx.setState("tickTockDestroyed", wasInArena && !inArena() ? 1 : 0);
        ctx.setState("tickTockChosen", 0);
        tickTockNextItem(ctx);
      },
      onChoose(ctx, hook, option) {
        if (hook !== TICK_TOCK_ITEM) return;
        if (option === "done") {
          ctx.setState("tickTockChosen", 2);
        } else {
          ctx.setState("tickTockChosen", ctx.getState("tickTockChosen") + 1);
          if (ctx.destroyPermanent(Number(option))) {
            ctx.setState("tickTockDestroyed", ctx.getState("tickTockDestroyed") + 1);
          }
        }
        tickTockNextItem(ctx);
      },
    },
    1,
  ),
  "hyper scrapper|3": {
    variablePlayCost: {
      base: 0,
      stateKey: "scrapperX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
      maximum(ctx) {
        return ctx.player(ctx.seat).graveyard.filter((card) => isItem(ctx, card)).length;
      },
    },
    declareAdditionalCost(ctx) {
      if (ctx.getState("scrapperX") <= 0) return;
      const items = ctx.player(ctx.seat).graveyard.filter((card) => isItem(ctx, card));
      if (items.length)
        ctx.requestCardChoice(
          "hyper-scrapper-item",
          decisionPrompt("Banish an item from your graveyard", "card.evo.graveyard.item.banish"),
          items.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "hyper-scrapper-item") return;
      const card = ctx.player(ctx.seat).graveyard.find((candidate) => candidate.instanceId === Number(option));
      if (card && ctx.banish(card.instanceId)) {
        ctx.addCardState(ctx.self.instanceId, "scrapped", 1);
        if (named(ctx, card, "hyper driver")) ctx.addCardState(ctx.self.instanceId, "scrappedDrivers", 1);
      }
      if (ctx.getState("scrapped") >= ctx.getState("scrapperX")) return;
      const items = ctx.player(ctx.seat).graveyard.filter((candidate) => isItem(ctx, candidate));
      if (items.length)
        ctx.requestCardChoice(
          "hyper-scrapper-item",
          decisionPrompt("Banish another item from your graveyard", "card.evo.graveyard.item.banish.next"),
          items.map((card) => card.instanceId),
        );
    },
    modifyAttack: (ctx) => ctx.getState("scrapperX"),
    onAttackDeclared(ctx) {
      if (ctx.getState("scrappedDrivers") >= 3) {
        ctx.changeResources(ctx.seat, 6);
        ctx.grantGoAgain();
      }
    },
  },
  "scrap trader|1": scrap(
    {
      onPlay(ctx) {
        ctx.changeResources(ctx.seat, ctx.getState("scrapped") * 2);
      },
    },
    2,
  ),
  "moonshot|2": {
    variablePlayCost: {
      base: 0,
      resourcesPerX: 2,
      stateKey: "moonshotX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
      maximum(ctx) {
        return ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "hyper driver")).length;
      },
    },
    canPlay: (ctx) => ctx.getPlayerFlag(ctx.seat, "boostedThisTurn") === true,
    additionalCost(ctx) {
      if (ctx.getState("moonshotX") <= 0) return;
      const drivers = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "hyper driver"));
      if (drivers.length)
        ctx.requestCardChoice(
          "moonshot",
          decisionPrompt("Destroy a Hyper Driver", "card.evo.hyperdriver.destroy"),
          drivers.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "moonshot") return;
      if (ctx.destroyPermanent(Number(option))) ctx.addCardState(ctx.self.instanceId, "drivers", 1);
      if (ctx.getState("drivers") >= ctx.getState("moonshotX")) return;
      const drivers = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "hyper driver"));
      if (drivers.length)
        ctx.requestCardChoice(
          "moonshot",
          decisionPrompt("Destroy another Hyper Driver", "card.evo.hyperdriver.destroy.next"),
          drivers.map((card) => card.instanceId),
        );
    },
    modifyAttack: (ctx) => ctx.getState("drivers") * 3,
    onAttackDeclared(ctx) {
      if (ctx.currentAttackPower() >= 10) ctx.setFlag("link", "overpower", true);
    },
  },
  "steel street hoons|3": galvanize({
    modifyAttack: (ctx) => (ctx.getPlayerFlag(ctx.seat, "graveSubtype:item") === true ? 2 : 0),
  }),
  "twin drive|1": { boostCount: 2 },
  "meganetic lockwave|3": {
    variablePlayCost: {
      base: 0,
      resourcesPerX: 3,
      stateKey: "lockwaveX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
      maximum(ctx) {
        return Object.values(ctx.player(opponentSeat(ctx)).equipment).filter((card) => !!card).length;
      },
    },
    playTargetOptions(ctx) {
      return [ctx.player(opponentSeat(ctx)).hero.instanceId];
    },
    onPlay(ctx) {
      if (ctx.getState("lockwaveX") <= 0) return;
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment).filter(
        (card): card is DeepReadonly<CardInstance> => !!card,
      );
      if (equipment.length)
        ctx.requestCardChoice(
          "lockwave-offer",
          decisionPrompt("Choose equipment to offer", "card.evo.equipment.offer"),
          equipment.map((card) => card.instanceId),
          opponentSeat(ctx),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "lockwave-offer") {
        const count = ctx.getState("lockwaveOffered") + 1;
        ctx.setState("lockwaveOffered", count);
        ctx.setState(`lockwaveOffer:${count}`, Number(option));
        if (count < ctx.getState("lockwaveX")) {
          const chosen = new Set(
            Array.from({ length: count }, (_, index) => ctx.getState(`lockwaveOffer:${index + 1}`)),
          );
          const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment).filter(
            (card): card is DeepReadonly<CardInstance> => !!card && !chosen.has(card.instanceId),
          );
          if (equipment.length)
            ctx.requestCardChoice(
              "lockwave-offer",
              decisionPrompt("Choose another equipment to offer", "card.evo.equipment.offer.next"),
              equipment.map((card) => card.instanceId),
              opponentSeat(ctx),
            );
          return;
        }
        const offered = Array.from({ length: count }, (_, index) => ctx.getState(`lockwaveOffer:${index + 1}`));
        ctx.requestCardChoice(
          "lockwave-pick",
          decisionPrompt("Choose equipment that must defend", "card.evo.equipment.mustdefend"),
          offered,
        );
        return;
      }
      if (hook === "lockwave-pick") ctx.setPlayerFlag(opponentSeat(ctx), `mustDefend:${option}`, true);
    },
  },
  "system failure|2": {
    playTargetOptions(ctx) {
      return ctx.state.players
        .flatMap((player) => [
          ...player.board,
          ...player.weapons,
          ...Object.values(player.equipment).filter((c): c is DeepReadonly<CardInstance> => !!c),
        ])
        .filter((card) => (card.counters?.steam ?? 0) > 0)
        .map((card) => card.instanceId);
    },
    onPlay(ctx) {
      const id = ctx.playTargetInstanceId;
      if (id === undefined) return;
      const owner = ctx.state.players.find((player) =>
        [
          ...player.board,
          ...player.weapons,
          ...Object.values(player.equipment).filter((c): c is DeepReadonly<CardInstance> => !!c),
        ].some((card) => card.instanceId === id),
      );
      const card =
        owner &&
        [
          ...owner.board,
          ...owner.weapons,
          ...Object.values(owner.equipment).filter((c): c is DeepReadonly<CardInstance> => !!c),
        ].find((candidate) => candidate.instanceId === id);
      const n = card?.counters?.steam ?? 0;
      if (card) ctx.setCardCounter(card.instanceId, "steam", 0);
      if (owner && n >= 2) ctx.dealDamage(owner.seat, 2);
    },
  },
  "system reset|2": {
    variablePlayCost: {
      base: 0,
      stateKey: "systemResetX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
      maximum(ctx) {
        return ctx
          .player(ctx.seat)
          .board.filter(
            (card) => isItem(ctx, card) && has(ctx, card, "mechanologist") && (data(ctx, card).cost ?? 0) <= 1,
          ).length;
      },
    },
    onPlay(ctx) {
      if (ctx.getState("systemResetX") <= 0) return;
      const items = ctx
        .player(ctx.seat)
        .board.filter(
          (card) => isItem(ctx, card) && has(ctx, card, "mechanologist") && (data(ctx, card).cost ?? 0) <= 1,
        );
      if (items.length)
        ctx.requestCardChoice(
          "system-reset",
          decisionPrompt("Choose an item to reset", "card.evo.item.reset"),
          items.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "system-reset") return;
      if (ctx.banish(Number(option))) {
        const count = ctx.getState("systemResetChosen") + 1;
        ctx.setState("systemResetChosen", count);
        ctx.setState(`systemResetItem:${count}`, Number(option));
      }
      const chosen = ctx.getState("systemResetChosen");
      if (chosen < ctx.getState("systemResetX")) {
        const items = ctx
          .player(ctx.seat)
          .board.filter(
            (card) => isItem(ctx, card) && has(ctx, card, "mechanologist") && (data(ctx, card).cost ?? 0) <= 1,
          );
        if (items.length)
          ctx.requestCardChoice(
            "system-reset",
            decisionPrompt("Choose another item to reset", "card.evo.item.reset.next"),
            items.map((card) => card.instanceId),
          );
        return;
      }
      for (let index = 1; index <= chosen; index++) ctx.settleCard(ctx.getState(`systemResetItem:${index}`));
    },
  },
  "fabricate|1": {
    additionalCost(ctx) {
      ctx.requestChoice(
        "fabricate-mode",
        decisionPrompt("Choose the first Fabricate mode", "card.evo.fabricate.mode.first", {
          optionMessages: {
            equip: decisionMessage("card.evo.fabricate.option.equip"),
            defense: decisionMessage("card.evo.fabricate.option.defense"),
            under: decisionMessage("card.evo.fabricate.option.under"),
            hand: decisionMessage("card.evo.fabricate.option.hand"),
          },
        }),
        [...FABRICATE_MODES],
      );
    },
    onPlay(ctx) {
      if (ctx.getState("fabricate-mode:equip") > 0) {
        const base = ctx
          .player(ctx.seat)
          .inventory?.find((card) => has(ctx, card, "base") && cardNameContains(ctx, card, "Proto"));
        if (base) ctx.equipFromInventory(base.instanceId);
      }
      if (ctx.getState("fabricate-mode:defense") > 0) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          defense: 1,
          appliesToEquipment: true,
          appliesToSubtype: "evo",
        });
      }
      if (ctx.getState("fabricate-mode:under") > 0) {
        const evos = Object.values(ctx.player(ctx.seat).equipment).filter(
          (card): card is DeepReadonly<CardInstance> => !!card && has(ctx, card, "evo"),
        );
        if (evos.length) {
          if (ctx.getState("fabricate-mode:hand") > 0) ctx.setState("fabricate-hand-pending", 1);
          ctx.requestCardChoice(
            "fabricate-under",
            decisionPrompt("Choose an Evo equipment to put Fabricate under", "card.evo.fabricate.under.choose"),
            evos.map((card) => card.instanceId),
          );
          return;
        }
      }
      applyFabricateHandMode(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "fabricate-under") {
        ctx.putSelfUnder(Number(option));
        if (ctx.getState("fabricate-hand-pending") > 0) applyFabricateHandMode(ctx);
        return;
      }
      if (hook !== "fabricate-mode") return;
      recordFabricateMode(ctx, option);
    },
  },
  "shriek razors|0": {
    triggers: [
      {
        event: "start-of-turn",
        sourceZone: "graveyard",
        optional: true,
        label: "Destroy 2 Silvers to equip this?",
        condition(ctx) {
          return ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Silver")).length >= 2;
        },
        effect(ctx) {
          const silvers = ctx
            .player(ctx.seat)
            .board.filter((card) => named(ctx, card, "Silver"))
            .slice(0, 2);
          if (
            silvers.length === 2 &&
            ctx.destroyPermanent(silvers[0]!.instanceId) &&
            ctx.destroyPermanent(silvers[1]!.instanceId)
          ) {
            ctx.equipFromGraveyard(ctx.self.instanceId);
          }
        },
      },
    ],
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      label: "Give a defender -1 power",
      onActivate(ctx) {
        const defender = ctx.link?.defendingCards.find(
          (card) => ctx.hasCardType(card, "action") && has(ctx, card, "attack"),
        );
        if (defender) ctx.addCardTempDefense(defender.instanceId, -1);
      },
    },
  },
  "already dead|1": {
    ...contractWithSilver((ctx, card) => !ctx.hasCardType(card, "action")),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);

      const defenders = ctx.state.chain.flatMap((link) => [...link.defendingCards, ...link.defendingEquipment]);
      if (defenders.length === 1) ctx.banish(defenders[0]!.instanceId);
      else if (defenders.length > 1) {
        ctx.requestCardChoice(
          "already-dead-defender",
          decisionPrompt(`${ctx.data.name}: choose a defending card to banish`, "card.evo.defender.banish", {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
          }),
          defenders.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "already-dead-defender") ctx.banish(Number(option));
    },
  },
  "smashing performance|2": {
    onAttackDeclared(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const card = ctx.discardRandom(ctx.seat, 1)[0];
      if (card && ctx.basePower(card) >= 6) {
        const items = ctx.state.players.flatMap((player) => player.board).filter((item) => isItem(ctx, item));
        if (items.length) ctx.destroyPermanent(items[ctx.randomInt(items.length)]!.instanceId);
      }
    },
  },
  "tectonic rift|3": {
    variablePlayCost: {
      base: 0,
      stateKey: "tectonicX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
    },
    onPlay(ctx) {
      ctx.createTokens(SEISMIC, ctx.getState("tectonicX"));
    },
  },
  "wax off|3": {
    onPlay(ctx) {
      if (ctx.getPlayerFlag(ctx.seat, "playedName:wax on") === true) ctx.createToken("OUT239");
    },
  },
  "emboldened blade|3": {
    // The card does not target: the face-down card is chosen on resolution.
    // Options name an arsenal position, never the hidden card's instance id.
    onPlay(ctx) {
      const slots = ctx.state.players.flatMap((player) =>
        player.arsenal.flatMap((card, index) =>
          card.faceDown ? [{ seat: player.seat, index, card }] : []),
      );
      if (slots.length === 0) return;
      if (slots.length === 1) {
        emboldenedBladeReveal(ctx, slots[0]!.card.instanceId);
        return;
      }
      const options = slots.map(({ seat, index }) => `${seat}:${index}`);
      ctx.requestChoice(
        "emboldened-arsenal",
        decisionPrompt("Turn a face-down arsenal card face up", "card.evo.emboldened.arsenal.choose", {
          optionMessages: Object.fromEntries(slots.map(({ seat }, index) => [
            options[index]!,
            seat === ctx.seat
              ? decisionMessage("card.evo.emboldened.option.arsenal.own")
              : decisionMessage("card.evo.emboldened.option.arsenal", { player: { kind: "player", seat } }),
          ])),
        }),
        options,
        ctx.seat,
        // Projection shows another player's face-down card only as a card back.
        slots.map(({ card }) => card.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "emboldened-arsenal") return;
      const [seat, index] = option.split(":").map(Number) as [number, number];
      const card = ctx.player(seat).arsenal[index];
      if (card?.faceDown) emboldenedBladeReveal(ctx, card.instanceId);
    },
  },
  "intoxicating shot|3": {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ctx.createToken("DTD232", opponentSeat(ctx));
      ctx.createToken(QUICKEN, opponentSeat(ctx));
    },
  },
  "sonata fantasmia|3": {
    variablePlayCost: {
      base: 0,
      resourcesPerX: 2,
      stateKey: "sonataX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
    },
    onPlay(ctx) {
      const x = ctx.getState("sonataX");
      ctx.createTokens(RUNECHANT, x);
      if (x >= 6) ctx.discardRandom(opponentSeat(ctx), 3);
    },
  },
  "contest the mindfield|3": {
    onEnterArena(ctx) {
      for (const player of ctx.state.players)
        ctx.setPlayerFlag(player.seat, "bonusIntellect", Number(ctx.getPlayerFlag(player.seat, "bonusIntellect")) - 1);
    },
    onDestroyed(ctx) {
      for (const player of ctx.state.players)
        ctx.setPlayerFlag(player.seat, "bonusIntellect", Number(ctx.getPlayerFlag(player.seat, "bonusIntellect")) + 1);
    },
    modifyBaseDefense: (_ctx, _card, base) => base,
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Destroy Contest the Mindfield",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },
  "phantom tidemaw|3": {
    onFriendlyDestroyed(ctx, card) {
      if (has(ctx, card, "illusionist")) ctx.addCounter(ctx.self.instanceId, "power", 1);
    },
    modifyAttack: (ctx) => ctx.getCounter("power"),
  },
  "tome of imperial flame|1": {
    onPlay(ctx) {
      ctx.drawCards(ctx.seat, has(ctx, ctx.player(ctx.seat).hero, "royal") ? 2 : 1);
      const reds = ctx.player(ctx.seat).hand.filter((card) => ctx.cardColor(card) === 1);
      if (reds.length >= 2)
        ctx.requestCardChoice(
          "tome-red-1",
          decisionPrompt("Pitch the first of 2 red cards?", "card.evo.red.pitch.first", {
            values: { count: 2 },
            optionMessages: commonOptionMessages("decline"),
          }),
          ["decline", ...reds.map((card) => card.instanceId)],
        );
      else for (const card of [...ctx.player(ctx.seat).hand]) ctx.banish(card.instanceId);
    },
    onChoose(ctx, hook, option) {
      if (hook === "tome-red-1") {
        if (option === "decline") {
          for (const card of [...ctx.player(ctx.seat).hand]) ctx.banish(card.instanceId);
          return;
        }
        ctx.pitchCard(Number(option));
        const reds = ctx.player(ctx.seat).hand.filter((card) => ctx.cardColor(card) === 1);
        if (reds.length)
          ctx.requestCardChoice(
            "tome-red-2",
            decisionPrompt("Pitch the second red card?", "card.evo.red.pitch.second", {
              optionMessages: commonOptionMessages("decline"),
            }),
            ["decline", ...reds.map((card) => card.instanceId)],
          );
      } else if (hook === "tome-red-2") {
        if (option === "decline") for (const card of [...ctx.player(ctx.seat).hand]) ctx.banish(card.instanceId);
        else ctx.pitchCard(Number(option));
      }
    },
  },
  "dust from the chrome caverns|1": { materialKeywords: ["phantasm"] },
  "warband of bellona|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      label: "Charge on next attack",
      onActivate(ctx) {
        armDelayedEffect(
          ctx,
          ongoingLabel(
            "the next time you attack, you may charge your hero's soul, and draw a card if a yellow card is charged",
            "card.effect.evo.warbandofbellona",
          ),
        );
      },
    },
    onFriendlyAttackDeclared(ctx) {
      if (!consumeDelayedEffect(ctx)) return;
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) {
        ctx.requestCardChoice(
          "warband-charge",
          decisionPrompt("Charge your hero's soul?", "card.evo.soul.charge", {
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...hand.map((candidate) => candidate.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "warband-charge" && option !== "no") {
        const charged = ctx.charge(Number(option));
        if (charged && ctx.cardColor(charged) === 2) ctx.drawCards(ctx.seat, 1);
      }
    },
  },
  "slay|1": {
    playTargetOptions(ctx) {
      return ctx.state.players
        .flatMap((player) => player.board)
        .filter((card) => has(ctx, card, "angel"))
        .map((card) => card.instanceId);
    },
    onPlay(ctx) {
      if (ctx.playTargetInstanceId !== undefined) ctx.destroyPermanent(ctx.playTargetInstanceId);
    },
  },
};
