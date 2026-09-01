import type { ActivatedAbility, CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  markedStealthHeroScript,
  opponentSeat,
} from "./shared-helpers.js";

// ── SAR (Silver Age: Arakni, Web of Deceit precon, Chapter 2) ───────────────
//
// Chaos Assassin cards. New mechanics used here (all engine-native):
// - Marked (CR 9.3): the persistent `marked` counter on the hero instance
//   (SFA precedent); opposing hits remove it in the engine's hit event.
// - "You become a random Agent of Chaos" / "return to the brood":
//   ctx.becomeHero swaps the hero card id (life/intellect are player-level),
//   firing the new hero's onBecomeHero (Trap-Door's search). The random pick
//   uses the seeded ScriptCtx random command.
// - The brood heroes' "Discard an Assassin card" ability cost rides
//   ActivatedAbility.discardCost (discards travel in pitchInstanceIds, the
//   Rally the Rearguard precedent — enumeration, validation, windows).
// - "Equip a Graphene Chelicera token" rides ctx.equipToken (CR 8.5.41).
// - Trap-Door's banished-face-down trap is playable in reaction windows via
//   the play-from-banish permission (per-card permission beats the face-down
//   lock in mayPlayFromZone) until the next end-of-turn cleanup.
// - Stains of the Redback's conditional "costs {r} less" rides
//   CardScript.modifyPlayCost; Hyper Inflation's "cards cost {r} more to
//   play this turn" rides a play-cost-only modifier — both are applied by
//   cardPlayCost in enumeration and validation.
// - Topsy Turvy's "would be put on top of a deck → bottom instead" rides the
//   per-turn topDeckToBottom flag, honored by ctx.putOnDeckTop (which
//   Memorial Ground and opt placements also use).
// - Stealth (CR 8.3.24) means nothing — a keyword tag the scripts read.

const WEB_OF_DECEIT = "SAR001";
const GRAPHENE = "SAR033";
const BLACK_WIDOW = "SAR034";
const FUNNEL_WEB = "SAR035";
const ORB_WEAVER = "SAR036";
const REDBACK = "SAR037";
const TARANTULA = "SAR038";
const TRAP_DOOR = "SAR039";
/** The brood — the Agents of Chaos Web of Deceit randomly becomes. */
const AGENTS = [BLACK_WIDOW, FUNNEL_WEB, ORB_WEAVER, REDBACK, TARANTULA, TRAP_DOOR];

const BLOODROT_POX = "SAZ034";
const FRAILTY = "SAZ035";
const INERTIA = "SAZ036";




/** ctx.state is typed without the internal side tables; the runtime object has them. */

function isMarked(ctx: ScriptCtx, seat: number): boolean {
  return (ctx.state.players[seat]!.hero.counters?.marked ?? 0) > 0;
}

/** Mark is removed as part of the hit event. Hit-triggered effects that care
 *  about the target's prior condition use the event snapshot on the link. */
function hitMarkedHero(ctx: ScriptCtx): boolean {
  return ctx.link?.flags.targetWasMarkedOnHit === true;
}

function markHero(ctx: ScriptCtx, seat: number): void {
  const hero = ctx.state.players[seat]!.hero;
  if ((hero.counters?.marked ?? 0) > 0) return;
  ctx.addCounter(hero.instanceId, "marked", 1);
  ctx.logPublic(`${ctx.cardData(hero.cardId).name} is marked`);
}

function requestHuntsmanMark(ctx: ScriptCtx): void {
  ctx.requestChoice("huntsman-mark", "Mark of the Huntsman: destroy this and mark them?", [
    "yes",
    "no",
  ]);
}

function hasStealth(ctx: ScriptCtx, cardId: string): boolean {
  return (ctx.cardData(cardId).keywords ?? []).some((k) => k.toLowerCase() === "stealth");
}

function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("dagger");
}

function attackTypes(ctx: ScriptCtx): readonly string[] {
  if (!ctx.link) return [];
  return ctx.cardTypes(ctx.link.attackingCard);
}

/** The attacking card's class check for "target Assassin attack". */
function myAttack(ctx: ScriptCtx): boolean {
  return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat;
}

/** A rider granted by a chain-link modifier sourced from this card/hero. */
function armedBySelf(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some(
    (m) => m.scope === "chain-link" && m.sourceInstanceId === ctx.self.instanceId,
  );
}

/** "At the beginning of your end phase, return to the brood" (CR 8.5.52). */
function returnToBrood() {
  return {
    event: "end-of-turn" as const,
    label: "Return to the brood",
    effect(ctx: ScriptCtx) {
      ctx.becomeHero(ctx.self.originalHeroCardId ?? WEB_OF_DECEIT);
    },
  };
}

/** The brood heroes' shared ability: "Once per Turn Attack Reaction —
 *  Discard an Assassin card: Target <target> attack gets +3{p}." */
function broodReaction(target: (ctx: ScriptCtx) => boolean, label: string): ActivatedAbility {
  return {
    cost: 0,
    isAttack: false,
    goAgain: false,
    oncePerTurn: true,
    timing: "attack-reaction",
    discardCost: { count: 1, classes: ["assassin"] },
    label,
    canActivate: (ctx) => myAttack(ctx) && target(ctx),
    onActivate(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      ctx.logPublic(`${ctx.data.name}: the attack gets +3{p}`);
    },
  };
}

/** Art of Desire: banish the top of their deck on hit; pitch-matching cards
 *  draw a card and gain 1{h}. */
function artOfDesire(pitchValue: number): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      const top = opp.deck[0];
      if (!top) return;
      ctx.banish(top.instanceId);
      if (ctx.cardColor(top) === pitchValue) {
        ctx.drawCards(ctx.seat, 1);
        ctx.gainLife(ctx.seat, 1);
      }
    },
  };
}

/** Attack-reaction pump on the controller's attack with an armed on-hit
 *  rider (Scar Tissue / Spike with Bloodrot). */
function pumpWithRider(
  target: (ctx: ScriptCtx) => boolean,
  pump: number,
  rider: (ctx: ScriptCtx) => void,
): CardScript {
  return {
    canPlay: (ctx) => myAttack(ctx) && target(ctx),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: pump });
      ctx.addModifier({ scope: "until-end-of-turn" }); // marker: source of the lingering onHit
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && armedBySelf(ctx);
    },
    onHit(ctx) {
      rider(ctx);
    },
  };
}

export const sar: Record<string, CardScript> = {
  // ── Hero ──────────────────────────────────────────────────────────────────

  "arakni, web of deceit|0": markedStealthHeroScript(AGENTS),

  // ── Weapons ───────────────────────────────────────────────────────────────

  "mark of the huntsman|0": {
    // Once per Turn Action — {r}{r}: Attack. Go again. "If this is attacking
    //  a marked hero, this gets +1{p}. When this hits a hero, you may choose
    //  to destroy this and mark them."
    activated: attackAbility(2, { goAgain: true }),
    modifyAttack(ctx) {
      const link = ctx.link;
      if (!link || link.attackingCard.instanceId !== ctx.self.instanceId) return 0;
      return isMarked(ctx, opponentSeat(ctx)) ? 1 : 0;
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return !!link && link.targetAllyId === undefined &&
        link.attackingCard.instanceId === ctx.self.instanceId;
    },
    onHit(ctx) {
      requestHuntsmanMark(ctx);
    },
    onEffectHit(ctx) {
      requestHuntsmanMark(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "huntsman-mark" || option !== "yes") return;
      ctx.destroySelf();
      markHero(ctx, opponentSeat(ctx));
    },
  },

  "graphene chelicera|0": {
    // Once per Turn Action — {r}: Attack. "When this attacks a marked hero,
    //  the attack gets go again." (Go again is conditional —
    //  KEYWORD_OVERRIDES strips the printed keyword; Stealth is a tag.)
    activated: attackAbility(1),
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      if (isMarked(ctx, opponentSeat(ctx))) ctx.grantGoAgain();
    },
  },

  // ── Equipment ─────────────────────────────────────────────────────────────

  "prey spotters|0": {
    // "Attack Reaction — Destroy this: Mark target opposing hero." Battleworn
    //  is native.
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      label: "Destroy: mark the opposing hero",
      onActivate(ctx) {
        ctx.destroySelf();
        markHero(ctx, opponentSeat(ctx));
      },
    },
  },

  "topsy turvy|0": {
    // "Instant — Destroy this: Until end of turn, if one or more cards would
    //  be put on top of a deck, instead they're put on the bottom." Arcane
    //  Barrier 1 is native. The replacement rides the per-turn flag honored
    //  by ctx.putOnDeckTop (see header for the opt-style bypass).
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: top-of-deck puts go on the bottom this turn",
      onActivate(ctx) {
        ctx.destroySelf();
        for (const p of ctx.state.players) ctx.setPlayerFlag(p.seat, "topDeckToBottom", true);
        ctx.logPublic("Topsy Turvy: cards put on top of a deck go on the bottom this turn");
      },
    },
  },

  "danger digits|0": {
    // "Attack Reaction — Destroy this: Target dagger you control that isn't
    //  on the active chain link deals 1 damage to the defending hero. If
    //  damage is dealt this way, the dagger has hit. Destroy the dagger."
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      label: "Destroy: another dagger deals 1 damage, then is destroyed",
      canActivate(ctx) {
        const link = ctx.link;
        if (!myAttack(ctx)) return false;
        return ctx.player(ctx.seat).weapons.some(
          (w) => isDagger(ctx, w) && w.instanceId !== link?.attackingCard.instanceId,
        );
      },
      onActivate(ctx) {
        ctx.destroySelf();
        const link = ctx.link;
        const daggers = ctx.player(ctx.seat).weapons.filter(
          (w) => isDagger(ctx, w) && w.instanceId !== link?.attackingCard.instanceId,
        );
        ctx.requestCardChoice(
          "danger-digits",
          "Danger Digits: choose a dagger to deal 1 damage (it is destroyed)",
          daggers.map((c) => c.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "danger-digits") return;
      const dagger = ctx.player(ctx.seat).weapons.find((c) => c.instanceId === Number(option));
      if (!dagger) return;
      ctx.dealDamage(opponentSeat(ctx), 1, {
        sourceInstanceId: dagger.instanceId,
        countsAsHit: true,
        destroySourceAfterDamage: true,
      });
    },
  },

  "stalker's steps|0": {
    // "Attack Reaction — Destroy this: Target attack with stealth gets go
    //  again." Arcane Barrier 1 is native.
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      label: "Destroy: an attack with stealth gets go again",
      canActivate: (ctx) => myAttack(ctx) && hasStealth(ctx, ctx.link!.attackingCard.cardId),
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.grantGoAgain();
      },
    },
  },

  // ── Attacks ───────────────────────────────────────────────────────────────

  "art of desire: body|1": artOfDesire(1),

  "art of desire: mind|3": artOfDesire(3),

  "concoct disorder|1": {
    // "When this attacks, each hero puts the top card of their deck face-down
    //  into their arsenal. If 2 or more cards are put into arsenals this way,
    //  this gets go again." (Go again is conditional — KEYWORD_OVERRIDES.)
    onAttackDeclared(ctx) {
      let puts = 0;
      for (const p of ctx.state.players) {
        const top = p.deck[0];
        if (!top || p.arsenal.length > 0) continue;
        ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false });
        puts++;
        ctx.logPublic(`${ctx.cardData(p.heroCardId).name} puts the top card of their deck face-down into their arsenal`);
      }
      if (puts >= 2) ctx.grantGoAgain();
    },
  },

  "hyper inflation|1": {
    // "When this attacks, cards cost {r} more to play this turn." Go again is
    //  printed (native).
    onAttackDeclared(ctx) {
      for (const p of ctx.state.players) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          seat: p.seat,
          appliesTo: "any",
          playCostReduction: -1,
        });
      }
      ctx.logPublic(`${ctx.data.name}: cards cost {r} more to play this turn`);
    },
  },

  "infect|1": {
    // "When this hits a hero, create a Bloodrot Pox token under their control."
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ctx.createToken(BLOODROT_POX, opponentSeat(ctx));
    },
  },

  "mark of the black widow|1": {
    // "When this hits a marked hero, they banish a card from their hand."
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      if (opp.hand.length === 0) return;
      ctx.requestCardChoice(
        "black-widow",
        "Mark of the Black Widow: banish a card from your hand",
        opp.hand.map((c) => c.instanceId),
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "black-widow") return;
      ctx.banish(Number(option));
    },
  },

  "mark of the black widow|3": {
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      if (opp.hand.length === 0) return;
      ctx.requestCardChoice(
        "black-widow",
        "Mark of the Black Widow: banish a card from your hand",
        opp.hand.map((c) => c.instanceId),
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "black-widow") return;
      ctx.banish(Number(option));
    },
  },

  "mark of the funnel web|1": {
    // "When this hits a marked hero, banish a card in their arsenal."
    canTriggerOnHit: hitMarkedHero,
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      const card = opp.arsenal[0];
      if (!card) return;
      // Arsenal capacity is one in the current engine, so there is no real
      // choice. Do not project the hidden card to the attack controller.
      ctx.setCardFaceDown(card.instanceId, false);
      ctx.banish(card.instanceId);
    },
  },

  "mark the prey|1": {
    // "When this hits a hero, mark them."
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      markHero(ctx, opponentSeat(ctx));
    },
  },

  // ── Non-attack actions ────────────────────────────────────────────────────

  "orb-weaver spinneret|1": {
    // "Equip a Graphene Chelicera token. Your next attack with stealth this
    //  turn gets +3{p}." Go again is printed (native).
    onPlay(ctx) {
      ctx.equipToken(GRAPHENE);
      buffNextAttack(ctx, { attack: 3, appliesToKeyword: "stealth" });
    },
  },

  // ── Attack reactions ──────────────────────────────────────────────────────

  "scar tissue|1": pumpWithRider(
    (ctx) => isDagger(ctx, ctx.link!.attackingCard),
    3,
    (ctx) => markHero(ctx, opponentSeat(ctx)),
  ),

  "spike with bloodrot|1": pumpWithRider(
    (ctx) => ctx.link!.attackCardType === "action" && hasStealth(ctx, ctx.link!.attackingCard.cardId),
    3,
    (ctx) => ctx.createToken(BLOODROT_POX, opponentSeat(ctx)),
  ),

  "stains of the redback|1": {
    // "If the defending hero is marked, this costs {r} less to play."
    modifyPlayCost: (ctx, base) =>
      ctx.link && isMarked(ctx, ctx.link.attacker === 0 ? 1 : 0) ? base - 1 : base,
    // "Target attack with stealth gets +3{p} and go again."
    canPlay: (ctx) => myAttack(ctx) && hasStealth(ctx, ctx.link!.attackingCard.cardId),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      ctx.grantGoAgain();
    },
  },

  "two sides to the blade|1": {
    canPlay(ctx) {
      if (!myAttack(ctx)) return false;
      return (
        isDagger(ctx, ctx.link!.attackingCard) ||
        (ctx.link!.attackCardType === "action" && hasStealth(ctx, ctx.link!.attackingCard.cardId))
      );
    },
    additionalCost(ctx) {
      const link = ctx.link!;
      const dagger = isDagger(ctx, link.attackingCard);
      const stealthAction =
        link.attackCardType === "action" && hasStealth(ctx, link.attackingCard.cardId);
      if (dagger && stealthAction) {
        ctx.requestChoice("two-sides", "Two Sides to the Blade: choose 1", [
          "Dagger attack gets +3{p}",
          "Stealth attack gets +3{p} and mark on hit",
        ]);
      }
    },
    onPlay(ctx) {
      const link = ctx.link!;
      const dagger = isDagger(ctx, link.attackingCard);
      const stealthAction =
        link.attackCardType === "action" && hasStealth(ctx, link.attackingCard.cardId);
      const selectedStealth = ctx.getCounter("twoSidesMode") === 2;
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      if (stealthAction && (!dagger || selectedStealth)) {
        ctx.addModifier({ scope: "until-end-of-turn" }); // marker for the mark rider
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && armedBySelf(ctx);
    },
    onHit(ctx) {
      markHero(ctx, opponentSeat(ctx));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "two-sides") return;
      ctx.setCounter("twoSidesMode", option.startsWith("Stealth") ? 2 : 1);
    },
  },

  "night's embrace|3": {
    // "Your attacks with stealth get +1{p} this turn."
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToKeyword: "stealth" });
    },
  },

  "shred|3": {
    // "Target card defending an Assassin attack gets -2{d} this combat chain."
    canPlay(ctx) {
      if (!myAttack(ctx) || !attackTypes(ctx).includes("assassin")) return false;
      const link = ctx.link!;
      return link.defendingCards.length + link.defendingEquipment.length > 0;
    },
    onPlay(ctx) {
      const link = ctx.link!;
      ctx.requestCardChoice(
        "shred",
        "Shred: target defending card gets -2{d} this combat chain",
        [...link.defendingCards, ...link.defendingEquipment].map((c) => c.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "shred") return;
      const link = ctx.link;
      const card = [...(link?.defendingCards ?? []), ...(link?.defendingEquipment ?? [])].find(
        (c) => c.instanceId === Number(option),
      );
      if (!card) return;
      ctx.addCardTempDefense(card.instanceId, -2);
      ctx.logPublic(`Shred: ${ctx.cardData(card.cardId).name} gets -2{d} this combat chain`);
    },
  },

  "reaper's call|3": {
    // "Instant — Discard this: Mark target opposing hero." (from-hand instant
    //  ability; the discard is the cost.)
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      label: "Discard: mark the opposing hero",
      onActivate(ctx) {
        markHero(ctx, opponentSeat(ctx));
      },
    },
  },

  // ── Defense reactions (traps) ─────────────────────────────────────────────

  "den of the spider|1": {
    // "When this defends an attack with {p} greater than its base, mark the
    //  attacking hero."
    canTriggerOnDefend: (ctx) => ctx.attackBonusAboveBase() > 0,
    onDefend(ctx) {
      const link = ctx.link;
      if (!link) return;
      ctx.notifyTrapTriggered();
      markHero(ctx, link.attacker);
    },
  },

  "frailty trap|1": {
    // "When this defends an attack with go again, create a Frailty token
    //  under the attacking hero's control."
    canTriggerOnDefend: (ctx) => ctx.link?.goAgain === true,
    onDefend(ctx) {
      const link = ctx.link;
      if (!link) return;
      ctx.notifyTrapTriggered();
      ctx.createToken(FRAILTY, link.attacker);
    },
  },

  "inertia trap|1": {
    // "When this defends an attack with {p} greater than its base, create an
    //  Inertia token under the attacking hero's control."
    canTriggerOnDefend: (ctx) => ctx.attackBonusAboveBase() > 0,
    onDefend(ctx) {
      const link = ctx.link;
      if (!link) return;
      ctx.notifyTrapTriggered();
      ctx.createToken(INERTIA, link.attacker);
    },
  },

  "lair of the spider|1": {
    // "When this defends an attack with go again, mark the attacking hero."
    canTriggerOnDefend: (ctx) => ctx.link?.goAgain === true,
    onDefend(ctx) {
      const link = ctx.link;
      if (!link) return;
      ctx.notifyTrapTriggered();
      markHero(ctx, link.attacker);
    },
  },

  // ── The brood (Agents of Chaos) ───────────────────────────────────────────

  "arakni, black widow|0": {
    activated: broodReaction(
      (ctx) => attackTypes(ctx).includes("assassin"),
      "Discard an Assassin card: target Assassin attack gets +3{p}",
    ),
    // "If it has stealth, it gets 'When this hits a hero, they banish a card
    //  from their hand.'" — the hero's onHit fires for its attacks; the
    //  +3 modifier on the link marks the ability as armed.
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return !!link && link.targetAllyId === undefined &&
        armedBySelf(ctx) &&
        hasStealth(ctx, link.attackingCard.cardId);
    },
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      if (opp.hand.length === 0) return;
      ctx.requestCardChoice(
        "brood-black-widow",
        "Arakni, Black Widow: banish a card from your hand",
        opp.hand.map((c) => c.instanceId),
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "brood-black-widow") return;
      ctx.banish(Number(option));
    },
    triggers: [returnToBrood()],
  },

  "arakni, funnel web|0": {
    activated: broodReaction(
      (ctx) => attackTypes(ctx).includes("assassin"),
      "Discard an Assassin card: target Assassin attack gets +3{p}",
    ),
    // "If it has stealth, it gets 'When this hits a hero, banish a card in
    //  their arsenal.'"
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return !!link && link.targetAllyId === undefined &&
        armedBySelf(ctx) &&
        hasStealth(ctx, link.attackingCard.cardId);
    },
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      const card = opp.arsenal[0];
      if (!card) return;
      ctx.setCardFaceDown(card.instanceId, false);
      ctx.banish(card.instanceId);
    },
    triggers: [returnToBrood()],
  },

  "arakni, orb-weaver|0": {
    // "Graphene Chelicerae cost you {r} less to activate."
    modifyAttackActivationCost(ctx, attacker, baseCost) {
      if (ctx.cardData(attacker.cardId).name !== "Graphene Chelicera") return baseCost;
      return baseCost - 1;
    },
    // "Once per Turn Instant — Discard an Assassin card: Equip a Graphene
    //  Chelicera token. Your next attack with stealth this turn gets +3{p}."
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "instant",
      discardCost: { count: 1, classes: ["assassin"] },
      label: "Discard an Assassin card: equip a Graphene Chelicera; next stealth attack +3{p}",
      onActivate(ctx) {
        ctx.equipToken(GRAPHENE);
        buffNextAttack(ctx, { attack: 3, appliesToKeyword: "stealth" });
      },
    },
    triggers: [returnToBrood()],
  },

  "arakni, redback|0": {
    activated: {
      ...broodReaction(
        (ctx) => attackTypes(ctx).includes("assassin"),
        "Discard an Assassin card: target Assassin attack gets +3{p}",
      ),
      // "If it has stealth, it gets go again."
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link", attack: 3 });
        if (hasStealth(ctx, ctx.link!.attackingCard.cardId)) ctx.grantGoAgain();
      },
    },
    triggers: [returnToBrood()],
  },

  "arakni, tarantula|0": {
    // "Whenever a dagger you own hits a hero, they lose 1{h}."
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return !!link &&
        link.targetAllyId === undefined &&
        isDagger(ctx, link.attackingCard) &&
        link.attackingCard.owner === ctx.seat;
    },
    onHit(ctx) {
      const targetSeat = opponentSeat(ctx);
      ctx.loseLife(targetSeat, 1);
      const opp = ctx.player(targetSeat);
      ctx.logPublic(`${ctx.cardData(opp.heroCardId).name} loses 1 life (${opp.life} life)`);
    },
    onFriendlyEffectHitCondition(ctx, source) {
      return isDagger(ctx, source) && source.owner === ctx.seat;
    },
    onFriendlyEffectHit(ctx, _source, targetSeat) {
      ctx.loseLife(targetSeat, 1);
      const target = ctx.player(targetSeat);
      ctx.logPublic(`${ctx.cardData(target.heroCardId).name} loses 1 life (${target.life} life)`);
    },
    activated: broodReaction(
      (ctx) => isDagger(ctx, ctx.link!.attackingCard),
      "Discard an Assassin card: target dagger attack gets +3{p}",
    ),
    triggers: [returnToBrood()],
  },

  "arakni, trap-door|0": {
    // "When you become this, you may search your deck for a card, banish it
    //  face-down, then shuffle. If it's a trap, you may play it until the
    //  start of your next turn."
    onBecomeHero(ctx) {
      const p = ctx.player(ctx.seat);
      if (p.deck.length === 0) return;
      ctx.requestCardChoice(
        "trap-door-search",
        "Arakni, Trap-Door: search your deck for a card to banish face-down?",
        ["pass", ...p.deck.map((c) => c.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "trap-door-search" || option === "pass") return;
      const card = ctx.player(ctx.seat).deck.find((c) => c.instanceId === Number(option));
      if (!card) return;
      ctx.banish(card.instanceId, { faceDown: true });
      ctx.logPublic("Arakni, Trap-Door: a card is banished face-down");
      ctx.shuffleDeck();
      if (ctx.cardTypes(card).includes("trap")) {
        ctx.allowPlayFrom(card.instanceId, "banish", { untilNextTurn: true });
        ctx.logPublic("Arakni, Trap-Door: the trap may be played until the start of your next turn");
      }
    },
    triggers: [returnToBrood()],
  },
};
