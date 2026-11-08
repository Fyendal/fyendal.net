import type { CardScript } from "@fyendal/engine";
import {
  attackAbility,
  commonOptionMessages,
  decisionMessage,
  decisionPrompt,
  flipHero,
  ongoingLabel,
  hasLiveTurnEffect,
} from "./shared-helpers.js";

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

const brainwaveReformer: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    destroySelfCost: true,
    onActivate(ctx) {
      flipHero(ctx);
    },
  },
};

const syncopatedHeartPump: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    tap: true,
    onActivate(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "gain 1 resource whenever 1 or more cards are banished from an opponent's deck",
          "card.effect.amg.heartpump",
        ),
      });
      ctx.destroyAtEndPhase(ctx.self.instanceId);
    },
  },
  triggers: [
    {
      event: "cards-banished",
      whose: "any",
      label: "Gain 1 resource",
      labelMessage: { id: "card.trigger.common.resource.gain", values: { amount: 1 } },
      condition: (ctx, card, event) =>
        !!card &&
        card.owner !== ctx.seat &&
        event?.from === "deck" &&
        hasLiveTurnEffect(ctx),
      effect(ctx) {
        ctx.gainResources(ctx.seat, 1);
      },
    },
  ],
};

const QUICKDIGIT_HOOK = "amg-quickdigit-item";

const quickdigitAssemblers: CardScript = {
  onDefend(ctx) {
    const items = ctx.player(ctx.seat).hand.filter(
      (card) => ctx.cardTypes(card).includes("item") && (ctx.cardData(card.cardId).cost ?? 0) === 0,
    );
    if (!items.length) return;
    ctx.requestCardChoice(
      QUICKDIGIT_HOOK,
      decisionPrompt("Put an item with cost 0 from your hand into the arena?", "card.amg.quickdigit.item.optional", {
        optionMessages: commonOptionMessages("none"),
      }),
      ["none", ...items.map((card) => card.instanceId)],
    );
  },
  onChoose(ctx, hook, option) {
    if (hook === QUICKDIGIT_HOOK && option !== "none" && ctx.settleCard(Number(option))) {
      ctx.addCardTempDefense(ctx.self.instanceId, 1);
    }
  },
};

export const amg: Record<string, CardScript> = {
  "unstable plasma pistol|0": {
    activated: attackAbility(2, { oncePerTurn: false }),
    modifyAttack: (ctx) => (ctx.getFlag("player", "boostBanishedOpponentCard") === true ? 2 : 0),
  },
  "brainwave reformer|0": brainwaveReformer,
  "syncopated heart pump|0": syncopatedHeartPump,
  "quickdigit assemblers|0": quickdigitAssemblers,
  "madness spiral|3": { boostBanishesOtherDeckTops: true },
  "revere the copper idol|3": revereTheCopperIdol,
};
