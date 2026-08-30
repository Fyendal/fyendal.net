import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, bloodDebtScript as bloodDebt, buffNextAttack, mergeSetScripts, opponentSeat } from "./shared-helpers.js";
import { dtdHighRarity } from "./dtd/high-rarity.js";

// Dusk till Dawn — commons, rares, young heroes, and required tokens.
const RUNECHANT = "DTD214";
const COURAGE = "DTD232";
const SPECTRAL_SHIELD = "DTD220";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) { return ctx.cardData(card.cardId); }
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, tag: string): boolean {
  const wanted = tag.toLowerCase();
  return ctx.cardTypes(card).includes(wanted) || (data(ctx, card).keywords ?? [])
    .some((candidate) => candidate.toLowerCase() === wanted);
}
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function isNonAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !has(ctx, card, "attack");
}
function isHerald(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return isAttack(ctx, card) && data(ctx, card).name.toLowerCase().includes("herald");
}
function ownAttack(ctx: ScriptCtx): boolean {
  return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat;
}
function charged(ctx: ScriptCtx): boolean { return ctx.getFlag("player", "chargedThisTurn") === true; }
function createTokens(ctx: ScriptCtx, id: string, count: number): void {
  ctx.createTokens(id, count);
}
function chargeAttack(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) ctx.requestCardChoice("dtd-charge", "Charge your hero's soul?", ["no", ...hand.map((card) => card.instanceId)]);
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "dtd-charge") {
        if (option !== "no") {
          const card = ctx.charge(Number(option));
          if (card) ctx.setCounter("chargedPitch", ctx.cardColor(card));
        }
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}
function heraldInstant(effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    canPlay: (ctx) => ownAttack(ctx) && isHerald(ctx, ctx.link!.attackingCard),
    onPlay: effect,
  };
}
function celestialResolve(amount: number): CardScript {
  const targets = (ctx: ScriptCtx) => [ctx.link?.attackingCard, ...(ctx.link?.defendingCards ?? [])]
    .filter((card): card is DeepReadonly<CardInstance> => !!card && isHerald(ctx, card));
  return {
    playTargetOptions: (ctx) => targets(ctx).map((card) => card.instanceId),
    onPlay(ctx) { if (ctx.playTargetInstanceId !== undefined) ctx.addCardTempDefense(ctx.playTargetInstanceId, amount); },
  };
}
function celestialReprimand(amount: number): CardScript {
  const targets = (ctx: ScriptCtx) => (ctx.link?.defendingCards ?? [])
    .filter((card) => isHerald(ctx, ctx.link!.attackingCard) && isAttack(ctx, card));
  return {
    playTargetOptions: (ctx) => targets(ctx).map((card) => card.instanceId),
    onPlay(ctx) { if (ctx.playTargetInstanceId !== undefined) ctx.addCardTempPower(ctx.playTargetInstanceId, -amount); },
  };
}
function boltynHero(): CardScript {
  return {
    modifyAttack(ctx) {
      return charged(ctx) && (ctx.link?.defendingCards ?? []).some((card) => isAttack(ctx, card)) ? 1 : 0;
    },
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", banishSoulCost: 1,
      label: "Banish a soul card: grant go again",
      canActivate: (ctx) => ownAttack(ctx) && ctx.currentAttackPower() > ctx.basePower(ctx.link!.attackingCard),
      onActivate(ctx) { ctx.grantGoAgain(); },
    },
  };
}
function banneret(kind: "defense" | "resource"): CardScript {
  return {
    onCharged(ctx) {
      if (kind === "resource") ctx.addModifier({ scope: "until-end-of-turn", onHitGainResources: 1 });
      else ctx.addModifier({ scope: "until-end-of-turn", defense: 1, appliesToCardType: "action", once: true });
    },
  };
}
function vForValor(power: number): CardScript {
  return {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true,
      canActivate: (ctx) => ownAttack(ctx) && ctx.player(ctx.seat).hand.length > 0,
      label: `Destroy and charge: attack +${power}`,
      onActivate(ctx) { ctx.requestCardChoice("valor-charge", "Charge a card", ctx.player(ctx.seat).hand.map((card) => card.instanceId)); },
    },
    onChoose(ctx, hook, option) {
      if (hook === "valor-charge" && ctx.charge(Number(option))) ctx.addModifier({ scope: "chain-link", attack: power });
    },
  };
}
function radiantEquipment(): CardScript {
  return {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", banishSelfCost: true, banishSoulCost: 1,
      label: "Banish this and a soul card: prevent 2",
      onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 2); },
    },
  };
}
function randomBanishCost(ctx: ScriptCtx): DeepReadonly<CardInstance> | undefined {
  const hand = ctx.player(ctx.seat).hand;
  if (!hand.length) return undefined;
  const chosen = hand[ctx.randomInt(hand.length)];
  if (!chosen || !ctx.banish(chosen.instanceId)) return undefined;
  if (ctx.basePower(chosen) >= 6) ctx.setCounter("banishedSix", 1);
  return chosen;
}
function randomBanishAttack(reward?: "go-again" | "power"): CardScript {
  return {
    additionalCost: randomBanishCost,
    onAttackDeclared(ctx) {
      if (!ctx.getCounter("banishedSix")) return;
      if (reward === "go-again") ctx.grantGoAgain();
      if (reward === "power") ctx.addModifier({ scope: "chain-link", attack: 2 });
    },
  };
}
function bloodDebtAttack(extra: CardScript = {}): CardScript { return bloodDebt(extra); }
function runeGate(extra: CardScript = {}): CardScript { return { runeGate: true, ...bloodDebt(extra) }; }
function runeGateClose(kind?: "life" | "runechant"): CardScript {
  return runeGate({
    onCombatChainClosed(ctx) {
      const count = ctx.state.players.filter((player) => player.flags.lostLifeThisTurn === true).length;
      if (kind === "life") ctx.gainLife(ctx.seat, count);
      if (kind === "runechant") createTokens(ctx, RUNECHANT, count);
    },
  });
}
function nextRuneGated(power: number, create = false): CardScript {
  return {
    onPlay(ctx) {
      if (create) ctx.createToken(RUNECHANT);
      buffNextAttack(ctx, { attack: power, appliesTo: "attack-action", appliesToRuneGated: true });
    },
  };
}
function shadowEquipment(): CardScript {
  return bloodDebt({
    optionalDamagePrevention: { amount: 2, moveSource: "banish" },
  });
}
function fromBanishDiscount(effect: (ctx: ScriptCtx) => void): CardScript {
  return bloodDebt({
    staticPlayableFrom: ["banish"],
    modifyPlayCost(ctx, base) {
      return ctx.player(ctx.seat).banish.some((card) => card.instanceId === ctx.self.instanceId)
        ? Math.max(0, base - 2) : base;
    },
    onPlay: effect,
  });
}
function banishTargetSoul(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const soul = ctx.player(opponentSeat(ctx)).soul;
      if (soul.length) ctx.requestCardChoice("banish-soul", "Banish a card from the defending hero's soul", soul.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "banish-soul") ctx.banish(Number(option)); },
  };
}
function banishBuff(power: number): CardScript {
  return {
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && isAttack(ctx, card));
      if (cards.length) ctx.requestCardChoice("banish-buff", "Choose a banished attack action", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "banish-buff") ctx.addCardTempPower(Number(option), power); },
  };
}
function banishGoAgain(pitch: number): CardScript {
  return {
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && ctx.hasCardType(card, "action") && ctx.cardColor(card) === pitch);
      if (cards.length) ctx.requestCardChoice("banish-go", "Choose a banished action card", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "banish-go") ctx.grantCardKeyword(Number(option), "go again"); },
  };
}
function frontline(): CardScript {
  return { triggers: [{ event: "end-of-turn", whose: "subject", label: "Put a -1 defense counter on this", effect(ctx) { ctx.addCardDefenseCounters(ctx.self.instanceId, 1); } }] };
}

export const dtd: Record<string, CardScript> = mergeSetScripts("DTD", dtdHighRarity, {
  "prism, advent of thrones|0": {
    onCardPutIntoSoul(ctx, card) {
      if (ctx.state.phase !== "action" || !data(ctx, card).name.toLowerCase().includes("herald")) return;
      const controlledNames = new Set(ctx.player(ctx.seat).board.map((permanent) => data(ctx, permanent).name));
      const figments = ctx.player(ctx.seat).deck.filter((candidate) =>
        has(ctx, candidate, "figment") && !controlledNames.has(data(ctx, candidate).name),
      );
      if (figments.length > 0) {
        ctx.requestCardChoice(
          "prism-figment-search",
          "Search your deck for a Figment and put it into the arena?",
          ["no", ...figments.map((candidate) => candidate.instanceId)],
        );
      }
    },
    activated: {
      cost: 2,
      banishSoulCost: 1,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "instant",
      label: "Banish a soul card: awaken a Figment",
      canActivate(ctx) {
        return ctx.player(ctx.seat).board.some((card) =>
          has(ctx, card, "figment") && data(ctx, card).backId !== undefined,
        );
      },
      onActivate(ctx) {
        const figments = ctx.player(ctx.seat).board.filter((card) =>
          has(ctx, card, "figment") && data(ctx, card).backId !== undefined,
        );
        if (figments.length > 0) {
          ctx.requestCardChoice(
            "prism-awaken",
            "Choose a Figment to awaken",
            figments.map((card) => card.instanceId),
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "prism-figment-search") {
        if (option !== "no") {
          const chosen = ctx.player(ctx.seat).deck.find((card) =>
            card.instanceId === Number(option) && has(ctx, card, "figment"),
          );
          if (chosen) ctx.settleCard(chosen.instanceId);
        }
        ctx.shuffleDeck();
        return;
      }
      if (hook !== "prism-awaken") return;
      const figment = ctx.player(ctx.seat).board.find((card) =>
        card.instanceId === Number(option) && has(ctx, card, "figment"),
      );
      const backId = figment ? data(ctx, figment).backId : undefined;
      if (figment && backId) ctx.transformInto(backId, [], figment.instanceId);
    },
  },
  "figment of protection|2": {
    onEnterArena(ctx) { ctx.createToken(SPECTRAL_SHIELD); },
  },
  "aegis, archangel of protection|0": {
    activated: attackAbility(2),
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      const soul = ctx.player(ctx.seat).soul;
      if (soul.length > 0) {
        ctx.requestCardChoice(
          "aegis-soul",
          "Banish a card from your hero's soul to create 2 Spectral Shields?",
          ["no", ...soul.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aegis-soul" || option === "no" || !ctx.banish(Number(option))) return;
      createTokens(ctx, SPECTRAL_SHIELD, 2);
    },
  },
  "luminaris, celestial fury|0": {
    activated: {
      cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true,
      canActivate: (ctx) => ownAttack(ctx) && (isHerald(ctx, ctx.link!.attackingCard) || has(ctx, ctx.link!.attackingCard, "angel")),
      label: "Target Herald or angel attack gains go again",
      onActivate(ctx) { ctx.grantGoAgain(); },
    },
  },
  "ser boltyn, breaker of dawn|0": boltynHero(),
  "beaming blade|0": {
    activated: attackAbility(2),
    modifyAttack: (ctx) => Number(ctx.getFlag("player", "soulPitch:2")) > 0 ? 5 : 0,
  },
  "banneret of resilience|2": banneret("defense"),
  "banneret of vigor|2": banneret("resource"),
  "beaming bravado|3": chargeAttack({ modifyAttack: (ctx) => ctx.getCounter("chargedPitch") === 2 ? 1 : 0 }),
  "radiant view|0": radiantEquipment(), "radiant raiment|0": radiantEquipment(), "radiant flow|0": radiantEquipment(),
  "levia, shadowborn abomination|0": {},
  "hell hammer|0": bloodDebt({
    activated: attackAbility(2),
    onCombatChainClosed(ctx) { ctx.banish(ctx.self.instanceId); },
  }),
  "vynnset|0": {
    triggers: [
      {
        event: "start-of-turn", whose: "subject", label: "Banish a card from hand",
        condition: (ctx) => ctx.player(ctx.seat).hand.length > 0,
        effect(ctx) { ctx.requestCardChoice("vynnset-banish", "Banish a card from your hand", ctx.player(ctx.seat).hand.map((card) => card.instanceId)); },
      },
      {
        event: "card-played",
        label: "Pay 1 life to make the next Runechant unpreventable?",
        condition: (ctx, played) => !!played && isNonAttack(ctx, played) &&
          has(ctx, played, "shadow") &&
          ctx.player(ctx.seat).life > 1,
        effect(ctx) {
          ctx.requestChoice("vynnset-life", "Pay 1 life to make the next Runechant effect unpreventable?", ["yes", "no"]);
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "vynnset-banish" && ctx.banish(Number(option))) ctx.createToken(RUNECHANT);
      if (hook === "vynnset-life" && option === "yes") {
        ctx.loseLife(ctx.seat, 1);
        ctx.setFlag("player", "nextRunechantUnpreventable", true);
      }
    },
  },
  "flail of agony|0": { activated: attackAbility(0), ...banishTargetSoul(), canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.createToken(RUNECHANT); } },
  "shroud of darkness|0": shadowEquipment(), "cloak of darkness|0": shadowEquipment(),
  "grasp of darkness|0": shadowEquipment(), "dance of darkness|0": shadowEquipment(),
  "nasreth, the soul harrower|0": {
    activated: attackAbility(0),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const soul = ctx.player(opponentSeat(ctx)).soul;
      if (soul.length) ctx.requestCardChoice("nasreth", "Banish a soul card", soul.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "nasreth") return;
      const card = ctx.player(opponentSeat(ctx)).soul.find((candidate) => candidate.instanceId === Number(option));
      if (card && ctx.banish(card.instanceId) && has(ctx, card, "light")) ctx.gainLife(ctx.seat, 1);
    },
  },
  "rugged roller|0": { activated: { ...attackAbility(1)[0]!, canActivate: (ctx) => ctx.getFlag("player", "rolledDie:6") === true } },
  "decimator great axe|0": {
    activated: attackAbility(3),
    friendlyDefendedTrigger: {
      label: "The first time Decimator Great Axe is defended by a non-equipment card this turn",
      condition(ctx, defenders) {
        return ownAttack(ctx) && ctx.getCounter("usedTurn") !== ctx.state.turn &&
          defenders.some((card) => ctx.cardData(card.cardId).cardType !== "equipment");
      },
    },
    onFriendlyDefended(ctx) {
      if (!ownAttack(ctx) || ctx.getCounter("usedTurn") === ctx.state.turn) return;
      const cards = [
        ...ctx.link!.defendingCards,
        ...ctx.link!.defendingEquipment,
      ];
      if (!cards.length) return;
      ctx.setCounter("usedTurn", ctx.state.turn);
      ctx.requestCardChoice("decimator", "Choose a defending card to halve its base defense", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "decimator") return;
      const card = [
        ...(ctx.link?.defendingCards ?? []),
        ...(ctx.link?.defendingEquipment ?? []),
      ].find((candidate) => candidate.instanceId === Number(option));
      if (card) ctx.addCardTempDefense(card.instanceId, -Math.floor((data(ctx, card).defense ?? 0) / 2));
    },
  },
  "scepter of pain|0": {
    activated: {
      cost: 2, isAttack: false, goAgain: true, oncePerTurn: true, label: "Deal 1 arcane damage",
      onActivate(ctx) { if (ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true }) > 0) ctx.createToken(RUNECHANT); },
    },
  },
  "reality refractor|0": {
    grantsAuraAttack: {
      cost: 2,
      basePower: 5,
      requiresClass: "illusionist",
      requiresSubtype: "aura",
      requiresWard: false,
    },
  },
  "frontline helm|0": frontline(), "frontline plating|0": frontline(),
  "frontline gauntlets|0": frontline(), "frontline legs|0": frontline(),
  "eloquence|0": {
    triggers: [{
      event: "card-played",
      label: "Destroy Eloquence (card gains go again)",
      condition: (ctx, played) => !!played && isNonAttack(ctx, played),
      effect(ctx, played) {
        if (!played) return;
        ctx.destroySelf();
        ctx.grantCardKeyword(played.instanceId, "go again");
      },
    }],
  },
});

for (const [pitch, power] of [[1, 3], [2, 2], [3, 1]] as const) {
  dtd[`angelic descent|${pitch}`] = heraldInstant((ctx) => { ctx.grantGoAgain(); buffNextAttack(ctx, { attack: power, appliesToSubtype: "angel" }); });
  dtd[`angelic wrath|${pitch}`] = heraldInstant((ctx) => ctx.addModifier({ scope: "chain-link", attack: power + 1 }));
  dtd[`celestial reprimand|${pitch}`] = celestialReprimand(power);
  dtd[`celestial resolve|${pitch}`] = celestialResolve(power + 2);
  dtd[`v for valor|${pitch}`] = vForValor(power);
  dtd[`glaring impact|${pitch}`] = chargeAttack({ onAttackDeclared(ctx) { if (ctx.getCounter("chargedPitch") === 2) ctx.setFlag("link", "overpower", true); } });
  if (pitch === 3) dtd[`light the way|${pitch}`] = chargeAttack({ canTriggerOnHit: (ctx) => ctx.getCounter("chargedPitch") === 2, onHit(ctx) { ctx.grantGoAgain(); } });
  dtd[`resounding courage|${pitch}`] = {
    canPlay: (ctx) => ownAttack(ctx) && has(ctx, ctx.link!.attackingCard, "light") && has(ctx, ctx.link!.attackingCard, "warrior"),
    onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: power }); if (charged(ctx)) ctx.createToken(COURAGE); },
  };
  dtd[`charge of the light brigade|${pitch}`] = { onPlay(ctx) { buffNextAttack(ctx, { attack: power, appliesTo: "attack-action", appliesToCharged: true }); } };

  dtd[`lay to rest|${pitch}`] = {
    modifyAttack(ctx) { return ctx.link?.targetAllyId === undefined && has(ctx, ctx.player(opponentSeat(ctx)).hero, "shadow") ? 1 : 0; },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const banish = ctx.player(opponentSeat(ctx)).banish.filter((card) => !card.faceDown);
      if (banish.length) ctx.requestCardChoice("lay-rest", "Turn a banished card face down?", ["no", ...banish.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "lay-rest" && option !== "no") ctx.setCardFaceDown(Number(option), true); },
  };
  dtd[`blessing of salvation|${pitch}`] = {
    playAsInstant: (ctx) => ctx.getFlag("player", "soulThisTurn") === true,
    onPlay(ctx) { ctx.gainLife(ctx.seat, 4 - pitch); },
  };
  dtd[`cleansing light|${pitch}`] = {
    playAsInstant: (ctx) => ctx.getFlag("player", "soulThisTurn") === true,
    playTargetOptions(ctx) {
      return ctx.state.players.flatMap((player) => player.board)
        .filter((card) => has(ctx, card, "aura") && ctx.cardColor(card) === pitch)
        .map((card) => card.instanceId);
    },
    onPlay(ctx) { if (ctx.playTargetInstanceId !== undefined) ctx.destroyPermanent(ctx.playTargetInstanceId); },
  };
  dtd[`blistering assault|${pitch}`] = { onAttackDeclared(ctx) { if (ctx.player(ctx.seat).pitch.some((card) => ctx.cardColor(card) === 2)) ctx.grantGoAgain(); } };
  dtd[`defender of daybreak|${pitch}`] = {
    canTriggerOnDefend: (ctx) => !!ctx.link && has(ctx, ctx.link.attackingCard, "shadow"),
    onDefend(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", defense: 1, appliesToSubtype: "light", appliesToCardType: "action", expiresOnChainClose: true });
    },
  };
  dtd[`searing ray|${pitch}`] = { modifyAttack: (ctx) => ctx.player(ctx.seat).pitch.some((card) => ctx.cardColor(card) === 2) ? 2 : 0 };
  dtd[`break of dawn|${pitch}`] = {
    onPlay(ctx) {
      ctx.preventNextDamageFromType(ctx.seat, 5 - pitch, "shadow");
    },
  };

  dtd[`ram raider|${pitch}`] = bloodDebt(randomBanishAttack("go-again"));
  dtd[`wall breaker|${pitch}`] = bloodDebtAttack({ onAttackDeclared(ctx) { if (ctx.getFlag("player", "banishedSixPlusThisTurn") === true) ctx.setFlag("link", "overpower", true); } });
  dtd[`shaden scream|${pitch}`] = { additionalCost: randomBanishCost, onPlay(ctx) { buffNextAttack(ctx, { attack: 6 - pitch, appliesToType: ["brute", "shadow"] }); } };
  dtd[`battlefield breaker|${pitch}`] = bloodDebt({ modifyAttack: (ctx) => ctx.getFlag("player", "banishedSixPlusThisTurn") === true ? 1 : 0 });
  dtd[`shaden swing|${pitch}`] = bloodDebt(randomBanishAttack());
  dtd[`tribute to demolition|${pitch}`] = bloodDebt(randomBanishAttack("power"));
  dtd[`tribute to the legions of doom|${pitch}`] = bloodDebt(randomBanishAttack("power"));

  dtd[`deathly delight|${pitch}`] = runeGateClose("life");
  dtd[`deathly wail|${pitch}`] = runeGateClose("runechant");
  dtd[`envelop in darkness|${pitch}`] = nextRuneGated(4 - pitch, true);
  dtd[`rift skitter|${pitch}`] = runeGate();
  dtd[`vantom banshee|${pitch}`] = runeGate();
  dtd[`vantom wraith|${pitch}`] = runeGate();
  dtd[`putrid stirrings|${pitch}`] = bloodDebt({ staticPlayableFrom: ["banish"], ...nextRuneGated(6 - pitch) });

  dtd[`hungering demigon|${pitch}`] = bloodDebt({
    staticPlayableFrom: ["banish"],
    canPlay(ctx) {
      const inBanish = ctx.player(ctx.seat).banish.some((card) => card.instanceId === ctx.self.instanceId);
      return !inBanish || ctx.player(opponentSeat(ctx)).soul.length > 0;
    },
    ...banishTargetSoul(),
  });
  dtd[`grim feast|${pitch}`] = fromBanishDiscount((ctx) => ctx.gainLife(ctx.seat, 4 - pitch));
  dtd[`vile inquisition|${pitch}`] = fromBanishDiscount((ctx) => {
    const target = ctx.player(opponentSeat(ctx));
    const top = target.deck[0];
    if (top && ctx.banish(top.instanceId) && ctx.cardColor(top) === pitch) ctx.loseLife(target.seat, 1);
  });
  dtd[`soul butcher|${pitch}`] = bloodDebt({ modifyAttack: (ctx) => ctx.player(opponentSeat(ctx)).soul.length > 0 ? 2 : 0 });
  dtd[`soul cleaver|${pitch}`] = bloodDebt({ onAttackDeclared(ctx) { if (ctx.player(opponentSeat(ctx)).soul.length > 0) ctx.grantGoAgain(); } });
  dtd[`beseech the demigon|${pitch}`] = banishBuff(4 - pitch);
  dtd[`tear through the portal|${pitch}`] = banishGoAgain(pitch);
}
