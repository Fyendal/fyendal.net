import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { decisionMessage, decisionPrompt, localizedCardLog, opponentSeat } from "./shared-helpers.js";

function hasKeyword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, keyword: string): boolean {
  const key = keyword.toLowerCase();
  if ((card.suppressedKeywords ?? []).includes(key)) return false;
  return [...(ctx.cardData(card.cardId).keywords ?? []), ...(card.grantedKeywords ?? [])]
    .some((candidate) => candidate.toLowerCase() === key);
}

function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("arrow");
}

function minFace(ownedCardTypes: CardScript["ownedCardTypes"], flip: (ctx: ScriptCtx) => void): CardScript {
  return {
    ownedCardTypes,
    triggers: [
      {
        event: "end-of-turn",
        label: "Flip this hero",
        labelMessage: decisionMessage("card.trigger.obk.min.flip"),
        effect: flip,
      },
    ],
  };
}

function flipToBack(ctx: ScriptCtx): void {
  const backId = ctx.cardData(ctx.self.cardId).backId;
  if (backId) ctx.becomeHero(backId);
}

function flipToFront(ctx: ScriptCtx): void {
  const frontId = ctx.self.originalHeroCardId;
  if (frontId) ctx.becomeHero(frontId);
}

const minGenius = minFace({ gain: ["mechanologist"] }, flipToBack);
const minMad = minFace({ loseClassTalent: true }, flipToFront);

const vyle: CardScript = {
  activated: {
    cost: 2,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    tap: true,
    canActivate: (ctx) => ctx.state.activePlayer === ctx.seat,
    onActivate(ctx) {
      // Each hero acts in turn order, starting with the turn player.
      for (const seat of [ctx.seat, opponentSeat(ctx)]) {
        const top = ctx.player(seat).deck[0];
        if (top) ctx.putIntoArsenal(top.instanceId, "deck");
      }
    },
  },
  modifyFriendlyAttack(ctx, attacking) {
    const opponentFaceUp = ctx.player(opponentSeat(ctx)).arsenal.some((card) => !card.faceDown);
    return opponentFaceUp && isArrow(ctx, attacking) ? 1 : 0;
  },
};

const huxley: CardScript = {
  triggers: [
    {
      event: "card-banished-for-boost",
      optional: true,
      label: "Tap this hero to play the banished card as though it were an instant this turn",
      labelMessage: decisionMessage("card.trigger.obk.huxley.instant"),
      condition: (ctx, banished) =>
        !!banished && !ctx.self.tapped && ctx.hasCardType(banished, "action") && hasKeyword(ctx, banished, "stealth"),
      canAccept: (ctx) => !ctx.self.tapped,
      effect(ctx, banished) {
        if (!banished || !ctx.tap(ctx.self.instanceId)) return;
        const card = ctx.player(ctx.seat).banish.find(
          (candidate) => candidate.instanceId === banished.instanceId && !candidate.faceDown,
        );
        if (!card) return;
        ctx.allowPlayFrom(card.instanceId, "banish", { asInstant: true });
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.self.cardId).name}: ${ctx.cardData(card.cardId).name} ` +
              "may be played as though it were an instant this turn",
            "card.log.obk.huxley.instant",
            { target: { kind: "card", cardId: card.cardId } },
          ),
        );
      },
    },
  ],
};

const azalea: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    tap: true,
    effectCardCosts: [
      {
        zone: "arsenal",
        move: "put-on-deck-bottom",
        count: 1,
        prompt: decisionPrompt(
          "Put a card from your arsenal on the bottom of your deck as a cost",
          "card.obk.azalea.cost.arsenal.bottom",
        ),
      },
    ],
    onActivate(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top || !ctx.putIntoArsenal(top.instanceId, "deck")) return;
      const target = { kind: "card", cardId: top.cardId } as const;
      const name = ctx.cardData(top.cardId).name;
      if (hasKeyword(ctx, top, "stealth")) {
        ctx.addCardTempPower(top.instanceId, 1);
        ctx.grantCardKeyword(top.instanceId, "go again");
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.self.cardId).name}: ${name} gets +1 power and go again this turn`,
            "card.log.obk.azalea.stealth",
            { target },
          ),
        );
      }
      if (isArrow(ctx, top)) {
        ctx.grantCardKeyword(top.instanceId, "veil");
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.self.cardId).name}: ${name} gets veil this turn`,
            "card.log.obk.azalea.veil",
            { target },
          ),
        );
      }
    },
  },
};

export const obk: Record<string, CardScript> = {
  "min, genius|0": minGenius,
  "min, half-genius|0": minGenius,
  "min, mad|0": minMad,
  "min, half-mad|0": minMad,
  "vyle, catalyst of collapse|0": vyle,
  "vyle|0": vyle,
  "huxley, racketeer|0": huxley,
  "huxley|0": huxley,
  "azalea, ace of spades|0": azalea,
  "azalea, lone vigilante|0": azalea,
};
