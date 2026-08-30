import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  buffNextAttack,
  opponentSeat,
  optN,
  optOnChoose,
} from "../shared-helpers.js";

function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("arrow");
}

/** Reload: if the arsenal is empty, optionally put a hand card there face down. */
function reload(ctx: ScriptCtx): void {
  const player = ctx.state.players[ctx.seat]!;
  if (player.arsenal.length > 0 || player.hand.length === 0) return;
  ctx.requestCardChoice(
    "arc-reload",
    "Reload: put a card from your hand into your arsenal?",
    ["pass", ...player.hand.map((card) => card.instanceId)],
  );
}

function reloadOnChoose(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== "arc-reload") return false;
  if (option !== "pass") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
  return true;
}

function reloadScript(): CardScript {
  return {
    onPlay: reload,
    onChoose(ctx, hook, option) {
      reloadOnChoose(ctx, hook, option);
    },
  };
}

/** Put the looked cards on the bottom in the controller's chosen order, then
 * load the selected arrow. Loading last makes arsenal-entry triggers observe
 * the deck after Silver the Tip has finished moving the other looked cards. */
function orderSilverBottoms(ctx: ScriptCtx, arrowId: number, ids: number[]): void {
  if (ids.length === 0) {
    if (arrowId > 0) ctx.putIntoArsenal(arrowId, "deck");
    return;
  }
  if (ids.length === 1) {
    ctx.putOnDeckBottom(ids[0]!);
    if (arrowId > 0) ctx.putIntoArsenal(arrowId, "deck");
    return;
  }
  ctx.requestCardChoice(
    `silver-order:${arrowId}:${ids.join(",")}`,
    "Silver the Tip: choose the next card to put on the bottom",
    ids,
  );
}

function silverTheTip(look: number): CardScript {
  return {
    onPlay(ctx) {
      const player = ctx.state.players[ctx.seat]!;
      if (player.arsenal.length > 0) return;
      const looked = player.deck.slice(0, look);
      if (looked.length === 0) return;
      for (const card of looked) ctx.lookAt(card.instanceId);
      const arrowIds = looked
        .filter((card) => isArrow(ctx, card))
        .map((card) => card.instanceId);
      if (arrowIds.length === 0) {
        orderSilverBottoms(ctx, 0, looked.map((card) => card.instanceId));
        return;
      }
      ctx.requestCardChoice(
        `silver-select:${looked.map((card) => card.instanceId).join(",")}`,
        "Silver the Tip: put an arrow face up into your arsenal?",
        ["pass", ...arrowIds],
      );
    },
    onChoose(ctx, hook, option) {
      const selected = /^silver-select:([\d,]+)$/.exec(hook);
      if (selected) {
        const looked = selected[1]!.split(",").map(Number);
        const arrowId = option === "pass" ? 0 : Number(option);
        orderSilverBottoms(
          ctx,
          arrowId,
          looked.filter((id) => id !== arrowId),
        );
        return;
      }
      const ordering = /^silver-order:(\d+):([\d,]+)$/.exec(hook);
      if (!ordering) return;
      const arrowId = Number(ordering[1]);
      const remaining = ordering[2]!.split(",").map(Number);
      const chosen = Number(option);
      if (!remaining.includes(chosen)) return;
      ctx.putOnDeckBottom(chosen);
      orderSilverBottoms(
        ctx,
        arrowId,
        remaining.filter((id) => id !== chosen),
      );
    },
  };
}

function takeAim(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        appliesToClass: "ranger",
      });
      reload(ctx);
    },
    onChoose(ctx, hook, option) {
      reloadOnChoose(ctx, hook, option);
    },
  };
}

const headShot: CardScript = {
  onEnterArsenal(ctx) {
    ctx.addCardTempPower(ctx.self.instanceId, 2);
    ctx.logPublic(`${ctx.data.name} gets +2{p} this turn`);
  },
};

const hamstringShot: CardScript = {
  canTriggerOnHit(ctx) {
    return ctx.link?.targetAllyId === undefined;
  },
  onHit(ctx) {
    const target = opponentSeat(ctx);
    ctx.increaseFirstAttackCostNextTurn(target, 1);
    ctx.logPublic(
      `${ctx.data.name}: ${ctx.cardData(ctx.state.players[target]!.heroCardId).name}'s first attack next turn costs an additional {r}`,
    );
  },
};

const ridgeRiderShot: CardScript = {
  onEnterArsenal(ctx) {
    optN(ctx, 1);
  },
  onChoose(ctx, hook, option) {
    optOnChoose(ctx, hook, option);
  },
};

const salvageShot: CardScript = {
  onHit(ctx) {
    ctx.setFlag("link", "attackToBottom", true);
  },
};

const searingShot: CardScript = {
  canTriggerOnHit(ctx) {
    return ctx.link?.targetAllyId === undefined;
  },
  onHit(ctx) {
    const seat = opponentSeat(ctx);
    ctx.loseLife(seat, 1);
    const hero = ctx.player(seat);
    ctx.logPublic(`${ctx.cardData(hero.heroCardId).name} loses 1 life (${hero.life} life)`);
  },
};

const sicEmShot: CardScript = {
  onAttackDeclared(ctx) {
    if (ctx.getFlag("link", "fromArsenal") === true) ctx.grantGoAgain();
  },
};

export const arcRanger: Record<string, CardScript> = {
  "take cover|1": reloadScript(),
  "take cover|2": reloadScript(),
  "take cover|3": reloadScript(),

  "silver the tip|1": silverTheTip(4),
  "silver the tip|2": silverTheTip(3),
  "silver the tip|3": silverTheTip(2),

  "take aim|2": takeAim(2),
  "take aim|3": takeAim(1),

  "head shot|1": headShot,
  "head shot|2": headShot,
  "head shot|3": headShot,

  "hamstring shot|1": hamstringShot,
  "hamstring shot|2": hamstringShot,
  "hamstring shot|3": hamstringShot,

  "ridge rider shot|2": ridgeRiderShot,
  "ridge rider shot|3": ridgeRiderShot,

  "salvage shot|1": salvageShot,
  "salvage shot|2": salvageShot,
  "salvage shot|3": salvageShot,

  "searing shot|2": searingShot,
  "searing shot|3": searingShot,

  "sic 'em shot|1": sicEmShot,
  "sic 'em shot|2": sicEmShot,
  "sic 'em shot|3": sicEmShot,
};
