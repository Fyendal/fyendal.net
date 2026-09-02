import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, contractCompletionCount, opponentSeat } from "../shared-helpers.js";

const AGILITY = "HVY240";
const CINTARI_SELLSWORD = "HVY134";
const GOLD = "HVY243";
const MIGHT = "HVY241";
const PONDER = "DYN244";
const VIGOR = "HVY242";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) { return ctx.cardData(card.cardId); }
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string) {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}
function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string) {
  return ctx.cardNames(card).some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}
function controlledPermanents(ctx: ScriptCtx, seat = ctx.seat): DeepReadonly<CardInstance>[] {
  const player = ctx.player(seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter(
      (card): card is DeepReadonly<CardInstance> => card !== undefined,
    ),
  ];
}
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function isSix(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) { return ctx.basePower(card) >= 6; }
function wagerAttack(tokens: string[]): CardScript {
  return { triggers: [{ event: "attack-declared", sourceZone: "self", optional: true, label: "Wager with the defending hero?", condition: (ctx) => ctx.link?.targetAllyId === undefined, effect: (ctx) => ctx.wager(opponentSeat(ctx), tokens) }] };
}
function topCards(ctx: ScriptCtx, count: number) { return ctx.player(ctx.seat).deck.slice(0, count); }
function chooseArsenalBottom(ctx: ScriptCtx, hook: string) {
  const card = ctx.player(ctx.seat).arsenal[0];
  if (card) ctx.requestCardChoice(hook, "Put your arsenal card on the bottom?", ["no", card.instanceId]);
}
function evoEquipment(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    playableEquipment: true,
    canPlay(ctx) {
      const slot = ctx.cardTypes(ctx.self).find((type): type is "head" | "chest" | "arms" | "legs" => ["head", "chest", "arms", "legs"].includes(type));
      const base = slot ? ctx.player(ctx.seat).equipment[slot] : undefined;
      return !!base && has(ctx, base, "base");
    },
    playAsInstant(ctx) {
      return ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true ||
        (extra.playAsInstant?.(ctx) ?? false);
    },
  };
}
function talkDamage(ctx: ScriptCtx, targetSeat: number, amount: number, arcane: boolean): void {
  const threshold = ctx.getCounter("talk-threshold");
  if (arcane || threshold <= 0 || amount < threshold || targetSeat === ctx.seat) return;
  ctx.setCounter("talk-threshold", 0);
  ctx.createTokens(MIGHT, threshold);
}

const ANTE_MODES = ["agility", "gold", "vigor", "power"] as const;
type AnteMode = typeof ANTE_MODES[number];
function requestAnteMode(ctx: ScriptCtx): void {
  const remaining = ctx.getCounter("ante-remaining");
  if (remaining <= 0) return;
  const total = Math.min(ANTE_MODES.length, ctx.getCounter("anteX") + 1);
  ctx.requestChoice(
    "ante-mode",
    remaining === total ? "Choose a wager mode" : "Choose another wager mode",
    ANTE_MODES.filter((mode) => ctx.getCounter(`ante-mode:${mode}`) <= 0),
  );
}
function applyAnteModes(ctx: ScriptCtx): void {
  for (const mode of ANTE_MODES) {
    if (ctx.getCounter(`ante-mode:${mode}`) <= 0) continue;
    if (mode === "agility") ctx.wager(opponentSeat(ctx), [AGILITY]);
    else if (mode === "gold") ctx.wager(opponentSeat(ctx), [GOLD]);
    else if (mode === "vigor") ctx.wager(opponentSeat(ctx), [VIGOR]);
    else if (mode === "power") ctx.addModifier({ scope: "chain-link", attack: Number(ctx.getFlag("link", "wagerCount")) });
  }
}

export const hvyHighRarity: Record<string, CardScript> = {
  "deathmatch arena|0": { global: true, onFriendlyCombatDamageDealt(ctx, _source, targetSeat, amount) { if (amount > 0 && ctx.player(targetSeat).life <= 0) ctx.createTokens(GOLD, ctx.state.players.length); } },
  "apex bonebreaker|0": { modifyDefense: (ctx) => ctx.link?.defendingCards.some((card) => card.instanceId !== ctx.self.instanceId && isSix(ctx, card)) ? 0 : 0, canTriggerOnDefend: (ctx) => ctx.link?.defendingCards.some((card) => card.instanceId !== ctx.self.instanceId && isSix(ctx, card)) === true, onDefend(ctx) { ctx.createToken(MIGHT); } },
  "send packing|2": { onAttackDeclared(ctx) { const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0]; if (arsenal) { ctx.banish(arsenal.instanceId, { faceDown: false }); ctx.setCounter("packed", arsenal.instanceId); } }, onMiss(ctx) { const id = ctx.getCounter("packed"); if (id) ctx.moveToHand(id); } },
  "cast bones|1": { onPlay(ctx) { const cards = [...topCards(ctx, 6)]; ctx.revealCards(cards.map((card) => card.instanceId)); const sixes = cards.filter((card) => isSix(ctx, card)).length; ctx.createTokens(MIGHT, sixes); const order: DeepReadonly<CardInstance>[] = []; while (cards.length) order.push(cards.splice(ctx.randomInt(cards.length), 1)[0]!); for (const card of [...order].reverse()) ctx.putOnDeckTop(card.instanceId); if (ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "might")).length >= 6) ctx.createToken(AGILITY); }, onChoose() {} },
  "reckless charge|3": { onPlay(ctx) { ctx.requestDieRoll("reckless", 6); }, onDieRollResolved(ctx, hook, result) { if (hook !== "reckless") return; ctx.changeActionPoints(ctx.seat, Math.floor(result / 2)); if (ctx.getPlayerFlag(ctx.seat, "rolledDie:6") === true) ctx.drawCards(ctx.seat, 1); } },
  "no fear|1": { additionalCost(ctx) { const cards = ctx.player(ctx.seat).hand.filter((card) => isSix(ctx, card)); if (cards.length) ctx.requestCardChoice("no-fear", "Banish a 6-power card?", ["done", ...cards.map((card) => card.instanceId)]); else ctx.preventNextDamage(ctx.seat, 2); }, onChoose(ctx, hook, option) { if (hook !== "no-fear" || option === "done") { if (hook === "no-fear") ctx.preventNextDamage(ctx.seat, 2 + ctx.getCounter("fear-count")); return; } if (ctx.banish(Number(option))) { const count = ctx.getCounter("fear-count") + 1; ctx.setCounter("fear-count", count); ctx.setCounter(`fear-card-${count}`, Number(option)); const cards = ctx.player(ctx.seat).hand.filter((card) => isSix(ctx, card)); ctx.requestCardChoice("no-fear", "Banish another?", ["done", ...cards.map((card) => card.instanceId)]); } }, triggers: [{ event: "end-of-turn", sourceZone: "graveyard", label: "Return cards banished by No Fear", effect(ctx) { for (let i = 1; i <= ctx.getCounter("fear-count"); i++) ctx.moveToHand(ctx.getCounter(`fear-card-${i}`)); } }] },
  "betsy, skin in the game|0": { triggers: [{ event: "wager-generated", label: "Pay 2 for +1 and overpower?", effect(ctx, attacking) { if (!attacking) return; ctx.setCounter("betsy-attack", attacking.instanceId); ctx.requestPayment("betsy-pay", "Pay 2 for +1 and overpower?", 2); } }], onChoose(ctx, hook, option) { if (hook === "betsy-pay" && option === "paid") { ctx.addModifier({ scope: "chain-link", attack: 1, appliesToInstanceId: ctx.getCounter("betsy-attack"), overpower: true }); } } },
  "victor goldmane, high and mighty|0": { firstFailedClashReplacement: { costPermanentName: "Gold", choiceHook: "victor-adult-reclash" }, onFriendlyTokenCreated(ctx, token) { if (named(ctx, token, "gold") && ctx.getPlayerFlag(ctx.seat, "victorGoldDrawn") !== true) { ctx.setPlayerFlag(ctx.seat, "victorGoldDrawn", true); ctx.drawCards(ctx.seat, 1); } } },
  "aurum aegis|0": { allZoneNames: ["Gold"] },
  "gauntlets of iron will|0": { onDefend(ctx) { ctx.setCounter("replacement-ready", 1); }, replacePowerGain(ctx, amount) { if (ctx.getCounter("replacement-ready") <= 0 || amount <= 0) return amount; ctx.setCounter("replacement-ready", 0); return Math.max(0, amount - 1); } },
  "bet big|1": wagerAttack([GOLD, MIGHT, VIGOR]),
  "primed to fight|1": { modifyPlayCost(ctx, base) { const controlled = ctx.player(ctx.seat).board.some((card) => named(ctx, card, "vigor")) || ctx.getPlayerFlag(ctx.seat, "createdName:vigor") === true; return controlled ? Math.max(0, base - 1) : base; }, modifyAttack(ctx) { return ctx.player(ctx.seat).board.some((card) => named(ctx, card, "might")) || ctx.getPlayerFlag(ctx.seat, "createdName:might") === true ? 1 : 0; } },
  "the golden son|2": { alternativePlayCost: { kind: "destroy-controlled-named", options: [{ name: "Gold", count: 1 }], replacesResourceCost: false }, onAlternativeCostPaid(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3, overpower: true }); }, onClashRevealed(ctx, won) { if (won) ctx.createToken(GOLD); } },
  "boast|3": { modifyDefense: (ctx) => Number(ctx.getPlayerFlag(ctx.seat, "clashesWonThisTurn")) * 2 },
  "trounce|1": { onDefend(ctx) { ctx.requestClash(opponentSeat(ctx), "trounce-one"); }, onClashResult(ctx, hook, winner) { if (hook === "trounce-one") { ctx.setCounter("trounce-winner", winner); ctx.requestClash(opponentSeat(ctx), "trounce-two"); } else if (hook === "trounce-two" && winner >= 0 && winner === ctx.getCounter("trounce-winner")) { ctx.createToken(GOLD, winner); ctx.createToken(MIGHT, winner); ctx.createToken(VIGOR, winner); } } },
  "kassai of the golden sand|0": { modifyAttackActivationCost(ctx, attacker, base) { return has(ctx, attacker, "sword") && Number(ctx.getPlayerFlag(ctx.seat, "cardsDrawnThisTurn")) > 0 ? Math.max(0, base - 1) : base; }, activated: { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, effectCardCosts: [{ zone: "graveyard", move: "banish", count: 2, pitch: 1, prompt: "Banish 2 red cards" }, { zone: "graveyard", move: "banish", count: 2, pitch: 2, prompt: "Banish 2 yellow cards" }], label: "Next weapon hit creates Gold", onActivate(ctx) { buffNextAttack(ctx, { appliesTo: "weapon", onHitCreateToken: { cardId: GOLD, count: 1 } }); } } },
  "grains of bloodspill|0": { canTriggerOnHit: (ctx) => ctx.link?.attackCardType === "weapon", onHit(ctx) { ctx.requestPayment("grains", "Pay 1 to create Vigor?", 1); }, onChoose(ctx, hook, option) { if (hook === "grains" && option === "paid") ctx.createToken(VIGOR); } },
  "blade flurry|1": { onPlay(ctx) { if (ctx.link?.attackCardType === "weapon") ctx.addModifier({ scope: "chain-link", attack: 2 }); buffNextAttack(ctx, { attack: 2, appliesTo: "weapon" }); } },
  "shift the tide of battle|2": { canPlay: (ctx) => !!ctx.link && has(ctx, ctx.link.attackingCard, "warrior") && ctx.currentAttackPower() > ctx.basePower(ctx.link.attackingCard), onPlay(ctx) { ctx.grantGoAgain(); ctx.addModifier({ scope: "until-end-of-turn", onHitCreateToken: { cardId: AGILITY, count: 1 }, once: true }); } },
  "up the ante|3": { variablePlayCost: { base: 0, maximum: ANTE_MODES.length - 1, counterKey: "anteX", prompt: "Choose X" }, playTargetOptions(ctx) { return ctx.link ? [ctx.link.attackingCard.instanceId] : []; }, additionalCost(ctx) { ctx.setCounter("ante-remaining", ctx.getCounter("anteX") + 1); requestAnteMode(ctx); }, onPlay(ctx) { applyAnteModes(ctx); }, onChoose(ctx, hook, option) { if (hook !== "ante-mode" || !ANTE_MODES.includes(option as AnteMode)) return; const mode = option as AnteMode; ctx.setCounter(`ante-mode:${mode}`, 1); ctx.setCounter("ante-remaining", ctx.getCounter("ante-remaining") - 1); requestAnteMode(ctx); } },
  "commanding performance|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToType: ["warrior"] }); ctx.addModifier({ scope: "until-end-of-turn", appliesToType: ["warrior"], onHitClearHandAndArsenalAtEndPhase: true }); } },
  "raise an army|2": { additionalCost(ctx) { const totalGold = controlledPermanents(ctx).filter((card) => named(ctx, card, "gold")).length; if (totalGold > 0) ctx.requestChoice("army-gold-count", "How many Gold do you want to destroy?", Array.from({ length: totalGold + 1 }, (_, count) => String(count))); }, onChoose(ctx, hook, option) { if (hook !== "army-gold-count") return; const gold = controlledPermanents(ctx).filter((card) => named(ctx, card, "gold")); const count = Number(option); if (!Number.isSafeInteger(count) || count < 0 || count > gold.length) return; let destroyed = 0; for (const card of gold.slice(0, count)) if (ctx.destroyPermanent(card.instanceId)) destroyed++; ctx.createTokens(CINTARI_SELLSWORD, destroyed); } },
  "cintari sellsword|0": { activated: { ...attackAbility(1, { goAgain: true })[0]!, canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, "attackedWithWeaponThisTurn") === true } },
  "talk a big game|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); ctx.requestChoice("big-number", "Choose a number", ["1", "2", "3", "4", "5", "6"]); }, onChoose(ctx, hook, option) { if (hook === "big-number") ctx.setCounter("talk-threshold", Number(option)); }, onFriendlyDamageDealt(ctx, _source, target, amount, arcane) { talkDamage(ctx, target, amount, arcane); }, onFriendlyCombatDamageDealt(ctx, _source, target, amount) { talkDamage(ctx, target, amount, false); } },
  "runner runner|1": { onAttackDeclared(ctx) { if (ctx.link?.goAgain) ctx.createToken(AGILITY); } },
  "double down|1": { alternativePlayCost: { kind: "destroy-controlled-named", options: [{ name: "Gold", count: 1 }] }, onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); ctx.setCounter("double-attack-ready", 1); }, triggers: [{ event: "wager-generated", label: "The wagering attack gets +3 and overpower", condition: (ctx) => ctx.getCounter("double-attack-ready") > 0, onTrigger: (ctx) => ctx.setCounter("double-attack-ready", 0), effect(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3, overpower: true }); } }], globalTokenCreationReplacement: { label: "Double Down adds one of each wager token", replace(_ctx, _creatingSeat, _cardId, count, cause) { return cause.kind === "wager" && count > 0 ? count + 1 : undefined; } } },
  "balance of justice|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, label: "Draw a card", canActivate: (ctx) => Number(ctx.getPlayerFlag(opponentSeat(ctx), "cardsDrawnThisTurn")) >= 2, onActivate(ctx) { ctx.drawCards(ctx.seat, 1); } } },
  "nasty surprise|3": {
    triggers: [{
      event: "card-put-into-graveyard",
      sourceZone: "graveyard",
      label: "Create Agility, Might, and Vigor tokens",
      condition: (ctx, card, eventContext) =>
        card?.instanceId === ctx.self.instanceId &&
        eventContext?.causedBySeat !== undefined &&
        eventContext.causedBySeat !== ctx.seat,
      effect(ctx) {
        ctx.createToken(AGILITY);
        ctx.createToken(MIGHT);
        ctx.createToken(VIGOR);
      },
    }],
    onFriendlyDestroyed() {},
  },
  "pay up|1": { onAttackDeclared(ctx) { if (controlledPermanents(ctx, opponentSeat(ctx)).some((card) => named(ctx, card, "gold"))) ctx.setFlag("link", "overpower", true); }, canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const gold = controlledPermanents(ctx, opponentSeat(ctx)).find((card) => named(ctx, card, "gold")); if (gold) ctx.steal(gold.instanceId, { duration: "indefinite" }); else ctx.dealDamage(opponentSeat(ctx), 1); } },
  "ripple away|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, label: "Reduce action-card token creation", onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); } }, globalTokenCreationReplacement: { label: "Ripple Away removes one of each token", replace(ctx, _creatingSeat, _cardId, count, cause) { return cause.sourceCardId && ctx.cardData(cause.sourceCardId).cardType === "action" && count > 0 ? Math.max(0, count - 1) : undefined; } } },
  "standing order|1": { onAttackDeclared(ctx) { chooseArsenalBottom(ctx, "standing"); }, onDefend(ctx) { chooseArsenalBottom(ctx, "standing"); }, onChoose(ctx, hook, option) { if (hook === "standing" && option !== "no" && ctx.putOnDeckBottom(Number(option))) { ctx.addCardTempPower(ctx.self.instanceId, 2); ctx.addCardTempDefense(ctx.self.instanceId, 2); } } },
  "tenacity|2": { modifyAttack: (ctx) => (ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0) },
  "seduce secrets|2": { onPlay(ctx) { const target = ctx.player(opponentSeat(ctx)); for (const card of [...target.hand, ...target.deck.slice(0, 1)]) ctx.lookAt(card.instanceId); if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); } },
  "graven call|0": { activated: [{ ...attackAbility(2, { goAgain: true })[0]!, label: "Attack" }, { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromGraveyard: true, effectCardCosts: [{ zone: "arena", move: "destroy", count: 2, name: "Silver", prompt: "Destroy 2 Silver" }], label: "Equip from graveyard", onActivate(ctx) { if (ctx.equipFromGraveyard(ctx.self.instanceId)) ctx.addCounter(ctx.self.instanceId, "power", 1); } }] },
  "coercive tendency|3": { onPlay(ctx) { const cards = ctx.player(opponentSeat(ctx)).deck.slice(0, 3); for (const card of cards) ctx.lookAt(card.instanceId); if (cards.length) ctx.requestCardChoice("coercive-first", "Choose the top card", cards.map((card) => card.instanceId)); }, onChoose(ctx, hook, option, _unused?: never) { if (hook === "coercive-first") { ctx.setCounter("coercive-first", Number(option)); const cards = ctx.player(opponentSeat(ctx)).deck.slice(0, 3).filter((card) => card.instanceId !== Number(option)); if (cards.length) ctx.requestCardChoice("coercive-second", "Choose the second card", cards.map((card) => card.instanceId)); return; } if (hook !== "coercive-second") return; const first = ctx.getCounter("coercive-first"); const cards = ctx.player(opponentSeat(ctx)).deck.slice(0, 3); const third = cards.find((card) => card.instanceId !== first && card.instanceId !== Number(option)); if (third) ctx.putOnDeckTop(third.instanceId); ctx.putOnDeckTop(Number(option)); ctx.putOnDeckTop(first); const completions = contractCompletionCount(ctx); const top = ctx.player(opponentSeat(ctx)).deck[0]; if (top) ctx.banish(top.instanceId); if (contractCompletionCount(ctx) > completions) { ctx.addModifier({ scope: "combat-chain", goAgain: true, appliesTo: "attack", appliesToClass: "assassin" }); if (ctx.link?.attacker === ctx.seat && has(ctx, ctx.link.attackingCard, "assassin")) ctx.grantGoAgain(); } } },
  "ancestral harmony|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToKeyword: "combo" }); const top = ctx.player(ctx.seat).deck[0]; if (top && ctx.banish(top.instanceId) && (data(ctx, top).keywords ?? []).some((keyword) => keyword.toLowerCase() === "combo")) ctx.allowPlayFrom(top.instanceId, "banish"); } },
  "evo magneto|3": evoEquipment({ onDefend(ctx) { if (ctx.destroySubcard(ctx.self.instanceId)) { const items = ctx.player(opponentSeat(ctx)).board.filter((card) => isAttack(ctx, card) === false && has(ctx, card, "item") && (data(ctx, card).cost ?? 0) <= 1); if (items.length) ctx.requestCardChoice("magneto", "Gain control of an item", items.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "magneto") ctx.steal(Number(option), { duration: "indefinite" }); } }),
  "judge, jury, executioner|1": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && (ctx.getCounter("aim") > 0 || ctx.getFlag("link", "aim") === true); }, onHit(ctx) { const target = opponentSeat(ctx); const hand = ctx.player(target).hand; if (hand.length > 1) ctx.requestCardChoice("judge-keep", "Choose a card to keep", hand.map((card) => card.instanceId), target); }, onChoose(ctx, hook, option) { if (hook !== "judge-keep") return; const target = opponentSeat(ctx); for (const card of [...ctx.player(target).hand]) if (card.instanceId !== Number(option)) ctx.discardCard(target, card.instanceId); } },
  "reel in|3": { variablePlayCost: { base: 0, counterKey: "reelX", prompt: "Choose X" }, onPlay(ctx) { const looked = topCards(ctx, ctx.getCounter("reelX") + 1); for (const card of looked) ctx.lookAt(card.instanceId); const cards = looked.filter((card) => has(ctx, card, "trap")).slice(0, 4); ctx.revealCards(cards.map((card) => card.instanceId)); for (const card of cards) ctx.moveToHand(card.instanceId); ctx.shuffleDeck(); } },
  "sonata galaxia|1": { variablePlayCost: { base: 0, resourcesPerX: 2, counterKey: "galaxiaX", prompt: "Choose X" }, modifyPlayCost(ctx, base) { const runechants = ctx.player(ctx.seat).board.filter((card) => data(ctx, card).name.toLowerCase() === "runechant").length; return Math.max(0, base - runechants); }, onPlay(ctx) { const x = ctx.getCounter("galaxiaX"); const cards = ctx.player(ctx.seat).deck.filter((card) => has(ctx, card, "runeblade") && has(ctx, card, "aura") && (data(ctx, card).cost ?? 0) <= x); if (cards.length) { ctx.requestCardChoice("galaxia-aura", `Choose a Runeblade aura with cost ${x} or less`, cards.map((card) => card.instanceId)); return; } ctx.shuffleDeck(); if (x >= 2) ctx.gainActionPoint(); }, onChoose(ctx, hook, option) { if (hook !== "galaxia-aura") return; const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option)); if (card && has(ctx, card, "runeblade") && has(ctx, card, "aura") && (data(ctx, card).cost ?? 0) <= ctx.getCounter("galaxiaX")) ctx.settleCard(card.instanceId); ctx.shuffleDeck(); if (ctx.getCounter("galaxiaX") >= 2) ctx.gainActionPoint(); } },
  "aether arc|3": { arcaneDamageEffect: true, arcaneDamageEffectAmounts: [1], prospectiveHeroDamage(ctx) { return ctx.state.players.filter((player) => player.seat !== ctx.seat).map((player) => ({ targetSeat: player.seat, amount: 1 })); }, onPlay(ctx) { for (const target of ctx.state.players.filter((player) => player.seat !== ctx.seat)) if (ctx.dealDamage(target.seat, 1, { arcane: true }) > 0) ctx.createToken(PONDER); } },
  "dissolve reality|2": { onPlay(ctx) { for (const player of ctx.state.players) { for (const card of [...player.arsenal]) ctx.putOnDeckBottom(card.instanceId); ctx.createToken(PONDER, player.seat); } } },
  "luminaris, angel's glow|0": { onFriendlyPlay(ctx, card) { if (!isAttack(ctx, card) || !ctx.player(ctx.seat).pitch.some((pitch) => ctx.cardColor(pitch) === 2)) return; if (data(ctx, card).name.includes("Herald") && ctx.getPlayerFlag(ctx.seat, "luminarisHerald") !== true) { ctx.setPlayerFlag(ctx.seat, "luminarisHerald", true); ctx.grantCardKeyword(card.instanceId, "go again"); } }, onFriendlyActivate(ctx, card) { if (!has(ctx, card, "angel") || !ctx.player(ctx.seat).pitch.some((pitch) => ctx.cardColor(pitch) === 2) || ctx.getPlayerFlag(ctx.seat, "luminarisAngel") === true) return; ctx.setPlayerFlag(ctx.seat, "luminarisAngel", true); ctx.grantGoAgain(); } },
};
