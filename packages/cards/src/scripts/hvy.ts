import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  isSixPlus,
  mergeSetScripts,
  opponentSeat,
  queueIntimidate,
  revealTopSixPlusStays,
} from "./shared-helpers.js";
import { hvyHighRarity } from "./hvy/high-rarity.js";

// Heavy Hitters — commons, rares, young heroes, and required wager tokens.
const AGILITY = "SBL034";
const MIGHT = "SLY035";
const VIGOR = "SDO036";
const GOLD = "SGB035";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasTag(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, tag: string): boolean {
  const d = data(ctx, card);
  if (tag.toLowerCase() === "token" && d.cardType === "token") return true;
  return ctx.cardTypes(card).includes(tag.toLowerCase());
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack");
}

function controls(ctx: ScriptCtx, name: string): boolean {
  const player = ctx.player(ctx.seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined),
  ].some((card) => ctx.cardNames(card).includes(name.toLowerCase()));
}

function drawnThisTurn(ctx: ScriptCtx): boolean {
  return Number(ctx.getPlayerFlag(ctx.seat, "cardsDrawnThisTurn")) > 0;
}

function defendedByAttackAction(ctx: ScriptCtx): boolean {
  return (ctx.link?.defendingCards ?? []).some((card) => isAttackAction(ctx, card));
}

function pitches(name: string, factory: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return {
    [`${name}|1`]: factory(1),
    [`${name}|2`]: factory(2),
    [`${name}|3`]: factory(3),
  };
}

function tokenAction(token: string): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      label: "Destroy: create a token",
      onActivate(ctx) { ctx.createToken(token); },
    },
  };
}

function windup(token: string): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate(ctx) { ctx.createToken(token); },
    },
  };
}

function clashForToken(token: string): CardScript {
  return {
    onDefend(ctx) {
      ctx.requestClash(opponentSeat(ctx), "create-token");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "create-token" && winner >= 0) ctx.createToken(token, winner);
    },
  };
}

function preventionToken(token: string): CardScript {
  return {
    onPlay(ctx) {
      ctx.preventNextDamage(ctx.seat, 2);
      ctx.addModifier({ scope: "until-end-of-turn", onPreventCreateToken: token });
    },
  };
}

function beatChest(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    additionalCost(ctx) {
      const sixes = ctx.player(ctx.seat).hand.filter((card) => isSixPlus(ctx, card));
      if (sixes.length) {
        ctx.requestCardChoice(
          "beat-chest",
          `${ctx.data.name}: discard a card with 6 or more power to beat chest?`,
          ["no", ...sixes.map((card) => card.instanceId)],
        );
      }
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "beat-chest") {
        ctx.setFlag("player", "discardingToBeatChest", true);
        ctx.setFlag("player", "discardingForBruteAttackCost", true);
        const discarded = option !== "no" && ctx.discardCard(ctx.seat, Number(option));
        ctx.setFlag("player", "discardingToBeatChest", false);
        ctx.setFlag("player", "discardingForBruteAttackCost", false);
        if (discarded) {
          ctx.setFlag("player", "beatenChestThisTurn", true);
        }
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

function wagerAttack(rewards: readonly string[]): CardScript {
  return {
    triggers: [{
      event: "attack-declared",
      sourceZone: "self",
      optional: true,
      label: "Wager with the defending hero?",
      condition: (ctx) => ctx.link?.targetAllyId === undefined,
      effect: (ctx) => ctx.wager(opponentSeat(ctx), rewards),
    }],
  };
}

function nextAttackWager(
  power: number,
  rewards: readonly string[],
  appliesToType?: string[],
): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: power,
        appliesTo: "attack",
        ...(appliesToType ? { appliesToType } : {}),
      });
      // Keep the resolved action available as the delayed wager source.
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId === undefined) return;
      const attached = ctx.state.modifiers.some((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link",
      );
      if (!attached) return;
      const sourceMarker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "until-end-of-turn" &&
        !modifier.consumed,
      );
      if (sourceMarker) ctx.consumeModifier(sourceMarker.id);
    },
    triggers: [{
      event: "attack-declared",
      optional: true,
      label: "Wager with the defending hero?",
      condition(ctx) {
        return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) =>
          modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link",
        );
      },
      onTrigger(ctx) {
        const sourceMarker = ctx.state.modifiers.find((modifier) =>
          modifier.sourceInstanceId === ctx.self.instanceId &&
          modifier.scope === "until-end-of-turn" &&
          !modifier.consumed,
        );
        if (sourceMarker) ctx.consumeModifier(sourceMarker.id);
      },
      effect(ctx) { ctx.wager(opponentSeat(ctx), rewards); },
    }],
  };
}

function warriorReaction(power: number, effect?: (ctx: ScriptCtx) => void): CardScript {
  return {
    canPlay: (ctx) => !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat &&
      ctx.currentAttackHasType("warrior"),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: power });
      effect?.(ctx);
    },
  };
}

function cutTheDeck(power: number): CardScript {
  return {
    ...warriorReaction(power),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: power });
      if (!defendedByAttackAction(ctx)) return;
      ctx.drawCards(ctx.seat, 1);
      const player = ctx.player(ctx.seat);
      const options = [...player.hand, ...player.arsenal].map((card) => card.instanceId);
      if (options.length) {
        ctx.requestCardChoice("cut-bottom", "Put a card from hand or arsenal on the bottom", options);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "cut-bottom") ctx.putOnDeckBottom(Number(option));
    },
  };
}

function lead(power: number, types: string[], token: string): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: power, appliesTo: "attack", appliesToType: types });
      ctx.createToken(token);
    },
  };
}

function dynamicDefense(): CardScript {
  return {
    modifyDefense(ctx) {
      return ctx.compareLife(opponentSeat(ctx), ctx.seat) > 0 ? 1 : 0;
    },
  };
}

function equipmentAndTokens(ctx: ScriptCtx, seat: number): number {
  const player = ctx.player(seat);
  const equipment = Object.values(player.equipment).filter(Boolean).length;
  const tokens = player.board.filter((card) => hasTag(ctx, card, "token")).length;
  return equipment + tokens;
}

function downButNotOut(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const opposing = opponentSeat(ctx);
      if (
        ctx.link?.targetAllyId !== undefined ||
        ctx.compareLife(ctx.seat, opposing) >= 0 ||
        equipmentAndTokens(ctx, ctx.seat) >= equipmentAndTokens(ctx, opposing)
      ) return;
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      ctx.setFlag("link", "overpower", true);
      ctx.setCounter("downButNotOut", 1);
    },
    canTriggerOnHit(ctx) {
      return ctx.getCounter("downButNotOut") > 0 && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      ctx.createToken(AGILITY);
      ctx.createToken(MIGHT);
      ctx.createToken(VIGOR);
    },
  };
}

function auraStart(power: number, token: string): CardScript {
  return {
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: `Destroy this: next Guardian attack +${power} and may wager`,
      effect(ctx) {
        ctx.destroySelf();
        buffNextAttack(ctx, { attack: power, appliesTo: "attack", appliesToClass: "guardian" });
        ctx.addModifier({ scope: "until-end-of-turn" });
      },
    }, {
      event: "attack-declared",
      optional: true,
      label: "Wager with the defending hero?",
      condition(ctx) {
        return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) =>
          modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link",
        );
      },
      effect: (ctx) => ctx.wager(opponentSeat(ctx), [token]),
    }],
  };
}

function stackInFavor(defense: number): CardScript {
  return {
    onEnterArena(ctx) {
      ctx.addModifier({ scope: "static", defense, appliesTo: "attack-action" });
    },
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: "Destroy this, draw, then put a hand card on top",
      effect(ctx) {
        ctx.destroySelf();
        ctx.drawCards(ctx.seat, 1);
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length) {
          ctx.requestCardChoice("stacked-top", "Put a card from your hand on top of your deck", hand.map((card) => card.instanceId));
        }
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "stacked-top") ctx.putOnDeckTop(Number(option));
    },
  };
}

function findPitchedGraveCards(ctx: ScriptCtx, pitch: number, count: number): DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).graveyard.filter((card) => ctx.cardColor(card) === pitch).slice(0, count);
}

function rally(): CardScript {
  return {
    defenseAbility: { discard: 1, oncePerTurn: true },
    onDefendAbility(ctx) {
      ctx.addModifier({ scope: "chain-link", defense: 3 });
      ctx.logPublic("Rally the Rearguard gains +3 defense");
    },
  };
}

export const hvy: Record<string, CardScript> = mergeSetScripts("HVY", hvyHighRarity, {
  // Brute
  "ball breaker|0": {
    activated: attackAbility(2),
    modifyAttack: (ctx) => ctx.getFlag("player", "discardedSixPlusThisTurn") === true ? 1 : 0,
  },
  "mini meataxe|0": {
    activated: attackAbility(2),
    onAttackDeclared(ctx) {
      ctx.drawCards(ctx.seat, 1);
      ctx.discardRandom(ctx.seat, 1);
    },
  },
  "monstrous veil|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true, destroySelfCost: true,
      onActivate(ctx) { ctx.drawCards(ctx.seat, 1); ctx.discardRandom(ctx.seat, 1); },
    },
  },
  "raw meat|0": {
    modifyDefense: (ctx) => Number(controls(ctx, "Agility")) + Number(controls(ctx, "Might")),
  },
  ...pitches("beast mode", () => ({
    modifyAttack: (ctx) => ctx.getFlag("player", "intimidatedThisTurn") === true ? 2 : 0,
  })),
  "pack call|1": { onDefend: revealTopSixPlusStays },
  "pack call|2": { onDefend: revealTopSixPlusStays },
  "pack call|3": { onDefend: revealTopSixPlusStays },
  ...pitches("rawhide rumble", () => beatChest({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "beatenChestThisTurn") === true && ctx.link?.targetAllyId === undefined) queueIntimidate(ctx);
    },
  })),
  ...pitches("assault and battery", () => beatChest({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "beatenChestThisTurn") === true) ctx.createToken(AGILITY);
    },
  })),
  ...pitches("pound town", () => beatChest({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "beatenChestThisTurn") === true) ctx.createToken(MIGHT);
    },
  })),
  ...pitches("bonebreaker bellow", (pitch) => beatChest({
    onPlay(ctx) {
      const base = 4 - pitch;
      buffNextAttack(ctx, {
        attack: base + (ctx.getFlag("player", "beatenChestThisTurn") === true ? 2 : 0),
        appliesTo: "attack",
        appliesToClass: "brute",
      });
    },
  })),
  "smashback alehorn|3": { onPlay(ctx) { ctx.createToken(AGILITY); ctx.createToken(MIGHT); } },

  // Guardian
  "betsy|0": {
    triggers: [{
      event: "wager-generated",
      label: "Pay 2 to give the wagering attack +1 and overpower?",
      effect(ctx) {
        ctx.requestPayment("betsy-pay", "Betsy: pay 2 to give the wagering attack +1 and overpower?", 2);
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "betsy-pay" || option !== "paid") return;
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      ctx.setFlag("link", "overpower", true);
    },
  },
  "victor goldmane|0": {
    firstFailedClashReplacement: {
      costPermanentName: "Gold",
      choiceHook: "victor-reclash",
    },
    onFriendlyTokenCreated(ctx, token) {
      if (data(ctx, token).name !== "Gold" || ctx.getFlag("player", "victorGoldDraw") === true) return;
      ctx.setFlag("player", "victorGoldDraw", true);
      ctx.drawCards(ctx.seat, 1);
    },
  },
  "high riser|0": {
    activated: attackAbility(3),
    modifyAttack: (ctx) => drawnThisTurn(ctx) ? 1 : 0,
  },
  "miller's grindstone|0": {
    activated: attackAbility(3),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ctx.requestClash(opponentSeat(ctx), "millers-grindstone");
    },
    onClashResult(ctx, hook, winner) {
      if (hook !== "millers-grindstone") return;
      if (winner === ctx.seat) {
        const top = ctx.player(opponentSeat(ctx)).deck[0];
        if (top) ctx.moveToGraveyard(top.instanceId, "deck");
      } else if (winner === opponentSeat(ctx)) {
        ctx.addCounter(ctx.self.instanceId, "power", -1);
      }
    },
    modifyAttack: (ctx) => ctx.getCounter("power"),
  },
  "golden glare|0": {
    canTriggerOnDefend: (ctx) => (ctx.link?.defendingCards ?? []).filter((card) => ctx.cardColor(card) === 2).length >= 2,
    onDefend(ctx) {
      ctx.createToken(GOLD);
    },
  },
  "good time chapeau|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true,
      canActivate: (ctx) => controls(ctx, "Gold"),
      effectCardCosts: [{
        zone: "arena", move: "destroy", count: 1, name: "Gold",
        prompt: "Good Time Chapeau: choose a Gold to destroy as a cost",
      }],
      effectCardCostChoiceHook: "chapeau-cost",
      label: "Destroy a Gold: next attack wagers Might and Vigor",
      onActivate(ctx) {
        ctx.addModifier({ scope: "next-attack", appliesTo: "attack" });
        ctx.addModifier({ scope: "until-end-of-turn" });
      },
    },
    triggers: [{
      event: "attack-declared",
      label: "Wager Might and Vigor with the defending hero",
      condition(ctx) {
        return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) =>
          modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link",
        );
      },
      effect: (ctx) => ctx.wager(opponentSeat(ctx), [MIGHT, VIGOR]),
    }],
  },
  "stand ground|0": {
    modifyDefense: (ctx) => Number(controls(ctx, "Might")) + Number(controls(ctx, "Vigor")),
  },
  "colossal bearing|1": {
    canTriggerOnHit: (ctx) => ctx.currentAttackPower() >= 13 && ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const targets = Object.values(ctx.player(opponentSeat(ctx)).equipment)
        .filter((card): card is DeepReadonly<CardInstance> => !!card)
        .filter((card) => Math.max(0, (data(ctx, card).defense ?? 0) - (card.defCounters ?? 0)) <= 1);
      if (targets.length) ctx.requestCardChoice("colossal-destroy", "Destroy equipment with 1 or less defense", targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "colossal-destroy") ctx.destroyPermanent(Number(option)); },
  },
  "lay down the law|1": {
    modifyDefendingDefense(ctx, defending) {
      return ctx.currentAttackPower() >= 13 && data(ctx, defending).cardType !== "equipment" ? -1 : 0;
    },
  },
  "smack of reality|1": {
    canTriggerOnHit: (ctx) => ctx.currentAttackPower() >= 13 && ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      for (const card of [...ctx.player(opponentSeat(ctx)).board]) {
        if (hasTag(ctx, card, "aura") && hasTag(ctx, card, "token")) ctx.destroyPermanent(card.instanceId);
      }
    },
  },
  ...pitches("over the top", () => ({
    onAttackDeclared(ctx) {
      ctx.suppressCardKeyword(ctx.self.instanceId, "overpower");
      if (ctx.currentAttackPower() > ctx.basePower(ctx.self)) ctx.setFlag("link", "overpower", true);
    },
  })),
  ...pitches("command respect", () => ({
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined && ctx.currentAttackPower() > ctx.basePower(ctx.self),
    onHit(ctx) {
      const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (arsenal) ctx.moveToGraveyard(arsenal.instanceId, "arsenal");
    },
  })),
  ...pitches("concuss", () => ({
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined && ctx.currentAttackPower() > ctx.basePower(ctx.self),
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      if (opponent.hand.length) {
        ctx.requestCardChoice("concuss-discard", "Choose a card to discard", opponent.hand.map((card) => card.instanceId), opponent.seat);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "concuss-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  })),
  ...pitches("thunk", () => ({
    onClashRevealed(ctx, won) { if (won) ctx.createToken(MIGHT); },
  })),
  ...pitches("wallop", () => ({
    onClashRevealed(ctx, won) { if (won) ctx.createToken(VIGOR); },
  })),
  ...pitches("big bop", (pitch) => auraStart(6 - pitch, VIGOR)),
  ...pitches("bigger than big", (pitch) => auraStart(6 - pitch, MIGHT)),
  "pint of strong and stout|3": { onPlay(ctx) { ctx.createToken(MIGHT); ctx.createToken(VIGOR); } },
  ...pitches("stacked in your favor", (pitch) => stackInFavor(4 - pitch)),

  // Warrior
  "kassai|0": {
    modifyAttackActivationCost(ctx, attacker, baseCost) {
      return drawnThisTurn(ctx) && hasTag(ctx, attacker, "sword") ? Math.max(0, baseCost - 1) : baseCost;
    },
    activated: {
      cost: 0, isAttack: false, goAgain: true, oncePerTurn: true,
      canActivate(ctx) { return findPitchedGraveCards(ctx, 1, 2).length === 2 && findPitchedGraveCards(ctx, 2, 2).length === 2; },
      effectCardCosts: [
        { zone: "graveyard", move: "banish", count: 2, pitch: 1, prompt: "Kassai: choose a red card to banish as a cost" },
        { zone: "graveyard", move: "banish", count: 2, pitch: 2, prompt: "Kassai: choose a yellow card to banish as a cost" },
      ],
      effectCardCostChoiceHook: "kassai-cost",
      label: "Banish 2 red and 2 yellow: next weapon hit creates Gold",
      onActivate(ctx) {
        ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "weapon", onHitCreateToken: { cardId: GOLD, count: 1 }, once: true });
      },
    },
  },
  "olympia|0": {
    triggers: [{
      event: "wager-won",
      label: "Create a Gold token",
      condition(ctx) {
        return ctx.link?.attacker === ctx.seat &&
          ctx.getFlag("link", `olympiaGold:${ctx.self.instanceId}`) !== true;
      },
      onTrigger(ctx) {
        ctx.setFlag("link", `olympiaGold:${ctx.self.instanceId}`, true);
      },
      effect(ctx) { ctx.createToken(GOLD); },
    }],
  },
  "hot streak|0": {
    activated: attackAbility(1),
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "hotStreakGoAgain") === true) ctx.grantGoAgain();
    },
    friendlyDefendedTrigger: {
      label: "When Hot Streak is defended by an attack action card",
      condition(ctx, defenders) {
        return ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
          defenders.some((card) => isAttackAction(ctx, card));
      },
    },
    onFriendlyDefended(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId || !defendedByAttackAction(ctx)) return;
      ctx.setFlag("player", "hotStreakGoAgain", true);
      ctx.grantGoAgain();
    },
  },
  "parry blade|0": {
    activated: attackAbility(1),
    modifyDefense: (ctx) => ctx.link?.attackCardType === "weapon" ? 2 : 0,
  },
  "prized galea|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true,
      canActivate: (ctx) => !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat && ctx.link.attackCardType === "weapon",
      onActivate(ctx) { ctx.wager(opponentSeat(ctx), [GOLD]); },
    },
  },
  "hood of red sand|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true,
      canActivate(ctx) {
        return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat && hasTag(ctx, ctx.link.attackingCard, "sword") &&
          findPitchedGraveCards(ctx, 1, 1).length === 1 && findPitchedGraveCards(ctx, 2, 1).length === 1;
      },
      effectCardCosts: [
        { zone: "graveyard", move: "banish", count: 1, pitch: 1, prompt: "Hood of Red Sand: choose a red card to banish as a cost" },
        { zone: "graveyard", move: "banish", count: 1, pitch: 2, prompt: "Hood of Red Sand: choose a yellow card to banish as a cost" },
      ],
      effectCardCostChoiceHook: "hood-cost",
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link", onHitDraw: 1 });
      },
    },
  },
  "beckon applause|0": {
    modifyDefense: (ctx) => Number(controls(ctx, "Agility")) + Number(controls(ctx, "Vigor")),
  },
  ...pitches("cut the deck", (pitch) => cutTheDeck(4 - pitch)),
  ...pitches("fatal engagement", (pitch) => ({
    ...warriorReaction(6 - pitch),
    canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat && ctx.currentAttackHasType("warrior") && defendedByAttackAction(ctx),
  })),
  ...pitches("take the upper hand", (pitch) => ({
    ...warriorReaction(4 - pitch),
    canPlay: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat && ctx.currentAttackHasType("warrior") && ctx.getFlag("link", "wagered") === true,
  })),
  "agile engagement|2": warriorReaction(2, (ctx) => { if (defendedByAttackAction(ctx)) ctx.createToken(AGILITY); }),
  "agile engagement|3": warriorReaction(1, (ctx) => { if (defendedByAttackAction(ctx)) ctx.createToken(AGILITY); }),
  ...pitches("vigorous engagement", (pitch) => warriorReaction(4 - pitch, (ctx) => {
    if (defendedByAttackAction(ctx)) ctx.createToken(VIGOR);
  })),
  ...pitches("draw swords", (pitch) => ({
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4 - pitch, appliesTo: "attack", appliesToClass: "warrior" });
      ctx.drawCards(ctx.seat, 1);
    },
  })),
  ...pitches("edge ahead", (pitch) => nextAttackWager(4 - pitch, [AGILITY], ["warrior"])),
  ...pitches("engaged swiftblade", (pitch) => ({
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 4 - pitch,
        appliesTo: "attack",
        appliesToClass: "warrior",
        goAgainIfDefendedByAttackAction: true,
      });
    },
  })),
  ...pitches("hold 'em", (pitch) => nextAttackWager(4 - pitch, [VIGOR], ["warrior"])),

  // Shared class cycles
  "gauntlet of might|0": tokenAction(MIGHT),
  "vigor girth|0": tokenAction(VIGOR),
  "clash of agility|2": clashForToken(AGILITY),
  "clash of agility|3": clashForToken(AGILITY),
  "clash of might|3": clashForToken(MIGHT),
  "clash of vigor|1": clashForToken(VIGOR),
  "clash of vigor|2": clashForToken(VIGOR),
  "test of agility|1": clashForToken(AGILITY),
  "test of vigor|1": clashForToken(VIGOR),
  "battered not broken|1": preventionToken(MIGHT),
  "slap-happy|1": preventionToken(VIGOR),
  "take it on the chin|1": preventionToken(AGILITY),
  "mighty windup|1": windup(MIGHT),
  "mighty windup|2": windup(MIGHT),
  "mighty windup|3": windup(MIGHT),
  "vigorous windup|1": windup(VIGOR),
  "vigorous windup|2": windup(VIGOR),
  "vigorous windup|3": windup(VIGOR),
  "agile windup|1": windup(AGILITY),
  "agile windup|2": windup(AGILITY),
  "wall of meat and muscle|1": {
    canTriggerOnDefend: (ctx) => controls(ctx, "Might"),
    onDefend(ctx) {
      if (!controls(ctx, "Might")) return;
      const attacks = ctx.player(ctx.seat).graveyard.filter((card) => isAttackAction(ctx, card));
      if (attacks.length) ctx.requestCardChoice("wall-top", "Put an attack action from your graveyard on top?", ["no", ...attacks.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "wall-top" && option !== "no") ctx.putOnDeckTop(Number(option)); },
  },
  "run into trouble|1": {
    canTriggerOnDefend: (ctx) => controls(ctx, "Agility"),
    onDefend(ctx) { if (controls(ctx, "Agility") && ctx.link) ctx.dealDamage(ctx.link.attacker, 1); },
  },
  "hearty block|1": { canTriggerOnDefend: (ctx) => controls(ctx, "Vigor"), onDefend(ctx) { if (controls(ctx, "Vigor")) ctx.gainLife(ctx.seat, 1); } },
  ...pitches("rising power", () => ({ modifyAttack: (ctx) => drawnThisTurn(ctx) ? 1 : 0 })),
  ...pitches("rising speed", () => ({
    onAttackDeclared(ctx) {
      ctx.suppressCardKeyword(ctx.self.instanceId, "go again");
      if (drawnThisTurn(ctx)) ctx.grantGoAgain();
    },
  })),
  ...pitches("rising energy", () => ({
    modifyPlayCost: (ctx, base) => drawnThisTurn(ctx) ? Math.max(0, base - 1) : base,
  })),
  ...pitches("wage agility", () => wagerAttack([AGILITY])),
  ...pitches("wage might", () => wagerAttack([MIGHT])),
  ...pitches("wage vigor", () => wagerAttack([VIGOR])),
  ...pitches("lead with heart", (pitch) => lead(4 - pitch, ["guardian", "warrior"], VIGOR)),
  ...pitches("lead with power", (pitch) => lead(4 - pitch, ["brute", "guardian"], MIGHT)),
  "lead with speed|2": lead(2, ["brute", "warrior"], AGILITY),
  "lead with speed|3": lead(1, ["brute", "warrior"], AGILITY),

  // Generic
  "glory seeker|0": {
    activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.drawCards(ctx.seat, 1); } },
  },
  "sheltered cove|0": {
    activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 2); } },
  },
  "face adversity|0": {
    canDefend: (ctx) => !!ctx.link && Number(ctx.getPlayerFlag(ctx.link.attacker, "cardsDrawnThisTurn")) > 0,
  },
  "confront adversity|0": {
    canDefend: (ctx) => !!ctx.link && ctx.getPlayerFlag(ctx.link.attacker, "destroyedName:vigor") === true,
  },
  "embrace adversity|0": {
    canDefend: (ctx) => !!ctx.link && ctx.getPlayerFlag(ctx.link.attacker, "destroyedName:might") === true,
  },
  "overcome adversity|0": {
    canDefend: (ctx) => !!ctx.link && ctx.getPlayerFlag(ctx.link.attacker, "destroyedName:agility") === true,
  },
  "bloodied oval|0": dynamicDefense(),
  "headliner helm|0": dynamicDefense(),
  "stadium centerpiece|0": dynamicDefense(),
  "ticket puncher|0": dynamicDefense(),
  "grandstand legplates|0": dynamicDefense(),
  ...pitches("down but not out", () => downButNotOut()),
  ...pitches("wage gold", () => wagerAttack([GOLD])),
  ...pitches("performance bonus", () => ({
    onAttackDeclared(ctx) {
      if (ctx.link?.flags.fromArsenal === true) ctx.grantGoAgain();
    },
    onHit(ctx) { ctx.createToken(GOLD); },
  })),
  ...pitches("money where ya mouth is", (pitch) => nextAttackWager(4 - pitch, [GOLD])),
  "starting stake|2": { onPlay(ctx) { if (!controls(ctx, "Gold")) ctx.createToken(GOLD); } },

  // HVY's previously imported blue Rally remains the only new printing-key;
  // red and yellow reuse the Monarch scripts.
  "rally the rearguard|3": rally(),
});
