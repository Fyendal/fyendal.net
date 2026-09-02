import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { decisionPrompt, opponentSeat } from "./shared-helpers.js";

function isTome(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardData(card.cardId).name.toLowerCase().includes("tome");
}

function nonHeroPermanents(ctx: ScriptCtx, seat: number): DeepReadonly<CardInstance>[] {
  const player = ctx.player(seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter(
      (card): card is DeepReadonly<CardInstance> => card !== undefined,
    ),
  ];
}

export const jdg: Record<string, CardScript> = {
  "brutus, summa rudis|0": { choosesFailedClashWinner: true },

  // In a two-hero game, an attack aimed at the other hero has no alternative
  // legal hero target (CR 1.8.5f). Taipanis therefore has no applicable attack
  // redirection in Fyendal's supported game shape.
  "taipanis, dracai of judgement|0": {},

  "the librarian, magister of history|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: false,
      tap: true,
      label: "Reveal a Tome from inventory",
      canActivate: (ctx) => (ctx.player(ctx.seat).inventory ?? []).some((card) => isTome(ctx, card)),
      onActivate(ctx) {
        const tomes = (ctx.player(ctx.seat).inventory ?? []).filter((card) => isTome(ctx, card));
        if (tomes.length) {
          ctx.requestCardChoice(
            "librarian-tome",
            decisionPrompt(
              "The Librarian: reveal a Tome from inventory",
              "card.jdg.librarian.tome.choose",
            ),
            tomes.map((card) => card.instanceId),
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "librarian-tome") return;
      const instanceId = Number(option);
      ctx.revealCards([instanceId]);
      if (!ctx.moveInventoryToHand(instanceId)) return;
      const target = ctx.player(opponentSeat(ctx));
      ctx.setCardCounter(target.hero.instanceId, "bonusIntellectAtEndPhaseTurn", ctx.state.turn + 1);
    },
  },

  "theryon, magister of justice|0": {
    onFriendlyDestroyed(ctx, _destroyed, destroyingSeat) {
      if (
        destroyingSeat === undefined ||
        destroyingSeat === ctx.seat ||
        ctx.getFlag("player", "theryonObservedDestruction") === true
      ) return;
      ctx.setFlag("player", "theryonObservedDestruction", true);
      ctx.setCounter("theryonDestroyingSeat", destroyingSeat);
      ctx.requestPayment(
        "theryon-pay",
        decisionPrompt(
          "Theryon: pay 2 resources to have that hero destroy a permanent they control?",
          "card.jdg.theryon.pay",
        ),
        2,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "theryon-pay" && option === "paid") {
        const destroyingSeat = ctx.getCounter("theryonDestroyingSeat");
        const permanents = nonHeroPermanents(ctx, destroyingSeat);
        if (permanents.length) {
          ctx.requestCardChoice(
            "theryon-destroy",
            decisionPrompt(
              "Choose a non-hero permanent you control to destroy",
              "card.jdg.theryon.permanent.choose",
            ),
            permanents.map((card) => card.instanceId),
            destroyingSeat,
          );
        }
      } else if (hook === "theryon-destroy") {
        const destroyingSeat = ctx.getCounter("theryonDestroyingSeat");
        ctx.destroyPermanent(Number(option), destroyingSeat);
      }
    },
  },
};
