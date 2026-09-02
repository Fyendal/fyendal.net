import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  decisionPrompt,
  discardSixPlusPayoff,
  isSixPlus,
  opponentSeat,
  yesNoPrompt,
} from "./shared-helpers.js";

// ── SKA (Silver Age Chapter 1: Kayo precon) ────────────────────────────────

const AGILITY = "SKA034";
const MIGHT = "SKA035";
const VIGOR = "SKA036";

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
}

function isOnCombatChain(ctx: ScriptCtx, card: { readonly instanceId: number; readonly cardId: string }): boolean {
  return ctx.state.chain.some((link) =>
    [
      link.attackingCard,
      ...link.defendingCards,
      ...link.defendingEquipment,
      ...link.reactions,
    ].some((onChain) => onChain.instanceId === card.instanceId),
  );
}

function hasSixPlusInPitch(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card));
}

function conditionalPitchGoAgain(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (hasSixPlusInPitch(ctx)) ctx.grantGoAgain();
    },
  };
}

function clashForToken(tokenId: string): CardScript {
  return {
    onDefend(ctx) {
      ctx.requestClash(opponentSeat(ctx), "create-token");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "create-token" && winner >= 0) ctx.createToken(tokenId, winner);
    },
  };
}

function pulpingGoAgain(ctx: ScriptCtx): void {
  if ((ctx.link?.defendingCards.length ?? 0) < 2) ctx.grantGoAgain();
}

function strongestSurvive(): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      if (opponent.hand.length === 0) return;
      const damage = ctx.link?.damage ?? 0;
      const revealable = opponent.hand.filter((card) => {
        return ctx.basePower(card.instanceId) > damage;
      });
      const options = [
        ...revealable.map((card) => `reveal:${card.instanceId}`),
        ...opponent.hand.map((card) => `discard:${card.instanceId}`),
      ];
      const cardOptions = [
        ...revealable.map((card) => card.instanceId),
        ...opponent.hand.map((card) => card.instanceId),
      ];
      ctx.requestChoice(
        "strongest-survive",
        decisionPrompt(
          `${ctx.data.name}: reveal a card with power greater than ${damage}, or discard a card`,
          "card.ska.strongest.survive.choose",
          {
            values: {
              card: { kind: "card", cardId: ctx.self.cardId },
              damage,
            },
          },
        ),
        options,
        opponent.seat,
        cardOptions,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "strongest-survive") return;
      const [choice, rawId] = option.split(":");
      const id = Number(rawId);
      if (choice === "discard") {
        ctx.discardCard(opponentSeat(ctx), id);
      } else if (choice === "reveal") {
        const card = ctx.player(opponentSeat(ctx)).hand.find((candidate) => candidate.instanceId === id);
        if (card) ctx.logPublic(`${ctx.cardData(card.cardId).name} is revealed`);
      }
    },
  };
}

const bareFangs = discardSixPlusPayoff((ctx) => {
  ctx.addModifier({ scope: "chain-link", attack: 2 });
  ctx.logPublic("Bare Fangs gains +2 attack");
});

const wildRide = discardSixPlusPayoff((ctx) => {
  ctx.grantGoAgain();
  ctx.logPublic("Wild Ride gains go again");
});

export const ska: Record<string, CardScript> = {
  "kayo|0": {
    modifyBasePower(ctx, card, base) {
      if (card.owner !== ctx.seat || !isAttackAction(ctx, card) || isOnCombatChain(ctx, card)) {
        return base;
      }
      return base + 1;
    },
    triggers: [{
      event: "card-discarded",
      label: "Create a Might token",
      condition: (ctx, discarded) =>
        ctx.state.activePlayer === ctx.seat &&
        ctx.state.phase !== "start" &&
        ctx.state.phase !== "end" &&
        ctx.state.phase !== "game-over" &&
        ctx.getFlag("player", "kayoMightTriggered") !== true &&
        isSixPlus(ctx, discarded),
      onTrigger: (ctx) => ctx.setFlag("player", "kayoMightTriggered", true),
      effect: (ctx) => ctx.createToken(MIGHT),
    }],
  },

  "mandible claw|0": {
    activated: attackAbility(2),
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "discardedSixPlusThisTurn") === true) {
        ctx.grantGoAgain();
      }
    },
  },

  "knucklehead|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      oncePerTurn: false,
      onActivate(ctx) {
        ctx.requestDieRoll("knucklehead", 6);
      },
    },
    onDieRollResolved(ctx, hook, roll) {
      if (hook !== "knucklehead") return;
        ctx.setPlayerFlag(ctx.seat, "baseIntellectThisTurn", roll);
        ctx.logPublic(`Knucklehead rolls ${roll}; base intellect is ${roll} this turn`);
        ctx.destroySelf();
    },
  },

  "predatory plating|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      oncePerTurn: false,
      timing: "instant",
      canActivate(ctx) {
        const player = ctx.player(ctx.seat);
        const current = [...ctx.state.chain].reverse().find((link) => !link.resolved);
        const controlled = [
          player.hero,
          ...player.weapons,
          ...Object.values(player.equipment).filter((card) => card !== undefined),
          ...player.board,
          ...(current?.attacker === ctx.seat ? [current.attackingCard] : []),
        ];
        return controlled.some((card) => isSixPlus(ctx, card));
      },
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.changeResources(ctx.seat, 1);
        ctx.logPublic("Predatory Plating gains {r}");
      },
    },
  },

  "beaten trackers|0": {
    triggers: [{
      event: "card-discarded",
      label: "Destroy this to gain 1 action point?",
      condition: (ctx, discarded, eventContext) =>
        eventContext?.atRandom === true && isSixPlus(ctx, discarded),
      effect: (ctx) => ctx.requestChoice(
        "beaten-trackers",
        yesNoPrompt(
          "Destroy Beaten Trackers to gain 1 action point?",
          "card.ska.beaten.trackers.destroy",
        ),
        ["yes", "no"],
      ),
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "beaten-trackers" || option !== "yes") return;
      ctx.destroySelf();
      ctx.gainActionPoint();
    },
  },

  "bare fangs|2": bareFangs,
  "wild ride|2": wildRide,
  "buckwild|1": conditionalPitchGoAgain(),
  "buckwild|3": conditionalPitchGoAgain(),
  "clash of agility|1": clashForToken(AGILITY),
  "clash of might|1": clashForToken(MIGHT),
  "clash of might|2": clashForToken(MIGHT),

  "high pitched howl|1": {
    onAttackDeclared(ctx) {
      if (hasSixPlusInPitch(ctx)) ctx.createToken(VIGOR);
    },
  },

  "pulping|1": {
    onAttackDeclared(ctx) {
      const discarded = (() => {
        ctx.drawCards(ctx.seat, 1);
        return ctx.discardRandom(ctx.seat, 1)[0];
      })();
      if (isSixPlus(ctx, discarded)) {
        ctx.addModifier({ scope: "chain-link", dominate: true });
      }
    },
    onHit: pulpingGoAgain,
    onMiss: pulpingGoAgain,
  },

  "rough up|1": {
    modifyAttack(ctx) {
      return hasSixPlusInPitch(ctx) ? 1 : 0;
    },
  },

  "strongest survive|1": strongestSurvive(),
  "strongest survive|2": strongestSurvive(),
  "strongest survive|3": strongestSurvive(),

  "test of might|1": clashForToken(MIGHT),

  "agile windup|3": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      oncePerTurn: false,
      onActivate(ctx) {
        ctx.createToken(AGILITY);
      },
    },
  },

  "bear hug|3": {
    canPlay: hasSixPlusInPitch,
  },

  "rally the coast guard|3": {
    defenseAbility: { discard: 1, oncePerTurn: true },
    onDefendAbility(ctx) {
      ctx.addModifier({ scope: "chain-link", defense: 3 });
      ctx.logPublic("Rally the Coast Guard gains +3 defense");
    },
  },

  "reincarnate|3": {
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Put this on the bottom of its owner's deck",
      condition: (ctx, discarded, eventContext) =>
        eventContext?.atRandom === true && discarded?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.putOnDeckBottom(ctx.self.instanceId),
    }],
  },

  "run roughshod|3": {
    canPlay(ctx) {
      return ctx.getFlag("player", "discardedSixPlusThisTurn") === true;
    },
  },

  "unexpected backhand|3": {
    onClashRevealed(ctx, won, opposingSeat) {
      if (won) ctx.dealDamage(opposingSeat, 1);
    },
  },
};
