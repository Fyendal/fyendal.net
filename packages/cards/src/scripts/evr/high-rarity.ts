import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, commonOptionMessages, decisionMessage, decisionPrompt, opponentSeat, previousAttackHasName, yesNoPrompt } from "../shared-helpers.js";

const SEISMIC_SURGE = "CRU044";
const FROSTBITE = "SIY035";
const RUNECHANT = "EVR119";
const SILVER = "EVR195";
const QUICKEN = "EVR196";

function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function weapon(cost: number, extra: CardScript = {}): CardScript {
  return { ...extra, activated: { cost, isAttack: true, goAgain: false, oncePerTurn: true } };
}

function elementalRevealOptions(ctx: ScriptCtx): string[] {
  const hand = ctx.player(ctx.seat).hand;
  const earth = hand.filter((card) => hasType(ctx, card, "earth"));
  const ice = hand.filter((card) => hasType(ctx, card, "ice"));
  const lightning = hand.filter((card) => hasType(ctx, card, "lightning"));
  const options = new Set<string>();
  for (const a of earth) for (const b of ice) for (const c of lightning) {
    if (new Set([a.instanceId, b.instanceId, c.instanceId]).size === 3) {
      options.add(`${a.instanceId}:${b.instanceId}:${c.instanceId}`);
    }
  }
  return [...options];
}

function elementalRevealOptionMessages(ctx: ScriptCtx): Record<string, ReturnType<typeof decisionMessage>> {
  const hand = ctx.player(ctx.seat).hand;
  return Object.fromEntries(elementalRevealOptions(ctx).flatMap((option) => {
    const [earthId, iceId, lightningId] = option.split(":").map(Number);
    const earth = hand.find((card) => card.instanceId === earthId);
    const ice = hand.find((card) => card.instanceId === iceId);
    const lightning = hand.find((card) => card.instanceId === lightningId);
    return earth && ice && lightning ? [[option, decisionMessage("card.evr.bravo.option.reveal", {
      earth: { kind: "card", cardId: earth.cardId },
      ice: { kind: "card", cardId: ice.cardId },
      lightning: { kind: "card", cardId: lightning.cardId },
    })]] : [];
  }));
}

function illusionistAttacksOnChain(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return ctx.state.chain.flatMap((link) => [link.attackingCard, ...link.defendingCards])
    .filter((card) => {
      if (card.instanceId === ctx.self.instanceId) return false;
      return ctx.hasCardType(card, "action") &&
        hasType(ctx, card, "attack") &&
        hasType(ctx, card, "illusionist");
    });
}

const fractalReplication: CardScript = {
  triggers: [{
    event: "card-played",
    sourceZone: "self",
    label: "Gain the base abilities of Illusionist attacks on the combat chain",
    effect(ctx) {
      for (const source of illusionistAttacksOnChain(ctx)) {
        ctx.grantBaseAbilities(ctx.self.instanceId, source.cardId);
      }
    },
  }],
  onDefend(ctx) {
    for (const source of illusionistAttacksOnChain(ctx)) {
      ctx.grantBaseAbilities(ctx.self.instanceId, source.cardId);
    }
  },
  modifyAttack(ctx) {
    const greatest = Math.max(0, ...illusionistAttacksOnChain(ctx).map((card) => ctx.basePower(card)));
    return greatest - (ctx.data.attack ?? 0);
  },
  modifyDefense(ctx) {
    const greatest = Math.max(0, ...illusionistAttacksOnChain(ctx).map((card) => ctx.cardData(card.cardId).defense ?? 0));
    return greatest - (ctx.data.defense ?? 0);
  },
};

function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return ctx.cardNames(card).includes(name.toLowerCase());
}

const BLOOD_MODES = ["power", "go-again", "extra-attack"] as const;
type BloodMode = typeof BLOOD_MODES[number];

function bloodWeapons(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).weapons.filter((card) => hasType(ctx, card, "1h"));
}

function bloodAllocationKey(mode: BloodMode, weaponId: number): string {
  return `bloodAllocation:${mode}:${weaponId}`;
}

function bloodModeTotal(ctx: ScriptCtx, mode: BloodMode): number {
  return bloodWeapons(ctx).reduce(
    (total, weapon) => total + ctx.getCounter(bloodAllocationKey(mode, weapon.instanceId)),
    0,
  );
}

function bloodSelectedTotal(ctx: ScriptCtx): number {
  return BLOOD_MODES.reduce((total, mode) => total + bloodModeTotal(ctx, mode), 0);
}

function requestBloodMode(ctx: ScriptCtx): void {
  const required = ctx.getCounter("bloodPaid");
  if (required <= 0) return;
  const selected = bloodSelectedTotal(ctx);
  const options: string[] = [];
  const cardOptions: Array<number | null> = [];
  const optionMessages: Record<string, ReturnType<typeof decisionMessage>> = {};
  for (const weapon of bloodWeapons(ctx)) {
    for (const mode of BLOOD_MODES) {
      const count = ctx.getCounter(bloodAllocationKey(mode, weapon.instanceId));
      for (const operation of ["decrement", "increment"] as const) {
        const value = `blood-mode:${operation}:${mode}:${weapon.instanceId}:${count}:${selected}:${required}`;
        options.push(value);
        cardOptions.push(weapon.instanceId);
        optionMessages[value] = decisionMessage(`card.evr.blood.option.${operation}.${mode.replaceAll("-", "")}`, { card: { kind: "card", cardId: weapon.cardId }, amount: count });
      }
    }
  }
  const confirmation = `blood-mode:confirm:${selected}:${required}`;
  options.push(confirmation);
  cardOptions.push(null);
  optionMessages[confirmation] = decisionMessage("card.evr.blood.option.confirm", { selected, required });
  ctx.requestChoice(
    "blood-mode",
    decisionPrompt(`Assign ${required} Blood on Her Hands ${required === 1 ? "mode" : "modes"}`, "card.evr.blood.modes.assign", { values: { amount: required }, optionMessages }),
    options,
    undefined,
    cardOptions,
  );
}

function applyBloodAllocation(ctx: ScriptCtx): void {
  for (const weapon of bloodWeapons(ctx)) {
    const weaponId = weapon.instanceId;
    const power = ctx.getCounter(bloodAllocationKey("power", weaponId));
    const goAgain = ctx.getCounter(bloodAllocationKey("go-again", weaponId));
    const extraAttacks = ctx.getCounter(bloodAllocationKey("extra-attack", weaponId));
    if (power > 0) {
      ctx.addModifier({ scope: "until-end-of-turn", attack: power, appliesTo: "weapon", appliesToInstanceId: weaponId });
    }
    if (goAgain > 0) {
      ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesTo: "weapon", appliesToInstanceId: weaponId });
    }
    if (extraAttacks > 0) {
      ctx.setAttackActivationLimit(weaponId, 2);
    }
  }
}

const bloodOnHerHands: CardScript = {
  additionalCost(ctx) {
    const totalCopper = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Copper")).length;
    const maximum = bloodWeapons(ctx).length > 0 ? Math.min(totalCopper, BLOOD_MODES.length * 2) : 0;
    ctx.requestChoice(
      "blood-count",
      decisionPrompt("How many Copper do you want to destroy?", "card.evr.copper.count"),
      Array.from({ length: maximum + 1 }, (_, value) => String(value)),
    );
  },
  onPlay(ctx) {
    applyBloodAllocation(ctx);
  },
  onChoose(ctx, hook, option) {
    if (hook === "blood-count") {
      const coppers = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Copper"));
      const maximum = bloodWeapons(ctx).length > 0 ? Math.min(coppers.length, BLOOD_MODES.length * 2) : 0;
      const count = Number(option);
      if (!Number.isSafeInteger(count) || count < 0 || count > maximum) return;
      let destroyed = 0;
      for (const copper of coppers.slice(0, count)) if (ctx.destroyPermanent(copper.instanceId)) destroyed++;
      ctx.setCounter("bloodPaid", destroyed);
      requestBloodMode(ctx);
    } else if (hook === "blood-mode") {
      const confirm = /^blood-mode:confirm:(\d+):(\d+)$/.exec(option);
      if (confirm) {
        const selected = Number(confirm[1]);
        const required = Number(confirm[2]);
        if (required !== ctx.getCounter("bloodPaid") || selected !== required || selected !== bloodSelectedTotal(ctx)) {
          requestBloodMode(ctx);
        }
        return;
      }
      const adjustment = /^blood-mode:(decrement|increment):(power|go-again|extra-attack):(\d+):(\d+):(\d+):(\d+)$/.exec(option);
      if (!adjustment) return;
      const operation = adjustment[1]!;
      const mode = adjustment[2] as BloodMode;
      const weaponId = Number(adjustment[3]);
      const count = Number(adjustment[4]);
      const selected = Number(adjustment[5]);
      const required = Number(adjustment[6]);
      const weapon = bloodWeapons(ctx).find((candidate) => candidate.instanceId === weaponId);
      const key = bloodAllocationKey(mode, weaponId);
      if (!weapon || count !== ctx.getCounter(key) || selected !== bloodSelectedTotal(ctx) || required !== ctx.getCounter("bloodPaid")) return;
      if (operation === "increment" && selected < required && bloodModeTotal(ctx, mode) < 2) {
        ctx.setCounter(key, count + 1);
      } else if (operation === "decrement" && count > 0) {
        ctx.setCounter(key, count - 1);
      }
      requestBloodMode(ctx);
    }
  },
};

function moneyValue(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): number {
  if (named(ctx, card, "Gold")) return 4;
  if (named(ctx, card, "Silver")) return 2;
  return named(ctx, card, "Copper") ? 1 : 0;
}

function knickMoney(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  const player = ctx.player(ctx.seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter(
      (card): card is DeepReadonly<CardInstance> => card !== undefined,
    ),
  ].filter((card) => moneyValue(ctx, card) > 0);
}

function knickTargets(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).deck.filter((card) => {
    const name = ctx.cardData(card.cardId).name.toLowerCase();
    return name.includes("amulet") || name.includes("potion") || name.includes("talisman");
  });
}

function requestKnickSearch(ctx: ScriptCtx): void {
  const targets = knickTargets(ctx);
  if (ctx.getCounter("knickSearches") <= 0 || targets.length === 0) {
    ctx.shuffleDeck();
    return;
  }
  ctx.requestCardChoice("knick-search", decisionPrompt("Search for an Amulet, Potion, or Talisman", "card.evr.knick.search"), targets.map((card) => card.instanceId));
}

const knickKnack: CardScript = {
  additionalCost(ctx) {
    ctx.requestCardChoice("knick-money", decisionPrompt("Destroy money tokens?", "card.evr.money.destroy", { optionMessages: commonOptionMessages("done") }), ["done", ...knickMoney(ctx).map((card) => card.instanceId)]);
  },
  onPlay(ctx) {
    ctx.setCounter("knickSearches", 1 + Math.floor(ctx.getCounter("knickUnits") / 4));
    requestKnickSearch(ctx);
  },
  onChoose(ctx, hook, option) {
    if (hook === "knick-money") {
      if (option === "done") return;
      const card = knickMoney(ctx).find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.setCounter("knickUnits", ctx.getCounter("knickUnits") + moneyValue(ctx, card));
      if (ctx.destroyPermanent(card.instanceId)) {
        ctx.requestCardChoice("knick-money", decisionPrompt("Destroy another money token?", "card.evr.money.destroy.next", { optionMessages: commonOptionMessages("done") }), ["done", ...knickMoney(ctx).map((candidate) => candidate.instanceId)]);
      }
    } else if (hook === "knick-search") {
      ctx.settleCard(Number(option));
      ctx.setCounter("knickSearches", ctx.getCounter("knickSearches") - 1);
      requestKnickSearch(ctx);
    }
  },
};

export const evrHighRarity: Record<string, CardScript> = {
  "grandeur of valahai|3": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Create a Seismic Surge token", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx) { ctx.createToken(SEISMIC_SURGE); } }] },
  "skull crushers|0": { onFriendlyDieRollResult(ctx, result) { if (result === 1) ctx.destroySelf(); else if (result >= 5) ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToType: ["brute"] }); } },
  "swing big|1": { onMiss(ctx) { ctx.createToken(QUICKEN, opponentSeat(ctx)); } },
  "ready to roll|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", extraDiceIgnoreLowest: 1 }); } },
  "rolling thunder|1": { onPlay(ctx) { ctx.requestDieRoll("rolling-thunder", 6); }, onDieRollResolved(ctx, hook, result) { if (hook === "rolling-thunder") buffNextAttack(ctx, { attack: result, appliesToType: ["brute"] }); } },
  "bravo, star of the show|0": {
    triggers: [{ event: "start-of-turn", optional: true, label: "Reveal Earth, Ice, and Lightning cards?", condition(ctx) { return elementalRevealOptions(ctx).length > 0; }, effect(ctx) { ctx.requestChoice("bravo-elements", decisionPrompt("Reveal an Earth, an Ice, and a Lightning card", "card.evr.bravo.elements.reveal", { optionMessages: elementalRevealOptionMessages(ctx) }), elementalRevealOptions(ctx)); } }],
    onChoose(ctx, hook, option) { if (hook !== "bravo-elements") return; const cards = option.split(":").map(Number).map((id) => ctx.player(ctx.seat).hand.find((card) => card.instanceId === id)); if (cards.length !== 3 || !cards[0] || !cards[1] || !cards[2] || !hasType(ctx, cards[0], "earth") || !hasType(ctx, cards[1], "ice") || !hasType(ctx, cards[2], "lightning")) return; ctx.revealCards([cards[0].instanceId, cards[1].instanceId, cards[2].instanceId]); buffNextAttack(ctx, { attack: 2, dominate: true, goAgain: true, appliesTo: "attack-action", minCost: 3 }); },
  },
  "stalagmite, bastion of isenloft|0": { onDefend(ctx) { if (ctx.link) ctx.createToken(FROSTBITE, ctx.link.attacker); } },
  "earthlore bounty|0": { onFriendlyDraws(ctx, count, source) { if (source && ctx.hasCardType(source, "action")) ctx.createTokens(SEISMIC_SURGE, count); } },
  "pulverize|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToType: ["guardian"] }); },
    triggers: [{
      event: "end-of-turn",
      sourceZone: "hand",
      label: "Heave 3",
      condition: (ctx) => ctx.player(ctx.seat).arsenal.length === 0,
      effect(ctx) {
        ctx.requestPayment("pulverize-heave", decisionPrompt("Pulverize: pay {r}{r}{r} to heave it?", "card.evr.pulverize.pay", { values: { amount: 3 }, optionMessages: commonOptionMessages("no") }), 3);
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "pulverize-heave" || option !== "paid") return;
      if (ctx.putIntoArsenal(ctx.self.instanceId, "hand")) {
        ctx.createTokens(SEISMIC_SURGE, 3);
      }
    },
  },
  "imposing visage|3": {
    variablePlayCost: { base: 3, counterKey: "visageX", prompt: decisionPrompt("Choose X", "engine.decision.x.choose") },
    onPlay(ctx) {
      const x = ctx.getCounter("visageX");
      const cards = ctx.player(ctx.seat).deck.filter((card) =>
        hasType(ctx, card, "aura") && (ctx.cardData(card.cardId).cost ?? -1) <= x
      );
      if (cards.length) {
        ctx.requestCardChoice(
          "visage-search",
          decisionPrompt(`Choose an aura with cost ${x} or less`, "card.evr.aura.cost.choose", { values: { amount: x } }),
          cards.map((card) => card.instanceId),
        );
      } else {
        ctx.shuffleDeck();
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "visage-search") return;
      const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
      if (!card || !hasType(ctx, card, "aura") ||
        (ctx.cardData(card.cardId).cost ?? -1) > ctx.getCounter("visageX")) return;
      ctx.settleCard(card.instanceId);
      ctx.shuffleDeck();
    },
  },
  "nerves of steel|3": { onEnterArena(ctx) { ctx.addCounter(ctx.self.instanceId, "defense", 1); } },
  "mask of the pouncing lynx|0": {
    canTriggerOnHit(ctx) { return ctx.link?.attackCardType === "action"; },
    onHit(ctx) {
      ctx.requestChoice(
        "lynx-destroy",
        yesNoPrompt("Destroy Mask of the Pouncing Lynx to search your deck?", "card.evr.lynx.destroy"),
        ["yes", "no"],
        undefined,
        undefined,
        "no",
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "lynx-destroy" && option === "yes") {
        ctx.destroySelf();
        const cards = ctx.player(ctx.seat).deck.filter(
          (card) => isAttack(ctx, card) && (ctx.cardData(card.cardId).attack ?? 99) <= 2,
        );
        if (cards.length) {
          ctx.requestCardChoice(
            "lynx-search",
            decisionPrompt("Choose an attack with 2 or less power", "card.evr.attack.power.choose", { values: { amount: 2 } }),
            cards.map((card) => card.instanceId),
          );
        } else ctx.shuffleDeck();
      } else if (hook === "lynx-search") {
        const chosen = ctx.player(ctx.seat).deck.find((card) => card.instanceId === Number(option));
        if (chosen && ctx.banish(chosen.instanceId)) ctx.allowPlayFrom(chosen.instanceId, "banish");
        ctx.shuffleDeck();
      }
    },
  },
  "break tide|2": { modifyAttack: (ctx) => previousAttackHasName(ctx, "rushing river", "flood of force") ? 3 : 0, onAttackDeclared(ctx) { if (previousAttackHasName(ctx, "rushing river", "flood of force")) ctx.addModifier({ scope: "chain-link", dominate: true }); } },
  "spring tidings|2": { onHit(ctx) { const count = ctx.state.chain.filter((link) => link.attackCardType === "action" && (ctx.cardData(link.attackingCard.cardId).attack ?? 99) <= 2).length - 1; if (count > 0) ctx.drawCards(ctx.seat, count); } },
  "winds of eternity|3": { modifyAttack: (ctx) => previousAttackHasName(ctx, "winds of eternity") ? 2 : 0 },
  "helm of sharp eye|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", oncePerTurn: false, destroySelfCost: true, canActivate: (ctx) => ctx.link?.attackCardType === "weapon", onActivate(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.banish(top.instanceId); } } },
  "shatter|2": {
    playTargetOptions(ctx) {
      const attacking = ctx.link?.attackingCard;
      if (!attacking || ctx.link?.attacker !== ctx.seat || ctx.link.attackCardType !== "weapon") return [];
      return hasType(ctx, attacking, "2h") ? [attacking.instanceId] : [];
    },
    onPlay(ctx) {
      if (ctx.playTargetInstanceId === undefined) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesTo: "weapon",
        appliesToInstanceId: ctx.playTargetInstanceId,
        replaceCombatDamageWithDefendingEquipment: true,
      });
    },
  },
  "blood on her hands|2": bloodOnHerHands,
  "oath of steel|1": { onAttackDeclared(ctx) { if (ctx.link?.attackCardType === "weapon") ctx.addCounter(ctx.self.instanceId, "power", 1); }, triggers: [{ event: "end-of-turn", label: "Remove Oath counters", effect(ctx) { ctx.setCardCounter(ctx.self.instanceId, "power", 0); } }] },
  "dissolution sphere|2": { onEnterArena(ctx) { ctx.addCounter(ctx.self.instanceId, "steam", 1); }, replaceDamageToController(_ctx, amount) { return amount === 1 ? 0 : amount; }, triggers: [{ event: "begin-action-phase", label: "Remove a steam counter or destroy Dissolution Sphere", effect(ctx) { if (ctx.getCounter("steam") > 0) ctx.addCounter(ctx.self.instanceId, "steam", -1); else ctx.destroySelf(); } }] },
  "micro-processor|3": { activated: [
    { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, label: "Opt 1", onActivate(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.requestChoice("micro-opt", decisionPrompt("Leave on top or put on bottom?", "card.evr.deck.position", { optionMessages: commonOptionMessages("top", "bottom") }), ["top", "bottom"]); } },
    { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, label: "Draw then bottom", onActivate(ctx) { ctx.drawCards(ctx.seat, 1); const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("micro-bottom", decisionPrompt("Put a card from hand on the bottom", "card.evr.hand.bottom"), hand.map((card) => card.instanceId)); } },
    { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, label: "Banish top", onActivate(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.banish(top.instanceId); } },
  ], onChoose(ctx, hook, option) { if (hook === "micro-bottom") ctx.putOnDeckBottom(Number(option)); else if (hook === "micro-opt" && option === "bottom") { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.putOnDeckBottom(top.instanceId); } } },
  "signal jammer|3": { nonAttackActionCardLimit: 1, onEnterArena(ctx) { ctx.addCounter(ctx.self.instanceId, "steam", 1); }, triggers: [{ event: "begin-action-phase", label: "Remove a steam counter or destroy Signal Jammer", effect(ctx) { if (ctx.getCounter("steam") > 0) ctx.addCounter(ctx.self.instanceId, "steam", -1); else ctx.destroySelf(); } }] },
  "teklo pounder|3": { onEnterArena(ctx) { ctx.addCounter(ctx.self.instanceId, "steam", 3); }, onBoosted(ctx) { if (ctx.getCounter("steam") > 0) { ctx.addCounter(ctx.self.instanceId, "steam", -1); buffNextAttack(ctx, { attack: 2, appliesToType: ["mechanologist"] }); } } },
  "silver palms|0": { onPlay(ctx) { if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) { ctx.drawCards(ctx.seat, 1); ctx.createToken(SILVER); } } },
  "dreadbore|0": weapon(1, { onFriendlyAttackDeclared(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1, appliesToSubtype: ["arrow"] }); } }),
  "battering bolt|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const hand = [...ctx.player(opponentSeat(ctx)).hand]; let count = 0; for (const card of hand) if (!ctx.hasCardType(card, "action")) { ctx.discardCard(opponentSeat(ctx), card.instanceId); count++; } if (count) ctx.loseLife(opponentSeat(ctx), count); } },
  "tri-shot|3": { onPlay(ctx) { const bows = ctx.player(ctx.seat).weapons.filter((card) => hasType(ctx, card, "bow")); for (const bow of bows) ctx.setPlayerFlag(ctx.seat, `additionalActivations:${bow.instanceId}:0`, 2); } },
  "rain razors|2": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToSubtype: "arrow" }); } },
  "vexing quillhand|0": { activated: { cost: 0, isAttack: false, goAgain: true, oncePerTurn: false, destroySelfCost: true, onActivate(ctx) { ctx.createTokens(RUNECHANT, 2); } } },
  "runic reclamation|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => hasType(ctx, card, "aura")); if (auras.length) ctx.requestCardChoice("reclamation-aura", decisionPrompt("Choose an aura to destroy", "card.evr.aura.destroy"), auras.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "reclamation-aura" && ctx.destroyPermanent(Number(option))) ctx.createToken(RUNECHANT); } },
  "swarming gloomveil|1": { modifyAttack(ctx) { return (Number(ctx.getFlag("player", "playedSubtypeCount:aura")) + Number(ctx.getFlag("player", "createdSubtypeCount:aura"))) >= 2 ? 3 : 0; }, onAttackDeclared(ctx) { if ((Number(ctx.getFlag("player", "playedSubtypeCount:aura")) + Number(ctx.getFlag("player", "createdSubtypeCount:aura"))) >= 2) ctx.grantGoAgain(); } },
  "revel in runeblood|1": {
    onPlay(ctx) {
      ctx.scheduleEndOfTurnTrigger(
        "revel-cleanup",
        decisionPrompt("Destroy Runechants", "card.trigger.common.runechants.destroy"),
      );
      if (Number(ctx.getFlag("player", "attackActionsPlayedThisTurn")) >= 1 && Number(ctx.getFlag("player", "nonAttackActionsPlayedThisTurn")) >= 2) ctx.createTokens(RUNECHANT, 4);
    },
    onDelayedTrigger(ctx, hook) {
      if (hook === "revel-cleanup") {
        for (const card of [...ctx.player(ctx.seat).board]) {
          if (ctx.cardData(card.cardId).name.toLowerCase() === "runechant") ctx.destroyPermanent(card.instanceId);
        }
      }
    },
  },
  "kraken's aethervein|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, onActivate(ctx) { ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, sourceInstanceId: ctx.self.instanceId }); } }, onDamageDealt(ctx, _target, amount, arcane) { if (arcane && amount > 0) ctx.drawCards(ctx.seat, 1); } },
  "sigil of parapets|3": {
    onDefend: (ctx) => ctx.addModifier({ scope: "chain-link" }),
    triggers: [{ event: "card-played", label: "Gain +2 defense", condition: (ctx, played) => !!played && ctx.state.chain.some((link) => link.defendingCards.some((card) => card.instanceId === ctx.self.instanceId)) && ctx.cardTypes(played).includes("wizard"), effect(ctx) { ctx.addCardTempDefense(ctx.self.instanceId, 2); } }],
  },
  "aether wildfire|1": { arcaneDamageEffect: true, arcaneDamageEffectAmounts: [4], onPlay(ctx) { ctx.dealDamage(opponentSeat(ctx), 4, { arcane: true, sourceInstanceId: ctx.self.instanceId }); } },
  "scour|3": { arcaneDamageEffect: true, arcaneDamageEffectAmounts: [0], variablePlayCost: { base: 0, counterKey: "scourX", prompt: decisionPrompt("Choose X", "engine.decision.x.choose") }, onPlay(ctx) { const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => hasType(ctx, card, "aura") && (ctx.cardData(card.cardId).cost ?? -1) === 0).slice(0, ctx.getCounter("scourX")); for (const aura of auras) ctx.destroyPermanent(aura.instanceId); ctx.dealDamage(opponentSeat(ctx), auras.length, { arcane: true, sourceInstanceId: ctx.self.instanceId }); } },
  "crown of reflection|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: false, destroySelfCost: true, onActivate(ctx) { const auras = ctx.player(ctx.seat).board.filter((card) => hasType(ctx, card, "aura")); if (auras.length) ctx.requestCardChoice("reflection-aura", decisionPrompt("Choose an aura to destroy", "card.evr.aura.destroy"), auras.map((card) => card.instanceId)); } } },
  "fractal replication|1": fractalReplication,
  "shimmers of silver|3": { onFriendlyAttackDeclared(ctx) { if (ctx.link?.attackCardType !== "weapon") return; const key = `shimmers:${ctx.self.instanceId}`; if (ctx.getFlag("player", key) === true) return; ctx.setFlag("player", key, true); ctx.addCounter(ctx.link.attackingCard.instanceId, "power", 1); } },
  "bingo|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length) ctx.requestCardChoice("bingo-reveal", decisionPrompt("Choose a card to reveal", "card.evr.card.reveal"), hand.map((card) => card.instanceId), opponentSeat(ctx)); }, onChoose(ctx, hook, option) { if (hook !== "bingo-reveal") return; const card = ctx.player(opponentSeat(ctx)).hand.find((candidate) => candidate.instanceId === Number(option)); if (!card) return; ctx.lookAt(card.instanceId); if (isAttack(ctx, card)) ctx.grantGoAgain(); else ctx.drawCards(ctx.seat, 1); } },
  "firebreathing|1": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", oncePerTurn: false, onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); } } },
  "cash out|3": { onPlay(ctx) { const permanents = [...ctx.player(ctx.seat).board]; for (const card of permanents) if (ctx.destroyPermanent(card.instanceId)) ctx.createToken(SILVER); } },
  "knick knack bric-a-brac|1": knickKnack,
  "this round's on me|3": { modifyOpposingAttack: () => -1, onPlay(ctx) { for (const player of ctx.state.players) ctx.drawCards(player.seat, 1); ctx.addModifier({ scope: "until-end-of-turn", expiresAtStartOfTurn: ctx.state.turn + 2 }); } },
};
