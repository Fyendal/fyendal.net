import type { CardScript } from "@fyendal/engine";
import {
  discardSixPlusPayoff,
  isSixPlus,
  lessonCounter,
  mentorFlipTrigger,
  mentorPayoff,
  opponentSeat,
  queueIntimidate,
} from "./shared-helpers.js";

const RUNECHANT = "SBA036";

function jackOLantern(pitch: 1 | 2 | 3): CardScript {
  return {
    onPlay(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      const matches = ctx.cardColor(top) === pitch;
      if (ctx.banish(top.instanceId) && matches) ctx.createToken(RUNECHANT);
    },
  };
}

export const lgs: Record<string, CardScript> = {
  // Wrecking Ball (red)
  "wrecking ball|1": discardSixPlusPayoff((ctx) => {
    ctx.addModifier({ scope: "chain-link", intimidate: 1 });
    ctx.logPublic("Wrecking Ball: intimidate");
  }),
  "chief ruk'utan|0": {
    activeWhileFaceUpInArsenal: true,
    // Chief Ruk'utan — mentor: face down in arsenal, flips up at start of turn
    triggers: [mentorFlipTrigger(), {
      event: "card-played",
      label: "Intimidate",
      condition: (ctx, played) => ctx.self.faceDown !== true && isSixPlus(ctx, played),
      effect(ctx) {
      queueIntimidate(ctx);
      if (lessonCounter(ctx) >= 2) mentorPayoff(ctx, "Alpha Rampage", 1);
      },
    }],
  },
  "batter to a pulp|1": {
    combatDamageUnpreventableAtLeast: 4,
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4;
    },
    onHit(ctx) {
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment).filter(
        (card) => card !== undefined && (ctx.cardData(card.cardId).defense ?? 0) === 0,
      );
      if (equipment.length) {
        ctx.requestCardChoice(
          "batter-equipment",
          "Batter to a Pulp: destroy an equipment with no defense value",
          equipment.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "batter-equipment") ctx.destroyPermanent(Number(option));
    },
  },
  // Protect changes multiplayer defender eligibility. With exactly two heroes
  // there is no third hero to protect, so its token-transfer trigger cannot occur.
  "gesture of goodwill|3": {},
  "jack-o'-lantern|1": jackOLantern(1),
  "jack-o'-lantern|2": jackOLantern(2),
  "jack-o'-lantern|3": jackOLantern(3),
};
