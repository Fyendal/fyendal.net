import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, dealArcane, mergeSetScripts, opponentSeat } from "./shared-helpers.js";
import { eleHighRarity } from "./ele/high-rarity.js";

// Tales of Aria commons, rares, and young heroes. Fusion is paid by revealing
// a matching talent card from hand; the revealed card never leaves the hand.

const FROSTBITE = "SIY035";
const SEISMIC_SURGE = "CRU044";

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack");
}

function isFused(ctx: ScriptCtx): boolean {
  return ctx.getCounter("fused") > 0;
}

function fusionAdditionalCost(type: "earth" | "ice" | "lightning") {
  return (ctx: ScriptCtx) => {
    const matches = ctx.player(ctx.seat).hand.filter((card) => hasType(ctx, card, type));
    if (matches.length === 0) return;
    ctx.requestCardChoice(
      `${type}-fusion`,
      `${ctx.data.name}: reveal a ${type[0]!.toUpperCase()}${type.slice(1)} card to fuse?`,
      [...matches.map((card) => card.instanceId), "no"],
    );
  };
}

function fusionOnChoose(
  ctx: ScriptCtx,
  hook: string,
  option: string,
  type: "earth" | "ice" | "lightning",
): boolean {
  if (hook !== `${type}-fusion`) return false;
  if (option === "no") return true;
  const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
  if (!card) return true;
  ctx.setCounter("fused", 1);
  ctx.setFlag("player", "fusedThisTurn", true);
  ctx.setFlag("player", `${type}FusedThisTurn`, true);
  ctx.logPublic(`${ctx.data.name} is fused (reveals ${ctx.cardData(card.cardId).name})`);
  return true;
}

function fusionOnly(type: "earth" | "ice" | "lightning"): Pick<CardScript, "additionalCost" | "onChoose"> {
  return {
    additionalCost: fusionAdditionalCost(type),
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, type);
    },
  };
}

function createFrostbites(ctx: ScriptCtx, seat: number, count = 1): void {
  ctx.createTokens(FROSTBITE, count, seat);
}

function discardUnlessPay(
  ctx: ScriptCtx,
  target: number,
  cost: number,
  key: string,
): void {
  const hand = ctx.player(target).hand;
  if (hand.length === 0) return;
  if (
    ctx.requestPayment(
      `${key}:pay:${target}`,
      `${ctx.data.name}: pay ${cost} resource${cost === 1 ? "" : "s"} or discard a card?`,
      cost,
      target,
    )
  ) return;
  ctx.requestCardChoice(
    `${key}:discard:${target}`,
    `${ctx.data.name}: choose a card to discard`,
    hand.map((card) => card.instanceId),
    target,
  );
}

function discardUnlessPayOnChoose(
  ctx: ScriptCtx,
  hook: string,
  option: string,
  key: string,
): boolean {
  const payment = new RegExp(`^${key}:pay:(\\d+)$`).exec(hook);
  if (payment) {
    const target = Number(payment[1]);
    if (option !== "paid" && ctx.player(target).hand.length > 0) {
      ctx.requestCardChoice(
        `${key}:discard:${target}`,
        `${ctx.data.name}: choose a card to discard`,
        ctx.player(target).hand.map((card) => card.instanceId),
        target,
      );
    }
    return true;
  }
  const discard = new RegExp(`^${key}:discard:(\\d+)$`).exec(hook);
  if (!discard) return false;
  ctx.discardCard(Number(discard[1]), Number(option));
  return true;
}

function fusedDominate(type: "ice" | "earth" | "lightning"): CardScript {
  return {
    additionalCost: fusionAdditionalCost(type),
    onAttackDeclared(ctx) {
      if (isFused(ctx)) ctx.addModifier({ scope: "chain-link", dominate: true });
    },
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, type);
    },
  };
}

function fusedPower(type: "earth" | "ice" | "lightning", attack: number): CardScript {
  return {
    additionalCost: fusionAdditionalCost(type),
    modifyAttack(ctx) {
      return isFused(ctx) ? attack : 0;
    },
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, type);
    },
  };
}

function fusedGoAgain(type: "earth" | "ice" | "lightning"): CardScript {
  return {
    additionalCost: fusionAdditionalCost(type),
    onAttackDeclared(ctx) {
      if (isFused(ctx)) ctx.grantGoAgain();
    },
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, type);
    },
  };
}

function fusedHitFrostbite(type: "ice", count = 1): CardScript {
  return {
    additionalCost: fusionAdditionalCost(type),
    canTriggerOnHit(ctx) {
      return isFused(ctx) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
            createFrostbites(ctx, opponentSeat(ctx), count);
    },
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, type);
    },
  };
}

function entangle(): CardScript {
  return {
    ...fusionOnly("earth"),
    canTriggerOnHit(ctx) {
      return isFused(ctx) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const hero = ctx.player(opponentSeat(ctx)).hero;
      ctx.setCardCounter(hero.instanceId, "nextAttackPowerPenalty", 2);
      ctx.setCardCounter(hero.instanceId, "nextAttackPowerPenaltyUntilTurn", ctx.state.turn + 1);
    },
  };
}

function delayedGuardianAura(
  type: "earth" | "ice",
  attack: number,
  creates?: "frostbite" | "seismic",
): CardScript {
  return {
    additionalCost: fusionAdditionalCost(type),
    onEnterArena(ctx) {
      if (!isFused(ctx)) return;
      if (creates === "frostbite") {
        ctx.requestChoice(
          "avalanche-target",
          `${ctx.data.name}: create Frostbite under which hero?`,
          ["opponent", "self"],
        );
      }
      if (creates === "seismic") ctx.createToken(SEISMIC_SURGE);
    },
    triggers: [{
      event: "begin-action-phase",
      label: "Destroy this — next attack action gets +3 power",
      effect(ctx) {
        ctx.destroySelf();
        buffNextAttack(ctx, { attack, appliesTo: "attack-action" });
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "avalanche-target") {
        createFrostbites(ctx, option === "self" ? ctx.seat : opponentSeat(ctx));
        return;
      }
      fusionOnChoose(ctx, hook, option, type);
    },
  };
}

function fusedAttackWatcher(
  type: "ice" | "lightning",
  key: string,
  onHit: (ctx: ScriptCtx) => void,
): CardScript {
  return {
    additionalCost: fusionAdditionalCost(type),
    onAttackDeclared(ctx) {
      if (!isFused(ctx)) return;
      ctx.setCounter(key, 1);
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    canTriggerOnHit(ctx) {
      return ctx.getCounter(key) > 0 && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      onHit(ctx);
    },
    onChoose(ctx, hook, option) {
      if (fusionOnChoose(ctx, hook, option, type)) return;
      discardUnlessPayOnChoose(ctx, hook, option, key);
    },
  };
}

function arcanicShockwave(): CardScript {
  return {
    arcaneDamageEffect: true,
    additionalCost: fusionAdditionalCost("lightning"),
    onAttackDeclared(ctx) {
      if (isFused(ctx)) dealArcane(ctx, opponentSeat(ctx), 1);
    },
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, "lightning");
    },
  };
}

function ritesOfLightning(): CardScript {
  return {
    arcaneDamageEffect: true,
    additionalCost: fusionAdditionalCost("lightning"),
    onAttackDeclared(ctx) {
      if (isFused(ctx)) dealArcane(ctx, opponentSeat(ctx), 1);
      if (ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true) ctx.grantGoAgain();
    },
    onDamageDealt(ctx, _target, amount, arcane) {
      if (arcane && amount > 0) ctx.grantGoAgain();
    },
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, "lightning");
    },
  };
}

function requestRitesAttack(ctx: ScriptCtx): void {
  if (!ctx.getCounter("ritesAttack")) return;
  const attacks = ctx.player(ctx.seat).graveyard.filter((card) => isAttack(ctx, card));
  if (attacks.length > 0) {
    ctx.requestCardChoice("rites-attack", `${ctx.data.name}: put an attack action on the bottom?`, [
      "none",
      ...attacks.map((card) => card.instanceId),
    ]);
  }
}

function ritesOfReplenishment(): CardScript {
  return {
    additionalCost: fusionAdditionalCost("earth"),
    onAttackDeclared(ctx) {
      ctx.setCounter("ritesAttack", isFused(ctx) ? 1 : 0);
      const nonAttacks = ctx.player(ctx.seat).graveyard.filter((card) => isNonAttackAction(ctx, card));
      if (
        ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true &&
        nonAttacks.length > 0
      ) {
        ctx.requestCardChoice(
          "rites-non-attack",
          `${ctx.data.name}: put a non-attack action on the bottom?`,
          ["none", ...nonAttacks.map((card) => card.instanceId)],
        );
      } else {
        requestRitesAttack(ctx);
      }
    },
    onChoose(ctx, hook, option) {
      if (fusionOnChoose(ctx, hook, option, "earth")) return;
      if (hook === "rites-non-attack") {
        if (option !== "none") ctx.putOnDeckBottom(Number(option));
        requestRitesAttack(ctx);
      } else if (hook === "rites-attack" && option !== "none") {
        ctx.putOnDeckBottom(Number(option));
      }
    },
  };
}

function brambleSpark(attack: number): CardScript {
  return {
    additionalCost: fusionAdditionalCost("earth"),
    onPlay(ctx) {
      ctx.setCounter("brambleArmed", 1);
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getCounter("brambleArmed") || ctx.link?.attackCardType !== "action") return;
      ctx.setCounter("brambleArmed", 0);
      if (isFused(ctx)) ctx.addModifier({ scope: "chain-link", attack, appliesTo: "attack-action" });
      ctx.dealDamage(opponentSeat(ctx), 1, {
        arcane: true,
        sourceInstanceId: ctx.link.attackingCard.instanceId,
      });
    },
    onChoose(ctx, hook, option) {
      fusionOnChoose(ctx, hook, option, "earth");
    },
  };
}

function weave(type: "earth" | "ice", attack: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.setCounter("weaveArmed", 1);
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getCounter("weaveArmed") || ctx.link?.attackCardType !== "action") return;
      const attackCard = ctx.link.attackingCard;
      if (!hasType(ctx, attackCard, type) && !hasType(ctx, attackCard, "elemental")) return;
      ctx.setCounter("weaveArmed", 0);
      ctx.addModifier({ scope: "chain-link", attack, appliesTo: "attack-action" });
      if (type === "earth" && (attackCard.counters?.fused ?? 0) > 0) {
        ctx.addModifier({ scope: "chain-link", attack: 1, appliesTo: "attack-action" });
      }
      if (type === "ice" && (attackCard.counters?.fused ?? 0) > 0) {
        ctx.addModifier({ scope: "chain-link", dominate: true, appliesTo: "attack-action" });
      }
    },
  };
}

function weaveLightning(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        appliesToSubtype: ["lightning", "elemental"],
      });
      ctx.setCounter("weaveLightningArmed", 1);
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getCounter("weaveLightningArmed") || ctx.link?.attackCardType !== "action") return;
      const card = ctx.link.attackingCard;
      if (!hasType(ctx, card, "lightning") && !hasType(ctx, card, "elemental")) return;
      ctx.setCounter("weaveLightningArmed", 0);
      const marker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "until-end-of-turn" &&
        !modifier.consumed
      );
      if (marker) ctx.consumeModifier(marker.id);
      if ((card.counters?.fused ?? 0) > 0) ctx.grantGoAgain();
    },
  };
}

function fromArsenalGoAgain(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("link", "fromArsenal") === true) ctx.grantGoAgain();
    },
  };
}

function lightningPress(attack: number): CardScript {
  return {
    playTargetOptions(ctx) {
      return ctx.state.chain
        .filter((link) =>
          link.flags.attackGone !== true &&
          link.attackCardType === "action" &&
          (ctx.cardData(link.attackingCard.cardId).cost ?? 99) <= 1
        )
        .map((link) => link.attackingCard.instanceId);
    },
    onPlay(ctx) {
      if (ctx.playTargetInstanceId === undefined) return;
      ctx.addModifier({
        scope: "chain-link",
        attack,
        appliesTo: "attack-action",
        appliesToInstanceId: ctx.playTargetInstanceId,
        maxCost: 1,
      });
    },
  };
}

function reload(ctx: ScriptCtx, hook = "ele-reload"): void {
  const player = ctx.player(ctx.seat);
  if (player.arsenal.length > 0 || player.hand.length === 0) return;
  ctx.requestCardChoice(hook, "Reload: put a card from your hand into your arsenal?", [
    "pass",
    ...player.hand.map((card) => card.instanceId),
  ]);
}

function reloadOnChoose(ctx: ScriptCtx, hook: string, option: string, wanted = "ele-reload"): boolean {
  if (hook !== wanted) return false;
  if (option !== "pass") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
  return true;
}

function boltNShot(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.attackBonusAboveBase(ctx.self.instanceId) <= 0) return;
      ctx.grantGoAgain();
      ctx.setFlag("link", "reloadOnHit", true);
    },
    canTriggerOnHit(ctx) {
      return ctx.getFlag("link", "reloadOnHit") === true;
    },
    onHit(ctx) {
      reload(ctx);
    },
    onChoose(ctx, hook, option) {
      reloadOnChoose(ctx, hook, option);
    },
  };
}

function sigilOfSuffering(): CardScript {
  return {
    onPlay(ctx) {
      if (ctx.link) dealArcane(ctx, ctx.link.attacker, 1);
    },
    modifyDefense(ctx) {
      return ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true ? 1 : 0;
    },
  };
}

function sowTomorrow(minCost: number): CardScript {
  return {
    onPlay(ctx) {
      if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1);
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => {
        const data = ctx.cardData(card.cardId);
        return ctx.hasCardType(card, "action") &&
          (data.cost ?? 0) >= minCost &&
          (hasType(ctx, card, "earth") || hasType(ctx, card, "elemental"));
      });
      if (cards.length > 0) {
        ctx.requestCardChoice(
          "sow-bottom",
          "Sow Tomorrow: put an Earth or Elemental action on the bottom",
          cards.map((card) => card.instanceId),
        );
      }
      ctx.banish(ctx.self.instanceId);
    },
    onChoose(ctx, hook, option) {
      if (hook === "sow-bottom") ctx.putOnDeckBottom(Number(option));
    },
  };
}

function snapShot(): CardScript {
  return {
    ...fusionOnly("lightning"),
    onAttackDeclared(ctx) {
      if (!isFused(ctx)) return;
      for (const weapon of ctx.player(ctx.seat).weapons) {
        if (hasType(ctx, weapon, "bow")) ctx.grantAdditionalActivation(weapon.instanceId);
      }
      ctx.allowAbilitiesAsInstant("bow");
    },
  };
}

export const ele: Record<string, CardScript> = mergeSetScripts("ELE", eleHighRarity, {
  // Heroes and Elemental Guardian
  "oldhim|0": {
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      timing: "defense-reaction",
      oncePerTurn: true,
      onCostPaid(ctx, cards) {
        ctx.setCounter("oldhimEarth", cards.some((card) => hasType(ctx, card, "earth")) ? 1 : 0);
        ctx.setCounter("oldhimIce", cards.some((card) => hasType(ctx, card, "ice")) ? 1 : 0);
      },
      onActivate(ctx) {
        if (ctx.getCounter("oldhimEarth")) ctx.preventNextDamage(ctx.seat, 2);
        if (!ctx.getCounter("oldhimIce") || !ctx.link) return;
        const attacker = ctx.link.attacker;
        const hand = ctx.player(attacker).hand;
        if (hand.length > 0) {
          ctx.requestCardChoice(
            "oldhim-top",
            "Oldhim: put a card from your hand on top of your deck",
            hand.map((card) => card.instanceId),
            attacker,
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "oldhim-top") ctx.putOnDeckTop(Number(option));
    },
  },
  "biting gale|1": {
    ...fusionOnly("ice"),
    onPlay(ctx) { if (isFused(ctx) && ctx.link) discardUnlessPay(ctx, ctx.link.attacker, 2, "biting-gale"); },
    onChoose(ctx, hook, option) {
      if (fusionOnChoose(ctx, hook, option, "ice")) return;
      discardUnlessPayOnChoose(ctx, hook, option, "biting-gale");
    },
  },
  "biting gale|2": {
    ...fusionOnly("ice"),
    onPlay(ctx) { if (isFused(ctx) && ctx.link) discardUnlessPay(ctx, ctx.link.attacker, 2, "biting-gale"); },
    onChoose(ctx, hook, option) {
      if (fusionOnChoose(ctx, hook, option, "ice")) return;
      discardUnlessPayOnChoose(ctx, hook, option, "biting-gale");
    },
  },
  "biting gale|3": {
    ...fusionOnly("ice"),
    onPlay(ctx) { if (isFused(ctx) && ctx.link) discardUnlessPay(ctx, ctx.link.attacker, 2, "biting-gale"); },
    onChoose(ctx, hook, option) {
      if (fusionOnChoose(ctx, hook, option, "ice")) return;
      discardUnlessPayOnChoose(ctx, hook, option, "biting-gale");
    },
  },
  "turn timber|1": { ...fusionOnly("earth"), modifyDefense: (ctx) => isFused(ctx) ? 2 : 0 },
  "turn timber|2": { ...fusionOnly("earth"), modifyDefense: (ctx) => isFused(ctx) ? 2 : 0 },
  "turn timber|3": { ...fusionOnly("earth"), modifyDefense: (ctx) => isFused(ctx) ? 2 : 0 },
  "entangle|1": entangle(),
  "entangle|2": entangle(),
  "entangle|3": entangle(),
  "glacial footsteps|1": fusedDominate("ice"),
  "glacial footsteps|2": fusedDominate("ice"),
  "glacial footsteps|3": fusedDominate("ice"),
  "mulch|1": {
    ...fusionOnly("earth"),
    canTriggerOnHit(ctx) { return isFused(ctx) && ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { const card = ctx.player(opponentSeat(ctx)).arsenal[0]; if (card) ctx.putOnDeckBottom(card.instanceId); },
  },
  "mulch|2": {
    ...fusionOnly("earth"),
    canTriggerOnHit(ctx) { return isFused(ctx) && ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { const card = ctx.player(opponentSeat(ctx)).arsenal[0]; if (card) ctx.putOnDeckBottom(card.instanceId); },
  },
  "mulch|3": {
    ...fusionOnly("earth"),
    canTriggerOnHit(ctx) { return isFused(ctx) && ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { const card = ctx.player(opponentSeat(ctx)).arsenal[0]; if (card) ctx.putOnDeckBottom(card.instanceId); },
  },
  "snow under|1": fusedHitFrostbite("ice"),
  "snow under|2": fusedHitFrostbite("ice"),
  "snow under|3": fusedHitFrostbite("ice"),
  "emerging avalanche|1": delayedGuardianAura("ice", 3, "frostbite"),
  "emerging avalanche|2": delayedGuardianAura("ice", 2, "frostbite"),
  "emerging avalanche|3": delayedGuardianAura("ice", 1, "frostbite"),
  "strength of sequoia|1": delayedGuardianAura("earth", 3, "seismic"),
  "strength of sequoia|2": delayedGuardianAura("earth", 2, "seismic"),
  "strength of sequoia|3": delayedGuardianAura("earth", 1, "seismic"),

  // Elemental Ranger
  "lexi|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      canActivate(ctx) { return ctx.player(ctx.seat).arsenal.some((card) => card.faceDown); },
      onActivate(ctx) {
        const cards = ctx.player(ctx.seat).arsenal.filter((card) => card.faceDown);
        ctx.requestCardChoice("lexi-flip", "Lexi: turn a face-down arsenal card face up", cards.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "lexi-flip") {
        const card = ctx.player(ctx.seat).arsenal.find((candidate) => candidate.instanceId === Number(option));
        if (!card) return;
        const lightning = hasType(ctx, card, "lightning");
        const ice = hasType(ctx, card, "ice");
        ctx.turnArsenalFaceUp(card.instanceId);
        if (lightning) buffNextAttack(ctx, { goAgain: true });
        if (ice) ctx.requestChoice("lexi-ice-target", "Lexi: create Frostbite under which hero?", ["opponent", "self"]);
      } else if (hook === "lexi-ice-target") {
        createFrostbites(ctx, option === "self" ? ctx.seat : opponentSeat(ctx));
      }
    },
  },
  "cold wave|1": {
    ...fusionOnly("ice"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.setPlayerFlag(opponentSeat(ctx), "costMoreThisTurn", Number(ctx.getPlayerFlag(opponentSeat(ctx), "costMoreThisTurn")) + 1); },
  },
  "cold wave|2": {
    ...fusionOnly("ice"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.setPlayerFlag(opponentSeat(ctx), "costMoreThisTurn", Number(ctx.getPlayerFlag(opponentSeat(ctx), "costMoreThisTurn")) + 1); },
  },
  "cold wave|3": {
    ...fusionOnly("ice"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.setPlayerFlag(opponentSeat(ctx), "costMoreThisTurn", Number(ctx.getPlayerFlag(opponentSeat(ctx), "costMoreThisTurn")) + 1); },
  },
  "snap shot|1": snapShot(),
  "snap shot|2": snapShot(),
  "snap shot|3": snapShot(),
  "blizzard bolt|1": fusedAttackWatcher("ice", "blizzard", (ctx) => createFrostbites(ctx, opponentSeat(ctx))),
  "blizzard bolt|2": fusedAttackWatcher("ice", "blizzard", (ctx) => createFrostbites(ctx, opponentSeat(ctx))),
  "blizzard bolt|3": fusedAttackWatcher("ice", "blizzard", (ctx) => createFrostbites(ctx, opponentSeat(ctx))),
  "buzz bolt|1": fusedAttackWatcher("lightning", "buzz", (ctx) => ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: ctx.link!.attackingCard.instanceId })),
  "buzz bolt|2": fusedAttackWatcher("lightning", "buzz", (ctx) => ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: ctx.link!.attackingCard.instanceId })),
  "buzz bolt|3": fusedAttackWatcher("lightning", "buzz", (ctx) => ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: ctx.link!.attackingCard.instanceId })),
  "chilling icevein|1": fusedAttackWatcher("ice", "icevein", (ctx) => discardUnlessPay(ctx, opponentSeat(ctx), 1, "icevein")),
  "chilling icevein|2": fusedAttackWatcher("ice", "icevein", (ctx) => discardUnlessPay(ctx, opponentSeat(ctx), 1, "icevein")),
  "chilling icevein|3": fusedAttackWatcher("ice", "icevein", (ctx) => discardUnlessPay(ctx, opponentSeat(ctx), 1, "icevein")),
  "dazzling crescendo|1": fusedGoAgain("lightning"),
  "dazzling crescendo|2": fusedGoAgain("lightning"),
  "dazzling crescendo|3": fusedGoAgain("lightning"),
  "flake out|1": fusedDominate("ice"),
  "flake out|2": fusedDominate("ice"),
  "flake out|3": fusedDominate("ice"),
  "frazzle|1": {
    ...fusionOnly("lightning"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.addModifier({ scope: "until-end-of-turn", damage: 1, appliesTo: "attack" }); },
  },
  "frazzle|2": {
    ...fusionOnly("lightning"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.addModifier({ scope: "until-end-of-turn", damage: 1, appliesTo: "attack" }); },
  },
  "frazzle|3": {
    ...fusionOnly("lightning"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.addModifier({ scope: "until-end-of-turn", damage: 1, appliesTo: "attack" }); },
  },

  // Elemental Runeblade
  "explosive growth|1": {
    arcaneDamageEffect: true,
    ...fusionOnly("earth"),
    onAttackDeclared(ctx) { dealArcane(ctx, opponentSeat(ctx), 1); },
    onDamageDealt(ctx, _target, amount) { if (amount > 0 && isFused(ctx)) ctx.addModifier({ scope: "combat-chain", attack: 1 }); },
    canTriggerOnHit: isFused,
    onHit(ctx) { ctx.addModifier({ scope: "combat-chain", attack: 1 }); },
  },
  "explosive growth|2": {
    arcaneDamageEffect: true,
    ...fusionOnly("earth"),
    onAttackDeclared(ctx) { dealArcane(ctx, opponentSeat(ctx), 1); },
    onDamageDealt(ctx, _target, amount) { if (amount > 0 && isFused(ctx)) ctx.addModifier({ scope: "combat-chain", attack: 1 }); },
    canTriggerOnHit: isFused,
    onHit(ctx) { ctx.addModifier({ scope: "combat-chain", attack: 1 }); },
  },
  "explosive growth|3": {
    arcaneDamageEffect: true,
    ...fusionOnly("earth"),
    onAttackDeclared(ctx) { dealArcane(ctx, opponentSeat(ctx), 1); },
    onDamageDealt(ctx, _target, amount) { if (amount > 0 && isFused(ctx)) ctx.addModifier({ scope: "combat-chain", attack: 1 }); },
    canTriggerOnHit: isFused,
    onHit(ctx) { ctx.addModifier({ scope: "combat-chain", attack: 1 }); },
  },
  "rites of lightning|1": ritesOfLightning(),
  "rites of lightning|2": ritesOfLightning(),
  "rites of lightning|3": ritesOfLightning(),
  "arcanic shockwave|2": arcanicShockwave(),
  "arcanic shockwave|3": arcanicShockwave(),
  "vela flash|1": {
    ...fusionOnly("lightning"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.setFlag("player", "nextNonAttackAsInstant", true); },
  },
  "vela flash|2": {
    ...fusionOnly("lightning"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.setFlag("player", "nextNonAttackAsInstant", true); },
  },
  "vela flash|3": {
    ...fusionOnly("lightning"),
    onAttackDeclared(ctx) { if (isFused(ctx)) ctx.setFlag("player", "nextNonAttackAsInstant", true); },
  },
  "rites of replenishment|1": ritesOfReplenishment(),
  "rites of replenishment|2": ritesOfReplenishment(),
  "rites of replenishment|3": ritesOfReplenishment(),
  "stir the wildwood|1": {
    ...fusionOnly("earth"),
    modifyAttack(ctx) { return (isFused(ctx) ? 2 : 0) + (ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true ? 2 : 0); },
  },
  "stir the wildwood|2": {
    ...fusionOnly("earth"),
    modifyAttack(ctx) { return (isFused(ctx) ? 2 : 0) + (ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true ? 2 : 0); },
  },
  "stir the wildwood|3": {
    ...fusionOnly("earth"),
    modifyAttack(ctx) { return (isFused(ctx) ? 2 : 0) + (ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true ? 2 : 0); },
  },
  "bramble spark|1": brambleSpark(3),
  "bramble spark|2": brambleSpark(2),
  "bramble spark|3": brambleSpark(1),
  "inspire lightning|1": {
    arcaneDamageEffect: true,
    ...fusionOnly("lightning"),
    onPlay(ctx) { if (isFused(ctx)) dealArcane(ctx, opponentSeat(ctx), 3); },
  },
  "inspire lightning|2": {
    arcaneDamageEffect: true,
    ...fusionOnly("lightning"),
    onPlay(ctx) { if (isFused(ctx)) dealArcane(ctx, opponentSeat(ctx), 2); },
  },
  "inspire lightning|3": {
    arcaneDamageEffect: true,
    ...fusionOnly("lightning"),
    onPlay(ctx) { if (isFused(ctx)) dealArcane(ctx, opponentSeat(ctx), 1); },
  },

  // Elemental and Earth
  "entwine earth|1": fusedPower("earth", 2),
  "entwine earth|2": fusedPower("earth", 2),
  "entwine earth|3": fusedPower("earth", 2),
  "entwine ice|1": fusedDominate("ice"),
  "entwine ice|2": fusedDominate("ice"),
  "entwine ice|3": fusedDominate("ice"),
  "entwine lightning|2": fusedGoAgain("lightning"),
  "entwine lightning|3": fusedGoAgain("lightning"),
  "invigorate|1": {
    onPlay(ctx) { ctx.setCounter("invigorateArmed", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getCounter("invigorateArmed") || !(ctx.link?.attackingCard.counters?.fused ?? 0)) return;
      ctx.setCounter("invigorateArmed", 0);
      ctx.addModifier({ scope: "chain-link", attack: 4 });
    },
  },
  "invigorate|2": {
    onPlay(ctx) { ctx.setCounter("invigorateArmed", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getCounter("invigorateArmed") || !(ctx.link?.attackingCard.counters?.fused ?? 0)) return;
      ctx.setCounter("invigorateArmed", 0);
      ctx.addModifier({ scope: "chain-link", attack: 3 });
    },
  },
  "invigorate|3": {
    onPlay(ctx) { ctx.setCounter("invigorateArmed", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getCounter("invigorateArmed") || !(ctx.link?.attackingCard.counters?.fused ?? 0)) return;
      ctx.setCounter("invigorateArmed", 0);
      ctx.addModifier({ scope: "chain-link", attack: 2 });
    },
  },
  "rejuvenate|1": { playAsInstant: (ctx) => ctx.getFlag("player", "fusedThisTurn") === true, onPlay: (ctx) => ctx.gainLife(ctx.seat, 3) },
  "rejuvenate|2": { playAsInstant: (ctx) => ctx.getFlag("player", "fusedThisTurn") === true, onPlay: (ctx) => ctx.gainLife(ctx.seat, 2) },
  "rejuvenate|3": { playAsInstant: (ctx) => ctx.getFlag("player", "fusedThisTurn") === true, onPlay: (ctx) => ctx.gainLife(ctx.seat, 1) },
  "plume of evergrowth|0": {
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate(ctx) {
        return ctx.player(ctx.seat).graveyard.some((card) => {
          return hasType(ctx, card, "earth") &&
            (ctx.hasCardType(card, "action") || ctx.hasCardType(card, "instant"));
        });
      },
      onActivate(ctx) {
        const cards = ctx.player(ctx.seat).graveyard.filter((card) => {
          return hasType(ctx, card, "earth") &&
            (ctx.hasCardType(card, "action") || ctx.hasCardType(card, "instant"));
        });
        ctx.requestCardChoice("plume-return", "Plume of Evergrowth: return an Earth card to your hand", cards.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) { if (hook === "plume-return") ctx.moveToHand(Number(option)); },
  },
  "evergreen|1": {
    onAttackDeclared(ctx) { ctx.setCounter("evergreenArsenal", ctx.getFlag("link", "fromArsenal") === true ? 1 : 0); },
    graveyardReplacement: (ctx) => ctx.getCounter("evergreenArsenal") ? "bottom-of-deck" : undefined,
  },
  "evergreen|2": {
    onAttackDeclared(ctx) { ctx.setCounter("evergreenArsenal", ctx.getFlag("link", "fromArsenal") === true ? 1 : 0); },
    graveyardReplacement: (ctx) => ctx.getCounter("evergreenArsenal") ? "bottom-of-deck" : undefined,
  },
  "evergreen|3": {
    onAttackDeclared(ctx) { ctx.setCounter("evergreenArsenal", ctx.getFlag("link", "fromArsenal") === true ? 1 : 0); },
    graveyardReplacement: (ctx) => ctx.getCounter("evergreenArsenal") ? "bottom-of-deck" : undefined,
  },
  "weave earth|1": weave("earth", 3),
  "weave earth|2": weave("earth", 2),
  "weave earth|3": weave("earth", 1),
  "summerwood shelter|1": {
    onPlay(ctx) {
      const cards = ctx.link?.defendingCards.filter((card) =>
        ctx.hasCardType(card, "action") &&
        (hasType(ctx, card, "earth") || hasType(ctx, card, "elemental"))) ?? [];
      if (cards.length > 0) ctx.requestCardChoice("shelter", "Summerwood Shelter: choose a defending Earth or Elemental card", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "shelter") ctx.addCardTempDefense(Number(option), 4); },
  },
  "summerwood shelter|2": {
    onPlay(ctx) {
      const cards = ctx.link?.defendingCards.filter((card) =>
        ctx.hasCardType(card, "action") &&
        (hasType(ctx, card, "earth") || hasType(ctx, card, "elemental"))) ?? [];
      if (cards.length > 0) ctx.requestCardChoice("shelter", "Summerwood Shelter: choose a defending Earth or Elemental card", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "shelter") ctx.addCardTempDefense(Number(option), 3); },
  },
  "summerwood shelter|3": {
    onPlay(ctx) {
      const cards = ctx.link?.defendingCards.filter((card) =>
        ctx.hasCardType(card, "action") &&
        (hasType(ctx, card, "earth") || hasType(ctx, card, "elemental"))) ?? [];
      if (cards.length > 0) ctx.requestCardChoice("shelter", "Summerwood Shelter: choose a defending Earth or Elemental card", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "shelter") ctx.addCardTempDefense(Number(option), 2); },
  },
  "break ground|1": {
    onAttackDeclared(ctx) { const card = ctx.player(ctx.seat).arsenal[0]; if (card) ctx.requestCardChoice("break-ground", "Break Ground: bottom your arsenal and draw?", ["no", card.instanceId]); },
    onChoose(ctx, hook, option) { if (hook === "break-ground" && option !== "no" && ctx.putOnDeckBottom(Number(option))) ctx.drawCards(ctx.seat, 1); },
  },
  "break ground|2": {
    onAttackDeclared(ctx) { const card = ctx.player(ctx.seat).arsenal[0]; if (card) ctx.requestCardChoice("break-ground", "Break Ground: bottom your arsenal and draw?", ["no", card.instanceId]); },
    onChoose(ctx, hook, option) { if (hook === "break-ground" && option !== "no" && ctx.putOnDeckBottom(Number(option))) ctx.drawCards(ctx.seat, 1); },
  },
  "break ground|3": {
    onAttackDeclared(ctx) { const card = ctx.player(ctx.seat).arsenal[0]; if (card) ctx.requestCardChoice("break-ground", "Break Ground: bottom your arsenal and draw?", ["no", card.instanceId]); },
    onChoose(ctx, hook, option) { if (hook === "break-ground" && option !== "no" && ctx.putOnDeckBottom(Number(option))) ctx.drawCards(ctx.seat, 1); },
  },
  "burgeoning|1": { modifyAttack: (ctx) => ctx.getFlag("link", "fromArsenal") === true ? 1 : 0 },
  "burgeoning|2": { modifyAttack: (ctx) => ctx.getFlag("link", "fromArsenal") === true ? 1 : 0 },
  "burgeoning|3": { modifyAttack: (ctx) => ctx.getFlag("link", "fromArsenal") === true ? 1 : 0 },
  "earthlore surge|1": { onPlay: (ctx) => buffNextAttack(ctx, { attack: 5, appliesTo: "attack-action" }) },
  "earthlore surge|2": { onPlay: (ctx) => buffNextAttack(ctx, { attack: 4, appliesTo: "attack-action" }) },
  "earthlore surge|3": { onPlay: (ctx) => buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action" }) },
  "sow tomorrow|1": sowTomorrow(0),
  "sow tomorrow|2": sowTomorrow(1),
  "sow tomorrow|3": sowTomorrow(2),
  "amulet of earth|3": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("player", "earthFusedThisTurn") === true,
      onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, defense: 1, appliesToCardType: "action" }); },
    },
  },

  // Ice
  "coat of frost|0": {
    activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate: (ctx) => createFrostbites(ctx, opponentSeat(ctx)) },
  },
  "frost fang|1": {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) { discardUnlessPay(ctx, opponentSeat(ctx), 2, "frost-fang"); },
    onChoose(ctx, hook, option) { discardUnlessPayOnChoose(ctx, hook, option, "frost-fang"); },
  },
  "frost fang|2": {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) { discardUnlessPay(ctx, opponentSeat(ctx), 2, "frost-fang"); },
    onChoose(ctx, hook, option) { discardUnlessPayOnChoose(ctx, hook, option, "frost-fang"); },
  },
  "frost fang|3": {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) { discardUnlessPay(ctx, opponentSeat(ctx), 2, "frost-fang"); },
    onChoose(ctx, hook, option) { discardUnlessPayOnChoose(ctx, hook, option, "frost-fang"); },
  },
  "ice quake|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 3 }); ctx.setCounter("iceQuake", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("iceQuake") > 0 && ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { createFrostbites(ctx, opponentSeat(ctx)); },
  },
  "ice quake|2": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 2 }); ctx.setCounter("iceQuake", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("iceQuake") > 0 && ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { createFrostbites(ctx, opponentSeat(ctx)); },
  },
  "ice quake|3": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 1 }); ctx.setCounter("iceQuake", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("iceQuake") > 0 && ctx.link?.targetAllyId === undefined; },
    onHit(ctx) { createFrostbites(ctx, opponentSeat(ctx)); },
  },
  "weave ice|1": weave("ice", 3),
  "weave ice|2": weave("ice", 2),
  "weave ice|3": weave("ice", 1),
  "icy encounter|1": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit: (ctx) => { createFrostbites(ctx, opponentSeat(ctx)); } },
  "icy encounter|2": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit: (ctx) => { createFrostbites(ctx, opponentSeat(ctx)); } },
  "icy encounter|3": { canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit: (ctx) => { createFrostbites(ctx, opponentSeat(ctx)); } },
  "chill to the bone|1": {
    onPlay(ctx) { ctx.setCounter("chill", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("chill") > 0 && ctx.link?.targetAllyId === undefined && (ctx.currentAttackHasType("ice") || ctx.currentAttackHasType("elemental")); },
    onHit(ctx) { ctx.setCounter("chill", 0); createFrostbites(ctx, opponentSeat(ctx), 3); },
  },
  "chill to the bone|2": {
    onPlay(ctx) { ctx.setCounter("chill", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("chill") > 0 && ctx.link?.targetAllyId === undefined && (ctx.currentAttackHasType("ice") || ctx.currentAttackHasType("elemental")); },
    onHit(ctx) { ctx.setCounter("chill", 0); createFrostbites(ctx, opponentSeat(ctx), 2); },
  },
  "chill to the bone|3": {
    onPlay(ctx) { ctx.setCounter("chill", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("chill") > 0 && ctx.link?.targetAllyId === undefined && (ctx.currentAttackHasType("ice") || ctx.currentAttackHasType("elemental")); },
    onHit(ctx) { ctx.setCounter("chill", 0); createFrostbites(ctx, opponentSeat(ctx), 1); },
  },
  "polar blast|1": {
    onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); if (!ctx.requestPayment("polar-pay", "Polar Blast: pay 3 resources?", 3, opponentSeat(ctx))) buffNextAttack(ctx, { dominate: true }); },
    onChoose(ctx, hook, option) { if (hook === "polar-pay" && option !== "paid") buffNextAttack(ctx, { dominate: true }); },
  },
  "polar blast|2": {
    onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); if (!ctx.requestPayment("polar-pay", "Polar Blast: pay 2 resources?", 2, opponentSeat(ctx))) buffNextAttack(ctx, { dominate: true }); },
    onChoose(ctx, hook, option) { if (hook === "polar-pay" && option !== "paid") buffNextAttack(ctx, { dominate: true }); },
  },
  "polar blast|3": {
    onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); if (!ctx.requestPayment("polar-pay", "Polar Blast: pay 1 resource?", 1, opponentSeat(ctx))) buffNextAttack(ctx, { dominate: true }); },
    onChoose(ctx, hook, option) { if (hook === "polar-pay" && option !== "paid") buffNextAttack(ctx, { dominate: true }); },
  },
  "winter's bite|1": {
    onPlay(ctx) { discardUnlessPay(ctx, opponentSeat(ctx), 3, "winters-bite"); },
    onChoose(ctx, hook, option) { discardUnlessPayOnChoose(ctx, hook, option, "winters-bite"); },
  },
  "winter's bite|2": {
    onPlay(ctx) { discardUnlessPay(ctx, opponentSeat(ctx), 2, "winters-bite"); },
    onChoose(ctx, hook, option) { discardUnlessPayOnChoose(ctx, hook, option, "winters-bite"); },
  },
  "amulet of ice|3": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("player", "iceFusedThisTurn") === true,
      onActivate: (ctx) => discardUnlessPay(ctx, opponentSeat(ctx), 2, "amulet-ice"),
    },
    onChoose(ctx, hook, option) { discardUnlessPayOnChoose(ctx, hook, option, "amulet-ice"); },
  },

  // Lightning
  "mark of lightning|0": {
    triggers: [{
      event: "attack-defended",
      optional: true,
      label: "Destroy this to have the attack deal 1 damage to the defending hero?",
      condition(ctx) {
        return ctx.link?.flags.defendedFromHand === true &&
          (ctx.currentAttackHasType("lightning") || ctx.currentAttackHasType("elemental"));
      },
      effect(ctx) {
        const link = ctx.link;
        const stillControlled = Object.values(ctx.player(ctx.seat).equipment)
          .some((card) => card?.instanceId === ctx.self.instanceId);
        if (!link || !stillControlled) return;
        ctx.destroySelf();
        ctx.dealDamage(opponentSeat(ctx), 1, {
          sourceInstanceId: link.attackingCard.instanceId,
        });
      },
    }],
  },
  "flash|1": { onPlay: (ctx) => ctx.addModifier({ scope: "next-play", grantKeyword: "go again", appliesToCardType: "action", minCost: 0 }) },
  "flash|2": { onPlay: (ctx) => ctx.addModifier({ scope: "next-play", grantKeyword: "go again", appliesToCardType: "action", minCost: 1 }) },
  "flash|3": { onPlay: (ctx) => ctx.addModifier({ scope: "next-play", grantKeyword: "go again", appliesToCardType: "action", minCost: 2 }) },
  "weave lightning|2": weaveLightning(2),
  "weave lightning|3": weaveLightning(1),
  "lightning press|2": lightningPress(2),
  "lightning press|3": lightningPress(1),
  "ball lightning|1": {
    onAttackDeclared(ctx) { ctx.addModifier({ scope: "combat-chain", damage: 1, appliesToCardType: "action", appliesToType: ["lightning", "elemental"] }); },
  },
  "ball lightning|2": {
    onAttackDeclared(ctx) { ctx.addModifier({ scope: "combat-chain", damage: 1, appliesToCardType: "action", appliesToType: ["lightning", "elemental"] }); },
  },
  "ball lightning|3": {
    onAttackDeclared(ctx) { ctx.addModifier({ scope: "combat-chain", damage: 1, appliesToCardType: "action", appliesToType: ["lightning", "elemental"] }); },
  },
  "lightning surge|2": fromArsenalGoAgain(),
  "lightning surge|3": fromArsenalGoAgain(),
  "shock striker|1": {
    activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId, onActivate: (ctx) => ctx.setFlag("link", "shockStriker", true) },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "shockStriker") === true; },
    onHit(ctx) { ctx.dealDamage(opponentSeat(ctx), 1); },
  },
  "shock striker|2": {
    activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId, onActivate: (ctx) => ctx.setFlag("link", "shockStriker", true) },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "shockStriker") === true; },
    onHit(ctx) { ctx.dealDamage(opponentSeat(ctx), 1); },
  },
  "shock striker|3": {
    activated: { cost: 2, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, canActivate: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId, onActivate: (ctx) => ctx.setFlag("link", "shockStriker", true) },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "shockStriker") === true; },
    onHit(ctx) { ctx.dealDamage(opponentSeat(ctx), 1); },
  },
  "electrify|1": {
    onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); ctx.setCounter("electrify", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("electrify") > 0 && ctx.link?.targetAllyId === undefined && ctx.link?.attackCardType === "action"; },
    onHit(ctx) { ctx.setCounter("electrify", 0); ctx.dealDamage(opponentSeat(ctx), 3, { sourceInstanceId: ctx.link!.attackingCard.instanceId }); },
  },
  "electrify|2": {
    onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); ctx.setCounter("electrify", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("electrify") > 0 && ctx.link?.targetAllyId === undefined && ctx.link?.attackCardType === "action"; },
    onHit(ctx) { ctx.setCounter("electrify", 0); ctx.dealDamage(opponentSeat(ctx), 2, { sourceInstanceId: ctx.link!.attackingCard.instanceId }); },
  },
  "electrify|3": {
    onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); ctx.setCounter("electrify", 1); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.getCounter("electrify") > 0 && ctx.link?.targetAllyId === undefined && ctx.link?.attackCardType === "action"; },
    onHit(ctx) { ctx.setCounter("electrify", 0); ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: ctx.link!.attackingCard.instanceId }); },
  },
  "amulet of lightning|3": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate(ctx) {
        return ctx.getFlag("player", "lightningFusedThisTurn") === true &&
          (ctx.link?.attackCardType === "action" ||
            ctx.state.stack.some((layer) => layer.card && ctx.hasCardType(layer.card, "action")));
      },
      onActivate(ctx) {
        const ids = new Set<number>();
        if (ctx.link?.attackCardType === "action") ids.add(ctx.link.attackingCard.instanceId);
        for (const layer of ctx.state.stack) {
          if (layer.card && ctx.hasCardType(layer.card, "action")) ids.add(layer.card.instanceId);
        }
        ctx.requestCardChoice("amulet-lightning", "Amulet of Lightning: choose an action card to gain go again", [...ids]);
      },
    },
    onChoose(ctx, hook, option) { if (hook === "amulet-lightning") ctx.grantCardKeyword(Number(option), "go again"); },
  },

  // Class and generic equipment / attacks
  "embolden|1": {
    onEnterArena(ctx) {
      if (ctx.player(ctx.seat).board.some((card) => card.instanceId !== ctx.self.instanceId && ctx.cardData(card.cardId).cardType !== "token" && hasType(ctx, card, "aura"))) ctx.drawCards(ctx.seat, 1);
    },
    triggers: [{ event: "begin-action-phase", label: "Destroy Embolden — next Guardian attack gets +5 power", effect(ctx) { ctx.destroySelf(); buffNextAttack(ctx, { attack: 5, appliesTo: "attack-action", appliesToClass: "guardian" }); } }],
  },
  "embolden|2": {
    onEnterArena(ctx) {
      if (ctx.player(ctx.seat).board.some((card) => card.instanceId !== ctx.self.instanceId && ctx.cardData(card.cardId).cardType !== "token" && hasType(ctx, card, "aura"))) ctx.drawCards(ctx.seat, 1);
    },
    triggers: [{ event: "begin-action-phase", label: "Destroy Embolden — next Guardian attack gets +4 power", effect(ctx) { ctx.destroySelf(); buffNextAttack(ctx, { attack: 4, appliesTo: "attack-action", appliesToClass: "guardian" }); } }],
  },
  "embolden|3": {
    onEnterArena(ctx) {
      if (ctx.player(ctx.seat).board.some((card) => card.instanceId !== ctx.self.instanceId && ctx.cardData(card.cardId).cardType !== "token" && hasType(ctx, card, "aura"))) ctx.drawCards(ctx.seat, 1);
    },
    triggers: [{ event: "begin-action-phase", label: "Destroy Embolden — next Guardian attack gets +3 power", effect(ctx) { ctx.destroySelf(); buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action", appliesToClass: "guardian" }); } }],
  },
  "thump|1": {
    onAttackDeclared(ctx) { if (ctx.attackBonusAboveBase(ctx.self.instanceId) > 0) { ctx.addModifier({ scope: "chain-link", dominate: true }); ctx.setFlag("link", "thumpDiscard", true); } },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "thumpDiscard") === true; },
    onHit(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length > 0) ctx.requestCardChoice("thump-discard", "Thump: choose a card to discard", hand.map((card) => card.instanceId), opponentSeat(ctx)); },
    onChoose(ctx, hook, option) { if (hook === "thump-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "thump|2": {
    onAttackDeclared(ctx) { if (ctx.attackBonusAboveBase(ctx.self.instanceId) > 0) { ctx.addModifier({ scope: "chain-link", dominate: true }); ctx.setFlag("link", "thumpDiscard", true); } },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "thumpDiscard") === true; },
    onHit(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length > 0) ctx.requestCardChoice("thump-discard", "Thump: choose a card to discard", hand.map((card) => card.instanceId), opponentSeat(ctx)); },
    onChoose(ctx, hook, option) { if (hook === "thump-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "thump|3": {
    onAttackDeclared(ctx) { if (ctx.attackBonusAboveBase(ctx.self.instanceId) > 0) { ctx.addModifier({ scope: "chain-link", dominate: true }); ctx.setFlag("link", "thumpDiscard", true); } },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("link", "thumpDiscard") === true; },
    onHit(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; if (hand.length > 0) ctx.requestCardChoice("thump-discard", "Thump: choose a card to discard", hand.map((card) => card.instanceId), opponentSeat(ctx)); },
    onChoose(ctx, hook, option) { if (hook === "thump-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "honing hood|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.player(ctx.seat).arsenal.length > 0,
      onActivate(ctx) {
        for (const card of [...ctx.player(ctx.seat).arsenal]) ctx.moveToHand(card.instanceId);
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length > 0) ctx.requestCardChoice("honing-arsenal", "Honing Hood: put a card face down into arsenal", hand.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) { if (hook === "honing-arsenal") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false }); },
  },
  "bolt'n' shot|2": boltNShot(),
  "bolt'n' shot|3": boltNShot(),
  "over flex|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesTo: "attack-action", appliesToSubtype: "arrow" }); reload(ctx, "over-flex-reload"); },
    onChoose(ctx, hook, option) { reloadOnChoose(ctx, hook, option, "over-flex-reload"); },
  },
  "over flex|2": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action", appliesToSubtype: "arrow" }); reload(ctx, "over-flex-reload"); },
    onChoose(ctx, hook, option) { reloadOnChoose(ctx, hook, option, "over-flex-reload"); },
  },
  "over flex|3": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 2, appliesTo: "attack-action", appliesToSubtype: "arrow" }); reload(ctx, "over-flex-reload"); },
    onChoose(ctx, hook, option) { reloadOnChoose(ctx, hook, option, "over-flex-reload"); },
  },
  "sutcliffe's suede hides|0": {
    activated: { cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, canActivate: (ctx) => ctx.getFlag("player", "playedNonAttackAction") === true && ctx.link?.attackCardType === "action", onActivate: (ctx) => ctx.grantGoAgain() },
  },
  "sigil of suffering|2": sigilOfSuffering(),
  "sigil of suffering|3": sigilOfSuffering(),
  "singeing steelblade|1": { arcaneDamageEffect: true, onAttackDeclared: (ctx) => { dealArcane(ctx, opponentSeat(ctx), 1); } },
  "singeing steelblade|2": { arcaneDamageEffect: true, onAttackDeclared: (ctx) => { dealArcane(ctx, opponentSeat(ctx), 1); } },
  "singeing steelblade|3": { arcaneDamageEffect: true, onAttackDeclared: (ctx) => { dealArcane(ctx, opponentSeat(ctx), 1); } },
  "ragamuffin's hat|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.length === 1,
      onActivate(ctx) {
        ctx.drawCards(ctx.seat, 1);
        const hand = ctx.player(ctx.seat).hand;
        ctx.requestChoice(
          "ragamuffin-place",
          "Ragamuffin's Hat: put a card on the top or bottom of your deck",
          hand.flatMap((card) => [`top:${card.instanceId}`, `bottom:${card.instanceId}`]),
          undefined,
          hand.flatMap((card) => [card.instanceId, card.instanceId]),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ragamuffin-place") return;
      const [where, id] = option.split(":");
      if (where === "top") ctx.putOnDeckTop(Number(id));
      else ctx.putOnDeckBottom(Number(id));
    },
  },
  "deep blue|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.length > 0,
      onActivate(ctx) { ctx.requestCardChoice("deep-blue-bottom", "Deep Blue: put a card from hand on the bottom", ctx.player(ctx.seat).hand.map((card) => card.instanceId)); },
    },
    onChoose(ctx, hook, option) { if (hook === "deep-blue-bottom" && ctx.putOnDeckBottom(Number(option))) ctx.changeResources(ctx.seat, 3); },
  },
  "cracker jax|0": {
    activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate: (ctx) => buffNextAttack(ctx, { attack: 1, appliesTo: "attack-action" }) },
  },
  "runaways|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => ctx.getFlag("player", "damageTakenThisTurn") === true, onActivate: (ctx) => ctx.preventNextDamage(ctx.seat, 1) },
  },
});
