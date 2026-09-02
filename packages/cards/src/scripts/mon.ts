import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackedWithWeapon,
  bloodDebtScript as bloodDebt,
  buffNextAttack,
  commonOptionMessages,
  dealArcane,
  decisionMessage,
  decisionPrompt,
  ironhideScript,
  isCard,
  isSixPlus,
  mergeSetScripts,
  optN,
  optOnChoose,
  opponentSeat,
  yesNoPrompt,
} from "./shared-helpers.js";
import { monHighRarity } from "./mon/high-rarity.js";

// ── Monarch (commons, rares, young heroes, and required tokens) ────────────

const SPECTRAL_SHIELD = "SEN037";
const SOUL_SHACKLE = "MON186";

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
}

function lessLifePlayTrigger(effect: { attack?: number; keyword?: string }): CardScript {
  return {
    triggers: [{
      event: "card-played",
      sourceZone: "self",
      label: effect.attack ? `Gain +${effect.attack} attack` : `Gain ${effect.keyword}`,
      condition: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0,
      effect(ctx, played) {
        if (!played) return;
        if (effect.attack) ctx.addCardTempPower(played.instanceId, effect.attack);
        if (effect.keyword === "dominate") ctx.setFlag("link", "dominate", true);
        else if (effect.keyword) ctx.grantCardKeyword(played.instanceId, effect.keyword);
      },
    }],
  };
}

function invigoratingLight(): CardScript {
  return {
    triggers: [{
      event: "card-played",
      sourceZone: "self",
      label: "Put this into your hero's soul when the combat chain closes",
      condition: (ctx) => ctx.player(ctx.seat).soul.length === 0,
      effect: (ctx) => ctx.setFlag("link", "attackToSoul", true),
    }],
  };
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function hasKeyword(ctx: ScriptCtx, cardId: string, keyword: string): boolean {
  return (ctx.cardData(cardId).keywords ?? []).some(
    (candidate) => candidate.toLowerCase() === keyword.toLowerCase(),
  );
}

function blindingBeamTargets(ctx: ScriptCtx) {
  return [ctx.link?.attackingCard, ...(ctx.link?.defendingCards ?? [])]
    .filter((card): card is NonNullable<typeof card> =>
      !!card && isAttackAction(ctx, card));
}

function blindingBeam(powerReduction: number): CardScript {
  return {
    playTargetOptions(ctx) {
      return blindingBeamTargets(ctx).map((card) => card.instanceId);
    },
    modifyPlayCost(ctx, baseCost) {
      const target = blindingBeamTargets(ctx).find(
        (card) => card.instanceId === ctx.playTargetInstanceId,
      );
      const shadow = target && (
        hasType(ctx, target, "shadow") ||
        (target.grantedTypes ?? []).some((type) => type.toLowerCase() === "shadow")
      );
      return shadow ? baseCost - 1 : baseCost;
    },
    onPlay(ctx) {
      const target = blindingBeamTargets(ctx).find(
        (card) => card.instanceId === ctx.playTargetInstanceId,
      );
      if (target) ctx.addCardTempPower(target.instanceId, -powerReduction);
    },
  };
}

function chargedThisTurn(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "chargedThisTurn") === true;
}

function chargeAttack(extra: CardScript = {}): CardScript {
  return {
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length === 0) return;
      ctx.requestCardChoice(
        "mon-charge",
        decisionPrompt(`${ctx.data.name}: choose a card from your hand to charge, or decline`, "card.mon.charge.choose", {
          values: { card: { kind: "card", cardId: ctx.self.cardId } },
          optionMessages: commonOptionMessages("no"),
        }),
        ["no", ...hand.map((card) => card.instanceId)],
      );
    },
    ...extra,
    onChoose(ctx, hook, option) {
      if (hook === "mon-charge") {
        if (option !== "no") {
          const charged = ctx.charge(Number(option));
          if (charged) ctx.setCounter("chargedPitch", ctx.cardColor(charged));
        }
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

function putAttackIntoSoulOnHit(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    onHit(ctx) {
      ctx.setFlag("link", "attackToSoul", true);
      extra.onHit?.(ctx);
    },
  };
}

function createSpectralShields(count: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.createTokens(SPECTRAL_SHIELD, count);
    },
  };
}

function glisten(count: number): CardScript {
  return {
    onPlay(ctx) {
      const weapons = ctx.player(ctx.seat).weapons;
      if (weapons.length === 0) return;
      const options: string[] = [];
      if (weapons.length === 1) {
        for (let first = 0; first <= count; first++) options.push(String(first));
      } else {
        for (let first = 0; first <= count; first++) {
          for (let second = 0; first + second <= count; second++) {
            options.push(`${first}:${second}`);
          }
        }
      }
      ctx.requestChoice(
        "mon-glisten",
        decisionPrompt(`${ctx.data.name}: distribute up to ${count} +1{p} counters among your weapons`, "card.mon.glisten.distribute", {
          values: { card: { kind: "card", cardId: ctx.self.cardId }, count },
          optionMessages: Object.fromEntries(options.map((option) => [
            option,
            decisionMessage("card.mon.glisten.option", { distribution: option.split(":").map((amount) => `+${amount}`).join(" / ") }),
          ])),
        }),
        options,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "mon-glisten") return;
      const weapons = ctx.player(ctx.seat).weapons;
      option.split(":").map(Number).forEach((amount, index) => {
        const weapon = weapons[index];
        if (weapon && amount > 0) ctx.addCounter(weapon.instanceId, "power", amount);
      });
      ctx.setFlag(
        "player",
        "clearWeaponPowerCountersAtTurn",
        ctx.state.activePlayer === ctx.seat ? ctx.state.turn : ctx.state.turn + 1,
      );
    },
  };
}

function nextAttackToSoul(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        onHitToSoul: true,
      });
    },
  };
}

function phantasmify(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        grantType: "illusionist",
        grantKeyword: "phantasm",
      });
    },
  };
}

function duskPathPilgrimage(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "weapon",
        onHitReenableAttacker: true,
      });
    },
  };
}

function plowThrough(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "weapon",
        onDefendedByAttackActionPowerCounters: 1,
      });
    },
  };
}

function secondSwing(attack: number): CardScript {
  return {
    onPlay(ctx) {
      if (attackedWithWeapon(ctx)) buffNextAttack(ctx, { attack });
    },
  };
}

function banishRandomFromGraveyard(ctx: ScriptCtx, count: number) {
  const graveyard = [...ctx.player(ctx.seat).graveyard];
  const banished = [];
  for (let i = 0; i < count && graveyard.length > 0; i++) {
    const index = ctx.randomInt(graveyard.length);
    const [card] = graveyard.splice(index, 1);
    if (card && ctx.banish(card.instanceId)) banished.push(card);
  }
  return banished;
}

function banishThreeCost(extra: CardScript = {}): CardScript {
  return {
    canPlay: (ctx) => ctx.player(ctx.seat).graveyard.length >= 3,
    additionalCost(ctx) {
      const banished = banishRandomFromGraveyard(ctx, 3);
      if (banished.some((card) => isSixPlus(ctx, card))) ctx.setCounter("banishedSix", 1);
      extra.additionalCost?.(ctx);
    },
    ...extra,
  };
}

function shadowBruteBanishThree(kind: "plain" | "power" | "dominate" | "go-again"): CardScript {
  return bloodDebt(banishThreeCost({
    modifyAttack(ctx) {
      return kind === "power" && ctx.getCounter("banishedSix") ? 3 : 0;
    },
    onAttackDeclared(ctx) {
      if (!ctx.getCounter("banishedSix")) return;
      if (kind === "dominate") {
        ctx.addModifier({ scope: "chain-link", dominate: true });
      } else if (kind === "go-again") {
        ctx.grantGoAgain();
      }
    },
  }));
}

function convulsions(attack: number): CardScript {
  return banishThreeCost({
    onPlay(ctx) {
      if (!ctx.getCounter("banishedSix")) return;
      buffNextAttack(ctx, { attack, dominate: true, appliesTo: "attack-action" });
    },
  });
}

function unworldlyBellow(attack: number): CardScript {
  return banishThreeCost({
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        appliesToType: ["brute", "shadow"],
      });
    },
  });
}

function dimenxxionalGateway(opt: number): CardScript {
  const requestShadowBanish = (ctx: ScriptCtx, instanceId: number) => {
    ctx.requestCardChoice(
      "gateway-banish",
      decisionPrompt(`${ctx.data.name}: banish the revealed Shadow card?`, "card.mon.shadow.revealed.banish", {
        values: { card: { kind: "card", cardId: ctx.self.cardId } },
        optionMessages: commonOptionMessages("no"),
      }),
      ["no", instanceId],
    );
  };
  const reveal = (ctx: ScriptCtx) => {
    const top = ctx.player(ctx.seat).deck[0];
    if (!top) return;
    const data = ctx.cardData(top.cardId);
    ctx.logPublic(`${ctx.data.name} reveals ${data.name}`);
    const runeblade = hasType(ctx, top, "runeblade");
    const shadow = hasType(ctx, top, "shadow");
    if (runeblade && shadow) ctx.setCounter("gatewayShadowCard", top.instanceId);
    if (runeblade) {
      dealArcane(ctx, opponentSeat(ctx), 1);
      return;
    }
    if (shadow) requestShadowBanish(ctx, top.instanceId);
  };
  return {
    onPlay(ctx) {
      if (ctx.player(ctx.seat).deck.length === 0) return;
      optN(ctx, opt);
    },
    onChoose(ctx, hook, option) {
      if (optOnChoose(ctx, hook, option, () => reveal(ctx))) return;
      if (
        hook === "gateway-banish" &&
        option !== "no" &&
        ctx.player(ctx.seat).deck[0]?.instanceId === Number(option)
      ) ctx.banish(Number(option));
    },
    onDamageDealt(ctx) {
      const instanceId = ctx.getCounter("gatewayShadowCard");
      if (instanceId <= 0) return;
      ctx.setCounter("gatewayShadowCard", 0);
      if (ctx.player(ctx.seat).deck[0]?.instanceId === instanceId) {
        requestShadowBanish(ctx, instanceId);
      }
    },
  };
}

function seepingShadows(maxCost: number): CardScript {
  return bloodDebt({
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 1,
        goAgain: true,
        appliesTo: "attack-action",
        maxCost,
      });
    },
  }, true);
}

function boundingDemigon(): CardScript {
  return bloodDebt({
    canPlay(ctx) {
      const inBanish = ctx.player(ctx.seat).banish.some(
        (card) => card.instanceId === ctx.self.instanceId,
      );
      return !inBanish || ctx.getFlag("player", "playedNonAttackAction") === true;
    },
    modifyAttack(ctx) {
      return ctx.getFlag("link", "fromBanish") === true ? 1 : 0;
    },
  }, true);
}

function piercingShadowVise(): CardScript {
  return bloodDebt({
    modifyAttack(ctx) {
      return ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true ? 2 : 0;
    },
  }, true);
}

function riftBind(): CardScript {
  return bloodDebt({
    modifyAttack(ctx) {
      if (ctx.getFlag("link", "fromBanish") !== true) return 0;
      return Number(ctx.getFlag("player", "nonAttackActionsPlayedThisTurn")) || 0;
    },
  }, true);
}

function riftedTorment(): CardScript {
  return bloodDebt({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("link", "fromBanish") === true) {
        dealArcane(ctx, opponentSeat(ctx), 1);
      }
    },
  }, true);
}

function ripThroughReality(): CardScript {
  return bloodDebt({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true) {
        ctx.grantGoAgain();
      }
    },
  }, true);
}

function seedsOfAgony(maxCost: number): CardScript {
  return bloodDebt({
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesTo: "attack-action",
        maxCost,
      });
    },
    onFriendlyAttackDeclared(ctx) {
      const link = ctx.link;
      if (!link || link.attackCardType !== "action") return;
      if ((ctx.cardData(link.attackingCard.cardId).cost ?? 0) > maxCost) return;
      const modifier = ctx.state.modifiers.find(
        (candidate) =>
          candidate.sourceInstanceId === ctx.self.instanceId &&
          candidate.scope === "until-end-of-turn" &&
          !candidate.consumed,
      );
      if (!modifier) return;
      ctx.consumeModifier(modifier.id);
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  }, true);
}

function howlFromBeyond(attack: number): CardScript {
  return bloodDebt({
    onPlay(ctx) {
      buffNextAttack(ctx, { attack, appliesTo: "attack-action" });
    },
  }, true);
}

function bloodTribute(opt: number): CardScript {
  const banishTop = (ctx: ScriptCtx) => {
    const top = ctx.player(ctx.seat).deck[0];
    if (top) ctx.banish(top.instanceId);
  };
  return {
    onPlay(ctx) {
      if (ctx.player(ctx.seat).deck.length === 0) return;
      optN(ctx, opt);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => banishTop(ctx));
    },
  };
}

function arcanicAttack(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    onAttackDeclared(ctx) {
      dealArcane(ctx, opponentSeat(ctx), damage);
    },
  };
}

function conditionalGoAgain(test: (ctx: ScriptCtx) => boolean): CardScript {
  const grant = (ctx: ScriptCtx) => {
    if (test(ctx)) ctx.grantGoAgain();
  };
  return { onHit: grant, onMiss: grant };
}

function seekHorizon(): CardScript {
  return {
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length === 0) return;
      ctx.requestCardChoice(
        "seek-horizon-top",
        decisionPrompt(`${ctx.data.name}: put a card from your hand on top of your deck for go again?`, "card.mon.hand.top.goagain", {
          values: { card: { kind: "card", cardId: ctx.self.cardId } },
          optionMessages: commonOptionMessages("no"),
        }),
        ["no", ...hand.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "seek-horizon-top" || option === "no") return;
      if (ctx.putOnDeckTop(Number(option))) ctx.setCounter("paidTop", 1);
    },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("paidTop")) ctx.grantGoAgain();
    },
  };
}

function captainsCall(maxCost: number): CardScript {
  return {
    additionalCost(ctx) {
      ctx.requestChoice(
        "captains-call-mode",
        decisionPrompt(`${ctx.data.name}: choose +2{p} or go again for your next qualifying attack`, "card.mon.captainscall.mode", {
          values: { card: { kind: "card", cardId: ctx.self.cardId } },
          optionMessages: {
            power: decisionMessage("card.mon.option.power.two"),
            "go-again": decisionMessage("card.mon.option.goagain"),
          },
        }),
        ["power", "go-again"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "captains-call-mode") ctx.setCounter("captainsCallMode", option === "power" ? 1 : 2);
    },
    onPlay(ctx) {
      const mode = ctx.getCounter("captainsCallMode");
      if (mode <= 0) return;
      buffNextAttack(ctx, {
        appliesTo: "attack-action",
        maxCost,
        ...(mode === 1 ? { attack: 2 } : { goAgain: true }),
      });
    },
  };
}

function minnowism(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack, appliesTo: "attack-action", maxBasePower: 3 });
    },
  };
}

function warmongersRecital(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        onHitBottomDeck: true,
      });
    },
  };
}

function memorialGround(maxCost: number): CardScript {
  const targets = (ctx: ScriptCtx) => ctx.player(ctx.seat).graveyard.filter((card) => {
    const data = ctx.cardData(card.cardId);
    return isAttackAction(ctx, card) && (data.cost ?? 0) <= maxCost;
  });
  return {
    canPlay: (ctx) => targets(ctx).length > 0,
    onPlay(ctx) {
      ctx.requestCardChoice(
        "mon-memorial-ground",
        decisionPrompt(`${ctx.data.name}: put a cost ${maxCost} or less attack action on top of your deck`, "card.mon.attack.top.maxcost", {
          values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: maxCost },
        }),
        targets(ctx).map((card) => card.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "mon-memorial-ground") ctx.putOnDeckTop(Number(option));
    },
  };
}

function rallyTheRearguard(): CardScript {
  return {
    defenseAbility: { discard: 1, oncePerTurn: true },
    onDefendAbility(ctx) {
      ctx.addModifier({ scope: "chain-link", defense: 3 });
      ctx.logPublic(`${ctx.data.name} gets +3{d}`);
    },
  };
}

function belittle(): CardScript {
  const revealable = (ctx: ScriptCtx) => ctx.player(ctx.seat).hand.filter(
    (card) => isAttackAction(ctx, card) && ctx.basePower(card) <= 3,
  );
  return {
    additionalCost(ctx) {
      const cards = revealable(ctx);
      if (cards.length === 0) return;
      ctx.requestCardChoice(
        "belittle-reveal",
        decisionPrompt(`${ctx.data.name}: reveal an attack action with 3 or less base {p}?`, "card.mon.attack.reveal.three", {
          values: { card: { kind: "card", cardId: ctx.self.cardId } },
          optionMessages: commonOptionMessages("no"),
        }),
        ["no", ...cards.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "belittle-reveal") {
        if (option === "no") return;
        const revealed = revealable(ctx).find((card) => card.instanceId === Number(option));
        if (!revealed) return;
        ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(revealed.cardId).name}`);
        const minnows = ctx.player(ctx.seat).deck.filter((card) => isCard(ctx, card.cardId, "Minnowism"));
        if (minnows.length === 0) {
          ctx.shuffleDeck();
          return;
        }
        ctx.requestCardChoice(
          "belittle-search",
          decisionPrompt(`${ctx.data.name}: choose a Minnowism from your deck`, "card.mon.minnowism.choose", {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
          }),
          minnows.map((card) => card.instanceId),
        );
        return;
      }
      if (hook !== "belittle-search") return;
      const found = ctx.player(ctx.seat).deck.find((card) => card.instanceId === Number(option));
      if (found && ctx.moveToHand(found.instanceId)) {
        ctx.logPublic(`${ctx.data.name} finds Minnowism`);
      }
      ctx.shuffleDeck();
    },
  };
}

export const mon: Record<string, CardScript> = mergeSetScripts("MON", monHighRarity, {
  // ── Light Illusionist ───────────────────────────────────────────────────
  "prism|0": {
    activated: {
      cost: 2,
      banishSoulCost: 1,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "instant",
      label: "Banish a soul card: create a Spectral Shield",
      onActivate(ctx) {
        ctx.createToken(SPECTRAL_SHIELD);
      },
    },
  },
  "herald of judgment|2": putAttackIntoSoulOnHit({
    onHit(ctx) {
      if (ctx.link?.targetAllyId !== undefined) return;
      const opponent = ctx.player(opponentSeat(ctx));
      ctx.setCardCounter(
        opponent.hero.instanceId,
        "banishPlayLockedUntilTurn",
        ctx.state.turn + 1,
      );
    },
  }),
  "herald of triumph|1": putAttackIntoSoulOnHit({
    modifyDefendingPower(ctx, defender) {
      return isAttackAction(ctx, defender) ? -1 : 0;
    },
  }),
  "herald of triumph|2": putAttackIntoSoulOnHit({
    modifyDefendingPower(ctx, defender) {
      return isAttackAction(ctx, defender) ? -1 : 0;
    },
  }),
  "herald of triumph|3": putAttackIntoSoulOnHit({
    modifyDefendingPower(ctx, defender) {
      return isAttackAction(ctx, defender) ? -1 : 0;
    },
  }),
  "parable of humility|2": {
    modifyOpposingAttack(ctx, attacking) {
      return isAttackAction(ctx, attacking) ? -1 : 0;
    },
    modifyOpposingPower(ctx, defending) {
      return isAttackAction(ctx, defending) ? -1 : 0;
    },
  },
  "merciful retribution|2": {
    onFriendlyDestroyed(ctx, destroyed) {
      const data = ctx.cardData(destroyed.cardId);
      const aura = hasType(ctx, destroyed, "aura");
      if (!aura && !isAttackAction(ctx, destroyed)) return;
      dealArcane(ctx, opponentSeat(ctx), 1);
      if (data.cardType !== "token" && hasType(ctx, destroyed, "light")) {
        ctx.putIntoSoul(destroyed.instanceId);
      }
    },
  },
  "ode to wrath|2": {
    onFriendlyPlay(ctx, played) {
      if (isAttackAction(ctx, played) && hasType(ctx, played, "illusionist")) {
        ctx.grantCardKeyword(played.instanceId, "go again");
      }
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ctx.loseLife(opponentSeat(ctx), 1);
    },
    onFriendlyDamageDealt(ctx, _source, targetSeat, amount) {
      if (targetSeat !== ctx.seat && amount > 0) ctx.loseLife(targetSeat, 1);
    },
  },
  "herald of protection|1": putAttackIntoSoulOnHit({ onHit: (ctx) => { ctx.createToken(SPECTRAL_SHIELD); } }),
  "herald of protection|2": putAttackIntoSoulOnHit({ onHit: (ctx) => { ctx.createToken(SPECTRAL_SHIELD); } }),
  "herald of protection|3": putAttackIntoSoulOnHit({ onHit: (ctx) => { ctx.createToken(SPECTRAL_SHIELD); } }),
  "herald of ravages|1": putAttackIntoSoulOnHit({ onHit: (ctx) => { dealArcane(ctx, opponentSeat(ctx), 1); } }),
  "herald of ravages|2": putAttackIntoSoulOnHit({ onHit: (ctx) => { dealArcane(ctx, opponentSeat(ctx), 1); } }),
  "herald of ravages|3": putAttackIntoSoulOnHit({ onHit: (ctx) => { dealArcane(ctx, opponentSeat(ctx), 1); } }),
  "herald of rebirth|1": putAttackIntoSoulOnHit({
    onHit(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => hasKeyword(ctx, card.cardId, "phantasm"));
      if (cards.length > 0) ctx.requestCardChoice("herald-rebirth", decisionPrompt(`${ctx.data.name}: put a phantasm card on top?`, "card.mon.phantasm.top", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "herald-rebirth" && option !== "none") ctx.putOnDeckTop(Number(option)); },
  }),
  "herald of rebirth|2": putAttackIntoSoulOnHit({
    onHit(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => hasKeyword(ctx, card.cardId, "phantasm"));
      if (cards.length > 0) ctx.requestCardChoice("herald-rebirth", decisionPrompt(`${ctx.data.name}: put a phantasm card on top?`, "card.mon.phantasm.top", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "herald-rebirth" && option !== "none") ctx.putOnDeckTop(Number(option)); },
  }),
  "herald of rebirth|3": putAttackIntoSoulOnHit({
    onHit(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => hasKeyword(ctx, card.cardId, "phantasm"));
      if (cards.length > 0) ctx.requestCardChoice("herald-rebirth", decisionPrompt(`${ctx.data.name}: put a phantasm card on top?`, "card.mon.phantasm.top", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "herald-rebirth" && option !== "none") ctx.putOnDeckTop(Number(option)); },
  }),
  "herald of tenacity|1": putAttackIntoSoulOnHit(),
  "herald of tenacity|2": putAttackIntoSoulOnHit(),
  "herald of tenacity|3": putAttackIntoSoulOnHit(),
  "wartune herald|1": putAttackIntoSoulOnHit(),
  "wartune herald|2": putAttackIntoSoulOnHit(),
  "wartune herald|3": putAttackIntoSoulOnHit(),

  // ── Light Warrior / Light / Illusionist / Warrior ──────────────────────
  "battlefield blitz|1": { onAttackDeclared(ctx) { if (chargedThisTurn(ctx)) ctx.grantGoAgain(); } },
  "battlefield blitz|2": { onAttackDeclared(ctx) { if (chargedThisTurn(ctx)) ctx.grantGoAgain(); } },
  "battlefield blitz|3": { onAttackDeclared(ctx) { if (chargedThisTurn(ctx)) ctx.grantGoAgain(); } },
  "valiant thrust|1": { modifyAttack: (ctx) => chargedThisTurn(ctx) ? 3 : 0 },
  "valiant thrust|3": { modifyAttack: (ctx) => chargedThisTurn(ctx) ? 3 : 0 },
  "bolt of courage|3": chargeAttack({ canTriggerOnHit: chargedThisTurn, onHit(ctx) { ctx.drawCards(ctx.seat, 1); } }),
  "cross the line|1": chargeAttack(),
  "cross the line|2": chargeAttack(),
  "cross the line|3": chargeAttack(),
  "engulfing light|3": chargeAttack({ canTriggerOnHit: chargedThisTurn, onHit(ctx) { ctx.setFlag("link", "attackToSoul", true); } }),
  "express lightning|1": chargeAttack(),
  "express lightning|2": chargeAttack(),
  "express lightning|3": chargeAttack(),
  "take flight|3": chargeAttack({ onAttackDeclared(ctx) { if (chargedThisTurn(ctx)) ctx.grantGoAgain(); } }),
  "courageous steelhand|2": { onPlay(ctx) { if (chargedThisTurn(ctx)) ctx.addModifier({ scope: "chain-link", attack: 2 }); } },
  "courageous steelhand|3": { onPlay(ctx) { if (chargedThisTurn(ctx)) ctx.addModifier({ scope: "chain-link", attack: 1 }); } },
  "invigorating light|1": invigoratingLight(),
  "invigorating light|2": invigoratingLight(),
  "invigorating light|3": invigoratingLight(),
  "glisten|2": glisten(3),
  "glisten|3": glisten(2),
  "illuminate|2": putAttackIntoSoulOnHit(),
  "illuminate|3": putAttackIntoSoulOnHit(),
  "impenetrable belief|1": { modifyDefense(ctx) { return Number(ctx.getPlayerFlag(opponentSeat(ctx), "banishedThisTurn")) >= 3 ? 2 : 0; } },
  "impenetrable belief|2": { modifyDefense(ctx) { return Number(ctx.getPlayerFlag(opponentSeat(ctx), "banishedThisTurn")) >= 3 ? 2 : 0; } },
  "impenetrable belief|3": { modifyDefense(ctx) { return Number(ctx.getPlayerFlag(opponentSeat(ctx), "banishedThisTurn")) >= 3 ? 2 : 0; } },
  "rising solartide|1": putAttackIntoSoulOnHit(),
  "rising solartide|2": putAttackIntoSoulOnHit(),
  "rising solartide|3": putAttackIntoSoulOnHit(),
  "seek enlightenment|1": nextAttackToSoul(3),
  "seek enlightenment|2": nextAttackToSoul(2),
  "seek enlightenment|3": nextAttackToSoul(1),
  "blinding beam|1": blindingBeam(3),
  "blinding beam|2": blindingBeam(2),
  "blinding beam|3": blindingBeam(1),
  "ray of hope|2": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToTargetType: "shadow" });
      if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0 && hasType(ctx, ctx.player(opponentSeat(ctx)).hero, "shadow")) {
        ctx.putIntoSoul(ctx.self.instanceId);
      }
    },
  },
  "dream weavers|0": {
    activated: {
      cost: 0,
      destroySelfCost: true,
      isAttack: false,
      goAgain: true,
      label: "Next Illusionist attack loses phantasm",
      onActivate(ctx) {
        buffNextAttack(ctx, { appliesTo: "attack-action", appliesToClass: "illusionist", suppressKeyword: "phantasm" });
      },
    },
  },
  "prismatic shield|1": createSpectralShields(3),
  "prismatic shield|2": createSpectralShields(2),
  "prismatic shield|3": createSpectralShields(1),
  "phantasmify|1": phantasmify(5),
  "phantasmify|2": phantasmify(4),
  "phantasmify|3": phantasmify(3),
  "dusk path pilgrimage|1": duskPathPilgrimage(3),
  "dusk path pilgrimage|2": duskPathPilgrimage(2),
  "dusk path pilgrimage|3": duskPathPilgrimage(1),
  "plow through|1": plowThrough(3),
  "plow through|2": plowThrough(2),
  "plow through|3": plowThrough(1),
  "second swing|2": secondSwing(3),
  "second swing|3": secondSwing(2),

  // ── Shadow Brute ───────────────────────────────────────────────────────
  "levia|0": {},
  "hooves of the shadowbeast|0": {
    onCardBanished(ctx, card) {
      if (!isSixPlus(ctx, card)) return;
      const pending = ctx.getCounter("pendingTriggers") + 1;
      ctx.setCounter("pendingTriggers", pending);
      if (pending === 1) {
        ctx.requestChoice("hooves-shadowbeast", yesNoPrompt("Destroy Hooves of the Shadowbeast to gain 1 action point?", "card.mon.hooves.destroy"), ["yes", "no"]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "hooves-shadowbeast") return;
      const remaining = Math.max(0, ctx.getCounter("pendingTriggers") - 1);
      ctx.setCounter("pendingTriggers", remaining);
      if (option === "yes") {
        ctx.destroySelf();
        ctx.gainActionPoint();
      } else if (remaining > 0) {
        ctx.requestChoice("hooves-shadowbeast", yesNoPrompt("Destroy Hooves of the Shadowbeast to gain 1 action point?", "card.mon.hooves.destroy"), ["yes", "no"]);
      }
    },
  },
  "endless maw|1": shadowBruteBanishThree("power"),
  "endless maw|2": shadowBruteBanishThree("power"),
  "endless maw|3": shadowBruteBanishThree("power"),
  "writhing beast hulk|1": shadowBruteBanishThree("dominate"),
  "writhing beast hulk|2": shadowBruteBanishThree("dominate"),
  "writhing beast hulk|3": shadowBruteBanishThree("dominate"),
  "convulsions from the bellows of hell|1": convulsions(3),
  "convulsions from the bellows of hell|2": convulsions(2),
  "convulsions from the bellows of hell|3": convulsions(1),
  "boneyard marauder|1": shadowBruteBanishThree("plain"),
  "boneyard marauder|2": shadowBruteBanishThree("plain"),
  "boneyard marauder|3": shadowBruteBanishThree("plain"),
  "deadwood rumbler|1": bloodDebt({
    onAttackDeclared(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const discarded = ctx.discardRandom(ctx.seat, 1)[0];
      if (!isSixPlus(ctx, discarded)) return;
      const graves = ctx.state.players.flatMap((player) => player.graveyard);
      if (graves.length > 0) ctx.requestCardChoice("deadwood-banish", decisionPrompt(`${ctx.data.name}: banish a card from a graveyard`, "card.mon.graveyard.card.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), graves.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "deadwood-banish") ctx.banish(Number(option)); },
  }),
  "deadwood rumbler|2": bloodDebt({
    onAttackDeclared(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const discarded = ctx.discardRandom(ctx.seat, 1)[0];
      if (!isSixPlus(ctx, discarded)) return;
      const graves = ctx.state.players.flatMap((player) => player.graveyard);
      if (graves.length > 0) ctx.requestCardChoice("deadwood-banish", decisionPrompt(`${ctx.data.name}: banish a card from a graveyard`, "card.mon.graveyard.card.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), graves.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "deadwood-banish") ctx.banish(Number(option)); },
  }),
  "deadwood rumbler|3": bloodDebt({
    onAttackDeclared(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const discarded = ctx.discardRandom(ctx.seat, 1)[0];
      if (!isSixPlus(ctx, discarded)) return;
      const graves = ctx.state.players.flatMap((player) => player.graveyard);
      if (graves.length > 0) ctx.requestCardChoice("deadwood-banish", decisionPrompt(`${ctx.data.name}: banish a card from a graveyard`, "card.mon.graveyard.card.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), graves.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "deadwood-banish") ctx.banish(Number(option)); },
  }),
  "dread screamer|1": shadowBruteBanishThree("go-again"),
  "dread screamer|2": shadowBruteBanishThree("go-again"),
  "dread screamer|3": shadowBruteBanishThree("go-again"),
  "graveling growl|1": bloodDebt({ canPlay: (ctx) => ctx.getFlag("player", "banishedSixPlusThisTurn") === true }),
  "graveling growl|2": bloodDebt({ canPlay: (ctx) => ctx.getFlag("player", "banishedSixPlusThisTurn") === true }),
  "graveling growl|3": bloodDebt({ canPlay: (ctx) => ctx.getFlag("player", "banishedSixPlusThisTurn") === true }),
  "hungering slaughterbeast|1": shadowBruteBanishThree("plain"),
  "hungering slaughterbeast|2": shadowBruteBanishThree("plain"),
  "hungering slaughterbeast|3": shadowBruteBanishThree("plain"),
  "unworldly bellow|1": unworldlyBellow(4),
  "unworldly bellow|2": unworldlyBellow(3),
  "unworldly bellow|3": unworldlyBellow(2),

  // ── Shadow Runeblade ───────────────────────────────────────────────────
  "chane|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Create a Soul Shackle; next Runeblade or Shadow action gains go again",
      onActivate(ctx) {
        ctx.createToken(SOUL_SHACKLE);
        ctx.setFlag("player", "chaneNextActionGoAgain", true);
      },
    },
    onFriendlyPlay(ctx, played) {
      if (ctx.getFlag("player", "chaneNextActionGoAgain") !== true) return;
      if (!ctx.hasCardType(played, "action")) return;
      if (!hasType(ctx, played, "runeblade") && !hasType(ctx, played, "shadow")) return;
      ctx.setFlag("player", "chaneNextActionGoAgain", false);
      ctx.grantCardKeyword(played.instanceId, "go again");
    },
  },
  "soul shackle|0": {
    triggers: [{
      event: "begin-action-phase",
      label: "Banish the top card of your deck",
      effect(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (top) ctx.banish(top.instanceId);
      },
    }],
  },
  "unhallowed rites|1": bloodDebt({
    canPlay(ctx) {
      const inBanish = ctx.player(ctx.seat).banish.some((card) => card.instanceId === ctx.self.instanceId);
      return !inBanish || ctx.getFlag("player", "playedNonAttackAction") === true;
    },
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => {
        return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack") && hasKeyword(ctx, card.cardId, "blood debt");
      });
      if (cards.length > 0) ctx.requestCardChoice("unhallowed-bottom", decisionPrompt(`${ctx.data.name}: put a blood-debt non-attack action on the bottom?`, "card.mon.blooddebt.nonattack.bottom", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "unhallowed-bottom" && option !== "none") ctx.putOnDeckBottom(Number(option)); },
  }, true),
  "unhallowed rites|2": bloodDebt({
    canPlay(ctx) {
      const inBanish = ctx.player(ctx.seat).banish.some((card) => card.instanceId === ctx.self.instanceId);
      return !inBanish || ctx.getFlag("player", "playedNonAttackAction") === true;
    },
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => {
        return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack") && hasKeyword(ctx, card.cardId, "blood debt");
      });
      if (cards.length > 0) ctx.requestCardChoice("unhallowed-bottom", decisionPrompt(`${ctx.data.name}: put a blood-debt non-attack action on the bottom?`, "card.mon.blooddebt.nonattack.bottom", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "unhallowed-bottom" && option !== "none") ctx.putOnDeckBottom(Number(option)); },
  }, true),
  "unhallowed rites|3": bloodDebt({
    canPlay(ctx) {
      const inBanish = ctx.player(ctx.seat).banish.some((card) => card.instanceId === ctx.self.instanceId);
      return !inBanish || ctx.getFlag("player", "playedNonAttackAction") === true;
    },
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => {
        return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack") && hasKeyword(ctx, card.cardId, "blood debt");
      });
      if (cards.length > 0) ctx.requestCardChoice("unhallowed-bottom", decisionPrompt(`${ctx.data.name}: put a blood-debt non-attack action on the bottom?`, "card.mon.blooddebt.nonattack.bottom", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "unhallowed-bottom" && option !== "none") ctx.putOnDeckBottom(Number(option)); },
  }, true),
  "dimenxxional gateway|1": dimenxxionalGateway(3),
  "dimenxxional gateway|2": dimenxxionalGateway(2),
  "dimenxxional gateway|3": dimenxxionalGateway(1),
  "seeping shadows|1": seepingShadows(2),
  "seeping shadows|2": seepingShadows(1),
  "seeping shadows|3": seepingShadows(0),
  "bounding demigon|1": boundingDemigon(),
  "bounding demigon|2": boundingDemigon(),
  "bounding demigon|3": boundingDemigon(),
  "piercing shadow vise|1": piercingShadowVise(),
  "piercing shadow vise|2": piercingShadowVise(),
  "piercing shadow vise|3": piercingShadowVise(),
  "rift bind|1": riftBind(),
  "rift bind|2": riftBind(),
  "rift bind|3": riftBind(),
  "rifted torment|1": riftedTorment(),
  "rifted torment|2": riftedTorment(),
  "rifted torment|3": riftedTorment(),
  "rip through reality|1": ripThroughReality(),
  "rip through reality|2": ripThroughReality(),
  "rip through reality|3": ripThroughReality(),
  "seeds of agony|1": seedsOfAgony(2),
  "seeds of agony|2": seedsOfAgony(1),
  "seeds of agony|3": seedsOfAgony(0),

  // ── Shadow ──────────────────────────────────────────────────────────────
  "ebon fold|0": {
    activated: {
      cost: 1,
      destroySelfCost: true,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      canActivate: (ctx) => ctx.player(ctx.seat).hand.length > 0,
      label: "Banish a hand card; draw if it is Shadow",
      onActivate(ctx) {
        ctx.requestCardChoice("ebon-fold-banish", decisionPrompt(`${ctx.data.name}: banish a card from your hand`, "card.mon.hand.card.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), ctx.player(ctx.seat).hand.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ebon-fold-banish") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      const shadow = hasType(ctx, card, "shadow");
      if (ctx.banish(card.instanceId) && shadow) ctx.drawCards(ctx.seat, 1);
    },
  },
  "consuming aftermath|1": {
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) ctx.requestCardChoice("aftermath-banish", decisionPrompt(`${ctx.data.name}: banish a card from hand?`, "card.mon.hand.card.banish.optional", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("no") }), ["no", ...hand.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aftermath-banish" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (card && hasType(ctx, card, "shadow") && ctx.banish(card.instanceId)) ctx.grantCardKeyword(ctx.self.instanceId, "dominate");
      else if (card) ctx.banish(card.instanceId);
    },
  },
  "consuming aftermath|2": {
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) ctx.requestCardChoice("aftermath-banish", decisionPrompt(`${ctx.data.name}: banish a card from hand?`, "card.mon.hand.card.banish.optional", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("no") }), ["no", ...hand.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aftermath-banish" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      const shadow = hasType(ctx, card, "shadow");
      if (ctx.banish(card.instanceId) && shadow) ctx.grantCardKeyword(ctx.self.instanceId, "dominate");
    },
  },
  "consuming aftermath|3": {
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) ctx.requestCardChoice("aftermath-banish", decisionPrompt(`${ctx.data.name}: banish a card from hand?`, "card.mon.hand.card.banish.optional", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("no") }), ["no", ...hand.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aftermath-banish" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      const shadow = hasType(ctx, card, "shadow");
      if (ctx.banish(card.instanceId) && shadow) ctx.grantCardKeyword(ctx.self.instanceId, "dominate");
    },
  },
  "soul harvest|3": {
    canPlay: (ctx) => ctx.player(ctx.seat).graveyard.length >= 6,
    additionalCost(ctx) {
      ctx.setCounter("harvestRemaining", 6);
      ctx.requestCardChoice("soul-harvest-banish", decisionPrompt(`${ctx.data.name}: choose 6 graveyard cards to banish`, "card.mon.graveyard.cards.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId }, count: 6 } }), ctx.player(ctx.seat).graveyard.map((card) => card.instanceId));
    },
    modifyAttack: (ctx) => ctx.getCounter("harvestBloodDebt"),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const soul = [...ctx.player(opponentSeat(ctx)).soul];
      for (const card of soul) ctx.banish(card.instanceId);
      if (soul.length > 0) ctx.loseLife(opponentSeat(ctx), soul.length);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "soul-harvest-banish") return;
      const card = ctx.player(ctx.seat).graveyard.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      if (hasKeyword(ctx, card.cardId, "blood debt")) ctx.setCounter("harvestBloodDebt", ctx.getCounter("harvestBloodDebt") + 1);
      if (!ctx.banish(card.instanceId)) return;
      const remaining = ctx.getCounter("harvestRemaining") - 1;
      ctx.setCounter("harvestRemaining", remaining);
      if (remaining > 0) ctx.requestCardChoice("soul-harvest-banish", decisionPrompt(`${ctx.data.name}: choose ${remaining} more card(s) to banish`, "card.mon.graveyard.cards.banish.more", { values: { card: { kind: "card", cardId: ctx.self.cardId }, count: remaining } }), ctx.player(ctx.seat).graveyard.map((candidate) => candidate.instanceId));
    },
  },
  "soul reaping|1": {
    alternativePlayCost: { kind: "banish-hand", min: 1 },
    onAlternativeCostPaid(ctx, paidCards) {
      const bloodDebt = paidCards.filter((card) =>
        hasKeyword(ctx, card.cardId, "blood debt"),
      ).length;
      if (bloodDebt > 0) ctx.changeResources(ctx.seat, bloodDebt);
    },
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId === undefined && ctx.player(opponentSeat(ctx)).soul.length > 0) ctx.grantGoAgain();
    },
  },
  "howl from beyond|1": howlFromBeyond(3),
  "howl from beyond|2": howlFromBeyond(2),
  "howl from beyond|3": howlFromBeyond(1),
  "ghostly visit|1": bloodDebt({}, true),
  "ghostly visit|2": bloodDebt({}, true),
  "ghostly visit|3": bloodDebt({}, true),
  "lunartide plunderer|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.setFlag("link", "attackToBanish", true); const soul = ctx.player(opponentSeat(ctx)).soul; if (soul.length > 0) ctx.requestCardChoice("lunartide-soul", decisionPrompt(`${ctx.data.name}: banish a card from the defending hero's soul`, "card.mon.defending.soul.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), soul.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "lunartide-soul") ctx.banish(Number(option)); } },
  "lunartide plunderer|2": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.setFlag("link", "attackToBanish", true); const soul = ctx.player(opponentSeat(ctx)).soul; if (soul.length > 0) ctx.requestCardChoice("lunartide-soul", decisionPrompt(`${ctx.data.name}: banish a card from the defending hero's soul`, "card.mon.defending.soul.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), soul.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "lunartide-soul") ctx.banish(Number(option)); } },
  "lunartide plunderer|3": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.setFlag("link", "attackToBanish", true); const soul = ctx.player(opponentSeat(ctx)).soul; if (soul.length > 0) ctx.requestCardChoice("lunartide-soul", decisionPrompt(`${ctx.data.name}: banish a card from the defending hero's soul`, "card.mon.defending.soul.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), soul.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "lunartide-soul") ctx.banish(Number(option)); } },
  "void wraith|1": bloodDebt({}, true),
  "void wraith|2": bloodDebt({}, true),
  "void wraith|3": bloodDebt({}, true),
  "spew shadow|1": {
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && isAttackAction(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) <= 2);
      ctx.requestCardChoice("spew-shadow", decisionPrompt(`${ctx.data.name}: choose a banished attack action`, "card.mon.banished.attack.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "spew-shadow") return;
      const id = Number(option);
      ctx.allowPlayFrom(id, "banish");
      ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToInstanceId: id, appliesToTargetType: "light" });
    },
  },
  "spew shadow|2": {
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && isAttackAction(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) <= 1);
      ctx.requestCardChoice("spew-shadow", decisionPrompt(`${ctx.data.name}: choose a banished attack action`, "card.mon.banished.attack.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "spew-shadow") return;
      const id = Number(option);
      ctx.allowPlayFrom(id, "banish");
      ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToInstanceId: id, appliesToTargetType: "light" });
    },
  },
  "spew shadow|3": {
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && isAttackAction(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) <= 0);
      ctx.requestCardChoice("spew-shadow", decisionPrompt(`${ctx.data.name}: choose a banished attack action`, "card.mon.banished.attack.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "spew-shadow") return;
      const id = Number(option);
      ctx.allowPlayFrom(id, "banish");
      ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesToInstanceId: id, appliesToTargetType: "light" });
    },
  },
  "blood tribute|1": bloodTribute(3),
  "blood tribute|2": bloodTribute(2),
  "blood tribute|3": bloodTribute(1),
  "eclipse existence|3": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn" });
      if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) > 0) {
        const actions = ctx.player(ctx.seat).graveyard.filter((card) => ctx.hasCardType(card, "action"));
        if (actions.length > 0) ctx.requestCardChoice("eclipse-grave", decisionPrompt(`${ctx.data.name}: banish a graveyard action?`, "card.mon.graveyard.action.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...actions.map((card) => card.instanceId)]);
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && hasType(ctx, ctx.player(opponentSeat(ctx)).hero, "light");
    },
    onHit(ctx) {
      const soul = ctx.player(opponentSeat(ctx)).soul;
      if (soul.length > 0) ctx.requestCardChoice("eclipse-soul", decisionPrompt(`${ctx.data.name}: banish a card from the Light hero's soul?`, "card.mon.light.soul.banish", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...soul.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (option === "none") return;
      if (hook === "eclipse-grave") ctx.banish(Number(option));
      if (hook === "eclipse-soul" && ctx.banish(Number(option))) ctx.loseLife(opponentSeat(ctx), 1);
    },
  },

  // ── Brute / Runeblade / Generic ────────────────────────────────────────
  "pulping|2": {
    onAttackDeclared(ctx) { ctx.drawCards(ctx.seat, 1); if (isSixPlus(ctx, ctx.discardRandom(ctx.seat, 1)[0])) ctx.addModifier({ scope: "chain-link", dominate: true }); },
    ...conditionalGoAgain((ctx) => (ctx.link?.defendingCards.length ?? 0) < 2),
  },
  "pulping|3": {
    onAttackDeclared(ctx) { ctx.drawCards(ctx.seat, 1); if (isSixPlus(ctx, ctx.discardRandom(ctx.seat, 1)[0])) ctx.addModifier({ scope: "chain-link", dominate: true }); },
    ...conditionalGoAgain((ctx) => (ctx.link?.defendingCards.length ?? 0) < 2),
  },
  "aether ironweave|0": {
    activated: {
      cost: 0,
      destroySelfCost: true,
      isAttack: false,
      goAgain: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedSubtype:attack") === true && ctx.getFlag("player", "playedNonAttackAction") === true,
      label: "Destroy after playing attack and non-attack actions: gain 2 resources",
      onActivate(ctx) { ctx.changeResources(ctx.seat, 2); },
    },
  },
  "vexing malice|1": arcanicAttack(2),
  "vexing malice|2": arcanicAttack(2),
  "arcanic crackle|1": arcanicAttack(1),
  "arcanic crackle|2": arcanicAttack(1),
  "arcanic crackle|3": arcanicAttack(1),
  "blood drop brocade|0": {
    activated: {
      cost: 0,
      destroySelfCost: true,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      canActivate: (ctx) => ctx.getFlag("player", "physicalDamageDealtThisTurn") === true || ctx.getFlag("player", "physicalDamageTakenThisTurn") === true,
      label: "Destroy after physical damage: gain 1 resource",
      onActivate(ctx) { ctx.changeResources(ctx.seat, 1); },
    },
  },
  "stubby hammerers|0": {
    activated: {
      cost: 0,
      destroySelfCost: true,
      isAttack: false,
      goAgain: true,
      label: "Attack actions with base 3 or less get +1 this turn",
      onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "attack-action", maxBasePower: 3 }); },
    },
  },
  "time skippers|0": {
    activated: {
      cost: 3,
      destroySelfCost: true,
      isAttack: false,
      goAgain: false,
      label: "Destroy: gain 2 action points",
      onActivate(ctx) { ctx.changeActionPoints(ctx.seat, 2); },
    },
  },
  "ironhide helm|0": ironhideScript(),
  "ironhide plate|0": ironhideScript(),
  "out muscle|1": conditionalGoAgain((ctx) => !(ctx.link?.defendingCards ?? []).some((card) => ctx.currentPower(card) >= ctx.basePower(ctx.self) + ctx.attackBonusAboveBase())),
  "out muscle|2": conditionalGoAgain((ctx) => !(ctx.link?.defendingCards ?? []).some((card) => ctx.currentPower(card) >= ctx.basePower(ctx.self) + ctx.attackBonusAboveBase())),
  "out muscle|3": conditionalGoAgain((ctx) => !(ctx.link?.defendingCards ?? []).some((card) => ctx.currentPower(card) >= ctx.basePower(ctx.self) + ctx.attackBonusAboveBase())),
  "seek horizon|1": seekHorizon(),
  "seek horizon|2": seekHorizon(),
  "seek horizon|3": seekHorizon(),
  "tremor of i'arathael|1": { modifyAttack: (ctx) => Number(ctx.getFlag("player", "banishedThisTurn")) > 0 ? 2 : 0 },
  "tremor of i'arathael|2": { modifyAttack: (ctx) => Number(ctx.getFlag("player", "banishedThisTurn")) > 0 ? 2 : 0 },
  "tremor of i'arathael|3": { modifyAttack: (ctx) => Number(ctx.getFlag("player", "banishedThisTurn")) > 0 ? 2 : 0 },
  "rise above|1": { alternativePlayCost: { kind: "put-hand-card-on-deck-top" } },
  "rise above|2": { alternativePlayCost: { kind: "put-hand-card-on-deck-top" } },
  "rise above|3": { alternativePlayCost: { kind: "put-hand-card-on-deck-top" } },
  "captain's call|1": captainsCall(2),
  "captain's call|2": captainsCall(1),
  "captain's call|3": captainsCall(0),
  "adrenaline rush|1": lessLifePlayTrigger({ attack: 3 }),
  "adrenaline rush|2": lessLifePlayTrigger({ attack: 3 }),
  "adrenaline rush|3": lessLifePlayTrigger({ attack: 3 }),
  "belittle|1": belittle(),
  "belittle|2": belittle(),
  "belittle|3": belittle(),
  "brandish|1": { onHit(ctx) { buffNextAttack(ctx, { attack: 1, appliesTo: "weapon" }); } },
  "brandish|2": { onHit(ctx) { buffNextAttack(ctx, { attack: 1, appliesTo: "weapon" }); } },
  "brandish|3": { onHit(ctx) { buffNextAttack(ctx, { attack: 1, appliesTo: "weapon" }); } },
  "frontline scout|1": {
    onAttackDeclared(ctx) {
      ctx.requestChoice("frontline-look", yesNoPrompt(`${ctx.data.name}: look at the defending hero's hand?`, "card.mon.defending.hand.look", { card: { kind: "card", cardId: ctx.self.cardId } }), ["yes", "no"]);
      if (ctx.getFlag("link", "fromArsenal") === true) ctx.grantGoAgain();
    },
    onChoose(ctx, hook, option) { if (hook === "frontline-look" && option === "yes") for (const card of ctx.player(opponentSeat(ctx)).hand) ctx.lookAt(card.instanceId); },
  },
  "frontline scout|2": {
    onAttackDeclared(ctx) {
      ctx.requestChoice("frontline-look", yesNoPrompt(`${ctx.data.name}: look at the defending hero's hand?`, "card.mon.defending.hand.look", { card: { kind: "card", cardId: ctx.self.cardId } }), ["yes", "no"]);
      if (ctx.getFlag("link", "fromArsenal") === true) ctx.grantGoAgain();
    },
    onChoose(ctx, hook, option) { if (hook === "frontline-look" && option === "yes") for (const card of ctx.player(opponentSeat(ctx)).hand) ctx.lookAt(card.instanceId); },
  },
  "frontline scout|3": {
    onAttackDeclared(ctx) {
      ctx.requestChoice("frontline-look", yesNoPrompt(`${ctx.data.name}: look at the defending hero's hand?`, "card.mon.defending.hand.look", { card: { kind: "card", cardId: ctx.self.cardId } }), ["yes", "no"]);
      if (ctx.getFlag("link", "fromArsenal") === true) ctx.grantGoAgain();
    },
    onChoose(ctx, hook, option) { if (hook === "frontline-look" && option === "yes") for (const card of ctx.player(opponentSeat(ctx)).hand) ctx.lookAt(card.instanceId); },
  },
  "overload|1": { onHit(ctx) { ctx.grantGoAgain(); } },
  "overload|2": { onHit(ctx) { ctx.grantGoAgain(); } },
  "overload|3": { onHit(ctx) { ctx.grantGoAgain(); } },
  "pound for pound|1": lessLifePlayTrigger({ keyword: "dominate" }),
  "pound for pound|2": lessLifePlayTrigger({ keyword: "dominate" }),
  "pound for pound|3": lessLifePlayTrigger({ keyword: "dominate" }),
  "rally the rearguard|1": rallyTheRearguard(),
  "rally the rearguard|2": rallyTheRearguard(),
  "stony woottonhog|1": { modifyAttack: (ctx) => (ctx.link?.defendingCards.length ?? 0) < 2 ? 1 : 0 },
  "stony woottonhog|2": { modifyAttack: (ctx) => (ctx.link?.defendingCards.length ?? 0) < 2 ? 1 : 0 },
  "stony woottonhog|3": { modifyAttack: (ctx) => (ctx.link?.defendingCards.length ?? 0) < 2 ? 1 : 0 },
  "surging militia|1": { modifyAttack: (ctx) => ctx.link?.defendingCards.length ?? 0 },
  "surging militia|2": { modifyAttack: (ctx) => ctx.link?.defendingCards.length ?? 0 },
  "surging militia|3": { modifyAttack: (ctx) => ctx.link?.defendingCards.length ?? 0 },
  "yinti yanti|1": { modifyAttack: (ctx) => ctx.player(ctx.seat).board.some((card) => hasType(ctx, card, "aura")) ? 1 : 0, modifyDefense: (ctx) => ctx.player(ctx.seat).board.some((card) => hasType(ctx, card, "aura")) ? 1 : 0 },
  "yinti yanti|2": { modifyAttack: (ctx) => ctx.player(ctx.seat).board.some((card) => hasType(ctx, card, "aura")) ? 1 : 0, modifyDefense: (ctx) => ctx.player(ctx.seat).board.some((card) => hasType(ctx, card, "aura")) ? 1 : 0 },
  "yinti yanti|3": { modifyAttack: (ctx) => ctx.player(ctx.seat).board.some((card) => hasType(ctx, card, "aura")) ? 1 : 0, modifyDefense: (ctx) => ctx.player(ctx.seat).board.some((card) => hasType(ctx, card, "aura")) ? 1 : 0 },
  "zealous belting|2": { onAttackDeclared(ctx) { const base = ctx.data.attack ?? 0; if (ctx.player(ctx.seat).pitch.some((card) => ctx.basePower(card) > base)) ctx.grantGoAgain(); } },
  "zealous belting|3": { onAttackDeclared(ctx) { const base = ctx.data.attack ?? 0; if (ctx.player(ctx.seat).pitch.some((card) => ctx.basePower(card) > base)) ctx.grantGoAgain(); } },
  "minnowism|1": minnowism(3),
  "minnowism|2": minnowism(2),
  "minnowism|3": minnowism(1),
  "warmonger's recital|1": warmongersRecital(3),
  "warmonger's recital|2": warmongersRecital(2),
  "warmonger's recital|3": warmongersRecital(1),
  "memorial ground|1": memorialGround(2),
  "memorial ground|3": memorialGround(0),
});
