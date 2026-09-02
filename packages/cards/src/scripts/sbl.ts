import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, commonOptionMessages, decisionPrompt } from "./shared-helpers.js";

// ── SBL (Silver Age: Boltyn precon) ─────────────────────────────────────────
//
// Light Warrior cards. New mechanics used here:
// - The hero's soul zone + Charge (engine: PlayerState.soul, ctx.charge /
//   ctx.putIntoSoul, per-turn flags `chargedThisTurn` / `chargedPitch:<n>` /
//   `soulPitch:<n>`, and the onCharged script hook for Solflare). Charging as
//   an optional additional cost is a scripted yes/no choice that pauses the
//   play (the Fusion pause/resume machinery); the charged card's pitch is
//   stamped on the played card as a `chargedPitch` counter so "if a yellow
//   card was charged this way" can be evaluated at resolution.
// - Unity (equipment on-defend triggers), Spellvoid
//   (engine: a destroy-to-prevent decision ahead of Arcane Barrier), Sharpen /
//   Glisten (+1{p} counters on weapons — engine: the `power` counter feeds
//   computeAttack; Glisten's end-phase wipe is the `clearWeaponPowerCounters`
//   flag), and the Agility/Courage/Flurry tokens (triggered auras; Flurry
//   re-enables the weapon's once-per-turn attack by resetting its
//   `activated:<id>` flag — the documented re-enable pattern).
// - "Put it into your hero's soul" on-hit redirects (engine: the
//   `attackToSoul` link flag, consumed by closeChain) and Roaring Beam's
//   return-to-hand (engine: ctx.returnSelfToHand).
// - Toe the Line's "if you prevent damage this way, create a Flurry token"
//   (engine: Modifier.onPreventCreateToken on the generic prevention shield).

const AGILITY = "SBL034";
const COURAGE = "SBL035";
const FLURRY = "SBL036";


/** ctx.state is typed without the internal side tables; the runtime object has them. */

function isLight(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("light");
}

function isSword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("sword");
}

function chargedThisTurn(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "chargedThisTurn") === true;
}

/** The pitch of the card charged as this card's additional cost (0 = none). */
function chargedPitchThisWay(ctx: ScriptCtx): number {
  return ctx.getCounter("chargedPitch");
}

// ── Charge as an optional additional cost ───────────────────────────────────

const CHARGE_HOOK = "charge-cost";

function chargeAdditionalCost(ctx: ScriptCtx): void {
  const hand = ctx.player(ctx.seat).hand;
  if (hand.length === 0) return;
  ctx.requestCardChoice(
    CHARGE_HOOK,
    decisionPrompt(`${ctx.data.name}: choose a card from your hand to charge, or decline`, "card.sbl.charge.choose", {
      values: { card: { kind: "card", cardId: ctx.self.cardId } },
      optionMessages: commonOptionMessages("no"),
    }),
    ["no", ...hand.map((card) => card.instanceId)],
  );
}

/** Shared onChoose for the charge-cost hook; returns true when handled. */
function chargeOnChoose(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== CHARGE_HOOK) return false;
  if (option !== "no") {
    const charged = ctx.charge(Number(option));
    if (charged) ctx.setCounter("chargedPitch", ctx.cardColor(charged));
  }
  return true;
}

/** An attack action with "you may charge your hero's soul" as an additional cost. */
function chargeAttack(extra: CardScript): CardScript {
  return {
    additionalCost: chargeAdditionalCost,
    ...extra,
    onChoose(ctx, hook, option) {
      if (chargeOnChoose(ctx, hook, option)) return;
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

/** Unity equipment: "+1{d} while defending together with a card from hand". */
function unityEquipment(): CardScript {
  return {
    canTriggerOnDefend(ctx) {
      if (!ctx.link) return false;
      const count = Number(ctx.link.flags.defendedFromHandCount ?? 0);
      const selfWasFromHand = ctx.link.flags[`defendedFromHand:${ctx.self.instanceId}`] === true ? 1 : 0;
      return count > selfWasFromHand;
    },
    onDefend(ctx) { ctx.addCardTempDefense(ctx.self.instanceId, 1); },
  };
}

export const sbl: Record<string, CardScript> = {
  // ── Hero ──────────────────────────────────────────────────────────────────

  "boltyn|0": {
    // "If you've charged this turn, your attacks get +1{p} while defended by
    // an attack action card."
    modifyAttack(ctx) {
      if (!ctx.link || !chargedThisTurn(ctx)) return 0;
      const defendedByAttackAction = ctx.link.defendingCards.some((c) => {
        return ctx.hasCardType(c, "action") && ctx.cardTypes(c).includes("attack");
      });
      return defendedByAttackAction ? 1 : 0;
    },
    // "Attack Reaction — Banish a card from Boltyn's soul: Target attack with
    // {p} greater than its base {p} gains go again."
    activated: {
      cost: 0,
      banishSoulCost: 1,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      label: "Banish a soul card: pumped attack gains go again",
      canActivate(ctx) {
        const link = ctx.link;
        if (!link || link.resolved) return false;
        if (ctx.player(ctx.seat).soul.length === 0) return false;
        return ctx.attackBonusAboveBase() > 0;
      },
      onActivate(ctx) {
        ctx.grantGoAgain();
        ctx.logPublic("Boltyn: target attack gains go again");
      },
    },
  },

  // ── Weapon ────────────────────────────────────────────────────────────────

  "raydn, duskbane|0": {
    // "If you've charged this turn, Raydn gains +3{p}." — only its own attack
    modifyAttack(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return 0;
      return chargedThisTurn(ctx) ? 3 : 0;
    },
    activated: attackAbility(0),
  },

  // ── Equipment ─────────────────────────────────────────────────────────────

  // Spellvoid 2 is native (engine arcane-damage decisions).
  "halo of illumination|0": {
    activated: {
      cost: 1,
      destroySelfCost: true,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: put a hand card into your soul",
      canActivate: (ctx) => ctx.player(ctx.seat).hand.length > 0,
      onActivate(ctx) {
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length === 0) {
          ctx.logPublic("Halo of Illumination: no card in hand to put into the soul");
          return;
        }
        ctx.requestCardChoice(
          "halo-soul",
          decisionPrompt("Halo of Illumination: put a card from your hand into your hero's soul", "card.sbl.halo.soul"),
          hand.map((c) => c.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "halo-soul") return;
      const id = Number(option);
      const card = ctx.player(ctx.seat).hand.find((c) => c.instanceId === id);
      if (!card) return;
      const light = isLight(ctx, card);
      ctx.putIntoSoul(id);
      if (light) ctx.drawCards(ctx.seat, 1);
    },
  },

  "helm of unity|0": unityEquipment(),
  "gauntlets of unity|0": unityEquipment(),

  "garland of spring|0": {
    activated: {
      cost: 0,
      destroySelfCost: true,
      isAttack: false,
      goAgain: true,
      label: "Destroy: gain {r}",
      onActivate(ctx) {
        ctx.changeResources(ctx.seat, 1);
        ctx.logPublic("Garland of Spring: gain 1 resource");
      },
    },
  },

  "radiant touch|0": {
    activated: {
      cost: 0,
      banishSelfCost: true,
      banishSoulCost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Banish this and a soul card: prevent the next 2 damage",
      canActivate: (ctx) => ctx.player(ctx.seat).soul.length > 0,
      onActivate(ctx) {
        ctx.preventNextDamage(ctx.seat, 2);
      },
    },
  },

  "flat trackers|0": {
    // Blade Break is native
    activated: {
      cost: 0,
      destroySelfCost: true,
      isAttack: false,
      goAgain: true,
      label: "Destroy: create an Agility token",
      onActivate(ctx) {
        ctx.createToken(AGILITY);
      },
    },
  },

  // ── Attack actions ────────────────────────────────────────────────────────

  "beaming bravado|1": chargeAttack({
    modifyAttack: (ctx) => (chargedPitchThisWay(ctx) === 2 ? 1 : 0),
  }),
  "beaming bravado|2": chargeAttack({
    modifyAttack: (ctx) => (chargedPitchThisWay(ctx) === 2 ? 1 : 0),
  }),

  "bolt of courage|1": chargeAttack({
    canTriggerOnHit: chargedThisTurn,
    onHit(ctx) {
      ctx.drawCards(ctx.seat, 1);
    },
  }),
  "bolt of courage|2": chargeAttack({
    canTriggerOnHit: chargedThisTurn,
    onHit(ctx) {
      ctx.drawCards(ctx.seat, 1);
    },
  }),

  "duty bound blitz|1": {
    // "Play this only if a yellow card has been put into your soul this turn."
    canPlay: (ctx) => Number(ctx.getFlag("player", "soulPitch:2")) > 0,
  },
  "duty bound blitz|2": {
    canPlay: (ctx) => Number(ctx.getFlag("player", "soulPitch:2")) > 0,
  },

  "engulfing light|1": chargeAttack({
    canTriggerOnHit: chargedThisTurn,
    onHit(ctx) {
      ctx.setFlag("link", "attackToSoul", true);
    },
  }),
  "engulfing light|2": chargeAttack({
    canTriggerOnHit: chargedThisTurn,
    onHit(ctx) {
      ctx.setFlag("link", "attackToSoul", true);
    },
  }),

  "illuminate|1": {
    onHit(ctx) {
      ctx.setFlag("link", "attackToSoul", true);
    },
  },

  "light the way|1": chargeAttack({
    canTriggerOnHit: (ctx) => chargedPitchThisWay(ctx) === 2,
    onHit(ctx) {
      ctx.grantGoAgain();
    },
  }),
  "light the way|2": chargeAttack({
    canTriggerOnHit: (ctx) => chargedPitchThisWay(ctx) === 2,
    onHit(ctx) {
      ctx.grantGoAgain();
    },
  }),

  "take flight|1": chargeAttack({
    onAttackDeclared(ctx) {
      if (chargedThisTurn(ctx)) ctx.grantGoAgain();
    },
  }),
  "take flight|2": chargeAttack({
    onAttackDeclared(ctx) {
      if (chargedThisTurn(ctx)) ctx.grantGoAgain();
    },
  }),

  "v of the vanguard|2": {
    // "you may charge your hero's soul any number of times" — a repeated
    // yes/no choice; each Light card charged feeds the chain-wide buff
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "v-charge",
          decisionPrompt("V of the Vanguard: choose a card from your hand to charge, or stop", "card.sbl.v.charge.first", { optionMessages: commonOptionMessages("no") }),
          ["no", ...hand.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "v-charge") return;
      if (option !== "no") {
        const charged = ctx.charge(Number(option));
        if (charged) {
          if (isLight(ctx, charged)) {
            ctx.setCounter("vLight", ctx.getCounter("vLight") + 1);
          }
          const hand = ctx.player(ctx.seat).hand;
          if (hand.length > 0) {
            ctx.requestCardChoice(
              "v-charge",
              decisionPrompt("V of the Vanguard: choose another card to charge, or stop", "card.sbl.v.charge.next", { optionMessages: commonOptionMessages("no") }),
              ["no", ...hand.map((card) => card.instanceId)],
            );
            return;
          }
        }
      }
      const n = ctx.getCounter("vLight");
      if (n > 0) {
        ctx.addModifier({ scope: "combat-chain", attack: n });
        ctx.logPublic(`V of the Vanguard: attacks on this combat chain get +${n}{p}`);
      }
    },
  },

  "valiant thrust|2": {
    modifyAttack: (ctx) => (chargedThisTurn(ctx) ? 3 : 0),
  },

  // Solflare: "When this is charged to your hero's soul, the next time you hit
  // this turn, gain 1{h}."
  "banneret of salvation|2": {
    onCharged(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", onHitGainLife: 1 });
      ctx.logPublic("Banneret of Salvation: the next time you hit this turn, gain 1 life");
    },
  },

  // ── Reactions / non-attack actions / instants ─────────────────────────────

  "courageous steelhand|1": {
    onPlay(ctx) {
      if (!chargedThisTurn(ctx)) return;
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      ctx.logPublic("Courageous Steelhand: target attack gains +3{p}");
    },
  },

  "edict of steel|1": {
    // Go again is native. "Sharpen target sword you control" = a +1{p} counter.
    canPlay: (ctx) => ctx.player(ctx.seat).weapons.some((w) => isSword(ctx, w)),
    onPlay(ctx) {
      const swords = ctx.player(ctx.seat).weapons.filter((w) => isSword(ctx, w));
      if (swords.length === 1 && swords[0]) {
        sharpenSword(ctx, swords[0].instanceId);
        return;
      }
      ctx.requestCardChoice(
        "edict-sword",
        decisionPrompt("Edict of Steel: Sharpen target sword you control", "card.sbl.sword.sharpen"),
        swords.map((c) => c.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "edict-sword") return;
      sharpenSword(ctx, Number(option));
    },
  },

  "glisten|1": {
    onPlay(ctx) {
      const weapons = ctx.player(ctx.seat).weapons;
      const options: string[] = [];
      if (weapons.length === 1) {
        for (let a = 0; a <= 4; a++) options.push(`${a}`);
      } else {
        for (let a = 0; a <= 4; a++) {
          for (let b = 0; a + b <= 4; b++) options.push(`${a}:${b}`);
        }
      }
      ctx.requestChoice(
        "glisten-dist",
        decisionPrompt("Glisten: distribute up to four +1{p} counters among your weapons", "card.sbl.weapon.counters.distribute", { values: { count: 4 } }),
        options,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "glisten-dist") return;
      const weapons = ctx.player(ctx.seat).weapons;
      option.split(":").map(Number).forEach((n, i) => {
        const w = weapons[i];
        if (n > 0 && w) ctx.addCounter(w.instanceId, "power", n);
      });
      ctx.setFlag(
        "player",
        "clearWeaponPowerCountersAtTurn",
        ctx.state.activePlayer === ctx.seat ? ctx.state.turn : ctx.state.turn + 1,
      );
      ctx.logPublic("Glisten: remove all +1{p} counters from your weapons at the beginning of your end phase");
    },
  },

  "toe the line|1": {
    onPlay(ctx) {
      ctx.preventNextDamage(ctx.seat, 2);
      ctx.addModifier({ scope: "until-end-of-turn", onPreventCreateToken: FLURRY });
    },
  },

  "roaring beam|2": {
    onPlay(ctx) {
      ctx.createToken(COURAGE);
      if (ctx.player(ctx.seat).soul.length === 0 && ctx.returnSelfToHand()) {
        ctx.charge(ctx.self.instanceId);
      }
    },
  },

  "springboard somersault|2": {
    // "played from arsenal" is stamped on the card at resolution (the chain
    // copy keeps the counter through cloneState)
    onPlay(ctx) {
      ctx.setCounter("fromArsenal", ctx.fromArsenal ? 1 : 0);
    },
    modifyDefense: (ctx) => (ctx.getCounter("fromArsenal") ? 2 : 0),
  },

  // ── Tokens ────────────────────────────────────────────────────────────────

  "agility|0": {
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Agility (next attack gains go again)",
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, { goAgain: true });
        },
      },
    ],
  },

  "courage|0": {
    triggers: [
      {
        event: "card-played",
        label: "Destroy Courage (attack +1{p})",
        condition: (ctx, played) => !!played &&
          ctx.hasCardType(played, "action") &&
          ctx.cardTypes(played).includes("attack"),
        effect(ctx) {
          ctx.destroySelf();
          ctx.addModifier({ scope: "chain-link", attack: 1 });
        },
      },
      {
        event: "weapon-attack-activated",
        label: "Destroy Courage (attack +1{p})",
        effect(ctx) {
          ctx.destroySelf();
          ctx.addModifier({ scope: "chain-link", attack: 1 });
        },
      },
    ],
  },

  "flurry|0": {
    triggers: [
      {
        event: "weapon-attack-activated",
        label: "Destroy Flurry (you may attack with the weapon twice this turn)",
        effect(ctx) {
          ctx.destroySelf();
          const weaponId = ctx.link?.attackingCard.instanceId;
          if (weaponId !== undefined) {
            // "Attack with the weapon twice" sets its total limit to 2.
            // Another Flurry sets that same limit; it does not add a third.
            ctx.setAttackActivationLimit(weaponId, 2);
          }
          ctx.logPublic("Flurry: you may attack with the weapon again this turn");
        },
      },
    ],
  },
};

/** Edict of Steel: a +1{p} counter on the sword, and a Flurry token when it
 *  ends up with 1 or more. */
function sharpenSword(ctx: ScriptCtx, instanceId: number): void {
  const extra = ctx.getFlag("player", "ahaExtraSharpen") === true ? 1 : 0;
  if (extra) ctx.setFlag("player", "ahaExtraSharpen", false);
  ctx.addCounter(instanceId, "power", 1 + extra);
  ctx.setCardCounter(instanceId, "sharpenedTurn", ctx.state.turn);
  ctx.setFlag(
    "player",
    "clearWeaponPowerCountersAtTurn",
    ctx.state.activePlayer === ctx.seat ? ctx.state.turn : ctx.state.turn + 1,
  );
  const sword = ctx.player(ctx.seat).weapons.find((w) => w.instanceId === instanceId);
  ctx.logPublic(`Edict of Steel: ${sword ? ctx.cardData(sword.cardId).name : "the sword"} gets ${1 + extra} +1{p} counter(s)`);
  if ((sword?.counters?.power ?? 0) + 1 + extra >= 1) ctx.createToken(FLURRY);
}
