import type { ActivatedAbility, CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  commonOptionMessages,
  dealArcane,
  decisionPrompt,
  isCard,
  localizedCardLog,
  opponentSeat,
} from "./shared-helpers.js";

// ── SVI (Silver Age Chapter 1: Viserai precon) ──────────────────────────────
//
// The engine exposes beginning-of-action-phase triggers, generic leave-arena
// hooks, and granted on-hit riders for both hero and ally hits. Sigil of
// Silphidae and Mauvrion Skies therefore use their printed timing directly.

const RUNECHANT = "SVI034";

function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("aura");
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
}

function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !ctx.cardTypes(card).includes("attack");
}

function runeCount(ctx: ScriptCtx): number {
  return ctx.player(ctx.seat).board.filter((card) => isCard(ctx, card.cardId, "Runechant")).length;
}

function playedOrCreatedAura(ctx: ScriptCtx): boolean {
  return (
    ctx.getFlag("player", "playedSubtype:aura") === true ||
    ctx.getFlag("player", "createdSubtype:aura") === true
  );
}

function createRunechants(ctx: ScriptCtx, count: number): void {
  ctx.createTokens(RUNECHANT, count);
}

function auraActivityAttackBonus(amount: number): CardScript {
  return { modifyAttack: (ctx) => (playedOrCreatedAura(ctx) ? amount : 0) };
}

function spellbladeAssault(): CardScript {
  return { onAttackDeclared: (ctx) => createRunechants(ctx, 2) };
}

function maleficIncantation(verses: number): CardScript {
  return {
    destroyAtZeroCounter: "verse",
    onEnterArena(ctx) {
      ctx.setCounter("verse", verses);
    },
    triggers: [{
      event: "card-played",
      label: "Remove a verse counter and create a Runechant",
      condition(ctx, played) {
        const onceKey = `maleficUsed:${ctx.self.instanceId}`;
        return !!played &&
          isAttackAction(ctx, played) &&
          ctx.getFlag("player", onceKey) !== true &&
          ctx.getCounter("verse") > 0;
      },
      onTrigger(ctx) {
        ctx.setFlag("player", `maleficUsed:${ctx.self.instanceId}`, true);
      },
      effect(ctx) {
        ctx.setCounter("verse", ctx.getCounter("verse") - 1);
        createRunechants(ctx, 1);
      },
    }],
  };
}

function condemnToSlaughter(amount: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: amount, appliesToClass: "runeblade" });
      const auras = ctx.player(ctx.seat).board.filter((card) => isAura(ctx, card));
      if (auras.length > 0) {
        ctx.requestCardChoice(
          "condemn-own-aura",
          decisionPrompt(
            `${ctx.data.name}: destroy an aura you control?`,
            "card.svi.condemn.own.aura.destroy",
            {
              values: { card: { kind: "card", cardId: ctx.self.cardId } },
              optionMessages: commonOptionMessages("no"),
            },
          ),
          ["no", ...auras.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "condemn-own-aura") {
        if (option === "no") return;
        const aura = ctx.player(ctx.seat).board.find((card) => card.instanceId === Number(option));
        if (!aura || !isAura(ctx, aura)) return;
        ctx.destroyPermanent(aura.instanceId);
        const opposingAuras = ctx.player(opponentSeat(ctx)).board.filter((card) => isAura(ctx, card));
        if (opposingAuras.length > 0) {
          ctx.requestCardChoice(
            "condemn-opposing-aura",
            decisionPrompt(
              `${ctx.data.name}: destroy an aura you control`,
              "card.svi.condemn.opposing.aura.destroy",
              { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
            ),
            opposingAuras.map((card) => card.instanceId),
            opponentSeat(ctx),
          );
        }
        return;
      }
      if (hook !== "condemn-opposing-aura") return;
      const aura = ctx.player(opponentSeat(ctx)).board.find((card) => card.instanceId === Number(option));
      if (aura && isAura(ctx, aura)) {
        ctx.destroyPermanent(aura.instanceId);
      }
    },
  };
}

function mauvrionSkies(runechants: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        goAgain: true,
        appliesTo: "attack-action",
        appliesToClass: "runeblade",
        onHitCreateToken: { cardId: RUNECHANT, count: runechants },
      });
    },
  };
}

function sigilOfSilphidaeTrigger(ctx: ScriptCtx): void {
  const auras = ctx.player(ctx.seat).graveyard.filter(
    (card) => card.instanceId !== ctx.self.instanceId && isAura(ctx, card),
  );
  if (auras.length === 0) return;
  ctx.requestCardChoice(
    "silphidae-banish",
    decisionPrompt(
      `${ctx.data.name}: banish another aura from your graveyard for ${ctx.previewArcaneDamage(1)} arcane damage?`,
      "card.svi.silphidae.aura.banish",
      {
        values: {
          card: { kind: "card", cardId: ctx.self.cardId },
          amount: ctx.previewArcaneDamage(1),
        },
        optionMessages: commonOptionMessages("no"),
      },
    ),
    ["no", ...auras.map((card) => card.instanceId)],
  );
}

function beckoningAbilities(): ActivatedAbility[] {
  return Array.from({ length: 11 }, (_, x) => ({
    cost: 2 * x + 1,
    isAttack: false,
    goAgain: false,
    label: `Return a cost ${x} aura`,
    canActivate(ctx: ScriptCtx) {
      return ctx.player(ctx.seat).graveyard.some(
        (card) => isAura(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) === x,
      );
    },
    onActivate(ctx: ScriptCtx) {
      ctx.destroySelf();
      const auras = ctx.player(ctx.seat).graveyard.filter(
        (card) => isAura(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) === x,
      );
      ctx.requestCardChoice(
        "beckoning-return",
        decisionPrompt(
          `${ctx.data.name}: return a cost ${x} aura from your graveyard to your hand`,
          "card.svi.beckoning.aura.return",
          {
            values: {
              card: { kind: "card", cardId: ctx.self.cardId },
              amount: x,
            },
          },
        ),
        auras.map((card) => card.instanceId),
      );
    },
  }));
}

export const svi: Record<string, CardScript> = {
  "viserai|0": {
    triggers: [{
      event: "card-played",
      label: "Create a Runechant",
      condition(ctx, played) {
        if (!played) return false;
      const currentIsNonAttack = isNonAttackAction(ctx, played);
      const priorNonAttacks = Number(ctx.getFlag("player", "nonAttackActionsPlayedThisTurn")) -
        (currentIsNonAttack ? 1 : 0);
        return ctx.cardTypes(played).includes("runeblade") && priorNonAttacks > 0;
      },
      effect: (ctx) => createRunechants(ctx, 1),
    }],
  },

  "reaping blade|0": {
    activated: attackAbility(1),
    preventsLifeGainWhileAhead: true,
  },

  "runebleed robe|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy with a Runechant: prevent 1 arcane damage",
      canActivate: (ctx) => runeCount(ctx) > 0,
      onActivate(ctx) {
        const rune = ctx.player(ctx.seat).board.find((card) => isCard(ctx, card.cardId, "Runechant"));
        if (!rune) return;
        ctx.destroyPermanent(rune.instanceId);
        ctx.destroySelf();
        ctx.preventNextDamage(ctx.seat, 1);
      },
    },
  },

  "beckoning haunt|0": {
    activated: beckoningAbilities(),
    onChoose(ctx, hook, option) {
      if (hook !== "beckoning-return") return;
      const aura = ctx.player(ctx.seat).graveyard.find((card) => card.instanceId === Number(option));
      if (!aura || !isAura(ctx, aura)) return;
      ctx.moveToHand(aura.instanceId);
      ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: return ${ctx.cardData(aura.cardId).name} to hand`, "card.log.svi.aura.returned", { result: { kind: "card", cardId: aura.cardId } }, { kind: "card-moved", cardId: aura.cardId, ownerSeat: ctx.seat, from: "graveyard", to: "hand" }));
    },
  },

  "amplify the arknight|1": {
    modifyPlayCost: (ctx, base) => Math.max(0, base - runeCount(ctx)),
  },
  "rune flash|1": {
    modifyPlayCost: (ctx, base) => Math.max(0, base - runeCount(ctx)),
  },
  "reduce to runechant|1": {
    modifyPlayCost: (ctx, base) => Math.max(0, base - runeCount(ctx)),
    onPlay: (ctx) => createRunechants(ctx, 1),
  },

  "hit the high notes|1": auraActivityAttackBonus(2),
  "shrill of skullform|1": auraActivityAttackBonus(3),
  "shrill of skullform|2": auraActivityAttackBonus(3),
  "shrill of skullform|3": auraActivityAttackBonus(3),
  "runerager swarm|1": {
    onAttackDeclared(ctx) {
      if (playedOrCreatedAura(ctx)) ctx.grantGoAgain();
    },
  },

  "runic fellingsong|1": {
    onAttackDeclared(ctx) {
      const auras = ctx.player(ctx.seat).graveyard.filter((card) => isAura(ctx, card));
      if (auras.length > 0) {
        ctx.requestCardChoice(
          "fellingsong-banish",
          decisionPrompt(
            `${ctx.data.name}: banish an aura from your graveyard for ${ctx.previewArcaneDamage(1)} arcane damage?`,
            "card.svi.fellingsong.aura.banish",
            {
              values: {
                card: { kind: "card", cardId: ctx.self.cardId },
                amount: ctx.previewArcaneDamage(1),
              },
              optionMessages: commonOptionMessages("no"),
            },
          ),
          ["no", ...auras.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "fellingsong-banish" || option === "no") return;
      if (ctx.banish(Number(option))) dealArcane(ctx, opponentSeat(ctx), 1);
    },
  },

  "spellblade assault|1": spellbladeAssault(),
  "spellblade assault|3": spellbladeAssault(),
  "vexing malice|3": {
    onAttackDeclared: (ctx) => dealArcane(ctx, opponentSeat(ctx), 2),
  },

  "condemn to slaughter|1": condemnToSlaughter(3),
  "condemn to slaughter|3": condemnToSlaughter(1),
  "malefic incantation|1": maleficIncantation(3),
  "malefic incantation|2": maleficIncantation(2),
  "mauvrion skies|1": mauvrionSkies(3),
  "mauvrion skies|3": mauvrionSkies(1),
  "read the runes|1": { onPlay: (ctx) => createRunechants(ctx, 3) },

  "sigil of silphidae|3": {
    onEnterArena: sigilOfSilphidaeTrigger,
    onLeaveArena: sigilOfSilphidaeTrigger,
    triggers: [
      {
        event: "begin-action-phase",
        label: "Destroy Sigil of Silphidae",
        effect: (ctx) => ctx.destroySelf(),
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "silphidae-banish" || option === "no") return;
      if (ctx.banish(Number(option))) dealArcane(ctx, opponentSeat(ctx), 1);
    },
  },
};
