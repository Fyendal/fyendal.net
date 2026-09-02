import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  buffNextAttack,
  commonOptionMessages,
  decisionMessage,
  decisionPrompt,
  localizedCardLog,
  mergeSetScripts,
  opponentSeat,
  optN,
  optOnChoose,
} from "./shared-helpers.js";
import { evoHighRarity } from "./evo/high-rarity.js";

const HYPER_DRIVER = "EVO099";
const QUICKEN = "DVR028";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasTag(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, tag: string): boolean {
  return ctx.cardTypes(card).includes(tag.toLowerCase());
}

function isMechAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasTag(ctx, card, "mechanologist") && hasTag(ctx, card, "attack");
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack");
}

function isItem(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasTag(ctx, card, "item");
}

function isEvo(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasTag(ctx, card, "evo");
}

function controlsNamed(ctx: ScriptCtx, name: string): boolean {
  return ctx.player(ctx.seat).board.some((card) => data(ctx, card).name === name);
}

function hyperDrivers(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).board.filter((card) => data(ctx, card).name === "Hyper Driver");
}

function equippedEvos(ctx: ScriptCtx): number {
  return ctx.countEquipped("evo");
}

function boostedCount(ctx: ScriptCtx): number {
  return Number(ctx.getPlayerFlag(ctx.seat, "boostCountThisTurn")) || 0;
}

function initializeCogwerx(ctx: ScriptCtx): void {
  for (const equipment of Object.values(ctx.player(ctx.seat).equipment)) {
    if (equipment && data(ctx, equipment).name.startsWith("Cogwerx Base ")) {
      ctx.setCardCounter(equipment.instanceId, "steam", 1);
    }
  }
}

function itemOrEquipment(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return [
    ...ctx.player(ctx.seat).board.filter((card) => {
      return hasTag(ctx, card, "item") || data(ctx, card).cardType === "token";
    }),
    ...Object.values(ctx.player(ctx.seat).equipment)
      .filter((card): card is DeepReadonly<CardInstance> => card !== undefined),
  ];
}

function addSteamToChoice(ctx: ScriptCtx, hook: string): void {
  const choices = ctx.player(ctx.seat).board.filter((card) =>
    isItem(ctx, card) && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "crank"),
  );
  if (choices.length) ctx.requestCardChoice(
    hook,
    decisionPrompt("Put a steam counter on an item with crank", "card.evo.crankitem.steam.add"),
    choices.map((card) => card.instanceId),
  );
}

function addSteam(ctx: ScriptCtx, option: string): void {
  const id = Number(option);
  const target = ctx.player(ctx.seat).board.find((card) => card.instanceId === id);
  if (target) ctx.addCounter(id, "steam", 1);
}

function addHyperSteam(ctx: ScriptCtx): void {
  const driver = hyperDrivers(ctx)[0];
  if (driver) ctx.addCounter(driver.instanceId, "steam", 1);
}

function pitches(name: string, factory: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return {
    [`${name}|1`]: factory(1),
    [`${name}|2`]: factory(2),
    [`${name}|3`]: factory(3),
  };
}

function baseSlot(ctx: ScriptCtx): "head" | "chest" | "arms" | "legs" | undefined {
  return (["head", "chest", "arms", "legs"] as const).find((slot) =>
    ctx.cardTypes(ctx.self).includes(slot),
  );
}

function evoEquipment(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    playableEquipment: true,
    canPlay(ctx) {
      const slot = baseSlot(ctx);
      const base = slot ? ctx.player(ctx.seat).equipment[slot] : undefined;
      return !!base && hasTag(ctx, base, "base") && (extra.canPlay?.(ctx) ?? true);
    },
    playAsInstant(ctx) {
      return ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true ||
        (extra.playAsInstant?.(ctx) ?? false);
    },
  };
}

function destroyUnderAbility(effect: (ctx: ScriptCtx) => void): CardScript {
  return evoEquipment({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "instant",
      destroySubcardCost: true,
      onActivate: effect,
    },
  });
}

function cogwerxAbility(effect: (ctx: ScriptCtx) => void, label: string): CardScript {
  return {
    onEnterArena(ctx) { ctx.setCounter("steam", 1); },
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "instant",
      label,
      removeCounterCost: { key: "steam", amount: 1 },
      canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, "boostedThisTurn") === true,
      onActivate: effect,
    },
  };
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
        labelMessage: decisionMessage("card.trigger.steam.maintain"),
        effect(ctx) {
          if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
          else ctx.requestChoice("evo-maintenance", decisionPrompt(
            "Remove a steam counter or destroy this?",
            "card.evo.maintenance.choose",
            { optionMessages: {
              remove: decisionMessage("common.option.remove"),
              destroy: decisionMessage("common.option.destroy"),
            } },
          ), ["remove", "destroy"]);
        },
      },
      ...(extra.triggers ?? []),
    ],
    onChoose(ctx, hook, option) {
      if (hook === "evo-maintenance") {
        if (option === "remove") ctx.setCounter("steam", Math.max(0, ctx.getCounter("steam") - 1));
        else ctx.destroySelf();
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

function backupProtocol(pitch: number): CardScript {
  return maintenanceItem(1, {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        const cards = ctx.player(ctx.seat).graveyard.filter((card) =>
          isMechAttack(ctx, card) && ctx.cardColor(card) === pitch,
        );
        if (cards.length) ctx.requestCardChoice("backup", decisionPrompt("Return a Mechanologist attack action card", "card.evo.mechanologist.attack.return"), cards.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "backup") ctx.moveToHand(Number(option));
    },
  });
}

function boomGrenade(damage: number): CardScript {
  return maintenanceItem(1, {
    canTriggerOnHit(ctx) {
      return !!ctx.link && ctx.link.targetAllyId === undefined && isMechAttack(ctx, ctx.link.attackingCard);
    },
    onHit(ctx) {
      ctx.destroySelf();
      ctx.dealDamage(opponentSeat(ctx), damage);
    },
  });
}

function dissolvingShield(steam: number): CardScript {
  return maintenanceItem(steam, {
    destroyAtZeroCounter: "steam",
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      removeCounterCost: { key: "steam", amount: 1 },
      onActivate(ctx) {
        ctx.preventNextDamage(ctx.seat, 1);
        if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
      },
    },
  });
}

function hadronCollider(steam: number): CardScript {
  return maintenanceItem(steam, {
    onBoosted(ctx, boosted) {
      const bonus = ctx.getCounter("steam");
      if (bonus <= 0) return;
      ctx.destroySelf();
      ctx.addCardTempPower(boosted.instanceId, bonus);
    },
  });
}

function miniForcefield(steam: number): CardScript {
  return maintenanceItem(steam, {
    wardValue: (ctx) => ctx.getCounter("steam"),
  });
}

function scrapAttack(effect?: (ctx: ScriptCtx) => void): CardScript {
  return {
    additionalCost(ctx) {
      const choices = itemOrEquipment(ctx);
      if (choices.length) ctx.requestCardChoice("scrap", decisionPrompt("Scrap an item, equipment, or token?", "card.evo.scrap.choose", { optionMessages: commonOptionMessages("none") }), ["none", ...choices.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "scrap" || option === "none") return;
      if (ctx.destroyPermanent(Number(option))) ctx.setCounter("scrapped", 1);
    },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("scrapped") > 0) effect?.(ctx);
    },
  };
}

function galvanize(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    onDefend(ctx) {
      const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card));
      if (items.length) ctx.requestCardChoice("galvanize", decisionPrompt("Destroy an item for +2 defense?", "card.evo.galvanize.item", { values: { amount: 2 }, optionMessages: commonOptionMessages("none") }), ["none", ...items.map((card) => card.instanceId)]);
      extra.onDefend?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "galvanize" && option !== "none" && ctx.destroyPermanent(Number(option))) {
        ctx.addModifier({ scope: "chain-link", defense: 2 });
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

function boostedItemOrEquipment(ctx: ScriptCtx): boolean {
  if (ctx.link?.flags.boosted !== true) return false;
  const id = Number(ctx.getPlayerFlag(ctx.seat, "lastBoostedCardInstanceId"));
  const card = ctx.player(ctx.seat).banish.find((candidate) => candidate.instanceId === id);
  return !!card && (isItem(ctx, card) || data(ctx, card).cardType === "equipment");
}

function itemFromHandOnHit(): CardScript {
  return {
    onHit(ctx) {
      const items = ctx.player(ctx.seat).hand.filter((card) => isItem(ctx, card) && (data(ctx, card).cost ?? 0) <= 1);
      if (items.length) ctx.requestCardChoice("hit-item", decisionPrompt("Put an item with cost 0 or 1 into the arena?", "card.evo.item.small.arena.optional", { optionMessages: commonOptionMessages("none") }), ["none", ...items.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "hit-item" && option !== "none") ctx.settleCard(Number(option));
    },
  };
}

function nextBoostBuff(amount: number, addDriver = false): CardScript {
  return {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", onBoostAttack: amount });
      if (!addDriver) return;
      const drivers = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && data(ctx, card).name === "Hyper Driver");
      if (drivers.length) ctx.requestCardChoice("gas-up-driver", decisionPrompt("Put a Hyper Driver into the arena?", "card.evo.hyperdriver.arena.optional", { optionMessages: commonOptionMessages("none") }), ["none", ...drivers.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "gas-up-driver" && option !== "none") ctx.settleCard(Number(option));
    },
  };
}

function conditionalDestroyedItem(keyword: "go again" | "overpower"): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.getPlayerFlag(ctx.seat, "destroyedSubtype:item") !== true) return;
      if (keyword === "go again") ctx.grantGoAgain();
      else ctx.setFlag("link", "overpower", true);
    },
  };
}

const dashDatabase: CardScript = {
  lookAtTopDeck: true,
  onGameStart: initializeCogwerx,
  allowsFriendlyCardPlayFrom(ctx, card, zone) {
    const d = data(ctx, card);
    return zone === "deck" && isItem(ctx, card) && hasTag(ctx, card, "mechanologist") && (d.cost ?? 0) <= 1 &&
      ctx.player(ctx.seat).deck[0]?.instanceId === card.instanceId;
  },
  modifyFriendlyCardPlayCost(ctx, card, zone, baseCost) {
    return zone === "deck" && isItem(ctx, card) && (data(ctx, card).cost ?? 0) <= 1 ? baseCost + 1 : baseCost;
  },
  allowsFriendlyCardPlayAsInstant(ctx, card, zone) {
    return zone === "deck" && isItem(ctx, card) && hasTag(ctx, card, "mechanologist") && (data(ctx, card).cost ?? 0) <= 1;
  },
};

const maxxNitro: CardScript = {
  onGameStart: initializeCogwerx,
  grantsCrankToFriendly(ctx, card) {
    return data(ctx, card).name.toLowerCase() === "hyper driver";
  },
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
};

const teklovossen: CardScript = {
  onGameStart: initializeCogwerx,
  allowsFriendlyCardPlayFrom: (ctx, card, zone) => zone === "banish" && isEvo(ctx, card),
  activated: {
    cost: 3,
    isAttack: false,
    goAgain: false,
    oncePerTurn: true,
    timing: "instant",
    onActivate(ctx) { ctx.setPlayerFlag(ctx.seat, "nextEvoAsInstant", true); },
  },
  triggers: [{
    event: "card-played",
    label: "Draw a card",
    condition: (ctx, played) => !!played && isEvo(ctx, played) &&
      ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true,
    onTrigger: (ctx) => ctx.setPlayerFlag(ctx.seat, "nextEvoAsInstant", false),
    effect: (ctx) => ctx.drawCards(ctx.seat, 1),
  }],
};

export const evo: Record<string, CardScript> = mergeSetScripts("EVO", evoHighRarity, {
  "dash, database|0": dashDatabase,
  "maxx nitro|0": maxxNitro,
  "teklovossen|0": teklovossen,

  "cogwerx base head|0": cogwerxAbility((ctx) => {
    const cards = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && isMechAttack(ctx, card));
    if (cards.length) ctx.requestCardChoice("cogwerx-head", decisionPrompt("Shuffle a Mechanologist attack into your deck", "card.evo.mechanologist.attack.shuffle"), cards.map((card) => card.instanceId));
  }, "Remove steam: recover a boosted attack"),
  "cogwerx base chest|0": cogwerxAbility((ctx) => ctx.changeResources(ctx.seat, 2), "Remove steam: gain 2 resources"),
  "cogwerx base arms|0": cogwerxAbility((ctx) => buffNextAttack(ctx, { attack: 1, appliesToClass: "mechanologist" }), "Remove steam: next Mechanologist attack +1"),
  "cogwerx base legs|0": cogwerxAbility((ctx) => ctx.gainActionPoint(), "Remove steam: gain an action point"),

  "evo command center|2": destroyUnderAbility((ctx) => ctx.addModifier({ scope: "until-end-of-turn", onHitDraw: 1, appliesTo: "weapon" })),
  "evo engine room|2": {
    ...destroyUnderAbility((ctx) => ctx.setPlayerFlag(ctx.seat, "nextWeaponCostReduction", true)),
    modifyAttackActivationCost(ctx, attacker, baseCost) {
      return data(ctx, attacker).cardType === "weapon" && ctx.getPlayerFlag(ctx.seat, "nextWeaponCostReduction") === true
        ? Math.max(0, baseCost - 1)
        : baseCost;
    },
    onFriendlyActivate(ctx, activated) {
      if (data(ctx, activated).cardType === "weapon") ctx.setPlayerFlag(ctx.seat, "nextWeaponCostReduction", false);
    },
  },
  "evo smoothbore|2": destroyUnderAbility((ctx) => buffNextAttack(ctx, { attack: 1, appliesTo: "weapon" })),
  "evo thruster|2": destroyUnderAbility((ctx) => {
    const weapons = ctx.player(ctx.seat).weapons;
    if (weapons.length) ctx.requestCardChoice("thruster", decisionPrompt("Choose a weapon that may attack an additional time", "card.evo.weapon.attackagain.choose"), weapons.map((card) => card.instanceId));
  }),
  "evo tekloscope|3": evoEquipment(),
  "evo energy matrix|3": evoEquipment({ modifyAttackActivationCost: (ctx, attacker, base) => data(ctx, attacker).name === "Teklo Blaster" ? Math.max(0, base - 1) : base }),
  "evo scatter shot|3": evoEquipment({ modifyAttack: (ctx) => ctx.link && data(ctx, ctx.link.attackingCard).name === "Teklo Blaster" ? 1 : 0 }),
  "evo rapid fire|3": evoEquipment({ onFriendlyAttackDeclared(ctx) { if (ctx.link && data(ctx, ctx.link.attackingCard).name === "Teklo Blaster") ctx.grantGoAgain(); } }),
  "evo sentry base head|1": evoEquipment(),
  "evo sentry base chest|1": evoEquipment(),
  "evo sentry base arms|1": evoEquipment(),
  "evo sentry base legs|1": evoEquipment(),
  "evo data mine|2": destroyUnderAbility((ctx) => {
    ctx.drawCards(ctx.seat, 1);
    const hand = ctx.player(ctx.seat).hand;
    if (hand.length) ctx.requestCardChoice("data-mine", decisionPrompt("Put a card from your hand on top of your deck", "card.evo.hand.card.top"), hand.map((card) => card.instanceId));
  }),
  "evo battery pack|2": destroyUnderAbility((ctx) => addSteamToChoice(ctx, "battery-pack")),
  "evo cogspitter|2": destroyUnderAbility((ctx) => {
    const items = ctx.player(ctx.seat).hand.filter((card) => isItem(ctx, card) && (data(ctx, card).cost ?? 0) <= 1);
    if (items.length) ctx.requestCardChoice("cogspitter", decisionPrompt("Put an item with cost 0 or 1 into the arena", "card.evo.item.small.arena"), items.map((card) => card.instanceId));
  }),
  "evo charging rods|2": destroyUnderAbility((ctx) => { ctx.createToken(QUICKEN); }),
  "evo zoom call|2": evoEquipment({ onEnterArena(ctx) { if (ctx.player(ctx.seat).hand.length) ctx.requestCardChoice("zoom-call", decisionPrompt("Banish a card from hand to draw a card?", "card.evo.hand.card.banish.draw", { optionMessages: commonOptionMessages("none") }), ["none", ...ctx.player(ctx.seat).hand.map((card) => card.instanceId)]); } }),
  "evo buzz hive|2": evoEquipment({ onEnterArena(ctx) { ctx.changeResources(ctx.seat, 1); } }),
  "evo whizz bang|2": evoEquipment({ onEnterArena(ctx) { if (ctx.link) ctx.addModifier({ scope: "chain-link", attack: 1 }); } }),
  "evo zip line|2": evoEquipment({ onEnterArena(ctx) { if (ctx.link) ctx.grantGoAgain(); } }),

  ...pitches("heavy artillery", () => ({
    canBeDefendedBy(ctx, defending) {
      if (!isAttackAction(ctx, defending)) return true;
      return (data(ctx, defending).cost ?? 0) >= equippedEvos(ctx);
    },
  })),
  ...pitches("liquid-cooled mayhem", () => ({ modifyPlayCost: (ctx, base) => Math.max(0, base - equippedEvos(ctx)) })),
  ...pitches("mechanical strength", () => ({ modifyAttack: equippedEvos })),

  "fuel injector|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", putSelfOnDeckBottomCost: true, onActivate(ctx) { ctx.changeResources(ctx.seat, 1); } } },
  "medkit|3": { activated: { cost: 0, isAttack: false, goAgain: false, putSelfOnDeckBottomCost: true, onActivate(ctx) { ctx.gainLife(ctx.seat, 2); } } },
  "steam canister|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", putSelfOnDeckBottomCost: true, onActivate(ctx) { addSteamToChoice(ctx, "steam-canister"); } } },
  "polarity reversal script|1": maintenanceItem(1, {
    modifyDefendingDefense(ctx, defending) {
      return ctx.link && isMechAttack(ctx, ctx.link.attackingCard) && ctx.hasCardType(defending, "action") ? -1 : 0;
    },
  }),
  "penetration script|2": maintenanceItem(1, { onEnterArena(ctx) { ctx.addModifier({ scope: "static", attack: 1, appliesTo: "attack-action", appliesToClass: "mechanologist" }); } }),
  "security script|3": maintenanceItem(1, { onEnterArena(ctx) { ctx.addModifier({ scope: "static", defense: 1, appliesToCardType: "action", appliesToClass: "mechanologist" }); } }),
  "backup protocol: red|1": backupProtocol(1),
  "backup protocol: yel|2": backupProtocol(2),
  "backup protocol: blu|3": backupProtocol(3),
  "boom grenade|2": boomGrenade(3),
  "boom grenade|3": boomGrenade(2),
  ...pitches("dissolving shield", (pitch) => dissolvingShield(4 - pitch)),
  ...pitches("hadron collider", (pitch) => hadronCollider(5 - pitch)),
  ...pitches("mini forcefield", (pitch) => miniForcefield(5 - pitch)),
  "overload script|1": maintenanceItem(1, { onFriendlyPlay(ctx, played) { if (isMechAttack(ctx, played)) ctx.grantCardKeyword(played.instanceId, "overpower"); } }),
  "mhz script|2": maintenanceItem(1, { onFriendlyPlay(ctx, played) { if (isMechAttack(ctx, played)) ctx.grantCardKeyword(played.instanceId, "go again"); } }),
  "autosave script|3": maintenanceItem(1, { onFriendlyCombatDamageDealt(ctx, source) { if (isMechAttack(ctx, source)) ctx.putOnDeckBottom(source.instanceId); } }),

  ...pitches("hydraulic press", () => scrapAttack((ctx) => ctx.setFlag("link", "overpower", true))),
  ...pitches("ratchet up", () => galvanize({
    modifyDefendingDefense(ctx, defending) {
      return ctx.getPlayerFlag(ctx.seat, "destroyedSubtype:item") === true && ctx.hasCardType(defending, "action") ? -1 : 0;
    },
  })),
  ...pitches("scrap hopper", () => scrapAttack((ctx) => { ctx.createToken(QUICKEN); })),
  ...pitches("soup up", () => galvanize(conditionalDestroyedItem("go again"))),
  ...pitches("torque tuned", () => galvanize(conditionalDestroyedItem("overpower"))),
  ...pitches("cognition field", () => galvanize()),
  ...pitches("infuse alloy", () => galvanize()),
  ...pitches("infuse titanium", () => galvanize()),
  ...pitches("junkyard dogg", () => scrapAttack((ctx) => ctx.addModifier({ scope: "chain-link", attack: 1 }))),
  ...pitches("scrap compactor", () => scrapAttack((ctx) => ctx.setPlayerFlag(ctx.seat, "nextEvoAsInstant", true))),
  ...pitches("scrap harvester", () => scrapAttack((ctx) => addSteamToChoice(ctx, "scrap-harvester"))),
  ...pitches("scrap prospector", () => scrapAttack((ctx) => ctx.changeResources(ctx.seat, 1))),

  ...pitches("bull bar", () => ({ onAttackDeclared(ctx) { if (controlsNamed(ctx, "Hyper Driver")) ctx.setFlag("link", "overpower", true); } })),
  ...pitches("spring a leak", () => ({
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      const targets = [...opponent.weapons, ...Object.values(opponent.equipment).filter((card): card is DeepReadonly<CardInstance> => !!card), ...opponent.board]
        .filter((card) => Number(card.counters?.steam ?? 0) > 0);
      if (targets.length) ctx.requestCardChoice("spring-leak", decisionPrompt("Remove all steam counters from a permanent", "card.evo.permanent.steam.remove"), targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "spring-leak") ctx.setCardCounter(Number(option), "steam", 0); },
  })),
  "big shot|1": { modifyAttack: (ctx) => boostedCount(ctx) >= 2 ? 2 : 0 },
  "burn rubber|1": { modifyAttack: (ctx) => boostedCount(ctx) >= 2 ? 2 : 0, canBeDefendedBy: (ctx, card) => boostedCount(ctx) < 2 || data(ctx, card).cardType !== "equipment" },
  "smash and grab|1": {
    modifyAttack: (ctx) => boostedCount(ctx) >= 2 ? 2 : 0,
    canTriggerOnHit(ctx) {
      return boostedCount(ctx) >= 2 && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const items = ctx.player(opponentSeat(ctx)).board.filter((card) => isItem(ctx, card));
      if (items.length) {
        ctx.requestCardChoice(
          "smash-and-grab",
          decisionPrompt("Gain control of an item controlled by the defending hero", "card.evo.defendinghero.item.control"),
          items.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "smash-and-grab") ctx.steal(Number(option), { duration: "indefinite" });
    },
  },
  ...pitches("gigawatt", (pitch) => ({ onPlay(ctx) { buffNextAttack(ctx, { attack: 5 - pitch, appliesToClass: "mechanologist" }); } })),
  ...pitches("firewall", () => ({
    onDefend(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name} reveals ${data(ctx, top).name}`, "card.log.common.decktop.revealed", { revealed: { kind: "card", cardId: top.cardId } }, { kind: "cards-revealed", cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" }));
      if (!isEvo(ctx, top)) ctx.putOnDeckBottom(top.instanceId);
    },
  })),
  ...pitches("teklonetic force field", () => ({
    canTriggerOnDefend: (ctx) => ctx.currentAttackHasOverpower(),
    onDefend(ctx) { ctx.addCardTempDefense(ctx.self.instanceId, 2); },
  })),

  "big bertha|1": { onBanishedForBoost: addHyperSteam },
  "big bertha|2": { onBanishedForBoost: addHyperSteam },
  "fender bender|2": { modifyAttack: (ctx) => ctx.link?.defendingEquipment.length ?? 0 },
  "fender bender|3": { modifyAttack: (ctx) => ctx.link?.defendingEquipment.length ?? 0 },
  "out pace|2": { cannotBeDefendedByEquipment: true },
  "out pace|3": { cannotBeDefendedByEquipment: true },
  "under loop|2": { onHit(ctx) { ctx.setFlag("link", "attackToBottom", true); } },
  "under loop|3": { onHit(ctx) { ctx.setFlag("link", "attackToBottom", true); } },
  "re-charge!|2": { onPlay(ctx) { addHyperSteam(ctx); ctx.addModifier({ scope: "until-end-of-turn", onBoostAttack: 3 }); } },
  "re-charge!|3": { onPlay(ctx) { addHyperSteam(ctx); ctx.addModifier({ scope: "until-end-of-turn", onBoostAttack: 2 }); } },
  "rev up|2": { modifyPlayCost: (ctx, base) => Math.max(0, base - (controlsNamed(ctx, "Hyper Driver") ? 1 : 0)) },
  "rev up|3": { modifyPlayCost: (ctx, base) => Math.max(0, base - (controlsNamed(ctx, "Hyper Driver") ? 1 : 0)) },

  ...pitches("data link", () => ({ onHit(ctx) { optN(ctx, 1); }, onChoose: optOnChoose })),
  ...pitches("dive through data", () => ({ onHit(ctx) { optN(ctx, 1); }, onChoose: optOnChoose })),
  ...pitches("sprocket rocket", () => ({ modifyAttack: (ctx) => boostedItemOrEquipment(ctx) ? 1 : 0 })),
  ...pitches("dumpster dive", () => ({ modifyAttack: (ctx) => boostedItemOrEquipment(ctx) ? 1 : 0 })),
  ...pitches("expedite", () => itemFromHandOnHit()),
  ...pitches("metex", () => itemFromHandOnHit()),
  ...pitches("lay waste", () => ({ cannotBeDefendedByEquipment: true })),
  ...pitches("panel beater", () => ({ modifyAttack: (ctx) => ctx.link?.defendingEquipment.length ?? 0 })),
  ...pitches("gas up", (pitch) => nextBoostBuff(5 - pitch, true)),
  ...pitches("quickfire", (pitch) => ({
    modifyPlayCost: (ctx, base) => Math.max(0, base - hyperDrivers(ctx).length),
    ...nextBoostBuff(5 - pitch),
  })),
});

for (const key of ["evo thruster|2", "evo data mine|2", "evo battery pack|2", "evo cogspitter|2", "evo zoom call|2", "steam canister|3", "scrap harvester|1", "scrap harvester|2", "scrap harvester|3"] as const) {
  const script = evo[key]!;
  const prior = script.onChoose;
  script.onChoose = (ctx, hook, option) => {
    if (hook === "thruster") ctx.grantAdditionalActivation(Number(option));
    else if (hook === "data-mine") ctx.putOnDeckTop(Number(option));
    else if (hook === "battery-pack" || hook === "steam-canister" || hook === "scrap-harvester") addSteam(ctx, option);
    else if (hook === "cogspitter") ctx.settleCard(Number(option));
    else if (hook === "zoom-call" && option !== "none" && ctx.banish(Number(option))) ctx.drawCards(ctx.seat, 1);
    else prior?.(ctx, hook, option);
  };
}

evo["cogwerx base head|0"]!.onChoose = (ctx, hook, option) => {
  if (hook !== "cogwerx-head") return;
  if (ctx.putOnDeckBottom(Number(option))) ctx.shuffleDeck();
};
