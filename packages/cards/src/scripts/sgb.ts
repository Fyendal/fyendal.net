import type { CardInstance, CardScript, DeepReadonly, Modifier, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  commonOptionMessages,
  decisionMessage,
  decisionPrompt,
  nextAttack,
  opponentSeat,
} from "./shared-helpers.js";

// ── SGB (Silver Age: Gravy Bones precon) ────────────────────────────────────
//
// Pirate Necromancer cards. New mechanics used here:
// - Allies: played action cards enter the arena (engine: settlePlayedCard) and
//   attack via an activated ability that taps them ({t} is a real activation
//   cost — the ally untaps in its controller's end phase). Allies have a life
//   total and can be attack-targets (engine: targetAllyId on attack intents —
//   CR 8.2.8: undefendable, damage hits the ally not the hero, life resets in
//   the end phase, the ally dies at 0).
// - Gravy Bones' blue-to-graveyard permission / High Tide (script-level;
//   driven off pitch zone contents and the engine's per-turn graveyard hook).
// - Gold tokens (item with an activated ability).
//
const GOLD = "SGB035";


/** ctx.state is typed without the internal side tables; the runtime object has them. */



function isAlly(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("ally");
}

function isPirate(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("pirate");
}

function hasWateryGrave(ctx: ScriptCtx, cardId: string): boolean {
  return (ctx.cardData(cardId).keywords ?? []).some((k) => k.toLowerCase() === "watery grave");
}

/** High Tide: 2 or more blue cards in your pitch zone. */
function highTide(ctx: ScriptCtx): boolean {
  return (
    ctx.player(ctx.seat).pitch.filter((c) => ctx.cardColor(c) === 3).length >= 2
  );
}

/** "Destroy the top card of your deck": it goes to the graveyard (face up). */
function destroyDeckTop(ctx: ScriptCtx): { readonly instanceId: number; readonly cardId: string } | undefined {
  const p = ctx.player(ctx.seat);
  const top = p.deck[0];
  if (!top) return undefined;
  ctx.logPublic(`${ctx.data.name} destroys the top card of the deck (${ctx.cardData(top.cardId).name})`);
  ctx.moveToGraveyard(top.instanceId, "deck");
  return top;
}

/** Ally attack ability: "Action - [<r>…,] {t}: Attack[. Go again]". */
function allyAttack(cost: number, goAgain = false): CardScript {
  return { activated: attackAbility(cost, { goAgain, tap: true, oncePerTurn: false }) };
}

type NextAllyMod = Omit<Modifier, "id" | "sourceInstanceId" | "scope" | "defense" | "seat">;

/** "Your next Pirate ally attack this turn gets <mod> and 'When this hits a
 *  hero, <onHitEffect>'" — the buff rides a next-attack modifier; the granted
 *  on-hit effect is dispatched via an until-end-of-turn marker (lingering
 *  onAttackDeclared/onHit), counted so two copies stack. */
function nextAllyAttack(
  key: string,
  mod: NextAllyMod,
  onHitEffect: (ctx: ScriptCtx) => void,
): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        appliesToSubtype: "ally",
        appliesToClass: "pirate",
        ...mod,
      });
      ctx.addModifier({ scope: "until-end-of-turn" }); // marker: lingering dispatch source
      ctx.setFlag("player", key, (Number(ctx.getFlag("player", key)) || 0) + 1);
    },
    onFriendlyAttackDeclared(ctx) {
      const link = ctx.link;
      if (!link || link.attacker !== ctx.seat) return;
      const n = Number(ctx.getFlag("player", key)) || 0;
      if (n <= 0) return;
      if (
        !isAlly(ctx, link.attackingCard) ||
        !isPirate(ctx, link.attackingCard)
      ) return;
      ctx.setFlag("player", key, n - 1);
      ctx.setFlag("link", key, (Number(ctx.getFlag("link", key)) || 0) + 1);
      // the effect is spent: retire the lingering marker so its effect chip
      // disappears from the mat (the on-hit dispatch below reads the link
      // flag, not the marker, so it still fires)
      const marker = ctx.state.modifiers.find(
        (m) =>
          m.scope === "until-end-of-turn" &&
          m.sourceInstanceId === ctx.self.instanceId &&
          !m.consumed,
      );
      if (marker) ctx.consumeModifier(marker.id);
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return !!link &&
        link.attacker === ctx.seat &&
        link.targetAllyId === undefined &&
        (Number(ctx.getFlag("link", key)) || 0) > 0;
    },
    onHit(ctx) {
      const n = Number(ctx.getFlag("link", key)) || 0;
      // two copies put two markers down, and the lingering dispatch calls this
      // once per marker — the first dispatch fires for all of them
      ctx.setFlag("link", key, 0);
      for (let i = 0; i < n; i++) onHitEffect(ctx);
    },
  };
}

function createGold(ctx: ScriptCtx): void {
  ctx.createToken(GOLD);
}

/** "When this attacks, you may discard a card or destroy the top card of your
 *  deck. If that card has watery grave, …" — shared choice plumbing. */
function discardOrMillChoice(hook: string, name: string) {
  return {
    offer(ctx: ScriptCtx) {
      const p = ctx.player(ctx.seat);
      const options: (number | string)[] = [
        ...p.hand.map((c) => c.instanceId),
        ...(p.deck.length > 0 ? ["deck-top"] : []),
        "pass",
      ];
      if (options.length === 1) return;
      ctx.requestCardChoice(
        hook,
        decisionPrompt(
          `${name}: discard a card or destroy the top card of your deck?`,
          "card.sgb.discardormill.choose",
          {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
            optionMessages: {
              "deck-top": decisionMessage("card.sgb.option.decktop"),
              ...commonOptionMessages("pass"),
            },
          },
        ),
        options,
      );
    },
    resolve(ctx: ScriptCtx, option: string): { readonly instanceId: number; readonly cardId: string } | undefined {
      if (option === "deck-top") return destroyDeckTop(ctx);
      return ctx.discardCard(ctx.seat, Number(option));
    },
  };
}

export const sgb: Record<string, CardScript> = {
  // Gravy Bones — {t}, destroy a Gold: draw then discard; Watery Grave access
  "gravy bones|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true, // {t}
      canActivate: (ctx) => {
        const player = ctx.player(ctx.seat);
        return [...player.board, ...player.weapons,
          ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined)]
          .some((card) => ctx.cardNames(card).includes("gold"));
      },
      onActivate(ctx) {
        const player = ctx.player(ctx.seat);
        const golds = [...player.board, ...player.weapons,
          ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined)]
          .filter((card) => ctx.cardNames(card).includes("gold"));
        if (golds.length > 0) {
          ctx.requestCardChoice(
            "gravy-gold",
            decisionPrompt(
              "Gravy Bones: choose a Gold to destroy",
              "card.sgb.gravy.gold.choose",
            ),
            golds.map((c) => c.instanceId),
          );
        }
      },
    },
    onCardToGraveyard(ctx, card) {
      if (ctx.cardColor(card) === 3) {
        ctx.setFlag("player", "blueToGraveyard", true);
      }
      if (ctx.getFlag("player", "blueToGraveyard") !== true) return;
      // "If a blue card has been put into your graveyard this turn, you may
      // play cards with watery grave from your graveyard."
      for (const c of ctx.player(ctx.seat).graveyard) {
        if (hasWateryGrave(ctx, c.cardId)) ctx.allowPlayFrom(c.instanceId, "graveyard");
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "gravy-gold") {
        const player = ctx.player(ctx.seat);
        const gold = [...player.board, ...player.weapons,
          ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined)]
          .find((card) => card.instanceId === Number(option));
        if (gold) {
          ctx.destroyPermanent(gold.instanceId);
          ctx.logPublic(`${ctx.data.name} destroys a Gold`);
        }
        ctx.drawCards(ctx.seat, 1);
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length > 0) {
          ctx.requestCardChoice(
            "gravy-discard",
            decisionPrompt(
              "Gravy Bones: discard a card",
              "card.sgb.gravy.discard.choose",
            ),
            hand.map((c) => c.instanceId),
          );
        }
        return;
      }
      if (hook !== "gravy-discard") return;
      ctx.discardCard(ctx.seat, Number(option));
    },
  },

  // Compass of Sunken Depths — {t}: look at the top card of your deck
  "compass of sunken depths|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true, // {t}
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) {
          ctx.logPublic(`${ctx.data.name}: the deck is empty`);
          return;
        }
        // the identity is private: logged only to the controller (lookAt)
        ctx.lookAt(top.instanceId);
        ctx.logPublic(`${ctx.data.name}: its controller looks at the top card of their deck`);
      },
    },
    // "The first card with watery grave you play from your graveyard each
    // turn gets go again" — fired from finishPlayCard at declaration, so the
    // refunded action point nets out the play's AP cost.
    onFriendlyPlay(ctx, card, from) {
      if (from !== "graveyard" || !hasWateryGrave(ctx, card.cardId)) return;
      if (ctx.getFlag("player", "compassGoAgain")) return;
      ctx.setFlag("player", "compassGoAgain", true);
      ctx.gainActionPoint();
      ctx.logPublic(`${ctx.data.name}: ${ctx.cardData(card.cardId).name} gets go again`);
    },
  },

  // Carrion Crown — discard an ally, destroy this: draw a card. Go again
  "carrion crown|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.some((c) => isAlly(ctx, c)),
      onActivate(ctx) {
        const allies = ctx.player(ctx.seat).hand.filter((c) => isAlly(ctx, c));
        ctx.requestCardChoice(
          "carrion-discard",
          decisionPrompt(
            "Carrion Crown: discard an ally",
            "card.sgb.carrion.ally.discard",
          ),
          allies.map((c) => c.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "carrion-discard") return;
      if (!ctx.discardCard(ctx.seat, Number(option))) return;
      ctx.destroySelf();
      ctx.drawCards(ctx.seat, 1);
    },
  },

  // Mournful Casket — +1{d} if an ally went to your graveyard this turn; Temper
  "mournful casket|0": {
    modifyDefense(ctx) {
      return ctx.getFlag("player", "graveSubtype:ally") === true ? 1 : 0;
    },
  },

  // Washed Up Wave — when this defends: discard or mill; watery grave → +2{d}
  "washed up wave|0": (() => {
    const choice = discardOrMillChoice("wuw-discard-or-mill", "Washed Up Wave");
    return {
      onDefend: choice.offer,
      onChoose(ctx, hook, option) {
        if (hook !== "wuw-discard-or-mill" || option === "pass") return;
        const card = choice.resolve(ctx, option);
        if (card && hasWateryGrave(ctx, card.cardId)) {
          ctx.addModifier({ scope: "chain-link", defense: 2 });
          ctx.logPublic(`${ctx.data.name} gets +2{d} (${ctx.cardData(card.cardId).name} has watery grave)`);
        }
      },
    };
  })(),

  // Mage Master Boots — {r}, destroy: next non-attack action gets go again
  "mage master boots|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.setFlag("player", "nextNonAttackActionCardGoAgain", true);
        ctx.logPublic(`${ctx.data.name}: the next non-attack action card played this turn gets go again`);
      },
    },
  },

  // Scuttle Toes — {r}{r}, destroy: untap an ally (re-enables its attack)
  "scuttle toes|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      canActivate: (ctx) => ctx.player(ctx.seat).board.some((c) => isAlly(ctx, c)),
      onActivate(ctx) {
        ctx.destroySelf();
        // only tapped allies are eligible — untapping an untapped ally fails
        const allies = ctx.player(ctx.seat).board.filter((c) => c.tapped && isAlly(ctx, c));
        if (allies.length > 0) {
          ctx.requestCardChoice(
            "scuttle-untap",
            decisionPrompt(
              "Scuttle Toes: untap target ally",
              "card.sgb.scuttle.ally.choose",
            ),
            allies.map((c) => c.instanceId),
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "scuttle-untap") return;
      ctx.untap(Number(option));
      ctx.destroyAtEndPhase(Number(option));
    },
  },

  // Battalion Barque — High Tide: +2{p}
  "battalion barque|1": {
    modifyAttack: (ctx) => (highTide(ctx) ? 2 : 0),
  },

  // Swiftwater Sloop — High Tide: go again (checked at declaration)
  "swiftwater sloop|1": {
    onAttackDeclared(ctx) {
      if (highTide(ctx)) {
        ctx.grantGoAgain();
        ctx.logPublic(`${ctx.data.name} gains go again (High Tide)`);
      }
    },
  },
  "swiftwater sloop|3": {
    onAttackDeclared(ctx) {
      if (highTide(ctx)) {
        ctx.grantGoAgain();
        ctx.logPublic(`${ctx.data.name} gains go again (High Tide)`);
      }
    },
  },

  // Golden Tipple — when this attacks: may discard a yellow → draw + Gold
  ...(Object.fromEntries(
    [1, 2, 3].map((pitch) => [
      `golden tipple|${pitch}`,
      {
        onAttackDeclared(ctx) {
          const yellow = ctx.player(ctx.seat).hand.filter(
            (c) => ctx.cardColor(c) === 2,
          );
          if (yellow.length === 0) return;
          ctx.requestCardChoice(
            "tipple-discard",
            decisionPrompt(
              "Golden Tipple: discard a yellow card to draw a card and create a Gold?",
              "card.sgb.tipple.discard",
              { optionMessages: commonOptionMessages("pass") },
            ),
            ["pass", ...yellow.map((c) => c.instanceId)],
          );
        },
        onChoose(ctx, hook, option) {
          if (hook !== "tipple-discard" || option === "pass") return;
          if (!ctx.discardCard(ctx.seat, Number(option))) return;
          ctx.drawCards(ctx.seat, 1);
          createGold(ctx);
        },
      } satisfies CardScript,
    ]),
  ) as Record<string, CardScript>),

  // Saltwater Swell — when this attacks: reveal the top card; pitch it if blue
  ...(Object.fromEntries(
    [1, 3].map((pitch) => [
      `saltwater swell|${pitch}`,
      {
        onAttackDeclared(ctx) {
          const p = ctx.player(ctx.seat);
          const top = p.deck[0];
          if (!top) return;
          ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`);
          const value = ctx.cardData(top.cardId).pitch ?? 0;
          if (ctx.cardColor(top) === 3) {
            ctx.pitchCard(top.instanceId);
            ctx.logPublic(`${ctx.data.name} pitches ${ctx.cardData(top.cardId).name} (+${value} resources)`);
          }
        },
      } satisfies CardScript,
    ]),
  ) as Record<string, CardScript>),

  // ── allies (attack via a {t} tap ability) ──

  "barnacle|2": allyAttack(0),
  "cutty shark, quick clip|2": {
    activated: [...attackAbility(1, { tap: true }), {
        // Once per Turn Action - {r}: Your next ally attack this turn gets +1{p}. Go again
        cost: 1,
        isAttack: false,
        goAgain: true,
        oncePerTurn: true,
        label: "Next ally +1{p}",
        onActivate(ctx) {
          buffNextAttack(ctx, { attack: 1, appliesToSubtype: "ally" });
          ctx.logPublic(`${ctx.data.name}: your next ally attack this turn gets +1{p}`);
        },
      },
    ],
  },
  "limpit, hop-a-long|2": allyAttack(1, true),
  "oysten, heart of gold|2": {
    ...allyAttack(0),
    onDestroyed(ctx) {
      createGold(ctx);
      ctx.logPublic(`${ctx.data.name}: created a Gold token when it died`);
    },
  },
  "riggermortis|2": allyAttack(1),
  "swabbie|2": allyAttack(2),

  // Back Alley Breakline — deck → graveyard by an effect: gain an action point
  "back alley breakline|3": {
    triggers: [{
      event: "card-moved-from-deck-by-effect",
      sourceZone: "any",
      label: "Gain 1 action point",
      condition: (ctx, card) => card?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.gainActionPoint(),
    }],
  },

  // Jittery Bones — discard or mill; watery grave → go again (keyword override
  // in ../index.ts removes the unconditional Go again the dataset lists)
  "jittery bones|3": (() => {
    const choice = discardOrMillChoice("jb-discard-or-mill", "Jittery Bones");
    return {
      onAttackDeclared: choice.offer,
      onChoose(ctx, hook, option) {
        if (hook !== "jb-discard-or-mill" || option === "pass") return;
        const card = choice.resolve(ctx, option);
        if (card && hasWateryGrave(ctx, card.cardId)) {
          ctx.grantGoAgain();
          ctx.logPublic(`${ctx.data.name} gains go again (${ctx.cardData(card.cardId).name} has watery grave)`);
        }
      },
    };
  })(),

  // Murderous Rabble — reveal the top card; +X{p} where X is its pitch value
  "murderous rabble|3": {
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      const x = top ? (ctx.cardData(top.cardId).pitch ?? 0) : 0;
      if (top) ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name} (+${x}{p})`);
      ctx.setFlag("link", "rabbleX", x);
    },
    modifyAttack(ctx) {
      return Number(ctx.getFlag("link", "rabbleX")) || 0;
    },
  },

  // Avast Ye! — next ally attack: go again and "on hit: create a Gold"
  "avast ye!|3": nextAllyAttack("avastYe", { goAgain: true }, (ctx) => {
    createGold(ctx);
    ctx.logPublic(`${ctx.data.name}: created a Gold token on hit`);
  }),

  // Yo Ho Ho! — next ally attack: +1{p} and "on hit: create a Gold"
  "yo ho ho!|3": nextAllyAttack("yoHoHo", { attack: 1 }, (ctx) => {
    createGold(ctx);
    ctx.logPublic(`${ctx.data.name}: created a Gold token on hit`);
  }),

  // Loot the Arsenal — next ally attack: "on hit: destroy a card in their
  // arsenal; if you do, create a Gold"
  "loot the arsenal|3": nextAllyAttack("lootArsenal", {}, (ctx) => {
    const opp = ctx.player(opponentSeat(ctx));
    const card = opp.arsenal[0];
    if (!card) return;
    ctx.logPublic(`${ctx.data.name} destroys ${ctx.cardData(card.cardId).name} in the opposing arsenal`);
    ctx.moveToGraveyard(card.instanceId, "arsenal");
    createGold(ctx);
  }),

  // Loot the Hold — next ally attack: "on hit: they discard a card; if they
  // do, create a Gold"
  "loot the hold|3": {
    ...nextAllyAttack("lootHold", {}, (ctx) => {
      const opp = ctx.player(opponentSeat(ctx));
      if (opp.hand.length === 0) return;
      ctx.requestCardChoice(
        "loot-hold-discard",
        decisionPrompt(
          "Loot the Hold: discard a card",
          "card.sgb.loot.discard.choose",
        ),
        opp.hand.map((c) => c.instanceId),
        opponentSeat(ctx),
      );
    }),
    onChoose(ctx, hook, option) {
      if (hook !== "loot-hold-discard") return;
      const discarded = ctx.discardCard(opponentSeat(ctx), Number(option));
      if (discarded) createGold(ctx);
    },
  },

  // Flying High — your next attack gets go again; +1{p} if it's blue
  "flying high|3": {
    onPlay(ctx) {
      nextAttack({ goAgain: true })(ctx);
      ctx.addModifier({ scope: "until-end-of-turn" }); // marker: lingering dispatch source
      ctx.setFlag("player", "flyingHigh", true);
    },
    onFriendlyAttackDeclared(ctx) {
      const link = ctx.link;
      if (!link || link.attacker !== ctx.seat) return;
      if (ctx.getFlag("player", "flyingHigh") !== true) return;
      ctx.setFlag("player", "flyingHigh", false);
      if (ctx.cardColor(link.attackingCard) === 3) {
        ctx.addModifier({ scope: "chain-link", attack: 1 });
        ctx.logPublic(`${ctx.data.name}: the blue attack gets +1{p}`);
      }
    },
  },

  // Portside Exchange — discard a card, draw a card; yellow → create a Gold
  "portside exchange|3": {
    onPlay(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length === 0) {
        ctx.drawCards(ctx.seat, 1);
        return;
      }
      ctx.requestCardChoice(
        "portside-discard",
        decisionPrompt(
          "Portside Exchange: discard a card",
          "card.sgb.portside.discard.choose",
        ),
        hand.map((c) => c.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "portside-discard") return;
      const discarded = ctx.discardCard(ctx.seat, Number(option));
      ctx.drawCards(ctx.seat, 1);
      if (discarded && ctx.cardColor(discarded) === 2) createGold(ctx);
    },
  },

  // Throw Caution to the Wind — reveal top; prevent next damage = its pitch
  "throw caution to the wind|3": {
    onPlay(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      const x = top ? (ctx.cardData(top.cardId).pitch ?? 0) : 0;
      if (top) ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name} (prevent ${x})`);
      if (x > 0) {
        const cur = Number(ctx.getFlag("player", "preventNextDamage")) || 0;
        ctx.setFlag("player", "preventNextDamage", cur + x);
      }
    },
  },

  // Gold token — {r}{r}, destroy this: draw a card. Go again
  "gold|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.setFlag("player", "goldDrawEffect", true);
        ctx.drawCards(ctx.seat, 1);
        ctx.setFlag("player", "goldDrawEffect", false);
      },
    },
  },
};
