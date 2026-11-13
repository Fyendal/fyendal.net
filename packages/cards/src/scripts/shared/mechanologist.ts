import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { cardNamed, hasCardSubtype, isItem } from "./cards.js";
import { commonOptionMessages, decisionMessage, decisionPrompt, localizedCardLog } from "./messages.js";

type Card = DeepReadonly<CardInstance>;

const HYPER_DRIVER_STEAM_FROM_BOOST_HOOK = "common-hyper-driver-steam-from-boost";

/** "When this is banished by boost, put a steam counter on a Hyper Driver"; asks only when several exist. */
export function hyperDriverCounterFromBoostBanish(): CardScript {
  const hyperDrivers = (ctx: ScriptCtx) =>
    ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Hyper Driver"));
  const addCounter = (ctx: ScriptCtx, instanceId: number) => {
    const driver = hyperDrivers(ctx).find((card) => card.instanceId === instanceId);
    if (!driver) return;
    const steam = driver.counters?.steam ?? 0;
    ctx.addCounter(driver.instanceId, "steam", 1);
    ctx.logPublic(
      localizedCardLog(
        ctx,
        `${ctx.data.name}: Hyper Driver gains a steam counter (${steam} → ${steam + 1})`,
        "card.log.common.hyperdriver.counter",
        { from: steam, to: steam + 1 },
      ),
    );
  };

  return {
    onBanishedForBoost(ctx) {
      const drivers = hyperDrivers(ctx);
      if (drivers.length === 1) {
        addCounter(ctx, drivers[0]!.instanceId);
      } else if (drivers.length > 1) {
        ctx.requestCardChoice(
          HYPER_DRIVER_STEAM_FROM_BOOST_HOOK,
          decisionPrompt("Put a steam counter on a Hyper Driver", "card.common.hyperdriver.steam.add"),
          drivers.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === HYPER_DRIVER_STEAM_FROM_BOOST_HOOK) addCounter(ctx, Number(option));
    },
  };
}

export function isMechanologistItemAtMost(ctx: ScriptCtx, card: Card, maxCost: number): boolean {
  return (
    hasCardSubtype(ctx, card, "mechanologist") && isItem(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) <= maxCost
  );
}

/** Resolve with `resolveCrankSteam`; optional prompts offer "no". */
export function requestCrankSteam(ctx: ScriptCtx, hook: string, optional = false): void {
  const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card) && ctx.hasCrank(card));
  if (!items.length) return;
  ctx.requestCardChoice(
    hook,
    decisionPrompt(
      "Put a steam counter on an item with crank",
      "card.common.crankitem.steam",
      optional ? { optionMessages: commonOptionMessages("no") } : {},
    ),
    [...(optional ? ["no"] : []), ...items.map((card) => card.instanceId)],
  );
}

export function resolveCrankSteam(ctx: ScriptCtx, option: string): void {
  const id = Number(option);
  if (ctx.player(ctx.seat).board.some((card) => card.instanceId === id)) ctx.addCounter(id, "steam", 1);
}

export function hyperDrivers(ctx: ScriptCtx): readonly Card[] {
  return ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Hyper Driver"));
}

export function hyperDriver(steam: number): CardScript {
  return {
    destroyAtZeroCounter: "steam",
    onEnterArena(ctx) {
      if (steam > 0) ctx.setCounter("steam", steam);
    },
    triggers: [
      {
        event: "card-boosted",
        label: "Remove a steam counter and gain 1 resource",
        labelMessage: decisionMessage("card.trigger.common.hyperdriver.boost"),
        condition(ctx) {
          return (
            ctx.getFlag("player", `hyperDriverBoost:${ctx.self.instanceId}`) !== true && ctx.getCounter("steam") > 0
          );
        },
        onTrigger(ctx) {
          ctx.setFlag("player", `hyperDriverBoost:${ctx.self.instanceId}`, true);
        },
        effect(ctx) {
          const steam = ctx.getCounter("steam");
          if (steam <= 0) return;
          ctx.setCounter("steam", steam - 1);
          ctx.gainResources(ctx.seat, 1);
        },
      },
    ],
  };
}

/** Evo equipment: played from hand onto a Base, as an instant while a "next Evo" effect is live. */
export function evoEquipment(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    playableEquipment: true,
    transformsEquipment: (ctx, equipped) => hasCardSubtype(ctx, equipped, "base"),
    playAsInstant(ctx) {
      return ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true || (extra.playAsInstant?.(ctx) ?? false);
    },
  };
}

export function equippedEvos(ctx: ScriptCtx): number {
  return ctx.countEquipped("evo");
}

const MAINTENANCE_OPTIONS = ["remove", "destroy"] as const;

const MAINTENANCE_OPTION_MESSAGES = commonOptionMessages(...MAINTENANCE_OPTIONS);

const LEGACY_MAINTENANCE_HOOKS = new Set(["evo-maintenance", "aio-maintenance"]);

/** `hook` stays per-card where saved standing orders are keyed by an older hook. */
export function maintenanceItem(steam: number, extra: CardScript = {}, hook = "maintenance"): CardScript {
  return {
    ...extra,
    onEnterArena(ctx) {
      ctx.setCounter("steam", steam);
      extra.onEnterArena?.(ctx);
    },
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Remove a steam counter or destroy this",
        labelMessage: decisionMessage("card.trigger.common.steam.maintain"),
        standingChoice: { hook, options: MAINTENANCE_OPTIONS, optionMessages: MAINTENANCE_OPTION_MESSAGES },
        effect(ctx) {
          if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
          else
            ctx.requestChoice(
              hook,
              decisionPrompt("Remove a steam counter or destroy this?", "card.common.maintenance.choose", {
                optionMessages: MAINTENANCE_OPTION_MESSAGES,
              }),
              [...MAINTENANCE_OPTIONS],
            );
        },
      },
      ...(extra.triggers ?? []),
    ],
    onChoose(ctx, chosenHook, option) {
      // AIO/EVO used prefixed hooks; pending decisions in stored games may still carry them.
      if (chosenHook === hook || LEGACY_MAINTENANCE_HOOKS.has(chosenHook)) {
        if (option === "remove") ctx.setCounter("steam", Math.max(0, ctx.getCounter("steam") - 1));
        else ctx.destroySelf();
        return;
      }
      extra.onChoose?.(ctx, chosenHook, option);
    },
  };
}

/** Galvanize: when this defends, you may destroy an item you control for +2{d}. */
export function galvanize(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    onDefend(ctx) {
      const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card));
      if (items.length)
        ctx.requestCardChoice(
          "galvanize",
          decisionPrompt("Destroy an item for +2 defense?", "card.common.item.destroy.defense", {
            values: { amount: 2 },
            optionMessages: commonOptionMessages("none"),
          }),
          ["none", ...items.map((card) => card.instanceId)],
        );
      extra.onDefend?.(ctx);
    },
    onChoose(ctx, hook, option) {
      // EVO high-rarity used "evo-galvanize" with a "no" option; stored games may still carry it.
      const galvanizing = hook === "galvanize" || hook === "evo-galvanize";
      if (galvanizing && option !== "none" && option !== "no" && ctx.destroyPermanent(Number(option))) {
        ctx.addModifier({ scope: "chain-link", defense: 2 });
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}
