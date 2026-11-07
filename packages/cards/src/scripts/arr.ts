import type { CardScript, ScriptCtx } from "@fyendal/engine";
import {
  attackIntimidateTrigger,
  beatChest as sharedBeatChest,
  buffNextAttack,
  decisionPrompt,
  isSixPlus,
  opponentSeat,
  queueIntimidate,
  yesNoPrompt,
} from "./shared-helpers.js";

const AGILITY = "ARR029";
const MIGHT = "ARR030";

function beatChest(extra: CardScript = {}): CardScript {
  return sharedBeatChest(extra, { hook: "arr-beat-chest", messageId: "card.arr.beatchest.discard" });
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
      buffNextAttack(ctx, {
        attack: amount,
        appliesTo: "attack",
        appliesToClass: "brute",
        intimidatedAtLeastThisTurn: 2,
      });
    },
  });
}

function beatChestEquipment(label: string, effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    triggers: [
      {
        event: "card-discarded",
        label,
        condition: (ctx) => ctx.getFlag("player", "discardingToBeatChest") === true,
        effect,
      },
    ],
  };
}

export const arr: Record<string, CardScript> = {
  "clearing bellow|3": { onPlay: queueIntimidate },

  "alpha instinct|3": {
    triggers: [
      {
        event: "card-discarded",
        sourceZone: "graveyard",
        label: "Create a Might token",
        condition: (ctx, discarded) =>
          discarded?.instanceId === ctx.self.instanceId && ctx.getFlag("player", "discardingToBeatChest") === true,
        effect: (ctx) => ctx.createToken(MIGHT),
      },
    ],
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
      )
        return;
      grantBareDestructionPayoff(ctx);
    },
  }),
  "bare swing|1": bareSwing(),
  "bare swing|2": bareSwing(),
  "beast within|2": {
    triggers: [
      {
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
      },
    ],
  },
  "echo casque|0": {
    ...beatChestEquipment("Echo Casque — pay and destroy to draw", (ctx) => {
      ctx.requestPayment(
        "echo-casque",
        decisionPrompt("Echo Casque: pay {r} and destroy this to draw a card?", "card.arr.echocasque.pay.draw"),
        1,
      );
    }),
    onChoose(ctx, hook, option) {
      if (hook === "echo-casque" && option === "paid") {
        destroyBeatChestEquipment(ctx);
        ctx.drawCards(ctx.seat, 1);
      }
    },
  },
  "massacre|1": {
    triggers: [
      attackIntimidateTrigger({
        condition: (ctx) => ctx.getFlag("player", "discardedSixPlusThisTurn") === true,
        effect: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 2 }),
      }),
      {
        event: "card-discarded",
        sourceZone: "graveyard",
        label: "Intimidate",
        condition: (ctx, discarded) =>
          discarded?.instanceId === ctx.self.instanceId &&
          ctx.getFlag("player", "discardingForBruteAttackCost") === true,
        effect: (ctx) => ctx.intimidate(),
      },
    ],
  },
  "show no mercy|1": {
    triggers: [attackIntimidateTrigger({ hero: true })],
    modifyAttack(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.player(opponentSeat(ctx)).hand.length === 0 ? 3 : 0;
    },
  },
  "smell fear|2": smellFear(3),
  "smell fear|3": smellFear(2),
  "torc of vim|0": {
    ...beatChestEquipment("Torc of Vim — destroy for a discount", (ctx) =>
      ctx.requestChoice(
        "torc-vim",
        yesNoPrompt("Destroy Torc of Vim for a {r}{r} discount?", "card.arr.torcofvim.destroy"),
        ["yes", "no"],
      ),
    ),
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
    ...beatChestEquipment("Trampling Trackers — destroy to create Agility", (ctx) =>
      ctx.requestChoice(
        "trampling-trackers",
        yesNoPrompt("Destroy Trampling Trackers to create Agility?", "card.arr.trackers.destroy.agility"),
        ["yes", "no"],
      ),
    ),
    onChoose(ctx, hook, option) {
      if (hook === "trampling-trackers" && option === "yes") {
        destroyBeatChestEquipment(ctx);
        ctx.createToken(AGILITY);
      }
    },
  },
};
