import type { CardScript, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  decisionMessage,
  decisionPrompt,
  isWeaponAttack,
  opponentSeat,
  reprise,
} from "./shared-helpers.js";

// ── SDO (Silver Age: Dorinthea precon, Chapter 2) ───────────────────────────
//
// Warrior cards — almost everything rides existing engine mechanics:
// - Dawnblade's hit-count +1{p} counters ride the generic weapon power
//   counters (computeAttack) and an end-of-turn trigger; the hit count itself
//   is a per-turn flag (auto-wiped).
// - Wreck Havoc's "defense reactions can't be played to this chain link" is
//   the noDefenseReactions link flag (SAZ). Its arsenal reveal destroys the
//   revealed card if it is a defense reaction (arsenal cards are public in
//   this engine except face-down mentors — "turn face up" clears faceDown).
// - Granted piercing (Puncture) rides the generic static Piercing modifier.
// - Reprise (Out for Blood) is the defendedFromHand link flag — already set
//   by the time the reaction resolves in the reaction step.
// - Trot Along's "next attack with 3 or less base {p}" rides the new generic
//   Modifier.maxBasePower filter (printed base power).
// - Agility/Vigor are aura tokens on the board; Vigor's start-of-turn trigger
//   rides the trigger stack machinery.

const AGILITY = "SDO035";
const VIGOR = "SDO036";



/** ctx.state is typed without the internal side tables; the runtime object has them. */

/** Attack-reaction legality: my unresolved attack is on the chain and matches
 *  `target` — then pump it by `pump`. */
function targetMyAttack(
  target: (ctx: ScriptCtx) => boolean,
  pump: number,
  onPlayExtra?: (ctx: ScriptCtx) => void,
  extra: CardScript = {},
): CardScript {
  return {
    ...extra,
    canPlay(ctx) {
      const link = ctx.link;
      if (!link || link.resolved || link.attacker !== ctx.seat) return false;
      return target(ctx);
    },
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: pump });
      ctx.logPublic(`${ctx.data.name}: the attack gets +${pump}{p}`);
      onPlayExtra?.(ctx);
    },
  };
}

function attackTypes(ctx: ScriptCtx): readonly string[] {
  if (!ctx.link) return [];
  return ctx.cardTypes(ctx.link.attackingCard);
}

export const sdo: Record<string, CardScript> = {
  // ── Weapon ────────────────────────────────────────────────────────────────

  "dawnblade|0": {
    // Once per Turn Action — {r}: Attack. "The second time this hits each
    //  turn, put a +1{p} counter on it. At the beginning of your end phase,
    //  if this hasn't hit this turn, remove all +1{p} counters from it."
    activated: attackAbility(1),
    onFriendlyCombatDamageDealt(ctx, source, target, amount) {
      if (amount <= 0 || target === ctx.seat || source.instanceId !== ctx.self.instanceId) return;
      const key = `hits:${ctx.self.instanceId}`;
      ctx.setFlag("player", key, (Number(ctx.getFlag("player", key)) || 0) + 1);
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
        Number(ctx.getFlag("player", `hits:${ctx.self.instanceId}`)) === 2;
    },
    onHit(ctx) {
      ctx.addCounter(ctx.self.instanceId, "power", 1);
      ctx.logPublic(`${ctx.data.name} gets a +1{p} counter`);
    },
    triggers: [
      {
        event: "end-of-turn",
        condition: (ctx) =>
          !ctx.getFlag("player", `hits:${ctx.self.instanceId}`) &&
          (ctx.self.counters?.power ?? 0) > 0,
        label: "Dawnblade hasn't hit this turn — remove all +1{p} counters",
        effect(ctx) {
          const n = ctx.self.counters?.power ?? 0;
          if (n > 0) {
            ctx.addCounter(ctx.self.instanceId, "power", -n);
            ctx.logPublic(`${ctx.data.name}'s +1{p} counters are removed`);
          }
        },
      },
    ],
  },

  // ── Attacks ───────────────────────────────────────────────────────────────

  "wreck havoc|1": {
    // "Defense reactions can't be played to this chain link."
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "noDefenseReactions", true);
    },
    // "When this hits a hero, you may turn a card in their arsenal face up,
    //  then destroy a defense reaction in their arsenal."
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      if (opp.arsenal.length === 0) return;
      // The current rules model permits one arsenal card. Asking for a card
      // choice exposed its face to the attacker before they chose whether to
      // turn it up; this is only the actual optional yes/no decision.
      ctx.requestChoice(
        "wreck-havoc",
        decisionPrompt(
          "Wreck Havoc: turn a card in their arsenal face up? (a defense reaction is destroyed)",
          "card.sdo.wreck.arsenal.turn",
          {
            optionMessages: {
              pass: decisionMessage("common.option.pass"),
              turn: decisionMessage("card.sdo.option.turn"),
            },
          },
        ),
        ["pass", "turn"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "wreck-havoc" || option === "pass") return;
      const opp = ctx.player(opponentSeat(ctx));
      const card = opp.arsenal[0];
      if (!card) return;
      ctx.setCardFaceDown(card.instanceId, false);
      ctx.logPublic(`Wreck Havoc: ${ctx.cardData(card.cardId).name} in their arsenal is turned face up`);
      if (ctx.cardData(card.cardId).cardType !== "defense-reaction") return;
      ctx.moveToGraveyard(card.instanceId, "arsenal");
      ctx.logPublic(`Wreck Havoc: ${ctx.cardData(card.cardId).name} is destroyed`);
    },
  },

  // ── Attack reactions ──────────────────────────────────────────────────────

  "agile engagement|1": targetMyAttack(
    (ctx) => attackTypes(ctx).includes("warrior"),
    3,
    (ctx) => {
      // "If it's defended by an attack action card, create an Agility token."
      //  Defenders were committed in the defend step, before this resolves.
      const defended = ctx.link?.defendingCards.some((c) => {
        return ctx.hasCardType(c, "action") && ctx.cardTypes(c).includes("attack");
      });
      if (defended) ctx.createToken(AGILITY);
    },
  ),

  "out for blood|1": targetMyAttack(
    (ctx) => isWeaponAttack(ctx),
    3,
    (ctx) => {
      // Reprise — the defending hero defended from hand this chain link
      //  (already known when the reaction resolves).
      if (!reprise(ctx)) return;
      buffNextAttack(ctx, { attack: 1 });
      ctx.logPublic(`${ctx.data.name}: reprise — your next attack this turn gets +1{p}`);
    },
  ),

  "puncture|1": targetMyAttack(
    (ctx) => attackTypes(ctx).some((s) => s === "sword" || s === "dagger"),
    3,
    (ctx) => {
      ctx.addModifier({ scope: "chain-link", piercing: 1 });
      ctx.logPublic(`${ctx.data.name}: the attack gains piercing 1`);
    },
  ),

  "puncture|3": targetMyAttack(
    (ctx) => attackTypes(ctx).some((s) => s === "sword" || s === "dagger"),
    1,
    (ctx) => {
      ctx.addModifier({ scope: "chain-link", piercing: 1 });
      ctx.logPublic(`${ctx.data.name}: the attack gains piercing 1`);
    },
  ),

  // ── Non-attack actions ────────────────────────────────────────────────────

  "lead with speed|1": {
    // "Your next Brute or Warrior attack this turn gets +3{p}. Create an
    //  Agility token." Go again is printed (native).
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToType: ["brute", "warrior"] });
      ctx.createToken(AGILITY);
    },
  },

  "goblet of bloodrun wine|3": {
    // "Create an Agility and a Vigor token." Go again is printed (native).
    onPlay(ctx) {
      ctx.createToken(AGILITY);
      ctx.createToken(VIGOR);
    },
  },

  "trot along|3": {
    // "Your next attack with 3 or less base {p} this turn gets go again."
    //  Go again (on Trot Along itself) is printed (native).
    onPlay(ctx) {
      buffNextAttack(ctx, { goAgain: true, maxBasePower: 3 });
      ctx.logPublic(`${ctx.data.name}: your next attack with 3 or less base {p} this turn gets go again`);
    },
  },

  // ── Tokens ────────────────────────────────────────────────────────────────

  "vigor|0": {
    // "At the start of your turn, destroy this, then gain {r}."
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Vigor — gain {r}",
        effect(ctx) {
          ctx.destroySelf();
          ctx.changeResources(ctx.seat, 1);
          ctx.logPublic("Vigor is destroyed: gain {r}");
        },
      },
    ],
  },
};
