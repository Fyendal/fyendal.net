import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, commonOptionMessages, decisionMessage, decisionPrompt } from "./shared-helpers.js";

// AMG — Min armory deck, released beside OBK.

const REVERE_HOOK = "amg-revere-shuffle";
const REVERE_LIMIT = 3;
const REVERE_COUNT = "revereCount";
const REVERE_DONE = "revereDone";

function revereChosen(ctx: ScriptCtx): number[] {
  return Array.from({ length: ctx.getCounter(REVERE_COUNT) }, (_, index) => ctx.getCounter(`revereCard:${index}`));
}

function revereCandidates(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  const banish = ctx.player(ctx.seat).banish;
  const chosen = revereChosen(ctx);
  const chosenNames = new Set(
    banish.filter((card) => chosen.includes(card.instanceId)).flatMap((card) => ctx.cardNames(card)),
  );
  return banish.filter(
    (card) =>
      !card.faceDown &&
      !chosen.includes(card.instanceId) &&
      ctx.hasCardType(card, "action") &&
      ctx.cardTypes(card).includes("mechanologist") &&
      !ctx.cardNames(card).some((name) => chosenNames.has(name)),
  );
}

/** Choose the Mechanologist action cards one at a time so each pick can
 * exclude the names already chosen, then shuffle them in together. */
function continueRevere(ctx: ScriptCtx): void {
  const chosen = revereChosen(ctx);
  const choosing = chosen.length < REVERE_LIMIT && ctx.getCounter(REVERE_DONE) === 0;
  const candidates = choosing ? revereCandidates(ctx) : [];
  if (candidates.length) {
    ctx.requestCardChoice(
      REVERE_HOOK,
      chosen.length === 0
        ? decisionPrompt(
            "Shuffle a Mechanologist action card from your banished zone into your deck?",
            "card.amg.revere.shuffle",
            { optionMessages: commonOptionMessages("done") },
          )
        : decisionPrompt(
            "Shuffle another differently named Mechanologist action card?",
            "card.amg.revere.shuffle.next",
            { optionMessages: commonOptionMessages("done") },
          ),
      ["done", ...candidates.map((card) => card.instanceId)],
    );
    return;
  }
  ctx.shuffleIntoDeck(chosen);
}

const revereTheCopperIdol: CardScript = {
  onPlay(ctx) {
    ctx.setCounter(REVERE_COUNT, 0);
    ctx.setCounter(REVERE_DONE, 0);
    continueRevere(ctx);
  },
  onChoose(ctx, hook, option) {
    if (hook !== REVERE_HOOK) return;
    const picked = option === "done"
      ? undefined
      : revereCandidates(ctx).find((card) => card.instanceId === Number(option));
    if (picked) {
      const count = ctx.getCounter(REVERE_COUNT);
      ctx.setCounter(`revereCard:${count}`, picked.instanceId);
      ctx.setCounter(REVERE_COUNT, count + 1);
    } else {
      ctx.setCounter(REVERE_DONE, 1);
    }
    continueRevere(ctx);
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
