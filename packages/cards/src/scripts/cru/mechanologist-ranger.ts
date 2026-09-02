import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  buffNextAttack,
  commonOptionMessages,
  decisionPrompt,
  opponentSeat,
  optN,
  optOnChoose,
} from "../shared-helpers.js";

function isMechanologistItem(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance>,
  maxCost: number,
): boolean {
  const data = ctx.cardData(card.cardId);
  return (
    ctx.cardTypes(card).includes("mechanologist") &&
    ctx.cardTypes(card).includes("item") &&
    (data.cost ?? 0) <= maxCost
  );
}

function dashSetup(): CardScript {
  return {
    onGameStart(ctx) {
      const candidates = ctx.state.players[ctx.seat]!.deck.filter((card) =>
        isMechanologistItem(ctx, card, 2),
      );
      if (candidates.length === 0) return;
      ctx.requestCardChoice(
        "dash-start-item",
        decisionPrompt(
          `${ctx.data.name}: start with a Mechanologist item with cost 2 or less in the arena?`,
          "card.cru.dash.item.start",
          {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
            optionMessages: commonOptionMessages("none"),
          },
        ),
        ["none", ...candidates.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "dash-start-item" || option === "none") return;
      const instanceId = Number(option);
      const card = ctx.state.players[ctx.seat]!.deck.find(
        (candidate) => candidate.instanceId === instanceId,
      );
      if (!card || !isMechanologistItem(ctx, card, 2)) return;
      if (ctx.settleCard(instanceId)) ctx.shuffleDeck(ctx.seat);
    },
  };
}

function dataDoll(): CardScript {
  return {
    onCardBanished(ctx, card, from) {
      if (from !== "deck" || !isMechanologistItem(ctx, card, 2)) return;
      ctx.settleCard(card.instanceId);
    },
  };
}

function tekloPlasmaPistol(): CardScript {
  return {
    activated: [
      {
        cost: 0,
        isAttack: true,
        goAgain: false,
        label: "Remove a steam counter: Attack",
        canActivate: (ctx) => ctx.getCounter("steam") > 0,
      },
      {
        cost: 1,
        isAttack: false,
        goAgain: true,
        label: "Load a steam counter",
        canActivate: (ctx) => ctx.getCounter("steam") === 0,
        onActivate(ctx) {
          ctx.setCounter("steam", 1);
        },
      },
    ],
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      ctx.setCounter("steam", Math.max(0, ctx.getCounter("steam") - 1));
    },
  };
}

function highSpeedImpact(): CardScript {
  return {
    onHit(ctx) {
      ctx.addModifier({
        scope: "combat-chain",
        onBoostDominate: true,
        expiresOnChainClose: true,
      });
    },
  };
}

function combustibleCourier(): CardScript {
  return {
    onHit(ctx) {
      ctx.addModifier({
        scope: "combat-chain",
        onBoostAttack: 3,
        expiresOnChainClose: true,
      });
    },
  };
}

function boostedLinks(ctx: ScriptCtx): number {
  return ctx.state.chain.filter(
    (link) => link.attacker === ctx.seat && link.flags.boosted === true,
  ).length;
}

function finishWorkshop(ctx: ScriptCtx, maxCost: number): void {
  const top = ctx.state.players[ctx.seat]!.deck[0];
  if (!top) return;
  ctx.lookAt(top.instanceId);
  ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`);
  if (isMechanologistItem(ctx, top, maxCost)) ctx.settleCard(top.instanceId);
}

function teklovossensWorkshop(maxCost: number): CardScript {
  return {
    onPlay(ctx) {
      const count = Number(ctx.getFlag("player", "boostCountThisTurn")) || 0;
      if (count === 0) finishWorkshop(ctx, maxCost);
      else optN(ctx, count);
    },
    onChoose(ctx, hook, option) {
      const opt = /^opt:\d+:([\d,]+)$/.exec(hook);
      if (!opt) return;
      const finalChoice = !opt[1]!.includes(",");
      optOnChoose(ctx, hook, option);
      if (finalChoice) finishWorkshop(ctx, maxCost);
    },
  };
}

function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("arrow");
}

function requestArrow(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  id: string,
): void {
  const player = ctx.state.players[ctx.seat]!;
  if (player.arsenal.length > 0) return;
  const arrows = player.hand.filter((card) => isArrow(ctx, card));
  if (arrows.length === 0) return;
  ctx.requestCardChoice(
    hook,
    decisionPrompt(fallback, id),
    arrows.map((card) => card.instanceId),
  );
}

function redLiner(): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Put an arrow from hand into arsenal",
      canActivate: (ctx) => {
        const player = ctx.state.players[ctx.seat]!;
        return player.arsenal.length === 0 && player.hand.some((card) => isArrow(ctx, card));
      },
      onActivate(ctx) {
        requestArrow(
          ctx,
          "red-liner-arrow",
          "Red Liner: put an arrow face up into your arsenal",
          "card.cru.redliner.arrow.load",
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "red-liner-arrow") return;
      const card = ctx.state.players[ctx.seat]!.hand.find(
        (candidate) => candidate.instanceId === Number(option),
      );
      if (card && isArrow(ctx, card)) ctx.putIntoArsenal(card.instanceId, "hand");
    },
  };
}

function azaleaAce(): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Cycle arsenal; arrows gain dominate",
      canActivate: (ctx) => ctx.state.players[ctx.seat]!.arsenal.length > 0,
      onActivate(ctx) {
        const arsenal = ctx.state.players[ctx.seat]!.arsenal[0];
        if (!arsenal || !ctx.putOnDeckBottom(arsenal.instanceId)) return;
        const top = ctx.state.players[ctx.seat]!.deck[0];
        if (!top || !ctx.putIntoArsenal(top.instanceId, "deck")) return;
        if (isArrow(ctx, top)) ctx.grantCardKeyword(top.instanceId, "dominate");
      },
    },
  };
}

function trapOnlyFromArsenal(extra: CardScript): CardScript {
  return {
    canPlay: (ctx) =>
      ctx.fromArsenal === true ||
      ctx.state.players[ctx.seat]!.arsenal.some(
        (card) => card.instanceId === ctx.self.instanceId,
      ),
    ...extra,
  };
}

function pitfallTrap(): CardScript {
  return trapOnlyFromArsenal({
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      ctx.notifyTrapTriggered();
      if (!ctx.requestPayment(
        "pitfall-pay",
        decisionPrompt(
          "Pitfall Trap: pay {r} or take 2 damage?",
          "card.cru.pitfall.pay",
          { optionMessages: commonOptionMessages("no") },
        ),
        1,
        attacker,
      )) {
        ctx.dealDamage(attacker, 2);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "pitfall-pay" && option !== "paid" && ctx.link) {
        ctx.dealDamage(ctx.link.attacker, 2);
      }
    },
  });
}

function rockslideTrap(): CardScript {
  return trapOnlyFromArsenal({
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      ctx.notifyTrapTriggered();
      if (!ctx.requestPayment(
        "rockslide-pay",
        decisionPrompt(
          "Rockslide Trap: pay {r} or the attack gets -2{p}?",
          "card.cru.rockslide.pay",
          { optionMessages: commonOptionMessages("no") },
        ),
        1,
        attacker,
      )) {
        ctx.addModifier({ scope: "chain-link", attack: -2, seat: attacker });
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "rockslide-pay" && option !== "paid" && ctx.link) {
        ctx.addModifier({ scope: "chain-link", attack: -2, seat: ctx.link.attacker });
      }
    },
  });
}

function tripwireTrap(): CardScript {
  return trapOnlyFromArsenal({
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      ctx.notifyTrapTriggered();
      if (!ctx.requestPayment(
        "tripwire-pay",
        decisionPrompt(
          "Tripwire Trap: pay {r} to keep hit effects?",
          "card.cru.tripwire.pay",
          { optionMessages: commonOptionMessages("no") },
        ),
        1,
        attacker,
      )) {
        ctx.setFlag("link", "suppressHitEffects", true);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "tripwire-pay" && option !== "paid") {
        ctx.setFlag("link", "suppressHitEffects", true);
      }
    },
  });
}

function pathingHelix(): CardScript {
  return {
    onHit(ctx) {
      const player = ctx.state.players[ctx.seat]!;
      if (player.arsenal.length > 0 || player.hand.length === 0) return;
      ctx.requestCardChoice(
        "pathing-reload",
        decisionPrompt(
          `${ctx.data.name}: put a card from hand face down into arsenal?`,
          "card.cru.pathing.arsenal.put",
          {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
            optionMessages: commonOptionMessages("pass"),
          },
        ),
        ["pass", ...player.hand.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pathing-reload" || option === "pass") return;
      ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
    },
  };
}

function sleepDart(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      ctx.suppressHeroAbilitiesThroughNextTurn(opponentSeat(ctx));
      ctx.logPublic(
        `${ctx.data.name}: ${ctx.cardData(ctx.state.players[opponentSeat(ctx)]!.heroCardId).name} loses hero abilities until the end of their next turn`,
      );
    },
  };
}

function increaseTheTension(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesToSubtype: "arrow",
        noDefenseReactionsFromHand: true,
      });
    },
  };
}

export const cruMechanologistRanger: Record<string, CardScript> = {
  "dash, inventor extraordinaire|0": dashSetup(),
  "data doll mkii|0": dataDoll(),
  "teklo plasma pistol|0": tekloPlasmaPistol(),
  "high speed impact|1": highSpeedImpact(),
  "high speed impact|2": highSpeedImpact(),
  "high speed impact|3": highSpeedImpact(),
  "combustible courier|1": combustibleCourier(),
  "combustible courier|2": combustibleCourier(),
  "combustible courier|3": combustibleCourier(),
  "overblast|2": { modifyAttack: boostedLinks },
  "overblast|3": { modifyAttack: boostedLinks },
  "teklovossen's workshop|1": teklovossensWorkshop(2),
  "teklovossen's workshop|2": teklovossensWorkshop(1),
  "teklovossen's workshop|3": teklovossensWorkshop(0),

  "azalea, ace in the hole|0": azaleaAce(),
  "red liner|0": redLiner(),
  "tripwire trap|1": tripwireTrap(),
  "pitfall trap|2": pitfallTrap(),
  "rockslide trap|3": rockslideTrap(),
  "pathing helix|1": pathingHelix(),
  "pathing helix|2": pathingHelix(),
  "pathing helix|3": pathingHelix(),
  "sleep dart|1": sleepDart(),
  "sleep dart|2": sleepDart(),
  "sleep dart|3": sleepDart(),
  "increase the tension|1": increaseTheTension(3),
  "increase the tension|2": increaseTheTension(2),
  "increase the tension|3": increaseTheTension(1),
};
