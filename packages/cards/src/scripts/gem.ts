import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { bloodDebtScript as bloodDebt } from "./shared-helpers.js";

const RUNECHANT = "SBA036";
const GATE = "IAR222";

function specializedRunechant(
  onUsurped: (ctx: ScriptCtx, attack: Parameters<NonNullable<CardScript["onUsurped"]>>[1]) => void,
): CardScript {
  return {
    runechantToken: true,
    onUsurped,
    onDestroyed(ctx) { ctx.createToken(RUNECHANT); },
    triggers: [
      {
        event: "begin-action-phase",
        whose: "subject",
        label: "Destroy this and create a Runechant",
        effect(ctx) { ctx.destroySelf(); },
      },
      {
        event: "card-played",
        label: "Destroy this and create a Runechant",
        condition: (ctx, played) => !!played &&
          ctx.hasCardType(played, "action") &&
          ctx.cardTypes(played).includes("attack"),
        effect(ctx) { ctx.destroySelf(); },
      },
    ],
  };
}

const ominousToll: CardScript = {
  onAttackDeclared(ctx) {
    const zombies = ctx.player(ctx.seat).hand.filter((card) =>
      ctx.cardTypes(card).includes("zombie")
    );
    if (zombies.length > 0) {
      ctx.requestCardChoice(
        "gem-ominous-toll-discard",
        "Discard a zombie to create a Gate to i'Arathael?",
        ["no", ...zombies.map((card) => card.instanceId)],
      );
    }
  },
  onChoose(ctx, hook, option) {
    if (hook !== "gem-ominous-toll-discard" || option === "no") return;
    const card = ctx.player(ctx.seat).hand.find((candidate) =>
      candidate.instanceId === Number(option) && ctx.cardTypes(candidate).includes("zombie")
    );
    if (card && ctx.discardCard(ctx.seat, card.instanceId)) ctx.createToken(GATE);
  },
};

export const gem: Record<string, CardScript> = {
  "consuming appetite|2": bloodDebt({
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "banish",
      onActivate(ctx) {
        ctx.setFlag("player", "gemConsumingAppetiteActive", true);
      },
    },
  }),

  "ominous toll|1": ominousToll,
  "ominous toll|2": ominousToll,
  "ominous toll|3": ominousToll,

  "embrace ursur|1": {
    onAttackDeclared(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "gem-embrace-ursur-banish",
          "Banish a card from your hand?",
          ["no", ...hand.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "gem-embrace-ursur-banish" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) =>
        candidate.instanceId === Number(option)
      );
      if (!card) return;
      const types = ctx.cardTypes(card);
      if (!ctx.banish(card.instanceId)) return;
      if (types.includes("runeblade")) ctx.createToken(RUNECHANT);
      if (types.includes("shadow")) ctx.grantGoAgain();
    },
  },

  "runechant of greed|2": specializedRunechant((ctx) => ctx.drawCards(ctx.seat, 1)),
  "runechant of envy|2": specializedRunechant((ctx) => ctx.gainLife(ctx.seat, 1)),
  "runechant of gluttony|2": specializedRunechant((ctx) => ctx.changeResources(ctx.seat, 1)),
  "runechant of lust|2": specializedRunechant((ctx) => ctx.createToken(RUNECHANT)),
  "runechant of pride|2": specializedRunechant((ctx, attack) => {
    ctx.addCardTempPower(attack.instanceId, 1);
  }),
  "runechant of sloth|2": specializedRunechant((ctx, attack) => {
    ctx.grantCardKeyword(attack.instanceId, "Go again");
  }),
  "runechant of wrath|2": specializedRunechant((ctx, attack) => {
    ctx.grantCardKeyword(attack.instanceId, "Overpower");
  }),
};
