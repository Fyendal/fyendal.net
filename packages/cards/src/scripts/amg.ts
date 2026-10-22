import type { CardScript } from "@fyendal/engine";
import { attackAbility, decisionMessage, decisionPrompt } from "./shared-helpers.js";

// AMG — Min armory deck, released beside OBK.

const REVERE_HOOK = "amg-revere-shuffle";

const revereTheCopperIdol: CardScript = {
  onPlay(ctx) {
    const candidates = ctx.player(ctx.seat).banish.filter(
      (card) => !card.faceDown && ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("mechanologist"),
    );
    if (!candidates.length) {
      ctx.shuffleIntoDeck([]);
      return;
    }
    ctx.requestCardChoices(
      REVERE_HOOK,
      decisionPrompt(
        "Choose up to 3 Mechanologist action cards with different names to shuffle into your deck",
        "card.amg.revere.shuffle.choose",
      ),
      candidates.map((card) => card.instanceId),
      0,
      3,
      undefined,
      undefined,
      undefined,
      true,
    );
  },
  onChooseMany(ctx, hook, options) {
    if (hook === REVERE_HOOK) ctx.shuffleIntoDeck(options.map(Number));
  },
  triggers: [
    {
      event: "card-banished-for-boost",
      sourceZone: "self",
      // Any hero's Boost may banish this (Madness Spiral banishes opposing deck tops).
      whose: "any",
      label: "Shuffle this into its owner's deck",
      labelMessage: decisionMessage("card.trigger.amg.revere.shuffle"),
      effect(ctx) {
        const { instanceId, owner } = ctx.self;
        if (ctx.player(owner).banish.some((card) => card.instanceId === instanceId)) {
          ctx.shuffleIntoDeck([instanceId]);
        }
      },
    },
  ],
};

export const amg: Record<string, CardScript> = {
  "unstable plasma pistol|0": {
    activated: attackAbility(2, { oncePerTurn: false }),
    modifyAttack: (ctx) => (ctx.getFlag("player", "boostBanishedOpponentCard") === true ? 2 : 0),
  },
  "madness spiral|3": { boostBanishesOtherDeckTops: true },
  "revere the copper idol|3": revereTheCopperIdol,
};
