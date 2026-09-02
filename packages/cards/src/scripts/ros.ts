import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { ampNextArcane, attackAbility, buffNextAttack, commonOptionMessages, dealArcane, decisionMessage, decisionPrompt, opponentSeat, previousAttackHasName, requestDiscardChoice, resolveDiscardChoice } from "./shared-helpers.js";

// Rosetta (ROS) — commons, rares, young heroes, and their required tokens.

const EARTH = "ROS025";
const LIGHTNING = "ROS026";
const RUNECHANT = "ROS162";
const PONDER = "ROS237";
const SPECTRAL_SHIELD = "MST158";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasTag(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, tag: string): boolean {
  return ctx.cardTypes(card).includes(tag.toLowerCase());
}

function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasTag(ctx, card, "aura");
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack");
}

function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !hasTag(ctx, card, "attack");
}

function fourEarthBanished(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && hasTag(ctx, card, "earth")).length >= 4;
}

function playedOrCreatedAura(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "playedSubtype:aura") === true ||
    ctx.getFlag("player", "createdSubtype:aura") === true;
}

function sigils(ctx: ScriptCtx, seat = ctx.seat): DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) =>
    isAura(ctx, card) && data(ctx, card).name.toLowerCase().includes("sigil"),
  );
}

function createRunechants(ctx: ScriptCtx, count: number): void {
  ctx.createTokens(RUNECHANT, count);
}

function requestAnyTarget(ctx: ScriptCtx, hook: string, prompt: string, amount: number, opposingOnly = false, optional = false): void {
  const options = opposingOnly ? ["opposing hero"] : ["opposing hero", "your hero"];
  if (optional) options.unshift("no");
  const cardOptions: (number | null)[] = options.map(() => null);
  for (const player of ctx.state.players) {
    if (opposingOnly && player.seat === ctx.seat) continue;
    for (const card of player.board) {
      if (!hasTag(ctx, card, "ally")) continue;
      options.push(`ally:${player.seat}:${card.instanceId}`);
      cardOptions.push(card.instanceId);
    }
  }
  ctx.requestChoice(hook, decisionPrompt(prompt, "card.ros.arcane.target.choose", {
    values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: ctx.previewArcaneDamage(amount) },
    optionMessages: {
      "opposing hero": decisionMessage("common.option.opponent"),
      "your hero": decisionMessage("card.ros.option.yourhero"),
      ...(optional ? commonOptionMessages("no") : {}),
    },
  }), options, ctx.seat, cardOptions);
}

function dealToChoice(ctx: ScriptCtx, option: string, amount: number): void {
  if (option === "no") return;
  const ally = /^ally:(\d+):(\d+)$/.exec(option);
  ctx.setCounter("lastTargetWasAlly", ally ? 1 : 0);
  if (ally) {
    dealArcane(ctx, Number(ally[1]), amount, Number(ally[2]));
  } else {
    dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), amount);
  }
}

interface SplitSides {
  leftName: string;
  rightName: string;
  left(ctx: ScriptCtx): void;
  right(ctx: ScriptCtx): void;
}

function splitScript(sides: SplitSides): CardScript {
  return {
    meld: {
      leftName: sides.leftName,
      rightName: sides.rightName,
      leftCardType: "action",
      rightCardType: "instant",
    },
    onPlay(ctx) {
      if (ctx.self.meldSide === "left") sides.left(ctx);
      else if (ctx.self.meldSide === "right") sides.right(ctx);
      else if (ctx.self.meldSide === "both") {
        sides.right(ctx);
        sides.left(ctx);
      }
    },
  };
}

type DecomposePayoff = (ctx: ScriptCtx) => void;

function decompose(trigger: "attack" | "play", payoff: DecomposePayoff): CardScript {
  const offer = (ctx: ScriptCtx) => {
    const grave = ctx.player(ctx.seat).graveyard;
    const firstEarth = grave.filter((first) =>
      hasTag(ctx, first, "earth") && grave.some((second) =>
        second.instanceId !== first.instanceId && hasTag(ctx, second, "earth") && grave.some((action) =>
          action.instanceId !== first.instanceId &&
          action.instanceId !== second.instanceId &&
          ctx.hasCardType(action, "action"),
        ),
      ),
    );
    if (firstEarth.length === 0) return;
    ctx.requestCardChoice(
      "decompose-earth-1",
      decisionPrompt(`${ctx.data.name}: decompose? Choose the first Earth card to banish`, "card.ros.decompose.earth.first", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("no") }),
      ["no", ...firstEarth.map((card) => card.instanceId)],
    );
  };
  return {
    ...(trigger === "attack" ? { onAttackDeclared: offer } : { onPlay: offer }),
    onChoose(ctx, hook, option) {
      if (hook === "decompose-earth-1") {
        if (option === "no") return;
        const first = ctx.player(ctx.seat).graveyard.find((card) => card.instanceId === Number(option));
        if (!first || !hasTag(ctx, first, "earth")) return;
        ctx.setCounter("decomposeEarth1", first.instanceId);
        const secondEarth = ctx.player(ctx.seat).graveyard.filter(
          (second) => second.instanceId !== first.instanceId && hasTag(ctx, second, "earth") &&
            ctx.player(ctx.seat).graveyard.some((action) =>
              action.instanceId !== first.instanceId &&
              action.instanceId !== second.instanceId &&
              ctx.hasCardType(action, "action"),
            ),
        );
        ctx.requestCardChoice(
          "decompose-earth-2",
          decisionPrompt(`${ctx.data.name}: choose the second Earth card to banish`, "card.ros.decompose.earth.second", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
          secondEarth.map((card) => card.instanceId),
        );
        return;
      }
      if (hook === "decompose-earth-2") {
        const firstId = ctx.getCounter("decomposeEarth1");
        const second = ctx.player(ctx.seat).graveyard.find((card) => card.instanceId === Number(option));
        if (!second || second.instanceId === firstId || !hasTag(ctx, second, "earth")) return;
        ctx.setCounter("decomposeEarth2", second.instanceId);
        const actions = ctx.player(ctx.seat).graveyard.filter(
          (card) => card.instanceId !== firstId &&
            card.instanceId !== second.instanceId &&
            ctx.hasCardType(card, "action"),
        );
        ctx.requestCardChoice(
          "decompose-action",
          decisionPrompt(`${ctx.data.name}: choose the action card to banish`, "card.ros.decompose.action", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
          actions.map((card) => card.instanceId),
        );
        return;
      }
      if (hook !== "decompose-action") return;
      const ids = [ctx.getCounter("decomposeEarth1"), ctx.getCounter("decomposeEarth2"), Number(option)];
      if (new Set(ids).size !== 3) return;
      const grave = ctx.player(ctx.seat).graveyard;
      const chosen = ids.map((id) => grave.find((card) => card.instanceId === id));
      if (!chosen.every(Boolean) || !hasTag(ctx, chosen[0]!, "earth") ||
        !hasTag(ctx, chosen[1]!, "earth") || !ctx.hasCardType(chosen[2]!, "action")) return;
      for (const id of ids) ctx.banish(id);
      payoff(ctx);
    },
  };
}

function earthForm(): CardScript {
  return { onHit: (ctx) => ctx.createToken(EARTH) };
}

function fellingOfTheCrown(): CardScript {
  const promptNextHero = (ctx: ScriptCtx, heroIndex: number): void => {
    const heroes = [ctx.seat, ...ctx.state.players.map((player) => player.seat).filter((seat) => seat !== ctx.seat)];
    for (let index = heroIndex; index < heroes.length; index++) {
      const choiceSeat = heroes[index]!;
      const hand = ctx.player(choiceSeat).hand;
      if (hand.length === 0) continue;
      ctx.requestCardChoice(
        `felling-hand:${index}:${choiceSeat}`,
        decisionPrompt("Put a card from your hand on the bottom of your deck", "card.ros.hand.card.bottom"),
        hand.map((card) => card.instanceId),
        choiceSeat,
      );
      return;
    }
  };
  const base = decompose("attack", (ctx) => promptNextHero(ctx, 0));
  return {
    modifyAttack: (ctx) => fourEarthBanished(ctx) ? 4 : 0,
    ...base,
    onChoose(ctx, hook, option) {
      const fellingChoice = /^felling-hand:(\d+):(\d+)$/.exec(hook);
      if (!fellingChoice) {
        base.onChoose?.(ctx, hook, option);
        return;
      }
      const heroIndex = Number(fellingChoice[1]);
      const choiceSeat = Number(fellingChoice[2]);
      const heroes = [ctx.seat, ...ctx.state.players.map((player) => player.seat).filter((seat) => seat !== ctx.seat)];
      if (heroes[heroIndex] !== choiceSeat) return;
      const chosen = ctx.player(choiceSeat).hand.find((card) => card.instanceId === Number(option));
      if (!chosen) return;
      ctx.putOnDeckBottom(chosen.instanceId);
      promptNextHero(ctx, heroIndex + 1);
    },
  };
}

function summersFall(): CardScript {
  const base = decompose("attack", (ctx) => {
    const auras = ctx.state.players.flatMap((player) => player.board).filter((card) => isAura(ctx, card));
    if (auras.length) ctx.requestCardChoice("summer-aura", decisionPrompt("Put up to 1 aura on the bottom of its owner's deck", "card.ros.aura.bottom.optional", { values: { count: 1 }, optionMessages: commonOptionMessages("none") }), ["none", ...auras.map((card) => card.instanceId)]);
  });
  return {
    ...base,
    onChoose(ctx, hook, option) {
      if (hook === "summer-aura") {
        if (option !== "none") ctx.putOnDeckBottom(Number(option));
        return;
      }
      base.onChoose?.(ctx, hook, option);
    },
  };
}

function fruitsOfForest(): CardScript {
  return { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => ctx.gainLife(ctx.seat, 2) } };
}

function beginningAura(effect?: (ctx: ScriptCtx) => void, leave?: (ctx: ScriptCtx) => void): CardScript {
  const triggers: NonNullable<CardScript["triggers"]> = [
    { event: "begin-action-phase", label: "Destroy aura", effect(ctx) { ctx.destroySelf(); effect?.(ctx); } },
  ];
  if (leave) {
    triggers.push({
      event: "card-left-arena",
      sourceZone: "any",
      label: "Resolve leave-arena effect",
      condition: (ctx, left) => left?.instanceId === ctx.self.instanceId,
      effect: leave,
    });
  }
  return {
    triggers,
  };
}

function preventEquipment(amount: number, condition: (ctx: ScriptCtx) => boolean): CardScript {
  return { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: condition, onActivate: (ctx) => ctx.preventNextDamage(ctx.seat, amount) } };
}

function lightningForm(): CardScript {
  return { onHit: (ctx) => ctx.createToken(LIGHTNING) };
}

function handPrevention(amount: number): CardScript {
  return { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => ctx.preventNextDamage(ctx.seat, amount) } };
}

function conditionalNextAttack(amount: number): CardScript {
  return { onPlay: (ctx) => buffNextAttack(ctx, { attack: amount, appliesTo: "attack-action", maxCost: 1 }) };
}

function chooseAuraToDestroy(ctx: ScriptCtx, hook: string, prompt: string, messageId: string, optional = false): void {
  const auras = ctx.player(ctx.seat).board.filter((card) => isAura(ctx, card));
  if (auras.length) ctx.requestCardChoice(hook, decisionPrompt(prompt, messageId, {
    values: { card: { kind: "card", cardId: ctx.self.cardId } },
    ...(optional ? { optionMessages: commonOptionMessages("no") } : {}),
  }), [...(optional ? ["no"] : []), ...auras.map((card) => card.instanceId)]);
}

function splinteringDeadwood(): CardScript {
  const offer = (ctx: ScriptCtx) => chooseAuraToDestroy(ctx, "splinter-aura", `${ctx.data.name}: destroy an aura to create a Runechant?`, "card.ros.aura.destroy.runechant", true);
  return {
    onAttackDeclared: offer,
    onHit: offer,
    onChoose(ctx, hook, option) {
      if (hook === "splinter-aura" && option !== "no" && ctx.destroyPermanent(Number(option))) createRunechants(ctx, 1);
    },
  };
}

function maleficIncantation(verses: number): CardScript {
  return {
    destroyAtZeroCounter: "verse",
    onEnterArena: (ctx) => ctx.setCounter("verse", verses),
    triggers: [{
      event: "card-played",
      label: "Remove a verse counter and create a Runechant",
      condition(ctx, played) {
        const onceKey = `maleficUsed:${ctx.self.instanceId}`;
        return !!played &&
          isAttackAction(ctx, played) &&
          ctx.getFlag("player", onceKey) !== true &&
          ctx.getCounter("verse") > 0;
      },
      onTrigger(ctx) {
        ctx.setFlag("player", `maleficUsed:${ctx.self.instanceId}`, true);
      },
      effect(ctx) {
        ctx.setCounter("verse", ctx.getCounter("verse") - 1);
        createRunechants(ctx, 1);
      },
    }],
  };
}

function arcaneCussing(count: number): CardScript {
  const destroy = (ctx: ScriptCtx, amount: number) => { if (amount > 0) ctx.destroySelf(); };
  return {
    onFriendlyDamageDealt(ctx, _source, _target, amount) { destroy(ctx, amount); },
    onHeroDealtDamage(ctx, amount) { destroy(ctx, amount); },
    onLeaveArena(ctx) { if (ctx.state.activePlayer === ctx.seat) createRunechants(ctx, count); },
  };
}

function deadwoodDirge(count: number): CardScript {
  return {
    onPlay: (ctx) => chooseAuraToDestroy(ctx, "dirge-aura", `${ctx.data.name}: destroy an aura you control`, "card.ros.aura.destroy.named"),
    onChoose(ctx, hook, option) {
      if (hook === "dirge-aura" && ctx.destroyPermanent(Number(option))) createRunechants(ctx, count);
    },
  };
}

function ampFromHand(): CardScript {
  return { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => ampNextArcane(ctx, 1) } };
}

function arcaneAnyTarget(amount: number, extra?: Pick<CardScript, "onDamageDealt" | "graveyardReplacement">): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    onPlay: (ctx) => requestAnyTarget(ctx, "arcane-target", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to a target`, amount),
    onChoose(ctx, hook, option) { if (hook === "arcane-target") dealToChoice(ctx, option, amount); },
    ...extra,
  };
}

function arcaneHero(amount: number, surge?: (ctx: ScriptCtx, target: number, dealt: number) => void): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    onPlay(ctx) { ctx.requestChoice("arcane-hero", decisionPrompt(`${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to a hero`, "card.ros.arcane.hero.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: ctx.previewArcaneDamage(amount) }, optionMessages: { "opposing hero": decisionMessage("common.option.opponent"), "your hero": decisionMessage("card.ros.option.yourhero") } }), ["opposing hero", "your hero"]); },
    onChoose(ctx, hook, option) { if (hook === "arcane-hero") dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), amount); },
    onDamageDealt(ctx, target, dealt, arcane) { if (arcane && dealt > amount) surge?.(ctx, target, dealt); },
  };
}

function chorus(amount: number): CardScript {
  return {
    ...arcaneAnyTarget(amount),
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true,
      onActivate(ctx) {
        ctx.addModifier({ scope: "until-end-of-turn", damage: 1, appliesToCardType: "action" });
        ctx.addModifier({ scope: "until-end-of-turn", damage: 1, appliesToCardType: "instant" });
      },
    },
  };
}

function glyphOverlay(base: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [base],
    onPlay(ctx) {
      const amount = base + sigils(ctx).length;
      ctx.requestChoice("glyph-hero", decisionPrompt(`${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to a hero`, "card.ros.arcane.hero.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: ctx.previewArcaneDamage(amount) }, optionMessages: { "opposing hero": decisionMessage("common.option.opponent"), "your hero": decisionMessage("card.ros.option.yourhero") } }), ["opposing hero", "your hero"]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "glyph-hero") {
        dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), base + sigils(ctx).length);
      }
    },
    onDamageDealt(ctx, _target, dealt, arcane) {
      if (!arcane || dealt <= 3) return;
      ctx.gainLife(ctx.seat, 1);
      const cards = sigils(ctx);
      for (const card of cards) ctx.putOnDeckBottom(card.instanceId);
      if (cards.length) ctx.shuffleDeck();
    },
  };
}

function popBubble(amount: number): CardScript {
  const base = arcaneAnyTarget(amount, {
    onDamageDealt(ctx, target, dealt, arcane) {
      if (!arcane || dealt <= 3 || ctx.getCounter("lastTargetWasAlly")) return;
      const auras = ctx.player(target).board.filter((card) => isAura(ctx, card));
      if (auras.length) ctx.requestCardChoice("pop-aura", decisionPrompt("Destroy an aura permanent", "card.ros.aura.destroy"), auras.map((card) => card.instanceId));
    },
  });
  return {
    ...base,
    onChoose(ctx, hook, option) {
      if (hook === "pop-aura") ctx.destroyPermanent(Number(option));
      else base.onChoose?.(ctx, hook, option);
    },
  };
}

function saveThought(max: number): CardScript {
  const finish = (ctx: ScriptCtx) => {
    if (ctx.getCounter("saveMoved")) ctx.shuffleDeck();
    ctx.createToken(PONDER);
  };
  const offer = (ctx: ScriptCtx, remaining: number) => {
    const cards = ctx.player(ctx.seat).graveyard.filter((card) => isNonAttackAction(ctx, card));
    if (remaining <= 0 || cards.length === 0) {
      finish(ctx);
      return;
    }
    ctx.requestCardChoice(`save-thought:${remaining}`, decisionPrompt("Choose a non-attack action to shuffle, or finish", "card.ros.nonattack.shuffle", { optionMessages: commonOptionMessages("done") }), ["done", ...cards.map((card) => card.instanceId)]);
  };
  return {
    onPlay: (ctx) => offer(ctx, max),
    onChoose(ctx, hook, option) {
      const match = /^save-thought:(\d+)$/.exec(hook);
      if (!match) return;
      if (option === "done") {
        finish(ctx);
        return;
      }
      if (ctx.putOnDeckBottom(Number(option))) {
        ctx.setCounter("saveMoved", 1);
        offer(ctx, Number(match[1]) - 1);
      }
    },
  };
}

function etchings(amount: number): CardScript {
  const base = arcaneHero(amount, (ctx) => {
    const choices = ctx.player(ctx.seat).graveyard.filter((card) => isAura(ctx, card) && data(ctx, card).name.toLowerCase().includes("sigil"));
    if (choices.length) ctx.requestCardChoice("etching-sigil", decisionPrompt("Return a Sigil aura from your graveyard?", "card.ros.sigil.return", { optionMessages: commonOptionMessages("no") }), ["no", ...choices.map((card) => card.instanceId)]);
  });
  return {
    ...base,
    onChoose(ctx, hook, option) {
      if (hook === "etching-sigil") { if (option !== "no") ctx.moveToHand(Number(option)); }
      else base.onChoose?.(ctx, hook, option);
    },
  };
}

function arsenalHit(required: "attack" | "non-attack" | "instant"): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const arsenal = ctx.player(target).arsenal;
      const facedown = arsenal.find((card) => card.faceDown);
      if (facedown) ctx.turnArsenalFaceUp(facedown.instanceId);
      const matches = ctx.player(target).arsenal.filter((card) => {
        if (required === "instant") return ctx.hasCardType(card, "instant");
        if (required === "attack") return ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack");
        return ctx.hasCardType(card, "action") && !hasTag(ctx, card, "attack");
      });
      if (matches.length) ctx.requestCardChoice("arsenal-banish", decisionPrompt("Banish the matching card from arsenal", "card.ros.arsenal.matching.banish"), matches.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "arsenal-banish") ctx.banish(Number(option)); },
  };
}

export const ros: Record<string, CardScript> = {
  "florian|0": {
    replaceFriendlyTokenCreation(ctx, cardId, count) {
      return fourEarthBanished(ctx) && hasTag(ctx, { cardId, owner: ctx.seat, instanceId: -1 }, "aura") ? count + 1 : count;
    },
  },
  "rotwood reaper|0": { activated: attackAbility(2), modifyAttack: (ctx) => playedOrCreatedAura(ctx) ? 2 : 0 },
  "aurora|0": { activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.getFlag("player", "playedSubtype:lightning") === true, onActivate: (ctx) => ctx.createToken(LIGHTNING) } },
  "verdance|0": {
    onHeroGainedLife(ctx) {
      if (ctx.state.activePlayer !== ctx.seat || !fourEarthBanished(ctx)) return;
      requestAnyTarget(ctx, "verdance-target", `Verdance: deal ${ctx.previewArcaneDamage(1)} arcane damage to an opposing target?`, 1, true, true);
    },
    onChoose(ctx, hook, option) { if (hook === "verdance-target") dealToChoice(ctx, option, 1); },
  },
  "staff of verdant shoots|0": {
    activated: {
      cost: 3, isAttack: false, goAgain: true, oncePerTurn: true,
      onCostPaid(ctx, paid) { if (paid.some((card) => hasTag(ctx, card, "earth"))) ctx.setCounter("earthPitched", 1); },
      onActivate(ctx) { ampNextArcane(ctx, 1); },
    },
    onFriendlyDamageDealt(ctx, _source, _target, amount, arcane) {
      if (arcane && amount > 0 && ctx.getCounter("earthPitched")) { ctx.setCounter("earthPitched", 0); ctx.createToken(EARTH); }
    },
  },
  "pulsing aether // life|1": splitScript({ leftName: "Pulsing Aether", rightName: "Life", left: (ctx) => requestAnyTarget(ctx, "pulsing-target", `Choose a target for ${ctx.previewArcaneDamage(4)} arcane damage`, 4), right: (ctx) => ctx.gainLife(ctx.seat, 1) }),
  "oscilio|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, discardCost: { count: 1, cardTypes: ["instant"] }, onActivate: (ctx) => ctx.drawCards(ctx.seat, 1) } },
  "volzar, the lightning rod|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, modifyCost: (ctx, cost) => Math.max(0, cost - (sigils(ctx).length ? 1 : 0)), onActivate: (ctx) => ampNextArcane(ctx, Number(ctx.getFlag("player", "playedSubtypeCount:lightning")) || 0) } },
  "comet storm // shock|1": splitScript({ leftName: "Comet Storm", rightName: "Shock", left: (ctx) => requestAnyTarget(ctx, "comet-target", `Choose a target for ${ctx.previewArcaneDamage(5)} arcane damage`, 5), right: (ctx) => requestAnyTarget(ctx, "shock-target", `Choose a target for ${ctx.previewArcaneDamage(1)} arcane damage`, 1) }),

  "helm of lignum vitae|0": { modifyDefense: (ctx) => fourEarthBanished(ctx) ? 1 : 0 },
  "well grounded|0": preventEquipment(2, fourEarthBanished),
  "sigil of sanctuary|3": { optionalDamagePrevention: { amount: 1, moveSource: "destroy", arcaneOnly: true }, onLeaveArena: (ctx) => ctx.createToken(EARTH) },
  "flash of brilliance|0": {
    onDefend(ctx) {
      const lightning = ctx.player(ctx.seat).hand.filter((card) => hasTag(ctx, card, "lightning"));
      if (lightning.length) ctx.requestCardChoice("brilliance-discard", decisionPrompt("Discard a Lightning card?", "card.ros.lightning.discard", { optionMessages: commonOptionMessages("no") }), ["no", ...lightning.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "brilliance-discard" && option !== "no" && ctx.discardCard(ctx.seat, Number(option))) chooseAuraToDestroy(ctx, "brilliance-aura", "Return an aura you control to hand", "card.ros.aura.return");
      else if (hook === "brilliance-aura") ctx.moveToHand(Number(option));
    },
  },
  "twinkle toes|0": preventEquipment(2, (ctx) => ctx.getFlag("player", "playedCardType:instant") === true),
  "sigil of conductivity|3": { optionalDamagePrevention: { amount: 1, moveSource: "destroy", arcaneOnly: true }, onLeaveArena: (ctx) => ctx.createToken(LIGHTNING) },
  "bloodtorn bodice|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true, destroySelfCost: true,
      canActivate: (ctx) => ctx.player(ctx.seat).board.some((card) => isAura(ctx, card)),
      effectCardCosts: [{
        zone: "arena", move: "destroy", count: 1, subtype: "aura",
        prompt: "Bloodtorn Bodice: choose an aura to destroy as a cost",
      }],
      effectCardCostChoiceHook: "bloodtorn-cost",
      onActivate(ctx) { ctx.changeResources(ctx.seat, 1); },
    },
  },
  "runehold release|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate: (ctx) => ctx.createToken(RUNECHANT) } },
  "ink-lined cloak|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => sigils(ctx).length > 0, onActivate: (ctx) => ctx.changeResources(ctx.seat, 1) } },
  "hold focus|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate: (ctx) => ampNextArcane(ctx, 1) } },

  "sigil of the arknight|3": beginningAura(undefined, (ctx) => {
    const top = ctx.player(ctx.seat).deck[0];
    if (!top) return;
    ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`);
    if (isAttackAction(ctx, top)) ctx.moveToHand(top.instanceId);
  }),
  "sigil of deadwood|3": beginningAura(undefined, (ctx) => ctx.createToken(RUNECHANT)),
  "sigil of temporal manipulation|3": beginningAura(undefined, (ctx) => {
    const top = ctx.player(ctx.seat).deck[0];
    if (!top || !ctx.banish(top.instanceId) || !isNonAttackAction(ctx, top)) return;
    ctx.allowPlayFrom(top.instanceId, "banish");
    ctx.setFlag("player", `asInstant:${top.instanceId}`, true);
  }),
  "sigil of forethought|3": beginningAura(undefined, (ctx) => ctx.createToken(PONDER)),
  "sigil of cycles|3": beginningAura(undefined, (ctx) => {
    const hand = ctx.player(ctx.seat).hand;
    if (hand.length) ctx.requestCardChoice("cycles-discard", decisionPrompt("Discard a card", "card.ros.card.discard"), hand.map((card) => card.instanceId));
  }),
  "sigil of fyendal|3": beginningAura(undefined, (ctx) => ctx.gainLife(ctx.seat, 1)),
  "sigil of earth|3": beginningAura(undefined, (ctx) => ctx.createToken(EARTH)),
  "sigil of lightning|3": beginningAura(undefined, (ctx) => ctx.createToken(LIGHTNING)),
};

for (const pitch of [1, 2, 3]) {
  ros[`earth form|${pitch}`] = earthForm();
  ros[`summer's fall|${pitch}`] = summersFall();
  ros[`rootbound carapace|${pitch}`] = decompose("play", (ctx) => { ctx.addCardTempDefense(ctx.self.instanceId, 1); });
  ros[`blossoming decay|${pitch}`] = decompose("attack", (ctx) => ctx.gainLife(ctx.seat, 1));
  ros[`cadaverous tilling|${pitch}`] = decompose("attack", (ctx) => ctx.addCardTempPower(ctx.self.instanceId, 2));
  ros[`fruits of the forest|${pitch}`] = fruitsOfForest();
  ros[`strength of four seasons|${pitch}`] = { modifyAttack: (ctx) => fourEarthBanished(ctx) ? 4 : 0 };
  ros[`lightning form|${pitch}`] = lightningForm();
  ros[`flittering charge|${pitch}`] = {
    onAttackDeclared: (ctx) => ctx.addModifier({ scope: "combat-chain" }),
    triggers: [{
      event: "card-played",
      label: "Gain go again",
      condition: (ctx, played) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
        !!played &&
        ctx.hasCardType(played, "instant"),
      effect: (ctx) => ctx.grantGoAgain(),
    }],
  };
  ros[`trip the light fantastic|${pitch}`] = handPrevention(2);
  ros[`splintering deadwood|${pitch}`] = splinteringDeadwood();
  ros[`vantage point|${pitch}`] = { onAttackDeclared: (ctx) => { if (playedOrCreatedAura(ctx)) ctx.grantCardKeyword(ctx.self.instanceId, "overpower"); } };
  ros[`arcanic spike|${pitch}`] = { modifyAttack: (ctx) => ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true ? 2 : 0 };
  ros[`hocus pocus|${pitch}`] = { onAttackDeclared: (ctx) => ctx.createToken(RUNECHANT) };
  ros[`arcane cussing|${pitch}`] = arcaneCussing(4 - pitch);
  ros[`deadwood dirge|${pitch}`] = deadwoodDirge(4 - pitch);
  if (pitch !== 3) ros[`arcane twining|${pitch}`] = { ...arcaneAnyTarget(4 - pitch), activated: ampFromHand().activated };
  ros[`etchings of arcana|${pitch}`] = etchings(4 - pitch);
  ros[`exploding aether|${pitch}`] = { onPlay: (ctx) => ampNextArcane(ctx, 4 - pitch) };
  if (pitch !== 3) ros[`open the flood gates|${pitch}`] = arcaneHero(4 - pitch, (ctx) => ctx.drawCards(ctx.seat, 2));
  const bloom = arcaneHero(4 - pitch, (ctx) => ctx.setCounter("surged", 1));
  ros[`perennial aetherbloom|${pitch}`] = { ...bloom, graveyardReplacement: (ctx) => ctx.getCounter("surged") ? "bottom-of-deck" : undefined };
  ros[`overflow the aetherwell|${pitch}`] = arcaneHero(4 - pitch, (ctx) => ctx.changeResources(ctx.seat, 2));
  ros[`trailblazing aether|${pitch}`] = arcaneHero(4 - pitch, (ctx) => ctx.gainActionPoint());
  ros[`count your blessings|${pitch}`] = { onPlay(ctx) { const copies = ctx.player(ctx.seat).graveyard.filter((card) => data(ctx, card).name === "Count Your Blessings").length; ctx.gainLife(ctx.seat, 4 - pitch + copies); } };
  if (pitch !== 1) ros[`arcane polarity|${pitch}`] = { onPlay: (ctx) => ctx.gainLife(ctx.seat, ctx.getFlag("player", "arcaneDamageTakenThisTurn") === true ? 5 - pitch : 1) };
}

for (const [pitch, amount] of [[1, 3], [2, 2], [3, 1]] as const) {
  ros[`harvest season|${pitch}`] = beginningAura((ctx) => ctx.gainLife(ctx.seat, amount));
  ros[`strong yield|${pitch}`] = beginningAura((ctx) => buffNextAttack(ctx, { attack: amount }));
  ros[`fertile ground|${pitch}`] = { onPlay: (ctx) => ctx.gainLife(ctx.seat, fourEarthBanished(ctx) ? amount + 2 : 2) };
  ros[`electrostatic discharge|${pitch}`] = conditionalNextAttack(amount);
  ros[`chorus of the amphitheater|${pitch}`] = chorus(amount + 1);
  ros[`glyph overlay|${pitch}`] = glyphOverlay(amount);
  ros[`pop the bubble|${pitch}`] = popBubble(amount);
  ros[`save the thought|${pitch}`] = saveThought(amount);
  if (pitch !== 3) ros[`photon splicing|${pitch}`] = { ...arcaneAnyTarget(amount + 1), activated: ampFromHand().activated };
}

for (const pitch of [2, 3]) {
  ros[`second strike|${pitch}`] = { onAttackDeclared(ctx) { if (ctx.getFlag("player", "dealtDamageThisTurn") === true) { ctx.addCardTempPower(ctx.self.instanceId, 1); ctx.grantGoAgain(); } } };
  ros[`hit the high notes|${pitch}`] = { modifyAttack: (ctx) => playedOrCreatedAura(ctx) ? 2 : 0 };
  ros[`runerager swarm|${pitch}`] = { onAttackDeclared: (ctx) => { if (playedOrCreatedAura(ctx)) ctx.grantGoAgain(); } };
}

ros["condemn to slaughter|2"] = {
  onPlay(ctx) { buffNextAttack(ctx, { attack: 2, appliesToClass: "runeblade" }); chooseAuraToDestroy(ctx, "condemn-own", "Destroy an aura you control?", "card.ros.aura.destroy.own", true); },
  onChoose(ctx, hook, option) {
    if (hook === "condemn-own" && option !== "no" && ctx.destroyPermanent(Number(option))) {
      const opposing = ctx.player(opponentSeat(ctx)).board.filter((card) => isAura(ctx, card));
      if (opposing.length) ctx.requestCardChoice("condemn-opposing", decisionPrompt("Destroy an aura you control", "card.ros.aura.destroy.own"), opposing.map((card) => card.instanceId), opponentSeat(ctx));
    } else if (hook === "condemn-opposing") ctx.destroyPermanent(Number(option));
  },
};
ros["malefic incantation|3"] = maleficIncantation(1);

for (const pitch of [1, 2, 3]) {
  ros[`blast to oblivion|${pitch}`] = {
    onAttackDeclared(ctx) { ctx.setCounter("blastArmed", 1); ctx.addModifier({ scope: "chain-link" }); },
    triggers: [{
      event: "card-played",
      label: "Return an eligible aura to its owner's hand?",
      condition: (ctx, played) => ctx.getCounter("blastArmed") > 0 &&
        !!played &&
        ctx.hasCardType(played, "instant"),
      onTrigger: (ctx) => ctx.setCounter("blastArmed", 0),
      effect(ctx) {
      const auras = ctx.state.players.flatMap((player) => player.board).filter((card) => isAura(ctx, card) && ((data(ctx, card).cost ?? 0) <= 1 || data(ctx, card).cardType === "token"));
      if (auras.length) ctx.requestCardChoice("blast-aura", decisionPrompt("Return an eligible aura to its owner's hand?", "card.ros.aura.return.eligible", { optionMessages: commonOptionMessages("no") }), ["no", ...auras.map((card) => card.instanceId)]);
      },
    }],
    onChoose(ctx, hook, option) { if (hook === "blast-aura" && option !== "no") ctx.moveToHand(Number(option)); },
  };
}

for (const [pitch, minimum] of [[1, 0], [2, 1], [3, 2]] as const) {
  ros[`electromagnetic somersault|${pitch}`] = {
    onPlay(ctx) {
      const link = ctx.link;
      if (!link) return;
      const cards = [link.attackingCard, ...link.defendingCards].filter((card) => isAttackAction(ctx, card) && (data(ctx, card).cost ?? 0) >= minimum);
      if (cards.length) ctx.requestCardChoice("somersault:2", decisionPrompt("Choose up to 2 attack actions to return when the link resolves", "card.ros.attack.return.upto", { values: { count: 2 }, optionMessages: commonOptionMessages("done") }), ["done", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      const match = /^somersault:(\d+)$/.exec(hook);
      if (!match || option === "done") return;
      const id = Number(option);
      ctx.setCardCounter(id, "returnToHandAtLinkResolution", 1);
      const remaining = Number(match[1]) - 1;
      if (remaining <= 0 || !ctx.link) return;
      const cards = [ctx.link.attackingCard, ...ctx.link.defendingCards].filter((card) => card.instanceId !== id && isAttackAction(ctx, card) && (data(ctx, card).cost ?? 0) >= minimum && !card.counters?.returnToHandAtLinkResolution);
      if (cards.length) ctx.requestCardChoice(`somersault:${remaining}`, decisionPrompt("Choose another attack action, or finish", "card.ros.attack.return.next", { optionMessages: commonOptionMessages("done") }), ["done", ...cards.map((card) => card.instanceId)]);
    },
  };
}

// Adult heroes and high-rarity cards from the complete ROS release.
ros["florian, rotwood harbinger|0"] = ros["florian|0"]!;
ros["verdance, thorn of the rose|0"] = ros["verdance|0"]!;
ros["oscilio, constella intelligence|0"] = ros["oscilio|0"]!;

Object.assign(ros, {
  "will of arcana|3": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Amp 1", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect: (ctx: ScriptCtx) => ampNextArcane(ctx, 1) }] },
  "germinate|3": {
    variablePlayCost: { base: 0, resourcesPerX: 2, counterKey: "germinateX", prompt: "Choose X" },
    onPlay(ctx: ScriptCtx) {
      const count = ctx.getCounter("germinateX") + 1;
      ctx.setCounter("germinateRemaining", count);
      ctx.requestChoice("germinate-token", decisionPrompt("Create which token?", "card.ros.token.create", { optionMessages: { Runechant: decisionMessage("card.ros.option.runechant"), "Embodiment of Earth": decisionMessage("card.ros.option.earth") } }), ["Runechant", "Embodiment of Earth"]);
    },
  },
  "thistle bloom // life|2": {
    meld: {
      leftName: "Thistle Bloom",
      rightName: "Life",
      leftCardType: "action",
      rightCardType: "instant",
    },
    onPlay(ctx: ScriptCtx) {
      if (ctx.self.meldSide !== "left") ctx.gainLife(ctx.seat, 1);
      if (ctx.self.meldSide !== "right") createRunechants(ctx, Number(ctx.getPlayerFlag(ctx.seat, "lifeGainedThisTurn")));
    },
  },
  "vaporize // shock|2": {
    meld: {
      leftName: "Vaporize",
      rightName: "Shock",
      leftCardType: "action",
      rightCardType: "instant",
    },
    arcaneDamageEffect: true,
    onPlay(ctx: ScriptCtx) {
      if (ctx.self.meldSide !== "left") requestAnyTarget(ctx, "vaporize-shock", `Choose a target for ${ctx.previewArcaneDamage(1)} arcane damage`, 1);
      if (ctx.self.meldSide === "left" || ctx.self.meldSide === "both") {
        const x = Number(ctx.getPlayerFlag(ctx.seat, `arcaneDamageAmountToSeat:${opponentSeat(ctx)}`));
        const auras = ctx.state.players.flatMap((player) => player.board).filter((card) => isAura(ctx, card) && ((data(ctx, card).cost ?? 0) <= x || data(ctx, card).cardType === "token"));
        if (auras.length) ctx.requestCardChoice("vaporize-aura", decisionPrompt("Destroy an eligible aura", "card.ros.aura.destroy.eligible", { optionMessages: commonOptionMessages("done") }), ["done", ...auras.map((card) => card.instanceId)]);
      }
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "vaporize-shock") dealToChoice(ctx, option, 1); else if (hook === "vaporize-aura" && option !== "done") ctx.destroyPermanent(Number(option)); },
  },
  "heartbeat of candlehold|3": { onPlay(ctx: ScriptCtx) { ctx.gainLife(ctx.seat, 1); ctx.gainLife(ctx.seat, 1); ctx.gainLife(ctx.seat, 1); } },
  "rampant growth // life|2": {
    meld: {
      leftName: "Rampant Growth",
      rightName: "Life",
      leftCardType: "action",
      rightCardType: "instant",
    },
    onPlay(ctx: ScriptCtx) { if (ctx.self.meldSide !== "left") ctx.gainLife(ctx.seat, 1); if (ctx.self.meldSide !== "right") ampNextArcane(ctx, Number(ctx.getPlayerFlag(ctx.seat, "lifeGainedThisTurn"))); },
  },
  "sigil of brilliance|2": beginningAura(undefined, (ctx) => ctx.drawCards(ctx.seat, 1)),
  "null // shock|2": {
    meld: {
      leftName: "Null",
      rightName: "Shock",
      leftCardType: "action",
      rightCardType: "instant",
    },
    arcaneDamageEffect: true,
    onPlay(ctx: ScriptCtx) { if (ctx.self.meldSide !== "left") requestAnyTarget(ctx, "null-shock", `Choose a target for ${ctx.previewArcaneDamage(1)} arcane damage`, 1); },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "null-shock") dealToChoice(ctx, option, 1); },
  },
  "sanctuary of aria|0": { activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", onActivate: (ctx: ScriptCtx) => { ctx.preventNextDamage(ctx.seat, 1); ctx.destroyAtEndPhase(ctx.self.instanceId); } } },
  "barkskin of the millennium tree|0": { canTriggerOnDefend: fourEarthBanished, onDefend(ctx: ScriptCtx) { if (fourEarthBanished(ctx)) ctx.createToken(EARTH); } },
  "felling of the crown|1": fellingOfTheCrown(),
  "plow under|2": { modifyAttack: (ctx: ScriptCtx) => fourEarthBanished(ctx) ? 4 : 0, ...decompose("attack", (ctx) => { for (const player of ctx.state.players) for (const card of player.arsenal) ctx.putOnDeckBottom(card.instanceId); }) },
  "channel the millennium tree|1": { onEnterArena: (ctx: ScriptCtx) => ampNextArcane(ctx, 3), triggers: [{ event: "begin-action-phase", label: "Amp 3", effect: (ctx: ScriptCtx) => ampNextArcane(ctx, 3) }] },
  "earth's embrace|3": { triggers: [{ event: "end-of-turn", label: "Create Embodiment of Earth", effect(ctx: ScriptCtx) { ctx.createToken(EARTH); if (ctx.getFlag("player", "banishedSubtype:earth") !== true) ctx.destroySelf(); } }] },
  "seeds of tomorrow|3": { additionalCost(ctx: ScriptCtx) { const arsenal = ctx.player(ctx.seat).arsenal; if (arsenal.length) ctx.requestCardChoice("seeds-arsenal", decisionPrompt("Put an arsenal card on the bottom", "card.ros.arsenal.card.bottom"), arsenal.map((card) => card.instanceId)); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "seeds-arsenal") ctx.putOnDeckBottom(Number(option)); }, onPlay: (ctx: ScriptCtx) => ctx.preventNextDamage(ctx.seat, 5) },
  "lightning greaves|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate: (ctx: ScriptCtx) => ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesToCardType: "instant" }) } },
  "current funnel|3": { onAttackDeclared(ctx: ScriptCtx) { if (ctx.getFlag("player", "lastActionWasType:lightning") === true) { ctx.grantGoAgain(); ctx.addModifier({ scope: "next-play", grantKeyword: "go again", appliesToCardType: "action" }); } } },
  "eclectic magnetism|1": { onAttackDeclared: (ctx: ScriptCtx) => ctx.allowAbilitiesAsInstant("action") },
  "gone in a flash|1": {
    onAttackDeclared(ctx: ScriptCtx) {
      ctx.setCounter("goneInAFlashReady", 1);
      // Keep this attack observable as a card-play trigger source while it is
      // on the combat chain rather than in a player's permanent zone.
      ctx.addModifier({ scope: "combat-chain" });
    },
    triggers: [{
      event: "card-played",
      label: "Return this to its owner's hand?",
      optional: true,
      defaultOption: "yes",
      condition(ctx: ScriptCtx, played?: DeepReadonly<CardInstance>) {
        return !!played &&
          ctx.getCounter("goneInAFlashReady") > 0 &&
          ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
          ctx.link.flags.resolutionStepBegan !== true &&
          ctx.hasCardType(played, "instant");
      },
      onTrigger(ctx: ScriptCtx) {
        ctx.setCounter("goneInAFlashReady", 0);
      },
      effect(ctx: ScriptCtx) {
        ctx.returnSelfToHand();
      },
    }],
  },
  "channel lightning valley|2": { onFriendlyDamageDealt(ctx: ScriptCtx, _source: DeepReadonly<CardInstance>, target: number, amount: number) { const key = `valley:${ctx.state.turn}`; if (target !== ctx.seat && amount > 0 && !ctx.getCounter(key)) { ctx.setCounter(key, 1); ctx.drawCards(ctx.seat, 1); } } },
  "high voltage|3": { onPlay: (ctx: ScriptCtx) => ampNextArcane(ctx, 1) },
  "face purgatory|0": { canTriggerOnDefend(ctx: ScriptCtx) { const cards = ctx.link?.defendingCards ?? []; return cards.some((card) => isAttackAction(ctx, card)) && cards.some((card) => isNonAttackAction(ctx, card)); }, onDefend(ctx: ScriptCtx) { if (!requestDiscardChoice(ctx, "face-purgatory-discard", "Choose a card to discard", opponentSeat(ctx))) ctx.drawCards(ctx.seat, 1); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "face-purgatory-discard") { resolveDiscardChoice(ctx, option, opponentSeat(ctx)); ctx.drawCards(ctx.seat, 1); } } },
  "snuff out|1": { canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined, onHit(ctx: ScriptCtx) { chooseAuraToDestroy(ctx, "snuff-aura", "Destroy an aura you control?", "card.ros.aura.destroy.own", true); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "snuff-aura" && option !== "no" && ctx.destroyPermanent(Number(option))) requestDiscardChoice(ctx, "snuff-discard", decisionPrompt("Choose a card to discard", "card.ros.card.discard"), opponentSeat(ctx)); else if (hook === "snuff-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx)); } },
  "machinations of dominion|3": { onPlay: (ctx: ScriptCtx) => buffNextAttack(ctx, { grantKeyword: "overpower", goAgainIfPlayedOrCreatedSubtype: "aura", appliesToClass: "runeblade", appliesTo: "attack-action" }) },
  "succumb to temptation|2": {
    playAsInstant: (ctx: ScriptCtx) =>
      ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true,
    onPlay(ctx: ScriptCtx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesTo: "attack-action",
        appliesToClass: "runeblade",
        once: true,
        ongoingLabel: "next Runeblade attack-action hit: look at their hand and discard a card",
        onHitScriptHook: {
          hook: "succumb-hit",
          label: "look at their hand and choose a card for them to discard",
          heroOnly: true,
        },
      });
    },
    onGrantedHit(ctx: ScriptCtx, hook: string) {
      if (hook !== "succumb-hit") return;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      for (const card of hand) ctx.lookAt(card.instanceId);
      if (hand.length) {
        ctx.requestCardChoice(
          "succumb-discard",
          decisionPrompt("Look at their hand and choose a card — they discard it", "card.ros.opponent.hand.discard"),
          hand.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook === "succumb-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  },
  "haunting rendition|1": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx: ScriptCtx) { ctx.preventNextDamage(ctx.seat, 2); ctx.createToken(RUNECHANT); } } },
  "aether bindings of the third age|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate: (ctx: ScriptCtx) => ctx.addModifier({ scope: "until-end-of-turn" }),
    },
    triggers: [{
      event: "card-left-arena",
      label: "Amp 1",
      condition: (ctx, left) => !!left && isAura(ctx, left) && data(ctx, left).name.toLowerCase().includes("sigil"),
      effect: (ctx: ScriptCtx) => ampNextArcane(ctx, 1),
    }],
  },
  "destructive aethertide|3": arcaneAnyTarget(1, { onDamageDealt(ctx: ScriptCtx, target: number, dealt: number, arcane: boolean) { if (!arcane || dealt <= 1) return; const arsenal = ctx.player(target).arsenal; if (arsenal.length) ctx.destroyPermanent(arsenal[0]!.instanceId); } }),
  "eternal inferno|1": { ...arcaneAnyTarget(4), onDamageDealt(ctx: ScriptCtx, _target: number, dealt: number, arcane: boolean) { if (arcane && dealt > 4 && ctx.banish(ctx.self.instanceId)) ctx.allowPlayFrom(ctx.self.instanceId, "banish"); } },
  "sigil of aether|3": {
    ...beginningAura(undefined, (ctx) => {
      const amount = ctx.previewArcaneDamage(1);
      requestAnyTarget(ctx, "sigil-aether-target", `Deal ${amount} arcane damage to a target`, 1);
    }),
    onChoose(ctx, hook, option) {
      if (hook === "sigil-aether-target") dealToChoice(ctx, option, 1);
    },
    onDamageDealt(ctx, _target, dealt, arcane) {
      if (arcane && dealt > 0) ampNextArcane(ctx, 1);
    },
  },
  "mental block|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx: ScriptCtx) { ctx.preventNextDamage(ctx.seat, 2); ctx.createToken(PONDER); } } },
  "arcanite fortress|0": { modifyDefense: (ctx: ScriptCtx) => Object.values(ctx.player(ctx.seat).equipment).filter((card) => card && data(ctx, card).name.includes("Arcanite")).length, wardValue: (ctx: ScriptCtx) => Object.values(ctx.player(ctx.seat).equipment).filter((card) => card && data(ctx, card).name.includes("Arcanite")).length },
  "cut through the facade|1": { canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined, onHit(ctx: ScriptCtx) { const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => isAura(ctx, card)); if (auras.length) ctx.requestCardChoice("facade-aura", decisionPrompt("Destroy an aura", "card.ros.aura.destroy", { optionMessages: commonOptionMessages("no") }), ["no", ...auras.map((card) => card.instanceId)]); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "facade-aura" && option !== "no") ctx.destroyPermanent(Number(option)); } },
  "ten foot tall and bulletproof|1": { onAttackDeclared: (ctx: ScriptCtx) => ctx.setPlayerFlag(ctx.seat, "intellectPenaltyNextEnd", Number(ctx.getPlayerFlag(ctx.seat, "intellectPenaltyNextEnd")) + 2), onDefend: (ctx: ScriptCtx) => ctx.setPlayerFlag(ctx.seat, "intellectPenaltyNextEnd", Number(ctx.getPlayerFlag(ctx.seat, "intellectPenaltyNextEnd")) + 2) },
  "truce|3": { onEnterArena: (ctx: ScriptCtx) => ctx.setCounter("opponent", opponentSeat(ctx)), triggers: [{ event: "end-of-turn", whose: "any", condition: (ctx: ScriptCtx) => ctx.state.activePlayer === ctx.getCounter("opponent"), label: "Both heroes gain 3 life", effect(ctx: ScriptCtx) { ctx.destroySelf(); ctx.gainLife(ctx.seat, 3); ctx.gainLife(opponentSeat(ctx), 3); } }] },
  "widow veil respirator|0": {}, "widow back abdomen|0": {}, "widow claw tarsus|0": {}, "widow web crawler|0": {},
  "splatter skull|1": { canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined, onHit(ctx: ScriptCtx) { const cards = ctx.player(opponentSeat(ctx)).banish.filter((card) => card.intimidated === true); if (cards.length) ctx.requestCardChoice("splatter-card", decisionPrompt("Put an intimidated card in graveyard", "card.ros.intimidated.card.graveyard"), cards.map((card) => card.instanceId)); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "splatter-card") ctx.moveToGraveyard(Number(option), "banish"); } },
  "drink 'em under the table|1": {
    triggers: [{ event: "attack-declared", sourceZone: "self", optional: true, label: "Wager with the defending hero?", condition: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined, effect: (ctx: ScriptCtx) => ctx.wager(opponentSeat(ctx), [], "Winner draws a card and the other hero discards a card") }],
    onWagerResolved(ctx: ScriptCtx, winner: number) {
      ctx.drawCards(winner, 1);
      const loser = winner === ctx.seat ? opponentSeat(ctx) : ctx.seat;
      ctx.setCounter("drink-loser", loser);
      requestDiscardChoice(ctx, "drink-discard", decisionPrompt("Choose a card to discard", "card.ros.card.discard"), loser);
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "drink-discard") resolveDiscardChoice(ctx, option, ctx.getCounter("drink-loser")); },
  },
  "gustwave of the second wind|1": { onAttackDeclared(ctx: ScriptCtx) { if (previousAttackHasName(ctx, "surging strike")) ctx.grantGoAgain(); } },
  "adaptive dissolver|0": {},
  "plan for the worst|3": { onPlay(ctx: ScriptCtx) {
    const target = ctx.player(opponentSeat(ctx));
    for (const card of [...target.hand, ...target.arsenal]) ctx.lookAt(card.instanceId);
    // "At the beginning of their next end phase, they discard all cards in
    // their hand and destroy all cards in their arsenal." — the shared
    // end-phase wipe consumed in endTurn()
    ctx.setCardCounter(target.hero.instanceId, "clearHandAndArsenalAtEndPhaseTurn", ctx.state.turn + 1);
    const traps = ctx.player(ctx.seat).deck.filter((card) => hasTag(ctx, card, "trap")).slice(0, 3);
    if (traps.length) ctx.revealCards(traps.map((card) => card.instanceId));
    for (const card of traps) ctx.moveToHand(card.instanceId);
    ctx.shuffleDeck();
  } },
  "unsheathed|1": { onPlay: (ctx: ScriptCtx) => buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" }) },
  "calming cloak|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate: (ctx: ScriptCtx) => ctx.addModifier({ scope: "next-play", playCostReduction: 2, appliesToSubtype: "aura" }) } },
  "calming gesture|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate: (ctx: ScriptCtx) => ctx.createToken(SPECTRAL_SHIELD) } },
  "fluttersteps|0": { onDestroyed: (ctx: ScriptCtx) => ctx.setPlayerFlag(ctx.seat, "nextAuraAsInstant", true) },
  "dust from the fertile fields|1": { materialKeywords: ["phantasm"] },
  "regrowth // shock|3": {
    meld: {
      leftName: "Regrowth",
      rightName: "Shock",
      leftCardType: "action",
      rightCardType: "instant",
    },
    arcaneDamageEffect: true,
    onPlay(ctx: ScriptCtx) { if (ctx.self.meldSide !== "left") requestAnyTarget(ctx, "regrowth-shock", `Choose a target for ${ctx.previewArcaneDamage(1)} arcane damage`, 1); if (ctx.self.meldSide !== "right") { const x = Number(ctx.getPlayerFlag(ctx.seat, `arcaneDamageAmountToSeat:${opponentSeat(ctx)}`)); const cards = ctx.player(ctx.seat).graveyard.filter((card) => isAttackAction(ctx, card) && (data(ctx, card).cost ?? 0) < x); if (cards.length) ctx.requestCardChoice("regrowth-card", decisionPrompt("Return an attack action", "card.ros.attack.return"), cards.map((card) => card.instanceId)); } },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "regrowth-shock") dealToChoice(ctx, option, 1); else if (hook === "regrowth-card") ctx.moveToHand(Number(option)); },
  },
} satisfies Record<string, CardScript>);

ros["germinate|3"]!.onChoose = (ctx, hook, option) => {
  if (hook === "germinate-token") {
    ctx.createToken(option === "Runechant" ? RUNECHANT : EARTH);
    const remaining = ctx.getCounter("germinateRemaining") - 1;
    ctx.setCounter("germinateRemaining", remaining);
    if (remaining > 0) ctx.requestChoice("germinate-token", decisionPrompt("Create which token?", "card.ros.token.create", { optionMessages: { Runechant: decisionMessage("card.ros.option.runechant"), "Embodiment of Earth": decisionMessage("card.ros.option.earth") } }), ["Runechant", "Embodiment of Earth"]);
    else ctx.gainLife(ctx.seat, Number(ctx.getCounter("germinateX")) + 1);
    return;
  }
};

for (const name of ["hood of second thoughts", "bruised leather", "four finger gloves"]) {
  ros[`${name}|0`] = preventEquipment(1, (ctx) => ctx.getFlag("player", "damageTakenThisTurn") === true);
}
ros["hand behind the pen|1"] = arsenalHit("non-attack");
ros["smash up|1"] = arsenalHit("attack");
ros["tongue tied|1"] = arsenalHit("instant");

const cycles = ros["sigil of cycles|3"]!;
cycles.onChoose = (ctx, hook, option) => { if (hook === "cycles-discard" && ctx.discardCard(ctx.seat, Number(option))) ctx.drawCards(ctx.seat, 1); };

const pulsing = ros["pulsing aether // life|1"]!;
pulsing.arcaneDamageEffect = true;
pulsing.onChoose = (ctx, hook, option) => { if (hook === "pulsing-target") dealToChoice(ctx, option, 4); };
const comet = ros["comet storm // shock|1"]!;
comet.arcaneDamageEffect = true;
comet.onChoose = (ctx, hook, option) => {
  if (hook === "comet-target") dealToChoice(ctx, option, 5);
  else if (hook === "shock-target") dealToChoice(ctx, option, 1);
};
