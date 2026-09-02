import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  bottomOrKeepPrompt,
  buffNextArcaneDamageCard,
  buffNextAttack,
  commonOptionMessages,
  contractWithSilver,
  dealArcane,
  type DecisionPromptOptions,
  decisionPrompt,
  discardRandomCost,
  mergeSetScripts,
  opponentSeat,
  optN,
  optOnChoose,
  previousAttackHasName,
} from "./shared-helpers.js";
import { dynHighRarity } from "./dyn/high-rarity.js";

const CROUCHING_TIGER = "DYN065";
const RUNECHANT = "DYN191";
const SPECTRAL_SHIELD = "DYN233";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack");
}

function controlsNamed(ctx: ScriptCtx, name: string): boolean {
  return ctx.player(ctx.seat).board.some((card) => data(ctx, card).name === name);
}

function createTokens(ctx: ScriptCtx, id: string, count: number): void {
  ctx.createTokens(id, count);
}

function chooseHero(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  id: string,
  values?: DecisionPromptOptions["values"],
): void {
  ctx.requestChoice(
    hook,
    decisionPrompt(fallback, id, {
      values,
      optionMessages: commonOptionMessages("opposing hero", "your hero"),
    }),
    ["opposing hero", "your hero"],
  );
}

function heroSeat(ctx: ScriptCtx, option: string): number {
  return option === "your hero" ? ctx.seat : opponentSeat(ctx);
}

function anyTargets(ctx: ScriptCtx): number[] {
  return [
    ...ctx.state.players.map((player) => player.hero.instanceId),
    ...ctx.state.players.flatMap((player) =>
      player.board.filter((card) => hasType(ctx, card, "ally"))
        .map((card) => card.instanceId)),
  ];
}

function dealToAnyTarget(ctx: ScriptCtx, option: string, amount: number, arcane = false): void {
  const id = Number(option);
  const hero = ctx.state.players.find((player) => player.hero.instanceId === id);
  if (hero) {
    if (arcane) dealArcane(ctx, hero.seat, amount);
    else ctx.dealDamage(hero.seat, amount);
    return;
  }
  const owner = ctx.state.players.find((player) =>
    player.board.some((card) => card.instanceId === id));
  if (!owner) return;
  if (arcane) dealArcane(ctx, owner.seat, amount, id);
  else ctx.dealDamage(owner.seat, amount, { targetAllyId: id });
}

function blessing(effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: "Destroy this Blessing",
      effect(ctx) {
        ctx.destroySelf();
        effect(ctx);
      },
    }],
  };
}

function randomDiscardAttack(reward: "go-again" | "power"): CardScript {
  return {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: discardRandomCost,
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "discardedSixPlusThisTurn") !== true) return;
      if (reward === "go-again") ctx.grantGoAgain();
      else ctx.addModifier({ scope: "chain-link", attack: 3 });
    },
  };
}

function blessingFocus(amount: number): CardScript {
  const reveal = (ctx: ScriptCtx) => {
    const top = ctx.player(ctx.seat).deck[0];
    if (!top) return;
    ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`);
    if (hasType(ctx, top, "arrow")) {
      ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: true });
      ctx.addCounter(top.instanceId, "aim", 1);
    }
  };
  return {
    ...blessing((ctx) => optN(ctx, amount)),
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => reveal(ctx));
    },
  };
}

function blessingIngenuity(count: number): CardScript {
  const offer = (ctx: ScriptCtx) => {
    const candidates = [...ctx.player(ctx.seat).graveyard, ...ctx.player(ctx.seat).banish]
      .filter((card) => data(ctx, card).name === "Hyper Driver");
    if (ctx.getCounter("ingenuityRemaining") <= 0 || candidates.length === 0) return;
    ctx.requestCardChoice(
      "ingenuity",
      decisionPrompt(
        "Return a Hyper Driver to the arena?",
        "card.dyn.ingenuity.hyperdriver.return",
        { optionMessages: commonOptionMessages("done") },
      ),
      ["done", ...candidates.map((card) => card.instanceId)],
    );
  };
  return {
    ...blessing((ctx) => {
      ctx.setCounter("ingenuityRemaining", count);
      offer(ctx);
    }),
    onChoose(ctx, hook, option) {
      if (hook !== "ingenuity" || option === "done") return;
      if (!ctx.settleCard(Number(option), { allowCrank: false })) return;
      ctx.setCounter("ingenuityRemaining", ctx.getCounter("ingenuityRemaining") - 1);
      offer(ctx);
    },
  };
}

function createTiger(ctx: ScriptCtx, power = 0): void {
  const tiger = ctx.createToken(CROUCHING_TIGER);
  if (!tiger) return;
  ctx.banish(tiger.instanceId);
  if (power > 0) ctx.addCardTempPower(tiger.instanceId, power);
  ctx.allowPlayFrom(tiger.instanceId, "banish");
}

function comboWithTiger(ctx: ScriptCtx): boolean {
  return previousAttackHasName(ctx, "crouching tiger");
}

function pouncingQi(): CardScript {
  return {
    modifyAttack: (ctx) => comboWithTiger(ctx) ? 1 : 0,
    onAttackDeclared(ctx) { if (comboWithTiger(ctx)) ctx.grantGoAgain(); },
  };
}

function qiUnleashed(): CardScript {
  return { modifyAttack: (ctx) => comboWithTiger(ctx) ? 4 : 0 };
}

function spectralProwler(): CardScript {
  return {
    triggers: [{ event: "card-played", sourceZone: "self", label: "Gain go again", condition: (ctx) => controlsNamed(ctx, "Spectral Shield"), effect(ctx, played) { if (played) ctx.grantGoAgain(played.instanceId); } }],
  };
}

function spectralRider(): CardScript {
  return {
    triggers: [{ event: "card-played", sourceZone: "self", label: "Gain overpower", condition: (ctx) => controlsNamed(ctx, "Spectral Shield"), effect(ctx) { ctx.setFlag("link", "overpower", true); } }],
  };
}

function hyperDriver(steam: number): CardScript {
  return {
    destroyAtZeroCounter: "steam",
    onEnterArena(ctx) { ctx.setCounter("steam", steam); },
    onBoosted(ctx) {
      const key = `hyperDriverBoost:${ctx.self.instanceId}`;
      if (ctx.getFlag("player", key) === true || ctx.getCounter("steam") <= 0) return;
      ctx.setFlag("player", key, true);
      ctx.setCounter("steam", ctx.getCounter("steam") - 1);
      ctx.changeResources(ctx.seat, 1);
    },
  };
}

function crankshaft(): CardScript {
  return {
    onBanishedForBoost(ctx) {
      const driver = ctx.player(ctx.seat).board.find((card) => data(ctx, card).name === "Hyper Driver");
      if (driver) ctx.addCounter(driver.instanceId, "steam", 1);
    },
  };
}

function aimCounter(ctx: ScriptCtx): boolean {
  return Number(ctx.self.counters?.aim ?? 0) > 0;
}

function drillShot(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (aimCounter(ctx)) ctx.addModifier({ scope: "chain-link", piercing: 1 });
    },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment)
        .filter((card): card is DeepReadonly<CardInstance> => card !== undefined);
      if (equipment.length) ctx.requestCardChoice(
        "drill",
        decisionPrompt(
          "Put a -1 defense counter on equipment",
          "card.dyn.drill.equipment.counter",
        ),
        equipment.map((card) => card.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "drill") ctx.addCardDefenseCounters(Number(option), 1);
    },
  };
}

type ContractTest = (ctx: ScriptCtx, card: DeepReadonly<CardInstance>) => boolean;

function contractAttack(test: ContractTest): CardScript {
  return {
    ...contractWithSilver(test),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
  };
}

const contractAttackAction: ContractTest = (ctx, card) => isAttackAction(ctx, card);
const contractLowDefense: ContractTest = (ctx, card) => (data(ctx, card).defense ?? Infinity) <= 2;
const contractReaction: ContractTest = (ctx, card) => ["attack-reaction", "defense-reaction"].includes(data(ctx, card).cardType);
const contractLowCost: ContractTest = (ctx, card) => {
  const cardData = data(ctx, card);
  if (cardData.cost !== undefined) return cardData.cost <= 1;
  // An undeclared X is 0; cards with no cost property do not match.
  return ctx.hasVariablePlayCost(card);
};
const contractHighCost: ContractTest = (ctx, card) => (data(ctx, card).cost ?? -1) >= 2;
const contractGoAgain: ContractTest = (ctx, card) =>
  (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "go again");
const contractNonAttack: ContractTest = (ctx, card) => isNonAttackAction(ctx, card);

function arcaneTargetSpell(amount: number, surge: "go-again" | "opt" | "energy" | null): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    onPlay(ctx) {
      const preview = ctx.previewArcaneDamage(amount);
      chooseHero(
        ctx,
        "arcane-target",
        `Deal ${preview} arcane damage to a hero`,
        "card.dyn.arcane.hero.choose",
        { amount: preview },
      );
    },
    onDamageDealt(ctx, target, dealt, arcane) {
      if (!arcane || dealt <= amount || surge === null) return;
      if (surge === "go-again") ctx.gainActionPoint();
      else if (surge === "opt") optN(ctx, 1);
      else {
        const permanents = [
          ...ctx.player(target).board,
          ...ctx.player(target).weapons,
          ...Object.values(ctx.player(target).equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined),
          ctx.player(target).hero,
        ].filter((card) => Number(card.counters?.energy ?? 0) > 0);
        if (permanents.length) ctx.requestCardChoice(
          "sap-energy",
          decisionPrompt(
            "Remove an energy counter",
            "card.dyn.sap.energy.remove",
            { optionMessages: commonOptionMessages("pass") },
          ),
          ["pass", ...permanents.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "arcane-target") dealArcane(ctx, heroSeat(ctx, option), amount);
      else if (hook === "sap-energy" && option !== "pass") ctx.addCounter(Number(option), "energy", -1);
      else optOnChoose(ctx, hook, option);
    },
  };
}

function aetherSlash(): CardScript {
  return {
    onPlayCostPaid(ctx, paid) {
      ctx.setCounter("nonAttackPitched", paid.some((card) => isNonAttackAction(ctx, card)) ? 1 : 0);
    },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("nonAttackPitched")) {
        const amount = ctx.previewArcaneDamage(1);
        ctx.requestCardChoice(
          "slash-target",
          decisionPrompt(
            `Deal ${amount} arcane damage to any target`,
            "card.dyn.aetherslash.target.choose",
            { values: { amount } },
          ),
          anyTargets(ctx),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "slash-target") dealToAnyTarget(ctx, option, 1, true);
    },
  };
}

function deathlyDuet(): CardScript {
  return {
    onPlayCostPaid(ctx, paid) {
      ctx.setCounter("attackPitched", paid.some((card) => isAttackAction(ctx, card)) ? 1 : 0);
      ctx.setCounter("nonAttackPitched", paid.some((card) => isNonAttackAction(ctx, card)) ? 1 : 0);
    },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("attackPitched")) ctx.addModifier({ scope: "chain-link", attack: 2 });
      if (ctx.getCounter("nonAttackPitched")) createTokens(ctx, RUNECHANT, 2);
    },
  };
}

function runicReaping(count: number): CardScript {
  return {
    onPlayCostPaid(ctx, paid) {
      ctx.setCounter("attackPitched", paid.some((card) => isAttackAction(ctx, card)) ? 1 : 0);
    },
    onPlay(ctx) {
      buffNextAttack(ctx, {
        appliesTo: "attack-action",
        appliesToClass: "runeblade",
        attack: ctx.getCounter("attackPitched") ? 1 : 0,
        onHitCreateToken: { cardId: RUNECHANT, count },
      });
    },
  };
}

function tranquilPassing(maxCost: number): CardScript {
  return {
    onEnterArena(ctx) {
      const targets = ctx.player(opponentSeat(ctx)).board.filter((card) => {
        const d = data(ctx, card);
        return hasType(ctx, card, "aura") && (d.cost ?? 0) <= maxCost;
      });
      if (targets.length) ctx.requestCardChoice(
        "tranquil",
        decisionPrompt(
          "Banish an opposing aura until this leaves",
          "card.dyn.tranquil.aura.banish",
          { optionMessages: commonOptionMessages("pass") },
        ),
        ["pass", ...targets.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "tranquil" || option === "pass") return;
      ctx.setCounter("tranquilTarget", Number(option));
      ctx.banish(Number(option));
    },
    onLeaveArena(ctx) {
      const target = ctx.getCounter("tranquilTarget");
      if (target) ctx.settleCard(target, { allowCrank: false });
    },
  };
}

export const dyn: Record<string, CardScript> = mergeSetScripts("DYN", dynHighRarity, {
  // Its Construct target is outside this C/R import; keeping Material here
  // avoids treating its +1 power grant as vanilla behavior.
  "galvanic bender|0": {},

  // Heroes
  "arakni|0": {
    triggers: [{
      event: "card-played",
      label: "Look at the opponent's top card?",
      optional: true,
      defaultOption: "yes",
      condition: (ctx, played) => !!played &&
        (data(ctx, played).keywords ?? []).some((keyword) => keyword.toLowerCase() === "contract"),
      effect(ctx) {
        const top = ctx.player(opponentSeat(ctx)).deck[0];
        if (!top) return;
        ctx.lookAt(top.instanceId);
        ctx.setCounter("arakniTop", top.instanceId);
        ctx.requestChoice("arakni-top", bottomOrKeepPrompt(), ["bottom", "keep"]);
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "arakni-top" && option === "bottom") ctx.putOnDeckBottom(ctx.getCounter("arakniTop"));
    },
  },
  "emperor, dracai of aesir|0": {
    activated: {
      cost: 3, isAttack: false, goAgain: false, label: "Search for Command and Conquer",
      onActivate(ctx) {
        const card = ctx.player(ctx.seat).deck.find((candidate) => data(ctx, candidate).name === "Command and Conquer");
        if (card) {
          ctx.logPrivate(ctx.seat, "Emperor finds Command and Conquer", "Emperor searches for a card");
          ctx.attackFromDeck(card.instanceId);
        }
        ctx.shuffleDeck();
      },
    },
  },
  "yoji, royal protector|0": {
    activated: {
      cost: 3, isAttack: false, goAgain: false, oncePerTurn: true, timing: "instant", label: "Protect another hero",
      onActivate(ctx) {
        ctx.redirectNextHeroDamage(opponentSeat(ctx), ctx.seat, 1);
      },
    },
  },

  // Brute
  "reincarnate|1": {
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Put this on the bottom of its owner's deck",
      condition: (ctx, discarded, eventContext) =>
        eventContext?.atRandom === true && discarded?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.putOnDeckBottom(ctx.self.instanceId),
    }],
  },
  "reincarnate|2": {
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Put this on the bottom of its owner's deck",
      condition: (ctx, discarded, eventContext) =>
        eventContext?.atRandom === true && discarded?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.putOnDeckBottom(ctx.self.instanceId),
    }],
  },
  "madcap charger|1": randomDiscardAttack("go-again"),
  "madcap charger|2": randomDiscardAttack("go-again"),
  "madcap charger|3": randomDiscardAttack("go-again"),
  "madcap muscle|1": randomDiscardAttack("power"),
  "madcap muscle|2": randomDiscardAttack("power"),
  "madcap muscle|3": randomDiscardAttack("power"),
  "rumble grunting|1": { canPlay: (ctx) => ctx.getFlag("player", "discardedSixPlusThisTurn") === true, onPlay: (ctx) => buffNextAttack(ctx, { appliesTo: "attack", appliesToClass: "brute", attack: 4 }) },
  "rumble grunting|2": { canPlay: (ctx) => ctx.getFlag("player", "discardedSixPlusThisTurn") === true, onPlay: (ctx) => buffNextAttack(ctx, { appliesTo: "attack", appliesToClass: "brute", attack: 3 }) },
  "rumble grunting|3": { canPlay: (ctx) => ctx.getFlag("player", "discardedSixPlusThisTurn") === true, onPlay: (ctx) => buffNextAttack(ctx, { appliesTo: "attack", appliesToClass: "brute", attack: 2 }) },
  "blessing of savagery|1": blessing((ctx) => buffNextAttack(ctx, { appliesTo: "attack", minBasePower: 6, attack: 3 })),
  "blessing of savagery|2": blessing((ctx) => buffNextAttack(ctx, { appliesTo: "attack", minBasePower: 6, attack: 2 })),
  "blessing of savagery|3": blessing((ctx) => buffNextAttack(ctx, { appliesTo: "attack", minBasePower: 6, attack: 1 })),

  // Guardian
  "blessing of patience|1": { ...blessing((ctx) => chooseHero(ctx, "patience", "Choose a hero to gain 3 life", "card.dyn.patience.hero.choose", { amount: 3 })), onChoose(ctx, h, o) { if (h === "patience") ctx.gainLife(heroSeat(ctx, o), 3); } },
  "blessing of patience|2": { ...blessing((ctx) => chooseHero(ctx, "patience", "Choose a hero to gain 2 life", "card.dyn.patience.hero.choose", { amount: 2 })), onChoose(ctx, h, o) { if (h === "patience") ctx.gainLife(heroSeat(ctx, o), 2); } },
  "blessing of patience|3": { ...blessing((ctx) => chooseHero(ctx, "patience", "Choose a hero to gain 1 life", "card.dyn.patience.hero.choose", { amount: 1 })), onChoose(ctx, h, o) { if (h === "patience") ctx.gainLife(heroSeat(ctx, o), 1); } },
  "shield bash|1": { onPlay(ctx) { const offhand = ctx.link?.defendingEquipment.some((card) => hasType(ctx, card, "off-hand")); if (!offhand) return; const hand = ctx.player(opponentSeat(ctx)).hand; ctx.requestCardChoice("shield-bash", decisionPrompt("Discard a card or take 1 damage", "card.dyn.shieldbash.discard", { optionMessages: commonOptionMessages("take damage") }), ["take damage", ...hand.map((card) => card.instanceId)], opponentSeat(ctx)); }, onChoose(ctx, h, o) { if (h !== "shield-bash") return; if (o === "take damage") ctx.dealDamage(opponentSeat(ctx), 1); else ctx.discardCard(opponentSeat(ctx), Number(o)); } },
  "shield bash|2": { onPlay(ctx) { const offhand = ctx.link?.defendingEquipment.some((card) => hasType(ctx, card, "off-hand")); if (!offhand) return; const hand = ctx.player(opponentSeat(ctx)).hand; ctx.requestCardChoice("shield-bash", decisionPrompt("Discard a card or take 1 damage", "card.dyn.shieldbash.discard", { optionMessages: commonOptionMessages("take damage") }), ["take damage", ...hand.map((card) => card.instanceId)], opponentSeat(ctx)); }, onChoose(ctx, h, o) { if (h !== "shield-bash") return; if (o === "take damage") ctx.dealDamage(opponentSeat(ctx), 1); else ctx.discardCard(opponentSeat(ctx), Number(o)); } },
  "shield bash|3": { onPlay(ctx) { const offhand = ctx.link?.defendingEquipment.some((card) => hasType(ctx, card, "off-hand")); if (!offhand) return; const hand = ctx.player(opponentSeat(ctx)).hand; ctx.requestCardChoice("shield-bash", decisionPrompt("Discard a card or take 1 damage", "card.dyn.shieldbash.discard", { optionMessages: commonOptionMessages("take damage") }), ["take damage", ...hand.map((card) => card.instanceId)], opponentSeat(ctx)); }, onChoose(ctx, h, o) { if (h !== "shield-bash") return; if (o === "take damage") ctx.dealDamage(opponentSeat(ctx), 1); else ctx.discardCard(opponentSeat(ctx), Number(o)); } },
  "shield wall|1": { modifyDefense: (ctx) => Object.values(ctx.player(ctx.seat).equipment).some((card) => card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand")) ? 4 : 0 },
  "shield wall|2": { modifyDefense: (ctx) => Object.values(ctx.player(ctx.seat).equipment).some((card) => card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand")) ? 4 : 0 },
  "shield wall|3": { modifyDefense: (ctx) => Object.values(ctx.player(ctx.seat).equipment).some((card) => card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand")) ? 4 : 0 },
  "reinforce steel|1": { onPlay(ctx) { const choices = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand") && (data(ctx, card).defense ?? 0) <= 3 && (card.defCounters ?? 0) > 0); if (choices.length) ctx.requestCardChoice("reinforce", decisionPrompt("Remove a -1 defense counter", "card.dyn.reinforce.counter.remove"), choices.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "reinforce") ctx.addCardDefenseCounters(Number(o), -1); } },
  "reinforce steel|2": { onPlay(ctx) { const choices = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand") && (data(ctx, card).defense ?? 0) <= 2 && (card.defCounters ?? 0) > 0); if (choices.length) ctx.requestCardChoice("reinforce", decisionPrompt("Remove a -1 defense counter", "card.dyn.reinforce.counter.remove"), choices.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "reinforce") ctx.addCardDefenseCounters(Number(o), -1); } },
  "reinforce steel|3": { onPlay(ctx) { const choices = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand") && (data(ctx, card).defense ?? 0) <= 1 && (card.defCounters ?? 0) > 0); if (choices.length) ctx.requestCardChoice("reinforce", decisionPrompt("Remove a -1 defense counter", "card.dyn.reinforce.counter.remove"), choices.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "reinforce") ctx.addCardDefenseCounters(Number(o), -1); } },
  "withstand|1": { onPlay(ctx) { const choices = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand")); if (choices.length) ctx.requestCardChoice("withstand", decisionPrompt("Choose a Guardian off-hand", "card.dyn.withstand.offhand.choose"), choices.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "withstand") ctx.addCardTempDefense(Number(o), 6); } },
  "withstand|2": { onPlay(ctx) { const choices = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand")); if (choices.length) ctx.requestCardChoice("withstand", decisionPrompt("Choose a Guardian off-hand", "card.dyn.withstand.offhand.choose"), choices.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "withstand") ctx.addCardTempDefense(Number(o), 5); } },
  "withstand|3": { onPlay(ctx) { const choices = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && hasType(ctx, card, "guardian") && hasType(ctx, card, "off-hand")); if (choices.length) ctx.requestCardChoice("withstand", decisionPrompt("Choose a Guardian off-hand", "card.dyn.withstand.offhand.choose"), choices.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "withstand") ctx.addCardTempDefense(Number(o), 4); } },

  // Ninja
  "flex claws|1": { onHit(ctx) { createTiger(ctx); } },
  "flex claws|2": { onHit(ctx) { createTiger(ctx); } },
  "flex claws|3": { onHit(ctx) { createTiger(ctx); } },
  "blessing of qi|1": blessing((ctx) => createTiger(ctx, 3)),
  "blessing of qi|2": blessing((ctx) => createTiger(ctx, 2)),
  "blessing of qi|3": blessing((ctx) => createTiger(ctx, 1)),
  "pouncing qi|1": pouncingQi(),
  "pouncing qi|2": pouncingQi(),
  "pouncing qi|3": pouncingQi(),
  "qi unleashed|1": qiUnleashed(),
  "qi unleashed|2": qiUnleashed(),
  "qi unleashed|3": qiUnleashed(),
  "predatory streak|1": { onPlay(ctx) { createTiger(ctx); createTiger(ctx); createTiger(ctx); } },
  "predatory streak|2": { onPlay(ctx) { createTiger(ctx); createTiger(ctx); } },
  "predatory streak|3": { onPlay(ctx) { createTiger(ctx); } },

  // Warrior
  "quicksilver dagger|0": { activated: attackAbility(1), onAttackDeclared(ctx) { if (ctx.player(ctx.seat).weapons.some((weapon) => weapon.instanceId !== ctx.self.instanceId && ctx.getFlag("player", `weaponGainedGoAgain:${weapon.instanceId}`) === true)) ctx.grantGoAgain(); } },
  "blessing of steel|1": blessing((ctx) => buffNextAttack(ctx, { appliesTo: "weapon", attack: 3 })),
  "blessing of steel|2": blessing((ctx) => buffNextAttack(ctx, { appliesTo: "weapon", attack: 2 })),
  "blessing of steel|3": blessing((ctx) => buffNextAttack(ctx, { appliesTo: "weapon", attack: 1 })),
  "precision press|1": { onPlay(ctx) { buffNextAttack(ctx, { appliesToSubtype: ["sword", "dagger"], goAgain: true, piercing: 3 }); } },
  "precision press|2": { onPlay(ctx) { buffNextAttack(ctx, { appliesToSubtype: ["sword", "dagger"], goAgain: true, piercing: 2 }); } },
  "precision press|3": { onPlay(ctx) { buffNextAttack(ctx, { appliesToSubtype: ["sword", "dagger"], goAgain: true, piercing: 1 }); } },
  "puncture|2": { canPlay: (ctx) => !!ctx.link && ["sword", "dagger"].some((type) => ctx.currentAttackHasType(type)), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 2, piercing: 1 }); } },
  "felling swing|1": { onPlay(ctx) { buffNextAttack(ctx, { appliesToSubtype: "axe", attack: 6 }); } },
  "felling swing|2": { onPlay(ctx) { buffNextAttack(ctx, { appliesToSubtype: "axe", attack: 5 }); } },
  "felling swing|3": { onPlay(ctx) { buffNextAttack(ctx, { appliesToSubtype: "axe", attack: 4 }); } },
  "visit the imperial forge|1": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", appliesToSubtype: ["sword", "dagger"], piercing: 3 }); } },
  "visit the imperial forge|2": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", appliesToSubtype: ["sword", "dagger"], piercing: 2 }); } },
  "visit the imperial forge|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", appliesToSubtype: ["sword", "dagger"], piercing: 1 }); } },

  // Mechanologist
  "crankshaft|2": crankshaft(),
  "hyper driver|2": hyperDriver(2),
  "hyper driver|3": hyperDriver(1),
  "scramble pulse|1": { modifyDefendingEquipmentDefense: () => -1 },
  "scramble pulse|2": { modifyDefendingEquipmentDefense: () => -1 },
  "scramble pulse|3": { modifyDefendingEquipmentDefense: () => -1 },
  "blessing of ingenuity|1": blessingIngenuity(3),
  "blessing of ingenuity|2": blessingIngenuity(2),
  "blessing of ingenuity|3": blessingIngenuity(1),
  "urgent delivery|1": { onHit(ctx) { const boosts = ctx.state.chain.filter((link) => link.attacker === ctx.seat && link.flags.boosted).length; const items = ctx.player(ctx.seat).hand.filter((card) => hasType(ctx, card, "mechanologist") && hasType(ctx, card, "item") && (data(ctx, card).cost ?? 0) <= boosts); if (items.length) ctx.requestCardChoice("delivery", decisionPrompt("Put a Mechanologist item into the arena", "card.dyn.delivery.item.put", { optionMessages: commonOptionMessages("pass") }), ["pass", ...items.map((card) => card.instanceId)]); }, onChoose(ctx, h, o) { if (h === "delivery" && o !== "pass") ctx.settleCard(Number(o)); } },
  "urgent delivery|2": { onHit(ctx) { const boosts = ctx.state.chain.filter((link) => link.attacker === ctx.seat && link.flags.boosted).length; const items = ctx.player(ctx.seat).hand.filter((card) => hasType(ctx, card, "mechanologist") && hasType(ctx, card, "item") && (data(ctx, card).cost ?? 0) <= boosts); if (items.length) ctx.requestCardChoice("delivery", decisionPrompt("Put a Mechanologist item into the arena", "card.dyn.delivery.item.put", { optionMessages: commonOptionMessages("pass") }), ["pass", ...items.map((card) => card.instanceId)]); }, onChoose(ctx, h, o) { if (h === "delivery" && o !== "pass") ctx.settleCard(Number(o)); } },
  "urgent delivery|3": { onHit(ctx) { const boosts = ctx.state.chain.filter((link) => link.attacker === ctx.seat && link.flags.boosted).length; const items = ctx.player(ctx.seat).hand.filter((card) => hasType(ctx, card, "mechanologist") && hasType(ctx, card, "item") && (data(ctx, card).cost ?? 0) <= boosts); if (items.length) ctx.requestCardChoice("delivery", decisionPrompt("Put a Mechanologist item into the arena", "card.dyn.delivery.item.put", { optionMessages: commonOptionMessages("pass") }), ["pass", ...items.map((card) => card.instanceId)]); }, onChoose(ctx, h, o) { if (h === "delivery" && o !== "pass") ctx.settleCard(Number(o)); } },

  // Assassin
  "annihilate the armed|1": contractAttack(contractAttackAction),
  "annihilate the armed|2": contractAttack(contractAttackAction),
  "annihilate the armed|3": contractAttack(contractAttackAction),
  "fleece the frail|1": contractAttack(contractLowDefense),
  "fleece the frail|2": contractAttack(contractLowDefense),
  "fleece the frail|3": contractAttack(contractLowDefense),
  "nix the nimble|1": contractAttack(contractReaction),
  "nix the nimble|2": contractAttack(contractReaction),
  "nix the nimble|3": contractAttack(contractReaction),
  "plunder the poor|1": contractAttack(contractLowCost),
  "plunder the poor|2": contractAttack(contractLowCost),
  "plunder the poor|3": contractAttack(contractLowCost),
  "rob the rich|1": contractAttack(contractHighCost),
  "rob the rich|2": contractAttack(contractHighCost),
  "rob the rich|3": contractAttack(contractHighCost),
  "sack the shifty|1": contractAttack(contractGoAgain),
  "sack the shifty|2": contractAttack(contractGoAgain),
  "sack the shifty|3": contractAttack(contractGoAgain),
  "slay the scholars|1": contractAttack(contractNonAttack),
  "slay the scholars|2": contractAttack(contractNonAttack),
  "slay the scholars|3": contractAttack(contractNonAttack),
  "cut to the chase|1": { canPlay: (ctx) => !!ctx.link && hasType(ctx, ctx.link.attackingCard, "assassin") && (data(ctx, ctx.link.attackingCard).keywords ?? []).some((keyword) => keyword.toLowerCase() === "contract"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3 }); const top = ctx.player(opponentSeat(ctx)).deck[0]; if (top) { ctx.lookAt(top.instanceId); ctx.setCounter("cutTop", top.instanceId); ctx.requestChoice("cut-top", bottomOrKeepPrompt(), ["bottom", "keep"]); } }, onChoose(ctx, h, o) { if (h === "cut-top" && o === "bottom") ctx.putOnDeckBottom(ctx.getCounter("cutTop")); } },
  "cut to the chase|2": { canPlay: (ctx) => !!ctx.link && hasType(ctx, ctx.link.attackingCard, "assassin") && (data(ctx, ctx.link.attackingCard).keywords ?? []).some((keyword) => keyword.toLowerCase() === "contract"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 2 }); const top = ctx.player(opponentSeat(ctx)).deck[0]; if (top) { ctx.lookAt(top.instanceId); ctx.setCounter("cutTop", top.instanceId); ctx.requestChoice("cut-top", bottomOrKeepPrompt(), ["bottom", "keep"]); } }, onChoose(ctx, h, o) { if (h === "cut-top" && o === "bottom") ctx.putOnDeckBottom(ctx.getCounter("cutTop")); } },
  "cut to the chase|3": { canPlay: (ctx) => !!ctx.link && hasType(ctx, ctx.link.attackingCard, "assassin") && (data(ctx, ctx.link.attackingCard).keywords ?? []).some((keyword) => keyword.toLowerCase() === "contract"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); const top = ctx.player(opponentSeat(ctx)).deck[0]; if (top) { ctx.lookAt(top.instanceId); ctx.setCounter("cutTop", top.instanceId); ctx.requestChoice("cut-top", bottomOrKeepPrompt(), ["bottom", "keep"]); } }, onChoose(ctx, h, o) { if (h === "cut-top" && o === "bottom") ctx.putOnDeckBottom(ctx.getCounter("cutTop")); } },
  "shred|1": { canPlay: (ctx) => !!ctx.link && hasType(ctx, ctx.link.attackingCard, "assassin") && [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0, onPlay(ctx) { const defenders = [...(ctx.link?.defendingCards ?? []), ...(ctx.link?.defendingEquipment ?? [])]; ctx.requestCardChoice("shred", decisionPrompt("Choose a defending card", "card.dyn.shred.defender.choose"), defenders.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "shred") ctx.addCardTempDefense(Number(o), -4); } },
  "shred|2": { canPlay: (ctx) => !!ctx.link && hasType(ctx, ctx.link.attackingCard, "assassin") && [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].length > 0, onPlay(ctx) { const defenders = [...(ctx.link?.defendingCards ?? []), ...(ctx.link?.defendingEquipment ?? [])]; ctx.requestCardChoice("shred", decisionPrompt("Choose a defending card", "card.dyn.shred.defender.choose"), defenders.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "shred") ctx.addCardTempDefense(Number(o), -3); } },
  "spider's bite|0": { activated: attackAbility(2, { goAgain: true }), canTriggerOnHit(ctx) { return !!ctx.link && ctx.link.targetAllyId === undefined && ctx.link.attackingCard.instanceId === ctx.self.instanceId; }, onHit(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), defense: -1, appliesToCardType: "action", appliesToSubtype: "attack", once: true }); }, onEffectHit(ctx, targetSeat) { ctx.addModifier({ scope: "until-end-of-turn", seat: targetSeat, defense: -1, appliesToCardType: "action", appliesToSubtype: "attack", once: true }); } },

  // Ranger
  "blessing of focus|1": blessingFocus(3),
  "blessing of focus|2": blessingFocus(2),
  "blessing of focus|3": blessingFocus(1),
  "drill shot|2": drillShot(),
  "drill shot|3": drillShot(),
  "hemorrhage bore|1": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && aimCounter(ctx); }, onHit(ctx) { const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0]; if (arsenal) ctx.moveToGraveyard(arsenal.instanceId, "arsenal"); } },
  "hemorrhage bore|2": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && aimCounter(ctx); }, onHit(ctx) { const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0]; if (arsenal) ctx.moveToGraveyard(arsenal.instanceId, "arsenal"); } },
  "hemorrhage bore|3": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && aimCounter(ctx); }, onHit(ctx) { const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0]; if (arsenal) ctx.moveToGraveyard(arsenal.instanceId, "arsenal"); } },
  "long shot|1": { modifyAttack: (ctx) => aimCounter(ctx) ? 2 : 0 },
  "long shot|2": { modifyAttack: (ctx) => aimCounter(ctx) ? 2 : 0 },
  "long shot|3": { modifyAttack: (ctx) => aimCounter(ctx) ? 2 : 0 },
  "point the tip|1": { onPlay(ctx) { const arrows = ctx.player(ctx.seat).arsenal.filter((card) => !card.faceDown && hasType(ctx, card, "arrow")); if (arrows.length) ctx.requestCardChoice("point", decisionPrompt("Choose a face-up arrow", "card.dyn.point.arrow.choose"), arrows.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "point") { ctx.addCardTempPower(Number(o), 3); ctx.addCounter(Number(o), "aim", 1); } } },
  "point the tip|2": { onPlay(ctx) { const arrows = ctx.player(ctx.seat).arsenal.filter((card) => !card.faceDown && hasType(ctx, card, "arrow")); if (arrows.length) ctx.requestCardChoice("point", decisionPrompt("Choose a face-up arrow", "card.dyn.point.arrow.choose"), arrows.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "point") { ctx.addCardTempPower(Number(o), 2); ctx.addCounter(Number(o), "aim", 1); } } },
  "point the tip|3": { onPlay(ctx) { const arrows = ctx.player(ctx.seat).arsenal.filter((card) => !card.faceDown && hasType(ctx, card, "arrow")); if (arrows.length) ctx.requestCardChoice("point", decisionPrompt("Choose a face-up arrow", "card.dyn.point.arrow.choose"), arrows.map((card) => card.instanceId)); }, onChoose(ctx, h, o) { if (h === "point") { ctx.addCardTempPower(Number(o), 1); ctx.addCounter(Number(o), "aim", 1); } } },
  "hornet's sting|0": { onDefend(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (!top) return; ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`); if (hasType(ctx, top, "arrow")) { const targets = [ctx.player(opponentSeat(ctx)).hero.instanceId]; if (ctx.link?.attackCardType === "ally") targets.push(ctx.link.attackingCard.instanceId); ctx.requestCardChoice("hornet", decisionPrompt("Deal 1 damage to the attacking hero or ally", "card.dyn.hornet.target.choose"), targets); } else ctx.putOnDeckBottom(top.instanceId); }, onChoose(ctx, h, o) { if (h === "hornet") dealToAnyTarget(ctx, o, 1); } },

  // Runeblade
  "annals of sutcliffe|0": { activated: { cost: 3, isAttack: false, goAgain: true, oncePerTurn: true, label: "Draw a card", onCostPaid(ctx, paid) { ctx.setCounter("annalsAttack", paid.some((card) => isAttackAction(ctx, card)) ? 1 : 0); ctx.setCounter("annalsNonAttack", paid.some((card) => isNonAttackAction(ctx, card)) ? 1 : 0); }, onActivate(ctx) { ctx.drawCards(ctx.seat, 1); if (ctx.getCounter("annalsAttack") && ctx.getCounter("annalsNonAttack")) ctx.createToken(RUNECHANT); } } },
  "aether slash|1": aetherSlash(),
  "aether slash|2": aetherSlash(),
  "aether slash|3": aetherSlash(),
  "deathly duet|1": deathlyDuet(),
  "deathly duet|2": deathlyDuet(),
  "deathly duet|3": deathlyDuet(),
  "runic reaping|1": runicReaping(3),
  "runic reaping|2": runicReaping(2),
  "runic reaping|3": runicReaping(1),
  "blessing of occult|1": blessing((ctx) => createTokens(ctx, RUNECHANT, 3)),
  "blessing of occult|2": blessing((ctx) => createTokens(ctx, RUNECHANT, 2)),
  "blessing of occult|3": blessing((ctx) => createTokens(ctx, RUNECHANT, 1)),
  "sky fire lanterns|1": { onPlay(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`); if (ctx.cardColor(top) === 1) ctx.createToken(RUNECHANT); } } },
  "sky fire lanterns|2": { onPlay(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`); if (ctx.cardColor(top) === 2) ctx.createToken(RUNECHANT); } } },
  "sky fire lanterns|3": { onPlay(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`); if (ctx.cardColor(top) === 3) ctx.createToken(RUNECHANT); } } },

  // Wizard
  "aether quickening|1": arcaneTargetSpell(4, "go-again"),
  "aether quickening|2": arcaneTargetSpell(3, "go-again"),
  "prognosticate|1": arcaneTargetSpell(3, "opt"),
  "prognosticate|2": arcaneTargetSpell(2, "opt"),
  "prognosticate|3": arcaneTargetSpell(1, "opt"),
  "sap|1": arcaneTargetSpell(3, "energy"),
  "sap|2": arcaneTargetSpell(2, "energy"),
  "sap|3": arcaneTargetSpell(1, "energy"),
  "blessing of aether|1": blessing((ctx) => buffNextArcaneDamageCard(ctx, 3)),
  "blessing of aether|2": blessing((ctx) => buffNextArcaneDamageCard(ctx, 2)),
  "blessing of aether|3": blessing((ctx) => buffNextArcaneDamageCard(ctx, 1)),
  "tempest aurora|1": { onPlay(ctx) { ctx.setCounter("auroraMax", 2); ctx.addModifier({ scope: "until-end-of-turn" }); }, onFriendlyPlay(ctx, played) { if (ctx.getCounter("auroraMax") < 0 || (data(ctx, played).cost ?? 0) > ctx.getCounter("auroraMax") || !data(ctx, played).text.toLowerCase().includes("arcane damage")) return; ctx.addCounter(played.instanceId, "arcaneBonus", 1); ctx.setCounter("auroraMax", -1); const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && !modifier.consumed); if (marker) ctx.consumeModifier(marker.id); } },
  "tempest aurora|2": { onPlay(ctx) { ctx.setCounter("auroraMax", 1); ctx.addModifier({ scope: "until-end-of-turn" }); }, onFriendlyPlay(ctx, played) { if (ctx.getCounter("auroraMax") < 0 || (data(ctx, played).cost ?? 0) > ctx.getCounter("auroraMax") || !data(ctx, played).text.toLowerCase().includes("arcane damage")) return; ctx.addCounter(played.instanceId, "arcaneBonus", 1); ctx.setCounter("auroraMax", -1); const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && !modifier.consumed); if (marker) ctx.consumeModifier(marker.id); } },
  "tempest aurora|3": { onPlay(ctx) { ctx.setCounter("auroraMax", 0); ctx.addModifier({ scope: "until-end-of-turn" }); }, onFriendlyPlay(ctx, played) { if (ctx.getCounter("auroraMax") < 0 || (data(ctx, played).cost ?? 0) > ctx.getCounter("auroraMax") || !data(ctx, played).text.toLowerCase().includes("arcane damage")) return; ctx.addCounter(played.instanceId, "arcaneBonus", 1); ctx.setCounter("auroraMax", -1); const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && !modifier.consumed); if (marker) ctx.consumeModifier(marker.id); } },
  "seerstone|0": { activated: { cost: 3, isAttack: false, goAgain: false, label: "Look at the top card and create Ponder", onActivate(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.lookAt(top.instanceId); ctx.setCounter("seerTop", top.instanceId); ctx.requestChoice("seerstone", bottomOrKeepPrompt(), ["bottom", "keep"]); } else ctx.createToken("DYN244"); } }, onChoose(ctx, h, o) { if (h !== "seerstone") return; if (o === "bottom") ctx.putOnDeckBottom(ctx.getCounter("seerTop")); ctx.createToken("DYN244"); } },

  // Illusionist
  "blessing of spirits|1": blessing((ctx) => createTokens(ctx, SPECTRAL_SHIELD, 3)),
  "blessing of spirits|2": blessing((ctx) => createTokens(ctx, SPECTRAL_SHIELD, 2)),
  "blessing of spirits|3": blessing((ctx) => createTokens(ctx, SPECTRAL_SHIELD, 1)),
  "spectral prowler|1": spectralProwler(),
  "spectral prowler|2": spectralProwler(),
  "spectral prowler|3": spectralProwler(),
  "spectral rider|1": spectralRider(),
  "spectral rider|2": spectralRider(),
  "tranquil passing|1": tranquilPassing(3),
  "tranquil passing|2": tranquilPassing(2),
  "tranquil passing|3": tranquilPassing(1),
  "water glow lanterns|1": { onPlay(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`); if (ctx.cardColor(top) === 1) ctx.createToken(SPECTRAL_SHIELD); } } },
  "water glow lanterns|2": { onPlay(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`); if (ctx.cardColor(top) === 2) ctx.createToken(SPECTRAL_SHIELD); } } },
  "water glow lanterns|3": { onPlay(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`); if (ctx.cardColor(top) === 3) ctx.createToken(SPECTRAL_SHIELD); } } },
  "wave of reality|0": { onDestroyed(ctx) { ctx.createToken(SPECTRAL_SHIELD); } },

  // Generic
  "ornate tessen|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, label: "Cycle a hand card", onActivate(ctx) { const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("tessen", decisionPrompt("Put a hand card on the bottom", "card.dyn.tessen.hand.bottom"), hand.map((card) => card.instanceId)); } }, onChoose(ctx, h, o) { if (h === "tessen" && ctx.putOnDeckBottom(Number(o))) ctx.drawCards(ctx.seat, 1); } },
});
