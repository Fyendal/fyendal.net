import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, contractWithSilver, dealArcane, opponentSeat, previousAttackHasName } from "../shared-helpers.js";

const CROUCHING_TIGER = "DYN065";
const SILVER = "DYN245";
const PONDER = "DYN244";

function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean { return ctx.cardTypes(card).includes(type); }
function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean { return ctx.cardData(card.cardId).name.toLowerCase() === name; }
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean { return ctx.hasCardType(card, "action") && has(ctx, card, "attack"); }
function weapon(cost: number, extra: CardScript = {}): CardScript {
  const base = { cost, isAttack: true, goAgain: false, oncePerTurn: true } as const;
  const activated = extra.activated;
  return {
    ...extra,
    activated: !activated || Array.isArray(activated)
      ? (activated ?? base)
      : { ...base, ...activated },
  };
}
function discardChoice(ctx: ScriptCtx, hook: string, seat = opponentSeat(ctx)): void { const hand = ctx.player(seat).hand; if (hand.length) ctx.requestCardChoice(hook, "Choose a card to discard", hand.map((card) => card.instanceId), seat); }
function arcane(amount: number, extra?: (ctx: ScriptCtx, dealt: number) => void): CardScript { return { arcaneDamageEffect: true, onPlay(ctx) { const dealt = dealArcane(ctx, opponentSeat(ctx), amount); extra?.(ctx, dealt); } }; }
function graveyardAssassinEquipment(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    triggers: [{
      event: "start-of-turn", whose: "subject", sourceZone: "graveyard", optional: true,
      condition(ctx) { return ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "silver")).length >= 2; },
      label: "Destroy 2 Silvers to equip this?",
      effect(ctx) {
        const silvers = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "silver")).slice(0, 2);
        if (silvers.length === 2 && silvers.every((card) => ctx.destroyPermanent(card.instanceId))) ctx.equipFromGraveyard(ctx.self.instanceId);
      },
    }],
  };
}
function typedPermanents(ctx: ScriptCtx, seat: number, type: string): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) => has(ctx, card, type));
}
function advanceDiabolic(ctx: ScriptCtx, stage: "ally" | "aura", seat: number): void {
  if (seat > 1) {
    if (stage === "ally" && ctx.getCounter("diabolicAura") > 0) return advanceDiabolic(ctx, "aura", 0);
    for (const type of ["ally", "aura"] as const) for (const targetSeat of [0, 1]) {
      const id = ctx.getCounter(`diabolic:${type}:${targetSeat}`);
      if (id > 0) ctx.destroyPermanent(id);
    }
    return;
  }
  const cards = typedPermanents(ctx, seat, stage);
  if (!cards.length) return advanceDiabolic(ctx, stage, seat + 1);
  ctx.requestCardChoice(`diabolic:${stage}:${seat}`, `Choose a ${stage} to destroy`, cards.map((card) => card.instanceId), seat);
}
function warhornPermanents(ctx: ScriptCtx, seat: number): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) => ["ally", "aura", "item", "landmark"].some((type) => has(ctx, card, type)));
}
function finishHarpoonReveal(ctx: ScriptCtx): void {
  const x = ctx.getCounter("harpoonX");
  const ids = Array.from({ length: x }, (_, index) => ctx.getCounter(`harpoonReveal:${index}`)).filter((id) => id > 0);
  if (!ctx.revealCards(ids, opponentSeat(ctx))) return;
  const hand = ctx.player(opponentSeat(ctx)).hand;
  const actions = ids.flatMap((id) => { const card = hand.find((candidate) => candidate.instanceId === id); return card && ctx.hasCardType(card, "action") && (ctx.cardData(card.cardId).defense ?? 99) <= x ? [card] : []; });
  if (ids.length) {
    ctx.requestCardChoice(
      "harpoon-defender",
      actions.length ? "Choose a revealed action card to defend" : "No revealed cards can defend",
      actions.length ? actions.map((card) => card.instanceId) : ["Close"],
      undefined,
      ids,
    );
  }
}
function requestBrainstormTarget(ctx: ScriptCtx): void {
  const allies = ctx.state.players.flatMap((player) => player.board.filter((card) => has(ctx, card, "ally")));
  ctx.requestChoice("brainstorm-target", `Choose a target for ${ctx.previewArcaneDamage(1)} arcane damage`, ["hero:0", "hero:1", ...allies.map((card) => `ally:${card.instanceId}`)]);
}
function advanceWarhorn(ctx: ScriptCtx, afterSeat: number): void {
  const next = [0, 1].find((target) => target > afterSeat && (ctx.getCounter("warhornMask") & (1 << target)) !== 0 && warhornPermanents(ctx, target).length > 0);
  if (next !== undefined) {
    ctx.requestCardChoice(`warhorn:${next}`, "Choose a permanent to destroy", warhornPermanents(ctx, next).map((card) => card.instanceId), has(ctx, ctx.player(ctx.seat).hero, "royal") ? ctx.seat : next);
    return;
  }
  for (const target of [0, 1]) { const id = ctx.getCounter(`warhornChoice:${target}`); if (id) ctx.destroyPermanent(id); }
}

export const dynHighRarity: Record<string, CardScript> = {
  "dust from the golden plains|1": { materialKeywords: ["phantasm"] },
  "dust from the red desert|1": { materialKeywords: ["phantasm"] },
  "dust from the shadow crypts|1": { materialKeywords: ["phantasm"] },
  "rok|0": weapon(3, { activated: { cost: 3, isAttack: true, goAgain: false, oncePerTurn: true, canActivate: (ctx) => ctx.player(ctx.seat).hand.length === 0 }, onAttackDeclared(ctx) { ctx.setFlag("link", "unpreventable", true); } }),
  "skull crack|1": {
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Gain 1 resource",
      condition: (ctx, discarded, eventContext) =>
        eventContext?.atRandom === true && discarded?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.changeResources(ctx.seat, 1),
    }],
  },
  "berserk|2": {
    onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); },
    triggers: [{
      event: "card-discarded",
      label: "Banish the discarded card",
      condition: (ctx, discarded, eventContext) =>
        eventContext?.atRandom === true && !!discarded && ctx.basePower(discarded) >= 6,
      effect(ctx, discarded) {
        if (
          !discarded ||
          !ctx.player(discarded.owner).graveyard.some(
            (card) => card.instanceId === discarded.instanceId,
          ) ||
          !ctx.banish(discarded.instanceId)
        ) return;
        const top = ctx.player(ctx.seat).deck[0];
        if (top) {
          ctx.revealCards([top.instanceId]);
          if (ctx.basePower(top) >= 6) ctx.drawCards(ctx.seat, 1);
        }
      },
    }],
  },
  "seasoned saviour|0": { onGameStart(ctx) { ctx.addCounter(ctx.self.instanceId, "defense", -2); } },
  "buckle|3": { onPlay(ctx) { buffNextAttack(ctx, { attack: 1, dominate: true, appliesToType: ["guardian"] }); } },
  "never yield|3": { triggers: [{ event: "start-of-turn", whose: "subject", label: "Destroy Never Yield", effect(ctx) { ctx.destroySelf(); if (!ctx.player(ctx.seat).hand.length) ctx.drawCards(ctx.seat, 1); if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) ctx.gainLife(ctx.seat, 2); } }] },
  "blazen yoroi|0": { modifyDefense(ctx) { return ctx.currentChainLinkNumber() >= 4 ? 4 : 0; } },
  "tiger swipe|1": { modifyAttack: (ctx) => previousAttackHasName(ctx, "crouching tiger") ? 2 : 0, onAttackDeclared(ctx) { if (previousAttackHasName(ctx, "crouching tiger")) ctx.grantGoAgain(); }, canTriggerOnHit(ctx) { return previousAttackHasName(ctx, "crouching tiger"); }, onHit(ctx) { const count = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "crouching tiger")).length; for (let i = 0; i < count; i++) { const tiger = ctx.createToken(CROUCHING_TIGER); if (tiger) ctx.banish(tiger.instanceId); } } },
  "mindstate of tiger|3": { triggers: [{ event: "start-of-turn", whose: "subject", label: "Create Crouching Tiger", effect(ctx) { ctx.destroySelf(); ctx.createCardInHand(CROUCHING_TIGER); } }] },
  "roar of the tiger|2": { onPlay(ctx) { ctx.createCardInHand(CROUCHING_TIGER); ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToName: "Crouching Tiger" }); } },
  "spirit of eirina|2": { replacesSoulMoveWithArena: true, allowsFriendlyCardPlayAsInstant(ctx, card) { return named(ctx, card, "lumina ascension"); } },
  "jubeel, spellbane|0": weapon(1, { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined && !ctx.player(ctx.seat).board.some((card) => named(ctx, card, "spellbane aegis")), onHit(ctx) { ctx.createToken("DYN246"); } }),
  "merciless battleaxe|0": weapon(3, { onAttackDeclared(ctx) { if ((ctx.link?.attackingCard.tempPower ?? 0) + (ctx.data.attack ?? 0) > 2 * (ctx.data.attack ?? 0)) ctx.setFlag("link", "overpower", true); } }),
  "cleave|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "axe" }); },
    canTriggerOnHit(ctx) { return ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"); },
    onHit(ctx) { const allies = typedPermanents(ctx, opponentSeat(ctx), "ally").filter((card) => card.instanceId !== ctx.link?.targetAllyId); if (allies.length && (ctx.link?.damage ?? 0) > 0) { ctx.setCounter("cleaveDamage", ctx.link!.damage); ctx.requestCardChoice("cleave-ally", "Deal the hit damage to another ally?", ["no", ...allies.map((card) => card.instanceId)]); } },
    onChoose(ctx, hook, option) { if (hook === "cleave-ally" && option !== "no") ctx.dealDamage(opponentSeat(ctx), ctx.getCounter("cleaveDamage"), { targetAllyId: Number(option) }); },
  },
  "ironsong pride|1": { onEnterArena(ctx) { const swords = ctx.player(ctx.seat).weapons.filter((card) => has(ctx, card, "sword")); if (swords.length) ctx.addCounter(swords[0]!.instanceId, "power", 1); }, onLeaveArena(ctx) { for (const sword of ctx.player(ctx.seat).weapons.filter((card) => has(ctx, card, "sword"))) ctx.setCardCounter(sword.instanceId, "power", 0); } },
  "hanabi blaster|0": { activated: { cost: 0, isAttack: true, goAgain: false, oncePerTurn: true, removeCounterCost: { key: "steam", amount: 2 } }, triggers: [{ event: "card-played", label: "Put a steam counter on Hanabi Blaster", condition: (ctx, played) => !!played && (ctx.cardData(played.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "boost") && Number(ctx.getFlag("player", "playedKeywordCount:boost")) === 3, effect(ctx) { ctx.addCounter(ctx.self.instanceId, "steam", 1); } }], onAttackDeclared(ctx) { ctx.setFlag("link", "overpower", true); } },
  "pulsewave harpoon|1": {
    onAttackDeclared(ctx) { const x = Math.min(Number(ctx.getFlag("player", "boostCountThisTurn")), ctx.player(opponentSeat(ctx)).hand.length); ctx.setCounter("harpoonX", x); if (x <= 0) return; const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length === x) { hand.forEach((card, index) => ctx.setCardCounter(ctx.self.instanceId, `harpoonReveal:${index}`, card.instanceId)); finishHarpoonReveal(ctx); } else ctx.requestCardChoice("harpoon-reveal:0", "Choose a card to reveal", hand.map((card) => card.instanceId), opponentSeat(ctx)); },
    onChoose(ctx, hook, option) { if (hook === "harpoon-defender") { if (option !== "Close") ctx.addDefenderFromHand(Number(option)); return; } if (!hook.startsWith("harpoon-reveal:")) return; const index = Number(hook.split(":")[1]); ctx.setCardCounter(ctx.self.instanceId, `harpoonReveal:${index}`, Number(option)); if (index + 1 >= ctx.getCounter("harpoonX")) { finishHarpoonReveal(ctx); return; } const selected = new Set(Array.from({ length: index + 1 }, (_, i) => ctx.getCounter(`harpoonReveal:${i}`))); const hand = ctx.player(opponentSeat(ctx)).hand.filter((card) => !selected.has(card.instanceId)); ctx.requestCardChoice(`harpoon-reveal:${index + 1}`, "Choose another card to reveal", hand.map((card) => card.instanceId), opponentSeat(ctx)); },
  },
  "bios update|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToType: ["mechanologist"] }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    triggers: [{
      event: "card-banished-for-boost",
      label: "Bios Update — put the banished item into the arena",
      condition(ctx, card) {
        const marker = ctx.state.modifiers.find(
          (modifier) =>
            modifier.sourceInstanceId === ctx.self.instanceId &&
            modifier.scope === "until-end-of-turn" &&
            !modifier.consumed,
        );
        return !!marker && !!card &&
          has(ctx, card, "mechanologist") &&
          has(ctx, card, "item") &&
          (ctx.cardData(card.cardId).cost ?? 99) <= 2;
      },
      onTrigger(ctx) {
        const marker = ctx.state.modifiers.find(
          (modifier) =>
            modifier.sourceInstanceId === ctx.self.instanceId &&
            modifier.scope === "until-end-of-turn" &&
            !modifier.consumed,
        );
        if (marker) ctx.consumeModifier(marker.id);
      },
      effect(ctx, triggeredCard) {
        const item = triggeredCard && ctx.player(ctx.seat).banish.find(
          (card) => card.instanceId === triggeredCard.instanceId,
        );
        if (
          item &&
          has(ctx, item, "mechanologist") &&
          has(ctx, item, "item") &&
          (ctx.cardData(item.cardId).cost ?? 99) <= 2
        ) ctx.settleCard(item.instanceId);
      },
    }],
  },
  "construct nitro mechanoid|2": { onPlay(ctx) { const equipment = ["head", "chest", "arms", "legs"].flatMap((slot) => { const card = ctx.player(ctx.seat).equipment[slot as "head" | "chest" | "arms" | "legs"]; return card && has(ctx, card, "mechanologist") ? [card] : []; }); const weaponCard = ctx.player(ctx.seat).weapons.find((card) => has(ctx, card, "mechanologist")); const drivers = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "hyper driver")).slice(0, 3); if (equipment.length === 4 && weaponCard && drivers.length === 3) ctx.transformInto("DYN092B", [...equipment, weaponCard, ...drivers].map((card) => card.instanceId)); } },
  "nitro mechanoid|0": { activated: { cost: 0, isAttack: true, goAgain: false, oncePerTurn: true, destroySubcardCost: true }, onAttackDeclared(ctx) { ctx.setFlag("link", "overpower", true); } },
  "plasma mainline|1": { onEnterArena(ctx) { ctx.addCounter(ctx.self.instanceId, "steam", 5); }, onFriendlyEnterArena(ctx, card) { if (!has(ctx, card, "mechanologist") || !has(ctx, card, "item") || (ctx.cardData(card.cardId).cost ?? 99) > 2 || ctx.getCounter("steam") <= 0) return; ctx.addCounter(ctx.self.instanceId, "steam", -1); ctx.addCounter(card.instanceId, "steam", 1); } },
  "powder keg|3": {
    onFriendlyCombatDamageDealt(ctx, source, target, amount) {
      const sourceTypes = ctx.cardTypes(source);
      const isGun = has(ctx, source, "gun") || (
        ctx.cardData(source.cardId).cardType === "weapon" &&
        sourceTypes.includes("mechanologist") &&
        sourceTypes.includes("pistol")
      );
      if (target === ctx.seat || amount <= 0 || !isGun) return;
      const equipment = ctx.link?.defendingEquipment ?? [];
      if (equipment.length) ctx.requestCardChoice("powder-keg-equipment", "Choose defending equipment to destroy", equipment.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "powder-keg-equipment") return;
      const equipmentId = Number(option);
      if (ctx.destroyPermanent(equipmentId)) {
        ctx.setFlag("link", `equipmentGone:${equipmentId}`, true);
        ctx.destroySelf();
      }
    },
  },
  "arakni, huntsman|0": {
    triggers: [{
      event: "card-played",
      label: "Look at the opponent's top card?",
      optional: true,
      defaultOption: "yes",
      condition: (ctx, played) => !!played &&
        (ctx.cardData(played.cardId).keywords ?? []).some(
          (keyword) => keyword.toLowerCase() === "contract",
        ),
      effect(ctx) {
        const top = ctx.player(opponentSeat(ctx)).deck[0];
        if (!top) return;
        ctx.lookAt(top.instanceId);
        ctx.setCounter("arakniTop", top.instanceId);
        ctx.requestChoice(
          "arakni-top",
          "Put the looked-at card on the bottom?",
          ["bottom", "keep"],
        );
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "arakni-top" && option === "bottom") {
        ctx.putOnDeckBottom(ctx.getCounter("arakniTop"));
      }
    },
  },
  "blacktek whisperers|0": graveyardAssassinEquipment({ activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => !!ctx.link && has(ctx, ctx.link.attackingCard, "assassin"), onActivate(ctx) { ctx.addModifier({ scope: "chain-link", onHitGoAgain: true }); } } }),
  "mask of perdition|0": graveyardAssassinEquipment({ activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => ctx.link?.attackCardType === "action" && has(ctx, ctx.link.attackingCard, "assassin"), onActivate(ctx) { ctx.addModifier({ scope: "chain-link" }); } }, canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"), onHit(ctx) { const top = ctx.player(opponentSeat(ctx)).deck[0]; if (top) ctx.banish(top.instanceId); } }),
  "eradicate|2": { ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 2), canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const count = Math.max(0, ctx.currentAttackPower()); for (const card of ctx.player(opponentSeat(ctx)).deck.slice(0, count)) ctx.banish(card.instanceId); } },
  "leave no witnesses|1": { ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 1), canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { const opp = ctx.player(opponentSeat(ctx)); const top = opp.deck[0]; if (top) ctx.banish(top.instanceId); const arsenal = opp.arsenal[0]; if (arsenal) { ctx.setCardFaceDown(arsenal.instanceId, false); ctx.banish(arsenal.instanceId); } } },
  "regicide|3": { canBeDefendedBy(ctx, defending) { const names = new Set(ctx.player(opponentSeat(ctx)).banish.filter((card) => !card.faceDown).flatMap((card) => ctx.cardNames(card))); return !ctx.cardNames(defending).some((name) => names.has(name)); }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && has(ctx, ctx.player(opponentSeat(ctx)).hero, "royal"); }, onHit(ctx) { ctx.loseGame(opponentSeat(ctx)); }, onCombatChainClosed(ctx) { ctx.loseGame(ctx.seat); } },
  "surgical extraction|3": {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 3),
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; },
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      const top = opponent.deck[0];
      if (top) ctx.banish(top.instanceId);
      for (const card of opponent.hand) ctx.lookAt(card.instanceId);
      if (opponent.hand.length) ctx.requestCardChoice("surgical-hand", "Choose an opposing hand card to banish", opponent.hand.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "surgical-hand") ctx.banish(Number(option)); },
  },
  "pay day|3": { canPlay: (ctx) => ctx.getFlag("player", "completedContractThisTurn") === true, onPlay(ctx) { ctx.createTokens(SILVER, 4); } },
  "sandscour greatbow|0": { activated: { cost: 1, isAttack: false, goAgain: true, oncePerTurn: true, onActivate(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.lookAt(top.instanceId); const cards = [...ctx.player(ctx.seat).hand, ...ctx.player(ctx.seat).deck.slice(0, 1)].filter((card) => has(ctx, card, "arrow")); if (cards.length) ctx.requestCardChoice("sandscour-load", "Put an arrow face up in arsenal", ["no", ...cards.map((card) => card.instanceId)]); } }, onChoose(ctx, hook, option) { if (hook !== "sandscour-load" || option === "no") return; const from = ctx.player(ctx.seat).hand.some((card) => card.instanceId === Number(option)) ? "hand" : "deck"; if (ctx.putIntoArsenal(Number(option), from, { faceUp: true }) && from === "deck") ctx.addCounter(Number(option), "aim", 1); } },
  "heat seeker|1": { onHit(ctx) { ctx.setCounter("heatSeekerEndTurn", ctx.state.turn); }, triggers: [{ event: "end-of-turn", whose: "subject", sourceZone: "graveyard", condition: (ctx) => ctx.getCounter("heatSeekerEndTurn") === ctx.state.turn, label: "Put the top card face up into arsenal", effect(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: true }); ctx.setCounter("heatSeekerEndTurn", 0); } }] },
  "immobilizing shot|1": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getCounter("aim") > 0; }, onHit(ctx) { const target = opponentSeat(ctx); ctx.addModifier({ scope: "until-end-of-turn", seat: target, attackActionCardCap: 1, nonAttackActionCardCap: 1, expiresAtEndOfSeatTurn: target }); } },
  "dead eye|2": {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 3,
        appliesToSubtype: "arrow",
        // "If it has an aim counter, it gains 'When this hits a hero, look at
        // their hand and choose a card. They discard it.'"
        onHitScriptHook: { hook: "dead-eye-hit", label: "look at their hand and choose a card for them to discard", heroOnly: true, requiresAttackCounter: "aim" },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "dead-eye-hit") return;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      for (const card of hand) ctx.lookAt(card.instanceId);
      if (hand.length) ctx.requestCardChoice("dead-eye-discard", "Dead Eye: choose a card — they discard it", hand.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook === "dead-eye-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  },
  "amethyst tiara|0": { grantsSpellvoidToRunechants: true, activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); } } },
  "cryptic crossing|2": { onPlayCostPaid(ctx, cards) { ctx.setCounter("mixedPitch", cards.some((card) => isAttack(ctx, card)) && cards.some((card) => !isAttack(ctx, card) && ctx.hasCardType(card, "action")) ? 1 : 0); }, onDealsDamage(ctx, target, amount) { if (!ctx.getCounter("mixedPitch") || target === ctx.seat || amount <= 0) return; discardChoice(ctx, "cryptic-discard", target); ctx.drawCards(ctx.seat, 1); }, onChoose(ctx, hook, option) { if (hook === "cryptic-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); } },
  "diabolic ultimatum|1": { onPlayCostPaid(ctx, cards) { ctx.setCounter("diabolicAlly", cards.some(isAttack.bind(undefined, ctx)) ? 1 : 0); ctx.setCounter("diabolicAura", cards.some((card) => ctx.hasCardType(card, "action") && !has(ctx, card, "attack")) ? 1 : 0); }, onPlay(ctx) { if (ctx.getCounter("diabolicAlly") > 0) advanceDiabolic(ctx, "ally", 0); else if (ctx.getCounter("diabolicAura") > 0) advanceDiabolic(ctx, "aura", 0); }, onChoose(ctx, hook, option) { if (!hook.startsWith("diabolic:")) return; const [, stage, seatText] = hook.split(":"); ctx.setCardCounter(ctx.self.instanceId, hook, Number(option)); advanceDiabolic(ctx, stage as "ally" | "aura", Number(seatText) + 1); } },
  "looming doom|3": { onEnterArena(ctx) { const runechants = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "runechant")); for (const card of runechants) ctx.destroyPermanent(card.instanceId); ctx.addCounter(ctx.self.instanceId, "doom", runechants.length); }, triggers: [{ event: "end-of-turn", label: "Resolve Looming Doom", effect(ctx) { if (ctx.getCounter("doom") <= 0) { ctx.destroySelf(); return; } ctx.addCounter(ctx.self.instanceId, "doom", -1); dealArcane(ctx, opponentSeat(ctx), 2); } }] },
  "surgent aethertide|0": { activated: { cost: 2, isAttack: false, goAgain: true, oncePerTurn: true, onActivate(ctx) { dealArcane(ctx, opponentSeat(ctx), 1); ctx.setPlayerFlag(ctx.seat, "surgentDamage", 1); } } },
  "mind warp|2": arcane(2),
  "swell tidings|1": arcane(5, (ctx, dealt) => { if (dealt > 5) ctx.createToken(PONDER); }),
  "brainstorm|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); }, onFriendlyDraws(ctx, count) { if (ctx.state.phase !== "action" && ctx.state.phase !== "layer" && ctx.state.phase !== "reaction") return; ctx.setCounter("brainstormPackets", ctx.getCounter("brainstormPackets") + count); requestBrainstormTarget(ctx); }, onChoose(ctx, hook, option) { if (hook !== "brainstorm-target") return; if (option.startsWith("ally:")) ctx.dealDamage(ctx.seat, 1, { arcane: true, targetAllyId: Number(option.split(":")[1]) }); else ctx.dealDamage(Number(option.split(":")[1]), 1, { arcane: true }); ctx.setCounter("brainstormPackets", ctx.getCounter("brainstormPackets") - 1); if (ctx.getCounter("brainstormPackets") > 0) requestBrainstormTarget(ctx); } },
  "invoke suraya|2": { onPlay(ctx) { const shields = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "spectral shield")); if (shields.length) ctx.requestCardChoice("suraya-transform", "Choose a Spectral Shield", shields.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "suraya-transform") ctx.transformInto("DYN212B", [Number(option)], ctx.self.instanceId); } },
  "suraya, archangel of knowledge|0": { activated: { cost: 0, isAttack: true, goAgain: false, oncePerTurn: true }, onDealsDamage(ctx, _target, amount) { if (amount > 0) ctx.gainLife(ctx.seat, amount); } },
  "celestial kimono|0": { onFriendlyDestroyed(ctx, card) { if (card.instanceId === ctx.self.instanceId || has(ctx, card, "ward")) ctx.changeResources(ctx.seat, 1); } },
  "phantasmal symbiosis|2": { onAttackDeclared(ctx) { ctx.requestNameChoice("symbiosis-name", "Name a card"); }, onChoose(ctx, hook, option) { if (hook === "symbiosis-name") ctx.addModifier({ scope: "until-end-of-turn", grantsTypeToName: option.toLowerCase(), grantsType: "illusionist" }); } },
  "spectral procession|1": { modifyAttack(ctx) { return ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "spectral shield")).length - (ctx.data.attack ?? 0); } },
  "tome of aeo|3": { triggers: [{ event: "begin-action-phase", whose: "subject", label: "Destroy Tome of Aeo", effect(ctx) { ctx.destroySelf(); ctx.drawCards(ctx.seat, 1); } }] },
  "crown of dominion|0": { allZoneTypes: ["royal"], onGameStart(ctx) { ctx.createToken("DYN243"); } },
  "imperial edict|1": { activated: { cost: 0, isAttack: false, goAgain: true, oncePerTurn: false, destroySelfCost: true, onActivate(ctx) { if (has(ctx, ctx.player(ctx.seat).hero, "royal")) ctx.revealCards(ctx.player(opponentSeat(ctx)).hand.map((card) => card.instanceId), opponentSeat(ctx)); ctx.requestNameChoice("edict-name", "Name a card"); } }, onChoose(ctx, hook, option) { if (hook === "edict-name") ctx.addModifier({ scope: "until-end-of-turn", prohibitsName: option.toLowerCase(), expiresAtStartOfSeatTurn: ctx.seat }); } },
  "imperial ledger|1": { activated: { cost: 0, isAttack: false, goAgain: true, oncePerTurn: false, onActivate(ctx) { ctx.putOnDeckBottom(ctx.self.instanceId); ctx.createToken(has(ctx, ctx.player(ctx.seat).hero, "royal") ? "DYN243" : "DYN247"); } } },
  "imperial warhorn|1": { activated: { cost: 1, isAttack: false, goAgain: false, oncePerTurn: false, destroySelfCost: true, onActivate(ctx) { ctx.requestChoice("warhorn-heroes", "Choose heroes", ["both", "opponent", "self", "none"]); } }, onChoose(ctx, hook, option) { if (hook === "warhorn-heroes") { const seats = option === "both" ? [0, 1] : option === "none" ? [] : [option === "self" ? ctx.seat : opponentSeat(ctx)]; ctx.setCounter("warhornMask", seats.reduce((mask, target) => mask | (1 << target), 0)); advanceWarhorn(ctx, -1); } else if (hook.startsWith("warhorn:")) { const seat = Number(hook.split(":")[1]); ctx.setCardCounter(ctx.self.instanceId, `warhornChoice:${seat}`, Number(option)); advanceWarhorn(ctx, seat); } } },
};
