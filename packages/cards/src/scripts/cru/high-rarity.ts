import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  commonOptionMessages,
  dealArcane,
  decisionMessage,
  decisionPrompt,
  localizedCardLog,
  opponentSeat,
  optN,
  optOnChoose,
  previousAttackHasName,
  wizardActionAsInstant,
  yesNoPrompt,
} from "../shared-helpers.js";

const COPPER = "CRU197";
const QUICKEN = "CRU196";
const RUNECHANT = "CRU157";
const ZEN_STATE = "CRU075";

function types(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): readonly string[] {
  return ctx.cardTypes(card);
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return types(ctx, card).includes(type);
}

function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function isNonAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack");
}

function previousNamed(ctx: ScriptCtx, name: string): boolean {
  return previousAttackHasName(ctx, name);
}

function runeCount(ctx: ScriptCtx): number {
  return ctx.player(ctx.seat).board.filter((card) => ctx.cardData(card.cardId).name === "Runechant").length;
}

function ownedCards(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  const player = ctx.player(ctx.seat);
  return [
    player.hero,
    ...player.hand,
    ...player.deck,
    ...player.arsenal,
    ...player.pitch,
    ...player.graveyard,
    ...player.banish,
    ...player.soul,
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => !!card),
  ].filter((card) => card.owner === ctx.seat);
}

function requestItemDestruction(ctx: ScriptCtx): void {
  const remaining = ctx.getCounter("smashRemaining");
  const items = ctx.player(opponentSeat(ctx)).board.filter((card) => hasType(ctx, card, "item"));
  if (remaining > 0 && items.length > 0) {
    ctx.requestCardChoice(
      "smash-item",
      decisionPrompt(
        "Argh... Smash!: destroy an item?",
        "card.cru.smash.item.destroy",
        { optionMessages: commonOptionMessages("done") },
      ),
      ["done", ...items.map((card) => card.instanceId)],
    );
  }
}

function orderOnTop(ctx: ScriptCtx, ids: number[]): void {
  if (ids.length === 0) return;
  if (ids.length === 1) { ctx.putOnDeckTop(ids[0]!); return; }
  ctx.requestCardChoice(
    `cleanse-order:${ids.join(",")}`,
    decisionPrompt(
      "Righteous Cleansing: choose the next card for the top",
      "card.cru.cleansing.order.choose",
    ),
    ids,
  );
}

const righteousCleansing: CardScript = {
  canTriggerOnHit(ctx) {
    return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4;
  },
  onHit(ctx) {
    const top = ctx.player(opponentSeat(ctx)).deck.slice(0, 5);
    for (const card of top) ctx.lookAt(card.instanceId);
    if (top.length > 0) ctx.requestCardChoice(
      `cleanse-name:${top.map((card) => card.instanceId).join(",")}`,
      decisionPrompt(
        "Righteous Cleansing: choose a card name to banish",
        "card.cru.cleansing.name.choose",
      ),
      top.map((card) => card.instanceId),
    );
  },
  onChoose(ctx, hook, option) {
    const choose = /^cleanse-name:([\d,]+)$/.exec(hook);
    if (choose) {
      const ids = choose[1]!.split(",").map(Number);
      const selected = ctx.player(opponentSeat(ctx)).deck.find((card) => card.instanceId === Number(option));
      if (!selected) return;
      const name = ctx.cardData(selected.cardId).name;
      const matching = ctx.player(opponentSeat(ctx)).deck.filter((card) => ids.includes(card.instanceId) && ctx.cardData(card.cardId).name === name);
      for (const card of matching) ctx.banish(card.instanceId);
      orderOnTop(ctx, ids.filter((id) => !matching.some((card) => card.instanceId === id)));
      return;
    }
    const order = /^cleanse-order:([\d,]+)$/.exec(hook);
    if (!order) return;
    const ids = order[1]!.split(",").map(Number);
    const chosen = Number(option);
    if (!ids.includes(chosen) || !ctx.putOnDeckTop(chosen)) return;
    orderOnTop(ctx, ids.filter((id) => id !== chosen));
  },
};

const floodOfForce: CardScript = {
  onAttackDeclared(ctx) {
    if (!previousNamed(ctx, "rushing river") && !previousNamed(ctx, "flood of force")) return;
    const top = ctx.player(ctx.seat).deck[0];
    if (!top) return;
    ctx.logPublic(localizedCardLog(ctx, `Flood of Force reveals ${ctx.cardData(top.cardId).name}`, "card.log.common.decktop.revealed", { revealed: { kind: "card", cardId: top.cardId } }, { kind: "cards-revealed", cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" }));
    if ((ctx.cardData(top.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "combo")) {
      ctx.moveToHand(top.instanceId);
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      ctx.grantGoAgain();
    }
  },
};

const heronsFlight: CardScript = {
  modifyAttack: (ctx) => previousNamed(ctx, "crane dance") ? 2 : 0,
  onAttackDeclared(ctx) {
    if (previousNamed(ctx, "crane dance")) ctx.requestChoice(
      "heron-mode",
      decisionPrompt(
        "Heron's Flight: choose what may defend",
        "card.cru.heron.defense.choose",
        {
          optionMessages: {
            "attack actions": decisionMessage("card.cru.heron.option.attacks"),
            "non-attack actions": decisionMessage("card.cru.heron.option.nonattacks"),
          },
        },
      ),
      ["attack actions", "non-attack actions"],
    );
  },
  canBeDefendedBy(ctx, defending) {
    const mode = ctx.getCounter("heronMode");
    if (mode === 0) return true;
    return mode === 1 ? isAttack(ctx, defending) : isNonAttack(ctx, defending);
  },
  onChoose(ctx, hook, option) { if (hook === "heron-mode") ctx.setCounter("heronMode", option === "attack actions" ? 1 : 2); },
};

const unifiedDecree: CardScript = {
  canPlay: (ctx) => ctx.link?.attackCardType === "weapon",
  onPlay(ctx) {
    ctx.addModifier({ scope: "chain-link", attack: 3 });
    if (!ctx.link?.flags.defendedFromHand) return;
    const top = ctx.player(ctx.seat).deck[0];
    if (!top) return;
    ctx.lookAt(top.instanceId);
    if (ctx.cardData(top.cardId).cardType === "attack-reaction") ctx.requestCardChoice(
      "decree-banish",
      decisionPrompt(
        "Unified Decree: banish the top card?",
        "card.cru.decree.banish",
        { optionMessages: commonOptionMessages("no") },
      ),
      ["no", top.instanceId],
    );
  },
  onChoose(ctx, hook, option) {
    if (hook !== "decree-banish" || option === "no") return;
    const id = Number(option);
    if (ctx.banish(id)) ctx.allowPlayFrom(id, "banish", { untilChainClose: true });
  },
};

const viziertronic: CardScript = {
  activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); } },
  onBoosted(ctx) {
    ctx.drawCards(ctx.seat, 1);
    const hand = ctx.player(ctx.seat).hand;
    if (hand.length > 0) ctx.requestCardChoice(
      "viz-top",
      decisionPrompt(
        "Viziertronic Model i: put a card on top",
        "card.cru.viziertronic.card.top",
      ),
      hand.map((card) => card.instanceId),
    );
  },
  onChoose(ctx, hook, option) { if (hook === "viz-top") ctx.putOnDeckTop(Number(option)); },
};

const plasmaPurifier: CardScript = {
  activated: [
    { cost: 1, isAttack: false, goAgain: true, label: "Load a steam counter", canActivate: (ctx) => ctx.getCounter("steam") === 0, onActivate(ctx) { ctx.setCounter("steam", 1); } },
    { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, label: "Give a pistol +1 power", removeCounterCost: { key: "steam", amount: 1 }, canActivate: (ctx) => ctx.player(ctx.seat).weapons.some((card) => hasType(ctx, card, "mechanologist") && hasType(ctx, card, "pistol")), onActivate(ctx) { const pistols = ctx.player(ctx.seat).weapons.filter((card) => hasType(ctx, card, "mechanologist") && hasType(ctx, card, "pistol")); ctx.requestCardChoice("purifier-pistol", decisionPrompt("Plasma Purifier: choose a pistol", "card.cru.purifier.pistol.choose"), pistols.map((card) => card.instanceId)); } },
  ],
  onChoose(ctx, hook, option) { if (hook === "purifier-pistol") ctx.addCardTempPower(Number(option), 1); },
};

const remorseless: CardScript = {
  onEnterArsenal(ctx) { if (!ctx.self.faceDown) ctx.setCounter("faceUpLoaded", 1); },
  onAttackDeclared(ctx) { if (ctx.getCounter("faceUpLoaded")) ctx.addModifier({ scope: "chain-link", noDefenseReactionsFromArsenal: true }); },
  onHit(ctx) {
    const target = ctx.player(opponentSeat(ctx));
    ctx.setPlayerFlag(target.seat, "loseLifeOnActionThroughNextTurn", true);
    ctx.setCardCounter(target.hero.instanceId, "loseLifeOnActionUntilTurn", ctx.state.turn + 1);
    ctx.setCardCounter(target.hero.instanceId, "loseLifeOnActionSource", ctx.self.instanceId);
  },
};

const poisonTheTips: CardScript = {
  onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); reload(ctx); },
  canTriggerOnHit(ctx) {
    return !!ctx.link && hasType(ctx, ctx.link.attackingCard, "arrow") &&
      ctx.link.targetAllyId === undefined;
  },
  onHit(ctx) {
    const target = opponentSeat(ctx);
    const hand = ctx.player(target).hand;
    if (hand.length > 0) ctx.requestCardChoice(
      "poison-discard",
      decisionPrompt(
        "Poison the Tips: choose a card to discard",
        "card.cru.poison.discard.choose",
      ),
      hand.map((card) => card.instanceId),
      target,
    );
  },
  onChoose(ctx, hook, option) { if (hook === "poison-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); else reloadChoice(ctx, hook, option); },
};

function reload(ctx: ScriptCtx): void {
  const player = ctx.player(ctx.seat);
  if (player.arsenal.length === 0 && player.hand.length > 0) ctx.requestCardChoice(
    "cru-high-reload",
    decisionPrompt(
      "Reload: put a card into arsenal?",
      "card.cru.reload.card.choose",
      { optionMessages: commonOptionMessages("pass") },
    ),
    ["pass", ...player.hand.map((card) => card.instanceId)],
  );
}

function reloadChoice(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== "cru-high-reload") return false;
  if (option !== "pass") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
  return true;
}

const rattleBones: CardScript = {
  playAsInstant: (ctx) => ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true,
  onPlay(ctx) {
    const cards = ctx.player(ctx.seat).graveyard.filter((card) => isAttack(ctx, card) && hasType(ctx, card, "runeblade"));
    if (cards.length > 0) ctx.requestCardChoice(
      "rattle-banish",
      decisionPrompt(
        "Rattle Bones: choose a Runeblade attack",
        "card.cru.rattlebones.attack.choose",
      ),
      cards.map((card) => card.instanceId),
    );
  },
  onChoose(ctx, hook, option) { if (hook === "rattle-banish" && ctx.banish(Number(option))) ctx.allowPlayFrom(Number(option), "banish"); },
};

const metacarpusNode: CardScript = {
  triggers: [{
    event: "card-played",
    label: "Pay 1 resource for +1 arcane damage?",
    condition: (ctx, played) => !!played &&
      ctx.cardData(played.cardId).text?.toLowerCase().includes("arcane damage") === true,
    effect(ctx, played) {
      if (!played) return;
      ctx.setCounter("metacarpusTarget", played.instanceId);
      ctx.requestPayment(
        "metacarpus-pay",
        decisionPrompt(
          "Metacarpus Node: pay 1 resource for +1 arcane damage?",
          "card.cru.metacarpus.pay",
          { optionMessages: commonOptionMessages("no") },
        ),
        1,
      );
    },
  }],
  onChoose(ctx, hook, option) {
    if (hook !== "metacarpus-pay" || option !== "paid") return;
    ctx.addCounter(ctx.getCounter("metacarpusTarget"), "arcaneBonus", 1);
    ctx.destroyAtEndPhase(ctx.self.instanceId);
  },
};

const chainLightning: CardScript = {
  arcaneDamageEffect: true,
  arcaneDamageEffectAmounts: [3],
  playAsInstant: wizardActionAsInstant,
  onPlay(ctx) {
    const playedAnother = Number(ctx.getFlag("player", "playedClassTypeCount:wizard:non-attack-action")) >= 2;
    ctx.setFlag("player", "nextWizardNonAttackAsInstant", true);
    if (playedAnother) dealArcane(ctx, opponentSeat(ctx), 3);
  },
};

const coaxACommotion: CardScript = {
  onHit(ctx) {
    ctx.requestChoice(
      "coax-modes",
      decisionPrompt(
        "Coax a Commotion: choose any number",
        "card.cru.coax.modes.choose",
        {
          optionMessages: {
            none: decisionMessage("common.option.none"),
            quicken: decisionMessage("card.cru.coax.option.quicken"),
            draw: decisionMessage("card.cru.coax.option.draw"),
            life: decisionMessage("card.cru.coax.option.life"),
            "quicken+draw": decisionMessage("card.cru.coax.option.quickendraw"),
            "quicken+life": decisionMessage("card.cru.coax.option.quickenlife"),
            "draw+life": decisionMessage("card.cru.coax.option.drawlife"),
            all: decisionMessage("card.cru.coax.option.all"),
          },
        },
      ),
      ["none", "quicken", "draw", "life", "quicken+draw", "quicken+life", "draw+life", "all"],
    );
  },
  onChoose(ctx, hook, option) {
    if (hook !== "coax-modes" || option === "none") return;
    const quicken = option === "all" || option.includes("quicken");
    const draw = option === "all" || option.includes("draw");
    const life = option === "all" || option.includes("life");
    for (const player of ctx.state.players) {
      if (quicken) ctx.createToken(QUICKEN, player.seat);
      if (draw) ctx.drawCards(player.seat, 1);
      if (life) ctx.gainLife(player.seat, 1);
    }
  },
};

export const cruHighRarity: Record<string, CardScript> = {
  "arknight shard|3": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Create a Runechant token", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx) { ctx.createToken(RUNECHANT); } }] },
  "skullhorn|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.drawCards(ctx.seat, 1); ctx.discardRandom(ctx.seat, 1); } } },
  "argh... smash!|2": {
    onPlay(ctx) { ctx.requestDieRoll("argh-smash", 6); },
    onDieRollResolved(ctx, hook, roll) { if (hook === "argh-smash") { ctx.setCounter("smashRemaining", Math.floor(roll / 2)); requestItemDestruction(ctx); } },
    onChoose(ctx, hook, option) { if (hook !== "smash-item" || option === "done") return; if (ctx.destroyPermanent(Number(option))) { ctx.setCounter("smashRemaining", ctx.getCounter("smashRemaining") - 1); requestItemDestruction(ctx); } },
  },
  "crater fist|0": { activated: { cost: 3, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToKeyword: "crush" }); } } },
  "righteous cleansing|2": righteousCleansing,
  "stamp authority|3": { suppressesAttackActionHitEffects: true, onEnterArena(ctx) { ctx.setPlayerFlag(ctx.seat, "suppressAttackActionHitEffects", true); if (ctx.player(ctx.seat).pitch.filter((card) => (ctx.cardData(card.cardId).cost ?? 0) >= 3).length >= 2) ctx.setPlayerFlag(ctx.seat, "bonusIntellect", Number(ctx.getPlayerFlag(ctx.seat, "bonusIntellect")) + 1); }, onLeaveArena(ctx) { ctx.setPlayerFlag(ctx.seat, "suppressAttackActionHitEffects", false); }, triggers: [{ event: "begin-action-phase", label: "Destroy Stamp Authority", effect: (ctx) => ctx.destroySelf() }] },

  "breeze rider boots|0": { canTriggerOnHit(ctx) { return ctx.link?.attackCardType === "action" && hasType(ctx, ctx.link.attackingCard, "ninja"); }, onHit(ctx) { ctx.requestChoice("breeze-destroy", yesNoPrompt("Destroy Breeze Rider Boots?", "card.cru.breeze.boots.destroy"), ["yes", "no"]); }, onChoose(ctx, hook, option) { if (hook === "breeze-destroy" && option === "yes") { ctx.destroySelf(); ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToKeyword: "combo" }); } } },
  "find center|3": { canBeDefendedBy(ctx, defending) { return !previousNamed(ctx, "crane dance") || (ctx.cardData(defending.cardId).cost ?? 0) >= ctx.currentChainLinkNumber(); }, canTriggerOnHit(ctx) { return previousNamed(ctx, "crane dance"); }, onHit(ctx) { ctx.createToken(ZEN_STATE); } },
  "flood of force|2": floodOfForce,
  "heron's flight|1": heronsFlight,
  "courage of bladehold|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attackActivationCostReduction: 1, appliesTo: "sword" }); } } },
  "twinning blade|2": { onPlay(ctx) { const weapon = ctx.link?.attackingCard; if (weapon && ctx.link?.attackCardType === "weapon") ctx.grantAdditionalActivation(weapon.instanceId); } },
  "unified decree|2": unifiedDecree,
  "spoils of war|1": { onPlay(ctx) { ctx.addModifier({ scope: "next-attack", attack: 2, goAgain: true, appliesTo: "weapon" }); ctx.addModifier({ scope: "until-end-of-turn" }); }, canTriggerOnHit(ctx) { return ctx.link?.attackCardType === "weapon"; }, onHit(ctx) { ctx.createTokens(COPPER, 2); } },

  "shiyana, diamond gemini|0": {
    triggers: [{
      event: "begin-action-phase",
      label: "Copy a hero with Shiyana",
      effect(ctx) {
        const previousClass = ctx.self.chosenName;
        if (previousClass) {
          for (const card of ownedCards(ctx)) ctx.removeCardType(card.instanceId, previousClass);
        }
        const heroes = ctx.state.players
          .filter((player) => player.seat !== ctx.seat)
          .map((player) => player.hero.instanceId);
        ctx.requestCardChoice(
          "shiyana-hero",
          decisionPrompt(
            "Shiyana: choose a hero to copy",
            "card.cru.shiyana.hero.choose",
          ),
          heroes,
        );
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "shiyana-hero") return;
      const target = ctx.state.players.map((player) => player.hero)
        .find((hero) => hero.instanceId === Number(option));
      if (!target) return;
      const heroData = ctx.cardData(target.cardId);
      const heroClass = heroData.classes?.[0];
      if (heroClass) {
        ctx.setChosenName(heroClass);
        for (const card of ownedCards(ctx)) ctx.grantCardType(card.instanceId, heroClass);
      }
      ctx.becomeHeroUntilNextTurn(target.cardId);
    },
  },
  "viziertronic model i|0": viziertronic,
  "meganetic shockwave|3": {
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "mustDefendWithEquipmentCount", Number(ctx.getFlag("player", "boostCountThisTurn")) || 0);
    },
  },
  "absorption dome|2": {
    onEnterArena(ctx) {
      const steam = Number(ctx.getFlag("player", "boostCountThisTurn")) || 0;
      ctx.setCounter("steam", steam);
      ctx.setCounter("damageReplacement", steam);
    },
    replaceDamageToController(ctx, amount) {
      const prevented = Math.min(amount, ctx.getCounter("steam"));
      if (prevented <= 0) return amount;
      const remaining = ctx.getCounter("steam") - prevented;
      ctx.setCounter("steam", remaining);
      ctx.setCounter("damageReplacement", remaining);
      ctx.logPublic(localizedCardLog(ctx, `Absorption Dome prevents ${prevented} damage`, "card.log.cru.damage.prevented", { amount: prevented }));
      if (remaining === 0) ctx.destroySelf();
      return amount - prevented;
    },
  },
  "plasma purifier|1": plasmaPurifier,
  "perch grapplers|0": { activated: { cost: 2, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToSubtype: "arrow", appliesToFromArsenal: true }); } } },
  "remorseless|1": remorseless,
  "poison the tips|2": poisonTheTips,
  "feign death|2": { canPlay: (ctx) => ctx.getFlag("player", "damageTakenThisTurn") === true, onPlay(ctx) { ctx.preventNextDamage(ctx.seat, Number.MAX_SAFE_INTEGER); } },

  "bloodsheath skeleta|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { const discount = runeCount(ctx); ctx.addModifier({ scope: "until-end-of-turn", playCostReduction: discount, appliesTo: "attack-action", once: true }); ctx.addModifier({ scope: "until-end-of-turn", playCostReduction: discount, appliesToCardType: "action", excludesSubtype: "attack", once: true }); } } },
  "dread triptych|3": { onAttackDeclared(ctx) { if (ctx.getFlag("player", "playedNonAttackAction") === true) ctx.createToken(RUNECHANT); if (ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true) ctx.createToken(RUNECHANT); }, onHit(ctx) { ctx.createToken(RUNECHANT); } },
  "rattle bones|1": rattleBones,
  "runeblood barrier|2": {
    onEnterArena(ctx) {
      ctx.createTokens(RUNECHANT, 4);
      ctx.setCounter("runechantDamageReplacement", 4);
    },
    replaceDamageToController(ctx, amount) {
      const runechants = ctx.player(ctx.seat).board.filter((card) =>
        ctx.cardData(card.cardId).name === "Runechant"
      );
      const prevented = Math.min(amount, runechants.length);
      for (const token of runechants.slice(0, prevented)) ctx.destroyPermanent(token.instanceId);
      ctx.setCounter("runechantDamageReplacement", runechants.length - prevented);
      if (prevented > 0) ctx.logPublic(localizedCardLog(ctx, `Runeblood Barrier prevents ${prevented} damage`, "card.log.cru.damage.prevented", { amount: prevented }));
      return amount - prevented;
    },
    triggers: [{ event: "begin-action-phase", label: "Destroy Runeblood Barrier", effect: (ctx) => ctx.destroySelf() }],
  },
  "metacarpus node|0": metacarpusNode,
  "chain lightning|2": chainLightning,
  "gaze the ages|3": { onPlay(ctx) { const another = Number(ctx.getFlag("player", "playedClassTypeCount:wizard:non-attack-action")) >= 2; optN(ctx, 2); if (another) ctx.returnSelfToHand(); }, onChoose: optOnChoose },
  "aetherize|3": {
    playTargetOptions(ctx) {
      return ctx.state.stack.flatMap((layer) => {
        const card = layer.card;
        if (!card || card.instanceId === ctx.self.instanceId) return [];
        const data = ctx.cardData(card.cardId);
        return ctx.hasCardType(card, "instant") && (data.cost ?? 0) <= 1 ? [card.instanceId] : [];
      });
    },
    onPlay(ctx) {
      if (ctx.playTargetInstanceId !== undefined) ctx.negateStackCard(ctx.playTargetInstanceId);
    },
  },

  "gambler's gloves|0": { dieRollReplacement: true },
  "coax a commotion|1": coaxACommotion,
  "gorganian tome|0": { onPlay(ctx) { const copies = ctx.state.players.flatMap((player) => player.graveyard).filter((card) => ctx.cardData(card.cardId).name === "Gorganian Tome").length; ctx.drawCards(ctx.seat, 1 + copies); } },
  "snag|3": { onPlay(ctx) { for (const player of ctx.state.players) ctx.setPlayerFlag(player.seat, "suppressAttackPowerEffectGains", true); } },
};
