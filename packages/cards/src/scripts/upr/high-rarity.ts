import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { dealArcane, opponentSeat, requestDiscardChoice, resolveDiscardChoice, wizardActionAsInstant } from "../shared-helpers.js";

const ASH = "UPR043";
const FROSTBITE = "SIY035";

function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return ctx.cardData(card.cardId).name.toLowerCase() === name;
}
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type);
}
function isAttackCard(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function controlledPhoenixFlames(ctx: ScriptCtx): number {
  return ctx.state.chain.filter(
    (link) => link.attacker === ctx.seat && named(ctx, link.attackingCard, "phoenix flame"),
  ).length;
}
function ashes(ctx: ScriptCtx) { return ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "ash")); }
function invoke(backId: string): CardScript {
  return {
    onPlay(ctx) { const cards = ashes(ctx); if (cards.length) ctx.requestCardChoice("invoke-high", "Choose an Ash to transform", cards.map((card) => card.instanceId)); },
    onChoose(ctx, hook, option) { if (hook === "invoke-high") ctx.transformInto(backId, [Number(option)], ctx.self.instanceId); },
  };
}
function revealRed(ctx: ScriptCtx, count: number): number {
  const cards = ctx.player(ctx.seat).deck.slice(0, count);
  ctx.revealCards(cards.map((card) => card.instanceId));
  return cards.filter((card) => ctx.cardData(card.cardId).pitch === 1).length;
}
function fusedIce(): Pick<CardScript, "additionalCost" | "onChoose"> {
  return {
    additionalCost(ctx) { const ice = ctx.player(ctx.seat).hand.filter((card) => has(ctx, card, "ice")); if (ice.length) ctx.requestCardChoice("upr-high-fuse", "Reveal an Ice card to fuse?", ["no", ...ice.map((card) => card.instanceId)]); },
    onChoose(ctx, hook, option) { if (hook === "upr-high-fuse" && option !== "no") { ctx.setCounter("fused", 1); ctx.setFlag("player", "fusedThisTurn", true); } },
  };
}
function dragonAttack(extra: CardScript): CardScript { return { activated: { cost: 3, isAttack: true, goAgain: false, oncePerTurn: true }, ...extra }; }

const dromai: CardScript = {
  replacePitchResources(ctx, card, amount) { if (ctx.cardData(card.cardId).pitch === 1) ctx.createToken(ASH); return amount; },
  onFriendlyActivate(ctx, activated) { if (has(ctx, activated, "dragon") && Number(ctx.getFlag("player", "playedPitch:1")) > 0) ctx.grantGoAgain(); },
};
const fai: CardScript = {
  onGameStart(ctx) { const flame = ctx.player(ctx.seat).deck.find((card) => named(ctx, card, "phoenix flame")); if (flame) ctx.moveToGraveyard(flame.instanceId, "deck"); },
  activated: { cost: 3, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.player(ctx.seat).graveyard.some((card) => named(ctx, card, "phoenix flame")), modifyCost: (ctx, base) => Math.max(0, base - ctx.chainLinksControlled(ctx.seat, "draconic")), onActivate(ctx) { const flame = ctx.player(ctx.seat).graveyard.find((card) => named(ctx, card, "phoenix flame")); if (flame) ctx.moveToHand(flame.instanceId); } },
};
const iyslander: CardScript = {
  allowsFriendlyCardPlayAsInstant(ctx, card, zone) { return zone === "arsenal" && ctx.state.activePlayer !== ctx.seat && ctx.cardData(card.cardId).pitch === 3 && has(ctx, card, "ice") && ctx.hasCardType(card, "action") && !has(ctx, card, "attack"); },
  triggers: [{ event: "card-played", label: "Create a Frostbite", condition: (ctx, card) => ctx.state.activePlayer !== ctx.seat && !!card && has(ctx, card, "ice"), effect: (ctx) => ctx.createToken(FROSTBITE, opponentSeat(ctx)) }],
};

export const uprHighRarity: Record<string, CardScript> = {
  "blood of the dracai|1": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Discount the next 3 Draconic cards", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx) { ctx.setPlayerFlag(ctx.seat, "draconicDiscount", Number(ctx.getPlayerFlag(ctx.seat, "draconicDiscount")) + 3); } }] },
  "dromai, ash artist|0": dromai,
  "burn them all|1": { onFriendlyActivate(ctx, card) { if (has(ctx, card, "dragon")) dealArcane(ctx, opponentSeat(ctx), 1); } },
  "invoke dracona optimai|1": invoke("UPR006B"),
  "dracona optimai|0": dragonAttack({ onAttackDeclared(ctx) { const red = revealRed(ctx, 3); if (red) dealArcane(ctx, opponentSeat(ctx), red * 2); } }),
  "invoke tomeltai|1": invoke("UPR007B"),
  "tomeltai|0": dragonAttack({
    onAttackDeclared(ctx) {
      const red = revealRed(ctx, 2);
      if (red <= 0) return;
      ctx.setCounter("tomeltaiRed", red);
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment)
        .filter((card): card is DeepReadonly<CardInstance> => !!card);
      if (equipment.length) ctx.requestCardChoice("tomeltai-equipment", "Choose equipment for Tomeltai", equipment.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "tomeltai-equipment") return;
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment)
        .find((card) => card?.instanceId === Number(option));
      if (!equipment) return;
      ctx.addCardDefenseCounters(equipment.instanceId, ctx.getCounter("tomeltaiRed"));
      if ((ctx.cardData(equipment.cardId).defense ?? 0) - (equipment.defCounters ?? 0) - ctx.getCounter("tomeltaiRed") <= 0) {
        ctx.destroyPermanent(equipment.instanceId);
      }
    },
  }),
  "invoke dominia|1": invoke("UPR008B"),
  "dominia|0": dragonAttack({
    onAttackDeclared(ctx) {
      if (revealRed(ctx, 1) <= 0) return;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      for (const card of hand) ctx.lookAt(card.instanceId);
      if (hand.length) ctx.requestCardChoice("dominia-banish", "Choose a card from the opposing hand to banish", hand.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "dominia-banish") ctx.banish(Number(option)); },
  }),
  "fai, rising rebellion|0": fai,
  "phoenix form|1": { modifyAttack(ctx) { return controlledPhoenixFlames(ctx) >= 2 ? 2 : 0; }, onAttackDeclared(ctx) { if (controlledPhoenixFlames(ctx) >= 1) ctx.grantGoAgain(); }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && controlledPhoenixFlames(ctx) >= 3; }, onHit(ctx) { ctx.drawCards(ctx.seat, 3); } },
  "spreading flames|1": {
    onAttackDeclared(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", expiresOnChainClose: true });
    },
    modifyAttack(ctx) {
      const attacking = ctx.link?.attackingCard;
      if (!attacking || !ctx.currentAttackHasType("draconic")) return 0;
      return ctx.basePower(attacking) < ctx.chainLinksControlled(ctx.seat, "draconic") ? 1 : 0;
    },
  },
  "combustion point|1": { canPlay(ctx) { return !!ctx.link && (ctx.cardTypes(ctx.link.attackingCard).includes("draconic") || ctx.cardTypes(ctx.link.attackingCard).includes("ninja")); }, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); } },
  "flamescale furnace|0": { activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => Number(ctx.getFlag("player", "playedPitch:1")) > 0, onActivate(ctx) { ctx.changeResources(ctx.seat, ctx.player(ctx.seat).pitch.filter((card) => ctx.cardData(card.cardId).pitch === 1).length); } } },
  "thaw|1": {
    triggers: [{
      event: "start-of-turn", whose: "subject", sourceZone: "graveyard", optional: true,
      label: "Banish Thaw to destroy or unfreeze a card?",
      effect(ctx) {
        const targets = ctx.state.players.flatMap((player) => [
          ...player.board.filter((card) => named(ctx, card, "frostbite") || (has(ctx, card, "ice") && has(ctx, card, "affliction")) || Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn),
          ...player.arsenal.filter((card) => Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn),
          ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn),
        ]);
        if (targets.length) ctx.requestCardChoice("thaw-target", "Choose a frozen card or Ice permanent", targets.map((card) => card.instanceId));
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "thaw-target") return;
      const id = Number(option);
      const target = ctx.state.players.flatMap((player) => [...player.board, ...player.arsenal, ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => !!card)]).find((card) => card.instanceId === id);
      if (!target || !ctx.banish(ctx.self.instanceId)) return;
      if (named(ctx, target, "frostbite") || (has(ctx, target, "ice") && has(ctx, target, "affliction"))) ctx.destroyPermanent(id);
      else ctx.setCardCounter(id, "frozenUntilTurn", 0);
    },
  },
  "liquefy|1": { onPlay(ctx) { if (ctx.currentChainLinkNumber() >= 4) ctx.setFlag("link", "liquefy", true); } },
  "uprising|1": { onPlay(ctx) { ctx.setPlayerFlag(ctx.seat, "uprisingCharges", 4); } },
  "tome of firebrand|1": { canPlay: (ctx) => ctx.chainLinksControlled(ctx.seat, "draconic") >= 4, onPlay(ctx) { ctx.drawCards(ctx.seat, 2); } },
  "iyslander, stormbind|0": iyslander,
  "encase|1": { ...fusedIce(), arcaneDamageEffect: true, arcaneDamageEffectAmounts: [3], playAsInstant: wizardActionAsInstant, onPlay(ctx) { dealArcane(ctx, opponentSeat(ctx), 3); } },
  "freezing point|1": { ...fusedIce(), arcaneDamageEffect: true, arcaneDamageEffectAmounts: [5], playAsInstant: wizardActionAsInstant, onPlay(ctx) { const opp = ctx.player(opponentSeat(ctx)); const frozen = [...opp.arsenal, ...opp.board, ...Object.values(opp.equipment).filter((card): card is DeepReadonly<CardInstance> => !!card)].filter((card) => Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn).length; const ice = opp.board.filter((card) => has(ctx, card, "ice") && has(ctx, card, "affliction")).length; dealArcane(ctx, opp.seat, 5 + (ctx.getCounter("fused") ? frozen + ice + opp.board.filter((card) => named(ctx, card, "frostbite")).length : 0)); } },
  "frost hex|3": {},
  "coronet peak|0": { activated: { cost: 3, isAttack: false, goAgain: true, oncePerTurn: true, onActivate(ctx) { const seat = opponentSeat(ctx); if (!ctx.requestPayment("coronet", "Pay 1 or discard a card", 1, seat)) { const hand = ctx.player(seat).hand; if (hand.length) ctx.requestCardChoice("coronet-discard", "Choose a card to discard", hand.map((card) => card.instanceId), seat); } } }, onChoose(ctx, hook, option) { if (hook === "coronet" && option !== "paid") { const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length) ctx.requestCardChoice("coronet-discard", "Choose a card to discard", hand.map((card) => card.instanceId), opponentSeat(ctx)); } else if (hook === "coronet-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); } },
  "channel the bleak expanse|3": {
    prohibitsReveals: true,
    prohibitsEffectDraws: true,
    prohibitsDeckSearches: true,
    triggers: [{ event: "end-of-turn", whose: "subject", label: "Channel Ice", effect(ctx) {
      ctx.addCounter(ctx.self.instanceId, "flow", 1);
      ctx.setCounter("channelRemaining", ctx.getCounter("flow"));
      const ice = ctx.player(ctx.seat).pitch.filter((card) => has(ctx, card, "ice"));
      if (ice.length < ctx.getCounter("channelRemaining")) ctx.destroySelf();
      else ctx.requestCardChoice("bleak-channel", "Put an Ice card on the bottom of your deck", ice.map((card) => card.instanceId));
    } }],
    onChoose(ctx, hook, option) {
      if (hook !== "bleak-channel" || !ctx.putOnDeckBottom(Number(option))) return;
      ctx.setCounter("channelRemaining", ctx.getCounter("channelRemaining") - 1);
      if (ctx.getCounter("channelRemaining") <= 0) return;
      const ice = ctx.player(ctx.seat).pitch.filter((card) => has(ctx, card, "ice"));
      if (ice.length < ctx.getCounter("channelRemaining")) ctx.destroySelf();
      else ctx.requestCardChoice("bleak-channel", "Put another Ice card on the bottom of your deck", ice.map((card) => card.instanceId));
    },
  },
  "hypothermia|3": { onEnterArena(ctx) { ctx.setPlayerFlag(opponentSeat(ctx), "cannotGainGoAgain", true); }, onLeaveArena(ctx) { ctx.setPlayerFlag(opponentSeat(ctx), "cannotGainGoAgain", false); }, triggers: [{ event: "end-of-turn", label: "Destroy Hypothermia", effect: (ctx) => ctx.destroySelf() }] },
  "insidious chill|3": { onEnterArena(ctx) { ctx.addCounter(ctx.self.instanceId, "frost", 3); }, triggers: [{ event: "card-played", label: "Remove a frost counter; opposing hero pays 2 or discards", condition: (ctx, card) => !!card && Number(card.counters?.fused ?? 0) > 0 && ctx.getCounter("frost") > 0 && has(ctx, card, "ice"), onTrigger(ctx) { ctx.addCounter(ctx.self.instanceId, "frost", -1); }, effect(ctx) { ctx.requestPayment("chill", "Pay 2 or discard", 2, opponentSeat(ctx)); } }], onChoose(ctx, hook, option) { if (hook === "chill" && option !== "paid") requestDiscardChoice(ctx, "chill-discard", "Choose a card to discard", opponentSeat(ctx)); else if (hook === "chill-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx)); } },
  "ghostly touch|0": {
    onFriendlyAttackLost(ctx, card, cause) {
      if (cause === "phantasm" && has(ctx, card, "illusionist")) ctx.addCounter(ctx.self.instanceId, "haunt", 1);
    },
    activated: [
      { cost: 0, isAttack: false, goAgain: true, oncePerTurn: true, canActivate: (ctx) => ctx.getCounter("haunt") > 0,
        onActivate(ctx) { ctx.addCounter(ctx.self.instanceId, "haunt", -1); const n = ctx.getCounter("haunt"); if (ctx.becomeAllyUntilEndOfTurn(ctx.self.instanceId, n, n)) ctx.grantCardKeyword(ctx.self.instanceId, "phantasm"); } },
      { cost: 3, isAttack: true, goAgain: false, oncePerTurn: true, canActivate: (ctx) => has(ctx, ctx.self, "ally") },
    ],
  },
  "frightmare|1": { canPlay: (ctx) => ctx.getFlag("player", "phantasmDestroyedThisTurn") === true },
  "semblance|3": { onPlay(ctx) { ctx.setFlag("link", "suppressPhantasm", true); } },
  "tiger stripe shuko|0": {
    onFriendlyPlay(ctx, card) {
      if (!isAttackCard(ctx, card) || ctx.basePower(card) > 2) return;
      const count = Number(ctx.getFlag("player", "smallAttackCount")) + 1;
      ctx.setFlag("player", "smallAttackCount", count);
      if (count !== 2) return;
      ctx.addCardTempPower(card.instanceId, 1);
      ctx.setFlag("player", `tigerStripeShuko:${card.instanceId}`, true);
    },
    onFriendlyAttackDeclared(ctx) {
      const attacking = ctx.link?.attackingCard;
      if (!attacking || ctx.getFlag("player", `tigerStripeShuko:${attacking.instanceId}`) !== true) return;
      ctx.setFlag("link", "unpreventable", true);
      ctx.setFlag("player", `tigerStripeShuko:${attacking.instanceId}`, false);
    },
  },
  "double strike|1": { onChainLinkResolved(ctx) { if (ctx.getCounter("replayed") > 0) return; ctx.setCounter("replayed", 1); if (ctx.banish(ctx.self.instanceId)) ctx.allowPlayFrom(ctx.self.instanceId, "banish", { untilChainClose: true }); } },
  "take the tempo|1": { canTriggerOnHit(ctx) { return ctx.hitsThisCombatChain(ctx.seat) >= 3; }, onHit(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top && ctx.banish(top.instanceId) && isAttackCard(ctx, top)) ctx.allowPlayFrom(top.instanceId, "banish", { untilEndOfNextTurn: true }); } },
  "waning moon|0": { activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.getFlag("player", "playedNonAttackAction") === true, onActivate(ctx) { dealArcane(ctx, opponentSeat(ctx), ctx.state.activePlayer === ctx.seat ? 2 : 3); } } },
  "alluvion constellas|0": { preventArcaneDamage: 1, onPreventsDamage(ctx) { if (ctx.getCounter("preventionObservedTurn") === ctx.state.turn || ctx.getCounter("energy") >= 4) return; ctx.setCounter("preventionObservedTurn", ctx.state.turn); ctx.requestChoice("alluvion-energy", "Put an energy counter on Alluvion Constellas?", ["yes", "no"]); }, onChoose(ctx, hook, option) { if (hook === "alluvion-energy" && option === "yes" && ctx.getCounter("energy") < 4) ctx.addCounter(ctx.self.instanceId, "energy", 1); }, activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: false, removeCounterCost: { key: "energy", amount: 2 }, canActivate: (ctx) => ctx.getCounter("energy") >= 2, onActivate(ctx) { ctx.setPlayerFlag(ctx.seat, "nextStaffAbilityCostReduction", 3); } } },
  "tome of duplicity|3": { onPlay(ctx) { const cards = ctx.player(ctx.seat).deck.slice(0, 2); for (const card of cards) ctx.lookAt(card.instanceId); if (cards.length) ctx.requestCardChoice("duplicity", "Choose a card to banish", cards.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "duplicity" && ctx.banish(Number(option))) ctx.allowPlayFrom(Number(option), "banish"); } },
  "rewind|3": {
    canPlay(ctx) { return ctx.state.stack.some((layer) => layer.card && ctx.hasCardType(layer.card, "action") && !has(ctx, layer.card, "attack")); },
    onPlay(ctx) {
      const targets = ctx.state.stack.flatMap((layer) => layer.card && ctx.hasCardType(layer.card, "action") && !has(ctx, layer.card, "attack") ? [layer.card] : []);
      if (targets.length) ctx.requestCardChoice("rewind-target", "Choose a non-attack action to negate", targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "rewind-target") return;
      const id = Number(option);
      const owner = ctx.state.stack.find((layer) => layer.card?.instanceId === id)?.card?.owner;
      if (owner !== undefined && ctx.negateStackCard(id) && ctx.moveToHand(id)) ctx.changeActionPoints(owner, 1);
    },
  },
  "crown of providence|0": { onDefend(ctx) { const cards = [...ctx.player(ctx.seat).hand, ...ctx.player(ctx.seat).arsenal]; if (cards.length) ctx.requestCardChoice("providence", "Put a card on the bottom to draw?", ["no", ...cards.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "providence" && option !== "no" && ctx.putOnDeckBottom(Number(option))) ctx.drawCards(ctx.seat, 1); } },
  "helio's mitre|0": { activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: false, onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 1); ctx.setCounter("used", 1); } }, triggers: [{ event: "end-of-turn", condition: (ctx) => ctx.getCounter("used") > 0, label: "Destroy Helio's Mitre", effect: (ctx) => ctx.destroySelf() }] },
  "erase face|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const target = opponentSeat(ctx); ctx.addModifier({ scope: "until-end-of-turn", seat: target, suppressesOwnedClassTalentTypes: true, expiresAtEndOfSeatTurn: target }); } },
  "vipox|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { ctx.loseLife(opponentSeat(ctx), ctx.player(opponentSeat(ctx)).hand.length); } },
  "that all you got?|2": { onDefendingCombatChainClosed(ctx) { if (ctx.currentAttackPower() <= 2) ctx.drawCards(ctx.seat, 1); } },
  "fog down|2": { suppressesNonAttackActionGoAgain: true, triggers: [{ event: "begin-action-phase", whose: "subject", label: "Destroy Fog Down", effect: (ctx) => ctx.destroySelf() }] },
};
