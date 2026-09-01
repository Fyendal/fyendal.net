import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { bloodDebtScript as bloodDebt, buffNextAttack, opponentSeat, weaponAttackCount } from "../shared-helpers.js";

const SPECTRAL_SHIELD = "MON104";
const SOUL_SHACKLE = "MON186";
const BLASMOPHET = "MON219";
const URSUR = "MON220";

function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
}

function weapon(cost: number, extra: CardScript = {}): CardScript {
  return { ...extra, activated: { cost, isAttack: true, goAgain: false, oncePerTurn: true } };
}

function hatchet(otherCode: 1 | 2): CardScript {
  return weapon(1, {
    onAttackDeclared(ctx) {
      if (ctx.getPlayerFlag(ctx.seat, "lastHatchetObservedAttack") !== otherCode) return;
      const key = `hatchetPower:${ctx.self.instanceId}`;
      ctx.setPlayerFlag(ctx.seat, key, Number(ctx.getPlayerFlag(ctx.seat, key)) + 1);
    },
    onFriendlyAttackDeclared(ctx) {
      const attack = ctx.link?.attackingCard;
      if (!attack) return;
      const name = ctx.cardData(attack.cardId).name.trim().toLowerCase();
      ctx.setPlayerFlag(
        ctx.seat,
        "lastHatchetObservedAttack",
        name === "hatchet of body" ? 1 : name === "hatchet of mind" ? 2 : 0,
      );
    },
    modifyAttack(ctx) {
      return Number(ctx.getPlayerFlag(ctx.seat, `hatchetPower:${ctx.self.instanceId}`));
    },
  });
}

function randomDiscardSix(ctx: ScriptCtx): boolean {
  const card = ctx.discardRandom(ctx.seat, 1)[0];
  return !!card && (ctx.basePower(card) >= 6);
}

function requestSoulBanish(ctx: ScriptCtx, hook: string, prompt: string): void {
  ctx.requestCardChoice(hook, prompt, ctx.player(ctx.seat).soul.map((card) => card.instanceId));
}

const beaconOfVictory: CardScript = {
  canPlay: (ctx) => ctx.player(ctx.seat).soul.length > 0,
  additionalCost(ctx) {
    ctx.requestChoice(
      "beacon-x",
      "Choose a nonzero X to banish from soul",
      Array.from({ length: ctx.player(ctx.seat).soul.length }, (_, index) => `x:${index + 1}`),
    );
  },
  onPlay(ctx) {
    const x = ctx.getCounter("beaconX");
    if (x > 0) ctx.addModifier({ scope: "chain-link", attack: x });
    if (ctx.getFlag("player", "chargedThisTurn") !== true) return;
    const cards = ctx.player(ctx.seat).deck.filter((card) => {
      const data = ctx.cardData(card.cardId);
      return ctx.hasCardType(card, "action") && (data.cost ?? 0) <= x;
    });
    if (cards.length) ctx.requestCardChoice("beacon-search", "Search for an action card", cards.map((card) => card.instanceId));
    else ctx.shuffleDeck();
  },
  onChoose(ctx, hook, option) {
    if (hook === "beacon-x") {
      const x = Number(option.slice(2));
      ctx.setCounter("beaconX", x);
      ctx.setCounter("beaconRemaining", x);
      requestSoulBanish(ctx, "beacon-soul", "Choose a soul card to banish");
    } else if (hook === "beacon-soul") {
      if (!ctx.banish(Number(option))) return;
      const remaining = ctx.getCounter("beaconRemaining") - 1;
      ctx.setCounter("beaconRemaining", remaining);
      if (remaining > 0) requestSoulBanish(ctx, "beacon-soul", "Choose another soul card to banish");
    } else if (hook === "beacon-search") {
      const id = Number(option);
      ctx.revealCards([id]);
      ctx.moveToHand(id);
      ctx.shuffleDeck();
    }
  },
};

const celestialCataclysm: CardScript = {
  canPlay: (ctx) => ctx.player(ctx.seat).soul.length >= 3,
  additionalCost(ctx) {
    ctx.setCounter("cataclysmRemaining", 3);
    requestSoulBanish(ctx, "cataclysm-soul", "Choose a soul card to banish");
  },
  onChoose(ctx, hook, option) {
    if (hook !== "cataclysm-soul" || !ctx.banish(Number(option))) return;
    const remaining = ctx.getCounter("cataclysmRemaining") - 1;
    ctx.setCounter("cataclysmRemaining", remaining);
    if (remaining > 0) requestSoulBanish(ctx, "cataclysm-soul", "Choose another soul card to banish");
  },
};

function finishSonata(ctx: ScriptCtx): void {
  ctx.dealDamage(opponentSeat(ctx), ctx.getCounter("sonataChosen"), { arcane: true, sourceInstanceId: ctx.self.instanceId });
  ctx.shuffleDeck();
  ctx.banish(ctx.self.instanceId);
}

function requestSonataAttack(ctx: ScriptCtx): void {
  const attacks = ctx.player(ctx.seat).deck.filter((card) =>
    ctx.getCounter(`sonata:${card.instanceId}`) > 0 && isAttack(ctx, card)
  );
  if (ctx.getCounter("sonataRemaining") <= 0 || attacks.length === 0) {
    finishSonata(ctx);
    return;
  }
  ctx.requestCardChoice("sonata-pick", "Choose a revealed attack action", ["done", ...attacks.map((card) => card.instanceId)]);
}

const sonataArcanix: CardScript = {
  variablePlayCost: { base: 0, resourcesPerX: 2, counterKey: "sonataX", prompt: "Choose X" },
  onPlay(ctx) {
    const revealed = ctx.player(ctx.seat).deck.slice(0, ctx.getCounter("sonataX") + 3);
    ctx.revealCards(revealed.map((card) => card.instanceId));
    for (const card of revealed) ctx.setCounter(`sonata:${card.instanceId}`, 1);
    ctx.setCounter("sonataRemaining", revealed.filter((card) => !isAttack(ctx, card)).length);
    ctx.setCounter("sonataChosen", 0);
    requestSonataAttack(ctx);
  },
  onChoose(ctx, hook, option) {
    if (hook === "sonata-pick") {
      if (option === "done") {
        finishSonata(ctx);
        return;
      }
      const id = Number(option);
      if (ctx.moveToHand(id)) {
        ctx.setCounter(`sonata:${id}`, 0);
        ctx.setCounter("sonataRemaining", ctx.getCounter("sonataRemaining") - 1);
        ctx.setCounter("sonataChosen", ctx.getCounter("sonataChosen") + 1);
      }
      requestSonataAttack(ctx);
    }
  },
};

function rouseRevealOptions(ctx: ScriptCtx): string[] {
  const attacks = ctx.player(ctx.seat).hand.filter((card) => isAttack(ctx, card));
  const options: string[] = [];
  const visit = (index: number, selected: DeepReadonly<CardInstance>[], power: number): void => {
    if (power >= 13) {
      options.push(`reveal:${selected.map((card) => card.instanceId).join(":")}`);
      return;
    }
    for (let i = index; i < attacks.length && options.length < 64; i++) {
      const card = attacks[i]!;
      visit(i + 1, [...selected, card], power + ctx.basePower(card));
    }
  };
  visit(0, [], 0);
  return options;
}

const rouseTheAncients: CardScript = {
  additionalCost(ctx) {
    ctx.suppressCardKeyword(ctx.self.instanceId, "go again");
    const options = rouseRevealOptions(ctx);
    if (options.length) ctx.requestChoice("rouse-reveal", "Reveal attacks with at least 13 total power?", ["no", ...options]);
  },
  modifyAttack: (ctx) => ctx.getCounter("roused") ? 7 : 0,
  onChoose(ctx, hook, option) {
    if (hook !== "rouse-reveal" || option === "no") return;
    const ids = option.split(":").slice(1).map(Number);
    ctx.revealCards(ids);
    ctx.setCounter("roused", 1);
    ctx.grantCardKeyword(ctx.self.instanceId, "go again");
  },
};

export const monHighRarity: Record<string, CardScript> = {
  "great library of solana|0": { global: true, activated: { cost: 0, isAttack: false, goAgain: true, oncePerTurn: false, effectCardCosts: [{ zone: "hand", move: "discard", count: 2, pitch: 2, prompt: "Discard two yellow cards" }], onActivate(ctx) { ctx.destroyGlobal(ctx.self.instanceId); } }, triggers: [{ event: "end-of-turn", whose: "any", label: "Great Library intellect", condition(ctx) { return ctx.player(ctx.seat).pitch.filter((card) => ctx.cardColor(card) === 2).length >= 2; }, effect(ctx) { ctx.setPlayerFlag(ctx.seat, "bonusIntellect", Number(ctx.getPlayerFlag(ctx.seat, "bonusIntellect")) + 1); } }] },
  "prism, sculptor of arc light|0": { activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: false, banishSoulCost: 1, onActivate(ctx) { ctx.createToken(SPECTRAL_SHIELD); } } },
  "luminaris|0": { grantsAuraAttack: { cost: 0, basePower: 1, requiresClass: "illusionist" }, onFriendlyAttackDeclared(ctx) { if (ctx.currentAttackHasType("illusionist") && ctx.player(ctx.seat).pitch.some((card) => ctx.cardColor(card) === 2)) ctx.grantGoAgain(); } },
  "herald of erudition|2": { onHit(ctx) { ctx.setFlag("link", "attackToSoul", true); ctx.drawCards(ctx.seat, 2); } },
  "arc light sentinel|2": { mandatoryAttackTarget: true },
  "genesis|2": { triggers: [{ event: "start-of-turn", optional: true, label: "Put a card from hand into soul?", effect(ctx) { const cards = ctx.player(ctx.seat).hand; if (cards.length) ctx.requestCardChoice("genesis-soul", "Choose a card for your soul", cards.map((card) => card.instanceId)); } }], onChoose(ctx, hook, option) { if (hook !== "genesis-soul") return; const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option)); if (!card || !ctx.putIntoSoul(card.instanceId)) return; if (ctx.cardTypes(card).includes("illusionist")) ctx.createToken(SPECTRAL_SHIELD); if (ctx.cardTypes(card).includes("light")) ctx.drawCards(ctx.seat, 1); } },
  "bolting blade|2": { modifyPlayCost(ctx, base) { return Math.max(0, base - 2 * Number(ctx.getFlag("player", "chargedCountThisTurn"))); } },
  "beacon of victory|2": beaconOfVictory,
  "vestige of sol|0": { replacePitchResources(ctx, pitched, amount) { return ctx.cardTypes(pitched).includes("light") && ctx.player(ctx.seat).soul.length > 0 ? amount + 1 : amount; } },
  "celestial cataclysm|2": celestialCataclysm,
  "soul shield|2": { settlesToSoulOnChainClose: true },
  "soul food|2": { onPlay(ctx) { for (const card of [...ctx.player(ctx.seat).hand]) ctx.putIntoSoul(card.instanceId); ctx.putIntoSoul(ctx.self.instanceId); } },
  "tome of divinity|2": { onPlay(ctx) { ctx.drawCards(ctx.seat, Number(ctx.getFlag("player", "chargedThisTurn")) ? 3 : 2); } },
  "iris of reality|0": { grantsAuraAttack: { cost: 3, basePower: 4, requiresClass: "illusionist", requiresSubtype: "aura", requiresWard: false, goAgain: true } },
  "phantasmal footsteps|0": {
    onDefend(ctx) {
      ctx.requestPayment("footsteps-defense", "Pay 1 to make Phantasmal Footsteps defend for 1?", 1);
      if (!ctx.link) return;
      if (!ctx.cardTypes(ctx.link.attackingCard).includes("illusionist") && ctx.basePower(ctx.link.attackingCard) >= 6) {
        ctx.setFlag("link", `destroyOnClose:${ctx.self.instanceId}`, true);
      }
    },
    onFriendlyAttackLost(ctx, card, cause) {
      if (cause !== "phantasm" || !ctx.cardTypes(card).includes("illusionist")) return;
      if (ctx.getCounter("actionPointTurn") === ctx.state.turn) return;
      ctx.requestPayment("footsteps-action", "Pay 1 to gain an action point?", 1);
    },
    onChoose(ctx, hook, option) {
      if (option !== "paid") return;
      if (hook === "footsteps-defense") ctx.addCardTempDefense(ctx.self.instanceId, 1);
      if (hook === "footsteps-action") {
        ctx.setCounter("actionPointTurn", ctx.state.turn);
        ctx.gainActionPoint();
      }
    },
  },
  "phantasmaclasm|1": { onAttackDeclared(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; for (const card of hand) ctx.lookAt(card.instanceId); if (hand.length) ctx.requestCardChoice("phantasmaclasm-bottom", "Choose a defending hero's card to bottom", hand.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "phantasmaclasm-bottom" && ctx.putOnDeckBottom(Number(option))) ctx.drawCards(opponentSeat(ctx), 1); } },
  "hatchet of body|0": hatchet(2),
  "hatchet of mind|0": hatchet(1),
  "valiant dynamo|0": { triggers: [{ event: "end-of-turn", optional: true, defaultOption: "yes", condition: (ctx) => weaponAttackCount(ctx) >= 2, label: "Recover Valiant Dynamo", effect(ctx) { ctx.addCardDefenseCounters(ctx.self.instanceId, -1); } }] },
  "spill blood|1": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 2, appliesTo: "weapon" }); ctx.addModifier({ scope: "until-end-of-turn", dominate: true, appliesTo: "weapon" }); } },
  "hexagore, the death hydra|0": weapon(2, { onAttackDeclared(ctx) { const blood = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "blood debt")).length; ctx.dealDamage(ctx.seat, Math.max(0, 6 - blood), { sourceInstanceId: ctx.self.instanceId }); } }),
  "deep rooted evil|2": bloodDebt({ canPlay: (ctx) => Number(ctx.getFlag("player", "banishedThisTurn")) >= 6 }, true),
  "mark of the beast|2": bloodDebt({ graveyardReplacement: "banish" }),
  "shadow of blasmophet|1": bloodDebt({ onAttackDeclared(ctx) { ctx.drawCards(ctx.seat, 1); if (randomDiscardSix(ctx)) { const cards = ctx.player(ctx.seat).deck.filter((card) => (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "blood debt")); if (cards.length) ctx.requestCardChoice("blasmophet-search", "Choose a Blood Debt card", cards.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "blasmophet-search" && ctx.banish(Number(option))) ctx.shuffleDeck(); } }),
  "chane, bound by shadow|0": { activated: { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, onActivate(ctx) { ctx.createToken(SOUL_SHACKLE); buffNextAttack(ctx, { goAgain: true, appliesToType: ["runeblade", "shadow"] }); } } },
  "galaxxi black|0": weapon(1, { modifyAttack(ctx) { return ctx.getFlag("player", "playedFromBanishThisTurn") === true ? 2 : 0; }, onHit(ctx) { ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, sourceInstanceId: ctx.self.instanceId }); } }),
  "shadow of ursur|3": bloodDebt({ additionalCost(ctx) { const cards = ctx.player(ctx.seat).hand.filter((card) => (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "blood debt")); if (cards.length) ctx.requestCardChoice("ursur-banish", "Banish a Blood Debt card for go again?", ["no", ...cards.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "ursur-banish" && option !== "no" && ctx.banish(Number(option))) ctx.grantGoAgain(); } }, true),
  "dimenxxional crossroads|2": { triggers: [{ event: "card-played", label: "Deal 1 arcane damage", condition(ctx, played, event) { if (!played || event?.from !== "banish" || !ctx.hasCardType(played, "action")) return false; const kind = ctx.cardTypes(played).includes("attack") ? "attack" : "nonattack"; return !ctx.getCounter(`crossroads:${kind}`); }, onTrigger(ctx, played) { if (!played) return; const kind = ctx.cardTypes(played).includes("attack") ? "attack" : "nonattack"; ctx.setCounter(`crossroads:${kind}`, 1); }, effect(ctx) { ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, sourceInstanceId: ctx.self.instanceId }); } }] },
  "invert existence|3": bloodDebt({ staticPlayableFrom: ["banish"], onPlay(ctx) { const cards = ctx.player(opponentSeat(ctx)).graveyard.slice(0, 2); for (const card of cards) ctx.banish(card.instanceId); const attack = cards.some((card) => isAttack(ctx, card)); const nonattack = cards.some((card) => !isAttack(ctx, card)); if (attack && nonattack) ctx.dealDamage(opponentSeat(ctx), 2, { sourceInstanceId: ctx.self.instanceId }); } }, true),
  "carrion husk|0": bloodDebt({
    onDefend(ctx) {
      ctx.setFlag("link", `banishOnClose:${ctx.self.instanceId}`, true);
    },
    triggers: [{
      event: "start-of-turn",
      label: "Banish Carrion Husk",
      condition: (ctx) => ctx.player(ctx.seat).life <= 13,
      effect(ctx) { ctx.banish(ctx.self.instanceId); },
    }],
  }),
  "doomsday|3": { canPlay: (ctx) => ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "blood debt")).length >= 6, onPlay(ctx) { ctx.createToken(BLASMOPHET); } },
  "eclipse|3": { staticPlayableFrom: ["banish"], canPlay: (ctx) => Number(ctx.getFlag("player", "bloodDebtCardsPlayedThisTurn")) >= 6, onPlay(ctx) { ctx.createToken(URSUR); } },
  "mutated mass|3": bloodDebt({ staticPlayableFrom: ["banish"], modifyAttack(ctx) { return 2 * new Set(ctx.player(ctx.seat).pitch.map((card) => ctx.cardData(card.cardId).cost ?? 0)).size - (ctx.data.attack ?? 0); }, modifyDefense(ctx) { return 2 * new Set(ctx.player(ctx.seat).pitch.map((card) => ctx.cardData(card.cardId).cost ?? 0)).size - (ctx.data.defense ?? 0); } }, true),
  "guardian of the shadowrealm|1": bloodDebt({ activated: { cost: 2, isAttack: false, goAgain: false, fromBanish: true, returnSelfToHandCost: true } }),
  "shadow puppetry|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 1,
        goAgain: true,
        // "If this attack hits, look at the top card of your deck. You may
        // banish it." — routed to onGrantedHit below when the buffed attack hits
        onHitScriptHook: { hook: "shadow-puppetry-hit", label: "look at the top card of your deck and you may banish it" },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "shadow-puppetry-hit") return;
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.lookAt(top.instanceId);
      ctx.requestCardChoice("shadow-puppetry-banish", "Shadow Puppetry: you may banish the top card", ["no", top.instanceId]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "shadow-puppetry-banish" && option !== "no") ctx.banish(Number(option));
    },
  },
  "tome of torment|1": bloodDebt({ onPlay(ctx) { ctx.drawCards(ctx.seat, 1); } }, true),
  "blasmophet, the soul harvester|0": { activated: { cost: 0, isAttack: true, goAgain: false, oncePerTurn: true, onCostPaid(ctx, cards) { ctx.setCounter("shadowDiscarded", cards.some((card) => ctx.cardTypes(card).includes("shadow")) ? 1 : 0); } } },
  "ursur, the soul reaper|0": { activated: { cost: 0, isAttack: true, goAgain: false, oncePerTurn: true }, onAttackDeclared(ctx) { if (ctx.link?.targetAllyId === undefined && ctx.player(opponentSeat(ctx)).soul.length) ctx.grantGoAgain(); } },
  "ravenous meataxe|0": weapon(2, { onAttackDeclared(ctx) { ctx.drawCards(ctx.seat, 1); if (randomDiscardSix(ctx)) ctx.addModifier({ scope: "chain-link", attack: 2 }); } }),
  "tear limb from limb|3": { onPlay(ctx) { ctx.drawCards(ctx.seat, 1); if (randomDiscardSix(ctx)) buffNextAttack(ctx, { attack: 6, appliesToType: ["brute"] }); } },
  "dread scythe|0": weapon(3, { onAttackDeclared(ctx) { ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, sourceInstanceId: ctx.self.instanceId }); } }),
  "sonata arcanix|1": sonataArcanix,
  "exude confidence|1": { defendingHeroCannotRespondBelowPower: true, activated: { cost: 3, isAttack: false, goAgain: false, timing: "attack-reaction", oncePerTurn: false, onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 2 }); } } },
  "nourishing emptiness|1": { onAttackDeclared(ctx) { if (!ctx.player(ctx.seat).graveyard.some((card) => isAttack(ctx, card))) ctx.addModifier({ scope: "chain-link", dominate: true }); }, onHit(ctx) { ctx.setPlayerFlag(ctx.seat, "nextEndPhaseIntellectBonus", 1); } },
  "rouse the ancients|3": rouseTheAncients,
};
