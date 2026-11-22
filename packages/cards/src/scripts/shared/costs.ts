import type { CardInstance, CardScript, DeepReadonly, ScriptCtx, ScriptPrompt } from "@fyendal/engine";
import { isAttackAction, isSixPlus } from "./cards.js";
import { commonOptionMessages, decisionMessage, decisionPrompt, localizedLog } from "./messages.js";

/** "pass" lets the client pick the charged card in hand instead of in a popup. */
const CHARGE_DECLINE = "pass";

/** Options for an optional charge: decline, then each hand card. */
export function optionalChargeOptions(ctx: ScriptCtx): (string | number)[] {
  return [CHARGE_DECLINE, ...ctx.player(ctx.seat).hand.map((card) => card.instanceId)];
}

export const chargeDeclineMessages = { [CHARGE_DECLINE]: decisionMessage("common.option.decline") };

/** "no" still declines decisions persisted before charges declined with "pass". */
export function isChargeDecline(option: string): boolean {
  return option === CHARGE_DECLINE || option === "no";
}

const CHARGE_COST_HOOK = "charge-cost";

/** Hooks of charge-cost decisions persisted before the cost was shared. */
const LEGACY_CHARGE_COST_HOOKS: ReadonlySet<string> = new Set([
  "asb-charge",
  "dtd-charge",
  "iar-bravery-charge",
  "mon-charge",
]);

/** "As an additional cost, you may charge your hero's soul." The charged
 * card's pitch is kept as `chargedPitch` (0 when nothing was charged);
 * `extra`'s additional cost and choices follow the charge. */
export function chargeAttack(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    additionalCost(ctx) {
      if (ctx.player(ctx.seat).hand.length > 0)
        ctx.requestCardChoice(
          CHARGE_COST_HOOK,
          decisionPrompt(
            `${ctx.data.name}: choose a card from your hand to charge, or decline`,
            "card.common.charge.choose",
            { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: chargeDeclineMessages },
          ),
          optionalChargeOptions(ctx),
        );
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== CHARGE_COST_HOOK && !LEGACY_CHARGE_COST_HOOKS.has(hook)) {
        extra.onChoose?.(ctx, hook, option);
        return;
      }
      if (isChargeDecline(option)) return;
      const charged = ctx.charge(Number(option));
      if (charged) ctx.setState("chargedPitch", ctx.cardColor(charged));
    },
  };
}

/** Heave N can be paid and this card can still move from hand to arsenal. */
export function canHeave(ctx: ScriptCtx, amount: number): boolean {
  return ctx.hasArsenalSpace() &&
    ctx.player(ctx.seat).hand.some((card) => card.instanceId === ctx.self.instanceId) &&
    ctx.canPayResources(amount, [ctx.self.instanceId]);
}

/** Ask the affected hero to choose one of their hand cards to discard. */
export function requestDiscardChoice(ctx: ScriptCtx, hook: string, prompt: ScriptPrompt, targetSeat: number): boolean {
  const hand = ctx.player(targetSeat).hand;
  if (hand.length === 0) return false;
  ctx.requestCardChoice(
    hook,
    prompt,
    hand.map((card) => card.instanceId),
    targetSeat,
  );
  return true;
}

/** Validate and perform a pending affected-player discard choice. */
export function resolveDiscardChoice(
  ctx: ScriptCtx,
  option: string,
  targetSeat: number,
): DeepReadonly<CardInstance> | undefined {
  return ctx.discardCard(targetSeat, Number(option));
}

/** Beat Chest: optional additional cost of discarding a card with 6 or more base {p}. */
export function beatChest(
  extra: CardScript = {},
  opts: { hook?: string; messageId?: string } = {},
): CardScript {
  const hook = opts.hook ?? "beat-chest";
  return {
    ...extra,
    additionalCost(ctx) {
      const sixes = ctx.player(ctx.seat).hand.filter((card) => isSixPlus(ctx, card));
      if (sixes.length) {
        ctx.requestCardChoice(
          hook,
          decisionPrompt(
            `${ctx.data.name}: discard a card with 6 or more power to beat chest?`,
            opts.messageId ?? "card.common.beatchest.discard",
            {
              values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: 6 },
              optionMessages: commonOptionMessages("no"),
            },
          ),
          ["no", ...sixes.map((card) => card.instanceId)],
        );
      }
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, chosenHook, option) {
      if (chosenHook !== hook) {
        extra.onChoose?.(ctx, chosenHook, option);
        return;
      }
      const attackAction = isAttackAction(ctx, ctx.self);
      ctx.setFlag("player", "discardingToBeatChest", true);
      if (attackAction) ctx.setFlag("player", "discardingForBruteAttackCost", true);
      const discarded = option !== "no" && ctx.discardCard(ctx.seat, Number(option));
      ctx.setFlag("player", "discardingToBeatChest", false);
      if (attackAction) ctx.setFlag("player", "discardingForBruteAttackCost", false);
      if (discarded) {
        ctx.setFlag("player", "beatenChestThisTurn", true);
        ctx.setCardState(ctx.self.instanceId, "beatChestPaid", 1);
      }
    },
  };
}

export function beatenChest(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "beatenChestThisTurn") === true;
}

/** Additional cost: discard a random card. */
export function discardRandomCost(ctx: ScriptCtx): void {
  ctx.discardRandom(ctx.seat, 1);
}

/** "Pay {r}: +N{d}", on defend or with `onPlay` on play; `destroyOnClose` destroys it when the chain closes. */
export function payForDefenseBoost(
  cost: number,
  defense: number,
  opts?: {
    destroyOnClose?: boolean;
    onPlay?: boolean;
    message?: string | ((ctx: ScriptCtx) => string);
    logMessage?: string | ((ctx: ScriptCtx) => string);
  },
): CardScript {
  const resourceString = Array(cost).fill("{r}").join("");
  const resolve = (v: string | ((ctx: ScriptCtx) => string) | undefined, ctx: ScriptCtx, fallback: string) =>
    typeof v === "function" ? v(ctx) : (v ?? fallback);
  const request = (ctx: ScriptCtx) => {
    ctx.requestPayment(
      "pay-boost",
      resolve(opts?.message, ctx, `${ctx.data.name}: pay ${resourceString} for +${defense}{d}?`),
      cost,
    );
  };
  const onChoose = (ctx: ScriptCtx, hook: string, option: string) => {
    if (hook !== "pay-boost" || option !== "paid") return;
    ctx.addModifier({ scope: "chain-link", defense });
    if (opts?.destroyOnClose) {
      ctx.setFlag("link", `destroyOnClose:${ctx.self.instanceId}`, true);
    }
    ctx.logPublic(
      localizedLog(
        resolve(opts?.logMessage, ctx, `${ctx.data.name} gains +${defense} defense`),
        "card.log.common.defense.gained",
        {
          card: { kind: "card", cardId: ctx.self.cardId },
          defense,
        },
      ),
    );
  };
  return opts?.onPlay ? { onPlay: request, onChoose } : { defendCost: cost, onDefend: request, onChoose };
}

/** Ironhide-style: "when you defend with this, you may pay {r}: +2{d}, destroy when the chain closes" */
export function ironhideScript(): CardScript {
  return payForDefenseBoost(1, 2, {
    destroyOnClose: true,
    message: (ctx) => `${ctx.data.name}: pay {r} for +2 defense? (it is destroyed when the combat chain closes)`,
  });
}

export function discardUnlessPay(ctx: ScriptCtx, target: number, cost: number, key: string): void {
  const player = ctx.state.players[target]!;
  if (player.hand.length === 0) return;
  if (
    ctx.requestPayment(
      `${key}:pay:${target}`,
      decisionPrompt(
        `${ctx.data.name}: pay ${cost} resource${cost === 1 ? "" : "s"} or discard a card?`,
        "card.common.discard.pay",
        {
          values: {
            card: { kind: "card", cardId: ctx.self.cardId },
            amount: cost,
          },
          optionMessages: commonOptionMessages("no"),
        },
      ),
      cost,
      target,
    )
  )
    return;
  ctx.requestCardChoice(
    `${key}:discard:${target}`,
    decisionPrompt(`${ctx.data.name}: choose a card to discard`, "card.common.card.discard.choose.named", {
      values: { card: { kind: "card", cardId: ctx.self.cardId } },
    }),
    player.hand.map((card) => card.instanceId),
    target,
  );
}
