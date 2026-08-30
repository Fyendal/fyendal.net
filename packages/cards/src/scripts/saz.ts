import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, opponentSeat, optN, optOnChoose } from "./shared-helpers.js";

// ── SAZ (Silver Age: Azalea precon, Chapter 2) ──────────────────────────────
//
// Ranger cards. New mechanics used here (all engine-native):
// - Arrows (CR 8.2.6a): the engine restricts arrow-subtype cards to being
//   played from the arsenal, and only while their controller has a bow in a
//   weapon slot (playCard validation + intent enumeration).
// - "Put into your arsenal face up" rides ctx.putIntoArsenal, which fires the
//   new onEnterArsenal hook — on the entering card itself (Dry Powder Shot,
//   Entangling Shot, Ridge Rider Shot, Spire Sniping) and on the controller's
//   permanents (Crow's Nest). `from` names the source zone for Crow's Nest's
//   "from your deck" condition.
// - Per-instance "until end of turn" grants: CardInstance.grantedKeywords
//   (Azalea's dominate, Swift Shot's go again — consulted for attacks) and
//   CardInstance.tempPower (Bull's Eye Bracers, Dry Powder Shot — counted by
//   computeAttack/attackBonusAboveBase); both cleared at end of turn.
// - "Played from arsenal" is stamped on the chain link (fromArsenal flag) at
//   declaration; Scout the Periphery filters its next-attack modifier on it
//   (Modifier.appliesToFromArsenal) and Frailty reads it in modifyAttack.
// - "Damage … can't be prevented" (Murkmire Grapnel) is the unpreventable
//   link flag: resolveLink skips prevention shields and the Ward decision.
// - "Defense reactions can't be played … this chain link": the
//   noDefenseReactions link flag (Widowmaker) and the
//   Modifier.noDefenseReactionsFromArsenal field (Release the Tension),
//   enforced in enumeration and validation via defenseReactionRestriction.
// - Piercing 1 (Drill Shot) is scripted per CR 8.3.23 ("if this is defended
//   by an equipment, it gets +1{p}") — conditional on its aim counter.
// - Reload (CR 8.5.23): optional "hand card → arsenal if arsenal is empty".
// - Aim counters ride the generic named counters on the card instance.
//
const BLOODROT_POX = "SAZ034";
const FRAILTY = "SAZ035";
const INERTIA = "SAZ036";




/** ctx.state is typed without the internal side tables; the runtime object has them. */

function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("arrow");
}

function hasAimCounter(ctx: ScriptCtx): boolean {
  return (ctx.self.counters?.aim ?? 0) > 0;
}

/** The granted "when this hits a hero" effect rides the link that picked up
 *  this card's next-attack modifier (Lace with X / Drop the Anchor). */
function armedBySelf(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some(
    (m) => m.scope === "chain-link" && m.sourceInstanceId === ctx.self.instanceId,
  );
}

/** Reload (CR 8.5.23): if the player's arsenal is empty, they may move a card
 *  from their hand to their arsenal. */
function reload(ctx: ScriptCtx): void {
  const p = ctx.player(ctx.seat);
  if (p.arsenal.length > 0 || p.hand.length === 0) return;
  ctx.requestCardChoice(
    "reload",
    "Reload: put a card from your hand into your arsenal?",
    ["pass", ...p.hand.map((c) => c.instanceId)],
  );
}

/** Handles the "reload" choice; returns true when the hook was a reload hook. */
function reloadOnChoose(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== "reload") return false;
  if (option !== "pass") {
    ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
  }
  return true;
}

/** "You may put an arrow card from your hand face up into your arsenal." */
function requestArrowToArsenal(ctx: ScriptCtx, hook: string, prompt: string): void {
  const p = ctx.player(ctx.seat);
  const arrows = p.hand.filter((c) => isArrow(ctx, c));
  if (p.arsenal.length > 0 || arrows.length === 0) return;
  ctx.requestCardChoice(hook, prompt, ["pass", ...arrows.map((c) => c.instanceId)]);
}

/** "Your next arrow attack this turn gets +3{p} and <on-hit rider>" (Lace
 *  with X / Drop the Anchor): the +3 rides a next-attack modifier; the rider
 *  is dispatched from the card's onHit via a until-end-of-turn marker. */
function nextArrowPlusRider(rider: (ctx: ScriptCtx) => void): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow" });
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

export const saz: Record<string, CardScript> = {
  // ── Hero ──────────────────────────────────────────────────────────────────

  "azalea|0": {
    // "Once per Turn Action — 0: Put a card from your arsenal on the bottom of
    //  your deck. If you do, put the top card of your deck face up into your
    //  arsenal. If it's an arrow card, it gains dominate until end of turn.
    //  Go again." (Arsenal holds at most one card here — no choice needed.)
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Arsenal card to deck bottom; deck top to arsenal (arrows gain dominate)",
      canActivate: (ctx) => ctx.player(ctx.seat).arsenal.length > 0,
      onActivate(ctx) {
        const p = ctx.player(ctx.seat);
        const card = p.arsenal[0];
        if (!card) return;
        ctx.putOnDeckBottom(card.instanceId);
        ctx.logPrivate(
          ctx.seat,
          `Azalea: ${ctx.cardData(card.cardId).name} goes on the bottom of the deck`,
          "Azalea: the arsenal card goes on the bottom of the deck",
        );
        const top = p.deck[0];
        if (!top) return;
        ctx.putIntoArsenal(top.instanceId, "deck");
        if (isArrow(ctx, top)) {
          ctx.grantCardKeyword(top.instanceId, "dominate");
          ctx.logPublic(`Azalea: ${ctx.cardData(top.cardId).name} gains dominate until end of turn`);
        }
      },
    },
  },

  // ── Weapon ────────────────────────────────────────────────────────────────

  "death dealer|0": {
    // "Once per Turn Action — {r}: If you have no cards in your arsenal, you
    //  may put an arrow card from your hand face up into your arsenal. If you
    //  do, draw a card. Go again."
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Put an arrow from your hand into your arsenal; draw a card",
      canActivate: (ctx) =>
        ctx.player(ctx.seat).arsenal.length === 0 &&
        ctx.player(ctx.seat).hand.some((c) => isArrow(ctx, c)),
      onActivate(ctx) {
        requestArrowToArsenal(
          ctx,
          "death-dealer",
          "Death Dealer: put an arrow from your hand into your arsenal?",
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "death-dealer" || option === "pass") return;
      const card = ctx.player(ctx.seat).hand.find((c) => c.instanceId === Number(option));
      if (!card) return;
      // the arrow comes from the hand, so drawing first is equivalent — and
      // the arrow's enter-arsenal trigger then correctly sees the post-draw
      // deck (a trigger resolves after the ability that caused it)
      ctx.drawCards(ctx.seat, 1);
      ctx.putIntoArsenal(card.instanceId, "hand");
    },
  },

  // ── Equipment ─────────────────────────────────────────────────────────────

  "crow's nest|0": {
    // "Whenever an arrow is put face up into your arsenal from your deck, you
    //  may pay {r}. If you do, put an aim counter on it."
    onEnterArsenal(ctx, card, from) {
      if (from !== "deck" || !isArrow(ctx, card)) return;
      ctx.requestPayment(
        `crows-nest:${card.instanceId}`,
        "Crow's Nest: pay {r} to put an aim counter on the arrow?",
        1,
      );
    },
    onChoose(ctx, hook, option) {
      const m = /^crows-nest:(\d+)$/.exec(hook);
      if (!m || option !== "paid") return;
      ctx.addCounter(Number(m[1]), "aim", 1);
      ctx.logPublic("Crow's Nest: the arrow gets an aim counter");
    },
  },

  "bull's eye bracers|0": {
    // "Action — Destroy this: If you have no cards in your arsenal, you may
    //  put an arrow card from your hand face up into your arsenal. It gains
    //  +1{p} until end of turn. Go again." Arcane Barrier 1 is native.
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      label: "Destroy: put an arrow from your hand into your arsenal — it gains +1{p} this turn",
      canActivate: (ctx) =>
        ctx.player(ctx.seat).arsenal.length === 0 &&
        ctx.player(ctx.seat).hand.some((c) => isArrow(ctx, c)),
      onActivate(ctx) {
        requestArrowToArsenal(
          ctx,
          "bulls-eye",
          "Bull's Eye Bracers: put an arrow from your hand into your arsenal — it gains +1{p} this turn?",
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "bulls-eye" || option === "pass") return;
      const card = ctx.player(ctx.seat).hand.find((c) => c.instanceId === Number(option));
      if (!card || !ctx.putIntoArsenal(card.instanceId, "hand")) return;
      ctx.destroySelf();
      ctx.addCardTempPower(card.instanceId, 1);
      ctx.logPublic(`Bull's Eye Bracers: ${ctx.cardData(card.cardId).name} gets +1{p} this turn`);
    },
  },

  "bolt'n boots|0": {
    // "Attack Reaction — {r}, destroy this: Target arrow attack with {p}
    //  greater than its base gets go again." Battleworn is native.
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      label: "{r}, destroy: an arrow attack above its base {p} gets go again",
      canActivate(ctx) {
        const link = ctx.link;
        if (!link || link.attacker !== ctx.seat) return false;
        if (!isArrow(ctx, link.attackingCard)) return false;
        return ctx.attackBonusAboveBase(link.attackingCard.instanceId) > 0;
      },
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.grantGoAgain();
      },
    },
  },

  // ── Arrows ────────────────────────────────────────────────────────────────

  "bolt'n' shot|1": {
    // "If Bolt'n' Shot's {p} is greater than its base {p}, it has go again
    //  and 'If this hits, reload.'" (Go again / Reload are conditional —
    //  KEYWORD_OVERRIDES strips the printed keywords.)
    onAttackDeclared(ctx) {
      const link = ctx.link;
      if (!link) return;
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
  },

  "drill shot|1": {
    // "If Drill Shot has an aim counter, it has piercing 1." Piercing 1 (CR
    //  8.3.23): "if this is defended by an equipment, it gets +1{p}".
    //  (KEYWORD_OVERRIDES strips the printed conditional keyword.)
    onAttackDeclared(ctx) {
      if (hasAimCounter(ctx)) ctx.addModifier({ scope: "chain-link", piercing: 1 });
    },
    // "When this hits a hero, put a -1{d} counter on an equipment they control."
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const equips = Object.values(ctx.player(opponentSeat(ctx)).equipment).filter(
        (c): c is CardInstance => !!c,
      );
      if (equips.length === 0) return;
      ctx.requestCardChoice(
        "drill-shot",
        "Drill Shot: put a -1{d} counter on an equipment they control",
        equips.map((c) => c.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "drill-shot") return;
      const eq = Object.values(ctx.player(opponentSeat(ctx)).equipment).find(
        (c) => c?.instanceId === Number(option),
      );
      if (!eq) return;
      ctx.addCardDefenseCounters(eq.instanceId, 1);
      ctx.logPublic(`Drill Shot: ${ctx.cardData(eq.cardId).name} gets a -1{d} counter`);
    },
  },

  "dry powder shot|1": {
    // "When this is put face-up into your arsenal, it gets +2{p} this turn."
    onEnterArsenal(ctx) {
      ctx.addCardTempPower(ctx.self.instanceId, 2);
      ctx.logPublic(`${ctx.data.name} gets +2{p} this turn`);
    },
  },

  "entangling shot|1": {
    // "When this is put face-up into your arsenal, you may {t} target hero."
    onEnterArsenal(ctx) {
      ctx.requestCardChoice(
        "entangling-shot",
        "Entangling Shot: tap target hero?",
        ["pass", ...ctx.state.players.map((p) => p.hero.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "entangling-shot" || option === "pass") return;
      ctx.tap(Number(option));
    },
  },

  "infecting shot|1": {
    modifyAttack: (ctx) => (hasAimCounter(ctx) ? 1 : 0),
    // "When this hits a hero, create a Bloodrot Pox token under their control."
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ctx.createToken(BLOODROT_POX, opponentSeat(ctx));
    },
  },

  "infecting shot|2": {
    modifyAttack: (ctx) => (hasAimCounter(ctx) ? 1 : 0),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      ctx.createToken(BLOODROT_POX, opponentSeat(ctx));
    },
  },

  "murkmire grapnel|1": {
    // "Damage that would be dealt by Murkmire Grapnel can't be prevented."
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "unpreventable", true);
    },
    modifyAttack: (ctx) => (hasAimCounter(ctx) ? 1 : 0),
  },

  "ridge rider shot|1": {
    // "If Ridge Rider Shot is put into your arsenal face up, opt 1."
    onEnterArsenal(ctx) {
      optN(ctx, 1);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  },

  "searing shot|1": {
    // "If Searing Shot hits a hero, they lose 1{h}." Life loss, not damage —
    //  it bypasses prevention.
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const seat = opponentSeat(ctx);
      ctx.loseLife(seat, 1);
      const opp = ctx.player(seat);
      ctx.logPublic(`${ctx.cardData(opp.heroCardId).name} loses 1 life (${opp.life} life)`);
    },
  },

  "swift shot|1": {
    // "When this is put face-up into your arsenal, it gets go again this
    //  turn." (Go again is conditional — KEYWORD_OVERRIDES strips it.)
    onEnterArsenal(ctx) {
      ctx.grantCardKeyword(ctx.self.instanceId, "go again");
      ctx.logPublic(`${ctx.data.name} gets go again this turn`);
    },
  },

  "spire sniping|2": {
    // "When Spire Sniping is put or turned face up in arsenal, look at the
    //  top 2 cards of your deck, then put them back in any order." (See
    //  Turning it face up routes through the same generic arsenal hook.
    onEnterArsenal(ctx) {
      const p = ctx.player(ctx.seat);
      const top2 = p.deck.slice(0, 2);
      for (const c of top2) ctx.lookAt(c.instanceId);
      if (top2.length < 2) return;
      ctx.requestChoice(
        "spire-sniping",
        "Spire Sniping: put the top 2 cards back in any order",
        ["keep order", "swap"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "spire-sniping" || option !== "swap") return;
      const p = ctx.player(ctx.seat);
      if (p.deck.length < 2) return;
      ctx.putOnDeckTop(p.deck[1]!.instanceId);
      ctx.logPublic("Spire Sniping: the top two cards swap places");
    },
  },

  "widowmaker|2": {
    // "Defense reactions can't be played to Widowmaker's chain link."
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "noDefenseReactions", true);
    },
    // "If Widowmaker is defended by fewer than 2 cards, it has +3{p}."
    modifyAttack(ctx) {
      const link = ctx.link;
      if (!link) return 0;
      return link.defendingCards.length + link.defendingEquipment.length < 2 ? 3 : 0;
    },
  },

  // ── Non-attack actions ────────────────────────────────────────────────────

  "call in the big guns|1": {
    // "Your next arrow attack this turn gets +3{p}. You may put an arrow from
    //  your hand face-up into your arsenal." Go again is printed (native).
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow" });
      requestArrowToArsenal(
        ctx,
        "call-in-the-big-guns",
        "Call in the Big Guns: put an arrow from your hand into your arsenal?",
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "call-in-the-big-guns" || option === "pass") return;
      ctx.putIntoArsenal(Number(option), "hand");
    },
  },

  "drop the anchor|1": nextArrowPlusRider((ctx) => {
    // "When this hits a hero, {t} them and all allies they control."
    const opp = ctx.player(opponentSeat(ctx));
    ctx.tap(opp.hero.instanceId);
    for (const c of opp.board) {
      const d = ctx.cardData(c.cardId);
      if (ctx.cardTypes(c).includes("ally") && d.life !== undefined) ctx.tap(c.instanceId);
    }
  }),

  "lace with bloodrot|1": nextArrowPlusRider((ctx) => {
    ctx.createToken(BLOODROT_POX, opponentSeat(ctx));
  }),

  "lace with frailty|1": nextArrowPlusRider((ctx) => {
    ctx.createToken(FRAILTY, opponentSeat(ctx));
  }),

  "lace with inertia|1": nextArrowPlusRider((ctx) => {
    ctx.createToken(INERTIA, opponentSeat(ctx));
  }),

  "read the glide path|1": {
    // "Your next arrow attack this turn gains +3{p}. Opt 1." Go again printed.
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow" });
      optN(ctx, 1);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  },

  "release the tension|1": {
    // "Your next arrow attack this turn gains +3{p} and 'Defense reactions
    //  can't be played from arsenal this chain link.'" Go again printed.
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3,
        appliesToSubtype: "arrow",
        noDefenseReactionsFromArsenal: true, });
    },
  },

  "scout the periphery|1": {
    // "Look at the top card of target hero's deck. The next attack action
    //  card you play from arsenal this turn gains +3{p}." Go again printed.
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3,
        appliesTo: "attack-action",
        appliesToFromArsenal: true, });
      ctx.requestCardChoice(
        "scout-the-periphery",
        "Scout the Periphery: look at the top card of target hero's deck",
        ctx.state.players.map((p) => p.hero.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "scout-the-periphery") return;
      const target = ctx.state.players.find((p) => p.hero.instanceId === Number(option));
      const top = target?.deck[0];
      if (!target || !top) return;
      ctx.lookAt(top.instanceId);
      ctx.logPublic(
        `${ctx.data.name}: look at the top card of ${ctx.cardData(target.heroCardId).name}'s deck`,
      );
    },
  },

  "take aim|1": {
    // "The next Ranger attack action card you play this turn gains +3{p}.
    //  Reload." Go again is printed (native).
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3,
        appliesTo: "attack-action",
        appliesToClass: "ranger", });
      reload(ctx);
    },
    onChoose(ctx, hook, option) {
      reloadOnChoose(ctx, hook, option);
    },
  },

  "memorial ground|2": {
    // "Put target attack action card with cost 1 or less from your graveyard
    //  on top of your deck."
    canPlay: (ctx) =>
      ctx.player(ctx.seat).graveyard.some((c) => {
        const d = ctx.cardData(c.cardId);
        return (
          ctx.hasCardType(c, "action") && ctx.cardTypes(c).includes("attack") && (d.cost ?? 0) <= 1
        );
      }),
    onPlay(ctx) {
      const targets = ctx.player(ctx.seat).graveyard.filter((c) => {
        const d = ctx.cardData(c.cardId);
        return (
          ctx.hasCardType(c, "action") && ctx.cardTypes(c).includes("attack") && (d.cost ?? 0) <= 1
        );
      });
      ctx.requestCardChoice(
        "memorial-ground",
        "Memorial Ground: put an attack action with cost 1 or less from your graveyard on top of your deck",
        targets.map((c) => c.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "memorial-ground") return;
      ctx.putOnDeckTop(Number(option));
    },
  },

  // ── Tokens (created under the opponent's control) ─────────────────────────

  "bloodrot pox|0": {
    // "At the beginning of your end phase, destroy Bloodrot Pox, then it
    //  deals 2 damage to you unless you pay {r}{r}{r}." The choice is made
    //  before the destroy so the
    //  decision can route back to the script (tokens cease to exist).
    triggers: [
      {
        event: "end-of-turn",
        label: "Destroy Bloodrot Pox — 2 damage unless you pay {r}{r}{r}",
        effect(ctx) {
          if (!ctx.requestPayment(
            "bloodrot-pox",
            "Bloodrot Pox: pay {r}{r}{r} or take 2 damage?",
            3,
          )) {
            ctx.destroySelf();
            ctx.dealDamage(ctx.seat, 2);
          }
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "bloodrot-pox") return;
      ctx.destroySelf();
      if (option === "paid") {
        ctx.logPublic("Bloodrot Pox: {r}{r}{r} paid");
      } else {
        ctx.dealDamage(ctx.seat, 2);
      }
    },
  },

  "frailty|0": {
    // "Your attack action cards played from arsenal and weapon attacks have
    //  -1{p}." The static marker dispatches this script's modifyAttack
    //  against its controller's attacks; it expires when Frailty leaves play.
    onEnterArena(ctx) {
      ctx.addModifier({ scope: "static" });
    },
    modifyAttack(ctx) {
      const link = ctx.link;
      if (!link) return 0;
      return link.attackCardType === "weapon" || link.flags.fromArsenal === true ? -1 : 0;
    },
    // "At the beginning of your end phase destroy Frailty."
    triggers: [
      {
        event: "end-of-turn",
        label: "Destroy Frailty",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },

  "inertia|0": {
    // "At the beginning of your end phase, destroy Inertia, then put all
    //  cards from your hand and arsenal on the bottom of your deck."
    triggers: [
      {
        event: "end-of-turn",
        label: "Destroy Inertia — hand and arsenal go on the bottom of the deck",
        effect(ctx) {
          ctx.destroySelf();
          const moved = [...ctx.player(ctx.seat).hand, ...ctx.player(ctx.seat).arsenal];
          ctx.putOnDeckBottomInChosenOrder(
            moved.map((card) => card.instanceId),
            "Inertia: choose the next card to put on the bottom of your deck",
          );
        },
      },
    ],
  },
};
