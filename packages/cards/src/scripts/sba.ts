import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, commonOptionMessages, dealArcane, decisionPrompt, isWeaponAttack, localizedCardLog, nextAttack, opponentSeat } from "./shared-helpers.js";

// ── SBA (Silver Age: Briar precon) ──────────────────────────────────────────
//
// Elemental Runeblade cards. New mechanics used here:
// - arcane damage + Arcane Barrier (engine: dealEffectDamage/answerArcaneBarrier)
// - Lightning Fusion (optional additional cost: reveal a Lightning card)
// - Meld split cards (side announced at play time, riding the intent —
//   engine: CardScript.meld + CardInstance.meldSide; "both" costs twice the
//   base cost, though both SBA splits cost 0)
// - Guardwell (engine keyword), Quickstrike / Lightning Flow (label keywords)

const EMBODIMENT_OF_EARTH = "SBA034";
const EMBODIMENT_OF_LIGHTNING = "SBA035";
const RUNECHANT = "SBA036";




// dealArcane comes from shared-helpers (applies the "next arcane card +N" pool)

/** "if you've played a Lightning card this turn" */
function playedLightning(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "playedSubtype:lightning") === true;
}

function isFused(ctx: ScriptCtx): boolean {
  return ctx.getCounter("fused") > 0;
}

/** Name-only identity check (any pitch variant — "a Nimblism"). */
function isNamed(ctx: ScriptCtx, cardId: string, name: string): boolean {
  return ctx.cardData(cardId).name.trim().toLowerCase() === name.toLowerCase();
}

// ── Fusion ──────────────────────────────────────────────────────────────────

/** Lightning Fusion: optional additional cost — reveal a Lightning card from
 *  hand; the played card becomes fused (8.3.17). The play pauses on the
 *  choice and resumes via finishPlayCard. */
function fusionAdditionalCost(supertype: string) {
  return (ctx: ScriptCtx) => {
    const matches = ctx.player(ctx.seat).hand.filter((c) =>
      ctx.cardTypes(c).includes(supertype.toLowerCase()),
    );
    if (matches.length === 0) return;
    ctx.requestCardChoice(
      "fusion",
      decisionPrompt(`${ctx.data.name}: reveal a ${supertype} card from your hand to fuse?`, "card.sba.fusion.reveal", {
        values: { card: { kind: "card", cardId: ctx.self.cardId }, type: supertype },
        optionMessages: commonOptionMessages("no"),
      }),
      [...matches.map((c) => c.instanceId), "no"],
    );
  };
}

function fusionOnChoose(ctx: ScriptCtx, hook: string, option: string): void {
  if (hook !== "fusion" || option === "no") return;
  const card = ctx.player(ctx.seat).hand.find((c) => c.instanceId === Number(option));
  if (!card) return;
  ctx.setCounter("fused", 1);
  ctx.setFlag("player", "fusedThisTurn", true);
  for (const type of ["earth", "ice", "lightning"] as const) {
    if (ctx.cardTypes(card).includes(type)) {
      ctx.setFlag("player", `${type}FusedThisTurn`, true);
    }
  }
  ctx.logPublic(localizedCardLog(
    ctx,
    `${ctx.data.name} is fused (reveals ${ctx.cardData(card.cardId).name})`,
    "card.log.common.fusion.revealed",
    { revealed: { kind: "card", cardId: card.cardId } },
    { kind: "cards-revealed", cards: [{ cardId: card.cardId, ownerSeat: ctx.seat }], sourceZone: "hand" },
  ));
}

// ── Meld split cards ────────────────────────────────────────────────────────

interface SplitSides {
  leftName: string;
  rightName: string;
  left(ctx: ScriptCtx): void;
  right(ctx: ScriptCtx): void;
}

/** Split card with Meld: the side is announced when the card is played — the
 *  client asks left/right/both and the choice rides the play intent
 *  (`CardInstance.meldSide`); "both" costs twice the base cost (CR 8.3.38).
 *  A melded card is a single stack layer that resolves twice with priority
 *  between (Rules Reprise 21), so the engine runs onPlay per half ("right" at
 *  stage 1, "left" at stage 2). */
function splitScript({ leftName, rightName, left, right }: SplitSides): CardScript {
  return {
    meld: {
      leftName,
      rightName,
      leftCardType: "action",
      rightCardType: "instant",
    },
    onPlay(ctx) {
      const side = ctx.self.meldSide;
      if (side === "left") return left(ctx);
      if (side === "right") return right(ctx);
      if (side === "both") {
        right(ctx);
        return left(ctx);
      }
    },
  };
}

// ── Crown of Dichotomy helpers ──────────────────────────────────────────────

function isRunebladeAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, attack: boolean): boolean {
  if (!ctx.hasCardType(card, "action")) return false;
  if (!ctx.cardTypes(card).includes("runeblade")) return false;
  return ctx.cardTypes(card).includes("attack") === attack;
}

// ── the scripts ─────────────────────────────────────────────────────────────

export const sba: Record<string, CardScript> = {
  // Briar — Essence of Earth and Lightning
  "briar|0": {
    onSuppressedHit(ctx) {
      if (ctx.link?.attackCardType === "action" && ctx.link.targetAllyId === undefined) {
        ctx.setFlag("player", "briarEarthThisTurn", true);
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackCardType === "action" &&
        ctx.link.targetAllyId === undefined &&
        ctx.getFlag("player", "briarEarthThisTurn") !== true;
    },
    onHit(ctx) {
      // the first time an attack action card you control deals damage to an
      // opposing hero each turn, create an Embodiment of Earth
      ctx.setFlag("player", "briarEarthThisTurn", true);
      ctx.createToken(EMBODIMENT_OF_EARTH);
    },
    triggers: [{
      event: "card-played",
      label: "Create an Embodiment of Lightning",
      condition: (ctx, played) => !!played &&
        ctx.hasCardType(played, "action") &&
        !ctx.cardTypes(played).includes("attack") &&
        Number(ctx.getFlag("player", "nonAttackActionsPlayedThisTurn")) === 2,
      effect: (ctx) => ctx.createToken(EMBODIMENT_OF_LIGHTNING),
    }],
  },

  // Scorpio, Comet Tail — tap to attack while you control a Lightning attack;
  // 1 arcane on hit
  "scorpio, comet tail|0": {
    activated: attackAbility(0, {
      tap: true,
      canActivate(ctx) {
        return ctx.state.chain.some(
          (l) =>
            l.attacker === ctx.seat &&
            ctx.cardTypes(l.attackingCard).includes("lightning"),
        );
      },
    }),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  },

  // Star Fall — 1{r} once-per-turn attack; +1{p} and go again if you've played
  // a Lightning card this turn (its "Go again" keyword is pruned in index.ts —
  // it is conditional)
  "star fall|0": {
    activated: attackAbility(1),
    modifyAttack(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return 0;
      return playedLightning(ctx) ? 1 : 0;
    },
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      if (!playedLightning(ctx)) return;
      ctx.grantGoAgain();
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: +1{p} and go again (played a Lightning card this turn)`, "card.log.sba.starfall.lightning", { amount: 1 }));
    },
  },

  // Blade Beckoner Helm / Gauntlets / Boots — +1{d} while defending a weapon
  // attack; Guardwell is handled by the engine keyword
  "blade beckoner helm|0": {
    modifyDefense(ctx) {
      return isWeaponAttack(ctx) ? 1 : 0;
    },
  },
  "blade beckoner gauntlets|0": {
    modifyDefense(ctx) {
      return isWeaponAttack(ctx) ? 1 : 0;
    },
  },
  "blade beckoner boots|0": {
    modifyDefense(ctx) {
      return isWeaponAttack(ctx) ? 1 : 0;
    },
  },

  // Crown of Dichotomy — {r}, destroy: put a Runeblade attack action and a
  // Runeblade 'non-attack' action from your graveyard on top of your deck in
  // any order. Arcane Barrier 1 is handled by the engine.
  "crown of dichotomy|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      canActivate(ctx) {
        const p = ctx.player(ctx.seat);
        return (
          p.graveyard.some((c) => isRunebladeAction(ctx, c, true)) ||
          p.graveyard.some((c) => isRunebladeAction(ctx, c, false))
        );
      },
      onActivate(ctx) {
        ctx.destroySelf();
        const attacks = ctx.player(ctx.seat).graveyard.filter((c) =>
          isRunebladeAction(ctx, c, true),
        );
        if (attacks.length === 0) {
          crownPickNonAttack(ctx);
          return;
        }
        ctx.requestCardChoice(
          "crown-attack",
          decisionPrompt("Crown of Dichotomy: put a Runeblade attack action from your graveyard on top of your deck", "card.sba.crown.attack.top"),
          attacks.map((c) => c.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "crown-attack") {
        ctx.setCounter("crownAttack", Number(option));
        crownPickNonAttack(ctx);
        return;
      }
      if (hook === "crown-non-attack") {
        ctx.setCounter("crownNonAttack", Number(option));
        crownOrder(ctx);
        return;
      }
      if (hook === "crown-order") {
        // the chosen card goes on top: put the other one there first
        const chosen = Number(option);
        const other =
          chosen === ctx.getCounter("crownAttack")
            ? ctx.getCounter("crownNonAttack")
            : ctx.getCounter("crownAttack");
        crownPutOnTop(ctx, other);
        crownPutOnTop(ctx, chosen);
        ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: put two cards from the graveyard on top of the deck`, "card.log.sba.crown.graveyard.top", { amount: 2 }));
      }
    },
  },

  // Swiftstrike Bracers / Quick Clicks — destroy for a next-attack buff;
  // only if you've played a Nimblism this turn. Their abilities have go again.
  "swiftstrike bracers|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedName:nimblism") === true,
      onActivate(ctx) {
        nextAttack({ attack: 2 })(ctx);
        ctx.destroySelf();
      },
    },
  },
  "quick clicks|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedName:nimblism") === true,
      onActivate(ctx) {
        nextAttack({ goAgain: true })(ctx);
        ctx.destroySelf();
      },
    },
  },

  // Arcanic Shockwave — fused: 1 arcane when it attacks
  "arcanic shockwave|1": {
    additionalCost: fusionAdditionalCost("lightning"),
    onChoose: fusionOnChoose,
    onAttackDeclared(ctx) {
      if (!isFused(ctx)) return;
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  },

  // Entwine Lightning — fused: gains go again (keyword pruned in index.ts)
  "entwine lightning|1": {
    additionalCost: fusionAdditionalCost("lightning"),
    onChoose: fusionOnChoose,
    onAttackDeclared(ctx) {
      if (!isFused(ctx)) return;
      ctx.grantGoAgain();
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: gains go again (fused)`, "card.log.sba.fused.goagain"));
    },
  },

  // Jack Be Quick — may banish a Nimblism from graveyard for +1{p} and go again
  "jack be quick|1": {
    onAttackDeclared(ctx) {
      const nimblisms = ctx.player(ctx.seat).graveyard.filter((c) =>
        isNamed(ctx, c.cardId, "Nimblism"),
      );
      if (nimblisms.length === 0) return;
      ctx.requestCardChoice(
        "jack-banish",
        decisionPrompt("Jack Be Quick: banish a Nimblism from your graveyard for +1{p} and go again?", "card.sba.jack.nimblism.banish", { optionMessages: commonOptionMessages("no") }),
        [...nimblisms.map((c) => c.instanceId), "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "jack-steal") {
        ctx.untap(Number(option));
        ctx.steal(Number(option));
        return;
      }
      if (hook !== "jack-banish" || option === "no") return;
      const card = ctx.player(ctx.seat).graveyard.find((c) => c.instanceId === Number(option));
      if (!card) return;
      ctx.banish(card.instanceId);
      ctx.setCounter("jackBuff", 1);
      ctx.grantGoAgain();
      ctx.logPublic(localizedCardLog(
        ctx,
        `${ctx.data.name}: banishes Nimblism — +1{p} and go again`,
        "card.log.sba.jack.nimblism",
        { result: { kind: "card", cardId: card.cardId }, amount: 1 },
        { kind: "card-moved", cardId: card.cardId, ownerSeat: ctx.seat, from: "graveyard", to: "banish" },
      ));
    },
    modifyAttack(ctx) {
      return ctx.getCounter("jackBuff") ? 1 : 0;
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      // "When this hits a hero, {u} an ally they control, then steal it until
      // the end of this action phase."
      const allies = ctx.player(opponentSeat(ctx)).board.filter((c) =>
        ctx.cardTypes(c).includes("ally"),
      );
      if (allies.length === 0) return;
      if (allies.length === 1) {
        ctx.untap(allies[0]!.instanceId);
        ctx.steal(allies[0]!.instanceId);
        return;
      }
      ctx.requestCardChoice(
        "jack-steal",
        decisionPrompt("Jack Be Quick: untap and steal an ally until the end of this action phase", "card.sba.jack.ally.steal"),
        allies.map((c) => c.instanceId),
      );
    },
  },

  // Lightning Surge — go again if played from arsenal (keyword pruned)
  "lightning surge|1": {
    canPlay(ctx) {
      // counters persist on the card while it leaves its zone (unlike flags)
      const fromArsenal = ctx.player(ctx.seat).arsenal.includes(ctx.self);
      ctx.setCounter("fromArsenal", fromArsenal ? 1 : 0);
      return true;
    },
    onAttackDeclared(ctx) {
      if (!ctx.getCounter("fromArsenal")) return;
      ctx.grantGoAgain();
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: gains go again (played from arsenal)`, "card.log.common.goagain.from.arsenal"));
    },
  },

  // Path of Same Ends — 1 arcane when it attacks a hero; go again if dealt.
  // "Instant - {r}: This gets go again" while it attacks (keyword pruned).
  "path of same ends|1": {
    onAttackDeclared(ctx) {
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
    onDamageDealt(ctx, _target, amount, arcane) {
      if (!arcane || amount <= 0) return;
      ctx.grantGoAgain();
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: gains go again (arcane damage dealt)`, "card.log.sba.arcane.goagain"));
    },
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Pay {r}: This gets go again",
      canActivate(ctx) {
        return ctx.link?.attackingCard.instanceId === ctx.self.instanceId;
      },
      onActivate(ctx) {
        ctx.grantGoAgain();
      },
    },
  },

  // Ravenous Rabble — reveal the top card; -X{p} where X is its pitch value
  "ravenous rabble|1": {
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      const x = top ? (ctx.cardData(top.cardId).pitch ?? 0) : 0;
      if (top) ctx.logPublic(localizedCardLog(
        ctx,
        `${ctx.data.name} reveals ${ctx.cardData(top.cardId).name} (-${x}{p})`,
        "card.log.sba.rabble.revealed",
        { revealed: { kind: "card", cardId: top.cardId }, amount: x },
        { kind: "cards-revealed", cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" },
      ));
      ctx.setFlag("link", "rabbleX", x);
    },
    modifyAttack(ctx) {
      return -Number(ctx.getFlag("link", "rabbleX")) || 0;
    },
  },

  // Rush of Power — Quickstrike: +1{p} while it has go again; 1 arcane on hit
  "rush of power|1": {
    modifyAttack(ctx) {
      return ctx.link?.goAgain ? 1 : 0;
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  },

  // Second Strike — +1{p} and go again if you've dealt damage this turn
  // (keyword pruned)
  "second strike|1": {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "dealtDamageThisTurn") !== true) return;
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      ctx.grantGoAgain();
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: +1{p} and go again (dealt damage this turn)`, "card.log.sba.secondstrike.damage", { amount: 1 }));
    },
  },

  // Static Shock — Lightning Flow: on hit, 1 arcane if you've played a
  // Lightning card this turn
  "static shock|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && playedLightning(ctx);
    },
    onHit(ctx) {
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  },

  // Sigil of Suffering — 1 arcane to the attacking hero; +1{d} if you've
  // dealt arcane damage this turn
  "sigil of suffering|1": {
    onPlay(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      dealArcane(ctx, attacker, 1);
    },
    modifyDefense(ctx) {
      return ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true ? 1 : 0;
    },
  },

  // Arcane Seeds // Life — split: two separate Runechant creation events + go again // gain 1{h}
  "arcane seeds // life|1": splitScript({
    leftName: "Arcane Seeds",
    rightName: "Life",
    left(ctx) {
      ctx.createToken(RUNECHANT);
      ctx.createToken(RUNECHANT);
    },
    right(ctx) {
      ctx.gainLife(ctx.seat, 1);
    },
  }),

  // Burn Up // Shock — split: next hit this turn deals 4 arcane + go again
  // // deal 1 arcane
  "burn up // shock|1": {
    ...splitScript({
      leftName: "Burn Up",
      rightName: "Shock",
      left(ctx) {
        ctx.addModifier({ scope: "until-end-of-turn" }); // marker: source of the lingering onHit
        ctx.setFlag("player", "burnUpArmed", true);
      },
      right(ctx) {
        dealArcane(ctx, opponentSeat(ctx), 1);
      },
    }),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined &&
        ctx.link?.attacker === ctx.seat &&
        ctx.getFlag("player", "burnUpArmed") === true;
    },
    onHit(ctx) {
      ctx.setFlag("player", "burnUpArmed", false);
      dealArcane(ctx, opponentSeat(ctx), 4);
    },
  },

  // Sizzle — next Lightning or Elemental attack gets +3{p}
  "sizzle|1": {
    onPlay: nextAttack({ attack: 3, appliesToSubtype: ["lightning", "elemental"] }),
  },

  // Sprout Strength — three separate "your next attack gets +1{p}" effects
  "sprout strength|1": {
    onPlay(ctx) {
      nextAttack({ attack: 1 })(ctx);
      nextAttack({ attack: 1 })(ctx);
      nextAttack({ attack: 1 })(ctx);
    },
  },

  // Weave Lightning — next Lightning/Elemental attack action +3{p}; go again
  // if it's fused
  "weave lightning|1": {
    onPlay(ctx) {
      nextAttack({
        attack: 3,
        appliesTo: "attack-action",
        appliesToSubtype: ["lightning", "elemental"],
      })(ctx);
      ctx.addModifier({ scope: "until-end-of-turn" }); // marker: keeps the resolved source observable
      ctx.setFlag("player", "weaveGoAgain", true);
    },
    onFriendlyAttackDeclared(ctx) {
      const link = ctx.link;
      if (!link || link.attacker !== ctx.seat || link.attackCardType !== "action") return;
      if (ctx.getFlag("player", "weaveGoAgain") !== true) return;
      const subs = ctx.cardTypes(link.attackingCard);
      if (!subs.includes("lightning") && !subs.includes("elemental")) return;
      ctx.setFlag("player", "weaveGoAgain", false);
      const marker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "until-end-of-turn" &&
        !modifier.consumed
      );
      if (marker) ctx.consumeModifier(marker.id);
      if ((link.attackingCard.counters?.fused ?? 0) > 0) {
        ctx.grantGoAgain();
        ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: the fused attack gains go again`, "card.log.sba.fused.attack.goagain"));
      }
    },
  },

  // Arcane Polarity — gain 1{h}, or 4{h} if you've been dealt arcane damage
  "arcane polarity|1": {
    onPlay(ctx) {
      const taken = ctx.getFlag("player", "arcaneDamageTakenThisTurn") === true;
      ctx.gainLife(ctx.seat, taken ? 4 : 1);
    },
  },

  // Cloud Cover — prevent the next 3 damage you would be dealt this turn
  "cloud cover|1": {
    onPlay(ctx) {
      const cur = Number(ctx.getFlag("player", "preventNextDamage")) || 0;
      ctx.setFlag("player", "preventNextDamage", cur + 3);
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: the next 3 damage dealt to you this turn is prevented`, "card.log.common.damage.next.prevented", { amount: 3 }));
    },
  },

  // Lightning Press — target attack action card with cost 1 or less gains +3{p}
  "lightning press|1": {
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
        attack: 3,
        appliesTo: "attack-action",
        appliesToInstanceId: ctx.playTargetInstanceId,
        maxCost: 1,
      });
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: the attack gains +3{p}`, "card.log.common.attack.gained", { amount: 3 }));
    },
  },

  // ── tokens ──────────────────────────────────────────────────────────────

  // Embodiment of Earth — your 'non-attack' action cards defend for +1;
  // destroyed at the beginning of your action phase
  "embodiment of earth|0": {
    onEnterArena(ctx) {
      ctx.addModifier({
        scope: "static",
        defense: 1,
        appliesToCardType: "action",
        excludesSubtype: "attack",
      });
    },
    triggers: [
      {
        event: "begin-action-phase",
        label: "Destroy Embodiment of Earth",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },

  // Embodiment of Lightning — when you play an attack action card, destroy
  // this; the attack gains go again (a triggered ability: rides the stack)
  "embodiment of lightning|0": {
    triggers: [
      {
        event: "card-played",
        label: "Destroy Embodiment of Lightning (attack gains go again)",
        condition: (ctx, played) => !!played &&
          ctx.hasCardType(played, "action") &&
          ctx.cardTypes(played).includes("attack"),
        effect(ctx) {
          ctx.destroySelf();
          ctx.grantGoAgain();
          ctx.logPublic(localizedCardLog(
            ctx,
            `${ctx.data.name} is destroyed — the attack gains go again`,
            "card.log.common.destroyed.attack.goagain",
            undefined,
            { kind: "card-moved", cardId: ctx.self.cardId, ownerSeat: ctx.seat, from: "board", to: "graveyard" },
          ));
        },
      },
    ],
  },

  // Runechant — when you play an attack action card or activate a weapon
  // attack, destroy this and deal 1 arcane damage to the opposing hero
  // (a triggered ability: rides the stack, respondable)
  "runechant|0": {
    runechantToken: true,
    triggers: [
      {
        event: "card-played",
        label: "Destroy Runechant: 1 arcane damage to the opposing hero",
        condition: (ctx, played) => !!played &&
          ctx.hasCardType(played, "action") &&
          ctx.cardTypes(played).includes("attack"),
        effect(ctx) {
          ctx.destroySelf();
          const unpreventable = ctx.getFlag("player", "nextRunechantUnpreventable") === true;
          if (unpreventable) ctx.setFlag("player", "nextRunechantUnpreventable", false);
          ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, unpreventable });
        },
      },
      {
        event: "weapon-attack-activated",
        label: "Destroy Runechant: 1 arcane damage to the opposing hero",
        effect(ctx) {
          ctx.destroySelf();
          const unpreventable = ctx.getFlag("player", "nextRunechantUnpreventable") === true;
          if (unpreventable) ctx.setFlag("player", "nextRunechantUnpreventable", false);
          ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, unpreventable });
        },
      },
    ],
  },
};

// ── Crown of Dichotomy choice chain ─────────────────────────────────────────

function crownPickNonAttack(ctx: ScriptCtx): void {
  const nonAttacks = ctx.player(ctx.seat).graveyard.filter((c) =>
    isRunebladeAction(ctx, c, false),
  );
  if (nonAttacks.length === 0) {
    // only an attack action was available: straight to the top
    const picked = ctx.getCounter("crownAttack");
    if (picked > 0) crownPutOnTop(ctx, picked);
    return;
  }
  ctx.requestCardChoice(
    "crown-non-attack",
    decisionPrompt("Crown of Dichotomy: put a Runeblade 'non-attack' action from your graveyard on top of your deck", "card.sba.crown.nonattack.top"),
    nonAttacks.map((c) => c.instanceId),
  );
}

function crownOrder(ctx: ScriptCtx): void {
  const attack = ctx.getCounter("crownAttack");
  const nonAttack = ctx.getCounter("crownNonAttack");
  if (attack <= 0) {
    crownPutOnTop(ctx, nonAttack);
    return;
  }
  ctx.requestChoice(
    "crown-order",
    decisionPrompt("Crown of Dichotomy: which card goes on top? (the other goes beneath it)", "card.sba.crown.order"),
    [String(attack), String(nonAttack)],
  );
}

function crownPutOnTop(ctx: ScriptCtx, instanceId: number): void {
  ctx.putOnDeckTop(instanceId);
}
