import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, opponentSeat } from "./shared-helpers.js";

function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("arrow");
}

function hasAim(card: { readonly counters?: Readonly<Record<string, number>> }): boolean {
  return (card.counters?.aim ?? 0) > 0;
}

function reload(ctx: ScriptCtx): void {
  const player = ctx.player(ctx.seat);
  if (player.arsenal.length === 0 && player.hand.length > 0) {
    ctx.requestCardChoice("aaz-reload", "Reload: put a card from your hand into your arsenal?", [
      "pass",
      ...player.hand.map((card) => card.instanceId),
    ]);
  }
}

export const aaz: Record<string, CardScript> = {
  "target totalizer|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({ scope: "until-end-of-turn" });
      },
    },
    canTriggerOnHit(ctx) {
      const source = ctx.link?.attackingCard;
      return ctx.link?.targetAllyId === undefined && !!source && isArrow(ctx, source) && hasAim(source);
    },
    onHit(ctx) {
      ctx.drawCards(ctx.seat, 1);
    },
  },
  "hidden agenda|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      effectCardCosts: [{
        zone: "arsenal",
        move: "turn-face-up",
        count: 1,
        subtype: "arrow",
        prompt: "Turn a face-down arrow in your arsenal face up as a cost",
      }],
      canActivate(ctx) {
        return ctx.player(ctx.seat).arsenal.some((card) => card.faceDown && isArrow(ctx, card));
      },
      onActivate(ctx) {
        ctx.changeResources(ctx.seat, 1);
        ctx.destroyAtEndPhase(ctx.self.instanceId);
      },
    },
  },
  "sharp shooters|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      canActivate(ctx) {
        return ctx.player(ctx.seat).arsenal.length === 0 &&
          ctx.player(ctx.seat).hand.some((card) => isArrow(ctx, card));
      },
      onActivate(ctx) {
        const arrows = ctx.player(ctx.seat).hand.filter((card) => isArrow(ctx, card));
        ctx.requestCardChoice("sharp-shooters", "Put an arrow face up into your arsenal", arrows.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "sharp-shooters") return;
      const id = Number(option);
      if (ctx.putIntoArsenal(id, "hand", { faceUp: true })) ctx.addCounter(id, "aim", 1);
    },
  },
  "flight path|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate(ctx) {
        return ctx.link?.attacker === ctx.seat && isArrow(ctx, ctx.link.attackingCard) && hasAim(ctx.link.attackingCard);
      },
      onActivate(ctx) {
        ctx.grantGoAgain();
      },
    },
  },
  "barbed undertow|1": {
    canTriggerOnHit(ctx) {
      return hasAim(ctx.self) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
            ctx.requestChoice("barbed-undertow-color", "Choose a color the defending hero can't pitch", ["red", "yellow", "blue"]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "barbed-undertow-color") return;
      const color = option === "red" ? 1 : option === "yellow" ? 2 : option === "blue" ? 3 : 0;
      if (color === 0) return;
      const target = ctx.player(opponentSeat(ctx));
      const mask = Number(target.hero.counters?.pitchColorsProhibitedMask ?? 0) | (1 << (color - 1));
      const throughTurn = Math.max(
        Number(target.hero.counters?.pitchColorProhibitedThroughTurn ?? 0),
        ctx.state.turn + 1,
      );
      ctx.setCardCounter(target.hero.instanceId, "pitchColorsProhibitedMask", mask);
      ctx.setCardCounter(target.hero.instanceId, "pitchColorProhibitedThroughTurn", throughTurn);
    },
  },
  "red in the ledger|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const target = ctx.player(opponentSeat(ctx));
      ctx.setCardCounter(target.hero.instanceId, "actionLimit", 1);
      ctx.setCardCounter(target.hero.instanceId, "actionLimitTurn", ctx.state.turn + 1);
    },
  },
  "stone rain|1": {
    onAttackDeclared(ctx) {
      if (hasAim(ctx.self)) ctx.addModifier({ scope: "chain-link", dominate: true });
    },
    canTriggerOnHit(ctx) {
      return hasAim(ctx.self) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
            ctx.banishRandomFromHandUntilEndPhase(opponentSeat(ctx), ctx.state.turn + 1);
    },
  },
  "line it up|2": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow" });
      const arrow = ctx.player(ctx.seat).arsenal.find((card) => card.faceDown && isArrow(ctx, card));
      if (arrow) ctx.requestChoice("line-it-up", "Turn the arrow in your arsenal face up and give it an aim counter?", ["yes", "no"]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "line-it-up" || option !== "yes") return;
      const arrow = ctx.player(ctx.seat).arsenal.find((card) => card.faceDown && isArrow(ctx, card));
      if (arrow && ctx.turnArsenalFaceUp(arrow.instanceId)) ctx.addCounter(arrow.instanceId, "aim", 1);
    },
  },
  "nock the deathwhistle|3": {
    onPlay(ctx) {
      const arrows = ctx.player(ctx.seat).deck.filter((card) => isArrow(ctx, card));
      if (arrows.length) {
        ctx.requestCardChoice("nock-arrow", "Search your deck for an arrow", arrows.map((card) => card.instanceId));
      } else {
        ctx.shuffleDeck();
        reload(ctx);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "nock-arrow") {
        const id = Number(option);
        const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === id);
        if (!card) return;
        ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(card.cardId).name}`);
        ctx.shuffleDeck();
        ctx.putOnDeckTop(id);
        reload(ctx);
      } else if (hook === "aaz-reload" && option !== "pass") {
        ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
      }
    },
  },
};
