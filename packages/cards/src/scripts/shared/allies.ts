import type { CardScript, Modifier, ScriptCtx } from "@fyendal/engine";
import { cardNamed, isAlly, isPirate } from "./cards.js";
import { armDelayedEffect, buffNextAttack, consumeDelayedEffect } from "./triggers.js";

export function controlsVox(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).weapons.some((card) => cardNamed(ctx, card, "Vox Necropolis"));
}

export function decay(): Pick<CardScript, "triggers"> {
  return {
    triggers: [
      {
        event: "end-of-turn",
        whose: "subject",
        label: "Decay",
        labelMessage: { id: "card.trigger.common.decay" },
        effect(ctx) {
          const life = ctx.self.life ?? 0;
          if (life <= 1) {
            ctx.destroySelf();
            return;
          }
          ctx.setState("lifePenalty", ctx.getState("lifePenalty") + 1);
          ctx.setPermanentLife(ctx.self.instanceId, life - 1);
        },
      },
    ],
  };
}

export function skeletalPuppetry(power: number): CardScript {
  return {
    alternativePlayCost: {
      kind: "discard-hand-subtype",
      subtype: "ally",
    },
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: power,
        appliesToSubtype: "ally",
        goAgain: true,
      });
    },
  };
}

type NextAllyMod = Omit<Modifier, "id" | "sourceInstanceId" | "scope" | "defense" | "seat">;

/** "Your next Pirate ally attack this turn gets <mod> and 'When this hits a hero, <onHitEffect>'"; copies stack. */
export function nextAllyAttack(key: string, mod: NextAllyMod, onHitEffect: (ctx: ScriptCtx) => void): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        appliesToSubtype: "ally",
        appliesToClass: "pirate",
        ...mod,
      });
      armDelayedEffect(ctx);
    },
    onFriendlyAttackDeclared(ctx) {
      const link = ctx.link;
      if (!link || link.attacker !== ctx.seat) return;
      if (!isAlly(ctx, link.attackingCard) || !isPirate(ctx, link.attackingCard)) return;
      // onHit reads the link flag, so consuming the marker here is safe.
      if (!consumeDelayedEffect(ctx)) return;
      ctx.setFlag("link", key, (Number(ctx.getFlag("link", key)) || 0) + 1);
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return (
        !!link &&
        link.attacker === ctx.seat &&
        link.targetAllyId === undefined &&
        (Number(ctx.getFlag("link", key)) || 0) > 0
      );
    },
    onHit(ctx) {
      const n = Number(ctx.getFlag("link", key)) || 0;
      // The lingering dispatch calls this once per marker; the first fires them all.
      ctx.setFlag("link", key, 0);
      for (let i = 0; i < n; i++) onHitEffect(ctx);
    },
  };
}
