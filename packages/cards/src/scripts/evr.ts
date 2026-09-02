import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { evrHighRarity } from "./evr/high-rarity.js";
import {
  buffNextAttack,
  commonOptionMessages,
  decisionMessage,
  decisionPrompt,
  discardSixPlusPayoff,
  isCard,
  isWeaponAttack,
  localizedCardLog,
  mergeSetScripts,
  opponentSeat,
  optN,
  optOnChoose,
  previousAttackHasName,
  requestDiscardChoice,
  resolveDiscardChoice,
  wizardActionAsInstant,
  weaponAttackCount,
} from "./shared-helpers.js";

const COPPER = "EVR194";
const SILVER = "EVR195";
const QUICKEN = "EVR196";
const SEISMIC_SURGE = "EVR036";
const RUNECHANT = "EVR119";
const SPECTRAL_SHIELD = "EVR153";

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function isNamed(ctx: ScriptCtx, cardId: string, name: string): boolean {
  return ctx.cardData(cardId).name.toLowerCase() === name.toLowerCase();
}

function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasType(ctx, card, "aura");
}

function auraActivity(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "playedSubtype:aura") === true ||
    ctx.getFlag("player", "createdSubtype:aura") === true;
}

function makeCopies(ctx: ScriptCtx, cardId: string, count: number): void {
  ctx.createTokens(cardId, count);
}

function currentWeaponIsOneHanded(ctx: ScriptCtx): boolean {
  return isWeaponAttack(ctx) && !!ctx.link && hasType(ctx, ctx.link.attackingCard, "1h");
}

function currentWeaponIsSwordOrDagger(ctx: ScriptCtx): boolean {
  return isWeaponAttack(ctx) && !!ctx.link && (
    hasType(ctx, ctx.link.attackingCard, "sword") ||
    hasType(ctx, ctx.link.attackingCard, "dagger")
  );
}

function badBeats(threshold: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.requestDieRoll("bad-beats", 6);
    },
    onDieRollResolved(ctx, hook, roll) {
      if (hook !== "bad-beats") return;
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: rolled ${roll}`, "card.log.common.die.rolled", { result: roll }, { kind: "roll", result: roll, seat: ctx.seat, sides: 6 }));
      if (roll >= threshold) {
        buffNextAttack(ctx, { attack: 5, appliesTo: "attack-action", appliesToClass: "brute" });
      }
    },
  };
}

function highRoller(threshold: number): CardScript {
  return {
    onPlay(ctx) {
      const count = ctx.getFlag("player", `rolledDieAtLeast:${threshold}`) === true ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const pending = Number(ctx.getFlag("player", "pendingIntimidate")) || 0;
        ctx.setFlag("player", "pendingIntimidate", pending + 1);
      }
    },
  };
}

function heaveThree(): CardScript {
  return {
    triggers: [{
      event: "end-of-turn",
      sourceZone: "hand",
      label: "Heave 3",
      condition: (ctx) => ctx.player(ctx.seat).arsenal.length === 0,
      effect(ctx) {
        ctx.requestPayment("heave-three", decisionPrompt(`${ctx.data.name}: pay {r}{r}{r} to put it face up into arsenal?`, "card.evr.heave.pay", { values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: 3 }, optionMessages: commonOptionMessages("no") }), 3);
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "heave-three" || option !== "paid") return;
      if (!ctx.putIntoArsenal(ctx.self.instanceId, "hand")) return;
      makeCopies(ctx, SEISMIC_SURGE, 3);
    },
  };
}

function seismicStir(count: number): CardScript {
  return { onPlay: (ctx) => makeCopies(ctx, SEISMIC_SURGE, count) };
}

function steadfast(amount: number): CardScript {
  return {
    onPlay(ctx) {
      const current = [...ctx.state.chain].reverse().find((link) => !link.resolved);
      const publicSources = ctx.state.players.flatMap((player) => [
        player.hero,
        ...player.weapons,
        ...Object.values(player.equipment).filter((card) => card !== undefined),
        ...player.board,
      ]);
      const options = [...new Map(
        [...(current ? [current.attackingCard] : []), ...publicSources]
          .map((card) => [card.instanceId, card]),
      ).values()];
      if (options.length === 0) return;
      ctx.requestCardChoice(
        "steadfast-source",
        decisionPrompt(`${ctx.data.name}: choose a damage source`, "card.evr.damage.source.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
        options.map((card) => card.instanceId),
      );
      ctx.setCounter("steadfastAmount", amount);
    },
    onChoose(ctx, hook, option) {
      if (hook === "steadfast-source") {
        ctx.preventNextDamage(ctx.seat, ctx.getCounter("steadfastAmount"), Number(option));
      }
    },
  };
}

function hundredWinds(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const chain = ctx.state.chain;
      if (chain.length < 2) return;
      if (!previousAttackHasName(ctx, "hundred winds")) return;
      const bonus = chain.slice(0, -1).filter((link) =>
        link.attacker === ctx.seat &&
        ctx.cardNames(link.attackingCard).includes("hundred winds")
      ).length;
      if (bonus > 0) ctx.addModifier({ scope: "chain-link", attack: bonus });
    },
  };
}

function rideTailwind(): CardScript {
  return {
    onHit(ctx) {
      ctx.addModifier({
        scope: "next-attack",
        appliesTo: "attack-action",
        maxBasePower: 2,
        goAgain: true,
        expiresOnChainClose: true,
      });
    },
  };
}

function twinTwisters(): CardScript {
  return {
    onAttackDeclared(ctx) {
      ctx.requestChoice("twin-mode", decisionPrompt(`${ctx.data.name}: choose a mode`, "card.evr.twin.mode.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: { "next attack": decisionMessage("card.evr.twin.option.next"), "+1": decisionMessage("card.evr.twin.option.power") } }), ["next attack", "+1"]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "twin-mode") return;
      if (option === "+1") ctx.addModifier({ scope: "chain-link", attack: 1 });
      else ctx.setCounter("twinOnHit", 1);
    },
    canTriggerOnHit(ctx) {
      return ctx.getCounter("twinOnHit") > 0;
    },
    onHit(ctx) {
      ctx.addModifier({ scope: "next-attack", attack: 1, expiresOnChainClose: true });
    },
  };
}

function waxOn(): CardScript {
  return {
    modifyDefense(ctx) {
      if (!ctx.link || ctx.link.attackCardType !== "action") return 0;
      return (ctx.cardData(ctx.link.attackingCard.cardId).cost ?? 0) === 0 ? 2 : 0;
    },
  };
}

function sliceAndDice(second: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "weapon" });
    },
    modifyAttack(ctx) {
      if (!currentWeaponIsSwordOrDagger(ctx)) return 0;
      const count = weaponAttackCount(ctx);
      return count === 1 ? 1 : count === 2 ? second : 0;
    },
  };
}

function bladeRunner(amount: number): CardScript {
  return {
    canPlay: currentWeaponIsOneHanded,
    onPlay(ctx) {
      ctx.grantGoAgain();
      buffNextAttack(ctx, { attack: amount, appliesTo: "weapon" });
    },
  };
}

function inTheSwing(amount: number): CardScript {
  return {
    canPlay: (ctx) => isWeaponAttack(ctx) && weaponAttackCount(ctx) >= 2,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: amount });
    },
  };
}

function outlandSkirmish(amount: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: amount, appliesTo: "weapon", appliesToSubtype: "1h" });
      ctx.setCounter("outlandCopper", 1);
      ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "weapon" });
    },
    canTriggerOnHit(ctx) {
      return ctx.getCounter("outlandCopper") > 0 && isWeaponAttack(ctx);
    },
    onHit(ctx) {
      ctx.setCounter("outlandCopper", 0);
      ctx.createToken(COPPER);
    },
  };
}

function boostedLinks(ctx: ScriptCtx): number {
  return ctx.state.chain.filter((link) => link.attacker === ctx.seat && link.flags.boosted === true).length;
}

function payload(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (boostedLinks(ctx) > 0) ctx.addModifier({ scope: "chain-link", dominate: true });
    },
  };
}

function zoomIn(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const count = boostedLinks(ctx);
      if (count > 0) optN(ctx, count);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

function rotaryRam(amount: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: amount, appliesTo: "attack-action", appliesToClass: "mechanologist" });
      if (ctx.getFlag("player", "boostedThisTurn") === true) ctx.putOnDeckBottom(ctx.self.instanceId);
    },
  };
}

function genis(): CardScript {
  return {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      onActivate(ctx) {
        const target = opponentSeat(ctx);
        const hand = ctx.player(target).hand;
        ctx.requestCardChoice(
          "genis-bottom",
          decisionPrompt("Genis: put a card from your hand on the bottom of your deck?", "card.evr.genis.hand.bottom", { optionMessages: commonOptionMessages("decline") }),
          ["decline", ...hand.map((card) => card.instanceId)],
          target,
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "genis-bottom") return;
      const target = opponentSeat(ctx);
      if (option === "decline") {
        ctx.drawCards(ctx.seat, 1);
        return;
      }
      const card = ctx.player(target).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card || !ctx.putOnDeckBottom(card.instanceId)) {
        ctx.drawCards(ctx.seat, 1);
        return;
      }
      ctx.drawCards(target, 1);
      ctx.createToken(SILVER);
    },
  };
}

function releaseTension(amount: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: amount,
        appliesToSubtype: "arrow",
        noDefenseReactionsFromArsenal: true,
      });
    },
  };
}

function readGlidePath(amount: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: amount, appliesToSubtype: "arrow" });
      optN(ctx, 1);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

function fatigueShot(): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const hero = ctx.player(opponentSeat(ctx)).hero;
      ctx.setCardCounter(hero.instanceId, "halveNextAttackActionOnTurn", ctx.state.turn + 1);
    },
  };
}

function timidityPoint(): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const hero = ctx.player(opponentSeat(ctx)).hero;
      ctx.setCardCounter(hero.instanceId, "suppressDominateUntilTurn", ctx.state.turn + 1);
    },
  };
}

function runebloodIncantation(verses: number): CardScript {
  return {
    onEnterArena(ctx) {
      ctx.setCounter("verse", verses);
    },
    triggers: [{
      event: "begin-action-phase",
      label: "Runeblood Incantation",
      effect(ctx) {
        const remaining = ctx.getCounter("verse");
        if (remaining <= 0) {
          ctx.destroySelf();
          return;
        }
        ctx.setCounter("verse", remaining - 1);
        ctx.createToken(RUNECHANT);
      },
    }],
  };
}

function drowningDire(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (auraActivity(ctx)) ctx.addModifier({ scope: "chain-link", dominate: true });
    },
    onHit(ctx) {
      const options = ctx.player(ctx.seat).graveyard.filter((card) => {
        return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack");
      });
      if (options.length === 0) return;
      ctx.requestCardChoice(
        "drowning-bottom",
        decisionPrompt(`${ctx.data.name}: put a non-attack action from your graveyard on the bottom?`, "card.evr.nonattack.bottom", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("pass") }),
        ["pass", ...options.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "drowning-bottom" && option !== "pass") ctx.putOnDeckBottom(Number(option));
    },
  };
}

function reekOfCorruption(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return auraActivity(ctx) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "reek-discard",
          decisionPrompt(`${ctx.data.name}: choose a card to discard`, "card.evr.discard.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
          hand.map((card) => card.instanceId),
          target,
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "reek-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  };
}

function pry(revealCount: number): CardScript {
  const offerBottom = (ctx: ScriptCtx, target: number, ids: number[]) => {
    if (!ctx.revealCards(ids, target)) return;
    ctx.requestCardChoice(
      "pry-bottom",
      decisionPrompt(`${ctx.data.name}: put a revealed card on the bottom of its owner's deck?`, "card.evr.revealed.bottom", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("pass") }),
      ["pass", ...ids],
      undefined,
      ids,
    );
    ctx.setCounter("pryTarget", target);
    ids.forEach((id, index) => ctx.setCounter(`pryRevealed:${index}`, id));
    ctx.setCounter("pryRevealedCount", ids.length);
  };
  const revealNext = (ctx: ScriptCtx, target: number, remaining: number) => {
    const already = Array.from({ length: ctx.getCounter("pryRevealedCount") }, (_, index) =>
      ctx.getCounter(`pryRevealed:${index}`),
    );
    const hand = ctx.player(target).hand.filter((card) => !already.includes(card.instanceId));
    if (remaining <= 0 || hand.length === 0) {
      offerBottom(ctx, target, already);
      return;
    }
    ctx.setCounter("pryRevealRemaining", remaining);
    ctx.requestCardChoice(
      "pry-reveal",
      decisionPrompt(`${ctx.data.name}: choose a card to reveal`, "card.evr.reveal.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
      hand.map((card) => card.instanceId),
      target,
    );
  };
  return {
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      ctx.requestCardChoice(
        "pry-target",
        decisionPrompt(`${ctx.data.name}: choose a hero`, "card.evr.hero.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
        ctx.state.players.map((player) => player.hero.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pry-target") {
        const target = ctx.state.players.find((player) => player.hero.instanceId === Number(option))?.seat;
        if (target === undefined) return;
        ctx.setCounter("pryTarget", target);
        ctx.setCounter("pryRevealedCount", 0);
        const count = ctx.state.activePlayer !== ctx.seat
          ? ctx.player(target).hand.length
          : Math.min(revealCount, ctx.player(target).hand.length);
        revealNext(ctx, target, count);
        return;
      }
      if (hook === "pry-reveal") {
        const target = ctx.getCounter("pryTarget");
        const handCard = ctx.player(target).hand.find((card) => card.instanceId === Number(option));
        if (!handCard) return;
        const index = ctx.getCounter("pryRevealedCount");
        ctx.setCounter(`pryRevealed:${index}`, handCard.instanceId);
        ctx.setCounter("pryRevealedCount", index + 1);
        revealNext(ctx, target, ctx.getCounter("pryRevealRemaining") - 1);
        return;
      }
      if (hook !== "pry-bottom" || option === "pass") return;
      const target = ctx.getCounter("pryTarget");
      const id = Number(option);
      const allowed = Array.from({ length: ctx.getCounter("pryRevealedCount") }, (_, index) =>
        ctx.getCounter(`pryRevealed:${index}`),
      );
      if (!allowed.includes(id) || !ctx.putOnDeckBottom(id)) return;
      ctx.drawCards(target, 1);
    },
  };
}

function pyroglyphic(amount: number): CardScript {
  return {
    playAsInstant: wizardActionAsInstant,
    preventArcaneDamage: amount,
    triggers: [{
      event: "begin-action-phase",
      whose: "subject",
      label: "Destroy Pyroglyphic Protection",
      effect: (ctx) => ctx.destroySelf(),
    }],
  };
}

function timekeepersWhim(amount: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    playAsInstant: wizardActionAsInstant,
    additionalCost(ctx) {
      if (ctx.state.activePlayer !== ctx.seat) ctx.setCounter("whimOpponentTurn", 1);
    },
    onPlay(ctx) {
      ctx.requestCardChoice(
        "whim-target",
        decisionPrompt(`${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to a hero`, "card.evr.arcane.hero.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: ctx.previewArcaneDamage(amount) } }),
        ctx.state.players.map((player) => player.hero.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "whim-target") return;
      const target = ctx.state.players.find((player) => player.hero.instanceId === Number(option))?.seat;
      if (target !== undefined) ctx.dealDamage(target, amount, { arcane: true });
      if (ctx.getCounter("whimOpponentTurn")) ctx.putOnDeckBottom(ctx.self.instanceId);
    },
    graveyardReplacement(ctx) {
      return ctx.getCounter("whimOpponentTurn") ? "bottom-of-deck" : undefined;
    },
  };
}

function hazeBending(): CardScript {
  return {
    onFriendlyDestroyed(ctx, destroyed) {
      const data = ctx.cardData(destroyed.cardId);
      if (
        ctx.getFlag("player", `hazeBending:${ctx.self.instanceId}`) === true ||
        data.cardType === "token" ||
        !hasType(ctx, destroyed, "illusionist") ||
        !isAura(ctx, destroyed)
      ) return;
      ctx.setFlag("player", `hazeBending:${ctx.self.instanceId}`, true);
      ctx.createToken(SPECTRAL_SHIELD);
    },
  };
}

function coalescenceMirage(): CardScript {
  return {
    onDestroyed(ctx) {
      const auras = ctx.player(ctx.seat).hand.filter((card) =>
        hasType(ctx, card, "illusionist") &&
        isAura(ctx, card) &&
        (ctx.cardData(card.cardId).cost ?? 0) === 0,
      );
      if (auras.length > 0) {
        ctx.requestCardChoice(
          "coalescence-aura",
          decisionPrompt(`${ctx.data.name}: put a cost-0 Illusionist aura into the arena?`, "card.evr.illusionist.aura.put", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("pass") }),
          ["pass", ...auras.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "coalescence-aura" && option !== "pass") ctx.settleCard(Number(option));
    },
  };
}

function phantasmalHaze(): CardScript {
  return { onDestroyed: (ctx) => ctx.createToken(SPECTRAL_SHIELD) };
}

function veiledIntentions(amount: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: amount,
        appliesTo: "attack-action",
        grantType: "illusionist",
        grantKeyword: "phantasm",
        onDestroyedDraw: 1,
      });
    },
  };
}

function lifeOfParty(): CardScript {
  return {
    alternativePlayCost: {
      kind: "discard-or-destroy-controlled-named",
      name: "Crazy Brew",
    },
    onAlternativeCostPaid(ctx) {
      ctx.setCounter("partyAlternativeCost", 1);
    },
    onAttackDeclared(ctx) {
      const allModes = ctx.getCounter("partyAlternativeCost") > 0;
      const mode = allModes ? -1 : ctx.randomInt(3);
      if (allModes || mode === 0) {
        ctx.setCounter("lifeOnHit", 1);
        ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: gains "When this hits, gain 2 life"`, "card.log.evr.phantasmaclasm.life", { amount: 2 }));
      }
      if (allModes || mode === 1) {
        ctx.addModifier({ scope: "chain-link", attack: 2 });
        ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: gains +2{p}`, "card.log.common.attack.gained", { amount: 2 }));
      }
      if (allModes || mode === 2) {
        ctx.grantGoAgain();
        ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: gains go again`, "card.log.common.goagain.gained"));
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.getCounter("lifeOnHit") > 0;
    },
    onHit(ctx) {
      ctx.gainLife(ctx.seat, 2);
    },
  };
}

function highStriker(count: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.setCounter("highStriker", count);
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    canTriggerOnHit(ctx) {
      return ctx.getCounter("highStriker") > 0;
    },
    onHit(ctx) {
      const remaining = ctx.getCounter("highStriker");
      ctx.setCounter("highStriker", 0);
      makeCopies(ctx, COPPER, remaining);
    },
  };
}

function pickACard(repeats: number): CardScript {
  return {
    onPlay(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (hand.length === 0) return;
      hand.forEach((card) => ctx.lookAt(card.instanceId));
      const names = [...new Set(hand.map((card) => ctx.cardData(card.cardId).name))];
      ctx.requestChoice("pick-name", decisionPrompt(`${ctx.data.name}: name a card`, "card.evr.card.name", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), names);
      ctx.setCounter("pickRepeats", repeats);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pick-name") return;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      for (let i = 0; i < ctx.getCounter("pickRepeats") && hand.length > 0; i++) {
        const card = hand[ctx.randomInt(hand.length)]!;
        const name = ctx.cardData(card.cardId).name;
        ctx.logPublic(localizedCardLog(
          ctx,
          `${ctx.data.name} reveals ${name}`,
          "card.log.common.card.revealed",
          { revealed: { kind: "card", cardId: card.cardId } },
          { kind: "cards-revealed", cards: [{ cardId: card.cardId, ownerSeat: ctx.seat }], sourceZone: "hand" },
        ));
        if (name === option) ctx.createToken(SILVER);
      }
    },
  };
}

function smashingGoodTime(amount: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.setCounter("smashingReady", 1);
      ctx.addModifier({ scope: "until-end-of-turn" });
      if (ctx.fromArsenal) {
        buffNextAttack(ctx, { attack: amount, appliesTo: "attack-action" });
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.getCounter("smashingReady") > 0 &&
        ctx.link?.attackCardType === "action" &&
        ctx.link.targetAllyId === undefined;
    },
    onHit(ctx) {
      ctx.setCounter("smashingReady", 0);
      const items = ctx.player(opponentSeat(ctx)).board.filter((card) =>
        hasType(ctx, card, "item") && (ctx.cardData(card.cardId).cost ?? 0) <= 2,
      );
      if (items.length > 0) {
        ctx.requestCardChoice(
          "smashing-item",
          decisionPrompt(`${ctx.data.name}: destroy an opposing item with cost 2 or less?`, "card.evr.item.destroy", { values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: 2 }, optionMessages: commonOptionMessages("pass") }),
          ["pass", ...items.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "smashing-item" && option !== "pass") ctx.destroyPermanent(Number(option));
    },
  };
}

function evenBigger(opt: number): CardScript {
  const reveal = (ctx: ScriptCtx) => {
    const top = ctx.player(ctx.seat).deck[0];
    if (!top) return;
    const power = ctx.basePower(top);
    ctx.logPublic(localizedCardLog(
      ctx,
      `${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`,
      "card.log.common.decktop.revealed",
      { revealed: { kind: "card", cardId: top.cardId } },
      { kind: "cards-revealed", cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" },
    ));
    const dealt = Number(ctx.getFlag("player", "physicalDamageAmountDealtThisTurn")) || 0;
    if (power > dealt) {
      ctx.createToken(QUICKEN);
      ctx.drawCards(ctx.seat, 1);
    }
  };
  return {
    canPlay: (ctx) => Number(ctx.getFlag("player", "physicalDamageAmountDealtThisTurn")) > 0,
    onPlay(ctx) {
      if (ctx.player(ctx.seat).deck.length === 0) return;
      optN(ctx, opt);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => reveal(ctx));
    },
  };
}

const amuletAssertiveness: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "attack-reaction",
    destroySelfCost: true,
    canActivate(ctx) {
      return !!ctx.link && ctx.link.attacker === ctx.seat && ctx.player(ctx.seat).hand.length >= 4;
    },
    onActivate(ctx) {
      if (!ctx.link) return;
      ctx.setCounter("assertivenessAttack", ctx.link.attackingCard.instanceId);
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesToInstanceId: ctx.link.attackingCard.instanceId,
      });
    },
  },
  canTriggerOnHit(ctx) {
    return !!ctx.link &&
      ctx.getCounter("assertivenessAttack") === ctx.link.attackingCard.instanceId;
  },
  onHit(ctx) {
    ctx.setCounter("assertivenessAttack", 0);
    const top = ctx.player(ctx.seat).deck[0];
    if (!top || !ctx.banish(top.instanceId)) return;
    if (isAttackAction(ctx, top)) ctx.allowPlayFrom(top.instanceId, "banish");
  },
};

const amuletEchoes: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    canActivate(ctx) {
      return ctx.state.players.some((player) => Object.entries(player.flags).some(
        ([key, value]) => key.startsWith("playedNameCount:") && Number(value) >= 2,
      ));
    },
    onActivate(ctx) {
      const heroes = ctx.state.players.filter((player) => Object.entries(player.flags).some(
        ([key, value]) => key.startsWith("playedNameCount:") && Number(value) >= 2,
      ));
      ctx.requestCardChoice(
        "echoes-target",
        decisionPrompt("Amulet of Echoes: choose a hero to discard 2 cards", "card.evr.echoes.hero.choose", { values: { amount: 2 } }),
        heroes.map((player) => player.hero.instanceId),
      );
    },
  },
  onChoose(ctx, hook, option) {
    if (hook === "echoes-target") {
      const target = ctx.state.players.find((player) => player.hero.instanceId === Number(option));
      if (!target) return;
      ctx.setCounter("echoes-target-seat", target.seat);
      ctx.setCounter("echoes-discards-left", 2);
      requestDiscardChoice(ctx, "echoes-discard", decisionPrompt("Choose a card to discard", "card.common.card.discard.choose"), target.seat);
      return;
    }
    if (hook !== "echoes-discard") return;
    const targetSeat = ctx.getCounter("echoes-target-seat");
    if (!resolveDiscardChoice(ctx, option, targetSeat)) return;
    const left = ctx.getCounter("echoes-discards-left") - 1;
    ctx.setCounter("echoes-discards-left", left);
    if (left > 0) requestDiscardChoice(ctx, "echoes-discard", decisionPrompt("Choose another card to discard", "card.evr.discard.next"), targetSeat);
  },
};

const amuletHavencall: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "defense-reaction",
    destroySelfCost: true,
    canActivate(ctx) {
      return !!ctx.link && ctx.link.attacker !== ctx.seat && ctx.player(ctx.seat).hand.length === 0 &&
        ctx.player(ctx.seat).deck.some((card) => isNamed(ctx, card.cardId, "Rally the Rearguard"));
    },
    onActivate(ctx) {
      const rally = ctx.player(ctx.seat).deck.find((card) => isNamed(ctx, card.cardId, "Rally the Rearguard"));
      if (rally) ctx.addDefenderFromDeck(rally.instanceId);
      ctx.shuffleDeck();
    },
  },
};

const amuletIgnition: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    canActivate(ctx) {
      return ctx.getFlag("player", "playedCardThisTurn") !== true &&
        ctx.getFlag("player", "activatedAbilityThisTurn") !== true;
    },
    onActivate(ctx) {
      ctx.setFlag("player", "nextAbilityCostReduction", 1);
    },
  },
};

const amuletIntervention: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    canActivate(ctx) {
      const incoming = ctx.incomingDamage(ctx.seat);
      return !!incoming && incoming.amount >= ctx.player(ctx.seat).life;
    },
    onActivate(ctx) {
      ctx.preventNextDamage(ctx.seat, 1);
    },
  },
};

const amuletOblation: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    canActivate(ctx) {
      return ctx.getFlag("player", "graveThisTurn") === true &&
        !!ctx.link && ctx.link.attackCardType === "action";
    },
    onActivate(ctx) {
      ctx.setFlag("link", "attackToBottom", true);
    },
  },
};

const clarityPotion: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    onActivate: (ctx) => optN(ctx, 2),
  },
  onChoose(ctx, hook, option) {
    optOnChoose(ctx, hook, option);
  },
};

const healingPotion: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: true,
    destroySelfCost: true,
    onActivate: (ctx) => ctx.gainLife(ctx.seat, 2),
  },
};

const potionSeeing: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    onActivate(ctx) {
      ctx.requestCardChoice(
        "seeing-target",
        decisionPrompt("Potion of Seeing: choose a hero", "card.evr.seeing.hero.choose"),
        ctx.state.players.map((player) => player.hero.instanceId),
      );
    },
  },
  onChoose(ctx, hook, option) {
    if (hook !== "seeing-target") return;
    const target = ctx.state.players.find((player) => player.hero.instanceId === Number(option));
    if (!target) return;
    target.hand.forEach((card) => ctx.lookAt(card.instanceId));
    ctx.logPrivate(ctx.seat, localizedCardLog(
      ctx,
      `Potion of Seeing: ${target.hand.map((card) => ctx.cardData(card.cardId).name).join(", ")}`,
      "card.log.evr.potionseeing.private",
      { cards: target.hand.map((card) => ctx.cardData(card.cardId).name).join(", ") },
      { kind: "cards-revealed", cards: target.hand.map((card) => ({ cardId: card.cardId, ownerSeat: target.seat })), sourceZone: "hand" },
    ));
  },
};

const potionDejaVu: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    onActivate(ctx) {
      const pitch = ctx.player(ctx.seat).pitch;
      if (pitch.length > 0) {
        ctx.requestCardChoice(
          "deja-top",
          decisionPrompt("Potion of Déjà Vu: choose the next pitch card to put on top (the last choice ends on top)", "card.evr.dejavu.pitch.first"),
          pitch.map((card) => card.instanceId),
        );
      }
    },
  },
  onChoose(ctx, hook, option) {
    if (hook !== "deja-top" || !ctx.putOnDeckTop(Number(option))) return;
    const pitch = ctx.player(ctx.seat).pitch;
    if (pitch.length > 0) {
      ctx.requestCardChoice(
        "deja-top",
        decisionPrompt("Choose the next pitch card to put on top (the last choice ends on top)", "card.evr.dejavu.pitch.next"),
        pitch.map((card) => card.instanceId),
      );
    }
  },
};

const potionIronhide: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    onActivate(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", defense: 1, appliesTo: "attack-action" });
    },
  },
};

const potionLuck: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    onActivate(ctx) {
      const player = ctx.player(ctx.seat);
      const cards = [...player.hand, ...player.arsenal];
      for (const card of cards) ctx.putOnDeckBottom(card.instanceId);
      ctx.shuffleDeck();
      ctx.drawCards(ctx.seat, cards.length);
    },
  },
};

const talismanBalance: CardScript = {
  triggers: [{
    event: "end-of-turn",
    label: "Talisman of Balance",
    condition(ctx) {
      const own = ctx.player(ctx.seat).arsenal.length;
      return own === 0 && ctx.state.players.some((player) => player.seat !== ctx.seat && player.arsenal.length > own);
    },
    effect(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      ctx.destroySelf();
      if (top) ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false });
    },
  }],
};

const talismanCremation: CardScript = {
  triggers: [{
    event: "card-played",
    label: "Destroy this and name a card",
    condition: (_ctx, _played, event) => event?.from === "banish",
    effect(ctx) {
    ctx.destroySelf();
    const names = [...new Set(ctx.state.players
      .filter((player) => player.seat !== ctx.seat)
      .flatMap((player) => player.graveyard.map((card) => ctx.cardData(card.cardId).name)))];
    if (names.length > 0) ctx.requestChoice("cremation-name", decisionPrompt("Talisman of Cremation: name a card", "card.evr.cremation.card.name"), names);
    },
  }],
  onChoose(ctx, hook, option) {
    if (hook !== "cremation-name") return;
    for (const player of ctx.state.players) {
      if (player.seat === ctx.seat) continue;
      for (const card of [...player.graveyard]) {
        if (ctx.cardData(card.cardId).name === option) ctx.banish(card.instanceId);
      }
    }
  },
};

const talismanFeatherfoot: CardScript = {
  onFriendlyAttackPowerGained(ctx, amount) {
    if (amount !== 1 || ctx.state.phase !== "reaction" || ctx.link?.attacker !== ctx.seat) return;
    ctx.destroySelf();
    ctx.grantGoAgain();
  },
};

const talismanRecompense: CardScript = {
  replacePitchResources(ctx, _pitched, amount) {
    if (amount !== 1) return undefined;
    ctx.destroySelf();
    ctx.logPublic(localizedCardLog(ctx, "Talisman of Recompense replaces 1 resource with 3 resources", "card.log.evr.recompense.resources", { from: 1, to: 3 }));
    return 3;
  },
};

const talismanTithes: CardScript = {
  replaceOpponentDraw(ctx, _drawingSeat, count) {
    const duringActionPhase =
      ctx.state.phase !== "start" &&
      ctx.state.phase !== "end" &&
      ctx.state.phase !== "game-over";
    if (count <= 0 || ctx.state.activePlayer !== ctx.seat || !duringActionPhase) return undefined;
    ctx.destroySelf();
    ctx.logPublic(localizedCardLog(ctx, `Talisman of Tithes reduces the draw from ${count} to ${Math.max(0, count - 1)}`, "card.log.evr.tithes.draw", { from: count, to: Math.max(0, count - 1) }));
    return count - 1;
  },
};

function destroyAllArsenals(ctx: ScriptCtx): void {
  ctx.destroySelf();
  for (const player of ctx.state.players) {
    for (const card of [...player.arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal");
  }
}

const talismanWarfare: CardScript = {
  onFriendlyDamageDealt(ctx, _source, targetSeat, amount) {
    if (targetSeat !== ctx.seat && amount === 2) destroyAllArsenals(ctx);
  },
  onFriendlyCombatDamageDealt(ctx, _source, targetSeat, amount) {
    if (targetSeat !== ctx.seat && amount === 2) destroyAllArsenals(ctx);
  },
};

const silver: CardScript = {
  activated: {
    cost: 3,
    isAttack: false,
    goAgain: true,
    destroySelfCost: true,
    onActivate: (ctx) => ctx.drawCards(ctx.seat, 1),
  },
};

export const evr: Record<string, CardScript> = mergeSetScripts("EVR", evrHighRarity, {
  "high roller|1": highRoller(4),
  "high roller|2": highRoller(5),
  "high roller|3": highRoller(6),
  "bare fangs|3": discardSixPlusPayoff((ctx) => ctx.addModifier({ scope: "chain-link", attack: 2 })),
  "wild ride|3": discardSixPlusPayoff((ctx) => ctx.grantGoAgain()),
  "bad beats|1": badBeats(4),
  "bad beats|2": badBeats(5),
  "bad beats|3": badBeats(6),

  "valda brightaxe|0": {
    onOpponentDraws(ctx, _drawingSeat, count) {
      if (ctx.state.phase !== "start" && ctx.state.phase !== "end" && ctx.state.phase !== "game-over") {
        makeCopies(ctx, SEISMIC_SURGE, count);
      }
    },
    triggers: [{
      event: "start-of-turn",
      label: "Valda Brightaxe",
      condition(ctx) {
        return ctx.player(ctx.seat).board.filter((card) => isCard(ctx, card.cardId, "Seismic Surge")).length >= 3;
      },
      effect(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          dominate: true,
          appliesToKeyword: "crush",
        });
      },
    }],
  },
  "thunder quake|1": heaveThree(),
  "thunder quake|2": heaveThree(),
  "seismic stir|1": seismicStir(3),
  "seismic stir|2": seismicStir(2),
  "seismic stir|3": seismicStir(1),
  "steadfast|1": steadfast(6),
  "steadfast|2": steadfast(5),
  "steadfast|3": steadfast(4),

  "hundred winds|1": hundredWinds(),
  "hundred winds|2": hundredWinds(),
  "hundred winds|3": hundredWinds(),
  "ride the tailwind|1": rideTailwind(),
  "ride the tailwind|2": rideTailwind(),
  "ride the tailwind|3": rideTailwind(),
  "twin twisters|1": twinTwisters(),
  "twin twisters|2": twinTwisters(),
  "twin twisters|3": twinTwisters(),
  "wax on|2": waxOn(),
  "wax on|3": waxOn(),

  "slice and dice|1": sliceAndDice(3),
  "slice and dice|3": sliceAndDice(1),
  "blade runner|1": bladeRunner(3),
  "blade runner|2": bladeRunner(2),
  "blade runner|3": bladeRunner(1),
  "in the swing|2": inTheSwing(2),
  "in the swing|3": inTheSwing(1),
  "outland skirmish|1": outlandSkirmish(3),
  "outland skirmish|2": outlandSkirmish(2),
  "outland skirmish|3": outlandSkirmish(1),

  "t-bone|1": { onAttackDeclared(ctx) { if (boostedLinks(ctx) > 0) ctx.setFlag("link", "mustDefendWithEquipment", true); } },
  "t-bone|2": { onAttackDeclared(ctx) { if (boostedLinks(ctx) > 0) ctx.setFlag("link", "mustDefendWithEquipment", true); } },
  "t-bone|3": { onAttackDeclared(ctx) { if (boostedLinks(ctx) > 0) ctx.setFlag("link", "mustDefendWithEquipment", true); } },
  "payload|1": payload(),
  "payload|2": payload(),
  "payload|3": payload(),
  "zoom in|1": zoomIn(),
  "zoom in|2": zoomIn(),
  "zoom in|3": zoomIn(),
  "rotary ram|1": rotaryRam(3),
  "rotary ram|2": rotaryRam(2),
  "rotary ram|3": rotaryRam(1),
  "genis wotchuneed|0": genis(),

  "release the tension|2": releaseTension(2),
  "release the tension|3": releaseTension(1),
  "fatigue shot|1": fatigueShot(),
  "fatigue shot|2": fatigueShot(),
  "fatigue shot|3": fatigueShot(),
  "timidity point|1": timidityPoint(),
  "timidity point|2": timidityPoint(),
  "timidity point|3": timidityPoint(),
  "read the glide path|2": readGlidePath(2),
  "read the glide path|3": readGlidePath(1),

  "runeblood incantation|1": runebloodIncantation(3),
  "runeblood incantation|2": runebloodIncantation(2),
  "runeblood incantation|3": runebloodIncantation(1),
  "drowning dire|1": drowningDire(),
  "drowning dire|2": drowningDire(),
  "drowning dire|3": drowningDire(),
  "reek of corruption|1": reekOfCorruption(),
  "reek of corruption|2": reekOfCorruption(),
  "reek of corruption|3": reekOfCorruption(),

  "pry|1": pry(3),
  "pry|2": pry(2),
  "pry|3": pry(1),
  "pyroglyphic protection|1": pyroglyphic(3),
  "pyroglyphic protection|2": pyroglyphic(2),
  "timekeeper's whim|1": timekeepersWhim(5),
  "timekeeper's whim|2": timekeepersWhim(4),
  "timekeeper's whim|3": timekeepersWhim(3),

  "haze bending|3": hazeBending(),
  "passing mirage|3": {
    onFriendlyPlay(ctx, played) {
      if (!isAttackAction(ctx, played) || !hasType(ctx, played, "illusionist")) return;
      const key = `passingMirage:${ctx.self.instanceId}`;
      if (ctx.getFlag("player", key) === true) return;
      ctx.setFlag("player", key, true);
      ctx.suppressCardKeyword(played.instanceId, "phantasm");
    },
  },
  "pierce reality|3": {
    onFriendlyPlay(ctx, played) {
      if (!isAttackAction(ctx, played) || !hasType(ctx, played, "illusionist")) return;
      const key = `pierceReality:${ctx.self.instanceId}`;
      if (ctx.getFlag("player", key) === true) return;
      ctx.setFlag("player", key, true);
      ctx.addCardTempPower(played.instanceId, 2);
    },
  },
  "coalescence mirage|1": coalescenceMirage(),
  "coalescence mirage|2": coalescenceMirage(),
  "coalescence mirage|3": coalescenceMirage(),
  "phantasmal haze|1": phantasmalHaze(),
  "phantasmal haze|2": phantasmalHaze(),
  "veiled intentions|1": veiledIntentions(4),
  "veiled intentions|2": veiledIntentions(3),
  "veiled intentions|3": veiledIntentions(2),

  "life of the party|1": lifeOfParty(),
  "life of the party|2": lifeOfParty(),
  "life of the party|3": lifeOfParty(),
  "high striker|1": highStriker(6),
  "high striker|2": highStriker(4),
  "high striker|3": highStriker(2),
  "pick a card, any card|1": pickACard(3),
  "pick a card, any card|2": pickACard(2),
  "pick a card, any card|3": pickACard(1),
  "smashing good time|1": smashingGoodTime(3),
  "smashing good time|2": smashingGoodTime(2),
  "smashing good time|3": smashingGoodTime(1),
  "even bigger than that!|1": evenBigger(3),
  "even bigger than that!|2": evenBigger(2),
  "even bigger than that!|3": evenBigger(1),

  "amulet of assertiveness|2": amuletAssertiveness,
  "amulet of echoes|3": amuletEchoes,
  "amulet of havencall|3": amuletHavencall,
  "amulet of ignition|2": amuletIgnition,
  "amulet of intervention|3": amuletIntervention,
  "amulet of oblation|3": amuletOblation,
  "clarity potion|3": clarityPotion,
  "healing potion|3": healingPotion,
  "potion of seeing|3": potionSeeing,
  "potion of déjà vu|3": potionDejaVu,
  "potion of ironhide|3": potionIronhide,
  "potion of luck|3": potionLuck,
  "talisman of balance|3": talismanBalance,
  "talisman of cremation|3": talismanCremation,
  "talisman of featherfoot|2": talismanFeatherfoot,
  "talisman of recompense|2": talismanRecompense,
  "talisman of tithes|3": talismanTithes,
  "talisman of warfare|2": talismanWarfare,
  "silver|0": silver,
});
