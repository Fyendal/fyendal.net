import type { CardScript, ScriptCtx } from "@fyendal/engine";
import {
  decisionMessage,
  decisionPrompt,
  localizedCardLog,
  opponentSeat,
} from "./shared-helpers.js";

// SDA — Silver Age Chapter 1 Dash precon.
// Boost is engine-native: the play intent carries the optional cost and fires
// onBoosted/onBanishedForBoost after banishing the deck top.
// Dash's setup ability pauses game creation on a card-backed choice. Crank is
// engine-native: as an item enters, its controller may remove steam for 1 AP.

function isHyperDriver(ctx: ScriptCtx, card: { readonly cardId: string }): boolean {
  return ctx.cardData(card.cardId).name === "Hyper Driver";
}

function firstHyperDriver(ctx: ScriptCtx) {
  return ctx.player(ctx.seat).board.find((c) => isHyperDriver(ctx, c));
}

function addHyperSteam(ctx: ScriptCtx): void {
  const driver = firstHyperDriver(ctx);
  if (!driver) return;
  const steam = driver.counters?.steam ?? 0;
  ctx.addCounter(driver.instanceId, "steam", 1);
  ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: Hyper Driver gains a steam counter (${steam} → ${steam + 1})`, "card.log.sda.hyperdriver.counter", { from: steam, to: steam + 1 }));
}

function controlsHyperDriver(ctx: ScriptCtx): boolean {
  return firstHyperDriver(ctx) !== undefined;
}

function boostedLinks(ctx: ScriptCtx): number {
  return ctx.state.chain.filter((l) => l.attacker === ctx.seat && l.flags.boosted === true).length;
}

const hyperCounterFromBanish: CardScript = {
  onBanishedForBoost(ctx) {
    addHyperSteam(ctx);
  },
};

const jumpStart: CardScript = {
  modifyPlayCost: (ctx, base) => Math.max(0, base - (controlsHyperDriver(ctx) ? 1 : 0)),
};

export const sda: Record<string, CardScript> = {
  "dash|0": {
    onGameStart(ctx) {
      const p = ctx.player(ctx.seat);
      const candidates = p.deck.filter((card) => {
        const data = ctx.cardData(card.cardId);
        return (
          ctx.cardTypes(card).includes("mechanologist") &&
          ctx.cardTypes(card).includes("item") &&
          (data.cost ?? 0) <= 2
        );
      });
      if (candidates.length === 0) return;
      ctx.requestCardChoice(
        "dash-start-item",
        decisionPrompt(
          "Dash: start with a Mechanologist item with cost 2 or less in the arena?",
          "card.sda.dash.item.start",
          {
            optionMessages: {
              none: decisionMessage("common.option.none"),
            },
          },
        ),
        ["none", ...candidates.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "dash-start-item" || option === "none") return;
      const item = ctx.player(ctx.seat).deck.find((card) => card.instanceId === Number(option));
      if (!item) return;
      ctx.settleCard(item.instanceId, { allowCrank: false });
      ctx.shuffleDeck();
      ctx.logPublic(localizedCardLog(
        ctx,
        `Dash starts the game with ${ctx.cardData(item.cardId).name} in the arena`,
        "card.log.sda.dash.item.start",
        { result: { kind: "card", cardId: item.cardId } },
        { kind: "card-moved", cardId: item.cardId, ownerSeat: ctx.seat, from: "deck", to: "board" },
      ));
    },
  },

  "plasma barrel shot|0": {
    activated: [
      {
        cost: 0,
        isAttack: true,
        goAgain: false,
        oncePerTurn: true,
        label: "Remove a steam counter: Attack",
        canActivate: (ctx) => ctx.getCounter("steam") > 0,
      },
      {
        cost: 2,
        isAttack: false,
        goAgain: true,
        label: "Load a steam counter",
        canActivate: (ctx) => ctx.getCounter("steam") === 0,
        onActivate(ctx) {
          ctx.setCounter("steam", 1);
          ctx.logPublic(localizedCardLog(ctx, "Plasma Barrel Shot gets a steam counter", "card.log.sda.steam.counter", { amount: 1 }));
        },
      },
    ],
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      ctx.setCounter("steam", Math.max(0, ctx.getCounter("steam") - 1));
    },
    modifyAttack(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return 0;
      return 1 + boostedLinks(ctx);
    },
  },

  "talishar, the lost prince|0": {
    activated: { cost: 2, isAttack: true, goAgain: false, oncePerTurn: true },
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      ctx.setCounter("rust", ctx.getCounter("rust") + 1);
    },
    triggers: [
      {
        event: "end-of-turn",
        whose: "subject",
        label: "Destroy Talishar with 3 rust counters",
        condition: (ctx) => ctx.getCounter("rust") >= 3,
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },

  "achilles accelerator|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: gain 1 action point",
      canActivate: (ctx) => ctx.getFlag("player", "boostedThisTurn") === true,
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.gainActionPoint();
      },
    },
  },

  "crankshaft|1": hyperCounterFromBanish,
  "crankshaft|3": hyperCounterFromBanish,
  "big bertha|3": hyperCounterFromBanish,

  "fender bender|1": {
    modifyAttack: (ctx) => ctx.link?.defendingEquipment.length ?? 0,
  },
  "jump start|1": jumpStart,
  "jump start|2": jumpStart,
  "jump start|3": jumpStart,
  "rev up|1": jumpStart,
  "out pace|1": { cannotBeDefendedByEquipment: true },
  "overblast|1": { modifyAttack: boostedLinks },
  "under loop|1": {
    onHit(ctx) {
      ctx.setFlag("link", "attackToBottom", true);
    },
  },

  "re-charge!|1": {
    onPlay(ctx) {
      addHyperSteam(ctx);
      ctx.addModifier({ scope: "until-end-of-turn", onBoostAttack: 4 });
      ctx.logPublic(localizedCardLog(ctx, "Re-Charge!: your next boosted attack this turn gets +4{p}", "card.log.sda.recharge.attack", { amount: 4 }));
    },
  },

  "boom grenade|1": {
    onEnterArena(ctx) {
      ctx.setCounter("steam", 1);
    },
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Remove a steam counter or destroy Boom Grenade",
        effect(ctx) {
          const steam = ctx.getCounter("steam");
          if (steam > 0) ctx.setCounter("steam", steam - 1);
          else ctx.destroySelf();
        },
      },
    ],
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.link?.attackCardType === "action" &&
        ctx.cardTypes(ctx.link.attackingCard).includes("mechanologist");
    },
    onHit(ctx) {
      ctx.destroySelf();
      ctx.dealDamage(opponentSeat(ctx), 4);
    },
  },

  "hyper driver|1": {
    destroyAtZeroCounter: "steam",
    onEnterArena(ctx) {
      ctx.setCounter("steam", 3);
    },
    onBoosted(ctx) {
      const used = `hyperDriverBoost:${ctx.self.instanceId}`;
      const steam = ctx.getCounter("steam");
      if (ctx.getFlag("player", used) === true || steam <= 0) return;
      ctx.setFlag("player", used, true);
      ctx.setCounter("steam", steam - 1);
      ctx.changeResources(ctx.seat, 1);
      ctx.logPublic(localizedCardLog(ctx, `Hyper Driver: remove a steam counter (${steam} → ${steam - 1}) and gain {r}`, "card.log.sda.hyperdriver.spent", { from: steam, to: steam - 1, amount: 1 }));
    },
  },

  "teklo trebuchet 2000|3": {
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      ctx.addModifier({ scope: "combat-chain", onBoostAttack: 2 });
      ctx.logPublic(localizedCardLog(ctx, "Teklo Trebuchet 2000: your next boosted attack this combat chain gets +2{p}", "card.log.sda.trebuchet.attack", { amount: 2 }));
    },
  },
};
