import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  bloodDebtScript as bloodDebt,
  buffNextAttack,
  commonOptionMessages,
  decisionPrompt,
  opponentSeat,
  previousAttackHasName,
  queueIntimidate,
} from "../shared-helpers.js";

const COURAGE = "DTD232";
const EMBODIMENT_LIGHTNING = "DTD195";
const GOLD = "DYN243";
const MIGHT = "SKA035";
const PONDER = "DYN244";
const RUNECHANT = "ROS162";
const SPELLBANE = "DTD235";
const VIGOR = "SBR036";

type Card = DeepReadonly<CardInstance>;

function data(ctx: ScriptCtx, card: Card) { return ctx.cardData(card.cardId); }
function has(ctx: ScriptCtx, card: Card, type: string): boolean {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}
function named(ctx: ScriptCtx, card: Card, name: string): boolean {
  return ctx.cardNames(card).some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}
function isAttack(ctx: ScriptCtx, card: Card): boolean {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function cardIdNamed(ctx: ScriptCtx, name: string): string | undefined { return ctx.cardIdsNamed(name)[0]; }
function swordAttack(ctx: ScriptCtx): boolean {
  return ctx.link?.attackCardType === "weapon" && !!ctx.link && has(ctx, ctx.link.attackingCard, "sword");
}
function attacksAboveBaseControlled(ctx: ScriptCtx, seat: number): number {
  return ctx.state.chain.filter((link) => {
    if (link.attacker !== seat) return false;
    const power = link.resolved ? Number(link.finalAttack ?? 0) : ctx.currentAttackPower();
    return power > ctx.basePower(link.attackingCard);
  }).length;
}
function weapon(cost: number, extra: CardScript = {}): CardScript {
  return { activated: attackAbility(cost), ...extra };
}
function nextWager(power: number): CardScript {
  return {
    onPlay(ctx) { buffNextAttack(ctx, { attack: power, appliesTo: "attack-action" }); ctx.addModifier({ scope: "until-end-of-turn" }); ctx.setCounter("cheat-loss-ready", 1); },
    triggers: [{ event: "attack-declared", label: "Wager with the defending hero", condition: (ctx) => ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"), effect: (ctx) => ctx.wager(opponentSeat(ctx), [GOLD]) }],
    onFriendlyWagerLossReplacement(ctx) {
      if (ctx.getCounter("cheat-loss-ready") <= 0 || ctx.player(ctx.seat).hand.length === 0) return false;
      ctx.setCounter("cheat-loss-ready", 0);
      ctx.requestCardChoice("cheat-wager", decisionPrompt("Discard a card to win the wager instead?", "card.pen.wager.discard.win", { optionMessages: commonOptionMessages("no") }), ["no", ...ctx.player(ctx.seat).hand.map((card) => card.instanceId)]);
      return true;
    },
    onChoose(ctx, hook, option) {
      if (hook !== "cheat-wager") return;
      if (option !== "no" && ctx.discardCard(ctx.seat, Number(option))) {
        ctx.setCounter("wagerWinnerOverride", ctx.seat + 1);
      }
    },
  };
}

function seismicSurges(ctx: ScriptCtx): Card[] {
  return ctx.player(ctx.seat).board.filter(
    (card) => named(ctx, card, "Seismic Surge") && !card.tapped,
  );
}

function seismicAuraTokens(ctx: ScriptCtx): Card[] {
  const chosen = new Set(Array.from(
    { length: ctx.getCounter("seismicTargetsChosen") },
    (_, index) => ctx.getCounter(`seismicTarget:${index}`),
  ));
  return ctx.state.players.flatMap((player) => player.board).filter(
    (card) => has(ctx, card, "aura") && data(ctx, card).cardType === "token" && !chosen.has(card.instanceId),
  );
}

function continueSeismicChoices(ctx: ScriptCtx): void {
  const x = ctx.getCounter("seismicX");
  const surgesChosen = ctx.getCounter("seismicSurgesChosen");
  if (surgesChosen < x) {
    ctx.requestCardChoice(
      "seismic-surge",
      decisionPrompt(`Tap Seismic Surge ${surgesChosen + 1} of ${x}`, "card.pen.seismicsurge.tap", {
        values: { current: surgesChosen + 1, total: x },
      }),
      seismicSurges(ctx).map((card) => card.instanceId),
    );
    return;
  }
  const targetsChosen = ctx.getCounter("seismicTargetsChosen");
  if (targetsChosen < x) {
    ctx.requestCardChoice(
      "seismic-target",
      decisionPrompt(`Choose aura token target ${targetsChosen + 1} of ${x}`, "card.pen.auratoken.target.choose", {
        values: { current: targetsChosen + 1, total: x },
      }),
      seismicAuraTokens(ctx).map((card) => card.instanceId),
    );
  }
}

export const penHighRarity: Record<string, CardScript> = {
  "savage claw|0": weapon(2, { modifyAttack(ctx) { return ctx.player(ctx.seat).pitch.some((card) => (data(ctx, card).attack ?? 0) >= 6) ? 1 : 0; } }),
  "reckless arithmetic|3": {
    onAttackDeclared: (ctx) => ctx.requestDieRoll("reckless", 6),
    onDieRollResolved(ctx, hook, result) { if (hook === "reckless") ctx.addModifier({ scope: "chain-link", attack: result }); },
  },
  "lay down the challenge|2": {
    onPlay(ctx) {
      queueIntimidate(ctx);
      if (ctx.player(opponentSeat(ctx)).hand.length > ctx.player(ctx.seat).hand.length) ctx.drawCards(ctx.seat, 1);
    },
  },
  "shield beater|0": weapon(4, {
    onFriendlyPlay(ctx, played) { if (named(ctx, played, "Visit Anvilheim")) ctx.grantCardKeyword(played.instanceId, "go again"); },
  }),
  "seismic shift|1": {
    additionalCost(ctx) {
      const max = Math.min(seismicSurges(ctx).length, seismicAuraTokens(ctx).length);
      ctx.requestChoice(
        "seismic-x",
        decisionPrompt("Choose X for Seismic Shift", "card.pen.seismicshift.x.choose"),
        Array.from({ length: max + 1 }, (_, x) => String(x)),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "seismic-x") {
        ctx.setCounter("seismicX", Number(option));
        continueSeismicChoices(ctx);
        return;
      }
      if (hook === "seismic-surge") {
        ctx.tap(Number(option));
        ctx.setCounter("seismicSurgesChosen", ctx.getCounter("seismicSurgesChosen") + 1);
        continueSeismicChoices(ctx);
        return;
      }
      if (hook === "seismic-target") {
        const chosen = ctx.getCounter("seismicTargetsChosen");
        ctx.setCounter(`seismicTarget:${chosen}`, Number(option));
        ctx.setCounter("seismicTargetsChosen", chosen + 1);
        continueSeismicChoices(ctx);
      }
    },
    onPlay(ctx) {
      for (let index = 0; index < ctx.getCounter("seismicTargetsChosen"); index++) {
        ctx.destroyPermanent(ctx.getCounter(`seismicTarget:${index}`));
      }
    },
  },
  "sense weakness|3": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 1, dominate: true, appliesToClass: "guardian" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"
      );
    },
    onHit(ctx) {
      const damage = ctx.link?.damage ?? 0;
      for (const ally of ctx.player(opponentSeat(ctx)).board.filter((card) => has(ctx, card, "ally"))) {
        ctx.dealDamage(opponentSeat(ctx), damage, { targetAllyId: ally.instanceId });
      }
    },
  },
  "wind cutter|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", tap: true,
      canActivate: (ctx) => ctx.hitsThisCombatChain(ctx.seat) >= 2,
      onActivate(ctx) {
        const item = ctx.player(ctx.seat).deck.find((card) => has(ctx, card, "shuriken") && has(ctx, card, "item"));
        if (item) ctx.settleCard(item.instanceId); ctx.shuffleDeck();
      },
    },
  },
  "gentle breeze|1": { modifyBasePower(ctx, card, base) { return card.instanceId !== ctx.self.instanceId && isAttack(ctx, card) ? 1 : base; } },
  "tigrine reflex|1": {
    modifyAttack: (ctx) => previousAttackHasName(ctx, "crouching tiger") ? 1 : 0,
    onAttackDeclared(ctx) { if (previousAttackHasName(ctx, "crouching tiger")) ctx.grantGoAgain(); },
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", fromHand: true,
      canActivate: (ctx) => !!ctx.link && ctx.link.attacker === ctx.seat && has(ctx, ctx.link.attackingCard, "ninja"),
      onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); const id = cardIdNamed(ctx, "Crouching Tiger"); if (id) ctx.createCardInHand(id); },
    },
  },
  "templar spellbane|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) {
      ctx.preventNextArcaneDamage(ctx.seat, ctx.getFlag("player", "attackedWithWeaponThisTurn") === true ? 2 : 1);
    } },
  },
  "swordmaster's shine|1": {
    canPlay: (ctx) => swordAttack(ctx),
    modifyPlayCost(ctx, base) { return Math.max(0, base - ctx.player(ctx.seat).weapons.reduce((n, card) => n + Number(card.counters?.power ?? 0), 0)); },
    onPlay: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 5 }),
  },
  "blunten|2": {
    canTriggerOnDefend: (ctx) => ctx.link?.attackCardType === "weapon",
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      const hand = ctx.player(attacker).hand;
      if (hand.length) ctx.requestCardChoice("blunten-discard", decisionPrompt("Discard a card", "card.pen.card.discard"), hand.map((card) => card.instanceId), attacker);
    },
    onChoose(ctx, hook, option) { if (hook === "blunten-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "synapse sparkcap|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true, tap: true,
      effectCardCosts: [{ zone: "hand", move: "banish", count: 1, subtype: "evo", prompt: "Banish an Evo" }],
      onActivate: (ctx) => { ctx.createToken(PONDER); },
    },
  },
  "ghost protocol: architect|1": {
    onBanishedForBoost(ctx) { ctx.allowPlayFrom(ctx.self.instanceId, "banish"); },
    onAttackDeclared(ctx) {
      const equipped = ctx.countEquipped("evo");
      const evos = ctx.player(ctx.seat).deck.filter((card) => has(ctx, card, "evo") && (data(ctx, card).cost ?? 0) <= equipped);
      if (evos.length) {
        ctx.requestCardChoice(
          "ghost-architect-evo",
          decisionPrompt(`Choose an Evo with cost ${equipped} or less`, "card.pen.evo.maxcost.choose", { values: { amount: equipped } }),
          evos.map((card) => card.instanceId),
        );
        return;
      }
      ctx.shuffleDeck();
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ghost-architect-evo") return;
      const equipped = ctx.countEquipped("evo");
      const evo = ctx.player(ctx.seat).deck.find((card) =>
        card.instanceId === Number(option) && has(ctx, card, "evo") && (data(ctx, card).cost ?? 0) <= equipped
      );
      if (evo) ctx.banish(evo.instanceId);
      ctx.shuffleDeck();
    },
  },
  "ghost protocol: mainframe|3": {
    onBanishedForBoost(ctx) { ctx.allowPlayFrom(ctx.self.instanceId, "banish"); },
    modifyAttack(ctx) { return ctx.countEquipped("evo"); },
  },
  "farflight longbow|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "instant", tap: true,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.some((card) => has(ctx, card, "arrow")) && ctx.player(ctx.seat).arsenal.length === 0,
      onActivate(ctx) { const arrows = ctx.player(ctx.seat).hand.filter((card) => has(ctx, card, "arrow")); ctx.requestCardChoice("farflight", decisionPrompt("Put an arrow into arsenal", "card.pen.arrow.arsenal"), arrows.map((card) => card.instanceId)); },
    },
    onChoose(ctx, hook, option) { if (hook === "farflight") ctx.putIntoArsenal(Number(option), "hand", { faceUp: true }); },
  },
  "tiger trap|1": {
    canTriggerOnDefend(ctx) {
      const attacker = ctx.link?.attacker;
      return attacker !== undefined && attacksAboveBaseControlled(ctx, attacker) >= 3;
    },
    onDefend(ctx) {
      if (ctx.link) ctx.setPlayerFlag(ctx.link.attacker, "attacksCannotGainPower", true);
    },
  },
  "rune snare|1": {
    canTriggerOnDefend(ctx) {
      const target = ctx.link?.attacker;
      return target !== undefined && Number(ctx.getPlayerFlag(target, "createdThisTurn")) >= 2;
    },
    onPlay: (ctx) => buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow" }),
    onDefend(ctx) {
      const target = ctx.link?.attacker ?? opponentSeat(ctx);
      const aura = ctx.player(target).board.find((card) => has(ctx, card, "aura")); if (aura) ctx.destroyPermanent(aura.instanceId);
    },
  },
  "grimoire of fellingsong|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate: (ctx) => { ctx.createToken(RUNECHANT); } } },
  "doomsaying|1": { triggers: [{ event: "end-of-turn", label: "Doomsaying", effect(ctx) {
    const x = ctx.getCounter("doom") + 1; ctx.setCounter("doom", x);
    for (const player of ctx.state.players) for (const aura of player.board.filter((card) => has(ctx, card, "aura")).slice(0, x)) ctx.destroyPermanent(aura.instanceId);
  } }] },
  "sigil of gravespawning|3": {
    onCardLeavesGraveyard(ctx, card) { if (has(ctx, card, "aura")) ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true }); },
    triggers: [{ event: "begin-action-phase", label: "Destroy Sigil of Gravespawning", effect: (ctx) => ctx.destroySelf() }],
  },
  "tempest dancers|0": { onLeaveArena(ctx) { ctx.setPlayerFlag(ctx.seat, "nextNonAttackAsInstant", true); } },
  "glyph destruction nodes|2": { arcaneDamageEffect: true, arcaneDamageEffectAmounts: [3], onPlay(ctx) {
    const count = ctx.player(ctx.seat).board.filter((card) => has(ctx, card, "aura") && data(ctx, card).name.includes("Sigil")).length;
    if (count > 0) ctx.dealDamage(opponentSeat(ctx), 3, { arcane: true });
    for (const ally of ctx.player(opponentSeat(ctx)).board.filter((card) => has(ctx, card, "ally")).slice(0, Math.max(0, count - 1))) ctx.dealDamage(opponentSeat(ctx), 3, { arcane: true, targetAllyId: ally.instanceId });
  } },
  "temporal wobble|1": {
    playTargetOptions(ctx) {
      const sigils = ctx.player(ctx.seat).board.filter((card) => has(ctx, card, "aura") && data(ctx, card).name.includes("Sigil")).length;
      return ctx.state.stack.flatMap((layer) => layer.card ? [layer.card] : []).filter((card) => ctx.hasCardType(card, "action") && !has(ctx, card, "attack") && (data(ctx, card).cost ?? 0) < sigils).map((card) => card.instanceId);
    },
    onPlay(ctx) { if (ctx.playTargetInstanceId !== undefined && ctx.negateStackCard(ctx.playTargetInstanceId)) ctx.changeActionPoints(opponentSeat(ctx), 1); },
  },
  "touch of reality|0": {
    activated: { cost: 0, variableCost: { base: 0, counterKey: "wardX", prompt: "Choose ward X" }, isAttack: false, goAgain: false, timing: "instant", tap: true, onActivate: (ctx) => ctx.destroyAtEndPhase(ctx.self.instanceId) },
    wardValue: (ctx) => ctx.getCounter("wardX"),
  },
  "lunar mirage|1": {
    friendlyDefendedTrigger: {
      label: "When an attack action card with 6 or more power defends this",
      condition: (ctx, defenders) => defenders.some((card) => isAttack(ctx, card) && ctx.basePower(card) >= 6),
    },
    onFriendlyDefended(ctx) {
      const source = ctx.link?.defendingCards.find((card) => isAttack(ctx, card) && ctx.basePower(card) >= 6);
      if (source) ctx.becomeCardCopy(ctx.self.instanceId, source.cardId);
    },
  },
  "mind meets might|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) {
    const target = opponentSeat(ctx); const cards = ctx.player(target).hand.filter((card) => ctx.basePower(card) >= 6);
    ctx.revealCards(ctx.player(target).hand.map((card) => card.instanceId), target);
    for (const card of cards) ctx.discardCard(target, card.instanceId); ctx.drawCards(target, cards.length);
  } },
  "graven gaslight|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromGraveyard: true,
    effectCardCosts: [{ zone: "arena", move: "destroy", count: 2, name: "Silver", prompt: "Destroy 2 Silver" }], onActivate(ctx) { ctx.equipFromGraveyard(ctx.self.instanceId); }
  } },
  "lobotomy|1": {
    onAttackDeclared(ctx) { const orbit = (ctx.player(ctx.seat).inventory ?? []).find((card) => data(ctx, card).name.includes("Orbitoclast")); if (orbit) ctx.requestCardChoice("lobotomy-equip", decisionPrompt("Equip an Orbitoclast?", "card.pen.orbitoclast.equip", { optionMessages: commonOptionMessages("no") }), ["no", orbit.instanceId]); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && Object.values(ctx.player(ctx.seat).equipment).some((card) => card && data(ctx, card).name.includes("Orbitoclast")); },
    onHit(ctx) { ctx.suppressHeroAbilitiesThroughNextTurn(opponentSeat(ctx)); },
    onChoose(ctx, hook, option) { if (hook === "lobotomy-equip" && option !== "no") ctx.equipFromInventory(Number(option)); },
  },
  "seeker kunai|1": {
    triggers: [{
      event: "start-of-turn",
      sourceZone: "graveyard",
      optional: true,
      label: "Destroy 2 Silvers to return this to the arena?",
      condition(ctx) {
        return ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Silver")).length >= 2;
      },
      effect(ctx) {
        const silvers = ctx.player(ctx.seat).board
          .filter((card) => named(ctx, card, "Silver"))
          .slice(0, 2);
        if (
          silvers.length === 2 &&
          ctx.destroyPermanent(silvers[0]!.instanceId) &&
          ctx.destroyPermanent(silvers[1]!.instanceId)
        ) {
          ctx.settleCard(ctx.self.instanceId);
        }
      },
    }],
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) =>
        ctx.link?.attacker === ctx.seat && has(ctx, ctx.link.attackingCard, "assassin"),
      onActivate: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 1 }),
    },
  },
  "bone puppetry|0": {
    onDefend(ctx) { const ally = ctx.player(ctx.seat).graveyard.find((card) => has(ctx, card, "ally")); if (ally && ctx.settleCard(ally.instanceId)) { ctx.setCounter("puppet", ally.instanceId); ctx.destroyAtEndPhase(ally.instanceId); } },
    triggers: [{ event: "end-of-turn", label: "Bone Puppetry discard", condition: (ctx) => ctx.getCounter("puppet") > 0, effect(ctx) { for (const card of [...ctx.player(ctx.seat).hand]) ctx.discardCard(ctx.seat, card.instanceId); } }],
  },
  "boo, resident spook|2": { activated: attackAbility(0, { tap: true }), spellvoidValue: (ctx) => ctx.self.tapped ? 0 : 2 },
  "bubba-lubba, run aground|2": {
    onEnterArena: (ctx) => ctx.addCounter(ctx.self.instanceId, "power", 1),
    activated: [
      { ...attackAbility(1, { tap: true })[0]! },
      { cost: 0, isAttack: false, goAgain: true, effectCardCosts: [{ zone: "arena", move: "remove-counter", count: 1, subtype: "ally", counter: { key: "power", amount: 1 }, prompt: "Remove a power counter" }], onActivate(ctx) { const aura = ctx.state.players.flatMap((p) => p.board).find((card) => has(ctx, card, "aura") && has(ctx, card, "token")); if (aura) ctx.destroyPermanent(aura.instanceId); } },
    ],
  },
  "gloves of azure waves|0": { modifyDefense: (ctx) => ctx.player(ctx.seat).pitch.filter((card) => ctx.cardColor(card) === 3).length >= 2 ? 3 : 0 },
  "cheating scoundrel|1": nextWager(3),
  "solforge gauntlet|0": { settlesToSoulOnChainClose: true },
  "blessing of bellona|2": {
    onCardPutIntoSoul: (ctx) => { ctx.createToken(COURAGE); },
    triggers: [{ event: "start-of-turn", label: "Put Blessing of Bellona into soul", effect(ctx) { ctx.putIntoSoul(ctx.self.instanceId); } }],
  },
  "vestige of flagellation|0": { replaceHeroLifeGain(ctx, gainingSeat, amount) {
    if (gainingSeat === ctx.seat) return amount; ctx.loseLife(ctx.seat, amount); ctx.createTokens(VIGOR, amount); return 0;
  } },
  "embalm|2": bloodDebt({ staticPlayableFrom: ["banish"], onPlay(ctx) {
    const attack = ctx.player(ctx.seat).graveyard.find((card) => isAttack(ctx, card) && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "blood debt"));
    if (attack) ctx.putOnDeckBottom(attack.instanceId);
  }, onAttackDeclared(ctx) { if (ctx.getFlag("link", "fromBanish") === true) ctx.grantGoAgain(); } }),
  "elemental strike|1": {
    additionalCost(ctx) { const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("elemental-banish", decisionPrompt("Banish a card", "card.pen.card.banish"), hand.map((card) => card.instanceId)); },
    onChoose(ctx, hook, option) { if (hook !== "elemental-banish") return; const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option)); if (!card || !ctx.banish(card.instanceId)) return; if (has(ctx, card, "earth")) ctx.addModifier({ scope: "chain-link", attack: 2 }); if (has(ctx, card, "lightning")) ctx.grantGoAgain(); if (has(ctx, card, "ice")) ctx.setFlag("link", "dominate", true); },
  },
  "crown of everbloom|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => ctx.player(ctx.seat).arsenal.length > 0, onActivate(ctx) {
    const card = ctx.player(ctx.seat).arsenal[0]; if (card && ctx.putOnDeckBottom(card.instanceId)) { ctx.drawCards(ctx.seat, 1); ctx.createToken(SPELLBANE); }
  } } },
  "channel the skybreaker|2": {
    onEnterArena: (ctx) => ctx.createTokens(MIGHT, 2),
    triggers: [
      { event: "begin-action-phase", label: "Create 2 Might", effect: (ctx) => { ctx.createTokens(MIGHT, 2); } },
      { event: "end-of-turn", label: "Channel Earth", effect(ctx) { const n = ctx.getCounter("flow") + 1; ctx.setCounter("flow", n); const earth = ctx.player(ctx.seat).pitch.filter((card) => has(ctx, card, "earth")).slice(0, n); if (earth.length < n) ctx.destroySelf(); else for (const card of earth) ctx.putOnDeckBottom(card.instanceId); } },
    ],
  },
  "crown of frozen thoughts|0": { onDefend(ctx) { if (ctx.link) ctx.setCardCounter(ctx.player(ctx.link.attacker).hero.instanceId, "frozenUntilTurn", ctx.state.turn + 2); } },
  "channel iceloch glaze|3": { freezesOpposingArsenalConditionally: true, triggers: [{ event: "end-of-turn", label: "Channel Ice", effect(ctx) { const n = ctx.getCounter("flow") + 1; ctx.setCounter("flow", n); const ice = ctx.player(ctx.seat).pitch.filter((card) => has(ctx, card, "ice")).slice(0, n); if (ice.length < n) ctx.destroySelf(); else for (const card of ice) ctx.putOnDeckBottom(card.instanceId); } }] },
  "stormweaver's aegis|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.grantOwnedInstantDiscardPrevention(2); } } },
  "astravolt elemental|1": { onAttackDeclared(ctx) {
    const cards = ctx.player(ctx.seat).hand.filter((card) => ctx.hasCardType(card, "instant")); if (cards.length) ctx.requestCardChoice("astravolt", decisionPrompt("Discard an instant?", "card.pen.instant.discard", { optionMessages: commonOptionMessages("no") }), ["no", ...cards.map((card) => card.instanceId)]);
  }, onChoose(ctx, hook, option) { if (hook === "astravolt" && option !== "no" && ctx.discardCard(ctx.seat, Number(option))) { ctx.drawCards(ctx.seat, 1); ctx.createToken(EMBODIMENT_LIGHTNING); } } },
  "dynastic diadem|0": {
    preventsOpponentDestroyingFriendly: (ctx, target) => named(ctx, target, "Fealty"),
    modifyDefense: (ctx) => ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Fealty")).length >= 3 ? 1 : 0,
  },
  "art of the phoenix: war|1": { additionalCost(ctx) {
    const flame = ctx.player(ctx.seat).hand.find((card) => named(ctx, card, "Phoenix Flame")); if (flame) ctx.discardCard(ctx.seat, flame.instanceId);
  }, onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToType: ["draconic"], appliesTo: "attack-action" }); ctx.drawCards(ctx.seat, 2); } },
  "rippling wave|0": { activated: { cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "defense-reaction", turnsFaceUp: true, canActivate: (ctx) => !!ctx.link, onActivate(ctx) {
    const card = ctx.link?.defendingCards.find((candidate) => ctx.cardColor(candidate) === 3 && isAttack(ctx, candidate)); if (card) ctx.moveToHand(card.instanceId);
  } } },
  "whispering mist|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToPitch: 3 }); ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToKeyword: "ephemeral" }); } },
  "havoc wrap|0": {
    activated: { cost: 0, isAttack: false, goAgain: true, tap: true, onActivate: () => {} },
    modifyFriendlyCardPlayCost(ctx, _card, _zone, base) { return ctx.self.tapped ? Math.max(0, base - 1) : base; },
    preventsUntapOf(ctx, target) { return target.instanceId === ctx.self.instanceId && ctx.self.tapped === true; },
    triggers: [{ event: "start-of-turn", condition: (ctx) => ctx.self.tapped === true, label: "Destroy Havoc Wrap", effect: (ctx) => ctx.destroySelf() }],
  },
  "tome of pandemonium|2": { onPlay(ctx) { for (const player of ctx.state.players) { const top = player.deck[0]; if (top && ctx.banish(top.instanceId)) ctx.allowPlayFrom(top.instanceId, "banish", { forSeat: ctx.seat }); } } },
  "glory plate|0": { modifyDefense: (ctx) => Number(ctx.getFlag("player", "destroyedNameCount:toughness")) },
  "by the book|3": { playAsInstant: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0, prohibitsEffectDrawsDuringActionPhase: true, triggers: [{ event: "begin-action-phase", label: "Destroy By the Book", effect: (ctx) => ctx.destroySelf() }] },
  "two-faced|0": { onDefend(ctx) {
    const attacker = ctx.link?.attacker; if (attacker === undefined) return; ctx.drawCards(attacker, 1); const hand = ctx.player(attacker).hand; for (const card of hand) ctx.lookAt(card.instanceId); if (hand.length) ctx.requestCardChoice("two-faced", decisionPrompt("Choose a card for the attacking hero to discard", "card.pen.attackinghero.card.discard"), hand.map((card) => card.instanceId), ctx.seat);
  }, onChoose(ctx, hook, option) { if (hook === "two-faced") ctx.discardCard(opponentSeat(ctx), Number(option)); } },
  "leave 'em speechless|3": {
    playAsInstant: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) > 0,
    onEnterArena: (ctx) => ctx.requestNameChoice("speechless-name", decisionPrompt("Name a card", "card.pen.card.name")),
    onChoose(ctx, hook, option) { if (hook === "speechless-name") ctx.setChosenName(option); },
    prohibitsChosenName: true,
    triggers: [{ event: "begin-action-phase", label: "Destroy Leave 'Em Speechless", effect: (ctx) => ctx.destroySelf() }],
  },
  "helm of safe haven|0": { onDefend(ctx) {
    const top = ctx.player(ctx.seat).deck[0]; if (!top) return; ctx.revealCards([top.instanceId], ctx.seat); if (isAttack(ctx, top) && ctx.addDefenderFromDeck(top.instanceId)) { const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("safe-discard", decisionPrompt("Discard a card", "card.pen.card.discard"), hand.map((card) => card.instanceId)); }
  }, onChoose(ctx, hook, option) { if (hook === "safe-discard") ctx.discardCard(ctx.seat, Number(option)); } },
  "rockyard rodeo|3": { modifyBasePower(ctx, card, base) { return card.instanceId === ctx.self.instanceId ? Math.max(0, ...ctx.player(ctx.seat).weapons.map((weaponCard) => ctx.basePower(weaponCard))) : base; } },
  "high current currency|3": {
    playTargetOptions(ctx) { return ctx.player(opponentSeat(ctx)).board.filter((card) => !has(ctx, card, "hero") && Number(card.counters?.energy ?? 0) > 0).map((card) => card.instanceId); },
    onPlay(ctx) { const target = ctx.player(opponentSeat(ctx)).board.find((card) => card.instanceId === ctx.playTargetInstanceId); if (!target) return; const n = Number(target.counters?.energy ?? 0); ctx.setCardCounter(target.instanceId, "energy", 0); ctx.createTokens(GOLD, n); },
  },
};
