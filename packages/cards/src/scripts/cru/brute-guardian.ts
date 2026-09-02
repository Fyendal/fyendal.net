import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { localizedCardLog } from "../shared-helpers.js";

function opponentSeat(ctx: ScriptCtx): number {
  return ctx.seat === 0 ? 1 : 0;
}

function discardRandomCost(ctx: ScriptCtx): void {
  ctx.discardRandom(ctx.seat, 1);
}

function barragingBigHorn(): CardScript {
  const grantConditionalGoAgain = (ctx: ScriptCtx): void => {
    if ((ctx.link?.defendingCards.length ?? 0) < 2) ctx.grantGoAgain();
  };
  return {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost: discardRandomCost,
    onHit: grantConditionalGoAgain,
    onMiss: grantConditionalGoAgain,
  };
}

function predatoryAssault(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "discardedSixPlusThisTurn") !== true) return;
      ctx.addModifier({ scope: "chain-link", dominate: true });
    },
  };
}

function riledUp(): CardScript {
  return {
    modifyAttack(ctx) {
      return ctx.getFlag("player", "discardedSixPlusThisTurn") === true ? 1 : 0;
    },
  };
}

function delayedGuardianAura(attack: number, dominate = false): CardScript {
  return {
    triggers: [
      {
        event: "begin-action-phase",
        label: "Destroy and empower the next Guardian attack action",
        effect(ctx) {
          ctx.destroySelf();
          ctx.addModifier({
            scope: "next-attack",
            attack,
            ...(dominate ? { dominate: true } : {}),
            appliesTo: "attack-action",
            appliesToClass: "guardian",
          });
          ctx.logPublic(localizedCardLog(
            ctx,
            `${ctx.data.name}: next Guardian attack action gets +${attack}{p}${dominate ? " and dominate" : ""}`,
            dominate ? "card.log.cru.riled.attack.dominate" : "card.log.cru.riled.attack",
            { amount: attack },
          ));
        },
      },
    ],
  };
}

function crushTriggered(ctx: ScriptCtx): boolean {
  return (
    !!ctx.link &&
    ctx.link?.targetAllyId === undefined &&
    ctx.link.hit === true &&
    (ctx.link.damage ?? 0) >= 4
  );
}

function crushTheWeak(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const opponent = ctx.state.players[opponentSeat(ctx)]!;
      ctx.setCardCounter(
        opponent.hero.instanceId,
        "attackActionBasePowerLimitUntilTurn",
        ctx.state.turn + 1,
      );
      ctx.setCardCounter(opponent.hero.instanceId, "attackActionBasePowerLimit", 3);
      ctx.logPublic(localizedCardLog(ctx, "Crush the Weak: the opponent can't play attack actions with 3 or less base {p} next action phase", "card.log.sbr.crushtheweak.restricted", { amount: 3 }));
    },
  };
}

function chokeslam(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const opponent = ctx.state.players[opponentSeat(ctx)]!;
      ctx.setCardCounter(
        opponent.hero.instanceId,
        "attackActionNoPowerGainUntilTurn",
        ctx.state.turn + 1,
      );
      ctx.logPublic(localizedCardLog(ctx, "Chokeslam: opposing attack action cards can't gain {p} during their next action phase", "card.log.sbr.chokeslam.suppressed"));
    },
  };
}

function blessingOfSerenity(prevention: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.preventNextPhysicalDamage(ctx.seat, prevention);
    },
  };
}

export const cruBruteGuardian: Record<string, CardScript> = {
  "rhinar, reckless rampage|0": {
    triggers: [{
      event: "card-discarded",
      label: "Intimidate",
      publicLog: "Rhinar's ability triggers",
      publicLogMessage: { id: "card.log.common.heroability.triggered" },
      condition: (ctx, discarded) =>
        ctx.state.activePlayer === ctx.seat &&
        ctx.state.phase !== "start" &&
        ctx.state.phase !== "end" &&
        ctx.state.phase !== "game-over" &&
        discarded !== undefined &&
        ctx.basePower(discarded) >= 6,
      effect: (ctx) => ctx.intimidate(),
    }],
  },

  "kayo, berserker runt|0": {
    triggers: [{
      event: "card-played",
      label: "Roll a die for the attack's base power",
      condition: (ctx, played) => !!played &&
        ctx.hasCardType(played, "action") &&
        ctx.cardTypes(played).includes("attack") &&
        (ctx.cardData(played.cardId).attack ?? 0) >= 6,
      effect(ctx, played) {
      if (!played) return;
      ctx.setCounter("kayoRolledAttack", played.instanceId);
      ctx.requestDieRoll("kayo-power", 6);
      },
    }],
    onDieRollResolved(ctx, hook, roll) {
      if (hook !== "kayo-power") return;
      const playedId = ctx.getCounter("kayoRolledAttack");
      const played = [
        ...ctx.state.chain.map((link) => link.attackingCard),
        ...ctx.state.stack.flatMap((layer) => layer.card ? [layer.card] : []),
        ...ctx.state.resolving,
      ].find((card) => card.instanceId === playedId);
      if (!played) return;
      const data = ctx.cardData(played.cardId);
      ctx.setCardCounter(played.instanceId, "halveBasePowerRoundDown", 0);
      ctx.setCardCounter(played.instanceId, "doubleBasePower", 0);
      if (roll <= 4) {
        ctx.setCardCounter(played.instanceId, "halveBasePowerRoundDown", 1);
      } else {
        ctx.setCardCounter(played.instanceId, "doubleBasePower", 1);
      }
      ctx.logPublic(localizedCardLog(
        ctx,
        `${ctx.data.name}: rolled ${roll}; ${data.name}'s base {p} is ${roll <= 4 ? "halved" : "doubled"}`,
        roll <= 4 ? "card.log.cru.knucklehead.halved" : "card.log.cru.knucklehead.doubled",
        { result: roll, target: { kind: "card", cardId: played.cardId } },
        { kind: "roll", result: roll, seat: ctx.seat, sides: 6 },
      ));
    },
  },

  "romping club|0": {
    activated: {
      cost: 2,
      isAttack: true,
      goAgain: false,
      oncePerTurn: true,
      label: "Attack",
    },
    triggers: [{
      event: "card-discarded",
      label: "Get +1 power this turn",
      condition(ctx, discarded) {
        const flag = `rompingClubTriggered:${ctx.self.instanceId}`;
        return discarded !== undefined &&
          ctx.basePower(discarded) >= 6 &&
          ctx.getFlag("player", flag) !== true;
      },
      onTrigger(ctx) {
        ctx.setFlag("player", `rompingClubTriggered:${ctx.self.instanceId}`, true);
      },
      effect(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          attack: 1,
          appliesTo: "weapon",
          appliesToName: "romping club",
        });
      },
    }],
  },

  "barraging big horn|1": barragingBigHorn(),
  "barraging big horn|2": barragingBigHorn(),
  "barraging big horn|3": barragingBigHorn(),

  "predatory assault|1": predatoryAssault(),
  "predatory assault|2": predatoryAssault(),
  "predatory assault|3": predatoryAssault(),

  "riled up|1": riledUp(),
  "riled up|2": riledUp(),
  "riled up|3": riledUp(),

  "swing fist, think later|1": { requiredHandCardsForAdditionalCost: 1, additionalCost: discardRandomCost },
  "swing fist, think later|2": { requiredHandCardsForAdditionalCost: 1, additionalCost: discardRandomCost },
  "swing fist, think later|3": { requiredHandCardsForAdditionalCost: 1, additionalCost: discardRandomCost },

  "bravo, showstopper|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      label: "Cost 3+ attack actions gain dominate",
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          dominate: true,
          appliesTo: "attack-action",
          minCost: 3,
        });
        ctx.logPublic(localizedCardLog(ctx, "Bravo: attack action cards with cost 3 or more gain dominate this turn", "card.log.wtr.bravo.dominate"));
      },
    },
  },

  "anothos|0": {
    activated: {
      cost: 3,
      isAttack: true,
      goAgain: false,
      oncePerTurn: true,
      label: "Attack",
    },
    modifyAttack(ctx) {
      const expensivePitch = ctx.state.players[ctx.seat]!.pitch.filter(
        (card) => (ctx.cardData(card.cardId).cost ?? 0) >= 3,
      );
      return expensivePitch.length >= 2 ? 2 : 0;
    },
  },

  "towering titan|1": delayedGuardianAura(10),
  "towering titan|2": delayedGuardianAura(9),
  "towering titan|3": delayedGuardianAura(8),

  "crush the weak|1": crushTheWeak(),
  "crush the weak|2": crushTheWeak(),

  "chokeslam|2": chokeslam(),

  "emerging dominance|1": delayedGuardianAura(3, true),
  "emerging dominance|2": delayedGuardianAura(2, true),
  "emerging dominance|3": delayedGuardianAura(1, true),

  "blessing of serenity|1": blessingOfSerenity(3),
  "blessing of serenity|2": blessingOfSerenity(2),
  "blessing of serenity|3": blessingOfSerenity(1),
};
