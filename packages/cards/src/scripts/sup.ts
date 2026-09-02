import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  contractWithSilver,
  isSixPlus,
  opponentSeat,
  payForDefenseBoost,
  previousAttackHasName,
  queueIntimidate,
  requestDiscardChoice,
  resolveDiscardChoice,
  suspenseAura as suspenseLifecycle,
} from "./shared-helpers.js";

const CONFIDENCE = "SLY034";
const MIGHT = "SLY035";
const TOUGHNESS = "SUP241";
const VIGOR = "SKA036";

type Card = DeepReadonly<CardInstance>;

function pitches(name: string, make: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return Object.fromEntries(([1, 2, 3] as const).map((pitch) => [`${name}|${pitch}`, make(pitch)]));
}

function data(ctx: ScriptCtx, card: Card) { return ctx.cardData(card.cardId); }
function hasTag(ctx: ScriptCtx, card: Card, tag: string): boolean {
  return ctx.cardTypes(card).includes(tag.toLowerCase());
}
function named(ctx: ScriptCtx, card: Card, name: string): boolean {
  return ctx.cardNames(card).includes(name.toLowerCase());
}
function controls(ctx: ScriptCtx, name: string): boolean {
  const player = ctx.player(ctx.seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is Card => card !== undefined),
  ].some((card) => named(ctx, card, name));
}
function controlsAny(ctx: ScriptCtx, names: string[]): boolean {
  return names.some((name) => controls(ctx, name));
}
function aura(ctx: ScriptCtx, card: Card): boolean { return hasTag(ctx, card, "aura"); }
function tokenAura(ctx: ScriptCtx, card: Card): boolean {
  return data(ctx, card).cardType === "token" && aura(ctx, card);
}

function finishLiarsCharmModes(ctx: ScriptCtx, modes: number): void {
  if ((modes & 2) !== 0) ctx.crowdBoo(ctx.seat);
  if ((modes & 4) === 0) return;
  const target = opponentSeat(ctx);
  const hand = ctx.player(target).hand;
  if (hand.length) ctx.requestCardChoice(
    "liar-discard",
    "Discard a card to keep your hero abilities?",
    ["lose abilities", ...hand.map((card) => card.instanceId)],
    target,
  );
  else ctx.suppressHeroAbilitiesThroughNextTurn(target);
}
function suspenseAura(ctx: ScriptCtx, card: Card): boolean {
  return aura(ctx, card) && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "suspense");
}
function controlsSuspense(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).board.some((card) => suspenseAura(ctx, card));
}
function countAuras(ctx: ScriptCtx): number {
  return ctx.player(ctx.seat).board.filter((card) => aura(ctx, card)).length;
}
function heroHas(ctx: ScriptCtx, seat: number, tag: string): boolean {
  return hasTag(ctx, ctx.player(seat).hero, tag);
}
function hasSixPlusInPitch(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card));
}
function createMany(ctx: ScriptCtx, id: string, count: number): void { ctx.createTokens(id, count); }

function hunterSearchedCards(ctx: ScriptCtx): Card[] {
  const target = opponentSeat(ctx);
  return [
    ...ctx.player(target).hand,
    ...(ctx.canSearchDeck(target) ? ctx.player(target).deck : []),
    ...ctx.player(target).arsenal,
  ];
}

function hunterSearchCandidates(ctx: ScriptCtx, searchedCards = hunterSearchedCards(ctx)): Card[] {
  const chosen = ctx.self.chosenName?.trim().toLowerCase();
  if (!chosen) return [];
  return searchedCards.filter((card) => ctx.cardNames(card).includes(chosen));
}

function requestHunterSearch(ctx: ScriptCtx): void {
  const target = opponentSeat(ctx);
  const searchedCards = hunterSearchedCards(ctx);
  const candidates = hunterSearchCandidates(ctx, searchedCards);
  if (candidates.length === 0) {
    ctx.shuffleDeck(target);
    return;
  }
  ctx.requestCardChoices(
    "hunter-search",
    "Choose up to 3 more cards with the named card's name",
    candidates.map((card) => card.instanceId),
    0,
    Math.min(3, candidates.length),
    undefined,
    undefined,
    searchedCards.map((card) => card.instanceId),
  );
}

const BEAT_OF_THE_IRONSONG_MODES = [
  "+1 attack",
  "go again",
  "defending cards can't gain defense",
  "damage can't be prevented",
] as const;

function beatOfTheIronsongModeBit(option: string): number {
  const index = BEAT_OF_THE_IRONSONG_MODES.indexOf(
    option as (typeof BEAT_OF_THE_IRONSONG_MODES)[number],
  );
  return index < 0 ? 0 : 1 << index;
}

function requestSongOfSinewOrder(ctx: ScriptCtx, ids: number[]): void {
  if (ids.length === 0) return;
  ctx.requestChoice(
    `song-sinew-order:${ids.join(",")}`,
    "Song of Sinew: choose the bottommost card first; the last choice becomes the top card",
    // "pass" (the Space default) keeps the remaining cards in their order
    [...ids.map(String), "pass"],
    undefined,
    [...ids, null],
    "pass",
  );
}

function tokenEquipment(a: string, b: string): CardScript {
  return { modifyDefense: (ctx) => controls(ctx, a) && controls(ctx, b) ? 2 : 0 };
}

function tokenAttack(a: string, b: string): CardScript {
  return {
    modifyAttack: (ctx) => controlsAny(ctx, [a, b]) ? 1 : 0,
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ctx.createToken(a === "Toughness" || a === "Confidence" ? (a === "Toughness" ? TOUGHNESS : CONFIDENCE) : MIGHT);
      ctx.createToken(b === "Toughness" ? TOUGHNESS : b === "Vigor" ? VIGOR : b === "Confidence" ? CONFIDENCE : MIGHT);
    },
  };
}

function crowdAttack(kind: "cheer" | "boo", compare: "less" | "more", bonus: number): CardScript {
  return {
    onAttackDeclared(ctx) {
      const cmp = ctx.compareLife(ctx.seat, opponentSeat(ctx));
      if ((compare === "less" ? cmp < 0 : cmp > 0)) {
        if (kind === "cheer") ctx.crowdCheer(ctx.seat); else ctx.crowdBoo(ctx.seat);
      }
    },
    modifyAttack(ctx) {
      return ctx.getFlag("player", kind === "cheer" ? "cheeredThisTurn" : "booedThisTurn") ? bonus : 0;
    },
  };
}

function crowdWhenBehind(kind: "cheer" | "boo"): CardScript {
  const resolve = (ctx: ScriptCtx) => {
    if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) {
      if (kind === "cheer") ctx.crowdCheer(ctx.seat); else ctx.crowdBoo(ctx.seat);
    }
  };
  return { onAttackDeclared: resolve, onDefend: resolve };
}

function subtypeOpponentAttack(tag: "revered" | "reviled", bonus: number, kind: "cheer" | "boo"): CardScript {
  return {
    modifyAttack(ctx) { return heroHas(ctx, opponentSeat(ctx), tag) ? bonus : 0; },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && heroHas(ctx, opponentSeat(ctx), tag); },
    onHit(ctx) {
      if (kind === "cheer") ctx.crowdCheer(ctx.seat); else ctx.crowdBoo(ctx.seat);
    },
  };
}

function defendedByTag(ctx: ScriptCtx, tag: string): boolean {
  return !!ctx.link && [...ctx.link.defendingCards, ...ctx.link.defendingEquipment].some((card) => hasTag(ctx, card, tag));
}

function fightCard(defenderTag: string, heroTag: string, topDeck: boolean): CardScript {
  return {
    modifyAttack: (ctx) => defendedByTag(ctx, defenderTag) ? 1 : 0,
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && heroHas(ctx, opponentSeat(ctx), heroTag); },
    onHit(ctx) {
      if (topDeck) {
        const top = ctx.player(opponentSeat(ctx)).deck[0];
        if (top) ctx.moveToGraveyard(top.instanceId, "deck");
      } else ctx.putOnDeckBottom(ctx.self.instanceId);
    },
  };
}

function xTokens(tokenId: string, when: "attack" | "defend"): CardScript {
  const request = (ctx: ScriptCtx) => ctx.requestXPayment("sup-x", `${ctx.data.name}: choose and pay up to 3`, undefined, 3);
  return {
    ...(when === "attack" ? { onAttackDeclared: request } : { onDefend: request, defendCost: 3 }),
    onChoose(ctx, hook, option) {
      if (hook !== "sup-x" || !option.startsWith("x:")) return;
      createMany(ctx, tokenId, Number(option.slice(2)));
    },
  };
}

function revealCrowd(kind: "cheer" | "damage"): CardScript {
  return {
    onClashRevealed(ctx, won, opposingSeat) {
      if (!won) return;
      if (kind === "cheer") ctx.crowdCheer(ctx.seat); else ctx.dealDamage(opposingSeat, 1);
    },
  };
}

function clashToken(tokenId: string): CardScript {
  return {
    onDefend(ctx) { ctx.requestClash(opponentSeat(ctx), "sup-clash"); },
    onClashResult(ctx, hook, winner) {
      if (hook !== "sup-clash") return;
      if (winner >= 0) ctx.createToken(tokenId, winner);
      const top = ctx.player(ctx.seat).deck[0];
      if (top) {
        ctx.setCounter("clashTop", top.instanceId);
        ctx.requestChoice("clash-bottom", "Put your revealed card on the bottom?", ["yes", "no"]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "clash-bottom" && option === "yes") ctx.putOnDeckBottom(ctx.getCounter("clashTop"));
    },
  };
}

function missCreates(tokenId: string): CardScript {
  return {
    onMiss(ctx) { ctx.setCounter("missed", 1); },
    onCombatChainClosed(ctx) {
      if (ctx.getCounter("missed")) ctx.createToken(tokenId, opponentSeat(ctx));
    },
  };
}

function nextAttack(amount: number, kind?: "cheer" | "boo"): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: amount });
      if (kind === "cheer") ctx.crowdCheer(ctx.seat);
      if (kind === "boo") ctx.crowdBoo(ctx.seat);
    },
  };
}

function destroyOpposingToken(createId: string, targetName: string, heroTag: string): CardScript {
  return {
    canTriggerOnDefend: (ctx) => heroHas(ctx, opponentSeat(ctx), heroTag),
    onDefend(ctx) {
      const token = ctx.player(opponentSeat(ctx)).board.find((card) => named(ctx, card, targetName));
      if (token && ctx.destroyPermanent(token.instanceId)) ctx.createToken(createId);
    },
  };
}

function defendsTogetherWithCardFromHand(ctx: ScriptCtx): boolean {
  if (!ctx.link) return false;
  const count = Number(ctx.link.flags.defendedFromHandCount ?? 0);
  const selfWasFromHand = ctx.link.flags[`defendedFromHand:${ctx.self.instanceId}`] === true ? 1 : 0;
  return count > selfWasFromHand;
}

function suspense(onEnter?: (ctx: ScriptCtx) => void, onLeave?: (ctx: ScriptCtx) => void): CardScript {
  return suspenseLifecycle({ onEnter, onLeave });
}

function suspenseBuff(amount: number): CardScript {
  return suspense(undefined, (ctx) => buffNextAttack(ctx, { attack: amount }));
}

function dramaticPause(amount: number): CardScript {
  return {
    ...suspense((ctx) => {
      if (ctx.playTargetInstanceId !== undefined) ctx.addCardTempDefense(ctx.playTargetInstanceId, amount);
    }),
    playTargetOptions(ctx) {
      return (ctx.link?.defendingCards ?? [])
        .filter((card) => ctx.hasCardType(card, "action"))
        .map((card) => card.instanceId);
    },
  };
}

function storyBeats(): CardScript {
  const request = (ctx: ScriptCtx) => {
    const options = ctx.player(ctx.seat).board.flatMap((card) => suspenseAura(ctx, card)
      ? [`add:${card.instanceId}`, ...(card.counters?.suspense ? [`remove:${card.instanceId}`] : [])]
      : []);
    if (options.length) ctx.requestChoice("story", `${ctx.data.name}: add or remove a suspense counter`, ["pass", ...options]);
  };
  return {
    onAttackDeclared: request,
    onDefend: request,
    onChoose(ctx, hook, option) {
      if (hook !== "story" || option === "pass") return;
      const [action, raw] = option.split(":");
      const id = Number(raw);
      const card = ctx.player(ctx.seat).board.find((candidate) => candidate.instanceId === id);
      if (!card) return;
      const value = card.counters?.suspense ?? 0;
      ctx.setCardCounter(id, "suspense", Math.max(0, value + (action === "add" ? 1 : -1)));
    },
  };
}

function bashHero(className: string): CardScript {
  return {
    modifyAttack: (ctx) => defendedByTag(ctx, className) ? 1 : 0,
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && heroHas(ctx, opponentSeat(ctx), className); },
    onHit(ctx) {
      const targets = ctx.player(opponentSeat(ctx)).board.filter((card) => tokenAura(ctx, card));
      if (targets.length) ctx.requestCardChoice("bash-aura", `${ctx.data.name}: destroy an aura token`, targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "bash-aura") ctx.destroyPermanent(Number(option)); },
  };
}

function defendedByClassToken(className: string, tokenId: string): CardScript {
  return {
    friendlyDefendedTrigger: {
      label: `When this is defended by a ${className} card`,
      condition(ctx, defenders) {
        return ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
          ctx.getCounter("madeToken") === 0 && defenders.some((card) => hasTag(ctx, card, className));
      },
    },
    onFriendlyDefended(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId || ctx.getCounter("madeToken")) return;
      if (defendedByTag(ctx, className)) {
        ctx.setCounter("madeToken", 1);
        ctx.createToken(tokenId);
      }
    },
  };
}

function pitchCondition(kind: "go" | "token" | "power", tokenId = VIGOR): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (!hasSixPlusInPitch(ctx)) return;
      if (kind === "go") ctx.grantGoAgain();
      if (kind === "token") ctx.createToken(tokenId);
      if (kind === "power") ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  };
}

function flex(kind: "speed" | "strength"): CardScript {
  return kind === "speed"
    ? { onAttackDeclared(ctx) { if (ctx.currentAttackPower() >= 6) ctx.grantGoAgain(); } }
    : { modifyAttack(ctx) { return ctx.basePower(ctx.self) + ctx.attackBonusAboveBase(ctx.self.instanceId) >= 6 ? 3 : 0; } };
}

function paidAttack(cost: number, amount: number, penalty = false): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (!ctx.requestPayment("attack-pay", `${ctx.data.name}: pay ${cost}?`, cost) && penalty) {
        ctx.addModifier({ scope: "chain-link", attack: -amount });
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "attack-pay") return;
      if (option === "paid" && !penalty) ctx.addModifier({ scope: "chain-link", attack: amount });
      if (option !== "paid" && penalty) ctx.addModifier({ scope: "chain-link", attack: -amount });
    },
  };
}

function primeCrowd(amount: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: amount, appliesTo: "attack-action" });
      for (const player of ctx.state.players) {
        if (heroHas(ctx, player.seat, "revered")) ctx.crowdCheer(player.seat);
        if (heroHas(ctx, player.seat, "reviled")) ctx.crowdBoo(player.seat);
      }
    },
  };
}

export const sup: Record<string, CardScript> = {
  "tuffnut|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, tap: true, timing: "instant",
      canActivate: (ctx) => ctx.player(ctx.seat).deck.length > 0,
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        const six = isSixPlus(ctx, top);
        ctx.pitchCard(top.instanceId);
        if (six) ctx.crowdCheer(ctx.seat);
      },
    },
    onCheered(ctx) { ctx.createToken(TOUGHNESS); },
  },
  "tough leather boots|0": tokenEquipment("Toughness", "Vigor"),
  "old leather and vim|1": tokenAttack("Toughness", "Vigor"),
  "pleiades|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, tap: true, timing: "instant",
      effectCardCosts: [{ zone: "arena", move: "remove-counter", count: 1, subtype: "aura", counter: { key: "suspense", amount: 1 }, prompt: "Pleiades: choose an aura to remove a suspense counter from" }],
      onActivate(ctx) {
        const targets = ctx.player(ctx.seat).board.filter((card) => suspenseAura(ctx, card));
        if (targets.length) ctx.requestChoice("pleiades-add", "Put a suspense counter on an aura of suspense?", ["pass", ...targets.map((card) => String(card.instanceId))], undefined, [null, ...targets.map((card) => card.instanceId)]);
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pleiades-add" || option === "pass") return;
      const card = ctx.player(ctx.seat).board.find((candidate) => candidate.instanceId === Number(option));
      if (card) ctx.setCardCounter(card.instanceId, "suspense", (card.counters?.suspense ?? 0) + 1);
    },
    onCheered(ctx) { ctx.createToken(CONFIDENCE); },
  },
  "plate of tough love|0": tokenEquipment("Confidence", "Toughness"),
  "uplifting performance|3": tokenAttack("Confidence", "Toughness"),
  "helm of the adored|0": { onDefend(ctx) { ctx.crowdCheer(ctx.seat); } },
  "hold firm|0": { activated: { cost: 2, isAttack: false, goAgain: true, destroySelfCost: true, canActivate: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0, onActivate(ctx) { createMany(ctx, TOUGHNESS, 3); } } },

  ...pitches("comeback kid", () => crowdAttack("cheer", "less", 1)),
  "disarm|2": {
    onAttackDeclared(ctx) { if (ctx.getFlag("player", "cheeredThisTurn")) ctx.createToken(TOUGHNESS); },
    canTriggerOnDefend: (ctx) => (ctx.data.defense ?? 0) + (ctx.self.tempDefense ?? 0) >= 6,
    onDefend(ctx) {
      if ((ctx.data.defense ?? 0) + (ctx.self.tempDefense ?? 0) < 6) return;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length) ctx.requestCardChoice("disarm-bottom", "Put a hand card on the bottom", hand.map((card) => card.instanceId), opponentSeat(ctx));
    },
    onChoose(ctx, hook, option) { if (hook === "disarm-bottom") ctx.putOnDeckBottom(Number(option)); },
  },
  "disembody|1": {
    onAttackDeclared(ctx) { if (ctx.getFlag("player", "cheeredThisTurn")) ctx.createToken(TOUGHNESS); },
    canTriggerOnDefend: (ctx) => (ctx.data.defense ?? 0) + (ctx.self.tempDefense ?? 0) >= 6,
    onDefend(ctx) {
      if ((ctx.data.defense ?? 0) + (ctx.self.tempDefense ?? 0) < 6) return;
      const targets = ctx.player(opponentSeat(ctx)).board.filter((card) => aura(ctx, card));
      if (targets.length) ctx.requestCardChoice("disembody-bottom", "Put an aura on the bottom", targets.map((card) => card.instanceId), opponentSeat(ctx));
    },
    onChoose(ctx, hook, option) { if (hook === "disembody-bottom") ctx.putOnDeckBottom(Number(option)); },
  },
  "disperse|3": {
    onAttackDeclared(ctx) { if (ctx.getFlag("player", "cheeredThisTurn")) ctx.createToken(TOUGHNESS); },
    canTriggerOnDefend: (ctx) => (ctx.data.defense ?? 0) + (ctx.self.tempDefense ?? 0) >= 6,
    onDefend(ctx) {
      if ((ctx.data.defense ?? 0) + (ctx.self.tempDefense ?? 0) < 6) return;
      const card = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (card) ctx.putOnDeckBottom(card.instanceId);
    },
  },
  "fight fair|1": fightCard("reviled", "reviled", false),
  "shining courage|1": {
    onPlay(ctx) {
      const targets = ctx.link?.defendingCards.filter((card) => ctx.hasCardType(card, "action")) ?? [];
      ctx.crowdCheer(ctx.seat);
      if (targets.length) ctx.requestChoice("shine-target", "Give a defending action +3 defense?", ["pass", ...targets.map((card) => String(card.instanceId))], undefined, [null, ...targets.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "shine-target" && option !== "pass") ctx.addCardTempDefense(Number(option), 3); },
  },
  "will of the crowd|3": { canTriggerOnDefend: (ctx) => ctx.getFlag("player", "cheeredThisTurn") === true, onDefend(ctx) { if (ctx.getFlag("player", "cheeredThisTurn")) for (const card of ctx.link?.defendingCards ?? []) if (ctx.hasCardType(card, "action")) ctx.addCardTempDefense(card.instanceId, 3); } },
  ...pitches("dig in", () => xTokens(TOUGHNESS, "defend")),
  "empowering ruckus|2": { modifyAttack: (ctx) => ctx.getFlag("player", "cheeredThisTurn") ? 1 : 0 },
  ...pitches("fight from behind", () => crowdWhenBehind("cheer")),
  ...pitches("rapturous applause", () => revealCrowd("cheer")),
  ...pitches("tough smashup", () => clashToken(TOUGHNESS)),
  ...pitches("turn the crowd grateful", () => subtypeOpponentAttack("reviled", 1, "cheer")),
  ...pitches("who's the tough guy?", () => missCreates(TOUGHNESS)),
  "cheers!|3": {
    onEnterArena(ctx) { ctx.crowdCheer(ctx.seat); },
    onLeaveArena(ctx) { ctx.crowdCheer(ctx.seat); },
    triggers: [{ event: "start-of-turn", label: "Destroy Cheers!", effect(ctx) { ctx.destroySelf(); } }],
  },
  "heroic grit|2": { onPlay(ctx) { ctx.createToken(TOUGHNESS); buffNextAttack(ctx, { attack: ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Toughness")).length }); } },
  ...pitches("heroic pose", (pitch) => nextAttack(4 - pitch, "cheer")),
  "humble entrance|3": { onPlay(ctx) { createMany(ctx, TOUGHNESS, 3); } },
  "darling of the crowd|2": { modifyDefense: (ctx) => ctx.getFlag("player", "cheeredThisTurn") ? 1 : 0 },
  "not so mighty|3": destroyOpposingToken(TOUGHNESS, "Might", "reviled"),

  "kayo, strong-arm|0": {
    modifyBasePower(_ctx, card, base) { return card.counters?.kayoBaseSix ? 6 : base; },
    activated: {
      cost: 4, isAttack: false, goAgain: false, tap: true, timing: "instant",
      canActivate: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat && ctx.link.attackCardType === "action",
      onActivate(ctx) { if (ctx.link) ctx.setCardCounter(ctx.link.attackingCard.instanceId, "kayoBaseSix", 1); },
    },
    onBooed(ctx) { ctx.createToken(VIGOR); },
  },
  "laughing knee-slappers|0": tokenEquipment("Might", "Vigor"),
  "offensive behavior|3": tokenAttack("Might", "Vigor"),
  "strong stomach for adversity|0": tokenEquipment("Confidence", "Might"),
  "spew obscenities|2": tokenAttack("Confidence", "Might"),
  "horns of the despised|0": { onDefend(ctx) { ctx.crowdBoo(ctx.seat); } },
  "mightybone knuckles|0": { activated: { cost: 3, isAttack: false, goAgain: true, destroySelfCost: true, canActivate: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) > 0, onActivate(ctx) { createMany(ctx, MIGHT, 3); } } },
  "fight dirty|1": fightCard("revered", "revered", true),
  "overturn the results|3": { failedClashBecomesWin: { booController: true } },
  "cheap shot|2": {
    playAsInstant: (ctx) => ctx.getFlag("player", "booedThisTurn") === true,
    onPlay(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (!hand.length) { ctx.dealDamage(target, 2); return; }
      ctx.requestChoice("cheap-discard", "Discard a card to prevent 2 damage?", ["take 2", ...hand.map((card) => String(card.instanceId))], target, [null, ...hand.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "cheap-discard") return;
      if (option === "take 2") ctx.dealDamage(opponentSeat(ctx), 2);
      else ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  },
  "arrogant showboating|3": { onPlay(ctx) { const n = ctx.state.chain.flatMap((link) => [...link.defendingCards, ...link.defendingEquipment]).filter((card) => card.owner !== ctx.seat).length; createMany(ctx, MIGHT, n); } },
  ...pitches("bask in your own greatness", () => xTokens(MIGHT, "attack")),
  ...pitches("clench the upper hand", () => crowdWhenBehind("boo")),
  "goon battery|3": { modifyAttack: (ctx) => countAuras(ctx) >= 3 ? 3 : 0, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && countAuras(ctx) >= 3; }, onHit(ctx) { ctx.tap(ctx.player(opponentSeat(ctx)).hero.instanceId); } },
  ...pitches("instill fear", () => ({ onAttackDeclared(ctx) { queueIntimidate(ctx); } })),
  "low blow|1": { modifyAttack: (ctx) => ctx.getFlag("player", "booedThisTurn") ? 3 : 0 },
  ...pitches("take that!", () => missCreates(MIGHT)),
  ...pitches("turn the crowd hateful", () => subtypeOpponentAttack("revered", 3, "boo")),
  "cruel ambition|1": { onPlay(ctx) { createMany(ctx, MIGHT, 3); } },
  "revolting gesture|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 3 }); ctx.createToken(MIGHT); } },
  "villainous pose|2": nextAttack(3, "boo"),
  "villainous pose|3": nextAttack(2, "boo"),
  "disdainful delight|2": { modifyDefense: (ctx) => ctx.getFlag("player", "booedThisTurn") ? 1 : 0 },
  "not so tuff|3": destroyOpposingToken(MIGHT, "Toughness", "revered"),

  "overbearing presence|0": { activated: { cost: 3, isAttack: false, goAgain: true, destroySelfCost: true, canActivate: hasSixPlusInPitch, onActivate(ctx) { createMany(ctx, VIGOR, 3); } } },
  "vigorous roar|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 3 }); if (hasSixPlusInPitch(ctx)) ctx.createToken(VIGOR); } },
  "visit the boneyard|3": {
    onPlay(ctx) {
      const targets = ctx.player(ctx.seat).graveyard.filter((card) => isSixPlus(ctx, card));
      if (targets.length) ctx.requestCardChoice("boneyard", "Put a 6+ card on top", targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "boneyard" && ctx.putOnDeckTop(Number(option))) ctx.createToken(VIGOR); },
  },
  "asking for trouble|2": { onDefend(ctx) { ctx.createToken(VIGOR, opponentSeat(ctx)); } },
  "bash guardian|1": bashHero("guardian"),
  "familiar stench|1": defendedByClassToken("brute", VIGOR),
  "buckwild|2": pitchCondition("go"),
  ...pitches("flex speed", () => flex("speed")),
  ...pitches("flex strength", () => flex("strength")),
  ...pitches("give 'em a piece of your mind", () => missCreates(VIGOR)),
  "high pitched howl|2": pitchCondition("token"),
  "high pitched howl|3": pitchCondition("token"),
  "rough up|2": pitchCondition("power"),
  "rough up|3": pitchCondition("power"),
  "unexpected backhand|1": revealCrowd("damage"),
  "unexpected backhand|2": revealCrowd("damage"),
  ...pitches("vigorous smashup", () => clashToken(VIGOR)),
  "bark obscenities|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToTargetType: "guardian" }); } },

  "full of bravado|1": { onAttackDeclared(ctx) { if (controlsSuspense(ctx)) ctx.createToken(CONFIDENCE); }, canTriggerOnDefend: controlsSuspense, onDefend(ctx) { if (controlsSuspense(ctx)) ctx.createToken(CONFIDENCE); } },
  "full of bravado|2": { onAttackDeclared(ctx) { if (controlsSuspense(ctx)) ctx.createToken(CONFIDENCE); }, canTriggerOnDefend: controlsSuspense, onDefend(ctx) { if (controlsSuspense(ctx)) ctx.createToken(CONFIDENCE); } },
  ...pitches("story beats", () => storyBeats()),
  "bash brute|1": bashHero("brute"),
  "familiar story|1": defendedByClassToken("guardian", CONFIDENCE),
  "power play|1": { modifyAttack: (ctx) => ctx.link?.flags.fromArsenal ? 5 : 0 },
  "power play|2": { modifyAttack: (ctx) => ctx.link?.flags.fromArsenal ? 5 : 0 },
  ...pitches("shoot your mouth off", () => missCreates(CONFIDENCE)),
  "small problem|2": {
    modifyAttack(ctx) { return ctx.attackBonusAboveBase(ctx.self.instanceId) > 0 ? 1 : 0; },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4; },
    onHit(ctx) {
      const targets = ctx.player(opponentSeat(ctx)).board.filter((card) => aura(ctx, card));
      if (targets.length) ctx.requestCardChoice("small-aura", "Destroy an aura", targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "small-aura") ctx.destroyPermanent(Number(option)); },
  },
  "act of glory|2": suspenseBuff(5),
  "act of glory|3": suspenseBuff(4),
  "dramatic pause|1": dramaticPause(3),
  "dramatic pause|2": dramaticPause(2),
  "dramatic pause|3": dramaticPause(1),
  "edge of their seats|2": suspenseBuff(4),
  "tension in the air|2": suspenseBuff(3),
  "tension in the air|3": suspenseBuff(2),
  "to be continued...|3": { ...suspense(), fixedDamagePrevention: { amount: 1, oncePerTurn: true } },
  "what happens next?|3": {
    ...suspense(),
    modifyFriendlyCardPlayCost(ctx, card, _zone, baseCost) {
      return (data(ctx, card).cost ?? 0) >= 1 && !ctx.getFlag("player", `whatNextUsed:${ctx.self.instanceId}`) ? baseCost - 1 : baseCost;
    },
    onFriendlyPlay(ctx, played) {
      if ((data(ctx, played).cost ?? 0) >= 1) ctx.setFlag("player", `whatNextUsed:${ctx.self.instanceId}`, true);
    },
  },
  "sit!|1": { canTriggerOnDefend: (ctx) => ctx.currentAttackHasType("brute"), onDefend(ctx) { ctx.addCardTempDefense(ctx.self.instanceId, 3); } },
  "helm of hindsight|0": {
    activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { const cards = ctx.player(ctx.seat).graveyard.filter((card) => ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack")); if (cards.length) ctx.requestCardChoice("hindsight", "Put an attack action on top", cards.map((card) => card.instanceId)); } },
    onChoose(ctx, hook, option) { if (hook === "hindsight") ctx.putOnDeckTop(Number(option)); },
  },
  "punching gloves|0": { activated: { cost: 2, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { buffNextAttack(ctx, { attack: 2, appliesTo: "attack-action" }); } } },
  "toby jugs|0": { defendCost: 1, ...payForDefenseBoost(1, 2) },

  "bluster buff|1": paidAttack(1, 1, true),
  "chest puff|1": paidAttack(1, 1, true),
  ...pitches("punch above your weight", (pitch) => paidAttack(3, 6 - pitch)),
  ...pitches("right behind you", () => ({
    canTriggerOnDefend: defendsTogetherWithCardFromHand,
    onDefend(ctx) {
      ctx.addCardTempDefense(ctx.self.instanceId, 1);
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.lookAt(top.instanceId);
      ctx.setCounter("rightTop", top.instanceId);
      ctx.requestChoice("right-bottom", "Put the looked-at card on the bottom?", ["yes", "no"]);
    },
    onChoose(ctx, hook, option) { if (hook === "right-bottom" && option === "yes") ctx.putOnDeckBottom(ctx.getCounter("rightTop")); },
  })),
  "prime the crowd|2": primeCrowd(3),
  "prime the crowd|3": primeCrowd(2),

  "toughness|0": {
    triggers: [{
      event: "start-of-turn", whose: "any", label: "Destroy Toughness",
      condition: (ctx) => ctx.state.activePlayer !== ctx.seat,
      effect(ctx) {
        ctx.destroySelf();
        ctx.addModifier({ scope: "until-end-of-turn", defense: 1, appliesToCardType: "action", appliesToFirstDefenderOnly: true, once: true });
      },
    }],
  },
};

const AGILITY = "AKO027";
const COURAGE = "ASB027";
const SELLSWORD = "HVY134";

function tokenNamed(ctx: ScriptCtx, seat: number, name: string): Card | undefined {
  return ctx.player(seat).board.find((card) => named(ctx, card, name) && tokenAura(ctx, card));
}

function convertTokens(from: string, to: string, max = 3): CardScript {
  return {
    onPlay(ctx) {
      const tokens = ctx.state.players.flatMap((player) => player.board).filter((card) => named(ctx, card, from) && tokenAura(ctx, card)).slice(0, max);
      for (const token of tokens) if (ctx.destroyPermanent(token.instanceId)) ctx.createToken(to);
    },
  };
}

function tower(payoff: (ctx: ScriptCtx) => void): CardScript {
  return {
    modifyAttack(ctx) { return ctx.attackBonusAboveBase(ctx.self.instanceId) > 0 ? 1 : 0; },
    canTriggerOnHit(ctx) { return ctx.currentAttackPower() >= 13 && ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { payoff(ctx); },
  };
}

function destroyAuraAtTarget(ctx: ScriptCtx, seat: number, hook: string): void {
  const targets = ctx.player(seat).board.filter((card) => aura(ctx, card));
  if (targets.length) ctx.requestCardChoice(hook, `${ctx.data.name}: destroy an aura`, targets.map((card) => card.instanceId));
}

function goldenEquipment(): CardScript {
  return { allZoneNames: ["Gold"] };
}

Object.assign(sup, {
  "authority of ataya|3": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Defense reactions cost opponents 1 more", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx: ScriptCtx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), playCostReduction: -1, appliesToCardType: "defense-reaction" }); } }] },
  "tuffnut, bumbling hulkster|0": sup["tuffnut|0"]!,
  "good natured brutality|2": { modifyDefense: (ctx: ScriptCtx) => ctx.player(ctx.seat).hand.length === 0 ? 6 : 0, canTriggerOnDefend: (ctx: ScriptCtx) => ctx.player(ctx.seat).hand.length === 0, onDefend(ctx: ScriptCtx) { if (ctx.player(ctx.seat).hand.length === 0) ctx.crowdCheer(ctx.seat); } },
  "jaws of victory|1": { onAttackDeclared(ctx: ScriptCtx) { if (ctx.link?.targetAllyId === undefined && ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) ctx.crowdCheer(ctx.seat); if (ctx.getFlag("player", "cheeredThisTurn")) ctx.grantGoAgain(); } },
  "wind up the crowd|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx: ScriptCtx) { ctx.createToken(TOUGHNESS); ctx.createToken(VIGOR); } } },
  "numbskull charm|2": { onPlay(ctx: ScriptCtx) { for (const name of ["Confidence", "Might"]) { const token = tokenNamed(ctx, opponentSeat(ctx), name) ?? tokenNamed(ctx, ctx.seat, name); if (token) ctx.destroyPermanent(token.instanceId); } ctx.crowdCheer(ctx.seat); const top = ctx.player(ctx.seat).deck[0]; if (top) { const six = isSixPlus(ctx, top); ctx.pitchCard(top.instanceId); if (six) ctx.createToken(VIGOR); } } },
  "cries of encore|1": { onAttackDeclared(ctx: ScriptCtx) { if (ctx.link?.targetAllyId === undefined && ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) ctx.crowdCheer(ctx.seat); }, canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("player", "cheeredThisTurn") === true; }, onHit(ctx: ScriptCtx) { ctx.setFlag("player", "planSuspenseFromGraveyard", true); } },
  "crowd goes wild|2": { modifyPlayCost: (ctx: ScriptCtx, base: number) => ctx.getFlag("player", "cheeredThisTurn") ? base - 3 : base },
  "no hero stands alone|2": { canDefendFromArsenal: (ctx: ScriptCtx) => ctx.getFlag("player", "controlledName:toughness") === true, modifyDefense: (ctx: ScriptCtx) => ctx.getFlag("player", "controlledName:toughness") ? 3 : 0, onDefend(ctx: ScriptCtx) { ctx.requestClash(opponentSeat(ctx), "hero-alone"); }, onClashResult(ctx: ScriptCtx, hook: string, winner: number) { if (hook === "hero-alone" && winner >= 0 && ctx.link) { const cards = [ctx.link.attackingCard, ...ctx.link.defendingCards]; if (cards.length) ctx.requestCardChoice("hero-alone-card", "Give a combat card -3 power and defense", cards.map((card) => card.instanceId), winner); } }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "hero-alone-card") { ctx.addCardTempPower(Number(option), -3); ctx.addCardTempDefense(Number(option), -3); } } },
  "a good clean fight|1": { suppressesAttackActionHitEffects: true },
  "escalate order|1": { onAttackDeclared(ctx: ScriptCtx) { if (controls(ctx, "Toughness")) createMany(ctx, TOUGHNESS, 3); } },
  "old favorite|2": { onAttackDeclared(ctx: ScriptCtx) { if (ctx.getFlag("player", "cheeredThisTurn")) ctx.createToken(TOUGHNESS); }, canTriggerOnDefend: (ctx: ScriptCtx) => ctx.currentPower(ctx.self) >= 6, onDefend(ctx: ScriptCtx) { if (ctx.currentPower(ctx.self) >= 6) ctx.setCounter("oldBottom", 1); }, onCombatChainClosed(ctx: ScriptCtx) { if (ctx.getCounter("oldBottom")) ctx.putOnDeckBottom(ctx.self.instanceId); } },
  "tame the beastly behavior|1": { modifyAttack: (ctx: ScriptCtx) => heroHas(ctx, opponentSeat(ctx), "reviled") ? 1 : 0, canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined && heroHas(ctx, opponentSeat(ctx), "reviled"); }, onHit(ctx: ScriptCtx) { const card = ctx.player(opponentSeat(ctx)).arsenal[0]; if (card) ctx.putOnDeckBottom(card.instanceId); } },
  "renounce violence|3": convertTokens("Might", TOUGHNESS),
  "kayo, underhanded cheat|0": sup["kayo, strong-arm|0"]!,
  "outside interference|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx: ScriptCtx) { ctx.setFlag("player", "outsideInterference", true); } } },
  "big bully|1": {
    onAttackDeclared(ctx: ScriptCtx) {
      if (ctx.link?.targetAllyId === undefined && ctx.compareLife(ctx.seat, opponentSeat(ctx)) > 0) {
        ctx.crowdBoo(ctx.seat);
      }
    },
    multiplyBasePower(ctx: ScriptCtx, _card: Card, base: number) {
      return ctx.getFlag("player", "booedThisTurn") ? base * 2 : base;
    },
  },
  "cheater's charm|2": { onPlay(ctx: ScriptCtx) { for (const name of ["Confidence", "Toughness"]) { const token = tokenNamed(ctx, opponentSeat(ctx), name); if (token) ctx.steal(token.instanceId, { duration: "indefinite" }); } ctx.crowdBoo(ctx.seat); if (ctx.link && ctx.currentAttackPower() >= 6) { const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length) ctx.requestCardChoice("cheater-discard", "Discard a card or take 2 damage", ["damage", ...hand.map((card) => card.instanceId)], opponentSeat(ctx)); else ctx.dealDamage(opponentSeat(ctx), 2); } }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "cheater-discard") { if (option === "damage") ctx.dealDamage(opponentSeat(ctx), 2); else ctx.discardCard(opponentSeat(ctx), Number(option)); } } },
  "steal victory|3": { onDefend(ctx: ScriptCtx) { const targets = ctx.player(opponentSeat(ctx)).board.filter((card) => tokenAura(ctx, card)); if (targets.length) ctx.requestCardChoice("steal-victory", "Steal an aura token", targets.map((card) => card.instanceId)); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "steal-victory") ctx.steal(Number(option), { duration: "indefinite" }); } },
  "lyath goldmane, vile savant|0": { divideBasePower: (_ctx: ScriptCtx, _card: Card, base: number) => Math.ceil(base / 2), modifyBaseDefense: (_ctx: ScriptCtx, _card: Card, base: number) => Math.ceil(base / 2), activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", tap: true, onActivate(ctx: ScriptCtx) { ctx.crowdBoo(ctx.seat); ctx.addModifier({ scope: "until-end-of-turn", defense: 1, appliesToCardType: "action" }); } }, onBooed(ctx: ScriptCtx) { ctx.createToken(MIGHT); } },
  "leave them hanging|1": suspense((ctx) => queueIntimidate(ctx), (ctx) => { queueIntimidate(ctx); buffNextAttack(ctx, { attack: 4 }); }),
  "two steps ahead|3": { triggers: [{ event: "start-of-turn", label: "Destroy Two Steps Ahead", effect(ctx: ScriptCtx) { ctx.destroySelf(); ctx.createToken(CONFIDENCE); createMany(ctx, MIGHT, 3); } }] },
  "liar's charm|2": { onPlay(ctx: ScriptCtx) { ctx.requestChoice("liar-modes", "Choose any number of modes", ["none", "steal", "boo", "abilities", "steal + boo", "steal + abilities", "boo + abilities", "all"]); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "liar-modes") { const modes = option === "none" ? 0 : option === "steal" ? 1 : option === "boo" ? 2 : option === "abilities" ? 4 : option === "steal + boo" ? 3 : option === "steal + abilities" ? 5 : option === "boo + abilities" ? 6 : 7; ctx.setCounter("liar-modes", modes); if ((modes & 1) !== 0) { const tokens = ["Toughness", "Vigor"].flatMap((name) => { const token = tokenNamed(ctx, opponentSeat(ctx), name); return token ? [token] : []; }); if (tokens.length) { ctx.requestCardChoice("liar-steal", "Choose a Toughness or Vigor token to steal", tokens.map((card) => card.instanceId)); return; } } finishLiarsCharmModes(ctx, modes); } else if (hook === "liar-steal") { ctx.steal(Number(option), { duration: "indefinite" }); finishLiarsCharmModes(ctx, ctx.getCounter("liar-modes")); } else if (hook === "liar-discard") { const target = opponentSeat(ctx); if (option === "lose abilities") ctx.suppressHeroAbilitiesThroughNextTurn(target); else resolveDiscardChoice(ctx, option, target); } } },
  "truth or trickery|2": { onDefend(ctx: ScriptCtx) { const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.lookAt(top.instanceId); ctx.requestChoice("truth-color", "Choose a color", ["pass", "red", "yellow", "blue"]); } }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "truth-color" && option !== "pass") { ctx.setCounter("truth-color", option === "red" ? 1 : option === "yellow" ? 2 : 3); ctx.requestChoice("truth-guess", `Is the top card ${option}?`, ["yes", "no"], opponentSeat(ctx)); } else if (hook === "truth-guess") { const top = ctx.player(ctx.seat).deck[0]; if (!top) return; ctx.lookAtForSeat(top.instanceId, opponentSeat(ctx)); const matches = ctx.cardColor(top) === ctx.getCounter("truth-color"); const guessedYes = option === "yes"; if (matches !== guessedYes) requestDiscardChoice(ctx, "truth-discard", "Choose a card to discard", opponentSeat(ctx)); } else if (hook === "truth-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx)); } },
  "bully tactics|1": { onAttackDeclared(ctx: ScriptCtx) { ctx.requestXPayment("bully-x", "Pay up to 3 to intimidate", undefined, 3); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "bully-x") for (let i = 0; i < Number(option.slice(2)); i++) queueIntimidate(ctx); } },
  "fix the match|2": { onAttackDeclared(ctx: ScriptCtx) { const deck = ctx.player(ctx.seat).deck; if (deck.length) ctx.requestCardChoice("fix-top", "Choose a card to put on top", deck.map((card) => card.instanceId)); }, onFriendlyDefended(ctx: ScriptCtx) { ctx.requestClash(opponentSeat(ctx), "fix-clash"); }, onClashResult(ctx: ScriptCtx, hook: string, winner: number) { if (hook === "fix-clash" && winner >= 0) ctx.createToken(MIGHT, winner); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "fix-top" && ctx.putOnDeckTop(Number(option))) ctx.shuffleDeck(ctx.seat); } },
  "battered, beaten, and broken|2": { onAttackDeclared(ctx: ScriptCtx) { if (ctx.link?.targetAllyId === undefined) queueIntimidate(ctx); }, modifyAttack: (ctx: ScriptCtx) => countAuras(ctx) >= 3 ? 3 : 0 },
  "escalate violence|3": { onAttackDeclared(ctx: ScriptCtx) { if (controls(ctx, "Might")) createMany(ctx, MIGHT, 3); } },
  "gang robbery|2": { modifyAttack: (ctx: ScriptCtx) => countAuras(ctx) >= 3 ? 3 : 0, onAttackDeclared(ctx: ScriptCtx) { const targets = ctx.player(opponentSeat(ctx)).board.filter((card) => tokenAura(ctx, card)); if (targets.length) ctx.requestCardChoice("gang-steal", "Steal an aura token", targets.map((card) => card.instanceId)); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "gang-steal") ctx.steal(Number(option), { duration: "indefinite" }); } },
  "tear down the idols|1": { onAttackDeclared(ctx: ScriptCtx) { if (heroHas(ctx, opponentSeat(ctx), "revered")) queueIntimidate(ctx); }, canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined && heroHas(ctx, opponentSeat(ctx), "revered"); }, onHit(ctx: ScriptCtx) { requestDiscardChoice(ctx, "idols-discard", "Choose a card to discard", opponentSeat(ctx)); }, onChoose(ctx, hook, option) { if (hook === "idols-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx)); } },
  "the old switcheroo|3": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx: ScriptCtx) { ctx.setFlag("player", "reverseNextClash", true); } } },
  "rip up their virtues|3": convertTokens("Toughness", MIGHT),
  "gauntlets of tyrannical rex|0": { activated: { cost: 1, isAttack: false, goAgain: true, tap: true, canActivate: hasSixPlusInPitch, onActivate(ctx: ScriptCtx) { buffNextAttack(ctx, { attack: 1 }); } } },
  "reckless stampede|1": { onFriendlyDefended(ctx: ScriptCtx) { ctx.requestClash(opponentSeat(ctx), "stampede"); }, onClashResult(ctx: ScriptCtx, hook: string, winner: number) { if (hook !== "stampede" || winner < 0) return; for (const player of ctx.state.players) if (player.seat !== winner) ctx.dealDamage(player.seat, 1); } },
  "show of strength|1": { modifyAttack(ctx: ScriptCtx) { return -(ctx.link?.defendingCards.filter((card) => isSixPlus(ctx, card)).length ?? 0); } },
  "challenge the alpha|2": { modifyAttack: (ctx: ScriptCtx) => heroHas(ctx, opponentSeat(ctx), "brute") ? 2 : 0, canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined && heroHas(ctx, opponentSeat(ctx), "brute"); }, onHit(ctx: ScriptCtx) { requestDiscardChoice(ctx, "alpha-discard", "Choose a card to discard", opponentSeat(ctx)); }, onChoose(ctx, hook, option) { if (hook !== "alpha-discard") return; const card = resolveDiscardChoice(ctx, option, opponentSeat(ctx)); if (isSixPlus(ctx, card)) ctx.loseLife(ctx.seat, 2); } },
  "disturb the peace|1": { canBeDefendedBy(ctx: ScriptCtx, card: Card) { return !(hasTag(ctx, card, "guardian") && aura(ctx, card)); }, canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined && heroHas(ctx, opponentSeat(ctx), "guardian"); }, onHit(ctx: ScriptCtx) { destroyAuraAtTarget(ctx, opponentSeat(ctx), "disturb-aura"); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "disturb-aura") ctx.destroyPermanent(Number(option)); } },
  "energetic impact|3": { canTriggerOnDefend: (ctx: ScriptCtx) => ctx.link?.defendingCards.some((card) => card.instanceId !== ctx.self.instanceId && isSixPlus(ctx, card)) === true, onDefend(ctx: ScriptCtx) { ctx.createToken(VIGOR); } },
  "smashing ground|3": { canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined && ctx.currentAttackPower() >= 6; }, onHit(ctx: ScriptCtx) { const card = ctx.player(opponentSeat(ctx)).arsenal[0]; if (card) ctx.moveToGraveyard(card.instanceId, "arsenal"); } },
  "smash with big rock|2": { modifyDefendingDefense: () => 0 },
  "song of sinew|2": {
    onResolved(ctx: ScriptCtx) {
      const top = ctx.player(ctx.seat).deck.slice(0, 4);
      const ids = top.map((card) => card.instanceId);
      ctx.revealCards(ids);
      buffNextAttack(ctx, { attack: top.filter((card) => isSixPlus(ctx, card)).length });
      requestSongOfSinewOrder(ctx, ids);
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      const match = /^song-sinew-order:([\d,]+)$/.exec(hook);
      if (!match) return;
      if (option === "pass") return; // keep the remaining cards in their order
      const ids = match[1]!.split(",").map(Number);
      const chosen = Number(option);
      if (!ids.includes(chosen) || !ctx.putOnDeckTop(chosen)) return;
      requestSongOfSinewOrder(ctx, ids.filter((id) => id !== chosen));
    },
  },
  "ironfist revelation|0": { onDefend(ctx: ScriptCtx) { const cards = ctx.player(ctx.seat).arsenal.filter((card) => card.faceDown && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "crush")); if (cards.length) ctx.requestCardChoice("ironfist", "Turn a crush card face-up", cards.map((card) => card.instanceId)); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "ironfist" && ctx.turnArsenalFaceUp(Number(option))) ctx.addCounter(Number(option), "power", 1); } },
  "no tall tales|2": tower((ctx) => ctx.suppressOwnedCardAbilitiesNextTurn(opponentSeat(ctx))),
  "in the palm of your hand|1": suspense((ctx) => ctx.drawCards(ctx.seat, 1), (ctx) => ctx.drawCards(ctx.seat, 1)),
  "cut a long story short|2": tower((ctx) => { const target = opponentSeat(ctx); for (const card of [...ctx.player(target).hand]) ctx.discardCard(target, card.instanceId); }),
  "cut off at the knees|2": tower((ctx) => { for (const card of ctx.player(opponentSeat(ctx)).deck.slice(0, 3)) ctx.moveToGraveyard(card.instanceId, "deck"); }),
  "cut the small talk|2": tower((ctx) => { for (const card of [...ctx.player(opponentSeat(ctx)).board].filter((candidate) => aura(ctx, candidate))) ctx.destroyPermanent(card.instanceId); }),
  "hungry for more|1": suspense(undefined, (ctx) => ctx.gainLife(ctx.seat, 3)),
  "turn heads|3": suspense(undefined, (ctx) => { const hero = ctx.state.players.find((p) => heroHas(ctx, p.seat, "brute"))?.hero; if (hero) ctx.tap(hero.instanceId); }),
  "who blinks first?|3": suspense(undefined, (ctx) => { const player = ctx.state.players.find((p) => heroHas(ctx, p.seat, "guardian")); if (player) destroyAuraAtTarget(ctx, player.seat, "blinks-aura"); }),
  "cutting retort|1": { onAttackDeclared(ctx: ScriptCtx) { ctx.requestXPayment("retort-x", "Pay up to 3", undefined, 3); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "retort-x") { const n = Number(option.slice(2)); const tokens = ctx.player(opponentSeat(ctx)).board.filter((card) => tokenAura(ctx, card)).slice(0, n); for (const token of tokens) if (ctx.destroyPermanent(token.instanceId)) ctx.addModifier({ scope: "chain-link", attack: 1 }); } } },
  "overcrowded|3": { modifyAttack(ctx: ScriptCtx) { return new Set(ctx.state.players.flatMap((p) => p.board.filter((card) => tokenAura(ctx, card)).map((card) => data(ctx, card).name))).size; }, modifyDefense(ctx: ScriptCtx) { return new Set(ctx.state.players.flatMap((p) => p.board.filter((card) => tokenAura(ctx, card)).map((card) => data(ctx, card).name))).size; } },
  "kick the hornet's nest|2": {
    triggers: [{
      event: "card-put-into-graveyard",
      sourceZone: "graveyard",
      label: "Create Confidence, Might, Toughness, and Vigor tokens",
      condition: (ctx, card, eventContext) =>
        card?.instanceId === ctx.self.instanceId &&
        eventContext?.causedBySeat !== undefined &&
        eventContext.causedBySeat !== ctx.seat,
      effect(ctx) {
        for (const token of [CONFIDENCE, MIGHT, TOUGHNESS, VIGOR]) ctx.createToken(token);
      },
    }],
  },
  "unwavering resolve|1": { modifyAttack: (ctx: ScriptCtx) => ctx.player(ctx.seat).deck.length === 0 ? 4 : 0, friendlyDefendedTrigger: { label: "If this is defended by 3 or more cards", condition: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId && (ctx.link?.defendingCards.length ?? 0) >= 3 }, onFriendlyDefended(ctx: ScriptCtx) { if ((ctx.link?.defendingCards.length ?? 0) >= 3) ctx.grantGoAgain(); } },
  "beat the same drum|3": { onPlay(ctx: ScriptCtx) { for (const [name, id] of [["Agility", AGILITY], ["Confidence", CONFIDENCE], ["Might", MIGHT], ["Toughness", TOUGHNESS], ["Vigor", VIGOR]] as const) if (ctx.getFlag("player", `controlledName:${name.toLowerCase()}`)) ctx.createToken(id); } },
  "time flies when you're having fun|1": { onPlay(ctx: ScriptCtx) { ctx.setFlag("player", "timeFliesAura", true); if (ctx.fromArsenal) buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action" }); } },
  "hunter or hunted?|3": {
    ...contractWithSilver((ctx, card) =>
      !!ctx.self.chosenName && ctx.cardNames(card).includes(ctx.self.chosenName.toLowerCase())
    ),
    onDefend(ctx: ScriptCtx) {
      ctx.requestNameChoice("hunter-name", "Name a card");
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      const target = opponentSeat(ctx);
      if (hook === "hunter-name") {
        ctx.setChosenName(option);
        const top = ctx.player(target).deck[0];
        if (!top) return;
        ctx.revealCards([top.instanceId], target);
        const named = (card: DeepReadonly<CardInstance>) =>
          ctx.cardNames(card).some((name) => name.toLowerCase() === option.toLowerCase());
        if (!named(top) || !ctx.banish(top.instanceId)) return;
        requestHunterSearch(ctx);
      }
    },
    onChooseMany(ctx: ScriptCtx, hook: string, options: readonly string[]) {
      if (hook !== "hunter-search") return;
      const target = opponentSeat(ctx);
      const candidates = new Map(
        hunterSearchCandidates(ctx).map((card) => [card.instanceId, card]),
      );
      for (const option of options) {
        const chosen = candidates.get(Number(option));
        if (!chosen) continue;
        if (chosen.faceDown) ctx.setCardFaceDown(chosen.instanceId, false);
        ctx.banish(chosen.instanceId);
      }
      ctx.shuffleDeck(target);
    },
  },
  "tempest palm gustwave|2": { modifyAttack: (ctx: ScriptCtx) => previousAttackHasName(ctx, "surging strike") ? 2 : 0, onAttackDeclared(ctx: ScriptCtx) { if (ctx.currentChainLinkNumber() >= 3) ctx.grantGoAgain(); } },
  "golden galea|0": goldenEquipment(),
  "golden heart plate|0": goldenEquipment(),
  "golden gauntlets|0": goldenEquipment(),
  "golden gait|0": goldenEquipment(),
  "beat of the ironsong|3": {
    canPlay: (ctx: ScriptCtx) =>
      !!ctx.link &&
      !ctx.link.resolved &&
      ctx.link.attacker === ctx.seat &&
      named(ctx, ctx.link.attackingCard, "dawnblade"),
    additionalCost(ctx: ScriptCtx) {
      const counters = Math.max(0, Number(ctx.link?.attackingCard.counters?.power ?? 0));
      const count = Math.min(BEAT_OF_THE_IRONSONG_MODES.length, counters + 1);
      ctx.setCounter("beat-modes-remaining", count);
      ctx.setCounter("beat-modes", 0);
      ctx.requestChoice(
        "beat-mode",
        `Beat of the Ironsong: choose ${count} mode${count === 1 ? "" : "s"}`,
        [...BEAT_OF_THE_IRONSONG_MODES],
      );
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "beat-mode") return;
      const bit = beatOfTheIronsongModeBit(option);
      if (bit === 0 || (ctx.getCounter("beat-modes") & bit) !== 0) return;
      const selected = ctx.getCounter("beat-modes") | bit;
      const remaining = ctx.getCounter("beat-modes-remaining") - 1;
      ctx.setCounter("beat-modes", selected);
      ctx.setCounter("beat-modes-remaining", remaining);
      if (remaining > 0) {
        ctx.requestChoice(
          "beat-mode",
          `Beat of the Ironsong: choose ${remaining} more mode${remaining === 1 ? "" : "s"}`,
          BEAT_OF_THE_IRONSONG_MODES.filter((mode) =>
            (selected & beatOfTheIronsongModeBit(mode)) === 0
          ),
        );
      }
    },
    onPlay(ctx: ScriptCtx) {
      if (!ctx.link || !named(ctx, ctx.link.attackingCard, "dawnblade")) return;
      const modes = ctx.getCounter("beat-modes");
      if ((modes & 1) !== 0) ctx.addModifier({ scope: "chain-link", attack: 1 });
      if ((modes & 2) !== 0) ctx.grantGoAgain();
      if ((modes & 4) !== 0) ctx.setFlag("link", "defendingCardsCannotGainDefense", true);
      if ((modes & 8) !== 0) ctx.setFlag("link", "unpreventable", true);
    },
  },
  "blood follows blade|2": { onPlay(ctx: ScriptCtx) { if (ctx.link && hasTag(ctx, ctx.link.attackingCard, "sword")) { ctx.grantGoAgain(); ctx.addModifier({ scope: "chain-link", onHitCreateToken: { cardId: SELLSWORD, count: 1 } }); } } },
  "adaptive alpha mold|0": { playableEquipment: true, activated: { cost: 0, isAttack: false, goAgain: true, onActivate(ctx: ScriptCtx) { ctx.setFlag("player", "adaptiveMoldMoved", true); } } },
  "backspin thrust|1": { activated: [{ cost: 0, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, effectCardCosts: [{ zone: "arena", move: "tap", count: 1, subtype: "cog", prompt: "Untap a cog" }], onActivate(ctx: ScriptCtx) { ctx.addCardTempPower(ctx.self.instanceId, 1); } }, { cost: 0, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, onActivate(ctx: ScriptCtx) { ctx.grantGoAgain(); } }] },
  "hit the gas|3": { onPlay(ctx: ScriptCtx) { const drivers = ctx.player(ctx.seat).banish.filter((card) => named(ctx, card, "Hyper Driver") && !card.faceDown); for (const card of drivers) ctx.setCardFaceDown(card.instanceId, true); ctx.changeActionPoints(ctx.seat, drivers.length); if (drivers.length >= 3) ctx.drawCards(ctx.seat, 1); } },
  "mage hunter arrow|1": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx: ScriptCtx) => ctx.player(ctx.seat).arsenal.some((card) => card.instanceId === ctx.self.instanceId && !card.faceDown), onActivate(ctx: ScriptCtx) { ctx.preventNextArcaneDamage(ctx.seat, 3); } }, canTriggerOnHit(ctx: ScriptCtx) { return ctx.link?.targetAllyId === undefined && (heroHas(ctx, opponentSeat(ctx), "runeblade") || heroHas(ctx, opponentSeat(ctx), "wizard")); }, onHit(ctx: ScriptCtx) { destroyAuraAtTarget(ctx, opponentSeat(ctx), "mage-aura"); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "mage-aura") ctx.destroyPermanent(Number(option)); } },
  "take the bait|1": {
    onPlay(ctx: ScriptCtx) {
      const deck = ctx.player(ctx.seat).deck;
      if (deck.length) ctx.requestCardChoice("bait-top", "Choose a card to put on top", deck.map((card) => card.instanceId));
      const bait = ctx.createToken("SUP259");
      if (bait) ctx.giveControl(bait.instanceId, opponentSeat(ctx));
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "bait-top") return;
      ctx.shuffleDeck(ctx.seat);
      ctx.putOnDeckTop(Number(option));
    },
  },
  "bait|0": {
    mandatoryAttackTarget: true,
    controllerCannotPlayOrActivateOwnedCards: true,
    activated: [{ cost: 0, isAttack: true, goAgain: false, oncePerTurn: false, destroySelfCost: true }, { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", oncePerTurn: true, onActivate(ctx: ScriptCtx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); ctx.grantGoAgain(); } }],
  },
  "parched terrain|1": { replaceHeroLifeGain: () => 0, triggers: [{ event: "end-of-turn", label: "Add a sand counter", effect(ctx: ScriptCtx) { ctx.setCounter("sand", ctx.getCounter("sand") + 1); const reds = ctx.player(ctx.seat).graveyard.filter((card) => ctx.cardColor(card) === 1); if (reds.length < ctx.getCounter("sand")) ctx.destroySelf(); else for (const card of reds.slice(0, ctx.getCounter("sand"))) ctx.banish(card.instanceId); } }] },
  "channel the tranquil domain|2": { onEnterArena(ctx: ScriptCtx) { const auras = ctx.state.players.flatMap((p) => p.board.filter((card) => aura(ctx, card) && card.instanceId !== ctx.self.instanceId)); if (auras[0]) ctx.putOnDeckBottom(auras[0].instanceId); }, triggers: [{ event: "begin-action-phase", label: "Bottom another aura", effect(ctx: ScriptCtx) { const auraCard = ctx.state.players.flatMap((p) => p.board.filter((card) => aura(ctx, card) && card.instanceId !== ctx.self.instanceId))[0]; if (auraCard) ctx.putOnDeckBottom(auraCard.instanceId); } }] },
  "light up the leaves|1": { arcaneDamageEffect: true, onPlay(ctx: ScriptCtx) { ctx.dealDamage(opponentSeat(ctx), 6, { arcane: true }); }, activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, discardCost: { count: 1, types: ["earth"] }, onActivate(ctx: ScriptCtx) { ctx.preventNextArcaneDamage(ctx.seat, 6); } } },
  "angelic attendant|2": { onPlay(ctx: ScriptCtx) { const figments = ctx.player(ctx.seat).board.filter((card) => hasTag(ctx, card, "figment")); if (figments.length) ctx.requestCardChoice("awaken-figment", "Awaken a figment", figments.map((card) => card.instanceId)); ctx.putIntoSoul(ctx.self.instanceId); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "awaken-figment") ctx.setFlag("player", `awakened:${option}`, true); } },
  "battlefield beacon|2": { onAttackDeclared(ctx: ScriptCtx) { const n = Math.min(3, Number(ctx.getFlag("player", "soulBanishedThisChain")) || 0); for (let i = 0; i < n; i++) ctx.createToken([COURAGE, TOUGHNESS, VIGOR][i % 3]!); } },
  "gallow, end of the line|2": { ...attackAbility(1, { tap: true, oncePerTurn: false }), activated: [...attackAbility(1, { tap: true, oncePerTurn: false }), { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, oncePerTurn: false, effectCardCosts: [{ zone: "hand", move: "discard", count: 1, keyword: "watery grave", prompt: "Discard a card with watery grave" }], onActivate(ctx: ScriptCtx) { ctx.setFlag("player", "suppressOpponentHitTriggers", true); } }] },
  "catch of the day|3": { onPlay(ctx: ScriptCtx) { buffNextAttack(ctx, { attack: 2, appliesToSubtype: "arrow" }); ctx.setFlag("player", "doubleGoFish", true); } },
  "painful passage|1": { onPlay(ctx: ScriptCtx) { const attacks = ctx.player(ctx.seat).hand.filter((card) => ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack")); if (attacks.length) ctx.requestCardChoice("painful", "Banish an attack action?", ["pass", ...attacks.map((card) => card.instanceId)]); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "painful" && option !== "pass" && ctx.banish(Number(option))) { ctx.addCardTempPower(Number(option), 3); ctx.allowPlayFrom(Number(option), "banish"); } } },
} satisfies Record<string, CardScript>);

sup["who blinks first?|3"]!.onChoose = (ctx, hook, option) => { if (hook === "blinks-aura") ctx.destroyPermanent(Number(option)); };
