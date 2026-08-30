import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { isCard, opponentSeat } from "./shared-helpers.js";

// ── SEN (Silver Age: Enigma precon) ─────────────────────────────────────────
//
// Mystic Illusionist cards. New mechanics used here (all engine-native):
// - Chi points: Enigma's {c}{c}{c} ability (engine: ActivatedAbility.chiCost —
//  only chi-subtype pitches pay it, spent from the floating chi pool).
// - Transcend instants: on resolution the card returns to hand flipped as
//   Inner Chi (engine: ctx.transcend + the `transcendedThisTurn` flag) when
//   another blue card was played this turn (`playedPitch:3` — the card itself
//   is counted by noteCardPlayed before onPlay, so >= 2 means another blue).
// - Ward (engine-native destroy-to-prevent for equipment AND board cards) on
//   the Spectral Shield token and the Waning/Waxing aura-instants (the aura
//   subtype comes from SUBTYPE_OVERRIDES in ../index.ts).
// - Phantasm (engine-native) on the Chimera/Haze/Rider/Spears attacks;
//   Phantasmal Haze's "when destroyed" rides the onDestroyed hook, and Silent
//   Stilettos rides the onFriendlyAttackLost hook.
// - Aura attacks: Cosmo carries the grantsAuraAttack marker (ward auras get a
//   once-per-turn {r}: Attack riding the chain as attackCardType "weapon");
//   Enigma's first-Spectral-Shield discount is modifyAttackActivationCost +
//   a per-turn flag set from the hero's onAttackDeclared.
// - Cloaked Uphold Tradition: face-down equipment whose only usable ability is
//   the turnsFaceUp instant flip.
// - "Created a card this turn" (engine: createdThisTurn flag, set by
//   createTokenFor) powering Fluid Motion / Manifest Muscle, and clash with
//   an opponent winner (Test of Strength — engine: requestClash and the
//   optional seat param on ctx.createToken).
const SPECTRAL_SHIELD = "SEN037";
const GOLD = "SEN036";




function hasWard(ctx: ScriptCtx, cardId: string): boolean {
  return (ctx.cardData(cardId).keywords ?? []).some((k) => /^ward \d+$/i.test(k.trim()));
}

function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("aura");
}

/** Auras with ward on the controller's board (Spectral Shield, Waning/Waxing, …). */
function wardAuras(ctx: ScriptCtx) {
  return ctx.player(ctx.seat).board.filter((c) => isAura(ctx, c) && hasWard(ctx, c.cardId));
}

function controlsSpectralShield(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).board.some((c) => isCard(ctx, c.cardId, "Spectral Shield"));
}

function createdThisTurn(ctx: ScriptCtx): boolean {
  return (Number(ctx.getFlag("player", "createdThisTurn")) || 0) > 0;
}

function pitchedBlue(ctx: ScriptCtx): boolean {
  return (Number(ctx.getFlag("player", "pitchedPitch:3")) || 0) > 0;
}

/** "If you've played another blue card this turn, transcend." The resolving
 *  card is blue and noteCardPlayed has already counted it, so >= 2 means
 *  another blue card was played this turn. */
function transcendIfBlue(ctx: ScriptCtx): void {
  if ((Number(ctx.getFlag("player", "playedPitch:3")) || 0) >= 2) ctx.transcend();
}

/** A transcend instant: the printed effect, then the conditional transcend.
 * Choice-based effects defer transcend until their choice has resolved. */
function transcendInstant(
  onPlay: (ctx: ScriptCtx) => void,
  extra: CardScript = {},
  afterChoiceHook?: string,
): CardScript {
  const script: CardScript = {
    ...extra,
    onPlay(ctx) {
      onPlay(ctx);
      if (!afterChoiceHook) transcendIfBlue(ctx);
    },
  };
  if (afterChoiceHook) {
    script.onChoose = (ctx, hook, option) => {
      extra.onChoose?.(ctx, hook, option);
      if (hook === afterChoiceHook) transcendIfBlue(ctx);
    };
  }
  return script;
}

export const sen: Record<string, CardScript> = {
  // ── Hero ──────────────────────────────────────────────────────────────────

  "enigma|0": {
    // "Your first Spectral Shield attack each turn costs {r} less to activate."
    // The discount is consulted at enumeration/validation; the per-turn flag is
    // stamped when the discounted attack is actually declared.
    modifyAttackActivationCost(ctx, attacker, baseCost) {
      if (!isCard(ctx, attacker.cardId, "Spectral Shield")) return baseCost;
      if (ctx.getFlag("player", "ssDiscountUsed")) return baseCost;
      return baseCost - 1;
    },
    onFriendlyAttackDeclared(ctx) {
      const link = ctx.link;
      if (!link) return;
      if (!isCard(ctx, link.attackingCard.cardId, "Spectral Shield")) return;
      if (ctx.getFlag("player", "ssDiscountUsed")) return;
      ctx.setFlag("player", "ssDiscountUsed", true);
      ctx.logPublic("Enigma: your first Spectral Shield attack this turn is discounted");
    },
    // "Once per Turn Instant — {c}{c}{c}: Create a Spectral Shield token with
    //  a +1{p} counter."
    activated: {
      cost: 0,
      chiCost: 3,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "instant",
      label: "{c}{c}{c}: Create a Spectral Shield with a +1{p} counter",
      onActivate(ctx) {
        const shield = ctx.createToken(SPECTRAL_SHIELD);
        if (shield) ctx.addCounter(shield.instanceId, "power", 1);
      },
    },
  },

  // ── Weapon ────────────────────────────────────────────────────────────────

  // Auras you control with ward are weapons ({p} = ward, {r}: Attack, once per
  // turn); aura attacks with a +1{p} counter get go again. All engine-side.
  "cosmo, scroll of ancestral tapestry|0": {
    grantsAuraAttack: { cost: 1, goAgainWithPowerCounter: true },
  },

  // ── Equipment ─────────────────────────────────────────────────────────────

  "uphold tradition|0": {
    // Cloaked is native (enters face-down, inert until flipped); Ward 1 is
    // native once face-up. The only face-down-usable ability is the flip.
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      turnsFaceUp: true,
      label: "Turn face-up: +1{p} counter on an aura with ward",
      onActivate(ctx) {
        ctx.requestCardChoice(
          "uphold-target",
          "Uphold Tradition: put a +1{p} counter on an aura with ward you control",
          wardAuras(ctx).map((c) => c.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "uphold-target") return;
      ctx.addCounter(Number(option), "power", 1);
      ctx.logPublic(`${ctx.data.name}: a +1{p} counter goes on an aura with ward`);
    },
  },

  "silent stilettos|0": {
    onFriendlyAttackLost(ctx) {
      ctx.requestPayment(
        "stilettos-pay",
        "Silent Stilettos: pay {r}{r}{r} to destroy it and gain 1 action point?",
        3,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "stilettos-pay" || option !== "paid") return;
      ctx.destroySelf();
      ctx.gainActionPoint();
      ctx.logPublic("Silent Stilettos is destroyed: gain 1 action point");
    },
  },

  // ── Actions ───────────────────────────────────────────────────────────────

  "astral etchings|1": {
    // "If you control a Spectral Shield, you may play this as though it were an
    //  instant."
    playAsInstant: (ctx) => controlsSpectralShield(ctx),
    onPlay(ctx) {
      ctx.requestCardChoice(
        "etchings-target",
        "Astral Etchings: put three +1{p} counters on an aura with ward you control",
        wardAuras(ctx).map((c) => c.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "etchings-target") return;
      ctx.addCounter(Number(option), "power", 3);
      ctx.logPublic(`${ctx.data.name}: three +1{p} counters go on an aura with ward`);
    },
  },

  "spectral manifestations|1": {
    // Go again is printed (native). "…then if you control no other Illusionist
    //  auras, put three +1{p} counters on it."
    onPlay(ctx) {
      const shield = ctx.createToken(SPECTRAL_SHIELD);
      if (!shield) return;
      const otherIllusionistAura = ctx.player(ctx.seat).board.some(
        (c) =>
          c.instanceId !== shield.instanceId &&
          isAura(ctx, c) &&
          ctx.cardTypes(c).includes("illusionist"),
      );
      if (!otherIllusionistAura) ctx.addCounter(shield.instanceId, "power", 3);
    },
  },

  "fluid motion|3": {
    // Go again is conditional (KEYWORD_OVERRIDES strips the printed keyword).
    onAttackDeclared(ctx) {
      if (createdThisTurn(ctx)) ctx.grantGoAgain();
    },
  },

  "manifest muscle|3": {
    modifyAttack: (ctx) => (createdThisTurn(ctx) ? 1 : 0),
  },

  "phantasmal haze|3": {
    // Phantasm is native; the engine fires onDestroyed on the phantasm pop.
    onDestroyed(ctx) {
      ctx.createToken(SPECTRAL_SHIELD);
    },
  },

  "second tenet of chi: wind|3": {
    // Go again is conditional (KEYWORD_OVERRIDES strips the printed keyword).
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "transcendedThisTurn")) ctx.grantGoAgain();
    },
  },

  "spectral rider|3": {
    // Phantasm is native; Overpower is conditional (KEYWORD_OVERRIDES).
    triggers: [{ event: "card-played", sourceZone: "self", label: "Gain overpower", condition: controlsSpectralShield, effect(ctx) { ctx.setFlag("link", "overpower", true); } }],
  },

  // ── Blocks / reactions ────────────────────────────────────────────────────

  "on the horizon|1": {
    onDefend(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.lookAt(top.instanceId);
      ctx.logPublic(`${ctx.data.name}: look at the top card of your deck`);
    },
  },

  "test of strength|1": {
    // Clash with the attacking hero; the winner creates a Gold token (which may
    // be the opponent — requestClash + createToken's seat param).
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      ctx.requestClash(attacker, "test-of-strength");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "test-of-strength" && winner >= 0) ctx.createToken(GOLD, winner);
    },
  },

  "big blue sky|3": {
    modifyDefense: (ctx) => Number(ctx.getFlag("player", "pitchedPitch:3")) || 0,
  },

  "put in context|3": {
    canDefend(ctx) {
      const link = ctx.link;
      if (!link) return false;
      return (ctx.cardData(link.attackingCard.cardId).attack ?? 0) <= 3;
    },
  },

  // ── Aura instants ─────────────────────────────────────────────────────────

  "waning vengeance|1": {
    // Ward 3 is native. Every arena-to-zone move fires onLeaveArena.
    onLeaveArena(ctx) {
      if (pitchedBlue(ctx)) ctx.createToken(SPECTRAL_SHIELD);
    },
  },

  "waxing specter|1": {
    // Ward 3 is native.
    onEnterArena(ctx) {
      if (pitchedBlue(ctx)) ctx.addCounter(ctx.self.instanceId, "power", 1);
    },
  },

  // ── Transcend instants ────────────────────────────────────────────────────

  "a drop in the ocean|3": transcendInstant(
    (ctx) => {
      const link = ctx.link;
      if (!link) return;
      ctx.addModifier({ scope: "chain-link", attack: -1, seat: link.attacker });
      ctx.logPublic(`${ctx.data.name}: target attack gets -1{p}`);
    },
    {
      canPlay: (ctx) => !!ctx.link && !ctx.link.resolved,
    },
  ),

  "homage to ancestors|3": transcendInstant((ctx) => {
    ctx.gainLife(ctx.seat, 1);
  }),

  "pass over|3": transcendInstant(
    (ctx) => {
      ctx.requestCardChoice(
        "pass-over",
        "Pass Over: banish a card from the opponent's graveyard",
        ctx.player(opponentSeat(ctx)).graveyard.map((c) => c.instanceId),
      );
    },
    {
      canPlay: (ctx) => ctx.player(opponentSeat(ctx)).graveyard.length > 0,
      onChoose(ctx, hook, option) {
        if (hook !== "pass-over") return;
        ctx.banish(Number(option));
      },
    },
    "pass-over",
  ),

  "preserve tradition|3": transcendInstant(
    (ctx) => {
      const actions = ctx.player(ctx.seat).graveyard.filter(
        (c) => ctx.hasCardType(c, "action"),
      );
      ctx.requestCardChoice(
        "preserve-tradition",
        "Preserve Tradition: put an action card from your graveyard on the bottom of your deck",
        actions.map((c) => c.instanceId),
      );
    },
    {
      canPlay: (ctx) =>
        ctx.player(ctx.seat).graveyard.some((c) => ctx.hasCardType(c, "action")),
      onChoose(ctx, hook, option) {
        if (hook !== "preserve-tradition") return;
        const card = ctx.player(ctx.seat).graveyard.find((candidate) => candidate.instanceId === Number(option));
        if (!card) return;
        ctx.putOnDeckBottom(Number(option));
        ctx.logPublic(`${ctx.data.name}: ${ctx.cardData(card.cardId).name} goes on the bottom of the deck`);
      },
    },
    "preserve-tradition",
  ),

  "rising sun, setting moon|3": {
    onPlay(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const hand = ctx.player(ctx.seat).hand;
      // an empty hand fizzle-logs (requestCardChoice with no options)
      ctx.requestCardChoice(
        "rising-sun",
        "Rising Sun, Setting Moon: put a card from your hand on the bottom of your deck",
        hand.map((c) => c.instanceId),
      );
      // Transcend is the final instruction. When there is no card to put back,
      // there is no decision to pause on, so finish it immediately.
      if (hand.length === 0) transcendIfBlue(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "rising-sun") return;
      ctx.putOnDeckBottom(Number(option));
      ctx.logPublic(`${ctx.data.name}: a card goes on the bottom of the deck`);
      transcendIfBlue(ctx);
    },
  },
};
