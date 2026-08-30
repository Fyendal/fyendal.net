import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, nextAttack, opponentSeat, requestDiscardChoice, resolveDiscardChoice } from "../shared-helpers.js";

// ── WTR generic class cards ─────────────────────────────────────────────────
//
// These are the generic (class = "generic") cards from Welcome to Rathe that
// need scripted behaviour beyond the engine's keyword handling.

const QUICKEN_TOKEN_ID = "DVR028";




function cardInGraveyard(ctx: ScriptCtx, name: string): { readonly instanceId: number; readonly cardId: string } | undefined {
  return ctx.player(ctx.seat).graveyard.find(
    (c) => ctx.cardData(c.cardId).name.toLowerCase() === name.toLowerCase(),
  );
}

function currentLinkData(ctx: ScriptCtx) {
  const link = ctx.link;
  if (!link) return undefined;
  return { link, data: ctx.cardData(link.attackingCard.cardId) };
}

function isWeaponAttackOfSubtype(ctx: ScriptCtx, subtypes: string[]): boolean {
  const cur = currentLinkData(ctx);
  if (!cur || cur.link.attackCardType !== "weapon") return false;
  const weaponSubtypes = ctx.cardTypes(cur.link.attackingCard);
  return subtypes.some((s) => weaponSubtypes.includes(s));
}

function isAttackActionWithCost(ctx: ScriptCtx, predicate: (cost: number) => boolean): boolean {
  const cur = currentLinkData(ctx);
  if (!cur || cur.link.attackCardType !== "action") return false;
  return predicate(cur.data.cost ?? 0);
}

/** Move a card from hand to the bottom of the deck and draw a card. */
function bottomHandCardAndDraw(ctx: ScriptCtx, instanceId: number): void {
  if (!ctx.putOnDeckBottom(instanceId)) return;
  ctx.drawCards(ctx.seat, 1);
}

// ── Barraging Brawnhide ─────────────────────────────────────────────────────

const brawnhideScript = (): CardScript => ({
  modifyAttack(ctx) {
    if (!ctx.link) return 0;
    return ctx.link.defendingCards.length < 2 ? 1 : 0;
  },
});

// ── Demolition Crew ─────────────────────────────────────────────────────────

const demolitionCrewScript = (): CardScript => ({
  canPlay(ctx) {
    const reveal = ctx.player(ctx.seat).hand.find(
      (c) => c.instanceId !== ctx.self.instanceId && (ctx.cardData(c.cardId).cost ?? 0) >= 2,
    );
    if (reveal) {
      ctx.setCounter("revealTarget", reveal.instanceId);
    }
    return !!reveal;
  },
  additionalCost(ctx) {
    const p = ctx.player(ctx.seat);
    const targetId = ctx.getCounter("revealTarget");
    const reveal =
      p.hand.find((c) => c.instanceId === targetId) ??
      p.pitch.find((c) => c.instanceId === targetId);
    if (reveal) {
      ctx.logPublic(`${ctx.data.name}: reveals ${ctx.cardData(reveal.cardId).name} (cost 2 or greater)`);
    }
    // Grant dominate to the next attack action — which is this attack.
    buffNextAttack(ctx, { dominate: true, appliesTo: "attack-action" });
  },
});

// ── Drone of Brutality ──────────────────────────────────────────────────────

const droneOfBrutalityScript = (): CardScript => ({
  graveyardReplacement: "bottom-of-deck",
});

// ── Crazy Brew ─────────────────────────────────────────────────────────────

const crazyBrewScript = (): CardScript => ({
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    destroySelfCost: true,
    label: "Destroy: roll a 6 sided die",
    onActivate(ctx) {
      ctx.requestDieRoll("crazy-brew", 6);
    },
  },
  onDieRollResolved(ctx, hook, roll) {
    if (hook !== "crazy-brew") return;
      ctx.logPublic(`${ctx.data.name}: rolled ${roll}`);
      if (roll <= 2) {
        ctx.loseLife(ctx.seat, 2);
        ctx.gainActionPoint();
      } else if (roll <= 4) {
        ctx.gainLife(ctx.seat, 2);
        ctx.gainActionPoint();
      } else {
        ctx.changeResources(ctx.seat, 2);
        ctx.changeActionPoints(ctx.seat, 2);
        buffNextAttack(ctx, { attack: 2 });
      }
  },
});

// ── Energy Potion ───────────────────────────────────────────────────────────

const energyPotionScript = (): CardScript => ({
  // item: enters the board when played; destroy at instant speed for {r}{r}
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    onActivate(ctx) {
      ctx.changeResources(ctx.seat, 2);
      ctx.logPublic(`${ctx.data.name}: gained {r}{r}`);
      ctx.destroySelf();
    },
  },
});

// ── Flock of the Feather Walkers ────────────────────────────────────────────

const flockScript = (): CardScript => {
  const revealable = (ctx: ScriptCtx) => (c: { readonly instanceId: number; readonly cardId: string }) =>
    c.instanceId !== ctx.self.instanceId && (ctx.cardData(c.cardId).cost ?? 99) <= 1;
  return {
    canPlay(ctx) {
      const reveal = ctx.player(ctx.seat).hand.find(revealable(ctx));
      if (reveal) {
        ctx.setCounter("revealTarget", reveal.instanceId);
      }
      return !!reveal;
    },
    additionalCost(ctx) {
      const p = ctx.player(ctx.seat);
      const targetId = ctx.getCounter("revealTarget");
      const reveal =
        p.hand.find((c) => c.instanceId === targetId) ??
        p.pitch.find((c) => c.instanceId === targetId);
      if (reveal) ctx.logPublic(`${ctx.data.name}: reveals ${ctx.cardData(reveal.cardId).name} (cost 1 or less)`);
    },
    onAttackDeclared(ctx) {
      ctx.createToken(QUICKEN_TOKEN_ID);
    },
  };
};

// ── Goliath Gauntlet ────────────────────────────────────────────────────────

const goliathGauntletScript = (): CardScript => ({
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: true,
    onActivate(ctx) {
      buffNextAttack(ctx, { attack: 2, appliesTo: "attack-action", minCost: 2 });
      ctx.logPublic(`${ctx.data.name}: next attack action with cost 2 or greater gains +2 attack`);
      ctx.destroySelf();
    },
  },
});

// ── Heartened Cross Strap ───────────────────────────────────────────────────

const heartenedCrossStrapScript = (): CardScript => ({
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: true,
    onActivate(ctx) {
      ctx.setFlag("player", "nextActionCostReduction", 2);
      ctx.logPublic(`${ctx.data.name}: the next attack action card you play this turn costs {r}{r} less`);
      ctx.destroySelf();
    },
  },
});

// ── Hope Merchant's Hood ────────────────────────────────────────────────────

const hopeMerchantsHoodScript = (): CardScript => ({
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    onActivate(ctx) {
      ctx.destroySelf();
      const p = ctx.player(ctx.seat);
      if (p.hand.length === 0) return;
      ctx.requestCardChoice(
        "hood-shuffle",
        "Hope Merchant's Hood: shuffle a card from your hand into your deck? (or done)",
        [...p.hand.map((c) => c.instanceId), "done"],
      );
    },
  },
  onChoose(ctx, hook, option) {
    if (hook !== "hood-shuffle") return;
    const p = ctx.player(ctx.seat);
    if (option !== "done") {
      const idx = p.hand.findIndex((c) => c.instanceId === Number(option));
      if (idx >= 0) {
        const card = p.hand[idx]!;
        ctx.putOnDeckBottom(card.instanceId);
        ctx.setCounter("hoodCount", ctx.getCounter("hoodCount") + 1);
        ctx.logPrivate(
          ctx.seat,
          `${ctx.data.name}: put ${ctx.cardData(card!.cardId).name} into the deck`,
          `${ctx.data.name}: put a card into the deck`,
        );
      }
      if (p.hand.length > 0) {
        ctx.requestCardChoice(
          "hood-shuffle",
          "Hope Merchant's Hood: shuffle another card into your deck? (or done)",
          [...p.hand.map((c) => c.instanceId), "done"],
        );
        return;
      }
    }
    const n = ctx.getCounter("hoodCount");
    if (n > 0) {
      ctx.shuffleDeck();
      ctx.drawCards(ctx.seat, n);
      ctx.logPublic(`${ctx.data.name}: shuffled ${n} card(s) in and drew ${n}`);
    }
  },
});

// ── Nimble Strike ───────────────────────────────────────────────────────────

const nimbleStrikeScript = (): CardScript => ({
  additionalCost(ctx) {
    const nimblism = cardInGraveyard(ctx, "Nimblism");
    if (!nimblism) return;
      if (ctx.banish(nimblism.instanceId)) {
      ctx.setCounter("nimblismBanished", 1);
      ctx.logPublic(`${ctx.data.name}: banishes Nimblism from graveyard`);
    }
  },
  modifyAttack(ctx) {
    return ctx.getCounter("nimblismBanished") ? 1 : 0;
  },
  onAttackDeclared(ctx) {
    if (ctx.getCounter("nimblismBanished")) {
      ctx.grantGoAgain();
      ctx.logPublic(`${ctx.data.name}: gains go again`);
    }
  },
});

// ── Nimblism ────────────────────────────────────────────────────────────────

const nimblismScript = (buff: number): CardScript => ({
  onPlay: nextAttack({ attack: buff, appliesTo: "attack-action", maxCost: 1 }),
});

// ── Potion of Strength ──────────────────────────────────────────────────────

const potionOfStrengthScript = (): CardScript => ({
  // item: enters the board when played; destroy as an action for +2 next attack
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: true,
    onActivate(ctx) {
      nextAttack({ attack: 2 })(ctx);
      ctx.destroySelf();
    },
  },
});

// ── Pummel ──────────────────────────────────────────────────────────────────

const pummelScript = (buff: number): CardScript => ({
  canPlay(ctx) {
    return (
      isWeaponAttackOfSubtype(ctx, ["club", "hammer"]) ||
      isAttackActionWithCost(ctx, (cost) => cost >= 2)
    );
  },
  additionalCost(ctx) {
    const canClubHammer = isWeaponAttackOfSubtype(ctx, ["club", "hammer"]);
    const canBigAttack = isAttackActionWithCost(ctx, (cost) => cost >= 2);
    if (canClubHammer && canBigAttack) {
      ctx.requestChoice("pummel-mode", "Choose a Pummel mode:", ["club/hammer weapon", "attack action discard"]);
    }
  },
  onPlay(ctx) {
    const canClubHammer = isWeaponAttackOfSubtype(ctx, ["club", "hammer"]);
    const canBigAttack = isAttackActionWithCost(ctx, (cost) => cost >= 2);

    const selectedMode = ctx.getCounter("pummelMode");
    if (canClubHammer && canBigAttack && selectedMode === 1) {
      applyPummelClubHammer(ctx, buff);
    } else if (canClubHammer && canBigAttack && selectedMode === 2) {
      applyPummelDiscard(ctx, buff);
    } else if (canClubHammer && !canBigAttack) {
      applyPummelClubHammer(ctx, buff);
    } else if (canBigAttack && !canClubHammer) {
      applyPummelDiscard(ctx, buff);
    }
  },
  onChoose(ctx, hook, option) {
    if (hook === "pummel-discard") {
      resolveDiscardChoice(ctx, option, opponentSeat(ctx));
      return;
    }
    if (hook !== "pummel-mode") return;
    ctx.setCounter("pummelMode", option === "club/hammer weapon" ? 1 : 2);
  },
  canTriggerOnHit(ctx) {
    return ctx.getFlag("link", "pummelDiscardMode") === true && ctx.link?.targetAllyId === undefined;
  },
  onHit(ctx) {
    // The discard mode is tracked on the combat link so it only affects the
    // attack Pummel was played on.
    requestDiscardChoice(ctx, "pummel-discard", "Choose a card to discard", opponentSeat(ctx));
  },
});

function applyPummelClubHammer(ctx: ScriptCtx, buff: number): void {
  ctx.addModifier({ scope: "chain-link", attack: buff });
  ctx.logPublic(`${ctx.data.name}: club/hammer weapon gains +${buff} attack`);
}

function applyPummelDiscard(ctx: ScriptCtx, buff: number): void {
  ctx.addModifier({ scope: "chain-link", attack: buff });
  // The until-end-of-turn marker is needed so the engine calls this reaction
  // card's onHit hook when the attack resolves. The link flag keeps the effect
  // tied to the attack Pummel was actually played on.
  ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "attack-action" });
  ctx.setFlag("link", "pummelDiscardMode", true);
  ctx.logPublic(`${ctx.data.name}: attack action gains +${buff} attack and "when this hits, discard"`);
}

// ── Razor Reflex ────────────────────────────────────────────────────────────

const razorReflexScript = (buff: number): CardScript => ({
  canPlay(ctx) {
    return (
      isWeaponAttackOfSubtype(ctx, ["dagger", "sword"]) ||
      isAttackActionWithCost(ctx, (cost) => cost <= 1)
    );
  },
  additionalCost(ctx) {
    const canDaggerSword = isWeaponAttackOfSubtype(ctx, ["dagger", "sword"]);
    const canSmallAttack = isAttackActionWithCost(ctx, (cost) => cost <= 1);
    if (canDaggerSword && canSmallAttack) {
      ctx.requestChoice("razor-mode", "Choose a Razor Reflex mode:", ["dagger/sword weapon", "cheap attack action go again"]);
    }
  },
  onPlay(ctx) {
    const canDaggerSword = isWeaponAttackOfSubtype(ctx, ["dagger", "sword"]);
    const canSmallAttack = isAttackActionWithCost(ctx, (cost) => cost <= 1);

    const selectedMode = ctx.getCounter("razorMode");
    if (canDaggerSword && canSmallAttack && selectedMode === 1) {
      applyRazorWeapon(ctx, buff);
    } else if (canDaggerSword && canSmallAttack && selectedMode === 2) {
      applyRazorGoAgain(ctx, buff);
    } else if (canDaggerSword && !canSmallAttack) {
      applyRazorWeapon(ctx, buff);
    } else if (canSmallAttack && !canDaggerSword) {
      applyRazorGoAgain(ctx, buff);
    }
  },
  onChoose(ctx, hook, option) {
    if (hook !== "razor-mode") return;
    ctx.setCounter("razorMode", option === "dagger/sword weapon" ? 1 : 2);
  },
});

function applyRazorWeapon(ctx: ScriptCtx, buff: number): void {
  ctx.addModifier({ scope: "chain-link", attack: buff });
  ctx.logPublic(`${ctx.data.name}: dagger/sword weapon gains +${buff} attack`);
}

function applyRazorGoAgain(ctx: ScriptCtx, buff: number): void {
  ctx.addModifier({ scope: "chain-link", attack: buff, onHitGoAgain: true, appliesTo: "attack-action" });
  ctx.logPublic(`${ctx.data.name}: cheap attack action gains +${buff} attack and on-hit go again`);
}

// ── Regurgitating Slog ──────────────────────────────────────────────────────

const regurgitatingSlogScript = (): CardScript => ({
  additionalCost(ctx) {
    const sloggism = cardInGraveyard(ctx, "Sloggism");
    if (!sloggism) return;
      if (ctx.banish(sloggism.instanceId)) {
      ctx.setCounter("sloggismBanished", 1);
      ctx.logPublic(`${ctx.data.name}: banishes Sloggism from graveyard`);
    }
  },
  onAttackDeclared(ctx) {
    if (ctx.getCounter("sloggismBanished")) {
      buffNextAttack(ctx, { dominate: true, appliesTo: "attack-action" });
      ctx.logPublic(`${ctx.data.name}: gains dominate`);
    }
  },
});

// ── Scar for a Scar ─────────────────────────────────────────────────────────

const scarForAScarScript = (): CardScript => ({
  triggers: [{
    event: "card-played",
    sourceZone: "self",
    label: "Gain go again",
    condition: (ctx) => ctx.player(ctx.seat).life < ctx.player(opponentSeat(ctx)).life,
    effect(ctx, played) {
      if (!played) return;
      ctx.grantGoAgain(played.instanceId);
      ctx.logPublic(`${ctx.data.name}: gains go again (less life than opponent)`);
    },
  }],
});

// ── Scour the Battlescape ───────────────────────────────────────────────────

const scourScript = (): CardScript => ({
  canPlay(ctx) {
    // Remember whether this copy is being played from arsenal so we can grant
    // go again during attack declaration. Counters persist on the card while
    // it leaves its zone, unlike player/link flags.
    const fromArsenal = ctx.player(ctx.seat).arsenal.includes(ctx.self);
    ctx.setCounter("fromArsenal", fromArsenal ? 1 : 0);
    return true;
  },
  onAttackDeclared(ctx) {
    if (ctx.getCounter("fromArsenal")) {
      ctx.grantGoAgain();
      ctx.logPublic(`${ctx.data.name}: gains go again (played from arsenal)`);
    }
    const p = ctx.player(ctx.seat);
    const options: (number | string)[] = ["pass", ...p.hand.map((c) => c.instanceId)];
    ctx.requestCardChoice("scour-bottom", "Put a card from hand on the bottom of your deck?", options);
  },
  onChoose(ctx, hook, option) {
    if (hook !== "scour-bottom" || option === "pass") return;
    bottomHandCardAndDraw(ctx, Number(option));
    ctx.logPublic(`${ctx.data.name}: put a card on the bottom and drew a card`);
  },
});

// ── Sigil of Solace ─────────────────────────────────────────────────────────

const sigilOfSolaceScript = (life: number): CardScript => ({
  onPlay(ctx) {
    ctx.gainLife(ctx.seat, life);
  },
});

// ── Sink Below ──────────────────────────────────────────────────────────────

const sinkBelowScript = (): CardScript => ({
  onPlay(ctx) {
    const p = ctx.player(ctx.seat);
    const options: (number | string)[] = ["pass", ...p.hand.map((c) => c.instanceId)];
    ctx.requestCardChoice("sink-bottom", "Put a card from hand on the bottom of your deck?", options);
  },
  onChoose(ctx, hook, option) {
    if (hook !== "sink-bottom" || option === "pass") return;
    bottomHandCardAndDraw(ctx, Number(option));
    ctx.logPublic(`${ctx.data.name}: put a card on the bottom and drew a card`);
  },
});

// ── Sloggism ────────────────────────────────────────────────────────────────

const sloggismScript = (buff: number): CardScript => ({
  onPlay: nextAttack({ attack: buff, appliesTo: "attack-action", minCost: 2 }),
});

// ── Snapdragon Scalers ──────────────────────────────────────────────────────

const snapdragonScalersScript = (): CardScript => ({
  // equipment attack reaction: destroy to give a cheap attack action go again
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "attack-reaction",
    destroySelfCost: true,
    canActivate(ctx) {
      const link = ctx.state.chain[ctx.state.chain.length - 1];
      if (!link || link.resolved || link.attackCardType !== "action") return false;
      return (ctx.cardData(link.attackingCard.cardId).cost ?? 99) <= 1;
    },
    onActivate(ctx) {
      ctx.grantGoAgain();
      ctx.logPublic(`${ctx.data.name}: target attack action gains go again`);
    },
  },
});

// ── Snatch ──────────────────────────────────────────────────────────────────

const snatchScript = (): CardScript => ({
  onHit(ctx) {
    ctx.drawCards(ctx.seat, 1);
  },
});

// ── Timesnap Potion ─────────────────────────────────────────────────────────

const timesnapPotionScript = (): CardScript => ({
  // item: enters the board when played; destroy as an action for 2 action points
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    onActivate(ctx) {
      ctx.changeActionPoints(ctx.seat, 2);
      ctx.logPublic(`${ctx.data.name}: gained 2 action points`);
      ctx.destroySelf();
    },
  },
});

// ── Unmovable ───────────────────────────────────────────────────────────────

const unmovableScript = (): CardScript => ({
  onPlay(ctx) {
    if (ctx.fromArsenal) {
      ctx.addModifier({ scope: "chain-link", defense: 1 });
      ctx.logPublic(`${ctx.data.name}: +1 defense (played from arsenal)`);
    }
  },
});

// ── Wounded Bull ────────────────────────────────────────────────────────────

const woundedBullScript = (): CardScript => ({
  triggers: [{
    event: "card-played",
    sourceZone: "self",
    label: "Gain +1 attack",
    condition: (ctx) => ctx.player(ctx.seat).life < ctx.player(opponentSeat(ctx)).life,
    effect(ctx, played) { if (played) ctx.addCardTempPower(played.instanceId, 1); },
  }],
});

// ── exported registry ───────────────────────────────────────────────────────

export const generic: Record<string, CardScript> = {
  "barraging brawnhide|1": brawnhideScript(),
  "barraging brawnhide|2": brawnhideScript(),
  "barraging brawnhide|3": brawnhideScript(),

  "demolition crew|1": demolitionCrewScript(),
  "demolition crew|2": demolitionCrewScript(),
  "demolition crew|3": demolitionCrewScript(),

  "crazy brew|3": crazyBrewScript(),

  "drone of brutality|1": droneOfBrutalityScript(),
  "drone of brutality|2": droneOfBrutalityScript(),
  "drone of brutality|3": droneOfBrutalityScript(),

  "energy potion|3": energyPotionScript(),

  "flock of the feather walkers|2": flockScript(),
  "flock of the feather walkers|3": flockScript(),

  "goliath gauntlet|0": goliathGauntletScript(),
  "heartened cross strap|0": heartenedCrossStrapScript(),
  "hope merchant's hood|0": hopeMerchantsHoodScript(),

  "nimble strike|1": nimbleStrikeScript(),
  "nimble strike|2": nimbleStrikeScript(),
  "nimble strike|3": nimbleStrikeScript(),

  "nimblism|1": nimblismScript(3),
  "nimblism|2": nimblismScript(2),
  "nimblism|3": nimblismScript(1),

  "potion of strength|3": potionOfStrengthScript(),

  "pummel|1": pummelScript(4),
  "pummel|2": pummelScript(3),
  "pummel|3": pummelScript(2),

  "razor reflex|1": razorReflexScript(3),
  "razor reflex|2": razorReflexScript(2),
  "razor reflex|3": razorReflexScript(1),

  "regurgitating slog|1": regurgitatingSlogScript(),
  "regurgitating slog|2": regurgitatingSlogScript(),
  "regurgitating slog|3": regurgitatingSlogScript(),

  "scar for a scar|1": scarForAScarScript(),
  "scar for a scar|2": scarForAScarScript(),
  "scar for a scar|3": scarForAScarScript(),

  "scour the battlescape|1": scourScript(),
  "scour the battlescape|2": scourScript(),
  "scour the battlescape|3": scourScript(),

  "sigil of solace|1": sigilOfSolaceScript(3),
  "sigil of solace|2": sigilOfSolaceScript(2),

  "sink below|1": sinkBelowScript(),
  "sink below|2": sinkBelowScript(),
  "sink below|3": sinkBelowScript(),

  "sloggism|1": sloggismScript(6),
  "sloggism|2": sloggismScript(5),
  "sloggism|3": sloggismScript(4),

  "snapdragon scalers|0": snapdragonScalersScript(),

  "snatch|1": snatchScript(),
  "snatch|2": snatchScript(),
  "snatch|3": snatchScript(),

  "timesnap potion|3": timesnapPotionScript(),

  "unmovable|1": unmovableScript(),
  "unmovable|2": unmovableScript(),
  "unmovable|3": unmovableScript(),

  "wounded bull|1": woundedBullScript(),
  "wounded bull|3": woundedBullScript(),
};
