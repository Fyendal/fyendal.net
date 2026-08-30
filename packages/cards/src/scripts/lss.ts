import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { opponentSeat } from "./shared-helpers.js";

function isPotionOrBrew(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  const data = ctx.cardData(card.cardId);
  return ctx.cardTypes(card).includes("item") && /potion|brew/i.test(data.name);
}

function continueBuddySearch(ctx: ScriptCtx): void {
  const order = [ctx.seat, ...ctx.state.players.filter((player) => player.seat !== ctx.seat).map((player) => player.seat)];
  let step = ctx.getCounter("buddySearchStep");
  while (step < order.length) {
    const target = order[step]!;
    ctx.setCounter("buddySearchStep", ++step);
    const choices = ctx.canSearchDeck(target)
      ? ctx.player(target).deck.filter((card) => isPotionOrBrew(ctx, card))
      : [];
    if (!choices.length) continue;
    ctx.setCounter("buddySearchSeat", target);
    ctx.requestCardChoice(
      "buddy-search",
      "Drinking Buddy: search for a Potion or Brew item?",
      ["no", ...choices.map((card) => card.instanceId)],
      target,
    );
    return;
  }
  if (ctx.getCounter("buddySearches") >= 2) ctx.grantGoAgain();
}

export const lss: Record<string, CardScript> = {
  "drinking buddy|1": {
    onAttackDeclared(ctx) {
      ctx.setCounter("buddySearchStep", 0);
      ctx.setCounter("buddySearches", 0);
      continueBuddySearch(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "buddy-search") return;
      const target = ctx.getCounter("buddySearchSeat");
      if (option !== "no" && ctx.settleCard(Number(option), { controllerSeat: target })) {
        ctx.addCounter(ctx.self.instanceId, "buddySearches", 1);
        ctx.shuffleDeck(target);
      }
      continueBuddySearch(ctx);
    },
  },

  "ruu'di, gem keeper|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Reveal the top card",
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (top) ctx.revealCards([top.instanceId]);
        // Physical PSA grading is not a property of a digital CardInstance, so
        // cards in Fyendal are ungraded and take the printed "otherwise" path.
        ctx.requestChoice(
          "ruudi-draw",
          "Ruu'di: draw a card?",
          ["yes", "no"],
          opponentSeat(ctx),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "ruudi-draw" && option === "yes") ctx.drawCards(opponentSeat(ctx), 1);
    },
  },
};
