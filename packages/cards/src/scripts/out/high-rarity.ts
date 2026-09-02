import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, commonOptionMessages, decisionMessage, decisionPrompt, opponentSeat, previousAttackHasName, yesNoPrompt } from "../shared-helpers.js";

const BLOODROT = "SAZ034";
const FRAILTY = "SAZ035";
const INERTIA = "SAZ036";
const PONDER = "DYN244";
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean { return ctx.cardTypes(card).includes(type); }
function namedCard(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean { return ctx.cardNames(card).includes(name.toLowerCase()); }
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean { return ctx.hasCardType(card, "action") && has(ctx, card, "attack"); }
function dagger(extra: CardScript = {}): CardScript { return { ...extra, activated: { cost: 2, isAttack: true, goAgain: true, oncePerTurn: true }, onAttackDeclared(ctx) { extra.onAttackDeclared?.(ctx); } }; }
function arsenalFromHand(ctx: ScriptCtx, hook: string, filter = (_card: DeepReadonly<CardInstance>) => true): void { const cards = ctx.player(ctx.seat).hand.filter(filter); if (cards.length) ctx.requestCardChoice(hook, decisionPrompt("Choose a card for arsenal", "card.out.arsenal.card.choose", { optionMessages: commonOptionMessages("no") }), ["no", ...cards.map((card) => card.instanceId)]); }
function chooseDiscard(ctx: ScriptCtx, hook: string, seat: number): void { const hand = ctx.player(seat).hand; if (hand.length) ctx.requestCardChoice(hook, decisionPrompt("Choose a card to discard", "card.common.card.discard.choose"), hand.map((card) => card.instanceId), seat); }
function graveyardChest(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    triggers: [{
      event: "start-of-turn", whose: "subject", sourceZone: "graveyard", optional: true,
      condition(ctx) { return ctx.player(ctx.seat).board.filter((card) => ctx.cardData(card.cardId).name === "Silver").length >= 2; },
      label: "Destroy 2 Silvers to equip this?",
      effect(ctx) {
        const silvers = ctx.player(ctx.seat).board.filter((card) => ctx.cardData(card.cardId).name === "Silver").slice(0, 2);
        if (silvers.length === 2 && silvers.every((card) => ctx.destroyPermanent(card.instanceId))) ctx.equipFromGraveyard(ctx.self.instanceId);
      },
    }],
  };
}
function combo(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "combo");
}
function flickKnivesDaggers(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  const activeAttackId = ctx.link?.attackingCard.instanceId;
  const candidates = [
    ...ctx.player(ctx.seat).weapons,
    ...ctx.player(ctx.seat).board,
    ...ctx.state.chain
      .filter((link) => link.attacker === ctx.seat && link.flags.attackGone !== true)
      .map((link) => link.attackingCard),
  ];
  return candidates.filter((card, index) =>
    card.instanceId !== activeAttackId &&
    has(ctx, card, "dagger") &&
    candidates.findIndex((candidate) => candidate.instanceId === card.instanceId) === index
  );
}
function codexBloodrotChoice(ctx: ScriptCtx, seat: number): void {
  if (seat > 1) { ctx.createToken(PONDER); ctx.createToken(BLOODROT, opponentSeat(ctx)); return; }
  const player = ctx.player(seat);
  if (!player.hand.length || player.arsenal.length) return codexBloodrotChoice(ctx, seat + 1);
  ctx.requestCardChoice(`codex-bloodrot:${seat}`, decisionPrompt("Choose a card for arsenal", "card.out.arsenal.card.choose"), player.hand.map((card) => card.instanceId), seat);
}
function codexFrailtyChoice(ctx: ScriptCtx, seat: number): void {
  if (seat > 1) {
    const first = [0, 1].find((target) => ctx.getCounter(`codexFrailtyMoved:${target}`) > 0 && ctx.player(target).hand.length);
    if (first !== undefined) chooseDiscard(ctx, `codex-frailty-discard:${first}`, first);
    else { ctx.createToken(PONDER); ctx.createToken(FRAILTY, opponentSeat(ctx)); }
    return;
  }
  const player = ctx.player(seat);
  const attacks = player.graveyard.filter((card) => isAttack(ctx, card));
  if (!attacks.length || player.arsenal.length) return codexFrailtyChoice(ctx, seat + 1);
  ctx.requestCardChoice(`codex-frailty:${seat}`, decisionPrompt("Choose an attack for arsenal", "card.out.arsenal.attack.choose"), attacks.map((card) => card.instanceId), seat);
}

const UZURI_BANISHED_CARD = "uzuriBanishedCard";

export const uzuriAbility: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    oncePerTurn: true,
    timing: "attack-reaction",
    label: "Swap a stealth attack",
    effectCardCosts: [{
      zone: "hand",
      move: "banish",
      count: 1,
      faceDown: true,
      prompt: decisionPrompt("Banish a card from hand face down", "card.common.cost.hand.banishfacedown"),
    }],
    canActivate: (ctx) => !!ctx.link &&
      ctx.link.attacker === ctx.seat &&
      ctx.link.attackCardType === "action" &&
      (ctx.cardData(ctx.link.attackingCard.cardId).keywords ?? [])
        .some((keyword) => keyword.toLowerCase() === "stealth") &&
      ctx.player(ctx.seat).hand.length > 0,
    onCostPaid(ctx, paidCards) {
      ctx.setFlag("player", UZURI_BANISHED_CARD, paidCards.at(-1)?.instanceId ?? 0);
    },
    onActivate(ctx) {
      const instanceId = Number(ctx.getFlag("player", UZURI_BANISHED_CARD));
      ctx.setFlag("player", UZURI_BANISHED_CARD, false);
      const card = ctx.player(ctx.seat).banish.find((candidate) => candidate.instanceId === instanceId);
      if (!card || !ctx.setCardFaceDown(instanceId, false)) return;
      ctx.logPublic(`${ctx.cardData(card.cardId).name} is turned face up`);
      ctx.replaceAttackFromBanish(instanceId, 2);
    },
  },
};

export const outHighRarity: Record<string, CardScript> = {
  "plague hive|2": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Create a random adverse aura", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx) { const tokens = [BLOODROT, FRAILTY, INERTIA]; ctx.createToken(tokens[ctx.randomInt(tokens.length)]!, opponentSeat(ctx)); } }] },
  "uzuri, switchblade|0": uzuriAbility,
  "nerve scalpel|0": dagger({
    canTriggerOnHit(ctx) { return !!ctx.link && ctx.link.targetAllyId === undefined && ctx.link.attackingCard.instanceId === ctx.self.instanceId; },
    onHit(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), defense: -1, appliesToCardType: "reaction", once: true }); },
    onEffectHit(ctx, targetSeat) { ctx.addModifier({ scope: "until-end-of-turn", seat: targetSeat, defense: -1, appliesToCardType: "reaction", once: true }); },
  }),
  "orbitoclast|0": dagger({
    canTriggerOnHit(ctx) { return !!ctx.link && ctx.link.targetAllyId === undefined && ctx.link.attackingCard.instanceId === ctx.self.instanceId; },
    onHit(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), defense: -1, appliesToCardType: "action", excludesSubtype: "attack", once: true }); },
    onEffectHit(ctx, targetSeat) { ctx.addModifier({ scope: "until-end-of-turn", seat: targetSeat, defense: -1, appliesToCardType: "action", excludesSubtype: "attack", once: true }); },
  }),
  "scale peeler|0": dagger({
    canTriggerOnHit(ctx) { return !!ctx.link && ctx.link.targetAllyId === undefined && ctx.link.attackingCard.instanceId === ctx.self.instanceId; },
    onHit(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), defense: -1, appliesToEquipment: true, once: true }); },
    onEffectHit(ctx, targetSeat) { ctx.addModifier({ scope: "until-end-of-turn", seat: targetSeat, defense: -1, appliesToEquipment: true, once: true }); },
  }),
  "redback shroud|0": graveyardChest({ activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, onActivate(ctx) { ctx.addModifier({ scope: "next-play", playCostReduction: 1, appliesToCardType: "attack-reaction" }); } } }),
  "shake down|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined &&
        ctx.getFlag("link", "reactionPlayedOrActivated") === true;
    },
    onHit(ctx) {
            ctx.requestChoice("shake-color", decisionPrompt("Choose a color", "card.out.color.choose", { optionMessages: { red: decisionMessage("card.common.option.red"), yellow: decisionMessage("card.common.option.yellow"), blue: decisionMessage("card.common.option.blue") } }), ["red", "yellow", "blue"]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "shake-color") {
        const hand = ctx.player(opponentSeat(ctx)).hand;
        const revealedIds = hand.map((card) => card.instanceId);
        if (!ctx.revealCards(revealedIds, opponentSeat(ctx))) return;
        const pitch = option === "red" ? 1 : option === "yellow" ? 2 : 3;
        const matching = hand.filter((card) => ctx.cardData(card.cardId).pitch === pitch);
        ctx.requestCardChoice(
          "shake-banish",
          decisionPrompt(
            matching.length ? `Banish a revealed ${option} card` : `No revealed ${option} cards`,
            matching.length ? "card.out.revealed.banish" : "card.out.revealed.none",
            { values: { color: option }, optionMessages: { Close: decisionMessage("common.option.close") } },
          ),
          matching.length ? matching.map((card) => card.instanceId) : ["Close"],
          undefined,
          revealedIds,
        );
        return;
      }
      if (hook === "shake-banish" && option !== "Close") ctx.banish(Number(option));
    },
  },
  "spreading plague|2": { onPlay(ctx) { const count = (ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0); ctx.createTokens(BLOODROT, count, opponentSeat(ctx)); } },
  "cyclone roundhouse|2": { friendlyDefendedTrigger: { label: "Cyclone Roundhouse combo", condition: (ctx) => previousAttackHasName(ctx, "spinning wheel kick") }, onFriendlyDefended(ctx) { for (const link of ctx.state.chain) { if (!link.defendingCards.length) continue; const card = link.defendingCards[ctx.randomInt(link.defendingCards.length)]!; ctx.banish(card.instanceId); } } },
  "dishonor|3": { modifyAttack: (ctx) => previousAttackHasName(ctx, "bonds of ancestry") ? 2 : 0, canTriggerOnHit(ctx) { const names = new Set(ctx.state.chain.filter((link) => link.attacker === ctx.seat).flatMap((link) => ctx.cardNames(link.attackingCard))); return ctx.link?.targetAllyId === undefined && ["surging strike", "descendent gustwave", "bonds of ancestry"].every((name) => names.has(name)); }, onHit(ctx) { ctx.suppressHeroAbilitiesPermanently(opponentSeat(ctx)); } },
  "head leads the tail|1": { onAttackDeclared(ctx) { ctx.requestNameChoice("head-tail-name", decisionPrompt("Name another card", "card.out.card.name.another")); }, onChoose(ctx, hook, option) { if (hook === "head-tail-name" && option.toLowerCase() !== ctx.data.name.toLowerCase()) ctx.addModifier({ scope: "combat-chain", attack: 1, appliesToName: option.toLowerCase() }); } },
  "wander with purpose|2": { onHit(ctx) { const zeroes = ctx.player(ctx.seat).hand.filter((card) => (ctx.cardData(card.cardId).cost ?? -1) === 0); if (zeroes.length) ctx.requestCardChoice("wander-discard", yesNoPrompt("Discard a zero-cost card?", "card.out.zero.discard"), ["no", ...zeroes.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "wander-discard") { if (option === "no" || !ctx.discardCard(ctx.seat, Number(option))) return; const combos = ctx.player(ctx.seat).deck.filter((card) => (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "combo")); if (combos.length) ctx.requestCardChoice("wander-search", decisionPrompt("Choose a combo card", "card.out.combo.card.choose"), combos.map((card) => card.instanceId)); else ctx.shuffleDeck(); } else if (hook === "wander-search" && ctx.banish(Number(option))) ctx.shuffleDeck(); } },
  "silverwind shuriken|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => !!ctx.link && (ctx.cardData(ctx.link.attackingCard.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "combo"), onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); } } },
  "visit the floating dojo|3": {
    onPlay(ctx) { const strikes = ctx.player(ctx.seat).graveyard.filter((card) => namedCard(ctx, card, "surging strike")); if (strikes.length) ctx.requestCardChoice("dojo-strike", decisionPrompt("Choose a Surging Strike", "card.out.surgingstrike.choose"), strikes.map((card) => card.instanceId)); else { const combos = ctx.player(ctx.seat).graveyard.filter((card) => combo(ctx, card)); if (combos.length) ctx.requestCardChoice("dojo-combo", decisionPrompt("Choose a combo card", "card.out.combo.card.choose"), combos.map((card) => card.instanceId)); } },
    onChoose(ctx, hook, option) { if (hook === "dojo-strike" || hook === "dojo-combo") { ctx.setCounter(hook === "dojo-strike" ? "dojoStrike" : "dojoCombo", Number(option)); ctx.requestChoice(`${hook}-position`, decisionPrompt("Put it on top or bottom?", "card.out.deck.position", { optionMessages: commonOptionMessages("top", "bottom") }), ["top", "bottom"]); } else if (hook.endsWith("-position")) { const isStrike = hook.startsWith("dojo-strike"); const id = ctx.getCounter(isStrike ? "dojoStrike" : "dojoCombo"); if (option === "top") ctx.putOnDeckTop(id); else ctx.putOnDeckBottom(id); if (isStrike) { const combos = ctx.player(ctx.seat).graveyard.filter((card) => combo(ctx, card) && card.instanceId !== id); if (combos.length) ctx.requestCardChoice("dojo-combo", decisionPrompt("Choose a combo card", "card.out.combo.card.choose"), combos.map((card) => card.instanceId)); } } },
  },
  "riptide, lurker of the deep|0": { triggers: [{ event: "card-played", label: "Put a card from hand face down into arsenal?", condition: (_ctx, _card, event) => event?.from === "hand", effect(ctx) { arsenalFromHand(ctx, "riptide-arsenal"); } }, { event: "trap-triggered", whose: "subject", label: "Deal 1 damage", effect(ctx) { ctx.dealDamage(opponentSeat(ctx), 1); } }], onChoose(ctx, hook, option) { if (hook === "riptide-arsenal" && option !== "no") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false }); } },
  "barbed castaway|0": { activated: [{ cost: 1, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, label: "Load an arrow", onActivate(ctx) { arsenalFromHand(ctx, "castaway-load", (card) => has(ctx, card, "arrow")); } }, { cost: 1, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, label: "Turn an arrow face up", canActivate: (ctx) => ctx.player(ctx.seat).arsenal.some((card) => card.faceDown && has(ctx, card, "arrow")), onActivate(ctx) { const card = ctx.player(ctx.seat).arsenal.find((candidate) => candidate.faceDown && has(ctx, candidate, "arrow")); if (card) { ctx.turnArsenalFaceUp(card.instanceId); ctx.addCounter(card.instanceId, "aim", 1); } } }], onChoose(ctx, hook, option) { if (hook === "castaway-load" && option !== "no") ctx.putIntoArsenal(Number(option), "hand", { faceUp: true }); } },
  "trench of sunken treasure|0": { preventArcaneDamage: 1, activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.player(ctx.seat).arsenal.some((card) => card.faceDown), onActivate(ctx) { const cards = ctx.player(ctx.seat).arsenal.filter((card) => card.faceDown); ctx.requestCardChoice("trench-bottom", decisionPrompt("Choose a face-down arsenal card", "card.out.arsenal.facedown.choose"), cards.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "trench-bottom" && ctx.putOnDeckBottom(Number(option))) ctx.changeResources(ctx.seat, 1); } },
  "quiver of abyssal depths|0": { activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { const arrows = ctx.player(ctx.seat).graveyard.filter((card) => has(ctx, card, "arrow")); for (const card of arrows.filter((card, index) => arrows.findIndex((other) => ctx.cardData(other.cardId).name === ctx.cardData(card.cardId).name) === index).slice(0, 3)) ctx.putOnDeckBottom(card.instanceId); ctx.shuffleDeck(); } } },
  "quiver of rustling leaves|0": { activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: false, onActivate(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.lookAt(top.instanceId); if (top && has(ctx, top, "arrow") && ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: true })) ctx.destroySelf(); } } },
  "driftwood quiver|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => ctx.player(ctx.seat).arsenal.length > 0, onActivate(ctx) { ctx.requestCardChoice("driftwood-bottom", decisionPrompt("Choose an arsenal card", "card.out.arsenal.card.choose"), ctx.player(ctx.seat).arsenal.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "driftwood-bottom") ctx.putOnDeckBottom(Number(option)); } },
  "amplifying arrow|2": { replacePowerGain(_ctx, amount) { return amount > 0 ? amount + 1 : amount; } },
  "buzzsaw trap|3": { canTriggerOnDefend: (ctx) => !!ctx.link && ctx.currentAttackPower() > ctx.basePower(ctx.link.attackingCard), onDefend(ctx) { ctx.setFlag("link", "cannotGainPower", true); } },
  "collapsing trap|3": { canTriggerOnDefend: (ctx) => ctx.link?.goAgain === true, onDefend(ctx) { if (!ctx.link) return; const seat = ctx.link.attacker; const count = ctx.player(seat).hand.length; for (const card of [...ctx.player(seat).hand]) ctx.discardCard(seat, card.instanceId); ctx.drawCards(seat, Math.max(0, count - 1)); } },
  "spike pit trap|3": { canTriggerOnDefend: (ctx) => ctx.getFlag("link", "reactionPlayedOrActivated") === true, onDefend(ctx) { if (!ctx.link) return; const seat = ctx.link.attacker; const top = ctx.player(seat).deck[0]; if (!top) return; ctx.moveToGraveyard(top.instanceId, "deck"); const name = ctx.cardData(top.cardId).name; ctx.loseLife(seat, ctx.player(seat).graveyard.filter((card) => ctx.cardData(card.cardId).name === name).length); } },
  "melting point|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "arrow" }); } },
  "flick knives|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      oncePerTurn: true,
      canActivate: (ctx) => flickKnivesDaggers(ctx).length > 0,
      onActivate(ctx) {
        const daggers = flickKnivesDaggers(ctx);
        if (daggers.length > 0) {
          ctx.requestCardChoice(
            "flick-knives-dagger",
            decisionPrompt("Flick Knives: choose a dagger to deal 1 damage, then destroy it", "card.out.flickknives.dagger.choose"),
            daggers.map((card) => card.instanceId),
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "flick-knives-dagger") return;
      const dagger = flickKnivesDaggers(ctx).find(
        (card) => card.instanceId === Number(option),
      );
      if (!dagger) return;
      ctx.dealDamage(opponentSeat(ctx), 1, {
        sourceInstanceId: dagger.instanceId,
        countsAsHit: true,
        destroySourceAfterDamage: true,
      });
    },
  },
  "stab wound|3": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.loseLife(opponentSeat(ctx), Number(ctx.getFlag("player", "daggerHitsThisChain"))); } },
  "concealed blade|3": { canPlay: (ctx) => ctx.link?.attackCardType === "action" && (has(ctx, ctx.link.attackingCard, "assassin") || has(ctx, ctx.link.attackingCard, "ninja")), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); }, onHit(ctx) { const daggers = (ctx.player(ctx.seat).inventory ?? []).filter((card) => has(ctx, card, "dagger")); if (daggers.length) ctx.requestCardChoice("concealed-dagger", decisionPrompt("Choose a dagger to equip", "card.out.dagger.equip"), daggers.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "concealed-dagger") ctx.equipFromInventory(Number(option)); } },
  "knives out|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToSubtype: "dagger" }); } },
  "codex of bloodrot|2": { onPlay(ctx) { codexBloodrotChoice(ctx, 0); }, onChoose(ctx, hook, option) { if (!hook.startsWith("codex-bloodrot:")) return; const seat = Number(hook.split(":")[1]); if (ctx.putIntoArsenal(Number(option), "hand", { faceUp: false })) codexBloodrotChoice(ctx, seat + 1); } },
  "codex of frailty|2": { onPlay(ctx) { codexFrailtyChoice(ctx, 0); }, onChoose(ctx, hook, option) { if (hook.startsWith("codex-frailty-discard:")) { const seat = Number(hook.split(":")[1]); ctx.discardCard(seat, Number(option)); const next = [0, 1].find((target) => target > seat && ctx.getCounter(`codexFrailtyMoved:${target}`) > 0 && ctx.player(target).hand.length); if (next !== undefined) chooseDiscard(ctx, `codex-frailty-discard:${next}`, next); else { ctx.createToken(PONDER); ctx.createToken(FRAILTY, opponentSeat(ctx)); } return; } if (!hook.startsWith("codex-frailty:")) return; const seat = Number(hook.split(":")[1]); if (ctx.putIntoArsenal(Number(option), "graveyard", { faceUp: false })) ctx.setCounter(`codexFrailtyMoved:${seat}`, 1); codexFrailtyChoice(ctx, seat + 1); } },
  "codex of inertia|2": { onPlay(ctx) { for (const player of ctx.state.players) { const top = player.deck[0]; if (top) ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false }); if (top) chooseDiscard(ctx, `codex-discard:${player.seat}`, player.seat); } ctx.createToken(PONDER); ctx.createToken(INERTIA, opponentSeat(ctx)); }, onChoose(ctx, hook, option) { if (hook.startsWith("codex-discard:")) ctx.discardCard(Number(hook.split(":")[1]), Number(option)); } },
  "vambrace of determination|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", oncePerTurn: true, onActivate(ctx) { ctx.setPlayerFlag(ctx.seat, "nextPhysicalPreventionReduction", 1); } }, onDefend(ctx) { ctx.requestPayment("vambrace", decisionPrompt("Pay 1 for +1 defense and blade break?", "card.out.defense.pay", { optionMessages: commonOptionMessages("no") }), 1); }, onChoose(ctx, hook, option) { if (hook === "vambrace" && option === "paid") { ctx.addCardTempDefense(ctx.self.instanceId, 1); ctx.grantCardKeyword(ctx.self.instanceId, "blade break"); } } },
  "amnesia|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), suppressesOwnedNames: true, expiresAtStartOfSeatTurn: ctx.seat }); } },
  "down and dirty|1": { canDefendFromArsenal: true },
  "gore belching|1": { onAttackDeclared(ctx) { const deck = ctx.player(ctx.seat).deck; const card = deck.find((candidate) => isAttack(ctx, candidate)); if (card) { ctx.banish(card.instanceId); ctx.addModifier({ scope: "chain-link", attack: -(ctx.cardData(card.cardId).attack ?? 0) }); } else ctx.addModifier({ scope: "chain-link", attack: -7 }); ctx.shuffleDeck(); } },
  "burdens of the past|3": { onPlay(ctx) { const target = opponentSeat(ctx); ctx.addModifier({ scope: "until-end-of-turn", seat: target, prohibitsDefenseReactionNamesInGraveyard: true }); const count = ctx.player(target).graveyard.filter((card) => ctx.cardData(card.cardId).cardType === "defense-reaction").length; if (count >= 10) ctx.drawCards(ctx.seat, 1); } },
  "premeditate|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action", appliesToFromArsenal: true }); ctx.setPlayerFlag(ctx.seat, "ponderOnNextAttackHit", true); } },
};
