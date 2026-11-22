import type { CardScript, ScriptCtx, TriggerDef } from "@fyendal/engine";
import type { GameMessage } from "@fyendal/shared";
import { decisionMessage, localizedLog } from "./messages.js";
import { buffNextAttack, entersArenaTrigger, leavesArenaTrigger } from "./triggers.js";

/** A Suspense aura's own "when this enters/leaves the arena" ability. */
export type SuspenseTrigger = Pick<TriggerDef, "label" | "condition" | "optional" | "target"> & {
  labelMessage: GameMessage;
  effect: (ctx: ScriptCtx) => void;
};

/** "Your next attack this turn gets +N{p}" as a Suspense leave trigger. */
export function suspenseNextAttackBuff(amount: number): SuspenseTrigger {
  return {
    label: `Your next attack this turn gets +${amount} power`,
    labelMessage: decisionMessage("card.trigger.common.nextattack.turn.attack", { amount }),
    effect: (ctx) => buffNextAttack(ctx, { attack: amount }),
  };
}

/** "The crowd cheers/boos you" as an enter or leave trigger. */
export function crowdTrigger(kind: "cheer" | "boo"): SuspenseTrigger {
  return kind === "cheer"
    ? {
        label: "The crowd cheers you",
        labelMessage: decisionMessage("card.trigger.common.crowd.cheer"),
        effect: (ctx) => ctx.crowdCheer(ctx.seat),
      }
    : {
        label: "The crowd boos you",
        labelMessage: decisionMessage("card.trigger.common.crowd.boo"),
        effect: (ctx) => ctx.crowdBoo(ctx.seat),
      };
}

/** Shared Suspense lifecycle (CR 8.3.42). The suspense counters and the
 * `suspenseAurasLeftThisTurn` bookkeeping stay in the arena hooks; the card's
 * printed enter/leave abilities become stack triggers. `onEnterArena` is only
 * for non-triggered work done as the aura enters (static abilities). */
export function suspenseAura(
  options: {
    enters?: SuspenseTrigger | readonly SuspenseTrigger[];
    leaves?: SuspenseTrigger | readonly SuspenseTrigger[];
    onEnterArena?: (ctx: ScriptCtx) => void;
    logCounterRemoval?: boolean;
  } = {},
): CardScript {
  const list = (value: SuspenseTrigger | readonly SuspenseTrigger[] | undefined): readonly SuspenseTrigger[] =>
    value === undefined ? [] : "label" in value ? [value as SuspenseTrigger] : (value as readonly SuspenseTrigger[]);
  const toTrigger = (
    make: typeof entersArenaTrigger,
    { label, labelMessage, effect, ...extra }: SuspenseTrigger,
  ): TriggerDef => make(label, labelMessage, effect, extra);
  return {
    destroyAtZeroCounter: "suspense",
    onEnterArena(ctx) {
      ctx.setCounter("suspense", 2);
      options.onEnterArena?.(ctx);
    },
    onLeaveArena(ctx) {
      ctx.setFlag(
        "player",
        "suspenseAurasLeftThisTurn",
        Number(ctx.getFlag("player", "suspenseAurasLeftThisTurn")) + 1,
      );
    },
    triggers: [
      ...list(options.enters).map((trigger) => toTrigger(entersArenaTrigger, trigger)),
      ...list(options.leaves).map((trigger) => toTrigger(leavesArenaTrigger, trigger)),
      {
        event: "start-of-turn",
        label: "Remove a suspense counter",
        labelMessage: decisionMessage("card.trigger.common.suspense.remove"),
        effect(ctx) {
          const next = Math.max(0, ctx.getCounter("suspense") - 1);
          ctx.setCounter("suspense", next);
          if (options.logCounterRemoval) {
            ctx.logPublic(
              localizedLog(
                `${ctx.data.name}: a suspense counter is removed (${next} left)`,
                "card.log.common.suspense.counter.removed",
                {
                  card: { kind: "card", cardId: ctx.self.cardId },
                  remaining: next,
                },
              ),
            );
          }
          if (next === 0) ctx.destroySelf();
        },
      },
    ],
  };
}
