import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, decisionPrompt, isWeaponAttack, opponentSeat, payForDefenseBoost, queueIntimidate, suspenseAura, yesNoPrompt } from "./shared-helpers.js";

// ── SLY (Silver Age: Lyath Goldmane precon) ─────────────────────────────────
//
// Reviled Guardian cards (Super Slam mechanics). New mechanics used here:
// - The crowd boos/cheers (engine: ctx.crowdBoo/crowdCheer — per-turn flags
//   `booedThisTurn`/`cheeredThisTurn` plus the hero hooks onBooed/onCheered;
//   booing/cheering has no other material effect, per the SUP release notes).
// - Auras: Booze!, the Suspense cards and the Might/Confidence tokens carry
//   the aura subtype (SUBTYPE_OVERRIDES in ../index.ts — the dataset omits it)
//   and settle into the arena (engine: entersArena/settlePlayedCard).
// - Suspense counters are script-level: enter with 2, a start-of-turn trigger
//   removes one and destroys the aura at 0; the state-based "when this has
//   no suspense counters, destroy it" is the engine's destroyAtZeroCounter
//   marker, checked at intent boundaries.
// - Clash (engine: ctx.clash — reveal deck tops, greatest {p} wins, cards
//   stay on top), Lyath's base-{p}/{d} halving (engine: modifyBasePower/
//   modifyBaseDefense hero hooks), life-comparison tiebreaks (Line Crossers,
//   engine: ctx.compareLife + the lifeTiebreak script marker), and the
//   Confidence defender limit (engine: Modifier.maxNonBlockDefenders).

const CONFIDENCE = "SLY034";
const MIGHT = "SLY035";




/** ctx.state is typed without the internal side tables; the runtime object has them. */

function hasKeyword(ctx: ScriptCtx, cardId: string, keyword: string): boolean {
  return (ctx.cardData(cardId).keywords ?? []).some(
    (k) => k.toLowerCase() === keyword.toLowerCase(),
  );
}

/** Auras you control (aura-subtype board cards: Suspense auras, Booze!, tokens). */
function countAuras(ctx: ScriptCtx): number {
  return ctx.player(ctx.seat).board.filter((c) => ctx.cardTypes(c).includes("aura")).length;
}

/** An "aura of suspense" is an aura with the Suspense keyword (SUP notes). */
function controlsSuspenseAura(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).board.some((c) => hasKeyword(ctx, c.cardId, "suspense"));
}

function crushTriggered(ctx: ScriptCtx): boolean {
  return !!ctx.link && ctx.link.hit && ctx.link.damage >= 4;
}

/** Nameable damage sources for Oasis Respite's "source of your choice":
 * arena objects, the active attack, and objects currently on the stack. */
function damageSourceCandidates(ctx: ScriptCtx): number[] {
  const ids: number[] = [];
  for (const p of ctx.state.players) {
    ids.push(p.hero.instanceId);
    for (const c of [...p.weapons, ...p.board]) ids.push(c.instanceId);
  }
  if (ctx.link) ids.push(ctx.link.attackingCard.instanceId);
  for (const layer of ctx.state.stack) ids.push(layer.sourceInstanceId);
  return [...new Set(ids)];
}

/** "If this has {p} greater than its base" — the attack's current bonus over
 *  base {p}, counting modifier- and script-granted buffs (Mocking Blow's own
 *  +N, ...) but not this card's own conditional bonus: the check must not
 *  fulfill itself. */
function aboveBase(ctx: ScriptCtx): boolean {
  const link = ctx.link;
  if (!link) return false;
  return ctx.attackBonusAboveBase(ctx.self.instanceId) > 0;
}

/**
 * Suspense (8.3.42): the aura enters with 2 suspense counters; a start-of-turn
 * trigger removes one and destroys the aura when it has none. The
 * destroyAtZeroCounter marker adds the state-based "when this has no
 * suspense counters, destroy it" net for counters removed any other way.
 * `onLeave` runs the card's "when this leaves the arena" effect.
 */
function suspense(onLeave?: (ctx: ScriptCtx) => void): CardScript {
  return suspenseAura({ onLeave, logCounterRemoval: true });
}

/** "The next attack this turn gets +N{p} when this leaves the arena." */
function suspenseBuff(n: number): CardScript {
  return suspense((ctx) => buffNextAttack(ctx, { attack: n }));
}

/** Mocking Blow cycle: boo on attack while ahead on life; +N if booed this turn. */
function mockingBlow(n: number): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) > 0) ctx.crowdBoo(ctx.seat);
    },
    modifyAttack(ctx) {
      return ctx.getFlag("player", "booedThisTurn") ? n : 0;
    },
  };
}

/** "If you control 3 or more auras, this gets +3{p} and 'When this hits a hero, …'" */
function goonAttack(onHitEffect: (ctx: ScriptCtx) => void): CardScript {
  return {
    modifyAttack(ctx) {
      return countAuras(ctx) >= 3 ? 3 : 0;
    },
    canTriggerOnHit(ctx) {
      return countAuras(ctx) >= 3 && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      onHitEffect(ctx);
    },
  };
}

/** Shared "greater than base" +1{p} for the SLY crush cycle. */
function slyCrush(onCrush: (ctx: ScriptCtx) => void): CardScript {
  return {
    modifyAttack(ctx) {
      return aboveBase(ctx) ? 1 : 0;
    },
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      onCrush(ctx);
    },
  };
}

/** Short Shrift crush: the opponent chooses a hand card to discard. */
function shortShrift(): CardScript {
  return {
    ...slyCrush((ctx) => {
      const opp = ctx.player(opponentSeat(ctx));
      if (opp.hand.length === 0) return;
      ctx.requestCardChoice(
        "crush-discard",
        decisionPrompt("Short Shrift crush: choose a card to discard", "card.sly.shortshrift.card.discard"),
        opp.hand.map((c) => c.instanceId),
        opponentSeat(ctx),
      );
    }),
    onChoose(ctx, hook, option) {
      if (hook !== "crush-discard") return;
      ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  };
}

export const sly: Record<string, CardScript> = {
  // Lyath halves (rounded up) the base {p}/{d} of cards you control; his
  // instant ability boos you and pumps your defending action cards; every boo
  // creates a Might token.
  "lyath goldmane|0": {
    modifyBasePower: (_ctx, _card, base) => Math.ceil(base / 2),
    modifyBaseDefense: (_ctx, _card, base) => Math.ceil(base / 2),
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      tap: true, // {t}
      timing: "instant",
      onActivate(ctx) {
        ctx.crowdBoo(ctx.seat);
        ctx.addModifier({ scope: "until-end-of-turn", defense: 1, appliesToCardType: "action" });
        ctx.logPublic(`${ctx.data.name}: defending action cards you control get +1{d} this turn`);
      },
    },
    onBooed(ctx) {
      ctx.createToken(MIGHT);
    },
  },

  "titan's fist|0": {
    // Once per Turn Action - {r}{r}{r}: Attack
    activated: attackAbility(3),
    modifyAttack(ctx) {
      return ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
        ctx.player(ctx.seat).pitch.some((c) => (ctx.cardData(c.cardId).cost ?? 0) >= 3)
        ? 1
        : 0;
    },
  },

  "stonewall impasse|0": {
    // Clash when it defends; on a win +1{d} until end of turn (the per-turn
    // flag keeps it for the rest of the turn, incl. later links). Temper is
    // engine-handled in closeChain.
    onDefend(ctx) {
      ctx.requestClash(opponentSeat(ctx), "stonewall-impasse");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "stonewall-impasse" && winner === ctx.seat) {
        ctx.setFlag("player", `clashWin:${ctx.self.instanceId}`, true);
      }
    },
    modifyDefense(ctx) {
      return ctx.getFlag("player", `clashWin:${ctx.self.instanceId}`) ? 1 : 0;
    },
  },

  "blade beckoner plating|0": {
    modifyDefense(ctx) {
      return isWeaponAttack(ctx) ? 1 : 0;
    },
  },

  // If you have the same {h} as another hero, it counts as you having more and them
  // having less (engine: lifeTiebreak marker, read by ctx.compareLife).
  "line crossers|0": { lifeTiebreak: true },

  "stand strong|0": {
    // Action - {r}{r}{r}, destroy this: Create a Confidence token (only with
    // an aura of suspense in play). Go again. Blade Break is engine-handled.
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: true,
      canActivate: (ctx) => controlsSuspenseAura(ctx),
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.createToken(CONFIDENCE);
      },
    },
  },

  "mocking blow|1": mockingBlow(4),
  "mocking blow|2": mockingBlow(3),
  "mocking blow|3": mockingBlow(2),

  "drag down|1": {
    onDefend(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: -3, seat: opponentSeat(ctx) });
      ctx.logPublic(`${ctx.data.name}: the attack gets -3{p}`);
    },
  },

  "prime the crowd|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4, appliesTo: "attack-action" });
      for (const p of ctx.state.players) {
        const subs = ctx.cardTypes(p.hero);
        if (subs.includes("revered")) ctx.crowdCheer(p.seat);
        if (subs.includes("reviled")) ctx.crowdBoo(p.seat);
      }
    },
  },

  "sadistic scowl|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 5 });
      queueIntimidate(ctx);
    },
  },

  "villainous pose|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4 });
      ctx.crowdBoo(ctx.seat);
    },
  },

  "act of glory|1": suspenseBuff(6),
  "edge of their seats|1": suspenseBuff(5),
  "edge of their seats|3": suspenseBuff(3),
  "tension in the air|1": suspenseBuff(4),

  "the suspense is killing me|3": {
    ...suspense(),
    modifyFriendlyAttack(ctx) {
      return Number(ctx.getFlag("player", "attacksDeclaredThisTurn")) === 1 ? 1 : 0;
    },
  },

  "oasis respite|1": {
    // "Prevent the next 4 damage that would be dealt to target hero this turn
    // by a source of your choice" — two chained choices: the hero, then the
    // source (the specific object instance; a later copy is not covered).
    onPlay(ctx) {
      ctx.requestCardChoice(
        "target-hero",
        decisionPrompt("Oasis Respite: target which hero?", "card.sly.oasis.hero.choose"),
        ctx.state.players.map((player) => player.hero.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "target-hero") {
        const target = ctx.state.players.find(
          (player) => player.hero.instanceId === Number(option),
        );
        if (!target) return;
        ctx.setCounter("oasisTarget", target.seat);
        ctx.requestCardChoice("source", decisionPrompt("Prevent the next 4 damage from which source?", "card.sly.damage.source.choose", { values: { amount: 4 } }), damageSourceCandidates(ctx));
        return;
      }
      if (hook === "source") {
        const target = ctx.getCounter("oasisTarget");
        ctx.preventNextDamage(target, 4, Number(option));
        // "If they have less life than each other hero, they may gain 1{h}" —
        // the targeted hero's controller decides
        if (ctx.compareLife(target, target === 0 ? 1 : 0) < 0) {
          ctx.requestChoice("gain-life", yesNoPrompt("Oasis Respite: gain 1 life?", "card.sly.oasis.life.gain", { amount: 1 }), ["yes", "no"], target);
        }
        return;
      }
      if (hook === "gain-life" && option === "yes") {
        ctx.gainLife(ctx.getCounter("oasisTarget"), 1);
      }
    },
  },

  "short shrift|2": shortShrift(),

  "walk in my shoes|2": slyCrush((ctx) => {
    // "until the end of their next turn": the hero counter survives end-of-turn
    // flag cleanup and covers the rest of this turn plus their next turn
    const hero = ctx.player(opponentSeat(ctx)).hero;
    ctx.setCardCounter(hero.instanceId, "halveBaseAttackActionUntil", ctx.state.turn + 1);
    ctx.logPublic(`${ctx.data.name}: opponent's attack action cards' base {p}/{d} are halved until end of their next turn`);
  }),

  "wee wrecking ball|2": slyCrush((ctx) => {
    const opp = ctx.player(opponentSeat(ctx));
    const c = opp.arsenal[0];
    if (!c) return;
    ctx.logPublic(`${ctx.data.name} destroys ${ctx.cardData(c.cardId).name} in their arsenal`);
    ctx.moveToGraveyard(c.instanceId, "arsenal");
  }),

  "brothers in arms|3": {
    // "When this defends, you may pay {r}. If you do, it gets +2{d}."
    // Payment (including any pitch) is offered when the trigger resolves.
    defendCost: 1,
    ...payForDefenseBoost(1, 2, { logMessage: (ctx) => `${ctx.data.name} gets +2{d}` }),
  },

  "full of bravado|3": {
    onAttackDeclared(ctx) {
      if (controlsSuspenseAura(ctx)) ctx.createToken(CONFIDENCE);
    },
    canTriggerOnDefend: controlsSuspenseAura,
    onDefend(ctx) {
      if (controlsSuspenseAura(ctx)) ctx.createToken(CONFIDENCE);
    },
  },

  "goon beatdown|3": goonAttack((ctx) => ctx.crowdBoo(ctx.seat)),

  "goon tactics|3": goonAttack((ctx) => {
    const opp = ctx.player(opponentSeat(ctx));
    const top = opp.deck[0];
    if (!top) return;
    ctx.logPublic(`${ctx.data.name} destroys the top card of their deck (${ctx.cardData(top.cardId).name})`);
    ctx.moveToGraveyard(top.instanceId, "deck");
  }),

  "power play|3": {
    canPlay(ctx) {
      // counters persist on the card while it leaves its zone (unlike flags)
      ctx.setCounter("fromArsenal", ctx.player(ctx.seat).arsenal.includes(ctx.self) ? 1 : 0);
      return true;
    },
    modifyAttack(ctx) {
      return ctx.getCounter("fromArsenal") ? 5 : 0;
    },
  },

  "booze!|3": {
    onEnterArena(ctx) {
      ctx.crowdBoo(ctx.seat);
    },
    onDestroyed(ctx) {
      ctx.crowdBoo(ctx.seat);
    },
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Booze!",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },

  "concealed object|3": {
    onEnterArena(ctx) {
      ctx.crowdBoo(ctx.seat);
    },
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      tap: true, // {t}
      timing: "instant",
      canActivate: (ctx) => !!ctx.link,
      onActivate(ctx) {
        const link = ctx.link;
        if (!link) return;
        ctx.addModifier({ scope: "chain-link", attack: 1, seat: link.attacker });
        ctx.logPublic(`${ctx.data.name}: target attack gets +1{p}`);
      },
    },
    triggers: [
      {
        event: "end-of-turn",
        label: "Destroy Concealed Object",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },

  "might|0": {
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Might (next attack +1{p})",
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, { attack: 1 });
        },
      },
    ],
  },

  "confidence|0": {
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Confidence (next attack: max 2 non-block defenders)",
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, { maxNonBlockDefenders: 2 });
        },
      },
    ],
  },
};
