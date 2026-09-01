import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, isCard, opponentSeat } from "./shared-helpers.js";

// ── SFA (Silver Age: Fai precon, Chapter 2) ─────────────────────────────────
//
// Draconic Ninja cards. New mechanics used here (all engine-native):
// - Granted card types: Modifier.grantType makes matching attacks count as
//   having a class/subtype in addition to their printed types ("your next
//   attack is Draconic", "your attacks are Draconic this combat chain" — the
//   latter rides the combat-chain modifier scope, cleared by closeChain).
//   Grants are stamped on the chain link (`grantedType:<tag>`) at declaration
//   so resolved links keep counting (last-known information while the chain
//   is open, per the Uprising rules reprise).
// - "Draconic chain links you control": chainLinksControlled(state, seat,
//   "draconic") — resolved links stay on state.chain until the chain closes.
//   The current attack counts from the Attack Step (including for its own
//   effects), but not while it is still unresolved in the Layer Step.
// - "Attacks that have hit this combat chain": hitsThisCombatChain.
// - Rupture (CR 8.4.6): a label keyword — scripts check chainLinkNumber.
// - Ephemeral (CR 8.3.21): engine-native — the card ceases to exist instead
//   of hitting the graveyard (the deckbuilding half of the rule — Ephemeral
//   cards can't start in a deck — is not enforced; tokens are created, never
//   registered).
// - Fai's start-of-game Phoenix Flame rides the onGameStart hero hook; his
//   "{r} less for each Draconic chain link" rides ActivatedAbility.modifyCost.
// - Mask of the Swarming Claw's "Spellvoid X" rides the spellvoidValue hook.
// - Rising Resentment's "it costs {r} less to play" rides the per-instance
//   playCostReduction granted with allowPlayFrom.
// - Fealty's "the next card you play this turn is Draconic" rides the
//   next-play modifier scope (consumed by noteCardPlayed).
const CROUCHING_TIGER = "SFA036";
const FEALTY = "SFA037";


/** ctx.state is typed without the internal side tables; the runtime object has them. */


/** "Draconic chain links you control" — incl. the current attacking card. */
function draconicLinks(ctx: ScriptCtx): number {
  return ctx.chainLinksControlled(ctx.seat, "draconic");
}

/** "If it is Draconic" — the current attack, printed or granted. */
function currentAttackIsDraconic(ctx: ScriptCtx): boolean {
  return ctx.currentAttackHasType("draconic");
}

function isPhoenixFlame(ctx: ScriptCtx, cardId: string): boolean {
  return isCard(ctx, cardId, "Phoenix Flame", 1);
}

/** Living ally permanents on either board (ally subtype + life property) —
 *  valid "any target" choices alongside the heroes. */
function livingAllyIds(ctx: ScriptCtx): number[] {
  return ctx.state.players.flatMap((p) =>
    p.board
      .filter(
        (c) =>
          ctx.cardTypes(c).includes("ally") &&
          ctx.cardData(c.cardId).life !== undefined,
      )
      .map((c) => c.instanceId),
  );
}

/** "If you've played another red card this turn" — the resolving card is red
 *  and noteCardPlayed has already counted it, so >= 2 means another red. */
function playedAnotherRed(ctx: ScriptCtx): boolean {
  return (Number(ctx.getFlag("player", "playedPitch:1")) || 0) >= 2;
}

/** Instant — Destroy this equipment: gain {r} (Blood Scent / Double Cross
 *  Strap). The destruction happens at resolution (stack-layer precedent). */
function destroyGainResource(canActivate: (ctx: ScriptCtx) => boolean, label: string): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label,
      canActivate,
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.changeResources(ctx.seat, 1);
        ctx.logPublic(`${ctx.data.name} is destroyed: gain {r}`);
      },
    },
  };
}

/** "When Mounting Anger / Rising Resentment hits, you may banish an attack
 *  action card from your hand with cost less than the number of Draconic
 *  chain links you control. If you do, … and you may play it this turn." */
function banishAttackOnHit(hook: string, reward: string): CardScript {
  return {
    onHit(ctx) {
      const n = draconicLinks(ctx);
      if (n <= 0) return;
      const targets = ctx.player(ctx.seat).hand.filter((c) => {
        const d = ctx.cardData(c.cardId);
        return (
          ctx.hasCardType(c, "action") &&
          ctx.cardTypes(c).includes("attack") &&
          (d.cost ?? 0) < n
        );
      });
      if (targets.length === 0) return;
      ctx.requestCardChoice(
        hook,
        `${ctx.data.name}: banish an attack action with cost less than ${n} — it ${reward} and you may play it this turn`,
        ["pass", ...targets.map((c) => c.instanceId)],
      );
    },
    onChoose(ctx, h, option) {
      if (h !== hook || option === "pass") return;
      const id = Number(option);
      if (!ctx.banish(id)) return;
      if (reward === "gains +1{p}") {
        ctx.addCounter(id, "power", 1);
        ctx.allowPlayFrom(id, "banish");
      } else {
        ctx.allowPlayFrom(id, "banish", { costReduction: 1 });
      }
      ctx.logPublic(`${ctx.data.name}: the banished card ${reward} — you may play it this turn`);
    },
  };
}

/** Brand with Cinderclaw (all three pitches): "Your next attack this combat
 *  chain is Draconic in addition to its other card types." */
const brandWithCinderclaw: CardScript = {
  onAttackDeclared(ctx) {
    buffNextAttack(ctx, { grantType: "draconic", expiresOnChainClose: true });
    ctx.logPublic(`${ctx.data.name}: your next attack this combat chain is Draconic`);
  },
};

export const sfa: Record<string, CardScript> = {
  // ── Hero ──────────────────────────────────────────────────────────────────

  "fai|0": {
    // "You may start the game with a Phoenix Flame in your graveyard."
    onGameStart(ctx) {
      const p = ctx.player(ctx.seat);
      const i = p.deck.findIndex((c) => isPhoenixFlame(ctx, c.cardId));
      if (i < 0) return;
      ctx.requestChoice(
        "fai-start-flame",
        "Fai: start the game with a Phoenix Flame in your graveyard?",
        ["yes", "no"],
      );
    },
    // "Once per Turn Instant — {r}{r}{r}: Return a Phoenix Flame from your
    //  graveyard to your hand. This ability costs {r} less for each Draconic
    //  chain link you control."
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      timing: "instant",
      label: "Return a Phoenix Flame from your graveyard to your hand",
      modifyCost: (ctx, base) => base - draconicLinks(ctx),
      canActivate: (ctx) => ctx.player(ctx.seat).graveyard.some((c) => isPhoenixFlame(ctx, c.cardId)),
      onActivate(ctx) {
        const flames = ctx.player(ctx.seat).graveyard.filter((c) => isPhoenixFlame(ctx, c.cardId));
        ctx.requestCardChoice(
          "fai-return",
          "Fai: return a Phoenix Flame from your graveyard to your hand",
          flames.map((c) => c.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "fai-start-flame") {
        if (option !== "yes") return;
        const flame = ctx.player(ctx.seat).deck.find((c) => isPhoenixFlame(ctx, c.cardId));
        if (!flame) return;
        ctx.moveToGraveyard(flame.instanceId, "deck");
        ctx.shuffleDeck();
        ctx.logPublic("Fai: a Phoenix Flame starts the game in your graveyard");
        return;
      }
      if (hook !== "fai-return") return;
      const flame = ctx.player(ctx.seat).graveyard.find((c) => c.instanceId === Number(option));
      if (!flame) return;
      ctx.moveToHand(flame.instanceId);
      ctx.logPublic(`Fai: ${ctx.cardData(flame.cardId).name} returns to your hand`);
    },
  },

  // ── Weapon ────────────────────────────────────────────────────────────────

  "searing emberblade|0": {
    // Once per Turn Action — {r}{r}: Attack. "If you control 2 or more
    //  Draconic chain links, this card's attacks get go again."
    activated: attackAbility(2),
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      if (draconicLinks(ctx) >= 2) ctx.grantGoAgain();
    },
  },

  // ── Equipment ─────────────────────────────────────────────────────────────

  "mask of the swarming claw|0": {
    // Arcane Barrier 1 is native. "Spellvoid X, where X is the number of
    //  chain links you control" — the dynamic hook feeds the Spellvoid
    //  prevention decision.
    spellvoidValue: (ctx) => ctx.chainLinksControlled(ctx.seat),
  },

  "blood scent|0": destroyGainResource(
    // "Activate this only if you've attacked with a Crouching Tiger this
    //  turn." The Tiger is an attack action — playing it IS attacking with it.
    (ctx) => ctx.getFlag("player", "playedName:crouching tiger") === true,
    "Destroy: gain {r} (needs a Crouching Tiger attack this turn)",
  ),

  "double cross strap|0": destroyGainResource(
    // "Activate this only if you've hit 2 or more times this combat chain."
    (ctx) => ctx.hitsThisCombatChain(ctx.seat) >= 2,
    "Destroy: gain {r} (needs 2+ hits this combat chain)",
  ),

  "tearing shuko|0": {
    // "Instant — Destroy this: The next Crouching Tiger you play this turn
    //  gains +2{p}." Battleworn is native.
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: the next Crouching Tiger you play gets +2{p}",
      onActivate(ctx) {
        ctx.destroySelf();
        buffNextAttack(ctx, { attack: 2, appliesToName: "crouching tiger" });
        ctx.logPublic("Tearing Shuko: the next Crouching Tiger you play this turn gets +2{p}");
      },
    },
  },

  "pouncing paws|0": {
    // "Instant — Destroy this: Create a Crouching Tiger in your banished
    //  zone. You may play it this turn." Battleworn is native.
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: create a Crouching Tiger in your banished zone",
      onActivate(ctx) {
        ctx.destroySelf();
        const tiger = ctx.createToken(CROUCHING_TIGER);
        if (!tiger) return;
        ctx.banish(tiger.instanceId);
        ctx.allowPlayFrom(tiger.instanceId, "banish");
        ctx.logPublic("Pouncing Paws: the Crouching Tiger may be played this turn");
      },
    },
  },

  // ── Attacks ───────────────────────────────────────────────────────────────

  "art of the dragon: fire|1": {
    // "When this attacks, if it is Draconic, deal 2 damage to any target."
    //  Any target = any hero or any living ally, either player's.
    onAttackDeclared(ctx) {
      if (!currentAttackIsDraconic(ctx)) return;
      ctx.requestCardChoice(
        "art-of-the-dragon",
        "Art of the Dragon: Fire — deal 2 damage to any target",
        [...ctx.state.players.map((p) => p.hero.instanceId), ...livingAllyIds(ctx)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "art-of-the-dragon") return;
      const id = Number(option);
      const hero = ctx.state.players.find((p) => p.hero.instanceId === id);
      if (hero) {
        ctx.dealDamage(hero.seat, 2);
        return;
      }
      const ally = ctx.state.players.flatMap((p) => p.board).find((c) => c.instanceId === id);
      if (ally) ctx.dealDamage(ally.owner, 2, { targetAllyId: id });
    },
  },

  "blaze headlong|1": {
    // "If you've played another red card this turn, this gets go again."
    //  (Go again is conditional — KEYWORD_OVERRIDES strips the printed keyword.)
    onAttackDeclared(ctx) {
      if (playedAnotherRed(ctx)) ctx.grantGoAgain();
    },
  },

  "brand with cinderclaw|1": brandWithCinderclaw,
  "brand with cinderclaw|2": brandWithCinderclaw,
  "brand with cinderclaw|3": brandWithCinderclaw,

  "display loyalty|1": {
    // "If you control 2 or more Draconic chain links, this gets go again and
    //  'When this attacks a hero, create a Fealty token.'"
    //  (Go again is conditional — KEYWORD_OVERRIDES strips the printed keyword.)
    onAttackDeclared(ctx) {
      if (draconicLinks(ctx) < 2) return;
      ctx.grantGoAgain();
      if (ctx.link?.targetAllyId === undefined) ctx.createToken(FEALTY);
    },
  },

  "enflame the firebrand|1": {
    // "When this attacks, if you control 2 or more Draconic chain links, this
    //  gets go again, 3 or more, your attacks are Draconic this combat chain,
    //  4 or more, this gets +2{p}."
    onAttackDeclared(ctx) {
      const n = draconicLinks(ctx);
      if (n >= 2) ctx.grantGoAgain();
      if (n >= 3) {
        ctx.addModifier({ scope: "combat-chain", grantType: "draconic" });
        ctx.logPublic(`${ctx.data.name}: your attacks are Draconic this combat chain`);
      }
      if (n >= 4) ctx.addModifier({ scope: "chain-link", attack: 2 });
    },
  },

  "fire tenet: strike first|1": {
    // "When this attacks, your next Draconic attack this combat chain gets
    //  +1{p}." Go again is printed (native).
    onAttackDeclared(ctx) {
      buffNextAttack(ctx, {
        attack: 1,
        appliesToSubtype: "draconic",
        expiresOnChainClose: true,
      });
      ctx.logPublic(`${ctx.data.name}: your next Draconic attack this combat chain gets +1{p}`);
    },
  },

  "fire that burns within|1": {
    // "When this attacks, you may discard a Phoenix Flame. If you do, draw a
    //  card and this gets +2{p}." Go again is printed (native).
    onAttackDeclared(ctx) {
      const flames = ctx.player(ctx.seat).hand.filter((c) => isPhoenixFlame(ctx, c.cardId));
      if (flames.length === 0) return;
      ctx.requestCardChoice(
        "fire-that-burns",
        "Fire that Burns Within: discard a Phoenix Flame to draw a card and get +2{p}?",
        ["pass", ...flames.map((c) => c.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "fire-that-burns" || option === "pass") return;
      if (!ctx.discardCard(ctx.seat, Number(option))) return;
      ctx.drawCards(ctx.seat, 1);
      ctx.addModifier({ scope: "chain-link", attack: 2 });
      ctx.logPublic(`${ctx.data.name}: draw a card and get +2{p}`);
    },
  },

  "flamecall awakening|1": {
    // "When you attack with Flamecall Awakening, if you've played another red
    //  card this turn, you may search your deck for a Phoenix Flame, reveal
    //  it, put it into your hand, then shuffle." Go again is printed (native).
    onAttackDeclared(ctx) {
      if (!playedAnotherRed(ctx)) return;
      const p = ctx.player(ctx.seat);
      if (!p.deck.some((c) => isPhoenixFlame(ctx, c.cardId))) return;
      ctx.requestCardChoice(
        "flamecall-search",
        "Flamecall Awakening: search your deck for a Phoenix Flame?",
        [
          "pass",
          ...p.deck.filter((c) => isPhoenixFlame(ctx, c.cardId)).map((c) => c.instanceId),
        ],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "flamecall-search") return;
      if (option !== "pass") {
        const flame = ctx.player(ctx.seat).deck.find((c) => c.instanceId === Number(option));
        if (flame) {
          ctx.moveToHand(flame.instanceId);
          ctx.logPublic(`${ctx.data.name}: ${ctx.cardData(flame.cardId).name} is revealed and put into your hand`);
        }
      }
      ctx.shuffleDeck();
    },
  },

  "hot on their heels|1": {
    // "If you control 2 or more Draconic chain links, this gets go again and
    //  'When this hits a hero, mark them.'" (Go again is conditional —
    //  KEYWORD_OVERRIDES strips the printed keyword; the chain can't shrink
    //  between declaration and the hit, so the hit re-checks the count.)
    onAttackDeclared(ctx) {
      if (draconicLinks(ctx) >= 2) ctx.grantGoAgain();
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && draconicLinks(ctx) >= 2;
    },
    onHit(ctx) {
      const hero = ctx.player(opponentSeat(ctx)).hero;
      if ((hero.counters?.marked ?? 0) > 0) return;
      ctx.addCounter(hero.instanceId, "marked", 1);
      ctx.logPublic(`${ctx.cardData(hero.cardId).name} is marked`);
    },
  },

  "lava burst|1": {
    // Rupture — "If Lava Burst is played as chain link 4 or higher, it has
    //  +3{p}."
    modifyAttack: (ctx) =>
      ctx.currentChainLinkNumber() >= 4 ? 3 : 0,
  },

  "mounting anger|1": banishAttackOnHit("mounting-anger", "gains +1{p}"),

  "phoenix flame|1": {
    // "If you control 2 or more Draconic chain links, this gets +1{p}."
    //  Go again is printed (native).
    modifyAttack: (ctx) => (draconicLinks(ctx) >= 2 ? 1 : 0),
  },

  "rising resentment|1": banishAttackOnHit("rising-resentment", "costs {r} less to play"),

  "salt the wound|2": {
    // "This gets +1{p} for each attack that has hit this combat chain."
    modifyAttack: (ctx) => ctx.hitsThisCombatChain(),
  },

  "cinderskin devotion|3": {
    // "If you control 2 or more Draconic chain links, this gets go again."
    //  (Go again is conditional — KEYWORD_OVERRIDES strips the printed keyword.)
    onAttackDeclared(ctx) {
      if (draconicLinks(ctx) >= 2) ctx.grantGoAgain();
    },
  },

  "dragon power|3": {
    // "When this attacks, if it is Draconic, it gets +3{p}."
    modifyAttack: (ctx) => (currentAttackIsDraconic(ctx) ? 3 : 0),
  },

  // ── Non-attack action ─────────────────────────────────────────────────────

  "rise from the ashes|1": {
    // "The next Draconic or Ninja attack action card you play this turn gains
    //  +3{p}. You may return a Phoenix Flame from your graveyard to your
    //  hand." Go again is printed (native).
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3,
        appliesTo: "attack-action",
        appliesToType: ["draconic", "ninja"], });
      const flames = ctx.player(ctx.seat).graveyard.filter((c) => isPhoenixFlame(ctx, c.cardId));
      if (flames.length > 0) {
        ctx.requestCardChoice(
          "rise-from-the-ashes",
          "Rise from the Ashes: return a Phoenix Flame from your graveyard to your hand?",
          ["pass", ...flames.map((c) => c.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "rise-from-the-ashes" || option === "pass") return;
      const flame = ctx.player(ctx.seat).graveyard.find((c) => c.instanceId === Number(option));
      if (!flame) return;
      ctx.moveToHand(flame.instanceId);
      ctx.logPublic(`${ctx.data.name}: ${ctx.cardData(flame.cardId).name} returns to your hand`);
    },
  },

  // ── Reactions ─────────────────────────────────────────────────────────────

  "wax on|1": {
    // "While Wax On is defending an attack action card with cost 0, it gains
    //  +2{d}."
    modifyDefense(ctx) {
      const link = ctx.link;
      if (!link || link.attackCardType !== "action") return 0;
      return (ctx.cardData(link.attackingCard.cardId).cost ?? 0) === 0 ? 2 : 0;
    },
  },

  "nip at the heels|3": {
    // "Target attack with 3 or less base {p} gets +1{p}."
    canPlay(ctx) {
      const link = ctx.link;
      if (!link || link.resolved) return false;
      return ctx.basePower(link.attackingCard.instanceId) <= 3;
    },
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      ctx.logPublic(`${ctx.data.name}: the attack gets +1{p}`);
    },
  },

  // ── Tokens ────────────────────────────────────────────────────────────────

  "fealty|0": {
    // "Instant — Destroy this: The next card you play this turn is Draconic."
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      label: "Destroy: the next card you play this turn is Draconic",
      onActivate(ctx) {
        ctx.addModifier({ scope: "next-play", grantType: "draconic" });
        ctx.logPublic("Fealty: the next card you play this turn is Draconic");
      },
    },
    // "At the beginning of your end phase, if you haven't created a Fealty
    //  token or played a Draconic card this turn, destroy this."
    triggers: [
      {
        event: "end-of-turn",
        condition: (ctx) =>
          !ctx.getFlag("player", "createdName:fealty") &&
          !ctx.getFlag("player", "playedSubtype:draconic") &&
          !ctx.getFlag("player", "playedClass:draconic"),
        label: "Destroy Fealty",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },
};
