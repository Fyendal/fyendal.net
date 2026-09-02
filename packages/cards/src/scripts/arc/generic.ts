import type { CardScript } from "@fyendal/engine";
import {
  buffNextAttack,
  commonOptionMessages,
  decisionPrompt,
  optN,
  optOnChoose,
  opponentSeat,
  yesNoPrompt,
} from "../shared-helpers.js";

function vestOfTheFirstFist(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "action";
    },
    onHit(ctx) {
      ctx.requestChoice(
        "vest-first-fist",
        yesNoPrompt("Destroy Vest of the First Fist to gain {r}{r}?", "card.arc.vest.destroy"),
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "vest-first-fist" || option !== "yes") return;
      ctx.destroySelf();
      ctx.changeResources(ctx.seat, 2);
      ctx.logPublic("Vest of the First Fist is destroyed — gain {r}{r}");
    },
  };
}

function lifeForALife(): CardScript {
  return {
    triggers: [{ event: "card-played", sourceZone: "self", label: "Gain go again", condition: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0, effect(ctx, played) { if (played) ctx.grantGoAgain(played.instanceId); } }],
    onHit(ctx) {
      ctx.gainLife(ctx.seat, 1);
    },
  };
}

function enchantingMelody(prevention: number): CardScript {
  return {
    fixedDamagePrevention: { amount: prevention, destroySource: true },
    triggers: [
      {
        event: "end-of-turn",
        sourceZone: "arena",
        label: "Destroy Enchanting Melody unless you played a non-attack action",
        condition: (ctx) =>
          ctx.getFlag("player", "playedNonAttackAction") !== true,
        effect: (ctx) => ctx.destroySelf(),
      },
    ],
  };
}

function plunderRun(attack: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.setCounter("drawOnHit", 1);
      ctx.addModifier({ scope: "until-end-of-turn" });
      if (ctx.fromArsenal) buffNextAttack(ctx, { attack, appliesTo: "attack-action" });
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackCardType === "action" && ctx.getCounter("drawOnHit") > 0;
    },
    onHit(ctx) {
      ctx.setCounter("drawOnHit", 0);
      ctx.drawCards(ctx.seat, 1);
    },
  };
}

function eirinasPrayer(base: number): CardScript {
  return {
    onPlay(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      const pitch = ctx.cardData(top.cardId).pitch ?? 0;
      const amount = Math.max(0, base - pitch);
      ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`);
      if (amount > 0) ctx.preventNextArcaneDamage(ctx.seat, amount);
    },
  };
}

function backAlleyBreakline(): CardScript {
  return {
    triggers: [{
      event: "card-moved-from-deck-by-effect",
      sourceZone: "any",
      label: "Gain 1 action point",
      condition: (ctx, card) => card?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.gainActionPoint(),
    }],
  };
}

function cadaverousContraband(): CardScript {
  return {
    onHit(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => {
        return ctx.hasCardType(card, "action") && !ctx.cardTypes(card).includes("attack");
      });
      if (cards.length === 0) return;
      ctx.requestCardChoice(
        "cadaverous-top",
        decisionPrompt("Put a non-attack action from your graveyard on top of your deck?", "card.arc.nonattack.top", { optionMessages: commonOptionMessages("none") }),
        ["none", ...cards.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "cadaverous-top" || option === "none") return;
      ctx.putOnDeckTop(Number(option));
    },
  };
}

function ferventForerunner(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("link", "fromArsenal") === true) ctx.grantGoAgain();
    },
    onHit(ctx) {
      optN(ctx, 2);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

function moonWish(): CardScript {
  return {
    alternativePlayCost: { kind: "put-hand-card-on-deck-top" },
    onHit(ctx) {
      const kisses = ctx.player(ctx.seat).deck.filter(
        (card) => ctx.cardData(card.cardId).name === "Sun Kiss",
      );
      if (kisses.length === 0) return;
      ctx.requestCardChoice(
        "moon-wish-search",
        decisionPrompt("Search your deck for a Sun Kiss?", "card.arc.sunkiss.search", { optionMessages: commonOptionMessages("none") }),
        ["none", ...kisses.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "moon-wish-search" || option === "none") return;
      const instanceId = Number(option);
      const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === instanceId);
      if (!card || !ctx.moveToHand(instanceId)) return;
      ctx.shuffleDeck(ctx.seat);
      ctx.logPublic(`${ctx.data.name} finds ${ctx.cardData(card.cardId).name}`);
    },
  };
}

function pushThePoint(): CardScript {
  return {
    modifyAttack(ctx) {
      const index = ctx.state.chain.findIndex(
        (link) => link.attackingCard.instanceId === ctx.self.instanceId,
      );
      return index > 0 && ctx.state.chain[index - 1]?.hit ? 2 : 0;
    },
  };
}

function ravenousRabble(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      const pitch = top ? (ctx.cardData(top.cardId).pitch ?? 0) : 0;
      ctx.setFlag("link", "ravenousRabblePenalty", pitch);
      if (top) ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`);
    },
    modifyAttack(ctx) {
      return -Number(ctx.getFlag("link", "ravenousRabblePenalty") || 0);
    },
  };
}

function rifting(): CardScript {
  return {
    onHit(ctx) {
      ctx.setFlag("player", "nextNonAttackAsInstant", true);
      ctx.logPublic("Your next non-attack action card this turn may be played as though it were an instant");
    },
  };
}

function vigorRush(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "playedNonAttackAction") === true) ctx.grantGoAgain();
    },
  };
}

function forceSight(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack, appliesTo: "attack-action" });
      if (ctx.fromArsenal) optN(ctx, 2);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

function leadTheCharge(minCost: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        minCost,
        onActionPlayedGainActionPoints: 1,
      });
    },
  };
}

function sunKiss(life: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.gainLife(ctx.seat, life);
      if (ctx.getFlag("player", "playedName:moon wish") !== true) return;
      ctx.drawCards(ctx.seat, 1);
      ctx.gainActionPoint();
    },
  };
}

const fateForeseen: CardScript = {
  onPlay(ctx) {
    optN(ctx, 1);
  },
  onChoose(ctx, hook, option) {
    optOnChoose(ctx, hook, option);
  },
};

export const arcGeneric: Record<string, CardScript> = {
  "vest of the first fist|0": vestOfTheFirstFist(),
  "bracers of belief|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        const attack = 3 - (ctx.cardData(top.cardId).pitch ?? 0);
        ctx.logPublic(`${ctx.data.name} reveals ${ctx.cardData(top.cardId).name}`);
        buffNextAttack(ctx, { attack, appliesTo: "attack-action" });
      },
    },
  },

  "life for a life|1": lifeForALife(),
  "life for a life|2": lifeForALife(),
  "life for a life|3": lifeForALife(),
  "enchanting melody|1": enchantingMelody(4),
  "enchanting melody|2": enchantingMelody(3),
  "enchanting melody|3": enchantingMelody(2),
  "plunder run|1": plunderRun(3),
  "plunder run|2": plunderRun(2),
  "plunder run|3": plunderRun(1),
  "eirina's prayer|1": eirinasPrayer(6),
  "eirina's prayer|2": eirinasPrayer(5),
  "eirina's prayer|3": eirinasPrayer(4),
  "back alley breakline|1": backAlleyBreakline(),
  "back alley breakline|2": backAlleyBreakline(),
  "cadaverous contraband|1": cadaverousContraband(),
  "cadaverous contraband|2": cadaverousContraband(),
  "cadaverous contraband|3": cadaverousContraband(),
  "fervent forerunner|1": ferventForerunner(),
  "fervent forerunner|2": ferventForerunner(),
  "fervent forerunner|3": ferventForerunner(),
  "moon wish|1": moonWish(),
  "moon wish|2": moonWish(),
  "moon wish|3": moonWish(),
  "push the point|1": pushThePoint(),
  "push the point|2": pushThePoint(),
  "push the point|3": pushThePoint(),
  "ravenous rabble|2": ravenousRabble(),
  "ravenous rabble|3": ravenousRabble(),
  "rifting|1": rifting(),
  "rifting|2": rifting(),
  "rifting|3": rifting(),
  "vigor rush|1": vigorRush(),
  "vigor rush|2": vigorRush(),
  "vigor rush|3": vigorRush(),
  "come to fight|1": { onPlay: (ctx) => buffNextAttack(ctx, { attack: 3, appliesTo: "attack-action" }) },
  "come to fight|2": { onPlay: (ctx) => buffNextAttack(ctx, { attack: 2, appliesTo: "attack-action" }) },
  "force sight|1": forceSight(3),
  "force sight|2": forceSight(2),
  "force sight|3": forceSight(1),
  "lead the charge|1": leadTheCharge(0),
  "lead the charge|2": leadTheCharge(1),
  "lead the charge|3": leadTheCharge(2),
  "sun kiss|1": sunKiss(3),
  "sun kiss|2": sunKiss(2),
  "sun kiss|3": sunKiss(1),
  "fate foreseen|1": fateForeseen,
  "fate foreseen|2": fateForeseen,
  "fate foreseen|3": fateForeseen,
};
