import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextArcaneDamageCard, commonOptionMessages, dealArcane, decisionMessage, decisionPrompt, opponentSeat, optN, optOnChoose, wizardActionAsInstant } from "../shared-helpers.js";

const RUNECHANT = "ARC112";

function isType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type);
}

function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && isType(ctx, card, "attack");
}

function isNonAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !isType(ctx, card, "attack");
}

function runeCount(ctx: ScriptCtx): number {
  return ctx.player(ctx.seat).board.filter((card) => ctx.cardData(card.cardId).name === "Runechant").length;
}

function reload(ctx: ScriptCtx): void {
  const player = ctx.player(ctx.seat);
  if (player.arsenal.length === 0 && player.hand.length > 0) {
    ctx.requestCardChoice("high-reload", decisionPrompt("Reload: put a card from hand into arsenal?", "card.common.reload", { optionMessages: commonOptionMessages("pass") }), ["pass", ...player.hand.map((card) => card.instanceId)]);
  }
}

function reloadChoice(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== "high-reload") return false;
  if (option !== "pass") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
  return true;
}

function chooseFromDeck(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  messageId: string,
  predicate: (card: DeepReadonly<CardInstance>) => boolean,
): void {
  const cards = ctx.player(ctx.seat).deck.filter(predicate);
  if (cards.length > 0) ctx.requestCardChoice(hook, decisionPrompt(fallback, messageId), cards.map((card) => card.instanceId));
}

function mechanologistItem(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, exactCost?: number): boolean {
  const data = ctx.cardData(card.cardId);
  return isType(ctx, card, "mechanologist") && isType(ctx, card, "item") &&
    (exactCost === undefined || (data.cost ?? 0) === exactCost);
}

const tekloCore: CardScript = {
  destroyAtZeroCounter: "steam",
  onEnterArena: (ctx) => ctx.setCounter("steam", 2),
  triggers: [{
    event: "begin-action-phase",
    label: "Remove a steam counter and gain 2 resources",
    condition: (ctx) => ctx.getCounter("steam") > 0,
    effect(ctx) {
      ctx.setCounter("steam", ctx.getCounter("steam") - 1);
      ctx.changeResources(ctx.seat, 2);
    },
  }],
};

const sparkOfGenius: CardScript = {
  variablePlayCost: { base: 0, resourcesPerX: 2, counterKey: "sparkX", prompt: decisionPrompt("Choose X", "engine.decision.x.choose") },
  onChoose(ctx, hook, option) {
    if (hook !== "spark-item") return;
    const item = ctx.player(ctx.seat).deck.find((card) => card.instanceId === Number(option));
    if (!item || !mechanologistItem(ctx, item, ctx.getCounter("sparkX"))) return;
    ctx.settleCard(item.instanceId);
    ctx.shuffleDeck();
    if (ctx.getFlag("player", "boostedThisTurn") === true) ctx.drawCards(ctx.seat, 1);
  },
  onPlay(ctx) {
    const x = ctx.getCounter("sparkX");
    const items = ctx.player(ctx.seat).deck.filter((card) => mechanologistItem(ctx, card, x));
    if (items.length > 0) {
      ctx.requestCardChoice(
        "spark-item",
        decisionPrompt(`Choose a Mechanologist item with cost ${x}`, "card.arc.mechanologist.item.cost", { values: { amount: x } }),
        items.map((card) => card.instanceId),
      );
      return;
    }
    ctx.shuffleDeck();
    if (ctx.getFlag("player", "boostedThisTurn") === true) ctx.drawCards(ctx.seat, 1);
  },
};

const becomeTheArknight: CardScript = {
  onPlay(ctx) {
    const actions = ctx.player(ctx.seat).hand.filter((card) => ctx.hasCardType(card, "action"));
    if (actions.length > 0) ctx.requestCardChoice("become-discard", decisionPrompt("Become the Arknight: discard an action card?", "card.arc.become.discard", { optionMessages: commonOptionMessages("pass") }), ["pass", ...actions.map((card) => card.instanceId)]);
  },
  onChoose(ctx, hook, option) {
    if (hook === "become-discard") {
      if (option === "pass") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      const discardedAttack = isAttack(ctx, card);
      ctx.discardCard(ctx.seat, card.instanceId);
      chooseFromDeck(ctx, "become-search", "Become the Arknight: choose a Runeblade action", "card.arc.become.runeblade.choose", (candidate) =>
        isType(ctx, candidate, "runeblade") && (discardedAttack ? isNonAttack(ctx, candidate) : isAttack(ctx, candidate)));
      return;
    }
    if (hook !== "become-search") return;
    const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
    if (card) ctx.moveToHand(card.instanceId);
    ctx.shuffleDeck();
  },
};

function targetArcane(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [damage],
    playAsInstant: wizardActionAsInstant,
    onPlay: (ctx) => dealArcane(ctx, opponentSeat(ctx), damage),
  };
}

const sonicBoom: CardScript = {
  ...targetArcane(3),
  onDamageDealt(ctx, _target, amount, arcane) {
    if (!arcane || amount <= 0) return;
    const top = ctx.player(ctx.seat).deck[0];
    if (!top) return;
    ctx.lookAt(top.instanceId);
    if (isType(ctx, top, "wizard") && isNonAttack(ctx, top)) {
      ctx.requestCardChoice(`sonic-banish:${amount}`, decisionPrompt("Sonic Boom: banish the top card?", "card.arc.sonic.banish", { optionMessages: commonOptionMessages("no") }), ["no", top.instanceId]);
    }
  },
  onChoose(ctx, hook, option) {
    const match = /^sonic-banish:(\d+)$/.exec(hook);
    if (!match || option === "no") return;
    const id = Number(option);
    if (!ctx.banish(id)) return;
    ctx.allowPlayFrom(id, "banish", { costReduction: Number(match[1]) });
    ctx.setFlag("player", `asInstant:${id}`, true);
  },
};

const lessonInLava: CardScript = {
  ...targetArcane(3),
  onDamageDealt(ctx, _target, amount, arcane) {
    if (!arcane || amount <= 0) return;
    chooseFromDeck(ctx, `lesson-search:${amount}`, "Lesson in Lava: choose a Wizard card", "card.arc.lesson.wizard.choose", (card) =>
      isType(ctx, card, "wizard") && (ctx.cardData(card.cardId).cost ?? 0) <= amount);
  },
  onChoose(ctx, hook, option) {
    if (!hook.startsWith("lesson-search:")) return;
    if (ctx.putOnDeckTop(Number(option))) ctx.shuffleDeck();
    // Shuffle first, then restore the searched card to the top.
    ctx.putOnDeckTop(Number(option));
  },
};

function applyTomeMode(ctx: ScriptCtx, mode: string): void {
  if (mode === "draw") ctx.drawCards(ctx.seat, 1);
  else buffNextArcaneDamageCard(ctx, 1);
}

const tomeOfAetherwind: CardScript = {
  additionalCost(ctx) { ctx.requestChoice("tome-mode", decisionPrompt("Tome of Aetherwind: choose the first mode", "card.arc.tome.mode.first", { optionMessages: { draw: decisionMessage("card.arc.tome.option.draw"), "+1 arcane damage": decisionMessage("card.arc.tome.option.arcane") } }), ["draw", "+1 arcane damage"]); },
  onChoose(ctx, hook, option) {
    if (hook !== "tome-mode") return;
    ctx.setCounter(`tomeMode:${option}`, ctx.getCounter(`tomeMode:${option}`) + 1);
    const chosen = ctx.getCounter("tomeModesChosen") + 1;
    ctx.setCounter("tomeModesChosen", chosen);
    if (chosen < 2) ctx.requestChoice("tome-mode", decisionPrompt("Choose the second mode", "card.arc.tome.mode.second", { optionMessages: { draw: decisionMessage("card.arc.tome.option.draw"), "+1 arcane damage": decisionMessage("card.arc.tome.option.arcane") } }), ["draw", "+1 arcane damage"]);
  },
  onPlay(ctx) {
    for (let count = 0; count < ctx.getCounter("tomeMode:draw"); count++) applyTomeMode(ctx, "draw");
    for (let count = 0; count < ctx.getCounter("tomeMode:+1 arcane damage"); count++) applyTomeMode(ctx, "+1 arcane damage");
  },
};

function artMode(ctx: ScriptCtx, option: string): void {
  if (option === "power") ctx.addModifier({ scope: "until-end-of-turn", attack: 1, defense: 1, appliesTo: "attack-action" });
  else if (option === "go again") ctx.addModifier({ scope: "next-attack", goAgain: true, appliesTo: "attack-action" });
  else if (option === "banish") {
    const attacks = ctx.player(ctx.seat).hand.filter((card) => isAttack(ctx, card));
    if (attacks.length > 0) ctx.requestCardChoice("art-banish-card", decisionPrompt("Art of War: banish an attack action", "card.arc.art.attack.banish"), attacks.map((card) => card.instanceId));
  }
  else if (option === "defend from arsenal") ctx.setFlag("player", "attackActionsDefendFromArsenal", true);
}

const ART_OF_WAR_MODES = ["power", "go again", "defend from arsenal", "banish"] as const;

const artOfWar: CardScript = {
  additionalCost(ctx) { ctx.requestChoice("art-mode", decisionPrompt("Art of War: choose a mode", "card.arc.art.mode.choose", { optionMessages: { power: decisionMessage("card.arc.art.option.power"), "go again": decisionMessage("card.arc.art.option.goagain"), "defend from arsenal": decisionMessage("card.arc.art.option.defend"), banish: decisionMessage("card.arc.art.option.banish") } }), [...ART_OF_WAR_MODES]); },
  onChoose(ctx, hook, option) {
    if (hook === "art-mode") {
      ctx.setCounter(`art:${option}`, 1);
      const chosen = ctx.getCounter("artModesChosen") + 1;
      ctx.setCounter("artModesChosen", chosen);
      if (chosen < 2) ctx.requestChoice("art-mode", decisionPrompt("Art of War: choose another mode", "card.arc.art.mode.next", { optionMessages: { power: decisionMessage("card.arc.art.option.power"), "go again": decisionMessage("card.arc.art.option.goagain"), "defend from arsenal": decisionMessage("card.arc.art.option.defend"), banish: decisionMessage("card.arc.art.option.banish") } }), ART_OF_WAR_MODES.filter((mode) => mode !== option));
    } else if (hook === "art-banish-card" && ctx.banish(Number(option))) ctx.drawCards(ctx.seat, 2);
  },
  onPlay(ctx) {
    for (const mode of ART_OF_WAR_MODES) if (ctx.getCounter(`art:${mode}`) > 0) artMode(ctx, mode);
  },
};

export const arcHighRarity: Record<string, CardScript> = {
  "eye of ophidia|3": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Opt 2", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx) { optN(ctx, 2); } }], onChoose: optOnChoose },
  "teklo foundry heart|0": { activated: { cost: 1, isAttack: false, goAgain: true, oncePerTurn: true, canActivate: (ctx) => ctx.getFlag("player", "boostedThisTurn") === true, onActivate(ctx) { const top = ctx.player(ctx.seat).deck.slice(0, 2); let gained = 0; for (const card of top) { if (isType(ctx, card, "mechanologist")) gained++; ctx.banish(card.instanceId); } ctx.changeResources(ctx.seat, gained); } } },
  "high octane|1": { onPlay(ctx) { ctx.drawCards(ctx.seat, 1); ctx.addModifier({ scope: "until-end-of-turn" }); }, onBoosted(ctx) { ctx.changeActionPoints(ctx.seat, 1); } },
  "teklo core|3": tekloCore,
  "spark of genius|2": sparkOfGenius,
  "induction chamber|1": { activated: [
    { cost: 1, isAttack: false, goAgain: true, canActivate: (ctx) => ctx.getCounter("steam") === 0, onActivate(ctx) { ctx.setCounter("steam", 1); } },
    { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", oncePerTurn: true, removeCounterCost: { key: "steam", amount: 1 }, canActivate: (ctx) => ctx.link?.attackCardType === "weapon" && isType(ctx, ctx.link.attackingCard, "mechanologist"), onActivate(ctx) { ctx.grantGoAgain(); } },
  ] },

  "skullbone crosswrap|0": { activated: { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, canActivate: (ctx) => ctx.player(ctx.seat).arsenal.some((card) => card.faceDown), onActivate(ctx) { const card = ctx.player(ctx.seat).arsenal.find((candidate) => candidate.faceDown); if (card) ctx.turnArsenalFaceUp(card.instanceId); optN(ctx, 1); } }, onChoose: optOnChoose },
  "three of a kind|1": { onPlay(ctx) { ctx.drawCards(ctx.seat, 3); ctx.setFlag("player", "playsRestrictedToArsenal", true); } },
  "endless arrow|1": { onHit(ctx) { ctx.returnSelfToHand(); } },
  "rapid fire|2": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToSubtype: "arrow" }); reload(ctx); }, onChoose(ctx, hook, option) { reloadChoice(ctx, hook, option); } },

  "grasp of the arknight|0": { activated: { cost: 2, isAttack: false, goAgain: true, oncePerTurn: true, modifyCost: (ctx, base) => base + runeCount(ctx), onActivate(ctx) { ctx.createToken(RUNECHANT); } } },
  "arknight ascendancy|1": { modifyPlayCost: (ctx, base) => Math.max(0, base - runeCount(ctx)), canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.createTokens(RUNECHANT, ctx.link?.damage ?? 0); } },
  "mordred tide|1": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); }, replaceFriendlyTokenCreation: (ctx, cardId, count) => ctx.cardData(cardId).name === "Runechant" ? count + 1 : undefined },
  "ninth blade of the blood oath|2": { modifyPlayCost: (ctx, base) => Math.max(0, base - runeCount(ctx)) },
  "become the arknight|3": becomeTheArknight,
  "tome of the arknight|3": { onPlay(ctx) { const top = ctx.player(ctx.seat).deck.slice(0, 2); for (const card of top) ctx.logPublic(`Tome of the Arknight reveals ${ctx.cardData(card.cardId).name}`); if (top.length === 2 && top.some((card) => isAttack(ctx, card)) && top.some((card) => isNonAttack(ctx, card))) for (const card of top) ctx.moveToHand(card.instanceId); } },

  "storm striders|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.setFlag("player", "nextWizardNonAttackAsInstant", true); } } },
  "blazing aether|1": { arcaneDamageEffect: true, arcaneDamageEffectAmounts: [0], playAsInstant: wizardActionAsInstant, onPlay(ctx) { dealArcane(ctx, opponentSeat(ctx), Number(ctx.getFlag("player", `arcaneDamageAmountToSeat:${opponentSeat(ctx)}`)) || 0); } },
  "sonic boom|2": sonicBoom,
  "forked lightning|1": { arcaneDamageEffect: true, arcaneDamageEffectAmounts: [2], playAsInstant: wizardActionAsInstant, onPlay(ctx) { ctx.requestChoice("fork-first", decisionPrompt(`Forked Lightning: choose the first hero for ${ctx.previewArcaneDamage(2)} arcane damage`, "card.arc.fork.hero.first", { values: { amount: ctx.previewArcaneDamage(2) }, optionMessages: commonOptionMessages("opposing hero", "your hero") }), ["opposing hero", "your hero"]); }, onChoose(ctx, hook, option) { if (hook === "fork-first") { ctx.setCounter("forkFirst", option === "your hero" ? ctx.seat : opponentSeat(ctx)); ctx.requestChoice("fork-second", decisionPrompt("Choose the second hero for 2 arcane damage", "card.arc.fork.hero.second", { values: { amount: 2 }, optionMessages: commonOptionMessages("opposing hero", "your hero") }), ["opposing hero", "your hero"]); } else if (hook === "fork-second") { dealArcane(ctx, ctx.getCounter("forkFirst"), 2); dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), 2); } } },
  "lesson in lava|2": lessonInLava,
  "tome of aetherwind|1": tomeOfAetherwind,

  "arcanite skullcap|0": {
    modifyDefense: (ctx) => ctx.player(ctx.seat).life < ctx.player(opponentSeat(ctx)).life ? 1 : 0,
    arcaneBarrierValue: (ctx) => ctx.player(ctx.seat).life < ctx.player(opponentSeat(ctx)).life ? 3 : 0,
  },
  "command and conquer|1": { onAttackDeclared(ctx) { ctx.setFlag("link", "noDefenseReactions", true); }, canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) { if (!ctx.destroyPermanent(card.instanceId)) ctx.moveToGraveyard(card.instanceId); } } },
  "art of war|2": artOfWar,
  "pursuit of knowledge|3": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.setPlayerFlag(ctx.seat, "bonusIntellect", Number(ctx.getPlayerFlag(ctx.seat, "bonusIntellect")) + 1); } },
  "chains of eminence|1": {
    prohibitsChosenName: true,
    onEnterArena(ctx) { ctx.requestNameChoice("chains-name", decisionPrompt("Chains of Eminence: name a card", "card.arc.chains.card.name")); },
    onChoose(ctx, hook, option) {
      if (hook === "chains-name") {
        ctx.setChosenName(option);
      }
    },
    triggers: [{ event: "begin-action-phase", label: "Destroy Chains of Eminence", effect: (ctx) => ctx.destroySelf() }],
  },
  "rusted relic|3": {},
};
