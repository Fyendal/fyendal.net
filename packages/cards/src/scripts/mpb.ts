import type { CardScript } from "@fyendal/engine";
import {
  attackAbility,
  beatChest,
  beatenChest,
  decisionMessage,
  decisionPrompt,
  opponentSeat,
  targetsHero,
} from "./shared-helpers.js";

// Mastery Pack: Brute.
const AGILITY = "SBL034";
const MIGHT = "SLY035";
const CLUB = "club";

function babaza(): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      label: "Create Agility or Might, or intimidate",
      canActivate: beatenChest,
      onActivate(ctx) {
        ctx.requestChoice(
          "babaza-mode",
          decisionPrompt(`${ctx.data.name}: choose 1`, "card.mpb.babaza.mode.choose", {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
            optionMessages: {
              agility: decisionMessage("card.mpb.option.agility"),
              might: decisionMessage("card.mpb.option.might"),
              intimidate: decisionMessage("card.mpb.option.intimidate"),
            },
          }),
          ["agility", "might", "intimidate"],
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "babaza-mode") return;
      if (option === "agility") ctx.createToken(AGILITY);
      else if (option === "might") ctx.createToken(MIGHT);
      else ctx.intimidate(opponentSeat(ctx));
    },
  };
}

function zuul(): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      label: "Create a Might token",
      canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, `hitType:${CLUB}`) === true,
      onActivate(ctx) {
        ctx.createToken(MIGHT);
      },
    },
    onFriendlyAttackDeclared(ctx) {
      if (ctx.link && ctx.cardTypes(ctx.link.attackingCard).includes(CLUB)) {
        ctx.addModifier({ scope: "chain-link", goAgainIfAttackPowerAtLeast: 6 });
      }
    },
  };
}

export const mpb: Record<string, CardScript> = {
  "babaza, bloodbeat heartfather|0": babaza(),
  "babaza|0": babaza(),
  "zuul, clubcaste|0": zuul(),
  "zuul|0": zuul(),
  "deathbeat bludgeon|0": {
    activated: attackAbility(2, { tap: true, oncePerTurn: false }),
    modifyAttack: (ctx) => (ctx.getFlag("player", "discardedSixPlusThisTurn") === true ? 1 : 0),
  },
  "tenderized|2": {
    canTriggerOnHit: targetsHero,
    onHit(ctx) {
      const defender = opponentSeat(ctx);
      const amount = Number(ctx.getPlayerFlag(defender, `damageTakenFromType:${CLUB}`)) || 0;
      if (amount > 0) ctx.loseLife(defender, amount);
    },
  },
  "beat of savagery|3": beatChest({
    onPlay(ctx) {
      if (beatenChest(ctx)) ctx.gainResources(ctx.seat, 4);
    },
  }),
  "fury|0": {
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Destroy Fury; you've beaten chest this turn",
        labelMessage: decisionMessage("card.trigger.mpb.fury.destroy"),
        effect(ctx) {
          ctx.destroySelf();
          ctx.setFlag("player", "beatenChestThisTurn", true);
        },
      },
    ],
  },
};
