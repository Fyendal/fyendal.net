import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  buffNextAttack,
  commonOptionMessages,
  decisionPrompt,
  localizedCardLog,
  optN,
  optOnChoose,
} from "../shared-helpers.js";

function boostedThisTurn(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "boostedThisTurn") === true;
}

function mechanicItemAtMost(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, maxCost: number): boolean {
  const data = ctx.cardData(card.cardId);
  return (
    ctx.cardTypes(card).includes("mechanologist") &&
    ctx.cardTypes(card).includes("item") &&
    (data.cost ?? 0) <= maxCost
  );
}

function pourTheMold(maxCost: number): CardScript {
  return {
    onPlay(ctx) {
      const candidates = ctx.player(ctx.seat).hand.filter((card) =>
        mechanicItemAtMost(ctx, card, maxCost),
      );
      if (candidates.length === 0) return;
      ctx.requestCardChoice(
        "pour-item",
        decisionPrompt(`${ctx.data.name}: put a Mechanologist item with cost ${maxCost} or less into the arena`, "card.arc.mechanologist.item.put", { values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: maxCost } }),
        candidates.map((card) => card.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pour-item") return;
      const item = ctx.player(ctx.seat).hand.find((card) => card.instanceId === Number(option));
      if (!item || !mechanicItemAtMost(ctx, item, maxCost) || !ctx.settleCard(item.instanceId)) return;
      if (boostedThisTurn(ctx)) ctx.addCounter(item.instanceId, "steam", 1);
      ctx.logPublic(localizedCardLog(
        ctx,
        `${ctx.data.name}: ${ctx.cardData(item.cardId).name} is put into the arena`,
        "card.log.arc.item.arena",
        { result: { kind: "card", cardId: item.cardId } },
        { kind: "card-moved", cardId: item.cardId, ownerSeat: ctx.seat, from: "hand", to: "board" },
      ));
    },
  };
}

const overLoop: CardScript = {
  onHit(ctx) {
    ctx.setFlag("link", "attackToBottom", true);
  },
};

function lockedAndLoaded(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        appliesToClass: "mechanologist",
      });
      if (boostedThisTurn(ctx)) optN(ctx, 1);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

export const arcMechanologist: Record<string, CardScript> = {
  "pedal to the metal|1": {
    onHit: (ctx) => buffNextAttack(ctx, { dominate: true }),
  },
  "pedal to the metal|2": {
    onHit: (ctx) => buffNextAttack(ctx, { dominate: true }),
  },
  "pedal to the metal|3": {
    onHit: (ctx) => buffNextAttack(ctx, { dominate: true }),
  },

  "pour the mold|1": pourTheMold(2),
  "pour the mold|2": pourTheMold(1),
  "pour the mold|3": pourTheMold(0),

  "aether sink|2": {
    onEnterArena(ctx) {
      ctx.setCounter("steam", 1);
    },
    activated: [
      {
        cost: 1,
        isAttack: false,
        goAgain: true,
        label: "Load a steam counter",
        onActivate(ctx) {
          if (ctx.getCounter("steam") === 0) ctx.setCounter("steam", 1);
        },
      },
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "instant",
        label: "Remove a steam counter: Arcane Barrier 2",
        removeCounterCost: { key: "steam", amount: 1 },
        onActivate(ctx) {
          ctx.grantCardKeyword(ctx.self.instanceId, "arcane barrier 2");
          ctx.logPublic(localizedCardLog(ctx, "Aether Sink gains Arcane Barrier 2 until end of turn", "card.log.arc.aethersink.barrier", { amount: 2 }));
        },
      },
    ],
  },

  "cognition nodes|3": {
    activated: [
      {
        cost: 1,
        isAttack: false,
        goAgain: true,
        label: "Load a steam counter",
        onActivate(ctx) {
          if (ctx.getCounter("steam") === 0) ctx.setCounter("steam", 1);
        },
      },
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        oncePerTurn: true,
        timing: "attack-reaction",
        label: "Remove a steam counter: put the attacking card on deck bottom when it hits",
        canActivate: (ctx) =>
          ctx.getCounter("steam") > 0 && ctx.link?.attackCardType === "action",
        onActivate(ctx) {
          ctx.setCounter("steam", ctx.getCounter("steam") - 1);
          ctx.setFlag("link", "attackToBottom", true);
        },
      },
    ],
  },

  "convection amplifier|1": {
    destroyAtZeroCounter: "steam",
    onEnterArena(ctx) {
      ctx.setCounter("steam", 2);
    },
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      label: "Remove a steam counter: next attack action gains dominate",
      canActivate: (ctx) => ctx.getCounter("steam") > 0,
      onActivate(ctx) {
        ctx.setCounter("steam", ctx.getCounter("steam") - 1);
        buffNextAttack(ctx, { appliesTo: "attack-action", dominate: true });
      },
    },
  },

  "over loop|1": overLoop,
  "over loop|2": overLoop,
  "over loop|3": overLoop,

  "locked and loaded|1": lockedAndLoaded(3),
  "locked and loaded|2": lockedAndLoaded(2),
  "locked and loaded|3": lockedAndLoaded(1),

  "dissipation shield|2": {
    onEnterArena(ctx) {
      ctx.setCounter("steam", 4);
    },
    triggers: [
      {
        event: "begin-action-phase",
        whose: "subject",
        label: "Remove a steam counter or destroy Dissipation Shield",
        effect(ctx) {
          if (ctx.getCounter("steam") <= 0) {
            ctx.destroySelf();
            return;
          }
          ctx.requestChoice(
            "dissipation-maintenance",
            decisionPrompt("Dissipation Shield: remove a steam counter or destroy it?", "card.arc.dissipation.maintain", { optionMessages: commonOptionMessages("remove", "destroy") }),
            ["remove", "destroy"],
          );
        },
      },
    ],
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      label: "Destroy: prevent damage equal to steam counters",
      onActivate(ctx) {
        const steam = ctx.getCounter("steam");
        if (steam > 0) ctx.preventNextDamage(ctx.seat, steam);
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "dissipation-maintenance") return;
      if (option === "remove" && ctx.getCounter("steam") > 0) {
        ctx.setCounter("steam", ctx.getCounter("steam") - 1);
      } else {
        ctx.destroySelf();
      }
    },
  },

  "optekal monocle|3": {
    destroyAtZeroCounter: "steam",
    onEnterArena(ctx) {
      ctx.setCounter("steam", 5);
    },
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      label: "Remove a steam counter: Opt 1",
      canActivate: (ctx) => ctx.getCounter("steam") > 0,
      onActivate(ctx) {
        ctx.setCounter("steam", ctx.getCounter("steam") - 1);
        optN(ctx, 1);
      },
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  },
};
