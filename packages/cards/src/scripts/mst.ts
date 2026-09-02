import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { ampNextArcane, attackAbility, bloodDebtScript as bloodDebt, buffNextAttack, commonOptionMessages, decisionMessage, decisionPrompt, isCard, opponentSeat, previousAttackHasName, requestDiscardChoice, resolveDiscardChoice, yesNoPrompt } from "./shared-helpers.js";

// Part the Mistveil. Reprints reuse their existing functional-key scripts;
// this module contains only identities first introduced by MST.
const FANG_STRIKE = "MST023";
const SLITHER = "MST024";
const SPECTRAL_SHIELD = "MST158";
const CROUCHING_TIGER = "MST188";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function pitchedBlue(ctx: ScriptCtx): boolean {
  return Number(ctx.getFlag("player", "pitchedPitch:3")) > 0;
}

function playedAnotherBlue(ctx: ScriptCtx): boolean {
  return Number(ctx.getFlag("player", "playedPitch:3")) >= 2;
}

function transcended(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "transcendedThisTurn") === true;
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function hasKeyword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, keyword: string): boolean {
  return (data(ctx, card).keywords ?? []).some(
    (candidate) => candidate.toLowerCase() === keyword.toLowerCase(),
  );
}

function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasType(ctx, card, "aura");
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function isIllusionistAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return isAura(ctx, card) && hasType(ctx, card, "illusionist");
}

function controlsIllusionistAura(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).board.some((card) => isIllusionistAura(ctx, card));
}

function createInHand(ctx: ScriptCtx, cardId: string): void {
  const token = ctx.createToken(cardId);
  if (token) ctx.moveToHand(token.instanceId);
}

function createTigerInBanish(ctx: ScriptCtx, power = 0): void {
  const tiger = ctx.createToken(CROUCHING_TIGER);
  if (!tiger) return;
  ctx.banish(tiger.instanceId);
  if (power) ctx.addCardTempPower(tiger.instanceId, power);
  ctx.allowPlayFrom(tiger.instanceId, "banish");
}

function currentAttackIs(ctx: ScriptCtx, ...types: string[]): boolean {
  return !!ctx.link && ctx.link.attacker === ctx.seat && types.some((type) => hasType(ctx, ctx.link!.attackingCard, type));
}

function mysticAssassinReaction(pump: number, token?: string): CardScript {
  return {
    canPlay: (ctx) => currentAttackIs(ctx, "assassin", "mystic"),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: pump });
      if (token && pitchedBlue(ctx)) createInHand(ctx, token);
    },
  };
}

function simpleAttackReaction(pump: number, token?: string): CardScript {
  return {
    canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat,
    onPlay(ctx) {
      if (pump) ctx.addModifier({ scope: "chain-link", attack: pump });
      if (token) createInHand(ctx, token);
    },
  };
}

function lastLifeCloak(): CardScript {
  return {
    triggersWhileFaceDown: true,
    triggers: [{
      event: "start-of-turn",
      condition: (ctx) => ctx.self.faceDown === true && ctx.player(ctx.seat).life === 1,
      optional: true,
      label: "Turn this equipment face-up?",
      onAccept(ctx) { ctx.setCardFaceDown(ctx.self.instanceId, false); },
    }],
  };
}

function nextTurnDestroy(): CardScript["triggers"] {
  return [{
    event: "start-of-turn",
    condition: (ctx) => ctx.self.faceDown !== true,
    label: "Destroy this equipment",
    effect(ctx) { ctx.destroySelf(); },
  }];
}

function keikoi(): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      usableWhileFaceDown: true,
      destroySelfCost: true,
      canActivate: (ctx) => ctx.self.faceDown === true,
      label: "Destroy: prevent the next 1 damage",
      onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 1); },
    },
  };
}

function moonChakra(base: number, transcendedAmount: number): CardScript {
  return { onPlay(ctx) { ctx.preventNextDamage(ctx.seat, transcended(ctx) ? transcendedAmount : base); } };
}

function hazeShelter(blueWard: number): CardScript {
  return { wardValue: (ctx) => pitchedBlue(ctx) ? blueWard : 1 };
}

function waning(): CardScript {
  return { onLeaveArena(ctx) { if (pitchedBlue(ctx)) ctx.createToken(SPECTRAL_SHIELD); } };
}

function waxing(): CardScript {
  return { onEnterArena(ctx) { if (pitchedBlue(ctx)) ctx.addCounter(ctx.self.instanceId, "power", 1); } };
}

function nextTiger(power: number, includeTranscend = false): CardScript {
  return {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "next-attack",
        attack: includeTranscend && transcended(ctx) ? power + 2 : power,
        appliesToName: "crouching tiger",
      });
    },
  };
}

function tigerCreatorAttack(): CardScript {
  return { onAttackDeclared(ctx) { if (pitchedBlue(ctx)) createInHand(ctx, CROUCHING_TIGER); } };
}

function tigerIncantation(power: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.addModifier({ scope: "next-attack", attack: power, appliesToName: "crouching tiger" });
      if (pitchedBlue(ctx)) createInHand(ctx, CROUCHING_TIGER);
    },
  };
}

function blueAttackBonus(amount: number): CardScript {
  return { modifyAttack: (ctx) => playedAnotherBlue(ctx) ? amount : 0 };
}

function blueDefenseBonus(amount: number): CardScript {
  return { modifyDefense: (ctx) => playedAnotherBlue(ctx) ? amount : 0 };
}

function transcendIfBlue(ctx: ScriptCtx): void {
  if (playedAnotherBlue(ctx)) ctx.transcend();
}

function topBanishDesire(matches: (ctx: ScriptCtx, card: DeepReadonly<CardInstance>) => boolean): CardScript {
  return {
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (!top) return;
      ctx.banish(top.instanceId);
      if (matches(ctx, top)) ctx.gainLife(ctx.seat, 1);
    },
  };
}

function bonds(kind: "pitch" | "name"): CardScript {
  return {
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      const top = opponent.deck[0];
      if (!top) return;
      ctx.banish(top.instanceId);
      ctx.setCounter("bondsTop", top.instanceId);
      if (opponent.graveyard.length) {
        ctx.requestCardChoice("bonds", decisionPrompt("Choose a card in the defending hero's graveyard to banish", "card.mst.defendinghero.graveyard.banish"), opponent.graveyard.map((card) => card.instanceId));
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "bonds") return;
      const opponent = ctx.player(opponentSeat(ctx));
      const first = opponent.banish.find((card) => card.instanceId === ctx.getCounter("bondsTop"));
      const second = opponent.graveyard.find((card) => card.instanceId === Number(option));
      if (!second) return;
      const matches = first && (kind === "pitch"
        ? ctx.cardColor(first) !== 0 && ctx.cardColor(first) === ctx.cardColor(second)
        : data(ctx, first).name === data(ctx, second).name);
      ctx.banish(second.instanceId);
      if (matches) ctx.gainLife(ctx.seat, 1);
    },
  };
}

function doubleTrouble(): CardScript {
  return {
    modifyAttack: (ctx) => Number(ctx.getFlag("link", "reactionCount")) >= 2 ? 2 : 0,
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && Number(ctx.getFlag("link", "reactionCount")) >= 2; },
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      for (const card of opponent.deck.slice(0, 2)) ctx.banish(card.instanceId);
    },
  };
}

function pickToPieces(): CardScript {
  return {
    modifyAttack(ctx) {
      if (ctx.getFlag("link", "reactionPlayedOrActivated") !== true) return 0;
      ctx.setFlag("link", "unpreventable", true);
      return 1;
    },
  };
}

function etchings(counters: number): CardScript {
  const wardAuras = (ctx: ScriptCtx) => ctx.player(ctx.seat).board.filter(
    (card) => isAura(ctx, card) && ((data(ctx, card).keywords ?? []).some((keyword) => /^ward /i.test(keyword)) || data(ctx, card).name === "Haze Shelter"),
  );
  return {
    playAsInstant: (ctx) => ctx.player(ctx.seat).board.some((card) => isCard(ctx, card.cardId, "Spectral Shield")),
    onPlay(ctx) { ctx.requestCardChoice("etchings", decisionPrompt("Choose an aura with ward", "card.mst.wardaura.choose"), wardAuras(ctx).map((card) => card.instanceId)); },
    onChoose(ctx, hook, option) { if (hook === "etchings") ctx.addCounter(Number(option), "power", counters); },
  };
}

function essence(pitch: number): CardScript {
  return {
    onLeaveArena(ctx) {
      if (!controlsIllusionistAura(ctx)) ctx.addModifier({ scope: "until-end-of-turn", preventNextDamageFromPitch: pitch });
    },
  };
}

function haunting(): CardScript {
  return {
    onLeaveArena(ctx) {
      const shield = ctx.createToken(SPECTRAL_SHIELD);
      if (shield && !controlsIllusionistAura(ctx)) ctx.addCounter(shield.instanceId, "power", 1);
    },
  };
}

function sigil(): CardScript {
  return {
    triggers: [{
      event: "start-of-turn",
      condition: (ctx) => ctx.player(ctx.seat).board.some((card) => card.instanceId !== ctx.self.instanceId && isIllusionistAura(ctx, card)),
      label: "Destroy Sigil of Solitude",
      effect(ctx) { ctx.destroySelf(); },
    }],
  };
}

function singleMinded(counters: number): CardScript {
  return { onEnterArena(ctx) { if (!ctx.player(ctx.seat).board.some((card) => card.instanceId !== ctx.self.instanceId && isIllusionistAura(ctx, card))) ctx.addCounter(ctx.self.instanceId, "power", counters); } };
}

function solitary(): CardScript {
  return { onEnterArena(ctx) { if (!ctx.player(ctx.seat).board.some((card) => card.instanceId !== ctx.self.instanceId && isIllusionistAura(ctx, card))) ctx.createToken(SPECTRAL_SHIELD); } };
}

function spectralManifestations(counters: number): CardScript {
  return { onPlay(ctx) { const shield = ctx.createToken(SPECTRAL_SHIELD); if (shield && !controlsIllusionistAura(ctx)) ctx.addCounter(shield.instanceId, "power", counters); } };
}

function vengeful(maxCost: number): CardScript {
  return {
    onLeaveArena(ctx) {
      if (!controlsIllusionistAura(ctx)) {
        ctx.setCounter("vengefulMax", maxCost);
        ctx.addModifier({ scope: "until-end-of-turn" });
      }
    },
    allowsFriendlyCardPlayAsInstant(ctx, card) {
      return isAura(ctx, card) && (data(ctx, card).cost ?? 0) <= ctx.getCounter("vengefulMax");
    },
    onFriendlyPlay(ctx, played) {
      const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && !modifier.consumed);
      if (!marker || !isAura(ctx, played) || (data(ctx, played).cost ?? 0) > ctx.getCounter("vengefulMax")) return;
      ctx.addCounter(played.instanceId, "power", 1);
      ctx.consumeModifier(marker.id);
    },
  };
}

function lastResolvedAttack(ctx: ScriptCtx) {
  const links = ctx.state.chain.filter((link) => link.resolved && link.attacker === ctx.seat);
  return links[links.length - 1]?.attackingCard;
}

function aspectTiger(pitch: number): CardScript {
  return {
    onAttackDeclared(ctx) {
      const previous = lastResolvedAttack(ctx);
      if (!previous || !ctx.hasCardType(previous, "action") || !hasType(ctx, previous, "attack") || ctx.cardColor(previous) !== pitch) return;
      ctx.grantGoAgain();
      createTigerInBanish(ctx);
    },
  };
}

function breedAnger(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (!previousAttackHasName(ctx, "crouching tiger")) return;
      ctx.grantGoAgain();
      createTigerInBanish(ctx);
    },
  };
}

function tigerOnHit(): CardScript {
  return { onHit(ctx) { createTigerInBanish(ctx); } };
}

function untamed(): CardScript {
  return { onAttackDeclared(ctx) { ctx.addModifier({ scope: "combat-chain", attack: 1, appliesToName: "crouching tiger" }); } };
}

function emissary(kind: "moon" | "tides" | "wind"): CardScript {
  return {
    onAttackDeclared(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) ctx.requestCardChoice(`emissary-${kind}`, decisionPrompt("Put a card from your hand on the bottom of your deck?", "card.mst.hand.card.bottom", { optionMessages: commonOptionMessages("pass") }), ["pass", ...hand.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== `emissary-${kind}` || option === "pass" || !ctx.putOnDeckBottom(Number(option))) return;
      if (kind === "moon") ctx.drawCards(ctx.seat, 1);
      else if (kind === "tides") ctx.addModifier({ scope: "chain-link", attack: 2 });
      else ctx.grantGoAgain();
    },
  };
}

function gravekeeping(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId !== undefined) return;
      const grave = ctx.player(opponentSeat(ctx)).graveyard;
      if (grave.length) ctx.requestCardChoice("gravekeeping", decisionPrompt("Banish a card from the defending hero's graveyard?", "card.mst.defendinghero.graveyard.banish.optional", { optionMessages: commonOptionMessages("pass") }), ["pass", ...grave.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "gravekeeping" && option !== "pass") ctx.banish(Number(option)); },
  };
}

function battlefront(): CardScript {
  return {
    canTriggerOnDefend: (ctx) => (ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0) === 1,
    onDefend(ctx) { ctx.preventNextDamage(ctx.seat, 1); },
  };
}

function factFinding(): CardScript {
  return {
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      const cards = [...opponent.arsenal.filter((card) => card.faceDown), ...Object.values(opponent.equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && card.faceDown === true)];
      if (cards.length) ctx.requestCardChoice("fact-finding", decisionPrompt("Look at a face-down arsenal or equipment card?", "card.mst.facedown.card.look", { optionMessages: commonOptionMessages("pass") }), ["pass", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "fact-finding" && option !== "pass") ctx.lookAt(Number(option)); },
  };
}

export const mst: Record<string, CardScript> = {
  "nuu|0": {
    onAttackResolved(ctx) {
      if (!ctx.link || !hasKeyword(ctx, ctx.link.attackingCard, "stealth")) return;
      const defenders = [...ctx.link.defendingCards, ...ctx.link.defendingEquipment];
      for (const defender of defenders) {
        if (ctx.hasCardType(defender, "action")) ctx.banish(defender.instanceId);
      }
    },
    activated: {
      cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "instant",
      label: "Look at and possibly banish the opponent's top card",
      onActivate(ctx) {
        const top = ctx.player(opponentSeat(ctx)).deck[0];
        if (!top) return;
        ctx.lookAt(top.instanceId);
        if (ctx.cardColor(top) === 3) {
          ctx.setCounter("nuuTop", top.instanceId);
          ctx.requestChoice("nuu-banish", yesNoPrompt("Banish the blue card?", "card.mst.blue.card.banish"), ["yes", "no"]);
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "nuu-banish" || option !== "yes") return;
      const instanceId = ctx.getCounter("nuuTop");
      const card = ctx.player(opponentSeat(ctx)).deck.find(
        (candidate) => candidate.instanceId === instanceId,
      );
      if (!card || !ctx.banish(instanceId)) return;
      ctx.allowPlayFrom(instanceId, "banish", {
        costReduction: data(ctx, card).cost ?? 0,
        forSeat: ctx.seat,
      });
    },
  },
  "beckoning mistblade|0": { activated: attackAbility(2, { goAgain: true }), onHit(ctx) { ctx.addModifier({ scope: "next-attack", attack: 1, goAgain: true, appliesToPitch: 3 }); } },
  "heirloom of snake hide|0": lastLifeCloak(),
  "arousing wave|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => currentAttackIs(ctx, "assassin", "mystic"), onActivate(ctx) { createInHand(ctx, FANG_STRIKE); } } },
  "undertow stilettos|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => currentAttackIs(ctx, "assassin", "mystic"), onActivate(ctx) { createInHand(ctx, SLITHER); } } },
  "tide chakra|1": { canPlay: (ctx) => currentAttackIs(ctx, "assassin", "mystic"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: transcended(ctx) ? 5 : 3 }); } },
  "tide chakra|2": { canPlay: (ctx) => currentAttackIs(ctx, "assassin", "mystic"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: transcended(ctx) ? 4 : 2 }); } },
  "tide chakra|3": { canPlay: (ctx) => currentAttackIs(ctx, "assassin", "mystic"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: transcended(ctx) ? 3 : 1 }); } },
  "hiss|1": mysticAssassinReaction(3, SLITHER), "hiss|2": mysticAssassinReaction(2, SLITHER), "hiss|3": mysticAssassinReaction(1, SLITHER),
  "intimate inducement|1": intimateInducement(4), "intimate inducement|2": intimateInducement(3), "intimate inducement|3": intimateInducement(2),
  "venomous bite|1": mysticAssassinReaction(3, FANG_STRIKE), "venomous bite|2": mysticAssassinReaction(2, FANG_STRIKE), "venomous bite|3": mysticAssassinReaction(1, FANG_STRIKE),
  "fang strike|0": simpleAttackReaction(1), "slither|0": { canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onPlay(ctx) { ctx.grantGoAgain(); } },
  "heirloom of rabbit hide|0": lastLifeCloak(),
  "truths retold|0": truthsRetold(),
  "moon chakra|1": moonChakra(3, 5), "moon chakra|2": moonChakra(2, 4), "moon chakra|3": moonChakra(1, 3),
  "haze shelter|1": hazeShelter(4), "haze shelter|2": hazeShelter(3), "haze shelter|3": hazeShelter(2),
  "waning vengeance|2": waning(), "waning vengeance|3": waning(), "waxing specter|2": waxing(), "waxing specter|3": waxing(),
  "zen|0": zen(), "heirloom of tiger hide|0": lastLifeCloak(), "stride of reprisal|0": { onDefend(ctx) { createInHand(ctx, CROUCHING_TIGER); } },
  "wind chakra|1": nextTiger(3, true), "wind chakra|2": nextTiger(2, true), "wind chakra|3": nextTiger(2, true),
  "companion of the claw|1": tigerCreatorAttack(), "companion of the claw|2": tigerCreatorAttack(), "companion of the claw|3": tigerCreatorAttack(),
  "harmony of the hunt|1": tigerCreatorAttack(), "harmony of the hunt|2": tigerCreatorAttack(), "harmony of the hunt|3": tigerCreatorAttack(),
  "tiger form incantation|1": tigerIncantation(3), "tiger form incantation|2": tigerIncantation(2), "tiger form incantation|3": tigerIncantation(1),
  "aqua seeing shell|0": { activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", turnsFaceUp: true, onActivate(ctx) { ctx.drawCards(ctx.seat, 1); } }, triggers: nextTurnDestroy() },
  "koi blessed kimono|0": koiKimono(),
  "waves of aqua marine|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", turnsFaceUp: true, canActivate: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); } }, triggers: nextTurnDestroy() },
  "aqua laps|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", turnsFaceUp: true, canActivate: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onActivate(ctx) { ctx.grantGoAgain(); } }, triggers: nextTurnDestroy() },
  "skycrest keikoi|0": keikoi(), "skybody keikoi|0": keikoi(), "skyhold keikoi|0": keikoi(), "skywalker keikoi|0": keikoi(),
  "second tenet of chi: moon|3": { onAttackResolved(ctx) { if (transcended(ctx)) ctx.drawCards(ctx.seat, 1); } },
  "second tenet of chi: tide|3": { modifyAttack: (ctx) => transcended(ctx) ? 2 : 0 },
  "deep blue sea|3": { modifyAttack: (ctx) => Number(ctx.getFlag("player", "pitchedPitch:3")) },
  "wide blue yonder|3": { canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: Number(ctx.getFlag("player", "pitchedPitch:3")) }); } },
  "droplet|3": blueAttackBonus(2), "rising tide|3": blueAttackBonus(2), "spillover|3": blueAttackBonus(2), "tidal surge|3": blueAttackBonus(2), "wash away|3": blueDefenseBonus(2),
  "first tenet of chi: moon|3": firstTenetMoon(),
  "first tenet of chi: tide|3": { onPlay(ctx) { ctx.addModifier({ scope: "next-attack", attack: 2, appliesToPitch: 3 }); } },
  "first tenet of chi: wind|3": { onPlay(ctx) { ctx.addModifier({ scope: "next-play", grantKeyword: "go again", appliesToPitch: 3, appliesToCardType: "action" }); } },
  "path well traveled|3": { canPlay: (ctx) => !!ctx.link, onPlay(ctx) { ctx.grantGoAgain(); transcendIfBlue(ctx); } },
  "stir the pot|3": { onPlay(ctx) { ctx.shuffleDeck(); transcendIfBlue(ctx); } },
  "the grain that tips the scale|3": { canPlay: (ctx) => !!ctx.link, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); transcendIfBlue(ctx); } },
  "art of desire: soul|2": artSoul(),
  "bonds of attraction|1": bonds("pitch"), "bonds of attraction|2": bonds("pitch"), "bonds of attraction|3": bonds("pitch"),
  "double trouble|1": doubleTrouble(), "double trouble|2": doubleTrouble(), "double trouble|3": doubleTrouble(),
  "bonds of memory|1": bonds("name"), "bonds of memory|2": bonds("name"), "bonds of memory|3": bonds("name"),
  "desires of flesh|1": topBanishDesire((ctx, card) => isAttackAction(ctx, card)), "desires of flesh|2": topBanishDesire((ctx, card) => isAttackAction(ctx, card)), "desires of flesh|3": topBanishDesire((ctx, card) => isAttackAction(ctx, card)),
  "impulsive desire|1": topBanishDesire((ctx, card) => ["attack-reaction", "defense-reaction"].includes(data(ctx, card).cardType) || ctx.hasCardType(card, "instant")), "impulsive desire|2": topBanishDesire((ctx, card) => ["attack-reaction", "defense-reaction"].includes(data(ctx, card).cardType) || ctx.hasCardType(card, "instant")), "impulsive desire|3": topBanishDesire((ctx, card) => ["attack-reaction", "defense-reaction"].includes(data(ctx, card).cardType) || ctx.hasCardType(card, "instant")),
  "mind's desire|1": topBanishDesire((ctx, card) => ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack")), "mind's desire|2": topBanishDesire((ctx, card) => ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack")), "mind's desire|3": topBanishDesire((ctx, card) => ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack")),
  "pick to pieces|1": pickToPieces(), "pick to pieces|2": pickToPieces(), "pick to pieces|3": pickToPieces(),
  "astral etchings|2": etchings(2), "astral etchings|3": etchings(1),
  "essence of ancestry: body|1": essence(1), "essence of ancestry: soul|2": essence(2), "essence of ancestry: mind|3": essence(3),
  "haunting specter|1": haunting(), "haunting specter|2": haunting(), "haunting specter|3": haunting(),
  "sigil of solitude|1": sigil(), "sigil of solitude|2": sigil(), "sigil of solitude|3": sigil(),
  "single minded determination|1": singleMinded(3), "single minded determination|2": singleMinded(2), "single minded determination|3": singleMinded(1),
  "solitary companion|1": solitary(), "solitary companion|2": solitary(), "solitary companion|3": solitary(),
  "spectral manifestations|2": spectralManifestations(2), "spectral manifestations|3": spectralManifestations(1),
  "vengeful apparition|1": vengeful(2), "vengeful apparition|2": vengeful(1), "vengeful apparition|3": vengeful(0),
  "tiger taming khakkara|0": { activated: attackAbility(2, { goAgain: true }), onFriendlyAttackDeclared(ctx) { ctx.addModifier({ scope: "combat-chain", attack: 1, appliesToName: "crouching tiger" }); } },
  "mask of wizened whiskers|0": maskWhiskers(),
  "aspect of tiger: body|1": aspectTiger(1), "aspect of tiger: soul|2": aspectTiger(2), "aspect of tiger: mind|3": aspectTiger(3),
  "biting breeze|1": tigerOnHit(), "biting breeze|2": tigerOnHit(), "biting breeze|3": tigerOnHit(),
  "breed anger|1": breedAnger(), "breed anger|2": breedAnger(), "breed anger|3": breedAnger(),
  "untamed|1": untamed(), "untamed|2": untamed(), "untamed|3": untamed(),
  "blanch|1": blanch(), "blanch|2": blanch(), "blanch|3": blanch(),
  "emissary of moon|1": emissary("moon"), "emissary of tides|1": emissary("tides"), "emissary of wind|1": emissary("wind"),
  "gravekeeping|1": gravekeeping(), "gravekeeping|2": gravekeeping(), "gravekeeping|3": gravekeeping(),
  "battlefront bastion|1": battlefront(), "battlefront bastion|2": battlefront(), "battlefront bastion|3": battlefront(),
  "fact-finding mission|1": factFinding(), "fact-finding mission|2": factFinding(), "fact-finding mission|3": factFinding(),
  "water the seeds|1": waterSeeds(), "water the seeds|2": waterSeeds(), "water the seeds|3": waterSeeds(),
  "enigma, new moon|0": enigmaNewMoon(),
};

function intimateInducement(count: number): CardScript {
  return {
    canPlay: (ctx) => currentAttackIs(ctx, "assassin", "mystic"),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      const cards = ctx.player(opponentSeat(ctx)).deck.slice(0, count);
      cards.forEach((card, index) => { ctx.lookAt(card.instanceId); ctx.setCounter(`induce:${index}`, card.instanceId); });
      ctx.setCounter("induceCount", cards.length);
      if (cards.length) ctx.requestCardChoice("induce-defender", decisionPrompt("Choose a defending card", "card.mst.defending.card.choose"), cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook === "induce-defender") {
        const chosen = Number(option);
        const card = ctx.player(opponentSeat(ctx)).deck.find((candidate) => candidate.instanceId === chosen);
        if (card && ctx.cardColor(card) === 3) ctx.addCardTempDefense(chosen, -(data(ctx, card).defense ?? 0));
        ctx.addDefenderFromDeck(chosen);
        const remaining: number[] = [];
        for (let i = 0; i < ctx.getCounter("induceCount"); i++) { const id = ctx.getCounter(`induce:${i}`); if (id && id !== chosen) remaining.push(id); }
        remaining.forEach((id, index) => ctx.setCounter(`induceRemain:${index}`, id));
        ctx.setCounter("induceRemaining", remaining.length);
        if (remaining.length > 1) ctx.requestCardChoice("induce-order", decisionPrompt("Choose the bottommost remaining card", "card.mst.remaining.bottommost.choose"), remaining);
      } else if (hook === "induce-order") {
        const chosen = Number(option);
        ctx.putOnDeckTop(chosen);
        const remaining: number[] = [];
        for (let i = 0; i < ctx.getCounter("induceRemaining"); i++) { const id = ctx.getCounter(`induceRemain:${i}`); if (id && id !== chosen) remaining.push(id); }
        remaining.forEach((id, index) => ctx.setCounter(`induceRemain:${index}`, id));
        ctx.setCounter("induceRemaining", remaining.length);
        if (remaining.length > 1) ctx.requestCardChoice("induce-order", decisionPrompt("Choose the bottommost remaining card", "card.mst.remaining.bottommost.choose"), remaining);
        else if (remaining[0]) ctx.putOnDeckTop(remaining[0]);
      }
    },
  };
}

function truthsRetold(): CardScript {
  return {
    activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", turnsFaceUp: true, onActivate(ctx) { const auras = ctx.player(ctx.seat).graveyard.filter((card) => isAura(ctx, card)); if (auras.length) ctx.requestCardChoice("truths", decisionPrompt("Put an aura on the bottom of your deck", "card.mst.aura.bottom"), auras.map((card) => card.instanceId)); } },
    onChoose(ctx, hook, option) { if (hook === "truths") ctx.putOnDeckBottom(Number(option)); },
  };
}

function zen(): CardScript {
  return {
    activated: { cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, onActivate(ctx) { createInHand(ctx, CROUCHING_TIGER); const combo = ctx.player(ctx.seat).deck.filter((card) => hasKeyword(ctx, card, "combo")); if (combo.length) ctx.requestCardChoice("zen-combo", decisionPrompt("Search for a card with combo", "card.mst.combo.search"), combo.map((card) => card.instanceId)); else ctx.shuffleDeck(); } },
    onChoose(ctx, hook, option) { if (hook !== "zen-combo") return; const id = Number(option); ctx.banish(id); ctx.shuffleDeck(); ctx.allowPlayFrom(id, "banish"); },
  };
}

function koiKimono(): CardScript {
  return {
    triggersWhileFaceDown: true,
    triggers: [{ event: "start-of-turn", condition: (ctx) => ctx.self.faceDown === true && ctx.player(ctx.seat).life === 1, optional: true, label: "Turn Koi Blessed Kimono face-up?", onAccept(ctx) { ctx.setCardFaceDown(ctx.self.instanceId, false); }, effect(ctx) { ctx.destroySelf(); const chi = ctx.player(ctx.seat).deck.filter((card) => data(ctx, card).name === "Inner Chi"); if (chi.length) ctx.requestCardChoice("koi-chi", decisionPrompt("Search for Inner Chi", "card.mst.innerchi.search"), chi.map((card) => card.instanceId)); else ctx.shuffleDeck(); } }],
    onChoose(ctx, hook, option) { if (hook !== "koi-chi") return; const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option)); if (!card) return; ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, card).name}`); ctx.moveToHand(card.instanceId); ctx.shuffleDeck(); },
  };
}

function firstTenetMoon(): CardScript {
  return {
    onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", appliesToPitch: 3, appliesTo: "attack" }); },
    onFriendlyAttackDeclared(ctx) {
      const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && !modifier.consumed && modifier.appliesToPitch === 3);
      if (!marker || !ctx.link || ctx.cardColor(ctx.link.attackingCard) !== 3) return;
      ctx.drawCards(ctx.seat, 1);
      ctx.consumeModifier(marker.id);
    },
  };
}

function artSoul(): CardScript {
  return {
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (!top) return;
      ctx.banish(top.instanceId);
      if (ctx.cardColor(top) === 2) { ctx.drawCards(ctx.seat, 1); ctx.gainLife(ctx.seat, 1); }
    },
  };
}

function maskWhiskers(): CardScript {
  return {
    onDefend(ctx) { const combo = ctx.player(ctx.seat).graveyard.filter((card) => hasKeyword(ctx, card, "combo")); if (combo.length) ctx.requestCardChoice("whiskers", decisionPrompt("Put a combo card on the bottom of your deck", "card.mst.combo.bottom"), combo.map((card) => card.instanceId)); },
    onChoose(ctx, hook, option) { if (hook === "whiskers") ctx.putOnDeckBottom(Number(option)); },
  };
}

function blanch(): CardScript {
  return {
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      ctx.setCardCounter(
        opponent.hero.instanceId,
        "colorsSuppressedUntilTurn",
        ctx.state.turn + 1,
      );
    },
  };
}

function waterSeeds(): CardScript {
  return { onAttackDeclared(ctx) { ctx.addModifier({ scope: "next-attack", attack: 1, maxBasePower: 1, expiresOnChainClose: true }); } };
}

function enigmaNewMoon(): CardScript {
  return {
    onGameStart(ctx) {
      for (const equipment of Object.values(ctx.player(ctx.seat).equipment)) {
        if (equipment) ctx.setCardFaceDown(equipment.instanceId, true);
      }
    },
    activated: {
      cost: 0,
      chiCost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Turn face-down equipment face-up",
      onActivate(ctx) {
        const equipment = Object.values(ctx.player(ctx.seat).equipment).filter(
          (card): card is DeepReadonly<CardInstance> => !!card && card.faceDown === true,
        );
        if (equipment.length) ctx.requestCardChoice("new-moon", decisionPrompt("Turn a face-down equipment face-up", "card.mst.equipment.faceup"), equipment.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "new-moon") return;
      const card = Object.values(ctx.player(ctx.seat).equipment).find((candidate) => candidate?.instanceId === Number(option));
      if (!card || !ctx.setCardFaceDown(card.instanceId, false)) return;
      if ((data(ctx, card).keywords ?? []).some((keyword) => /^ward(?:\s|$)/i.test(keyword))) {
        ctx.createTokens(SPECTRAL_SHIELD, 3);
      }
    },
  };
}

// Adult heroes and high-rarity cards from the complete MST release.
mst["nuu, alluring desire|0"] = mst["nuu|0"]!;
mst["zen, tamer of purpose|0"] = mst["zen|0"]!;

const tokenNamed = (ctx: ScriptCtx, name: string): string | undefined => ctx.cardIdsNamed(name)[0];
const createNamed = (ctx: ScriptCtx, name: string, count = 1): void => { const id = tokenNamed(ctx, name); if (id) ctx.createTokens(id, count); };
const reactionCount = (ctx: ScriptCtx): number => Number(ctx.getFlag("link", "reactionCount"));

function restlessCoalescenceSources(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).board.filter((card) =>
    card.instanceId !== ctx.self.instanceId &&
    isAura(ctx, card) &&
    (card.counters?.power ?? 0) > 0,
  );
}

function requestRestlessCoalescenceMove(ctx: ScriptCtx): void {
  const sources = restlessCoalescenceSources(ctx);
  if (sources.length) {
    ctx.requestCardChoice(
      "restless-coalescence-move",
      decisionPrompt("Move a +1 power counter onto Restless Coalescence, or finish", "card.mst.restless.power.move", { optionMessages: commonOptionMessages("done") }),
      ["done", ...sources.map((card) => card.instanceId)],
    );
  }
}

Object.assign(mst, {
  "mistcloak gully|0": { modifyOpposingAttack: (ctx) => Number(ctx.getPlayerFlag(opponentSeat(ctx), "attacksDeclaredThisTurn")) === 1 ? -1 : 0, triggers: [{ event: "end-of-turn", whose: "any", label: "Check Mistcloak Gully", effect(ctx) { const pitched = Number(ctx.getFlag("player", "pitchedPitch:3")) > 0; const played = Number(ctx.getFlag("player", "playedPitch:3")) > 0; const defended = Number(ctx.getFlag("player", "defendedPitch:3")) > 0; if (pitched && played && defended) ctx.transcend(); else if (!(pitched || played || defended)) ctx.destroySelf(); } }] },
  "mask of recurring nightmares|0": { activated: { cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "attack-reaction", oncePerTurn: true, canActivate: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onActivate: (ctx) => { const target = opponentSeat(ctx); const hand = ctx.player(target).hand; if (hand.length) ctx.requestCardChoice("mask-recurring-banish", decisionPrompt("Choose a card to banish", "card.mst.card.banish"), hand.map((card) => card.instanceId), target); } }, onChoose(ctx, hook, option) { if (hook === "mask-recurring-banish") ctx.banish(Number(option)); } },
  "gorgon's gaze|2": { canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onPlay(ctx) { createInHand(ctx, SLITHER); if (!ctx.link) return; for (const card of ctx.link.defendingCards.filter((candidate) => isAttackAction(ctx, candidate))) { if (ctx.banish(card.instanceId) && pitchedBlue(ctx)) ctx.allowPlayFrom(card.instanceId, "banish", { costReduction: data(ctx, card).cost ?? 0, untilChainClose: true }); } } },
  "siren's call|1": { canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onPlay(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; for (const card of hand) ctx.lookAt(card.instanceId); const cards = hand.filter((card) => ctx.cardColor(card) === 3); if (cards.length) ctx.requestCardChoice("siren-blue", decisionPrompt("Choose a blue card to defend", "card.mst.blue.card.defend"), cards.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "siren-blue" && ctx.addDefenderFromHand(Number(option))) ctx.drawCards(ctx.seat, 1); } },
  "sacred art: undercurrent desires|3": { onPlay(ctx) { createInHand(ctx, FANG_STRIKE); createInHand(ctx, SLITHER); const grave = ctx.player(opponentSeat(ctx)).graveyard.slice(0, 2); for (const card of grave) ctx.banish(card.instanceId); ctx.transcend(); } },
  "enigma, ledger of ancestry|0": { modifyAttackActivationCost(ctx, attacker, base) { return data(ctx, attacker).name === "Spectral Shield" && Number(ctx.getPlayerFlag(ctx.seat, "attackedNameCount:spectral shield")) === 0 ? base - 1 : base; }, activated: { cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, onActivate(ctx) { const shield = ctx.createToken(SPECTRAL_SHIELD); if (shield) ctx.addCounter(shield.instanceId, "power", 1); } } },
  "meridian pathway|0": { activated: { cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "instant", onActivate: (ctx) => ctx.setPlayerFlag(ctx.seat, "aurasAsInstantThisTurn", true) }, wardValue: (ctx) => pitchedBlue(ctx) ? 3 : 0 },
  "manifestation of miragai|3": { onEnterArena(ctx) { ctx.setCounter("power", pitchedBlue(ctx) ? 4 : 2); }, wardValue: (ctx) => ctx.getCounter("power") },
  "sacred art: immortal lunar shrine|3": { onPlay(ctx) { ctx.createTokens(SPECTRAL_SHIELD, 2); for (const aura of ctx.player(ctx.seat).board.filter((card) => isAura(ctx, card) && hasKeyword(ctx, card, "ward"))) ctx.addCounter(aura.instanceId, "power", 1); ctx.transcend(); } },
  "three visits|1": { wardValue: (ctx) => Number(ctx.getFlag("player", "pitchedPitch:3")) * 3 },
  "twelve petal kāṣāya|0": { onFriendlyPlay(ctx, played) { if (data(ctx, played).name === "Inner Chi") ctx.changeResources(ctx.seat, 1); }, activated: { cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate: (ctx) => createNamed(ctx, "Zen State") } },
  "tooth and claw|1": { onAttackDeclared(ctx) { const count = ctx.player(ctx.seat).hand.filter((card) => data(ctx, card).name === "Crouching Tiger").length; if (count > 0) ctx.grantGoAgain(); if (count > 1) ctx.addCardTempPower(ctx.self.instanceId, 1); if (count > 2) ctx.drawCards(ctx.seat, 1); } },
  "shifting winds of the mystic beast|3": {
    onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); if (pitchedBlue(ctx)) { createInHand(ctx, CROUCHING_TIGER); createInHand(ctx, CROUCHING_TIGER); } },
    triggers: [{ event: "card-played", label: "Name the Crouching Tiger", condition: (ctx, played) => !!played && data(ctx, played).name === "Crouching Tiger", effect(ctx, played) { if (!played) return; ctx.setCounter("shiftingTarget", played.instanceId); ctx.requestNameChoice("shifting-name", decisionPrompt("Choose a name for Crouching Tiger", "card.mst.crouchingtiger.name")); } }],
    onChoose(ctx, hook, option) { if (hook === "shifting-name") ctx.grantCardName(ctx.getCounter("shiftingTarget"), option); },
  },
  "sacred art: jade tiger domain|3": { onPlay(ctx) { createInHand(ctx, CROUCHING_TIGER); createInHand(ctx, CROUCHING_TIGER); ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToName: "crouching tiger" }); ctx.transcend(); } },
  "traverse the universe|0": { onDefend(ctx) { const chi = ctx.player(ctx.seat).deck.filter((card) => data(ctx, card).name === "Inner Chi"); if (chi.length) ctx.requestCardChoice("traverse-chi", decisionPrompt("Search for Inner Chi", "card.mst.innerchi.search"), chi.map((card) => card.instanceId)); else ctx.shuffleDeck(); }, onChoose(ctx, hook, option) { if (hook === "traverse-chi") { ctx.revealCards([Number(option)]); ctx.moveToHand(Number(option)); ctx.shuffleDeck(); } } },
  "attune with cosmic vibrations|3": { onAttackDeclared(ctx) { const top = ctx.player(opponentSeat(ctx)).deck[0]; if (top) { ctx.revealCards([top.instanceId], opponentSeat(ctx)); if (ctx.cardColor(top) === 3) ctx.addCardTempPower(ctx.self.instanceId, 3); } }, canTriggerOnDefend: (ctx) => ctx.link?.targetAllyId === undefined, onDefend(ctx) { const top = ctx.player(ctx.link?.attacker ?? opponentSeat(ctx)).deck[0]; if (top) { ctx.revealCards([top.instanceId]); if (ctx.cardColor(top) === 3) ctx.addCardTempDefense(ctx.self.instanceId, 3); } } },
  "cosmic awakening|3": { modifyAttack(ctx) { const chi = Number(ctx.getFlag("player", "pitchedChiCount")); return chi >= 3 ? 20 : chi === 2 ? 15 : chi === 1 ? 10 : 0; } },
  "levels of enlightenment|3": { onAttackDeclared(ctx) { const count = Number(ctx.getFlag("player", "pitchedPitch:3")); if (count > 0) ctx.drawCards(ctx.seat, 1); if (count > 1) ctx.addCardTempPower(ctx.self.instanceId, 2); if (count > 2) ctx.grantGoAgain(); } },
  "unravel aggression|3": { onPlay(ctx) { if (pitchedBlue(ctx)) ctx.drawCards(ctx.seat, 1); } },
  "dense blue mist|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: -1, seat: opponentSeat(ctx) }); if (pitchedBlue(ctx)) ctx.setPlayerFlag(ctx.seat, "suppressHitEffectsThisTurn", true); } },
  "orihon of mystic tenets|3": { onPlay(ctx) { ctx.drawCards(ctx.seat, pitchedBlue(ctx) ? 3 : 2); } },
  "bonds of agony|3": { modifyAttack: (ctx) => reactionCount(ctx) >= 3 ? 3 : 0, canTriggerOnHit(ctx) { return reactionCount(ctx) >= 3 && ctx.link?.targetAllyId === undefined; }, onHit(ctx) { const target = opponentSeat(ctx); const hand = ctx.player(target).hand; for (const card of hand) ctx.lookAt(card.instanceId); if (hand.length) ctx.requestCardChoice("agony-name", decisionPrompt("Choose a card", "card.mst.card.choose"), hand.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook !== "agony-name") return; const target = opponentSeat(ctx); const chosen = ctx.player(target).hand.find((card) => card.instanceId === Number(option)); if (!chosen) return; const name = data(ctx, chosen).name; for (const card of [...ctx.player(target).hand, ...ctx.player(target).deck, ...ctx.player(target).graveyard].filter((card) => data(ctx, card).name === name).slice(0, 3)) ctx.banish(card.instanceId); ctx.shuffleDeck(target); } },
  "persuasive prognosis|3": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { const target = opponentSeat(ctx); const top = ctx.player(target).deck[0]; if (!top || !ctx.banish(top.instanceId)) return; if (isAttackAction(ctx, top)) ctx.gainLife(ctx.seat, 1); const hand = ctx.player(target).hand; for (const card of hand) ctx.lookAt(card.instanceId); const same = hand.filter((card) => ctx.cardColor(card) === ctx.cardColor(top)); if (same.length) ctx.requestCardChoice("prognosis-hand", decisionPrompt("Banish a matching-color card", "card.mst.matchingcolor.card.banish"), same.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "prognosis-hand" && ctx.banish(Number(option))) { const card = ctx.player(opponentSeat(ctx)).banish.find((candidate) => candidate.instanceId === Number(option)); if (card && isAttackAction(ctx, card)) ctx.gainLife(ctx.seat, 1); } } },
  "just a nick|1": { canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onPlay(ctx) { if (!ctx.link) return; if (ctx.basePower(ctx.link.attackingCard) <= 1) ctx.addModifier({ scope: "chain-link", attack: 5 }); } },
  "10,000 year reunion|1": { wardValue: () => 10 },
  "rage specter|3": { onEnterArena(ctx) { if (!ctx.player(ctx.seat).board.some((card) => card.instanceId !== ctx.self.instanceId && isIllusionistAura(ctx, card))) ctx.gainActionPoint(); }, wardValue: (ctx) => ctx.state.activePlayer === ctx.seat ? 6 : 1 },
  "restless coalescence|2": {
    onEnterArena(ctx) { requestRestlessCoalescenceMove(ctx); },
    onChoose(ctx, hook, option) {
      if (hook !== "restless-coalescence-move" || option === "done") return;
      const source = restlessCoalescenceSources(ctx).find((card) => card.instanceId === Number(option));
      if (!source) return;
      ctx.addCounter(source.instanceId, "power", -1);
      ctx.addCounter(ctx.self.instanceId, "power", 1);
      requestRestlessCoalescenceMove(ctx);
    },
    wardValue: () => 2,
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.getCounter("power") > 0, onActivate(ctx) { ctx.setCounter("power", ctx.getCounter("power") - 1); ctx.createToken(SPECTRAL_SHIELD); } },
  },
  "chase the tail|1": { onAttackDeclared(ctx) { if (previousAttackHasName(ctx, "crouching tiger")) { ctx.grantGoAgain(); buffNextAttack(ctx, { attack: 3, appliesToName: "crouching tiger" }); } } },
  "maul|2": { canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat, onPlay(ctx) { if (!ctx.link) return; if (ctx.basePower(ctx.link.attackingCard) <= 1) ctx.addModifier({ scope: "chain-link", attack: 3 }); } },
  "territorial domain|3": { modifyDefense: (ctx) => ctx.getPlayerFlag(ctx.seat, "createdName:crouching tiger") === true ? 3 : 0 },
  "stonewall gauntlet|0": { canTriggerOnDefend: (ctx) => !!ctx.link && ctx.currentAttackPower() > ctx.basePower(ctx.link.attackingCard), onDefend(ctx) { ctx.addModifier({ scope: "combat-chain", attack: -1, seat: opponentSeat(ctx) }); } },
  "rowdy locals|3": { modifyAttack: (ctx) => ctx.link?.defendingCards.some((card) => ctx.hasCardType(card, "action")) ? 2 : 0, canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { requestDiscardChoice(ctx, "rowdy-self-discard", decisionPrompt("Choose a card to discard", "card.mst.card.discard"), ctx.seat); }, onChoose(ctx, hook, option) { if (hook === "rowdy-self-discard" && resolveDiscardChoice(ctx, option, ctx.seat)) requestDiscardChoice(ctx, "rowdy-opponent-discard", decisionPrompt("Choose a card to discard", "card.mst.card.discard"), opponentSeat(ctx)); else if (hook === "rowdy-opponent-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx)); } },
  "the weakest link|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; for (const card of hand) ctx.lookAt(card.instanceId); const eligible = hand.filter((card) => data(ctx, card).defense === undefined); if (eligible.length) ctx.requestCardChoice("weakest-card", decisionPrompt("Choose a card without defense", "card.mst.card.nodefense.choose"), eligible.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "weakest-card" && ctx.discardCard(opponentSeat(ctx), Number(option))) ctx.drawCards(ctx.seat, 1); } },
  "prismatic leyline|2": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToPitch: 1, once: true }); ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToPitch: 2, once: true }); ctx.addModifier({ scope: "until-end-of-turn", attack: 3, appliesToPitch: 3, once: true }); } },
  "visit goldmane estate|3": { onPlay(ctx) { createNamed(ctx, "Gold"); const player = ctx.player(ctx.seat); const gold = [...player.board, ...player.weapons, ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined)].filter((card) => ctx.cardNames(card).includes("gold")).length; if (gold >= 3) createNamed(ctx, "Might", gold); } },
  "visit the golden anvil|3": {},
  "supercell|3": { variablePlayCost: { base: 0, counterKey: "supercellX", prompt: "Choose X" }, onPlay(ctx) { const x = ctx.getCounter("supercellX"); const id = tokenNamed(ctx, "Hyper Driver"); if (id) { const driver = ctx.createToken(id); if (driver) ctx.setCardCounter(driver.instanceId, "steam", x); } } },
  "evo recall|3": { onEnterArena(ctx) { const cards = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && hasType(ctx, card, "mechanologist") && ctx.hasCardType(card, "action")); if (cards.length) ctx.requestCardChoice("recall-card", decisionPrompt("Put a Mechanologist action on top", "card.mst.mechanologist.action.top", { optionMessages: commonOptionMessages("no") }), ["no", ...cards.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "recall-card" && option !== "no") ctx.putOnDeckTop(Number(option)); } },
  "evo heartdrive|3": { onEnterArena: (ctx) => ctx.addModifier({ scope: "next-play", playCostReduction: 1, appliesTo: "attack-action" }) },
  "evo shortcircuit|3": { onEnterArena(ctx) { ctx.requestChoice("shortcircuit-target", decisionPrompt("Deal 1 damage to which hero?", "card.mst.hero.damage.choose", { values: { amount: 1 }, optionMessages: { "opposing hero": decisionMessage("common.option.opponent"), "your hero": decisionMessage("card.mst.option.yourhero") } }), ["opposing hero", "your hero"]); }, onChoose(ctx, hook, option) { if (hook === "shortcircuit-target") ctx.dealDamage(option === "your hero" ? ctx.seat : opponentSeat(ctx), 1); } },
  "evo speedslip|3": { onEnterArena: (ctx) => ctx.addModifier({ scope: "next-play", grantKeyword: "boost", appliesTo: "attack-action" }) },
  "longdraw half-glove|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => ctx.player(ctx.seat).hand.length + ctx.player(ctx.seat).arsenal.length >= 2, onActivate: (ctx) => buffNextAttack(ctx, { attack: 4, appliesToSubtype: "arrow" }) } },
  "murky water|1": { modifyAttack: (ctx) => (ctx.self.counters?.aim ?? 0) > 0 ? 1 : 0, onAttackDeclared(ctx) { if ((ctx.self.counters?.aim ?? 0) > 0) ctx.grantCardKeyword(ctx.self.instanceId, "dominate"); } },
  "kindle|1": { onPlay(ctx) { ampNextArcane(ctx, 1); if (ctx.player(ctx.seat).hand.length === 0) ctx.drawCards(ctx.seat, 1); } },
  "dust from stillwater shrine|1": { materialKeywords: ["phantasm"] },
  "shadowrealm horror|1": bloodDebt({ additionalCost(ctx) { for (const card of [...ctx.player(ctx.seat).graveyard].sort(() => ctx.randomInt(3) - 1).slice(0, 3)) ctx.banish(card.instanceId); }, modifyAttack: (ctx) => Number(ctx.getPlayerFlag(ctx.seat, "banishedSixPlusThisTurn")) > 0 ? 1 : 0 }),
  "eloquent eulogy|1": bloodDebt({ runeGate: true, onCombatChainClosed(ctx) { if (ctx.getFlag("player", "lostLifeThisTurn") === true || ctx.getPlayerFlag(opponentSeat(ctx), "lostLifeThisTurn") === true) createNamed(ctx, "Eloquence"); } }),
} satisfies Record<string, CardScript>);
