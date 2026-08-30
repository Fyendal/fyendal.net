import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, isSixPlus, opponentSeat, queueIntimidate } from "./shared-helpers.js";

const AGILITY = "ARR029";
const MIGHT = "ARR030";

function beatChest(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    additionalCost(ctx) {
      const sixes = ctx.player(ctx.seat).hand.filter((card) => isSixPlus(ctx, card));
      if (sixes.length) {
        ctx.requestCardChoice(
          "arr-beat-chest",
          `${ctx.data.name}: discard a card with 6 or more power to beat chest?`,
          ["no", ...sixes.map((card) => card.instanceId)],
        );
      }
      extra.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook === "arr-beat-chest") {
        ctx.setFlag("player", "discardingToBeatChest", true);
        ctx.setFlag("player", "discardingForBruteAttackCost", true);
        const discarded = option !== "no" && ctx.discardCard(ctx.seat, Number(option));
        ctx.setFlag("player", "discardingToBeatChest", false);
        ctx.setFlag("player", "discardingForBruteAttackCost", false);
        if (discarded) {
          ctx.setFlag("player", "beatenChestThisTurn", true);
          ctx.setCardCounter(ctx.self.instanceId, "beatChestPaid", 1);
        }
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

function noChest(ctx: ScriptCtx): boolean {
  return !ctx.player(ctx.seat).equipment.chest;
}

function destroyBeatChestEquipment(ctx: ScriptCtx): void {
  ctx.destroySelf();
  if (ctx.link) ctx.setFlag("link", "beatChestEquipmentDestroyed", true);
}

function grantBareDestructionPayoff(ctx: ScriptCtx): void {
  ctx.grantGoAgain();
  buffNextAttack(ctx, { attack: 2, appliesTo: "attack-action", appliesToClass: "brute" });
  ctx.setFlag("link", "bareDestructionPayoffGranted", true);
}

function bareSwing(): CardScript {
  return beatChest({
    modifyAttack(ctx) {
      return ctx.getFlag("player", "beatenChestThisTurn") === true && noChest(ctx) ? 2 : 0;
    },
  });
}

function smellFear(amount: number): CardScript {
  return beatChest({
    onPlay(ctx) {
      if (ctx.getFlag("player", "beatenChestThisTurn") === true) queueIntimidate(ctx);
      const resolved = Number(ctx.getFlag("player", "intimidateCountThisTurn")) || 0;
      const pending = Number(ctx.getFlag("player", "pendingIntimidate")) || 0;
      if (resolved + pending >= 2) {
        buffNextAttack(ctx, { attack: amount, appliesTo: "attack", appliesToClass: "brute" });
      }
    },
  });
}

function beatChestEquipment(label: string, effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    triggers: [{
      event: "card-discarded",
      label,
      condition: (ctx) => ctx.getFlag("player", "discardingToBeatChest") === true,
      effect,
    }],
  };
}

export const arr: Record<string, CardScript> = {
  "clearing bellow|3": { onPlay: queueIntimidate },

  "alpha instinct|3": {
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Create a Might token",
      condition: (ctx, discarded) =>
        discarded?.instanceId === ctx.self.instanceId &&
        ctx.getFlag("player", "discardingToBeatChest") === true,
      effect: (ctx) => ctx.createToken(MIGHT),
    }],
  },
  "bare destruction|1": beatChest({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "beatenChestThisTurn") !== true || !noChest(ctx)) return;
      grantBareDestructionPayoff(ctx);
    },
    onAttackDeclaredTriggersResolved(ctx) {
      if (
        ctx.getFlag("link", "bareDestructionPayoffGranted") === true ||
        ctx.getFlag("link", "beatChestEquipmentDestroyed") !== true ||
        ctx.getFlag("player", "beatenChestThisTurn") !== true ||
        !noChest(ctx)
      ) return;
      grantBareDestructionPayoff(ctx);
    },
  }),
  "bare swing|1": bareSwing(),
  "bare swing|2": bareSwing(),
  "beast within|2": {
    triggers: [{
      event: "card-put-into-graveyard",
      sourceZone: "graveyard",
      label: "Banish until a 6 power card is found",
      condition: (ctx, card, eventContext) =>
        card?.instanceId === ctx.self.instanceId && eventContext?.from !== "chain",
      effect(ctx) {
        while (ctx.player(ctx.seat).deck.length) {
          const top = ctx.player(ctx.seat).deck[0]!;
          ctx.banish(top.instanceId);
          ctx.loseLife(ctx.seat, 1);
          if (isSixPlus(ctx, top)) {
            ctx.moveToHand(top.instanceId);
            break;
          }
        }
      },
    }],
  },
  "echo casque|0": {
    ...beatChestEquipment("Echo Casque — pay and destroy to draw", (ctx) => {
      ctx.requestPayment("echo-casque", "Echo Casque: pay {r} and destroy this to draw a card?", 1);
    }),
    onChoose(ctx, hook, option) {
      if (hook === "echo-casque" && option === "paid") {
        destroyBeatChestEquipment(ctx);
        ctx.drawCards(ctx.seat, 1);
      }
    },
  },
  "massacre|1": {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "discardedSixPlusThisTurn") !== true) return;
      ctx.addModifier({ scope: "chain-link", attack: 2 });
      queueIntimidate(ctx);
    },
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Intimidate",
      condition: (ctx, discarded) =>
        discarded?.instanceId === ctx.self.instanceId &&
        ctx.getFlag("player", "discardingForBruteAttackCost") === true,
      effect: (ctx) => ctx.intimidate(),
    }],
  },
  "show no mercy|1": {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId === undefined) queueIntimidate(ctx);
    },
    modifyAttack(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.player(opponentSeat(ctx)).hand.length === 0 ? 3 : 0;
    },
  },
  "smell fear|2": smellFear(3),
  "smell fear|3": smellFear(2),
  "torc of vim|0": {
    ...beatChestEquipment("Torc of Vim — destroy for a discount", (ctx) => ctx.requestChoice("torc-vim", "Destroy Torc of Vim for a {r}{r} discount?", ["yes", "no"])),
    onChoose(ctx, hook, option) {
      if (hook !== "torc-vim" || option !== "yes") return;
      destroyBeatChestEquipment(ctx);
      ctx.addModifier({
        scope: "next-play",
        appliesTo: "attack-action",
        appliesToClass: "brute",
        playCostReduction: 2,
      });
    },
  },
  "trampling trackers|0": {
    ...beatChestEquipment("Trampling Trackers — destroy to create Agility", (ctx) => ctx.requestChoice("trampling-trackers", "Destroy Trampling Trackers to create Agility?", ["yes", "no"])),
    onChoose(ctx, hook, option) {
      if (hook === "trampling-trackers" && option === "yes") {
        destroyBeatChestEquipment(ctx);
        ctx.createToken(AGILITY);
      }
    },
  },
};
